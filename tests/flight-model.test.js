// Modèle de vol des avions (js/FlightModel.js) hors navigateur : comportements et événements, pas les performances
// chiffrées (voir perf-c172.test.js). Hasard à graine fixe : chaque test est reproductible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Object3D, Vector3 } from 'three';
import { makeAircraft, airborne, run, KT } from './helpers/flight.js';
import { seededRandom } from '../js/Random.js';
import { FlightModel } from '../js/FlightModel.js';
import { CESSNA_172 } from '../js/Cessna172.js';
import { F15 } from '../js/F15.js';

test('Random.js : même graine, même suite ; valeurs dans [0, 1)', () => {
    const a = seededRandom(123), b = seededRandom(123), c = seededRandom(124);
    const seqA = Array.from({ length: 50 }, a), seqB = Array.from({ length: 50 }, b);
    assert.deepEqual(seqA, seqB);
    assert.notDeepEqual(seqA, Array.from({ length: 50 }, c));
    assert.ok(seqA.every((v) => v >= 0 && v < 1));
    assert.ok(new Set(seqA).size > 45, 'pas de répétition grossière');
});

test('posé au sol : arrêté, gaz réduits, trim de décollage, volets rentrés, roues à la hauteur prévue', () => {
    const { model, object } = makeAircraft();
    assert.equal(model.onGround, true);
    assert.equal(model.airspeed, 0);
    assert.equal(model.throttle, 0);
    assert.equal(model.trim, CESSNA_172.takeoffTrim);
    assert.equal(model.flapLevel, 0);
    assert.equal(object.position.y, model.minAltitude);
    assert.equal(model.random === Math.random, false, 'tirage à graine injecté');
});

test('plein gaz : l\'avion accélère, décolle (événement liftoff) puis monte sans s\'écraser', () => {
    const f = makeAircraft(), { model, object } = f;
    const events = [];
    for (const type of ['liftoff', 'touchdown', 'crash']) model.addEventListener(type, (e) => events.push(e.type));
    model.throttle = 1;
    model.setFlapLevel(1);
    model.flaps = 1 / 3;
    run(f, 3);
    assert.ok(model.airspeed > 4 && model.onGround, `ça roule : ${model.airspeed.toFixed(1)} m/s après 3 s`);
    const t = run(f, 60, { pilot: () => { model.controls.pitch = model.indicatedSpeed > 26 ? 0.5 : 0; }, until: () => !model.onGround });
    assert.ok(t < 60, 'envol en moins de 60 s');
    assert.deepEqual(events, ['liftoff']);
    assert.ok(model.airspeed > 24, `vitesse à l'envol ${(model.airspeed / KT).toFixed(0)} kt`);
    run(f, 15, { pilot: () => { model.controls.pitch = 0.1; } });
    assert.ok(object.position.y > 10, `altitude après 15 s : ${object.position.y.toFixed(1)} m`);
    assert.equal(model.crashed, false);
});

test('volets : sortie progressive (course complète en 4 s), crans bornés', () => {
    const f = makeAircraft(), { model } = f;
    model.setFlapLevel(3);
    run(f, 2);
    assert.ok(Math.abs(model.flaps - 0.5) < 0.03, `volets à mi-course : ${model.flaps.toFixed(2)}`);
    run(f, 2.5);
    assert.ok(model.flaps > 0.99);
    model.setFlapLevel(9);
    assert.equal(model.flapLevel, 3);
    model.setFlapLevel(-2);
    assert.equal(model.flapLevel, 0);
    assert.equal(model.flapSetting(), 0);
});

test('trim : à cabrer, l\'avion tient une vitesse plus faible manche lâché ; repère décollage = vitesse de montée', () => {
    const { model } = makeAircraft();
    const speeds = [CESSNA_172.trimTabMin, 0, CESSNA_172.takeoffTrim, CESSNA_172.trimTabMax].map((trim) => { model.trim = trim; return model.trimSpeed(); });
    for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] < speeds[i - 1], 'vitesse tenue décroissante avec le trim à cabrer');
    model.trim = CESSNA_172.takeoffTrim;
    assert.ok(model.trimSpeed() > model.stallSpeed() * 1.2 && model.trimSpeed() < 90 * KT, `${(model.trimSpeed() / KT).toFixed(0)} kt`);
});

test('décrochage : manche au ventre, l\'aile décroche ; rendre la main raccroche ; aile qui tombe reproductible', () => {
    const stall = (seed) => {
        const f = airborne(makeAircraft({ seed }), { altitude: 800, speed: 40, throttle: 0.4 }), { model } = f;
        const t = run(f, 40, { pilot: () => { model.controls.pitch = 1; }, until: () => model.stalled });
        assert.ok(model.stalled && t < 40, 'décroché en moins de 40 s');
        const drop = model._wingDrop;
        assert.ok(Math.abs(drop) >= 0.5 && Math.abs(drop) <= 1, `aile qui tombe : ${drop}`);
        const recovered = run(f, 15, { pilot: () => { model.controls.pitch = -0.4; }, until: () => !model.stalled });
        assert.ok(!model.stalled && recovered < 15, 'raccroché en rendant la main');
        return drop;
    };
    assert.equal(stall(3), stall(3), 'même graine : même aile, même force');
});

test('toucher doux : atterrissage (événement touchdown) ; arrivée brutale : crash et sa raison', () => {
    const soft = airborne(makeAircraft(), { altitude: 1.6, speed: 30, throttle: 0 });
    const touched = [];
    soft.model.addEventListener('touchdown', ({ impact }) => touched.push(impact));
    soft.model.velocity.set(0, -0.5, -30);
    run(soft, 5, { until: () => soft.model.onGround });
    assert.equal(soft.model.crashed, false);
    assert.equal(soft.model.onGround, true);
    assert.equal(touched.length, 1);
    assert.ok(touched[0] < CESSNA_172.crashSink);

    const hard = airborne(makeAircraft(), { altitude: 1.6, speed: 30, throttle: 0 });
    let reason = null;
    hard.model.addEventListener('crash', (e) => { reason = e.reason; });
    hard.model.velocity.set(0, -12, -30);
    run(hard, 2);
    assert.equal(hard.model.crashed, true);
    assert.match(reason, /^Impact trop violent/);
    assert.equal(hard.model.throttle, 0);
});

test('obstacle sur la trajectoire : collision', () => {
    const f = airborne(makeAircraft(), { altitude: 300, speed: 50, throttle: 0.6 }), { model } = f;
    model.obstacles = [new Box3(new Vector3(-60, 250, -700), new Vector3(60, 350, -650))];
    let reason = null;
    model.addEventListener('crash', (e) => { reason = e.reason; });
    run(f, 30, { pilot: () => { model.controls.pitch = 0; }, until: () => model.crashed });
    assert.equal(reason, 'Collision avec un obstacle');
});

test('masse et moteur en propriétés de l\'instance : changer la masse ne touche pas CESSNA_172, changer d\'avion la remet', () => {
    const { model } = makeAircraft();
    const reference = CESSNA_172.mass;
    assert.equal(model.mass, reference);
    assert.ok(model.propulsion && model.rpm > 0, 'moteur à hélice créé, au ralenti');
    model.mass = 900;
    model.restart(true);
    assert.equal(model.mass, 900, 'restart garde la masse chargée');
    assert.equal(CESSNA_172.mass, reference, 'l\'objet partagé n\'est pas modifié');
    assert.ok(model.stallSpeed() < new FlightModel(new Object3D(), { ...CESSNA_172 }).stallSpeed(), 'plus léger : décroche plus lentement');
    model.aircraft = F15;
    assert.equal(model.mass, F15.mass, 'autre avion : masse de référence de celui-ci');
    assert.equal(model.propulsion, null, 'réacteurs : pas de modèle d\'hélice');
    assert.equal(model.rpm, 0);
});

test('vitesses : TAS, CAS et IAS distinctes ; en altitude la CAS est plus faible que la TAS, le badin du 172P sous-lit à basse vitesse (POH fig. 5-1)', () => {
    const low = airborne(makeAircraft(), { altitude: 10, speed: 70 * KT, throttle: 0.5 });
    run(low, 0.1, { pilot: () => { low.model.controls.pitch = 0; } });
    assert.ok(Math.abs(low.model.calibratedSpeed - low.model.airspeed) < 0.2, 'au niveau de la mer, CAS = TAS');
    assert.ok(Math.abs(low.model.indicatedSpeed / KT - 70) < 1.5, `70 KCAS lisse se lit ~70 KIAS : ${(low.model.indicatedSpeed / KT).toFixed(1)}`);
    const slow = airborne(makeAircraft(), { altitude: 10, speed: 56 * KT, throttle: 0.5 });
    run(slow, 0.1, { pilot: () => { slow.model.controls.pitch = 0; } });
    assert.ok(Math.abs(slow.model.indicatedSpeed / KT - 50) < 1.5, `56 KCAS lisse se lit ~50 KIAS : ${(slow.model.indicatedSpeed / KT).toFixed(1)}`);
    const high = airborne(makeAircraft(), { altitude: 3000, speed: 70 * KT, throttle: 0.8 });
    run(high, 0.1, { pilot: () => { high.model.controls.pitch = 0; } });
    assert.ok(high.model.calibratedSpeed < 0.9 * high.model.airspeed, `à 3 000 m, CAS ${(high.model.calibratedSpeed / KT).toFixed(0)} kt bien sous la TAS 70 kt`);
    assert.ok(high.model.mach > 0.1 && high.model.mach < 0.12, `Mach ${high.model.mach.toFixed(3)}`);
});

test('température de la météo : air chaud, moins de portance (vitesse de décrochage vraie plus élevée) et moins de puissance', () => {
    const cold = makeAircraft().model, hot = makeAircraft().model;
    hot.temperatureOffset = 30;
    assert.ok(hot.airDensity() < 0.92 * cold.airDensity());
    assert.ok(hot.stallSpeed() > cold.stallSpeed() * 1.03, 'décrochage (TAS) plus rapide par air chaud');
    assert.equal(hot.stallSpeed() * Math.sqrt(hot.airDensity()) / Math.sqrt(cold.airDensity()) / cold.stallSpeed() > 0.999, true, 'même vitesse corrigée');
});

test('F-15 : train rentrant refusé au sol, rentré en vol en gearTime s ; aérofrein', () => {
    const ground = makeAircraft({ aircraft: F15 });
    assert.equal(ground.model.setGear(false), false);
    const f = airborne(makeAircraft({ aircraft: F15 }), { altitude: 1000, speed: 130, throttle: 1 }), { model } = f;
    model.jetThrust = 120000;
    assert.equal(model.gearDown, false, 'départ en vol : train rentré');
    model.gearDown = true;
    model.gearPosition = 1;
    assert.equal(model.setGear(false), true);
    run(f, F15.gearTime / 2, { pilot: () => { model.controls.pitch = 0.05; } });
    assert.ok(model.gearPosition > 0.3 && model.gearPosition < 0.7, `train à mi-course : ${model.gearPosition.toFixed(2)}`);
    run(f, F15.gearTime);
    assert.equal(model.gearPosition, 0);
    model.speedbrakeOut = true;
    run(f, F15.speedbrakeTime * 1.5);
    assert.equal(model.speedbrake, 1);
    assert.equal(model.crashed, false);
});
