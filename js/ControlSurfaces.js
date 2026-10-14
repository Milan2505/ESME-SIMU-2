import { MathUtils } from 'three';

// Gouvernes animées du Cessna (C172Model.js) : ailerons, volets, profondeur et direction sont des pièces mobiles,
// chacune dans un pivot placé sur sa charnière (userData.axis : axe de rotation ; un angle positif envoie le bord
// de fuite vers le bas, ou vers la gauche pour la direction).

// Débattements max (degrés)
const AILERON_TRAVEL = 20;
const ELEVATOR_TRAVEL = 25;
const RUDDER_TRAVEL = 25;
const FLAP_TRAVEL = 30;

class ControlSurfaces {
    // pivots : gouvernes de l'avion (aircraftParts(model).pivots)
    constructor(pivots) {
        this.pivots = pivots;
        this.deflections = { aileron: 0, elevator: 0, rudder: 0, flaps: 0 }; // -1 -> 1 (volets : 0 -> 1)
    }

    // inputs : commandes du pilote (-1 -> 1, + = cabrer / gauche) ; flaps : 0 -> 1
    update(delta, inputs, flaps) {
        const d = this.deflections;
        const k = 1 - Math.exp(-8 * delta); // les gouvernes suivent le manche avec un peu de retard
        d.aileron += (inputs.roll - d.aileron) * k;
        d.elevator += (inputs.pitch - d.elevator) * k;
        d.rudder += (inputs.yaw - d.rudder) * k;
        d.flaps = flaps;

        // Roulis à gauche : aileron gauche levé, aileron droit baissé
        this._set('aileronLeft', -d.aileron * AILERON_TRAVEL);
        this._set('aileronRight', d.aileron * AILERON_TRAVEL);
        // Cabrer : bord de fuite de la profondeur vers le haut
        this._set('elevator', -d.elevator * ELEVATOR_TRAVEL);
        // Palonnier à gauche : direction vers la gauche
        this._set('rudder', d.rudder * RUDDER_TRAVEL);
        this._set('flapLeft', d.flaps * FLAP_TRAVEL);
        this._set('flapRight', d.flaps * FLAP_TRAVEL);
    }

    _set(name, degrees) {
        const pivot = this.pivots[name];
        if (pivot) pivot.quaternion.setFromAxisAngle(pivot.userData.axis, MathUtils.degToRad(degrees));
    }
}

// Train d'atterrissage (C172Model.js : buildGear) : roulette de nez orientée par le palonnier au sol (recentrée en vol,
// comme le vrai train : la jambe se détend et se recentre), roues qui tournent à la vitesse de roulage
const NOSE_STEER = 30;    // braquage max de la roulette (degrés) : celui d'un vrai C172, palonnier et frein différentiel
class Gear {
    // gear : { steer, spins, radius } ; scale : agrandissement du modèle (rayon réel des roues)
    constructor(gear, scale = 1) {
        this.gear = gear;
        this.radius = gear.radius * scale;
        this.angle = 0;
        this.roll = 0;
    }

    // steer : commande au sol (-1 -> 1, + = gauche) ; speed : vitesse de roulage (m/s) ; onGround
    update(delta, steer, speed, onGround) {
        const { steer: pivot, spins } = this.gear;
        const target = onGround ? MathUtils.clamp(steer, -1, 1) * NOSE_STEER : 0;
        this.angle += (target - this.angle) * (1 - Math.exp(-6 * delta));
        pivot.quaternion.setFromAxisAngle(pivot.userData.axis, MathUtils.degToRad(this.angle));
        // Roues : au sol elles roulent ; en l'air elles ralentissent peu à peu
        this.roll = onGround ? speed / this.radius : this.roll * Math.exp(-0.4 * delta);
        for (const wheel of spins) wheel.rotation.x -= this.roll * delta;   // vers l'avant : le haut de la roue avance
    }
}

export { ControlSurfaces, Gear };
