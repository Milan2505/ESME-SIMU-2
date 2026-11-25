// Notation des leçons d'initiation (lot 6) : module pur, sans DOM ni three.js (testé par tests/lesson-grade.test.js).
//
// grade({ criteria, results, deviations }) -> { score (0-100), mention, passed, details, penalties }
//   criteria : critères chiffrés de la leçon (js/lessons/<id>.js), chacun avec sa source :
//     { key, label ('texte' ou { fr, en }), limit (nombre), compare ('max' : valeur ≤ limite, 'min' : valeur ≥ limite,
//       'abs' : |valeur| ≤ limite, 'bool' : valeur vraie), weight (1 par défaut), unit ('ft', 'kt', '°'…),
//       source (ex. 'FAA-S-ACS-6C, PA.V.A.S3, p. 36'), eliminatory (faux par défaut : critère dont l'échec seul fait
//       échouer la leçon même avec une bonne note) }
//   results : valeurs mesurées pendant la leçon (Initiation.js, tools.measure) : { [key]: nombre | booléen |
//     { value, demonstrated } } ; demonstrated : étape montrée par le moniteur (bouton Montrer), critère non compté
//   deviations : écarts relevés par review() du lot 5 (js/FlightReview.js) sur la fenêtre de la leçon :
//     [{ kind, severity ('info' | 'warn' | 'severe'), message, value, limit, t }]
//
// Barème (choix pédagogique du simulateur, pas une source : les épreuves FAA et EASA sont jugées réussi / échoué) :
// - note = part pondérée des critères tenus × 100, moins une pénalité par écart du débriefing (PENALTY), bornée à 0-100 ;
// - leçon réussie : tous les critères comptés tenus (l'ACS juge une tâche insatisfaisante dès qu'une tolérance est
//   dépassée : FAA-S-ACS-6C, introduction, « Satisfactory and Unsatisfactory Performance »), aucun écart sévère, pas
//   d'accident ;
// - mention : réussie, « Excellent » à 90 et plus, « Réussi » sinon ; non réussie, « À revoir » à 50 et plus,
//   « Non réussi » sinon.
//
// Progression (localStorage 'esme-progression', écriture coupée en mode test) : par leçon, { attempts, best, last,
// mention, passed (déjà réussie une fois), date (ISO du dernier essai) }.

export const PENALTY = { info: 0, warn: 5, severe: 15 };
export const MENTIONS = {
    excellent: { fr: 'Excellent', en: 'Excellent' },
    passed: { fr: 'Réussi', en: 'Passed' },
    review: { fr: 'À revoir', en: 'Needs work' },
    failed: { fr: 'Non réussi', en: 'Not passed' },
};
export const PROGRESS_KEY = 'esme-progression';

const text = (label, lang) => (label && typeof label === 'object' ? label[lang] ?? label.fr ?? '' : label ?? '');

// Valeur mesurée -> { value, demonstrated } (absente : value null)
function reading(entry) {
    if (entry === undefined || entry === null) return { value: null, demonstrated: false };
    if (typeof entry === 'object') return { value: entry.value ?? null, demonstrated: Boolean(entry.demonstrated) };
    return { value: entry, demonstrated: false };
}

// Critère tenu ? null : pas de mesure
export function within(compare, value, limit) {
    if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return null;
    switch (compare) {
        case 'min': return value >= limit;
        case 'abs': return Math.abs(value) <= limit;
        case 'bool': return Boolean(value) === (limit ?? true);
        case 'max':
        default: return value <= limit;
    }
}

export function grade({ criteria = [], results = {}, deviations = [], lang = 'fr' } = {}) {
    const details = criteria.map((c) => {
        const { value, demonstrated } = reading(results[c.key]);
        const ok = demonstrated ? null : within(c.compare ?? 'max', value, c.limit);
        return {
            key: c.key, label: text(c.label, lang), value, limit: c.limit ?? null, compare: c.compare ?? 'max', unit: c.unit ?? '',
            weight: c.weight ?? 1, source: c.source ?? '', eliminatory: Boolean(c.eliminatory), demonstrated,
            // Pas de mesure (étape non faite) : critère manqué
            ok: demonstrated ? null : ok ?? false, measured: value !== null,
        };
    });
    const counted = details.filter((d) => !d.demonstrated);
    const total = counted.reduce((s, d) => s + d.weight, 0);
    const kept = counted.reduce((s, d) => s + (d.ok ? d.weight : 0), 0);
    const penalties = deviations.map((d) => ({ kind: d.kind, severity: d.severity, message: d.message, t: d.t, points: PENALTY[d.severity] ?? 0 }))
        .filter((p) => p.points > 0);
    const base = total > 0 ? 100 * kept / total : 100;
    const score = Math.round(Math.max(0, Math.min(100, base - penalties.reduce((s, p) => s + p.points, 0))));
    const crashed = deviations.some((d) => d.kind === 'crash');
    const severe = deviations.some((d) => d.severity === 'severe');
    const passed = counted.length > 0 && counted.every((d) => d.ok) && !severe && !crashed;
    const key = passed ? (score >= 90 ? 'excellent' : 'passed') : score >= 50 && !crashed ? 'review' : 'failed';
    return { score, passed, mentionKey: key, mention: MENTIONS[key][lang] ?? MENTIONS[key].fr, details, penalties, demonstrated: details.length - counted.length };
}

// --- Progression -------------------------------------------------------------------------------------------------
const storageOf = (storage) => {
    if (storage !== undefined) return storage;
    try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function loadProgress(storage) {
    const s = storageOf(storage);
    if (!s) return {};
    try {
        const data = JSON.parse(s.getItem(PROGRESS_KEY) ?? '{}');
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
}

// Nouvel essai d'une leçon (pur) : progression mise à jour, sans toucher à l'objet reçu
export function recordAttempt(progress, id, result, date = new Date()) {
    const before = progress?.[id] ?? {};
    const entry = {
        attempts: (before.attempts ?? 0) + 1,
        best: Math.max(before.best ?? 0, result.score ?? 0),
        last: result.score ?? 0,
        mention: result.mentionKey ?? null,
        passed: Boolean(before.passed) || Boolean(result.passed),
        date: (date instanceof Date ? date : new Date(date)).toISOString(),
    };
    return { ...(progress ?? {}), [id]: entry };
}

// Essai enregistré ; persist faux (mode test) : rien n'est écrit, la progression rendue reste en mémoire
export function saveProgress(id, result, { storage, persist = true, date = new Date(), progress } = {}) {
    const s = storageOf(storage);
    const next = recordAttempt(progress ?? loadProgress(s), id, result, date);
    if (persist && s) {
        try { s.setItem(PROGRESS_KEY, JSON.stringify(next)); } catch { /* stockage plein ou indisponible */ }
    }
    return next;
}
