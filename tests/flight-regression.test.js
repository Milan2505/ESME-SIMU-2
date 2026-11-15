// Comportements du modèle de vol réglés à la main et validés en jeu (js/FlightModel.js), à garder tels quels quand on
// refait le modèle (feuille de route, lot 1) : envol sans saut, arrondi et effet de sol, vent de travers, relâchement
// du manche sans à-coup. Chaque test rappelle le commit qui a réglé le comportement ; les bornes viennent de mesures sur
// le modèle du 15/11/2026 (version 0.429, avant le lot 1), avec une marge : elles décrivent ce que le joueur a validé,
// pas une cible théorique. Un test qui tombe ici dit qu'une sensation réglée en jeu a changé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, run, attitude, speedHold, KT, DT } from './helpers/flight.js';

const RAD = 180 / Math.PI;
const wrap = (a) => ((a + 540) % 360) - 180;   // écart d'angle en degrés, dans ]-180 ; 180]

// Décollage plein gaz volets 10°, manche à 0,5 dès 55 kt indiqués ; rend la durée du roulement
function takeoff(f, { pull = 0.5, rotateKt = 55 } = {}) {
    const { model } = f;
    model.throttle = 1;
    model.setFlapLevel(1);
    model.flaps = 1 / 3;
    return run(f, 90, { pilot: () => { model.controls.pitch = model.indicatedSpeed >= rotateKt * KT ? pull : 0; }, until: () => !model.onGround });
}
// Montée initiale comme un pilote : assiette de rotation gardée 3 s après l'envol (manche à 0,3), puis 65 kt indiqués
// tenus au manche (POH 172P : montée normale 70 à 80 KIAS, 56 à 65 en piste courte)
function initialClimb(f) {
    const hold = speedHold(f, 65 * KT, { indicated: true });
    return (t) => { if (t < 3) f.model.controls.pitch = 0.3; else hold(); };
}

// --- Envol (fc4d7a7) : transition de 1,5 s, le nez tourne d'abord au plus à 4°/s et la montée s'installe progressivement ;
// avant, le nez cabrait d'un coup sec et l'avion « sautait » du sol. Mesuré : 3,95°/s, 0,13 g, hauteur jamais perdue,
// 3,0 m/s de montée à 3 s -------------------------------------------------------------------------------------------------
test('envol sans saut (fc4d7a7) : 1,5 s après le décollage, nez ≤ 6°/s, accélération verticale ≤ 0,3 g, hauteur jamais perdue', () => {
    const f = makeAircraft(), { model, object } = f;
    const events = [];
    for (const type of ['liftoff', 'touchdown', 'crash']) model.addEventListener(type, (e) => events.push(e.type));
    const t = takeoff(f);
    assert.ok(t < 90 && !model.crashed, 'envol');
    let pitch = attitude(f).pitch, vy = model.velocity.y, y = object.position.y;
    let maxRate = 0, maxAcc = 0, minDy = Infinity;
    const climb = initialClimb(f);
    run(f, 1.5, { pilot: (t) => {
        climb(t);
        const p = attitude(f).pitch;
        maxRate = Math.max(maxRate, Math.abs(p - pitch) / DT);
        maxAcc = Math.max(maxAcc, Math.abs(model.velocity.y - vy) / DT);
        minDy = Math.min(minDy, object.position.y - y);
        pitch = p; vy = model.velocity.y; y = object.position.y;
    } });
    assert.ok(maxRate * RAD <= 6, `vitesse de tangage max ${(maxRate * RAD).toFixed(1)}°/s`);
    assert.ok(maxAcc / 9.81 <= 0.3, `accélération verticale max ${(maxAcc / 9.81).toFixed(2)} g`);
    assert.ok(minDy >= -1e-6, `la hauteur ne baisse jamais après l'envol (${minDy.toFixed(4)} m)`);
    run(f, 1.5, { pilot: (t) => climb(t + 1.5) });
    assert.ok(model.velocity.y > 1, `montée établie 3 s après l'envol : ${model.velocity.y.toFixed(1)} m/s`);
    assert.deepEqual(events, ['liftoff'], 'pas de retour au sol ni de crash');
});

// --- Arrondi (9e2b08c : effet de sol McCormick, -7 % de traînée induite roues posées et +3,5 % de portance, au lieu de
// -21 % / +12 % qui faisaient flotter et remonter l'avion ; 81e5b7a : toucher adouci, plus de bascule en une image) -------
// Approche à 65 kt volets 30°, puis manche tenu sous une hauteur donnée ; rend ce qui s'est passé
function approach({ throttle, pullBelow, pull }) {
    const f = airborne(makeAircraft(), { altitude: 40, speed: 65 * KT, throttle }), { model, object } = f;
    model.setFlapLevel(3);
    model.flaps = 1;
    const impacts = [], events = [];
    model.addEventListener('touchdown', (e) => { impacts.push(e.impact); events.push('touchdown'); });
    model.addEventListener('liftoff', () => events.push('liftoff'));
    const hold = speedHold(f, 65 * KT);
    let flare = null, gain = 0;
    const t = run(f, 60, { pilot: (time) => {
        if (flare === null && object.position.y - model.minAltitude <= pullBelow) flare = { t: time, y: object.position.y, z: object.position.z };
        if (flare === null) hold(); else model.controls.pitch = pull;
        if (flare !== null) gain = Math.max(gain, object.position.y - flare.y);
    }, until: () => model.onGround });
    const landed = model.onGround && flare !== null ? { seconds: t - flare.t, metres: Math.abs(object.position.z - flare.z) } : null;
    run(f, 3, { pilot: () => { model.controls.pitch = 0; model.throttle = 0; } });   // roulage : l'avion reste au sol
    return { landed, gain, impact: impacts[0], events, crashed: model.crashed, onGround: model.onGround };
}
test('arrondi gaz réduits, manche à fond sous 6 m (9e2b08c) : posé en moins de 6 s sans remonter, impact doux, l\'avion reste au sol', () => {
    const a = approach({ throttle: 0, pullBelow: 6, pull: 1 });   // mesuré : posé en 4,1 s et 604 m, 2,9 m/s
    assert.ok(a.landed, 'posé');
    assert.ok(a.landed.seconds < 6, `posé en ${a.landed.seconds.toFixed(1)} s`);
    assert.ok(a.landed.metres < 900, `distance d'arrondi ${a.landed.metres.toFixed(0)} m`);
    assert.ok(a.gain < 0.3, `remontée pendant l'arrondi ${a.gain.toFixed(2)} m`);
    assert.ok(a.impact < 4.5, `impact ${a.impact.toFixed(2)} m/s`);
    assert.equal(a.crashed, false);
    assert.ok(a.onGround && !a.events.includes('liftoff'), `pas de rebond en l'air : ${a.events.join(',')}`);
});
test('arrondi gaz réduits, manche tiré à 35 % sous 3 m (81e5b7a) : posé en moins de 2 s, impact doux', () => {
    const a = approach({ throttle: 0, pullBelow: 3, pull: 0.35 });   // mesuré : posé en 0,6 s, 2,6 m/s
    assert.ok(a.landed && a.landed.seconds < 2, `posé en ${a.landed?.seconds.toFixed(1)} s`);
    assert.ok(a.gain < 0.3 && a.impact < 4.5 && !a.crashed, `remontée ${a.gain.toFixed(2)} m, impact ${a.impact?.toFixed(2)} m/s`);
});
test('effet de sol (9e2b08c, McCormick) : ~7 % roues au ras du sol, presque rien à une demi-envergure', () => {
    const low = airborne(makeAircraft(), { altitude: 0, speed: 30, throttle: 0 });
    low.object.position.y = low.model.minAltitude + 0.1;
    run(low, DT);
    assert.ok(low.model.groundEffect >= 0.05 && low.model.groundEffect <= 0.09, `au ras du sol : ${low.model.groundEffect.toFixed(3)}`);
    const half = airborne(makeAircraft(), { altitude: 0, speed: 30, throttle: 0 });
    half.object.position.y = half.model.minAltitude + 5.5;
    run(half, DT);
    assert.ok(half.model.groundEffect <= 0.03, `à une demi-envergure : ${half.model.groundEffect.toFixed(3)}`);
});

// --- Vent de travers (e93abf2) : après l'envol, sans l'aide « correction de dérive », l'avion part avec la masse d'air en
// ~1 s, nez gardé sur son cap (il dérive, au pilote de prendre un cap de correction) ; avec l'aide, la dérive fait pivoter
// le nez face au vent. Décollage cap nord, 15 kt d'ouest (qui souffle vers l'est, +x), palonnier au neutre.
// Mesuré sans l'aide : cap tenu à ±4,4° sur 10 s, lacet ≤ 1,2°/s, cap à 3 s -1,9°, 37 m sous le vent à 10 s ;
// avec l'aide : nez de -10° (face au vent) à 3 s, lacet ≤ 6,5°/s, 16 m au vent à 10 s ------------------------------------
function crosswindTakeoff(assist) {
    const f = makeAircraft(), { model, object } = f;
    model.assists.crosswindCorrection = assist;
    model.wind.set(15 * KT, 0, 0);
    takeoff(f);
    const x0 = object.position.x, heading0 = attitude(f).heading;
    const climb = initialClimb(f);
    const r = { heading0, maxHeadingError: 0, maxYawRate: 0, at3: null, x10: null, crashed: false };
    let previous = heading0;
    run(f, 10, { pilot: (t) => {
        climb(t);
        model.controls.yaw = 0;
        const { heading } = attitude(f);
        const error = wrap(heading - heading0), yawRate = wrap(heading - previous) / DT;
        previous = heading;
        r.maxHeadingError = Math.max(r.maxHeadingError, Math.abs(error));
        if (t > 0.1) r.maxYawRate = Math.max(r.maxYawRate, Math.abs(yawRate));
        if (r.at3 === null && t >= 3) {
            // Dérive : vitesse sol est-ouest attendue si l'avion suit la masse d'air (vent + vitesse air projetée sur le cap)
            const expectedEast = model.wind.x + model.airspeed * Math.sin(heading / RAD);
            r.at3 = { headingError: error, beta: model.beta * RAD, driftError: model.velocity.x - expectedEast };
        }
    } });
    r.x10 = object.position.x - x0;
    r.crashed = model.crashed;
    return r;
}
test('vent de travers sans aide (e93abf2) : le nez garde son cap, l\'avion prend la masse d\'air en ~1 s sans à-coup et dérive sous le vent', () => {
    const r = crosswindTakeoff(false);
    assert.equal(r.crashed, false);
    assert.ok(r.maxHeadingError <= 8, `écart de cap max ${r.maxHeadingError.toFixed(1)}° sur 10 s`);
    assert.ok(r.maxYawRate <= 3, `lacet max ${r.maxYawRate.toFixed(1)}°/s : pas de pivot brusque`);
    assert.ok(r.at3.headingError > -5, `à 3 s, le nez n'est pas parti face au vent (${r.at3.headingError.toFixed(1)}°)`);
    assert.ok(Math.abs(r.at3.beta) < 2, `bille au milieu à 3 s : dérapage ${r.at3.beta.toFixed(1)}°`);
    assert.ok(Math.abs(r.at3.driftError) < 1, `l'avion suit la masse d'air (écart ${r.at3.driftError.toFixed(2)} m/s)`);
    assert.ok(r.x10 > 15 && r.x10 < 80, `dérive sous le vent après 10 s : ${r.x10.toFixed(0)} m`);
});
test('vent de travers avec l\'aide « correction de dérive » : le nez pivote face au vent en ~3 s, trajectoire dans l\'axe', () => {
    const r = crosswindTakeoff(true);
    assert.equal(r.crashed, false);
    assert.ok(r.at3.headingError <= -5 && r.at3.headingError >= -16, `nez face au vent à 3 s : ${r.at3.headingError.toFixed(1)}°`);
    assert.ok(r.maxYawRate <= 10, `pivot progressif : lacet max ${r.maxYawRate.toFixed(1)}°/s`);
    assert.ok(Math.abs(r.x10) < 40, `trajectoire gardée près de l'axe après 10 s : ${r.x10.toFixed(0)} m`);
});

// --- Relâchement du manche (6861f36 ; latence : 40dcc89) : touche relâchée, le nez s'arrête mais ne repart pas dans l'autre
// sens (1°/s au plus) ; l'incidence en trop se résorbe parce que la trajectoire rejoint le nez. Avant : rappel à 20-40°/s
// en sens inverse à chaque touche relâchée. Entrée comme le clavier : montée en 0,17 s. Mesuré : réponse en 0,07-0,10 s,
// pic 13-26°/s, sens inverse au plus -1,0°/s dans les 2,5 s, oscillation lente ≤ 6,3°/s ensuite ------------------------
function stickRelease({ input, holdTime }) {
    const f = airborne(makeAircraft(), { altitude: 600, speed: 100 * KT, throttle: 0.75 }), { model } = f;
    model.trim = 0;
    run(f, 25, { pilot: () => { model.controls.pitch = 0; } });   // vitesse et trajectoire établies, phugoïde amortie
    const ramp = 0.17;
    let pitch = attitude(f).pitch, firstResponse = null, peak = 0, reverse = 0, later = 0;
    const rate = () => { const p = attitude(f).pitch, r = (p - pitch) / DT * RAD; pitch = p; return r; };
    run(f, holdTime + ramp, { pilot: (t) => {
        model.controls.pitch = input * (t < ramp ? t / ramp : t < holdTime ? 1 : 1 - (t - holdTime) / ramp);
        const r = rate();
        if (firstResponse === null && Math.abs(r) > 1) firstResponse = t;
        peak = Math.max(peak, Math.abs(r));
    } });
    run(f, 10, { pilot: (t) => {
        model.controls.pitch = 0;
        const r = rate() * Math.sign(input);   // > 0 : le nez continue dans le sens de la commande
        if (t <= 2.5) reverse = Math.min(reverse, r); else later = Math.max(later, Math.abs(r));
    } });
    return { firstResponse, peak, reverse, later, stalled: model.stalled, crashed: model.crashed };
}
for (const [label, input, holdTime] of [['tiré à fond 0,5 s', 1, 0.5], ['tiré à moitié 0,5 s', 0.5, 0.5], ['poussé à fond 1,5 s', -1, 1.5], ['poussé à moitié 1,5 s', -0.5, 1.5]]) {
    test(`relâchement du manche ${label} (6861f36) : réponse en < 0,2 s, pas de retour en sens inverse au-delà de 1,5°/s`, () => {
        const r = stickRelease({ input, holdTime });
        assert.ok(!r.crashed && !r.stalled);
        assert.ok(r.firstResponse !== null && r.firstResponse < 0.2, `première réponse du nez à ${r.firstResponse?.toFixed(2)} s`);
        assert.ok(r.peak >= 8 && r.peak <= 30, `vitesse de tangage max ${r.peak.toFixed(1)}°/s`);
        assert.ok(r.reverse >= -1.5, `retour en sens inverse ${r.reverse.toFixed(2)}°/s dans les 2,5 s après le relâchement`);
        assert.ok(r.later <= 10, `oscillation ensuite ${r.later.toFixed(1)}°/s au plus`);
    });
}
