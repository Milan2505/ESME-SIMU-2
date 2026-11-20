// Initiation complète sur le modèle de vol réaliste (demande du 18/11/2026) : de l'avion éteint au parking N4 jusqu'au
// bilan, niveau 1 (le moniteur fait la radio). Un pilote de test (initiation-driver.js) fait les gestes de l'élève ; chaque
// étape doit passer parce que sa condition est remplie (pas par le délai d'une étape en vol, ni sautée). Long : ~15 min
// (temps réel, le jeu ne s'accélère pas). Fenêtre réduite pour des images plus rapides sans carte graphique.
import { test, expect } from '@playwright/test';
import { installInitiationDriver } from './initiation-driver.js';

test.use({ viewport: { width: 480, height: 270 } });

test('modèle réaliste · initiation complète niveau 1 : chaque étape validée par sa condition', async ({ page }, testInfo) => {
    test.setTimeout(45 * 60_000);
    const errors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
        const text = message.text();
        if (text.startsWith('[étape]') || text.startsWith('[pilote]')) console.log(text);
    });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    await page.goto('/?test=1&carte=campagne');
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
    await page.waitForFunction(() => window.__sim?.phase === 'menu', null, { timeout: 60_000 });
    await page.click('#mp-parametres');
    await page.selectOption('#reglages-dialog select[name="flightModel"]', '"realiste"');
    await page.click('#reglages-fermer');
    await page.click('#mp-initiation');
    await page.click('#initiation-dialog [data-niveau="1"]');
    await page.waitForFunction(() => window.__sim.phase === 'vol' && window.__sim.initiation.active, null, { timeout: 240_000 });
    expect(await page.evaluate(() => window.__sim.state.flightModel)).toBe('realiste');
    // INITIATION_JUSQUA : débogage seulement (étapes passées au bouton Passer jusqu'à cet indice) ; jamais dans npm run test:e2e
    await page.evaluate(installInitiationDriver, { fastUntil: Number(process.env.INITIATION_JUSQUA ?? -1) });

    // Jusqu'au bilan (dernière étape), ou crash, ou leçon arrêtée
    await page.waitForFunction(() => {
        const i = window.__sim.initiation;
        return !i.active || i.step?.end || window.__sim.state.crashed;
    }, null, { timeout: 40 * 60_000, polling: 1000 });
    const result = await page.evaluate(() => ({
        log: window.__driver.log, notes: window.__driver.notes, max: window.__driver.max,
        end: Boolean(window.__sim.initiation.step?.end), state: window.__sim.state,
        steps: window.__sim.initiation.steps.map((s) => s.title),
    }));
    const report = [
        ...result.log.map((l) => `${String(l.index).padStart(2)} ${l.title} : ${l.how}`),
        '', ...result.notes, '', `vitesse max ${result.max.kias.toFixed(0)} KIAS, facteur de charge ${result.max.minLoad.toFixed(2)} à ${result.max.load.toFixed(2)} g`,
    ].join('\n');
    await testInfo.attach('journal-initiation', { body: report, contentType: 'text/plain' });
    console.log(report);
    expect(result.state.crashed, 'pas de crash').toBe(false);
    expect(result.end, 'leçon menée jusqu\'au bilan').toBe(true);
    const failed = result.log.filter((l) => !l.ok).map((l) => `${l.index} ${l.title} (${l.how})`);
    expect(failed, 'étapes passées sans que leur condition soit remplie').toEqual([]);
    expect(result.log.length, 'toutes les étapes avant le bilan').toBe(result.steps.length - 1);
    expect(errors, 'erreurs console').toEqual([]);
});
