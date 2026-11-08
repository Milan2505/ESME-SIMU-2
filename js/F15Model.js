import {
    AdditiveBlending,
    BackSide,
    Box3,
    Color,
    ConeGeometry,
    DoubleSide,
    FrontSide,
    Group,
    MathUtils,
    Mesh,
    ShaderMaterial,
    SRGBColorSpace,
    TextureLoader,
    Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeStatic } from './MergeStatic.js';
import { isTablet } from './Device.js';

// F-15C Eagle du projet FlightGear (Richard Harrison ; modèle extérieur d'Enrique Laso « flying_toaster », cockpit
// photo de geneb ; licence GPL-2.0), converti par asset/blender/build_f15.py : asset/f15/f15.glb (extérieur),
// asset/f15/f15-cockpit.glb (cockpit, voir F15Cockpit.js), asset/f15/liveries/ (livrées).
// Repère avion (comme le Cessna) : x vers la droite, y vers le haut, z vers l'arrière (nez vers -z), en mètres, taille
// réelle (19,4 m de long, 13 m d'envergure). Repère FlightGear du modèle d'origine : x vers l'arrière, y vers la
// droite, z vers le haut ; fg(x, y, z) le convertit.
// Pièces mobiles, sur les axes du modèle FlightGear (f15c.xml, nozzle-L.xml, nozzle-R.xml) : stabilisateurs (tangage,
// et roulis en différentiel), ailerons, volets, deux gouvernes de direction, aérofrein dorsal, verrière, train (jambes
// qui se replient, trappes, roulette de nez orientable, roues qui roulent), tuyères à pétales (ouvertes au ralenti et
// en postcombustion, fermées plein gaz sec), soufflante des réacteurs ; flammes de postcombustion.

// Appareils tactiles (iPhone, iPad, tablettes) : textures réduites (livrée en 1024 au lieu de 2048, voir
// asset/blender/shrink_glb.py). Safari ferme l'onglet sans prévenir quand la page dépasse sa mémoire : le F-15 en pleine
// définition (plus de 120 Mo de textures en mémoire graphique, cockpit compris) faisait planter iPhone et iPad
const LOW_MEMORY = isTablet();
const MODEL_URL = LOW_MEMORY ? 'asset/f15/f15-mobile.glb' : 'asset/f15/f15.glb';
const LIVERY_URL = (id) => `asset/f15/liveries/${LOW_MEMORY ? 'mobile/' : ''}${id}.jpg`;
const BASE_LIVERY_IMAGE = 'livery.AF80-0007';

// Livrées : textures du fuselage (FlightGear), couleur de l'étiquette des autres joueurs
const F15_LIVERIES = {
    'af80-0007':   { label: 'USAF gris (Eglin, 80-0007)', color: '#8f989e' },
    aggressor:     { label: 'Aggressor désert (65th AGRS)', color: '#c9a46a' },
    'regal-eagle': { label: 'Regal Eagle (Alaska)', color: '#2f4f8f' },
    nasa:          { label: 'NASA (Dryden)', color: '#d8dde2' },
    tiger:         { label: 'Tiger Meet', color: '#e3a21a' },
    iaf:           { label: 'Israël (69e escadron)', color: '#a49572' },
};
const F15_DEFAULT_LIVERY = 'af80-0007';
const isF15Livery = (id) => Object.hasOwn(F15_LIVERIES, id);

const fg = (x, y, z) => new Vector3(y, z, x);
const deg = MathUtils.degToRad;

const WHEEL_BOTTOM = -2.046;                     // bas des roues principales (repère avion)
const NOSE_DROP = 0.087;                         // la roulette de nez du modèle est 9 cm au-dessus du sol : descendue
const COCKPIT_EYE = new Vector3(0, 1.40, -5.0);  // œil du pilote (vue cabine de FlightGear)

// Feux (voir AircraftLights.js) : navigation aux saumons, feu de queue blanc et anticollision au sommet des dérives,
// phares d'atterrissage et de roulage sur la jambe du train avant (éteints train rentré, voir simulator.js)
const F15_LIGHT_LAYOUT = {
    scale: 1,
    beaconLight: null,
    beam: [0, -0.81, -3.8], taxiBeam: [0, -1.0, -3.7],
    lights: [
        { kind: 'nav', color: 0xff2414, position: [-6.16, 0.352, 3.78], sector: [deg(-110), deg(4)], size: 1.4, mesh: ['WingTipPosL-Light'] },
        { kind: 'nav', color: 0x18ff3c, position: [6.16, 0.352, 3.78], sector: [deg(-4), deg(110)], size: 1.4, mesh: ['WingTipPosR-Light'] },
        { kind: 'nav', color: 0xffffff, position: [1.755, 3.33, 8.47], sector: [deg(110), deg(250)], size: 1.0 },
        { kind: 'strobe', color: 0xf2f6ff, position: [-1.755, 3.40, 8.42], size: 3.6, mesh: [] },
        { kind: 'strobe', color: 0xf2f6ff, position: [1.755, 3.40, 8.42], size: 3.6, mesh: ['TailFinCollisionLights'] },
        { kind: 'landing', color: 0xfff4dc, position: [-0.02, -0.806, -3.73], size: 3.5, mesh: ['Landing_lightBulb'] },
        { kind: 'taxi', color: 0xfff4dc, position: [-0.02, -1.01, -3.66], size: 2.6, mesh: ['Taxi_lightBulb'] },
    ],
};

// Interpolation par morceaux (tables <interpolation> de FlightGear) : [[entrée, sortie], …]
function table(points) {
    return (v) => {
        if (v <= points[0][0]) return points[0][1];
        for (let i = 1; i < points.length; i++) {
            const [x1, y1] = points[i];
            if (v <= x1) {
                const [x0, y0] = points[i - 1];
                return y0 + (y1 - y0) * (v - x0) / (x1 - x0);
            }
        }
        return points[points.length - 1][1];
    };
}

// Rotations FlightGear : un angle positif tourne dans le sens indirect autour de l'axe (repère FlightGear)
const FG_SIGN = 1;

async function loadF15() {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const model = prepare(gltf.scene);
    return { model, parts: model.userData.parts };
}

// Copie pour les autres joueurs et les avions garés : pièces mobiles retrouvées dans la copie
function cloneF15(model) {
    const copy = model.clone();
    const parts = rebind(model.userData.parts, model, copy);
    // Matériaux propres à la copie : livrée (une autre peut être choisie), flammes et tuyères (sa propre postcombustion)
    parts.burners = [];
    copy.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        if (child.material.userData.livery || child.material.userData.flame) child.material = child.material.clone();
        if (child.material.userData.flame && !child.material.isShaderMaterial) parts.burners.push(child.material);
    });
    copy.userData = { ...model.userData, parts, livery: null };
    return copy;
}

function rebind(parts, from, to) {
    const map = new Map();
    const a = [], b = [];
    from.traverse((o) => a.push(o));
    to.traverse((o) => b.push(o));
    a.forEach((o, i) => map.set(o, b[i]));
    const swap = (v) => (Array.isArray(v) ? v.map(swap) : v?.isObject3D ? map.get(v) : v && typeof v === 'object' && !v.isVector3 && !v.isMaterial ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
    return swap(parts);
}

function prepare(scene) {
    const root = new Group();
    root.name = 'F15';
    root.add(scene);
    const nodes = new Map();   // nom (sans les points et espaces) -> nœuds
    scene.traverse((child) => {
        if (child === scene) return;
        if (child.parent === scene) {
            const base = child.name;
            if (!nodes.has(base)) nodes.set(base, []);
            nodes.get(base).push(child);
        }
        if (!child.isMesh) return;
        const material = child.material;
        const map = material.map;
        if (map?.name === BASE_LIVERY_IMAGE) material.userData.livery = true;
        if (material.transparent || material.opacity < 1) {
            // Verrière, pare-brise : vus des deux côtés, sans masquer ce qui est derrière
            material.side = DoubleSide;
            material.depthWrite = false;
            child.renderOrder = 2;
        } else {
            material.side = FrontSide;
            child.castShadow = true;
            child.receiveShadow = true;
        }
        if (material.metalness !== undefined) {
            material.metalness = Math.min(material.metalness, 0.25);
            material.roughness = Math.max(material.roughness, 0.55);
        }
    });
    // Vitres : légèrement teintées, un peu de reflet. Exportées en « masque » d'opacité nulle (verre du modèle
    // FlightGear rendu par un effet à part) : sans retirer le seuil de découpe (alphaTest 0,5), toute vitre plus
    // transparente que 50 % disparaissait. Deux couches (extérieure, intérieure) : ~30 % d'opacité en tout
    for (const name of ['CanopyGlass', 'CanopyGlassInside', 'WindscreenGlass', 'WindscreenGlassInside']) {
        for (const node of nodes.get(name) ?? []) {
            node.traverse((m) => {
                if (!m.isMesh) return;
                m.material = m.material.clone();
                Object.assign(m.material, {
                    transparent: true, opacity: 0.17, alphaTest: 0, alphaMap: null, depthWrite: false, side: DoubleSide,
                    roughness: 0.04, metalness: 0.3, envMapIntensity: 1.5,
                });
                m.material.color.set(0x8fa3b0);
                m.material.needsUpdate = true;
                m.renderOrder = 3;
                m.castShadow = false;
            });
        }
    }
    // Voyants de l'arceau (ravitaillement en vol prêt, verrouillage) : éteints (rien ne les allume dans le simulateur)
    for (const name of ['CanopyRefuelReadyLightLamp', 'CanopyLockShootLightLamp']) for (const n of nodes.get(name) ?? []) n.visible = false;
    // Soufflante rapide (image floue) : la soufflante normale tourne à la place
    for (const name of ['FanLHighSpeed', 'FanLHighSpeed001', 'FanRHighSpeed', 'FanRHighSpeed001']) for (const n of nodes.get(name) ?? []) n.visible = false;
    // Conduit du réacteur droit : le modèle d'origine n'en a que le dernier tronçon (z 5,5 -> 6), on voyait le dehors
    // autour de la soufflante depuis l'entrée d'air. Recréé en miroir du conduit gauche (complet, z 2,9 -> 6)
    for (const left of nodes.get('left-engine-and-inlet002') ?? []) {
        if (!left.isMesh) continue;
        const geometry = left.geometry.clone();
        const position = geometry.attributes.position, normal = geometry.attributes.normal;
        for (let i = 0; i < position.count; i++) {
            position.setX(i, -position.getX(i) + 0.015);   // (les deux réacteurs ne sont pas tout à fait symétriques)
            normal?.setX(i, -normal.getX(i));
        }
        // Miroir : sens des triangles inversé, sinon ils montreraient leur dos
        const index = geometry.index;
        if (index) for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i + 1);
            index.setX(i + 1, index.getX(i + 2));
            index.setX(i + 2, a);
        }
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const right = new Mesh(geometry, left.material);
        right.name = 'right-engine-and-inlet-mirror';
        right.castShadow = left.castShadow;
        right.receiveShadow = left.receiveShadow;
        right.position.copy(left.position);
        right.quaternion.copy(left.quaternion);
        right.scale.copy(left.scale);
        left.parent.add(right);
    }

    // Recherche par préfixe (doublons numérotés : « Nose door 1.000 », « .001 »…) ; noms nettoyés par GLTFLoader
    // (espaces -> _, points retirés)
    const clean = (s) => s.replace(/\s/g, '_').replace(/[[\]\.:/]/g, '');
    const find = (...names) => names.flatMap((name) => {
        const key = clean(name);
        return [...nodes.entries()].filter(([n]) => n === key || (n.startsWith(key) && /^\d+$/.test(n.slice(key.length)))).flatMap(([, list]) => list);
    });

    scene.updateMatrixWorld(true);
    // Pivot : groupe placé sur la charnière (axe en repère avion), qui reçoit les pièces ; parent : autre pivot
    const pivot = (name, objects, center, axis, parent = scene) => {
        const group = new Group();
        group.name = name;
        group.position.copy(center);
        group.userData.axis = axis.clone().normalize();
        group.userData.pivot = true;
        scene.add(group);
        group.updateMatrixWorld(true);
        for (const o of objects) if (o) group.attach(o);
        if (parent !== scene) parent.attach(group);
        return group;
    };
    const axisBetween = (a, b) => fg(...b).sub(fg(...a));

    // --- Gouvernes ---
    const p = {};
    p.stabL = pivot('stabL', find('StabilatorL'), fg(7.9652, -1.7929, 0), new Vector3(1, 0, 0));
    p.stabR = pivot('stabR', find('StabilatorR'), fg(7.9652, 1.7929, 0), new Vector3(1, 0, 0));
    p.aileronL = pivot('aileronL', find('AileronL'), fg(5.0335, -5.3892, 0.4772), axisBetween([5.0335, -5.3892, 0.4772], [4.4189, -3.7767, 0.5701]));
    p.aileronR = pivot('aileronR', find('AileronR'), fg(5.0335, 5.4368, 0.4754), axisBetween([4.44085, 3.8377, 0.5746], [5.0335, 5.4368, 0.4754]));
    p.flapL = pivot('flapL', find('FlapL'), fg(4.4107, -3.7839, 0.5651), axisBetween([4.4107, -3.7839, 0.5651], [4.3970, -1.9840, 0.5725]));
    p.flapR = pivot('flapR', find('FlapR'), fg(4.44085, 3.8298, 0.5566), axisBetween([4.4111, 2.02199, 0.6155], [4.44085, 3.8298, 0.5566]));
    p.rudderL = pivot('rudderL', find('rudder').filter((o) => o.name === 'rudder'), fg(7.7720, -1.7059, 2.3325), axisBetween([7.3705, -1.6659, 0.7031], [7.7720, -1.7059, 2.3325]));
    p.rudderR = pivot('rudderR', find('rudder001'), fg(7.7720, 1.7596, 2.3325), axisBetween([7.3705, 1.7928, 0.7031], [7.7720, 1.7596, 2.3325]));
    // Aérofrein dorsal : charnière à l'avant, il se lève vers l'arrière (jusqu'à ~45°) ; vérin
    p.airbrake = pivot('airbrake', find('Airbrake', 'AirbrakeInside'), fg(-0.7927, 0, 1.1368), new Vector3(1, 0, 0));
    p.airbrakeRam = pivot('airbrakeRam', find('SpeedBrakeRam', 'SpeedBrakeActuator'), fg(1.2581, 0, 0.7266), new Vector3(1, 0, 0));
    // Verrière : charnière à l'arrière, elle se soulève (20°) en reculant un peu
    p.canopy = pivot('canopy', find('Canopy', 'CanopyGlass', 'CanopyGlassInside', 'CanopyFasteners', 'CanopyMirrorLeftFrame',
        'CanopyMirrorLeftGlass', 'CanopyMirrorRightFrame', 'CanopyMirrorRightGlass', 'CanopyMirrorTopFrame', 'CanopyMirrorTopGlass', 'CanopyWire'),
    fg(-2.36, 0, 1.4), new Vector3(1, 0, 0));
    p.canopy.userData.home = p.canopy.position.clone();

    // --- Train ---
    // Roulette de nez : 9 cm plus bas (elle touche la piste comme les roues principales)
    for (const o of find('Nose wheel', 'Lower FWD oleo')) o.position.y -= NOSE_DROP;
    const wheelCenter = (objects) => new Box3().setFromObject(objects[0]).getCenter(new Vector3());
    const noseWheel = find('Nose wheel');
    const noseSpin = pivot('noseSpin', noseWheel, wheelCenter(noseWheel), new Vector3(1, 0, 0));
    const noseSteer = pivot('noseSteer', [noseSpin, ...find('Lower FWD oleo')], fg(-3.4036, 0, -0.7918), new Vector3(0, 1, 0));
    const noseGear = pivot('noseGear', [noseSteer, ...find('nosegear retraction linkage', 'Upper FWD oleo', 'fwd retract strut',
        'Landing light', 'Taxi light', 'Taxi lightBulb', 'Landing lightBulb')], fg(-3.4141, 0, -0.3202), fg(0, 1, 0));
    const main = (side) => {
        const s = side === 'Left' ? -1 : 1;
        const wheel = find(`${side} Main wheel`);
        const spin = pivot(`${side}Spin`, wheel, wheelCenter(wheel), new Vector3(1, 0, 0));
        const parts = [spin, ...find(`${side} Main Upper oleo`, `${side} Main lower oleo`, `${side} Main retraction linkage`, `${side} Main retract strut`)];
        const twist = pivot(`${side}Twist`, parts, fg(1.9641, s * 1.32, -0.4794), fg(-0.7, 0, 2.7));
        const fold = pivot(`${side}Fold`, [twist], fg(side === 'Left' ? 1.95 : 1.9, s * 1.32, -0.483), fg(0, 1, 0));
        return { spin, twist, fold, s };
    };
    const left = main('Left'), right = main('Right');
    const doors = [
        { group: pivot('noseDoor1', find('Nose door 1'), fg(-4.7565, -0.1489, -0.2785), fg(1, 0, 0)), gear: 'nose', angle: table([[0, 0], [0.2, -90], [0.8, -90], [1, 0]]) },
        { group: pivot('noseDoor2', find('Nose door 2'), fg(-3.3083, 0.025, -0.322), fg(0, -1, 0)), gear: 'nose', angle: table([[0, 0], [1, 110]]) },
    ];
    for (const [side, s] of [['Left', 1], ['Right', -1]]) {
        const y = side === 'Left' ? -1 : 1;
        doors.push(
            { group: pivot(`${side}Door1`, find(`${side} Main door 1a`, `${side} Main door 1b`), fg(0.9698, y * 0.5144, -0.5942), fg(1, 0, 0)), gear: side, angle: table([[0, 0], [0.2, s * 90], [0.8, s * 90], [1, 0]]) },
            { group: pivot(`${side}Door2`, find(`${side} Main door 2a`, `${side} Main door 2b`), fg(1.0758, y * 1.4532, -0.6014), fg(1, 0, 0)), gear: side, angle: table([[0, 0], [0.2, -s * 120], [0.8, -s * 120], [1, 0]]) },
            { group: pivot(`${side}Door3`, find(`${side} Main door 3a`, `${side} Main door 3b`), fg(2.0028, y * 1.4783, -0.5905), fg(1, 0, 0)), gear: side, angle: table([[0, 0], [0.2, -s * 90], [0.8, -s * 90]]) },
        );
    }
    const wheelRadius = new Box3().setFromObject(noseWheel[0]).getSize(new Vector3()).y / 2;
    const mainRadius = new Box3().setFromObject(left.spin).getSize(new Vector3()).y / 2;

    // --- Réacteurs : soufflante, tuyères à pétales ---
    const fans = [
        pivot('fanL', find('FanL', 'FanLCentre'), fg(3.71309, -0.78081, 0.18532), new Vector3(0, 0, 1)),
        pivot('fanR', find('FanR', 'FanRCentre'), fg(3.71309, 0.78081, 0.18532), new Vector3(0, 0, 1)),
    ];
    const nozzles = ['L', 'R'].map((side) => {
        const y = side === 'L' ? -0.68663 : 0.73888;
        const petals = [];
        for (let i = 0; i < 16; i++) {
            const n = (base) => find(`Petal${side}${base}${i ? `.${String(i).padStart(3, '0')}` : ''}`).filter((o) => o.name === clean(`Petal${side}${base}${i ? `.${String(i).padStart(3, '0')}` : ''}`));
            const [of, ob, rod, inf, ib] = ['OF', 'OB', 'rod', 'IF', 'IB'].map(n);
            // Ordre FlightGear : la rotation autour de l'axe de la tuyère englobe l'ouverture des pétales
            const rodHinge = pivot(`rod${side}${i}`, rod, fg(8.16378, y, 0.46835), fg(0, 1, 0));
            const back = pivot(`ob${side}${i}`, [...ob, rodHinge], fg(7.71482, y, 0.46005), fg(0, 1, 0));
            const front = pivot(`of${side}${i}`, [...of, back], fg(7.30059, y, 0.68181), fg(0, 1, 0));
            const innerAxis = fg(0, -0.9808978436, -0.1945235728);
            const innerBack = pivot(`ib${side}${i}`, ib, fg(7.71579, side === 'L' ? -0.76155 : 0.66396, 0.44881), innerAxis);
            const innerFront = pivot(`if${side}${i}`, [...inf, innerBack], fg(7.3006, side === 'L' ? -0.80548 : 0.62003, 0.66961), innerAxis);
            const ring = pivot(`ring${side}${i}`, [front, innerFront], fg(7.4506, y, 0.071), fg(1, 0, 0));
            ring.quaternion.setFromAxisAngle(ring.userData.axis, FG_SIGN * deg(22.5 * i));
            petals.push({ front, back, rodHinge, innerFront, innerBack });
        }
        return petals;
    });

    // --- Flammes de postcombustion : cônes emboîtés (cœur bleu-blanc, gaine orange, diamants de choc), additifs ---
    const flames = ['L', 'R'].map((side) => {
        const group = new Group();
        group.name = `flame${side}`;
        group.position.copy(fg(7.45, side === 'L' ? -0.705 : 0.705, 0.085));
        const layers = [
            { length: 5.5, radius: 0.42, color: new Color(1.0, 0.45, 0.15), alpha: 0.55 },
            { length: 3.6, radius: 0.32, color: new Color(1.0, 0.75, 0.45), alpha: 0.7 },
            { length: 2.2, radius: 0.2, color: new Color(0.75, 0.82, 1.0), alpha: 0.9 },
        ];
        for (const layer of layers) {
            const geometry = new ConeGeometry(layer.radius, layer.length, 24, 12, true);
            geometry.rotateX(Math.PI / 2);                          // pointe vers l'arrière (+z)
            geometry.translate(0, 0, layer.length / 2);
            const material = flameMaterial(layer.color, layer.alpha, layer.length);
            const mesh = new Mesh(geometry, material);
            mesh.renderOrder = 4;
            mesh.frustumCulled = false;
            group.add(mesh);
        }
        group.visible = false;
        scene.add(group);
        return group;
    });
    // Intérieur des tuyères : rougeoie en postcombustion
    const burners = find('AfterburnerL', 'AfterburnerR').flatMap((o) => {
        const list = [];
        o.traverse((m) => {
            if (!m.isMesh) return;
            m.material = m.material.clone();
            m.material.userData.flame = true;
            m.material.emissive = new Color(1, 0.45, 0.15);
            m.material.emissiveIntensity = 0;
            list.push(m.material);
        });
        return list;
    });

    // Pièces fixes fusionnées par matériau (~300 pièces -> quelques dizaines d'appels de dessin)
    const animated = new Set();
    scene.traverse((o) => { if (o.userData.pivot) animated.add(o); });
    for (const name of ['WingTipPosL-Light', 'WingTipPosR-Light', 'TailFinCollisionLights', 'AfterburnerL', 'AfterburnerR']) for (const o of find(name)) animated.add(o);
    for (const f of flames) animated.add(f);
    mergeStatic(scene, (o) => animated.has(o));

    // Livrée d'origine du modèle (embarquée) : sert telle quelle, sans être rechargée
    let embedded = null;
    scene.traverse((m) => { if (m.isMesh && m.material?.userData.livery) embedded ??= m.material.map; });
    if (embedded && !liveryTextures.has(F15_DEFAULT_LIVERY)) {
        embedded.anisotropy = 4;
        liveryTextures.set(F15_DEFAULT_LIVERY, embedded);
    }
    liveryUsers.set(F15_DEFAULT_LIVERY, (liveryUsers.get(F15_DEFAULT_LIVERY) ?? 0) + 1);
    root.userData = {
        livery: F15_DEFAULT_LIVERY,
        parts: { ...p, noseGear, noseSteer, noseSpin, left, right, doors, fans, nozzles, flames, burners, wheelRadius, mainRadius },
    };
    return root;
}

// Flamme : dégradé le long du cône (vive à la sortie, s'éteint au bout), bords adoucis, diamants de choc
function flameMaterial(color, alpha, length) {
    const material = new ShaderMaterial({
        uniforms: { uColor: { value: color }, uAlpha: { value: alpha }, uLevel: { value: 0 }, uTime: { value: 0 }, uLength: { value: length } },
        vertexShader: /* glsl */`
            varying float vAlong;
            varying float vEdge;
            void main() {
                vAlong = position.z / ${length.toFixed(2)};
                vec3 n = normalize(normalMatrix * normal);
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vEdge = abs(dot(n, normalize(-mv.xyz)));
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uColor;
            uniform float uAlpha;
            uniform float uLevel;
            uniform float uTime;
            varying float vAlong;
            varying float vEdge;
            void main() {
                float reach = mix(0.35, 1.0, uLevel);
                float fade = 1.0 - smoothstep(0.0, reach, vAlong);
                float diamonds = 0.75 + 0.25 * cos(vAlong * 40.0 - uTime * 3.0);
                float flicker = 0.9 + 0.1 * sin(uTime * 37.0 + vAlong * 9.0);
                float a = uAlpha * uLevel * fade * diamonds * flicker * pow(mix(0.45, 1.0, vEdge), 1.5);   // (vue dans l'axe : encore visible)
                gl_FragColor = vec4(uColor * 2.2 * a, a);
            }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });
    material.userData.flame = true;
    return material;
}

// Livrée : texture du fuselage remplacée (chargée une fois)
const liveryTextures = new Map();
const liveryUsers = new Map();   // livrée -> nombre d'avions qui la portent (une livrée plus portée est libérée)
function liveryTexture(id) {
    if (!liveryTextures.has(id)) {
        const texture = new TextureLoader().load(LIVERY_URL(id));
        texture.flipY = false;   // (textures glTF)
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        liveryTextures.set(id, texture);
    }
    return liveryTextures.get(id);
}
function paintF15(model, id) {
    const livery = isF15Livery(id) ? id : F15_DEFAULT_LIVERY;
    const previous = model.userData.livery;
    if (previous === livery) return;
    model.userData.livery = livery;
    liveryUsers.set(livery, (liveryUsers.get(livery) ?? 0) + 1);
    // Ancienne livrée plus portée par aucun avion : texture rendue (mémoire graphique)
    if (previous) {
        const users = (liveryUsers.get(previous) ?? 1) - 1;
        liveryUsers.set(previous, users);
        if (users <= 0 && previous !== F15_DEFAULT_LIVERY) {
            liveryTextures.get(previous)?.dispose();
            liveryTextures.delete(previous);
        }
    }
    const texture = liveryTexture(livery);
    model.traverse((m) => {
        if (m.isMesh && m.material?.userData.livery) {
            m.material.map = texture;
            m.material.needsUpdate = true;
        }
    });
}

// Animation : state = { pitch, roll, yaw (-1 -> 1, + = cabrer / gauche), flaps (0 -> 1), speedbrake (0 -> 1),
// canopy (0 -> 1), gear (0 rentré -> 1 sorti), steer (-1 -> 1), wheelSpeed (m/s), onGround, n2 [g, d] (%),
// ab [g, d] (0 -> 1), time (s) }
const _canopyShift = new Vector3();
function animateF15(model, state, delta) {
    const P = model.userData.parts;
    if (!P) return;
    const set = (pivot, degrees) => pivot?.quaternion.setFromAxisAngle(pivot.userData.axis, FG_SIGN * deg(degrees));
    const rot = (pivot, degrees) => pivot?.quaternion.setFromAxisAngle(pivot.userData.axis, deg(degrees));
    // Stabilisateurs : ensemble pour le tangage, en différentiel pour le roulis ; bord d'attaque vers le bas pour cabrer
    const pitch = -state.pitch * 20, roll = state.roll * 10;
    rot(P.stabL, MathUtils.clamp(pitch - roll, -29, 29));
    rot(P.stabR, MathUtils.clamp(pitch + roll, -29, 29));
    // Ailerons : roulis à gauche -> aileron gauche levé ; repliés sur eux-mêmes à grande vitesse (pas ici)
    rot(P.aileronL, -state.roll * 20);
    rot(P.aileronR, state.roll * 20);
    rot(P.flapL, state.flaps * 30);
    rot(P.flapR, state.flaps * 30);
    // Palonnier à gauche : bords de fuite des gouvernes de direction vers la gauche
    rot(P.rudderL, -state.yaw * 30);
    rot(P.rudderR, -state.yaw * 30);
    // Aérofrein : bord de fuite vers le haut
    rot(P.airbrake, -state.speedbrake * 45);
    rot(P.airbrakeRam, -state.speedbrake * 16);
    rot(P.canopy, state.canopy * 20);
    if (P.canopy) P.canopy.position.copy(P.canopy.userData.home).add(_canopyShift.set(0, 0, Math.min(1, state.canopy * 4) * 0.01));

    // Train : position (0 rentré -> 1 sorti) ; roulette orientée au sol, roues qui roulent
    const g = state.gear;
    set(P.noseGear, table([[0.1, 110], [1, 0]])(g));
    // Roulette de nez : braquage limité avec la vitesse (45° au parking, ~8° au décollage, comme le modèle de vol qui
    // perd son autorité) et suivi en douceur (avant : elle suivait le manche sans filtre, chaque correction de roulis
    // la faisait battre de gauche à droite)
    const speed = Math.abs(state.wheelSpeed ?? 0);
    const steerMax = MathUtils.lerp(45, 8, MathUtils.clamp((speed - 5) / 35, 0, 1));
    const steerTarget = state.onGround ? state.steer * steerMax : 0;
    P.steerAngle = (P.steerAngle ?? 0) + (steerTarget - (P.steerAngle ?? 0)) * (1 - Math.exp(-delta / 0.25));
    rot(P.noseSteer, P.steerAngle);
    set(P.left.fold, table([[0, 100], [0.1, 100], [1, 0]])(g));
    set(P.left.twist, table([[0.4, -90], [1, 0]])(g));
    set(P.right.fold, table([[0, 100], [0.1, 100], [1, 0]])(g));
    set(P.right.twist, table([[0.4, 90], [1, 0]])(g));
    for (const door of P.doors) set(door.group, door.angle(g));
    const roll_ = state.onGround ? state.wheelSpeed : 0;
    P.noseSpin.rotateX(-roll_ / P.wheelRadius * delta);
    P.left.spin.rotateX(-roll_ / P.mainRadius * delta);
    P.right.spin.rotateX(-roll_ / P.mainRadius * delta);

    // Réacteurs : soufflante, tuyères (ouvertes au ralenti, fermées plein gaz sec, grandes ouvertes en postcombustion),
    // flammes
    P.fans.forEach((fan, i) => fan.rotateZ((i ? -1 : 1) * state.n2[i] * 0.6 * delta));
    P.nozzles.forEach((petals, i) => {
        const n2 = state.n2[i], ab = state.ab[i];
        // Comme le vrai F100 : ouverte au ralenti, fermée à plein gaz sec (MIL), rouverte en postcombustion (le surplus
        // de gaz brûlés doit pouvoir sortir, sinon la contre-pression ferait décrocher le réacteur)
        const open = MathUtils.clamp(ab > 0.02 ? 0.4 + 0.6 * ab : n2 < 70 ? 0.8 - (n2 - 60) * 0.06 : 0.2 * (1 - (n2 - 70) / 30), 0, 1);
        for (const petal of petals) {
            set(petal.front, -15 * open);
            set(petal.back, 8 * open);
            set(petal.rodHinge, -7 * open);
            set(petal.innerFront, 15 * open);
            set(petal.innerBack, -9 * open);
        }
    });
    P.flames.forEach((flame, i) => {
        const level = state.ab[i];
        flame.visible = level > 0.02;
        for (const mesh of flame.children) {
            mesh.material.uniforms.uLevel.value = level;
            mesh.material.uniforms.uTime.value = state.time;
        }
        flame.scale.set(1, 1, 0.6 + 0.4 * level);
    });
    P.burners.forEach((material, i) => { material.emissiveIntensity = 2.5 * state.ab[i < P.burners.length / 2 ? 0 : 1]; });
}

export {
    loadF15, cloneF15, paintF15, animateF15, F15_LIVERIES, F15_DEFAULT_LIVERY, isF15Livery, F15_LIGHT_LAYOUT,
    WHEEL_BOTTOM as F15_WHEEL_BOTTOM, COCKPIT_EYE as F15_COCKPIT_EYE,
};
