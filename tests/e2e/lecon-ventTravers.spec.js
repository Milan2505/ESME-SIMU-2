// Bout en bout, lot 6 : leçon « atterrissage par vent de travers » (js/lessons/vent-travers.js) sur le modèle réaliste,
// départ en finale à 2,5 NM, vent de travers forcé de 10 kt. Chaque étape doit passer parce que sa condition est remplie ;
// les gestes sont ceux du moniteur (_autoDo lance sa démonstration, qui se poursuit d'étape en étape : crabe, aile basse,
// arrondi, roulage et freinage). En fin de leçon : note donnée (critères de l'ACS PA.IV.B et de la FSF mesurés, pas
// « démontrés » : _autoDo hors bouton Passer), progression enregistrée, aucun accident, aucune erreur console
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 960, height: 540 } });

test('leçon vent de travers : finale en crabe, aile basse, toucher dans l\'axe, note et progression', async ({ page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    await page.goto('/?test=1&carte=campagne');
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
    await page.waitForFunction(() => window.__sim?.phase === 'menu', null, { timeout: 60_000 });
    await page.click('#mp-initiation');
    await page.click('#initiation-dialog [data-niveau="ventTravers"]');
    await page.waitForFunction(() => window.__sim.phase === 'vol' && window.__sim.initiation.active, null, { timeout: 240_000 });
    const start = await page.evaluate(() => window.__sim.state);
    expect(start.flightModel).toBe('realiste');
    expect(start.onGround, 'départ en vol').toBe(false);

    // Élève de test : journal des étapes (condition remplie au passage ?), gestes faits par le moniteur
    await page.evaluate(() => {
        const init = window.__sim.initiation, log = [];
        window.__leconLog = log;
        window.__leconTrace = [];
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
            if (!init.active || !step || step.end) return;
            const now = init._time ?? 0;
            if (acted !== step || now - at > 5) { acted = step; at = now; init._autoDo(step); }
            // Trajectoire relevée (pièce jointe du test)
            const c = init._context();
            const r = (v) => Math.round(v * 10) / 10;
            if (c.runway) window.__leconTrace.push([r(now), init.index, r(c.aal), r(c.along), r(c.left), r(c.speedKt), r(c.vs), r(c.headingToAxis), r(c.trackToAxis), r(c.bank), r(c.throttle), c.onGround ? 1 : 0, init.demonstrating ? 1 : 0]);
            if (step.next) document.getElementById('moniteur-continuer').click();
        }, 250);
    });
    await page.evaluate(() => window.__sim.setTimeScale(4));

    await page.waitForFunction(() => { const i = window.__sim.initiation; return !i.active || i.step?.end || window.__sim.state.crashed; }, null, { timeout: 600_000, polling: 250 });
    const result = await page.evaluate(() => {
        const i = window.__sim.initiation;
        return { log: window.__leconLog, state: window.__sim.state, steps: i.steps.map((s) => s.title), end: Boolean(i.step?.end),
            grade: i.grade && { score: i.grade.score, passed: i.grade.passed, mention: i.grade.mention, details: i.grade.details.map((d) => ({ key: d.key, value: d.value, ok: d.ok, demonstrated: d.demonstrated })) },
            progress: window.__sim.progress.ventTravers ?? null, trace: window.__leconTrace, shown: !document.getElementById('moniteur-note')?.hidden };
    });
    await testInfo.attach('journal-ventTravers', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    expect(result.state.crashed).toBe(false);
    expect(result.state.onGround, 'posé').toBe(true);
    expect(result.end, 'leçon menée jusqu\'au bilan').toBe(true);
    expect(result.log.filter((l) => !l.ok).map((l) => l.title), 'étapes passées sans leur condition').toEqual([]);
    expect(result.log.length).toBe(result.steps.length - 1);
    // Note : tous les critères mesurés (aucun « démontré »), dans les tolérances de l'ACS
    expect(result.grade, 'note donnée').not.toBeNull();
    expect(result.grade.details.every((d) => d.value !== null && !d.demonstrated), 'critères mesurés').toBe(true);
    expect(result.grade.passed, `critères : ${JSON.stringify(result.grade.details)}`).toBe(true);
    expect(result.grade.score).toBeGreaterThanOrEqual(90);
    expect(result.shown, 'tableau de la note affiché').toBe(true);
    // Progression enregistrée (mode test : en mémoire)
    expect(result.progress?.attempts).toBe(1);
    expect(result.progress?.best).toBe(result.grade.score);
    expect(result.state.loopErrors).toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
    const shot = testInfo.outputPath('lecon-ventTravers-fin.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('lecon-ventTravers-fin', { path: shot, contentType: 'image/png' });
});
