import { TextureLoader } from 'three';

// Écran de chargement à l'entrée d'une partie (Vol libre, Multijoueur, Initiation).
// Les fichiers (avion, aérodromes, terrain, décor, sons...) commencent à se charger dès l'ouverture de la page, pendant
// le menu principal. Chaque élément nécessaire au vol est inscrit ici (track) avec la promesse de sa fin ; la barre de
// progression ne compte que ce qui est vraiment chargé et prêt. L'écran ne se ferme qu'une fois tout prêt, les shaders
// compilés et quelques images déjà dessinées derrière lui (préchauffage, voir simulator.js) : la première image visible
// du vol est fluide. La partie s'ouvre alors d'elle-même (le son est débloqué par les clics du menu).
// Un élément en échec (réseau) affiche un message et « Réessayer » (qui relance seulement ce qui a échoué) ; un élément
// qui ne progresse plus pendant STALL_SECONDS est traité comme un échec : jamais d'attente sans fin.

// Étapes affichées, dans l'ordre (libellé de l'étape en cours : la première pas encore finie) ; nom court de la liste
const SHORT = { avion: 'Avion', aerodromes: 'Aérodromes', terrain: 'Terrain', decor: 'Décor', ciel: 'Ciel et nuages',
    sons: 'Sons', instruments: 'Instruments', shaders: 'Shaders', prechauffage: 'Préchauffage' };
const STEPS = {
    avion:        "Chargement de l'avion",
    aerodromes:   'Chargement des aérodromes',
    terrain:      'Chargement du terrain',
    decor:        'Chargement du décor (forêts, villages)',
    ciel:         'Chargement du ciel et des nuages',
    sons:         'Chargement des sons',
    instruments:  'Préparation des instruments',
    shaders:      'Compilation des shaders',
    prechauffage: "Préchauffage de l'image",
};
const STALL_SECONDS = 45;

const items = [];        // { step, name, weight, fraction, state: 'loading' | 'done' | 'failed', error, retry, since }
const listeners = new Set();
let changed = 0;

function notify() {
    changed++;
    for (const listener of listeners) listener();
}

// Inscrit un élément. work : promesse, ou fonction qui la rend (refaite par « Réessayer » si elle échoue).
// retry : autre fonction à appeler pour réessayer (par défaut work, si c'est une fonction). Rend la promesse de work
function track(step, name, work, { weight = 1, retry } = {}) {
    const item = { step, name, weight, fraction: 0, state: 'loading', error: null, since: performance.now() };
    item.retry = retry ?? (typeof work === 'function' ? work : null);
    items.push(item);
    notify();
    const promise = watch(item, typeof work === 'function' ? work() : work);
    promise.item = item;   // (pour progress)
    return promise;
}

function watch(item, promise) {
    item.state = 'loading';
    item.error = null;
    item.since = performance.now();
    return Promise.resolve(promise).then((value) => {
        item.state = 'done';
        item.fraction = 1;
        notify();
        return value;
    }, (error) => {
        item.state = 'failed';
        item.error = error;
        console.error(`Chargement : ${item.name}`, error);
        notify();
        throw error;
    });
}

// Avancement partiel d'un élément long (0 -> 1) : la barre avance pendant qu'il se construit
function progress(item, fraction) {
    item.fraction = Math.max(item.fraction, Math.min(1, fraction));
    item.since = performance.now();
    notify();
}

// Élément dont l'avancement est donné au fur et à mesure (rend { item, done, fail, progress })
function task(step, name, options) {
    let done, fail;
    const promise = new Promise((resolve, reject) => { done = resolve; fail = reject; });
    const item = { step, name, weight: options?.weight ?? 1, fraction: 0, state: 'loading', error: null, since: performance.now(), retry: null };
    items.push(item);
    watch(item, promise).catch(() => {});
    return { item, done, fail, progress: (f) => progress(item, f) };
}

// Texture chargée comme TextureLoader.load (rendue tout de suite, image remplie à l'arrivée), suivie par l'écran de
// chargement ; un nouvel essai recharge l'image dans la même texture (les matériaux qui l'utilisent n'en savent rien)
function loadTexture(step, url, configure) {
    const loader = new TextureLoader();
    let texture = null;
    const attempt = () => new Promise((resolve, reject) => {
        const loaded = loader.load(url, (result) => {
            if (result !== texture) {
                texture.image = result.image;
                texture.needsUpdate = true;
            }
            resolve(texture);
        }, undefined, () => reject(new Error(`${url} introuvable`)));
        texture ??= loaded;
    });
    const first = attempt();
    configure?.(texture);
    track(step, url.split('/').pop(), first, { retry: attempt }).catch(() => {});
    return texture;
}

function summary() {
    let total = 0, done = 0;
    for (const item of items) {
        total += item.weight;
        done += item.weight * (item.state === 'done' ? 1 : item.fraction);
    }
    const pending = items.filter((item) => item.state !== 'done');
    const failed = items.filter((item) => item.state === 'failed');
    const now = performance.now();
    const stalled = pending.filter((item) => item.state === 'loading' && now - item.since > STALL_SECONDS * 1000);
    const current = Object.keys(STEPS).find((step) => pending.some((item) => item.step === step));
    return { total, done, ratio: total ? done / total : 1, pending, failed, stalled, current,
        count: items.length, doneCount: items.length - pending.length };
}

// Nouvel essai de ce qui a échoué (et de ce qui ne progresse plus)
function retryFailed() {
    const { failed, stalled } = summary();
    for (const item of [...failed, ...stalled]) {
        if (item.retry) watch(item, item.retry()).catch(() => {});
        else item.since = performance.now();   // rien à relancer : on lui laisse encore du temps
    }
    notify();
}

// Écran (index.html, #chargement)
class LoadingScreen {
    constructor(element) {
        this.element = element;
        this.bar = element.querySelector('#chargement-barre');
        this.stepLabel = element.querySelector('#chargement-etape');
        this.detail = element.querySelector('#chargement-detail');
        this.steps = element.querySelector('#chargement-etapes');
        this.errorBox = element.querySelector('#chargement-erreur');
        this.errorText = element.querySelector('#chargement-erreur-texte');
        this.active = false;
        this._shown = 0;
        this._stepRows = new Map(Object.entries(STEPS).map(([step, label]) => {
            const row = document.createElement('li');
            row.textContent = SHORT[step] ?? label;
            this.steps.append(row);
            return [step, row];
        }));
        element.querySelector('#chargement-reessayer').addEventListener('click', () => retryFailed());
        element.querySelector('#chargement-continuer').addEventListener('click', () => {
            this._skipFailures = true;
            this._render();
        });
        listeners.add(() => { if (this.active) this._render(); });
        // Vérifie aussi les éléments bloqués (aucun événement ne le signale)
        setInterval(() => { if (this.active) this._render(); }, 1000);
    }

    // Tout est-il prêt (hors préchauffage) ?
    get ready() {
        return summary().pending.length === 0;
    }

    // Affiche l'écran jusqu'à ce que tout soit prêt, puis lance prepare() (shaders, préchauffage : inscrits à leur
    // tour). Rend une promesse résolue dès que tout est prêt : la partie s'ouvre d'elle-même (le son est déjà autorisé
    // par les clics du menu, voir unlockSounds dans simulator.js)
    async open(prepare) {
        this.active = true;
        this._skipFailures = false;
        this._shown = 0;
        this.element.hidden = false;
        this._render();
        await this._waitReady();
        await prepare?.();
        await this._waitReady();
        this.active = false;
        this.element.hidden = true;
    }

    _waitReady() {
        return new Promise((resolve) => {
            const check = () => {
                const s = summary();
                const blocking = s.pending.filter((item) => !(this._skipFailures && (item.state === 'failed' || s.stalled.includes(item))));
                if (blocking.length) return;
                listeners.delete(check);
                clearInterval(timer);
                resolve();
            };
            listeners.add(check);
            const timer = setInterval(check, 1000);
            check();
        });
    }

    _render() {
        const s = summary();
        // La barre ne recule jamais (un élément peut s'inscrire en cours de route : le total grandit)
        this._shown = Math.max(this._shown, s.ratio);
        this.bar.value = this._shown;
        const percent = Math.floor(this._shown * 100);
        this.bar.textContent = `${percent} %`;
        this.stepLabel.textContent = s.current ? `${STEPS[s.current]}…` : 'Finalisation…';
        this.detail.textContent = `${percent} % · ${s.doneCount} / ${s.count} éléments prêts`;
        for (const [step, row] of this._stepRows) {
            const own = items.filter((item) => item.step === step);
            row.className = !own.length || own.every((item) => item.state === 'done') ? (own.length ? 'fait' : '')
                : own.some((item) => item.state === 'failed' || s.stalled.includes(item)) ? 'echec'
                : step === s.current ? 'encours' : '';
        }
        const problems = [...new Set([...s.failed, ...s.stalled])];
        this.errorBox.hidden = !problems.length || this._skipFailures;
        if (problems.length) {
            const names = problems.slice(0, 4).map((item) => item.name).join(', ') + (problems.length > 4 ? '…' : '');
            this.errorText.textContent = s.failed.length
                ? `Impossible de charger : ${names}. Vérifiez la connexion Internet, puis réessayez.`
                : `Le chargement ne progresse plus (${names}). La connexion est peut-être très lente.`;
        }
    }
}

export { track, task, progress, loadTexture, summary, retryFailed, LoadingScreen, STEPS };
