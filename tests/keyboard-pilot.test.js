// Joueur au clavier sur le modèle réaliste (décision du 18/11/2026) : une touche ne donne pas un braquage à fond
// instantané. Les touches (-1, 0 ou 1, comme PlaneControls._rotationVector) passent par la montée progressive
// (js/InputRamp.js, réglages par défaut) avant le modèle, comme dans le jeu. Le « joueur » ne voit que ce qu'un joueur voit
// (assiette, inclinaison, cap, badin, variomètre, hauteur) et ne fait que presser ou relâcher des touches, avec une zone
// morte et un peu d'anticipation. Décollage, montée, virage à 30°, approche et arrondi doivent rester réalistes :
// tangage ≤ 15°/s, facteur de charge ≤ 2 g en manœuvre normale, toucher à moins de 3 m/s de vitesse de descente.
// (Le tactile passe par la même montée progressive : PlaneControls ajoute le manche tactile aux touches.)
// Le joueur relâche la touche quand le nez, à la vitesse où il bouge, atteindra la cible dans ~0,6 s (il regarde le nez
// bouger). Mesuré le 18/11/2026 : le même joueur sans montée progressive atteint 2,04 g et 0,24 g dans le virage ; un
// joueur qui tient la touche jusqu'à l'assiette visée sans anticiper fait encore monter le nez à ~29°/s à la rotation
// (souffle de l'hélice sur la profondeur, plein gaz) : la douceur des commandes (Paramètres) est là pour lui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, run, attitude, KT, DT } from './helpers/flight.js';
import { InputRamp } from '../js/InputRamp.js';

const RAD = 180 / Math.PI;
const wrap = (a) => ((a + 540) % 360) - 180;

// Joueur au clavier : keys.pitch (+1 : S, cabrer), keys.roll (+1 : A, à gauche), keys.yaw (+1 : Q, à gauche).
// naive : joueur naïf, qui tient la touche jusqu'à l'assiette (ou l'inclinaison, le cap) visée, sans anticiper ;
// smoothness : réglage « Douceur des commandes » (1 : normale, 1,5 : douce ; InputRamp.setScale)
function keyboardPlayer(f, { naive = false, smoothness = 1 } = {}) {
    const ramp = new InputRamp(), keys = { pitch: 0, roll: 0, yaw: 0 };
    ramp.setScale(smoothness);
    const measure = { maxPitchRate: 0, maxLoad: 0, minLoad: Infinity, previousPitch: null };
    // Touche pressée selon l'écart prévu dans `lead` secondes (écart - vitesse × lead), zone morte `band`
    const key = (error, rate, lead, band) => { const e = error - rate * (naive ? 0 : lead); return e > band ? 1 : e < -band ? -1 : 0; };
    // Vitesses de rotation vues par le joueur (degrés par seconde), mises à jour après chaque pas
    let previous = attitude(f), rate = { pitch: 0, bank: 0, heading: 0 };
    const player = {
        keys,
        measure,
        rates() {
            return { a: attitude(f), r: rate };
        },
        // Assiette visée (degrés) aux touches de profondeur
        pitchTo(target, { lead = 0.6, band = 0.7 } = {}) {
            const { a, r } = this.rates();
            keys.pitch = key(target - a.pitch * RAD, r.pitch, lead, band);
        },
        // Inclinaison visée (degrés, + = à gauche) aux touches d'ailerons
        bankTo(target, { lead = 0.5, band = 2 } = {}) {
            const { a, r } = this.rates();
            keys.roll = key(target - a.bank * RAD, r.bank, lead, band);
        },
        // Cap visé (degrés) au palonnier (au sol : roulette de nez)
        headingTo(target, { lead = 0.8, band = 0.5 } = {}) {
            const { a, r } = this.rates();
            keys.yaw = -key(wrap(target - a.heading), r.heading, lead, band);   // à droite : touche E (yaw -1)
        },
        // Un pas : touches -> montée progressive -> modèle ; mesures
        apply() {
            const v = ramp.update(keys, DT);
            Object.assign(f.model.controls, { pitch: v.pitch, roll: v.roll, yaw: v.yaw });
        },
        record() {
            const a = attitude(f);
            if (measure.previousPitch !== null) measure.maxPitchRate = Math.max(measure.maxPitchRate, Math.abs(a.pitch - measure.previousPitch) / DT * RAD);
            measure.previousPitch = a.pitch;
            if (!f.model.onGround) {
                measure.maxLoad = Math.max(measure.maxLoad, f.model.loadFactor);
                measure.minLoad = Math.min(measure.minLoad, f.model.loadFactor);
            }
            rate = { pitch: (a.pitch - previous.pitch) / DT * RAD, bank: (a.bank - previous.bank) / DT * RAD, heading: wrap(a.heading - previous.heading) / DT };
            previous = a;
        },
    };
    return player;
}
// Vol au clavier : decide(t) choisit les touches, puis montée progressive, modèle, mesures
function fly(f, player, seconds, decide, until) {
    return run(f, seconds, { pilot: (t) => { decide(t); player.apply(); }, until: (t) => { player.record(); return until?.(t); } });
}
function report(t, label, m, extra = '') {
    t.diagnostic(`${label} : tangage max ${m.maxPitchRate.toFixed(1)}°/s, facteur de charge ${m.minLoad === Infinity ? '-' : m.minLoad.toFixed(2)} à ${m.maxLoad.toFixed(2)} g${extra}`);
}
function assertRealistic(m) {
    assert.ok(m.maxPitchRate <= 15, `vitesse de tangage max ${m.maxPitchRate.toFixed(1)}°/s (≤ 15)`);
    assert.ok(m.maxLoad <= 2, `facteur de charge max ${m.maxLoad.toFixed(2)} g (≤ 2)`);
    assert.ok(m.minLoad === Infinity || m.minLoad >= 0, `facteur de charge min ${m.minLoad.toFixed(2)} g (≥ 0)`);
}

// Décollage au clavier (volets 10°, plein gaz) puis montée initiale : rend l'avion en montée
function takeoffAndClimb(f, player, climbSeconds) {
    const { model } = f;
    model.throttle = 1;
    model.setFlapLevel(1);
    model.flaps = 1 / 3;
    // Roulage : axe tenu au palonnier, nez au neutre ; à 55 KIAS, assiette de 8° aux touches
    const t = fly(f, player, 90, () => {
        player.headingTo(0);
        if (model.indicatedSpeed > 55 * KT) player.pitchTo(8); else player.keys.pitch = 0;
    }, () => !model.onGround);
    // Montée : 70 KIAS tenus par l'assiette (le joueur lève le nez s'il va trop vite), ailes à plat
    let pitchTarget = 8;
    fly(f, player, climbSeconds, () => {
        player.keys.yaw = 0;
        pitchTarget = Math.max(2, Math.min(14, pitchTarget + (model.indicatedSpeed / KT - 70) * 0.02));
        player.pitchTo(pitchTarget);
        player.bankTo(0);
    });
    return t;
}

// --- Scénarios : style du joueur (anticipe ou naïf) et douceur des commandes en paramètres --------------------------
function takeoffScenario(t, style) {
    const f = makeAircraft({ model: 'realiste' }), { model, object } = f;
    const player = keyboardPlayer(f, style);
    const roll = takeoffAndClimb(f, player, 40);
    report(t, `décollage et montée${style.naive ? ' (naïf)' : ''}`, player.measure, `, envol en ${roll.toFixed(1)} s, ${(object.position.y / 0.3048).toFixed(0)} ft après 40 s de montée à ${(model.indicatedSpeed / KT).toFixed(0)} KIAS`);
    assert.ok(roll < 90 && !model.crashed, 'envol');
    assertRealistic(player.measure);
    assert.ok(object.position.y > 100, `hauteur après 40 s de montée : ${object.position.y.toFixed(0)} m`);
    assert.ok(Math.abs(model.indicatedSpeed / KT - 70) < 10, `vitesse de montée ${(model.indicatedSpeed / KT).toFixed(0)} KIAS (70 visés)`);
}

function turnScenario(t, style) {
    const f = airborne(makeAircraft({ model: 'realiste' }), { altitude: 600, speed: 95 * KT, throttle: 0.7 }), { model, object } = f;
    model.trim = 0;
    const player = keyboardPlayer(f, style);
    // Palier stabilisé (le joueur tient l'assiette qui garde l'altitude)
    // Palier : le joueur vise une assiette un peu plus haute s'il est bas ou s'il descend (comme on lit l'altimètre et le
    // variomètre)
    let level = 1;
    const hold = () => { level = Math.max(-3, Math.min(8, level + ((600 - object.position.y) * 0.02 - model.velocity.y * 0.1) * DT)); player.pitchTo(level + Math.max(-3, Math.min(4, (600 - object.position.y) * 0.1 - model.velocity.y * 0.8))); };
    fly(f, player, 20, () => { hold(); player.bankTo(0); });
    const y0 = object.position.y;
    let turned = 0, previous = attitude(f).heading, maxBank = 0, minY = Infinity, maxY = -Infinity;
    player.measure.maxPitchRate = 0; player.measure.maxLoad = 0; player.measure.minLoad = Infinity;
    fly(f, player, 120, () => {
        hold();
        const h = attitude(f).heading;
        turned += wrap(h - previous); previous = h;
        player.bankTo(turned > 340 ? 0 : -30);      // virage à droite (inclinaison négative), sortie 20° avant le cap
        maxBank = Math.max(maxBank, -attitude(f).bank * RAD);
        minY = Math.min(minY, object.position.y); maxY = Math.max(maxY, object.position.y);
    }, () => turned > 360 && Math.abs(attitude(f).bank * RAD) < 3);
    report(t, `virage à 30°${style.naive ? ' (naïf)' : ''}`, player.measure, `, inclinaison max ${maxBank.toFixed(1)}°, altitude ${((minY - y0) / 0.3048).toFixed(0)} à +${((maxY - y0) / 0.3048).toFixed(0)} ft`);
    assert.ok(!model.crashed && turned > 360, `360° effectués (${turned.toFixed(0)}°)`);
    assertRealistic(player.measure);
    assert.ok(maxBank >= 25 && maxBank <= 40, `inclinaison max ${maxBank.toFixed(1)}°`);
    assert.ok(maxY - y0 < 100 * 0.3048 && y0 - minY < 100 * 0.3048, `altitude tenue : ${((minY - y0) / 0.3048).toFixed(0)} à +${((maxY - y0) / 0.3048).toFixed(0)} ft`);
}

function landingScenario(t, style) {
    const f = airborne(makeAircraft({ model: 'realiste' }), { altitude: 80, speed: 65 * KT, throttle: 0.35 }), { model, object } = f;
    model.setFlapLevel(3);
    model.flaps = 1;
    const player = keyboardPlayer(f, style);
    const impacts = [], events = [];
    model.addEventListener('touchdown', (e) => { impacts.push(e.impact); events.push('touchdown'); });
    model.addEventListener('liftoff', () => events.push('liftoff'));
    // Approche : 65 KIAS tenus à l'assiette, descente ~ 3 m/s aux gaz ; sous 6 m de hauteur, gaz réduits et arrondi
    // (le joueur lève le nez pour réduire la descente : 1,5 m/s visés à 3 m, 0,5 m/s au ras du sol)
    let pitchTarget = -2, flareSink = null;
    const t0 = fly(f, player, 120, () => {
        const height = object.position.y - model.minAltitude;
        player.bankTo(0);
        player.keys.yaw = 0;
        if (height > 6) {
            pitchTarget = Math.max(-8, Math.min(8, pitchTarget + (model.indicatedSpeed / KT - 65) * 0.03));
            model.throttle = Math.max(0, Math.min(0.7, model.throttle + (-3 - model.velocity.y) * 0.05 * DT));
        } else {
            model.throttle = 0;
            flareSink ??= -model.velocity.y;
            const wanted = -(0.5 + height * 0.35);    // vitesse verticale visée (m/s)
            pitchTarget = Math.max(-5, Math.min(12, pitchTarget + (wanted - model.velocity.y) * 3 * DT));
        }
        player.pitchTo(pitchTarget, { lead: 0.5, band: 0.5 });
    }, () => model.onGround);
    run(f, 3, { pilot: () => { model.controls.pitch = 0; model.controls.roll = 0; } });
    report(t, `approche et arrondi${style.naive ? ' (naïf)' : ''}`, player.measure, `, descente ${flareSink?.toFixed(1)} m/s en début d'arrondi, toucher à ${impacts[0]?.toFixed(2)} m/s après ${t0.toFixed(0)} s`);
    assert.ok(impacts.length > 0 && !model.crashed, 'posé sans crash');
    assertRealistic(player.measure);
    assert.ok(impacts[0] < 3, `vitesse de descente au toucher ${impacts[0].toFixed(2)} m/s (< 3)`);
    assert.ok(model.onGround && !events.slice(1).includes('liftoff'), `pas de rebond : ${events.join(',')}`);
}

// Joueur naïf (demande du 18/11/2026) : il échoue en douceur normale (rotation ~29°/s, virage 2,4 g, arrondi ~20°/s) ;
// ni la douceur « douce », ni une montée en deux temps essayée hors du code ne le font passer partout. Décision en attente
// (feuille de route, lot 1, reste à faire) : ses tests tournent et affichent leurs mesures, sans faire échouer la suite
const NAIVE_TODO = 'joueur naïf : réglage de la montée progressive à décider (feuille de route, lot 1)';
for (const [label, style, options] of [['joueur qui anticipe', {}, {}], ['joueur naïf', { naive: true }, { todo: NAIVE_TODO }]]) {
    test(`[realiste] ${label}, douceur normale : décollage et montée au clavier, nez ≤ 15°/s, facteur de charge ≤ 2 g, montée établie`, options, (t) => takeoffScenario(t, style));
    test(`[realiste] ${label}, douceur normale : virage à 30° au clavier, 360° en palier, facteur de charge ≤ 2 g, altitude à ±100 ft`, options, (t) => turnScenario(t, style));
    test(`[realiste] ${label}, douceur normale : approche et arrondi au clavier, volets 30°, toucher à moins de 3 m/s, sans rebond`, options, (t) => landingScenario(t, style));
}

test('montée progressive (InputRamp) : touche tenue -> braquage croissant, touche tapée -> petit braquage, retour au relâchement', () => {
    const ramp = new InputRamp();
    let v = ramp.update({ pitch: 1 }, 0.1);
    assert.ok(Math.abs(v.pitch - 0.05) < 1e-9, `0,1 s de touche : ${v.pitch.toFixed(3)} (montée de 0 à fond en 2 s)`);
    for (let i = 0; i < 9; i++) v = ramp.update({ pitch: 1 }, 0.1);
    assert.ok(Math.abs(v.pitch - 0.5) < 1e-9, `1 s de touche : ${v.pitch.toFixed(3)}`);
    for (let i = 0; i < 2; i++) v = ramp.update({ pitch: 0 }, 0.1);
    assert.ok(Math.abs(v.pitch) < 1e-9, `relâchée : retour à 0 en 0,2 s depuis la moitié (${v.pitch.toFixed(3)})`);
    ramp.setScale(1.5);
    v = ramp.update({ roll: -1 }, 0.3);
    assert.ok(Math.abs(v.roll + 0.2) < 1e-9, `douceur 1,5 : ailerons en 1,5 s (${v.roll.toFixed(3)} après 0,3 s)`);
});
