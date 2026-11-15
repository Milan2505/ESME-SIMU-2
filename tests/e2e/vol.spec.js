// Bout en bout : le vrai simulateur dans Chromium sans fenêtre (WebGL logiciel, sans réseau : voir playwright.config.js
// et server.js), en mode test (?test=1 : voir simulator.js, TEST_MODE). Un scénario par appareil et par carte : menu
// principal sans erreur console, départ en vol libre par les vrais boutons, 10 s de vol plein gaz, capture d'écran.
import { test, expect } from '@playwright/test';

const SCENARIOS = [
    { carte: 'campagne', avion: 'c172' },
    { carte: 'campagne', avion: 'f15' },
    { carte: 'campagne', avion: 'r44' },
    { carte: 'ville', avion: 'c172' },
    { carte: 'mer', avion: 'f15' },
];
const LONG = 240_000;   // ms : écran de chargement (shaders compilés par le processeur) et modèles lourds (F-15, R44)

for (const { carte, avion } of SCENARIOS) {
    test(`${carte} · ${avion} : menu sans erreur, vol libre, 10 s de vol, capture`, async ({ page }, testInfo) => {
        const errors = [];
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
        // Aucun réseau : tout vient du serveur local (three et mqtt depuis node_modules)
        await page.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
        const sim = (expression) => page.evaluate(expression);
        const phase = async (name, timeout = 60_000) => page.waitForFunction((p) => window.__sim?.phase === p, name, { timeout });

        await page.goto(`/?test=1&carte=${carte}`);
        await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: 120_000 });
        await phase('menu');
        await expect(page.locator('#menu-principal')).toBeVisible();
        await expect(page.locator('#mp-version')).toContainText('Version 0.');
        expect(await sim(() => window.__sim.test)).toBe(true);
        expect(await sim(() => window.__sim.map)).toBe(carte);
        expect(errors, 'erreurs console au menu principal').toEqual([]);

        // Vol libre : carte, aérodrome, hangar (avion), premier départ de la liste (piste ou catapulte, prêt à décoller)
        await page.click('#mp-vol-libre');
        await page.click(`#carte-liste button[data-carte="${carte}"]`);
        await page.click('#carte-continuer');
        await phase('aerodrome', LONG);
        await page.click('#aerodrome-liste button');
        await phase('hangar');
        if (avion !== 'c172') {
            await page.click(`#hangar-avions [data-avion="${avion}"]`);
            await page.waitForFunction((a) => window.__sim.aircraftType === a && !document.querySelector('#hangar-avions button:disabled'), avion, { timeout: LONG });
        }
        await page.click('#hangar-partir');
        await phase('depart');
        await page.click('#depart-liste button');
        await phase('vol', 120_000);
        const start = await sim(() => window.__sim.state);
        expect(start.aircraft).toBe(avion);
        expect(start.crashed).toBe(false);
        expect(start.engineRunning, 'départ sur la piste : moteur tournant').toBe(true);

        // Plein gaz (R44 : collectif levé, l'aide au stationnaire tient l'assiette). Sans carte graphique, les images
        // sont lentes et le temps simulé par image est plafonné (PlaneControls : 0,1 s) : on attend que l'appareil
        // roule vraiment (ou que le R44 ait décollé), puis 10 s de vol de plus
        await sim((a) => window.__sim.setThrottle(a === 'r44' ? 0.6 : 1), avion);
        await page.waitForFunction((a) => { const s = window.__sim.state; return s.crashed || (a === 'r44' ? !s.onGround : s.speed > 10); }, avion, { timeout: 120_000 });
        await page.waitForTimeout(10_000);
        const after = await sim(() => window.__sim.state);
        expect(after.crashed, 'pas de crash').toBe(false);
        expect(after.loopErrors, 'aucune erreur dans la boucle d\'images').toBe(0);
        if (avion === 'r44') {
            expect(after.onGround, 'le R44 a décollé').toBe(false);
            expect(after.rotorPercent, 'rotor en rotation').toBeGreaterThan(60);
        } else {
            const moved = Math.hypot(after.position.x - start.position.x, after.position.z - start.position.z);
            expect(moved, 'l\'avion a avancé').toBeGreaterThan(50);
            expect(after.speed).toBeGreaterThan(10);
            // C172 : régime de l'hélice calculé par le modèle de vol (Propulsion.js) et suivi par le compte-tours
            if (avion === 'c172') {
                expect(after.modelRpm, 'hélice entraînée plein gaz').toBeGreaterThan(1800);
                expect(Math.abs(after.rpm - after.modelRpm), 'compte-tours sur le régime du modèle').toBeLessThan(150);
            }
        }
        expect(errors, 'erreurs console pendant le vol').toEqual([]);
        const capture = testInfo.outputPath(`vol-${carte}-${avion}.png`);
        await page.screenshot({ path: capture });
        await testInfo.attach(`vol-${carte}-${avion}`, { path: capture, contentType: 'image/png' });
    });
}
