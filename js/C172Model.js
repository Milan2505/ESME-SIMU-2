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
    Shape,
    ShapeGeometry,
    BufferGeometry,
    Float32BufferAttribute,
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
// Tout l'avion (modèle, cabine, tableau, feux) est agrandi de AIRCRAFT_SCALE : le modèle FlightGear (8,2 m de long,
// 2,45 m de haut) paraissait petit à côté du décor ; agrandi, il retrouve la taille de l'ancien modèle du simulateur
// (9,7 m de long). Les cotes ci-dessous sont avant agrandissement.

const MODEL_URL = 'asset/c172p.glb';
const AIRCRAFT_SCALE = 1.18;
const MODEL_OFFSET = new Vector3(0, 0.637, -2.23);
const GROUND_Y = (-1.326 + MODEL_OFFSET.y) * AIRCRAFT_SCALE;   // bas des roues principales (agrandi : repère avion)
const CABIN_ORIGIN = new Vector3(0, 0.9, -1.85);
const FLOOR_Y = -0.69 + MODEL_OFFSET.y;         // plancher de la cabine
const SEAT_Z = -1.9;                            // sièges avant (milieu de l'assise), comme siège réglé à mi-course

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
    // Emplanture de l'aile : dans le modèle, l'aile traverse le fuselage sans nervure (vue de la cabine à travers le
    // pare-brise, sa face intérieure n'est pas dessinée : on voyait le ciel). Fermée par son propre profil
    closeWingRoot(meshes, scene);
    // Hélice : cône et pales tournent ensemble autour de l'axe du cône. Centre pris dans le repère du modèle (setFromObject
    // donne le repère du monde, qui comprend MODEL_OFFSET : l'axe se trouvait 0,64 m plus haut et 2,23 m plus en arrière
    // que le moyeu, et l'hélice, dès qu'elle avait tourné, orbitait autour du nez et rentrait dans le capot)
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(meshes.Propeller);
    const center = scene.worldToLocal(box.getCenter(new Vector3()));
    const propeller = new Group();
    propeller.name = 'Propeller_Cone';
    propeller.position.copy(center);
    for (const mesh of [meshes.Propeller, meshes.Spinner]) {
        mesh.geometry.translate(-center.x, -center.y, -center.z);
        propeller.add(mesh);
    }
    scene.add(propeller);
    // Gouvernes : pivot sur la charnière, entre les points les plus en avant des deux bouts de la gouverne (span : axe
    // de l'envergure de la gouverne). Profondeur : ses bouts avancent (compensation), la charnière passe par l'emplanture
    // et reste transversale (fixedAxis)
    const pivots = {};
    const pivot = (name, parts, span, fixedAxis = null) => {
        const list = parts.map((n) => meshes[n]).filter(Boolean);
        if (!list.length) return;
        const points = [];
        for (const mesh of list) {
            const p = mesh.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) points.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)));
        }
        const lo = Math.min(...points.map((p) => p[span])), hi = Math.max(...points.map((p) => p[span]));
        const frontmost = (filter) => points.filter(filter).reduce((best, p) => (p.z < best.z ? p : best));
        let a, axis;
        if (fixedAxis) {
            const middle = (lo + hi) / 2, half = (hi - lo) / 2;
            a = frontmost((p) => Math.abs(p[span] - middle) < 0.15 * half);
            axis = fixedAxis.clone();
        } else {
            const end = 0.1 * (hi - lo);
            a = frontmost((p) => p[span] < lo + end);
            const b = frontmost((p) => p[span] > hi - end);
            // Gouverne de direction (symétrique) : charnière dans le plan de symétrie, pour que son nez arrondi (voir
            // roundJunction) tourne sur lui-même
            if (span === 'y') a.x = b.x = 0;
            axis = b.clone().sub(a).normalize();
        }
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
    pivot('elevator', ['elevatorleft', 'elevatorright', 'elevatortrim'], 'x', new Vector3(1, 0, 0));
    pivot('rudder', ['rudder_1'], 'y');
    const fin = meshes.vstab001 ?? meshes['vstab.001'];   // (GLTFLoader retire les points des noms)
    if (pivots.rudder && fin) roundJunction(meshes.rudder_1, pivots.rudder.position, fin);
    // Compensateur (tab de trim) : dans la découpe du bord de fuite de la gouverne de profondeur droite ; il la suit et
    // braque en plus selon le trim. Charnière le long de son bord d'attaque, qui est en biais (plus en arrière côté
    // fuselage) : un axe transversal le faisait sortir de sa découpe dès qu'il braquait
    if (pivots.elevator && meshes.elevatortrim) {
        const tab = meshes.elevatortrim;
        const p = tab.geometry.attributes.position;
        const points = [];
        for (let i = 0; i < p.count; i++) points.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)));
        const lo = Math.min(...points.map((v) => v.x)), hi = Math.max(...points.map((v) => v.x)), end = 0.05 * (hi - lo);
        // Bout du bord d'attaque : point le plus en avant de chaque extrémité, à mi-épaisseur
        const corner = (filter) => {
            const side = points.filter(filter), front = Math.min(...side.map((v) => v.z));
            const edge = side.filter((v) => v.z < front + 0.008);
            return edge.reduce((sum, v) => sum.add(v), new Vector3()).divideScalar(edge.length);
        };
        const a = corner((v) => v.x < lo + end), b = corner((v) => v.x > hi - end);
        // (sommets déjà dans le repère de la gouverne : voir pivot)
        const hinge = a.clone();
        tab.geometry.translate(-a.x, -a.y, -a.z);
        const group = new Group();
        group.name = 'trimTab';
        group.position.copy(hinge);
        group.userData.axis = b.sub(a).normalize();   // vers l'extérieur (+x) : angle positif = bord de fuite vers le bas
        group.add(tab);
        pivots.elevator.add(group);
        pivots.trimTab = group;
    }
    // Feu de queue : sur le bord de fuite de la gouverne de direction, il la suit (l'anticollision, lui, est sur la
    // partie fixe de la dérive)
    if (pivots.rudder && meshes.RearNavLight) {
        const hinge = pivots.rudder.position;
        meshes.RearNavLight.geometry.translate(-hinge.x, -hinge.y, -hinge.z);
        pivots.rudder.add(meshes.RearNavLight);
    }
    const gear = buildGear(meshes, scene);
    PARTS.set(root, { propeller, pivots, gear });
    root.scale.setScalar(AIRCRAFT_SCALE);   // après les pivots (calculés dans le repère du modèle)
    root.userData = { registration: 'F-HESM', liveryColor: null, textureSize: 2048 };
    return root;
}

// Jonction dérive / gouverne de direction : dans le modèle, les chants des deux pièces (bord d'attaque de la gouverne,
// bord de fuite de la dérive, découpe de la corne d'équilibrage) sont des faces plates grises, bien visibles dès que la
// gouverne braque. Chaque chant reçoit un demi-cylindre bombé vers l'autre pièce (caché dedans au neutre), peint comme
// la peau voisine. offset : position du pivot de la gouverne (ses sommets sont relatifs à la charnière)
function roundJunction(rudder, offset, fin) {
    const points = (mesh, shift) => {
        const p = mesh.geometry.attributes.position, list = [];
        for (let i = 0; i < p.count; i++) list.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)).add(shift));
        return list;
    };
    const rudderPoints = points(rudder, offset), finPoints = points(fin, new Vector3());
    roundEdges(rudder, (p) => finPoints.some((q) => q.distanceToSquared(p) < 2.25e-4), offset);
    roundEdges(fin, (p) => rudderPoints.some((q) => q.distanceToSquared(p) < 2.25e-4), new Vector3());
}

const EDGE_STEPS = 8;
const EDGE_BULGE = 0.8;     // profondeur du bombé / demi-épaisseur

// Chants (faces dont la normale est presque dans le plan de symétrie, qui traversent l'épaisseur) dont tous les sommets
// vérifient near : chacun reçoit un demi-cylindre elliptique bombé vers l'extérieur
function roundEdges(mesh, near, shift) {
    const old = mesh.geometry, position = old.attributes.position, normal = old.attributes.normal, uv = old.attributes.uv;
    if (old.index || !normal || !uv || Object.keys(old.attributes).length !== 3) return;
    const key = (i) => `${Math.round(position.getY(i) * 1000)} ${Math.round(position.getZ(i) * 1000)}`;
    const p = new Vector3(), q = new Vector3(), r = new Vector3(), n = new Vector3();
    const segments = new Map();
    for (let t = 0; t < position.count; t += 3) {
        p.fromBufferAttribute(position, t); q.fromBufferAttribute(position, t + 1); r.fromBufferAttribute(position, t + 2);
        const face = q.clone().sub(p).cross(r.clone().sub(p)).normalize();
        if (Math.abs(face.x) > 0.3) continue;
        if (![p, q, r].every((v) => near(v.clone().add(shift)))) continue;
        const keys = [...new Set([t, t + 1, t + 2].map(key))];
        if (keys.length !== 2) continue;
        keys.sort();
        const id = keys.join('|');
        const s = segments.get(id) ?? { ends: keys.map(() => ({ y: 0, z: 0, half: 0 })), normal: new Vector3() };
        for (let i = t; i < t + 3; i++) {
            const end = s.ends[keys.indexOf(key(i))];
            end.y = position.getY(i); end.z = position.getZ(i);
            end.half = Math.max(end.half, Math.abs(position.getX(i)));
            s.normal.add(n.fromBufferAttribute(normal, i));
        }
        segments.set(id, s);
    }
    if (!segments.size) return;
    // Peinture : celle du sommet de peau (face latérale) le plus proche
    const skin = [];
    for (let i = 0; i < position.count; i++) if (Math.abs(normal.getX(i)) > 0.7) skin.push(i);
    const out = { position: [...position.array], normal: [...normal.array], uv: [...uv.array] };
    for (const { ends, normal: dir } of segments.values()) {
        dir.x = 0;
        if (dir.lengthSq() < 1e-8 || ends.some((e) => e.half < 0.003)) continue;
        dir.normalize();
        const middle = new Vector3(0, (ends[0].y + ends[1].y) / 2, (ends[0].z + ends[1].z) / 2);
        let nearest = skin[0], best = Infinity;
        for (const i of skin) {
            const d = p.fromBufferAttribute(position, i).distanceToSquared(middle);
            if (d < best) { best = d; nearest = i; }
        }
        const u = uv.getX(nearest), v = uv.getY(nearest);
        const ring = ends.map((e) => Array.from({ length: EDGE_STEPS + 1 }, (_, k) => {
            const phi = Math.PI * k / EDGE_STEPS, c = Math.cos(phi), s = Math.sin(phi);
            return {
                p: new Vector3(e.half * c, e.y, e.z).addScaledVector(dir, e.half * EDGE_BULGE * s),
                n: new Vector3(c, 0, 0).addScaledVector(dir, s / EDGE_BULGE).normalize(),
            };
        }));
        const push = (a, b, c) => {
            // Ordre des sommets : face avant vers l'extérieur
            const facing = b.p.clone().sub(a.p).cross(c.p.clone().sub(a.p)).dot(a.n.clone().add(b.n).add(c.n)) < 0;
            for (const vertex of facing ? [a, c, b] : [a, b, c]) {
                out.position.push(vertex.p.x, vertex.p.y, vertex.p.z);
                out.normal.push(vertex.n.x, vertex.n.y, vertex.n.z);
                out.uv.push(u, v);
            }
        };
        for (let k = 0; k < EDGE_STEPS; k++) {
            push(ring[0][k], ring[1][k], ring[0][k + 1]);
            push(ring[0][k + 1], ring[1][k], ring[1][k + 1]);
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(out.position, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(out.normal, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(out.uv, 2));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
}

// Nervures d'emplanture : coupe de l'aile (partie centrale et bord d'attaque) au ras du fuselage, de chaque côté,
// remplie : même profil bombé que l'aile, blanc comme elle, visible des deux faces
const WING_ROOT_X = 0.52;
const WING_ROOT_BACK = -2.12;   // bord avant des portes (repère avion, avant agrandissement)
function closeWingRoot(meshes, scene) {
    const parts = ['wing_center', 'wing_leading_edge_center'].map((name) => meshes[name]).filter(Boolean);
    if (!parts.length) return;
    scene.updateMatrixWorld(true);
    const material = ambient(new MeshStandardMaterial({ color: 0xe2e3e5, roughness: 0.6, metalness: 0.05, emissive: 0x2e2f30, side: DoubleSide }));
    const toScene = scene.matrixWorld.clone().invert();
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (const side of [-1, 1]) {
        const x0 = side * WING_ROOT_X;
        // Segments de la coupe (z, y)
        const segments = [];
        for (const mesh of parts) {
            const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
            const count = index ? index.count : position.count;
            const at = (k, v) => v.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld);
            for (let k = 0; k < count; k += 3) {
                const tri = [at(k, a), at(k + 1, b), at(k + 2, c)];
                const points = [];
                for (let j = 0; j < 3; j++) {
                    const p = tri[j], q = tri[(j + 1) % 3];
                    if ((p.x - x0) * (q.x - x0) < 0) {
                        const t = (x0 - p.x) / (q.x - p.x);
                        points.push([p.z + (q.z - p.z) * t, p.y + (q.y - p.y) * t]);
                    }
                }
                if (points.length === 2) segments.push(points);
            }
        }
        if (!segments.length) continue;
        // Profil : extrados et intrados tous les centimètres de corde, du bord d'attaque jusqu'aux portes (plus en
        // arrière, l'aile est au-dessus du toit de la cabine : la nervure dépassait dans l'habitacle)
        const zs = segments.flat().map(([z]) => z);
        const z0 = Math.min(...zs), z1 = Math.min(Math.max(...zs), WING_ROOT_BACK), top = [], bottom = [];
        for (let z = z0; z <= z1 + 1e-6; z += 0.01) {
            const ys = [];
            for (const [[za, ya], [zb, yb]] of segments) {
                if ((za - z) * (zb - z) <= 0 && za !== zb) ys.push(ya + (yb - ya) * (z - za) / (zb - za));
            }
            if (ys.length < 2) continue;
            top.push([z, Math.max(...ys)]);
            bottom.push([z, Math.min(...ys)]);
        }
        if (top.length < 3) continue;
        const shape = new Shape();
        [...top, ...bottom.reverse()].forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
        const geometry = new ShapeGeometry(shape);
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
            a.set(x0, position.getY(i), position.getX(i)).applyMatrix4(toScene);
            position.setXYZ(i, a.x, a.y, a.z);
        }
        geometry.computeVertexNormals();
        const rib = new Mesh(geometry, material);
        rib.name = 'wingroot';
        rib.castShadow = rib.receiveShadow = true;
        scene.add(rib);
    }
}

// Train d'atterrissage animé (repère du modèle ; la géométrie des pièces est dans ce repère, comme pour les gouvernes) :
// - roulette de nez orientable : jambe, axe, carénage et roue tournent autour de l'axe de la jambe (inclinée vers l'avant)
// - roues qui roulent : roulette (dans la partie orientable) et roues principales, chacune autour de son axe (x)
// Rend { steer (axe : userData.axis), spins: [roues], radius (m, avant agrandissement) }, ou null
function buildGear(meshes, scene) {
    const strut = meshes.NoseWheelStrut, wheel = meshes.NoseWheel;
    if (!strut || !wheel) return null;
    // Axe de la jambe : centre de ses sommets du haut et du bas
    const p = strut.geometry.attributes.position;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.count; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); }
    const top = new Vector3(), bottom = new Vector3();
    let nTop = 0, nBottom = 0;
    for (let i = 0; i < p.count; i++) {
        const v = new Vector3(p.getX(i), p.getY(i), p.getZ(i));
        if (v.y > maxY - 0.04) { top.add(v); nTop++; }
        if (v.y < minY + 0.04) { bottom.add(v); nBottom++; }
    }
    top.divideScalar(nTop);
    bottom.divideScalar(nBottom);
    const steer = new Group();
    steer.name = 'noseSteer';
    steer.position.copy(bottom);
    steer.userData.axis = top.clone().sub(bottom).normalize();
    for (const mesh of [strut, meshes.Axle, meshes.fairing1].filter(Boolean)) {
        mesh.geometry.translate(-bottom.x, -bottom.y, -bottom.z);
        steer.add(mesh);
    }
    scene.add(steer);
    // Roue autour de son centre ; dans la partie orientable pour la roulette
    const spinner = (mesh, parent, origin) => {
        mesh.geometry.computeBoundingBox();
        const center = mesh.geometry.boundingBox.getCenter(new Vector3());
        mesh.geometry.translate(-center.x, -center.y, -center.z);
        const group = new Group();
        group.position.copy(center).sub(origin);
        group.add(mesh);
        parent.add(group);
        return group;
    };
    const spins = [spinner(wheel, steer, bottom)];
    for (const name of ['LeftWheel', 'RightWheel']) if (meshes[name]) spins.push(spinner(meshes[name], scene, new Vector3()));
    wheel.geometry.computeBoundingBox();
    const radius = (wheel.geometry.boundingBox.max.y - wheel.geometry.boundingBox.min.y) / 2;
    return { steer, spins, radius };
}

// Pièces mobiles d'un avion : { propeller, pivots (gouvernes), gear (train) }
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
    // Pare-feu derrière le tableau (pas de ciel de toit rapporté : le toit est l'envers de la carlingue, voir
    // buildCabinShell ; une plaque plate traversait l'aile ou barrait le pare-brise)
    const firewall = new Mesh(new PlaneGeometry(1.0, 0.8), dark);
    firewall.position.set(0, FLOOR_Y + 0.4, -2.9);
    group.add(firewall);
    // Moquette
    const carpet = new Mesh(new BoxGeometry(0.94, 0.02, 2.0), new MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }));
    carpet.position.set(0, FLOOR_Y + 0.01, -1.75);
    group.add(carpet);
    // Sièges avant (tissu gris bleuté, cuir beige, appui-tête), banquette arrière
    // Dossiers à la hauteur du toit, qui descend vers l'arrière : appuis-tête juste dessous. Banquette à la mesure du
    // fuselage, qui se resserre et s'abaisse vers l'arrière (plus en arrière, plus large ou plus haute, elle traversait
    // les flancs et le toit) : ~2,5 cm de marge partout
    for (const x of [-0.23, 0.23]) group.add(seat(x, SEAT_Z, FLOOR_Y + 0.27, false, 0.92));
    group.add(seat(0, SEAT_Z + 0.65, FLOOR_Y + 0.25, true, 0.75, 0.9));
    for (const side of [-1, 1]) {
        // Accoudoir de porte
        const arm = new Mesh(new RoundedBoxGeometry(0.05, 0.05, 0.45, 3, 0.02), tan);
        arm.position.set(side * 0.46, FLOOR_Y + 0.5, SEAT_Z + 0.05);
        group.add(arm);
        // Harnais : du toit derrière le siège vers la boucle
        const top = new Vector3(side * 0.43, 1.1, SEAT_Z + 0.2), bottom = new Vector3(side * 0.1, FLOOR_Y + 0.3, SEAT_Z + 0.07);
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
            pedal.userData.plate = plate;   // freins sur le haut des palonniers : la plaque bascule vers l'avant
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

// Siège : assise, dossier incliné, appui-tête ; liserés et joues en cuir beige ; bench : banquette à deux places ;
// backHeight : hauteur relative du dossier ; width : largeur de la banquette
function seat(x, z, height, bench, backHeight = 1, width = bench ? 0.98 : 0.46) {
    const g = new Group();
    g.position.set(x, 0, z);
    const leather = ambient(new MeshStandardMaterial({ color: 0xb59b74, roughness: 0.6, emissive: 0x2e2719 }));
    const cushion = new Mesh(new RoundedBoxGeometry(width, 0.11, 0.48, 4, 0.04), fabric());
    cushion.position.set(0, height, 0);
    const base = new Mesh(new RoundedBoxGeometry(width + 0.02, 0.06, 0.5, 3, 0.02), leather);
    base.position.set(0, height - 0.075, 0);
    g.add(cushion, base);
    // Dossier(s) et appuis-tête
    const backWidth = bench ? width / 2 - 0.02 : 0.47;   // coque d'un dossier
    for (const dx of bench ? [-width / 4, width / 4] : [0]) {
        const back = new Group();
        back.position.set(dx, height + 0.04, 0.25);
        // Dossier incliné vers l'arrière (~13°) : nez vers -z, donc un angle positif pousse le haut du dossier vers +z
        back.rotation.x = 0.22;
        back.scale.y = backHeight;
        const pad = new Mesh(new RoundedBoxGeometry(backWidth - 0.03, 0.6, 0.1, 4, 0.04), fabric());
        pad.position.y = 0.3;
        const shell = new Mesh(new RoundedBoxGeometry(backWidth, 0.62, 0.06, 3, 0.025), leather);
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

export { loadAircraft, aircraftParts, buildCabin, buildCabinShell, setRegistration, setLiveryColor, setDaylight, ambient, GROUND_Y, CABIN_ORIGIN, AIRCRAFT_SCALE };
