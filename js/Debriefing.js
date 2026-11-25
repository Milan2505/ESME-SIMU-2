// Fenêtre « Mes vols » et débriefing (lot 5) : <dialog id="debriefing-dialog"> à deux volets.
// - Mes vols : les 20 derniers vols du carnet (FlightStore.js) : date, appareil, aérodrome, leçon, durée, altitude maximale,
//   crash ; Débriefing, Rejouer, Exporter CSV, Supprimer ; Importer un CSV exporté (FlightRecorder.js, fromCsv).
// - Débriefing d'un vol : en-tête, trajectoire sur la carte (MapView : fitTrack, drawTrack), profil vertical et courbes
//   (Charts.js : TimeChart), écarts relevés automatiquement (FlightReview.js, fourni par l'appelant). Un curseur de temps
//   commun : clic sur une courbe, sur la carte ou sur un écart ; « Rejouer depuis ce point » rend la main à l'appelant
//   (onReplay) avec ce temps (la fenêtre se ferme pendant le rejeu ; « Débriefing » depuis le rejeu la rouvre à l'instant
//   rejoué).
// Événements (EventTarget) : 'open', 'close', 'replay' (detail { flight, id, t }), 'saved' (detail { id } : vol importé).
import { TimeChart } from './Charts.js';
import { toCsv, fromCsv, sampleAt } from './FlightRecorder.js';
import { THRESHOLDS, finalSegments } from './FlightReview.js';

const AIRCRAFT_LABELS = { c172: 'Cessna 172P', f15: 'F-15C Eagle', r44: 'Robinson R44' };
const MAP_LABELS = { campagne: 'Campagne', ville: 'Ville', mer: 'Mer' };
const SEVERITY = {
    info: { color: '#8fd3ff', label: 'Info', band: 'rgba(143, 211, 255, 0.16)' },
    warn: { color: '#ffb070', label: 'Écart', band: 'rgba(255, 176, 112, 0.2)' },
    severe: { color: '#ff5a4a', label: 'Grave', band: 'rgba(255, 90, 74, 0.22)' },
};
const FT = 3.28084;   // pieds par mètre
const MS_TO_FPM = FT * 60;   // m/s -> ft/min

// Courbes du débriefing : canvas de index.html -> réglages de TimeChart ; kinds : écarts (FlightReview) montrés en bandes
const CHARTS = [
    {
        id: 'debrief-profil', title: 'Profil vertical', kinds: /^(ils-gs|touchdown-aim|crash)$/,
        series: [
            { key: 'altitude', label: 'Altitude', unit: 'ft', color: '#8fd3ff', value: (s) => trueAltitude(s) },
            { key: 'sol', label: 'Sol', unit: 'ft', color: '#7a9a5a', fill: true, value: (s) => groundAltitude(s) },
        ],
    },
    {
        id: 'debrief-ias', title: 'Vitesse indiquée', kinds: /^(approach-speed|vfe|vne|stall)$/,
        series: [ { key: 'ias', label: 'IAS', unit: 'kt', color: '#ffd166', min: 0 } ],
    },
    {
        id: 'debrief-alt', title: 'Altitude', kinds: /^(ils-gs)$/,
        series: [
            { key: 'alt', label: 'Altimètre', unit: 'ft', color: '#8fd3ff' },
            { key: 'agl', label: 'Hauteur sol', unit: 'ft', color: '#9be07a', min: 0 },
        ],
    },
    {
        id: 'debrief-vario', title: 'Vitesse verticale', kinds: /^(approach-sink|touchdown-vs|throttle-touchdown)$/,
        series: [ { key: 'vs', label: 'Vario', unit: 'ft/min', color: '#c39bff' } ],
        limits: [ { value: 0, label: '0' } ],
    },
    {
        id: 'debrief-inclinaison', title: 'Inclinaison', kinds: /^(bank-low)$/,
        series: [ { key: 'bank', label: 'Inclinaison (+ droite)', unit: '°', color: '#ff9f6b' } ],
        limits: [ { value: 30, label: '30°' }, { value: -30, label: '−30°' } ],
    },
    {
        id: 'debrief-incidence', title: 'Incidence', kinds: /^(stall|load)$/,
        series: [ { key: 'alpha', label: 'Incidence', unit: '°', color: '#6be0c8' } ],
    },
];

// Cessna : finales repérées par la géométrie (aligné sur l'axe, en descente vers le seuil : finalSegments, les mêmes que
// FlightReview.js ; sans pistes, pas de finale) et vitesse visée (65 kt volets ≥ 25°, 70 kt sinon), avec la tolérance
// +10 / -5 kt : THRESHOLDS.approach, sources dans FlightReview.js
export function approachGuide(flight, runways = []) {
    if ((flight?.meta?.aircraft ?? 'c172') !== 'c172') return { bands: [], limits: [] };
    const A = THRESHOLDS.approach;
    const samples = flight.samples ?? [];
    const finals = finalSegments(samples, runways);
    if (!finals.length) return { bands: [], limits: [] };
    const targets = new Set();
    for (const ep of finals) {
        const mid = samples[(ep.i0 + ep.i1) >> 1];
        targets.add(Number.isFinite(mid?.flaps) && mid.flaps >= A.fullFlapsDeg ? A.targetFullFlaps : A.targetOther);
    }
    const limits = [];
    for (const target of targets) {
        // Une seule étiquette (les trois lignes sont serrées) : la cible ; la tolérance sans texte
        limits.push({ value: target, label: `Cible ${target} kt (+${A.above} / −${A.below})` });
        limits.push({ value: target + A.above, label: '' }, { value: target - A.below, label: '' });
    }
    return { bands: finals.map((ep) => ({ t0: ep.t0, t1: ep.t1, color: 'rgba(143, 211, 255, 0.13)', label: 'Finale' })), limits };
}

// Altitude vraie (ft) : hauteur du repère du jeu ; sinon l'altimètre
function trueAltitude(s) {
    return Number.isFinite(s.y) ? s.y * FT : s.alt;
}
function groundAltitude(s) {
    const alt = trueAltitude(s);
    return Number.isFinite(alt) && Number.isFinite(s.agl) ? alt - s.agl : null;
}

// Temps de vol : m:ss (h:mm:ss au-delà d'une heure), secondes tronquées comme les courbes (Charts.js) et le rejeu
export function formatTime(t) {
    const total = Math.max(0, Math.floor(t ?? 0));
    const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Date de début du vol en clair (heure locale)
export function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Nom du fichier exporté : esme-vol-AAAA-MM-JJ-HHMM.csv (heure locale du début du vol)
export function exportName(flight) {
    let d = new Date(flight?.meta?.started);
    if (Number.isNaN(d.getTime())) d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `esme-vol-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
}

// Météo du vol en une ligne (texte, ou objet { name | label | preset, metar, wind… })
function weatherText(weather) {
    if (!weather) return '';
    if (typeof weather === 'string') {
        try { return weatherText(JSON.parse(weather)); } catch { return weather; }
    }
    if (typeof weather !== 'object') return String(weather);
    const parts = [ weather.label ?? weather.name ?? weather.preset ];
    if (weather.metar) parts.push(weather.metar);
    return parts.filter(Boolean).join(' · ');
}

const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) if (child !== null && child !== undefined) node.append(child);
    return node;
};

export class Debriefing extends EventTarget {
    // dialog : <dialog id="debriefing-dialog"> ; store : FlightStore ; createMap(canvas) : MapView du débriefing (relief
    // partagé avec la carte du jeu : shareRelief) ; review(flight) : écarts (FlightReview.js) ; onReplay(flight, id, t)
    // canReplay(flight) : null si le rejeu 3D est possible, sinon la raison (affichée dans la fenêtre) ; runways(flight) :
    // pistes où repérer les finales (celles de la carte du vol, [] sinon : pas de bande « Finale »)
    constructor(dialog, { store, createMap, review = () => [], onReplay = () => {}, canReplay = () => null, runways = () => [] }) {
        super();
        this.dialog = dialog;
        this.store = store;
        this.createMap = createMap;
        this.review = review;
        this.runways = runways;
        this.onReplay = onReplay;
        this.canReplay = canReplay;
        this.flight = null;      // vol montré au débriefing
        this.flightId = null;    // son identifiant dans le carnet (null : vol non enregistré)
        this.cursorT = 0;
        this.issues = [];
        this.charts = [];
        this.map = null;
        this._mapMarkers = [];
        this._frame = 0;

        const $ = (id) => dialog.querySelector(`#${id}`);
        this.listPane = $('debrief-volet-liste');
        this.flightPane = $('debrief-volet-vol');
        this.listNode = $('debrief-liste');
        this.headerNode = $('debrief-entete');
        this.issuesNode = $('debrief-ecarts');
        this.timeNode = $('debrief-curseur-temps');
        this.mapCanvas = $('debrief-carte');
        this.messageNode = $('debrief-message');

        dialog.addEventListener('close', () => this._cleanup());
        for (const id of [ 'debrief-fermer', 'debrief-fermer-vol' ]) $(id).addEventListener('click', () => this.close());
        $('debrief-retour').addEventListener('click', () => this.openList());
        $('debrief-exporter').addEventListener('click', () => this.flight && this._export(this.flight));
        $('debrief-rejouer').addEventListener('click', () => this._replay(this.flight, this.flightId, this.cursorT));
        const file = $('debrief-fichier');
        $('debrief-importer').addEventListener('click', () => file.click());
        file.addEventListener('change', async () => {
            const chosen = file.files?.[0];
            file.value = '';
            if (chosen) await this.importText(await chosen.text());
        });
        // Carte : zoom, clic -> point de la trajectoire le plus proche
        // Zoom : quitte le cadrage sur toute la trajectoire, carte centrée sur l'avion au curseur ; ⤢ : tout le vol
        const zoom = (step) => { this.map?.clearFit?.(); this.map?.zoomBy(step); this._drawMap(); };
        $('debrief-zoom-plus').addEventListener('click', () => zoom(1));
        $('debrief-zoom-moins').addEventListener('click', () => zoom(-1));
        $('debrief-zoom-tout').addEventListener('click', () => { if (this.flight) this.map?.fitTrack?.(this.flight.samples); this._drawMap(); });
        this.mapCanvas.addEventListener('click', (event) => this._seekOnMap(event));
        this._resize = new ResizeObserver(() => { if (this.dialog.open && this.flight) this._scheduleDraw(); });
        this._resize.observe(this.flightPane);
    }

    get isOpen() { return this.dialog.open; }

    _show(pane) {
        this.listPane.hidden = pane !== 'liste';
        this.flightPane.hidden = pane !== 'vol';
        this.dialog.dataset.volet = pane;
        if (!this.dialog.open) {
            this.dialog.showModal();
            this.dispatchEvent(new Event('open'));
        }
    }

    close() {
        if (this.dialog.open) this.dialog.close();
    }

    _cleanup() {
        cancelAnimationFrame(this._frame);
        for (const chart of this.charts) chart.destroy?.();
        this.charts = [];
        this.flight = null;
        this.flightId = null;
        this.dispatchEvent(new Event('close'));
    }

    _say(text, error = false) {
        this.messageNode.textContent = text;
        this.messageNode.classList.toggle('erreur', error);
    }

    // --- Volet « Mes vols » ---
    async openList(message = '') {
        for (const chart of this.charts) chart.destroy?.();
        this.charts = [];
        this.flight = null;
        this.flightId = null;
        this._show('liste');
        this._say(message);
        let flights;
        try { flights = await this.store.list(); }
        catch (error) { flights = []; this._say(error.message, true); }
        this._renderList(flights);
    }

    _renderList(flights) {
        const list = this.listNode;
        list.replaceChildren();
        if (!flights.length) {
            list.append(el('p', { className: 'debrief-vide', textContent: 'Aucun vol enregistré. Chaque vol de plus de quelques secondes est gardé ici (les 20 derniers), sur cet appareil seulement.' }));
            return;
        }
        const table = el('table', { className: 'debrief-table' });
        table.append(el('thead', {}, el('tr', {}, ...[ 'Date', 'Appareil', 'Aérodrome', 'Leçon', 'Durée', 'Alt. max', '' ].map((text) => el('th', { textContent: text })))));
        const body = el('tbody');
        for (const f of flights) {
            const status = el('span', { className: 'debrief-etats' });
            if (f.crashed) status.append(el('span', { className: 'debrief-badge crash', textContent: 'Crash' }));
            if (f.imported) status.append(el('span', { className: 'debrief-badge', textContent: 'Importé' }));
            const action = (text, title, handler, extra = '') => {
                const button = el('button', { type: 'button', textContent: text, title, className: extra });
                button.addEventListener('click', handler);
                return button;
            };
            const remove = action('Supprimer', 'Supprimer ce vol du carnet', async () => {
                // Deux appuis : le premier demande confirmation (pas de fenêtre bloquante)
                if (!remove.classList.contains('confirmer')) {
                    remove.classList.add('confirmer');
                    remove.textContent = 'Confirmer ?';
                    setTimeout(() => { remove.classList.remove('confirmer'); remove.textContent = 'Supprimer'; }, 3000);
                    return;
                }
                await this.store.remove(f.id);
                await this.openList('Vol supprimé.');
            }, 'debrief-secondaire debrief-danger');
            const row = el('tr', { className: f.crashed ? 'crash' : '' },
                el('td', {}, formatDate(f.started), status),
                el('td', { textContent: AIRCRAFT_LABELS[f.aircraft] ?? f.aircraft ?? '—' }),
                el('td', { textContent: f.airport || '—' }),
                el('td', { textContent: f.lesson || '—' }),
                el('td', { textContent: formatTime(f.duration) }),
                el('td', { textContent: `${Math.round(f.maxAlt ?? 0).toLocaleString('fr-FR')} ft` }),
                el('td', { className: 'debrief-actions' },
                    action('Débriefing', 'Courbes, trajectoire et écarts relevés', () => this.openFlight(f.id)),
                    action('Rejouer', 'Revoir le vol en 3D', async () => {
                        const flight = await this._load(f.id);
                        if (flight) this._replay(flight, f.id, 0);
                    }, 'debrief-secondaire'),
                    action('CSV', 'Exporter ce vol (CSV : tableur, autre ordinateur)', async () => {
                        const flight = await this._load(f.id);
                        if (flight) this._export(flight);
                    }, 'debrief-secondaire'),
                    remove));
            row.dataset.id = f.id;
            body.append(row);
        }
        table.append(body);
        list.append(table);
    }

    async _load(id) {
        try {
            const flight = await this.store.load(id);
            if (!flight) throw new Error('Vol introuvable dans le carnet.');
            return flight;
        } catch (error) {
            this._say(error.message, true);
            return null;
        }
    }

    // Fichier CSV exporté -> carnet ; rend l'identifiant (null si le fichier n'est pas un vol)
    async importText(text) {
        let flight;
        try { flight = fromCsv(text); }
        catch (error) {
            if (!this.flightPane.hidden || !this.dialog.open) await this.openList();
            this._say(`Import impossible : ${error.message}`, true);
            return null;
        }
        flight.meta.imported = true;
        const id = await this.store.save(flight);
        this.dispatchEvent(new CustomEvent('saved', { detail: { id } }));
        await this.openList(`Vol importé (${AIRCRAFT_LABELS[flight.meta.aircraft] ?? 'appareil inconnu'}, ${formatTime(flight.meta.duration)}).`);
        return id;
    }

    _export(flight) {
        const name = exportName(flight);
        const blob = new Blob([ toCsv(flight) ], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        this._say(`Vol exporté (${name}).`);
    }

    _replay(flight, id, t = 0) {
        if (!flight) return;
        // Rejeu impossible ici (vol d'une autre carte) : la fenêtre reste ouverte, avec l'explication
        const refusal = this.canReplay?.(flight);
        if (refusal) { this._say(refusal); return; }
        this.close();
        this.dispatchEvent(new CustomEvent('replay', { detail: { flight, id, t } }));
        this.onReplay(flight, id, t);
    }

    // --- Volet « Débriefing » ---
    // idOrFlight : identifiant du carnet, ou le vol lui-même (fin de vol, rejeu en cours)
    async openFlight(idOrFlight, { t = 0, id = null } = {}) {
        const flight = typeof idOrFlight === 'object' && idOrFlight ? idOrFlight : await this._load(idOrFlight);
        if (!flight) { if (!this.dialog.open) await this.openList(); return; }
        for (const chart of this.charts) chart.destroy?.();
        this.charts = [];
        this.flight = flight;
        this.flightId = typeof idOrFlight === 'object' ? id : idOrFlight;
        this._show('vol');
        this._say('');
        try { this.issues = (this.review(flight) ?? []).slice().sort((a, b) => a.t - b.t); }
        catch (error) { this.issues = []; this._say(`Relevé des écarts impossible : ${error.message}`, true); }

        this._renderHeader(flight);
        this._renderIssues();
        this._buildCharts(flight);
        this._buildMap(flight);
        this.cursorT = t;
        this.setCursor(t);
    }

    _renderHeader(flight) {
        const { meta, samples, events } = flight;
        const maxAlt = samples.reduce((m, s) => Math.max(m, s.alt ?? -Infinity), -Infinity);
        const maxIas = samples.reduce((m, s) => Math.max(m, s.ias ?? -Infinity), -Infinity);
        const touchdowns = events.filter((e) => e.kind === 'touchdown');
        const crash = events.find((e) => e.kind === 'crash');
        const facts = [
            [ 'Appareil', AIRCRAFT_LABELS[meta.aircraft] ?? meta.aircraft ?? '—' ],
            [ 'Date', formatDate(meta.started) ],
            [ 'Durée', formatTime(meta.duration ?? samples[samples.length - 1]?.t) ],
            [ 'Aérodrome', [ meta.airport, MAP_LABELS[meta.map] ].filter(Boolean).join(' · ') || '—' ],
            [ 'Leçon', meta.lesson || '—' ],
            [ 'Météo', weatherText(meta.weather) || '—' ],
            [ 'Altitude max', Number.isFinite(maxAlt) ? `${Math.round(maxAlt).toLocaleString('fr-FR')} ft` : '—' ],
            [ 'Vitesse max', Number.isFinite(maxIas) ? `${Math.round(maxIas)} kt` : '—' ],
        ];
        if (touchdowns.length) {
            const last = touchdowns[touchdowns.length - 1];
            facts.push([ touchdowns.length > 1 ? `Toucher (${touchdowns.length})` : 'Toucher',
                Number.isFinite(last.impact) ? `${Math.round(last.impact * MS_TO_FPM)} ft/min` : formatTime(last.t) ]);
        }
        if (crash) facts.push([ 'Crash', crash.text || formatTime(crash.t) ]);
        if (meta.imported) facts.push([ 'Origine', 'importé (CSV)' ]);
        this.headerNode.replaceChildren(...facts.map(([ label, value ]) =>
            el('div', { className: label === 'Crash' ? 'crash' : '' }, el('dt', { textContent: label }), el('dd', { textContent: value }))));
    }

    _renderIssues() {
        const node = this.issuesNode;
        node.replaceChildren();
        if (!this.issues.length) {
            node.append(el('p', { className: 'debrief-vide', textContent: 'Aucun écart relevé.' }));
            return;
        }
        this.issues.forEach((issue, index) => {
            const sev = SEVERITY[issue.severity] ?? SEVERITY.info;
            const button = el('button', { type: 'button', className: `debrief-ecart ${issue.severity ?? 'info'}` },
                el('span', { className: 'debrief-ecart-temps', textContent: formatTime(issue.t) }),
                el('span', { className: 'debrief-ecart-niveau', textContent: sev.label }),
                el('span', { className: 'debrief-ecart-texte', textContent: issue.message ?? issue.kind }));
            button.style.setProperty('--couleur', sev.color);
            button.dataset.index = index;
            button.addEventListener('click', () => {
                this.setCursor(issue.t ?? issue.t0 ?? 0);
                for (const other of node.querySelectorAll('.debrief-ecart')) other.classList.toggle('actif', other === button);
            });
            node.append(button);
        });
    }

    _buildCharts(flight) {
        const events = flight.events ?? [];
        const markers = [];
        for (const e of events) {
            if (e.kind === 'liftoff') markers.push({ t: e.t, label: 'Envol', color: '#9be07a' });
            else if (e.kind === 'touchdown') markers.push({ t: e.t, label: 'Toucher', color: '#ffd166' });
            else if (e.kind === 'crash') markers.push({ t: e.t, label: 'Crash', color: '#ff5a4a' });
        }
        let runways;
        try { runways = this.runways(flight) ?? []; } catch { runways = []; }
        const approach = approachGuide(flight, runways);
        for (const spec of CHARTS) {
            const canvas = this.dialog.querySelector(`#${spec.id}`);
            if (!canvas) continue;
            const limits = [ ...(spec.limits ?? []) ];
            const bands = [];
            // Vitesse : cible d'approche et tolérance (lignes), finales (bandes)
            if (spec.id === 'debrief-ias') { limits.push(...approach.limits); bands.push(...approach.bands); }
            for (const issue of this.issues) {
                if (!spec.kinds.test(issue.kind ?? '')) continue;
                const t0 = issue.t0 ?? issue.t, t1 = issue.t1 ?? issue.t;
                if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
                const sev = SEVERITY[issue.severity] ?? SEVERITY.info;
                bands.push({ t0, t1: Math.max(t1, t0 + 0.5), color: sev.band, label: '' });   // (couleur seule : textes serrés)
            }
            const chart = new TimeChart(canvas, { title: spec.title, series: spec.series, limits });
            chart.setFlight(flight);
            chart.setBands(bands);
            chart.setMarkers(markers);
            chart.onSeek((t) => this.setCursor(t));
            chart.draw();
            this.charts.push(chart);
        }
    }

    _buildMap(flight) {
        if (!this.createMap) return;
        this.map ??= this.createMap(this.mapCanvas);
        const markers = [];
        const at = (t) => sampleAt(flight, t);
        for (const e of flight.events ?? []) {
            const s = e.kind === 'touchdown' && Number.isFinite(e.x) ? e : at(e.t);
            if (!s) continue;
            if (e.kind === 'liftoff') markers.push({ x: s.x, z: s.z, label: 'Envol', color: '#9be07a' });
            else if (e.kind === 'touchdown') markers.push({ x: s.x, z: s.z, label: 'Toucher', color: '#ffd166' });
            else if (e.kind === 'crash') markers.push({ x: s.x, z: s.z, label: 'Crash', color: '#ff5a4a' });
        }
        for (const issue of this.issues) {
            if (issue.severity === 'info') continue;
            const s = at(issue.t ?? issue.t0 ?? 0);
            if (s) markers.push({ x: s.x, z: s.z, label: '!', color: (SEVERITY[issue.severity] ?? SEVERITY.warn).color });
        }
        this._mapMarkers = markers;
        this.map?.fitTrack?.(flight.samples);
    }

    // Curseur commun (s depuis le début du vol) : courbes, carte, temps affiché
    setCursor(t) {
        if (!this.flight) return;
        const end = this.flight.samples[this.flight.samples.length - 1]?.t ?? 0;
        this.cursorT = Math.max(0, Math.min(end, t ?? 0));
        for (const chart of this.charts) chart.setCursor(this.cursorT);
        const s = sampleAt(this.flight, this.cursorT);
        if (this.timeNode) {
            this.timeNode.textContent = s
                ? `${formatTime(this.cursorT)} · ${Math.round(s.ias ?? 0)} kt · ${Math.round(s.alt ?? 0).toLocaleString('fr-FR')} ft · ${s.vs >= 0 ? '+' : ''}${Math.round(s.vs ?? 0)} ft/min`
                : formatTime(this.cursorT);
        }
        this._scheduleDraw();
    }

    // Carte : un seul dessin par image, même si le curseur bouge plusieurs fois (glisser sur une courbe, rejeu) ; les
    // courbes redessinent seulement leur curseur (TimeChart.setCursor) et se redimensionnent seules
    _scheduleDraw() {
        cancelAnimationFrame(this._frame);
        this._frame = requestAnimationFrame(() => this._drawMap());
    }

    _drawMap() {
        const map = this.map, flight = this.flight;
        if (!map || !flight) return;
        const s = sampleAt(flight, this.cursorT);
        if (!s) return;
        // (avion masqué ici : drawTrack le dessine à l'instant du curseur ; la position sert au zoom sans cadrage)
        map.draw({ position: { x: s.x, y: s.y, z: s.z }, heading: s.hdg ?? 0, hidden: true }, []);
        map.drawTrack?.(flight.samples, { cursorT: this.cursorT, markers: this._mapMarkers });
    }

    // Clic sur la carte : curseur au point de la trajectoire le plus proche (map.project : monde -> pixels du canvas)
    _seekOnMap(event) {
        const map = this.map, flight = this.flight;
        if (!map?.project || !flight) return;
        const rect = this.mapCanvas.getBoundingClientRect();
        const kx = this.mapCanvas.width / rect.width, ky = this.mapCanvas.height / rect.height;
        const px = (event.clientX - rect.left) * kx, py = (event.clientY - rect.top) * ky;
        let best = null, bestD = Infinity;
        for (const s of flight.samples) {
            const [x, y] = map.project(s.x, s.z);
            const d = (x - px) ** 2 + (y - py) ** 2;
            if (d < bestD) { bestD = d; best = s; }
        }
        if (best && bestD < (30 * kx) ** 2) this.setCursor(best.t);
    }
}
