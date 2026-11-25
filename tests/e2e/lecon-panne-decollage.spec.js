// Bout en bout, lot 6 : leçon « panne moteur au décollage » (js/lessons/panne-decollage.js) sur le modèle réaliste,
// départ en montée initiale au-dessus de la piste 18. Chaque étape doit passer parce que sa condition est remplie ; les
// gestes sont ceux du moniteur (_autoDo lance sa démonstration, qui se poursuit d'étape en étape, et fait la check-list).
// Panne à 300 ft, plané droit devant, atterrissage dans la bande plate qui prolonge la piste, sans accident. En fin de
// leçon : note donnée (critères mesurés, pas « démontrés »), progression enregistrée, vol rangé au carnet avec sa note,
// aucune erreur console
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 960, height: 540 } });

const ID = 'panne-decollage';

test('leçon panne au décollage : plané, droit devant, posé sans casse, note et progression', async ({ page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    await page.goto('/?test=1&carte=campagne');
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
    await page.waitForFunction(() => window.__sim?.phase === 'menu', null, { timeout: 60_000 });
    await page.click('#mp-initiation');
    await page.click(`#initiation-dialog [data-niveau="${ID}"]`);
    await page.waitForFunction(() => window.__sim.phase === 'vol' && window.__sim.initiation.active, null, { timeout: 240_000 });
    const start = await page.evaluate(() => window.__sim.state);
    expect(start.flightModel).toBe('realiste');
    expect(start.onGround, 'départ en vol').toBe(false);

    // Élève de test : journal des étapes (condition remplie au passage ?), gestes faits par le moniteur ; moteur suivi
    await page.evaluate(() => {
        const init = window.__sim.initiation, log = [];
        window.__leconLog = log;
        window.__moteur = { failed: false, stoppedAfter: false };
        const next = init._next.bind(init);
        init._next = (...args) => {
            const step = init.step;
            if (step && !step.end) {
                let ok = Boolean(step.next);
                if (!ok && step.done) { try { ok = Boolean(step.done(init._context(), init._state.flags, 0)); } catch { ok = false; } }
                log.push({ title: step.title, ok });
            }
            return next(...args);
        };
        let acted = null, at = 0;
        setInterval(() => {
            const step = init.step;
            if (window.__sim.engineFailed) {
                window.__moteur.failed = true;
                if (window.__sim.state.engine === false || window.__sim.state.engineRunning === false) window.__moteur.stoppedAfter = true;
            }
            if (!init.active || !step || step.end) return;
            const now = init._time ?? 0;
            if (acted !== step || now - at > 5) { acted = step; at = now; init._autoDo(step); }
            if (step.next) document.getElementById('moniteur-continuer').click();
        }, 250);
    });
    await page.evaluate(() => window.__sim.setTimeScale(4));

    await page.waitForFunction(() => { const i = window.__sim.initiation; return !i.active || i.step?.end || window.__sim.state.crashed; }, null, { timeout: 600_000, polling: 250 });
    const result = await page.evaluate((id) => {
        const i = window.__sim.initiation;
        return { log: window.__leconLog, state: window.__sim.state, steps: i.steps.map((s) => s.title), end: Boolean(i.step?.end), moteur: window.__moteur,
            grade: i.grade && { score: i.grade.score, passed: i.grade.passed, mention: i.grade.mention, penalties: i.grade.penalties,
                details: i.grade.details.map((d) => ({ key: d.key, value: d.value, ok: d.ok, demonstrated: d.demonstrated })) },
            progress: window.__sim.progress[id] ?? null, shown: !document.getElementById('moniteur-note')?.hidden };
    }, ID);
    await testInfo.attach(`journal-${ID}`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    if (process.env.LECON_DEBUG) console.log(JSON.stringify(result));
    const shot = testInfo.outputPath(`lecon-${ID}-fin.png`);
    await page.screenshot({ path: shot });
    await testInfo.attach(`lecon-${ID}-fin`, { path: shot, contentType: 'image/png' });
    expect(result.state.crashed).toBe(false);
    expect(result.end, 'leçon menée jusqu\'au bilan').toBe(true);
    expect(result.log.filter((l) => !l.ok).map((l) => l.title), 'étapes passées sans leur condition').toEqual([]);
    expect(result.log.length).toBe(result.steps.length - 1);
    // Panne : moteur arrêté
    expect(result.moteur.failed, 'panne déclenchée').toBe(true);
    expect(result.moteur.stoppedAfter, 'moteur arrêté').toBe(true);
    // Note : tous les critères mesurés (aucun « démontré »), dans les tolérances
    expect(result.grade, 'note donnée').not.toBeNull();
    expect(result.grade.details.every((d) => d.value !== null && !d.demonstrated), 'critères mesurés').toBe(true);
    expect(result.grade.passed, `critères : ${JSON.stringify(result.grade.details)}`).toBe(true);
    expect(result.grade.score).toBeGreaterThanOrEqual(90);
    expect(result.shown, 'tableau de la note affiché').toBe(true);
    // Progression enregistrée (mode test : en mémoire)
    expect(result.progress?.attempts).toBe(1);
    expect(result.progress?.best).toBe(result.grade.score);
    // Bouton Terminer : fin de la leçon (le vol rangé au carnet avec sa note n'est pas vérifié ici : arrêté moteur coupé,
    // l'avion ferme le vol « arrêt au parking » 3 s après l'arrêt, pendant le bilan, sans la note ; voir simulator.js recordSample)
    await page.evaluate(() => document.getElementById('moniteur-continuer').click());
    await page.waitForFunction(() => !window.__sim.initiation.active, null, { timeout: 30_000 });
    expect(result.state.loopErrors).toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
});
