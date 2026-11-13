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

function canvasTexture(size, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

// Façades : murs blancs (teintés par la couleur de chaque bâtiment) et fenêtres sombres ; carte d'émission : une
// partie des fenêtres allumées (la nuit)
function facadeTextures() {
    const rnd = random(77);
    const cell = 32;
    const map = canvasTexture(cell * WINDOWS, (ctx, size) => {
        ctx.fillStyle = '#e9e6e0';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < WINDOWS; i++) {
            for (let j = 0; j < WINDOWS; j++) {
                const shade = 40 + Math.floor(rnd() * 30);
                ctx.fillStyle = `rgb(${shade},${shade + 12},${shade + 24})`;
                ctx.fillRect(i * cell + 5, j * cell + 6, cell - 10, cell - 11);
                ctx.fillStyle = 'rgba(255,255,255,0.18)';   // reflet du ciel en haut de la vitre
                ctx.fillRect(i * cell + 5, j * cell + 6, cell - 10, 4);
            }
        }
    });
    const emissive = canvasTexture(cell * WINDOWS, (ctx, size) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < WINDOWS; i++) {
            for (let j = 0; j < WINDOWS; j++) {
                if (rnd() > 0.38) continue;
                const warm = rnd();
                ctx.fillStyle = warm < 0.7 ? '#ffd890' : warm < 0.9 ? '#fff3d8' : '#bfe0ff';
                ctx.fillRect(i * cell + 5, j * cell + 6, cell - 10, cell - 11);
            }
        }
    });
    for (const t of [map, emissive]) t.wrapS = t.wrapT = RepeatWrapping;
    return { map, emissive };
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

    // Quadrilatère a, b, c, d (sens anti-horaire vu de devant), normale n, uv des quatre coins, couleur
    quad(a, b, c, d, n, uv, color) {
        const base = this.positions.length / 3;
        for (const p of [a, b, c, d]) this.positions.push(p[0], p[1], p[2]);
        for (let i = 0; i < 4; i++) {
            this.normals.push(n[0], n[1], n[2]);
            this.colors.push(color.r, color.g, color.b);
        }
        this.uvs.push(...uv);
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    // Boîte (x0..x1, y0..y1, z0..z1) : façades (fenêtres à l'échelle des étages) et toit
    box(x0, x1, y0, y1, z0, z1, color, roof = this) {
        const u = (m) => m / (BAY * WINDOWS), v = (m) => m / (FLOOR * WINDOWS);
        const h = y1 - y0, wx = x1 - x0, wz = z1 - z0;
        const offset = (x0 * 0.37 + z0 * 0.71) % 1;   // (fenêtres allumées différentes d'un bâtiment à l'autre)
        const uvs = (w) => [offset, v(y0), offset + u(w), v(y0), offset + u(w), v(y0 + h), offset, v(y0 + h)];
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uvs(wx), color);    // sud
        this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uvs(wx), color);   // nord
        this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uvs(wz), color);    // est
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uvs(wz), color);   // ouest
        roof.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], color);
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
const TOWER_COLORS = [0x8fb2cc, 0x9fb9c4, 0xb7c3cc, 0x7f9fb8, 0xc9cfd3, 0xa9b6a8];
const BUILDING_COLORS = [0xd9cdb6, 0xc7b79c, 0xe2d9c8, 0xb9a48a, 0xcfc6bc, 0xd7c2a8, 0xa9a49c, 0xc4b2a0];

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
        const facades = new MeshBuilder(), roofs = new MeshBuilder(), blocks = new MeshBuilder(), parks = new MeshBuilder();
        const treeSpots = [], beacons = [];
        const color = new Color();
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
                        const palette = tower ? TOWER_COLORS : BUILDING_COLORS;
                        color.setHex(palette[Math.floor(rnd() * palette.length)]).convertSRGBToLinear();
                        color.multiplyScalar(0.85 + rnd() * 0.25);
                        const y0 = GROUND_Y - 0.5;
                        facades.box(bx0, bx1, y0, height, bz0, bz1, color, roofs);
                        let top = height;
                        // Tours : étage en retrait, locaux techniques sur le toit, feu d'obstacle rouge au sommet
                        if (tower) {
                            const inset = (bx1 - bx0) * (0.12 + rnd() * 0.1);
                            if (rnd() < 0.6) {
                                top = height + 8 + rnd() * 22;
                                facades.box(bx0 + inset, bx1 - inset, height, top, bz0 + inset, bz1 - inset, color, roofs);
                            }
                            const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
                            roofs.box(mx - 4, mx + 4, top, top + 4, mz - 3, mz + 3, color.setHex(0x8a8d90).convertSRGBToLinear(), roofs);
                            beacons.push([mx, top + 5, mz]);
                            top += 6;
                        } else if (rnd() < 0.5) {
                            const mx = bx0 + (bx1 - bx0) * (0.3 + rnd() * 0.4), mz = bz0 + (bz1 - bz0) * (0.3 + rnd() * 0.4);
                            roofs.box(mx - 2, mx + 2, height, height + 2.5, mz - 1.5, mz + 1.5, color.setHex(0x9a9c9e).convertSRGBToLinear(), roofs);
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
        add(facades, m.facade);
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
        const facade = facadeTextures(), block = groundTextures(false), park = groundTextures(true);
        // Sol des îlots : décalé vers la caméra pour ne pas scintiller avec le terrain (plat juste en dessous)
        const ground = (t) => new MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: 0xffffff,
            emissiveIntensity: 0, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
        this._materials = {
            facade: new MeshStandardMaterial({ map: facade.map, emissiveMap: facade.emissive, emissive: 0xffffff,
                emissiveIntensity: 0, vertexColors: true, roughness: 0.55, metalness: 0.15 }),
            roof: new MeshStandardMaterial({ color: 0x8e9194, vertexColors: true, roughness: 0.9 }),
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
        m.facade.emissiveIntensity = 1.1 * night;
        m.block.emissiveIntensity = m.park.emissiveIntensity = 1.6 * night;
        m.beacon.color.setRGB(0.35 + 0.65 * night, 0.03, 0.03).multiplyScalar(1 + 2 * night);
    }
}

export { City };
