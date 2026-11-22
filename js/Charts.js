// Courbes du débriefing (lot 5) : grandeurs d'un vol enregistré (js/FlightRecorder.js) en fonction du temps, sur un
// canvas 2D, sans dépendance. Style des fenêtres bleu nuit (repris du graphique de masse et centrage, WeightBalance._chart).
// Le profil vertical est un TimeChart à deux séries : altitude et sol sous l'avion (rempli).
// Fonctions pures exportées (testées sous Node, tests/charts.test.js) : niceTicks, formatTime, decimate, extent.

const GRID_MAJOR = 'rgba(255,255,255,0.14)';
const GRID_MINOR = 'rgba(255,255,255,0.05)';
const TICK_COLOR = '#9fb2c4';
const TITLE_COLOR = '#8fd3ff';
const LIMIT_COLOR = 'rgba(232, 68, 58, 0.8)';
const LIMIT_TEXT = '#e8443a';
const PAD = { left: 52, right: 14, top: 24, bottom: 22 };   // marges du tracé (px CSS)
const font = (size, weight = '') => `${weight} ${size}px "Noto Sans", Arial, sans-serif`;

// Graduations « rondes » (1, 2 ou 5 × 10^n) couvrant [min, max], environ count intervalles ; valeurs comprises dans
// [min, max], arrondies au pas (pas de 0.30000000000000004)
export function niceTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    if (min > max) [min, max] = [max, min];
    if (min === max) return [min];
    const raw = (max - min) / Math.max(1, count);
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const fraction = raw / power;
    const step = (fraction <= 1.5 ? 1 : fraction <= 3 ? 2 : fraction <= 7 ? 5 : 10) * power;
    const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const ticks = [];
    for (let i = Math.ceil(min / step - 1e-9); i * step <= max + step * 1e-9; i++) {
        ticks.push(Number((i * step).toFixed(digits)) + 0);   // + 0 : pas de -0
    }
    return ticks;
}

// Temps de vol (s) : « mm:ss », ou « h:mm:ss » à partir d'une heure ; secondes tronquées, négatif ramené à 0
export function formatTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(Math.floor(s / 60))}:${two(sec)}`;
}

// Bornes [min, max] des valeurs finies (null, NaN, ±Infinity ignorés) ; null sans aucune valeur
export function extent(values) {
    let min = Infinity, max = -Infinity;
    for (const v of values) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return min <= max ? [min, max] : null;
}

// Réduction d'une courbe pour le dessin : xs croissants, ys (null ou NaN = trou). Sur [x0, x1] découpé en `pixels`
// colonnes, chaque colonne garde au plus son minimum et son maximum, dans l'ordre du temps ; un point de chaque côté
// de la fenêtre est gardé pour que la courbe aille jusqu'aux bords. Un trou donne un point { x, y: null }.
// Résultat : { xs, ys } (au plus 2 × pixels + 2 points, plus les trous).
export function decimate(xs, ys, x0, x1, pixels) {
    const outX = [], outY = [];
    const n = Math.min(xs.length, ys.length);
    const cols = Math.max(1, Math.floor(pixels));
    const width = x1 - x0 || 1;
    let col = null, minI = -1, maxI = -1;
    const isGap = (v) => typeof v !== 'number' || !Number.isFinite(v);
    const pushGap = (x) => {
        if (outY.length && outY[outY.length - 1] !== null) { outX.push(x); outY.push(null); }
    };
    const flush = () => {
        if (minI < 0) return;
        const a = Math.min(minI, maxI), b = Math.max(minI, maxI);
        outX.push(xs[a]); outY.push(ys[a]);
        if (b !== a) { outX.push(xs[b]); outY.push(ys[b]); }
        minI = maxI = -1;
    };
    // Premier indice dans la fenêtre (recherche dichotomique), avec un point avant
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < x0) lo = mid + 1; else hi = mid; }
    const start = Math.max(0, lo - 1);
    for (let i = start; i < n; i++) {
        const x = xs[i], y = ys[i];
        const outside = x < x0 || x > x1;
        if (isGap(y)) { flush(); col = null; pushGap(x); if (x > x1) break; continue; }
        if (outside) {
            // Points avant et après la fenêtre : gardés tels quels (un de chaque côté)
            flush(); col = null;
            outX.push(x); outY.push(y);
            if (x > x1) break;
            continue;
        }
        const c = Math.min(cols - 1, Math.floor((x - x0) / width * cols));
        if (c !== col) { flush(); col = c; }
        if (minI < 0) { minI = maxI = i; continue; }
        if (y < ys[minI]) minI = i;
        if (y > ys[maxI]) maxI = i;
    }
    flush();
    return { xs: outX, ys: outY };
}

// Valeur interpolée à l'instant t (ts croissants) ; null hors du vol ou dans un trou
export function valueAt(ts, ys, t) {
    const n = ts.length;
    if (!n || t < ts[0] || t > ts[n - 1]) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) lo = mid; else hi = mid; }
    const a = ys[lo], b = ys[hi];
    const okA = typeof a === 'number' && Number.isFinite(a), okB = typeof b === 'number' && Number.isFinite(b);
    if (!okA || !okB) {
        // Bord d'un trou : valeur du point valide seulement s'il est le plus proche
        const nearA = t - ts[lo] <= ts[hi] - t;
        return okA && nearA ? a : okB && !nearA ? b : null;
    }
    const span = ts[hi] - ts[lo];
    return span > 0 ? a + (b - a) * (t - ts[lo]) / span : a;
}

// Valeur affichée : une décimale sous 10, entier au-delà (ou `digits` de la série)
function formatValue(v, digits) {
    if (v === null) return '—';
    const d = digits ?? (Math.abs(v) < 10 ? 1 : 0);
    return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export class TimeChart {
    // series : [{ key, label, unit, color, value?: (sample) => number|null, fill?, min?, max?, digits? }]
    // limits : [{ value, label }] (droites horizontales en pointillé rouge)
    constructor(canvas, { title = '', series = [], limits = [] } = {}) {
        this.canvas = canvas;
        this.title = title;
        this.series = series;
        this.limits = limits;
        this.bands = [];
        this.markers = [];
        this.cursor = null;
        this._ts = [];
        this._ys = series.map(() => []);
        this._seek = [];
        this._base = null;    // copie du dessin sans le curseur (curseur redessiné à moindre coût)
        this._layout = null;
        this._resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.draw()) : null;
        this._resize?.observe(canvas);

        // Clic ou glissé sur le tracé : instant choisi
        let dragging = false;
        const seek = (event) => {
            const t = this._timeAtClientX(event.clientX);
            if (t === null) return;
            this.setCursor(t);
            for (const callback of this._seek) callback(t);
        };
        this._onDown = (event) => {
            if (!this._ts.length) return;
            dragging = true;
            canvas.setPointerCapture?.(event.pointerId);
            seek(event);
            event.preventDefault();
        };
        this._onMove = (event) => { if (dragging) seek(event); };
        this._onUp = (event) => {
            dragging = false;
            canvas.releasePointerCapture?.(event.pointerId);
        };
        canvas.addEventListener?.('pointerdown', this._onDown);
        canvas.addEventListener?.('pointermove', this._onMove);
        canvas.addEventListener?.('pointerup', this._onUp);
        canvas.addEventListener?.('pointercancel', this._onUp);
        if (canvas.style) {
            canvas.style.touchAction = 'none';
            canvas.style.cursor = 'crosshair';
        }
    }

    // Vol enregistré { meta, samples, events } : abscisse = sample.t (s)
    setFlight(flight) {
        const samples = flight?.samples ?? [];
        this._ts = samples.map((s) => s.t);
        this._ys = this.series.map((serie) => samples.map((s) => {
            const v = serie.value ? serie.value(s) : s[serie.key];
            return typeof v === 'number' && Number.isFinite(v) ? v : null;
        }));
        this.cursor = null;
        this.draw();
    }

    // Écarts relevés : bandes verticales [{ t0, t1, color, label? }]
    setBands(bands = []) {
        this.bands = bands;
        this.draw();
    }

    // Repères verticaux [{ t, label, color }] (envol, toucher, crash)
    setMarkers(markers = []) {
        this.markers = markers;
        this.draw();
    }

    // Curseur de lecture (s) ; null l'efface. Redessine seulement le curseur, par-dessus la copie du tracé
    setCursor(t) {
        this.cursor = t === null || t === undefined ? null : t;
        if (!this._base || !this._layout) { this.draw(); return; }
        const ctx = this.canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.drawImage(this._base, 0, 0);
        this._drawCursor(ctx);
    }

    // callback(t) appelé au clic ou au glissé sur le tracé
    onSeek(callback) {
        this._seek.push(callback);
    }

    destroy() {
        this._resize?.disconnect();
        this._resize = null;
        const canvas = this.canvas;
        canvas.removeEventListener?.('pointerdown', this._onDown);
        canvas.removeEventListener?.('pointermove', this._onMove);
        canvas.removeEventListener?.('pointerup', this._onUp);
        canvas.removeEventListener?.('pointercancel', this._onUp);
        this._seek = [];
        this._base = null;
    }

    _timeAtClientX(clientX) {
        const l = this._layout;
        if (!l) return null;
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.max(l.left, Math.min(l.right, clientX - rect.left));
        return l.t0 + (x - l.left) / (l.right - l.left) * (l.t1 - l.t0);
    }

    draw() {
        const canvas = this.canvas;
        const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
        const cw = canvas.clientWidth, ch = canvas.clientHeight;
        if (!cw || !ch) return;
        const width = Math.round(cw * ratio), height = Math.round(ch * ratio);
        if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        const left = PAD.left, right = cw - PAD.right, top = PAD.top, bottom = ch - PAD.bottom;

        // Titre et légende
        ctx.font = font(11, 'bold');
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = TITLE_COLOR;
        ctx.fillText(this.title.toUpperCase(), left, 10);
        let lx = right;
        ctx.textAlign = 'right';
        ctx.font = font(11);
        for (const serie of [...this.series].reverse()) {
            const text = `${serie.label}${serie.unit ? ` (${serie.unit})` : ''}`;
            ctx.fillStyle = TICK_COLOR;
            ctx.fillText(text, lx, 10);
            lx -= ctx.measureText(text).width + 6;
            ctx.fillStyle = serie.color;
            ctx.fillRect(lx - 10, 8, 10, 4);
            lx -= 18;
        }

        const ts = this._ts;
        if (ts.length < 1 || right - left < 20 || bottom - top < 20) {
            ctx.fillStyle = TICK_COLOR;
            ctx.textAlign = 'center';
            ctx.fillText('Aucune donnée', (left + right) / 2, (top + bottom) / 2);
            this._layout = null;
            this._base = null;
            return;
        }

        // Échelles : temps du vol ; valeurs de toutes les séries, bornes imposées et limites comprises
        const t0 = ts[0], t1 = ts[ts.length - 1] > t0 ? ts[ts.length - 1] : t0 + 1;
        let lo = Infinity, hi = -Infinity;
        this.series.forEach((serie, i) => {
            const e = extent(this._ys[i]);
            if (e) { lo = Math.min(lo, e[0]); hi = Math.max(hi, e[1]); }
            if (Number.isFinite(serie.min)) lo = Math.min(lo, serie.min);
            if (Number.isFinite(serie.max)) hi = Math.max(hi, serie.max);
        });
        for (const limit of this.limits) { lo = Math.min(lo, limit.value); hi = Math.max(hi, limit.value); }
        if (!(lo <= hi)) { lo = 0; hi = 1; }
        if (lo === hi) { lo -= 1; hi += 1; }
        const margin = (hi - lo) * 0.06;
        // Marge seulement du côté où aucune borne n'est imposée
        if (!this.series.some((s) => Number.isFinite(s.min) && s.min === lo)) lo -= margin;
        if (!this.series.some((s) => Number.isFinite(s.max) && s.max === hi)) hi += margin;
        const px = (t) => left + (t - t0) / (t1 - t0) * (right - left);
        const py = (v) => bottom - (v - lo) / (hi - lo) * (bottom - top);
        this._layout = { left, right, top, bottom, t0, t1, lo, hi, px, py, ratio };

        // Bandes des écarts (sous le quadrillage)
        for (const band of this.bands) {
            const a = Math.max(left, px(band.t0)), b = Math.min(right, px(Math.max(band.t1, band.t0)));
            if (b < left || a > right) continue;
            ctx.fillStyle = band.color ?? 'rgba(232, 68, 58, 0.18)';
            ctx.fillRect(a, top, Math.max(2, b - a), bottom - top);
            if (band.label) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(a, top, Math.max(2, b - a), bottom - top);
                ctx.clip();
                ctx.font = font(10, 'bold');
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(band.label, a + 3, top + 3);
                ctx.restore();
            }
        }

        // Quadrillage, graduations
        ctx.lineWidth = 1;
        ctx.font = font(11);
        ctx.fillStyle = TICK_COLOR;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const yTicks = niceTicks(lo, hi, Math.max(2, Math.round((bottom - top) / 34)));
        const yMinor = yTicks.length > 1 ? (yTicks[1] - yTicks[0]) / 2 : 0;
        for (const v of yTicks) {
            ctx.strokeStyle = GRID_MAJOR;
            ctx.beginPath();
            ctx.moveTo(left, Math.round(py(v)) + 0.5);
            ctx.lineTo(right, Math.round(py(v)) + 0.5);
            ctx.stroke();
            ctx.fillText(formatValue(v, Math.abs(yMinor * 2) < 1 ? 1 : 0), left - 6, py(v));
            if (yMinor && v + yMinor < hi) {
                ctx.strokeStyle = GRID_MINOR;
                ctx.beginPath();
                ctx.moveTo(left, Math.round(py(v + yMinor)) + 0.5);
                ctx.lineTo(right, Math.round(py(v + yMinor)) + 0.5);
                ctx.stroke();
            }
        }
        // Temps : pas ronds en secondes ou minutes
        const tStep = timeStep((t1 - t0) / Math.max(2, Math.floor((right - left) / 80)));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1 + 1e-9; t += tStep) {
            ctx.strokeStyle = GRID_MAJOR;
            ctx.beginPath();
            ctx.moveTo(Math.round(px(t)) + 0.5, top);
            ctx.lineTo(Math.round(px(t)) + 0.5, bottom);
            ctx.stroke();
            ctx.fillText(formatTime(t), px(t), bottom + 5);
        }
        // Unité de l'axe vertical
        const unit = this.series[0]?.unit;
        if (unit) {
            ctx.save();
            ctx.translate(11, (top + bottom) / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textBaseline = 'middle';
            ctx.fillStyle = TITLE_COLOR;
            ctx.font = font(10, 'bold');
            ctx.fillText(unit, 0, 0);
            ctx.restore();
        }
        // Zéro marqué quand l'axe le traverse (vario, inclinaison)
        if (lo < 0 && hi > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.beginPath();
            ctx.moveTo(left, Math.round(py(0)) + 0.5);
            ctx.lineTo(right, Math.round(py(0)) + 0.5);
            ctx.stroke();
        }

        // Courbes : remplies d'abord, puis les traits
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top - 1, right - left, bottom - top + 2);
        ctx.clip();
        const columns = Math.max(1, Math.round((right - left) * ratio));
        const order = this.series.map((serie, i) => i).sort((a, b) => Number(!this.series[b].fill) - Number(!this.series[a].fill));
        for (const i of order) {
            const serie = this.series[i];
            const d = decimate(ts, this._ys[i], t0, t1, columns);
            if (serie.fill) {
                // Polygones jusqu'au bas du tracé, coupés aux trous
                ctx.fillStyle = withAlpha(serie.color, 0.35);
                let open = false, firstX = 0, lastX = 0;
                ctx.beginPath();
                for (let k = 0; k <= d.xs.length; k++) {
                    const y = k < d.xs.length ? d.ys[k] : null;
                    if (y === null) {
                        if (open) { ctx.lineTo(lastX, bottom); ctx.lineTo(firstX, bottom); ctx.closePath(); open = false; }
                        continue;
                    }
                    const x = px(d.xs[k]);
                    if (!open) { ctx.moveTo(x, bottom); ctx.lineTo(x, py(y)); firstX = x; open = true; }
                    else ctx.lineTo(x, py(y));
                    lastX = x;
                }
                ctx.fill();
            }
            ctx.strokeStyle = serie.color;
            ctx.lineWidth = serie.fill ? 1 : 1.6;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            let pen = false;
            for (let k = 0; k < d.xs.length; k++) {
                if (d.ys[k] === null) { pen = false; continue; }
                const x = px(d.xs[k]), y = py(d.ys[k]);
                if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                pen = true;
            }
            ctx.stroke();
        }
        ctx.restore();

        // Limites : pointillé rouge et libellé
        ctx.font = font(10, 'bold');
        for (const limit of this.limits) {
            const y = py(limit.value);
            ctx.strokeStyle = LIMIT_COLOR;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
            ctx.setLineDash([]);
            if (limit.label) {
                ctx.fillStyle = LIMIT_TEXT;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                ctx.fillText(limit.label, right - 4, y - 2);
            }
        }

        // Repères : envol, toucher, crash
        for (const marker of this.markers) {
            if (marker.t < t0 || marker.t > t1) continue;
            const x = Math.round(px(marker.t)) + 0.5;
            ctx.strokeStyle = marker.color ?? '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            if (marker.label) {
                ctx.fillStyle = marker.color ?? '#ffffff';
                ctx.font = font(10, 'bold');
                ctx.textBaseline = 'bottom';
                ctx.textAlign = x > right - 60 ? 'right' : 'left';
                ctx.fillText(marker.label, x + (x > right - 60 ? -3 : 3), bottom - 2);
            }
        }

        // Cadre
        ctx.strokeStyle = GRID_MAJOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);

        // Copie du tracé pour le curseur (sans DOM sous Node : pas de copie, redessin complet)
        if (typeof document !== 'undefined') {
            this._base ??= document.createElement('canvas');
            if (this._base.width !== width || this._base.height !== height) Object.assign(this._base, { width, height });
            const base = this._base.getContext('2d');
            base.clearRect(0, 0, width, height);
            base.drawImage(canvas, 0, 0);
        }
        this._drawCursor(ctx);
    }

    // Trait vertical à l'instant du curseur et valeurs lues à cet instant
    _drawCursor(ctx) {
        const l = this._layout;
        if (!l || this.cursor === null) return;
        const t = Math.max(l.t0, Math.min(l.t1, this.cursor));
        ctx.setTransform(l.ratio, 0, 0, l.ratio, 0, 0);
        const x = Math.round(l.px(t)) + 0.5;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, l.top);
        ctx.lineTo(x, l.bottom);
        ctx.stroke();

        const lines = [{ text: formatTime(t), color: '#ffffff' }];
        this.series.forEach((serie, i) => {
            const v = valueAt(this._ts, this._ys[i], t);
            lines.push({ text: `${serie.label} ${formatValue(v, serie.digits)}${serie.unit ? ` ${serie.unit}` : ''}`, color: serie.color });
            if (v === null) return;
            ctx.fillStyle = serie.color;
            ctx.beginPath();
            ctx.arc(x, l.py(v), 3, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.font = font(11, 'bold');
        const boxW = Math.max(...lines.map((line) => ctx.measureText(line.text).width)) + 12;
        const boxH = lines.length * 14 + 6;
        const bx = x + 8 + boxW > l.right ? x - 8 - boxW : x + 8;
        const by = l.top + 4;
        ctx.fillStyle = 'rgba(10, 22, 38, 0.88)';
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => {
            ctx.fillStyle = line.color;
            ctx.fillText(line.text, bx + 6, by + 4 + i * 14);
        });
    }
}

// Pas de temps rond (s) au moins égal à `raw` : 1, 2, 5, 10, 15, 30 s, 1, 2, 5, 10, 15, 30 min, 1 h…
function timeStep(raw) {
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    return steps.find((s) => s >= raw) ?? Math.ceil(raw / 3600) * 3600;
}

// Couleur CSS « #rrggbb » rendue translucide (les autres formes sont gardées telles quelles)
function withAlpha(color, alpha) {
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
