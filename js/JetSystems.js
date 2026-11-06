// Systèmes du F-15C, comme Systems.js pour le Cessna : électricité (batterie, génératrices), démarrage des réacteurs par
// le JFS (petite turbine de démarrage), deux réacteurs F100 (régime N2, postcombustion), carburant, feux, verrière.
// Même interface que Systems.js là où le simulateur les lit tous les deux (rpm, power, running, lights, switches,
// reset, coldAndDark, update, événements change / start / stop / startfail) ; le modèle de vol reçoit la poussée
// (thrust, N) plutôt qu'une puissance.
//
// Mise en route (procédure simplifiée du vrai avion) :
//   1. BATT sur ON ;
//   2. JFS : tirer la poignée, la turbine monte en régime (~8 s, voyant JFS READY) ;
//   3. ENG MASTER gauche et droit sur ON (pompes carburant) ;
//   4. ENG CRANK droit : le JFS entraîne le réacteur, qui s'allume vers 18 % de N2 et se stabilise au ralenti
//      (~65 %) ; puis le gauche. Le JFS s'arrête seul une fois les deux réacteurs lancés.
// Arrêt : ENG MASTER sur OFF.
// Manette des gaz (0 -> 1) : ralenti -> plein gaz sec (MIL) jusqu'à 85 %, puis les 5 étages de postcombustion (AB).

const IDLE_N2 = 65;                 // % : ralenti
const LIGHT_OFF_N2 = 18;            // % : allumage pendant le lancement
const CRANK_N2 = 24;                // % : régime auquel le JFS entraîne le réacteur
const JFS_SPOOL = 8;                // s : JFS prêt
const JFS_RUN_AFTER = 6;            // s : le JFS s'arrête après le lancement du dernier réacteur
const MIL = 0.85;                   // manette : plein gaz sec, au-delà postcombustion
const DRY_THRUST = 64900;           // N par réacteur, plein gaz sec
const AB_THRUST = 105700;           // N par réacteur, postcombustion à fond
const IDLE_THRUST = 3500;           // N par réacteur au ralenti
const FUEL_CAPACITY = 6100;         // kg (carburant interne)
const FUEL_DEFAULT = 4600;          // kg au départ (~75 %)
const LOW_FUEL = 900;               // kg : alarme BINGO
// Débit carburant d'un réacteur (kg/h) : ralenti, plein gaz sec, postcombustion à fond
const FLOW_IDLE = 500, FLOW_MIL = 4700, FLOW_AB = 19000;
const BATTERY_LIFE = 1200;          // s sur batterie seule

const TOGGLES = ['battery', 'genL', 'genR', 'masterL', 'masterR', 'nav', 'beacon', 'strobe', 'land', 'taxi', 'canopy'];

class JetEngine {
    constructor() {
        this.n2 = 0;          // régime (%)
        this.running = false;
        this.ab = 0;          // postcombustion (0 -> 1)
        this.cranking = false;
    }
}

class JetSystems extends EventTarget {
    constructor() {
        super();
        this.engines = [new JetEngine(), new JetEngine()];   // gauche, droit
        this.fuelLoad = FUEL_DEFAULT;
        this.reset();
    }

    // Prêt à voler : réacteurs au ralenti, tout allumé sauf les phares, verrière fermée
    reset() {
        this.switches = {
            battery: true, genL: true, genR: true, masterL: true, masterR: true,
            nav: true, beacon: true, strobe: true, land: false, taxi: false, canopy: false,   // canopy : true = ouverte
        };
        for (const e of this.engines) Object.assign(e, { n2: IDLE_N2, running: true, ab: 0, cranking: false });
        this.jfs = 0;               // régime du JFS (0 -> 1, prêt à 1)
        this.jfsRunning = false;
        this._jfsStop = 0;
        this.crank = -1;            // réacteur entraîné par le JFS (0 gauche, 1 droit, -1 aucun)
        this.fuelKg = this.fuelLoad;
        this.battery = 1;
        this.brake = false;
        this.panelLights = 0.8;
        this.domeLight = 0;
        this.mixture = 1;           // (sans objet : compatibilité avec Systems.js)
        this._throttle = 0;
        this._changed();
    }

    // Au parking, éteint : tout coupé, réacteurs arrêtés, verrière ouverte
    coldAndDark() {
        for (const id of Object.keys(this.switches)) this.switches[id] = false;
        this.switches.canopy = true;
        for (const e of this.engines) Object.assign(e, { n2: 0, running: false, ab: 0, cranking: false });
        this.jfs = 0;
        this.jfsRunning = false;
        this.crank = -1;
        this.panelLights = 0;
        this._changed();
    }

    // --- Commandes (clics en cabine, tablette) -----------------------------------------------

    toggle(id) {
        if (id in this.switches) this.switches[id] = !this.switches[id];
        this._changed();
    }

    // Poignée du JFS : tirée, la turbine démarre (batterie nécessaire) ; tirée de nouveau, elle s'arrête
    pullJfs() {
        if (this.jfsRunning) this.jfsRunning = false;
        else if (this.busPowered) {
            this.jfsRunning = true;
            this._jfsStop = 0;
        } else this.dispatchEvent(new CustomEvent('startfail', { detail: 'JFS sans effet : batterie coupée (BATT)' }));
        this._changed();
    }

    // ENG CRANK : le JFS (prêt) entraîne le réacteur choisi (0 gauche, 1 droit)
    crankEngine(side) {
        const e = this.engines[side];
        if (e.running) return;
        if (!this.jfsReady) {
            this.dispatchEvent(new CustomEvent('startfail', { detail: this.jfsRunning ? 'Attendez JFS READY (le JFS monte en régime)' : 'Lancement impossible : démarrez d\'abord le JFS (poignée JFS)' }));
            return;
        }
        this.crank = this.crank === side ? -1 : side;
        this._changed();
    }

    setPanelLights(value) {
        this.panelLights = Math.max(0, Math.min(1, value));
        this._changed();
    }

    setDomeLight(value) {
        this.domeLight = Math.max(0, Math.min(1, value));
        this._changed();
    }

    setMixture() { /* (pas de mixture sur un réacteur) */ }
    // (commandes propres au Cessna : sans objet sur le F-15, appelées par ses tuiles de tablette)
    turnMagnetos() {}
    turnFuelSelector() {}
    toggleFuelShutoff() {}

    // --- État -------------------------------------------------------------------------------------

    get jfsReady() {
        return this.jfsRunning && this.jfs >= 1;
    }

    get running() {
        return this.engines.some((e) => e.running);
    }

    get generatorOn() {
        return (this.switches.genL && this.engines[0].running && this.engines[0].n2 > 55)
            || (this.switches.genR && this.engines[1].running && this.engines[1].n2 > 55);
    }

    get busPowered() {
        return this.generatorOn || (this.switches.battery && this.battery > 0);
    }

    get volts() {
        return this.generatorOn ? 28 : this.busPowered ? 24 + this.battery * 1.5 : 0;
    }

    get flapsPowered() {
        return this.busPowered;
    }

    get gaugesPowered() {
        return this.busPowered;
    }

    get panelLighting() {
        return this.busPowered ? this.panelLights : 0;
    }

    get domeLighting() {
        return this.busPowered ? this.domeLight : 0;
    }

    get vacuum() {
        return this.busPowered;   // (instruments gyroscopiques électriques)
    }

    get turnCoordinatorPowered() {
        return this.busPowered;
    }

    get fuelPumpRunning() {
        return false;
    }

    get cranking() {
        return this.crank >= 0;
    }

    get lights() {
        const on = this.busPowered;
        return {
            beacon: on && this.switches.beacon, nav: on && this.switches.nav, strobe: on && this.switches.strobe,
            land: on && this.switches.land, taxi: on && this.switches.taxi,
        };
    }

    // Régime moyen (%), et « rpm » : N2 × 27 (100 % <-> 2 700, le régime maxi du Cessna) pour ce qui lit un régime
    // sans connaître l'avion (bruit des autres joueurs, message multijoueur)
    get n2() {
        return (this.engines[0].n2 + this.engines[1].n2) / 2;
    }

    get rpm() {
        return this.n2 * 27;
    }

    // Postcombustion moyenne (0 -> 1)
    get afterburner() {
        return (this.engines[0].ab + this.engines[1].ab) / 2;
    }

    // Part de la poussée maxi (0 -> 1), comme la puissance du Cessna
    get power() {
        return this.thrust / (2 * AB_THRUST);
    }

    // Poussée totale (N, niveau de la mer)
    get thrust() {
        return this.engines.reduce((sum, e) => sum + this._engineThrust(e), 0);
    }

    _engineThrust(e) {
        if (!e.running) return 0;
        const dry = Math.max(0, (e.n2 - IDLE_N2) / (100 - IDLE_N2));
        return IDLE_THRUST + (DRY_THRUST - IDLE_THRUST) * dry ** 1.6 + (AB_THRUST - DRY_THRUST) * e.ab;
    }

    // Débit carburant total (kg/h)
    get fuelFlow() {
        return this.engines.reduce((sum, e) => {
            if (!e.running) return sum;
            const dry = Math.max(0, (e.n2 - IDLE_N2) / (100 - IDLE_N2));
            return sum + FLOW_IDLE + (FLOW_MIL - FLOW_IDLE) * dry ** 1.5 + (FLOW_AB - FLOW_MIL) * e.ab;
        }, 0);
    }

    // Carburant restant (0 -> 1), pour la jauge du HUD
    get fuelFraction() {
        return this.fuelKg / FUEL_CAPACITY;
    }

    get fuelMass() {
        return this.fuelKg;
    }

    get warnings() {
        return {
            bingo: this.fuelKg < LOW_FUEL,
            genL: !(this.switches.genL && this.engines[0].running && this.engines[0].n2 > 55),
            genR: !(this.switches.genR && this.engines[1].running && this.engines[1].n2 > 55),
            oilL: !this.engines[0].running, oilR: !this.engines[1].running,
            jfs: this.jfsRunning, canopy: this.switches.canopy,
        };
    }

    // throttle : 0 -> 1 (manette) ; airspeed (m/s) : un réacteur arrêté tourne un peu dans le vent (moulinet)
    update(delta, throttle, airspeed) {
        this._throttle = throttle;
        // JFS : monte en régime, s'arrête sans courant ou une fois les deux réacteurs lancés
        if (this.jfsRunning && !this.busPowered) this.jfsRunning = false;
        this.jfs = this.jfsRunning ? Math.min(1, this.jfs + delta / JFS_SPOOL) : Math.max(0, this.jfs - delta / 3);
        if (this.jfsRunning && this.engines.every((e) => e.running) && this.crank < 0) {
            this._jfsStop += delta;
            if (this._jfsStop > JFS_RUN_AFTER) {
                this.jfsRunning = false;
                this._changed();
            }
        } else this._jfsStop = 0;
        if (this.crank >= 0 && !this.jfsReady) this.crank = -1;

        const dryTarget = Math.min(1, throttle / MIL);
        const abTarget = Math.max(0, (throttle - MIL) / (1 - MIL));
        this.engines.forEach((e, side) => {
            const master = side === 0 ? this.switches.masterL : this.switches.masterR;
            const fuel = master && this.fuelKg > 0;
            e.cranking = this.crank === side;
            // Allumage : entraîné par le JFS au-delà de 18 %, carburant ouvert
            if (!e.running && e.cranking && fuel && e.n2 >= LIGHT_OFF_N2) {
                e.running = true;
                this.crank = -1;
                this.dispatchEvent(new CustomEvent('start', { detail: { side } }));
                this._changed();
            }
            // Arrêt : ENG MASTER coupé ou panne sèche
            if (e.running && !fuel) {
                e.running = false;
                e.ab = 0;
                this.dispatchEvent(new CustomEvent('stop', { detail: { side } }));
                this._changed();
            }
            let target;
            if (e.running) target = IDLE_N2 + (100 - IDLE_N2) * dryTarget;
            else if (e.cranking) target = CRANK_N2;
            else target = Math.min(12, airspeed * 0.08);   // moulinet
            // Montée en régime : ~4 s du ralenti au plein gaz, plus lente au lancement ; descente un peu plus rapide
            const rate = e.running ? (target > e.n2 ? 9 : 14) : (e.cranking ? 3 : 6);
            e.n2 += Math.max(-rate * delta, Math.min(rate * delta, (target - e.n2) * Math.min(1, delta * 2.5)));
            // Postcombustion : seulement à plein régime sec, allumée en ~0,5 s
            const ab = e.running && e.n2 > 97 ? abTarget : 0;
            e.ab += (ab - e.ab) * Math.min(1, delta * (ab > e.ab ? 2.5 : 4));
        });

        // Carburant
        this.fuelKg = Math.max(0, this.fuelKg - this.fuelFlow * delta / 3600);
        // Batterie : se recharge avec une génératrice, se décharge sinon
        if (this.switches.battery) {
            const load = 0.3 + (this.jfsRunning && this.jfs < 1 ? 3 : 0);
            this.battery = Math.max(0, Math.min(1, this.battery + (this.generatorOn ? 1 / 300 : -load / BATTERY_LIFE) * delta));
        }
    }

    _changed() {
        this.dispatchEvent(new Event('change'));
    }
}

export { JetSystems, TOGGLES as JET_TOGGLES, FUEL_CAPACITY as JET_FUEL_CAPACITY, MIL as JET_MIL };
