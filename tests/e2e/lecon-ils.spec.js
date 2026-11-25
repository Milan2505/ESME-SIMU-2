// Bout en bout, lot 6 : leçon 5 « Approche ILS » (js/lessons/ils.js) jouée entière sur le modèle réaliste, départ en
// vol. Chaque étape doit passer parce que sa condition est remplie : les gestes sont faits par la leçon (_autoDo : le
// moniteur prend les commandes par sa démonstration), une fois puis toutes les 5 s. À la fin : note
// donnée (tableau du moniteur), progression enregistrée (en mémoire en mode test), note rangée dans le carnet de vols.
import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 960, height: 540 } });

test('leçon ILS : interception du localizer, capture du glide, descente stabilisée, minimums, remise de gaz', async ({ page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    await page.goto('/?test=1&carte=campagne');
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
    await page.waitForFunction(() => window.__sim?.phase === 'menu', null, { timeout: 60_000 });
    await page.click('#mp-initiation');
    await page.click('#initiation-dialog [data-niveau="ils"]');
    await page.waitForFunction(() => window.__sim.phase === 'vol' && window.__sim.initiation.active, null, { timeout: 240_000 });
    const start = await page.evaluate(() => ({ state: window.__sim.state, lesson: window.__sim.initiation.lesson }));
    expect(start.lesson).toBe('ils');
    expect(start.state.flightModel).toBe('realiste');
    expect(start.state.onGround, 'départ en vol').toBe(false);

    // Élève de test : journal des étapes (condition remplie au passage ?), gestes faits par la leçon ; trace du vol
    await page.evaluate(() => {
        const init = window.__sim.initiation, log = [], trace = [];
        window.__lessonLog = log;
        window.__lessonTrace = trace;
        const next = init._next.bind(init);
        init._next = (...args) => {
            const step = init.step;
            if (step && !step.end) {
                let ok = Boolean(step.next);
                if (!ok && step.done) { try { ok = Boolean(step.done(init._context(), init._state.flags, 0)); } catch { ok = false; } }
                log.push({ title: step.title, ok, t: Math.round(init._time) });
            }
            return next(...args);
        };
        let acted = null, at = 0, traced = -99;
        setInterval(() => {
            const step = init.step;
            if (!init.active || !step) return;
            const now = init._time ?? 0;
            if (now - traced > 5) {
                traced = now;
                const c = init._context(), i = c.nav?.ils;
                trace.push(`${Math.round(now)} s ${step.title} : alt ${Math.round(c.altitudeFt)} ft, haut. ${Math.round(c.aal)} ft, ${Math.round(c.speedKt)} kt, cap ${Math.round(c.heading)}, vario ${Math.round(c.vs)}, `
                    + `loc ${i?.available ? i.localizer.toFixed(2) : '-'}, glide ${i?.available ? i.glideslope.toFixed(2) : '-'}, ${i?.available ? (i.distance / 1852).toFixed(1) : '-'} NM`);
            }
            if (step.end) return;
            if (step.next) { document.getElementById('moniteur-continuer').click(); return; }
            if (acted !== step || now - at > 5) { acted = step; at = now; init._autoDo(step); }
        }, 250);
    });
    await page.evaluate(() => window.__sim.setTimeScale(8));

    // Jusqu'au bilan
    await page.waitForFunction(() => { const i = window.__sim.initiation; return !i.active || i.step?.end || window.__sim.state.crashed; }, null, { timeout: 12 * 60_000, polling: 500 });
    await page.evaluate(() => window.__sim.setTimeScale(1));
    const result = await page.evaluate(() => {
        const i = window.__sim.initiation;
        return { log: window.__lessonLog, trace: window.__lessonTrace, state: window.__sim.state, steps: i.steps.map((s) => s.title), end: Boolean(i.step?.end),
            grade: i.grade && { score: i.grade.score, passed: i.grade.passed, mention: i.grade.mention, details: i.grade.details.map((d) => `${d.key} ${d.value} (${d.compare} ${d.limit}) ${d.ok}`), penalties: i.grade.penalties },
            progress: window.__sim.progress?.ils ?? null, gradeShown: !document.getElementById('moniteur-note')?.hidden };
    });
    const journal = [...result.log.map((l) => `${l.t} s ${l.title} : ${l.ok ? 'condition' : 'SANS condition'}`), '', ...result.trace, '', JSON.stringify(result.grade, null, 1)].join('\n');
    writeFileSync(testInfo.outputPath('journal-lecon-ils.txt'), journal);
    await testInfo.attach('journal-lecon-ils', { body: journal, contentType: 'text/plain' });
    expect(result.state.crashed).toBe(false);
    expect(result.end, 'leçon menée jusqu\'au bilan').toBe(true);
    expect(result.log.filter((l) => !l.ok).map((l) => l.title), 'étapes passées sans leur condition').toEqual([]);
    expect(result.log.length).toBe(result.steps.length - 1);
    // Note donnée et affichée, progression enregistrée
    expect(result.grade, 'note de la leçon').toBeTruthy();
    expect(result.grade.score).toBeGreaterThanOrEqual(0);
    expect(result.gradeShown, 'tableau de la note affiché').toBe(true);
    expect(result.progress?.attempts, 'progression enregistrée').toBe(1);
    expect(result.progress.last).toBe(result.grade.score);
    // Le moniteur a volé dans les tolérances : leçon réussie
    expect(result.grade.details.filter((d) => !d.endsWith('true')), 'critères manqués').toEqual([]);
    expect(result.grade.passed).toBe(true);
    const endShot = testInfo.outputPath('lecon-ils-fin.png');
    await page.screenshot({ path: endShot });
    await testInfo.attach('lecon-ils-fin', { path: endShot, contentType: 'image/png' });

    // Terminer : la note est rangée dans le carnet de vols
    await page.click('#moniteur-continuer');
    await page.waitForFunction(() => window.__sim.lastFlight?.flight?.meta?.lesson === 'ils', null, { timeout: 30_000 });
    const meta = await page.evaluate(() => window.__sim.lastFlight.flight.meta);
    expect(meta.grade).toBe(result.grade.score);
    expect(meta.criteria.length).toBe(9);
    expect(result.state.loopErrors).toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
});
