// Enregistrement d'un vol (lot 5) : module pur, sans DOM (testé par tests/flight-recorder.test.js). 10 échantillons par
// seconde de temps de jeu (décision du 21/11/2026) : position, attitude, vitesses, commandes, régime, volets, phase de
// vol ; plus les événements (messages ATC, envol, toucher, crash). Export et import CSV (relecture plus tard, autre
// ordinateur), interpolation entre deux échantillons pour le rejeu.

export const RATE = 10;   // échantillons par seconde

// Colonnes d'un échantillon (unités du pilote : kt, ft, ft/min, degrés ; position et quaternion dans le repère du jeu)
export const FIELDS = [
    't',                         // s depuis le début du vol (temps de jeu)
    'x', 'y', 'z',               // m
    'qx', 'qy', 'qz', 'qw',      // orientation (quaternion)
    'ias', 'tas', 'gs',          // kt : indiquée, vraie, sol
    'alt', 'agl', 'aal', 'vs',   // ft (altimètre), ft au-dessus du sol, ft au-dessus du seuil de la piste la plus proche, ft/min
    'hdg', 'bank', 'pitch', 'alpha', 'load',   // ° (inclinaison + = à droite), facteur de charge (g)
    'pitchIn', 'rollIn', 'yawIn', 'brake',     // commandes du pilote (-1 -> 1 ; brake 0 -> 1)
    'throttle', 'rpm', 'flaps', 'trim',        // 0 -> 1, tr/min (F-15 : N2 %, R44 : % rotor), ° de volets, ° de trim
    'gear', 'ground', 'stall',                 // 0 / 1
    'loc', 'gsDev',                            // écarts ILS (pleine échelle ±1 ; vide sans ILS réglé sur la NAV 1)
    'speedbrake', 'rotor',                     // F-15 : aérofrein (0 -> 1) ; R44 : régime rotor (%)
    'phase',                                   // texte : sol, roulage, envol, vol, approche, crash…
];
const TEXT = new Set([ 'phase' ]);
const DISCRETE = new Set([ 'gear', 'ground', 'stall', 'phase' ]);

export class FlightRecorder {
    constructor({ rate = RATE, maxSeconds = 4 * 3600 } = {}) {
        this.rate = rate;
        this.maxSamples = Math.ceil(maxSeconds * rate);
        this.flight = null;
    }

    get recording() { return this.flight !== null; }

    // Nouveau vol : meta { aircraft, airport, map, spawn, flightModel, lesson, … }
    start(meta = {}) {
        this.flight = { meta: { version: 1, rate: this.rate, started: new Date().toISOString(), ...meta }, samples: [], events: [] };
        this._next = 0;
    }

    // Échantillon au temps t (s, temps de jeu) : gardé s'il tombe au pas d'échantillonnage (10 par seconde)
    record(t, sample) {
        const f = this.flight;
        if (!f || t + 1e-9 < this._next || f.samples.length >= this.maxSamples) return false;
        const row = { t: round(t, 2) };
        for (const key of FIELDS) {
            if (key === 't') continue;
            const v = sample[key];
            row[key] = TEXT.has(key) ? (v ?? '') : v === null || v === undefined || !Number.isFinite(v) ? null : v;
        }
        f.samples.push(row);
        this._next = Math.max(this._next + 1 / this.rate, t + 0.5 / this.rate);
        return true;
    }

    // Événement : kind ('atc', 'liftoff', 'touchdown', 'crash', 'info'…), texte, valeurs en plus (ex. vs au toucher)
    event(t, kind, text = '', extra = {}) {
        this.flight?.events.push({ t: round(t, 2), kind, text: String(text), ...extra });
    }

    // Fin du vol : rend le vol (ou null s'il est trop court pour mériter un débriefing)
    stop({ minSeconds = 5, ...meta } = {}) {
        const f = this.flight;
        this.flight = null;
        if (!f || f.samples.length < 2) return null;
        const duration = f.samples[f.samples.length - 1].t;
        if (duration < minSeconds) return null;
        Object.assign(f.meta, { duration, ended: new Date().toISOString() }, meta);
        return f;
    }
}

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// --- Rejeu : état au temps t, interpolé entre les deux échantillons qui l'encadrent ---
export function sampleAt(flight, t) {
    const s = flight.samples;
    if (!s.length) return null;
    if (t <= s[0].t) return { ...s[0] };
    if (t >= s[s.length - 1].t) return { ...s[s.length - 1] };
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (s[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = s[lo], b = s[hi], k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    const out = { t };
    for (const key of FIELDS) {
        if (key === 't') continue;
        if (DISCRETE.has(key) || a[key] === null || b[key] === null) out[key] = a[key];
        else if (key === 'hdg') out[key] = (a.hdg + wrap180(b.hdg - a.hdg) * k + 360) % 360;
        else out[key] = a[key] + (b[key] - a[key]) * k;
    }
    // Quaternion : interpolation normalisée (pas de 0,1 s : nlerp suffit), par le plus court chemin
    const sign = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw < 0 ? -1 : 1;
    const q = [ 'qx', 'qy', 'qz', 'qw' ].map((key) => a[key] + (sign * b[key] - a[key]) * k);
    const n = Math.hypot(...q) || 1;
    [ out.qx, out.qy, out.qz, out.qw ] = q.map((v) => v / n);
    return out;
}
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;

// --- CSV : en-tête de métadonnées (# clé,valeur), événements (# event,t,kind,texte), puis le tableau des échantillons ---
export const CSV_MAGIC = '# esme-vol,1';
const quote = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (v) => (v === null || v === undefined ? '' : Number.isInteger(v) ? String(v) : String(round(v, 4)));

export function toCsv(flight) {
    const lines = [ CSV_MAGIC ];
    for (const [key, value] of Object.entries(flight.meta)) {
        if (key === 'version') continue;
        lines.push(`# ${quote(key)},${quote(typeof value === 'object' ? JSON.stringify(value) : value)}`);
    }
    for (const e of flight.events) {
        const { t, kind, text, ...extra } = e;
        lines.push(`# event,${num(t)},${quote(kind)},${quote(text)}${Object.keys(extra).length ? ',' + quote(JSON.stringify(extra)) : ''}`);
    }
    lines.push(FIELDS.join(','));
    for (const s of flight.samples) lines.push(FIELDS.map((key) => (TEXT.has(key) ? quote(s[key]) : num(s[key]))).join(','));
    return lines.join('\n') + '\n';
}

// Découpe d'une ligne CSV (champs entre guillemets, "" pour un guillemet)
function splitCsv(line) {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') inQuotes = false;
            else cur += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur);
    return out;
}

// Fichier exporté -> vol ; erreur explicite si ce n'en est pas un
export function fromCsv(text) {
    const lines = String(text).replace(new RegExp('^' + String.fromCharCode(0xfeff)), '').split(/\r?\n/).filter((l) => l.length);
    if (lines[0]?.trim() !== CSV_MAGIC) throw new Error('Ce fichier n\'est pas un vol exporté par le simulateur.');
    const meta = { version: 1 }, events = [], samples = [];
    let header = null;
    for (const line of lines.slice(1)) {
        if (line.startsWith('# ')) {
            const cells = splitCsv(line.slice(2));
            if (cells[0] === 'event') {
                const [, t, kind, eventText, extra] = cells;
                let more;
                try { more = extra ? JSON.parse(extra) : {}; } catch { more = {}; }
                events.push({ t: Number(t), kind, text: eventText ?? '', ...more });
            } else {
                const [key, value] = cells;
                meta[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
            }
            continue;
        }
        const cells = splitCsv(line);
        if (!header) { header = cells; continue; }
        const row = {};
        header.forEach((key, i) => {
            if (!FIELDS.includes(key)) return;
            const v = cells[i] ?? '';
            row[key] = TEXT.has(key) ? v : v === '' ? null : Number(v);
        });
        if (Number.isFinite(row.t)) samples.push(row);
    }
    if (!header || !header.includes('t') || samples.length < 2) throw new Error('Fichier de vol vide ou illisible.');
    for (const key of FIELDS) for (const s of samples) if (!(key in s)) s[key] = TEXT.has(key) ? '' : null;
    meta.duration ??= samples[samples.length - 1].t;
    return { meta, samples, events };
}
