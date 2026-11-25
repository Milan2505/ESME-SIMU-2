// Leçon 4 du lot 6, navigation VOR (js/lessons/vor.js) : définition complète (objectifs, critères sourcés, étapes
// bilingues avec démonstration du moniteur), et mesures des critères sur des situations simulées : tenue de la route
// notée loin de la balise seulement, consignes du moniteur selon l'aiguille. La leçon entière est jouée en bout en bout
// par tests/e2e/lecon-vor.spec.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vor from '../js/lessons/vor.js';
import { LESSONS, lessonById } from '../js/lessons/index.js';

// Outils de la leçon, comme Initiation._tools : pire valeur gardée selon le critère
function makeTools(lang = 'fr', lesson = vor) {
    const results = {}, marks = {};
    let time = 0;
    const criterion = (key) => lesson.criteria.find((c) => c.key === key);
    return {
        results, advance: (dt) => { time += dt; },
        lang, T: (fr, en) => (lang === 'en' ? en : fr), plan: {}, lesson,
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
const context = (over = {}) => ({
    altitudeFt: 3000, speedKt: 95, heading: 0, track: 0, vs: 0, aal: 3000,
    nav: { obs: 360, vor: { available: true, overhead: false, to: true, deviation: 0, radial: 180, bearingTo: 0, distance: 8000 } },
    ...over,
});

test('VOR : inscrite au registre, objectifs et critères sourcés', () => {
    assert.ok(LESSONS.includes(vor));
    assert.equal(lessonById('vor'), vor);
    assert.ok(vor.objectives.length >= 3);
    for (const o of vor.objectives) assert.ok(o.fr && o.en);
    assert.deepEqual(vor.criteria.map((c) => c.key), ['cdi', 'track', 'alt', 'ias']);
    for (const c of vor.criteria) {
        assert.ok(c.label.fr && c.label.en, c.key);
        assert.ok(/ACS|EASA/.test(c.source), `${c.key} : source citée`);
        assert.ok(typeof c.limit === 'number');
    }
    // Seuils de la table du lot 6 : ¾ de pleine échelle (ACS IR), ±10°, ±150 ft, ±15 kt (EASA AMC1 FCL.235)
    const limits = Object.fromEntries(vor.criteria.map((c) => [c.key, c.limit]));
    assert.deepEqual(limits, { cdi: 75, track: 10, alt: 150, ias: 15 });
    assert.equal(vor.setup.nav1, '113.50');
});

test('VOR : étapes bilingues, chacune avec démonstration du moniteur', () => {
    for (const lang of ['fr', 'en']) {
        const tools = makeTools(lang);
        const steps = vor.build(lang, tools);
        assert.ok(steps.length >= 6);
        const c = context();
        for (const step of steps) {
            assert.ok(step.title, 'titre');
            const text = typeof step.say === 'function' ? step.say(c) : step.say;
            assert.ok(text && text.length > 40, `${step.title} : consigne`);
            assert.equal(typeof step.demo, 'function', `${step.title} : démonstration`);
            const plan = step.demo(c, tools);
            assert.ok(Number.isFinite(plan.heading) && Number.isFinite(plan.altitude), `${step.title} : consignes du moniteur`);
            assert.ok(step.next || typeof step.done === 'function', `${step.title} : condition`);
        }
    }
});

test('VOR : route notée loin de la balise seulement ; altitude et vitesse partout', () => {
    const tools = makeTools();
    const steps = vor.build('fr', tools);
    steps[0].enter(context({ altitudeFt: 3012 }));
    assert.equal(tools.plan.alt, 3000);
    const inbound = steps.find((s) => s.title === 'Tenir la route vers la balise');
    inbound.measure(context({ altitudeFt: 3080, speedKt: 101, track: 6, nav: { obs: 360, vor: { available: true, overhead: false, to: true, deviation: -0.4, distance: 6000 } } }), tools, 0.1);
    assert.equal(tools.results.cdi, 40);
    assert.equal(tools.results.track, 6);
    assert.equal(tools.results.alt, 80);
    assert.equal(tools.results.ias, 6);
    // Près de la balise (cône de silence, aiguille trop sensible) : ni aiguille ni route
    inbound.measure(context({ track: 40, nav: { obs: 360, vor: { available: true, overhead: false, to: true, deviation: 1, distance: 1500 } } }), tools, 0.1);
    inbound.measure(context({ track: 40, nav: { obs: 360, vor: { available: true, overhead: true, to: true, deviation: 1, distance: 3000 } } }), tools, 0.1);
    assert.equal(tools.results.cdi, 40);
    assert.equal(tools.results.track, 6);
    // Passage de la balise : TO devient FROM
    assert.equal(Boolean(inbound.done(context({ nav: { obs: 360, vor: { available: true, to: true, deviation: 0, distance: 900 } } }))), false);
    assert.equal(Boolean(inbound.done(context({ nav: { obs: 360, vor: { available: true, to: false, deviation: 0, distance: 900 } } }))), true);
});

test('VOR : le moniteur suit l\'aiguille (interception à 30° au plus, corrections de 6° en tenue)', () => {
    const tools = makeTools();
    const steps = vor.build('fr', tools);
    const join = steps.find((s) => s.title === 'Rejoindre la route');
    const inbound = steps.find((s) => s.title === 'Tenir la route vers la balise');
    const at = (deviation) => context({ nav: { obs: 360, vor: { available: true, to: true, deviation, distance: 8000 } } });
    // Aiguille à gauche (route à gauche) : virage à gauche
    assert.equal(join.demo(at(-1)).heading, 330);
    assert.equal(inbound.demo(at(-1)).heading, 354);
    assert.equal(inbound.demo(at(0.1)).heading, 363);
    assert.equal(inbound.demo(at(0)).heading, 360);
    // Interception : aiguille qui quitte la butée
    const intercept = steps.find((s) => s.title === "Cap d'interception");
    assert.equal(intercept.demo(at(-1)).heading, 330);
    assert.equal(Boolean(intercept.done(at(-1))), false);
    assert.equal(Boolean(intercept.done(at(-0.5))), true);
});
