// Systèmes du Robinson R44 Raven II, commandés depuis le cockpit (interrupteurs, clé, mixture, poignée des gaz,
// embrayage, régulateur) : même interface que Systems.js (Cessna) pour le simulateur (switches, lights, running,
// cranking, rpm, power, update, événements 'change', 'start', 'stop', 'startfail').
//
// Moteur Lycoming IO-540 (injection) relié au rotor par des courroies et une roue libre :
// - démarrage : batterie (MASTER BATT), embrayage débrayé, poignée des gaz fermée, mixture riche, clé sur START ;
// - embrayage (CLUTCH) : le vérin tend les courroies (~20 s, voyant CLUTCH allumé tant qu'il bouge) ; le rotor
//   s'entraîne peu à peu, le moteur ne doit pas passer sous ~50 % ;
// - régulateur (GOVERNOR, interrupteur sur le collectif) : au-dessus de 80 % de régime moteur, il tourne la poignée des
//   gaz pour tenir 102 % ; le corrélateur ouvre aussi les gaz quand on lève le collectif ;
// - roue libre : le moteur entraîne le rotor, jamais l'inverse (autorotation moteur coupé) ;
// - alarmes : klaxon et voyant LOW RPM sous 97 % de régime rotor (klaxon coupé collectif en bas), voyants ALT,
//   CLUTCH, STARTER ON, ROTOR BRAKE, LOW FUEL, GOV OFF, OIL.

const RATIO = 6.6625;                 // tours moteur par tour de rotor (100 % : 2 665 / 400 tr/min)
const ENGINE_100 = 2665;              // tr/min moteur à 100 %
const RPM_TO_RAD = Math.PI / 30;
const P_MAX = 153000;                 // W : 205 ch (puissance de décollage limitée du Raven II)
const Q_MAX = 700;                    // N·m de couple à pleine admission (le frottement en prend ~150 à 100 %)
const ENGINE_INERTIA = 1.6;           // kg·m² (vilebrequin, volant, poulie)
const CLUTCH_TIME = 20;               // s : tension des courroies
const CLUTCH_CAPACITY = 5000;         // N·m au rotor, courroies tendues (× tension³ : elles patinent au début)
const BELT_STIFFNESS = 12000;         // N·m par rad/s de glissement
const STARTER_TORQUE = 85;            // N·m (démarreur, à l'arrêt)
const STARTER_HOLD = 4;               // s de démarreur par appui sur START
const FUEL_MAIN = 29.5, FUEL_AUX = 17.2;   // gal US utilisables
const GPH_FULL = 17;                  // gal/h à pleine puissance
const BATTERY_LIFE = 1500;            // s sur la batterie seule
const KEY = ['OFF', 'R', 'L', 'BOTH', 'START'];

class R44Systems extends EventTarget {
    constructor() {
        super();
        this.reset();
    }

    // Prêt à décoller : moteur en marche, embrayé, régulateur, alternateur, feux
    reset() {
        this.switches = { masterBat: true, alternator: true, clutch: true, governor: true, nav: false, beacon: true,
            strobe: true, land: false, taxi: false, avionics: true, fuelPump: true };
        this.key = 3;
        this.mixture = 1;
        this.grip = 0.6;                  // poignée tournante des gaz (0 fermée -> 1 ouverte)
        this.clutch = 1;                  // tension des courroies (0 -> 1)
        this.rotorBrake = false;
        this.fuel = [FUEL_MAIN * 0.7, FUEL_AUX * 0.7];
        this.battery = 1;
        this.running = true;
        this.engineSpeed = ENGINE_100 * 1.02 * RPM_TO_RAD;
        this.rotorSpeed = 0;              // (copie de celle du modèle de vol, pour les alarmes)
        this.collective = 0;
        this.panelLights = 0;
        this.domeLight = 0;
        this.hobbs = 1234.5;
        this.brake = false;
        this.oilTemp = 85;
        this.cht = 190;
        this._starter = false;
        this._cranked = 0;
        this._time = 0;
        this._load = 0;
        this._governorIntegral = 0;
        this._changed();
    }

    // Tout éteint : moteur arrêté, débrayé, batterie coupée (départ au parking)
    coldAndDark() {
        Object.assign(this.switches, { masterBat: false, alternator: false, clutch: false, governor: false, nav: false,
            beacon: false, strobe: false, land: false, taxi: false, avionics: false, fuelPump: false });
        this.key = 0;
        this.grip = 0;
        this.clutch = 0;
        this.running = false;
        this.engineSpeed = 0;
        this._starter = false;
        this._changed();
    }

    // Interrupteur (id de switches) ; land : les deux phares ensemble
    toggle(id) {
        if (id === 'masterBat' || id in this.switches) this.switches[id] = !this.switches[id];
        if (id === 'strobe') this.switches.beacon = this.switches.strobe;
        this._changed();
    }

    // Clé : OFF, R, L, BOTH, START (step -1 / +1). START (clé à ressort) : le démarreur entraîne STARTER_HOLD s, puis
    // la clé revient sur BOTH ; tourner encore vers START relance le démarreur
    turnMagnetos(step) {
        this.key = Math.max(0, Math.min(4, this.key + Math.sign(step)));
        this._starter = this.key === 4;
        this._starterTimer = this._starter ? STARTER_HOLD : 0;
        this._changed();
    }

    // Clé directement sur une position (0 -> 4), depuis le cockpit
    setKey(position) {
        this.key = Math.max(0, Math.min(4, Math.round(position)));
        this._starter = this.key === 4;
        this._starterTimer = this._starter ? STARTER_HOLD : 0;
        this._changed();
    }

    releaseStarter() {
        if (this.key === 4) this.key = 3;
        this._starter = false;
        this._changed();
    }

    setMixture(value) {
        this.mixture = Math.max(0, Math.min(1, value));
        this._changed();
    }

    setGrip(value) {
        this.grip = Math.max(0, Math.min(1, value));
    }

    setPanelLights(value) {
        this.panelLights = Math.max(0, Math.min(1, value));
        this._changed();
    }

    setDomeLight(value) {
        this.domeLight = Math.max(0, Math.min(1, value));
    }

    turnFuelSelector() {}
    toggleFuelShutoff() {}

    get busPowered() {
        return this.switches.masterBat && (this.battery > 0.05 || this.alternatorOn);
    }

    get alternatorOn() {
        return this.switches.alternator && this.running && this.engineRpm > ENGINE_100 * 0.6;
    }

    get volts() {
        return this.busPowered ? (this.alternatorOn ? 28 : 24 * Math.min(1, 0.85 + this.battery * 0.15)) : 0;
    }

    get amps() {
        if (!this.switches.masterBat) return 0;
        return this.alternatorOn ? Math.max(0, 3 + (1 - this.battery) * 40) : -(6 + (this._starter ? 60 : 0));
    }

    get panelLighting() {
        return this.busPowered ? this.panelLights : 0;
    }

    get domeLighting() {
        return this.busPowered ? this.domeLight : 0;
    }

    // Avionique (NAV/COM KX 165, transpondeur KT 76A, boîte audio) : sur la batterie, pas de disjoncteurs à manœuvrer
    get avionicsPowered() { return this.busPowered; }
    get avionics2Powered() { return this.busPowered; }
    get breakers() { return { navcom1: true, navcom2: false, xpdr: true, dme: false, adf: false }; }
    get vacuum() { return true; }               // (instruments gyroscopiques électriques sur le R44)
    get turnCoordinatorPowered() { return this.busPowered; }
    get flapsPowered() { return true; }
    get fuelPumpRunning() { return this.switches.fuelPump && this.busPowered; }

    get lights() {
        const on = this.busPowered;
        return { nav: on && this.switches.nav, beacon: on && this.switches.beacon, strobe: on && this.switches.strobe,
            land: on && this.switches.land, taxi: on && this.switches.land };
    }

    get fuelAvailable() {
        return this.fuel[0] + this.fuel[1] > 0.05;
    }

    // Régime moteur (tr/min), comme Systems.rpm
    get rpm() {
        return this.engineSpeed / RPM_TO_RAD;
    }

    get engineRpm() {
        return this.rpm;
    }

    get enginePercent() {
        return this.rpm / ENGINE_100 * 100;
    }

    get rotorPercent() {
        return this.rotorSpeed / (400 * RPM_TO_RAD) * 100;
    }

    // Admission (0 -> 1) : poignée des gaz + corrélateur du collectif
    get throttle() {
        return Math.max(0, Math.min(1, this.grip + 0.45 * this.collective));
    }

    // Pression d'admission (inHg) : ~13 au ralenti, ~25 en vol stationnaire, 29 à pleine admission
    get manifoldPressure() {
        if (!this.running && this.engineSpeed < 5) return 29.6;
        return 10 + 19 * this.throttle * Math.min(1, this.rpm / 1200);
    }

    get power() {
        return this.running ? 1 : 0;
    }

    get fuelFraction() {
        return (this.fuel[0] + this.fuel[1]) / (FUEL_MAIN + FUEL_AUX);
    }

    get fuelFlow() {
        return this.running ? 3 + GPH_FULL * this._load : 0;
    }

    get cranking() {
        return this._starter && this.switches.masterBat && this.battery > 0.05;
    }

    get clutchMoving() {
        return this.switches.clutch ? this.clutch < 1 : this.clutch > 0;
    }

    // Voyants et klaxon
    get warnings() {
        const powered = this.busPowered;
        const rotor = this.rotorPercent;
        const lowRpm = powered && rotor < 97 && (this.running || rotor > 5);
        return {
            lowRpm,
            lowRpmHorn: lowRpm && this.collective > 0.03,   // (coupé collectif tout en bas)
            clutch: powered && this.clutchMoving,
            starter: powered && this.cranking,
            alt: powered && !this.alternatorOn,
            brake: powered && this.rotorBrake,
            lowFuel: powered && this.fuel[0] < 3,
            govOff: powered && !this.switches.governor,
            oil: powered && (!this.running || this.rpm < 1000),
        };
    }

    // Couple transmis au rotor (N·m) pour sa vitesse Ω (rad/s), sur dt secondes : intègre le régime moteur
    drive(rotorSpeed, dt) {
        this.rotorSpeed = rotorSpeed;
        const w = this.engineSpeed;
        // Couple de combustion : admission × couple maxi, moteur en marche et alimenté
        let combustion = 0;
        if (this.running) {
            // Admission : à papillon partiellement ouvert, la pression d'admission monte quand le régime baisse (le
            // moteur « tient » mieux sous la charge : il ne cale pas au premier effort)
            const throttle = 0.09 + 0.91 * this.throttle;
            const admission = Math.min(1, throttle * Math.min(2.5, Math.max(1, (0.6 * ENGINE_100 * RPM_TO_RAD / Math.max(1, w)) ** 0.8)));
            const mixture = this.mixture > 0.6 ? 1 : this.mixture / 0.6;
            combustion = Q_MAX * admission * mixture * (this.key === 1 || this.key === 2 ? 0.96 : 1);
        }
        const starter = this.cranking ? STARTER_TORQUE * Math.max(0, 1 - w / 60) : 0;
        // Frottements et pompage (compressions à l'arrêt : le moteur s'arrête vite)
        const friction = w > 0.01 ? 18 + 0.0018 * w * w + (this.running ? 0 : 25) : 0;
        // Courroies : glissent tant qu'elles ne sont pas tendues ; roue libre (le rotor n'entraîne jamais le moteur)
        const slip = w / RATIO - rotorSpeed;
        const capacity = CLUTCH_CAPACITY * this.clutch ** 4;
        const belt = slip > 0 ? Math.min(capacity, BELT_STIFFNESS * this.clutch * slip) : 0;
        const net = combustion + starter - friction - belt / RATIO;
        this.engineSpeed = Math.max(0, w + net / ENGINE_INERTIA * dt);
        this._load = this.running ? Math.min(1, Math.max(0, belt * rotorSpeed / P_MAX)) : 0;
        return belt;
    }

    // delta (s) ; collective : pas collectif (0 -> 1) ; airspeed (m/s)
    update(delta, collective = 0) {
        this._time += delta;
        this.collective = collective;
        const was = this.running;
        // Clé relâchée : revient de START sur BOTH (moteur parti, ou au bout de STARTER_HOLD s)
        if (this._starter) {
            this._starterTimer -= delta;
            if (this._starterTimer <= 0 || (this.running && this.rpm > 900)) {
                const failed = !this.running;
                this.releaseStarter();
                // Démarrage raté : pourquoi (message pour le pilote)
                if (failed) this.dispatchEvent(new CustomEvent('startfail', {
                    detail: this._startFailure() ?? 'Le moteur n\'est pas parti : recommencez (clé sur START)' }));
            }
        }
        // Démarreur : clé sur START, batterie ; le moteur part dès qu'il tourne assez, mixture riche, gaz fermés
        if (this.cranking && !this.running) {
            this._cranked += delta;
            if (this.rpm > 180 && this._cranked > 1.3 && !this._startFailure()) {
                this.running = true;
                this.dispatchEvent(new Event('start'));
            }
        } else if (!this.cranking) this._cranked = 0;
        // Arrêt : clé sur OFF, mixture coupée, panne sèche, moteur calé (trop chargé)
        if (this.running) {
            if (this.key === 0 || this.mixture < 0.1 || !this.fuelAvailable) this._stop();
            else if (this.rpm < 350 && !this.cranking) this._stop();
        }
        // Embrayage : le vérin tend (ou détend) les courroies, batterie nécessaire
        if (this.busPowered) {
            const target = this.switches.clutch ? 1 : 0;
            const before = this.clutch;
            this.clutch += Math.max(-delta / 6, Math.min(delta / CLUTCH_TIME, target - this.clutch));
            if ((before < 1 && this.clutch >= 1) || (before > 0 && this.clutch <= 0)) this._changed();
        }
        // Régulateur : au-dessus de 80 % moteur, poignée tournée pour tenir 102 % (rotor) ; coupé, la poignée reste là
        if (this.switches.governor && this.busPowered && this.running && this.enginePercent > 80) {
            const error = 102 - this.enginePercent;
            this._governorIntegral = Math.max(-0.6, Math.min(0.6, this._governorIntegral + error * 0.02 * delta));
            this.grip = Math.max(0, Math.min(1, this.grip + (error * 0.06 + this._governorIntegral * 0.2) * delta));
        } else this._governorIntegral = 0;
        // Carburant : réservoir principal, puis auxiliaire (ils communiquent)
        const burn = this.fuelFlow * delta / 3600;
        if (burn > 0) {
            if (this.fuel[1] > 0) this.fuel[1] = Math.max(0, this.fuel[1] - burn);
            else this.fuel[0] = Math.max(0, this.fuel[0] - burn);
        }
        // Batterie et températures
        if (this.switches.masterBat) {
            const load = 0.5 + (this.switches.land ? 0.3 : 0) + (this.cranking ? 5 : 0);
            this.battery = Math.max(0, Math.min(1, this.battery + (this.alternatorOn ? 1 / 500 : -load / BATTERY_LIFE) * delta));
        }
        const hot = this.running ? 80 + 25 * this._load : 15;
        this.oilTemp += (hot - this.oilTemp) * (1 - Math.exp(-delta / 240));
        this.cht += ((this.running ? 170 + 60 * this._load : 15) - this.cht) * (1 - Math.exp(-delta / 90));
        if (this.running) this.hobbs += delta / 3600;
        if (this.running !== was) this._changed();
    }

    _startFailure() {
        if (!this.switches.masterBat) return 'Démarreur sans effet : MASTER BATT coupé';
        if (this.battery <= 0.05) return 'Batterie à plat';
        if (this.mixture < 0.6) return 'Mixture tirée : poussez la commande rouge (riche)';
        if (this.grip > 0.25) return 'Gaz trop ouverts : fermez la poignée tournante (touche Y)';
        if (this.key < 3 && this.key !== 4) return 'Clé : passez sur START';
        if (!this.fuelAvailable) return 'Réservoirs vides';
        if (this.clutch > 0.2) return 'Embrayé : débrayez (CLUTCH) avant de démarrer';
        return null;
    }

    _stop() {
        this.running = false;
        this.dispatchEvent(new Event('stop'));
    }

    _changed() {
        this.dispatchEvent(new Event('change'));
    }
}

export { R44Systems, KEY as R44_KEY, RATIO as R44_RATIO, ENGINE_100 as R44_ENGINE_100 };
