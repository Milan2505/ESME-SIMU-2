// Leçon « atterrissage par vent de travers » (js/lessons/vent-travers.js) sur le banc du modèle réaliste : la
// démonstration du moniteur (crosswindDemo, par InstructorPilot) pose l'avion dans les critères de la leçon (ACS
// PA.IV.B p. 20, FSF BN 7.1), par vent de travers de 10 kt de la droite comme de la gauche ; les mesures de la leçon
// (crosswindMeasure) relèvent bien le toucher. Piste fictive : seuil en (0, 0), axe vers le nord (-z), sol plat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, attitude, KT, FT } from './helpers/flight.js';
import { InstructorPilot } from '../js/InstructorPilot.js';
import ventTravers, { crosswindDemo, crosswindMeasure, CROSSWIND } from '../js/lessons/vent-travers.js';
import { within } from '../js/LessonGrade.js';

const DEG = Math.PI / 180;
const TRIM_RATE = 8 * DEG * 0.25;   // servo de trim, comme PlaneControls (_TRIM_RATE × _AP_TRIM)
const wrap = (a) => ((a % 360) + 540) % 360 - 180;

// Finale à distanceNm sur le plan de 3° (50 ft au seuil, comme startLesson), 65 kt, volets 30° ; vent de travers
// fromRight (+1 : de la droite, -1 : de la gauche) ; hz : pas de calcul (images par seconde)
function landing({ knots = CROSSWIND.wind.knots, fromRight = 1, hz = 60, distanceNm = 2.5, seed = 1 } = {}) {
    const f = makeAircraft({ model: 'realiste', seed });
    const y0 = f.object.position.y;
    const along0 = -distanceNm * 1852;
    f.object.position.set(0, y0 + (50 + Math.tan(3 * DEG) * -along0 / FT) * FT, -along0);
    f.object.quaternion.identity();
    f.model.restart(false);
    f.model.velocity.set(0, 0, -65 * KT);
    f.model.airspeed = 65 * KT;
    f.model.throttle = 0.4;
    f.model.setFlapLevel(3);
    f.model.flaps = 1;
    f.model.trim = 25 * DEG;
    f.model.wind.set(-fromRight * knots * KT, 0, 0);   // vent venant de l'est (droite de l'axe nord) : air vers l'ouest
    const pilot = new InstructorPilot();
    const demo = {}, prev = {}, results = {};
    const tools = {
        measure: (k, v) => { results[k] = results[k] === undefined ? v : Math.max(results[k], v); },
        set: (k, v) => { results[k] = v; },
        get: (k) => results[k],
    };
    const dt = 1 / hz;
    let t = 0, lastY = f.object.position.y;
    const track = [];
    while (t < 240 && !f.model.crashed) {
        const p = f.object.position, v = f.model.velocity, a = attitude(f);
        const vs = (p.y - lastY) / dt / FT * 60;
        lastY = p.y;
        const trk = Math.hypot(v.x, v.z) > 1 ? (Math.atan2(v.x, -v.z) / DEG + 360) % 360 : a.heading;
        const c = { time: t, onGround: f.model.onGround, aal: (p.y - y0) / FT, along: -p.z, left: -p.x, heading: a.heading, track: trk,
            headingToAxis: wrap(a.heading), trackToAxis: wrap(trk), groundKt: Math.hypot(v.x, v.z) / KT, speedKt: f.model.indicatedSpeed / KT,
            vs, pitch: f.model.pitchAttitude / DEG, yawRate: f.model._angularVelocity.y / DEG, crosswind: fromRight * knots };
        crosswindMeasure(c, tools, prev);
        const plan = crosswindDemo(c, demo);
        const out = pilot.update(dt, { heading: a.heading, altitude: p.y / FT, vs, bank: f.model.bankAngle, pitch: f.model.pitchAttitude,
            ias: f.model.indicatedSpeed, tas: f.model.airspeed, side: f.model.sideAcceleration, onGround: f.model.onGround, throttle: f.model.throttle }, plan);
        Object.assign(f.model.controls, { pitch: out.pitch, roll: out.roll, yaw: out.yaw, brake: plan.brake ? 1 : 0 });
        if (out.trim) f.model.trim = Math.max(f.model.aircraft.trimTabMin, Math.min(f.model.aircraft.trimTabMax, f.model.trim + out.trim * TRIM_RATE * dt));
        if (out.throttle !== null) f.model.throttle = out.throttle;
        f.model.step(dt);
        t += dt;
        if (track.length < Math.floor(t)) track.push({ x: p.x, y: p.y, z: p.z });   // une position par seconde
        if (c.onGround && c.groundKt < 5) break;
    }
    return { results, crashed: f.model.crashed, stoppedAt: -f.object.position.z, track, t };
}

function assertCriteria(r, label) {
    assert.equal(r.crashed, false, `${label} : accident`);
    for (const c of ventTravers.criteria) {
        const value = r.results[c.key];
        assert.ok(within(c.compare, value, c.limit), `${label} : ${c.key} = ${value?.toFixed?.(2) ?? value} (limite ${c.limit} ${c.unit})`);
    }
    assert.ok(r.stoppedAt < 1000, `${label} : arrêté à ${r.stoppedAt.toFixed(0)} m du seuil (piste de 1 000 m)`);
}

test('vent de travers : le moniteur pose l\'avion dans les critères de la leçon, vent de droite et de gauche', () => {
    for (const fromRight of [1, -1]) assertCriteria(landing({ fromRight }), fromRight > 0 ? 'vent de droite' : 'vent de gauche');
});

test('vent de travers : même trajectoire à 60, 30 et 15 images/s', () => {
    const runs = [60, 30, 15].map((hz) => ({ hz, r: landing({ hz }) }));
    for (const { hz, r } of runs) assertCriteria(r, `${hz} images/s`);
    const ref = runs[0].r.track;
    for (const { hz, r } of runs.slice(1)) {
        const n = Math.min(ref.length, r.track.length);
        let worst = 0;
        for (let i = 0; i < n; i++) worst = Math.max(worst, Math.hypot(r.track[i].x - ref[i].x, r.track[i].y - ref[i].y, r.track[i].z - ref[i].z));
        assert.ok(worst < 15, `${hz} images/s : écart de ${worst.toFixed(1)} m à la trajectoire à 60 images/s`);
        assert.ok(Math.abs(r.results.aimLong - runs[0].r.results.aimLong) < 15, `${hz} images/s : point de toucher`);
    }
});

test('vent de travers : vent de la leçon sous le maximum démontré, critères sourcés', () => {
    assert.ok(CROSSWIND.wind.knots <= 15, 'vent de travers maximal démontré du POH 172P : 15 kt');
    for (const c of ventTravers.criteria) assert.ok(c.source && c.source.length > 10, `source du critère ${c.key}`);
    assert.equal(ventTravers.setup.flaps, 3);
});
