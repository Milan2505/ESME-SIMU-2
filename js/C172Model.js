import {
    BackSide,
    Box3,
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    Float32BufferAttribute,
    FrontSide,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    Raycaster,
    Quaternion,
    RepeatWrapping,
    Shape,
    ShapeGeometry,
    SphereGeometry,
    SRGBColorSpace,
    TorusGeometry,
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
            a = frontmost((p) => Math.abs(p[span] - middle) < 0.15 * half).clone();
            // Charnière à mi-épaisseur du bord d'attaque (la gouverne braque autour de son milieu, sans déborder d'un côté)
            const edge = points.filter((p) => Math.abs(p[span] - a[span]) < 0.05 && p.z < a.z + 0.05).map((p) => p.y);
            a.y = (Math.min(...edge) + Math.max(...edge)) / 2;
            axis = fixedAxis.clone();
        } else {
            const end = 0.1 * (hi - lo);
            a = frontmost((p) => p[span] < lo + end);
            const b = frontmost((p) => p[span] > hi - end);
            // Gouverne de direction (symétrique) : charnière dans le plan de symétrie, pour qu'elle braque autant des deux côtés
            // sans sortir de la dérive
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
    if (pivots.rudder && fin) paintJunction(fin, [{ mesh: meshes.rudder_1, offset: pivots.rudder.position }], 'x');
    // Bas de la gouverne de direction, sous la dérive (derrière le cône de queue, sans pièce voisine) : chant repeint aussi
    if (pivots.rudder) paintEdges(meshes.rudder_1, (p) => p.y < -0.385 && p.z < 5, pivots.rudder.position, 'x');
    if (pivots.elevator && meshes.hstab) {
        const offset = pivots.elevator.position;
        paintJunction(meshes.hstab, ['elevatorleft', 'elevatorright'].filter((n) => meshes[n]).map((n) => ({ mesh: meshes[n], offset })), 'y');
    }
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
        // Jonction compensateur / gouverne de profondeur droite repeinte comme les autres (sommets du compensateur
        // relatifs à sa charnière, elle-même dans le repère de la gouverne)
        if (meshes.elevatorright) {
            const elevator = pivots.elevator.position;
            paintJunction(meshes.elevatorright, [{ mesh: tab, offset: elevator.clone().add(hinge) }], 'y', elevator);
        }
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

// Jonctions entre une partie fixe et sa gouverne (dérive / direction, plan fixe / profondeur, compensateur) : dans le
// modèle, les chants des pièces (bord d'attaque de la gouverne, bord de fuite du plan fixe, découpes des cornes
// d'équilibrage) sont peints en gris foncé, bien visibles dès que la gouverne braque. Ils sont repeints comme la peau
// voisine (même blanc, mêmes bandes), sans toucher à la forme. (Un arrondi calculé, essayé avant, déformait les pièces :
// le modèle n'a pas assez de sommets pour être courbé proprement.) thickness : axe de l'épaisseur ('x' pour la dérive,
// 'y' pour le plan horizontal). moving : [{ mesh, offset }] (offset : position du pivot, les sommets d'une gouverne
// sont relatifs à sa charnière) ; fixedOffset : idem pour la partie fixe
function paintJunction(fixed, moving, thickness, fixedOffset = new Vector3()) {
    const points = (mesh, shift) => {
        const p = mesh.geometry.attributes.position, list = [];
        for (let i = 0; i < p.count; i++) list.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)).add(shift));
        return list;
    };
    const near = (list) => (p) => list.some((q) => q.distanceToSquared(p) < 2.25e-4);
    const fixedPoints = points(fixed, fixedOffset);
    const movingPoints = moving.flatMap(({ mesh, offset }) => points(mesh, offset));
    for (const { mesh, offset } of moving) paintEdges(mesh, near(fixedPoints), offset, thickness);
    paintEdges(fixed, near(movingPoints), fixedOffset, thickness);
}

// Chants (faces qui traversent l'épaisseur : normale presque perpendiculaire à l'axe thickness) dont tous les sommets
// vérifient near : chaque triangle prend la peinture (coordonnées de texture) du sommet de peau le plus proche
function paintEdges(mesh, near, shift, thickness) {
    const geometry = mesh.geometry, position = geometry.attributes.position, normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    if (geometry.index || !normal || !uv) return;
    const axis = ['x', 'y', 'z'].indexOf(thickness);
    const skin = [];
    for (let i = 0; i < position.count; i++) if (Math.abs(normal.getComponent(i, axis)) > 0.7) skin.push(i);
    if (!skin.length) return;
    const p = new Vector3(), q = new Vector3(), r = new Vector3(), v = new Vector3();
    for (let t = 0; t < position.count; t += 3) {
        p.fromBufferAttribute(position, t); q.fromBufferAttribute(position, t + 1); r.fromBufferAttribute(position, t + 2);
        const face = q.clone().sub(p).cross(r.clone().sub(p)).normalize();
        if (Math.abs(face.getComponent(axis)) > 0.3) continue;
        if (![p, q, r].every((point) => near(point.clone().add(shift)))) continue;
        const middle = p.clone().add(q).add(r).divideScalar(3);
        let nearest = skin[0], best = Infinity;
        for (const i of skin) {
            const d = v.fromBufferAttribute(position, i).distanceToSquared(middle);
            if (d < best) { best = d; nearest = i; }
        }
        for (let i = t; i < t + 3; i++) uv.setXY(i, uv.getX(nearest), uv.getY(nearest));
    }
    uv.needsUpdate = true;
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
    model.updateMatrixWorld(true);
    const inverse = model.matrixWorld.clone().invert();
    hideWingInCabin(model, inverse);
    const roofLine = cabinRoofLine(model, inverse);
    for (const name of ['fuselage', 'leftdoor', 'rightdoor', 'windowframeleftext', 'windowframerightext', 'baggagedoorexterior', 'fuselage_cowling_top']) {
        const source = model.getObjectByName(name);
        if (!source) continue;
        const inner = new Mesh(source.geometry);
        inner.applyMatrix4(inverse.clone().multiply(source.matrixWorld));
        inner.material = cabinTrim(inner.matrix, BackSide, roofLine);
        inner.receiveShadow = true;
        group.add(inner);
    }
    // Vitre et carlingue en repère cabine : le pare-soleil rabattu ne doit pas les traverser
    const surfaces = ['glas', 'fuselage'].map((name) => model.getObjectByName(name)).filter((mesh) => mesh?.isMesh).map((mesh) => {
        const copy = new Mesh(mesh.geometry, new MeshBasicMaterial({ side: DoubleSide }));
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(inverse.clone().multiply(mesh.matrixWorld));
        copy.matrixWorld.copy(copy.matrix);
        return copy;
    });
    group.add(sunVisors(roofLine, surfaces));
    group.add(wingRootVents(model, inverse, roofLine));
    const glass = model.getObjectByName('glas'), roof = model.getObjectByName('fuselage');
    if (glass?.isMesh && roof?.isMesh) {
        group.add(windshieldSeal({ mesh: glass, toCabin: inverse.clone().multiply(glass.matrixWorld) },
            { mesh: roof, toCabin: inverse.clone().multiply(roof.matrixWorld) }));
    }
    return group;
}

// Aile et volets traversent la cabine (une seule pièce d'un bout à l'autre, en grands triangles) et ressortaient à
// travers les garnitures (ligne claire le long des flancs). Leur face inférieure entre les flancs, sous le dessus du
// toit, cachée dans le fuselage vu de dehors, n'est pas dessinée (le dessus de l'aile, lui, sert de toit vu de dehors).
// Prise d'air de l'aile : pas dessinée quand la caméra est dans la cabine (l'emplanture y est habillée, voir
// wingRootVents). Matière propre à chaque pièce (comptée
// comme déjà copiée : la livrée ne change que son image, voir repaint)
const CABIN_HALF_WIDTH = 0.53, ROOF_TOP = 1.14;
const WING_CUTS = {
    wing_center: 'belowAndTop', flaps: 'below',
    wingventhole: 'fromCabin',
    wing_leading_edge_center: 'rootFromCabin',
};
function hideWingInCabin(model, inverse) {
    if (!ownMaterials.has(model)) ownMaterials.set(model, new Set());
    const own = ownMaterials.get(model);
    model.traverse((mesh) => {
        const cut = mesh.isMesh && WING_CUTS[mesh.name];
        if (!cut || mesh.userData.cabinCut) return;
        mesh.userData.cabinCut = true;
        if (!own.has(mesh.material)) {
            mesh.material = ambient(mesh.material.clone());
            own.add(mesh.material);
        }
        const toCabin = inverse.clone().multiply(mesh.matrixWorld);
        const test = {
            below: `abs(vCabinPos.x) < ${CABIN_HALF_WIDTH} && vCabinPos.y < ${ROOF_TOP} && vCabinDown > 0.3`,
            // + vu de la cabine, tout sauf le dessous (dessus et bord d'attaque, vus de profil : une lame au bord du
            // pare-brise ; de la cabine, on ne voit de l'aile que son dessous), et dessous du bord d'attaque devant le toit,
            // près du fuselage (vu en rasant dans les coins du pare-brise)
            belowAndTop: `(abs(vCabinPos.x) < ${CABIN_HALF_WIDTH} && vCabinPos.y < ${ROOF_TOP} && vCabinDown > 0.3)
                || (vCameraInCabin > 0.5 && (vCabinDown < 0.5 || (vCabinPos.z < -2.1 && abs(vCabinPos.x) < 1.6)))`,
            fromCabin: 'vCameraInCabin > 0.5',
            rootFromCabin: 'vCameraInCabin > 0.5 && abs(vCabinPos.x) < 1.3',   // près du fuselage seulement
        }[cut];
        mesh.material.customProgramCacheKey = () => `wingCabinCut:${cut}`;
        mesh.material.onBeforeCompile = (shader) => {
            shader.uniforms.uToCabin = { value: toCabin };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>
                    uniform mat4 uToCabin;
                    varying vec3 vCabinPos;
                    varying float vCabinDown;
                    varying float vCameraInCabin;`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    vCabinPos = (uToCabin * vec4(transformed, 1.0)).xyz;
                    vCabinDown = -normalize(mat3(uToCabin) * objectNormal).y;
                    vec3 cameraInCabin = (uToCabin * inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
                    vCameraInCabin = abs(cameraInCabin.x) < 0.55 && cameraInCabin.y > -0.1 && cameraInCabin.y < 1.2
                        && cameraInCabin.z > -2.9 && cameraInCabin.z < 0.3 ? 1.0 : 0.0;`);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
                    varying vec3 vCabinPos;
                    varying float vCabinDown;
                    varying float vCameraInCabin;`)
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                    if (${test}) discard;`);
        };
        mesh.material.needsUpdate = true;
    });
}

// Limite du ciel de toit : hauteur du toit (sommets de la carlingue près de l'axe) par tranches de ROOF_STEP en z,
// lissée, moins ROOF_DROP (le ciel de toit descend jusqu'au haut des portes). Une limite par la pente de chaque facette
// suivait les triangles du maillage, en zigzag
const ROOF_Z0 = -3.0, ROOF_STEP = 0.1, ROOF_SLICES = 40, ROOF_DROP = 0.14, ROOF_MIN_Y = 0.95;
function cabinRoofLine(model, inverse) {
    const top = new Array(ROOF_SLICES).fill(-Infinity);
    const v = new Vector3();
    for (const name of ['fuselage', 'leftdoor', 'rightdoor', 'baggagedoorexterior']) {
        const mesh = model.getObjectByName(name);
        if (!mesh?.isMesh) continue;
        const toCabin = inverse.clone().multiply(mesh.matrixWorld), position = mesh.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
            v.fromBufferAttribute(position, i).applyMatrix4(toCabin);
            if (Math.abs(v.x) > 0.45 || v.y < ROOF_MIN_Y) continue;   // toit seulement (pas le capot devant le pare-brise)
            const slice = Math.round((v.z - ROOF_Z0) / ROOF_STEP);
            if (slice >= 0 && slice < ROOF_SLICES) top[slice] = Math.max(top[slice], v.y);
        }
    }
    // Tranches sans sommet : la plus proche ; puis moyenne glissante
    const filled = top.map((y, i) => {
        if (y > -Infinity) return y;
        for (let d = 1; d < ROOF_SLICES; d++) {
            const near = [top[i - d], top[i + d]].filter((h) => h !== undefined && h > -Infinity);
            if (near.length) return Math.max(...near);
        }
        return 1.1;
    });
    return filled.map((_, i) => {
        const near = filled.slice(Math.max(0, i - 2), i + 3);
        return near.reduce((sum, h) => sum + h, 0) / near.length - ROOF_DROP;
    });
}

// Arêtes de bord d'une pièce (qui n'appartiennent qu'à un triangle, sommets soudés), en repère de la cabine :
// [{ a, b, third }] (third : troisième sommet du triangle, côté pièce)
function boundaryEdges(mesh, toCabin) {
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const points = [], ids = [], keys = new Map();
    for (let i = 0; i < position.count; i++) {
        const p = new Vector3().fromBufferAttribute(position, i).applyMatrix4(toCabin);
        const key = `${Math.round(p.x * 2000)} ${Math.round(p.y * 2000)} ${Math.round(p.z * 2000)}`;
        if (!keys.has(key)) {
            keys.set(key, points.length);
            points.push(p);
        }
        ids.push(keys.get(key));
    }
    const vertex = (k) => ids[index ? index.getX(k) : k];
    const edges = new Map();
    for (let t = 0; t < (index ? index.count : position.count); t += 3) {
        const [a, b, c] = [vertex(t), vertex(t + 1), vertex(t + 2)];
        for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) {
            const key = p < q ? `${p} ${q}` : `${q} ${p}`;
            const edge = edges.get(key);
            if (edge) edge.count++;
            else edges.set(key, { p, q, r, count: 1 });
        }
    }
    return [...edges.values()].filter((edge) => edge.count === 1)
        .map(({ p, q, r }) => ({ a: points[p], b: points[q], third: points[r] }));
}

// Moulure du pare-brise : bourrelet de plastique gris (comme les garnitures) le long du contour visible du pare-brise. Montants et bas : bord de la vitre (la même pièce contient la lunette arrière : seulement devant
// WINDSHIELD_MAX_Z). Haut : bord avant du toit de la carlingue (le haut de la vitre est caché derrière). Arêtes
// raccordées en un seul cordon, angles arrondis, section bombée. glass, roof : { mesh, toCabin }
const SEAL_WIDTH = 0.04, SEAL_BULGE = 0.012, WINDSHIELD_MAX_Z = -1.2, GLASS_TOP = 1.12;
// Dessus du tableau (prolongement de la casquette jusqu'au pied du pare-brise) : devant DASH_FRONT_Z, sous DASH_TOP
const DASH_FRONT_Z = -2.5, DASH_TOP = 0.92;
const SEAL_JOIN = 0.08;   // écart max entre deux bouts d'arête raccordés (montant de la vitre -> bord du toit)
function windshieldSeal(glass, roof) {
    // Arêtes : { a, b, normal (vers la cabine), inward (vers la vitre) }
    const segments = [];
    const dir = new Vector3(), toThird = new Vector3();
    // side : 1, la bande s'étend du côté de la pièce (vitre) ; -1, de l'autre (ouverture sous le toit)
    const addSegment = ({ a, b, third }, side) => {
        dir.subVectors(b, a);
        toThird.subVectors(third, a);
        const normal = new Vector3().crossVectors(dir, toThird).normalize();
        if (normal.dot(toThird.subVectors(CABIN_ORIGIN, a)) < 0) normal.negate();
        const inward = new Vector3().crossVectors(normal, dir).normalize();
        if (inward.dot(toThird.subVectors(third, a)) * side < 0) inward.negate();
        segments.push({ a, b, normal, inward });
    };
    for (let edge of boundaryEdges(glass.mesh, glass.toCabin)) {
        const { a, b } = edge;
        if (a.z > WINDSHIELD_MAX_Z || b.z > WINDSHIELD_MAX_Z || Math.min(a.y, b.y) > GLASS_TOP) continue;
        // Bas de la vitre : sous le dessus du tableau, qui glisse jusqu'au pied du pare-brise (pas de moulure)
        if (Math.max(a.y, b.y) < DASH_TOP && Math.min(a.z, b.z) < DASH_FRONT_Z) continue;
        // Haut des montants : coupé au bord du toit (au-dessus, caché), pour se raccorder au coin du toit
        const [low, high] = a.y < b.y ? [a, b] : [b, a];
        const roofY = GLASS_TOP - 0.02;
        if (high.y > roofY) edge = { ...edge, a: low, b: low.clone().lerp(high, (roofY - low.y) / (high.y - low.y)) };
        addSegment(edge, 1);
    }
    for (const edge of boundaryEdges(roof.mesh, roof.toCabin)) {
        const front = [edge.a, edge.b].every((p) => p.y > GLASS_TOP - 0.06 && p.z < -2.0 && p.z > -2.3
            && Math.abs(p.x) < CABIN_HALF_WIDTH);
        if (front) addSegment(edge, -1);
    }

    const group = new Group();
    const paths = chainSegments(segments).map(({ points, closed }) => ({ path: roundPath(roundPath(points, closed), closed), closed }));
    for (const { path, closed } of paths) group.add(sealCord(path, closed));
    return group;
}

// Emplanture de l'aile dans les coins hauts du pare-brise (profil d'aile contre le flanc, ses bords) : habillée du
// plastique des garnitures, comme une pièce moulée, et un aérateur orientable posé dessus, tourné vers les sièges
const WING_ROOT_PARTS = ['wingroot', 'wing_1Ledge', 'wing_1Redge'];
function wingRootVents(model, inverse, roofLine) {
    const group = new Group();
    const roots = [];
    model.traverse((source) => {
        if (!source.isMesh || !WING_ROOT_PARTS.includes(source.name)) return;
        const inner = new Mesh(source.geometry);
        inner.applyMatrix4(inverse.clone().multiply(source.matrixWorld));
        inner.material = cabinTrim(inner.matrix, DoubleSide, roofLine);
        Object.assign(inner.material, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        group.add(inner);
        if (source.name === 'wingroot') {
            roots.push(new Box3().setFromBufferAttribute(source.geometry.attributes.position).applyMatrix4(inner.matrix));
        }
    });
    const dark = new MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.55 });
    const black = new MeshBasicMaterial({ color: 0x050505 });
    for (const box of roots) {
        const center = box.getCenter(new Vector3()), side = Math.sign(center.x);
        // Collerette, rotule, buse et son trou ; axe vers les sièges (vers l'intérieur, vers l'arrière, un peu vers le bas)
        const vent = new Group();
        const collar = new Mesh(new TorusGeometry(0.022, 0.005, 10, 28), dark);
        const ball = new Mesh(new SphereGeometry(0.017, 20, 14), dark);
        const nozzle = new Mesh(new CylinderGeometry(0.009, 0.01, 0.02, 20, 1, true), dark);
        nozzle.rotation.x = Math.PI / 2;
        nozzle.position.z = 0.015;
        const hole = new Mesh(new CircleGeometry(0.0075, 20), black);
        hole.position.z = 0.0225;
        vent.add(collar, ball, nozzle, hole);
        vent.position.set(center.x - side * 0.012, center.y - 0.01, center.z + 0.02);
        vent.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(-side, -0.3, 0.6).normalize());
        group.add(vent);
    }
    return group;
}

// Pare-soleil : volet fin sous le toit devant chaque siège, sur son rail (repère de la cabine). Rabattu, il pivote
// vers l'avant jusqu'à presque se plaquer sous le pare-brise : angle cherché sur la vraie vitre (et le toit), le
// volet reste partout à SUN_VISOR_GAP sous elle, sans la traverser. surfaces : pièces de l'avion en repère cabine
const SUN_VISOR_UP = 0.12;                   // rotation de la charnière relevée contre le toit (rad)
const SUN_VISOR = { width: 0.34, length: 0.15, thickness: 0.005 }, SUN_VISOR_GAP = 0.012;
function sunVisors(roofLine, surfaces) {
    const group = new Group();
    const material = new MeshStandardMaterial({ color: 0x45484e, roughness: 0.7 });
    const rail = new MeshStandardMaterial({ color: 0x17181b, roughness: 0.5 });
    const z = -2.0, roofY = roofLine[Math.round((z - ROOF_Z0) / ROOF_STEP)] + ROOF_DROP;
    const raycaster = new Raycaster(), up = new Vector3(0, 1, 0), point = new Vector3();
    [-0.24, 0.24].forEach((x, i) => {
        // Volet sur sa charnière (bord avant, le long du rail) : rabattu d'un clic (voir Cockpit)
        const hinge = new Group();
        hinge.position.set(x, roofY - 0.024, z - 0.065);   // au bord avant du toit, contre la moulure du pare-brise
        hinge.rotation.x = SUN_VISOR_UP;
        hinge.userData.control = `visor:${i}`;
        const visor = new Mesh(new RoundedBoxGeometry(SUN_VISOR.width, SUN_VISOR.thickness, SUN_VISOR.length, 2, 0.002), material);
        visor.position.z = SUN_VISOR.length / 2 + 0.003;
        hinge.add(visor);
        // Angle rabattu : de la verticale vers l'avant (et au-delà de l'horizontale si la vitre remonte), tant que
        // tout le volet reste SUN_VISOR_GAP sous la vitre
        let down = Math.PI / 2;
        for (let angle = Math.PI / 2; angle < Math.PI * 1.15; angle += 0.01) {   // jusqu'au-delà de l'horizontale
            let clear = true;
            for (const u of [-0.48, 0, 0.48]) {
                for (const d of [0.04, 0.09, SUN_VISOR.length + 0.003]) {
                    point.set(x + u * SUN_VISOR.width, hinge.position.y - d * Math.sin(angle) + SUN_VISOR.thickness,
                        hinge.position.z + d * Math.cos(angle));
                    raycaster.set(point, up);
                    const hit = raycaster.intersectObjects(surfaces, false)[0];
                    if (hit && hit.distance < SUN_VISOR_GAP) clear = false;
                }
            }
            if (!clear) break;
            down = angle;
        }
        hinge.userData.downAngle = down;
        const track = new Mesh(new RoundedBoxGeometry(0.4, 0.012, 0.025, 2, 0.004), rail);
        track.position.set(x, roofY - 0.018, z - 0.04);
        const knob = new Mesh(new CylinderGeometry(0.007, 0.007, 0.012, 12), new MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 }));
        knob.position.set(x - 0.12, roofY - 0.028, z - 0.04);
        group.add(hinge, track, knob);
    });
    return group;
}

// Arêtes raccordées bout à bout (au plus SEAL_JOIN d'écart) : [{ points: [{ p, normal, inward }], closed }]
function chainSegments(segments) {
    const unused = new Set(segments), paths = [];
    const point = (p, segment) => ({ p, normal: segment.normal, inward: segment.inward });
    while (unused.size) {
        const first = unused.values().next().value;
        unused.delete(first);
        const points = [point(first.a, first), point(first.b, first)];
        for (const atEnd of [true, false]) {
            for (;;) {
                const tip = atEnd ? points[points.length - 1].p : points[0].p;
                let best = null, bestDistance = SEAL_JOIN, far = null;
                for (const segment of unused) {
                    for (const [near, other] of [[segment.a, segment.b], [segment.b, segment.a]]) {
                        const distance = near.distanceTo(tip);
                        if (distance < bestDistance) [best, bestDistance, far] = [segment, distance, other];
                    }
                }
                if (!best) break;
                unused.delete(best);
                if (atEnd) points.push(point(far, best));
                else points.unshift(point(far, best));
            }
        }
        const closed = points.length > 3 && points[0].p.distanceTo(points[points.length - 1].p) < SEAL_JOIN;
        if (closed) points.pop();
        paths.push({ points, closed });
    }
    return paths;
}

// Une passe de Chaikin : chaque angle coupé aux quarts, le cordon s'arrondit (bouts d'un cordon ouvert gardés)
function roundPath(points, closed) {
    const mix = (u, v, t) => ({
        p: u.p.clone().lerp(v.p, t),
        normal: u.normal.clone().lerp(v.normal, t).normalize(),
        inward: u.inward.clone().lerp(v.inward, t).normalize(),
    });
    const result = closed ? [] : [points[0]];
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
        const u = points[i], v = points[(i + 1) % points.length];
        result.push(mix(u, v, 0.25), mix(u, v, 0.75));
    }
    if (!closed) result.push(points[points.length - 1]);
    return result;
}

// Cordon bombé le long du chemin : 7 sommets en travers (de 0,6 largeur côté cadre, qui couvre le jour entre la
// garniture et la vitre, à la largeur entière côté vitre),
// soulevés vers la cabine en arc ; normales lissées
function sealCord(path, closed) {
    const ACROSS = 7, positions = [], index = [];
    for (const { p, normal, inward } of path) {
        for (let k = 0; k < ACROSS; k++) {
            const u = k / (ACROSS - 1);
            const lift = 0.003 + SEAL_BULGE * Math.sin(Math.PI * u);
            positions.push(...p.clone().addScaledVector(inward, SEAL_WIDTH * (u * 1.6 - 0.6)).addScaledVector(normal, lift).toArray());
        }
    }
    const rows = path.length, links = closed ? rows : rows - 1;
    for (let i = 0; i < links; i++) {
        const r0 = i * ACROSS, r1 = ((i + 1) % rows) * ACROSS;
        for (let k = 0; k < ACROSS - 1; k++) index.push(r0 + k, r1 + k, r1 + k + 1, r0 + k, r1 + k + 1, r0 + k + 1);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return new Mesh(geometry, SEAL_MATERIAL);
}
const SEAL_MATERIAL = ambient(new MeshStandardMaterial({ color: 0xc4c7cc, roughness: 0.8, side: DoubleSide, emissive: 0x3c3e42 }));

// Garnitures dessinées dans le shader, en coordonnées de la cabine (la peau de l'avion n'a pas de coordonnées de
// texture pour l'intérieur) : plastique moulé gris clair à grain fin, ciel de toit compris ; bas de porte gris
// anthracite sous un liseré à hauteur d'accoudoir.
// toCabin : repère de la pièce -> repère de la cabine (une matière par pièce, un seul programme pour toutes)
const CABIN_AXIS_Y = 0.45;   // hauteur de l'axe de la cabine, vers lequel la garniture est éclairée
const TRIM_COLORS = {
    headliner: new Color(0xc9ccd1), seam: new Color(0x9a9ea5), panel: new Color(0xbfc2c8), kick: new Color(0x3a3d43),
};
function cabinTrim(toCabin, side = BackSide, roofLine = new Array(ROOF_SLICES).fill(1.0)) {
    const material = ambient(new MeshStandardMaterial({ roughness: 0.85, side, emissive: 0x4f4f4f }));
    material.customProgramCacheKey = () => 'cabinTrim';
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
            uToCabin: { value: toCabin },
            uHeadliner: { value: TRIM_COLORS.headliner }, uSeam: { value: TRIM_COLORS.seam },
            uPanel: { value: TRIM_COLORS.panel }, uKick: { value: TRIM_COLORS.kick },
            uBeltY: { value: FLOOR_Y + 0.5 },
            uRoofLine: { value: roofLine },
        });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                uniform mat4 uToCabin;
                varying vec3 vCabinPos;
                varying vec3 vCabinNormal;
                varying vec3 vSmoothNormal;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vCabinPos = (uToCabin * vec4(transformed, 1.0)).xyz;
                vCabinNormal = mat3(uToCabin) * objectNormal;
                // Normale d'éclairage lisse, vers l'axe de la cabine (voir normal_fragment_maps)
                vec3 inward = vec3(-vCabinPos.x, ${CABIN_AXIS_Y.toFixed(2)} - vCabinPos.y, 0.0);
                vSmoothNormal = normalize(normalMatrix * (transpose(mat3(uToCabin)) * inward));`);
        shader.fragmentShader = shader.fragmentShader
            // Éclairage par cette normale lisse : vue de l'intérieur, la peau de l'avion a des facettes et des
            // triangles repliés à l'envers le long des jointures (traits clairs) ; la garniture, elle, est uniforme
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                normal = normalize(vSmoothNormal);`)
            .replace('#include <common>', `#include <common>
                uniform vec3 uHeadliner, uSeam, uPanel, uKick;
                uniform float uBeltY;
                const float DASH_FRONT_Z = ${DASH_FRONT_Z.toFixed(2)}, DASH_TOP = ${DASH_TOP.toFixed(2)};
                varying vec3 vSmoothNormal;
                uniform float uRoofLine[${ROOF_SLICES}];
                float roofLineAt(float z) {
                    float f = clamp((z - ${ROOF_Z0.toFixed(2)}) / ${ROOF_STEP.toFixed(2)}, 0.0, ${(ROOF_SLICES - 1).toFixed(1)} - 0.001);
                    int i = int(floor(f));
                    float a = 0.0, b = 0.0;
                    for (int k = 0; k < ${ROOF_SLICES}; k++) {   // (pas d'indice variable dans un tableau d'uniformes)
                        if (k == i) a = uRoofLine[k];
                        if (k == i + 1) b = uRoofLine[k];
                    }
                    return mix(a, b, fract(f));
                }
                varying vec3 vCabinPos;
                varying vec3 vCabinNormal;
                float trimHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float trimNoise(vec2 p) {
                    vec2 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(trimHash(i), trimHash(i + vec2(1.0, 0.0)), f.x),
                        mix(trimHash(i + vec2(0.0, 1.0)), trimHash(i + vec2(1.0, 1.0)), f.x), f.y);
                }`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                vec3 cp = vCabinPos;
                vec3 cn = normalize(vCabinNormal);   // normale de la peau, vers l'extérieur
                // Motifs projetés sur le plan le plus face à la paroi (x, y ou z) : sinon étirés en rayures sur les
                // parois tournées vers l'avant ou l'arrière
                vec3 an = abs(cn);
                vec2 gp = an.x >= an.y && an.x >= an.z ? cp.zy : (an.y >= an.z ? cp.xz : cp.xy);
                // Flancs : grain du vinyle, bas de porte foncé, liseré
                float grain = 0.6 * trimNoise(gp * 140.0) + 0.4 * trimNoise(gp * 30.0);
                vec3 panel = mix(uKick, uPanel, smoothstep(uBeltY - 0.01, uBeltY + 0.01, cp.y));
                float belt = 1.0 - smoothstep(0.004, 0.009, abs(cp.y - uBeltY - 0.015));
                panel = mix(panel, uSeam, belt * 0.5) * (0.95 + 0.08 * grain);
                // Ciel de toit : même plastique moulé, très légèrement grainé
                vec3 head = uHeadliner;
                head *= 0.97 + 0.06 * grain;
                // Bord du ciel de toit : limite nette (lissée sur un pixel), soulignée d'un jonc foncé
                float roofSide = cp.y - roofLineAt(cp.z), roofPx = max(fwidth(roofSide), 1e-4);
                float roof = smoothstep(-roofPx, roofPx, roofSide);
                vec3 trimColor = mix(panel, head, roof);
                trimColor = mix(trimColor, uSeam * 0.8, 1.0 - smoothstep(roofPx * 1.5, roofPx * 3.0, abs(roofSide)));
                // Dessus du tableau, devant la casquette jusqu'au pied du pare-brise : noir mat comme la casquette
                float dash = (1.0 - smoothstep(DASH_FRONT_Z - 0.01, DASH_FRONT_Z + 0.01, cp.z))
                    * (1.0 - smoothstep(DASH_TOP - 0.01, DASH_TOP + 0.01, cp.y)) * smoothstep(0.3, 0.5, cn.y);
                trimColor = mix(trimColor, vec3(0.06), dash);
                diffuseColor.rgb = trimColor;
                totalEmissiveRadiance *= trimColor;`);
    };
    return material;
}

function buildCabin() {
    const group = new Group();
    const tan = ambient(new MeshStandardMaterial({ color: 0xaeb2b8, roughness: 0.75, emissive: 0x2c2e31 }));   // accoudoirs, gris des garnitures
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
    // Sièges avant (tissu gris bleuté, cuir gris, appui-tête), banquette arrière
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
        const strap = new Mesh(new BoxGeometry(0.045, top.distanceTo(bottom), 0.005), new MeshStandardMaterial({ color: 0x5a5d63, roughness: 0.9 }));
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

// Siège : assise, dossier incliné, appui-tête ; liserés et joues en cuir gris ; bench : banquette à deux places ;
// backHeight : hauteur relative du dossier ; width : largeur de la banquette
function seat(x, z, height, bench, backHeight = 1, width = bench ? 0.98 : 0.46) {
    const g = new Group();
    g.position.set(x, 0, z);
    const leather = ambient(new MeshStandardMaterial({ color: 0x9a9ea5, roughness: 0.6, emissive: 0x26282b }));
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

export { loadAircraft, aircraftParts, buildCabin, buildCabinShell, setRegistration, setLiveryColor, setDaylight, ambient, GROUND_Y, CABIN_ORIGIN, AIRCRAFT_SCALE, SUN_VISOR_UP };
