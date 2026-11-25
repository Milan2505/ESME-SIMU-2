// « Le moniteur montre » (lot 6) : pilote du moniteur des leçons d'initiation. Module pur, sans DOM ni three.js (testé par
// tests/instructor-pilot.test.js sur le banc du modèle réaliste). Comme le KAP 140 (js/KAP140.js), il agit sur les
// gouvernes par le canal du pilote automatique de PlaneControls (setAutopilotOutput : tangage, roulis, lacet, trim), jamais
// sur l'attitude ; les gaz sont rendus à part (sortie throttle), posés par l'appelant sur la manette.
//
// Consignes (plan), toutes facultatives, données à chaque pas par l'étape de la leçon (step.demo(c) dans Initiation.js) :
//   Roulis : bank (° visés, + = à droite) ; ou heading (° : virage vers ce cap, maxBank au plus, 30° par défaut) ; sans
//     l'un ni l'autre, ailes à plat. aileron : braquage imposé (-1..1, + = manche à gauche, convention de PlaneControls).
//   Tangage, par ordre de priorité : pitch (assiette, °) ; altitude (ft lus à l'altimètre) ; vs (ft/min) ; speed (KIAS,
//     tenue par l'assiette : plané, montée). elevator : braquage imposé (-1..1, + = cabrer). Sans consigne : vs = 0.
//   Lacet : yaw 'coordinate' (bille au milieu, par défaut) ou braquage imposé (-1..1, + = pied à gauche).
//   Gaz : throttle (0..1) imposé, ou throttleSpeed (KIAS tenus aux gaz) ; sinon les gaz ne sont pas touchés (null).
//   trim : faux pour ne pas toucher au trim (par défaut, le servo de trim décharge la profondeur, comme le KAP 140).
// Capteurs (comme ceux du KAP 140, simulator.js autopilotSensors, plus side) : heading (°), altitude (ft), vs (ft/min),
//   bank (rad, + = à gauche), pitch (rad), ias (m/s), tas (m/s), side (accélération latérale, m/s², + = vers la droite),
//   onGround.
// Sortie : { pitch, roll, yaw (PlaneControls : + = cabrer, + = à gauche, + = pied à gauche), trim (-1, 0, 1), throttle
//   (0..1 ou null) }.
//
// Gains réglés sur le modèle réaliste (tests/instructor-pilot.test.js) : non relus, ce n'est pas un système réel.

const KT = 0.514444, G = 9.81, DEG = Math.PI / 180;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;

export const INSTRUCTOR = {
    maxBank: 30,           // ° : virage vers un cap
    headingGain: 1.5,      // ° d'inclinaison par degré d'écart de cap
    lead: 2,               // s : anticipation de la sortie de virage
    bankGain: 0.05,        // manche par degré d'écart d'inclinaison
    rollDamping: 0.025,    // manche par °/s de roulis
    rollMax: 0.6,
    altGain: 4,            // ft/min par ft d'écart
    vsMax: 1000,           // ft/min
    vsGain: 0.006,         // ° d'assiette par ft/min d'écart
    vsIntegral: 0.0012,    // °/s par ft/min
    speedGain: 0.8,        // ° d'assiette par kt d'écart (trop vite : le nez monte)
    speedIntegral: 0.15,   // °/s par kt
    turnPitch: 4,          // ° d'assiette en plus par g de facteur de charge au-delà de 1 (virage incliné)
    attitudeGain: 0.07,    // manche par degré d'écart d'assiette
    attitudeIntegral: 0.04,
    pitchDamping: 0.05,    // manche par °/s de tangage
    pitchMax: 0.8,
    pitchRange: [-15, 25], // ° : assiettes visées au plus
    trimAbove: 0.04,       // profondeur tenue au-delà de laquelle le trim tourne
    sideGain: 0.08,        // palonnier par m/s² (bille)
    sideIntegral: 0.04,
    throttleGain: 0.05,    // gaz par kt
    throttleIntegral: 0.01,
};

export class InstructorPilot {
    constructor() {
        this.reset();
    }

    reset() {
        this._pitchRef = null;
        this._elevI = 0;
        this._yawI = 0;
        this._throttleI = null;
        this._lastBank = null;
        this._lastPitch = null;
        this._mode = null;
        this.plan = null;
    }

    // Une consigne nouvelle d'un autre genre (assiette, altitude, vitesse…) : boucle externe repartie de l'assiette du moment
    _vertical(plan) {
        return plan.pitch !== undefined ? 'pitch' : plan.altitude !== undefined ? 'altitude' : plan.vs !== undefined ? 'vs' : plan.speed !== undefined ? 'speed' : 'vs';
    }

    update(dt, s, plan = this.plan) {
        if (!plan || !s || dt <= 0) return null;
        // Consigne non finie (NaN, undefined calculé avant l'entrée de l'étape) : ignorée, comme si elle n'était pas donnée
        // (sinon elle se propage aux gouvernes et fait diverger la physique)
        if (Object.values(plan).some((v) => typeof v === 'number' && !Number.isFinite(v))) {
            plan = Object.fromEntries(Object.entries(plan).filter(([, v]) => typeof v !== 'number' || Number.isFinite(v)));
        }
        this.plan = plan;
        const P = INSTRUCTOR;
        const pitchDeg = s.pitch / DEG;
        const bankRight = -s.bank / DEG;
        const tas = Math.max(s.tas ?? s.ias ?? 0, 25);
        const iasKt = (s.ias ?? 0) / KT;

        // --- Roulis ---
        let roll;
        const lastBank = this._lastBank ?? s.bank;
        const rollRate = -(s.bank - lastBank) / DEG / dt;   // °/s, + = vers la droite
        this._lastBank = s.bank;
        if (plan.aileron !== undefined) roll = clamp(plan.aileron, -1, 1);
        else {
            let bankTarget = 0;
            if (plan.bank !== undefined) bankTarget = plan.bank;
            else if (plan.heading !== undefined) {
                const turnRate = Math.tan(bankRight * DEG) * G / tas / DEG;   // °/s
                const err = wrap180(plan.heading - s.heading) - turnRate * P.lead;
                const limit = plan.maxBank ?? P.maxBank;
                bankTarget = clamp(err * P.headingGain, -limit, limit);
            }
            const wanted = clamp(P.bankGain * (bankTarget - bankRight) - P.rollDamping * rollRate, -P.rollMax, P.rollMax);
            roll = -wanted;   // PlaneControls : + = à gauche
        }

        // --- Tangage ---
        const mode = this._vertical(plan);
        if (mode !== this._mode || this._pitchRef === null) {
            this._mode = mode;
            this._pitchRef = pitchDeg;
        }
        let pitchTarget;
        if (mode === 'pitch') pitchTarget = plan.pitch;
        else if (mode === 'speed') {
            const err = iasKt - plan.speed;   // trop vite : on lève le nez
            this._pitchRef = clamp(this._pitchRef + err * P.speedIntegral * dt, P.pitchRange[0], P.pitchRange[1] - 5);
            pitchTarget = this._pitchRef + err * P.speedGain;
        } else {
            const vsCommand = mode === 'altitude' ? clamp((plan.altitude - s.altitude) * P.altGain, -(plan.vsMax ?? P.vsMax), plan.vsMax ?? P.vsMax)
                : plan.vs ?? 0;
            const err = vsCommand - s.vs;
            this._pitchRef = clamp(this._pitchRef + err * P.vsIntegral * dt, P.pitchRange[0], P.pitchRange[1] - 5);
            pitchTarget = this._pitchRef + err * P.vsGain;
        }
        // Virage incliné : le nez monte avec le facteur de charge (1 / cos φ) pour tenir la trajectoire
        if (mode !== 'pitch') pitchTarget += P.turnPitch * (1 / Math.max(0.3, Math.cos(bankRight * DEG)) - 1);
        pitchTarget = clamp(pitchTarget, P.pitchRange[0], P.pitchRange[1]);
        const lastPitch = this._lastPitch ?? pitchDeg;
        const q = (pitchDeg - lastPitch) / dt;
        this._lastPitch = pitchDeg;
        let pitch;
        if (plan.elevator !== undefined) {
            pitch = clamp(plan.elevator, -1, 1);
            this._elevI = 0;
        } else {
            const e = pitchTarget - pitchDeg;
            this._elevI = clamp(this._elevI + e * P.attitudeIntegral * dt, -0.5, 0.5);
            pitch = clamp(P.attitudeGain * e + this._elevI - P.pitchDamping * q, -P.pitchMax, P.pitchMax);
        }
        // Trim : décharge la profondeur tenue (l'intégrale de la boucle d'assiette)
        let trim = 0;
        if (plan.trim !== false && plan.elevator === undefined) {
            if (this._elevI > P.trimAbove) trim = 1;
            else if (this._elevI < -P.trimAbove) trim = -1;
        }

        // --- Lacet ---
        let yaw;
        if (typeof plan.yaw === 'number') yaw = clamp(plan.yaw, -1, 1);
        else {
            const side = s.side ?? 0;   // + = poussé vers la droite : bille à gauche, pied gauche (yaw > 0)
            this._yawI = clamp(this._yawI + side * P.sideIntegral * dt, -1, 1);
            yaw = clamp(P.sideGain * side + this._yawI, -1, 1);
        }

        // --- Gaz ---
        let throttle = null;
        if (plan.throttle !== undefined) throttle = clamp(plan.throttle, 0, 1);
        else if (plan.throttleSpeed !== undefined) {
            const err = plan.throttleSpeed - iasKt;   // trop lent : plus de gaz
            this._throttleI = clamp((this._throttleI ?? s.throttle ?? 0.6) + err * P.throttleIntegral * dt, 0, 1);
            throttle = clamp(this._throttleI + err * P.throttleGain, 0, 1);
        }
        return { pitch, roll, yaw, trim, throttle };
    }
}
