import { Box3, Group, MathUtils, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FGAnimator } from './FGAnimator.js';
import { R44_KEY } from './R44Systems.js';

// Robinson R44 Raven II (modèle FlightGear d'Emmanuel Baranger, GPL-2.0, converti par asset/blender/build_r44.py) :
// extérieur (r44.glb), cockpit (r44-cockpit.glb) et leurs animations (r44-anim.json), rejouées par FGAnimator avec
// les valeurs du jeu. R44Cockpit a la même interface que Cockpit.js et F15Cockpit.js pour le simulateur (group, eye,
// clickables, controlAt, update, setExterior, setNight…) ; il porte aussi l'extérieur (exterior), à ranger dans le
// groupe de l'appareil.

const URL = 'asset/r44/';
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

// Œil du pilote (place de droite, comme sur le vrai R44) et hauteur des patins
const R44_EYE = new Vector3(0.252, -0.12, -3.405);
const R44_SKID_HEIGHT = 1.64;     // origine du modèle au-dessus du sol, appareil posé (bas des tubes des patins)

// Feux : position rouge à gauche et verte à droite (sur les montants du train), blanc à l'arrière de la poutre,
// anticollision rouge sur le cône arrière, deux phares dans le nez
const R44_LIGHT_LAYOUT = {
    scale: 1,
    beaconLight: [0, 0.55, 2.16],
    beam: [-0.065, -0.85, -4.6], taxiBeam: [0.065, -0.85, -4.6],
    lights: [
        { kind: 'nav', color: 0xff2414, position: [-0.62, -0.98, -3.36], sector: [deg(-110), deg(4)], size: 0.8, mesh: [] },
        { kind: 'nav', color: 0x18ff3c, position: [0.62, -0.98, -3.36], sector: [deg(-4), deg(110)], size: 0.8, mesh: [] },
        { kind: 'nav', color: 0xffffff, position: [0, 0.62, 4.2], sector: [deg(110), deg(250)], size: 0.7 },
        { kind: 'beacon', color: 0xff1a0a, position: [0, 0.45, 2.16], size: 1.2 },
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
        const texture = textureLoader.load(`${URL}liveries/${entry.file}.png`);
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
function prepareMaterials(root, cockpit) {
    root.traverse((mesh) => {
        if (!mesh.isMesh) return;
        mesh.castShadow = !cockpit;
        mesh.receiveShadow = true;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            material.metalness = 0;
            if (material.transparent) {
                material.depthWrite = false;
                material.roughness = 0.1;
                mesh.renderOrder = 3;
            } else material.roughness = Math.max(cockpit ? 0.7 : 0.45, material.roughness ?? 0.6);
        }
    });
}

async function loadR44() {
    const loader = new GLTFLoader();
    const [exterior, cockpit, data] = await Promise.all([
        loader.loadAsync(`${URL}r44.glb`), loader.loadAsync(`${URL}r44-cockpit.glb`),
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

// Copie de l'extérieur pour les autres joueurs : son propre animateur (rotors, cône, portes)
function cloneR44(template) {
    const group = template.clone(true);
    const animator = new FGAnimator(animData, [group]);
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
        this.animator.assign(STATIC_PROPS);
        // Régulateur : interrupteur au bout de la poignée du collectif (pas de zone cliquable dans le modèle FlightGear)
        const collective = cockpit.getObjectByName('m10__Collective');
        if (collective) this.animator.addPick([collective], [{ buttons: [0, 2], repeatable: false,
            bindings: [{ command: 'property-toggle', property: 'controls/engines/engine/governor' }] }], 'Collective');
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

    setNight(night) { this._night = night; }
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
        let result = this.animator.activate(pick, button);
        if (!result.changed.length && !result.nasal.length) {
            // Pas de liaison pour ce bouton : la molette fait comme le clic, et inversement
            const fallback = { 3: 0, 4: 1, 2: 1, 0: 3 }[button];
            if (fallback !== undefined) result = this.animator.activate(pick, fallback);
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
            'sim/multiplay/generic/float[10]': heli.collective ?? 0,
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
            'systems/electrical/outputs/instrument-lights': powered ? 12 : 0,
            'systems/electrical/outputs/starter': warn.starter ? 12 : 0,
            'instrumentation/alerts/rpm': Boolean(warn.lowRpm),
            'controls/lighting/turn-off-light': false,
            'sim/current-view/name': this._exterior ? 'Chase View' : 'Cockpit View',
            // Immatriculation
            ...Object.fromEntries(glyphs.map((g, i) => [`sim/multiplay/generic/int[${i}]`, g])),
            'sim/multiplay/generic/float[22]': heli.bladePitchDeg ?? 0,
            'sim/multiplay/generic/float[23]': (heli.pedal ?? 0) * 12,
            'sim/multiplay/generic/float[18]': heli.coningDeg ?? 0, 'sim/multiplay/generic/float[19]': (heli.coningDeg ?? 0) * 0.5,
            'sim/multiplay/generic/float[20]': (heli.coningDeg ?? 0) * 0.25, 'sim/multiplay/generic/float[21]': (heli.coningDeg ?? 0) * 0.1,
            'sim/multiplay/generic/bool[1]': this.yokesVisible,
        };
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
