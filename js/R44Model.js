import {
    Box3, BoxGeometry, CylinderGeometry, Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
    SRGBColorSpace, TextureLoader, TorusGeometry, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FGAnimator } from './FGAnimator.js';
import { R44_KEY } from './R44Systems.js';
import { isTablet } from './Device.js';

// Robinson R44 Raven II (modèle FlightGear d'Emmanuel Baranger, GPL-2.0, converti par asset/blender/build_r44.py) :
// extérieur (r44.glb), cockpit (r44-cockpit.glb) et leurs animations (r44-anim.json), rejouées par FGAnimator avec
// les valeurs du jeu. R44Cockpit a la même interface que Cockpit.js et F15Cockpit.js pour le simulateur (group, eye,
// clickables, controlAt, update, setExterior, setNight…) ; il porte aussi l'extérieur (exterior), à ranger dans le
// groupe de l'appareil.

const URL = 'asset/r44/';
// Téléphones et tablettes : textures réduites (fuselage et livrées en 1024 px), comme pour le F-15
const LOW_MEMORY = isTablet();
const deg = MathUtils.degToRad;
const FT = 0.3048;

// Livrées (texture du fuselage) : identifiant -> nom affiché, couleur (étiquettes, carte)
const R44_LIVERIES = {
    'r44-default': { label: 'Raven II (jaune et noir)', file: 'default', color: '#e0a21a' },
    'r44-n7183c': { label: 'N7183C (blanc et bleu)', file: 'n7183c', color: '#3c6fb8' },
    'r44-orange': { label: 'Orange', file: 'orange', color: '#ef7a1a' },
    'r44-green': { label: 'Vert', file: 'green', color: '#3b9a4a' },
    'r44-police': { label: 'Police (Porto Rico)', file: 'policiapr', color: '#2a4f9e' },
    'r44-helitaxi': { label: 'Hélitaxi', file: 'helitaxi', color: '#d33a2c' },
    'r44-lemon': { label: 'Citron', file: 'lemon', color: '#e8de3a' },
    'r44-n176us': { label: 'N176US', file: 'n176us', color: '#9aa4ae' },
};
const R44_DEFAULT_LIVERY = 'r44-default';
const isR44Livery = (id) => Object.hasOwn(R44_LIVERIES, id ?? '');

// Boutons des radios du tableau -> commandes des radios du jeu (Avionics.use)
const RADIO_CONTROLS = {
    m28__CommMHz: 'com1:outer', m28__CommKHz: 'com1:inner', m28__CommToggle: 'com1:swap',
    m28__NavMHz: 'nav1:outer', m28__NavKHz: 'nav1:inner', m28__NavToggle: 'nav1:swap',
    m27__Knob1000: 'xpdr:d0', m27__Knob100: 'xpdr:d1', m27__Knob10: 'xpdr:d2', m27__Knob1: 'xpdr:d3',
    m27__KnobMode: 'xpdr:mode', m27__Ident: 'xpdr:ident',
};

const XPDR_MODES = ['OFF', 'SBY', 'ON', 'ALT', 'TST'];
function radioProps(avionics) {
    if (!avionics) return {};
    const code = String(avionics.xpdr?.code ?? '7000').padStart(4, '0');
    return {
        'instrumentation/comm/frequencies/selected-mhz': avionics.com1.active / 1000,
        'instrumentation/comm/frequencies/standby-mhz': avionics.com1.standby / 1000,
        'instrumentation/nav/frequencies/selected-mhz': avionics.nav1.active / 1000,
        'instrumentation/nav/frequencies/standby-mhz': avionics.nav1.standby / 1000,
        'instrumentation/comm/power-btn': true, 'instrumentation/nav/power-btn': true,
        'instrumentation/altimeter/setting-inhg': (avionics.baro ?? 1013) / 33.8639,   // (calage, en hPa dans le jeu)
        'instrumentation/kt76a/digit1': Number(code[0]), 'instrumentation/kt76a/digit2': Number(code[1]),
        'instrumentation/kt76a/digit3': Number(code[2]), 'instrumentation/kt76a/digit4': Number(code[3]),
        'instrumentation/kt76a/mode': Math.max(0, XPDR_MODES.indexOf(avionics.xpdr?.mode)),
    };
}

// Œil du pilote (place de droite, comme sur le vrai R44) et hauteur des patins
const R44_EYE = new Vector3(0.252, -0.12, -3.405);
const R44_SKID_HEIGHT = 1.64;     // origine du modèle au-dessus du sol, appareil posé (bas des tubes des patins)

// Feux : position rouge à gauche et verte à droite (sur les montants du train), blanc à l'arrière de la poutre,
// anticollision rouge sur le cône arrière, deux phares dans le nez
const R44_LIGHT_LAYOUT = {
    scale: 1,
    beaconLight: [0, 0.6, 2.16],
    beam: [-0.065, -0.85, -4.6], taxiBeam: [0.065, -0.85, -4.6],   // départ des faisceaux des phares (nez)
    // Positions relevées sur le modèle : verres rouge et vert sous la cabine (m0__redlight / m0__greenlight), feu
    // anticollision sur le cône arrière (m0__verrelampe, à 0,42 m), feu blanc au bout de la poutre (3,68 m)
    lights: [
        { kind: 'nav', color: 0xff2414, position: [-0.59, -0.98, -3.36], sector: [deg(-110), deg(4)], size: 0.8, mesh: ['m0__redlight'] },
        { kind: 'nav', color: 0x18ff3c, position: [0.59, -0.98, -3.36], sector: [deg(-4), deg(110)], size: 0.8, mesh: ['m0__greenlight'] },
        { kind: 'nav', color: 0xffffff, position: [0, 0.4, 3.7], sector: [deg(110), deg(250)], size: 0.6 },
        { kind: 'beacon', color: 0xff1a0a, position: [0, 0.42, 2.16], size: 1.2, mesh: ['m0__verrelampe'] },
        { kind: 'landing', color: 0xfff4dc, position: [-0.065, -0.85, -4.56], size: 2.6, mesh: [] },
        { kind: 'taxi', color: 0xfff4dc, position: [0.065, -0.85, -4.56], size: 2.2, mesh: [] },
    ],
};

let animData = null;
const textureLoader = new TextureLoader();
const liveryCache = new Map();

function liveryTexture(id) {
    const entry = R44_LIVERIES[isR44Livery(id) ? id : R44_DEFAULT_LIVERY];
    if (!liveryCache.has(entry.file)) {
        const texture = textureLoader.load(`${URL}liveries/${LOW_MEMORY ? 'mobile/' : ''}${entry.file}.jpg`);
        texture.flipY = false;                 // (coordonnées de texture du glTF)
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        liveryCache.set(entry.file, texture);
    }
    return liveryCache.get(entry.file);
}

// Peinture : la texture du fuselage (matériaux « …texture.png » du modèle FlightGear) remplacée par celle de la livrée
function paintR44(model, id) {
    const map = liveryTexture(id);
    model.traverse((mesh) => {
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (!/texture(_png)?$|texture\.png$/i.test(material.name)) continue;
            if (material.map !== map) {
                material.map = map;
                material.needsUpdate = true;
            }
        }
    });
}

// Matériaux importés : réglages pour le jeu (verres transparents, peinture un peu brillante)
const COCKPIT_FILL = 0.22;   // part de sa texture que le cockpit émet lui-même (lumière de la bulle)
function prepareMaterials(root, cockpit) {
    root.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        // Vitres : pas d'ombre (la bulle du R44 est presque toute en verre : son ombre plongeait le cockpit dans le noir)
        mesh.castShadow = !cockpit && !materials.some((m) => m.transparent);
        mesh.receiveShadow = true;
        for (const material of materials) {
            material.metalness = 0;
            if (material.transparent) {
                material.depthWrite = false;
                material.roughness = 0.1;
                mesh.renderOrder = 3;
            } else {
                material.roughness = Math.max(cockpit ? 0.7 : 0.45, material.roughness ?? 0.6);
                // Cockpit : un peu d'éclairage propre (lumière diffuse de la bulle, comme le cockpit du F-15) ; l'éclairage
                // des instruments la nuit s'y ajoute (FGAnimator garde cette base)
                if (cockpit && material.map && material.emissive) {
                    material.emissive.setScalar(COCKPIT_FILL);
                    material.emissiveMap = material.map;
                    material.userData.fill = true;
                }
            }
        }
    });
}

async function loadR44() {
    const loader = new GLTFLoader();
    const [exterior, cockpit, data] = await Promise.all([
        loader.loadAsync(`${URL}${LOW_MEMORY ? 'r44-mobile.glb' : 'r44.glb'}`), loader.loadAsync(`${URL}r44-cockpit.glb`),
        animData ?? fetch(`${URL}r44-anim.json`).then((r) => {
            if (!r.ok) throw new Error(`r44-anim.json : ${r.status}`);
            return r.json();
        }),
    ]);
    animData = data;
    // L'interrupteur ALT du modèle FlightGear manœuvre la propriété de l'embrayage (copier-coller dans son XML) :
    // remis sur l'alternateur
    for (const entry of [...data.animations, ...data.picks]) {
        if (!entry.file?.endsWith('switch/alt.xml')) continue;
        const text = JSON.stringify(entry).replace(/controls\/engines\/engine\/clutchguard/g, 'controls/electric/engine/generator-guard')
            .replace(/controls\/engines\/engine\/clutch/g, 'controls/electric/engine/generator');
        Object.assign(entry, JSON.parse(text));
    }
    prepareMaterials(exterior.scene, false);
    prepareMaterials(cockpit.scene, true);
    return { exterior: exterior.scene, cockpit: cockpit.scene, data };
}

// Immatriculation peinte (six caractères : lettres, chiffres, tiret) -> valeurs des tambours du modèle
function registrationGlyphs(text) {
    const s = String(text ?? '').toUpperCase().slice(0, 6);
    return Array.from({ length: 6 }, (_, i) => {
        const c = s[i];
        if (!c) return 0;
        if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 65 + 1;
        if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48 + 27;
        return 37;
    });
}

// Pales en rotation rapide : le modèle FlightGear montre alors un disque flou (propdisc, au-dessus de 150 tr/min) ;
// les pales elles-mêmes sont cachées (sinon, d'une image à l'autre, elles semblent sauter ou tourner à l'envers)
function hideBladesWhenBlurred(animator, root) {
    const main = [], tail = [];
    root.traverse((o) => {
        if (/^m6[89]__blade\d$/.test(o.name)) main.push(o);
        else if (/^m7[23]__blade$/.test(o.name)) tail.push(o);
    });
    const slow = (property) => ({ op: 'less-than-equals', a: property, b: { value: 150 } });
    if (main.length) animator.selects.push({ anim: { condition: slow('rotors/main/rpm') }, targets: main });
    if (tail.length) animator.selects.push({ anim: { condition: slow('rotors/tail/rpm') }, targets: tail });
}

// Animation d'une pièce par le collectif (propriété FlightGear du levier : 0 collectif en haut, 1 en bas)
const collectiveAnims = (part) => part.anims.filter((a) => a.type === 'rotate' && a.property?.endsWith('float[10]'));
const _v = new Vector3();

// Sommet d'une pièce (au repos, repère du modèle) le plus loin d'un point
function farthestVertex(object, base, from) {
    const p = object.geometry.attributes.position, best = new Vector3();
    let distance = -1;
    for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i).applyMatrix4(base);
        const d = _v.distanceTo(from);
        if (d > distance) {
            distance = d;
            best.copy(_v);
        }
    }
    return best;
}

// Levier du pas collectif : celui du modèle FlightGear n'est qu'une tige noire. Refait comme celui du R44 : soufflet
// au pied, tube, bague de friction, poignée tournante des gaz (crantée), boîtier au bout avec l'interrupteur du
// régulateur (GOVERNOR) et le bouton du démarreur. Accroché au levier d'origine (il en suit l'animation), qui reste
// cliquable (régulateur) mais n'est plus dessiné
function buildCollective(lever, part, hand = null) {
    const anim = collectiveAnims(part)[0];
    if (!anim) return;
    const pivot = new Vector3().fromArray(anim.center);
    const tip = farthestVertex(lever, part.base, pivot);
    const length = tip.distanceTo(pivot);
    // Poignée des gaz sous la main du pilote (hand : bout de ses doigts, au repos), sinon sur le dernier tiers
    const handAlong = hand ? hand.clone().sub(pivot).dot(tip.clone().sub(pivot).normalize()) : length;
    const metal = new MeshStandardMaterial({ color: 0xb4b8be, metalness: 0.8, roughness: 0.35 });
    const rubber = new MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.85 });
    const housing = new MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.3, roughness: 0.5 });
    const red = new MeshStandardMaterial({ color: 0xc4231e, roughness: 0.4 });
    const group = new Group();
    group.name = 'Collectif';
    const add = (geometry, material, y) => {
        const mesh = new Mesh(geometry, material);
        mesh.position.y = y;
        mesh.castShadow = true;
        group.add(mesh);
        return mesh;
    };
    const grip = MathUtils.clamp(handAlong - 0.1, length * 0.4, length * 0.66), gripLength = length - grip - 0.012;   // (axe y : du pied vers la poignée)
    add(new CylinderGeometry(0.018, 0.045, 0.09, 20), rubber, 0.045);                  // soufflet
    add(new CylinderGeometry(0.012, 0.012, grip - 0.08, 16), metal, 0.08 + (grip - 0.08) / 2);   // tube
    add(new CylinderGeometry(0.017, 0.017, 0.016, 16), housing, grip);                 // bague de friction
    add(new CylinderGeometry(0.019, 0.019, gripLength, 20), rubber, grip + 0.008 + gripLength / 2);   // poignée des gaz
    for (let k = 1; k < 6; k++) add(new TorusGeometry(0.019, 0.0028, 6, 20), rubber, grip + 0.008 + gripLength * k / 6).rotation.x = Math.PI / 2;
    add(new BoxGeometry(0.04, 0.046, 0.036), housing, length + 0.006);                  // boîtier
    const toggle = add(new CylinderGeometry(0.0035, 0.0035, 0.024, 8), metal, length + 0.036);   // régulateur
    toggle.rotation.z = 0.35;
    const button = add(new CylinderGeometry(0.007, 0.007, 0.008, 12), red, length + 0.006);       // démarreur
    button.rotation.x = Math.PI / 2;
    button.position.z = 0.019;
    // Placé dans le repère du modèle (pied au pivot, axe vers la poignée), puis ramené dans celui du levier d'origine
    group.position.copy(pivot);
    group.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tip.clone().sub(pivot).normalize());
    group.updateMatrix();
    group.matrix.premultiply(part.base.clone().invert());
    group.matrix.decompose(group.position, group.quaternion, group.scale);
    lever.add(group);
    lever.material = new MeshBasicMaterial({ visible: false });
}

// Main gauche du pilote sur la poignée du collectif. Dans le modèle FlightGear, l'épaule (20° par course) et le coude
// (-55°) tournent sans suivre le levier (35°, autre pivot) : la main s'en écartait de 15 à 42 cm. Remplacés par deux
// rotations calculées à chaque image (bras à deux segments dans le plan du levier : la main reste là où elle tient la
// poignée au repos, collectif en haut), coude d'abord, puis épaule
function setupArmOnCollective(animator, root) {
    const [upper, forearm, lever] = ['m60__brasG', 'm60__avantbrasG', 'm10__Collective'].map((name) => root.getObjectByName(name));
    const parts = [upper, forearm, lever].map((object) => object && animator.parts.get(object));
    if (parts.some((part) => !part)) return null;
    const [shoulderAnim] = collectiveAnims(parts[0]);
    const elbowAnim = collectiveAnims(parts[1]).find((a) => a !== shoulderAnim);
    const [leverAnim] = collectiveAnims(parts[2]);
    if (!shoulderAnim || !elbowAnim || !leverAnim) return null;
    const shoulder = { type: 'rotate', property: 'sim/r44/bras-epaule', factor: 1, axis: [1, 0, 0], center: shoulderAnim.center };
    const elbow = { type: 'rotate', property: 'sim/r44/bras-coude', factor: 1, axis: [1, 0, 0], center: elbowAnim.center };
    parts[0].anims = parts[0].anims.map((a) => (a === shoulderAnim ? shoulder : a));
    parts[1].anims = [...parts[1].anims.filter((a) => a !== shoulderAnim && a !== elbowAnim), elbow, shoulder];
    const S = new Vector3().fromArray(shoulderAnim.center), E = new Vector3().fromArray(elbowAnim.center);
    return {
        S, E, H: farthestVertex(forearm, parts[1].base, E),
        pivot: new Vector3().fromArray(leverAnim.center), axis: new Vector3().fromArray(leverAnim.axis).normalize(),
        factor: leverAnim.factor ?? 1, target: new Vector3(),
    };
}

// Angles (deg) de l'épaule et du coude pour la valeur du levier (0 -> 1). Rotations autour de x : on travaille dans le
// plan (y, z), où une rotation d'angle φ ajoute φ à atan2(z, y)
function armAngles(ik, value) {
    const T = ik.target.copy(ik.H).sub(ik.pivot).applyAxisAngle(ik.axis, deg(value * ik.factor)).add(ik.pivot);
    const angle = (y, z) => Math.atan2(z, y);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const u = [ik.E.y - ik.S.y, ik.E.z - ik.S.z], w = [ik.H.y - ik.E.y, ik.H.z - ik.E.z], d = [T.y - ik.S.y, T.z - ik.S.z];
    const L1 = Math.hypot(...u), L2 = Math.hypot(...w);
    const D = MathUtils.clamp(Math.hypot(...d), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    const bend0 = wrap(angle(...w) - angle(...u));
    const bend = Math.sign(bend0 || 1) * Math.acos(MathUtils.clamp((D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const beta = bend - bend0;
    const c = Math.cos(beta), s = Math.sin(beta);
    const reach = [u[0] + w[0] * c - w[1] * s, u[1] + w[0] * s + w[1] * c];
    const alpha = wrap(angle(...d) - angle(...reach));
    return [MathUtils.radToDeg(alpha), MathUtils.radToDeg(beta)];
}

// Copie de l'extérieur pour les autres joueurs : son propre animateur (rotors, cône, portes)
function cloneR44(template) {
    const group = template.clone(true);
    const animator = new FGAnimator(animData, [group]);
    hideBladesWhenBlurred(animator, group);
    animator.assign(STATIC_PROPS);
    return { group, animator };
}

// Propriétés fixes : version à patins (Raven II), vitres normales, pas de passager, manche cyclique visible
const STATIC_PROPS = {
    'sim/multiplay/generic/string[2]': 'raven', 'sim/multiplay/generic/bool[2]': false, 'sim/multiplay/generic/bool[3]': false,
    'sim/multiplay/generic/bool[1]': true, 'sim/multiplay/generic/bool[17]': false, 'sim/multiplay/generic/bool[4]': false,
    'instrumentation/kt76a/mode': 3, 'sim/model/r44/state': 0,
};

// Rotors d'un R44 (le nôtre ou celui d'un autre joueur) : régime, cône des pales, pas, palonniers
function setRotorProps(animator, { rotorRpm = 0, collective = 0, pedal = 0, coning = 0, delta = 0 }) {
    animator.assign({
        'rotors/main/rpm': rotorRpm,
        'rotors/tail/rpm': rotorRpm * 6,
        'sim/multiplay/generic/float[22]': collective,             // pas des pales (degrés)
        'sim/multiplay/generic/float[23]': pedal * 12,             // pas du rotor anticouple
        'sim/multiplay/generic/float[18]': coning, 'sim/multiplay/generic/float[19]': coning * 0.5,
        'sim/multiplay/generic/float[20]': coning * 0.25, 'sim/multiplay/generic/float[21]': coning * 0.1,
    });
    animator.update(delta);
}

class R44Cockpit {
    constructor() {
        this.group = new Group();
        this.group.name = 'R44Cockpit';
        this.exterior = new Group();
        this.exterior.name = 'R44';
        this.eye = R44_EYE.clone();
        this.clickables = [];
        this.ready = false;
        this.yokesVisible = true;
        this.panel = { turnKnob() {} };
        this.animator = null;
        this.registration = 'F-HESM';
        this._exterior = true;
        this._night = 0;
        this._clock = 0;
        this._pilot = [];
        this._doors = [0, 0, 0, 0];
        this.doorsOpen = false;
    }

    async load() {
        const { exterior, cockpit, data } = await loadR44();
        this.exterior.add(exterior);
        this.group.add(cockpit);
        this.model = exterior;
        this.animator = new FGAnimator(data, [exterior, cockpit]);
        hideBladesWhenBlurred(this.animator, exterior);
        // Voyants « génériques » du tableau FlightGear (sans fonction, allumés en permanence dans le modèle) : éteints
        const unused = [];
        cockpit.traverse((o) => { if (/^m3[2-6]__lampon$/.test(o.name)) unused.push(o); });
        if (unused.length) this.animator.selects.push({ anim: { condition: { property: 'sim/r44/jamais' } }, targets: unused });
        this.animator.assign(STATIC_PROPS);
        // Levier du collectif refait, main du pilote dessus
        const collective = cockpit.getObjectByName('m10__Collective');
        const collectivePart = collective && this.animator.parts.get(collective);
        this._armIK = setupArmOnCollective(this.animator, cockpit);
        if (collectivePart) buildCollective(collective, collectivePart, this._armIK?.H);
        // Régulateur : interrupteur au bout de la poignée du collectif (pas de zone cliquable dans le modèle FlightGear)
        if (collective) this.animator.addPick([collective], [{ buttons: [0, 2], repeatable: false,
            bindings: [{ command: 'property-toggle', property: 'controls/engines/engine/governor' }] }], 'Collective');
        // Radios (KX 165 NAV/COM, transpondeur KT 76A) : leurs boutons règlent les radios du jeu (contrôle aérien, VOR),
        // affichées en retour sur leurs tambours (voir update). Clic à droite ou molette vers le haut : +, à gauche ou vers
        // le bas : -
        for (const [name, id] of Object.entries(RADIO_CONTROLS)) {
            const object = cockpit.getObjectByName(name);
            if (!object) continue;
            this.animator.addPick([object], [
                { buttons: [0, 3], bindings: [{ command: 'game', id, step: 1 }] },
                { buttons: [1, 2, 4], bindings: [{ command: 'game', id, step: -1 }] },
            ], 'Radios', true);
        }
        this.clickables = this.animator.pickMeshes;
        // Pilote (place de droite) : caché en vue cabine (on est à sa place) ; le passager n'est pas à bord
        cockpit.traverse((o) => { if (o.isMesh && /^m60__/.test(o.name)) this._pilot.push(o); });
        cockpit.traverse((o) => { if (o.isMesh && /^m61__/.test(o.name)) o.visible = false; });
        // Bas des patins : hauteur de l'origine au-dessus du sol (contrôle du modèle)
        const box = new Box3().setFromObject(exterior);
        this.skidHeight = box.min.y < -1 ? -box.min.y : R44_SKID_HEIGHT;
        this.ready = true;
    }

    setExterior(exterior) {
        this._exterior = exterior;
        for (const mesh of this._pilot) mesh.visible = exterior;
    }

    // Nuit : l'éclairage propre du cockpit (lumière du jour par la bulle) s'éteint presque ; restent les instruments
    setNight(night) {
        this._night = night;
        const fill = COCKPIT_FILL * (1 - 0.9 * night);
        this.group.traverse((mesh) => {
            if (!mesh.isMesh) return;
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                if (!material.userData.fill) continue;
                const base = this.animator?._baseEmissive.get(material);
                if (base) base.setScalar(fill);
                else material.emissive.setScalar(fill);
            }
        });
        for (const m of this.animator?.materials ?? []) m.level = -1;   // (émission des instruments recalculée)
    }
    setRain() {}
    setYokesVisible(visible) { this.yokesVisible = visible; }
    setYokesHiddenByView() {}
    toggleVisor() {}
    fitInsideHull() {}
    addCabinShell() {}
    setWindshieldGlass() {}
    setRegistration(text) { this.registration = text; }

    toggleDoors() {
        this.doorsOpen = !this.doorsOpen;
    }

    // Zone cliquable touchée : { id: 'r44', pick, side, vertical }
    controlAt(hit) {
        const pick = this.animator?.pickOf(hit.object);
        if (!pick) return null;
        hit.object.geometry.computeBoundingBox();
        const center = hit.object.geometry.boundingBox.getCenter(new Vector3());
        hit.object.localToWorld(center);
        const local = this.group.worldToLocal(hit.point.clone()), c = this.group.worldToLocal(center);
        return { id: 'r44', pick, side: local.x < c.x ? -1 : 1, vertical: local.y > c.y ? -1 : 1 };
    }

    // Clic ou molette sur une zone : liaisons FlightGear appliquées aux propriétés ; renvoie ce qui a changé
    // button : 0 clic gauche (ou côté droit), 2 côté gauche, 3 molette vers le haut, 4 vers le bas
    activate(pick, button) {
        // Pas de liaison pour ce geste : on essaie les suivants. Clic à gauche (2) : sens inverse (bouton 1 de FlightGear),
        // sinon clic simple (0) ; molette : comme le clic dans un sens ou dans l'autre. Avant, un clic sur la moitié
        // gauche d'un interrupteur (qui n'a que le bouton 0) ne faisait rien : un clic sur deux était perdu
        const order = { 0: [0, 3], 2: [2, 1, 4, 0], 3: [3, 0], 4: [4, 1, 0] }[button] ?? [button, 0];
        let result = null;
        for (const b of order) {
            result = this.animator.activate(pick, b);
            if (result.changed.length || result.nasal.length || result.game.length) break;
        }
        return result;
    }

    // Valeurs du jeu -> propriétés FlightGear lues par les animations ; state : cockpitState() du simulateur, plus
    // state.heli (modèle de vol) et state.r44 (systèmes)
    update(delta, state) {
        if (!this.ready) return;
        const a = this.animator, sys = state.systems, heli = state.heli ?? {}, inputs = state.inputs ?? {};
        this._clock += delta;
        const powered = sys.busPowered;
        const panelLight = powered ? Math.max(sys.panelLights ?? 0, this._night * 0.8) : 0;
        const warn = sys.warnings ?? {};
        // Portes : s'ouvrent / se ferment en ~1,5 s
        for (let i = 0; i < 4; i++) this._doors[i] = MathUtils.clamp(this._doors[i] + (this.doorsOpen && i < 2 ? 1 : -1) * delta / 1.5, 0, 1);
        const glyphs = registrationGlyphs(this.registration);
        const time = new Date();
        const props = {
            // Rotors et commandes
            'controls/flight/rudder': -(heli.pedal ?? inputs.yaw ?? 0),
            'sim/multiplay/generic/float[15]': -(heli.pedal ?? 0),
            'sim/multiplay/generic/float[16]': -(heli.cyclicPitch ?? 0),
            'sim/multiplay/generic/float[17]': -(heli.cyclicRoll ?? 0),
            // (levier du collectif : la propriété FlightGear vaut 0 collectif en haut, 1 en bas, comme les gaz de YASim)
            'sim/multiplay/generic/float[10]': 1 - (heli.collective ?? 0),
            'sim/multiplay/generic/float[11]': this._doors[0], 'sim/multiplay/generic/float[12]': this._doors[1],
            'sim/multiplay/generic/float[13]': this._doors[2], 'sim/multiplay/generic/float[14]': this._doors[3],
            // Instruments de vol (state : cockpitState du simulateur, en m, m/s, degrés ; roulis : + = à gauche)
            'instrumentation/airspeed-indicator/indicated-speed-kt': state.onGround ? 0 : (state.speed ?? 0) / 0.5144,
            'instrumentation/altimeter/indicated-altitude-ft': (state.altitude ?? 0) / FT,
            'instrumentation/vertical-speed-indicator/indicated-speed-fpm': (state.verticalSpeed ?? 0) / FT * 60,
            'orientation/pitch-deg': state.pitchDeg ?? 0,
            'orientation/roll-deg': -MathUtils.radToDeg(state.roll ?? 0),
            'instrumentation/heading-indicator/indicated-heading-deg': state.heading ?? 0,
            'instrumentation/magnetic-compass/indicated-heading-deg': state.heading ?? 0,
            'instrumentation/yawstring': state.onGround ? 0 : MathUtils.clamp(-(heli.slipDeg ?? 0) * 2, -40, 40),
            'instrumentation/nav/heading-needle-deflection': state.nav1?.available ? MathUtils.clamp(state.nav1.deviation ?? 0, -10, 10) : 0,
            'instrumentation/nav/to-flag': Boolean(state.nav1?.available && state.nav1.to),
            'instrumentation/nav/from-flag': Boolean(state.nav1?.available && state.nav1.to === false),
            'instrumentation/clock/local-hour': time.getHours() + time.getMinutes() / 60,
            'instrumentation/clock/indicated-min': time.getMinutes() + time.getSeconds() / 60,
            'instrumentation/clock/indicated-sec': time.getSeconds() + (this._clock % 1),
            // Moteur et rotor
            'rotors/main/rpm': heli.rotorRpm ?? 0,
            'rotors/tail/rpm': (heli.rotorRpm ?? 0) * 6,
            'sim/model/r44/torque-pct': powered ? (sys.enginePercent ?? 0) : 0,
            'engines/engine/itt-norm': powered ? MathUtils.clamp(((sys.manifoldPressure ?? 0) - 10) / 25, 0, 1) : 0,
            'engines/engine/running': sys.running,
            'engines/engine/oil-pressure-psi': powered && sys.running ? 25 + 50 * Math.min(1, sys.rpm / 2000) : 0,
            'engines/engine/oil-temperature-degC': powered ? sys.oilTemp ?? 15 : 0,
            'engines/engine/fuel-pressure-psi': powered && (sys.running || sys.fuelPumpRunning) ? 6 + (sys.running ? 1.5 : 0) : 0,
            'consumables/fuel/tank/level-norm': powered ? sys.fuel[0] / 29.5 : 0,
            'consumables/fuel/tank[1]/level-norm': powered ? sys.fuel[1] / 17.2 : 0,
            'consumables/fuel/total-fuel-lbs': (sys.fuel[0] + sys.fuel[1]) * 6,
            'systems/electrical/amps': sys.amps ?? 0,
            'sim/model/r44/state': sys.clutchMoving ? 2 : sys.clutch >= 1 ? 5 : 0,
            // Interrupteurs (positions)
            'controls/electric/battery-switch': sys.switches.masterBat,
            'controls/electric/engine/generator': sys.switches.alternator,
            'controls/engines/engine/clutch': sys.switches.clutch,
            'controls/engines/engine/governor': sys.switches.governor,
            'controls/electric/key': Math.min(3, sys.key),
            'controls/engines/engine/starter': sys.key === 4 ? 1 : 0,
            'controls/engines/engine/mixture': sys.mixture,
            'sim/model/r44/controls/lighting/nav-lights': sys.switches.nav,
            'sim/model/r44/controls/lighting/beacon': sys.switches.strobe,
            'sim/multiplay/generic/bool[16]': sys.switches.land,
            'controls/rotor/brake': sys.rotorBrake ? 1 : 0,
            'controls/lighting/instruments-norm': panelLight,
            // Voyants
            // (sortie « éclairage des instruments » : > 0 sous tension, pour les voyants ; sa valeur règle la lueur du
            // transpondeur, avec le rhéostat)
            'systems/electrical/outputs/instrument-lights': powered ? Math.max(0.02, panelLight) : 0,
            'systems/electrical/outputs/starter': warn.starter ? 12 : 0,
            'instrumentation/alerts/rpm': Boolean(warn.lowRpm),
            'controls/lighting/turn-off-light': false,
            'sim/current-view/name': this._exterior ? 'Chase View' : 'Cockpit View',
            // Radios du jeu (kHz -> MHz) sur les tambours du KX 165, code et mode du transpondeur sur le KT 76A
            ...radioProps(state.avionics),
            // Immatriculation
            ...Object.fromEntries(glyphs.map((g, i) => [`sim/multiplay/generic/int[${i}]`, g])),
            'sim/multiplay/generic/float[22]': heli.bladePitchDeg ?? 0,
            'sim/multiplay/generic/float[23]': (heli.pedal ?? 0) * 12,
            'sim/multiplay/generic/float[18]': heli.coningDeg ?? 0, 'sim/multiplay/generic/float[19]': (heli.coningDeg ?? 0) * 0.5,
            'sim/multiplay/generic/float[20]': (heli.coningDeg ?? 0) * 0.25, 'sim/multiplay/generic/float[21]': (heli.coningDeg ?? 0) * 0.1,
            'sim/multiplay/generic/bool[1]': this.yokesVisible,
        };
        if (this._armIK) {
            [props['sim/r44/bras-epaule'], props['sim/r44/bras-coude']] = armAngles(this._armIK, props['sim/multiplay/generic/float[10]']);
        }
        a.assign(props);
        a.update(delta);
        // Voyant de la clé (texte du contacteur) : pour le message d'aide
        this.keyLabel = R44_KEY[sys.key];
    }
}

export {
    R44Cockpit, loadR44, cloneR44, paintR44, setRotorProps, registrationGlyphs, R44_LIVERIES, R44_DEFAULT_LIVERY, isR44Livery,
    R44_LIGHT_LAYOUT, R44_SKID_HEIGHT, R44_EYE, FT,
};
