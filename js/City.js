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

function canvasTexture(size, draw, height = size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = height;
    draw(canvas.getContext('2d'), size, height);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    return texture;
}

const rgb = (r, g, b) => `rgb(${Math.min(255, Math.round(r))},${Math.min(255, Math.round(g))},${Math.min(255, Math.round(b))})`;

// Grain d'un enduit ou d'un béton : petites taches claires et sombres
function grain(ctx, w, h, rnd, count, alpha) {
    for (let i = 0; i < count; i++) {
        ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
}

// Vitre : reflet du ciel (clair en haut, plus sombre en bas), parfois un rideau ou un store à l'intérieur
function pane(ctx, x, y, w, h, rnd, light = 1) {
    const k = (0.8 + rnd() * 0.3) * light;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgb(178 * k, 198 * k, 214 * k));
    g.addColorStop(0.5, rgb(122 * k, 142 * k, 160 * k));
    g.addColorStop(1, rgb(92 * k, 106 * k, 122 * k));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const inside = rnd();
    if (inside < 0.25) {                               // rideau sur un côté
        ctx.fillStyle = 'rgba(236,228,210,0.55)';
        ctx.fillRect(rnd() < 0.5 ? x : x + w * 0.65, y, w * 0.35, h);
    } else if (inside < 0.4) {                         // store à moitié baissé
        ctx.fillStyle = 'rgba(220,214,200,0.6)';
        ctx.fillRect(x, y, w, h * (0.25 + rnd() * 0.4));
    }
    // reflet oblique
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y);
    ctx.lineTo(x + w * 0.55, y);
    ctx.lineTo(x + w * 0.25, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
}

// Façades (WINDOWS x WINDOWS travées x étages, cellule de C px) : murs clairs teintés par la couleur de chaque
// bâtiment ; carte d'émission : une partie des fenêtres allumées (la nuit). Trois styles :
// - glass : mur-rideau des tours (vitrage sur presque toute la travée, allège opaque à chaque étage) ;
// - office : bureaux à bandeaux vitrés continus ;
// - house : immeubles d'habitation (fenêtres encadrées, appuis, volets).
const C = 64;
function facadeTextures(style) {
    const rnd = random(style === 'glass' ? 71 : style === 'office' ? 72 : 73);
    const S = C * WINDOWS;
    const windows = [];                                  // rectangles vitrés, pour la carte d'émission
    const map = canvasTexture(S, (ctx) => {
        ctx.fillStyle = style === 'glass' ? '#d4d8db' : style === 'office' ? '#ebe7df' : '#f1ebdf';
        ctx.fillRect(0, 0, S, S);
        grain(ctx, S, S, rnd, 9000, style === 'glass' ? 0.03 : 0.05);
        for (let j = 0; j < WINDOWS; j++) {
            const top = j * C;
            if (style === 'office') {
                ctx.fillStyle = '#d3cec4';               // nez de dalle
                ctx.fillRect(0, top + 50, S, 4);
            } else if (style === 'house') {
                ctx.fillStyle = 'rgba(0,0,0,0.05)';      // bandeau d'étage
                ctx.fillRect(0, top + C - 4, S, 3);
            }
            for (let i = 0; i < WINDOWS; i++) {
                const left = i * C;
                let w;
                if (style === 'glass') {
                    w = [left + 2, top + 3, C - 4, C - 16];
                    ctx.fillStyle = '#9aa5ae';           // allège
                    ctx.fillRect(left + 2, top + C - 12, C - 4, 10);
                    pane(ctx, ...w, rnd, 1.05);
                } else if (style === 'office') {
                    w = [left + 1, top + 18, C - 2, 31];
                    pane(ctx, ...w, rnd, 0.95);
                } else {
                    w = [left + 19, top + 12, 26, 36];
                    if (rnd() < 0.35) {                  // volets ouverts
                        ctx.fillStyle = ['#6f7d6a', '#7c6a58', '#5f6f7f', '#8a8a82'][Math.floor(rnd() * 4)];
                        ctx.fillRect(w[0] - 13, w[1], 11, w[3]);
                        ctx.fillRect(w[0] + w[2] + 2, w[1], 11, w[3]);
                    }
                    ctx.fillStyle = '#faf8f3';           // encadrement
                    ctx.fillRect(w[0] - 3, w[1] - 3, w[2] + 6, w[3] + 6);
                    ctx.fillStyle = '#c7beb0';           // appui
                    ctx.fillRect(w[0] - 5, w[1] + w[3] + 3, w[2] + 10, 4);
                    ctx.fillStyle = 'rgba(0,0,0,0.06)';  // coulure sous l'appui
                    ctx.fillRect(w[0] - 2, w[1] + w[3] + 7, w[2] + 4, 8);
                    pane(ctx, ...w, rnd, 0.9);
                    ctx.fillStyle = '#f4f2ec';           // croisillon
                    ctx.fillRect(w[0] + w[2] / 2 - 1, w[1], 2, w[3]);
                }
                windows.push(w);
            }
        }
    });
    const lit = style === 'glass' ? 0.4 : style === 'office' ? 0.33 : 0.38;
    const emissive = canvasTexture(S, (ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, S, S);
        for (const [x, y, w, h] of windows) {
            if (rnd() > lit) continue;
            const warm = rnd();
            ctx.fillStyle = style === 'office' && warm < 0.6 ? '#eef4ff'
                : warm < 0.7 ? '#ffd890' : warm < 0.9 ? '#fff3d8' : '#bfe0ff';
            ctx.fillRect(x, y, w, h);
        }
    });
    return { map, emissive };
}

// Rez-de-chaussée : vitrines (une boutique toutes les deux travées), enseigne au-dessus, porte
function shopTextures() {
    const rnd = random(74);
    const W = C * WINDOWS, H = C;
    const shops = [];
    const map = canvasTexture(W, (ctx) => {
        ctx.fillStyle = '#d9d4ca';
        ctx.fillRect(0, 0, W, H);
        grain(ctx, W, H, rnd, 1500, 0.05);
        for (let k = 0; k < WINDOWS / 2; k++) {
            const x = k * 2 * C;
            ctx.fillStyle = ['#8a3030', '#2f4f78', '#2f6040', '#3c3c3c', '#9a7426', '#6a3a6a'][Math.floor(rnd() * 6)];
            ctx.fillRect(x + 6, 4, 2 * C - 12, 10);       // enseigne
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillRect(x + 30 + rnd() * 20, 7, 30 + rnd() * 20, 4);
            const g = ctx.createLinearGradient(0, 18, 0, 60);
            g.addColorStop(0, '#a9b3ba');
            g.addColorStop(1, '#646a6f');
            ctx.fillStyle = g;
            ctx.fillRect(x + 8, 18, 2 * C - 16, 42);     // vitrine
            for (let p = 0; p < 6; p++) {                // marchandises
                ctx.fillStyle = `rgba(${rnd() * 255},${rnd() * 255},${rnd() * 255},0.35)`;
                ctx.fillRect(x + 12 + rnd() * 90, 40 + rnd() * 12, 6 + rnd() * 10, 8);
            }
            ctx.fillStyle = '#3d4246';                   // porte
            ctx.fillRect(x + C - 10, 20, 20, 40);
            ctx.fillStyle = '#c9c4ba';                   // montants
            ctx.fillRect(x + 8 + (2 * C - 16) / 4, 18, 2, 42);
            ctx.fillRect(x + 8 + 3 * (2 * C - 16) / 4, 18, 2, 42);
            shops.push(x);
        }
        ctx.fillStyle = '#8f8b84';                       // soubassement
        ctx.fillRect(0, 60, W, 4);
    }, H);
    const emissive = canvasTexture(W, (ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        for (const x of shops) {
            if (rnd() < 0.75) {
                ctx.fillStyle = '#ffe2b0';
                ctx.fillRect(x + 8, 18, 2 * C - 16, 42);
            }
            if (rnd() < 0.8) {
                ctx.fillStyle = ['#ff6060', '#70b0ff', '#80ff90', '#ffe070'][Math.floor(rnd() * 4)];
                ctx.fillRect(x + 6, 4, 2 * C - 12, 10);
            }
        }
    }, H);
    return { map, emissive };
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

    // Quatre murs (x0..x1, y0..y1, z0..z1) ; vOf : coordonnée v de la texture à une hauteur donnée
    walls(x0, x1, y0, y1, z0, z1, color, shade, vOf) {
        const u = (m) => m / (BAY * WINDOWS);
        const offset = (x0 * 0.37 + z0 * 0.71) % 1;   // (fenêtres allumées différentes d'un bâtiment à l'autre)
        const uvs = (w) => [offset, vOf(y0), offset + u(w), vOf(y0), offset + u(w), vOf(y1), offset, vOf(y1)];
        const wx = x1 - x0, wz = z1 - z0;
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uvs(wx), color, shade);    // sud
        this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uvs(wx), color, shade);   // nord
        this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uvs(wz), color, shade);    // est
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uvs(wz), color, shade);   // ouest
    }

    // Boîte : façades (fenêtres à l'échelle des étages) et toit (dans roof, sauf si null ; texture répétée tous
    // les 12 m)
    box(x0, x1, y0, y1, z0, z1, color, roof = this, roofColor = color, shade = 1) {
        this.walls(x0, x1, y0, y1, z0, z1, color, shade, (y) => y / (FLOOR * WINDOWS));
        const ru = (x1 - x0) / 12, rv = (z1 - z0) / 12;
        roof?.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [0, 0, ru, 0, ru, rv, 0, rv], roofColor);
    }

    // Bandeau sans toit (rez-de-chaussée) : la texture entière sur la hauteur
    band(x0, x1, y0, y1, z0, z1, color, shade) {
        this.walls(x0, x1, y0, y1, z0, z1, color, shade, (y) => (y - y0) / (y1 - y0));
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
const ROOF_COLORS = [0xd8d6d0, 0xc9c8c4, 0xe0ddd5, 0xbfc2c4, 0xcfcbc2];
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
        const styles = { glass: new MeshBuilder(), office: new MeshBuilder(), house: new MeshBuilder() };
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
                        const style = tower ? 'glass' : r < 0.65 && rnd() < 0.45 ? 'office' : 'house';
                        const facades = styles[style];
                        const palette = tower ? TOWER_COLORS : BUILDING_COLORS;
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
        // Façades : pas de métal (sans carte d'environnement, il ne ferait qu'assombrir) ; verre des tours plus lisse
        const facade = (t, roughness) => new MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive,
            emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness, metalness: 0 });
        this._materials = {
            glass: facade(facadeTextures('glass'), 0.35),
            office: facade(facadeTextures('office'), 0.6),
            house: facade(facadeTextures('house'), 0.85),
            shop: facade(shopTextures(), 0.7),
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
        m.glass.emissiveIntensity = m.office.emissiveIntensity = m.house.emissiveIntensity = 1.1 * night;
        m.shop.emissiveIntensity = 1.4 * night;
        m.block.emissiveIntensity = m.park.emissiveIntensity = 1.6 * night;
        m.beacon.color.setRGB(0.35 + 0.65 * night, 0.03, 0.03).multiplyScalar(1 + 2 * night);
    }
}

export { City };
