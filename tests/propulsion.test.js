// Moteur O-320 et hélice à pas fixe du Cessna 172P (js/Propulsion.js), seuls : régimes d'équilibre et puissances contre le
// manuel de vol (POH 172P) et la fiche moteur Lycoming. Le modèle de vol complet est vérifié par perf-c172.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PistonPropeller, HP } from '../js/Propulsion.js';
import { isa } from '../js/Atmosphere.js';
import { CESSNA_172 } from '../js/Cessna172.js';

const KT = 0.514444, FT = 0.3048;
const within = (value, low, high, what) => assert.ok(value >= low && value <= high, `${what} : ${value.toFixed(1)} hors de [${low} ; ${high}]`);

// Régime, poussée et puissance établis (8 s) à manette, vitesse air, altitude, mixture et santé données
function settle({ throttle, speedKt = 0, altitudeFt = 0, mixture = 1, health = 1, seconds = 8 }) {
    const engine = new PistonPropeller(CESSNA_172), air = isa(altitudeFt * FT);
    engine.reset(health > 0);
    for (let t = 0; t < seconds; t += 1 / 120) engine.update(1 / 120, { throttle, mixture, health, axialSpeed: speedKt * KT, density: air.density });
    return { rpm: engine.rpm, thrust: engine.thrust, hp: engine.power / HP, advance: engine.advance, engine };
}

test('plein gaz à l\'arrêt : régime statique 2 300 à 2 420 tr/min (TCDS 3A12 rév. 69 p. 13 : « not over 2420, not under 2300 »), poussée 2 200 à 2 700 N', () => {
    const e = new PistonPropeller(CESSNA_172);
    within(e.staticRpm, 2300, 2420, 'régime statique (tr/min)');
    within(e.staticThrust, 2200, 2700, 'poussée statique (N)');
    const s = settle({ throttle: 1, mixture: PistonPropeller.bestMixture(1, CESSNA_172.engine) });   // (à la richesse de la référence)
    within(s.rpm, e.staticRpm - 15, e.staticRpm + 15, 'régime établi par intégration = régime d\'équilibre');
});

test('ralenti manette fermée : 600 à 800 tr/min (POH 172P sect. 4 : 600 à 700, non relu), essai moteur à 55 % : 1 600 à 1 800', () => {
    within(settle({ throttle: 0 }).rpm, 600, 800, 'ralenti (tr/min)');
    within(settle({ throttle: 0.55 }).rpm, 1600, 1800, 'régime à 55 % de manette (essai moteur à 1 700)');
});

test('160 ch à 2 700 tr/min pleine admission au niveau de la mer (TCDS 3A12 p. 13), ~75 % à 8 000 ft (POH p. ii : croisière 75 % à 8 000 ft)', () => {
    const E = CESSNA_172.engine, e = new PistonPropeller(CESSNA_172);
    const omega = 2 * Math.PI * 2700 / 60;
    const best = PistonPropeller.bestMixture(1, E);
    within(e._engineTorque(2700, 1, 1, PistonPropeller.mixtureFactor(best, 1, E), 1) * omega / HP, 158.5, 161.5, 'puissance nominale (ch)');
    const sigma = isa(8000 * FT).sigma;
    const high = e._engineTorque(2700, 1, sigma, PistonPropeller.mixtureFactor(PistonPropeller.bestMixture(sigma, E), sigma, E), 1) * omega / HP;
    within(high / 160, 0.72, 0.78, 'part de la puissance à 8 000 ft, appauvri');
});

test('palier plein gaz à 123 kt : 2 650 à 2 750 tr/min (limite 2 700, TCDS 3A12 p. 13) ; montée à 76 kt : 2 400 à 2 550', () => {
    within(settle({ throttle: 1, speedKt: 123 }).rpm, 2650, 2750, 'régime à 123 kt plein gaz');
    const climb = settle({ throttle: 1, speedKt: 76 });
    within(climb.rpm, 2400, 2550, 'régime en montée à 76 kt');
    assert.ok(climb.thrust > settle({ throttle: 1, speedKt: 123 }).thrust, 'la traction baisse avec la vitesse');
    assert.ok(climb.thrust < settle({ throttle: 1 }).thrust, 'et reste sous la poussée statique');
});

test('moulinet : moteur coupé à 65 kt, l\'hélice tourne (500 à 1 200 tr/min) et freine (−150 à −350 N : finesse 9,1 du POH fig. 3-1 p. 3-11) ; au ralenti, ~1 000 tr/min et presque pas de traction', () => {
    const dead = settle({ throttle: 0, speedKt: 65, health: 0 });
    within(dead.rpm, 500, 1200, 'régime en moulinet (tr/min)');
    within(dead.thrust, -350, -150, 'traînée de l\'hélice en moulinet (N)');
    assert.equal(settle({ throttle: 0, health: 0 }).rpm, 0, 'moteur coupé à l\'arrêt : hélice immobile');
    const idle = settle({ throttle: 0, speedKt: 65 });
    within(idle.rpm, 850, 1200, 'régime au ralenti en plané (tr/min)');
    assert.ok(Math.abs(idle.thrust) < 80, `traction au ralenti en plané : ${idle.thrust.toFixed(0)} N`);
});

test('mixture : plein riche coûte quelques % au niveau de la mer et plus en altitude, appauvrir au régime maxi les rend, trop appauvrir étouffe le moteur', () => {
    const E = CESSNA_172.engine;
    within(PistonPropeller.mixtureFactor(1, 1, E), 0.95, 0.995, 'plein riche au niveau de la mer');
    assert.equal(PistonPropeller.mixtureFactor(PistonPropeller.bestMixture(1, E), 1, E), 1, 'meilleure puissance = 1');
    const sigma = isa(5000 * FT).sigma;
    const rich = settle({ throttle: 1, speedKt: 80, altitudeFt: 5000 }), leaned = settle({ throttle: 1, speedKt: 80, altitudeFt: 5000, mixture: PistonPropeller.bestMixture(sigma, E) });
    assert.ok(leaned.hp > rich.hp * 1.02 && leaned.hp < rich.hp * 1.12, `appauvri ${leaned.hp.toFixed(0)} ch contre plein riche ${rich.hp.toFixed(0)} ch à 5 000 ft`);
    assert.ok(settle({ throttle: 1, mixture: 0.3 }).hp < 0.9 * settle({ throttle: 1 }).hp, 'levier à 30 % : puissance nettement réduite');
    assert.ok(settle({ throttle: 1, mixture: 0.1 }).hp < 0.1 * settle({ throttle: 1 }).hp, 'levier à 10 % : le moteur ne tient plus (Systems le coupe sous 8 %)');
});

test('une magnéto (santé 0,93) à l\'essai moteur : chute de 50 à 125 tr/min (POH 172P sect. 4 : 125 au plus, 50 d\'écart au plus ; non relu)', () => {
    const both = settle({ throttle: 0.55 }).rpm, single = settle({ throttle: 0.55, health: 0.93 }).rpm;
    within(both - single, 50, 125, 'chute de régime sur une magnéto');
});

test('coup de gaz à l\'arrêt : du ralenti à plus de 2 000 tr/min en moins de 1,5 s, sans dépasser le régime statique', () => {
    const e = new PistonPropeller(CESSNA_172);
    for (let t = 0; t < 3; t += 1 / 120) e.update(1 / 120, { throttle: 0 });
    let reached = null, max = 0;
    for (let t = 0; t < 3; t += 1 / 120) {
        e.update(1 / 120, { throttle: 1 });
        max = Math.max(max, e.rpm);
        if (reached === null && e.rpm > 2000) reached = t;
    }
    assert.ok(reached !== null && reached < 1.5, `2 000 tr/min atteints à ${reached?.toFixed(2)} s`);
    assert.ok(max <= e.staticRpm + 20, `pas de dépassement : ${max.toFixed(0)} tr/min`);
});
