// Bout en bout du modèle de vol réaliste (js/RigidBodyModel.js) : choisi par le vrai menu Paramètres (Pilotage > Modèle
// de vol (Cessna)), puis (1) initiation : la leçon démarre avion éteint au parking N4, l'avion reste immobile sur ses
// roues (train ressort-amortisseur, frein de parc), le moniteur passe aux étapes suivantes ; (2) vol libre : décollage
// plein gaz au manche tactile (montée progressive des commandes, InputRamp.js), montée sans crash. Même cadre que
// vol.spec.js (?test=1, sans réseau).
import { test, expect } from '@playwright/test';
import { waitSimSeconds } from './sim-time.js';

const LONG = 240_000;

async function openSimulator(page) {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    await page.goto('/?test=1&carte=campagne');
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
    await page.waitForFunction(() => window.__sim?.phase === 'menu', null, { timeout: 60_000 });
    // Paramètres > Pilotage > Modèle de vol (Cessna) : Réaliste (valeurs des listes : JSON, voir Settings.js)
    await page.click('#mp-parametres');
    await page.selectOption('#reglages-dialog select[name="flightModel"]', '"realiste"');
    await page.click('#reglages-fermer');
    expect(await page.evaluate(() => window.__sim.settings.values.flightModel)).toBe('realiste');
    return errors;
}
const state = (page) => page.evaluate(() => window.__sim.state);

test('modèle réaliste · initiation : départ au parking, avion immobile sur ses roues, le moniteur avance', async ({ page }) => {
    const errors = await openSimulator(page);
    await page.click('#mp-initiation');
    await page.click('#initiation-dialog [data-niveau="1"]');
    await page.waitForFunction(() => window.__sim.phase === 'vol' && !document.getElementById('moniteur').hidden, null, { timeout: LONG });
    await page.evaluate(() => window.__sim.setTimeScale(8));   // temps accéléré (mode test, voir simulateStep)
    const start = await state(page);
    expect(start.flightModel, 'modèle réaliste branché').toBe('realiste');
    expect(start.aircraft).toBe('c172');
    expect(start.engineRunning, 'avion éteint au parking').toBe(false);
    expect(start.onGround).toBe(true);
    // Le moniteur passe la première étape (frein de parc déjà serré) : la leçon avance d'elle-même
    const first = await page.textContent('#moniteur-titre');
    await page.waitForFunction((t) => document.getElementById('moniteur-titre').textContent !== t, first, { timeout: 60_000 });
    await waitSimSeconds(page, 5);
    const after = await state(page);
    const moved = Math.hypot(after.position.x - start.position.x, after.position.z - start.position.z);
    expect(moved, 'immobile au parking (train et frein de parc)').toBeLessThan(0.5);
    expect(Math.abs(after.position.y - start.position.y), 'posé sur ses roues, sans rebond').toBeLessThan(0.2);
    expect(after.crashed).toBe(false);
    expect(after.loopErrors, 'aucune erreur dans la boucle d\'images').toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
});

test('modèle réaliste · vol libre : décollage plein gaz au manche, montée sans crash', async ({ page }, testInfo) => {
    const errors = await openSimulator(page);
    await page.click('#mp-vol-libre');
    await page.click('#carte-liste button[data-carte="campagne"]');
    await page.click('#carte-continuer');
    await page.waitForFunction(() => window.__sim.phase === 'aerodrome', null, { timeout: LONG });
    await page.click('#aerodrome-liste button');
    await page.waitForFunction(() => window.__sim.phase === 'hangar', null, { timeout: 60_000 });
    await page.click('#hangar-partir');
    await page.waitForFunction(() => window.__sim.phase === 'depart', null, { timeout: 60_000 });
    await page.click('#depart-liste button');
    await page.waitForFunction(() => window.__sim.phase === 'vol', null, { timeout: 120_000 });
    await page.evaluate(() => window.__sim.setTimeScale(4));   // temps accéléré (mode test, voir simulateStep)
    const start = await state(page);
    expect(start.flightModel, 'modèle réaliste branché').toBe('realiste');
    expect(start.engineRunning).toBe(true);
    // Plein gaz ; manche tiré à 30 % dès 55 kt indiqués (le manche tactile passe par la montée progressive)
    await page.evaluate(() => window.__sim.setThrottle(1));
    await page.waitForFunction(() => { const s = window.__sim.state; return s.crashed || s.indicatedSpeed > 55 * 0.5144; }, null, { timeout: 180_000 });
    await page.evaluate(() => window.__sim.setInput({ pitch: 0.3 }));
    await page.waitForFunction(() => { const s = window.__sim.state; return s.crashed || !s.onGround; }, null, { timeout: 120_000 });
    await page.evaluate(() => window.__sim.setInput({ pitch: 0.1 }));
    const airborne = await state(page);
    await waitSimSeconds(page, 10);
    const after = await state(page);
    expect(after.crashed, 'pas de crash').toBe(false);
    expect(after.onGround, 'en l\'air').toBe(false);
    expect(after.altitude - airborne.altitude, 'l\'avion monte').toBeGreaterThan(5);
    expect(after.loopErrors, 'aucune erreur dans la boucle d\'images').toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
    const capture = testInfo.outputPath('vol-realiste-c172.png');
    await page.screenshot({ path: capture });
    await testInfo.attach('vol-realiste-c172', { path: capture, contentType: 'image/png' });
});
