// Leçon 5 du lot 6, approche ILS (js/lessons/ils.js) : définition complète (objectifs, critères sourcés, étapes
// bilingues avec démonstration du moniteur) et mesures sur des situations simulées : palier avant le glide, aiguilles de
// la FAF à la DA, porte de stabilisation à 1 000 ft, consignes du moniteur selon les aiguilles. La leçon entière est
// jouée en bout en bout par tests/e2e/lecon-ils.spec.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ils from '../js/lessons/ils.js';
import { LESSONS, lessonById } from '../js/lessons/index.js';

function makeTools(lang = 'fr') {
    const results = {}, marks = {};
    let time = 0;
    const criterion = (key) => ils.criteria.find((c) => c.key === key);
    return {
        results, advance: (dt) => { time += dt; },
        lang, T: (fr, en) => (lang === 'en' ? en : fr), plan: {}, lesson: ils,
        measure: (key, value) => {
            assert.ok(criterion(key), `critère inconnu : ${key}`);
            const before = results[key];
            results[key] = before === undefined ? value : Math.max(before, value);
        },
        set: (key, value) => { assert.ok(criterion(key)); results[key] = value; },
        get: (key) => results[key],
        mark: (name) => { marks[name] = time; },
        since: (name) => (marks[name] === undefined ? Infinity : time - marks[name]),
        track: () => {}, turned: () => 0, failEngine: () => {}, restoreEngine: () => {},
    };
}
const ilsState = (over = {}) => ({ available: true, runway: '18', localizer: 0, glideslope: 0, distance: 5000, height: 270, glideHeight: 270, ...over });
const context = (over = {}, ilsOver = {}) => ({
    altitudeFt: 1200, aal: 1200, speedKt: 90, heading: 180, track: 180, trackToAxis: 0, vs: 0, groundKt: 90,
    runway: { heading: 180 },
    nav: { nav1: { available: true }, ils: ilsState(ilsOver) },
    ...over,
});

test('ILS : inscrite au registre, objectifs et critères sourcés', () => {
    assert.ok(LESSONS.includes(ils));
    assert.equal(lessonById('ils'), ils);
    for (const o of ils.objectives) assert.ok(o.fr && o.en);
    for (const c of ils.criteria) {
        assert.ok(c.label.fr && c.label.en, c.key);
        assert.ok(/ACS|Flight Safety Foundation/.test(c.source), `${c.key} : source citée`);
    }
    const limits = Object.fromEntries(ils.criteria.map((c) => [c.key, c.limit]));
    // ACS IR IR.VI.B.S9 / S12 p. 16, IR.VI.C.S7 p. 17 ; FSF BN 7.1
    assert.deepEqual(limits, { initAlt: 100, initHdg: 10, ias: 10, loc: 75, gs: 75, stable: true, gaHdg: 10, gaIas: 10, gaAlt: 100 });
    assert.equal(ils.setup.nav1, '110.30');
    assert.equal(ils.setup.runway, '18');
});

test('ILS : étapes bilingues, chacune avec démonstration du moniteur', () => {
    for (const lang of ['fr', 'en']) {
        const tools = makeTools(lang);
        const steps = ils.build(lang, tools);
        const c = context();
        steps[0].enter(c);
        for (const step of steps) {
            assert.ok(step.title);
            const text = typeof step.say === 'function' ? step.say(c) : step.say;
            assert.ok(text && text.length > 40, `${step.title} : consigne`);
            assert.equal(typeof step.demo, 'function', `${step.title} : démonstration`);
            assert.ok(Number.isFinite(step.demo(c, tools).heading), `${step.title} : cap du moniteur`);
            assert.equal(typeof step.done, 'function');
        }
    }
});

test('ILS : palier, aiguilles de la FAF à la DA, porte de stabilisation à 1 000 ft', () => {
    const tools = makeTools();
    const steps = ils.build('fr', tools);
    steps[0].enter(context({ altitudeFt: 1203, heading: 210 }));
    assert.equal(tools.plan.alt, 1200);
    // Localizer en butée : cap d'interception noté ; palier noté tant que le glide est loin au-dessus
    steps[0].measure(context({ altitudeFt: 1260, heading: 214 }, { localizer: 1, glideslope: 1 }), tools, 0.1);
    assert.equal(tools.results.initHdg, 4);
    assert.equal(tools.results.initAlt, 60);
    steps[0].measure(context({ altitudeFt: 1000, heading: 230 }, { localizer: 0.5, glideslope: 0.1 }), tools, 0.1);
    assert.equal(tools.results.initHdg, 4, 'cap libre une fois le localizer vivant');
    assert.equal(tools.results.initAlt, 60, 'palier noté avant le glide seulement');
    const descent = steps.find((s) => s.title === 'Descente sur le glide');
    descent.measure(context({ aal: 1100, vs: -500 }, { localizer: -0.3, glideslope: 0.2 }), tools, 0.1);
    assert.equal(tools.results.loc, 30);
    assert.equal(tools.results.gs, 20);
    assert.equal(tools.results.stable, undefined);
    descent.measure(context({ aal: 995, vs: -600 }, { localizer: 0.45, glideslope: -0.4 }), tools, 0.1);
    assert.equal(tools.results.stable, true);
    // La porte n'est jugée qu'une fois
    descent.measure(context({ aal: 900, vs: -1200 }, { localizer: 0.9 }), tools, 0.1);
    assert.equal(tools.results.stable, true);
    assert.equal(tools.results.loc, 90);
    // Hors des tolérances de la FSF à la porte : non stabilisé
    const other = makeTools();
    const steps2 = ils.build('fr', other);
    steps2.find((s) => s.title === 'Descente sur le glide').measure(context({ aal: 999, vs: -1100 }), other, 0.1);
    assert.equal(other.results.stable, false);
    assert.equal(Boolean(descent.done(context({ aal: 210 }))), false);
    assert.equal(Boolean(descent.done(context({ aal: 199 }))), true);
});

test('ILS : le moniteur intercepte, attend le glide en palier puis descend sur la pente', () => {
    const tools = makeTools();
    const steps = ils.build('fr', tools);
    steps[0].enter(context({ heading: 210 }));
    const demo = steps[0].demo;
    // Localizer en butée : cap d'interception, palier
    let plan = demo(context({}, { localizer: 1, glideslope: 1 }));
    assert.equal(plan.heading, 210);
    assert.equal(plan.altitude, 1200);
    // Localizer vivant, axe à droite : virage à droite, moins fort que l'interception
    plan = demo(context({}, { localizer: 0.4, glideslope: 0.8, distance: 6000 }));
    assert.equal(plan.heading, 190);
    assert.equal(plan.vs, undefined);
    // Glide au centre : descente (vario de 3° à 90 kt sol, environ -480 ft/min), corrections de 10° au plus
    plan = demo(context({}, { localizer: 0.9, glideslope: 0, distance: 5000 }));
    assert.ok(plan.vs < -440 && plan.vs > -520, `vario ${plan.vs}`);
    assert.equal(plan.heading, 190);
    assert.equal(plan.altitude, undefined);
    // Trop haut de 50 ft : on descend plus vite
    plan = demo(context({}, { glideslope: -0.3, height: 300, glideHeight: 285 }));
    assert.ok(plan.vs < -500);
    // Remise de gaz : plein gaz, Vy, cap de l'axe
    const ga = steps.find((s) => s.title === 'Minimums : remise de gaz');
    assert.deepEqual(ga.demo(context()), { heading: 180, maxBank: 10, throttle: 1, speed: 76 });
});
