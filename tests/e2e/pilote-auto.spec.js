// Bout en bout, lot 4 : leçon « tenir un cap et une altitude au pilote automatique » (Initiation.js, buildAutopilotSteps) sur
// le modèle réaliste, départ en vol. Chaque étape doit passer parce que sa condition est remplie : le geste de l'élève est
// fait par le bouton de la leçon (_autoDo), une fois puis toutes les 5 s ; c'est le KAP 140 qui pilote. Captures du
// KAP 140 allumé (vue radios) et en fin de leçon
import { test, expect } from '@playwright/test';
import { simWait, waitSimSeconds, waitStarted, LOADING } from './sim-time.js';

test.use({ viewport: { width: 960, height: 540 } });

test('leçon pilote automatique : KAP 140 engagé, cap et altitude, montée, déconnexion', async ({ page }, testInfo) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    await page.goto('/?test=1&carte=campagne');
    await waitStarted(page);
    await page.click('#mp-initiation');
    await page.click('#initiation-dialog [data-niveau="ap"]');
    // (chargement de la carte : pas de temps simulé, délai de chargement)
    await page.waitForFunction(() => window.__sim.phase === 'vol' && window.__sim.initiation.active, null, { timeout: LOADING, polling: 250 });
    const start = await page.evaluate(() => window.__sim.state);
    expect(start.flightModel).toBe('realiste');
    expect(start.onGround, 'départ en vol').toBe(false);
    expect(start.altitude / 0.3048).toBeGreaterThan(2500);

    // Élève de test : journal des étapes (condition remplie au passage ?), gestes faits par la leçon
    await page.evaluate(() => {
        const init = window.__sim.initiation, log = [];
        window.__apLog = log;
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
            if (step.next) { document.getElementById('moniteur-continuer').click(); return; }
            const now = init._time ?? 0;
            if (acted !== step || now - at > 5) { acted = step; at = now; init._autoDo(step); }
        }, 250);
    });
    await page.evaluate(() => window.__sim.setTimeScale(4));

    // KAP 140 engagé en HDG et ALT : capture en vue radios (KAP 140 allumé)
    // (délais en temps simulé, sim-time.js : les anciens délais en temps réel × 4, temps accéléré du test)
    await simWait(page, () => { const a = window.__sim.state.autopilot; return a.engaged && a.lateral === 'HDG' && a.vertical === 'ALT'; }, null, { sim: 1200 });
    await page.evaluate(() => window.__sim.setTimeScale(1));
    // (vue radios : guidage de caméra du moniteur coupé, touche 6 envoyée à la fenêtre)
    await page.evaluate(() => { window.__sim.initiation.cameraGuide = false; });
    await page.evaluate((code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(-1) })); window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.slice(-1) })); }, 'Digit6');
    await waitSimSeconds(page, 1.5);
    const kapShot = testInfo.outputPath('kap140-allume.png');
    await page.screenshot({ path: kapShot });
    await testInfo.attach('kap140-allume', { path: kapShot, contentType: 'image/png' });
    await page.evaluate((code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(-1) })); window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.slice(-1) })); }, 'Digit1');
    await page.evaluate(() => window.__sim.setTimeScale(4));

    // Jusqu'au bilan
    await simWait(page, () => { const i = window.__sim.initiation; return !i.active || i.step?.end || window.__sim.state.crashed; }, null, { sim: 2400, polling: 250 });
    const result = await page.evaluate(() => ({ log: window.__apLog, state: window.__sim.state, steps: window.__sim.initiation.steps.map((s) => s.title), end: Boolean(window.__sim.initiation.step?.end) }));
    await testInfo.attach('journal-lecon-pa', { body: result.log.map((l) => `${l.title} : ${l.ok ? 'condition' : 'SANS condition'}`).join('\n'), contentType: 'text/plain' });
    expect(result.state.crashed).toBe(false);
    expect(result.end, 'leçon menée jusqu\'au bilan').toBe(true);
    expect(result.log.filter((l) => !l.ok).map((l) => l.title), 'étapes passées sans leur condition').toEqual([]);
    expect(result.log.length).toBe(result.steps.length - 1);
    expect(result.state.autopilot.engaged, 'pilote automatique coupé à la fin').toBe(false);
    expect(result.state.loopErrors).toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
    const endShot = testInfo.outputPath('lecon-pa-fin.png');
    await page.screenshot({ path: endShot });
    await testInfo.attach('lecon-pa-fin', { path: endShot, contentType: 'image/png' });
});
