// Temps simulé pour les tests de bout en bout. Sans carte graphique, et plus encore avec plusieurs simulateurs en parallèle
// (playwright.config.js : un par cœur), les images sont lentes, et PlaneControls plafonne le pas de temps à 0,1 s par
// image : 10 s de temps réel peuvent ne faire que 6 à 9 s de vol. Les durées de vol des tests se comptent donc en temps
// simulé, celui que le modèle de vol a réellement intégré.

// Attend `seconds` secondes de temps simulé (compteur posé sur controls.update, une fois par page)
export async function waitSimSeconds(page, seconds, timeout = 180_000) {
    const start = await page.evaluate(() => {
        const controls = window.__sim.controls;
        if (!controls.__simClock) {
            const update = controls.update.bind(controls);
            controls.__simClock = { t: 0 };
            // (même plafond que PlaneControls : 0,1 s par image)
            controls.update = (delta) => { controls.__simClock.t += Math.min(Math.max(delta, 0), 0.1); update(delta); };
        }
        return controls.__simClock.t;
    });
    await page.waitForFunction(([from, duration]) => window.__sim.controls.__simClock.t - from >= duration, [start, seconds], { timeout, polling: 250 });
}
