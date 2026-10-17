// Masse et centrage du Cessna 172S (valeurs du manuel de vol, converties en kg et en mètres en arrière de la référence,
// la cloison pare-feu) : chargement (pilote, passagers, bagages, carburant gauche / droite), calcul de la masse et du
// centrage, graphique du domaine de centrage (catégories normale et utilitaire) mis à jour en direct.
// Le chargement choisi est appliqué à l'avion à la fermeture de la fenêtre (voir simulator.js).

const LB = 0.45359237;          // lb -> kg
const IN = 0.0254;              // pouce -> m
const GALLON = 3.785;           // L
const FUEL_DENSITY = 0.72;      // kg/L (AVGAS 100LL)

const EMPTY = { mass: 755, arm: 0.98 };         // avion vide équipé (masse de base, bras)
const ARMS = {
    pilot: 37 * IN,             // sièges avant (position moyenne)
    copilot: 37 * IN,
    rear: 73 * IN,              // banquette arrière
    baggage: 95 * IN,           // soute A
    fuel: 48 * IN,              // réservoirs d'aile
};
const LIMITS = {
    maxTakeoff: 2550 * LB,      // masse maximale au décollage (normale)
    maxUtility: 2200 * LB,      // utilitaire
    maxBaggage: 120 * LB,
    tankLitres: 26.5 * GALLON,  // carburant utilisable par aile
};
// Domaine de centrage (centrage en m, masse en kg)
const NORMAL = [[35 * IN, 1500 * LB], [35 * IN, 1950 * LB], [41 * IN, 2550 * LB], [47.3 * IN, 2550 * LB], [47.3 * IN, 1500 * LB]];
const UTILITY = [[35 * IN, 1500 * LB], [35 * IN, 1950 * LB], [37.5 * IN, 2200 * LB], [40.5 * IN, 2200 * LB], [40.5 * IN, 1500 * LB]];
const BURN = 32;                // L/h en croisière (≈ 8,5 gal/h)
const FUEL_MIN = 0.12;          // fraction gardée en réserve pour le point « atterrissage » (45 min)

const DEFAULT_LOAD = { pilot: 80, copilot: 0, rear: 0, baggage: 10, fuelLeft: 76, fuelRight: 76, sync: true };
const STORAGE_KEY = 'masse-centrage';

function inside(polygon, x, y) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
}

// Masse (kg), moment (kg·m) et centrage (m) d'un chargement ; fuelFactor : part du carburant comptée
function compute(load, fuelFactor = 1) {
    const fuelKg = (load.fuelLeft + load.fuelRight) * FUEL_DENSITY * fuelFactor;
    const items = [
        [EMPTY.mass, EMPTY.arm], [load.pilot, ARMS.pilot], [load.copilot, ARMS.copilot],
        [load.rear, ARMS.rear], [load.baggage, ARMS.baggage], [fuelKg, ARMS.fuel],
    ];
    const mass = items.reduce((sum, [m]) => sum + m, 0);
    const moment = items.reduce((sum, [m, arm]) => sum + m * arm, 0);
    return { mass, moment, cg: moment / mass, fuelKg };
}

function check(load) {
    const takeoff = compute(load), landing = compute(load, FUEL_MIN);
    const problems = [];
    if (takeoff.mass > LIMITS.maxTakeoff + 0.05) problems.push(`Masse maximale dépassée de ${Math.round(takeoff.mass - LIMITS.maxTakeoff)} kg`);
    if (load.baggage > LIMITS.maxBaggage + 0.05) problems.push(`Bagages : ${Math.round(LIMITS.maxBaggage)} kg au plus`);
    for (const [name, point] of [['au décollage', takeoff], ['à l\'atterrissage', landing]]) {
        if (point.mass <= LIMITS.maxTakeoff + 0.05 && !inside(NORMAL, point.cg, Math.max(point.mass, 1500 * LB + 0.1))) {
            problems.push(`Centrage hors limites ${name} (${point.cg.toFixed(3)} m)`);
        }
    }
    const utility = [takeoff, landing].every((p) => inside(UTILITY, p.cg, Math.max(p.mass, 1500 * LB + 0.1)));
    return { takeoff, landing, problems, utility };
}

class WeightBalance {
    // dialog : la fenêtre ; onApply(load, result) : appelé à la fermeture
    constructor(dialog, onApply) {
        this.dialog = dialog;
        this.onApply = onApply;
        this.load = { ...DEFAULT_LOAD };
        try { Object.assign(this.load, JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}); } catch { /* stockage indisponible */ }
        this._clamp();
        this.canvas = dialog.querySelector('canvas');
        this.inputs = {};
        for (const key of ['pilot', 'copilot', 'rear', 'baggage', 'fuelLeft', 'fuelRight']) {
            const range = dialog.querySelector(`[data-charge="${key}"]`);
            const number = dialog.querySelector(`[data-charge-valeur="${key}"]`);
            this.inputs[key] = { range, number };
            const set = (value) => this.set(key, Number(value));
            range.addEventListener('input', () => set(range.value));
            number.addEventListener('input', () => { if (number.value !== '') set(number.value); });
            number.addEventListener('change', () => this._render());
        }
        this.syncBox = dialog.querySelector('#mc-sync');
        this.syncBox.addEventListener('change', () => {
            this.load.sync = this.syncBox.checked;
            if (this.load.sync) this.set('fuelRight', this.load.fuelLeft);
            else this._render();
        });
        dialog.querySelector('#mc-plein').addEventListener('click', () => this._fuel(LIMITS.tankLitres));
        dialog.querySelector('#mc-moitie').addEventListener('click', () => this._fuel(LIMITS.tankLitres / 2));
        dialog.querySelector('#mc-defaut').addEventListener('click', () => {
            this.load = { ...DEFAULT_LOAD };
            this._render();
        });
        dialog.querySelector('#mc-fermer').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => this.apply());
        new ResizeObserver(() => this._chart()).observe(this.canvas);
        this._render();
    }

    open() {
        this.dialog.showModal();
        this._render();
    }

    set(key, value) {
        if (!Number.isFinite(value)) return;
        this.load[key] = value;
        // Ailes synchronisées : même quantité des deux côtés
        if (this.load.sync && (key === 'fuelLeft' || key === 'fuelRight')) this.load.fuelLeft = this.load.fuelRight = value;
        this._clamp();
        this._render(key);
    }

    _fuel(litres) {
        this.load.fuelLeft = this.load.fuelRight = litres;
        this._render();
    }

    _clamp() {
        const l = this.load;
        const clamp = (v, max) => Math.min(max, Math.max(0, Number(v) || 0));
        l.pilot = Math.max(40, clamp(l.pilot, 140));
        l.copilot = clamp(l.copilot, 140);
        l.rear = clamp(l.rear, 250);
        l.baggage = clamp(l.baggage, LIMITS.maxBaggage);
        l.fuelLeft = clamp(l.fuelLeft, LIMITS.tankLitres);
        l.fuelRight = clamp(l.fuelRight, LIMITS.tankLitres);
        l.sync = l.sync !== false;
    }

    // Valeur à appliquer : chargement, masse et centrage au décollage
    result() {
        return check(this.load);
    }

    apply() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.load)); } catch { /* stockage indisponible */ }
        this.onApply?.(this.load, this.result());
    }

    _render(editing = null) {
        const l = this.load;
        for (const [key, { range, number }] of Object.entries(this.inputs)) {
            range.value = l[key];
            if (key !== editing || document.activeElement !== number) number.value = Math.round(l[key]);
        }
        this.syncBox.checked = l.sync;
        const gal = (litres) => (litres / GALLON).toFixed(1);
        this.dialog.querySelector('#mc-gal-gauche').textContent = `${gal(l.fuelLeft)} gal`;
        this.dialog.querySelector('#mc-gal-droite').textContent = `${gal(l.fuelRight)} gal`;
        const r = this.result();
        const fuel = l.fuelLeft + l.fuelRight;
        const set = (id, text) => { this.dialog.querySelector(id).textContent = text; };
        set('#mc-masse', `${Math.round(r.takeoff.mass)} kg`);
        set('#mc-marge', `${Math.round(LIMITS.maxTakeoff - r.takeoff.mass)} kg`);
        set('#mc-centrage', `${r.takeoff.cg.toFixed(3)} m`);
        set('#mc-carburant', `${Math.round(fuel)} L · ${(fuel / GALLON).toFixed(1)} gal`);
        const hours = Math.max(0, fuel / BURN - 0.75);
        set('#mc-autonomie', `${Math.floor(hours)} h ${String(Math.round((hours % 1) * 60)).padStart(2, '0')} (réserve 45 min déduite)`);
        const status = this.dialog.querySelector('#mc-statut');
        status.classList.toggle('erreur', r.problems.length > 0);
        status.textContent = r.problems.length
            ? r.problems.join(' · ')
            : `Dans les limites (catégorie ${r.utility ? 'utilitaire et normale' : 'normale'})`;
        this.dialog.querySelector('#mc-marge').classList.toggle('erreur', r.takeoff.mass > LIMITS.maxTakeoff);
        this._chart();
    }

    // Graphique : masse (kg) en fonction du centrage (m), domaines normal et utilitaire, points décollage / atterrissage
    _chart() {
        const canvas = this.canvas;
        if (!canvas || !this.dialog.open) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const cw = canvas.clientWidth, ch = canvas.clientHeight;
        if (!cw || !ch) return;
        canvas.width = Math.round(cw * ratio);
        canvas.height = Math.round(ch * ratio);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        const pad = { left: 58, right: 18, top: 18, bottom: 46 };
        const X0 = 0.86, X1 = 1.24, Y0 = 650, Y1 = 1200;
        const px = (x) => pad.left + (x - X0) / (X1 - X0) * (cw - pad.left - pad.right);
        const py = (y) => ch - pad.bottom - (y - Y0) / (Y1 - Y0) * (ch - pad.top - pad.bottom);
        const font = (size, weight = '') => `${weight} ${size}px "Noto Sans", Arial, sans-serif`;

        // Quadrillage et graduations
        ctx.lineWidth = 1;
        ctx.font = font(11);
        ctx.fillStyle = '#9fb2c4';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let y = 700; y <= Y1; y += 50) {
            ctx.strokeStyle = y % 100 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
            ctx.beginPath();
            ctx.moveTo(pad.left, py(y));
            ctx.lineTo(cw - pad.right, py(y));
            ctx.stroke();
            if (y % 100 === 0) ctx.fillText(String(y), pad.left - 8, py(y));
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= 38; i++) {
            const x = X0 + i * 0.01;
            const major = Math.round(x * 100) % 5 === 0;
            ctx.strokeStyle = major ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
            ctx.beginPath();
            ctx.moveTo(px(x), pad.top);
            ctx.lineTo(px(x), ch - pad.bottom);
            ctx.stroke();
            if (major) ctx.fillText(x.toFixed(2), px(x), ch - pad.bottom + 6);
        }
        ctx.fillStyle = '#8fd3ff';
        ctx.font = font(11, 'bold');
        ctx.fillText('CENTRAGE (m en arrière de la référence)', pad.left + (cw - pad.left - pad.right) / 2, ch - 18);
        ctx.save();
        ctx.translate(14, pad.top + (ch - pad.top - pad.bottom) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = 'middle';
        ctx.fillText('MASSE (kg)', 0, 0);
        ctx.restore();

        // Domaines
        const polygon = (points, fill, stroke, dash = []) => {
            ctx.beginPath();
            points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.setLineDash(dash);
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
        };
        polygon(NORMAL, 'rgba(61, 143, 214, 0.18)', '#3d8fd6');
        polygon(UTILITY, 'rgba(58, 208, 106, 0.12)', '#3ad06a', [6, 4]);
        ctx.font = font(11, 'bold');
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#5ea9ec';
        ctx.fillText('NORMALE', px(1.10), py(1150));
        ctx.fillStyle = '#3ad06a';
        ctx.fillText('UTILITAIRE', px(0.905), py(720));
        // Masse maximale
        ctx.strokeStyle = 'rgba(232, 68, 58, 0.8)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, py(LIMITS.maxTakeoff));
        ctx.lineTo(cw - pad.right, py(LIMITS.maxTakeoff));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e8443a';
        ctx.textAlign = 'right';
        ctx.fillText(`MTOW ${Math.round(LIMITS.maxTakeoff)} kg`, cw - pad.right - 4, py(LIMITS.maxTakeoff) - 3);

        // Points : décollage (plein choisi) et atterrissage (réserve), reliés par la droite de consommation
        const r = this.result();
        const ok = r.problems.length === 0;
        const clampX = (x) => Math.min(X1, Math.max(X0, x)), clampY = (y) => Math.min(Y1, Math.max(Y0, y));
        ctx.strokeStyle = ok ? '#ffffff' : '#ff8a80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px(clampX(r.takeoff.cg)), py(clampY(r.takeoff.mass)));
        ctx.lineTo(px(clampX(r.landing.cg)), py(clampY(r.landing.mass)));
        ctx.stroke();
        const point = (p, label, filled) => {
            const x = px(clampX(p.cg)), y = py(clampY(p.mass));
            ctx.beginPath();
            ctx.arc(x, y, filled ? 7 : 5, 0, Math.PI * 2);
            ctx.fillStyle = filled ? (ok ? '#ffd23c' : '#e8443a') : '#0a1626';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.font = font(11, 'bold');
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x + 11, y);
        };
        point(r.landing, 'Atterrissage', false);
        point(r.takeoff, 'Décollage', true);
    }
}

export { WeightBalance, LIMITS as WB_LIMITS, GALLON as WB_GALLON, FUEL_DENSITY, compute as computeLoad };
