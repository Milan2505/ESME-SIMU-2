// Leçons « panne moteur » du lot 6 (js/lessons/panne-decollage.js, js/lessons/panne-campagne.js) : la démonstration du
// moniteur (InstructorPilot) doit tenir les critères de la leçon sur le modèle réaliste, au banc (sol plat, air calme,
// moteur arrêté : enginePower = 0, comme setEngineFailure de simulator.js). Piste fictive : seuil en (0, 0), axe vers le
// nord (cap 0), along = -z, gauche de l'axe = -x.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, attitude, KT, FT } from './helpers/flight.js';
import { InstructorPilot } from '../js/InstructorPilot.js';
import panneDecollage, { FAILURE, forcedLandingDemo } from '../js/lessons/panne-decollage.js';
import panneCampagne, { FIELD, fieldPlan, inField } from '../js/lessons/panne-campagne.js';
import { THRESHOLDS } from '../js/FlightReview.js';
import { LESSONS, lessonById } from '../js/lessons/index.js';

const DEG = Math.PI / 180;
const TRIM_RATE = 8 * DEG * 0.25;   // servo de trim, comme PlaneControls (_TRIM_RATE × _AP_TRIM)
const wrap = (a) => ((a % 360) + 540) % 360 - 180;

// Avion au banc, piloté par le moniteur : plan(c) rend la consigne d'après la situation c (comme Initiation._context)
function bench({ altitudeFt, speedKt, throttle, along = 0, left = 0, heading = 0, trimDeg = 8 }) {
    const f = airborne(makeAircraft({ model: 'realiste', seed: 1 }), { altitude: altitudeFt * FT, speed: speedKt * KT, throttle });
    f.object.position.set(-left, altitudeFt * FT, -along);
    f.object.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0, isVector3: true }, -heading * DEG);
    f.model.velocity.set(Math.sin(heading * DEG), 0, -Math.cos(heading * DEG)).multiplyScalar(speedKt * KT);
    f.model.trim = trimDeg * DEG;
    const pilot = new InstructorPilot();
    const b = { f, t: 0, failed: false, touchdown: null };
    const sys = { switches: { masterBat: true } };
    const controls = { setFlapLevel: (n) => f.model.setFlapLevel(n) };
    let lastY = f.object.position.y;
    f.model.addEventListener('touchdown', (e) => { b.touchdown ??= { fpm: e.impact / FT * 60, along: -f.object.position.z, left: -f.object.position.x }; });
    b.context = (dt) => {
        const y = f.object.position.y, vs = (y - lastY) / dt / FT * 60;
        lastY = y;
        const a = attitude(f), h = y / FT - 3;   // (hauteur des roues : origine de l'avion ~3 ft au-dessus du sol)
        const along = -f.object.position.z, leftOf = -f.object.position.x;
        return { agl: h, aal: h, vs, pitch: a.pitch / DEG, heading: a.heading, speedKt: f.model.indicatedSpeed / KT, groundKt: f.model.airspeed / KT,
            onGround: f.model.onGround, airborne: !f.model.onGround && h > 3, engineFailed: b.failed, time: b.t, along, left: leftOf,
            headingToAxis: wrap(a.heading), flaps: f.model.flapLevel ?? 0, runway: { heading: 0 }, controls, sys,
            sensors: { heading: a.heading, altitude: y / FT, vs, bank: f.model.bankAngle, pitch: f.model.pitchAttitude, ias: f.model.indicatedSpeed,
                tas: f.model.airspeed, side: f.model.sideAcceleration, onGround: f.model.onGround, throttle: f.model.throttle } };
    };
    b.fail = () => { b.failed = true; f.model.enginePower = 0; };
    b.run = (seconds, plan, each) => {
        const dt = 1 / 60;
        for (let t = 0; t < seconds && !f.model.crashed; t += dt) {
            const c = b.context(dt);
            each?.(c);
            if (b.stop) break;
            const out = pilot.update(dt, c.sensors, plan(c));
            const cc = f.model.controls;
            cc.pitch = out.pitch; cc.roll = out.roll; cc.yaw = out.yaw;
            if (out.trim) {
                const A = f.model.aircraft;
                f.model.trim = Math.max(A.trimTabMin, Math.min(A.trimTabMax, f.model.trim + out.trim * TRIM_RATE * dt));
            }
            if (out.throttle !== null) f.model.throttle = out.throttle;
            f.model.step(dt);
            b.t += dt;
        }
    };
    return b;
}

test('registre : les deux leçons de panne, critères sourcés, étapes construites', () => {
    for (const lesson of [panneDecollage, panneCampagne]) {
        assert.equal(lessonById(lesson.id), lesson);
        assert.ok(LESSONS.includes(lesson));
        assert.ok(lesson.criteria.length >= 4);
        for (const c of lesson.criteria) assert.ok(c.source && c.label.fr && c.label.en, `critère ${c.key} : libellé et source`);
        const tools = { T: (fr) => fr, EN: false, lang: 'fr', plan: {}, since: () => Infinity, measure() {}, set() {}, get() {}, mark() {}, failEngine() {} };
        const steps = lesson.build('fr', tools);
        assert.ok(steps.length >= 4);
        // Toutes les étapes en vol ont une démonstration (le moniteur garde les commandes d'une étape à l'autre)
        for (const s of steps) assert.ok(s.demo && s.flight, `étape « ${s.title} » : démonstration en vol`);
    }
    // Les seuils viennent des sources citées
    const glide = panneDecollage.criteria.find((c) => c.key === 'plane');
    assert.equal(glide.limit, 10);   // ACS PA.IX.B.S1 : ±10 kt
    assert.equal(panneDecollage.criteria.find((c) => c.key === 'toucher').limit, THRESHOLDS.touchdown.severe);
});

test('panne au décollage : la démonstration rend la main, plane à 65 kt ±10, droit devant, se pose sans casse', () => {
    const b = bench({ altitudeFt: 150, speedKt: 70, throttle: 1 });
    const state = {};
    let vmin = Infinity, glide = 0, heading = 0, failedAt = null, failAlong = null;
    b.run(120, (c) => forcedLandingDemo(c, state, 0), (c) => {
        if (!b.failed && c.aal >= FAILURE.failAt) { b.fail(); failedAt = b.t; failAlong = c.along; }
        if (b.failed && c.airborne && c.agl > FAILURE.measureFrom) {
            vmin = Math.min(vmin, c.speedKt);
            if (b.t - failedAt > FAILURE.settle) glide = Math.max(glide, Math.abs(c.speedKt - FAILURE.glide));
        }
        if (b.failed) heading = Math.max(heading, Math.abs(wrap(c.heading)));
        if (c.onGround && c.groundKt < 3) b.stop = true;
    });
    assert.equal(b.f.model.crashed, false, 'pas d\'accident');
    assert.ok(b.touchdown, 'posé');
    assert.ok(vmin >= FAILURE.glide - FAILURE.glideTol, `vitesse la plus basse : ${vmin.toFixed(1)} kt`);
    assert.ok(glide <= FAILURE.glideTol, `plané : écart ${glide.toFixed(1)} kt`);
    assert.ok(heading <= 5, `cap : ${heading.toFixed(1)}°`);
    assert.ok(b.touchdown.fpm <= THRESHOLDS.touchdown.warn, `toucher : ${b.touchdown.fpm.toFixed(0)} ft/min`);
    // Posé dans la bande plate qui prolonge la piste 18 d'ESME (départ au seuil, plat jusqu'à 1 800 m)
    assert.ok(b.touchdown.along > failAlong && b.touchdown.along < FIELD.to, `toucher à ${b.touchdown.along.toFixed(0)} m du départ`);
});

test('panne en campagne : de 2 000 ft, la démonstration rejoint le champ par le point clé et s\'y pose', () => {
    // Départ de la leçon : 4 km avant le seuil, 2 km à gauche de l'axe, cap perpendiculaire vers l'axe, panne d'emblée
    const b = bench({ altitudeFt: 2000, speedKt: 95, throttle: 0.68, along: -4000, left: 2000, heading: 90, trimDeg: 14 });
    b.fail();
    const state = {};
    let glide = 0;
    b.run(400, (c) => fieldPlan(c, state), (c) => {
        if (c.airborne && c.flaps === 0 && c.agl > 300 && b.t > 8) glide = Math.max(glide, Math.abs(c.speedKt - FAILURE.glide));
        if (c.onGround && c.groundKt < 3) b.stop = true;
    });
    assert.equal(b.f.model.crashed, false, 'pas d\'accident');
    assert.ok(b.touchdown, 'posé');
    assert.ok(glide <= FAILURE.glideTol, `plané : écart ${glide.toFixed(1)} kt`);
    assert.ok(inField({ along: b.touchdown.along, left: b.touchdown.left }), `toucher à ${b.touchdown.along.toFixed(0)} m du seuil, ${b.touchdown.left.toFixed(0)} m de l'axe`);
    assert.ok(Math.abs(b.touchdown.left) < 15, 'sur la piste (30 m de large)');
    assert.ok(b.touchdown.fpm <= THRESHOLDS.touchdown.warn, `toucher : ${b.touchdown.fpm.toFixed(0)} ft/min`);
});
