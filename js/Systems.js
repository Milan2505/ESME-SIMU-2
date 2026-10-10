// Systèmes du Cessna 172 commandés depuis la cabine (interrupteurs, contacts, mixture, carburant, disjoncteurs) :
// électricité (batterie, alternateur, avionique), moteur (magnétos, démarreur, mixture, alimentation en carburant),
// réservoirs, dépression (instruments gyroscopiques), feux. Le modèle de vol en reçoit la puissance du moteur et
// l'alimentation des volets ; la cabine, les instruments et les feux lisent l'état d'ici.

const GALLON = 3.785;                  // litres (affichage en gallons US, comme dans l'avion)
const TANK_CAPACITY = 26.5;            // gallons utilisables par aile
const LOW_FUEL = 5;                    // alarme carburant bas (gal)
const START_TIME = 1.2;                // le moteur démarre après 1,2 s de démarreur
const STARTER_HOLD = 1.6;              // durée d'un appui sur START (s) : la clé revient seule sur BOTH
const FUEL_STARVE_TIME = 4;            // sans alimentation, le moteur s'arrête après ~4 s (carburant dans les tuyaux)
const BATTERY_LIFE = 1800;             // batterie seule : ~30 min (s)

// Disjoncteurs (rangée du haut du sous-panneau), dans l'ordre d'affichage : { id, label, ampères }
const BREAKERS = [
    { id: 'cabin', label: 'CABIN\nLT/PWR', amps: 10 },
    { id: 'flap', label: 'FLAP', amps: 10 },
    { id: 'inst', label: 'INST', amps: 15 },
    { id: 'avn1', label: 'AVN\nBUS 1', amps: 15 },
    { id: 'avn2', label: 'AVN\nBUS 2', amps: 15 },
    { id: 'turn', label: 'TURN\nCOORD', amps: 5 },
    { id: 'instLts', label: 'INST\nLTS', amps: 5 },
    { id: 'altFld', label: 'ALT\nFLD', amps: 5 },
    { id: 'warn', label: 'WARN', amps: 5 },
];

// Interrupteurs à bascule (rangée du bas), dans l'ordre d'affichage
const TOGGLES = [
    { id: 'fuelPump', label: 'FUEL\nPUMP' },
    { id: 'beacon', label: 'BCN', group: 'LIGHTS' },
    { id: 'land', label: 'LAND', group: 'LIGHTS' },
    { id: 'nav', label: 'NAV', group: 'LIGHTS' },
    { id: 'strobe', label: 'STROBE', group: 'LIGHTS' },
    { id: 'pitotHeat', label: 'PITOT\nHEAT' },
];

const MAGNETOS = ['OFF', 'R', 'L', 'BOTH', 'START'];
const FUEL_SELECTOR = ['LEFT', 'BOTH', 'RIGHT'];

class Systems extends EventTarget {
    constructor() {
        super();
        this.reset();
    }

    // Avion prêt à voler : moteur tournant, tout allumé sauf phares et pompe
    reset() {
        this.switches = {
            masterBat: true, masterAlt: true, avionics: true,
            fuelPump: false, beacon: true, land: false, nav: true, strobe: true, pitotHeat: false,
            elt: false, altStatic: false, cabinAir1: false, cabinAir2: false,
        };
        this.breakers = Object.fromEntries(BREAKERS.map((b) => [b.id, true]));   // true = enclenché
        this.magnetos = 3;              // index dans MAGNETOS (BOTH)
        this.fuelSelector = 1;          // BOTH
        this.fuelShutoff = false;       // robinet coupé (tiré)
        this.mixture = 1;               // 1 = plein riche, 0 = étouffoir
        this.panelLights = 0.8;         // rhéostat d'éclairage des instruments (0 -> 1)
        this.fuel = [20, 20];           // gallons gauche / droite
        this.battery = 1;
        this.running = true;
        this.rpm = 800;
        this._crank = 0;                // temps de démarreur restant (s)
        this._cranked = 0;              // temps de démarreur écoulé
        this._starve = 0;               // temps sans carburant
        this._changed();
    }

    // --- Commandes (clics en cabine) -------------------------------------------------

    toggle(id) {
        if (id in this.switches) this.switches[id] = !this.switches[id];
        else if (id in this.breakers) this.breakers[id] = !this.breakers[id];
        this._changed();
    }

    // Clé des magnétos : step -1 / +1 ; START est momentané (la clé revient sur BOTH)
    turnMagnetos(step) {
        this.magnetos = Math.max(0, Math.min(4, this.magnetos + step));
        if (this.magnetos === 4) {
            this._crank = STARTER_HOLD;
            this._cranked = 0;
        }
        this._changed();
    }

    turnFuelSelector(step) {
        this.fuelSelector = Math.max(0, Math.min(2, this.fuelSelector + step));
        this._changed();
    }

    setMixture(value) {
        this.mixture = Math.max(0, Math.min(1, value));
        this._changed();
    }

    setPanelLights(value) {
        this.panelLights = Math.max(0, Math.min(1, value));
        this._changed();
    }

    toggleFuelShutoff() {
        this.fuelShutoff = !this.fuelShutoff;
        this._changed();
    }

    // --- État -----------------------------------------------------------------------------

    get magnetoPosition() {
        return MAGNETOS[this.magnetos];
    }

    get fuelSelectorPosition() {
        return FUEL_SELECTOR[this.fuelSelector];
    }

    // Bus principal alimenté (batterie chargée ou alternateur)
    get busPowered() {
        return this.switches.masterBat && (this.battery > 0 || this.alternatorOn);
    }

    get alternatorOn() {
        return this.switches.masterAlt && this.switches.masterBat && this.breakers.altFld && this.running && this.rpm > 1000;
    }

    // Avionique (radios, VOR, ILS, transpondeur)
    get avionicsPowered() {
        return this.busPowered && this.switches.avionics && this.breakers.avn1 && this.breakers.avn2;
    }

    get flapsPowered() {
        return this.busPowered && this.breakers.flap;
    }

    // Instruments moteur et jauges carburant (électriques)
    get gaugesPowered() {
        return this.busPowered && this.breakers.inst;
    }

    get turnCoordinatorPowered() {
        return this.busPowered && this.breakers.turn;
    }

    get annunciatorsPowered() {
        return this.busPowered && this.breakers.warn;
    }

    // Dépression (pompe entraînée par le moteur) : horizon artificiel et conservateur de cap
    get vacuum() {
        return this.running && this.rpm > 600;
    }

    // Éclairage des instruments (0 -> 1) : rhéostat, alimentation, disjoncteur
    get panelLighting() {
        return this.busPowered && this.breakers.instLts ? this.panelLights : 0;
    }

    // Feux extérieurs réellement allumés
    get lights() {
        const on = this.busPowered;
        return {
            beacon: on && this.switches.beacon, nav: on && this.switches.nav, strobe: on && this.switches.strobe,
            land: on && this.switches.land,
        };
    }

    // Carburant qui arrive au moteur
    get fuelAvailable() {
        if (this.fuelShutoff) return false;
        const [left, right] = this.fuel;
        return [left > 0, left > 0 || right > 0, right > 0][this.fuelSelector];
    }

    // Une seule magnéto (L ou R) : combustion moins complète, ~100 tr/min de moins (essai magnétos avant le décollage)
    get singleMagneto() {
        return this.magnetos === 1 || this.magnetos === 2;
    }

    // Richesse du mélange : 1 plein riche, baisse quand on appauvrit trop
    get _mixturePower() {
        return this.mixture >= 0.7 ? 1 : 0.55 + 0.45 * Math.max(0, (this.mixture - 0.1) / 0.6);
    }

    // Puissance du moteur (0 -> 1) : magnétos (une seule : ~4 % de moins), mixture
    get power() {
        if (!this.running) return 0;
        return (this.singleMagneto ? 0.96 : 1) * this._mixturePower;
    }

    // Débit carburant (gal/h)
    get fuelFlow() {
        return this.running ? (2.2 + 8.5 * this._throttle) * (0.45 + 0.55 * Math.min(1, this.mixture / 0.8)) : 0;
    }

    // Alarmes (panneau d'annonciateurs)
    get warnings() {
        return {
            lowFuelL: this.fuel[0] < LOW_FUEL, lowFuelR: this.fuel[1] < LOW_FUEL,
            oilPress: !this.running || this.rpm < 500,
            vacL: !this.vacuum, vacR: !this.vacuum,
            volts: !this.alternatorOn,
        };
    }

    // throttle : 0 -> 1 ; airspeed (m/s) : fait tourner l'hélice moteur coupé
    update(delta, throttle, airspeed) {
        this._throttle = throttle;
        // Démarreur : la clé tenue sur START lance le moteur (batterie, carburant, magnétos, mixture)
        const starting = this._crank > 0;
        if (starting) {
            this._crank -= delta;
            this._cranked += delta;
            const canStart = this.switches.masterBat && this.battery > 0.05 && this.fuelAvailable && this.mixture > 0.25;
            if (!this.running && canStart && this._cranked > START_TIME) {
                this.running = true;
                this._starve = 0;
                this.dispatchEvent(new Event('start'));
            }
            if (this._crank <= 0) {
                this.magnetos = 3;   // la clé revient sur BOTH
                this._changed();
            }
        }
        // Arrêts : magnétos coupées, étouffoir, panne sèche
        if (this.running) {
            if (this.magnetos === 0 || this.mixture < 0.08) this._stop();
            else if (!this.fuelAvailable) {
                this._starve += delta;
                if (this._starve > FUEL_STARVE_TIME) this._stop();
            } else this._starve = 0;
        }
        // Consommation, sur le(s) réservoir(s) choisi(s)
        const burn = this.fuelFlow * delta / 3600;
        if (burn > 0 && this.fuelAvailable) {
            const sides = this.fuelSelector === 1 ? [0, 1].filter((i) => this.fuel[i] > 0) : [this.fuelSelector === 0 ? 0 : 1];
            for (const i of sides) this.fuel[i] = Math.max(0, this.fuel[i] - burn / sides.length);
        }
        // Batterie : se décharge sans alternateur, se recharge avec
        if (this.switches.masterBat) {
            const load = 0.4 + (this.switches.avionics ? 0.3 : 0) + (this.switches.land ? 0.2 : 0)
                + (this.switches.pitotHeat ? 0.3 : 0) + (starting ? 4 : 0);
            this.battery = Math.max(0, Math.min(1, this.battery + (this.alternatorOn ? 1 / 600 : -load / BATTERY_LIFE) * delta));
        }
        // Régime : moteur (gaz, mixture) ou hélice entraînée par le vent relatif / le démarreur
        const target = this.running ? 750 + 1950 * throttle * this._mixturePower + airspeed * 4 - (this.singleMagneto ? 100 : 0)
            : starting && this.switches.masterBat && this.battery > 0.05 ? 280 : airspeed * 18;
        this.rpm += (target - this.rpm) * (1 - Math.exp(-(this.running ? 3 : 1.5) * delta));
    }

    _stop() {
        this.running = false;
        this.dispatchEvent(new Event('stop'));
    }

    _changed() {
        this.dispatchEvent(new Event('change'));
    }
}

export { Systems, BREAKERS, TOGGLES, MAGNETOS, FUEL_SELECTOR, TANK_CAPACITY, GALLON };
