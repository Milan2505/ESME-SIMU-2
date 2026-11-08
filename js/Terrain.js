import {
    BufferAttribute,
    BufferGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    RepeatWrapping,
    SRGBColorSpace,
    Sphere,
    Vector3
} from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { loadTexture } from './Loading.js';

// Textures CC0 de Poly Haven (https://polyhaven.com), voir asset/textures/
const TEXTURES = {
    grass: 'asset/textures/aerial_grass_rock_diff_1k.jpg',
    rock:  'asset/textures/rock_face_03_diff_1k.jpg',   // paroi photographiée de face : plaquée en triplanaire
    snow:  'asset/textures/snow_02_diff_1k.jpg',
};

// Dalles du terrain : TILE m de côté. Finesse selon la distance à la caméra : pleine (réglage « Détail du sol ») en
// deçà de LOD_DISTANCES[0], moitié jusqu'au suivant, etc. ; au-delà de la fin du brouillard, dalle cachée.
// Jupes : bord de chaque dalle prolongé vers le bas (SKIRT m), cache les fentes entre deux finesses différentes
const TILE = 1000;
const LOD_DISTANCES = [1600, 3200, 6000];
const MIN_SEGMENTS = 4;
const SKIRT = 25;
const BUILD_PER_FRAME = 3;
const BUILD_AT_ONCE = 9;     // reconstruction complète (départ, saut de caméra) : dalles faites en entier tout de suite   // dalles (re)construites au plus par image : pas d'à-coup en vol
// Lacs : rive à 1,4 × le rayon au plus (sol relevé au-dessus de l'eau entre 1,25 et 1,4) ; profondeur au centre (m)
const LAKE_RIM = 1.4;
const LAKE_DEPTH = 8;   // (assez creux : vu de loin, la précision de profondeur ne confond pas le fond et l'eau)

function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// Minimum adouci (raccord sans arête entre le relief et un plafond)
function softMin(a, b, k) {
    const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
    return b + (a - b) * h - k * h * (1 - h);
}

// Relief procédural : plaine au centre, collines autour, montagnes au loin ; vallées dégagées autour des pistes
class Terrain {
    constructor(renderer, {
        size = 26000,         // côté du terrain (m) : deux aérodromes et leurs vallées, et assez de marge autour pour
                              // ne jamais voir le bord du monde, même à 6 km de distance de vue depuis AIX
        segments = 384,       // finesse : segments pour 6000 m (réglage « Détail du sol », comme avant les dalles)
        flatRadius = 80,      // zone plate au centre (point de départ)
        hillHeight = 15,
        mountainStart = 350,  // distance où les montagnes commencent
        mountainFull = 1100,  // distance où elles atteignent leur hauteur max
        mountainHeight = 320,
        snowHeight = 190,
        tile = 60,            // taille d'une répétition de texture (m)
        grassTint = 0x219313,
        flatten = () => 1,    // facteur de relief en (x, z) : 0 = sol plat (aérodrome), 1 = relief normal
        // Vallées sans montagnes autour des pistes : ellipses (rx, rz : demi-axes) aux bords irréguliers, allongées
        // dans l'axe de chaque piste, pour décoller et atterrir face au relief dégagé
        clearings = [],       // [{ x, z, rx, rz }]
        limit = () => Infinity, // hauteur maximale du relief en (x, z) : couloirs d'approche (voir Airport.terrainLimit)
        dips = () => 1,       // abords des aérodromes : 0 = ni creux ni ondulations (pas de talus autour de la piste), 1 = loin
        rolling = 30,         // m : ondulations douces des fonds de vallée (grandes collines arrondies)
        lakes = [],           // [{ x, z, radius }] : cuvette et plan d'eau (bord irrégulier)
    } = {}) {
        this.noise = new ImprovedNoise();
        Object.assign(this, { flatRadius, hillHeight, mountainStart, mountainFull, mountainHeight, flatten, clearings, limit, dips, rolling });
        // Lacs : niveau de l'eau sous le point le plus bas de leur rive (le sol remonte tout autour)
        this.lakes = lakes.map((lake, i) => ({ ...lake, seed: 11.3 + i * 4.7 }));
        for (const lake of this.lakes) {
            let low = Infinity;
            for (let a = 0; a < 48; a++) {
                const angle = a / 48 * Math.PI * 2, rim = LAKE_RIM * lake.radius * this._lakeWobble(lake, angle);
                low = Math.min(low, this._baseHeight(lake.x + Math.cos(angle) * rim, lake.z + Math.sin(angle) * rim));
            }
            lake.level = low - 1.6;   // (berge à 1,5 m au-dessus de l'eau au plus, sous le sol de la rive)
        }

        this.size = size;
        this._waterTime = { value: 0 };   // vagues de l'eau et reflets ondulants sur le fond des lacs (voir animate)
        this.material = this._createMaterial(renderer, { snowHeight, tile, grassTint });
        // Groupe des dalles (scene.add(terrain.mesh) ; receiveShadow transmis aux dalles)
        this.mesh = new Group();
        this.mesh.name = 'terrain';
        const count = Math.ceil(size / TILE);
        this._tiles = [];
        for (let i = 0; i < count; i++) {
            for (let j = 0; j < count; j++) {
                const x0 = -size / 2 + i * TILE, z0 = -size / 2 + j * TILE;
                const mesh = new Mesh(new BufferGeometry(), this.material);
                mesh.receiveShadow = true;
                mesh.visible = false;
                mesh.matrixAutoUpdate = false;
                this.mesh.add(mesh);
                this._tiles.push({ x0, z0, cx: x0 + TILE / 2, cz: z0 + TILE / 2, mesh, level: -1, cache: new Map() });
            }
        }
        Object.defineProperty(this.mesh, 'receiveShadow', {
            set: (value) => { for (const t of this._tiles) t.mesh.receiveShadow = value; },
            get: () => true,
        });
        this.water = this._createWater();
        if (this.water) this.mesh.add(this.water);
        this._fullSegments = 0;
        this._viewer = new Vector3(0, 0, 0);
        this._range = 3000;
        this.setDetail(segments);
    }

    // Finesse du maillage (réglage "Détail du sol", segments pour 6000 m) ; les collisions utilisent heightAt
    setDetail(segments) {
        const full = Math.max(MIN_SEGMENTS, Math.round(segments * TILE / 6000));
        if (full === this._fullSegments) return;
        this._fullSegments = full;
        for (const t of this._tiles) {
            for (const geometry of t.cache.values()) geometry.dispose();
            t.cache.clear();
            t.keep?.clear();   // (finesses gardées : à refaire, voir prebuild)
            t.level = -1;
        }
        this.update(this._viewer, this._range, true);
    }

    // Chaque image : finesse de chaque dalle selon sa distance à viewer ; range : distance de dessin (brouillard)
    // all : tout reconstruire sans limite (au départ, changement de réglage)
    update(viewer, range = this._range, all = false) {
        // Rien à revoir tant que la caméra n'a pas bougé de 50 m (et que tout est construit)
        if (!all && !this._pending && this._viewer.distanceToSquared(viewer) < 2500 && Math.abs(range - this._range) < 50) return;
        // Saut de caméra (autre aérodrome choisi) : tout de suite en entier, plutôt que des trous dans le sol
        if (this._viewer.distanceToSquared(viewer) > 1500 * 1500) all = true;
        this._viewer.copy(viewer);
        this._range = range;
        this._pending = false;
        let budget = all ? BUILD_AT_ONCE : BUILD_PER_FRAME;
        // Les plus proches d'abord (la dalle sous l'avion est prête en premier)
        const order = this._tiles.map((t) => [t, this._distance(t, viewer)]).sort((a, b) => a[1] - b[1]);
        for (const [t, d] of order) {
            const visible = d < range + TILE * 0.75;
            t.mesh.visible = visible && t.level >= 0;
            if (!visible) continue;
            let level = LOD_DISTANCES.findIndex((limit) => d < limit);
            if (level < 0) level = LOD_DISTANCES.length;
            if (level === t.level) continue;
            if (!t.cache.has(level)) {
                // Pas de budget : on garde la finesse actuelle (ou une plus grossière déjà prête) pour l'instant
                if (budget <= 0) {
                    this._pending = true;   // à finir aux images suivantes
                    if (t.level < 0) {
                        // Rien d'affiché : la version la plus grossière (vite faite), plutôt qu'un trou dans le sol
                        let any = [...t.cache.keys()].sort((a, b) => b - a)[0];
                        if (any === undefined) {
                            any = LOD_DISTANCES.length;
                            t.cache.set(any, this._createTile(t, Math.max(MIN_SEGMENTS, this._fullSegments >> any)));
                        }
                        this._show(t, any);
                    }
                    continue;
                }
                budget--;
                t.cache.set(level, this._createTile(t, Math.max(MIN_SEGMENTS, this._fullSegments >> level)));
            }
            this._show(t, level);
        }
    }

    // Construit d'avance (écran de chargement) les dalles vues depuis chacun des points donnés, à la finesse qu'elles y
    // auront, et les garde : le saut de la caméra vers un aérodrome, un hangar ou un départ n'a plus rien à construire
    // (avant : jusqu'à 9 dalles d'un coup, une image figée). Construction par morceaux de ~25 ms (la page reste fluide) ;
    // onProgress(0 -> 1)
    async prebuild(points, range = this._range, onProgress) {
        const wanted = new Map();   // dalle -> finesses
        for (const p of points) {
            for (const t of this._tiles) {
                const d = this._distance(t, p);
                if (d >= range + TILE * 0.75) continue;
                let level = LOD_DISTANCES.findIndex((limit) => d < limit);
                if (level < 0) level = LOD_DISTANCES.length;
                if (!wanted.has(t)) wanted.set(t, new Set());
                wanted.get(t).add(level);
            }
        }
        const jobs = [...wanted].flatMap(([t, levels]) => [...levels].map((level) => [t, level]));
        let slice = performance.now();
        for (const [i, [t, level]] of jobs.entries()) {
            (t.keep ??= new Set()).add(level);
            if (!t.cache.has(level)) t.cache.set(level, this._createTile(t, Math.max(MIN_SEGMENTS, this._fullSegments >> level)));
            if (performance.now() - slice > 25) {
                onProgress?.((i + 1) / jobs.length);
                await new Promise((resolve) => setTimeout(resolve, 0));
                slice = performance.now();
            }
        }
        onProgress?.(1);
        this._pending = true;   // revoir l'affichage à la prochaine image
    }

    _show(tile, level) {
        // Finesses plus fines que celle affichée : libérées (mémoire), refaites si l'on revient près de la dalle ; sauf
        // celles construites d'avance autour des aérodromes (voir prebuild)
        for (const [k, geometry] of tile.cache) {
            if (k < level && !tile.keep?.has(k)) {
                geometry.dispose();
                tile.cache.delete(k);
            }
        }
        tile.level = level;
        tile.mesh.geometry = tile.cache.get(level);
        tile.mesh.visible = true;
    }

    // Distance horizontale de viewer au bord de la dalle (0 dedans)
    _distance(t, p) {
        const dx = Math.max(t.x0 - p.x, 0, p.x - (t.x0 + TILE));
        const dz = Math.max(t.z0 - p.z, 0, p.z - (t.z0 + TILE));
        return Math.hypot(dx, dz);
    }

    // Dalle de n × n segments : hauteurs sur une grille élargie d'un rang (normales par différences centrales, sans
    // raccord visible avec la voisine), plus une jupe sur les quatre bords
    _createTile(t, n) {
        const step = TILE / n, side = n + 1;
        const heights = new Float32Array((n + 3) * (n + 3));
        for (let j = -1; j <= n + 1; j++) {
            for (let i = -1; i <= n + 1; i++) heights[(j + 1) * (n + 3) + (i + 1)] = this.groundAt(t.x0 + i * step, t.z0 + j * step);
        }
        const h = (i, j) => heights[(j + 1) * (n + 3) + (i + 1)];
        const vertexCount = side * side + 4 * side;
        const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
        // Profondeur d'eau au sommet (m, -1 hors des lacs) : fond de lac (sable, reflets) seulement à l'intérieur de la
        // vraie rive. Avant, le shader testait un simple cercle autour du lac : un sol plus bas que l'eau à côté du lac
        // (pente qui descend hors de la cuvette) se couvrait de sable et de reflets, comme une flaque au milieu de l'herbe
        const lakeDepth = new Float32Array(vertexCount);
        const n3 = new Vector3();
        const put = (index, i, j, y) => {
            const x = t.x0 + i * step, z = t.z0 + j * step;
            positions[index * 3] = x;
            positions[index * 3 + 1] = y;
            positions[index * 3 + 2] = z;
            const lake = this.lakes.length ? this.lakeAt(x, z) : null;
            lakeDepth[index] = lake ? lake.level - y : -1;
            n3.set(h(i - 1, j) - h(i + 1, j), 2 * step, h(i, j - 1) - h(i, j + 1)).normalize();
            normals[index * 3] = n3.x;
            normals[index * 3 + 1] = n3.y;
            normals[index * 3 + 2] = n3.z;
        };
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) put(j * side + i, i, j, h(i, j));
        // Jupes : bords nord (j = 0), sud (j = n), ouest (i = 0), est (i = n)
        const skirtBase = side * side;
        const edges = [
            (k) => [k, 0], (k) => [k, n], (k) => [0, k], (k) => [n, k],
        ];
        edges.forEach((edge, e) => {
            for (let k = 0; k <= n; k++) {
                const [i, j] = edge(k);
                put(skirtBase + e * side + k, i, j, h(i, j) - SKIRT);
            }
        });
        const indices = [];
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }
        // Jupe : bande verticale entre le bord et son double abaissé, dessinée des deux côtés
        edges.forEach((edge, e) => {
            for (let k = 0; k < n; k++) {
                const [i0, j0] = edge(k), [i1, j1] = edge(k + 1);
                const top0 = j0 * side + i0, top1 = j1 * side + i1;
                const low0 = skirtBase + e * side + k, low1 = low0 + 1;
                indices.push(top0, low0, top1, top1, low0, low1, top0, top1, low0, top1, low1, low0);
            }
        });
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new BufferAttribute(normals, 3));
        geometry.setAttribute('aLakeDepth', new BufferAttribute(lakeDepth, 1));
        geometry.setIndex(indices);
        let minY = Infinity, maxY = -Infinity;
        for (let k = 1; k < positions.length; k += 3) { minY = Math.min(minY, positions[k]); maxY = Math.max(maxY, positions[k]); }
        geometry.boundingSphere = new Sphere(new Vector3(t.cx, (minY + maxY) / 2, t.cz), Math.hypot(TILE / 2 * Math.SQRT2, (maxY - minY) / 2));
        return geometry;
    }

    // Hauteur de la surface au point (x, z) : sol, ou eau d'un lac. Pour poser les objets et pour les collisions
    heightAt(x, z) {
        const lake = this.lakeAt(x, z);
        const ground = this.groundAt(x, z, lake);
        return lake && ground < lake.level ? lake.level : ground;
    }

    // Lac en (x, z) (null hors des lacs et de leurs rives) ; margin : m autour de la rive
    lakeAt(x, z, margin = 0) {
        for (const lake of this.lakes) {
            const dx = x - lake.x, dz = z - lake.z, reach = lake.radius * LAKE_RIM * 1.3 + margin;
            if (dx * dx + dz * dz < reach * reach && Math.hypot(dx, dz) < lake.radius * LAKE_RIM * this._lakeWobble(lake, Math.atan2(dz, dx)) + margin) return lake;
        }
        return null;
    }

    // Hauteur du sol (fond des lacs compris) : maillage du terrain
    groundAt(x, z, lake = this.lakeAt(x, z)) {
        const base = this._baseHeight(x, z);
        if (!lake) return base;
        // Cuvette. s : distance à la rive (m, positive dehors). Pente douce de part et d'autre de la ligne d'eau (8 à 10 %) :
        // le maillage (une maille de ~16 m) la suit sans marches ; fond plat à LAKE_DEPTH, berge rejoignant le relief
        const dx = x - lake.x, dz = z - lake.z;
        const radius = lake.radius * this._lakeWobble(lake, Math.atan2(dz, dx));
        const s = Math.hypot(dx, dz) - radius;
        if (s < 0) return lake.level - Math.min(LAKE_DEPTH, 0.3 + -s * 0.2);
        const bank = lake.level + Math.min(s * 0.1, 1.5);
        const dry = Math.max(base, lake.level + 1.5);
        return bank + (dry - bank) * smoothstep(0, 0.35 * radius, s);
    }

    // Plans d'eau de tous les lacs (un seul maillage) : grille polaire jusqu'à 1,3 × le rayon (sous la berge relevée).
    // Chaque sommet porte la profondeur réelle de l'eau (niveau - fond, négative sur la berge) : l'eau s'efface exactement
    // là où le fond affleure (avant : fondu à un rayon fixe, un voile bleuté restait posé sur la pente de la rive)
    _createWater() {
        if (!this.lakes.length) return null;
        const SIDES = 72, RINGS = 28, positions = [], depth = [], indices = [];
        for (const lake of this.lakes) {
            const center = positions.length / 3;
            positions.push(lake.x, lake.level, lake.z);
            depth.push(lake.level - this.groundAt(lake.x, lake.z, lake));
            for (let r = 1; r <= RINGS; r++) {
                // Anneaux resserrés vers la rive (là où la profondeur varie vite)
                const t = Math.sqrt(r / RINGS);
                for (let a = 0; a < SIDES; a++) {
                    const angle = a / SIDES * Math.PI * 2, rim = t * 1.3 * lake.radius * this._lakeWobble(lake, angle);
                    const x = lake.x + Math.cos(angle) * rim, z = lake.z + Math.sin(angle) * rim;
                    positions.push(x, lake.level, z);
                    depth.push(lake.level - this.groundAt(x, z, this.lakeAt(x, z) ?? lake));
                }
            }
            const ring = (r, a) => center + 1 + (r - 1) * SIDES + (a % SIDES);
            for (let a = 0; a < SIDES; a++) {
                indices.push(center, ring(1, a + 1), ring(1, a));
                for (let r = 1; r < RINGS; r++) {
                    indices.push(ring(r, a), ring(r, a + 1), ring(r + 1, a));
                    indices.push(ring(r, a + 1), ring(r + 1, a + 1), ring(r + 1, a));
                }
            }
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depth), 1));
        geometry.setAttribute('normal', new BufferAttribute(new Float32Array(positions.length).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        const mesh = new Mesh(geometry, this._waterMaterial());
        mesh.name = 'lacs';
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        return mesh;
    }

    // Eau : bleu profond vue de haut, reflet du ciel à l'horizon (Fresnel, couleur du brouillard = horizon), petites
    // vagues qui animent le reflet du soleil (voir animate)
    _waterMaterial() {
        // Rive : l'eau s'efface en transparence juste avant (fond peu profond visible). Sans ce fondu, vu de loin, l'eau et
        // le sol presque au même niveau se disputaient l'écran (bord qui tremble) et le bord net crénelait. Repoussée un
        // peu en profondeur : près de la rive, le sol passe devant. Recul proportionnel à la distance (0,05 %, voir
        // project_vertex) et non polygonOffset : ses « units » valent ~d² (précision du tampon de profondeur), soit ~5 m à
        // 1,5 km -> l'eau passait derrière le fond du lac (8 m plus bas) par bandes (pas de « factor » non plus : il
        // grandit avec l'angle de vue)
        const material = new MeshStandardMaterial({ color: 0x173f4d, roughness: 0.06, metalness: 0, transparent: true });
        const time = this._waterTime;
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uWaterTime = time;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>
                    attribute float aDepth;
                    varying float vDepth;
                    varying vec3 vWaterPos;`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    vDepth = aDepth;
                    vWaterPos = (modelMatrix * vec4(position, 1.0)).xyz;`)
                .replace('#include <project_vertex>', `#include <project_vertex>
                    gl_Position = projectionMatrix * vec4(mvPosition.xyz * 1.0005, 1.0);`);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
                    uniform float uWaterTime;
                    varying float vDepth;
                    varying vec3 vWaterPos;
                    // Pente d'une vague : direction, longueur d'onde (m), vitesse, amplitude de pente
                    // Taille d'un pixel sur l'eau (m) : une vague plus courte que ~3 pixels est effacée (sinon, de loin, elle
                    // scintille et dessine des moirés)
                    float waterFoot;
                    vec2 wave(vec2 p, vec2 dir, float length, float speed, float slope) {
                        float k = 6.2832 / length;
                        float fade = 1.0 - smoothstep(length * 0.04, length * 0.18, waterFoot);
                        return dir * slope * fade * cos(dot(dir, p) * k + uWaterTime * speed);
                    }`)
                // De loin, l'eau devient moins lisse : le reflet du soleil s'étale au lieu de scintiller
                .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                    waterFoot = max(length(dFdx(vWaterPos.xz)), length(dFdy(vWaterPos.xz)));
                    roughnessFactor = mix(roughnessFactor, 0.5, smoothstep(0.08, 1.2, waterFoot));`)
                .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                    vec2 waterSlope = wave(vWaterPos.xz, vec2(0.8, 0.6), 9.0, 1.7, 0.035)
                        + wave(vWaterPos.xz, vec2(-0.5, 0.87), 5.3, 2.3, 0.03)
                        + wave(vWaterPos.xz, vec2(0.17, -0.98), 3.1, 3.1, 0.022)
                        + wave(vWaterPos.xz, vec2(-0.94, -0.34), 17.0, 1.1, 0.03);
                    vec3 waterNormal = normalize(vec3(-waterSlope.x, 1.0, -waterSlope.y));
                    normal = normalize((viewMatrix * vec4(waterNormal, 0.0)).xyz);`)
                .replace('#include <opaque_fragment>', `
                    vec3 waterView = normalize(cameraPosition - vWaterPos);
                    float fresnel = 0.03 + 0.97 * pow(1.0 - clamp(dot(waterNormal, waterView), 0.0, 1.0), 5.0);
                    #ifdef USE_FOG
                        vec3 waterSky = fogColor;
                    #else
                        vec3 waterSky = vec3(0.62, 0.72, 0.8);
                    #endif
                    outgoingLight = mix(outgoingLight, waterSky * 0.9, clamp(fresnel, 0.0, 0.9));
                    // Hauts-fonds clairs et transparents (on voit le fond), eau profonde sombre et presque opaque ; rien
                    // là où le fond affleure (ligne d'eau sur la berge)
                    float waterDeep = smoothstep(0.4, 6.0, vDepth);
                    outgoingLight = mix(outgoingLight * vec3(0.9, 1.25, 1.15), outgoingLight, waterDeep);
                    diffuseColor.a *= smoothstep(0.02, 0.6, vDepth) * mix(0.42, 0.95, waterDeep);
                    #include <opaque_fragment>`);
        };
        return material;
    }

    // Vagues des lacs (time : s)
    animate(time) {
        if (this._waterTime) this._waterTime.value = time;
    }

    // Bord irrégulier d'un lac : rayon relatif selon la direction (ne dépend que de l'angle)
    _lakeWobble(lake, angle) {
        return 1 + 0.2 * this.noise.noise(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, lake.seed)
            + 0.08 * this.noise.noise(Math.cos(angle) * 4, Math.sin(angle) * 4, lake.seed + 2);
    }

    // Relief sans les lacs
    _baseHeight(x, z) {
        const relief = this.flatten(x, z);
        if (relief <= 0) return 0;
        const r = Math.hypot(x, z);

        // Collines : bruit doux
        let hills = 0, amp = 1, freq = 1 / 250;
        for (let o = 0; o < 3; o++) {
            hills += this.noise.noise(x * freq, z * freq, 0.5) * amp;
            amp *= 0.5; freq *= 2;
        }

        // Montagnes (pas calculées au fond des vallées). Massifs : bruit doux élevé au carré, sommets isolés et vallées
        // ouvertes entre eux ; crêtes et ravines (bruit "en crêtes") seulement sur les hauteurs. Avant, le bruit en
        // crêtes seul donnait un plateau en nid d'abeille, criblé de cuvettes fermées
        const valley = this._clearingFactor(x, z) * smoothstep(this.mountainStart, this.mountainFull, r);
        let mountains = 0;
        if (valley > 0) {
            let massif = 0, total = 0;
            amp = 1; freq = 1 / 1800;
            for (let o = 0; o < 3; o++) {
                massif += this.noise.noise(x * freq, z * freq, 7.3) * amp;
                total += amp;
                amp *= 0.5; freq *= 2;
            }
            massif = smoothstep(-0.5, 0.42, massif / total);   // rarement saturé : pas de sommet plat
            let ridges = 0;
            total = 0;
            amp = 1; freq = 1 / 450;
            for (let o = 0; o < 4; o++) {
                const ridge = 1 - Math.abs(this.noise.noise(x * freq, z * freq, 3.9));
                ridges += ridge * ridge * amp;
                total += amp;
                amp *= 0.5; freq *= 2;
            }
            ridges /= total;
            // Contreforts : bosses arrondies entre les massifs (pas de fond de vallée parfaitement plat)
            const foothills = Math.max(0, this.noise.noise(x / 380, z / 380, 5.2) + 0.5 * this.noise.noise(x / 170, z / 170, 6.4) + 0.15);
            mountains = Math.pow(massif, 1.6) * (0.55 + 0.9 * ridges * massif) + 0.22 * foothills * (1 - massif);
        }

        // Ondulations : grandes collines arrondies (pentes douces, herbe), effacées aux abords des aérodromes
        const around = this.dips(x, z);
        const rolling = around > 0 ? (this.noise.noise(x / 1300, z / 1300, 2.1) + 0.35 * this.noise.noise(x / 560, z / 560, 4.6) + 0.25)
            * this.rolling * around : 0;
        let height = relief * (hills * this.hillHeight * smoothstep(this.flatRadius, this.flatRadius * 4, r)
            + mountains * this.mountainHeight * valley + rolling);
        if (height < 0) height *= around;
        // Couloirs d'approche : le relief ne dépasse pas le plafond (raccord adouci sur 30 m), sans jamais creuser
        // sous le niveau de la piste (sinon talus le long de la piste et au bout des seuils)
        const cap = this.limit(x, z);
        if (cap === Infinity) return height;
        // Sous le plafond : creux et bosses, plus marqués loin du seuil où le plafond est haut (avant : relief rabattu
        // en un plan incliné parfaitement lisse). Les bosses ne font que creuser : le couloir reste dégagé
        let bumps = 0.5;
        amp = 0.7; freq = 1 / 300;
        for (let o = 0; o < 4; o++) {
            bumps += this.noise.noise(x * freq, z * freq, 8.8 + o) * amp;
            amp *= 0.55; freq *= 2.3;
        }
        const rough = Math.min(60, Math.max(0, cap + 15) * 0.5) * Math.min(1, Math.max(0, bumps));
        return Math.max(softMin(height, cap - rough, 30), Math.min(height, 0));
    }

    // 0 au fond des vallées des pistes, 1 hors des vallées (montagnes normales), fondu sur leurs bords
    _clearingFactor(x, z) {
        let factor = 1;
        for (const c of this.clearings) {
            const dx = (x - c.x) / c.rx, dz = (z - c.z) / c.rz;
            const d = Math.hypot(dx, dz);
            if (d > 2) continue;
            // Bord irrégulier : rayon qui varie avec la direction (grandes et petites ondulations) et le lieu
            const angle = Math.atan2(dz, dx);
            const wobble = 1 + 0.22 * this.noise.noise(Math.cos(angle) * 1.6, Math.sin(angle) * 1.6, 3.7)
                + 0.1 * this.noise.noise(x / 300, z / 300, 9.1);
            factor = Math.min(factor, smoothstep(0.75, 1.3, d / wobble));
        }
        return factor;
    }

    _createMaterial(renderer, { snowHeight, tile, grassTint }) {
        const textures = {};
        for (const [name, url] of Object.entries(TEXTURES)) {
            textures[name] = loadTexture('terrain', url, (texture) => {
                texture.colorSpace = SRGBColorSpace;
                texture.wrapS = texture.wrapT = RepeatWrapping;
                texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); // au-delà : coûteux en plein écran (6 lectures de texture par pixel), gain à peine visible
            });
        }

        const material = new MeshStandardMaterial({ roughness: 1 });
        const tint = new Vector3(...[16, 8, 0].map((shift) => ((grassTint >> shift) & 0xff) / 255));

        // Mélange herbe / roche / neige selon la pente et l'altitude
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, {
                tGrass: { value: textures.grass },
                tRock: { value: textures.rock },
                tSnow: { value: textures.snow },
                uGrassTint: { value: tint },
                uTile: { value: tile },
                uSnowHeight: { value: snowHeight },
                uWaterTime: this._waterTime,
            });

            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>
                    attribute float aLakeDepth;
                    varying float vLakeDepth;
                    varying vec3 vTerrainPos;
                    varying vec3 vTerrainNormal;`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    vLakeDepth = aLakeDepth;
                    vTerrainPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    vTerrainNormal = normalize(mat3(modelMatrix) * normal);`);

            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
                    uniform sampler2D tGrass;
                    uniform sampler2D tRock;
                    uniform sampler2D tSnow;
                    uniform vec3 uGrassTint;
                    uniform float uTile;
                    uniform float uSnowHeight;
                    uniform float uWaterTime;
                    varying float vLakeDepth;
                    varying vec3 vTerrainPos;
                    varying vec3 vTerrainNormal;

                    // Deux échelles mélangées pour casser la répétition vue de haut.
                    // Dérivées explicites (textureGrad) : la lecture peut se faire dans un "if"
                    vec3 terrainSample(sampler2D tex, vec2 uv, vec2 dx, vec2 dy) {
                        return mix(textureGrad(tex, uv, dx, dy).rgb, textureGrad(tex, uv * 0.13, dx * 0.13, dy * 0.13).rgb, 0.5);
                    }

                    // Roche en projection triplanaire : plaquée vue de dessus, la texture s'étirait en traînées sur les
                    // pentes raides. Poids très contrastés : un seul plan lu sur la plupart des pixels, deux dans les
                    // transitions (les plans de poids négligeable ne sont pas lus)
                    vec3 rockSample(sampler2D tex, vec3 pos, vec3 n, vec3 dx, vec3 dy) {
                        vec3 w = pow(abs(n), vec3(8.0));
                        w = max(w / (w.x + w.y + w.z) - 0.05, 0.0);
                        w /= w.x + w.y + w.z;
                        vec3 color = vec3(0.0);
                        if (w.x > 0.0) color += w.x * terrainSample(tex, pos.zy, dx.zy, dy.zy);
                        if (w.y > 0.0) color += w.y * terrainSample(tex, pos.xz, dx.xz, dy.xz);
                        if (w.z > 0.0) color += w.z * terrainSample(tex, pos.xy, dx.xy, dy.xy);
                        // Un peu désaturée et grisée : roche de montagne, raccord avec la neige
                        return mix(color, vec3(dot(color, vec3(0.3, 0.55, 0.15))), 0.45) * 1.1;
                    }`)
                .replace('#include <map_fragment>', `
                    vec2 terrainUv = vTerrainPos.xz / uTile;
                    vec2 uvDx = dFdx(terrainUv), uvDy = dFdy(terrainUv);
                    vec3 rockPos = vTerrainPos / uTile;
                    vec3 rockDx = dFdx(rockPos), rockDy = dFdy(rockPos);   // hors des "if" (dérivées)
                    vec3 terrainNormal = normalize(vTerrainNormal);

                    float slope = 1.0 - terrainNormal.y;
                    float rockAmount = clamp(smoothstep(0.12, 0.3, slope)
                        + smoothstep(uSnowHeight * 0.4, uSnowHeight * 0.8, vTerrainPos.y), 0.0, 1.0);
                    float snowAmount = smoothstep(uSnowHeight, uSnowHeight + 40.0, vTerrainPos.y)
                        * (1.0 - smoothstep(0.35, 0.6, slope));

                    // Herbe / roche / neige : chaque texture n'est lue que là où elle est visible
                    // (la plaine ne lit que l'herbe : 2 lectures au lieu de 6)
                    float grassWeight = (1.0 - rockAmount) * (1.0 - snowAmount);
                    float rockWeight = rockAmount * (1.0 - snowAmount);
                    vec3 terrainColor = vec3(0.0);
                    if (grassWeight > 0.0) {
                        vec3 grass = terrainSample(tGrass, terrainUv, uvDx, uvDy);
                        terrainColor += grassWeight * mix(grass, grass * uGrassTint * 2.5, 0.6);
                    }
                    if (rockWeight > 0.0) terrainColor += rockWeight * rockSample(tRock, rockPos, terrainNormal, rockDx, rockDy);
                    if (snowAmount > 0.0) terrainColor += snowAmount * terrainSample(tSnow, terrainUv, uvDx, uvDy);

                    // Fond des lacs : sable et vase, taches d'algues, reflets ondulants de la lumière à travers les vagues ;
                    // plus sombre et bleu-vert avec la profondeur
                    float lakeDepth = vLakeDepth;   // (calculée par sommet, dans la vraie rive : voir _createTile)
                    float underwater = smoothstep(-0.3, 0.5, lakeDepth);
                    if (underwater > 0.0) {
                        float grain = dot(terrainSample(tGrass, terrainUv * 0.7, uvDx * 0.7, uvDy * 0.7), vec3(0.33));
                        vec3 sand = vec3(0.62, 0.56, 0.42) * (0.75 + 0.6 * grain);
                        float algae = smoothstep(0.45, 0.62, dot(terrainSample(tGrass, terrainUv * 0.09, uvDx * 0.09, uvDy * 0.09), vec3(0.33)) + 0.15 * grain);
                        vec3 bed = mix(sand, vec3(0.2, 0.3, 0.16), algae * smoothstep(0.8, 3.0, lakeDepth));
                        vec2 cp = vTerrainPos.xz * 0.55;
                        float caustic = pow(abs(sin(cp.x + uWaterTime * 0.9 + sin(cp.y * 0.8 - uWaterTime * 0.6) * 1.4)
                            * sin(cp.y * 1.1 - uWaterTime * 0.7 + sin(cp.x * 0.7 + uWaterTime * 0.8) * 1.2)), 8.0);
                        bed += vec3(0.5, 0.55, 0.45) * caustic * (1.0 - smoothstep(0.5, 5.0, lakeDepth)) * (1.0 - smoothstep(0.02, 0.4, length(uvDx)));
                        bed *= mix(vec3(1.0), vec3(0.45, 0.62, 0.66), smoothstep(0.0, ${LAKE_DEPTH}.0, lakeDepth));
                        // Très loin (> ~2 km), la précision du tampon de profondeur ne sépare plus le fond de l'eau, 8 m
                        // au-dessus : le fond profond prend la couleur de l'eau, il ne perce plus en bandes claires
                        float bedFar = smoothstep(1500.0, 2500.0, distance(vTerrainPos, cameraPosition)) * smoothstep(1.0, 3.0, lakeDepth);
                        bed = mix(bed, vec3(0.0086, 0.0497, 0.0742), bedFar);   // (couleur de l'eau, 0x173f4d en linéaire)
                        terrainColor = mix(terrainColor, bed, underwater);
                    }
                    diffuseColor.rgb *= terrainColor;`);
        };
        return material;
    }
}

export { Terrain };
