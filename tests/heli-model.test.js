// Modèle de vol de l'hélicoptère (js/HeliModel.js, Robinson R44) hors navigateur : rotor, décollage au collectif,
// aide au stationnaire, moteur coupé. Le moteur (R44Systems) est remplacé par un régulateur de test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from 'three';
import { HeliModel, R44_HELI } from '../js/HeliModel.js';
import { seededRandom } from '../js/Random.js';

const SKID_HEIGHT = 1.64;          // origine du modèle au-dessus du sol, posé (R44Model.js : R44_SKID_HEIGHT)
const DT = 1 / 60;
const OMEGA_100 = R44_HELI.rotorRpm * Math.PI / 30;

// Régulateur de test : couple moteur qui tient le rotor à 102 % (comme le régulateur du vrai R44), borné
const governor = (percent = 102) => ({ drive: (omega) => Math.max(0, Math.min(6000, 4000 * (OMEGA_100 * percent / 100 - omega))) });

function makeHeli({ seed = 1, engine = governor() } = {}) {
    const object = new Object3D();
    const model = new HeliModel(object, { ...R44_HELI });
    model.groundHeight = () => 0;
    model.surfaceAt = () => 'asphalt';
    model.minAltitude = SKID_HEIGHT;
    model.random = seededRandom(seed);
    model.engine = engine;
    model.placeOnGround();
    model.restart(true);
    return { object, model };
}
function run({ model }, seconds, { pilot, until } = {}) {
    let t = 0;
    while (t < seconds && !model.crashed) {
        pilot?.(t);
        model.step(DT);
        t += DT;
        if (until?.(t)) break;
    }
    return t;
}

test('posé : patins au sol, rotor arrêté, collectif en bas ; spinUp lance le rotor à 102 %', () => {
    const { model, object } = makeHeli();
    assert.equal(model.onGround, true);
    assert.equal(model.rotorSpeed, 0);
    assert.equal(model.throttle, 0);
    assert.ok(Math.abs(object.position.y - SKID_HEIGHT) < 1e-9);
    model.spinUp();
    assert.ok(Math.abs(model.rotorPercent - 102) < 1e-9);
});

test('posé rotor tournant, le régulateur tient le régime et l\'appareil ne bouge pas', () => {
    const f = makeHeli(), { model, object } = f;
    model.spinUp();
    run(f, 10);
    assert.equal(model.onGround, true);
    assert.equal(model.crashed, false);
    assert.ok(Math.abs(model.rotorPercent - 102) < 3, `régime ${model.rotorPercent.toFixed(1)} %`);
    assert.ok(Math.hypot(object.position.x, object.position.z) < 0.5, 'pas de glissade');
});

test('collectif levé : décollage (événement liftoff), montée tenue par l\'aide au stationnaire, régime tenu', () => {
    const f = makeHeli(), { model, object } = f;
    const events = [];
    for (const type of ['liftoff', 'touchdown', 'crash']) model.addEventListener(type, (e) => events.push(e.type));
    model.spinUp();
    run(f, 2);
    model.throttle = 0.7;   // collectif
    const t = run(f, 20, { until: () => !model.onGround });
    assert.ok(t < 20, 'décollé en moins de 20 s');
    assert.equal(events[0], 'liftoff');
    run(f, 10);
    assert.ok(!events.includes('crash'), `événements : ${events.join(', ')}`);
    assert.equal(model.onGround, false);
    assert.equal(model.crashed, false);
    assert.ok(object.position.y > SKID_HEIGHT + 3, `hauteur ${(object.position.y - SKID_HEIGHT).toFixed(1)} m`);
    assert.ok(model.rotorPercent > 95 && model.rotorPercent < 106, `régime ${model.rotorPercent.toFixed(1)} %`);
    assert.ok(model.velocity.length() < 15, 'pas de dérive rapide avec l\'aide');
});

test('départ en vol : 25 m/s, rotor lancé, collectif de croisière ; moteur coupé, le rotor ralentit et l\'appareil descend', () => {
    const f = makeHeli(), { model, object } = f;
    object.position.set(0, 300, 0);
    object.quaternion.identity();
    model.restart(false);
    assert.ok(Math.abs(model.airspeed - R44_HELI.airStartSpeed) < 1e-9);
    assert.ok(model.rotorPercent > 100);
    assert.equal(model.throttle, 0.45);
    run(f, 3);
    const beforeRpm = model.rotorRpm;
    model.engine = { drive: () => 0 };   // panne moteur
    model.throttle = 0.2;                // collectif baissé : autorotation
    run(f, 6);
    assert.ok(model.velocity.y < -1, `descente : ${model.velocity.y.toFixed(1)} m/s`);
    assert.ok(model.rotorRpm > 0.6 * beforeRpm, 'le rotor continue de tourner (autorotation)');
    assert.equal(model.crashed, false);
});

test('interface commune avec FlightModel : volets et train sans objet, collision = crash', () => {
    const { model } = makeHeli();
    assert.equal(model.setGear(false), false);
    model.setFlapLevel(2);
    assert.equal(model.flapLevel, 0);
    assert.equal(model.stallSpeed(), 0);
    let reason = null;
    model.addEventListener('crash', (e) => { reason = e.reason; });
    model.collide('Collision avec un autre appareil');
    assert.equal(model.crashed, true);
    assert.equal(reason, 'Collision avec un autre appareil');
});
