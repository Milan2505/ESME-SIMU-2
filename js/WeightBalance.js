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
const FT = 0.3048;

// Bilan carburant (« Afficher plus ») : durées en minutes, consommations en L/h. Réserve finale VFR : 30 min de jour,
// 45 min de nuit (NCO.OP.125) ; réserve de route en % du délestage ; supplément au choix du commandant de bord
const DEFAULT_PLAN = {
    taxi: 10, trip: 60, procedures: 10, alternate: 0, finalReserve: 30, extra: 0, contingency: 10,
    burn: 32, taxiBurn: 12, tas: 110,
};
// Performances : terrain (altitude ft, QNH hPa, température °C), vent (kt, + = de face), surface, pente (%, + = montante
// au décollage), coefficient de sécurité, longueur de piste disponible (m ; par défaut celle de l'aérodrome ESME, voir constructor)
const DEFAULT_PERF = { elevation: 0, qnh: 1013, temperature: 15, wind: 0, surface: 'dur', slope: 0, margin: 1.15, runway: 1000 };
const SURFACES = {
    dur:    { label: 'Dur (sec)', takeoff: 1, landing: 1 },
    herbe:  { label: 'Herbe sèche', takeoff: 1.15, landing: 1.45 },        // manuel : +15 % / +45 % du roulement
    mouille: { label: 'Herbe mouillée (estim.)', takeoff: 1.3, landing: 1.6 },
};

// Manuel du 172S, décollage court (volets 10°), niveau de la mer, 20 °C : [masse lb, roulement ft, passage 50 ft ft]
const TAKEOFF = [[2200, 725, 1305], [2400, 860, 1540], [2550, 980, 1745]];
const LANDING = [2550, 585, 1335];   // atterrissage court (volets 30°), même référence

const DEFAULT_LOAD = { pilot: 80, copilot: 0, rear: 0, baggage: 10, fuelLeft: 76, fuelRight: 76, sync: true };

// Bilan carburant : litres de chaque poste, total nécessaire, carburant restant à l'atterrissage et rayon d'action
function fuelPlan(load) {
    const p = load.plan, perH = p.burn / 60;
    const items = [
        ['Roulage (départ et arrivée)', p.taxi * p.taxiBurn / 60, p.taxi],
        ['Délestage (étape)', p.trip * perH, p.trip],
        ['Procédures départ / arrivée', p.procedures * perH, p.procedures],
        [`Réserve de route (${p.contingency} % du délestage)`, p.trip * perH * p.contingency / 100, p.trip * p.contingency / 100],
        ['Dégagement', p.alternate * perH, p.alternate],
        ['Réserve finale', p.finalReserve * perH, p.finalReserve],
        ['Supplément commandant de bord', p.extra * perH, p.extra],
    ];
    const required = items.reduce((sum, [, litres]) => sum + litres, 0);
    const onboard = load.fuelLeft + load.fuelRight;
    // À l'atterrissage : départ et étape consommés (roulage d'arrivée : moitié du roulage restant)
    const atLanding = Math.max(0, onboard - p.taxi * p.taxiBurn / 120 - (p.trip + p.procedures) * perH);
    // Rayon d'action (air calme) : carburant hors roulage, procédures et réserves, réserve de route comprise
    const cruise = Math.max(0, onboard - p.taxi * p.taxiBurn / 60 - (p.procedures + p.finalReserve + p.extra) * perH);
    const cruiseHours = cruise / (p.burn * (1 + p.contingency / 100));
    const endurance = Math.max(0, onboard - p.taxi * p.taxiBurn / 60) / p.burn;
    return { items, required, onboard, spare: onboard - required, atLanding, cruiseHours, range: cruiseHours * p.tas, endurance };
}

// Distances (m) de décollage et d'atterrissage à une masse (kg), corrigées du terrain, du vent, de la surface, de la
// pente et du coefficient de sécurité. Altitude : ~+9 % par 1 000 ft d'altitude-pression ; température : ~+0,75 % par
// °C au-dessus de 20 °C (pente des tableaux du manuel) ; vent : -10 % par 9 kt de face, +10 % par 2 kt arrière
function performance(perf, takeoffKg, landingKg) {
    const pressureAlt = perf.elevation + (1013 - perf.qnh) * 27;
    const terrain = 1.09 ** (pressureAlt / 1000) * Math.max(0.7, 1 + 0.0075 * (perf.temperature - 20));
    const wind = perf.wind >= 0 ? Math.max(0.5, 1 - 0.1 * perf.wind / 9) : 1 + 0.1 * -perf.wind / 2;
    const surface = SURFACES[perf.surface] ?? SURFACES.dur;
    const slope = 1 + 0.1 * perf.slope;   // ±10 % par % de pente (montante au décollage)
    const lb = takeoffKg / LB;
    // Décollage : interpolation entre les masses du tableau ; en dessous, roulement en (masse)²
    let roll, obstacle;
    if (lb <= TAKEOFF[0][0]) {
        const k = (lb / TAKEOFF[0][0]) ** 2;
        [roll, obstacle] = [TAKEOFF[0][1] * k, TAKEOFF[0][2] * k];
    } else {
        const i = lb >= TAKEOFF[1][0] ? 1 : 0;
        const [w0, r0, o0] = TAKEOFF[i], [w1, r1, o1] = TAKEOFF[i + 1];
        const t = (lb - w0) / (w1 - w0);
        [roll, obstacle] = [r0 + (r1 - r0) * t, o0 + (o1 - o0) * t];
    }
    // Surface et pente ne jouent que sur le roulement ; la partie en l'air (jusqu'à 15 m) suit terrain et vent
    const groundRoll = roll * terrain * wind * surface.takeoff * slope;
    const airborne = (obstacle - roll) * terrain * wind;
    const takeoff = { roll: groundRoll * FT * perf.margin, obstacle: (groundRoll + airborne) * FT * perf.margin };
    // Atterrissage : proportionnel à la masse (le manuel ne donne que la masse maximale)
    const k = (landingKg / LB) / LANDING[0];
    const landRoll = LANDING[1] * k * terrain * wind * surface.landing / slope;
    const flare = (LANDING[2] - LANDING[1]) * k * terrain * wind;
    const landing = { roll: landRoll * FT * perf.margin, obstacle: (landRoll + flare) * FT * perf.margin };
    return { takeoff, landing, pressureAlt };
}
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
    // Point « atterrissage » : carburant restant après le roulage, l'étape et les procédures (bilan carburant)
    const plan = fuelPlan(load), onboard = load.fuelLeft + load.fuelRight;
    const takeoff = compute(load), landing = compute(load, onboard > 0 ? plan.atLanding / onboard : 0);
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
    // runwayLength : longueur de la piste de l'aérodrome (m), valeur par défaut de « Piste disponible »
    constructor(dialog, onApply, { runwayLength = DEFAULT_PERF.runway } = {}) {
        this.runwayLength = runwayLength;
        this.dialog = dialog;
        this.onApply = onApply;
        this.load = { ...DEFAULT_LOAD };
        try { Object.assign(this.load, JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}); } catch { /* stockage indisponible */ }
        this.load.plan = { ...DEFAULT_PLAN, ...this.load.plan };
        this.load.perf = { ...DEFAULT_PERF, runway: runwayLength, ...this.load.perf };
        // Ancienne valeur par défaut (piste de 700 m, avant son allongement) : remplacée par la piste actuelle
        if (this.load.perf.runway === 700) this.load.perf.runway = runwayLength;
        this._clamp();
        // « Afficher plus » : bilan carburant et performances
        this.more = dialog.querySelector('.mc-plus');
        const moreButton = dialog.querySelector('#mc-plus-bouton');
        moreButton.addEventListener('click', () => {
            this.more.hidden = !this.more.hidden;
            moreButton.textContent = this.more.hidden ? 'Afficher plus ▾' : 'Afficher moins ▴';
            this._render();
        });
        // Durées : heures et minutes (data-duree = poste du bilan, en minutes)
        for (const box of dialog.querySelectorAll('[data-duree]')) {
            const key = box.dataset.duree, [hours, minutes] = box.querySelectorAll('input');
            const set = () => {
                this.load.plan[key] = Math.max(0, (Number(hours.value) || 0) * 60 + (Number(minutes.value) || 0));
                this._render(`plan-${key}`);
            };
            hours.addEventListener('input', set);
            minutes.addEventListener('input', set);
            minutes.addEventListener('change', () => this._render());
        }
        // Autres réglages : data-plan (consommations, vitesse, %) et data-perf (terrain, vent, piste…)
        for (const input of dialog.querySelectorAll('[data-plan], [data-perf]')) {
            const group = input.dataset.plan ? 'plan' : 'perf', key = input.dataset.plan ?? input.dataset.perf;
            const read = () => {
                const value = input.tagName === 'SELECT' && key === 'surface' ? input.value : Number(input.value);
                if (typeof value === 'number' && !Number.isFinite(value)) return;
                this.load[group][key] = value;
                this._clamp();
                this._render(`${group}-${key}`);
            };
            input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', read);
            input.addEventListener('change', () => this._render());   // champ quitté : valeur ramenée dans ses bornes
        }
        dialog.querySelector('#mc-piste-esme').addEventListener('click', () => { this.load.perf.runway = this.runwayLength; this._render(); });
        dialog.querySelector('#mc-reserve-nuit').addEventListener('click', () => { this.load.plan.finalReserve = 45; this._render(); });
        // « Carburant à bord = carburant nécessaire » : les réservoirs suivent le bilan (curseurs de carburant bloqués)
        this.autoFuelBox = dialog.querySelector('#mc-auto-carbu');
        this.autoFuelBox.addEventListener('change', () => {
            this.load.fuelFromPlan = this.autoFuelBox.checked;
            this._render();
        });
        dialog.querySelector('#mc-reserve-jour').addEventListener('click', () => { this.load.plan.finalReserve = 30; this._render(); });
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
            this.load = { ...DEFAULT_LOAD, plan: { ...DEFAULT_PLAN }, perf: { ...DEFAULT_PERF, runway: this.runwayLength } };
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
        const p = l.plan, f = l.perf;
        for (const key of ['taxi', 'trip', 'procedures', 'alternate', 'finalReserve', 'extra']) p[key] = clamp(p[key], 24 * 60);
        p.contingency = clamp(p.contingency, 50);
        p.burn = Math.max(10, clamp(p.burn, 80));
        p.taxiBurn = clamp(p.taxiBurn, 40);
        p.tas = Math.max(50, clamp(p.tas, 160));
        f.elevation = Math.min(12000, Math.max(-1000, Number(f.elevation) || 0));
        f.qnh = Math.min(1060, Math.max(940, Number(f.qnh) || 1013));
        f.temperature = Math.min(50, Math.max(-40, Number(f.temperature) || 0));
        f.wind = Math.min(40, Math.max(-15, Number(f.wind) || 0));
        f.slope = Math.min(5, Math.max(-5, Number(f.slope) || 0));
        f.margin = [1, 1.15, 1.25, 1.43].includes(Number(f.margin)) ? Number(f.margin) : 1.15;
        f.runway = Math.max(100, Math.min(5000, Number(f.runway) || this.runwayLength));
        if (!SURFACES[f.surface]) f.surface = 'dur';
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
        // Carburant suivant le bilan : nécessaire réparti sur les deux ailes (au demi-litre supérieur, plein au plus)
        if (l.fuelFromPlan) {
            const half = Math.min(LIMITS.tankLitres, Math.ceil(fuelPlan(l).required) / 2);
            l.fuelLeft = l.fuelRight = half;
        }
        this.autoFuelBox.checked = Boolean(l.fuelFromPlan);
        for (const key of ['fuelLeft', 'fuelRight']) {
            this.inputs[key].range.disabled = this.inputs[key].number.disabled = Boolean(l.fuelFromPlan);
        }
        for (const button of [this.syncBox, ...this.dialog.querySelectorAll('#mc-moitie, #mc-plein')]) button.disabled = Boolean(l.fuelFromPlan);
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
        const hours = Math.max(0, fuel / l.plan.burn - l.plan.finalReserve / 60);
        set('#mc-autonomie', `${Math.floor(hours)} h ${String(Math.round((hours % 1) * 60)).padStart(2, '0')} (réserve finale de ${l.plan.finalReserve} min déduite)`);
        set('#mc-conso', `Autonomie (${l.plan.burn} L/h)`);
        const status = this.dialog.querySelector('#mc-statut');
        status.classList.toggle('erreur', r.problems.length > 0);
        status.textContent = r.problems.length
            ? r.problems.join(' · ')
            : `Dans les limites (catégorie ${r.utility ? 'utilitaire et normale' : 'normale'})`;
        this.dialog.querySelector('#mc-marge').classList.toggle('erreur', r.takeoff.mass > LIMITS.maxTakeoff);
        this._renderMore(editing, r);
        this._chart();
    }

    // « Afficher plus » : bilan carburant (postes en h / min et litres) et performances (distances, rayon d'action)
    _renderMore(editing, r) {
        if (this.more.hidden) return;
        const l = this.load, d = this.dialog;
        const hm = (minutes) => `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, '0')}`;
        for (const box of d.querySelectorAll('[data-duree]')) {
            const key = box.dataset.duree, [hours, minutes] = box.querySelectorAll('input');
            if (editing === `plan-${key}` && box.contains(document.activeElement)) continue;
            hours.value = Math.floor(l.plan[key] / 60);
            minutes.value = Math.round(l.plan[key] % 60);
        }
        for (const input of d.querySelectorAll('[data-plan], [data-perf]')) {
            const group = input.dataset.plan ? 'plan' : 'perf', key = input.dataset.plan ?? input.dataset.perf;
            if (editing === `${group}-${key}` && document.activeElement === input) continue;
            input.value = String(l[group][key]);
        }
        // Bilan carburant
        const plan = fuelPlan(l);
        const table = d.querySelector('#mc-bilan');
        table.replaceChildren(...plan.items.map(([label, litres, minutes]) => {
            const row = document.createElement('tr');
            row.innerHTML = `<td></td><td>${hm(minutes)}</td><td>${litres.toFixed(1)} L</td>`;
            row.firstChild.textContent = label;
            return row;
        }));
        const total = (label, minutes, litres, cls = '') => {
            const row = document.createElement('tr');
            row.className = cls;
            row.innerHTML = `<td></td><td>${minutes}</td><td>${litres}</td>`;
            row.firstChild.textContent = label;
            table.append(row);
        };
        total('Carburant nécessaire', hm(plan.required / l.plan.burn * 60), `${plan.required.toFixed(1)} L`, 'mc-total');
        total('Carburant à bord', hm(plan.onboard / l.plan.burn * 60), `${plan.onboard.toFixed(1)} L`, 'mc-total');
        const ok = plan.spare >= 0;
        total(ok ? 'Excédent' : 'MANQUE', hm(Math.abs(plan.spare) / l.plan.burn * 60), `${plan.spare >= 0 ? '+' : '−'}${Math.abs(plan.spare).toFixed(1)} L`,
            ok ? 'mc-ok' : 'mc-ko');
        d.querySelector('#mc-reserve-valeur').textContent = hm(l.plan.finalReserve);
        // Rayon d'action, autonomie
        const set = (id, text, bad = null) => {
            const el = d.querySelector(id);
            el.textContent = text;
            if (bad !== null) el.classList.toggle('erreur', bad);
        };
        set('#mc-autonomie-totale', hm(plan.endurance * 60));
        set('#mc-distance', `${Math.round(plan.range)} NM · ${Math.round(plan.range * 1.852)} km`);
        set('#mc-rayon', `${Math.round(plan.range / 2)} NM · ${Math.round(plan.range * 1.852 / 2)} km`);
        set('#mc-etape', `${Math.round(l.plan.trip / 60 * l.plan.tas)} NM à ${l.plan.tas} kt`);
        // Distances de décollage et d'atterrissage (masses du bilan), comparées à la piste
        const perf = performance(l.perf, r.takeoff.mass, r.landing.mass);
        const m = (v) => `${Math.round(v)} m`;
        set('#mc-deco-roul', m(perf.takeoff.roll), perf.takeoff.roll > l.perf.runway);
        set('#mc-deco-15', m(perf.takeoff.obstacle), perf.takeoff.obstacle > l.perf.runway);
        set('#mc-atte-roul', m(perf.landing.roll), perf.landing.roll > l.perf.runway);
        set('#mc-atte-15', m(perf.landing.obstacle), perf.landing.obstacle > l.perf.runway);
        set('#mc-masses', `décollage ${Math.round(r.takeoff.mass)} kg · atterrissage ${Math.round(r.landing.mass)} kg · altitude-pression ${Math.round(perf.pressureAlt)} ft`);
        const fits = Math.max(perf.takeoff.obstacle, perf.landing.obstacle) <= l.perf.runway;
        const verdict = d.querySelector('#mc-piste');
        verdict.classList.toggle('erreur', !fits);
        verdict.textContent = fits
            ? `Piste de ${l.perf.runway} m suffisante (coefficient ${l.perf.margin.toFixed(2)} compris)`
            : `Piste de ${l.perf.runway} m trop courte pour passer ou franchir 15 m (coefficient ${l.perf.margin.toFixed(2)})`;
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
