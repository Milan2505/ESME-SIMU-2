import { MathUtils, Vector3 } from 'three';

// Modèle simple d'ILS (Instrument Landing System) pour les deux pistes de l'aérodrome :
// - localizer : écart latéral par rapport à l'axe de piste (antenne en bout de piste opposé)
// - glide     : écart par rapport à une pente de 3° qui aboutit au point visé
// Les aiguilles vont de -1 à 1 (pleine échelle) et indiquent où se trouve la trajectoire idéale :
// aiguille à droite = l'axe est à droite, aiguille en haut = la pente est au-dessus.

const RANGE = 8000;                                 // portée (m)
const SECTOR = MathUtils.degToRad(35);              // ouverture du localizer de part et d'autre de l'axe
const MAX_HEIGHT = 1500;                            // au-dessus, on est hors du faisceau (m)
const GLIDE = MathUtils.degToRad(3);                // pente d'approche
const LOC_FULL_SCALE = MathUtils.degToRad(2.5);     // déviation pour une aiguille en butée
const GS_FULL_SCALE = MathUtils.degToRad(0.7);

const _offset = new Vector3();

class ILS {
    constructor(runways, runwayLength) {
        this.runways = runways;
        this.runwayLength = runwayLength;
        this.active = false;
        this.state = { available: false };
    }

    // Calcule l'état ILS pour la position de l'avion ; coupe l'ILS s'il n'est plus disponible
    update(position) {
        let best = null;
        for (const runway of this.runways) {
            _offset.subVectors(position, runway.threshold);
            const before = -_offset.dot(runway.direction);       // distance avant le seuil (m)
            const lateral = _offset.dot(runway.left);           // > 0 : avion à gauche de l'axe
            const height = position.y - runway.threshold.y;
            // Antenne du localizer au bout de piste opposé ; antenne glide au niveau du point visé
            const locAngle = Math.atan2(lateral, before + this.runwayLength);
            const gsDistance = before + runway.aimPoint.distanceTo(runway.threshold);
            // Disponible en approche (avant le seuil) ; une fois actif, reste allumé sur la piste (localizer seul)
            const minBefore = this.active ? -this.runwayLength : 0;
            if (before < minBefore || before > RANGE || Math.abs(locAngle) > SECTOR || height > MAX_HEIGHT) continue;
            if (best && Math.abs(locAngle) >= Math.abs(best.locAngle)) continue;
            const gsAngle = Math.atan2(height, Math.max(1, gsDistance));
            best = {
                available: true,
                runway: runway.name,
                course: runway.heading,
                distance: Math.max(0, before),
                locAngle,
                // Avion à gauche de l'axe -> l'axe est à droite -> aiguille à droite (+)
                localizer: MathUtils.clamp(locAngle / LOC_FULL_SCALE, -1, 1),
                // Avion sous la pente -> la pente est au-dessus -> aiguille en haut (+)
                glideslope: before > 0 ? MathUtils.clamp((GLIDE - gsAngle) / GS_FULL_SCALE, -1, 1) : 0,
                glideHeight: Math.tan(GLIDE) * Math.max(0, gsDistance), // hauteur idéale à cette distance (m)
                height,
            };
        }
        this.state = best ?? { available: false };
        if (!this.state.available) this.active = false;
        return this.state;
    }

    toggle() {
        this.active = this.state.available && !this.active;
        return this.active;
    }

    // Conseil de pilotage en clair d'après les aiguilles
    advice() {
        const s = this.state;
        if (!s.available) return '';
        const parts = [];
        if (s.localizer > 0.15) parts.push('corrigez à droite');
        else if (s.localizer < -0.15) parts.push('corrigez à gauche');
        else parts.push('dans l\'axe');
        if (s.distance > 0) {
            if (s.glideslope > 0.2) parts.push('trop bas : remontez');
            else if (s.glideslope < -0.2) parts.push('trop haut : descendez');
            else parts.push('sur la pente');
        }
        return parts.join(' · ');
    }
}

export { ILS };
