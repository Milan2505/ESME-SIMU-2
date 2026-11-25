// Attentes des tests de bout en bout comptées en temps SIMULÉ, pas en temps réel (25/11/2026 : e2e stables sous charge).
// Sans carte graphique, et plus encore avec plusieurs simulateurs en parallèle, les images sont lentes (jusqu'à
// plusieurs secondes) : un délai en temps réel échouait sous charge alors que le simulateur n'était que lent. Le simulateur
// compte le temps qu'il a réellement fait avancer (window.__sim.simTime, mode test : 0,1 s au plus par image, plus les pas
// du temps accéléré) ; une attente échoue quand ce temps-là est écoulé sans que la condition soit remplie.
// Le temps réel ne sert plus que de filet contre un simulateur figé (REAL_CEILING), et pour ce qui n'est pas simulé :
// chargement, menus, IndexedDB (LOADING).

export const REAL_CEILING = 30 * 60_000;   // ms : filet seulement (simulateur figé), jamais le délai normal d'une attente
export const LOADING = 15 * 60_000;        // ms : chargement et menus (pas de temps simulé : shaders compilés par le processeur)

// Attend que `predicate(arg)`, évalué dans la page, soit vrai ; échoue après `sim` secondes de temps simulé.
// predicate : fonction autonome (sérialisée dans la page, comme pour page.waitForFunction)
export async function simWait(page, predicate, arg = null, { sim = 120, polling = 250, real = REAL_CEILING } = {}) {
    const start = await page.evaluate(() => window.__sim.simTime);
    const handle = await page.waitForFunction(({ source, arg, start, sim }) => {
        const ok = (0, eval)(`(${source})`)(arg);
        if (ok) return { ok: true };
        const elapsed = window.__sim.simTime - start;
        return elapsed > sim ? { ok: false, elapsed } : false;
    }, { source: predicate.toString(), arg, start, sim }, { timeout: real, polling });
    const result = await handle.jsonValue();
    if (!result.ok) throw new Error(`simWait : condition non remplie après ${sim} s de temps simulé (${result.elapsed.toFixed(1)} s) : ${predicate.toString().slice(0, 200)}`);
}

// Attend `seconds` secondes de temps simulé
export async function waitSimSeconds(page, seconds, { real = REAL_CEILING } = {}) {
    const start = await page.evaluate(() => window.__sim.simTime);
    await page.waitForFunction(([from, duration]) => window.__sim.simTime - from >= duration, [start, seconds], { timeout: real, polling: 100 });
}

// Phase du simulateur (menus, chargement de la carte, départ) : pas de temps simulé à compter, délai de chargement
export function waitPhase(page, name, timeout = LOADING) {
    return page.waitForFunction((p) => window.__sim?.phase === p, name, { timeout, polling: 250 });
}

// Démarrage de la page (écran de chargement) jusqu'au menu principal
export async function waitStarted(page) {
    await page.waitForFunction(() => window.esmeStarted === true, null, { timeout: LOADING, polling: 250 });
    await waitPhase(page, 'menu');
}
