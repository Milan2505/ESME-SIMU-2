// Radios et réglages du tableau de bord du Cessna 172 : boîte de mélange audio (KMA 26), deux NAV/COM (KX 155),
// DME (KN 62), transpondeur (KT 76), ADF, horloge / thermomètre / voltmètre (Davtron M803), calage altimétrique,
// curseur de cap et recalage du conservateur de cap, réglage de la maquette de l'horizon.
// Les fréquences sont en kHz (entiers) pour éviter les arrondis : 118300 = 118,300 MHz.
// L'état est lu par la cabine (Panel172.js) ; simulator.js relie les radios au contrôle aérien et aux balises.

const COM = { min: 118000, max: 136975, step: 25 };
const NAV = { min: 108000, max: 117950, step: 50 };
const XPDR_MODES = ['OFF', 'SBY', 'ON', 'ALT', 'TST'];
const DME_MODES = ['RMT', 'FREQ', 'GS/T'];
const DAVTRON_TOP = ['E', 'F', 'C'];             // volts, °F, °C
const DAVTRON_BOTTOM = ['UT', 'LT', 'FT', 'ET']; // heure UTC, heure locale, temps de vol, chronomètre
const AUDIO_BUTTONS = ['com1', 'com2', 'nav1', 'nav2', 'dme', 'mkr', 'adf', 'spkr'];
const DG_DRIFT = 0.004;                          // dérive du conservateur de cap (°/s : ~3,5° en 15 min)

const formatCom = (khz) => (khz / 1000).toFixed(3);
const formatNav = (khz) => (khz / 1000).toFixed(2);
const parseFrequency = (text) => Math.round(Number(text) * 1000);
const wrap360 = (d) => ((d % 360) + 360) % 360;

// Bouton double concentrique : l'extérieur change les MHz, l'intérieur les kHz (sans retenue sur les MHz)
function tune(khz, range, outer, step) {
    let mhz = Math.floor(khz / 1000), rest = khz - mhz * 1000;
    const minMhz = Math.floor(range.min / 1000), maxMhz = Math.floor(range.max / 1000);
    if (outer) mhz = mhz + step > maxMhz ? minMhz : mhz + step < minMhz ? maxMhz : mhz + step;
    else rest = (rest + step * range.step + 1000) % 1000;
    return Math.min(range.max, Math.max(range.min, mhz * 1000 + rest));
}

class Avionics extends EventTarget {
    constructor() {
        super();
        this.reset();
    }

    // cold : avion éteint au parking (conservateur de cap à recaler, chronomètre à zéro)
    reset(cold = false) {
        this.com1 = { active: 118300, standby: 121500 };
        this.com2 = { active: 124550, standby: 121500 };
        this.nav1 = { active: 113500, standby: 110300 };
        this.nav2 = { active: 113500, standby: 108000 };
        this.units = { navcom1: true, navcom2: true, dme: true };    // boutons marche des appareils
        this.xpdr = { code: '7000', mode: cold ? 'SBY' : 'ALT', identUntil: 0 };
        this.dme = { mode: 'RMT' };
        this.audio = { mic: 'com1', com1: true, com2: false, nav1: false, nav2: false, dme: false, mkr: false, adf: false, spkr: true };
        this.davtron = { top: 0, bottom: 0, flightStart: null, timerStart: null };
        this.baro = 1013;            // calage de l'altimètre (hPa)
        this.hdgBug = 0;             // curseur de cap (°)
        this.dgOffset = cold ? (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10) : 0;   // écart du conservateur
        this._driftSign = Math.random() < 0.5 ? -1 : 1;
        this.aiOffset = 0;           // maquette de l'horizon (mm, + = vers le haut)
        this.obs2 = 0;               // route sélectionnée sur le VOR 2
        this.adfCard = 0;            // rose mobile de l'ADF
        this._changed();
    }

    // Appareils alimentés (barres avionique, disjoncteurs, boutons marche) d'après les systèmes de l'avion
    powered(systems) {
        const bus1 = systems.avionicsPowered, bus2 = systems.avionics2Powered, b = systems.breakers;
        return {
            navcom1: bus1 && b.navcom1 && this.units.navcom1,
            navcom2: bus2 && b.navcom2 && this.units.navcom2,
            xpdr: bus1 && b.xpdr && this.xpdr.mode !== 'OFF',
            dme: bus2 && b.dme && this.units.dme,
            adf: bus2 && b.adf,
        };
    }

    // COM qui émet (sélecteur micro de la boîte audio)
    get micCom() {
        return this[this.audio.mic];
    }

    // Une commande cliquée : step -1 / +1 (côté cliqué ou molette) ; fine : Maj (pas plus grand)
    use(id, step, fine = false) {
        const [unit, part] = id.split(':');
        if (unit === 'com1' || unit === 'com2' || unit === 'nav1' || unit === 'nav2') {
            const radio = this[unit], range = unit.startsWith('com') ? COM : NAV;
            if (part === 'swap') [radio.active, radio.standby] = [radio.standby, radio.active];
            else radio.standby = tune(radio.standby, range, part === 'outer', step);
        } else if (unit === 'power') this.units[part] = !this.units[part];
        else if (unit === 'xpdr') {
            if (part === 'mode') this.xpdr.mode = XPDR_MODES[Math.max(0, Math.min(4, XPDR_MODES.indexOf(this.xpdr.mode) + step))];
            else if (part === 'ident') this.xpdr.identUntil = performance.now() + 18000;
            else {
                const i = Number(part.slice(1)), digits = [...this.xpdr.code];
                digits[i] = String((Number(digits[i]) + step + 8) % 8);
                this.xpdr.code = digits.join('');
            }
        } else if (unit === 'dme') this.dme.mode = DME_MODES[(DME_MODES.indexOf(this.dme.mode) + (step > 0 ? 1 : 2)) % 3];
        else if (unit === 'audio') {
            if (part === 'mic') this.audio.mic = this.audio.mic === 'com1' ? 'com2' : 'com1';
            else this.audio[part] = !this.audio[part];
        } else if (unit === 'davtron') {
            const d = this.davtron;
            if (part === 'select') d.top = (d.top + 1) % DAVTRON_TOP.length;
            else if (DAVTRON_BOTTOM[d.bottom] === 'ET' && step > 0) d.timerStart = d.timerStart === null ? performance.now() : null;
            else d.bottom = (d.bottom + 1) % DAVTRON_BOTTOM.length;
        } else if (unit === 'baro') this.baro = Math.max(950, Math.min(1050, this.baro + step * (fine ? 10 : 1)));
        else if (unit === 'hdgBug') this.hdgBug = wrap360(this.hdgBug + step * (fine ? 10 : 1));
        else if (unit === 'dg') this.dgOffset += step * (fine ? 10 : 1);
        else if (unit === 'ai') this.aiOffset = Math.max(-6, Math.min(6, this.aiOffset + step * 0.5));
        else if (unit === 'obs2') this.obs2 = wrap360(Math.round(this.obs2) + step * (fine ? 10 : 1));
        else if (unit === 'adf') this.adfCard = wrap360(this.adfCard + step * (fine ? 10 : 1));
        else return false;
        this._changed();
        return true;
    }

    // Une COM affiche une autre fréquence (changement fait depuis la fenêtre Tour) : l'ancienne passe en attente
    showOnCom(com, khz) {
        if (this[com].active === khz) return;
        this[com].standby = this[com].active;
        this[com].active = khz;
        this._changed();
    }

    // ILS (touche I, bouton en vue extérieure) : affiche la fréquence ILS sur la NAV 1, ou revient à la précédente
    toggleNav1(khz) {
        const nav = this.nav1;
        if (nav.active === khz) [nav.active, nav.standby] = [nav.standby, nav.active];
        else [nav.active, nav.standby] = [khz, nav.active];
        this._changed();
    }

    // delta (s) ; onGround / running : temps de vol (Davtron FT) ; vacuum : le conservateur dérive
    update(delta, { airborne, vacuum }) {
        const d = this.davtron;
        if (airborne && d.flightStart === null) d.flightStart = performance.now();
        if (vacuum) this.dgOffset += this._driftSign * DG_DRIFT * delta;
    }

    _changed() {
        this.dispatchEvent(new Event('change'));
    }
}

export { Avionics, XPDR_MODES, DME_MODES, DAVTRON_TOP, DAVTRON_BOTTOM, AUDIO_BUTTONS, formatCom, formatNav, parseFrequency };
