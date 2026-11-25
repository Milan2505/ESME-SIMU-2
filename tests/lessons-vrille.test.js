// Leçon « La vrille » (lot 6, js/lessons/vrille.js) jouée hors navigateur sur le banc du modèle réaliste, en air calme,
// en catégorie utilitaire (2 100 lb au plus, centrage avant 36,5 in : POH 172P p. 2-7 et 2-8, comme le banc de vrille de
// tests/flying-qualities.test.js) : chaque étape passe par sa condition, gestes et pilotage de la démonstration du
// moniteur (step.act, step.demo -> InstructorPilot). Vrille d'un tour à gauche, sortie PARE en moins d'un quart de tour
// (POH p. 4-18), ressource sous 4,4 g ; la note doit être « réussi ».
// Banc de leçon (playLesson) : copie de celui de tests/lessons-decrochages.test.js (même logique que Initiation.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, attitude, KT, FT } from './helpers/flight.js';
import { InstructorPilot } from '../js/InstructorPilot.js';
import { grade } from '../js/LessonGrade.js';
import lesson, { yawRateWorld } from '../js/lessons/vrille.js';

const DEG = Math.PI / 180, DT = 1 / 60;
const TRIM_RATE = 8 * DEG * 0.25;   // servo de trim (PlaneControls : _TRIM_RATE × _AP_TRIM)
const wrap = (a) => ((a % 360) + 540) % 360 - 180;

function playLesson(def, { mass = null, cg = null, maxStep = 300 } = {}) {
    const setup = def.setup ?? {};
    const f = airborne(makeAircraft({ model: 'realiste', seed: 1 }), { altitude: (setup.altitudeFt ?? 3000) * FT, speed: (setup.speedKt ?? 95) * KT,
        throttle: setup.throttle ?? 0.68 });
    const { model, object } = f;
    if (mass) model.mass = mass;
    if (cg !== null) model.cgOffset = cg;
    model.setFlapLevel(setup.flaps ?? 0);
    model.trim = (setup.trimDeg ?? 14) * DEG;
    const sys = { switches: { carbHeat: false }, toggle(id) { this.switches[id] = !this.switches[id]; } };
    const controls = {
        model, object,
        get throttle() { return model.throttle; }, set throttle(v) { model.throttle = v; },
        setFlapLevel: (n) => model.setFlapLevel(n), getFlapLevel: () => model.flapLevel,
        isNearStall: () => model.nearStall(), isStalled: () => model.stalled,
    };
    const results = {}, marks = {}, tracks = {}, plan = {};
    let time = 0, lastY = object.position.y, vs = 0;
    const criterion = (key) => def.criteria.find((c) => c.key === key);
    const tools = {
        lang: 'fr', EN: false, KT: 1 / KT, T: (fr) => fr, lesson: def, plan, wrap, headingDiff: (a, b) => Math.abs(wrap(a - b)),
        capSay: (h) => String(Math.round(h)),
        measure: (key, value) => {
            if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return;
            const compare = criterion(key)?.compare ?? 'max';
            const before = results[key];
            let next = value;
            if (before) {
                const b = before.value;
                if (compare === 'min') next = Math.min(b, value);
                else if (compare === 'abs') next = Math.abs(value) > Math.abs(b) ? value : b;
                else if (compare === 'bool') next = Boolean(b) && Boolean(value);
                else next = Math.max(b, value);
            }
            results[key] = { value: next, demonstrated: false };
        },
        set: (key, value) => { results[key] = { value, demonstrated: false }; },
        get: (key) => results[key]?.value,
        mark: (name) => { marks[name] = time; },
        since: (name) => (marks[name] === undefined ? Infinity : time - marks[name]),
        track: (name) => { tracks[name] = { last: attitude(f).heading, total: 0 }; },
        turned: (name) => tracks[name]?.total ?? 0,
        failEngine: () => {}, restoreEngine: () => {},
    };
    const context = () => {
        const a = attitude(f);
        const y = object.position.y;
        return {
            sys, controls, s: {}, onGround: model.onGround, airborne: !model.onGround, altitudeFt: y / FT, agl: y / FT, aal: y / FT,
            heading: a.heading, dg: a.heading, speedKt: model.indicatedSpeed / KT, vs, bank: -a.bank / DEG, pitch: a.pitch / DEG,
            load: model.loadFactor, alpha: model.alpha / DEG, stalled: model.stalled, flaps: model.flapLevel, throttle: model.throttle,
            time, plan, lesson: def, realistic: true, track: a.heading,
        };
    };
    const steps = def.build('fr', tools);
    const pilot = new InstructorPilot();
    const log = [];
    // Un pas de 1/60 s : consignes de la démonstration de l'étape -> InstructorPilot -> gouvernes, trim, gaz ; virages comptés
    const fly = (step) => {
        const c = context();
        const goal = step.demo?.(c, tools);
        const ctl = model.controls;
        if (goal) {
            const out = pilot.update(DT, { heading: c.heading, altitude: c.altitudeFt, vs, bank: -c.bank * DEG, pitch: c.pitch * DEG,
                ias: model.indicatedSpeed, tas: model.airspeed, side: model.sideAcceleration, onGround: model.onGround, throttle: model.throttle }, goal);
            assert.ok([out.pitch, out.roll, out.yaw].every(Number.isFinite), `${step.title} : commandes du moniteur non finies (${JSON.stringify(goal)})`);
            ctl.pitch = out.pitch; ctl.roll = out.roll; ctl.yaw = out.yaw;
            if (out.trim) model.trim = Math.max(model.aircraft.trimTabMin, Math.min(model.aircraft.trimTabMax, model.trim + out.trim * TRIM_RATE * DT));
            if (out.throttle !== null) model.throttle = out.throttle;
        } else Object.assign(ctl, { pitch: 0, roll: 0, yaw: 0 });
        model.step(DT);
        time += DT;
        vs = (object.position.y - lastY) / DT / FT * 60;
        lastY = object.position.y;
        const h = attitude(f).heading;
        for (const tr of Object.values(tracks)) { tr.total += wrap(h - tr.last); tr.last = h; }
    };
    for (const step of steps) {
        const flags = {};
        let c;
        // Comme dans le jeu : la démonstration de l'étape précédente se poursuit sur celle-ci avant qu'elle soit dite (0,5 s)
        const before = time;
        while (time - before < 0.5 && !model.crashed) fly(step);
        c = context();
        step.enter?.(c, {});
        if (typeof step.say === 'function') step.say(c);
        const t0 = time;
        let lastAct = -Infinity, done = false;
        while (!done && time - t0 < maxStep && !model.crashed) {
            c = context();
            if (step.act && !step.next && time - lastAct > 1 && !(step.done?.(c, flags, 0))) { lastAct = time; step.act(c, {}); }
            fly(step);
            c = context();
            step.measure?.(c, tools, DT);
            const elapsed = time - t0;
            if (step.next) done = elapsed > 4;
            else done = elapsed > 2.5 && Boolean(step.done?.(c, flags, DT));
        }
        log.push({ title: step.title, done, seconds: time - t0, altitude: object.position.y / FT });
        if (!done) break;
    }
    const g = grade({ criteria: def.criteria, results, deviations: model.crashed ? [{ kind: 'crash', severity: 'severe' }] : [] });
    return { f, results, log, grade: g, steps };
}

const describe = (r) => `${r.log.map((l) => `${l.title} ${l.done ? '' : 'NON FAITE '}${l.seconds.toFixed(0)} s ${l.altitude.toFixed(0)} ft`).join(' | ')}\n`
    + r.grade.details.map((d) => `${d.key} ${d.value} (${d.compare} ${d.limit}) ${d.ok ? 'ok' : 'MANQUÉ'}`).join(' ; ');

const LB = 0.45359237, IN = 0.0254;
const UTILITY = { mass: 2100 * LB, cg: 36.5 * IN - 1.0 };   // (cgOffset : écart au centrage de référence du modèle, 1,0 m)

test('vrille : un tour à gauche démontré par le moniteur, sortie PARE en moins d\'un quart de tour, ressource sous 4,4 g, leçon réussie', (t) => {
    const r = playLesson(lesson, { mass: UTILITY.mass, cg: UTILITY.cg });
    t.diagnostic(describe(r));
    assert.equal(r.f.model.crashed, false);
    assert.deepEqual(r.log.filter((l) => !l.done).map((l) => l.title), [], 'étapes non faites');
    assert.equal(r.log.length, r.steps.length);
    for (const d of r.grade.details) assert.ok(d.ok, `${d.key} : ${d.value} (${d.compare} ${d.limit}, ${d.source})`);
    assert.equal(r.grade.passed, true);
});

test('vrille : masse hors catégorie utilitaire (2 400 lb) -> critère éliminatoire manqué', () => {
    const r = playLesson(lesson, { mass: 2400 * LB, cg: UTILITY.cg, maxStep: 5 });
    const g = grade({ criteria: lesson.criteria, results: { ...r.results } });
    assert.equal(g.details.find((d) => d.key === 'mass').ok, false);
    assert.equal(g.passed, false);
});

test('vrille : rotation autour de la verticale lue dans le repère du monde (quaternion), signe + = à gauche', () => {
    const object = { quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    const model = { _angularVelocity: { x: 0, y: 0.8, z: 0 } };
    assert.ok(Math.abs(yawRateWorld({ controls: { model, object } }) - 0.8) < 1e-9);
    // Nez à 90° vers le bas (rotation de -90° autour de x) : le lacet avion devient un roulis du monde, le roulis avion
    // (axe z, vers l'arrière) devient la verticale
    const s = Math.SQRT1_2;
    object.quaternion = { x: -s, y: 0, z: 0, w: s };
    model._angularVelocity = { x: 0, y: 0, z: 0.5 };
    assert.ok(Math.abs(Math.abs(yawRateWorld({ controls: { model, object } })) - 0.5) < 1e-9);
    for (const c of lesson.criteria) assert.ok(c.source && /ACS|POH/.test(c.source), `${c.key} : source`);
});
