import {
    Box3,
    AdditiveBlending,
    CanvasTexture,
    Group,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    DoubleSide,
    PlaneGeometry,
    RepeatWrapping,
    Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeStatic } from './MergeStatic.js';
import { JET_MIL } from './JetSystems.js';
import { isTablet } from './Device.js';
import { F15Displays } from './F15Displays.js';

// Cockpit du F-15C (FlightGear, cockpit photo de geneb : asset/f15/f15-cockpit.glb, voir F15Model.js), comme Cockpit.js
// pour le Cessna : même interface pour le simulateur (group, eye, clickables, controlAt, update, setExterior…).
// Instruments animés d'après les tables du modèle FlightGear (all-interior.xml, poste avant) : badin à cadran tournant
// et échelle de Mach, incidence, accéléromètre (et ses aiguilles de mini / maxi), horizon artificiel (sphère, index
// d'inclinaison, bille), altimètre (aiguille et tambours), variomètre, HSI, pendule ; moteurs : régime N2, température,
// débit, ouverture des tuyères (aiguilles et compteurs), carburant (aiguille et compteurs total / gauche / droite) ;
// voyants (JFS READY, génératrices, train verrouillé, volets, verrière, alarme principale). Manche, manettes des gaz,
// palonniers, poignée du train, poignée du JFS, interrupteurs des réacteurs. HUD : symbologie dessinée sur le verre du
// collimateur (échelle d'assiette, vecteur vitesse, cap, vitesse, altitude, Mach, g, incidence).
// Repère : celui de l'avion (le cockpit est à sa place dans le modèle, à taille réelle).

// Appareils tactiles (iPhone, iPad) : photo du cockpit en 2048 × 2048 au lieu de 4096 (~21 Mo de mémoire graphique au
// lieu de ~85 : en pleine définition, Safari fermait l'onglet), voir asset/blender/shrink_glb.py
const LOW_MEMORY = isTablet();
const COCKPIT_URL = LOW_MEMORY ? 'asset/f15/f15-cockpit-mobile.glb' : 'asset/f15/f15-cockpit.glb';
const EYE = new Vector3(0, 1.40, -5.0);
const KT = 1.94384, FT = 3.28084;
const deg = MathUtils.degToRad;
const fg = (x, y, z) => new Vector3(y, z, x);

function table(points) {
    return (v) => {
        if (!(v > points[0][0])) return points[0][1];
        for (let i = 1; i < points.length; i++) {
            if (v <= points[i][0]) {
                const [x0, y0] = points[i - 1], [x1, y1] = points[i];
                return y0 + (y1 - y0) * (v - x0) / (x1 - x0);
            }
        }
        return points[points.length - 1][1];
    };
}

const ASI = table([[0, 0], [40, 16], [75, 31], [100, 45], [117, 61], [135, 75], [150, 90], [170, 104], [185, 120], [200, 134], [250, 156], [300, 180], [350, 204], [400, 224], [500, 251], [600, 280], [700, 305], [1050, 345]]);
const MACH = table([[0, 0], [0.8, 90], [1.4, 180], [2.2, 270], [2.6, 315]]);
const G_METER = table([[-5, -202.5], [-4, -112.5], [-3, -90], [-1, -45], [0, -22.5], [1, 0], [3, 45], [5, 90], [7, 135], [9, 180], [10, 202.5]]);
const AOA = table([[0, 0], [40, -302], [50, -334]]);
const VSI = table([[-6000, -263], [-4000, -238], [-2000, -198], [-1000, -161], [-500, -129], [0, -90], [500, -51], [1000, -19], [2000, 19], [4000, 57], [6000, 81]]);
const BACKUP_ASI = table([[0, 0], [60, 13], [100, 45], [150, 161], [170, 180], [200, 210], [300, 250], [400, 270], [850, 345]]);

// Rotations (repère FlightGear : x vers l'arrière, y à droite, z en haut) : pièces, centre, axe, angle (degrés) selon l'état
const ROTATIONS = [
    { names: ['face', 'mach-scale'], center: [-5.7005, -0.1427, 0.9963], axis: [-1, 0, 0], angle: (s) => ASI(s.kt) },
    { names: ['mach-scale'], center: [-5.7005, -0.1427, 0.9963], axis: [1, 0, 0], angle: (s) => MACH(s.mach), inner: true },
    { names: ['needle'], center: [-5.7039, -0.132, 0.9186], axis: [-1, 0, 0], angle: (s) => AOA(s.aoaUnits) },
    { names: ['a_needle'], center: [-5.7096, -0.133, 0.856], axis: [-1, 0, 0], angle: (s) => G_METER(s.g) },
    { names: ['needle-max'], center: [-5.7096, -0.133, 0.856], axis: [-1, 0, 0], angle: (s) => G_METER(s.gMax) },
    { names: ['needle-min'], center: [-5.7096, -0.133, 0.856], axis: [-1, 0, 0], angle: (s) => G_METER(s.gMin) },
    { names: ['sphere'], center: [-5.7436, 0.012, 0.9862], axis: [1, 0, 0], angle: (s) => s.rollDeg },
    { names: ['sphere'], center: [-5.7436, 0.012, 0.9862], axis: [0, 1, 0], angle: (s) => s.pitchDeg, inner: true },
    { names: ['bank-index'], center: [-5.7052, 0.01, 0.9924], axis: [-1, 0, 0], angle: (s) => s.rollDeg },
    { names: ['slip-ball'], center: [-5.7037, 0.01, 1.0139], axis: [-1, 0, 0], angle: (s) => s.slip * 8 },
    { names: ['a_needle_1'], center: [-5.70147, 0.17061, 0.9943], axis: [-1, 0, 0], angle: (s) => s.ft * 0.36 },
    { names: ['vsi-needle'], center: [-5.6968, 0.1554, 0.9168], axis: [-1, 0, 0], angle: (s) => VSI(s.fpm) },
    { names: ['bearing-needle-1', 'HSI-compass-card'], center: [-5.7037, 0.0127, 0.8688], axis: [1, 0, 0], angle: (s) => s.heading },
    { names: ['HourHand'], center: [-5.698, 0.15158, 0.8545], axis: [-1, 0, 0], angle: (s) => s.clock / 120 },
    { names: ['MinuteHand'], center: [-5.698, 0.15158, 0.8545], axis: [-1, 0, 0], angle: (s) => s.clock * 0.1 },
    { names: ['SecondHand'], center: [-5.698, 0.15158, 0.8545], axis: [-1, 0, 0], angle: (s) => (s.clock % 60) * 6 },
    { names: ['needle-fan-l'], center: [-5.7033, 0.2432, 1.0132], axis: [-1, 0, 0], angle: (s) => s.n2[0] * 2.25 },
    { names: ['needle-fan-r'], center: [-5.7033, 0.3001, 1.0132], axis: [-1, 0, 0], angle: (s) => s.n2[1] * 2.25 },
    { names: ['needle-temp-l'], center: [-5.7032, 0.2419, 0.9559], axis: [-1, 0, 0], angle: (s) => table([[200, 0], [1400, 235]])(s.egt[0]) },
    { names: ['needle-temp-r'], center: [-5.7032, 0.2986, 0.9566], axis: [-1, 0, 0], angle: (s) => table([[200, 0], [1400, 235]])(s.egt[1]) },
    { names: ['needle-fuel-l'], center: [-5.7032, 0.2118, 0.895], axis: [-1, 0, 0], angle: (s) => s.ffPph[0] / 100000 * 235 },
    { names: ['needle-fuel-r'], center: [-5.7033, 0.2695, 0.8947], axis: [-1, 0, 0], angle: (s) => s.ffPph[1] / 100000 * 235 },
    { names: ['needle-nozl-l'], center: [-5.7037, 0.2126, 0.8432], axis: [-1, 0, 0], angle: (s) => s.nozzle[0] * 235 },
    { names: ['needle-nozl-r'], center: [-5.7037, 0.2681, 0.8444], axis: [-1, 0, 0], angle: (s) => s.nozzle[1] * 235 },
    { names: ['needle-oil-l'], center: [-5.7038, 0.3426, 0.9542], axis: [-1, 0, 0], angle: (s) => s.oil[0] * 3.1 },
    { names: ['needle-hyd-1'], center: [-5.7037, 0.341, 1.0215], axis: [-1, 0, 0], angle: (s) => s.hyd / 4000 * 310 },
    { names: ['fg_needle'], center: [-5.6888, 0.3406, 0.8943], axis: [-1, 0, 0], angle: (s) => s.fuelLb / 15000 * 215 },
    { names: ['balt-needle-feet'], center: [-5.6951, 0.0832, 0.7699], axis: [-1, 0, 0], angle: (s) => s.ft * 0.36 },
    { names: ['balt-needle-100-feet'], center: [-5.6951, 0.0832, 0.7699], axis: [-1, 0, 0], angle: (s) => s.ft * 0.036 },
    { names: ['balt-needle-1000-feet'], center: [-5.6951, 0.0832, 0.7699], axis: [-1, 0, 0], angle: (s) => s.ft * 0.0036 },
    { names: ['basi-needle-knots'], center: [-5.6979, -0.0566, 0.7709], axis: [-1, 0, 0], angle: (s) => BACKUP_ASI(s.kt) },
    // Manche : tangage (tout le manche), roulis (la poignée) ; manettes des gaz (ralenti -> MIL -> postcombustion)
    { names: ['stick-handle-parts', 'pickle-button', 'stick-mast'], center: [-5.5126, -0.0468, 0.3764], axis: [0, -1, 0], angle: (s) => -s.stickPitch * 18 },   // cabrer (+) : manche tiré vers le pilote
    { names: ['stick-handle-parts', 'pickle-button'], center: [-5.5126, 0.0139, 0.6024], axis: [-1, 0, 0], angle: (s) => -s.stickRoll * 20, inner: true },
    { names: ['throttle-left-wire', 'throttle-left-manual-sbr-switch', 'throttle-left-finger-lift', 'left-throttle-grip'], center: [-5.4852, -0.3714, 0.645], axis: [0, -1, 0], angle: (s) => s.throttleDeg },
    { names: ['throttle-missile-select-switch', 'throttle-speedbrake-switch-mount', 'throttle-microphone-switch', 'throttle-target-designator-switch',
        'throttle-right-grip', 'throttle-right-finger-lift', 'throttle-target-designator-switch-mount', 'throttle-speedbrake-switch'],
    center: [-5.4919, -0.3287, 0.6426], axis: [0, -1, 0], angle: (s) => s.throttleDeg },
    // Interrupteurs de la mise en route
    { names: ['l-eng-master-switch'], center: [-5.617, 0.3089, 0.67669], axis: [0, -1, 0], angle: (s) => (s.sw.masterL ? 0 : -70) },
    { names: ['r-eng-master-switch'], center: [-5.617, 0.39689, 0.67669], axis: [0, -1, 0], angle: (s) => (s.sw.masterR ? 0 : -70) },
    { names: ['eng-gen-left-switch'], center: [-5.65485, 0.30604, 0.68], axis: [0, -1, 0], angle: (s) => (s.sw.genL ? 0 : -50) },
    { names: ['eng-gen-right-switch'], center: [-5.65485, 0.32359, 0.68], axis: [0, -1, 0], angle: (s) => (s.sw.genR ? 0 : -50) },
    { names: ['eng-emerg-gen-switch'], center: [-5.65456, 0.35292, 0.67552], axis: [0, -1, 0], angle: (s) => (s.sw.battery ? 0 : -40) },
    { names: ['eng-jfs-switch'], center: [-5.6105, 0.3632, 0.67], axis: [0, -1, 0], angle: (s) => (s.crank === 0 ? -20 : s.crank === 1 ? 20 : 0) },
    { names: ['misc-ldg-light-switch'], center: [-5.6611, -0.4441, 0.6541], axis: [0, 1, 0], angle: (s) => (s.sw.land ? 30 : s.sw.taxi ? -30 : 0) },
];

// Tambours (compteurs) : décalage de texture, comme les « textranslate » de FlightGear : ((valeur arrondie au pas) +
// décalage) × facteur
const DRUMS = [
    ['drum-1', (s) => s.ft, 0.001, 100, -100], ['drum-4', (s) => s.ft, 0.01, 10, -10], ['drum-2', (s) => s.ft, 0.0001, 1000, -1000], ['drum-3', (s) => s.ft, 0.00001, 10000, -10000],
    ['l-n1-1', (s) => s.n2[0], 0.001, 100, -100], ['l-n1-2', (s) => s.n2[0], 0.01, 10, -10], ['l-n1-3', (s) => s.n2[0], 0.1, 1, -1],
    ['r-n1-1', (s) => s.n2[1], 0.001, 100, -100], ['r-n1-2', (s) => s.n2[1], 0.01, 10, -10], ['r-n1-3', (s) => s.n2[1], 0.1, 1, -1],
    ['l-egt-3', (s) => s.egt[0], 0.01, 10, -10], ['l-egt-4', (s) => s.egt[0], 0.1, 1, -1], ['r-egt-3', (s) => s.egt[1], 0.01, 10, -10], ['r-egt-4', (s) => s.egt[1], 0.1, 1, -1],
    ['l-egt-2', (s) => s.egt[0], 0.001, 100, -100], ['r-egt-2', (s) => s.egt[1], 0.001, 100, -100],
    ['l-ff-1', (s) => s.ffPph[0], 0.00001, 10000, -10000], ['l-ff-2', (s) => s.ffPph[0], 0.0001, 1000, -1000], ['l-ff-3', (s) => s.ffPph[0], 0.001, 100, -100], ['l-ff-4', (s) => s.ffPph[0], 0.01, 10, -10],
    ['r-ff-1', (s) => s.ffPph[1], 0.00001, 10000, -10000], ['r-ff-2', (s) => s.ffPph[1], 0.0001, 1000, -1000], ['r-ff-3', (s) => s.ffPph[1], 0.001, 100, -100], ['r-ff-4', (s) => s.ffPph[1], 0.01, 10, -10],
    ['total-1', (s) => s.fuelLb, 0.00001, 10000, -10000], ['total-2', (s) => s.fuelLb, 0.0001, 1000, -1000], ['total-3', (s) => s.fuelLb, 0.001, 100, -100], ['total-4', (s) => s.fuelLb, 0.01, 10, -10], ['total-5', (s) => s.fuelLb, 0.1, 1, 0],
    ['L-1', (s) => s.fuelLb / 2, 0.0001, 1000, -1000], ['L-2', (s) => s.fuelLb / 2, 0.001, 100, -100], ['L-3', (s) => s.fuelLb / 2, 0.01, 10, -10], ['L-4', (s) => s.fuelLb / 2, 0.1, 0, -1],
    ['R-1', (s) => s.fuelLb / 2, 0.0001, 1000, -1000], ['R-2', (s) => s.fuelLb / 2, 0.001, 100, -100], ['R-3', (s) => s.fuelLb / 2, 0.01, 10, -10], ['R-4', (s) => s.fuelLb / 2, 0.1, 0, -1],
];

// Voyants : pièce « allumée » montrée selon l'état (la pièce éteinte, s'il y en a une, est cachée à la place)
const LAMPS = [
    ['jfs-ready-lamp-on', (s) => s.jfsReady, 'jfs-ready-lamp-off'],
    ['master-caution-button-on', (s) => s.caution],
    ['ca-l-gen-out', (s) => s.powered && s.warn.genL],
    ['ca-r-gen-out', (s) => s.powered && s.warn.genR],
    ['ca-jfs-low', (s) => s.powered && s.jfsRunning && !s.jfsReady],
    ['light-locked-left', (s) => s.powered && s.gear > 0.99],
    ['light-locked-nose', (s) => s.powered && s.gear > 0.99],
    ['light-locked-right', (s) => s.powered && s.gear > 0.99],
    ['landing-gear-handle-lit', (s) => s.powered && s.gear > 0.01 && s.gear < 0.99, 'landing-gear-handle-unlit'],
    ['flaps-light-down', (s) => s.powered && s.flaps > 0.98],
    ['flaps-light-transit', (s) => s.powered && s.flaps > 0.02 && s.flaps < 0.98],
    ['canopy-unlocked-light-on', (s) => s.powered && s.canopy > 0.01],
    ['cas-takeoff-trim-lamp-on', () => false],
    ['adi-light-on', () => false], ['ag-light-on', () => false], ['ai-light-on', () => false], ['vi-light-on', () => false], ['sam-light-on', () => false],
];
// Drapeaux OFF des instruments : visibles sans courant
const FLAGS = ['off-flag', 'a_off-flag', 'ag_off-flag', 'fg_off-flag', 'h_off-flag', 'vsi-off-flag', 'mach-flag'];

// Commandes cliquables : pièce -> commande (voir simulator.js : useControl)
const CONTROLS = {
    'jfs-start-handle': 'jet:jfs',
    'eng-jfs-switch': 'jet:crank',
    'l-eng-master-switch': 'jet:masterL', 'l-eng-master-guard': 'jet:masterL',
    'r-eng-master-switch': 'jet:masterR', 'r-eng-master-guard': 'jet:masterR',
    'eng-gen-left-switch': 'jet:genL', 'eng-gen-right-switch': 'jet:genR',
    'eng-emerg-gen-switch': 'jet:battery',
    'landing-gear-handle-lit': 'jet:gear', 'landing-gear-handle-unlit': 'jet:gear',
    'anti-collision-switch': 'jet:strobe',
    'position-light-brightness-knob': 'jet:nav',
    'misc-ldg-light-switch': 'jet:lights',
    'throttle-speedbrake-switch': 'jet:speedbrake',
    'canopy-unlocked-light': 'jet:canopy', 'canopy-unlocked-light-on': 'jet:canopy',
    'left-throttle-grip': 'throttle', 'throttle-right-grip': 'throttle',
    'master-caution-button': 'jet:caution', 'master-caution-button-on': 'jet:caution',
};

class F15Cockpit {
    constructor() {
        this.group = new Group();
        this.group.name = 'F15Cockpit';
        this.eye = EYE.clone();
        this.clickables = [];
        this.ready = false;
        this.yokesVisible = true;
        this.panel = { turnKnob() {} };   // (pas de boutons rotatifs dessinés : compatibilité avec Cockpit.js)
        this._time = 0;
        this._clock = 0;
        this._gMax = 1;
        this._gMin = 1;
        this._smooth = { pitch: 0, roll: 0, yaw: 0, vs: 0, g: 1, slip: 0 };
        this._caution = false;
        this._cautionAck = '';
        this.displays = new F15Displays();   // VSD (radar), TEWS (alerte radar), MPCD (armement)
        this.hud = new F15Hud();
        this.hud.mesh.position.set(0.0095, 1.386, -5.70);   // sur le verre du collimateur (deux vitres : y 1,25 -> 1,52)
        this.group.add(this.hud.mesh);
    }

    async load() {
        const gltf = await new GLTFLoader().loadAsync(COCKPIT_URL);
        const scene = gltf.scene;   // (ajouté au groupe après la fusion : le groupe peut être caché, voir mergeStatic)
        const byName = new Map();
        scene.traverse((o) => {
            if (o === scene) return;
            if (o.parent === scene) byName.set(o.name, o);
            if (o.isMesh) {
                o.receiveShadow = true;
                o.castShadow = false;
                // Photo du cockpit : ombrages déjà dans la texture, un peu d'éclairage propre (pas de noir sous la casquette)
                if (o.material.map) {
                    o.material.emissive?.set(0xffffff);
                    o.material.emissiveMap = o.material.map;
                    o.material.emissiveIntensity = 0.12;
                }
                o.material.metalness = 0;
                o.material.roughness = Math.max(0.6, o.material.roughness ?? 0.6);
            }
        });
        const get = (name) => byName.get(name.replace(/\s/g, '_').replace(/[[\]\.:/]/g, ''));
        // Images du HUD et des écrans du modèle (transparentes) : cachées, le HUD est dessiné à part
        // Verre du collimateur : les vitres du modèle (forme et inclinaison réelles), en verre teinté visible (leur image
        // d'origine était transparente : on ne voyait pas le verre) ; chants sombres. La symbologie est dessinée à part
        const glass = new MeshStandardMaterial({
            color: 0x6f9c8c, transparent: true, opacity: 0.11, roughness: 0.08, metalness: 0.6, depthWrite: false, side: DoubleSide,
        });
        // (jonction des deux vitres : translucide, sous la symbologie, qui reste lisible par-dessus)
        const bevel = new MeshStandardMaterial({
            color: 0x23302f, transparent: true, opacity: 0.35, roughness: 0.4, metalness: 0.3, depthWrite: false, side: DoubleSide,
        });
        for (const name of ['HUDImage1', 'HUDImage2', 'HUDImageBevels']) {
            get(name)?.traverse((m) => {
                if (!m.isMesh) return;
                m.material = name === 'HUDImageBevels' ? bevel : glass;
                m.renderOrder = 5;
            });
        }
        scene.updateMatrixWorld(true);
        const keep = new Set();
        // Rotations : pivots emboîtés dans l'ordre FlightGear (inner : à l'intérieur du pivot précédent des mêmes pièces)
        this._rotations = [];
        const owner = new Map();   // pièce -> dernier pivot qui la porte
        for (const def of ROTATIONS) {
            const objects = def.names.map(get).filter(Boolean);
            if (!objects.length) continue;
            const pivot = new Group();
            pivot.position.copy(fg(...def.center));
            pivot.userData.axis = fg(...def.axis).normalize();
            // Pivot posé dans le repère du cockpit, puis rangé dans le pivot qui porte déjà ces pièces (inner) : attach
            // garde la position (tous les pivots sont au neutre pendant la construction)
            const parent = def.inner ? owner.get(objects[0]) ?? scene : scene;
            scene.add(pivot);
            scene.updateMatrixWorld(true);
            for (const o of objects) {
                pivot.attach(o);
                owner.set(o, pivot);
            }
            if (parent !== scene) parent.attach(pivot);
            keep.add(pivot);
            this._rotations.push({ pivot, angle: def.angle });
        }
        // Tambours : chaque compteur a sa propre texture décalée
        this._drums = [];
        for (const [name, value, factor, step, offset] of DRUMS) {
            const o = get(name);
            if (!o?.isMesh || !o.material.map) continue;
            o.material = o.material.clone();
            o.material.map = o.material.map.clone();
            o.material.map.wrapS = o.material.map.wrapT = RepeatWrapping;
            o.material.map.needsUpdate = true;
            keep.add(o);
            this._drums.push({ map: o.material.map, value, factor, step, offset, last: NaN });
        }
        this._lamps = [];
        for (const [name, on, offName] of LAMPS) {
            const lit = get(name), off = offName ? get(offName) : null;
            if (!lit) continue;
            keep.add(lit);
            if (off) keep.add(off);
            this._lamps.push({ lit, off, on });
        }
        this._flags = FLAGS.map(get).filter(Boolean);
        for (const f of this._flags) keep.add(f);
        // Palonniers : avancent / reculent
        this._pedals = ['rudder-pedal-left', 'rudder-pedal-right'].map(get).filter(Boolean).map((o, i) => {
            keep.add(o);
            return { o, z: o.position.z, side: i ? -1 : 1 };
        });
        // Commandes cliquables
        for (const [name, id] of Object.entries(CONTROLS)) {
            const o = get(name);
            if (!o) continue;
            o.userData.control = id;
            keep.add(o);
            o.traverse((m) => { if (m.isMesh) this.clickables.push(m); });
        }
        for (const name of ['HUDImage1', 'HUDImage2', 'HUDImageBevels']) { const o = get(name); if (o) keep.add(o); }
        // Le reste (des centaines de pièces fixes) fusionné par matériau
        // Écrans : surfaces du modèle remplacées par les écrans dessinés en direct (F15Displays.js)
        const surface = (name) => {
            const o = get(name);
            if (!o) return null;
            o.visible = false;
            const box = new Box3().setFromObject(o);
            const size = box.getSize(new Vector3());
            return { center: box.getCenter(new Vector3()), width: size.x, height: size.y };
        };
        const vsd = surface('VSDImage'), tews = surface('TEWSImage'), mpcd = surface('MPCDImage');
        if (vsd && tews && mpcd) this.clickables.push(...this.displays.build(this.group, { vsd, tews, mpcd }));
        mergeStatic(scene, (o) => keep.has(o));
        this.group.add(scene);
        this.ready = true;
    }

    // --- Interface commune avec Cockpit.js ---
    setExterior(exterior) {
        this._exterior = exterior;
        this.hud.mesh.visible = !exterior;
    }
    setNight(night) {
        this._night = night;
    }
    setRain() {}
    setYokesVisible(visible) { this.yokesVisible = visible; }
    setYokesHiddenByView() {}
    toggleVisor() {}
    fitInsideHull() {}
    addCabinShell() {}
    setWindshieldGlass() {}

    controlAt(hit) {
        let root = hit.object;
        while (root && !root.userData.control && root !== this.group) root = root.parent;
        if (!root?.userData.control) return null;
        const point = this.group.worldToLocal(hit.point.clone());
        const center = this.group.worldToLocal(root.getWorldPosition(new Vector3()));
        // (pièces fusionnées à l'origine : le centre de la pièce elle-même, pris sur sa géométrie)
        if (root.isMesh) {
            root.geometry.computeBoundingBox();
            root.geometry.boundingBox.getCenter(center);
            root.localToWorld(center);
            this.group.worldToLocal(center);
        }
        return { id: root.userData.control, side: point.x < center.x ? -1 : 1, vertical: point.y > center.y ? -1 : 1 };
    }

    // state : comme pour Cockpit.update, plus l'état propre au F-15 (state.jet, voir simulator.js : cockpitState)
    update(delta, state) {
        if (!this.ready) return;
        this._time += delta;
        const sys = state.systems, jet = state.jet ?? {};
        const s = this._smooth;
        const k = 1 - Math.exp(-10 * delta);
        s.pitch += (state.inputs.pitch - s.pitch) * k;
        s.roll += (state.inputs.roll - s.roll) * k;
        s.yaw += (state.inputs.yaw - s.yaw) * k;
        s.vs += (state.verticalSpeed - s.vs) * (1 - Math.exp(-2 * delta));
        s.g += ((jet.g ?? 1) - s.g) * (1 - Math.exp(-6 * delta));
        s.slip += (MathUtils.clamp(-(state.sideAcceleration ?? 0) / 9.81 * 3.3, -1, 1) - s.slip) * (1 - Math.exp(-4 * delta));
        if (!state.crashed && !state.onGround) {
            this._gMax = Math.max(this._gMax, s.g);
            this._gMin = Math.min(this._gMin, s.g);
        }
        if (state.onGround && Math.abs(state.speed) < 1) this._gMax = this._gMin = 1;
        this._clock = (Date.now() / 1000) % 43200;
        const powered = sys.busPowered;
        const engines = sys.engines ?? [];
        const n2 = engines.map((e) => e.n2);
        const ab = engines.map((e) => e.ab);
        const warn = sys.warnings ?? {};
        const cautionKey = JSON.stringify([warn.genL, warn.genR, warn.bingo]);
        if (cautionKey !== this._cautionKey) {
            this._cautionKey = cautionKey;
            this._caution = Boolean(warn.genL || warn.genR || warn.bingo) && cautionKey !== this._cautionAck;
        }
        const throttle = state.throttle;
        const v = {
            kt: powered ? state.speed * KT : 0,
            mach: powered ? (jet.mach ?? 0) : 0,
            aoaUnits: powered ? MathUtils.clamp((jet.alpha ?? 0) * 1.1 + 10 * (state.onGround ? 0 : 0), 0, 45) : 0,
            g: s.g, gMax: this._gMax, gMin: this._gMin,
            rollDeg: MathUtils.radToDeg(state.roll), pitchDeg: state.pitchDeg,
            slip: s.slip,
            ft: state.altitude * FT,
            fpm: s.vs * FT * 60,
            heading: state.heading,
            clock: this._clock,
            n2: powered ? n2 : [0, 0],
            egt: engines.map((e) => (powered && e.running ? 380 + (e.n2 - 60) * 9 + e.ab * 250 : powered ? 60 + e.n2 * 6 : 0)),
            ffPph: engines.map((e, i) => (powered ? (jet.fuelFlowKgH?.[i] ?? 0) * 2.2046 : 0)),
            // (même ouverture que les pétales, voir F15Model.animateF15)
            nozzle: engines.map((e) => (powered ? MathUtils.clamp(e.ab > 0.02 ? 0.4 + 0.6 * e.ab : e.n2 < 70 ? 0.8 - (e.n2 - 60) * 0.06 : 0.2 * (1 - (e.n2 - 70) / 30), 0, 1) : 0)),
            oil: engines.map((e) => (powered && e.running ? 25 + e.n2 * 0.35 : 0)),
            hyd: engines.some((e) => e.n2 > 40) ? 3000 : 0,
            fuelLb: powered ? (sys.fuelKg ?? 0) * 2.2046 : 0,
            stickPitch: s.pitch, stickRoll: s.roll,
            throttleDeg: throttle <= JET_MIL ? -20 + 26 * throttle / JET_MIL : 6 + 10 * (throttle - JET_MIL) / (1 - JET_MIL),
            sw: sys.switches ?? {},
            crank: sys.crank ?? -1,
            jfsReady: powered && sys.jfsReady, jfsRunning: sys.jfsRunning,
            caution: powered && this._caution,
            powered, warn,
            gear: jet.gear ?? 1, flaps: state.flaps, canopy: jet.canopy ?? 0,
        };
        for (const r of this._rotations) r.pivot.quaternion.setFromAxisAngle(r.pivot.userData.axis, deg(r.angle(v) || 0));
        for (const d of this._drums) {
            const raw = d.value(v) || 0;
            const value = d.step ? Math.floor(raw / d.step) * d.step : raw;
            const shift = (value + d.offset) * d.factor;
            if (shift !== d.last) {
                d.last = shift;
                d.map.offset.y = shift;
            }
        }
        for (const lamp of this._lamps) {
            const on = Boolean(lamp.on(v));
            lamp.lit.visible = on;
            if (lamp.off) lamp.off.visible = !on;
        }
        for (const flag of this._flags) flag.visible = !powered;
        for (const p of this._pedals) p.o.position.z = p.z - p.side * s.yaw * 0.07;
        const radar = jet.radar;
        if (radar) {
            this.displays.update({
                time: this._time, delta, powered, radarPower: powered && sys.generatorOn, onGround: state.onGround,
                own: { position: radar.position, heading: state.heading, pitchDeg: state.pitchDeg, rollDeg: MathUtils.radToDeg(state.roll), altitudeFt: v.ft },
                targets: radar.targets, sites: radar.sites, gun: 940, masterArm: false, fuelLb: v.fuelLb,
            });
        }
        this.hud.update(this._time, { ...v, powered, speedKt: state.speed * KT, alpha: jet.alpha ?? 0, beta: jet.beta ?? 0, gear: jet.gear ?? 1, ab: Math.max(...(ab.length ? ab : [0])), throttle });
    }

    // Alarme principale : un clic l'acquitte (jusqu'à la prochaine panne)
    acknowledgeCaution() {
        this._cautionAck = this._cautionKey;
        this._caution = false;
    }
}

// HUD : symbologie verte sur le verre du collimateur, à 69 cm de l'œil : les angles sont convertis en distances sur
// le verre (repère de l'œil), l'horizon dessiné recouvre donc le vrai horizon vu à travers
const HUD_SIZE = [0.17, 0.27];          // m (largeur entre les montants, hauteur du verre)
const HUD_DISTANCE = 0.69;              // m de l'œil
const HUD_CENTER_ABOVE_EYE = -0.014;    // m : centre du verre sous l'axe de l'œil
const HUD_PX = 512;
class F15Hud {
    constructor() {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(HUD_PX * HUD_SIZE[0] / HUD_SIZE[1]);
        canvas.height = HUD_PX;
        this.ctx = canvas.getContext('2d');
        this.texture = new CanvasTexture(canvas);
        this.mesh = new Mesh(new PlaneGeometry(...HUD_SIZE), new MeshBasicMaterial({
            map: this.texture, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
        }));
        this.mesh.renderOrder = 6;
        this.mesh.visible = false;
        this._next = 0;
    }

    // Degrés -> pixels sur le verre
    _px(degrees) {
        return Math.tan(deg(degrees)) * HUD_DISTANCE / HUD_SIZE[1] * HUD_PX;
    }

    update(time, s) {
        if (!this.mesh.visible || time < this._next) return;
        this._next = time + 1 / 30;
        const ctx = this.ctx, W = ctx.canvas.width, H = ctx.canvas.height;
        ctx.clearRect(0, 0, W, H);
        if (!s.powered) {
            this.texture.needsUpdate = true;
            return;
        }
        const green = 'rgba(80,255,120,0.95)';
        ctx.strokeStyle = ctx.fillStyle = green;
        ctx.lineWidth = 2.5;
        ctx.textBaseline = 'middle';
        // Zone utile : à l'intérieur du verre, entre les montants (rien ne déborde, tout est découpé à ce cadre)
        const L = 12, R = W - 12, T = 6, B = H - 10;
        ctx.save();
        ctx.beginPath();
        ctx.rect(L, T, R - L, B - T);
        ctx.clip();
        const cx = W / 2, cy = H / 2 + HUD_CENTER_ABOVE_EYE / HUD_SIZE[1] * H;   // axe de l'avion (point visé à l'infini)
        // Repère de l'avion (W)
        ctx.beginPath();
        ctx.moveTo(cx - 20, cy); ctx.lineTo(cx - 11, cy); ctx.lineTo(cx - 5, cy + 7); ctx.lineTo(cx, cy);
        ctx.lineTo(cx + 5, cy + 7); ctx.lineTo(cx + 11, cy); ctx.lineTo(cx + 20, cy);
        ctx.stroke();
        // Échelle d'assiette : tourne avec l'inclinaison, barreaux tous les 5° (pleins au-dessus, tirets en dessous) ;
        // dans la colonne du milieu, sans passer sous les cases de vitesse et d'altitude
        ctx.font = 'bold 14px monospace';
        ctx.save();
        ctx.beginPath();
        ctx.rect(L + 58, 48, R - L - 116, B - 48 - 34);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(deg(s.rollDeg));   // inclinaison à droite (roll < 0) : l'horizon tourne dans l'autre sens
        const pitch = s.pitchDeg;
        for (let p = Math.ceil((pitch - 25) / 5) * 5; p <= pitch + 25; p += 5) {
            const y = this._px(pitch - p);
            if (p === 0) {
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(-W, y); ctx.lineTo(-26, y); ctx.moveTo(26, y); ctx.lineTo(W, y);
                ctx.stroke();
                continue;
            }
            ctx.setLineDash(p < 0 ? [7, 5] : []);
            ctx.beginPath();
            const tick = p > 0 ? 7 : -7;
            ctx.moveTo(-52, y + tick); ctx.lineTo(-52, y); ctx.lineTo(-22, y);
            ctx.moveTo(22, y); ctx.lineTo(52, y); ctx.lineTo(52, y + tick);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.textAlign = 'right';
            ctx.fillText(String(Math.abs(p)), -55, y);
            ctx.textAlign = 'left';
            ctx.fillText(String(Math.abs(p)), 55, y);
        }
        ctx.restore();
        ctx.setLineDash([]);
        // Vecteur vitesse (où va l'avion) : incidence sous le repère, dérapage de côté. Hors du verre, il reste au bord,
        // barré d'une croix (comme sur un vrai HUD : symbole « limité »)
        if (s.speedKt > 30) {
            const rawX = cx - this._px(s.beta), rawY = cy + this._px(s.alpha);
            const fx = MathUtils.clamp(rawX, L + 70, R - 70), fy = MathUtils.clamp(rawY, 56, B - 44);
            ctx.beginPath();
            ctx.arc(fx, fy, 6, 0, Math.PI * 2);
            ctx.moveTo(fx - 16, fy); ctx.lineTo(fx - 6, fy); ctx.moveTo(fx + 6, fy); ctx.lineTo(fx + 16, fy);
            ctx.moveTo(fx, fy - 6); ctx.lineTo(fx, fy - 13);
            if (fx !== rawX || fy !== rawY) {
                ctx.moveTo(fx - 9, fy - 9); ctx.lineTo(fx + 9, fy + 9);
                ctx.moveTo(fx + 9, fy - 9); ctx.lineTo(fx - 9, fy + 9);
            }
            ctx.stroke();
        }
        // Cap (bande en haut), resserrée au milieu
        ctx.save();
        ctx.beginPath();
        ctx.rect(L + 40, T, R - L - 80, 50);
        ctx.clip();
        ctx.textAlign = 'center';
        const hdg = s.heading;
        for (let h = Math.ceil((hdg - 15) / 5) * 5; h <= hdg + 15; h += 5) {
            const x = cx + this._px(h - hdg);
            const major = ((h % 10) + 10) % 10 === 0;
            ctx.beginPath();
            ctx.moveTo(x, 34); ctx.lineTo(x, major ? 22 : 28);
            ctx.stroke();
            if (major) ctx.fillText(String(((Math.round(h) % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, 14);
        }
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(cx, 36); ctx.lineTo(cx - 5, 44); ctx.lineTo(cx + 5, 44); ctx.closePath();
        ctx.stroke();
        // Vitesse (gauche), altitude (droite), en cases
        ctx.font = 'bold 15px monospace';
        const box = (x, y, w, text) => {
            ctx.strokeRect(x, y - 11, w, 22);
            ctx.textAlign = 'right';
            ctx.fillText(text, x + w - 4, y + 1);
        };
        box(L + 2, cy - 40, 48, String(Math.round(s.speedKt)));
        box(R - 58, cy - 40, 56, String(Math.round(s.ft / 10) * 10));
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${s.fpm >= 0 ? '+' : ''}${Math.round(s.fpm / 10) * 10}`, R - 2, cy - 16);
        if (s.ab > 0.05) ctx.fillText('AB', R - 2, cy + 62);
        if (s.gear > 0.99) ctx.fillText('GEAR', R - 2, cy + 78);
        else if (s.gear > 0.01) ctx.fillText('GEAR…', R - 2, cy + 78);
        ctx.textAlign = 'left';
        ctx.fillText(`M ${s.mach.toFixed(2)}`, L + 2, cy + 62);
        ctx.fillText(`G ${s.g.toFixed(1)}`, L + 2, cy + 78);
        ctx.fillText(`α ${s.alpha.toFixed(1)}`, L + 2, cy + 94);
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(s.throttle * 100)} %`, cx, B - 44);   // (au-dessus de l'auvent, qui cache le bas du verre)
        ctx.restore();
        this.texture.needsUpdate = true;
    }
}

export { F15Cockpit };
