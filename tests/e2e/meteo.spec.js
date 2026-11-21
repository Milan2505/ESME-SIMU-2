// Bout en bout, météo et moteur (lot 3) : QNH de la partie et altimètre calé, METAR réel (donné par window.__sim.setMetar :
// pas de réseau en test), tirette de réchauffe au clavier (touche ²) et chute de régime, givrage du carburateur par temps
// froid et humide (régime qui baisse), fonte réchauffe tirée, puis arrêt du moteur si on laisse faire
import { test, expect } from '@playwright/test';
import { waitSimSeconds } from './sim-time.js';

const LONG = 240_000;
const FT = 0.3048;

test('météo : QNH et altimètre, METAR réel, réchauffe carburateur et givrage', async ({ page }, testInfo) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
    await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
    const sim = (expression, arg) => page.evaluate(expression, arg);
    const state = () => sim(() => window.__sim.state);
    const phase = (name, timeout = 60_000) => page.waitForFunction((p) => window.__sim?.phase === p, name, { timeout });

    await page.goto('/?test=1&carte=campagne');
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
    await phase('menu');
    // Effets de l'atmosphère « réaliste » (le défaut, doux, givre trois fois plus lentement)
    await page.click('#mp-parametres');
    await page.selectOption('#reglages-dialog select[name="atmosphere"]', JSON.stringify('realiste'));
    await page.click('#reglages-fermer');
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

    // QNH de la partie (graine fixe en mode test), altimètre calé au départ : il lit l'altitude du terrain (0 ft)
    let s = await state();
    expect(s.qnh).toBeGreaterThanOrEqual(995);
    expect(s.qnh).toBeLessThanOrEqual(1030);
    expect(s.baro, 'avion prêt à partir : altimètre calé au QNH').toBe(s.qnh);
    expect(Math.abs(s.altimeter / FT), 'altimètre au sol, bon calage (ft)').toBeLessThan(20);
    // Calage faux de 10 hPa (trop fort) : l'altimètre lit ~270 ft trop haut
    await sim(() => { window.__sim.avionics.baro += 10; });
    s = await state();
    expect(s.altimeter / FT).toBeGreaterThan(240);
    expect(s.altimeter / FT).toBeLessThan(310);
    await sim(() => { window.__sim.avionics.baro -= 10; });

    // METAR réel (froid et humide : givrage sérieux à toute puissance, abaque CAA SSL 14)
    expect(await sim(() => window.__sim.setMetar('LFML 211100Z 31008KT 4000 BR BKN012 10/09 Q1002'))).toBe(true);
    s = await state();
    expect(s.qnh).toBe(1002);
    expect(s.temperature).toBe(10);
    expect(s.dewPoint).toBe(9);
    expect(await sim(() => window.__sim.atc.metar.real)).toBe(true);
    await expect(page.locator('#météo-actuelle')).toContainText('LFML');

    // Essai moteur freins serrés à ~1 700 tr/min, puis réchauffe tirée à la touche ² : chute d'une centaine de tours
    await sim(() => { window.__sim.controls.parkingBrake = true; window.__sim.setThrottle(0.55); });
    await waitSimSeconds(page, 6);
    const before = (await state()).rpm;
    expect(before).toBeGreaterThan(1550);
    await page.locator('#ecran').click({ position: { x: 10, y: 10 } }).catch(() => {});
    await page.keyboard.press('Backquote');
    expect((await state()).carbHeat, 'tirette tirée (touche ²)').toBe(true);
    await waitSimSeconds(page, 6);
    const heated = (await state()).rpm;
    expect(before - heated, `chute réchauffe tirée (${before.toFixed(0)} -> ${heated.toFixed(0)})`).toBeGreaterThan(50);
    expect(before - heated).toBeLessThan(160);
    await page.keyboard.press('Backquote');
    expect((await state()).carbHeat).toBe(false);

    // Ralenti, réchauffe repoussée : la glace se forme, le régime baisse lentement
    await sim(() => window.__sim.setThrottle(0));
    await waitSimSeconds(page, 5);
    const idle = (await state()).rpm;
    await sim(() => window.__sim.setTimeScale(32));
    await page.waitForFunction(() => window.__sim.state.carbIce > 0.55, null, { timeout: 120_000 });
    await sim(() => window.__sim.setTimeScale(1));
    await waitSimSeconds(page, 2);
    const iced = await state();
    expect(iced.engineRunning).toBe(true);
    expect(iced.rpm, `régime qui baisse avec la glace (${idle.toFixed(0)} -> ${iced.rpm.toFixed(0)})`).toBeLessThan(idle - 40);
    // Réchauffe tirée : la glace fond en une vingtaine de secondes
    await page.keyboard.press('Backquote');
    await waitSimSeconds(page, 25);
    s = await state();
    expect(s.carbIce, 'glace fondue').toBe(0);
    expect(s.engineRunning).toBe(true);
    // Réchauffe repoussée et rien fait : le moteur finit par s'arrêter, carburateur givré
    await page.keyboard.press('Backquote');
    await sim(() => window.__sim.setTimeScale(32));
    await page.waitForFunction(() => !window.__sim.state.engineRunning, null, { timeout: 180_000 });
    s = await state();
    expect(s.stopReason).toBe('givrage');
    expect(s.loopErrors, 'aucune erreur dans la boucle d\'images').toBe(0);
    expect(errors, 'erreurs console').toEqual([]);
    const capture = testInfo.outputPath('meteo-givrage.png');
    await page.screenshot({ path: capture });
    await testInfo.attach('meteo-givrage', { path: capture, contentType: 'image/png' });
});
