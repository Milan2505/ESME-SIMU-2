import { Vector3 } from 'three';

// Vent de l'aérodrome : direction et force qui varient lentement autour des valeurs de la météo (vent variable),
// avec des rafales. La direction moyenne elle-même tourne très lentement sur 360° au fil de la partie (un tour en
// ~2 h, avec des allers-retours de quelques dizaines de degrés) : la piste en service finit par changer. Le temps vient de l'horloge réelle : tous les joueurs d'une partie ont le même vent.
const KT = 0.514444;   // nœud -> m/s

class Wind {
    constructor() {
        this.metarBase = 360;    // direction moyenne de la météo choisie (°)
        this.base = 360;         // direction moyenne actuelle (°) : celle de la météo, plus la dérive lente
        this.knots = 0;          // force moyenne (kt)
        this.variation = 0;      // amplitude totale de la variation de direction (°), ex. 60 : de -30 à +30
        this.gust = 0;           // rafales max (kt), 0 = sans rafales
        this.direction = 360;    // direction actuelle (°)
        this.speed = 0;          // force actuelle (kt)
        this.vector = new Vector3();  // vitesse de l'air (repère monde, m/s) : vers où souffle le vent
    }

    set({ wind = 360, knots = 0, variation = 0, gust = 0 } = {}) {
        this.metarBase = wind;
        this.knots = knots;
        this.variation = variation;
        this.gust = gust;
        this.update();
    }

    get calm() {
        return this.knots < 3;
    }

    // Extrêmes de la direction (ATIS : "variable entre 330 et 030")
    get range() {
        const norm = (d) => ((Math.round(d / 10) * 10) % 360 + 360) % 360 || 360;
        return [norm(this.base - this.variation / 2), norm(this.base + this.variation / 2)];
    }

    update() {
        const t = Date.now() / 1000;
        // Dérive lente de la direction moyenne : au plus ~10° par minute, souvent bien moins
        const drift = 360 * t / 7200 + 35 * Math.sin(t * 2 * Math.PI / 3000) + 10 * Math.sin(t * 2 * Math.PI / 1300 + 2.4);
        this.base = ((this.metarBase + drift) % 360 + 360) % 360;
        // Bruits lents (sommes de sinus) : la direction tourne en quelques dizaines de secondes, la force varie
        const turn = Math.sin(t * 0.031) * 0.6 + Math.sin(t * 0.077 + 1.3) * 0.3 + Math.sin(t * 0.19 + 4.1) * 0.1;
        const swell = Math.sin(t * 0.043 + 2) * 0.5 + Math.sin(t * 0.13 + 0.7) * 0.3 + Math.sin(t * 0.9 + 3) * 0.2;
        const burst = Math.max(0, Math.sin(t * 0.21) * Math.sin(t * 0.37 + 1));   // rafale : quelques secondes
        this.direction = ((this.base + turn * this.variation / 2) % 360 + 360) % 360;
        this.speed = Math.max(0, this.knots * (1 + 0.15 * swell) + (this.gust ? (this.gust - this.knots) * burst ** 2 : 0));
        // Le vent vient de "direction" (0 = nord = -z, 90 = est = +x) et souffle à l'opposé
        const rad = this.direction * Math.PI / 180;
        this.vector.set(-Math.sin(rad), 0, Math.cos(rad)).multiplyScalar(this.speed * KT);
    }
}

export { Wind };
