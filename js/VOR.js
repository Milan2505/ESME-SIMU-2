// Récepteur VOR (NAV1) : radial de l'avion par rapport à la balise, écart par rapport à la route choisie au bouton
// OBS, indicateur TO / FROM, distance DME. Caps et radials en degrés, 0 = nord (-z), 90 = est (+x).
//
// Lecture de l'indicateur (comme dans un vrai avion) : on tourne l'OBS jusqu'à centrer l'aiguille avec "TO" :
// la route affichée en haut est le cap à suivre pour rejoindre la balise. Aiguille à gauche = la route est à gauche.

const RANGE = 40000;              // portée (m) : bien au-delà du terrain
const FULL_SCALE = 10;            // écart pour une aiguille en butée (degrés)
const CONE = 1.2;                 // cône de silence au-dessus de la balise : demi-angle ~50° (tan)
const NM = 1852;

function wrap180(angle) {
    return ((angle + 540) % 360) - 180;
}

class VOR {
    // station : { x, y, z, ident, frequency }
    constructor(station) {
        this.station = station;
        this.course = 0;          // route sélectionnée à l'OBS (degrés)
        this.state = { available: false };
    }

    setCourse(course) {
        this.course = ((Math.round(course) % 360) + 360) % 360;
    }

    turnCourse(step) {
        this.setCourse(this.course + step);
    }

    // Règle l'OBS pour centrer l'aiguille avec "TO" (route directe vers la balise)
    centerTo() {
        if (this.state.available) this.setCourse(this.state.radial + 180);
    }

    update(position) {
        const s = this.station;
        const dx = position.x - s.x, dz = position.z - s.z, dy = position.y - s.y;
        const ground = Math.hypot(dx, dz);
        const distance = Math.hypot(ground, dy);
        // Radial : direction de la balise vers l'avion
        const radial = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
        const available = distance < RANGE;
        // Au-dessus de la balise (cône de silence) : indications instables, drapeau
        const overhead = dy > 0 && ground < dy * CONE;
        const fromOffset = wrap180(radial - this.course);
        const to = Math.abs(fromOffset) > 90;
        const offset = to ? wrap180(radial - this.course - 180) : -fromOffset;
        this.state = {
            available,
            overhead,
            radial,
            to,
            // -1 (aiguille en butée à gauche) -> 1 (à droite)
            deviation: Math.max(-1, Math.min(1, offset / FULL_SCALE)),
            distance,                    // distance oblique (m), comme un DME
            dmeNM: distance / NM,
            bearingTo: (radial + 180) % 360,
            course: this.course,
            ident: s.ident,
            frequency: s.frequency,
        };
        return this.state;
    }
}

export { VOR };
