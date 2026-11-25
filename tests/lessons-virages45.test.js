// Leçon « virages à grande inclinaison » (js/lessons/virages45.js) sur le banc du modèle réaliste : la démonstration du
// moniteur (steepTurnDemo, par InstructorPilot) vole les deux 360° dans les tolérances de l'ACS PA.V.A (p. 36), et les
// mesures de la leçon (steepTurnMeasure) les relèvent ; une sortie trop tardive est bien comptée hors tolérance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, attitude, KT, FT } from './helpers/flight.js';
import { InstructorPilot } from '../js/InstructorPilot.js';
import virages45, { steepTurnDemo, steepTurnMeasure, STEEP } from '../js/lessons/virages45.js';
import { within } from '../js/LessonGrade.js';

const DEG = Math.PI / 180;
const TRIM_RATE = 8 * DEG * 0.25;   // servo de trim, comme PlaneControls (_TRIM_RATE × _AP_TRIM)
const wrap = (a) => ((a % 360) + 540) % 360 - 180;
const headingDiff = (a, b) => Math.abs(wrap(a - b));

// Palier à 3 000 ft, 90 kt ; puis 360° à gauche et 360° à droite comme dans la leçon. demo(turned, side, entry) : consignes
// du moniteur (par défaut, celles de la leçon)
function steepTurns({ demo = steepTurnDemo, hz = 60 } = {}) {
    const f = airborne(makeAircraft({ model: 'realiste' }), { altitude: 3000 * FT, speed: STEEP.speed * KT, throttle: 0.62 });
    const pilot = new InstructorPilot();
    const results = {};
    const tools = { measure: (k, v) => { results[k] = results[k] === undefined ? v : Math.max(results[k], v); } };
    const dt = 1 / hz;
    let lastY = f.object.position.y;
    const state = () => {
        const y = f.object.position.y, vs = (y - lastY) / dt / FT * 60;
        lastY = y;
        const a = attitude(f);
        return { heading: a.heading, altitude: y / FT, vs, bank: f.model.bankAngle, pitch: f.model.pitchAttitude, ias: f.model.indicatedSpeed,
            tas: f.model.airspeed, side: f.model.sideAcceleration, onGround: f.model.onGround, throttle: f.model.throttle };
    };
    const step = (plan) => {
        const s = state();
        const out = pilot.update(dt, s, plan);
        Object.assign(f.model.controls, { pitch: out.pitch, roll: out.roll, yaw: out.yaw });
        if (out.trim) f.model.trim = Math.max(f.model.aircraft.trimTabMin, Math.min(f.model.aircraft.trimTabMax, f.model.trim + out.trim * TRIM_RATE * dt));
        if (out.throttle !== null) f.model.throttle = out.throttle;
        f.model.step(dt);
        return s;
    };
    let s = null;
    for (let t = 0; t < 30; t += dt) s = step({ altitude: 3000, heading: 0, throttleSpeed: STEEP.speed });
    const ref = { altitude: s.altitude, speed: s.ias / KT };
    const turns = [];
    for (const side of [-1, 1]) {
        const entry = { ...ref, heading: s.heading };
        let turned = 0, last = s.heading, done = false, t = 0;
        while (!done && t < 120 && !f.model.crashed) {
            s = step(demo(turned, side, entry));
            turned += wrap(s.heading - last);
            last = s.heading;
            const c = { altitudeFt: s.altitude, speedKt: s.ias / KT, bank: -s.bank / DEG, heading: s.heading };
            done = steepTurnMeasure(c, tools, turned, side, entry, headingDiff);
            t += dt;
        }
        turns.push({ side, turned, done, t });
    }
    return { results, turns, crashed: f.model.crashed };
}

test('virages à 45° : le moniteur vole les deux 360° dans les tolérances de l\'ACS PA.V.A', () => {
    for (const hz of [60, 30]) {
        const r = steepTurns({ hz });
        assert.equal(r.crashed, false);
        for (const turn of r.turns) {
            assert.ok(turn.done, `${hz} images/s : virage ${turn.side < 0 ? 'à gauche' : 'à droite'} terminé (${turn.turned.toFixed(0)}° en ${turn.t.toFixed(0)} s)`);
            assert.equal(Math.sign(turn.turned), turn.side, 'sens du virage');
        }
        for (const c of virages45.criteria) {
            assert.ok(within(c.compare, r.results[c.key], c.limit), `${hz} images/s : ${c.key} = ${r.results[c.key]?.toFixed(1)} (limite ${c.limit} ${c.unit})`);
        }
    }
});

test('virages à 45° : une sortie 40° trop tard est hors tolérance (sortie ±10°)', () => {
    const late = (turned, side, entry) => steepTurnDemo(turned, side, { ...entry, heading: entry.heading + 40 * side });
    const r = steepTurns({ demo: late });
    assert.ok(r.results.sortie > STEEP.rollTol, `sortie : ${r.results.sortie?.toFixed(1)}°`);
});

test('virages à 45° : critères de l\'ACS PA.V.A, vitesse d\'entrée sous VA', () => {
    const byKey = Object.fromEntries(virages45.criteria.map((c) => [c.key, c]));
    assert.equal(byKey.inclinaison.limit, 5);
    assert.equal(byKey.altitude.limit, 100);
    assert.equal(byKey.vitesse.limit, 10);
    assert.equal(byKey.sortie.limit, 10);
    for (const c of virages45.criteria) assert.match(c.source, /PA\.V\.A/);
    assert.ok(STEEP.speed <= 92, 'VA du 172P : 92 KIAS à 2 000 lb (POH fig. 2-1, non relu sur scan)');
});
