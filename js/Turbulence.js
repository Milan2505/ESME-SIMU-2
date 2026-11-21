// Turbulence atmosphérique, cisaillement du vent près du sol et thermiques (module pur, aucun three.js) :
// - Turbulence : modèle de Dryden, MIL-F-8785C (1980) §3.7.2 et MIL-HDBK-1797 (1997) §4.9.1, unités internes ft et ft/s,
//   sorties en m/s et rad/s. Sévérité (0 à 1) -> vent à 20 ft W20 = 45 kt × sévérité (15 kt légère, 30 kt modérée,
//   45 kt forte : figure 11 de la MIL-F-8785C, probabilité de dépassement 1e-2, 1e-3, 1e-5).
//   Basse altitude (h < 1 000 ft, h plancher 10 ft) :
//     Lw = h, Lu = Lv = h / (0,177 + 0,000823 h)^1,2 ;
//     σw = 0,1 W20, σu = σv = σw / (0,177 + 0,000823 h)^0,4.
//   Au-dessus de 2 000 ft : L = 1 750 ft pour les trois axes. La norme y donne σ selon l'altitude et la probabilité de
//   dépassement (figure 7 / figure 10 du HDBK) ; simplification : σu = σv = σw = σw(1 000 ft) = 0,1 W20 (valeur basse
//   altitude prolongée, la table n'est pas reprise). Entre 1 000 et 2 000 ft : interpolation linéaire des L et des σ.
//   Filtres de forme (V vitesse air, b envergure) :
//     Hu(s) = σu √(2 Lu / (π V)) / (1 + Lu/V s)
//     Hv(s) = σv √(Lv / (π V)) (1 + √3 Lv/V s) / (1 + Lv/V s)²   (Hw(s) idem avec Lw, σw)
//     Hp(s) = σw √(0,8 / V) (π / (4 b))^(1/6) / (Lw^(1/3) (1 + 4b/(πV) s))
//   Ici chaque état est tenu à variance 1 et multiplié par son σ à la sortie (un changement de hauteur change aussitôt
//   l'intensité, sans saut d'état). u : premier ordre exact (a = exp(-V dt / Lu), x = a x + √(1 - a²) n), indépendant
//   du pas. v, w : la forme (1 + √3 τs)/(1 + τs)² s'écrit √3 + (1 - √3)/(1 + τs) appliqué à z = n/(1 + τs) ; avec z de
//   variance 1, z2 = z/(1 + τs) a variance 1/2 et covariance 1/2 avec z, donc y = (√3 z + (1 - √3) z2) / √2 est de
//   variance 1 et de spectre de Dryden. z : premier ordre exact ; z2 : exponentielle exacte sur z moyenné (trapèzes),
//   sous-pas internes dès que V dt / L > 0,1 (stable et juste même pour dt = 0,1 s près du sol). p : premier ordre
//   exact, constante 4b/(πV), écart type pris égal au gain de Hp (σp = σw √(0,8/V) (π/(4b))^(1/6) / Lw^(1/3),
//   simplification documentée). V plancher 5 m/s.
//   Repère du vent : u longitudinal (sens de la vitesse air), v latéral, w vertical (+ vers le haut), p roulis (rad/s).
// - shearFactor : profil du vent en loi de puissance (exposant 1/7, terrain dégagé) au-dessus de 10 m, hauteur de
//   l'anémomètre du METAR (le vent annoncé), plafonné.
// - thermalAt : thermiques sur une grille de cellules à graine (aucun état), cœur gaussien, anneau descendant, cycle de
//   vie de quelques minutes. Valeurs d'ordre de grandeur (vol à voile : w* de 1 à 2,5 m/s), non relues dans une source.

import { seededRandom } from './Random.js';

const FT = 0.3048;            // m par pied
const KT_FTS = 1.6878099;     // ft/s par nœud
const W20_MAX = 45;           // kt : W20 de la turbulence forte (sévérité 1)
const V_MIN = 5;              // m/s : plancher de la vitesse air
const SUBSTEP = 0.1;          // V dt / L au plus par sous-pas
const MAX_SUBSTEPS = 64;
const SQRT3 = Math.sqrt(3);

// Échelles (ft) et écarts types (ft/s) de Dryden à une hauteur (ft) pour un W20 (ft/s)
function drydenScales(hFt, w20) {
    const sigmaW = 0.1 * w20;
    const low = (h) => {
        const k = 0.177 + 0.000823 * h;
        return { Lu: h / k ** 1.2, Lw: h, sigmaU: sigmaW / k ** 0.4 };
    };
    const h = Math.max(10, hFt);
    if (h <= 1000) {
        const s = low(h);
        return { Lu: s.Lu, Lv: s.Lu, Lw: s.Lw, sigmaU: s.sigmaU, sigmaV: s.sigmaU, sigmaW };
    }
    const at1000 = low(1000);
    const t = Math.min(1, (h - 1000) / 1000);
    const lerp = (a, b) => a + (b - a) * t;
    const Lu = lerp(at1000.Lu, 1750), Lw = lerp(at1000.Lw, 1750), sigmaU = lerp(at1000.sigmaU, sigmaW);
    return { Lu, Lv: Lu, Lw, sigmaU, sigmaV: sigmaU, sigmaW };
}

class Turbulence {
    constructor(seed = 1) {
        this.setSeed(seed);
    }

    // Nouvelle graine : tirage propre, état remis à zéro
    setSeed(seed) {
        this.seed = seed;
        this.random = seededRandom(seed);
        this.spare = null;
        this.reset();
    }

    // États remis à zéro (sorties nulles)
    reset() {
        this.xu = 0; this.xp = 0;
        this.zv = 0; this.zv2 = 0;
        this.zw = 0; this.zw2 = 0;
        this.u = 0; this.v = 0; this.w = 0; this.p = 0;
    }

    // Tirage normal centré réduit (Box-Muller, deux valeurs par paire de tirages)
    gauss() {
        if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
        const u1 = Math.max(1e-12, this.random()), u2 = this.random();
        const r = Math.sqrt(-2 * Math.log(u1));
        this.spare = r * Math.sin(2 * Math.PI * u2);
        return r * Math.cos(2 * Math.PI * u2);
    }

    // Premier ordre exact, état de variance 1
    firstOrder(x, k) {
        const a = Math.exp(-k);
        return a * x + Math.sqrt(1 - a * a) * this.gauss();
    }

    // Filtre de forme de Dryden (v ou w) sur dt, sous-pas si V dt / L > 0,1 ; rend [z, z2]
    drydenPair(z, z2, k) {
        const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(k / SUBSTEP)));
        const kk = k / n, a = Math.exp(-kk);
        for (let i = 0; i < n; i++) {
            const prev = z;
            z = a * z + Math.sqrt(1 - a * a) * this.gauss();
            z2 = a * z2 + (1 - a) * 0.5 * (prev + z);
        }
        return [z, z2];
    }

    // dt (s) ; height (m au-dessus du sol), airspeed (m/s), severity (0 à 1), span (m)
    step(dt, { height = 0, airspeed = 0, severity = 0, span = 11 } = {}) {
        if (!(severity > 0)) { this.reset(); return this; }
        if (!(dt > 0)) return this;
        const sev = Math.min(1, severity);
        const V = Math.max(V_MIN, airspeed || 0) / FT;                // ft/s
        const b = Math.max(1, span || 11) / FT;                       // ft
        const s = drydenScales((height || 0) / FT, W20_MAX * sev * KT_FTS);
        const dist = V * dt;                                          // ft parcourus

        this.xu = this.firstOrder(this.xu, dist / s.Lu);
        [this.zv, this.zv2] = this.drydenPair(this.zv, this.zv2, dist / s.Lv);
        [this.zw, this.zw2] = this.drydenPair(this.zw, this.zw2, dist / s.Lw);
        this.xp = this.firstOrder(this.xp, dt * Math.PI * V / (4 * b));

        const shape = (z, z2) => (SQRT3 * z + (1 - SQRT3) * z2) / Math.SQRT2;
        const sigmaP = s.sigmaW * Math.sqrt(0.8 / V) * (Math.PI / (4 * b)) ** (1 / 6) / s.Lw ** (1 / 3);
        this.u = s.sigmaU * this.xu * FT;
        this.v = s.sigmaV * shape(this.zv, this.zv2) * FT;
        this.w = s.sigmaW * shape(this.zw, this.zw2) * FT;
        this.p = sigmaP * this.xp;
        return this;
    }
}

// Facteur du vent selon la hauteur (m) : 1 sous ref (10 m, vent du METAR), puis (h / ref)^alpha plafonné à cap
function shearFactor(height, { alpha = 1 / 7, ref = 10, cap = 1.5 } = {}) {
    if (!(height > ref)) return 1;
    return Math.min(cap, (height / ref) ** alpha);
}

// Hachage entier de (i, j, k, seed, sel) -> [0, 1), sans état
function hash01(i, j, k, seed, salt) {
    let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1)
        ^ Math.imul(seed | 0, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// Vitesse verticale (m/s, + vers le haut) des thermiques au point (x, z) (m), à une hauteur (m, sol) et un instant (s)
function thermalAt(x, z, height, time, { strength = 1, seed = 1, cell = 800, top = 1200 } = {}) {
    if (!(strength > 0) || !(height > 0) || !(height < top)) return 0;
    const zr = height / top;
    const vertical = zr * (1 - zr) ** 1.5 / (0.4 * 0.6 ** 1.5);      // nul au sol et au sommet, maximum à 0,4 top
    const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    let w = 0;
    for (let i = ci - 1; i <= ci + 1; i++) {
        for (let j = cj - 1; j <= cj + 1; j++) {
            // Cycle de vie : période de 4 à 8 min, déphasée par cellule ; chaque cycle tire une nouvelle thermique
            const period = 240 + 240 * hash01(i, j, 0, seed, 1);
            const age = time / period + hash01(i, j, 0, seed, 2);
            const cycle = Math.floor(age);
            const fade = Math.sin(Math.PI * (age - cycle));            // fondu à l'apparition et à la fin
            if (hash01(i, j, cycle, seed, 3) >= 0.4) continue;         // présence ~40 %
            const cx = (i + hash01(i, j, cycle, seed, 4)) * cell;
            const cz = (j + hash01(i, j, cycle, seed, 5)) * cell;
            const radius = 100 + 100 * hash01(i, j, cycle, seed, 6);
            const wStar = (1 + 1.5 * hash01(i, j, cycle, seed, 7)) * strength;
            const d = Math.hypot(x - cx, z - cz) / radius;
            if (d > 3) continue;
            const core = Math.exp(-d * d);
            const ring = -0.3 * Math.exp(-(((d - 1.7) / 0.35) ** 2));  // descendance autour du cœur
            w += wStar * fade * (core + ring);
        }
    }
    return w * vertical;
}

export { Turbulence, shearFactor, thermalAt, drydenScales };
