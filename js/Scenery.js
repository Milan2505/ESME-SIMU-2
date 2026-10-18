import {
    Box3,
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    DoubleSide,
    DirectionalLight,
    Group,
    HemisphereLight,
    InstancedMesh,
    LinearMipmapLinearFilter,
    Matrix4,
    Mesh,
    MeshDepthMaterial,
    MeshLambertMaterial,
    OrthographicCamera,
    PlaneGeometry,
    Quaternion,
    RGBADepthPacking,
    Scene,
    ShaderMaterial,
    SRGBColorSpace,
    Vector3,
    WebGLRenderTarget
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Décor réaliste (réglage « Style du décor ») : forêts d'arbres réalistes et villages autour de l'aérodrome.
// - Arbres : générés par EZ-Tree (Daniel Greenheck, licence MIT, https://github.com/dgreenheck/ez-tree), écorce et
//   feuillage texturés, allégés (moins de segments et de feuilles). Une espèce = un seul appel de dessin (instanciation).
//   Près de la caméra : arbre complet (ombres portées) ; plus loin : « imposteur », un panneau tourné vers la caméra
//   avec l'image de l'arbre pré-rendue (deux triangles au lieu de ~10 000). La répartition est refaite quand la caméra bouge.
// - Maisons : City Kit Suburban de Kenney (CC0, asset/houses), groupées en villages, un seul maillage par village.
// Tout est placé de la même façon à chaque partie (tirage à graine fixe).

const EZ_TREE_URL = 'https://cdn.jsdelivr.net/npm/@dgreenheck/ez-tree@1.1.0/build/ez-tree.es.js';
const SPECIES = [
    { preset: 'Oak Medium', height: [12, 17], weight: 3, kind: 'leafy' },
    { preset: 'Ash Medium', height: [15, 21], weight: 3, kind: 'leafy' },
    { preset: 'Aspen Medium', height: [14, 19], weight: 2, kind: 'leafy' },
    { preset: 'Pine Medium', height: [14, 20], weight: 3, kind: 'pine' },
    { preset: 'Pine Large', height: [18, 25], weight: 2, kind: 'pine' },
];
const HOUSES = 'abcdefghijklmnopqrstu'.split('').map((c) => `asset/houses/building-type-${c}.glb`);
const HOUSE_SCALE = 12;          // modèles Kenney (~1,3 unité) -> maisons de ~15 m de long, 9 à 14 m au faîtage
const STREET = [36, 40];         // m : pas de la grille des rues (entre maisons, entre rangées)
// Sol en herbe uniquement (le terrain se peint en roche au-delà, voir Terrain.js : pente 0,12, altitude ~75 m)
const TREE_SLOPE = 0.08;         // 1 - normale.y
const HOUSE_SLOPE = 0.035;
const GRASS_TOP = 65;            // m
const TREE_COUNT = 8000;         // arbres par région à 100 % du réglage « Arbres et décor » (massifs denses)
const MAP_EDGE = 7800;           // m : rien au-delà (le terrain s'arrête à 8000 m du centre)
const REGION = 2800;             // m : demi-côté de la zone décorée autour de chaque aérodrome
const NEAR = 100;                // m : arbres complets en deçà, imposteurs au-delà
const NEAR_MAX = 12;             // arbres complets au plus, par espèce (les plus proches)
const SHADOW_RANGE = 140;        // m : arbres qui projettent une ombre (au-delà de la zone d'ombres du soleil)
const SHADOW_MAX = 400;          // par espèce
const MAX_TILT = 0.7;            // rad : inclinaison des imposteurs vers une caméra placée au-dessus
const FAR = 2600;                // m : au-delà, plus rien (le brouillard les cache)
const RELAYOUT = 35;             // m de déplacement de la caméra avant de refaire la répartition
const IMPOSTOR_SIZE = 256;
const UP = new Vector3(0, 1, 0);
// Palette Kenney (Textures/colormap.png) : 16 colonnes x 4 rangées de cases [colonne, rangée], rangée 0 en haut.
// Les toits d'origine (bleus, roses, violets) sont repeints en tuiles et en ardoise, tirés selon leur poids
const ROOFS = [
    { cell: [10, 2], weight: 0.3 },    // tuile brun-rouge
    { cell: [4, 3], weight: 0.25 },    // tuile terre cuite
    { cell: [5, 3], weight: 0.15 },    // tuile terre cuite foncée
    { cell: [11, 2], weight: 0.1 },    // tuile vieillie
    { cell: [8, 3], weight: 0.12 },    // ardoise
    { cell: [2, 2], weight: 0.08 },    // ardoise foncée
];
const WALL_CELL = [14, 2];           // crépi crème (église)
const SLATE_CELL = [8, 3];

function paletteCell(uv, i) {
    return Math.min(15, Math.floor(uv.getX(i) * 16)) + 16 * Math.min(3, Math.floor(uv.getY(i) * 4));
}

// Cases de la palette qui servent de toit dans un modèle : surtout peintes sur des faces en pente
function roofCells(geometry) {
    const pos = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
    const index = geometry.index, count = index ? index.count : pos.count;
    const sloped = new Map(), total = new Map();
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let t = 0; t < count; t += 3) {
        const [i, j, k] = index ? [index.getX(t), index.getX(t + 1), index.getX(t + 2)] : [t, t + 1, t + 2];
        a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, j); c.fromBufferAttribute(pos, k);
        const area = b.sub(a).cross(c.sub(a)).length() / 2;
        const cell = paletteCell(uv, i);
        total.set(cell, (total.get(cell) ?? 0) + area);
        const ny = normal.getY(i);
        if (ny > 0.25 && ny < 0.97) sloped.set(cell, (sloped.get(cell) ?? 0) + area);
    }
    return new Set([...sloped].filter(([cell, area]) => area > 0.35 * total.get(cell)).map(([cell]) => cell));
}

// Repeint les cases de toit vers une autre case (même position dans la case : le dégradé est conservé)
function repaint(uv, cells, [col, row]) {
    for (let i = 0; i < uv.count; i++) {
        const cell = paletteCell(uv, i);
        if (!cells.has(cell)) continue;
        uv.setXY(i, uv.getX(i) + (col - cell % 16) / 16, uv.getY(i) + (row - Math.floor(cell / 16)) / 4);
    }
}

function pickRoof(rnd) {
    let r = rnd() * ROOFS.reduce((sum, roof) => sum + roof.weight, 0);
    for (const roof of ROOFS) if ((r -= roof.weight) <= 0) return roof.cell;
    return ROOFS[0].cell;
}

// Matériau des maillages qui ne servent qu'à projeter une ombre : rien à l'écran (sommets envoyés hors du champ, aucun
// pixel calculé) ; la passe d'ombre utilise leur customDepthMaterial
const SHADOW_ONLY = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
    side: DoubleSide
});

// Copie d'un attribut (en flottants) : chaque maison placée transforme sa propre copie, pas les sommets du modèle
function floats(attribute) {
    const size = attribute.itemSize, array = new Float32Array(attribute.count * size);
    for (let i = 0; i < attribute.count; i++) for (let c = 0; c < size; c++) array[i * size + c] = attribute.getComponent(i, c);
    return new BufferAttribute(array, size);
}

// Tirage pseudo-aléatoire à graine fixe (mulberry32)
function random(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class Scenery {
    // terrain : { heightAt(x, z) } ; airport : { contains(x, z, marge) } ; corridor(x, z) : vrai dans l'axe d'approche
    // regions : centres des zones décorées (une par aérodrome), carrés de REGION m de demi-côté
    constructor(scene, { renderer, terrain, airport, corridor, regions = [{ x: 0, z: 0 }] }) {
        Object.assign(this, { scene, renderer, terrain, airport, corridor, regions });
        this.group = new Group();
        this.group.name = 'decor-realiste';
        this.group.visible = false;
        scene.add(this.group);
        this.density = 1;
        this.obstacles = [];
        this.species = [];
        this.villages = [];
        this.ready = false;
        this._lastLayout = null;
    }

    // Construit tout (une seule fois) ; rend une promesse
    build() {
        this._building ??= this._build().catch((error) => {
            console.error('Décor réaliste indisponible :', error);
            this._building = null;
        });
        return this._building;
    }

    async _build() {
        const rnd = random(1729);
        const villages = this._placeVillages(rnd);
        const [{ Tree }, houseModels] = await Promise.all([import(EZ_TREE_URL), this._loadHouses()]);
        this._buildHouses(villages, houseModels, rnd);
        const trees = this._placeTrees(rnd, villages);
        for (const [index, def] of SPECIES.entries()) {
            const source = new Tree();
            source.loadPreset(def.preset);
            const o = source.options;
            o.seed = 101 + index * 37;
            // Allègement (~6 000 triangles) : branches moins découpées ; feuilles moins nombreuses mais plus grandes, seuil de
            // transparence plus bas (sinon, de loin, les textures réduites rongent les feuilles et l'arbre paraît nu)
            for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(3, Math.round(o.branch.sections[k] * 0.5));
            for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * 0.6));
            o.leaves.count = Math.max(1, Math.round(o.leaves.count * 0.35));
            o.leaves.size *= 1.8;
            o.leaves.alphaTest = Math.min(o.leaves.alphaTest, 0.3);
            source.generate();
            // Feuillage : éclairage Lambert (bien moins coûteux que Phong, des milliers de feuilles se recouvrent), vent conservé
            const phong = source.leavesMesh.material;
            const leaves = new MeshLambertMaterial({ name: 'leaves', map: phong.map, color: phong.color.clone().multiplyScalar(1.35),
                side: DoubleSide, alphaTest: phong.alphaTest });
            leaves.onBeforeCompile = phong.onBeforeCompile;
            source.leavesMesh.material = leaves;
            this._instancedLeaves(leaves);
            await this._texturesLoaded(source);
            this.species.push(this._makeSpecies(source, def, trees.filter((t) => t.species === index)));
        }
        this.ready = true;
        this._lastLayout = null;
        this.setDensity(this.density);
    }

    // Le shader de vent des feuilles d'EZ-Tree remplace le calcul de position sans la matrice d'instance : toutes les
    // feuilles d'une espèce tombaient au même endroit. On l'ajoute (sans effet sur un arbre seul)
    _instancedLeaves(material) {
        const original = material.onBeforeCompile;
        material.onBeforeCompile = (shader, renderer) => {
            original.call(material, shader, renderer);
            shader.vertexShader = shader.vertexShader.replace('mvPosition = modelViewMatrix * mvPosition;',
                `#ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;`);
        };
        material.customProgramCacheKey = () => 'ez-tree-leaves-instanced';
        material.needsUpdate = true;
    }

    _texturesLoaded(tree) {
        const maps = [];
        tree.traverse((child) => {
            for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (child.material?.[key]) maps.push(child.material[key]);
        });
        return Promise.all(maps.map((map) => new Promise((resolve) => {
            const check = () => (map.image && (map.image.complete ?? true) && (map.image.width || map.image.naturalWidth)) ? resolve() : setTimeout(check, 30);
            check();
        })));
    }

    // --- Placement --------------------------------------------------------------------------------------------
    _free(x, z, villages, margin = 0) {
        if (!this.regions.some((r) => Math.abs(x - r.x) <= REGION && Math.abs(z - r.z) <= REGION)) return false;
        if (Math.abs(x) > MAP_EDGE || Math.abs(z) > MAP_EDGE) return false;   // (bord du terrain)
        if (this.airport.contains(x, z, 60)) return false;
        if (this.corridor(x, z)) return false;
        return !villages.some((v) => Math.hypot(x - v.x, z - v.z) < v.radius + margin);
    }

    // Vrai si le sol en (x, z) est de l'herbe assez plate : pente (1 - normale.y) sous maxSlope, sous la roche
    _grass(x, z, maxSlope) {
        const h = this.terrain.heightAt(x, z);
        if (h > GRASS_TOP) return false;
        const e = 6;
        const dx = this.terrain.heightAt(x + e, z) - this.terrain.heightAt(x - e, z);
        const dz = this.terrain.heightAt(x, z + e) - this.terrain.heightAt(x, z - e);
        return 1 - 2 * e / Math.hypot(dx, 2 * e, dz) < maxSlope;
    }

    // Villages : en plaine (fond de vallée, autour de l'aérodrome), là où presque tout le disque est plat
    _placeVillages(rnd) {
        const villages = [];
        // 4 villages par région, tirés à tour de rôle dans chacune
        const wanted = 4 * this.regions.length;
        for (let tries = 0; villages.length < wanted && tries < 3000 * this.regions.length; tries++) {
            const region = this.regions[villages.length % this.regions.length];
            const x = region.x + (rnd() * 2 - 1) * 2600, z = region.z + (rnd() * 2 - 1) * 2600;
            const radius = 130 + rnd() * 70;
            if (!this._free(x, z, villages, radius + 250) || this.airport.contains(x, z, radius + 200)) continue;
            let flat = 0, total = 0;
            for (let r = 0; r <= radius; r += radius / 3) {
                for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
                    total++;
                    if (this._grass(x + Math.cos(a) * r, z + Math.sin(a) * r, HOUSE_SLOPE)) flat++;
                }
            }
            if (flat / total > 0.85) villages.push({ x, z, radius });
        }
        return villages;
    }

    _placeTrees(rnd, villages) {
        // Massifs : centres et rayons tirés, puis arbres dans chaque massif (plus serrés au centre)
        const patches = [];
        // 30 massifs par région
        const wanted = 30 * this.regions.length;
        for (let tries = 0; patches.length < wanted && tries < 2000 * this.regions.length; tries++) {
            const region = this.regions[patches.length % this.regions.length];
            const x = region.x + (rnd() * 2 - 1) * 2600, z = region.z + (rnd() * 2 - 1) * 2600;
            if (!this._free(x, z, villages, 40) || !this._grass(x, z, TREE_SLOPE)) continue;
            patches.push({ x, z, radius: 80 + rnd() * 160, pine: rnd() < 0.4 });
        }
        const weights = SPECIES.map((s) => s.weight);
        const pick = (pine) => {
            const candidates = SPECIES.map((s, i) => i).filter((i) => (SPECIES[i].kind === 'pine') === pine || rnd() < 0.12);
            let total = candidates.reduce((sum, i) => sum + weights[i], 0), r = rnd() * total;
            for (const i of candidates) if ((r -= weights[i]) <= 0) return i;
            return candidates[0];
        };
        const area = patches.reduce((sum, p) => sum + p.radius * p.radius, 0);
        const trees = [];
        for (const p of patches) {
            const count = Math.round(TREE_COUNT * this.regions.length * p.radius * p.radius / area);
            for (let k = 0, tries = 0; k < count && tries < count * 4; tries++) {
                const r = p.radius * Math.sqrt(rnd()) * (0.6 + 0.4 * rnd()), a = rnd() * Math.PI * 2;
                const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
                if (!this._free(x, z, villages, 15) || !this._grass(x, z, TREE_SLOPE)) continue;
                const species = pick(p.pine);
                const [h0, h1] = SPECIES[species].height;
                trees.push({ x, z, species, height: h0 + (h1 - h0) * rnd(), angle: rnd() * Math.PI * 2, order: rnd() });
                k++;
            }
        }
        // Ordre aléatoire : le réglage de densité garde les premiers, répartis partout
        return trees.sort((a, b) => a.order - b.order);
    }

    // --- Arbres -----------------------------------------------------------------------------------------------
    _makeSpecies(source, def, trees) {
        const box = new Box3().setFromObject(source);
        const sourceHeight = box.max.y - box.min.y;
        const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
        // Matrice de chaque arbre (l'arbre généré mesure sourceHeight : ramené à sa hauteur tirée)
        const matrices = trees.map((t) => {
            const s = t.height / sourceHeight;
            const y = this.terrain.heightAt(t.x, t.z) - 0.3;
            return new Matrix4().compose(new Vector3(t.x, y, t.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), t.angle), new Vector3(s, s, s));
        });
        const full = [source.branchesMesh, source.leavesMesh].map((mesh) => {
            const instanced = new InstancedMesh(mesh.geometry, mesh.material, Math.min(NEAR_MAX, trees.length) || 1);
            instanced.castShadow = false;   // ombre portée par l'image de l'arbre entier (voir shadow), bien moins chère
            instanced.receiveShadow = true;
            instanced.frustumCulled = false;
            instanced.count = 0;
            this.group.add(instanced);
            return instanced;
        });
        const impostor = this._impostor(source, box, sourceHeight, width, trees.length);
        // Ombres de tous les arbres proches (feuillage compris) : deux panneaux croisés avec l'image de l'imposteur,
        // invisibles à l'écran. Bien moins cher que les milliers de feuilles, et les imposteurs n'ont plus à s'en charger
        const crossed = mergeGeometries([0, Math.PI / 2].map((angle) => impostor.geometry.clone().rotateY(angle)));
        // La passe d'ombre recopie map et alphaTest du matériau du maillage dans son customDepthMaterial : le matériau
        // invisible les porte aussi (sans eux, chaque arbre projetait l'ombre pleine de ses panneaux, des rectangles)
        const shadowMaterial = SHADOW_ONLY.clone();
        shadowMaterial.map = impostor.material.map;
        shadowMaterial.alphaTest = 0.45;
        const shadow = new InstancedMesh(crossed, shadowMaterial, Math.min(SHADOW_MAX, trees.length) || 1);
        shadow.customDepthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: impostor.material.map, alphaTest: 0.45 });
        shadow.castShadow = true;
        shadow.frustumCulled = false;
        shadow.count = 0;
        this.group.add(shadow);
        // Obstacles : tronc et houppier (boîte autour de la couronne, un peu resserrée)
        const obstacles = trees.map((t, i) => {
            const s = t.height / sourceHeight, half = width * s * 0.3;
            const p = new Vector3().setFromMatrixPosition(matrices[i]);
            return new Box3(new Vector3(p.x - half, p.y, p.z - half), new Vector3(p.x + half, p.y + t.height, p.z + half));
        });
        return { source, trees, matrices, full, impostor, shadow, obstacles };
    }

    // Imposteur : l'arbre rendu de profil dans une texture, posé sur un panneau tourné vers la caméra (voir update).
    // Normales vers le haut : il s'éclaire comme le feuillage vu d'en haut (pas de face noire à contre-jour)
    _impostor(source, box, height, width, count) {
        const target = new WebGLRenderTarget(IMPOSTOR_SIZE, IMPOSTOR_SIZE * 2);
        target.texture.colorSpace = SRGBColorSpace;
        // Mipmaps : au loin, un imposteur ne lit qu'une petite version de l'image (sinon le cache de texture déborde)
        target.texture.generateMipmaps = true;
        target.texture.minFilter = LinearMipmapLinearFilter;
        const scene = new Scene();
        scene.add(new HemisphereLight(0xffffff, 0x8a8a7a, 2.2));
        const light = new DirectionalLight(0xffffff, 1.6);
        light.position.set(0.4, 1, 1);
        scene.add(light);
        const holder = new Group();
        holder.add(source.branchesMesh.clone(), source.leavesMesh.clone());
        scene.add(holder);
        const half = Math.max(width / 2, height / 4) * 1.02;
        const camera = new OrthographicCamera(-half, half, box.max.y * 1.01, box.max.y * 1.01 - half * 4, 0.1, 1000);
        camera.position.set((box.min.x + box.max.x) / 2, 0, 500);
        camera.lookAt(camera.position.x, 0, 0);
        const renderer = this.renderer, previous = renderer.getRenderTarget(), clear = renderer.getClearAlpha();
        const color = renderer.getClearColor(new Color());
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(previous);
        renderer.setClearColor(color, clear);
        // Un panneau (largeur 2 * half, hauteur 4 * half), pied à la base de l'image
        const bottom = box.max.y * 1.01 - half * 4;
        const geometry = new PlaneGeometry(half * 2, half * 4);
        geometry.translate(0, bottom + half * 2, 0);
        const normals = geometry.attributes.normal;
        for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
        const material = new MeshLambertMaterial({ map: target.texture, alphaTest: 0.45, side: DoubleSide });
        const mesh = new InstancedMesh(geometry, material, count || 1);
        mesh.frustumCulled = false;
        // Ni ombres reçues ni portées : tous sont hors de la zone d'ombres du soleil (ombres portées : voir shadow)
        mesh.receiveShadow = mesh.castShadow = false;
        mesh.count = 0;
        this.group.add(mesh);
        return mesh;
    }

    // --- Maisons ----------------------------------------------------------------------------------------------
    async _loadHouses() {
        const loader = new GLTFLoader();
        const models = await Promise.all(HOUSES.map((url) => loader.loadAsync(url).then((g) => g.scene).catch(() => null)));
        return models.filter(Boolean);
    }

    _buildHouses(villages, models, rnd) {
        if (!models.length) return;
        const boxes = models.map((model) => { model.updateMatrixWorld(true); return new Box3().setFromObject(model); });
        const roofs = models.map((model) => {
            const cells = new Set();
            model.traverse((child) => { if (child.isMesh) for (const cell of roofCells(child.geometry)) cells.add(cell); });
            return cells;
        });
        let material = null;
        for (const v of villages) {
            // Un seul maillage par village (toutes les maisons partagent la même texture) : 5 appels de dessin en tout,
            // et un village hors champ (ou hors de la zone d'ombre) est écarté d'un bloc
            const parts = [];
            // Rues : grille de 24 m, maisons tournées vers la rue
            const angle = rnd() * Math.PI;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            for (let i = -6; i <= 6; i++) {
                for (let j = -6; j <= 6; j++) {
                    // Alignement imparfait : maisons plus ou moins en retrait de la rue
                    const u = i * STREET[0] + (rnd() - 0.5) * 6, w = j * STREET[1] + (rnd() - 0.5) * 5;
                    // Place de l'église au centre ; plus clairsemé vers le bord du village
                    const edge = Math.hypot(u, w) / v.radius;
                    if (edge > 1 || Math.hypot(u, w) < 34 || rnd() < 0.15 + 0.45 * edge * edge) continue;
                    const x = v.x + u * cos - w * sin, z = v.z + u * sin + w * cos;
                    if (this.airport.contains(x, z, 60) || this.corridor(x, z) || !this._grass(x, z, HOUSE_SLOPE)) continue;
                    const facing = angle + (j % 2 ? 0 : Math.PI) + (rnd() - 0.5) * 0.08;
                    const k = Math.floor(rnd() * models.length), box = boxes[k], roof = pickRoof(rnd);
                    // Tailles un peu variées ; posée au plus bas des quatre coins (pas de maison qui flotte sur une pente)
                    const scale = HOUSE_SCALE * (0.88 + rnd() * 0.24);
                    const r = (box.max.x - box.min.x) * scale / 2;
                    const y = Math.min(...[[r, r], [-r, r], [r, -r], [-r, -r], [0, 0]].map(([dx, dz]) => this.terrain.heightAt(x + dx, z + dz)));
                    const m = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, facing),
                        new Vector3(scale, scale, scale));
                    models[k].traverse((child) => {
                        if (!child.isMesh) return;
                        // Éclairage Lambert : les maisons Kenney n'ont qu'une texture de couleurs, le PBR n'apporte rien
                        material ??= new MeshLambertMaterial({ map: child.material.map, color: child.material.color });
                        const g = new BufferGeometry();
                        for (const name of ['position', 'normal', 'uv']) g.setAttribute(name, floats(child.geometry.attributes[name]));
                        if (child.geometry.index) g.setIndex(child.geometry.index);
                        repaint(g.attributes.uv, roofs[k], roof);
                        parts.push(g.applyMatrix4(new Matrix4().multiplyMatrices(m, child.matrixWorld)));
                    });
                    this.obstacles.push(box.clone().applyMatrix4(m));
                }
            }
            if (!parts.length) continue;
            this._church(v, angle, parts);
            const mesh = new Mesh(mergeGeometries(parts), material);
            mesh.receiveShadow = true;
            mesh.geometry.computeBoundingSphere();
            this.group.add(mesh);
            this.villages.push(mesh);
        }
        this._houseObstacles = this.obstacles.slice();
    }

    // Église au centre du village : nef crépie, toit de tuiles à deux pans, clocher carré et flèche d'ardoise.
    // Formes simples peintes avec la palette des maisons (même matériau, même maillage que le village)
    _church(v, angle, parts) {
        const ground = Math.min(...[[0, 0], [15, 15], [-15, 15], [15, -15], [-15, -15]]
            .map(([dx, dz]) => this.terrain.heightAt(v.x + dx, v.z + dz)));
        const place = new Matrix4().compose(new Vector3(v.x, ground, v.z), new Quaternion().setFromAxisAngle(UP, angle),
            new Vector3(1, 1, 1));
        const box = new Box3();
        const add = (geometry, [col, row]) => {
            const uv = geometry.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + 0.5) / 16, (row + 0.3) / 4);
            geometry.applyMatrix4(place);
            geometry.computeBoundingBox();
            box.union(geometry.boundingBox);
            parts.push(geometry);
        };
        // Nef (12 x 26 m, murs de 10 m) et son toit : prisme à section triangulaire, axe le long de la nef
        add(new BoxGeometry(12, 10, 26).translate(0, 5, -4), WALL_CELL);
        add(new CylinderGeometry(7.6, 7.6, 27.5, 3).rotateX(-Math.PI / 2).scale(1, 0.7, 1).translate(0, 12.7, -4), ROOFS[0].cell);
        // Clocher devant la nef, flèche pyramidale
        add(new BoxGeometry(7, 24, 7).translate(0, 12, 11), WALL_CELL);
        add(new ConeGeometry(5.2, 13, 4).rotateY(Math.PI / 4).translate(0, 30.5, 11), SLATE_CELL);
        this.obstacles.push(box);
    }

    // --- Réglages et image ------------------------------------------------------------------------------------
    // Part des arbres affichés (réglage « Arbres et décor »)
    setDensity(density) {
        this.density = density;
        this._lastLayout = null;
        if (!this.ready) return;
        this.obstacles = [...(this._houseObstacles ?? [])];
        for (const sp of this.species) this.obstacles.push(...sp.obstacles.slice(0, this._shown(sp)));
    }

    _shown(species) {
        return Math.round(species.trees.length * this.density);
    }

    setVisible(visible) {
        this.group.visible = visible;
        if (visible) this.build();
    }

    // camera : position (monde) ; time : s (vent dans les feuillages) ; shadowCenter : centre de la zone d'ombres du
    // décor (au sol, sous l'avion : voir Graphics.update), la caméra si absent
    update(cameraPosition, time, shadowCenter = cameraPosition) {
        if (!this.ready || !this.group.visible) return;
        for (const sp of this.species) sp.source.update(time);
        // Ombres des maisons seulement dans la zone d'ombres (ailleurs : passe d'ombre inutile)
        for (const village of this.villages) {
            const sphere = village.geometry.boundingSphere;
            village.castShadow = sphere.center.distanceTo(shadowCenter) < sphere.radius + SHADOW_RANGE;
        }
        // Rien au-delà de la fin du brouillard (par paliers de 200 m : à refaire quand la météo ou un nuage le change)
        const farthest = Math.min(FAR, Math.ceil((this.scene.fog?.far ?? FAR) / 200) * 200);
        if (this._lastLayout && this._lastLayout.distanceTo(cameraPosition) < RELAYOUT && this._lastShadow.distanceTo(shadowCenter) < RELAYOUT
            && farthest === this._layoutFar) return;
        this._lastLayout = cameraPosition.clone();
        this._lastShadow = shadowCenter.clone();
        this._layoutFar = farthest;
        const near = this.near ?? NEAR, near2 = near * near, far2 = farthest * farthest, shadow2 = SHADOW_RANGE * SHADOW_RANGE;
        const p = new Vector3(), scale = new Vector3(), yaw = new Quaternion(), tilt = new Quaternion(), billboard = new Matrix4();
        const X = new Vector3(1, 0, 0);
        for (const sp of this.species) {
            const [branches, leaves] = sp.full, { impostor, shadow } = sp;
            const close = [], far = [];
            let shadowCount = 0;
            const shown = this._shown(sp);
            for (let i = 0; i < shown; i++) {
                const m = sp.matrices[i];
                p.setFromMatrixPosition(m);
                const d2 = p.distanceToSquared(cameraPosition);
                if (d2 > far2) continue;
                // Ombre portée : arbres proches du centre de la zone d'ombres (distance au sol)
                const s2 = (p.x - shadowCenter.x) ** 2 + (p.z - shadowCenter.z) ** 2;
                if (s2 < shadow2 && shadowCount < shadow.instanceMatrix.count) shadow.setMatrixAt(shadowCount++, m);
                (d2 < near2 ? close : far).push({ i, d2 });
            }
            // Arbres complets : les plus proches ; le surplus passe en imposteurs
            close.sort((a, b) => a.d2 - b.d2);
            const nearCount = Math.min(close.length, branches.instanceMatrix.count);
            for (let k = 0; k < nearCount; k++) {
                branches.setMatrixAt(k, sp.matrices[close[k].i]);
                leaves.setMatrixAt(k, sp.matrices[close[k].i]);
            }
            // Imposteurs du plus proche au plus loin : les pixels cachés par un arbre déjà dessiné sont écartés avant
            // le calcul d'éclairage (les forêts vues de biais se recouvrent sur des dizaines d'épaisseurs)
            const rest = close.slice(nearCount).concat(far.sort((a, b) => a.d2 - b.d2));
            rest.forEach(({ i }, k) => {
                const m = sp.matrices[i];
                this._billboard(impostor, k, m, p.setFromMatrixPosition(m), cameraPosition, scale, yaw, tilt, X, billboard);
            });
            branches.count = leaves.count = nearCount;
            impostor.count = rest.length;
            shadow.count = shadowCount;
            for (const mesh of [branches, leaves, impostor, shadow]) mesh.instanceMatrix.needsUpdate = true;
        }
    }

    // Panneau tourné vers la caméra (autour de la verticale) et penché vers elle si elle est au-dessus, pivot au pied
    _billboard(impostor, index, m, p, camera, scale, yaw, tilt, X, out) {
        const s = scale.setFromMatrixScale(m).x;
        const dx = camera.x - p.x, dz = camera.z - p.z;
        yaw.setFromAxisAngle(UP, Math.atan2(dx, dz));
        tilt.setFromAxisAngle(X, -Math.min(MAX_TILT, Math.max(0, Math.atan2(camera.y - p.y, Math.hypot(dx, dz)))));
        out.compose(p, yaw.multiply(tilt), scale.setScalar(s));
        impostor.setMatrixAt(index, out);
    }
}

export { Scenery };
