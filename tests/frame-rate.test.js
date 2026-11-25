// Cadence d'images (lot 6) : un même vol donne la même trajectoire à 60, 30 et 15 images/s. PlaneControls fait avancer
// la simulation par pas fixes de 1/120 s (TICK) quelle que soit la durée de l'image : main du pilote (montée progressive
// du modèle réaliste, lissage du simplifié), gaz, trim, pilote automatique, vent, rafales de Dryden et physique
// avancent par les mêmes pas, dans le même ordre. Le vol : clavier, gaz et volets ; puis vent variable avec rafales et
// turbulence de Dryden ; puis KAP 140 engagé (cap et altitude). Les entrées ne changent qu'à des multiples de 1/15 s :
// toutes les cadences les voient au même pas.
// Tolérance : 1e-6 m (et 1e-6 en cap, vitesse) : les trois cadences font exactement les mêmes calculs ; seul le compteur
// de pas en attente (PlaneControls._tickDebt) diffère d'un arrondi de flottant, sans effet sur l'état de l'avion. Avant
// le pas fixe, les écarts mesurés étaient de 1,5 m (30 i/s) à 5 m (15 i/s) en air calme, 45 à 73 m en turbulence (un
// tirage gaussien des rafales par image : la suite aléatoire changeait avec le nombre d'images)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from 'three';
import { RigidBodyModel } from '../js/RigidBodyModel.js';
import { FlightModel } from '../js/FlightModel.js';
import { CESSNA_172 } from '../js/Cessna172.js';
import { KAP140 } from '../js/KAP140.js';
import { Wind } from '../js/Wind.js';
import { shearFactor } from '../js/Turbulence.js';
import { seededRandom } from '../js/Random.js';
import { KT, FT } from './helpers/flight.js';

afterEach(() => { delete globalThis.window; });

const SECONDS = 90;
const TOLERANCE = 1e-6;

// Touches tenues (event.code) : [début, fin) en secondes, multiples de 1/15 s
const KEYS = [
    ['KeyA', 2, 4], ['KeyD', 8, 10.2], ['KeyS', 14, 16], ['KeyQ', 18, 19], ['KeyX', 5, 6],
    ['Space', 20, 20.4], ['ShiftLeft', 22, 22.6], ['KeyW', 26, 26.8], ['KeyD', 35, 37], ['KeyA', 41, 42.2],
];
// Volets : cran demandé à cet instant
const FLAPS = [[24, 1], [28, 2], [32, 0]];
const WIND_FROM = 30;   // s : vent et turbulence de Dryden
const AP_AT = 60;       // s : KAP 140 engagé (HDG, ALT)

const key = (code) => ({ code, repeat: false, preventDefault() {} });

// Un vol de SECONDS secondes à fps images/s ; rend l'état à chaque seconde entière
async function fly(kind, fps) {
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    const { PlaneControls } = await import('../js/PlaneControls.js');
    const object = new Object3D();
    const controls = new PlaneControls(object);
    const model = kind === 'realiste' ? new RigidBodyModel(object, { ...CESSNA_172 }) : new FlightModel(object, { ...CESSNA_172 });
    model.groundHeight = () => 0;
    model.surfaceAt = () => 'asphalt';
    model.random = seededRandom(1);
    model.gusts?.setSeed?.(1);
    controls.useModel(model);
    model.placeOnGround();
    model.restart(true);
    object.position.set(0, 3000 * FT, 0);
    object.quaternion.identity();
    model.restart(false);
    model.velocity.set(0, 0, -100 * KT);
    model.airspeed = 100 * KT;
    model.throttle = 0.68;

    // Vent du jeu (Wind.js) sur l'horloge de la simulation, cisaillement selon la hauteur (comme updateAirMass)
    const wind = new Wind();
    wind.setSeed(1);
    let clock = 0;
    wind.now = () => 1.8e9 + clock;
    wind.set({ wind: 240, knots: 15, variation: 60, gust: 10, real: true });
    // KAP 140 : capteurs lus à chaque pas (cap, vario, inclinaison : valeurs des instruments de PlaneControls)
    const kap = new KAP140();
    const sensors = () => ({
        powered: true, heading: controls.getHeading(), bug: 300, altitude: object.position.y / FT,
        vs: controls.getVerticalSpeed() / FT * 60, bank: model.bankAngle ?? 0, pitch: model.pitchAttitude ?? 0,
        ias: model.indicatedSpeed, tas: model.airspeed, onGround: model.onGround, nav: null, baro: 1013,
        manualTrim: controls.manualTrim, trimFree: true,
    });
    controls.beforeTick = (dt) => {
        clock += dt;
        if (clock > WIND_FROM) {
            wind.update();
            model.wind.copy(wind.vector).multiplyScalar(shearFactor(object.position.y));
            model.turbulence = 0.5;
        }
        const s = sensors();
        controls._kapState = s;
        controls.setAutopilotOutput(kap.update(dt, s));
    };

    const out = [];
    let maxBank = 0, flapsSeen = 0;
    const N = SECONDS * fps;
    const held = new Set();
    for (let k = 0; k <= N; k++) {
        const t = k / fps;   // (compteur entier : pas de somme qui dérive)
        const at = (a) => Math.abs(t - a) < 1e-9;
        for (const [code, from, to] of KEYS) {
            const id = `${code}@${from}`;
            const down = t >= from - 1e-9 && t < to - 1e-9;
            if (down && !held.has(id)) { held.add(id); controls._onKeyEvent(key(code), 1); }
            if (!down && held.has(id)) { held.delete(id); controls._onKeyEvent(key(code), 0); }
        }
        for (const [when, level] of FLAPS) if (at(when)) controls.setFlapLevel(level);
        if (at(AP_AT)) {
            controls.setFlapLevel(0);
            for (const b of ['ap', 'hdg', 'alt']) kap.press(b, controls._kapState);
        }
        if (k % fps === 0) {
            out.push({
                t, x: object.position.x, y: object.position.y, z: object.position.z,
                heading: controls.getHeading(), speed: model.airspeed,
            });
        }
        maxBank = Math.max(maxBank, Math.abs(controls.getRoll()));
        flapsSeen = Math.max(flapsSeen, model.flaps);
        controls.update(1 / fps);
    }
    return { out, kap, model, maxBank, flapsSeen };
}

const headingDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

for (const kind of ['realiste', 'simplifie']) {
    test(`même trajectoire à 60, 30 et 15 images/s (${kind}) : clavier, gaz, volets, vent et Dryden, KAP 140`, async () => {
        const ref = await fly(kind, 60);
        // Le vol a bien exercé ce qu'il doit : virages au clavier, volets sortis, pilote automatique engagé, pas de crash
        assert.equal(ref.model.crashed, false);
        assert.ok(ref.maxBank > 10 * Math.PI / 180, `inclinaison max ${(ref.maxBank * 180 / Math.PI).toFixed(1)}°`);
        assert.ok(ref.flapsSeen > 0.4, `volets ${ref.flapsSeen}`);
        assert.equal(ref.kap.engaged, true, 'KAP 140 engagé');
        assert.equal(ref.out.length, SECONDS + 1);
        for (const fps of [30, 15]) {
            const run = await fly(kind, fps);
            assert.equal(run.out.length, ref.out.length);
            let worst = 0, worstAt = 0;
            for (let i = 0; i < ref.out.length; i++) {
                const a = ref.out[i], b = run.out[i];
                assert.equal(a.t, b.t);
                const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
                if (d > worst) { worst = d; worstAt = a.t; }
                assert.ok(headingDiff(a.heading, b.heading) < TOLERANCE, `${fps} i/s, t = ${a.t} s : cap ${a.heading} / ${b.heading}`);
                assert.ok(Math.abs(a.speed - b.speed) < TOLERANCE, `${fps} i/s, t = ${a.t} s : vitesse ${a.speed} / ${b.speed}`);
                assert.ok(Math.abs(a.y - b.y) < TOLERANCE, `${fps} i/s, t = ${a.t} s : altitude ${a.y} / ${b.y}`);
            }
            assert.ok(worst < TOLERANCE, `${fps} i/s : écart de position ${worst.toFixed(3)} m à t = ${worstAt} s`);
        }
    });
}

test('pas fixe : une image courte ne fait aucun pas, le reste est gardé ; 1/15 s = 8 pas', async () => {
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    const { PlaneControls } = await import('../js/PlaneControls.js');
    const object = new Object3D();
    const controls = new PlaneControls(object);
    const model = new RigidBodyModel(object, { ...CESSNA_172 });
    model.groundHeight = () => 0;
    model.surfaceAt = () => 'asphalt';
    controls.useModel(model);
    model.placeOnGround();
    model.restart(true);
    let ticks = 0;
    controls.afterTick = (dt) => { ticks++; assert.equal(dt, 1 / 120); };
    assert.equal(controls.update(1 / 144), 0);   // 144 Hz : 0,83 pas, gardé
    assert.equal(controls.update(1 / 144), 1);
    assert.equal(controls.update(1 / 15), 8);
    assert.equal(controls.update(1), 12);        // (image bornée à 0,1 s)
    assert.equal(ticks, 21);
});
