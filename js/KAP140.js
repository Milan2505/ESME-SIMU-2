// Pilote automatique Bendix/King KAP 140 deux axes avec présélection d'altitude (lot 4) : module pur, sans DOM ni three.js
// (testé par tests/autopilot.test.js). Il agit sur les gouvernes du modèle réaliste par des servos (PlaneControls :
// setAutopilotOutput), jamais sur l'attitude, et sur le trim par son servo de trim.
//
// Sources : KAP 140 Pilot's Guide 006-18034-0000 rév. 3 (Honeywell, 2005 ; pages citées ci-dessous) ; supplément
// S15 du POH 172R « Bendix/King KAP 140 2 Axis Autopilot » (172RPHUS-S15-02, rév. 2, 2002). Cessna n'a publié aucun
// supplément KAP 140 pour le 172P (le KAP 140 s'y monte par STC, avec un manuel que nous n'avons pas) : les valeurs du
// 172R tiennent lieu de référence.
// - AP : engage ROL (ailes à plat) et VS à la vitesse verticale du moment ; un nouvel appui désengage (p. 9, 12, 58, 83).
// - HDG : vire vers le curseur de cap du conservateur, par le plus court ; bascule HDG / ROL (p. 9, 13, 83).
// - NAV, APR, REV : armés (« ARM ») tant que l'écart dépasse ~2 à 3 points, puis capture ; avec un conservateur simple,
//   la route de référence est le curseur de cap (HDG clignote 5 s pour le rappeler), interception à 45° (p. 15-17).
//   APR arme aussi le glide (GS ARM, puis GS : ALT se désengage) ; REV : localizer inversé, glide inhibé.
// - ALT : tient l'altitude du moment, dépassement ~10 % de la VS établie ; bascule ALT / VS (p. 56, 59, 84).
// - UP / DN : VS ±100 ft/min par appui ; en ALT, ±20 ft par appui (p. 56, 58-59, 84, 86-87).
// - ARM : arme la capture de l'altitude présélectionnée (ALT ARM), armée d'elle-même quand on tourne les boutons AP
//   engagé (p. 85, 89).
// - Déconnexion : « AP » clignote 5 s avec une alarme sonore de 2 s (p. 10, 57, 85) ; bouton A/P DISC du manche, bouton
//   AP, coupure d'alimentation (disjoncteur AUTO PILOT, AVIONICS) ; le trim électrique manuel désengage (S15-5).
// - Test au démarrage (PFT) : « PFT n », puis tous les segments et l'alarme ; engagement verrouillé avant (p. 8, S15-5).
// - PT : flèche clignotante du sens de trim requis (servo de trim en marche) ; PT fixe : panne (p. 56, 85).
// - Alerteur : ALERT de 1 000 à 200 ft de l'altitude choisie ; 5 tonalités courtes à 1 000 ft en approche, et en
//   quittant la bande de ±200 ft (p. 85, 88-89) ; marche AP désengagé.
// Non relu (aucune valeur chiffrée dans ces sources) : inclinaison limitée au taux standard (3°/s, d'après un manuel
// d'installation secondaire), plage de VS ±2 000 ft/min, gains des boucles, vitesses des servos, durée du PFT.

const KT = 0.514444, FT = 0.3048, G = 9.81, DEG = Math.PI / 180;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;

// Gains de la boucle de tangage (non relus : réglés sur le modèle réaliste, tests/autopilot.test.js)
export const PITCH = { vs: 0.004, integral: 0.0006, attitude: 0.06, rate: 0.05, max: 0.45, slew: 0.8, trimAbove: 0.03 };

const LEAD = 2;   // s : anticipation de la sortie de virage (non relue, réglée par les tests)
export const KAP = {
    pftTime: 6,             // s : test au démarrage (« PFT 1 » à « PFT 6 »), puis 1 s de segments (non relu)
    segmentsTime: 1,
    disconnectFlash: 5,     // s : « AP » clignote (p. 10)
    hdgFlash: 5,            // s : « HDG » clignote en NAV / APR / REV (p. 15)
    standardRate: 3,        // °/s : virage au taux standard (non relu)
    maxBank: 25,            // ° : inclinaison au plus (taux standard à 140 kt ≈ 21°, non relu)
    vsStep: 100,            // ft/min par appui (p. 56)
    vsLimit: 2000,          // ft/min (non relu)
    altStep: 20,            // ft par appui en ALT (p. 59)
    captureDots: 0.6,       // écart (pleine échelle = 1) sous lequel NAV / APR capture (~2 à 3 points sur 5, p. 15)
    intercept: 45,          // ° : angle d'interception (p. 17)
    alertFar: 1000,         // ft
    alertNear: 200,         // ft
};

// Modes de roulis et de tangage, et état affiché
export class KAP140 extends EventTarget {
    constructor() {
        super();
        this.selected = 3000;      // altitude présélectionnée (ft)
        this.reset();
    }

    // Avion éteint (ou disjoncteur tiré) : tout à zéro ; le test refait au prochain allumage
    reset() {
        this.powered = false;
        this.engaged = false;
        this.lateral = null;       // 'ROL' | 'HDG' | 'NAV' | 'APR' | 'REV'
        this.lateralArm = null;    // 'NAV' | 'APR' | 'REV'
        this.vertical = null;      // 'VS' | 'ALT' | 'GS'
        this.altArm = false;
        this.gsArm = false;
        this.vsTarget = 0;         // ft/min
        this.altTarget = 0;        // ft
        this._pft = 0;             // s depuis la mise sous tension
        this._apFlash = 0;
        this._hdgFlash = 0;
        this._readout = null;      // { kind, value, until }
        this._integralPitch = 0;
        this._integralCourse = 0;
        this._pitchRef = null;
        this._lastPitch = null;
        this._trim = null;         // 'up' | 'down' | null
        this._servoPitch = 0;
        this._servoRoll = 0;
        this._lastBank = null;
        this._alertWas = null;
        this._time = 0;
        this.failP = this.failR = false;
    }

    get ready() { return this.powered && this._pft >= KAP.pftTime + KAP.segmentsTime; }

    _emit(type, detail = null) { this.dispatchEvent(new CustomEvent(type, { detail })); }

    // Déconnexion (bouton AP, A/P DISC, trim manuel, alimentation, panne) : « AP » clignote 5 s, alarme 2 s
    disconnect(reason = 'manuelle') {
        if (!this.engaged) return;
        this.engaged = false;
        this.lateral = this.lateralArm = this.vertical = null;
        this.altArm = this.gsArm = false;
        this._integralPitch = this._integralCourse = 0;
        this._pitchRef = this._lastPitch = null;
        this._servoPitch = this._servoRoll = 0;
        this._trim = null;
        this._apFlash = KAP.disconnectFlash;
        this._emit('disconnect', reason);
    }

    // Boutons de la façade (id sans 'kap:') ; s : état de l'avion (voir update), pour les modes qui prennent une valeur
    press(button, s) {
        if (!this.ready) return;
        const engage = () => {
            if (this.engaged) return true;
            this.engaged = true;
            this.lateral = 'ROL';
            this.vertical = 'VS';
            this.vsTarget = clamp(Math.round(s.vs / KAP.vsStep) * KAP.vsStep, -KAP.vsLimit, KAP.vsLimit);
            this._readout = { kind: 'FPM', value: this.vsTarget, until: this._time + 3 };
            this._integralPitch = 0;
            this._pitchRef = null;
            this._emit('engage');
            return false;
        };
        switch (button) {
            case 'ap':
                if (this.engaged) this.disconnect('bouton AP');
                else engage();
                break;
            case 'disc':
                this.disconnect('A/P DISC');
                break;
            case 'hdg':
                if (!this.engaged) { engage(); this.lateral = 'HDG'; break; }
                this.lateral = this.lateral === 'HDG' ? 'ROL' : 'HDG';
                this.lateralArm = null;
                break;
            case 'nav': case 'apr': case 'rev': {
                const mode = button.toUpperCase();
                if (!this.engaged) engage();
                if (this.lateral === mode || this.lateralArm === mode) {   // de nouveau : désarme, retour en ROL
                    this.lateralArm = null;
                    if (this.lateral === mode) this.lateral = 'ROL';
                    this.gsArm = false;
                    break;
                }
                this.lateralArm = mode;
                if (this.lateral === 'NAV' || this.lateral === 'APR' || this.lateral === 'REV') this.lateral = 'HDG';
                if (this.lateral === 'ROL') this.lateral = 'HDG';
                this._hdgFlash = KAP.hdgFlash;
                this.gsArm = mode === 'APR' && Boolean(s.nav?.isIls);
                break;
            }
            case 'alt':
                if (!this.engaged) break;
                if (this.vertical === 'ALT') { this.vertical = 'VS'; this.vsTarget = 0; }
                else if (this.vertical !== 'GS') { this.vertical = 'ALT'; this.altTarget = Math.round(s.altitude / 10) * 10; }
                break;
            case 'up': case 'dn': {
                if (!this.engaged) break;
                const sign = button === 'up' ? 1 : -1;
                if (this.vertical === 'ALT') {
                    this.altTarget += sign * KAP.altStep;
                    this._readout = { kind: 'FT', value: this.altTarget, until: this._time + 3 };
                } else if (this.vertical === 'VS') {
                    // (premier appui avec la présélection affichée : montre seulement la VS commandée, p. 58)
                    if (!(this._readout?.kind === 'FPM' && this._time < this._readout.until)) {
                        this._readout = { kind: 'FPM', value: this.vsTarget, until: this._time + 3 };
                        break;
                    }
                    this.vsTarget = clamp(this.vsTarget + sign * KAP.vsStep, -KAP.vsLimit, KAP.vsLimit);
                    this._readout = { kind: 'FPM', value: this.vsTarget, until: this._time + 3 };
                }
                break;
            }
            case 'arm':
                this.altArm = !this.altArm;
                break;
            case 'baro':
                this._readout = { kind: 'HPA', value: s.baro ?? 1013, until: this._time + 3 };
                break;
        }
        this._emit('change');
    }

    // Boutons rotatifs de présélection : outer ±1 000 ft, inner ±100 ft (pas non relus) ; AP engagé : ALT ARM s'arme
    turn(knob, step) {
        if (!this.ready) return;
        this.selected = clamp(this.selected + step * (knob === 'outer' ? 1000 : 100), 0, 18000);
        this._readout = null;
        if (this.engaged && this.vertical !== 'GS') this.altArm = true;
        this._emit('change');
    }

    // Un pas : dt (s) ; s : { powered, heading (° du conservateur), bug (°), altitude (ft lus), vs (ft/min), bank (rad,
    // + = gauche), pitch (rad), ias (m/s), tas (m/s), onGround, nav: { available, deviation (pleine échelle ±1, + = route
    // à droite), isIls, glide: bool, glideslope (+ = au-dessus de la pente, pleine échelle ±1), groundSpeed (m/s) } ,
    // trimFree (bool : trim encore loin de sa butée dans le sens voulu), manualTrim (trim manuel actionné) }.
    // Rend la sortie des servos { pitch, roll, trim (-1, 0, 1) } ou null (désengagé)
    update(dt, s) {
        this._time += dt;
        this._apFlash = Math.max(0, this._apFlash - dt);
        this._hdgFlash = Math.max(0, this._hdgFlash - dt);
        // Alimentation : à l'allumage, test (PFT) ; coupure : déconnexion
        if (!s.powered) {
            if (this.powered) { this.disconnect('alimentation'); const sel = this.selected; this.reset(); this.selected = sel; }
            return null;
        }
        if (!this.powered) { this.powered = true; this._pft = 0; }
        const before = this._pft;
        this._pft += dt;
        if (before < KAP.pftTime + KAP.segmentsTime && this._pft >= KAP.pftTime + KAP.segmentsTime) this._emit('pft');
        this._alerter(s);
        if (!this.engaged) { this._lastBank = s.bank; return null; }
        if (s.manualTrim) { this.disconnect('trim manuel'); return null; }
        if (s.onGround) { this.disconnect('au sol'); return null; }
        const lateral = this._lateral(dt, s);
        const vertical = this._vertical(dt, s);
        return { roll: lateral, pitch: vertical.pitch, trim: vertical.trim };
    }

    // --- Roulis : inclinaison visée par mode, puis servo de roulis (inclinaison et vitesse de roulis) ---
    _lateral(dt, s) {
        const nav = s.nav ?? {};
        // Armé : capture quand l'écart est assez petit (ou tout de suite s'il l'est déjà)
        if (this.lateralArm && nav.available && Math.abs(nav.deviation) < KAP.captureDots) {
            this.lateral = this.lateralArm;
            this.lateralArm = null;
            this._integralCourse = 0;
            this._emit('capture', this.lateral);
        }
        if (this.lateral !== 'APR' && this.vertical === 'GS') this.vertical = 'VS';
        let headingTarget = null;
        // Armé loin de la route (curseur calé sur la route) : interception à 45° vers elle (p. 17)
        if (this.lateral === 'HDG' && this.lateralArm && nav.available) {
            const dev = this.lateralArm === 'REV' ? -nav.deviation : nav.deviation;
            headingTarget = s.bug + KAP.intercept * Math.sign(dev);
        } else if (this.lateral === 'HDG') headingTarget = s.bug;
        else if (this.lateral === 'NAV' || this.lateral === 'APR' || this.lateral === 'REV') {
            if (!nav.available) headingTarget = s.heading;   // signal perdu : cap tenu
            else {
                // Route = curseur de cap (conservateur simple) ; écart -> correction d'interception, bornée à 45°, plus un
                // intégrateur lent pour le vent de travers
                const dev = this.lateral === 'REV' ? -nav.deviation : nav.deviation;
                const k = this.lateral === 'NAV' ? 60 : 90;   // ° par pleine échelle (le localizer est 4 fois plus fin)
                this._integralCourse = clamp(this._integralCourse + dev * dt * (this.lateral === 'NAV' ? 0.03 : 0.06), -10, 10);
                headingTarget = s.bug + clamp(dev * k + this._integralCourse, -KAP.intercept, KAP.intercept);
            }
        }
        // Inclinaison visée (+ = à droite) : ailes à plat (ROL), ou virage vers le cap au taux standard au plus
        let bankTarget = 0;
        if (headingTarget !== null) {
            // (anticipation : le taux de virage du moment, sur LEAD s, pour sortir du virage sans dépasser le cap)
            // (taux de virage déduit de l'inclinaison, g tan φ / V : le lacet du roulis hollandais ne s'y mêle pas)
            this._turnRate = Math.tan(-s.bank) * G / Math.max(s.tas, 25) / DEG;
            const err = wrap180(headingTarget - s.heading) - this._turnRate * LEAD;
            const standard = Math.atan(Math.max(s.tas, 25) * KAP.standardRate * DEG / G) / DEG;
            const limit = Math.min(KAP.maxBank, standard);
            bankTarget = clamp(err * 1.2, -limit, limit);
        }
        this._lastHeading = s.heading;
        const bank = -s.bank / DEG;   // + = à droite
        const last = this._lastBank === null ? s.bank : this._lastBank;
        const rollRate = -(s.bank - last) / DEG / Math.max(dt, 1e-3);
        this._lastBank = s.bank;
        // Servo (+ = manche à droite) : proportionnel à l'erreur d'inclinaison, amorti par la vitesse de roulis, vitesse
        // du servo limitée
        const wanted = clamp(0.045 * (bankTarget - bank) - 0.02 * rollRate, -0.35, 0.35);
        this._servoRoll += clamp(wanted - this._servoRoll, -1.5 * dt, 1.5 * dt);
        return -this._servoRoll;   // PlaneControls : roll + = à gauche
    }

    // --- Tangage : VS, ALT (et capture), GS ; servo de tangage, puis trim automatique qui le décharge ---
    _vertical(dt, s) {
        const nav = s.nav ?? {};
        // Glide armé : capture quand l'avion arrive sur la pente (par-dessous) ; ALT se désengage
        if (this.gsArm && this.lateral === 'APR' && nav.glide && nav.glideslope > -0.15) {
            this.gsArm = false;
            this.vertical = 'GS';
            this.altArm = false;
            this._emit('capture', 'GS');
        }
        // Capture de l'altitude présélectionnée : à ~10 % de la VS de l'altitude (p. 59), au moins 50 ft
        if (this.altArm && this.vertical === 'VS') {
            const toGo = this.selected - s.altitude;
            if (Math.sign(toGo) === Math.sign(s.vs || toGo) && Math.abs(toGo) < Math.max(50, Math.abs(s.vs) * 0.1)) {
                this.vertical = 'ALT';
                this.altTarget = this.selected;
                this.altArm = false;
                this._emit('capture', 'ALT');
            }
        }
        let vsCommand;
        if (this.vertical === 'ALT') vsCommand = clamp((this.altTarget - s.altitude) * 4, -700, 700);
        else if (this.vertical === 'GS') {
            const descent = (nav.groundSpeed ?? s.tas) / KT * 101.27 * Math.tan(3 * DEG);   // ft/min sur 3°
            vsCommand = -descent - clamp(nav.glideslope ?? 0, -1, 1) * 400;
        } else vsCommand = this.vsTarget;
        // Servo (+ = cabrer) : PI sur l'erreur de VS (ft/min) ; vitesse limitée ; en dessous de ~70 KIAS, on protège
        // contre la montée qui mène au décrochage (le guide le signale p. 58 : la limite basse d'emploi est 70 KIAS)
        const ias = s.ias / KT;
        if (ias < 65 && vsCommand > 0) vsCommand *= clamp((ias - 55) / 10, 0, 1);
        // Boucle externe : assiette visée = assiette d'équilibre (intégrateur) + correction de VS ; boucle interne : servo
        // de tangage sur l'écart d'assiette, amorti par la vitesse de tangage (gains : P.GAINS)
        const P = PITCH;
        const err = vsCommand - s.vs;
        const pitchDeg = s.pitch / DEG;
        if (this._pitchRef === null) this._pitchRef = pitchDeg;
        this._pitchRef = clamp(this._pitchRef + err * P.integral * dt, -10, 15);
        const pitchTarget = clamp(this._pitchRef + err * P.vs, -10, 15);
        const last = this._lastPitch ?? pitchDeg;
        const q = (pitchDeg - last) / Math.max(dt, 1e-3);
        this._lastPitch = pitchDeg;
        const wanted = clamp(P.attitude * (pitchTarget - pitchDeg) - P.rate * q, -P.max, P.max);
        this._servoPitch += clamp(wanted - this._servoPitch, -P.slew * dt, P.slew * dt);
        // Trim automatique : le servo de trim décharge le servo de tangage quand il tient un effort (PT : flèche du sens)
        let trim = 0;
        if (this._servoPitch > P.trimAbove) trim = 1;
        else if (this._servoPitch < -P.trimAbove) trim = -1;
        if (trim && s.trimFree === false) trim = 0;
        this._trim = trim > 0 ? 'up' : trim < 0 ? 'down' : null;
        return { pitch: this._servoPitch, trim };
    }

    // Alerteur d'altitude : ALERT de 1 000 à 200 ft de l'altitude choisie ; tonalités en approche et en la quittant
    _alerter(s) {
        const gap = Math.abs(this.selected - s.altitude);
        const zone = gap > KAP.alertFar ? 'far' : gap > KAP.alertNear ? 'near' : 'on';
        if (this._alertWas === 'far' && zone === 'near') this._emit('alert', 'approche');
        if (this._alertWas === 'on' && zone === 'near') this._emit('alert', 'quitte');
        this._alertWas = zone;
        this._alertZone = zone;
    }

    // État affiché (Panel172 : s.kap)
    display() {
        if (!this.powered) return { powered: false };
        const t = this._time;
        if (this._pft < KAP.pftTime) return { powered: true, pft: 1 + Math.floor(this._pft / KAP.pftTime * 6) };
        if (this._pft < KAP.pftTime + KAP.segmentsTime) return { powered: true, pft: null, allSegments: true };
        const flashOn = Math.floor(t * 2) % 2 === 0;
        const readout = this._readout && t < this._readout.until ? this._readout
            : this.engaged && this.vertical === 'VS' ? null
            : { kind: 'FT', value: this.selected };
        let lateral = this.lateral;
        if (lateral === 'HDG' && this._hdgFlash > 0 && !flashOn) lateral = null;
        return {
            powered: true, pft: null, allSegments: false,
            ap: this.engaged ? 'on' : this._apFlash > 0 ? (flashOn ? 'flash' : 'off') : 'off',
            lateral, lateralArm: this.lateralArm, vertical: this.vertical, altArm: this.altArm, gsArm: this.gsArm,
            trim: this._trim && flashOn ? this._trim : null,
            alert: this._alertZone === 'near' || (this._alertZone === 'on' && false),
            readout: readout ?? { kind: 'FPM', value: this.vsTarget },
            failP: this.failP, failR: this.failR,
        };
    }
}

export { FT };
