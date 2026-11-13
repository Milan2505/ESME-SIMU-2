import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    ConeGeometry,
    CylinderGeometry,
    Group,
    InstancedMesh,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    RepeatWrapping,
    SRGBColorSpace,
    Vector3
} from 'three';

// Carte « Ville » : une grande ville en plaine, entre ESME et AIX (les deux aérodromes restent ceux de la campagne).
// Plan en damier aligné sur les axes : îlots de CELL m, rues de ROAD m entre eux. Au centre, les tours (jusqu'à ~230 m),
// puis des immeubles, puis des bâtiments bas vers le bord ; quelques parcs arborés. Rien dans les couloirs d'approche,
// et des bâtiments de plus en plus bas en allant vers les aérodromes.
//
// Le sol est rendu plat sous la ville (flatten, voir simulator.js) : routes et parcs sont posés juste au-dessus.
// Dessin : quelques maillages fusionnés (façades, toits, sol des îlots, parcs, arbres instanciés), soit une dizaine
// d'appels de dessin pour toute la ville. Fenêtres éclairées et lampadaires la nuit (setNight).

const CENTER = { x: 2600, z: -2260 };   // à mi-chemin entre ESME (0, 0) et AIX (5200, -4520)
const RADIUS = 1400;                    // m
const CELL = 130;                       // îlot et la moitié des rues qui l'entourent (m)
const ROAD = 18;                        // largeur des rues (m)
const SIDEWALK = 4;                     // trottoirs (m)
const BAY = 4, FLOOR = 3.6;             // largeur d'une travée de fenêtres, hauteur d'un étage (m)
const WINDOWS = 8;                      // fenêtres par côté de la texture de façade (8 x 8)
const GROUND_Y = 0.25;                  // hauteur du sol des îlots au-dessus du terrain plat (m)

// Générateur pseudo-aléatoire à graine (même ville pour tous les joueurs)
function random(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeTexture(canvas, srgb) {
    const texture = new CanvasTexture(canvas);
    if (srgb) texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    return texture;
}

function canvasTexture(size, draw, height = size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = height;
    draw(canvas.getContext('2d'), size, height);
    return makeTexture(canvas, true);
}

const rgb = (r, g, b) => `rgb(${Math.min(255, Math.round(r))},${Math.min(255, Math.round(g))},${Math.min(255, Math.round(b))})`;
const gray = (v) => {
    const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return `rgb(${g},${g},${g})`;
};
// Couleur '#rrggbb' éclaircie ou assombrie (t : facteur)
const shade = (hex, t) => rgb(parseInt(hex.slice(1, 3), 16) * t, parseInt(hex.slice(3, 5), 16) * t, parseInt(hex.slice(5, 7), 16) * t);

// Grain d'un enduit ou d'un béton : petites taches claires et sombres
function grain(ctx, w, h, rnd, count, alpha) {
    for (let i = 0; i < count; i++) {
        ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
}

// Relief (niveaux de gris : 0 creux, 1 saillant) -> carte de normales (repère tangent, v vers le haut de l'image)
function normalsFrom(canvas, strength) {
    const W = canvas.width, H = canvas.height;
    const src = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    const image = ctx.createImageData(W, H);
    const d = image.data;
    const at = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;   // (texture répétée : bords raccordés)
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const nx = -(at(x + 1, y) - at(x - 1, y)) * strength;
            const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
            const len = Math.hypot(nx, ny, 1);
            const i = (y * W + x) * 4;
            d[i] = (nx / len * 0.5 + 0.5) * 255;
            d[i + 1] = (ny / len * 0.5 + 0.5) * 255;
            d[i + 2] = (0.5 / len + 0.5) * 255;
            d[i + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    return out;
}

// Peintre de façade : dessine à la fois la couleur, le relief (converti en carte de normales : fenêtres en retrait,
// appuis et corniches en saillie, joints de briques et de pierres), la rugosité (vitres lisses qui renvoient le soleil,
// murs mats) et l'émission (fenêtres allumées la nuit). Rugosité et émission à demi-résolution
class FacadePainter {
    constructor(W, H, seed) {
        this.W = W;
        this.H = H;
        this.rnd = random(seed);
        const layer = (scale) => {
            const canvas = document.createElement('canvas');
            canvas.width = W * scale;
            canvas.height = H * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            return ctx;
        };
        this.color = layer(1);
        this.height = layer(1);
        this.rough = layer(0.5);
        this.lit = layer(0.5);
        this.lit.fillStyle = '#000';
        this.lit.fillRect(0, 0, W, H);
    }

    // Rectangle sur les calques demandés : c couleur (css ou dégradé), h relief (0..1), r rugosité (0..1)
    rect(x, y, w, h, o) {
        if (o.c !== undefined) {
            this.color.fillStyle = o.c;
            this.color.fillRect(x, y, w, h);
        }
        if (o.h !== undefined) {
            this.height.fillStyle = gray(o.h);
            this.height.fillRect(x, y, w, h);
        }
        if (o.r !== undefined) {
            this.rough.fillStyle = gray(o.r);
            this.rough.fillRect(x, y, w, h);
        }
    }

    glow(x, y, w, h, color) {
        this.lit.fillStyle = color;
        this.lit.fillRect(x, y, w, h);
    }

    textures(strength = 2.5) {
        return {
            map: makeTexture(this.color.canvas, true),
            normalMap: makeTexture(normalsFrom(this.height.canvas, strength), false),
            roughnessMap: makeTexture(this.rough.canvas, false),
            emissive: makeTexture(this.lit.canvas, true),
        };
    }
}

// Mur : fond, taches (enduit ou béton vieilli, raccordées d'un bord à l'autre de la texture), grain (aussi en relief)
function wall(p, base, { blotches = 50, grainAlpha = 0.05, height = 0.6, rough = 0.9 } = {}) {
    const { W, H, rnd } = p, ctx = p.color;
    p.rect(0, 0, W, H, { c: base, h: height, r: rough });
    for (let i = 0; i < blotches; i++) {
        const x = rnd() * W, y = rnd() * H, r = 15 + rnd() * 90;
        const dark = rnd() < 0.6, a = 0.03 + rnd() * 0.05;
        for (const dx of [-W, 0, W]) {
            for (const dy of [-H, 0, H]) {
                const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
                g.addColorStop(0, dark ? `rgba(70,60,50,${a})` : `rgba(255,255,250,${a})`);
                g.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = g;
                ctx.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
            }
        }
    }
    for (let i = 0; i < W * H / 25; i++) {
        const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H), dark = rnd() < 0.5;
        ctx.fillStyle = dark ? `rgba(0,0,0,${grainAlpha})` : `rgba(255,255,255,${grainAlpha})`;
        ctx.fillRect(x, y, 1, 1);
        p.height.fillStyle = gray(height + (dark ? -0.05 : 0.05));
        p.height.fillRect(x, y, 1, 1);
    }
}

// Coulures de salissure sous un appui (x..x+w, à partir de y)
function streaks(p, x, y, w, alpha = 0.1) {
    const { rnd } = p, ctx = p.color;
    for (let k = 0; k < 3; k++) {
        const sx = x + rnd() * w, sw = 2 + rnd() * 6, len = 8 + rnd() * 22;
        const g = ctx.createLinearGradient(0, y, 0, y + len);
        g.addColorStop(0, `rgba(60,52,44,${alpha * (0.5 + rnd())})`);
        g.addColorStop(1, 'rgba(60,52,44,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx, y, sw, len);
    }
}

// Vitre : reflet du ciel (clair en haut, sombre en bas), parfois l'immeuble d'en face, l'intérieur (plafonnier), un
// store (bureaux) ou des rideaux (logements). lit : 1 allumée la nuit, 0 éteinte
function pane(p, x, y, w, h, { kind = 'house', light = 1, lit = 0 } = {}) {
    const { rnd } = p, ctx = p.color;
    const k = (0.75 + rnd() * 0.3) * light;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgb(170 * k, 192 * k, 212 * k));
    g.addColorStop(0.45, rgb(118 * k, 138 * k, 158 * k));
    g.addColorStop(1, rgb(72 * k, 84 * k, 98 * k));
    p.rect(x, y, w, h, { c: g, h: 0.25, r: 0.06 });
    // Immeuble d'en face reflété : silhouettes sombres en bas de la vitre
    if (rnd() < 0.45) {
        ctx.fillStyle = `rgba(40,44,50,${0.2 + rnd() * 0.25})`;
        for (let bx = x; bx < x + w;) {
            const bw = Math.min(3 + rnd() * w * 0.5, x + w - bx), bh = h * (0.15 + rnd() * 0.5);
            ctx.fillRect(bx, y + h - bh, bw, bh);
            bx += bw;
        }
    }
    // Intérieur visible : plus sombre, plafonnier
    if (rnd() < 0.3) {
        ctx.fillStyle = 'rgba(20,22,26,0.45)';
        ctx.fillRect(x, y, w, h);
        if (kind !== 'house') {
            ctx.fillStyle = 'rgba(230,236,240,0.35)';
            ctx.fillRect(x + 1, y + 2, w - 2, 1.5);
        }
    }
    // Reflet oblique
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y);
    ctx.lineTo(x + w * 0.55, y);
    ctx.lineTo(x + w * 0.25, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    // Store à lamelles (bureaux) ou rideaux (logements)
    let blind = 0;
    const cover = rnd();
    if (kind !== 'house' && cover < 0.4) {
        blind = h * (0.15 + rnd() * 0.8);
        p.rect(x, y, w, blind, { c: '#d9d6cf', h: 0.28, r: 0.7 });
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let s = y + 2; s < y + blind; s += 3) ctx.fillRect(x, s, w, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x, y + blind - 1.5, w, 1.5);
    } else if (kind === 'house' && cover < 0.35) {
        const cw = w * (0.25 + rnd() * 0.25);
        ctx.fillStyle = ['rgba(240,234,220,0.75)', 'rgba(225,215,200,0.7)', 'rgba(245,245,240,0.65)'][Math.floor(rnd() * 3)];
        ctx.fillRect(x, y, cw, h);
        ctx.fillRect(x + w - cw, y, cw, h);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';                // plis
        for (let f = 2; f < cw; f += 3) {
            ctx.fillRect(x + f, y, 1, h);
            ctx.fillRect(x + w - cw + f, y, 1, h);
        }
    }
    if (lit) {
        const warm = rnd();
        p.glow(x, y + blind, w, h - blind, kind === 'house'
            ? (warm < 0.75 ? '#ffd38a' : '#fff0d0') : (warm < 0.7 ? '#e8f0ff' : '#fff1d6'));
        if (blind) p.glow(x, y, w, blind, 'rgba(255,225,170,0.45)');
    }
}

// Fenêtre dans un mur épais : tableau (ombré en haut et à gauche : le soleil vient d'en haut), dormant, vitres séparées
// par les montants (cols x rows) et une imposte (transom px), appui en saillie et coulures dessous
function windowIn(p, x, y, w, h, { frame = '#f2f0ea', reveal = 3, cols = 2, rows = 1, transom = 0, sill = '#cfc6b8', kind = 'house', lit = false } = {}) {
    const ctx = p.color;
    p.rect(x - reveal, y - reveal, w + 2 * reveal, h + 2 * reveal, { h: 0.35, r: 0.9 });
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - reveal, y - reveal, w + 2 * reveal, reveal);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x - reveal, y, reveal, h);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(x + w, y, reveal, h);
    p.rect(x, y, w, h, { c: frame, h: 0.42, r: 0.5 });
    const f = 2, on = lit ? 1 : 0;
    const top = transom ? y + f + transom : y + f;
    if (transom) pane(p, x + f, y + f, w - 2 * f, transom - f, { kind, lit: on });
    const cw = (w - 2 * f - (cols - 1) * f) / cols, rh = (y + h - f - top - (rows - 1) * f) / rows;
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) pane(p, x + f + c * (cw + f), top + r * (rh + f), cw, rh, { kind, lit: on });
    }
    // Ombre du linteau sur la vitre
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y, w, 3);
    if (sill) {
        p.rect(x - reveal - 2, y + h + reveal - 1, w + 2 * reveal + 4, 3, { c: sill, h: 0.85, r: 0.8 });
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x - reveal - 2, y + h + reveal + 2, w + 2 * reveal + 4, 1.5);
        streaks(p, x - reveal, y + h + reveal + 3, w + 2 * reveal);
    }
}

// Volet à persiennes (un battant) : lames horizontales en relief
function shutter(p, x, y, w, h, color) {
    p.rect(x, y, w, h, { c: color, h: 0.66, r: 0.7 });
    for (let s = y + 1; s < y + h - 1; s += 3) p.rect(x + 1, s, w - 2, 1, { c: 'rgba(0,0,0,0.22)', h: 0.6 });
    p.rect(x, y, w, 1, { c: 'rgba(255,255,255,0.15)' });
}

// Garde-corps en fer : main courante, lisse basse, barreaux (et leur ombre)
function railing(p, x, y, w, h, color = '#2b2d30') {
    p.color.fillStyle = 'rgba(0,0,0,0.12)';
    for (let b = x + 1; b < x + w; b += 3) p.color.fillRect(b + 1, y + 3, 1, h);
    for (let b = x + 1; b < x + w; b += 3) p.rect(b, y, 1, h, { c: color, h: 0.88, r: 0.5 });
    p.rect(x, y, w, 2, { c: color, h: 0.92, r: 0.5 });
    p.rect(x, y + h - 2, w, 2, { c: color, h: 0.9, r: 0.5 });
}

// Façades : WINDOWS x WINDOWS cellules de C px (une travée de BAY m sur un étage de FLOOR m), murs clairs teintés par
// la couleur de chaque bâtiment. Cinq styles :
// - glass : mur-rideau des tours (vitrage en deux panneaux par travée, allège en verre opaque, meneaux en aluminium) ;
// - office : bureaux à bandeaux vitrés continus, panneaux de béton, stores à lamelles ;
// - house : immeubles d'habitation enduits (fenêtres à imposte, volets à persiennes, portes-fenêtres à garde-corps) ;
// - brick : immeubles en brique (linteaux et appuis en pierre) ;
// - stone : immeubles en pierre de taille (assises, chambranles moulurés, balcons filants en fer forgé).
const C = 80;
const S = C * WINDOWS;

function glassFacade() {
    const p = new FacadePainter(S, S, 71), { rnd } = p;
    p.rect(0, 0, S, S, { c: '#b9c0c6', h: 0.6, r: 0.35 });          // meneaux et traverses (aluminium)
    const vision = C - 22, half = (C - 8) / 2;
    for (let j = 0; j < WINDOWS; j++) {
        for (let i = 0; i < WINDOWS; i++) {
            const x = i * C, y = j * C, on = rnd() < 0.4 ? 1 : 0;
            for (let k = 0; k < 2; k++) pane(p, x + 3 + k * (half + 2), y + 3, half, vision, { kind: 'glass', light: 1.05, lit: on });
            // Allège : verre opaque, teinte légèrement différente d'un panneau à l'autre
            const t = 0.85 + rnd() * 0.2;
            const g = p.color.createLinearGradient(0, y + vision + 5, 0, y + C - 3);
            g.addColorStop(0, rgb(112 * t, 130 * t, 146 * t));
            g.addColorStop(1, rgb(80 * t, 94 * t, 108 * t));
            p.rect(x + 3, y + vision + 5, C - 6, C - vision - 8, { c: g, h: 0.35, r: 0.1 });
            // Ombre des traverses saillantes
            p.rect(x + 3, y + 3, C - 6, 2, { c: 'rgba(0,0,0,0.2)' });
        }
    }
    return p.textures(2);
}

function officeFacade() {
    const p = new FacadePainter(S, S, 72), { rnd } = p;
    wall(p, '#e6e2da', { blotches: 30, grainAlpha: 0.04, height: 0.65, rough: 0.8 });
    const ribbonY = 20, ribbonH = 40;
    for (let j = 0; j < WINDOWS; j++) {
        const y = j * C;
        // Panneaux de béton : joints verticaux et horizontaux
        p.rect(0, y + C - 1, S, 1, { c: 'rgba(0,0,0,0.18)', h: 0.5 });
        for (let i = 0; i < WINDOWS; i++) p.rect(i * C, y, 1, C, { c: 'rgba(0,0,0,0.14)', h: 0.5 });
        // Bandeau vitré en retrait
        const ry = y + ribbonY;
        p.rect(0, ry - 3, S, ribbonH + 3, { c: 'rgba(0,0,0,0.3)', h: 0.4, r: 0.9 });
        for (let i = 0; i < WINDOWS; i++) {
            const on = rnd() < 0.33 ? 1 : 0;
            for (let k = 0; k < 2; k++) {
                const px = i * C + k * C / 2;
                pane(p, px + 1.5, ry, C / 2 - 3, ribbonH, { kind: 'office', light: 0.95, lit: on });
                p.rect(px - 1.5, ry, 3, ribbonH, { c: '#7f878e', h: 0.5, r: 0.4 });   // montant
            }
        }
        // Nez de dalle (appui filant) et son ombre, coulures
        p.rect(0, ry + ribbonH, S, 3, { c: '#d6d1c8', h: 0.8, r: 0.7 });
        p.rect(0, ry + ribbonH + 3, S, 1.5, { c: 'rgba(0,0,0,0.22)' });
        for (let i = 0; i < WINDOWS; i++) if (rnd() < 0.5) streaks(p, i * C + rnd() * C * 0.6, ry + ribbonH + 4, C * 0.4, 0.08);
    }
    return p.textures();
}

const SHUTTERS = ['#6f7d6a', '#7c6a58', '#5f6f7f', '#8a8a82', '#9b5f4a', '#e8e4da'];
function houseFacade() {
    const p = new FacadePainter(S, S, 73), { rnd } = p;
    wall(p, '#efe8dc', { blotches: 70, grainAlpha: 0.06 });
    for (let j = 0; j < WINDOWS; j++) {
        const y = j * C;
        // Bandeau d'étage
        p.rect(0, y + C - 5, S, 4, { c: '#f4efe5', h: 0.7, r: 0.85 });
        p.rect(0, y + C - 1, S, 1, { c: 'rgba(0,0,0,0.15)' });
        const french = rnd() < 0.4;                                  // étage à portes-fenêtres et garde-corps
        const color = SHUTTERS[Math.floor(rnd() * SHUTTERS.length)];
        for (let i = 0; i < WINDOWS; i++) {
            const x = i * C + 25, w = 30, wy = y + (french ? 8 : 14), wh = french ? 62 : 44;
            if (rnd() < 0.5) {
                shutter(p, x - 17, wy, 13, wh, color);
                shutter(p, x + w + 4, wy, 13, wh, color);
            }
            windowIn(p, x, wy, w, wh, { transom: french ? 0 : 10, sill: french ? null : '#d2c9bb', lit: rnd() < 0.38 });
            if (french) railing(p, x - 3, wy + wh - 20, w + 6, 18);
        }
    }
    return p.textures();
}

const BRICKS = ['#b0644a', '#a85c44', '#b86d50', '#9e563f', '#c07a5c', '#a96a52'];
function brickFacade() {
    const p = new FacadePainter(S, S, 74), { rnd } = p;
    p.rect(0, 0, S, S, { c: '#cbc1b3', h: 0.48, r: 0.95 });           // mortier
    const BW = 10, BH = 4;                                          // brique + joint (px)
    for (let row = 0; row * BH < S; row++) {
        for (let bx = row % 2 ? -BW / 2 : 0; bx < S; bx += BW) {
            const base = BRICKS[Math.floor(rnd() * BRICKS.length)];
            p.rect(bx, row * BH, BW - 1, BH - 1, { c: shade(base, 0.85 + rnd() * 0.3), h: 0.6 + rnd() * 0.06, r: 0.9 });
        }
    }
    // Suie et salissures
    for (let i = 0; i < 25; i++) {
        const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 70;
        const g = p.color.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(40,30,25,${0.05 + rnd() * 0.08})`);
        g.addColorStop(1, 'rgba(40,30,25,0)');
        p.color.fillStyle = g;
        p.color.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (let j = 0; j < WINDOWS; j++) {
        const y = j * C, frame = rnd() < 0.6 ? '#f0eee8' : '#3b3f44';
        for (let i = 0; i < WINDOWS; i++) {
            const x = i * C + 22, w = 36, wy = y + 18, wh = 44;
            p.rect(x - 6, wy - 10, w + 12, 7, { c: '#d9d1c3', h: 0.72, r: 0.85 });   // linteau en pierre
            p.rect(x - 6, wy - 3, w + 12, 1, { c: 'rgba(0,0,0,0.25)' });
            windowIn(p, x, wy, w, wh, { frame, transom: 12, sill: '#d6cec0', lit: rnd() < 0.36 });
        }
    }
    return p.textures(3);
}

function stoneFacade() {
    const p = new FacadePainter(S, S, 75), { rnd } = p;
    wall(p, '#e9dfcd', { blotches: 60, grainAlpha: 0.05, height: 0.62 });
    // Assises de pierre de taille (joints fins, blocs de teintes un peu différentes)
    const course = C / 4, block = 40;
    for (let row = 0; row * course < S; row++) {
        const y = row * course;
        for (let x = (row % 2) * block / 2 - block / 2; x < S; x += block) {
            p.color.fillStyle = rnd() < 0.5 ? `rgba(255,250,240,${rnd() * 0.08})` : `rgba(90,75,60,${rnd() * 0.06})`;
            p.color.fillRect(x, y, block, course);
            p.rect(x, y, 1, course, { c: 'rgba(90,75,60,0.2)', h: 0.5 });
        }
        p.rect(0, y, S, 1, { c: 'rgba(90,75,60,0.25)', h: 0.5 });
    }
    for (let j = 0; j < WINDOWS; j++) {
        const y = j * C, balcony = j % 4 === 1;                          // balcon filant tous les 4 étages
        p.rect(0, y + C - 4, S, 4, { c: '#f1e8d8', h: 0.75, r: 0.85 });   // corniche d'étage
        p.rect(0, (y + C) % S, S, 1.5, { c: 'rgba(0,0,0,0.2)' });
        for (let i = 0; i < WINDOWS; i++) {
            const x = i * C + 24, w = 32, wy = y + 8, wh = 60;
            // Chambranle mouluré et clé de voûte
            p.rect(x - 7, wy - 7, w + 14, wh + 7, { c: '#f3eadb', h: 0.7, r: 0.85 });
            p.rect(x - 7, wy - 7, 1, wh + 7, { c: 'rgba(0,0,0,0.15)' });
            p.rect(x + w / 2 - 4, wy - 11, 8, 7, { c: '#f5ecdd', h: 0.8, r: 0.85 });
            windowIn(p, x, wy, w, wh, { frame: '#ece8e0', transom: 12, sill: null, lit: rnd() < 0.38 });
            if (!balcony) railing(p, x - 3, wy + wh - 22, w + 6, 20);
        }
        if (balcony) {
            railing(p, 0, y + 46, S, 22);
            p.rect(0, y + 68, S, 4, { c: '#e2d8c6', h: 0.95, r: 0.8 });   // dalle du balcon
            p.rect(0, y + 72, S, 2.5, { c: 'rgba(0,0,0,0.3)' });
        }
    }
    return p.textures();
}

function facadeTextures(style) {
    return { glass: glassFacade, office: officeFacade, house: houseFacade, brick: brickFacade, stone: stoneFacade }[style]();
}

// Rez-de-chaussée : vitrines (une boutique toutes les deux travées), enseigne au-dessus, porte
const SIGNS = ['#8a3030', '#2f4f78', '#2f6040', '#3c3c3c', '#9a7426', '#6a3a6a', '#1f5f63'];
const AWNINGS = ['#9b2f2f', '#2f5a3a', '#2e4a72', '#7a5a2a', '#444444'];
function shopTextures() {
    const W = S, H = C;
    const p = new FacadePainter(W, H, 76), { rnd } = p, ctx = p.color;
    wall(p, '#ddd7cc', { blotches: 12, grainAlpha: 0.05, height: 0.65 });
    const SW = 2 * C;                                               // une boutique toutes les deux travées
    for (let x = 0; x < W; x += SW) {
        // Enseigne (lettres claires, en relief)
        const sign = SIGNS[Math.floor(rnd() * SIGNS.length)];
        p.rect(x + 10, 5, SW - 20, 12, { c: sign, h: 0.78, r: 0.5 });
        const lx = x + 30 + rnd() * 30, lw = 40 + rnd() * 40;
        for (let l = lx; l < lx + lw; l += 6) p.rect(l, 8, 4, 6, { c: 'rgba(255,255,255,0.85)', h: 0.82 });
        // Vitrine : intérieur éclairé, rayonnages et marchandises, reflet par-dessus
        const gy = 21, gh = 51, gx = x + 12, gw = SW - 24;
        p.rect(gx - 3, gy - 3, gw + 6, gh + 3, { c: '#3c4248', h: 0.45, r: 0.5 });   // devanture (cadre)
        const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
        g.addColorStop(0, '#8d8a84');
        g.addColorStop(1, '#4f4d4a');
        p.rect(gx, gy, gw, gh, { c: g, h: 0.3, r: 0.06 });
        for (let s = gy + 14; s < gy + gh; s += 12) {
            ctx.fillStyle = 'rgba(30,28,26,0.5)';
            ctx.fillRect(gx, s, gw, 1.5);                                // étagère
            for (let k = 0; k < 10; k++) {
                ctx.fillStyle = `rgba(${80 + rnd() * 175},${80 + rnd() * 175},${80 + rnd() * 175},0.55)`;
                const w = 3 + rnd() * 7, h = 4 + rnd() * 6;
                ctx.fillRect(gx + rnd() * (gw - w), s - h, w, h);
            }
        }
        const r = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
        r.addColorStop(0, 'rgba(200,215,230,0.35)');
        r.addColorStop(0.5, 'rgba(200,215,230,0.05)');
        r.addColorStop(1, 'rgba(200,215,230,0.2)');
        ctx.fillStyle = r;
        ctx.fillRect(gx, gy, gw, gh);
        // Porte vitrée et montants
        const dx = x + SW / 2 - 11;
        p.rect(dx, gy + 2, 22, gh - 2, { c: '#2f3438', h: 0.4, r: 0.3 });
        p.rect(dx + 3, gy + 5, 16, gh - 12, { c: 'rgba(120,135,150,0.6)', h: 0.3, r: 0.06 });
        for (const mx of [gx + gw / 4, gx + 3 * gw / 4]) p.rect(mx - 1, gy, 2, gh, { c: '#3c4248', h: 0.45 });
        // Store banne (une boutique sur deux) : toile rayée en saillie, ombre dessous
        if (rnd() < 0.5) {
            const color = AWNINGS[Math.floor(rnd() * AWNINGS.length)];
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(gx - 4, gy + 9, gw + 8, 8);
            for (let s = gx - 4, k = 0; s < gx + gw + 4; s += 8, k++) {
                p.rect(s, gy - 2, Math.min(8, gx + gw + 4 - s), 11, { c: k % 2 ? '#efe9de' : color, h: 0.95, r: 0.85 });
            }
            p.rect(gx - 4, gy + 9, gw + 8, 1.5, { c: 'rgba(0,0,0,0.35)' });
        }
        // La nuit : vitrine et enseigne allumées
        if (rnd() < 0.75) p.glow(gx, gy, gw, gh, '#ffe2b0');
        if (rnd() < 0.8) p.glow(x + 10, 5, SW - 20, 12, ['#ff6060', '#70b0ff', '#80ff90', '#ffe070'][Math.floor(rnd() * 4)]);
    }
    p.rect(0, H - 6, W, 6, { c: '#8f8a82', h: 0.7, r: 0.9 });       // soubassement
    p.rect(0, H - 7, W, 1, { c: 'rgba(0,0,0,0.25)' });
    return p.textures();
}

// Toits : membrane / gravillons gris clair, joints et taches
function roofTexture() {
    const rnd = random(75);
    return canvasTexture(256, (ctx, S) => {
        ctx.fillStyle = '#c6c4be';
        ctx.fillRect(0, 0, S, S);
        grain(ctx, S, S, rnd, 7000, 0.08);
        for (let i = 0; i < 6; i++) {
            const x = rnd() * S, y = rnd() * S, r = 15 + rnd() * 40;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(60,55,50,0.12)');
            g.addColorStop(1, 'rgba(60,55,50,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let p = 0; p < S; p += 64) ctx.fillRect(p, 0, 2, S);
    });
}

// Sol d'un îlot (une case de CELL m) : demi-rue sur chaque bord (axe pointillé au bord de la case, partagé avec la
// voisine), trottoir, puis béton (îlot bâti) ou pelouse (parc). Carte d'émission : lampadaires le long des trottoirs
function groundTextures(park) {
    const size = 512, scale = size / CELL;
    const half = ROAD / 2 * scale, walk = SIDEWALK * scale;
    const map = canvasTexture(size, (ctx) => {
        ctx.fillStyle = '#3a3c3f';                       // chaussée
        ctx.fillRect(0, 0, size, size);
        const rnd = random(park ? 5 : 9);
        for (let i = 0; i < 4000; i++) {
            ctx.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},0.06)`;
            ctx.fillRect(rnd() * size, rnd() * size, 2, 2);
        }
        ctx.fillStyle = '#9a9894';                       // trottoirs
        ctx.fillRect(half, half, size - 2 * half, size - 2 * half);
        ctx.fillStyle = park ? '#4d7a35' : '#7d7b77';    // pelouse ou béton
        ctx.fillRect(half + walk, half + walk, size - 2 * (half + walk), size - 2 * (half + walk));
        if (park) {
            // Allées en croix
            ctx.fillStyle = '#b8a888';
            ctx.fillRect(size / 2 - 6, half + walk, 12, size - 2 * (half + walk));
            ctx.fillRect(half + walk, size / 2 - 6, size - 2 * (half + walk), 12);
        }
        // Axe des rues (pointillé blanc, au bord de la case) et passages piétons aux carrefours
        ctx.fillStyle = '#e4e2da';
        const dash = 6 * scale;
        for (let p = half + 2 * scale; p < size - half - 2 * scale; p += 2 * dash) {
            ctx.fillRect(p, 0, dash, 3);
            ctx.fillRect(p, size - 3, dash, 3);
            ctx.fillRect(0, p, 3, dash);
            ctx.fillRect(size - 3, p, 3, dash);
        }
        for (const corner of [0, 1]) {
            const at = corner ? size - half - 3 * scale : half;
            for (let s = 0; s < half - 4; s += 9) {
                ctx.fillRect(at, s + 4, 3 * scale, 5);                 // en travers des rues nord-sud
                ctx.fillRect(at, size - s - 9, 3 * scale, 5);
                ctx.fillRect(s + 4, at, 5, 3 * scale);                 // en travers des rues est-ouest
                ctx.fillRect(size - s - 9, at, 5, 3 * scale);
            }
        }
    });
    const emissive = canvasTexture(size, (ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, size, size);
        // Halo des lampadaires sur la chaussée, tous les ~26 m de chaque côté de l'îlot
        for (let p = half + 10 * scale; p < size - half; p += 26 * scale) {
            for (const [x, y] of [[p, half - 3 * scale], [p, size - half + 3 * scale], [half - 3 * scale, p], [size - half + 3 * scale, p]]) {
                const glow = ctx.createRadialGradient(x, y, 0, x, y, 6 * scale);
                glow.addColorStop(0, 'rgba(255,190,110,0.85)');
                glow.addColorStop(1, 'rgba(255,190,110,0)');
                ctx.fillStyle = glow;
                ctx.fillRect(x - 6 * scale, y - 6 * scale, 12 * scale, 12 * scale);
            }
        }
    });
    return { map, emissive };
}

// Maillage en cours de construction (positions, normales, uv, couleurs, indices)
class MeshBuilder {
    constructor() {
        this.positions = [];
        this.normals = [];
        this.uvs = [];
        this.colors = [];
        this.indices = [];
    }

    // Quadrilatère a, b, c, d (sens anti-horaire vu de devant), normale n, uv des quatre coins, couleur ; shade
    // assombrit a et b (bas des murs : ombre portée du sol et des voisins)
    quad(a, b, c, d, n, uv, color, shade = 1) {
        const base = this.positions.length / 3;
        for (const p of [a, b, c, d]) this.positions.push(p[0], p[1], p[2]);
        for (let i = 0; i < 4; i++) {
            const s = i < 2 ? shade : 1;
            this.normals.push(n[0], n[1], n[2]);
            this.colors.push(color.r * s, color.g * s, color.b * s);
        }
        this.uvs.push(...uv);
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    // Quatre murs (x0..x1, y0..y1, z0..z1) ; v0, v1 : coordonnées v de la texture en bas et en haut. Chaque mur porte
    // un nombre entier de travées (pas de fenêtre coupée à l'angle), à partir d'une travée tirée selon le bâtiment
    // (fenêtres allumées et volets différents d'un bâtiment à l'autre)
    walls(x0, x1, y0, y1, z0, z1, color, shade, v0, v1) {
        const offset = Math.floor((((x0 * 0.37 + z0 * 0.71) % 1 + 1) % 1) * WINDOWS) / WINDOWS;
        const u = (m) => Math.max(1, Math.round(m / BAY)) / WINDOWS;
        const uvs = (w) => [offset, v0, offset + u(w), v0, offset + u(w), v1, offset, v1];
        const wx = x1 - x0, wz = z1 - z0;
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uvs(wx), color, shade);    // sud
        this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uvs(wx), color, shade);   // nord
        this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uvs(wz), color, shade);    // est
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uvs(wz), color, shade);   // ouest
    }

    // Boîte : façades (fenêtres à l'échelle des étages) et toit (dans roof, sauf si null ; texture répétée tous
    // les 12 m)
    box(x0, x1, y0, y1, z0, z1, color, roof = this, roofColor = color, shade = 1) {
        // Nombre entier d'étages, à partir d'un étage de la texture tiré selon le bâtiment
        const floors = Math.max(1, Math.round((y1 - y0) / FLOOR));
        const v0 = Math.floor((((x0 * 0.13 + z0 * 0.29) % 1 + 1) % 1) * WINDOWS) / WINDOWS;
        this.walls(x0, x1, y0, y1, z0, z1, color, shade, v0, v0 + floors / WINDOWS);
        const ru = (x1 - x0) / 12, rv = (z1 - z0) / 12;
        roof?.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [0, 0, ru, 0, ru, rv, 0, rv], roofColor);
    }

    // Bandeau sans toit (rez-de-chaussée) : la texture entière sur la hauteur
    band(x0, x1, y0, y1, z0, z1, color, shade) {
        this.walls(x0, x1, y0, y1, z0, z1, color, shade, 0, 1);
    }

    // Case de sol (carré horizontal, uv 0..1)
    tile(x0, x1, z0, z1, y) {
        this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], { r: 1, g: 1, b: 1 });
    }

    geometry() {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
        geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
        geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
        geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
        geometry.setIndex(this.positions.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(this.indices), 1) : this.indices);
        geometry.computeBoundingSphere();
        return geometry;
    }
}

// Couleurs des bâtiments : verre bleuté ou gris acier pour les tours, crépis et pierre pour les autres
const TOWER_COLORS = [0xc4d6e4, 0xd0dde3, 0xdfe4e8, 0xb8cbdc, 0xeceff1, 0xd2dbd0, 0xe6e0d4];
const BUILDING_COLORS = [0xf2e8d6, 0xe8dcc4, 0xf6f1e6, 0xe0cfb6, 0xece6dd, 0xf0dcc2, 0xd9d6d0, 0xe9d8c6, 0xf3e3cf, 0xdedbd2];
const BRICK_TINTS = [0xffffff, 0xf6f0e8, 0xeeeae4, 0xfbf4ea];
const ROOF_COLORS = [0xd8d6d0, 0xc9c8c4, 0xe0ddd5, 0xbfc2c4, 0xcfcbc2];
const FACADE_STYLES = ['glass', 'office', 'house', 'brick', 'stone'];
const SHOP_FLOOR = 4.4;                 // hauteur du rez-de-chaussée commerçant (m)

class City {
    // airport : réseau d'aérodromes (contains, inCorridor, list) ; terrain : pour éviter les lacs (lakeAt)
    constructor({ airport, terrain }) {
        Object.assign(this, { airport, terrain });
        this.center = { ...CENTER };
        this.radius = RADIUS;
        this.group = new Group();
        this.group.name = 'ville';
        this.obstacles = [];          // boîtes (Box3, repère monde) des bâtiments
        this._materials = null;
    }

    // 0 sous la ville (sol plat), 1 au-delà de ses abords (relief normal) : facteur de relief du terrain
    reliefFactor(x, z) {
        return MathUtils.smoothstep(Math.hypot(x - CENTER.x, z - CENTER.z), RADIUS + 60, RADIUS + 700);
    }

    // Vallée sans montagnes autour de la ville (Terrain, clearings)
    get clearing() { return { x: CENTER.x, z: CENTER.z, rx: RADIUS * 1.45, rz: RADIUS * 1.45 }; }

    contains(x, z, margin = 0) { return Math.hypot(x - CENTER.x, z - CENTER.z) < RADIUS + margin; }

    build() {
        const rnd = random(2026);
        const styles = Object.fromEntries(FACADE_STYLES.map((style) => [style, new MeshBuilder()]));
        const shops = new MeshBuilder(), roofs = new MeshBuilder(), blocks = new MeshBuilder(), parks = new MeshBuilder();
        const treeSpots = [], beacons = [];
        const color = new Color(), roofColor = new Color(), trim = new Color(), mech = new Color();
        const fields = this.airport.list;
        const inner = CELL - ROAD - 2 * SIDEWALK;          // côté constructible d'un îlot
        const count = Math.ceil(RADIUS / CELL);
        for (let i = -count; i < count; i++) {
            for (let j = -count; j < count; j++) {
                const x0 = CENTER.x + i * CELL, z0 = CENTER.z + j * CELL;
                const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
                const r = Math.hypot(cx - CENTER.x, cz - CENTER.z) / RADIUS;
                if (r > 1 - CELL / 2 / RADIUS) continue;
                // Pas dans les couloirs d'approche, ni sur les lacs, ni trop près d'un aérodrome
                if (this.airport.contains(cx, cz, 250) || this._nearCorridor(cx, cz) || this.terrain.lakeAt?.(cx, cz, CELL)) continue;
                // Hauteur maximale : décroît en approchant des aérodromes (~10 % de la distance au-delà de 1,2 km)
                const nearest = Math.min(...fields.map((f) => Math.hypot(cx - f.center.x, cz - f.center.z)));
                const cap = Math.max(8, (nearest - 1200) * 0.12);
                // Parcs : un grand parc au centre-nord, d'autres semés au hasard
                const centralPark = Math.abs(i + 0.5 - 1) < 1.2 && Math.abs(j + 0.5 + 3) < 1.2;
                const park = centralPark || (r > 0.25 && rnd() < 0.08);
                (park ? parks : blocks).tile(x0, x0 + CELL, z0, z0 + CELL, GROUND_Y);
                if (park) {
                    for (let t = 0; t < 26; t++) {
                        const tx = x0 + ROAD / 2 + SIDEWALK + 4 + rnd() * (inner - 8);
                        const tz = z0 + ROAD / 2 + SIDEWALK + 4 + rnd() * (inner - 8);
                        if (Math.abs(tx - cx) < 5 || Math.abs(tz - cz) < 5) continue;   // (pas sur les allées)
                        treeSpots.push([tx, tz, 0.8 + rnd() * 0.6]);
                    }
                    continue;
                }
                // Parcelles : 2 x 2 au centre (tours), 2 x 2 ou 3 x 3 ailleurs
                const n = r < 0.3 ? 2 : rnd() < 0.5 ? 2 : 3;
                const lot = inner / n;
                for (let a = 0; a < n; a++) {
                    for (let b = 0; b < n; b++) {
                        if (r > 0.7 && rnd() < 0.25) continue;   // (terrains vagues, cours, parkings en périphérie)
                        let height;
                        if (r < 0.32) height = 45 + Math.pow(rnd(), 1.4) * 190 * (1 - r / 0.32) + rnd() * 30;
                        else if (r < 0.65) height = 14 + rnd() * 36;
                        else height = 6 + rnd() * 12;
                        height = Math.min(height, cap);
                        const tower = height > 60;
                        // Emprise : la parcelle moins une cour (plus étroite pour les tours, élancées)
                        const margin = tower ? lot * (0.12 + rnd() * 0.12) : 1.5 + rnd() * 3;
                        const bx0 = x0 + ROAD / 2 + SIDEWALK + a * lot + margin, bx1 = bx0 + lot - 2 * margin;
                        const bz0 = z0 + ROAD / 2 + SIDEWALK + b * lot + margin, bz1 = bz0 + lot - 2 * margin;
                        // Style de façade : mur-rideau pour les tours, bureaux ou logements pour les autres
                        // Style de façade : mur-rideau pour les tours ; au centre surtout bureaux et pierre de taille, en
                        // périphérie surtout enduit et brique
                        const pick = rnd();
                        const style = tower ? 'glass' : r < 0.65
                            ? (pick < 0.4 ? 'office' : pick < 0.65 ? 'stone' : pick < 0.8 ? 'brick' : 'house')
                            : (pick < 0.5 ? 'house' : pick < 0.85 ? 'brick' : 'office');
                        const facades = styles[style];
                        // (brique : teinte presque blanche, la couleur est dans la texture)
                        const palette = tower ? TOWER_COLORS : style === 'brick' ? BRICK_TINTS : BUILDING_COLORS;
                        color.setHex(palette[Math.floor(rnd() * palette.length)]).convertSRGBToLinear();
                        color.multiplyScalar(0.92 + rnd() * 0.12);
                        roofColor.setHex(ROOF_COLORS[Math.floor(rnd() * ROOF_COLORS.length)]).convertSRGBToLinear();
                        const y0 = GROUND_Y - 0.5;
                        // Rez-de-chaussée commerçant (sauf petits bâtiments), ombré au pied
                        let base = y0;
                        if (height >= 9 && (tower || r < 0.75)) {
                            shops.band(bx0, bx1, y0, SHOP_FLOOR, bz0, bz1, color, 0.6);
                            base = SHOP_FLOOR;
                        }
                        let top = height;
                        // Tours : étage en retrait, locaux techniques sur le toit, feu d'obstacle rouge au sommet
                        if (tower) {
                            facades.box(bx0, bx1, base, height, bz0, bz1, color, roofs, roofColor, base === y0 ? 0.6 : 1);
                            const inset = (bx1 - bx0) * (0.12 + rnd() * 0.1);
                            if (rnd() < 0.6) {
                                top = height + 8 + rnd() * 22;
                                facades.box(bx0 + inset, bx1 - inset, height, top, bz0 + inset, bz1 - inset, color, roofs, roofColor);
                            }
                            const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
                            mech.setHex(0xb4b6b7).convertSRGBToLinear();
                            roofs.box(mx - 4, mx + 4, top, top + 4, mz - 3, mz + 3, mech, roofs);
                            beacons.push([mx, top + 5, mz]);
                            top += 6;
                        } else {
                            // Corniche (légèrement en saillie, plus claire) qui porte le toit
                            facades.box(bx0, bx1, base, height, bz0, bz1, color, null, roofColor, base === y0 ? 0.6 : 1);
                            trim.copy(color).multiplyScalar(1.08);
                            roofs.box(bx0 - 0.3, bx1 + 0.3, height, height + 0.8, bz0 - 0.3, bz1 + 0.3, trim, roofs, roofColor);
                            top = height + 0.8;
                            if (rnd() < 0.5) {
                                const mx = bx0 + (bx1 - bx0) * (0.3 + rnd() * 0.4), mz = bz0 + (bz1 - bz0) * (0.3 + rnd() * 0.4);
                                mech.setHex(0xbdbfc0).convertSRGBToLinear();
                                roofs.box(mx - 2, mx + 2, top, top + 2.5, mz - 1.5, mz + 1.5, mech, roofs);
                            }
                        }
                        this.obstacles.push(new Box3(new Vector3(bx0, 0, bz0), new Vector3(bx1, top, bz1)));
                    }
                }
            }
        }

        const m = this._makeMaterials();
        const add = (builder, material, { cast = true, receive = true } = {}) => {
            if (!builder.positions.length) return null;
            const mesh = new Mesh(builder.geometry(), material);
            mesh.castShadow = cast;
            mesh.receiveShadow = receive;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            return mesh;
        };
        for (const style in styles) add(styles[style], m[style]);
        add(shops, m.shop);
        add(roofs, m.roof);
        add(blocks, m.block, { cast: false });
        add(parks, m.park, { cast: false });

        // Arbres des parcs : tronc et houppier instanciés
        const placement = new Object3D();
        const trunks = new InstancedMesh(new CylinderGeometry(0.25, 0.35, 3, 6).translate(0, 1.5, 0), m.trunk, treeSpots.length);
        const crowns = new InstancedMesh(new ConeGeometry(2.6, 7, 7).translate(0, 6, 0), m.leaves, treeSpots.length);
        treeSpots.forEach(([x, z, s], k) => {
            placement.position.set(x, GROUND_Y, z);
            placement.scale.setScalar(s);
            placement.rotation.y = k;
            placement.updateMatrix();
            trunks.setMatrixAt(k, placement.matrix);
            crowns.setMatrixAt(k, placement.matrix);
        });
        for (const mesh of [trunks, crowns]) {
            mesh.castShadow = mesh.receiveShadow = true;
            mesh.computeBoundingSphere();
            this.group.add(mesh);
        }

        // Feux d'obstacle (rouges, au sommet des tours)
        const lights = new InstancedMesh(new CylinderGeometry(0.7, 0.7, 1.2, 8), m.beacon, beacons.length);
        beacons.forEach(([x, y, z], k) => {
            placement.position.set(x, y, z);
            placement.scale.setScalar(1);
            placement.updateMatrix();
            lights.setMatrixAt(k, placement.matrix);
        });
        lights.computeBoundingSphere();
        this.group.add(lights);
        this.group.updateMatrixWorld(true);
        return this.group;
    }

    // Couloirs d'approche, avec une marge : aucune construction dans l'axe des pistes
    _nearCorridor(x, z) {
        const d = CELL * 0.75;
        return this.airport.inCorridor(x, z) || this.airport.inCorridor(x + d, z) || this.airport.inCorridor(x - d, z)
            || this.airport.inCorridor(x, z + d) || this.airport.inCorridor(x, z - d);
    }

    _makeMaterials() {
        const block = groundTextures(false), park = groundTextures(true);
        // Sol des îlots : décalé vers la caméra pour ne pas scintiller avec le terrain (plat juste en dessous)
        const ground = (t) => new MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: 0xffffff,
            emissiveIntensity: 0, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
        // Façades : relief (carte de normales) et rugosité peints avec la couleur (vitres lisses, murs mats) ; pas de
        // métal (sans carte d'environnement, il ne ferait qu'assombrir)
        const facade = (t) => new MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
            roughness: 1, metalness: 0, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true });
        this._materials = {
            ...Object.fromEntries(FACADE_STYLES.map((style) => [style, facade(facadeTextures(style))])),
            shop: facade(shopTextures()),
            roof: new MeshStandardMaterial({ map: roofTexture(), vertexColors: true, roughness: 0.95 }),
            block: ground(block),
            park: ground(park),
            trunk: new MeshStandardMaterial({ color: 0x5b4330, roughness: 0.9 }),
            leaves: new MeshStandardMaterial({ color: 0x3f6e2c, roughness: 0.85 }),
            beacon: new MeshBasicMaterial({ color: 0x551010, toneMapped: false }),
        };
        return this._materials;
    }

    // night : 0 (jour) à 1 (nuit) : fenêtres allumées, lampadaires, feux d'obstacle
    setNight(night) {
        const m = this._materials;
        if (!m) return;
        for (const style of FACADE_STYLES) m[style].emissiveIntensity = 1.1 * night;
        m.shop.emissiveIntensity = 1.4 * night;
        m.block.emissiveIntensity = m.park.emissiveIntensity = 1.6 * night;
        m.beacon.color.setRGB(0.35 + 0.65 * night, 0.03, 0.03).multiplyScalar(1 + 2 * night);
    }
}

export { City };
