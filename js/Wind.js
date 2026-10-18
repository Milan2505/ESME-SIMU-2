import { Vector3 } from 'three';

// Vent de l'aérodrome : direction et force qui varient lentement autour des valeurs de la météo (vent variable),
// avec des rafales. La direction moyenne elle-même tourne très lentement sur 360° au fil de la partie (un tour en
// ~2 h, avec des allers-retours de quelques dizaines de degrés) : la piste en service finit par changer. 
// Chaque partie a son vent (setSeed) : direction de départ, force (de 0,5 à 1,6 fois celle de la météo) et moment du
// cycle tirés d'une graine. En multijoueur, la graine vient du code de la partie et le temps de l'horloge réelle : tous
// les joueurs d'une même partie ont le même vent.
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
        this.metarKnots = 0;     // force et rafales de la météo choisie (kt), avant le tirage de la partie
        this.metarGust = 0;
        this.local = null;       // météo de ce joueur ; shared : celle du créateur de la partie (multijoueur), prioritaire
        this.shared = null;
        this.setSeed(Math.floor(Math.random() * 2 ** 32));
    }

    // Météo choisie par ce joueur (METAR : wind, knots, variation, gust)
    set(metar = {}) {
        this.local = metar;
        this._apply();
    }

    // Multijoueur : vent de la météo du créateur de la partie (null : la sienne), pour que tous aient le même vent
    setShared(metar) {
        if (metar === this.shared) return;
        this.shared = metar;
        this._apply();
    }

    // Vent d'une nouvelle partie : seed (entier) -> décalage de direction (0 à 360°), facteur de force, phase du cycle
    setSeed(seed) {
        let s = seed >>> 0;
        const rnd = () => {   // mulberry32
            s = (s + 0x6D2B79F5) >>> 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        this.seedDirection = rnd() * 360;
        this.seedStrength = 0.5 + rnd() * 1.1;
        this.seedPhase = rnd() * 7200;
        this._apply();
    }

    _apply() {
        const { wind = 360, knots = 0, variation = 0, gust = 0 } = this.shared ?? this.local ?? {};
        this.metarBase = wind;
        this.metarKnots = knots;
        this.metarGust = gust;
        this.variation = variation;
        // (au plus 25 kt, rafales à 35 kt : au-delà, un Cessna ne vole plus)
        this.knots = Math.min(25, Math.round(this.metarKnots * this.seedStrength));
        this.gust = this.metarGust ? Math.min(35, Math.max(this.knots + 5, Math.round(this.metarGust * this.seedStrength))) : 0;
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
        const drift = this.seedDirection + 360 * (t + this.seedPhase) / 7200 + 35 * Math.sin(t * 2 * Math.PI / 3000) + 10 * Math.sin(t * 2 * Math.PI / 1300 + 2.4);
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
