// Bout en bout, lot 6 : leçon « décrochages et sortie » (js/lessons/decrochages.js) sur le modèle réaliste, départ en vol.
// Chaque étape doit passer parce que sa condition est remplie ; gestes et pilotage sont ceux du moniteur (_autoDo lance sa
// démonstration, qui se poursuit d'étape en étape ; les gestes step.act sont refaits toutes les 5 s). Trois décrochages
// francs, sorties sans accident ; en fin de leçon : note donnée (critères de l'ACS PA.VII.B et C et du POH mesurés, pas
// « démontrés »), tableau affiché, progression enregistrée, vol rangé au carnet avec sa note, aucune erreur console
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 960, height: 540 } });

test('leçon décrochages : lisse, volets sortis, en virage, sorties ; note et progression', async ({ page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    await page.goto('/?test=1&carte=campagne');
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
    await page.waitForFunction(() => window.__sim?.phase === 'menu', null, { timeout: 60_000 });
    await page.click('#mp-initiation');
    await page.click('#initiation-dialog [data-niveau="decrochages"]');
    await page.waitForFunction(() => window.__sim.phase === 'vol' && window.__sim.initiation.active, null, { timeout: 240_000 });
    const start = await page.evaluate(() => window.__sim.state);
    expect(start.flightModel).toBe('realiste');
    expect(start.onGround, 'départ en vol').toBe(false);

    // Élève de test : journal des étapes (condition remplie au passage ?), gestes faits par le moniteur
    await page.evaluate(() => {
        const init = window.__sim.initiation, log = [];
        window.__leconLog = log;
        const next = init._next.bind(init);
        init._next = (...args) => {
            const step = init.step;
            if (step && !step.end) {
                let ok = Boolean(step.next);
                if (!ok && step.done) { try { ok = Boolean(step.done(init._context(), init._state.flags, 0)); } catch { ok = false; } }
                const s = window.__sim.state;
                log.push({ title: step.title, ok, t: Math.round(init._time), ft: Math.round(s.altitude / 0.3048) });
            }
            return next(...args);
        };
        let acted = null, at = 0;
        setInterval(() => {
            const step = init.step;
            if (!init.active || !step || step.end) return;
            const now = init._time ?? 0;
            if (acted !== step || now - at > 5) { acted = step; at = now; init._autoDo(step); }
            if (step.next) document.getElementById('moniteur-continuer').click();
        }, 250);
    });
    await page.evaluate(() => window.__sim.setTimeScale(8));

    await page.waitForFunction(() => { const i = window.__sim.initiation; return !i.active || i.step?.end || window.__sim.state.crashed; }, null, { timeout: 600_000, polling: 250 });
    const result = await page.evaluate(() => {
        const i = window.__sim.initiation;
        return { log: window.__leconLog, state: window.__sim.state, steps: i.steps.map((s) => s.title), end: Boolean(i.step?.end),
            grade: i.grade && { score: i.grade.score, passed: i.grade.passed, mention: i.grade.mention, penalties: i.grade.penalties,
                details: i.grade.details.map((d) => ({ key: d.key, value: d.value, limit: d.limit, ok: d.ok, demonstrated: d.demonstrated })) },
            progress: window.__sim.progress.decrochages ?? null, shown: !document.getElementById('moniteur-note')?.hidden };
    });
    await testInfo.attach('journal-decrochages', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    expect(result.state.crashed).toBe(false);
    expect(result.end, 'leçon menée jusqu\'au bilan').toBe(true);
    expect(result.log.filter((l) => !l.ok).map((l) => l.title), 'étapes passées sans leur condition').toEqual([]);
    expect(result.log.length).toBe(result.steps.length - 1);
    // Note : tous les critères mesurés (aucun « démontré »), dans leurs tolérances
    expect(result.grade, 'note donnée').not.toBeNull();
    expect(result.grade.details.every((d) => d.value !== null && !d.demonstrated), 'critères mesurés').toBe(true);
    expect(result.grade.details.find((d) => d.key === 'stalls').value, 'trois décrochages francs').toBe(3);
    expect(result.grade.passed, `critères : ${JSON.stringify(result.grade.details)}`).toBe(true);
    expect(result.shown, 'tableau de la note affiché').toBe(true);
    // Progression enregistrée (mode test : en mémoire)
    expect(result.progress?.attempts).toBe(1);
    expect(result.progress?.best).toBe(result.grade.score);
    expect(result.state.loopErrors).toBe(0);
    const shot = testInfo.outputPath('lecon-decrochages-fin.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('lecon-decrochages-fin', { path: shot, contentType: 'image/png' });
    // Terminer : vol rangé au carnet avec la leçon et sa note
    await page.click('#moniteur-continuer');
    await page.waitForFunction(() => window.__sim.lastFlight?.flight?.meta?.lesson === 'decrochages', null, { timeout: 30_000 });
    const meta = await page.evaluate(() => window.__sim.lastFlight.flight.meta);
    expect(meta.grade).toBe(result.grade.score);
    expect(errors, 'erreurs console').toEqual([]);
});
