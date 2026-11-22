// Bout en bout, périphériques (lot 2) : un yoke et un palonnier Saitek simulés (navigator.getGamepads remplacé avant le
// chargement de la page). Fenêtre Périphériques : préréglages reconnus, fonctions du Cessna, « Assigner ». Puis le C172
// (modèle réaliste) décolle aux seuls périphériques : gaz au levier, manche au yoke, freins du palonnier relâchés.
import { test, expect } from '@playwright/test';
import { waitSimSeconds } from './sim-time.js';

const LONG = 240_000;
const KT = 0.5144;

// Périphériques simulés (axes comme Chrome sous Windows : X 0, Y 1, Z 2, Rz 5, chapeau chinois 9, centre hors plage)
function mockGamepads() {
    const button = () => ({ pressed: false, touched: false, value: 0 });
    const pad = (index, id, nAxes, nButtons) => ({ id, index, mapping: '', connected: true, timestamp: 0,
        axes: new Array(nAxes).fill(0), buttons: Array.from({ length: nButtons }, button), vibrationActuator: null });
    const yoke = pad(0, 'Saitek Pro Flight Yoke (Vendor: 06a3 Product: 0bac)', 10, 23);
    yoke.axes[2] = 1;          // levier des gaz tiré (préréglage : levier poussé = brut -1 = plein gaz)
    yoke.axes[4] = 1;
    yoke.axes[9] = 1.2857;     // chapeau chinois au centre
    const pedals = pad(1, 'Saitek Pro Flight Rudder Pedals (Vendor: 06a3 Product: 0763)', 6, 0);
    pedals.axes[0] = pedals.axes[1] = -1;   // freins relâchés
    const pads = [yoke, pedals, null, null];
    window.__pads = {
        set(index, axes) { Object.assign(pads[index].axes, axes); pads[index].timestamp = performance.now(); },
        press(index, button, on) { Object.assign(pads[index].buttons[button], { pressed: on, touched: on, value: on ? 1 : 0 }); },
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads.slice() });
}

test('périphériques simulés : fenêtre Périphériques, puis décollage du C172 au yoke et au palonnier', async ({ page }, testInfo) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    await page.addInitScript(mockGamepads);
    const sim = (expression, arg) => page.evaluate(expression, arg);
    const phase = (name, timeout = 60_000) => page.waitForFunction((p) => window.__sim?.phase === p, name, { timeout });

    await page.goto('/?test=1&carte=campagne');
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
    await phase('menu');

    // Fenêtre Périphériques (menu principal) : les deux périphériques, leur préréglage, les fonctions du Cessna
    await page.click('#mp-peripheriques');
    const dialog = page.locator('#peripheriques-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.periph-appareil')).toHaveCount(2);
    await expect(dialog.locator('#periph-appareils')).toContainText('Préréglage : Logitech / Saitek Pro Flight Yoke');
    await expect(dialog.locator('#periph-appareils')).toContainText('Préréglage : Logitech / Saitek Pro Flight Rudder Pedals');
    await expect(dialog.locator('[data-fonction="throttle"] .periph-affectation')).toContainText('axe 2 inversé');
    await expect(dialog.locator('[data-fonction="brakeLeft"] .periph-affectation')).toContainText('Rudder Pedals · axe 0');
    await expect(dialog.locator('[data-fonction="mixture"]')).toHaveCount(1);
    await expect(dialog.locator('[data-fonction="fire"]')).toHaveCount(0);   // tir : F-15 seulement
    // Barre de test en direct : palonnier enfoncé à droite
    await sim(() => window.__pads.set(1, { 5: 1 }));
    await expect(dialog.locator('[data-fonction="yaw"] output')).toHaveText('100 %');
    await sim(() => window.__pads.set(1, { 5: 0 }));
    // « Assigner » : la vue sur le bouton 5 du yoke
    await dialog.locator('[data-fonction="view"] .periph-assigner').click();
    await expect(dialog.locator('[data-fonction="view"] .periph-assigner')).toHaveText('Bougez…');
    await sim(() => window.__pads.press(0, 5, true));
    await expect(dialog.locator('[data-fonction="view"] .periph-affectation')).toContainText('Saitek Pro Flight Yoke · bouton 5');
    await sim(() => window.__pads.press(0, 5, false));
    const window1 = testInfo.outputPath('fenetre-peripheriques.png');
    await dialog.screenshot({ path: window1 });
    await testInfo.attach('fenetre-peripheriques', { path: window1, contentType: 'image/png' });
    await page.click('#periph-fermer');
    await expect(dialog).toBeHidden();

    // Vol libre, Cessna, modèle réaliste (défaut)
    await page.click('#mp-vol-libre');
    await page.click('#carte-liste button[data-carte="campagne"]');
    await page.click('#carte-continuer');
    await phase('aerodrome', LONG);
    await page.click('#aerodrome-liste button');
    await phase('hangar');
    await page.click('#hangar-partir');
    await phase('depart');
    await page.click('#depart-liste button');
    await phase('vol', 120_000);
    await sim(() => window.__sim.setTimeScale(4));
    await sim(() => window.__sim.controls.addEventListener('crash', (e) => { window.__crashReason = `${e.reason} (vitesse ${window.__sim.state.speed.toFixed(1)} m/s)`; }));
    const start = await sim(() => window.__sim.state);
    expect(start.flightModel).toBe('realiste');
    expect(start.throttle, 'levier tiré : rien ne change tant qu\'il ne bouge pas').toBeLessThan(0.5);
    // Freins du palonnier au repos : aucun frein
    await page.waitForFunction(() => window.__sim.model.controls.brakeLeft === 0 && window.__sim.model.controls.brakeRight === 0);

    // Gaz au levier du yoke (aucun appel à setThrottle)
    await sim(() => window.__pads.set(0, { 2: -1 }));
    await page.waitForFunction(() => window.__sim.state.throttle > 0.99, null, { timeout: 30_000 });
    await page.waitForFunction(() => { const s = window.__sim.state; return s.crashed || s.indicatedSpeed > 55 * 0.5144; }, null, { timeout: 180_000 });
    // Manche tiré au yoke : la gouverne suit tout de suite (entrée directe, sans montée progressive)
    const pull = (0.2 - 0.05) / 0.95;   // zone morte du préréglage
    await sim(() => window.__pads.set(0, { 1: 0.2 }));
    await page.waitForFunction((p) => Math.abs(window.__sim.model.controls.pitch - p) < 1e-6, pull, { timeout: 10_000 });
    // (main passée au pilote de test à 3 m de haut : sous charge, les images sont lentes et il ne doit pas reposer l'avion)
    await page.waitForFunction((y0) => { const s = window.__sim.state; return s.crashed || (!s.onGround && s.altitude - y0 > 3); }, start.altitude, { timeout: 120_000 });
    // En l'air : temps réel (le périphérique n'est lu qu'une fois par image) et un pilote simple, au yoke seulement (axes
    // simulés) : ailes à plat, montée vers 65 kt indiqués, vitesse verticale amortie (phugoïde), rend la main pour garder la vitesse (pas de chandelle après l'envol), jamais en descendant sous 15 m
    await sim(() => window.__sim.setTimeScale(1));
    await sim((ground) => {
        window.__pilot = setInterval(() => {
            const st = window.__sim.state, clamp = (v, m) => Math.max(-m, Math.min(m, v));
            window.__pads.set(0, { 0: clamp(st.roll * 2, 0.5), 1: Math.max(st.altitude - ground < 15 && st.verticalSpeed < 0.5 ? 0.05 : -0.3, Math.min(0.3, 0.1 + (st.indicatedSpeed / 0.5144 - 65) * 0.02 - (st.verticalSpeed - 3) * 0.04)) });
        }, 50);
    }, start.altitude);
    const airborne = await sim(() => window.__sim.state);
    // Regard libre au chapeau chinois, en l'air : rien ne doit casser
    await sim(() => window.__pads.set(0, { 9: -1 }));
    await waitSimSeconds(page, 2);
    await sim(() => window.__pads.set(0, { 9: 1.2857 }));
    await waitSimSeconds(page, 8);
    const after = await sim(() => window.__sim.state);
    await sim(() => clearInterval(window.__pilot));
    expect(after.crashed, `pas de crash (${await sim(() => window.__crashReason)})`).toBe(false);
    expect(after.onGround, 'en l\'air').toBe(false);
    expect(after.indicatedSpeed, 'vitesse tenue').toBeGreaterThan(55 * KT);
    expect(Math.abs(after.roll), 'ailes à plat (ailerons au yoke)').toBeLessThan(0.25);
    expect(after.altitude - airborne.altitude, 'l\'avion monte').toBeGreaterThan(5);
    expect(after.loopErrors, 'aucune erreur dans la boucle d\'images').toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
    const capture = testInfo.outputPath('vol-peripheriques-c172.png');
    await page.screenshot({ path: capture });
    await testInfo.attach('vol-peripheriques-c172', { path: capture, contentType: 'image/png' });
});
