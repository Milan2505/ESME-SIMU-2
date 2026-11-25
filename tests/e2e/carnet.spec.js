// Bout en bout, lot 5 : vol enregistré (10 échantillons/s), fin de vol proposée, débriefing (trajectoire, courbes,
// écarts), export puis import CSV, rejeu 3D (pause, ×8, caméras), retour au vol. Carnet en mémoire en mode test.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { simWait, waitPhase, waitStarted, LOADING } from './sim-time.js';

test('carnet de vols : enregistrement, débriefing, CSV, rejeu 3D', async ({ page }, testInfo) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    const sim = (expression, arg) => page.evaluate(expression, arg);
    const shot = async (name) => {
        const path = testInfo.outputPath(`${name}.png`);
        await page.screenshot({ path });
        await testInfo.attach(name, { path, contentType: 'image/png' });
    };

    await page.goto('/?test=1&carte=campagne');
    await waitStarted(page);
    await page.click('#mp-vol-libre');
    await page.click('#carte-liste button[data-carte="campagne"]');
    await page.click('#carte-continuer');
    await waitPhase(page, 'aerodrome');
    await page.click('#aerodrome-liste button');
    await waitPhase(page, 'hangar');
    await page.click('#hangar-partir');
    await waitPhase(page, 'depart');
    await page.click('#depart-liste button');
    await waitPhase(page, 'vol');
    await sim(() => window.__sim.setTimeScale(4));

    // Décollage (comme realiste.spec.js), puis 30 s de vol. Délais en temps simulé (sim-time.js) : les anciens délais en
    // temps réel × 4 (temps accéléré du test), largement au-delà de ce que le vol demande
    await sim(() => window.__sim.setThrottle(1));
    await simWait(page, () => { const s = window.__sim.state; return s.crashed || s.indicatedSpeed > 55 * 0.5144; }, null, { sim: 720 });
    await sim(() => window.__sim.setInput({ pitch: 0.3 }));
    await simWait(page, () => { const s = window.__sim.state; return s.crashed || !s.onGround; }, null, { sim: 480 });
    await simWait(page, () => window.__sim.flightTime > 60, null, { sim: 480 });
    expect(await sim(() => window.__sim.recorder.recording)).toBe(true);

    // Fin du vol (comme un arrêt au parking) : rangé dans le carnet, carte « vol enregistré »
    await sim(() => window.__sim.endFlight('essai'));
    await expect(page.locator('#fin-vol')).toBeVisible();
    // (rangement dans le carnet : asynchrone, pas de temps simulé)
    await page.waitForFunction(() => window.__sim.lastFlight !== null, null, { timeout: LOADING });
    const recorded = await sim(() => {
        const f = window.__sim.lastFlight.flight;
        return { n: f.samples.length, duration: f.meta.duration, kinds: f.events.map((e) => e.kind), aircraft: f.meta.aircraft };
    });
    expect(recorded.aircraft).toBe('c172');
    expect(recorded.kinds).toContain('liftoff');
    expect(Math.abs(recorded.n / recorded.duration - 10), 'environ 10 échantillons par seconde').toBeLessThan(0.6);

    // Débriefing depuis la carte de fin de vol
    await page.click('#fin-vol-debrief');
    const dialog = page.locator('#debriefing-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-volet', 'vol');
    for (const id of ['debrief-carte', 'debrief-profil', 'debrief-ias', 'debrief-alt', 'debrief-vario', 'debrief-inclinaison', 'debrief-incidence']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
    }
    await expect(page.locator('#debrief-entete')).toContainText('172');
    await shot('debriefing');

    // Export CSV puis import : un deuxième vol dans le carnet
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#debrief-exporter')]);
    expect(download.suggestedFilename()).toMatch(/^esme-vol-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv.split('\n')[0].replace(String.fromCharCode(0xfeff), '')).toBe('# esme-vol,1');
    await page.click('#debrief-retour');
    await expect(dialog).toHaveAttribute('data-volet', 'liste');
    await page.setInputFiles('#debrief-fichier', { name: 'vol.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForFunction(async () => (await window.__sim.flightStore.list()).length === 2, null, { timeout: LOADING });
    await shot('mes-vols');

    // Rejeu 3D depuis le débriefing
    await page.locator('#debrief-liste button', { hasText: 'Débriefing' }).first().click();
    await expect(dialog).toHaveAttribute('data-volet', 'vol');
    await page.click('#debrief-rejouer');
    await waitPhase(page, 'rejeu');
    await expect(page.locator('#rejeu')).toBeVisible();
    await page.click('#rejeu [data-x="8"]');
    await page.click('#rejeu [data-cam="libre"]');
    const t0 = await sim(() => window.__sim.replay.t);
    // (à ×8, le rejeu avance d'au moins 8 fois le temps simulé de chaque image : 60 s simulées, l'ancien délai en temps réel)
    await simWait(page, (t) => window.__sim.replay.t > t + 5, t0, { sim: 60 });
    const playing = await sim(() => window.__sim.replay);
    expect(playing.speed).toBe(8);
    expect(playing.camera).toBe('libre');
    await shot('rejeu-libre');
    await page.click('#rejeu [data-cam="cabine"]');
    await page.click('#rejeu-lecture');
    // (relu jusqu'à ce que le clic soit traité : sous charge, la page peut avoir une image de retard ou plus)
    await expect.poll(() => sim(() => window.__sim.replay.paused), { timeout: LOADING }).toBe(true);
    await page.click('#rejeu-quitter');
    await waitPhase(page, 'vol');
    await expect(page.locator('#rejeu')).toBeHidden();
    expect(await sim(() => window.__sim.state.loopErrors), 'aucune erreur dans la boucle d\'images').toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
});
