// Comportements du modèle de vol réglés à la main et validés en jeu (js/FlightModel.js), à garder quand on refait le
// modèle (feuille de route, lot 1) : envol sans saut, arrondi et effet de sol, vent de travers, relâchement du manche
// sans à-coup. Chaque test rappelle le commit qui a réglé le comportement ; les bornes viennent de mesures sur le modèle
// du 15/11/2026 (version 0.429, avant le lot 1), avec une marge : elles décrivent ce que le joueur a validé, pas une
// cible théorique. Un test qui tombe ici dit qu'une sensation réglée en jeu a changé.
// Les mêmes tests tournent sur les deux modèles de vol (TEST_MODEL : 'simplifie' par défaut, 'realiste' par
// flight-regression-realiste.test.js). Les commandes sont celles d'un pilote (rotation à l'assiette, axe tenu au
// palonnier pendant le roulage) : au modèle réaliste, une traction fixe au manche fait cabrer l'avion à plus de 30°/s
// et un roulage sans palonnier sort de la piste ; ces commandes ont été vérifiées sur le modèle simplifié avant adoption.
// Deux critères diffèrent sur le modèle réaliste, par décision du 15/11/2026, parce que l'ancien critère n'est pas
// physique : vent de travers sans aide et relâchement du manche (voir ces tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, run, attitude, speedHold, rotationPilot, pitchHold, headingHold, bankHold, KT, DT } from './helpers/flight.js';

const KIND = process.env.TEST_MODEL ?? 'simplifie';
const REALISTIC = KIND === 'realiste';
const RAD = 180 / Math.PI;
const wrap = (a) => ((a + 540) % 360) - 180;   // écart d'angle en degrés, dans ]-180 ; 180]

// Décollage plein gaz volets 10° : rotation à l'assiette de 8° dès 55 kt indiqués, axe de piste (cap nord) tenu au
// palonnier pendant le roulage ; rend la durée du roulement
function takeoff(f, { rotateKt = 55 } = {}) {
    const { model } = f;
    model.throttle = 1;
    model.setFlapLevel(1);
    model.flaps = 1 / 3;
    const rotate = rotationPilot(f, { rotateKt }), axis = headingHold(f, 0);
    const t = run(f, 90, { pilot: () => { rotate(); axis(); }, until: () => !model.onGround });
    model.controls.yaw = 0;
    return t;
}
// Montée initiale comme un pilote : assiette de 10° gardée 3 s après l'envol, puis 65 kt indiqués tenus au manche
// (POH 172P : montée normale 70 à 80 KIAS, 56 à 65 en piste courte)
function initialClimb(f) {
    const hold = speedHold(f, 65 * KT, { indicated: true }), attitudeHold = pitchHold(f, 10);
    return (t) => { if (t < 3) attitudeHold(); else hold(); };
}

// --- Envol (fc4d7a7) : transition de 1,5 s, le nez tourne d'abord au plus à 4°/s et la montée s'installe progressivement ;
// avant, le nez cabrait d'un coup sec et l'avion « sautait » du sol. Mesuré : 3,95°/s, 0,13 g, hauteur jamais perdue,
// 3,0 m/s de montée à 3 s -------------------------------------------------------------------------------------------------
test(`[${KIND}] envol sans saut (fc4d7a7) : 1,5 s après le décollage, nez ≤ 6°/s, accélération verticale ≤ 0,3 g, hauteur jamais perdue`, () => {
    const f = makeAircraft(), { model, object } = f;
    const events = [];
    for (const type of ['liftoff', 'touchdown', 'crash']) model.addEventListener(type, (e) => events.push(e.type));
    const t = takeoff(f);
    assert.ok(t < 90 && !model.crashed, 'envol');
    let pitch = attitude(f).pitch, vy = model.velocity.y, y = object.position.y;
    let maxRate = 0, maxAcc = 0, minDy = Infinity;
    const climb = initialClimb(f);
    run(f, 1.5, { pilot: (time) => {
        climb(time);
        const p = attitude(f).pitch;
        maxRate = Math.max(maxRate, Math.abs(p - pitch) / DT);
        maxAcc = Math.max(maxAcc, Math.abs(model.velocity.y - vy) / DT);
        minDy = Math.min(minDy, object.position.y - y);
        pitch = p; vy = model.velocity.y; y = object.position.y;
    } });
    assert.ok(maxRate * RAD <= 6, `vitesse de tangage max ${(maxRate * RAD).toFixed(1)}°/s`);
    assert.ok(maxAcc / 9.81 <= 0.3, `accélération verticale max ${(maxAcc / 9.81).toFixed(2)} g`);
    assert.ok(minDy >= -1e-6, `la hauteur ne baisse jamais après l'envol (${minDy.toFixed(4)} m)`);
    run(f, 1.5, { pilot: (time) => climb(time + 1.5) });
    assert.ok(model.velocity.y > 1, `montée établie 3 s après l'envol : ${model.velocity.y.toFixed(1)} m/s`);
    assert.deepEqual(events, ['liftoff'], 'pas de retour au sol ni de crash');
});

// --- Arrondi (9e2b08c : effet de sol McCormick, -7 % de traînée induite roues posées et +3,5 % de portance, au lieu de
// -21 % / +12 % qui faisaient flotter et remonter l'avion ; 81e5b7a : toucher adouci, plus de bascule en une image) -------
// Approche à 65 kt volets 30° depuis un palier à 40 m (procédure des mesures d'origine), puis manche tenu sous une hauteur
// donnée ; rend ce qui s'est passé
function approach({ throttle, pullBelow, pull }) {
    const f = airborne(makeAircraft(), { altitude: 40, speed: 65 * KT, throttle }), { model, object } = f;
    model.setFlapLevel(3);
    model.flaps = 1;
    const settle = speedHold(f, 65 * KT);
    const impacts = [], events = [];
    model.addEventListener('touchdown', (e) => { impacts.push(e.impact); events.push('touchdown'); });
    model.addEventListener('liftoff', () => events.push('liftoff'));
    const hold = settle;
    let flare = null, gain = 0;
    const t = run(f, 90, { pilot: (time) => {
        if (flare === null && object.position.y - model.minAltitude <= pullBelow) flare = { t: time, y: object.position.y, z: object.position.z };
        if (flare === null) hold(); else model.controls.pitch = pull;
        if (flare !== null) gain = Math.max(gain, object.position.y - flare.y);
    }, until: () => model.onGround });
    const landed = model.onGround && flare !== null ? { seconds: t - flare.t, metres: Math.abs(object.position.z - flare.z) } : null;
    run(f, 3, { pilot: () => { model.controls.pitch = 0; model.throttle = 0; } });   // roulage : l'avion reste au sol
    return { landed, gain, impact: impacts[0], events, crashed: model.crashed, onGround: model.onGround };
}
test(`[${KIND}] arrondi gaz réduits, manche à fond sous 6 m (9e2b08c) : posé en moins de 6 s sans remonter, impact doux, l'avion reste au sol`, () => {
    const a = approach({ throttle: 0, pullBelow: 6, pull: 1 });   // mesuré : posé en 4,1 s et 604 m, 2,9 m/s
    assert.ok(a.landed, 'posé');
    assert.ok(a.landed.seconds < 6, `posé en ${a.landed.seconds.toFixed(1)} s`);
    assert.ok(a.landed.metres < 900, `distance d'arrondi ${a.landed.metres.toFixed(0)} m`);
    assert.ok(a.gain < 0.3, `remontée pendant l'arrondi ${a.gain.toFixed(2)} m`);
    assert.ok(a.impact < 4.5, `impact ${a.impact.toFixed(2)} m/s`);
    assert.equal(a.crashed, false);
    assert.ok(a.onGround && !a.events.includes('liftoff'), `pas de rebond en l'air : ${a.events.join(',')}`);
});
test(`[${KIND}] arrondi gaz réduits, manche tiré à 35 % sous 3 m (81e5b7a) : posé en moins de 2 s, impact doux`, () => {
    const a = approach({ throttle: 0, pullBelow: 3, pull: 0.35 });   // mesuré : posé en 0,6 s, 2,6 m/s
    assert.ok(a.landed && a.landed.seconds < 2, `posé en ${a.landed?.seconds.toFixed(1)} s`);
    assert.ok(a.gain < 0.3 && a.impact < 4.5 && !a.crashed, `remontée ${a.gain.toFixed(2)} m, impact ${a.impact?.toFixed(2)} m/s`);
});
test(`[${KIND}] effet de sol (9e2b08c, McCormick) : ~7 % roues au ras du sol, presque rien à une demi-envergure`, () => {
    const low = airborne(makeAircraft(), { altitude: 0, speed: 30, throttle: 0 });
    low.object.position.y = low.model.minAltitude + 0.1;
    run(low, DT);
    assert.ok(low.model.groundEffect >= 0.05 && low.model.groundEffect <= 0.09, `au ras du sol : ${low.model.groundEffect.toFixed(3)}`);
    const half = airborne(makeAircraft(), { altitude: 0, speed: 30, throttle: 0 });
    half.object.position.y = half.model.minAltitude + 5.5;
    run(half, DT);
    assert.ok(half.model.groundEffect <= 0.03, `à une demi-envergure : ${half.model.groundEffect.toFixed(3)}`);
});

// --- Vent de travers (e93abf2) : décollage cap nord, 15 kt d'ouest (qui souffle vers l'est, +x), axe tenu au palonnier
// pendant le roulage, palonnier au neutre après l'envol ---------------------------------------------------------------
function crosswindTakeoff(assist, seconds = 10) {
    const f = makeAircraft(), { model, object } = f;
    model.assists.crosswindCorrection = assist;
    model.wind.set(15 * KT, 0, 0);
    takeoff(f);
    const x0 = object.position.x, heading0 = attitude(f).heading;
    const climb = initialClimb(f);
    const r = { heading0, maxHeadingError: 0, maxYawRate: 0, at3: null, x10: null, crashed: false, samples: [] };
    let previous = heading0;
    run(f, seconds, { pilot: (t) => {
        climb(t);
        model.controls.yaw = 0;
        const { heading, bank } = attitude(f);
        const error = wrap(heading - heading0), yawRate = wrap(heading - previous) / DT;
        previous = heading;
        r.maxHeadingError = Math.max(r.maxHeadingError, Math.abs(error));
        if (t > 0.1) r.maxYawRate = Math.max(r.maxYawRate, Math.abs(yawRate));
        r.samples.push({ t, heading: error, beta: model.beta * RAD, bank: bank * RAD, tas: model.airspeed });
        if (r.at3 === null && t >= 3) {
            // Dérive : vitesse sol est-ouest attendue si l'avion suit la masse d'air (vent + vitesse air projetée sur le cap)
            const expectedEast = model.wind.x + model.airspeed * Math.sin(heading / RAD);
            r.at3 = { headingError: error, beta: model.beta * RAD, driftError: model.velocity.x - expectedEast };
        }
        if (r.x10 === null && t >= 10) r.x10 = object.position.x - x0;
    } });
    r.x10 ??= object.position.x - x0;
    r.crashed = model.crashed;
    return r;
}
if (!REALISTIC) {
    // Mesuré sans l'aide : cap tenu à ±4,4° sur 10 s, lacet ≤ 1,2°/s, cap à 3 s -1,9°, 37 m sous le vent à 10 s
    test(`[${KIND}] vent de travers sans aide (e93abf2) : le nez garde son cap, l'avion prend la masse d'air en ~1 s sans à-coup et dérive sous le vent`, () => {
        const r = crosswindTakeoff(false);
        assert.equal(r.crashed, false);
        assert.ok(r.maxHeadingError <= 8, `écart de cap max ${r.maxHeadingError.toFixed(1)}° sur 10 s`);
        assert.ok(r.maxYawRate <= 3, `lacet max ${r.maxYawRate.toFixed(1)}°/s : pas de pivot brusque`);
        assert.ok(r.at3.headingError > -5, `à 3 s, le nez n'est pas parti face au vent (${r.at3.headingError.toFixed(1)}°)`);
        assert.ok(Math.abs(r.at3.beta) < 2, `bille au milieu à 3 s : dérapage ${r.at3.beta.toFixed(1)}°`);
        assert.ok(Math.abs(r.at3.driftError) < 1, `l'avion suit la masse d'air (écart ${r.at3.driftError.toFixed(2)} m/s)`);
        assert.ok(r.x10 > 15 && r.x10 < 80, `dérive sous le vent après 10 s : ${r.x10.toFixed(0)} m`);
    });
} else {
    // Modèle réaliste (décision du 15/11/2026) : garder le cap ET un dérapage nul n'est pas physique en vol. À l'envol, les
    // roues ne tiennent plus l'axe : l'avion dérape, la dérive (stabilité de route, Cnβ) le ramène face au vent relatif,
    // le dérapage tend vers zéro et le cap tourne vers le vent d'environ atan(vent de travers / vitesse vraie).
    // En montée plein gaz, le souffle hélicoïdal, le couple et le facteur P font aussi tourner l'avion à gauche sans
    // palonnier, vent ou pas (il faut du pied droit, comme sur le vrai). Pour isoler l'effet du vent, chaque mesure est
    // l'écart entre deux vols identiques (mêmes commandes), l'un avec 15 kt de vent de travers, l'autre sans vent :
    // ailes tenues à plat aux ailerons pour le cap et le dérapage ; ailerons au neutre pour l'inclinaison
    function crosswindPair(ailerons, seconds = 15) {
        const fly = (wind) => {
            const f = makeAircraft(), { model } = f;
            model.wind.set(wind * KT, 0, 0);
            takeoff(f);
            const climb = initialClimb(f), wings = bankHold(f, 0), samples = [];
            run(f, seconds, { pilot: (t) => {
                climb(t);
                model.controls.yaw = 0;
                if (ailerons) wings(); else model.controls.roll = 0;
                const { heading, bank } = attitude(f);
                samples.push({ t, heading: wrap(heading), beta: model.beta * RAD, bank: bank * RAD, tas: model.airspeed, crashed: model.crashed });
            } });
            return samples;
        };
        const wind = fly(15), calm = fly(0);
        return wind.map((s, i) => ({ t: s.t, heading: wrap(s.heading - calm[i].heading), beta: s.beta - calm[i].beta, bank: s.bank - calm[i].bank, tas: s.tas, crashed: s.crashed || calm[i].crashed }));
    }
    test(`[${KIND}] vent de travers sans aide, physique : dérapage dû au vent qui s'annule en quelques secondes, cap tourné vers le vent de atan(vent / TAS) ± 30 %, inclinaison qui ne diverge pas`, () => {
        const level = crosswindPair(true);
        assert.ok(!level.some((s) => s.crashed));
        const end = level.at(-1);
        const expected = -Math.atan(15 * KT / end.tas) * RAD;   // < 0 : vers l'ouest, d'où vient le vent
        const late = level.filter((s) => s.t >= 5);
        assert.ok(late.every((s) => Math.abs(s.beta) < 2), `dérapage dû au vent après 5 s : jusqu'à ${Math.max(...late.map((s) => Math.abs(s.beta))).toFixed(1)}°`);
        assert.ok(end.heading <= expected * 0.7 && end.heading >= expected * 1.3, `cap tourné par le vent de ${end.heading.toFixed(1)}° (attendu ${expected.toFixed(1)}° ± 30 %)`);
        const free = crosswindPair(false);
        const banks = free.map((s) => Math.abs(s.bank));
        assert.ok(Math.max(...banks) < 15, `inclinaison due au vent, ailerons au neutre : jusqu'à ${Math.max(...banks).toFixed(1)}°`);
        const firstHalf = Math.max(...banks.slice(0, Math.floor(banks.length / 2)));
        assert.ok(banks.at(-1) <= firstHalf + 2, `inclinaison qui ne diverge pas (fin ${banks.at(-1).toFixed(1)}°, plus tôt ${firstHalf.toFixed(1)}°)`);
    });
}
test(`[${KIND}] vent de travers avec l'aide « correction de dérive » : le nez pivote face au vent en ~3 s, trajectoire dans l'axe`, () => {
    const r = crosswindTakeoff(true);
    assert.equal(r.crashed, false);
    assert.ok(r.at3.headingError <= -5 && r.at3.headingError >= -16, `nez face au vent à 3 s : ${r.at3.headingError.toFixed(1)}°`);
    assert.ok(r.maxYawRate <= 10, `pivot progressif : lacet max ${r.maxYawRate.toFixed(1)}°/s`);
    assert.ok(Math.abs(r.x10) < 40, `trajectoire gardée près de l'axe après 10 s : ${r.x10.toFixed(0)} m`);
});

// --- Relâchement du manche (6861f36 ; latence : 40dcc89). Entrée comme le clavier du modèle simplifié : montée en 0,17 s,
// directement sur le modèle (sans la montée progressive du clavier du modèle réaliste, voir InputRamp.js) ----------------
function stickRelease({ input, holdTime }) {
    const f = airborne(makeAircraft(), { altitude: 600, speed: 100 * KT, throttle: 0.75 }), { model } = f;
    model.trim = 0;
    run(f, 25, { pilot: () => { model.controls.pitch = 0; } });   // vitesse et trajectoire établies, phugoïde amortie
    const alphaTrim = model.alpha;
    const ramp = 0.17;
    let pitch = attitude(f).pitch, firstResponse = null, peak = 0, reverse = 0, later = 0, peakAlpha = 0;
    const rate = () => { const p = attitude(f).pitch, r = (p - pitch) / DT * RAD; pitch = p; return r; };
    const alphaAfter = [];
    run(f, holdTime + ramp, { pilot: (t) => {
        model.controls.pitch = input * (t < ramp ? t / ramp : t < holdTime ? 1 : 1 - (t - holdTime) / ramp);
        const r = rate();
        if (firstResponse === null && Math.abs(r) > 1) firstResponse = t;
        peak = Math.max(peak, Math.abs(r));
        peakAlpha = Math.max(peakAlpha, (model.alpha - alphaTrim) * Math.sign(input) * RAD);
    } });
    run(f, 10, { pilot: (t) => {
        model.controls.pitch = 0;
        const r = rate() * Math.sign(input);   // > 0 : le nez continue dans le sens de la commande
        if (t <= 2.5) reverse = Math.min(reverse, r); else later = Math.max(later, Math.abs(r));
        alphaAfter.push({ t, d: (model.alpha - alphaTrim) * Math.sign(input) * RAD });
    } });
    return { firstResponse, peak, reverse, later, peakAlpha, alphaAfter, stalled: model.stalled, crashed: model.crashed };
}
for (const [label, input, holdTime] of [['tiré à fond 0,5 s', 1, 0.5], ['tiré à moitié 0,5 s', 0.5, 0.5], ['poussé à fond 1,5 s', -1, 1.5], ['poussé à moitié 1,5 s', -0.5, 1.5]]) {
    if (!REALISTIC) {
        // Touche relâchée, le nez s'arrête mais ne repart pas dans l'autre sens (1°/s au plus) ; l'incidence en trop se
        // résorbe parce que la trajectoire rejoint le nez. Avant : rappel à 20-40°/s en sens inverse à chaque touche
        // relâchée. Mesuré : réponse en 0,07-0,10 s, pic 13-26°/s, sens inverse au plus -1,0°/s, oscillation ≤ 6,3°/s
        test(`[${KIND}] relâchement du manche ${label} (6861f36) : réponse en < 0,2 s, pas de retour en sens inverse au-delà de 1,5°/s`, () => {
            const r = stickRelease({ input, holdTime });
            assert.ok(!r.crashed && !r.stalled);
            assert.ok(r.firstResponse !== null && r.firstResponse < 0.2, `première réponse du nez à ${r.firstResponse?.toFixed(2)} s`);
            assert.ok(r.peak >= 8 && r.peak <= 30, `vitesse de tangage max ${r.peak.toFixed(1)}°/s`);
            assert.ok(r.reverse >= -1.5, `retour en sens inverse ${r.reverse.toFixed(2)}°/s dans les 2,5 s après le relâchement`);
            assert.ok(r.later <= 10, `oscillation ensuite ${r.later.toFixed(1)}°/s au plus`);
        });
    } else {
        // Modèle réaliste (décision du 15/11/2026) : un avion stable revient à son incidence d'équilibre quand on relâche,
        // le nez redescend donc un instant (le retour en sens inverse est physique). Critère physique : réponse rapide,
        // pas de dépassement de l'incidence d'équilibre (courte période amortie, ζ ≥ 0,5 : dépassement < 16 %), retour en
        // moins de 1 s, pas d'oscillation ensuite. Sans amortisseur artificiel
        test(`[${KIND}] relâchement du manche ${label}, physique : réponse en < 0,2 s, retour à l'incidence d'équilibre en < 1 s sans la dépasser (ζ ≥ 0,5), sans oscillation`, () => {
            const r = stickRelease({ input, holdTime });
            assert.ok(!r.crashed && !r.stalled);
            assert.ok(r.firstResponse !== null && r.firstResponse < 0.2, `première réponse du nez à ${r.firstResponse?.toFixed(2)} s`);
            const back = r.alphaAfter.find((s) => s.d < 0.1 * r.peakAlpha);
            assert.ok(back && back.t < 1, `retour à 10 % de l'écart d'incidence en ${back?.t.toFixed(2)} s (écart max ${r.peakAlpha.toFixed(1)}°)`);
            const overshoot = -Math.min(0, ...r.alphaAfter.filter((s) => s.t < 3).map((s) => s.d));
            assert.ok(overshoot < 0.16 * r.peakAlpha, `dépassement de l'incidence d'équilibre ${overshoot.toFixed(2)}° (< 16 % de ${r.peakAlpha.toFixed(1)}° : ζ ≥ 0,5)`);
            const tail = r.alphaAfter.filter((s) => s.t >= 1 && s.t <= 4).map((s) => Math.abs(s.d));
            assert.ok(Math.max(...tail) < 0.2 * r.peakAlpha, `pas d'oscillation de l'incidence après 1 s (${Math.max(...tail).toFixed(2)}°)`);
        });
    }
}
