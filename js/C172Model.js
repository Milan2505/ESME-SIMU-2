import {
    BackSide,
    Box3,
    BoxGeometry,
    CanvasTexture,
    CylinderGeometry,
    DoubleSide,
    FrontSide,
    Group,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    RepeatWrapping,
    SRGBColorSpace,
    Vector3
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Cessna 172P du projet FlightGear (équipe c172p, licence GPL-2.0 : asset/c172p-LICENCE.txt), converti en GLB
// (asset/c172p.glb : extérieur seulement, textures d'origine). Ici : mise en place dans le repère de l'avion,
// hélice et gouvernes mobiles, immatriculation et couleur de livrée peintes sur les textures, intérieur.
// Repère avion : x vers la droite, y vers le haut, z vers l'arrière (nez vers -z) ; la cabine (Cockpit.js) a son
// origine à CABIN_ORIGIN. Le modèle est décalé de MODEL_OFFSET : son tableau de bord d'origine (face à z -0,37,
// haut à y 0,163) tombe sur celui de Panel172.

const MODEL_URL = 'asset/c172p.glb';
const MODEL_OFFSET = new Vector3(0, 0.637, -2.23);
const GROUND_Y = -1.326 + MODEL_OFFSET.y;       // bas des roues principales
const CABIN_ORIGIN = new Vector3(0, 0.9, -1.85);
const FLOOR_Y = -0.69 + MODEL_OFFSET.y;         // plancher de la cabine

// Immatriculation d'origine (4X-CHV) dans les textures (px, textures de 2048) : flancs du fuselage (gris, penchée),
// dessous des ailes (bleu de la livrée, écrite dans le sens de l'envergure)
const REGISTRATION_AREAS = {
    fuselage: [{ box: [1326, 294, 1574, 368], color: '#979893', italic: true },
        { box: [306, 1400, 554, 1476], color: '#979893', italic: true }],
    wing: [{ box: [166, 136, 266, 504], color: '#1d2a6e', vertical: true },
        { box: [166, 1536, 266, 1894], color: '#1d2a6e', vertical: true }],
};
const NAVY = [29, 42, 110];                     // bleu de la livrée d'origine

// --- Matériaux un peu auto-éclairés (lumière renvoyée par le sol et les vitres) : éteints la nuit ---------------
const ambientMaterials = new Set();
let daylight = 1;
function ambient(material) {
    material.emissiveIntensity = daylight;
    ambientMaterials.add(material);
    return material;
}
// k : 1 en plein jour -> ~0 la nuit
function setDaylight(k) {
    daylight = k;
    for (const material of ambientMaterials) material.emissiveIntensity = k;
}

// --- Chargement --------------------------------------------------------------------------------------------------
const PARTS = new WeakMap();
const BASE_IMAGES = {};                          // images d'origine : fuselage, tail, wing

// Avion prêt à voler : { model (avion du joueur), template (copie, textures plus petites, pour les avions garés
// et ceux des autres joueurs) }
async function loadAircraft() {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const model = prepare(gltf.scene);
    const template = model.clone();
    template.userData.textureSize = 1024;
    const parts = PARTS.get(model);
    // Pièces mobiles de la copie : retrouvées par leur nom
    PARTS.set(template, { propeller: template.getObjectByName('Propeller_Cone'), pivots: {} });
    repaint(model);
    repaint(template);
    return { model, template, parts };
}

function prepare(scene) {
    const root = new Group();
    root.name = 'C172';
    scene.position.copy(MODEL_OFFSET);
    root.add(scene);
    const meshes = {};
    scene.traverse((child) => {
        if (!child.isMesh) return;
        meshes[child.name] = child;
        const material = child.material;
        const kind = material.map?.name?.replace('.png', '');
        if (kind && ['fuselage', 'tail', 'wing'].includes(kind)) {
            material.userData.kind = kind;
            BASE_IMAGES[kind] ??= material.map.image;
        }
        if (material.transparent) {
            // Vitres : vues des deux côtés, sans masquer ce qui est derrière
            material.side = DoubleSide;
            material.depthWrite = false;
            child.renderOrder = 2;
        } else {
            material.side = FrontSide;
            material.emissive?.setRGB(0.18, 0.18, 0.19);
            if (material.map) material.emissiveMap = material.map;
            ambient(material);
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    // Hélice : cône et pales tournent ensemble autour de l'axe du cône
    const box = new Box3().setFromObject(meshes.Propeller);
    const center = box.getCenter(new Vector3());
    const propeller = new Group();
    propeller.name = 'Propeller_Cone';
    propeller.position.copy(center);
    for (const mesh of [meshes.Propeller, meshes.Spinner]) {
        mesh.geometry.translate(-center.x, -center.y, -center.z);
        propeller.add(mesh);
    }
    scene.add(propeller);
    // Gouvernes : pivot sur la charnière (bord avant de la gouverne)
    const pivots = {};
    const pivot = (name, parts, span) => {
        const list = parts.map((n) => meshes[n]).filter(Boolean);
        if (!list.length) return;
        const points = [];
        for (const mesh of list) {
            const p = mesh.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) points.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)));
        }
        const minZ = Math.min(...points.map((p) => p.z));
        const front = points.filter((p) => p.z < minZ + (span === 'y' ? 0.25 : 0.03));
        front.sort((a, b) => a[span] - b[span]);
        const a = front[0], b = front[front.length - 1];
        const axis = b.clone().sub(a).normalize();
        if (span === 'x' ? axis.x < 0 : axis.y > 0) axis.negate();   // angle positif : bord de fuite vers le bas / la gauche
        const group = new Group();
        group.name = name;
        group.position.copy(a);
        group.userData.axis = axis;
        for (const mesh of list) {
            mesh.geometry.translate(-a.x, -a.y, -a.z);
            group.add(mesh);
        }
        scene.add(group);
        pivots[name] = group;
    };
    pivot('aileronLeft', ['leftaileron'], 'x');
    pivot('aileronRight', ['rightaileron'], 'x');
    pivot('flapLeft', ['flaps'], 'x');
    pivot('elevator', ['elevatorleft', 'elevatorright', 'elevatortrim'], 'x');
    pivot('rudder', ['rudder_1'], 'y');
    PARTS.set(root, { propeller, pivots });
    root.userData = { registration: 'F-HESM', liveryColor: null, textureSize: 2048 };
    return root;
}

// Pièces mobiles d'un avion : { propeller, pivots (gouvernes) }
function aircraftParts(model) {
    return PARTS.get(model);
}

// --- Peinture : immatriculation et couleur de livrée -------------------------------------------------------------
const painted = new Map();                       // textures peintes, par réglage (partagées entre avions identiques)
const ownMaterials = new WeakMap();              // avion -> ses matériaux à lui (copies)

function setRegistration(model, registration) {
    if (model.userData.registration === registration && ownMaterials.has(model)) return;
    model.userData.registration = registration;
    repaint(model);
}

// color : couleur des bandes (nombre), null : bleu d'origine
function setLiveryColor(model, color) {
    if (model.userData.liveryColor === color && ownMaterials.has(model)) return;
    model.userData.liveryColor = color;
    repaint(model);
}

function repaint(model) {
    const { registration, liveryColor, textureSize } = model.userData;
    if (!ownMaterials.has(model)) ownMaterials.set(model, new Set());
    const own = ownMaterials.get(model);
    model.traverse((child) => {
        const kind = child.isMesh && child.material.userData.kind;
        if (!kind || !BASE_IMAGES[kind]) return;
        if (!own.has(child.material)) {
            child.material = child.material.clone();
            ambient(child.material);
            own.add(child.material);
        }
        const text = REGISTRATION_AREAS[kind] ? registration : null;
        const key = `${kind}|${text}|${liveryColor}|${textureSize}`;
        if (!painted.has(key)) painted.set(key, paintTexture(kind, text, liveryColor, textureSize));
        child.material.map = child.material.emissiveMap = painted.get(key);
    });
}

function paintTexture(kind, registration, color, size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(BASE_IMAGES[kind], 0, 0, size, size);
    if (registration) {
        const k = size / 2048;
        for (const area of REGISTRATION_AREAS[kind]) paintRegistration(ctx, registration, area.box.map((v) => v * k), area);
    }
    const texture = new CanvasTexture(canvas);
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    if (color !== null && color !== undefined) schedule(recolor(ctx, texture, color));
    return texture;
}

// Efface l'ancienne immatriculation (dégradé d'un bord à l'autre, dans le sens de la hauteur des lettres) et
// écrit la nouvelle dans le même style
function paintRegistration(ctx, text, [x0, y0, x1, y1], { color, italic = false, vertical = false }) {
    x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2; x1 = Math.ceil(x1) + 2; y1 = Math.ceil(y1) + 2;
    const w = x1 - x0, h = y1 - y0;
    const image = ctx.getImageData(x0, y0, w, h);
    const d = image.data;
    const at = (x, y) => (y * w + x) * 4;
    if (vertical) {
        for (let y = 0; y < h; y++) {
            for (let x = 1; x < w - 1; x++) {
                const t = x / (w - 1), k = at(x, y), a = at(0, y), b = at(w - 1, y);
                for (let c = 0; c < 4; c++) d[k + c] = d[a + c] * (1 - t) + d[b + c] * t;
            }
        }
    } else {
        for (let x = 0; x < w; x++) {
            for (let y = 1; y < h - 1; y++) {
                const t = y / (h - 1), k = at(x, y), a = at(x, 0), b = at(x, h - 1);
                for (let c = 0; c < 4; c++) d[k + c] = d[a + c] * (1 - t) + d[b + c] * t;
            }
        }
    }
    ctx.putImageData(image, x0, y0);
    // Lettres : hauteur = petit côté de la zone ; sur l'aile, écrites de haut en bas
    const length = vertical ? h : w, size = (vertical ? w : h) - 6;
    ctx.save();
    ctx.translate(x0 + w / 2, y0 + h / 2);
    if (vertical) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = color;
    ctx.font = `${italic ? 'italic ' : ''}bold ${Math.round(size * 0.95)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, size * 0.04, length - 8);
    ctx.restore();
}

// Bandes bleues de la livrée -> autre couleur (bords adoucis conservés), calculé en arrière-plan
function* recolor(ctx, texture, color) {
    const size = ctx.canvas.width;
    const target = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    const shift = target.map((v, i) => v - NAVY[i]);
    const rows = 64;
    for (let y0 = 0; y0 < size; y0 += rows) {
        const image = ctx.getImageData(0, y0, size, rows);
        const d = image.data;
        for (let k = 0; k < d.length; k += 4) {
            const r = d[k], g = d[k + 1], b = d[k + 2];
            const t = Math.max(0, Math.min(1, (b - (r + g) / 2 - 8) / 64));
            if (t <= 0 || b < r + 20) continue;
            d[k] = r + shift[0] * t;
            d[k + 1] = g + shift[1] * t;
            d[k + 2] = b + shift[2] * t;
        }
        ctx.putImageData(image, 0, y0);
        yield;
    }
    texture.needsUpdate = true;
}

// Travaux de fond : quelques millisecondes à la fois, entre deux images
const jobs = [];
let jobTimer = 0;
function schedule(job) {
    jobs.push(job);
    if (!jobTimer) jobTimer = setTimeout(runJobs, 0);
}
function runJobs() {
    const end = performance.now() + 8;
    while (jobs.length && performance.now() < end) {
        if (jobs[0].next().done) jobs.shift();
    }
    jobTimer = jobs.length ? setTimeout(runJobs, 0) : 0;
}

// --- Intérieur -------------------------------------------------------------------------------------------------------
// Ciel de toit, pare-feu, moquette, sièges, harnais, palonniers (les garnitures : buildCabinShell). Repère avion
// Garnitures : l'envers de la carrosserie de l'avion chargé (repère avion)
function buildCabinShell(model) {
    const group = new Group();
    const trim = ambient(new MeshStandardMaterial({ color: 0xbca684, roughness: 0.85, side: BackSide, emissive: 0x3a342a }));
    model.updateMatrixWorld(true);
    const inverse = model.matrixWorld.clone().invert();
    for (const name of ['fuselage', 'leftdoor', 'rightdoor', 'windowframeleftext', 'windowframerightext', 'baggagedoorexterior', 'fuselage_cowling_top']) {
        const source = model.getObjectByName(name);
        if (!source) continue;
        const inner = new Mesh(source.geometry, trim);
        inner.applyMatrix4(inverse.clone().multiply(source.matrixWorld));
        inner.receiveShadow = true;
        group.add(inner);
    }
    return group;
}

function buildCabin() {
    const group = new Group();
    const tan = ambient(new MeshStandardMaterial({ color: 0xc3ab83, roughness: 0.75, emissive: 0x2e281e }));
    const dark = new MeshStandardMaterial({ color: 0x29292b, roughness: 0.9 });
    // Ciel de toit (sous l'aile), pare-feu derrière le tableau
    const headliner = new Mesh(new PlaneGeometry(1.0, 1.25), ambient(new MeshStandardMaterial({ color: 0xd6ccb4, roughness: 0.9, emissive: 0x4a463c })));
    headliner.rotation.x = Math.PI / 2;
    headliner.position.set(0, 1.155, -1.72);
    const firewall = new Mesh(new PlaneGeometry(1.0, 0.8), dark);
    firewall.position.set(0, FLOOR_Y + 0.4, -2.9);
    group.add(headliner, firewall);
    // Moquette
    const carpet = new Mesh(new BoxGeometry(0.94, 0.02, 2.0), new MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }));
    carpet.position.set(0, FLOOR_Y + 0.01, -1.85);
    group.add(carpet);
    // Sièges avant (tissu gris bleuté, cuir beige, appui-tête), banquette arrière
    for (const x of [-0.23, 0.23]) group.add(seat(x, -2.05, FLOOR_Y + 0.27, false));
    group.add(seat(0, -1.2, FLOOR_Y + 0.25, true));
    for (const side of [-1, 1]) {
        // Accoudoir de porte
        const arm = new Mesh(new RoundedBoxGeometry(0.05, 0.05, 0.45, 3, 0.02), tan);
        arm.position.set(side * 0.46, FLOOR_Y + 0.5, -2.0);
        group.add(arm);
        // Harnais : du toit derrière le siège vers la boucle
        const top = new Vector3(side * 0.43, 1.1, -1.85), bottom = new Vector3(side * 0.1, FLOOR_Y + 0.3, -1.98);
        const strap = new Mesh(new BoxGeometry(0.045, top.distanceTo(bottom), 0.005), new MeshStandardMaterial({ color: 0xa69b85, roughness: 0.9 }));
        strap.position.copy(top).add(bottom).multiplyScalar(0.5);
        strap.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
        group.add(strap);
    }
    const dome = new Mesh(new CylinderGeometry(0.05, 0.05, 0.015, 20), new MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.4 }));
    dome.position.set(0, 1.15, -1.6);
    group.add(dome);
    // Palonniers (deux paires, freins en haut) : déplacés par le pilote (voir Cockpit)
    const pedals = [];
    for (const x of [-0.2, 0.2]) {
        for (const side of [-1, 1]) {
            const pedal = new Group();
            pedal.position.set(x + side * 0.075, FLOOR_Y + 0.16, -2.72);
            const plate = new Mesh(new RoundedBoxGeometry(0.075, 0.13, 0.02, 2, 0.006), new MeshStandardMaterial({ color: 0x3a3b3e, metalness: 0.4, roughness: 0.5 }));
            plate.rotation.x = -0.9;
            plate.position.set(0, 0.06, 0.02);
            const arm = new Mesh(new CylinderGeometry(0.008, 0.008, 0.16, 8), new MeshStandardMaterial({ color: 0x8c9095, metalness: 0.7, roughness: 0.4 }));
            arm.position.set(0, -0.02, -0.05);
            arm.rotation.x = 0.5;
            pedal.add(plate, arm);
            pedal.userData.side = side;
            pedal.userData.z = pedal.position.z;
            group.add(pedal);
            pedals.push(pedal);
        }
    }
    group.userData.pedals = pedals;
    group.traverse((child) => { if (child.isMesh) child.receiveShadow = true; });
    return group;
}

function carpetTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(128, 128);
    for (let i = 0; i < image.data.length; i += 4) {
        const v = 38 + Math.random() * 14;
        image.data[i] = v; image.data[i + 1] = v * 0.97; image.data[i + 2] = v * 0.93; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(8, 8);
    return texture;
}

// Tissu des sièges : gris bleuté moucheté
let fabricMaterial = null;
function fabric() {
    if (fabricMaterial) return fabricMaterial;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(128, 128);
    for (let i = 0; i < image.data.length; i += 4) {
        const fleck = Math.random() < 0.18 ? 30 : 0;
        const v = 70 + Math.random() * 18 + fleck;
        image.data[i] = v * 0.92; image.data[i + 1] = v * 0.95; image.data[i + 2] = v * 1.08; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(3, 3);
    fabricMaterial = ambient(new MeshStandardMaterial({ map: texture, roughness: 0.95, emissive: 0x5a5a5a, emissiveMap: texture }));
    return fabricMaterial;
}

// Siège : assise, dossier incliné, appui-tête ; liserés et joues en cuir beige ; bench : banquette à deux places
function seat(x, z, height, bench) {
    const g = new Group();
    g.position.set(x, 0, z);
    const leather = ambient(new MeshStandardMaterial({ color: 0xb59b74, roughness: 0.6, emissive: 0x2e2719 }));
    const width = bench ? 0.98 : 0.46;
    const cushion = new Mesh(new RoundedBoxGeometry(width, 0.11, 0.48, 4, 0.04), fabric());
    cushion.position.set(0, height, 0);
    const base = new Mesh(new RoundedBoxGeometry(width + 0.02, 0.06, 0.5, 3, 0.02), leather);
    base.position.set(0, height - 0.075, 0);
    g.add(cushion, base);
    // Dossier(s) et appuis-tête
    for (const dx of bench ? [-0.245, 0.245] : [0]) {
        const back = new Group();
        back.position.set(dx, height + 0.04, 0.25);
        back.rotation.x = -0.2;
        const pad = new Mesh(new RoundedBoxGeometry(0.44, 0.6, 0.1, 4, 0.04), fabric());
        pad.position.y = 0.3;
        const shell = new Mesh(new RoundedBoxGeometry(0.47, 0.62, 0.06, 3, 0.025), leather);
        shell.position.set(0, 0.3, 0.05);
        const head = new Mesh(new RoundedBoxGeometry(0.26, 0.17, 0.09, 4, 0.04), fabric());
        head.position.set(0, 0.7, 0.01);
        const headTrim = new Mesh(new RoundedBoxGeometry(0.28, 0.19, 0.06, 3, 0.03), leather);
        headTrim.position.set(0, 0.7, 0.04);
        const posts = new Mesh(new BoxGeometry(0.12, 0.08, 0.02), new MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.7, roughness: 0.3 }));
        posts.position.set(0, 0.6, 0.03);
        back.add(pad, shell, head, headTrim, posts);
        g.add(back);
    }
    // Rails et pieds
    if (!bench) {
        for (const dx of [-0.15, 0.15]) {
            const rail = new Mesh(new BoxGeometry(0.03, 0.03, 0.6), new MeshStandardMaterial({ color: 0x8c9095, metalness: 0.7, roughness: 0.4 }));
            rail.position.set(dx, 0.045, 0);
            const leg = new Mesh(new BoxGeometry(0.03, height - 0.1, 0.03), new MeshStandardMaterial({ color: 0x55585c, metalness: 0.5, roughness: 0.5 }));
            leg.position.set(dx, (height - 0.1) / 2 + 0.03, 0);
            g.add(rail, leg);
        }
    }
    g.traverse((child) => { if (child.isMesh) child.castShadow = true; });
    return g;
}

export { loadAircraft, aircraftParts, buildCabin, buildCabinShell, setRegistration, setLiveryColor, setDaylight, GROUND_Y, CABIN_ORIGIN };
