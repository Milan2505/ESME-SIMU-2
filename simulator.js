import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Utils3dLoader } from './js/Utils3d.js';
import { PlaneControls } from './js/PlaneControls.js';
import { loadCSV } from './js/DataLoader.js';
import { Terrain } from './js/Terrain.js';
import { Clouds } from './js/Clouds.js';
import { CloudLayer } from './js/CloudLayer.js';
import { StallWarning } from './js/StallWarning.js';
import { EngineSound } from './js/EngineSound.js';
import { SoundEffects } from './js/SoundEffects.js';
import { Graphics } from './js/Graphics.js';
import { Multiplayer } from './js/Multiplayer.js';
import { RemotePlayers, formatNM } from './js/RemotePlayers.js';
import { Airport } from './js/Airport.js';
import { NightSky } from './js/NightSky.js';
import { Storm } from './js/Storm.js';
import { Cockpit, vorIndicator } from './js/Cockpit.js';
import { VOR } from './js/VOR.js';
import { Systems } from './js/Systems.js';
import { CrashEffect } from './js/CrashEffect.js';
import { ControlSurfaces } from './js/ControlSurfaces.js';
import { Settings } from './js/Settings.js';
import { AircraftLights } from './js/AircraftLights.js';
import { ILS } from './js/ILS.js';
import { Radio } from './js/Radio.js';
import { MapView } from './js/MapView.js';
import { LIVERIES, DEFAULT_LIVERY, isLivery, paintAircraft } from './js/Liveries.js';

// Toujours la dernière version publiée, malgré le cache de 10 min de GitHub Pages (voir sw.js)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((error) => console.warn(error));

const CAM_FOV = 60, COCKPIT_FOV = 70, CAM_NEAR = 0.1, CAM_FAR = 3000;
const COLOR_GROUND = 0x219313, COLOR_LIGHT = 0xfdfefe;
// Lumière renvoyée par le sol : vert-gris sourd (un vert pur teintait en vert le dessous des ailes et le ventre de l'avion)
const COLOR_GROUND_BOUNCE = 0x5d6450;
const WORLD_SIZE = 1000;      // zone de placement aléatoire des objets
const CRASH_RESET_DELAY = 5000; // retour au point de départ après un crash (ms)

// Avion du joueur : Cessna 172 low poly de Vojtěch Balák (Poly Pizza, CC-BY 3.0)
const AIRCRAFT_MODEL = 'asset/cessna.glb';
const PROPELLER_SCALE = 1.2 / 1.51;                        // pales du modèle ramenées à 1,20 m de rayon (garde au sol ~21 cm)
const NOSE_GEAR_EXTENSION = 0.18;                           // tige du train avant allongée (trop courte dans le modèle)
const WHEEL_HEIGHT = 1.25 + NOSE_GEAR_EXTENSION;            // centre de l'avion au-dessus du sol, roues posées
// Le modèle penche vers l'avant (aile calée à -1° à l'emplanture au lieu de +1,5°, dessous du fuselage qui descend de
// 30 cm vers le nez) : l'extérieur de l'avion (modèle, feux) est redressé de 3°, autour du centre de la cabine
// (la physique et la cabine ne changent pas), et le train avant allongé d'autant pour garder les trois roues au sol
const AIRFRAME_PITCH = THREE.MathUtils.degToRad(3);
const AIRFRAME_PIVOT_Z = -2.1;
const TIRE_BOTTOM_Y = 0.01 - WHEEL_HEIGHT;                  // bas des pneus, repère avion (1 cm au-dessus du sol)
const MAIN_WHEEL_Z = -1.21, NOSE_WHEEL_Z = -3.38;
const pitchedY = (y, z) => y * Math.cos(AIRFRAME_PITCH) - (z - AIRFRAME_PIVOT_Z) * Math.sin(AIRFRAME_PITCH);
const AIRFRAME_LIFT = TIRE_BOTTOM_Y - pitchedY(TIRE_BOTTOM_Y, MAIN_WHEEL_Z);       // roues principales gardées au sol
const NOSE_PITCH_EXTENSION = pitchedY(TIRE_BOTTOM_Y, NOSE_WHEEL_Z) + AIRFRAME_LIFT - TIRE_BOTTOM_Y; // nez relevé d'autant

// Repère redressé de l'extérieur de l'avion : rotation de AIRFRAME_PITCH autour de (0, 0, AIRFRAME_PIVOT_Z), relevé de AIRFRAME_LIFT
function trimAirframe(object) {
    object.rotation.x = AIRFRAME_PITCH;
    object.position.set(0, AIRFRAME_LIFT + AIRFRAME_PIVOT_Z * Math.sin(AIRFRAME_PITCH), AIRFRAME_PIVOT_Z * (1 - Math.cos(AIRFRAME_PITCH)));
    return object;
}
const COCKPIT_POSITION = new THREE.Vector3(0, 0.9, -1.85);  // cabine (hauteur des yeux) dans le repère avion, sous l'aile
const COCKPIT_TILT = THREE.MathUtils.degToRad(-8);          // regard légèrement baissé vers le tableau de bord
const CHASE_DISTANCE = 15.4;                                // caméra extérieure : distance à l'avion
const CHASE_PITCH = Math.atan2(3.5, 15);                    // … et hauteur (angle au-dessus de l'avion)
const CHASE_TARGET = new THREE.Vector3(0, 1.5, -8);         // point visé, devant l'avion
const CHASE_STIFFNESS = 4;                                  // rapidité avec laquelle la caméra suit
const ORBIT_SPEED = 0.006;                                  // rotation de la caméra à la souris (rad/pixel)

// Correspondance codeType (data/type objet.csv) -> fichier dans asset/
const ASSETS = {
    TREE:     'asset/tree_default',
    TREE_F:   'asset/tree_default_fall',
    FLOWER_Y: 'asset/flower_yellowB',
    FLOWER_P: 'asset/flower_purpleA',
    TENT:     'asset/tent_detailedOpen',
    ROCK:     'asset/rock_largeA',
    KART:     'asset/KarTech',
    PLANE:    'asset/carpeXL',
    BIMOTEUR: 'asset/bimoteur',   // bimoteur DRAVION (Tinkercad), garé sur le parking de l'aéroport
};
const SOFT_OBJECTS = new Set(['FLOWER_Y', 'FLOWER_P']); // on passe au travers sans crash
// Modèles très détaillés (le kart : plus de 100 000 faces) : dessinés seulement de près
const DETAILED_OBJECTS = new Set(['KART', 'PLANE']);
const DETAIL_DISTANCE = 600;
const detailedObjects = [];
const DEFAULT_SCALE = [10, 20, 10];

// Ambiances du panneau Météo
// night : 0 -> 1 (feux de l'aéroport et de l'avion, éclairage de la cabine) ; stars : ciel étoilé
// rain : 0 -> 1 ; lightning : éclairs et tonnerre ; wind : 0 -> 1 (manche à air)
const WEATHERS = {
    jour:       { label: 'Jour',       sky: 0x5dade2, fogNear: 400, fogFar: 2400, hemi: 1.2, sun: 2.0, turbulence: 0,
                  night: 0, wind: 0.35,
                  atmosphere: { elevation: 40, azimuth: 150, turbidity: 2, rayleigh: 3, fog: 0x8fb4d6 },
                  clouds: { coverage: 0.45, light: 0xffffff, dark: 0x8f9bb0 } },
    // Ciel couvert : ciel gris uniforme (pas de ciel bleu), soleil voilé, tous les nuages aux dessous gris, un peu de vent
    nuageux:    { label: 'Nuageux',    sky: 0x9ba5ae, fogNear: 220, fogFar: 1500, hemi: 1.15, sun: 0.7, turbulence: 0.35,
                  night: 0, wind: 0.55,
                  clouds: { coverage: 1, light: 0xdfe3e7, dark: 0x5f6873, opacity: 1, brightness: 1.4 },
                  // Plafond continu (stratus) vers 1 000 ft, quelques trouées
                  overcast: { base: 320, top: 390, coverage: 0.86, scale: 900 } },
    nuit:      { label: 'Nuit',       sky: 0x0b1a2e, fogNear: 300, fogFar: 1600, hemi: 0.18, sun: 0.35, turbulence: 0,
                  night: 1, stars: 1, wind: 0.2, sunColor: 0x9fb4e8, moon: { elevation: 35, azimuth: 220 },
                  clouds: { coverage: 0.15, light: 0x2c3650, dark: 0x0e1422, opacity: 0.6, brightness: 1 } },
    brouillard: { label: 'Brouillard', sky: 0xbfc9ca, fogNear: 10,  fogFar: 220,  hemi: 1.0, sun: 0.6, turbulence: 0.2,
                  night: 0.2, wind: 0.1,
                  clouds: { coverage: 0.8, light: 0xe5e8e8, dark: 0xaab7b8 } },
    tempete:    { label: 'Tempête',    sky: 0x3b4444, fogNear: 40,  fogFar: 450,  hemi: 0.4, sun: 0.2, turbulence: 1,
                  night: 0.5, wind: 1, rain: 1, lightning: true,
                  clouds: { coverage: 1, light: 0x7f8c8d, dark: 0x2c3e50, opacity: 1, brightness: 1.2 },
                  overcast: { base: 240, top: 330, coverage: 0.95, scale: 700 } },
};

const view = document.getElementById('ecran');
const camera = new THREE.PerspectiveCamera(CAM_FOV, view.clientWidth / view.clientHeight, CAM_NEAR, CAM_FAR);

const scene = new THREE.Scene();
// Pas d'anticrénelage sur le canvas : il est fait dans les textures du post-traitement (Graphics.js). Le canvas ne
// reçoit qu'une copie de l'image finale ; l'anticréneler calculait 4 échantillons par pixel pour rien (coûteux en plein écran)
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false });
const airport = new Airport();
const terrain = new Terrain(renderer, { grassTint: COLOR_GROUND, flatten: (x, z) => airport.reliefFactor(x, z) });
const clouds = new Clouds();
const cloudLayer = new CloudLayer();
const nightSky = new NightSky();
const stallWarning = new StallWarning();
const engineSound = new EngineSound();
const sounds = new SoundEffects();
const storm = new Storm({ groundHeight: (x, z) => terrain.heightAt(x, z), sounds });
const cockpit = new Cockpit();
const crashEffect = new CrashEffect();
let weather = null;
const hemiLight = new THREE.HemisphereLight(COLOR_LIGHT, COLOR_GROUND_BOUNCE);
const sunLight = new THREE.DirectionalLight(COLOR_LIGHT);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // au-delà : très coûteux, gain à peine visible (+ MSAA)
const graphics = new Graphics(renderer, scene, camera, sunLight);
const multiplayer = new Multiplayer();
const remotePlayers = new RemotePlayers(scene, multiplayer, { engineSound, altitudeOffset: WHEEL_HEIGHT, trimAirframe });
const radio = new Radio(multiplayer);

const loader = new Utils3dLoader();

// Les commandes pilotent l'avion ; la caméra le suit (cabine ou vue extérieure)
const aircraft = new THREE.Group();
const controls = new PlaneControls( aircraft );
// Systèmes de l'avion (électricité, moteur, carburant, feux) commandés depuis la cabine
const systems = new Systems();
// Décor instancié, par type d'objet : { meshes, total, obstacles } (voir buildWorld)
const decorGroups = [];
let decorDensity = 1;
let aircraftModel = null;
let propeller = null;
let propellerParts = new Set();   // pièces de l'hélice : seules affichées en vue cabine
let propellerDisc = null;          // disque de flou de l'hélice qui tourne vite
let controlSurfaces = null;
let chaseView = true;
const clock = new THREE.Clock();

controls.groundHeight = (x, z) => terrain.heightAt(x, z);
controls.surfaceAt = (x, z) => airport.surfaceAt(x, z);
controls.minAltitude = WHEEL_HEIGHT;

scene.fog = new THREE.Fog(0xffffff);
terrain.mesh.receiveShadow = true;
scene.add( terrain.mesh );
scene.add( airport.build(renderer) );
rebuildObstacles();
scene.add( nightSky.mesh );
scene.add( clouds.mesh, cloudLayer.mesh );
scene.add( storm.rainMesh, storm.bolt );
scene.add( crashEffect.group );
scene.add( hemiLight );
scene.add( sunLight );
scene.add( aircraft );

// Départ : avion posé en bout de piste (seuil sud), cap au nord, moteur au ralenti
aircraft.position.set(airport.start.x, 0, airport.start.z);
controls.placeOnGround();
controls.saveState();

cockpit.group.position.copy(COCKPIT_POSITION);
aircraft.add(cockpit.group);

// Feux de navigation (rouge à gauche, vert à droite, blanc à l'arrière), anticollision et phare d'atterrissage
// Extérieur de l'avion (modèle, feux, phare), redressé (voir trimAirframe)
const airframe = trimAirframe(new THREE.Group());
aircraft.add(airframe);
const aircraftLights = new AircraftLights(airframe, { castLight: true });
const landingLight = new THREE.SpotLight(0xfff3d6, 0, 400, THREE.MathUtils.degToRad(20), 0.65, 1.6); // phare unique : atterrissage et roulage
// Phare dans le bord d'attaque de l'aile gauche, comme sur un vrai Cessna 172
// (dans le nez, il éclairait les pales de l'hélice qui passaient devant : flashs blancs)
landingLight.position.set(-2.2, 1.12, -3);
// Visé ~2° sous l'horizon (sol éclairé surtout vers 50-120 m) : visible depuis la cabine au-dessus du tableau de bord
landingLight.target.position.set(-1.2, -2.4, -80);
airframe.add(landingLight, landingLight.target);

// Feux réellement allumés : interrupteurs et alimentation ; phares seulement de nuit (le jour, ils ne se
// verraient pas et chaque lumière alourdit le rendu)
function applyLights() {
    const lights = systems.lights;
    const dark = (weather?.night ?? 0) >= 0.5;
    aircraftLights.setSwitches(lights);
    landingLight.visible = lights.land && dark;
}
systems.addEventListener('change', applyLights);

new GLTFLoader().load(AIRCRAFT_MODEL, (gltf) => {
    const model = aircraftModel = gltf.scene;
    model.position.z = -2; // centre l'avion sur l'aile (le modèle a son origine vers le nez)
    lowerGear(model);
    propeller = model.getObjectByName('Propeller_Cone');
    // Recentre l'hélice sur son axe pour qu'elle tourne sans voilage
    const center = new THREE.Box3().setFromObject(propeller).getCenter(new THREE.Vector3());
    propeller.traverse((child) => child.geometry?.translate(-center.x, -center.y, 0));
    propeller.position.set(center.x, center.y, 0);
    // Pales raccourcies : 1,51 m de rayon dans le modèle (hélice de 3 m, la pale du bas traversait la piste) ;
    // 1,20 m, à l'échelle du nez du modèle, laisse ~21 cm sous la pale. Le cône (gris) garde sa taille
    propeller.traverse((child) => {
        if (child.isMesh && child.material.name === 'Black') child.geometry.scale(PROPELLER_SCALE, PROPELLER_SCALE, 1);
    });
    // Ailerons, profondeur, direction et volets deviennent des pièces mobiles (aussi sur les copies du modèle)
    controlSurfaces = new ControlSurfaces(model, propeller);
    addWindowPillars(model);
    // Copie aux vitres opaques pour les avions garés et ceux des autres joueurs (ils n'ont pas d'intérieur)
    const template = trimAirframe(new THREE.Group()).add(model.clone());
    makeWindowsTransparent(model, propeller);
    model.traverse((child) => { child.castShadow = child.material !== cabinGlass; }); // le soleil entre par les vitres
    setupPropellerBlur(propeller); // après : le disque flou ne fait pas d'ombre
    airframe.add(model);
    paintAircraft(model, multiplayer.livery);
    aircraftLights.setOccluder(model);
    remotePlayers.setTemplate(template);
    airport.addParkedPlanes(template, WHEEL_HEIGHT);
    rebuildObstacles(); // + les avions garés
    updateView();
}, undefined, (error) => console.error(error));

// Train d'atterrissage : dans le modèle, il est trop court.
// - Train avant : tige de 24 cm à peine entre le fuselage et le carénage de roue ; allongée de NOSE_GEAR_EXTENSION
//   (carénage et roue descendent d'un bloc, l'attache au fuselage, y -0,72, reste en place)
// - Train principal : avion posé sur la roulette de nez, les roues flottaient à 30 cm (droite) et 24 cm (gauche, le
//   modèle n'est pas symétrique) ; descendu d'autant, plus l'allongement du train avant, en étirant les jambes depuis
//   leur attache au fuselage (x ~0,67) jusqu'à la roue (x ~1,35)
const MAIN_GEAR_DROP = { right: 0.295 + NOSE_GEAR_EXTENSION, left: 0.23 + NOSE_GEAR_EXTENSION };

// Déplacement vertical d'un point du train (repère avion), 0 ailleurs
function gearDrop(point) {
    // Train avant : sous le fuselage, autour de la roue (x ±0,15, z -3,7 à -3,1)
    if (Math.abs(point.x) < 0.15 && point.z > -3.7 && point.z < -3.1 && point.y < -0.74) {
        return (NOSE_GEAR_EXTENSION + NOSE_PITCH_EXTENSION) * (1 - THREE.MathUtils.smoothstep(point.y, -0.9, -0.74));
    }
    // Train principal : sous le fuselage (y < -0,3), autour de l'axe des roues (z -1,9 à -0,5)
    if (point.y > -0.3 || point.z < -1.9 || point.z > -0.5) return 0;
    const reach = THREE.MathUtils.smoothstep(Math.abs(point.x), 0.7, 1.3);   // 0 à l'attache, 1 à la roue
    return reach * (point.x > 0 ? MAIN_GEAR_DROP.right : MAIN_GEAR_DROP.left);
}

function lowerGear(model) {
    model.updateMatrixWorld(true);
    const point = new THREE.Vector3(), inverse = new THREE.Matrix4();
    model.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const position = mesh.geometry.attributes.position;
        inverse.copy(mesh.matrixWorld).invert();
        let changed = false;
        for (let i = 0; i < position.count; i++) {
            point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);   // repère avion
            const drop = gearDrop(point);
            if (drop <= 0) continue;
            point.y -= drop;
            point.applyMatrix4(inverse);
            position.setXYZ(i, point.x, point.y, point.z);
            changed = true;
        }
        if (!changed) return;
        position.needsUpdate = true;
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
    });
}

// Montants extérieurs du vitrage (le modèle n'en a pas : vitres d'un seul tenant du pare-brise à l'arrière des portes) :
// bord du pare-brise, avant et arrière de la porte, à la couleur du fuselage. Arêtes relevées sur les vitres du modèle
// (repère avion ; le modèle n'est pas tout à fait symétrique)
const WINDOW_PILLARS = [
    { thickness: 0.035, right: [[0.79, 0.70, -2.95], [0.77, 1.10, -2.87]], left: [[-0.82, 0.66, -2.95], [-0.82, 1.06, -2.87]] },
    { thickness: 0.06,  right: [[0.78, 0.73, -2.49], [0.76, 1.10, -2.48]], left: [[-0.80, 0.69, -2.49], [-0.80, 1.06, -2.48]] },
    { thickness: 0.06,  right: [[0.74, 0.82, -1.07], [0.67, 1.16, -1.20]], left: [[-0.77, 0.79, -1.07], [-0.71, 1.12, -1.20]] },
];

function addWindowPillars(model) {
    let white = null;
    model.traverse((child) => { if (child.isMesh && child.material.name === 'White') white ??= child.material; });
    const up = new THREE.Vector3(0, 1, 0);
    for (const { thickness, right, left } of WINDOW_PILLARS) {
        for (const [side, points] of [[1, right], [-1, left]]) {
            // Repère du modèle : décalé de 2 m vers l'arrière ; montant posé sur la vitre, à moitié dehors
            const [a, b] = points.map(([x, y, z]) => new THREE.Vector3(x + side * thickness * 0.3, y, z - model.position.z));
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(thickness, a.distanceTo(b) + 0.06, thickness), white);
            pillar.position.copy(a).add(b).multiplyScalar(0.5);
            pillar.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
            pillar.castShadow = true;
            model.add(pillar);
        }
    }
}

// Hélice en rotation : les pales s'estompent et un disque flou apparaît (comme vu de la cabine d'un vrai avion,
// au lieu d'une pale qui saute d'une position à l'autre à chaque image)
function setupPropellerBlur(propeller) {
    propeller.traverse((child) => {
        if (!child.isMesh) return;
        child.material = child.material.clone(); // estompées sans toucher le reste de l'avion
        child.material.transparent = true;
        propellerParts.add(child);
    });
    propeller.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(propeller);
    // Rayon réel des pales (la boîte englobante d'une pale en biais le sous-estime)
    let radius = 0;
    propeller.traverse((child) => {
        const position = child.isMesh && child.geometry.attributes.position;
        for (let i = 0; position && i < position.count; i++) radius = Math.max(radius, Math.hypot(position.getX(i), position.getY(i)));
    });
    propellerDisc = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 48),
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    propellerDisc.position.z = propeller.worldToLocal(box.getCenter(new THREE.Vector3())).z;
    propeller.add(propellerDisc);
    propellerParts.add(propellerDisc);
}

function updatePropeller(delta) {
    if (!propeller) return;
    const spin = controls.isCrashed() ? 0 : systems.rpm / 2700 * 100; // rad/s (vitesse d'affichage, pas réelle)
    propeller.rotation.z += spin * delta;
    const blur = THREE.MathUtils.clamp((spin - 30) / 40, 0, 1);
    propellerDisc.material.opacity = 0.15 * blur; // à peine visible, comme une vraie hélice lancée
    for (const part of propellerParts) if (part !== propellerDisc) part.material.opacity = 1 - 0.8 * blur;
}

// Vitres de la cabine : dans le modèle, ce sont les triangles noirs au-dessus de y = 0,3
// (en dessous : pneus et carénages). Ils deviennent du verre teinté, on voit l'intérieur à travers.
const cabinGlass = new THREE.MeshStandardMaterial({
    color: 0x1d2c35, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.3,
    depthWrite: false, side: THREE.DoubleSide,
});

function makeWindowsTransparent(model, propeller) {
    const blackMeshes = [];
    model.traverse((child) => {
        if (!child.isMesh || child.material.name !== 'Black') return;
        for (let o = child; o; o = o.parent) if (o === propeller) return;
        blackMeshes.push(child);
    });
    for (const mesh of blackMeshes) {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const position = geometry.attributes.position, normal = geometry.attributes.normal;
        const parts = { opaque: { p: [], n: [] }, glass: { p: [], n: [] } };
        for (let i = 0; i < position.count; i += 3) {
            const y = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
            const part = y > 0.3 ? parts.glass : parts.opaque;
            for (let k = i; k < i + 3; k++) {
                part.p.push(position.getX(k), position.getY(k), position.getZ(k));
                part.n.push(normal.getX(k), normal.getY(k), normal.getZ(k));
            }
        }
        if (!parts.glass.p.length) continue;
        const build = ({ p, n }) => {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
            return g;
        };
        mesh.geometry = build(parts.opaque); // l'ancienne géométrie reste utilisée par la copie aux vitres opaques
        const windows = new THREE.Mesh(build(parts.glass), cabinGlass);
        windows.position.copy(mesh.position);
        windows.quaternion.copy(mesh.quaternion);
        windows.scale.copy(mesh.scale);
        windows.renderOrder = 2;
        mesh.parent.add(windows);
    }
}

// Vue cabine / vue extérieure (bouton ou touche V)
const viewButton = document.getElementById('vue');

function updateView() {
    // En cabine, seule l'hélice reste visible devant le pare-brise (le reste de l'avion masquerait la vue)
    aircraftModel?.traverse((child) => { if (child.isMesh) child.visible = chaseView || propellerParts.has(child); });
    // L'intérieur reste affiché en vue extérieure : on le voit à travers les vitres
    cockpit.setExterior(chaseView);
    aircraftLights.setCabinView(!chaseView);
    camera.fov = chaseView ? CAM_FOV : COCKPIT_FOV;
    camera.updateProjectionMatrix();
    viewButton.textContent = chaseView ? 'Vue cabine' : 'Vue extérieure';
}

function toggleView() {
    chaseView = !chaseView;
    updateView();
    updateCamera(0, true);
}

viewButton.addEventListener('click', (event) => {
    toggleView();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.repeat) return;
    if (event.code === 'KeyV') toggleView();
    if (event.code === 'KeyC') recenterCamera();
});
updateView();

// Caméra à la souris : glisser pour tourner autour de l'avion (ou regarder autour de soi en cabine),
// molette pour zoomer, double-clic ou touche C pour revenir derrière l'avion
const orbit = { yaw: 0, pitch: CHASE_PITCH, distance: CHASE_DISTANCE };
const head = { yaw: 0, pitch: 0 };
let drag = null;

// Vues de la cabine sur les touches chiffrées : point visé (repère cabine, comme Cockpit.js) et champ de vision
const CABIN_VIEWS = {
    1: { label: 'Devant', yaw: 0, pitch: 0, fov: COCKPIT_FOV },
    2: { label: 'Instruments de vol', target: [-0.3, -0.3, -0.75], fov: 46 },
    3: { label: 'Magnétos et master', target: [-0.5, -0.64, -0.75], fov: 32 },
    4: { label: 'Interrupteurs et disjoncteurs', target: [0.03, -0.56, -0.75], fov: 36 },
    5: { label: 'Volets et éclairage', target: [0.46, -0.57, -0.75], fov: 34 },
    6: { label: 'Radios, VOR et moteur', target: [0.33, -0.3, -0.75], fov: 44 },
    7: { label: 'Gaz et mixture', target: [-0.01, -0.47, -0.75], fov: 34 },
    8: { label: 'Pupitre (trim, robinet)', target: [0, -0.765, -0.6], fov: 38 },
    9: { label: 'Sélecteur de réservoir', target: [0, -0.884, -0.45], fov: 38 },
    0: { label: 'Aile gauche', yaw: 1.35, pitch: 0.05, fov: COCKPIT_FOV },
};
let headTarget = null;   // vue en cours de rejointe (glissement doux)

function setCabinViewPreset(number) {
    const preset = CABIN_VIEWS[number];
    if (!preset) return;
    if (chaseView) toggleView();
    let { yaw, pitch } = preset;
    if (preset.target) {
        const [tx, ty, tz] = preset.target;
        const dx = tx - cockpit.eye.x, dy = ty - cockpit.eye.y, dz = tz - cockpit.eye.z;
        yaw = Math.atan2(-dx, -dz);
        pitch = Math.atan2(dy, Math.hypot(dx, dz)) - COCKPIT_TILT;
    }
    headTarget = { yaw, pitch, fov: preset.fov };
}

function updateHeadTarget(delta) {
    if (!headTarget || chaseView) return;
    const k = 1 - Math.exp(-8 * delta);
    head.yaw += (headTarget.yaw - head.yaw) * k;
    head.pitch += (headTarget.pitch - head.pitch) * k;
    camera.fov += (headTarget.fov - camera.fov) * k;
    camera.updateProjectionMatrix();
    if (Math.abs(headTarget.yaw - head.yaw) + Math.abs(headTarget.pitch - head.pitch) + Math.abs(headTarget.fov - camera.fov) / 100 < 0.002) headTarget = null;
}

window.addEventListener('keydown', (event) => {
    if (event.repeat || isTypingTarget(event.target)) return;
    const match = /^(?:Digit|Numpad)(\d)$/.exec(event.code);
    if (match) setCabinViewPreset(Number(match[1]));
});

function recenterCamera() {
    headTarget = null;
    Object.assign(orbit, { yaw: 0, pitch: CHASE_PITCH, distance: CHASE_DISTANCE });
    Object.assign(head, { yaw: 0, pitch: 0 });
    camera.fov = chaseView ? CAM_FOV : COCKPIT_FOV;
    camera.updateProjectionMatrix();
    updateCamera(0, true);
}

let dragDistance = 0;
view.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY };
    dragDistance = 0;
    view.setPointerCapture(event.pointerId);
    view.focus();
});
view.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag = { x: event.clientX, y: event.clientY };
    dragDistance += Math.abs(dx) + Math.abs(dy);
    if (dx || dy) headTarget = null;   // la souris reprend la main sur une vue préréglée
    if (chaseView) {
        orbit.yaw -= dx * ORBIT_SPEED;
        orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * ORBIT_SPEED, -0.35, 1.45);
    } else {
        head.yaw = THREE.MathUtils.clamp(head.yaw - dx * ORBIT_SPEED * 0.7, -2.6, 2.6);
        head.pitch = THREE.MathUtils.clamp(head.pitch - dy * ORBIT_SPEED * 0.7, -1.0, 1.1);
    }
});
for (const type of ['pointerup', 'pointercancel']) view.addEventListener(type, () => { drag = null; });
view.addEventListener('dblclick', (event) => {
    if (!controlAt(event)) recenterCamera(); // double-clic sur une commande : pas de recentrage
});
view.addEventListener('wheel', (event) => {
    event.preventDefault();
    // En cabine, molette sur une commande (bouton, manette, molette de trim) : la tourne (au lieu du zoom)
    const control = controlAt(event);
    if (control) {
        const up = event.deltaY < 0 ? 1 : -1;
        if (useControl(control, control.id === 'trimWheel' ? -up : up, true, event.shiftKey)) return;
    }
    const zoom = Math.sign(event.deltaY) * 0.1;
    if (chaseView) {
        orbit.distance = THREE.MathUtils.clamp(orbit.distance * (1 + zoom), 7, 90);
    } else {
        camera.fov = THREE.MathUtils.clamp(camera.fov * (1 + zoom), 30, 85);
        camera.updateProjectionMatrix();
    }
}, { passive: false });

// Après une réinitialisation (bouton ou touche R), la caméra se replace d'un coup
controls.addEventListener('reset', () => {
    // Retour au point de départ : même état qu'au départ choisi (prêt à voler, ou éteint au parking)
    applySpawnState();
    aircraft.updateMatrixWorld();
    updateCamera(0, true);
    crashEffect.stop();
    aircraft.visible = true;
    updateView();
    crashBanner.classList.remove('actif');
    clearTimeout(crashTimer);
});

const _lookAt = new THREE.Vector3();
const _offset = new THREE.Vector3();
const chaseOffset = new THREE.Vector3(0, 0, CHASE_DISTANCE);  // caméra extérieure par rapport à l'avion (repère monde)
const _headQuaternion = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
let shake = 0;

const crashCamera = { position: new THREE.Vector3(), target: new THREE.Vector3() };

// Choix du départ en cours : pas encore d'avion dans le monde ; la caméra survole lentement l'aérodrome
let choosingSpawn = false;

function updateCamera(delta, snap = false) {
    if (choosingSpawn) {
        // Vue en temps réel au-dessus de l'aérodrome (nord en haut), légèrement inclinée
        camera.position.set(200, 430, 520);
        camera.up.set(0, 0, -1);
        camera.lookAt(215, 0, 20);
        if (camera.fov !== CAM_FOV) {
            camera.fov = CAM_FOV;
            camera.updateProjectionMatrix();
        }
        return;
    }
    if (controls.isCrashed()) {
        // Crash : vue extérieure en retrait sur l'épave, quelle que soit la vue choisie
        camera.position.lerp(crashCamera.position, snap ? 1 : 1 - Math.exp(-2 * delta));
        camera.up.set(0, 1, 0);
        camera.lookAt(crashCamera.target);
    } else if (!chaseView) {
        // Œil du pilote dans la cabine, la tête peut tourner
        camera.position.copy(cockpit.eye).add(COCKPIT_POSITION).applyMatrix4(aircraft.matrixWorld);
        _headQuaternion.setFromEuler(_euler.set(head.pitch + COCKPIT_TILT, head.yaw, 0));
        camera.quaternion.copy(aircraft.quaternion).multiply(_headQuaternion);
    } else {
        // Caméra de poursuite en orbite autour de l'avion, reste au-dessus du sol. Elle suit exactement la position
        // de l'avion ; seule sa direction autour de lui suit avec un peu de retard (virages, tangage). Lisser la position
        // elle-même la laissait traîner derrière l'avion d'autant plus qu'il allait vite (zoomée à 7 m : ~20 m en vol),
        // puis revenir d'un coup quand il ralentissait ou tournait
        _offset.set(0, 0, orbit.distance).applyAxisAngle(_xAxis, -orbit.pitch).applyAxisAngle(_yAxis, orbit.yaw)
            .applyQuaternion(aircraft.quaternion);
        if (snap) {
            chaseOffset.copy(_offset);
        } else {
            // Direction et distance lissées séparément : la caméra tourne autour de l'avion sans s'en rapprocher
            const length = THREE.MathUtils.lerp(chaseOffset.length(), _offset.length(), 1 - Math.exp(-CHASE_STIFFNESS * delta));
            chaseOffset.lerp(_offset, 1 - Math.exp(-CHASE_STIFFNESS * delta)).setLength(length);
        }
        camera.position.copy(aircraft.position).add(chaseOffset);
        camera.position.y = Math.max(camera.position.y, terrain.heightAt(camera.position.x, camera.position.z) + 2);
        camera.up.set(0, 1, 0);
        _lookAt.copy(CHASE_TARGET).applyAxisAngle(_yAxis, orbit.yaw);
        // En orbite, on vise l'avion lui-même plutôt qu'un point devant lui
        _lookAt.multiplyScalar(Math.max(0, Math.cos(orbit.yaw)));
        camera.lookAt(_lookAt.applyMatrix4(aircraft.matrixWorld));
    }
    // Secousses (atterrissage, roulage, crash)
    // Vibration continue (sinusoïdes de fréquences non multiples) plutôt qu'un tirage au hasard à chaque image,
    // qui faisait sauter la caméra d'autant plus que les i/s étaient élevées
    if (shake > 0.001) {
        // En cabine, le tableau de bord est à 50 cm de l'œil : quelques millimètres le font vibrer nettement
        const amount = chaseView ? shake : shake * 0.3;
        const t = clock.elapsedTime;
        camera.position.x += amount * 0.5 * (Math.sin(t * 31) + Math.sin(t * 17.3 + 1.1)) * 0.5;
        camera.position.y += amount * 0.5 * (Math.sin(t * 37.7 + 2.3) + Math.sin(t * 13.1)) * 0.5;
        camera.position.z += amount * 0.5 * (Math.sin(t * 23.9 + 4.2) + Math.sin(t * 19.7 + 0.7)) * 0.5;
    }
}

// Le canvas est dimensionné par la grille CSS : on adapte le rendu à sa taille réelle
function resize() {
    const width = view.clientWidth, height = view.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    graphics.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Le canvas redimensionné est vide : on redessine tout de suite (sinon éclair noir jusqu'à l'image suivante)
    if (weather) graphics.render();
}
new ResizeObserver(resize).observe(view);
resize();

// Construction de la scène à partir du modèle de données (data/)
// Réglage "Arbres et décor" : n'affiche qu'une partie des exemplaires (ceux de objet.csv d'abord)
function applyDecorDensity() {
    for (const group of decorGroups) {
        const count = Math.max(1, Math.round(group.total * decorDensity));
        for (const mesh of group.meshes) mesh.count = count;
    }
    rebuildObstacles();
}

// Obstacles : bâtiments et avions de l'aéroport, et seulement le décor affiché (pas de crash contre un arbre invisible)
function rebuildObstacles() {
    controls.obstacles = [...airport.obstacles];
    for (const group of decorGroups) {
        const count = group.meshes[0]?.count ?? group.total;
        controls.obstacles.push(...group.obstacles.slice(0, count));
    }
}

async function buildWorld() {
    const [types, objets] = await Promise.all([
        loadCSV('data/type objet.csv'),
        loadCSV('data/objet.csv'),
    ]);

    for (const type of types) {
        const asset = ASSETS[type.codeType];
        if (!asset) {
            console.warn(`Pas d'asset pour le type ${type.codeType}`);
            continue;
        }

        // Objets positionnés dans objet.csv, puis complétés aléatoirement jusqu'à "nombre"
        const placed = objets.filter((o) => o.codeType === type.codeType);
        const nombre = Math.max(parseInt(type.nombre, 10) || 0, placed.length);
        const ref = placed[0];
        const scale = ref ? [ref.scalex, ref.scaley, ref.scalez].map(Number) : DEFAULT_SCALE;

        loader.load(asset, (obj) => {
            // Position, orientation et taille de chaque exemplaire
            const placement = new THREE.Object3D();
            const matrices = [];
            for (let i = 0; i < nombre; i++) {
                const o = placed[i];
                placement.rotation.set(0, 0, 0);
                if (o) {
                    placement.scale.set(Number(o.scalex), Number(o.scaley), Number(o.scalez));
                    placement.position.set(Number(o.x), Number(o.y), Number(o.z));
                    placement.position.y += terrain.heightAt(placement.position.x, placement.position.z);
                } else {
                    placement.scale.set(...scale);
                    // Rien sur l'aérodrome (piste, parking, bâtiments)
                    let x, z;
                    do {
                        x = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                        z = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                    } while (airport.contains(x, z, 30));
                    // Légèrement enfoncé pour ne pas flotter sur les pentes
                    placement.position.set(x, terrain.heightAt(x, z) - 0.5, z);
                    placement.rotation.y = Math.random() * Math.PI * 2;
                }
                placement.updateMatrix();
                matrices.push(placement.matrix.clone());
            }

            // Instanciation : tous les exemplaires d'un même objet sont dessinés en un seul appel
            // (au lieu d'un appel par objet et par matériau : des centaines d'appels en moins à chaque image)
            obj.updateMatrixWorld(true);
            const instanceMatrix = new THREE.Matrix4();
            const group = { meshes: [], total: matrices.length, obstacles: [] };
            obj.traverse((child) => {
                if (!child.isMesh) return;
                const instances = new THREE.InstancedMesh(child.geometry, child.material, matrices.length);
                matrices.forEach((matrix, i) => instances.setMatrixAt(i, instanceMatrix.multiplyMatrices(matrix, child.matrixWorld)));
                instances.computeBoundingSphere();
                instances.castShadow = !SOFT_OBJECTS.has(type.codeType); // les fleurs : ombre invisible, inutile
                scene.add(instances);
                if (DETAILED_OBJECTS.has(type.codeType)) detailedObjects.push(instances);
                group.meshes.push(instances);
            });

            if (!SOFT_OBJECTS.has(type.codeType)) {
                const box = new THREE.Box3().setFromObject(obj);
                group.obstacles = matrices.map((matrix) => box.clone().applyMatrix4(matrix));
            }
            decorGroups.push(group);
            applyDecorDensity();
        });
    }
}

buildWorld().catch((error) => console.error(error));

// Mâts d'éclairage du parking de l'aéroport (Kenney City Kit Roads, CC0)
loader.load('asset/light-square-cross', (obj) => {
    airport.addFloodlights(obj);
    rebuildObstacles();
});

// Panneau Météo
function setWeather(name) {
    const w = weather = WEATHERS[name];
    scene.background = new THREE.Color(w.sky); // caché par le ciel atmosphérique s'il est actif
    graphics.setAtmosphere(w.atmosphere ?? null, w.moon);
    hemiLight.color.set(w.sky).lerp(new THREE.Color(COLOR_LIGHT), 0.5);
    hemiLight.intensity = w.hemi;
    sunLight.intensity = w.sun;
    sunLight.color.set(w.sunColor ?? COLOR_LIGHT);
    controls.turbulence = w.turbulence;
    clouds.setWeather(w.clouds);
    cloudLayer.setWeather(w.overcast ?? null, w.clouds);
    nightSky.setVisibility(w.stars ?? 0, w.sky);
    storm.setWeather({ rain: w.rain ?? 0, lightning: w.lightning ?? false, clouds: w.overcast ?? null });
    cockpit.setNight(w.night);
    airport.setNight(w.night);
    aircraftLights.setNight(w.night);
    applyLights();
    remotePlayers.setNight(w.night);
    // Phare seulement de nuit : une lumière, même éteinte, alourdit le calcul de tous les matériaux
    // Avion en route (moteur en marche) : de nuit, le pilote allume le phare (interrupteur LAND, modifiable en cabine).
    // Avion éteint au parking : on ne touche à rien, c'est au pilote de tout allumer
    if (systems.running) systems.switches.land = w.night >= 0.5;
    systems.dispatchEvent(new Event('change'));
    landingLight.intensity = 12000;

    for (const button of meteoButtons.children) button.classList.toggle('actif', button.dataset.meteo === name);
    document.getElementById('météo-actuelle').textContent = w.label;
}

// Menus du bandeau (Commandes, Météo) : un clic sur la case déroule son contenu ; clic ailleurs ou Échap : fermé
const menus = [...document.querySelectorAll('.menu')];
function closeMenus(except = null) {
    for (const menu of menus) {
        if (menu === except) continue;
        menu.querySelector('.menu-titre').setAttribute('aria-expanded', 'false');
        menu.querySelector('.menu-contenu').hidden = true;
    }
}
for (const menu of menus) {
    const title = menu.querySelector('.menu-titre');
    title.addEventListener('click', () => {
        const open = title.getAttribute('aria-expanded') !== 'true';
        closeMenus(menu);
        title.setAttribute('aria-expanded', String(open));
        menu.querySelector('.menu-contenu').hidden = !open;
        title.blur(); // garde le clavier pour le pilotage
    });
}
document.addEventListener('pointerdown', (event) => {
    if (!menus.some((menu) => menu.contains(event.target))) closeMenus();
});
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenus();
});

const meteoButtons = document.querySelector('#météo .menu-boutons');
for (const [name, w] of Object.entries(WEATHERS)) {
    const button = document.createElement('button');
    button.textContent = w.label;
    button.dataset.meteo = name;
    button.addEventListener('click', () => {
        setWeather(name);
        closeMenus();
        button.blur(); // garde le clavier pour le pilotage (Espace ne re-clique pas)
    });
    meteoButtons.appendChild(button);
}
setWeather('jour');

// Caméra placée directement derrière l'avion au démarrage
aircraft.updateMatrixWorld();
updateCamera(0, true);

// Plein écran : tout le cockpit (écran de vol + panneaux), bouton ou touche F
const simulatorElement = document.getElementById('simulator');
const fullscreenButton = document.getElementById('plein-ecran');

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else simulatorElement.requestFullscreen().catch((error) => console.error(error));
}
fullscreenButton.addEventListener('click', (event) => {
    toggleFullscreen();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyF' && !event.repeat && !(event.target instanceof HTMLInputElement)) toggleFullscreen();
});
document.addEventListener('fullscreenchange', () => {
    fullscreenButton.textContent = document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran';
});

// Volets : le bouton sort un cran (rentre tout après le dernier), touches G / T
const flapsButton = document.getElementById('volets');
function updateFlapsButton() {
    flapsButton.textContent = `Volets : ${controls.getFlapSetting()}°`;
}
flapsButton.addEventListener('click', (event) => {
    const level = controls.getFlapLevel();
    controls.setFlapLevel(level >= 3 ? 0 : level + 1);
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
controls.addEventListener('flaps', updateFlapsButton);
controls.addEventListener('reset', updateFlapsButton);
updateFlapsButton();

// Bouton de réinitialisation (équivalent à la touche R)
document.getElementById('reset').addEventListener('click', (event) => {
    controls.reset();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});

// Alarme de décrochage : bandeau à l'écran + alarme sonore Airbus ("STALL" + cricket)
const alarme = document.getElementById('alarme');

// Le navigateur n'autorise le son qu'après une action du joueur
for (const type of ['keydown', 'pointerdown']) {
    window.addEventListener(type, () => {
        radio.unlock();
        stallWarning.unlock().catch((error) => console.error(error));
        engineSound.unlock().catch((error) => console.error(error));
        sounds.unlock().catch((error) => console.error(error));
    }, { once: true });
}

function updateStallWarning() {
    alarme.classList.toggle('actif', controls.isStalled());
    stallWarning.update(controls.isNearStall());
}

// Sol : crissement des pneus au toucher, secousses, crash
const crashBanner = document.getElementById('crash');
const crashReason = document.getElementById('crash-raison');
let crashTimer = 0;

controls.addEventListener('touchdown', ({ impact }) => {
    shake = Math.max(shake, Math.min(0.5, impact * 0.08));
    if (controls.getSpeed() > 8) sounds.play('screech', { volume: THREE.MathUtils.clamp(impact / 3, 0.25, 1) });
});
let crashCount = 0;   // envoyé aux autres joueurs : chaque nouveau crash fait exploser notre avion chez eux
controls.addEventListener('crash', ({ reason }) => {
    crashCount++;
    crashReason.textContent = `${reason} — retour au point de départ…`;
    crashBanner.classList.add('actif');
    const wreck = aircraft.position.clone().setY(terrain.heightAt(aircraft.position.x, aircraft.position.z));
    crashEffect.start(wreck);
    aircraft.visible = false; // l'avion détruit disparaît dans la boule de feu
    // Caméra de crash : en retrait derrière le point d'impact, au-dessus du sol
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(aircraft.quaternion).setY(0);
    if (back.lengthSq() < 0.01) back.set(0, 0, 1);
    crashCamera.position.copy(wreck).addScaledVector(back.normalize(), 35);
    crashCamera.position.y = Math.max(wreck.y, terrain.heightAt(crashCamera.position.x, crashCamera.position.z)) + 14;
    crashCamera.target.copy(wreck).setY(wreck.y + 4);
    camera.fov = CAM_FOV;
    camera.updateProjectionMatrix();
    sounds.play('crash');
    shake = 1.2;
    clearTimeout(crashTimer);
    crashTimer = setTimeout(() => controls.reset(), CRASH_RESET_DELAY);
});

// Brouillard de la météo, épaissi quand l'avion traverse un nuage ("jour blanc"), éclairé par les éclairs
const cloudFogColor = new THREE.Color();
const flashColor = new THREE.Color(0xc8d0ff);
const shadowCenter = new THREE.Vector3();

const ABOVE_CLOUDS_SKY = new THREE.Color(0x6f9fd2), ABOVE_CLOUDS_FOG = new THREE.Color(0xc4d4e3);
const ABOVE_CLOUDS_SUN = 2.0, ABOVE_CLOUDS_HEMI = 1.2;   // plein jour au-dessus de la nappe, même par temps d'orage
const _sunColor = new THREE.Color(), _white = new THREE.Color(COLOR_LIGHT);

function updateFog() {
    const density = Math.max(clouds.densityAt(camera.position), cloudLayer.densityAt(camera.position));
    // Au-dessus de la couche nuageuse : ciel bleu, vue dégagée et plein soleil (sur 60 m après le sommet de la couche)
    const above = cloudLayer.mesh.visible ? THREE.MathUtils.smoothstep(camera.position.y, weather.overcast.top + 20, weather.overcast.top + 90) : 0;
    // Éclairs : sous les nuages, tout le ciel s'éclaire ; au-dessus, seule la nappe s'illumine par l'intérieur
    const flash = storm.flash * (1 - above);
    cloudLayer.setFlash(storm.flash, storm.strikeAt.x, storm.strikeAt.z);
    storm.bolt.visible &&= above < 0.5;
    cloudFogColor.set(weather.clouds.light);
    scene.fog.color.set(weather.atmosphere?.fog ?? weather.sky).lerp(ABOVE_CLOUDS_FOG, above)
        .lerp(cloudFogColor, density).lerp(flashColor, flash * 0.6);
    scene.background.set(weather.sky).lerp(ABOVE_CLOUDS_SKY, above).lerp(flashColor, flash * 0.6);
    scene.fog.near = THREE.MathUtils.lerp(THREE.MathUtils.lerp(weather.fogNear, 600, above), 0, density);
    scene.fog.far = THREE.MathUtils.lerp(THREE.MathUtils.lerp(weather.fogFar, 2800, above), 30, density);
    hemiLight.intensity = THREE.MathUtils.lerp(weather.hemi, ABOVE_CLOUDS_HEMI, above) + flash * 2.5;
    sunLight.intensity = THREE.MathUtils.lerp(weather.sun, ABOVE_CLOUDS_SUN, above);
    sunLight.color.copy(_sunColor.set(weather.sunColor ?? COLOR_LIGHT).lerp(_white, above));
    // Bouffées qui dépassent de la nappe : en plein soleil au-dessus (sinon gris d'orage)
    clouds.setColors(cloudLight.set(weather.clouds.light).lerp(_white, above), cloudDark.set(weather.clouds.dark).lerp(ABOVE_CLOUDS_SHADE, above));
}
const cloudLight = new THREE.Color(), cloudDark = new THREE.Color(), ABOVE_CLOUDS_SHADE = new THREE.Color(0x9aa6b6);

// Multijoueur : fenêtre ouverte depuis la case "Multijoueur" du bandeau
const multiDialog = document.getElementById('multi-dialog');
const multiPseudo = document.getElementById('multi-pseudo');
const multiCode = document.getElementById('multi-code');
const multiStatut = document.getElementById('multi-statut');
const multiJoueurs = document.getElementById('multi-joueurs');
const multiResume = document.getElementById('multi-resume');

function openMultiDialog() {
    multiDialog.showModal();
}
document.getElementById('multi').addEventListener('click', openMultiDialog);
document.getElementById('multi').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openMultiDialog();
});

try { multiPseudo.value = localStorage.getItem('pseudo') ?? ''; } catch { /* stockage indisponible */ }
function pseudo() {
    const name = multiPseudo.value.trim() || 'Pilote';
    try { localStorage.setItem('pseudo', name); } catch { /* stockage indisponible */ }
    return name;
}

document.getElementById('multi-creer').addEventListener('click', () => multiplayer.create(pseudo()));
document.getElementById('multi-rejoindre').addEventListener('click', () => {
    if (multiCode.value.trim()) multiplayer.join(multiCode.value, pseudo());
});
multiCode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && multiCode.value.trim()) multiplayer.join(multiCode.value, pseudo());
});
document.getElementById('multi-quitter').addEventListener('click', () => multiplayer.leave());
document.getElementById('multi-fermer').addEventListener('click', () => multiDialog.close());

const multiPartage = document.getElementById('multi-partage');
const multiLien = document.getElementById('multi-lien');

multiplayer.addEventListener('status', ({ detail }) => {
    multiStatut.textContent = detail.text;
    multiStatut.classList.toggle('erreur', detail.error);
    updateMultiResume();
    multiPartage.hidden = !multiplayer.code;
    multiLien.value = multiplayer.link;
});

document.getElementById('multi-copier').addEventListener('click', async (event) => {
    try {
        await navigator.clipboard.writeText(multiplayer.link);
        event.currentTarget.textContent = 'Lien copié ✓';
        setTimeout(() => { event.target.textContent = 'Copier le lien'; }, 2000);
    } catch {
        multiLien.select(); // copie manuelle (Ctrl+C) si le presse-papiers est refusé
    }
});

window.addEventListener('pagehide', () => multiplayer.leave());

// --- Choix du point de départ ---------------------------------------------------------------
// Au lancement (et bouton "Changer de départ") : carte de l'aérodrome, seuils de piste (prêt à décoller) et places
// de parking libres (avion éteint)
let currentSpawn = airport.spawns[0];
const spawnDialog = document.getElementById('depart-dialog');
const spawnList = document.getElementById('depart-liste');
let spawnHover = null;

// Cases jaunes virtuelles posées sur les points de départ (visibles seulement pendant le choix) : contour au sol,
// volume translucide, flèche du cap de départ et numéro au-dessus. Cliquables dans la vue 3D
const spawnMarkers = new THREE.Group();
spawnMarkers.visible = false;
scene.add(spawnMarkers);
function numberSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1a1a1a';
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 72px DejaVu Sans, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, toneMapped: false, sizeAttenuation: false }));
    sprite.scale.set(0.055, 0.055, 1);
    sprite.center.set(0.5, -0.35);   // numéro au-dessus de la case (ne la cache pas)
    sprite.renderOrder = 12;
    return sprite;
}
airport.spawns.forEach((spawn, i) => {
    const size = 24, height = 8;
    const marker = new THREE.Group();
    marker.position.set(spawn.x, 0.1, spawn.z);
    marker.rotation.y = spawn.heading;
    const fill = new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, height, size), fill);
    box.position.y = height / 2;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0xffe14d, toneMapped: false }));
    edges.position.copy(box.position);
    // Flèche au sol : direction dans laquelle l'avion sera tourné
    const arrowShape = new THREE.Shape([new THREE.Vector2(0, 10), new THREE.Vector2(5, 3), new THREE.Vector2(1.6, 3), new THREE.Vector2(1.6, -8),
        new THREE.Vector2(-1.6, -8), new THREE.Vector2(-1.6, 3), new THREE.Vector2(-5, 3)]);
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0xffd400, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
    arrow.rotation.x = -Math.PI / 2;   // plan (x, y) -> sol ; pointe vers -z (nord local = cap de l'avion)
    arrow.position.y = 0.15;
    const label = numberSprite(String(i + 1));
    label.position.y = height + 10;
    marker.add(box, edges, arrow, label);
    marker.userData = { spawn, fill, edges };
    box.userData.spawn = spawn;
    spawnMarkers.add(marker);
});

// Case survolée : plus lumineuse ; les autres pulsent doucement
function updateSpawnMarkers() {
    if (!spawnMarkers.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3);
    for (const marker of spawnMarkers.children) {
        const hover = marker.userData.spawn === spawnHover;
        marker.userData.fill.opacity = hover ? 0.55 : 0.16 + 0.12 * pulse;
        marker.userData.edges.material.color.setScalar(1).multiply(new THREE.Color(hover ? 0xffffff : 0xffe14d));
        marker.scale.setScalar(hover ? 1.15 : 1);
    }
    for (const button of spawnList.children) button.classList.toggle('survol', button.dataset.spawn === spawnHover?.id);
}

// Case jaune sous le pointeur, dans la vue 3D
const spawnRaycaster = new THREE.Raycaster();
function spawnUnderPointer(event) {
    if (!choosingSpawn) return null;
    const rect = view.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    spawnRaycaster.setFromCamera(ndc, camera);
    const boxes = spawnMarkers.children.map((marker) => marker.children[0]);
    const hit = spawnRaycaster.intersectObjects(boxes, false)[0];
    if (hit) return hit.object.userData.spawn;
    // Au loin, les cases sont petites à l'écran : tolérance autour de leur centre
    let best = null, bestDistance = 40;
    for (const marker of spawnMarkers.children) {
        const p = marker.position.clone().project(camera);
        const d = Math.hypot((p.x - ndc.x) * rect.width / 2, (p.y - ndc.y) * rect.height / 2);
        if (d < bestDistance) [best, bestDistance] = [marker.userData.spawn, d];
    }
    return best;
}

// État de l'avion au point de départ : prêt à voler sur la piste, éteint au parking (frein serré, gaz réduits)
function applySpawnState() {
    systems.reset();
    if (currentSpawn.cold) {
        systems.coldAndDark();
        controls.throttle = 0;
        controls.parkingBrake = systems.brake = true;
    } else {
        controls.parkingBrake = systems.brake = false;
        systems.switches.land = (weather?.night ?? 0) >= 0.5;
    }
    applyLights();
}

function spawnAt(spawn) {
    currentSpawn = spawn;
    aircraft.position.set(spawn.x, 0, spawn.z);
    aircraft.rotation.set(0, spawn.heading, 0);
    controls.placeOnGround();
    applySpawnState();
    controls.saveState();
    controls.reset();   // repart de là (même chemin que la touche R : caméra, effets, bandeau de crash)
}

function openSpawnDialog() {
    spawnList.replaceChildren(...airport.spawns.map((spawn, i) => {
        const button = document.createElement('button');
        button.dataset.spawn = spawn.id;
        const number = document.createElement('span');
        number.className = 'depart-numero';
        number.textContent = String(i + 1);
        const text = document.createElement('span');
        text.textContent = spawn.name;
        const detail = document.createElement('small');
        detail.textContent = spawn.detail;
        text.append(detail);
        button.append(number, text);
        button.addEventListener('click', () => chooseSpawn(spawn));
        button.addEventListener('pointerenter', () => { spawnHover = spawn; });
        button.addEventListener('pointerleave', () => { spawnHover = null; });
        return button;
    }));
    spawnDialog.hidden = false;
    // L'avion disparaît du monde (ni visible, ni physique, ni son, ni envoyé aux autres joueurs) jusqu'au choix ;
    // vue en temps réel au-dessus de l'aérodrome, cases jaunes sur les départs possibles
    choosingSpawn = true;
    aircraft.visible = false;
    spawnMarkers.visible = true;
}

function closeSpawnDialog() {
    spawnDialog.hidden = true;
    choosingSpawn = false;
    spawnHover = null;
    spawnMarkers.visible = false;
    aircraft.visible = true;
    view.style.cursor = '';
}

function chooseSpawn(spawn) {
    closeSpawnDialog();
    spawnAt(spawn);
    view.focus();
}

view.addEventListener('pointermove', (event) => {
    if (!choosingSpawn) return;
    spawnHover = spawnUnderPointer(event);
    view.style.cursor = spawnHover ? 'pointer' : '';
});
view.addEventListener('click', (event) => {
    const spawn = spawnUnderPointer(event);
    if (spawn) chooseSpawn(spawn);
});
// Échap : on garde le départ en cours
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !spawnDialog.hidden) {
        closeSpawnDialog();
        updateCamera(0, true);
        view.focus();
    }
});
document.getElementById('depart').addEventListener('click', (event) => {
    closeMenus();
    openSpawnDialog();
    event.currentTarget.blur();
});
openSpawnDialog();
multiplayer.addEventListener('players', () => {
    const names = multiplayer.code ? [`${multiplayer.name} (vous)`, ...[...multiplayer.players.values()].map((p) => p.name)] : [];
    multiJoueurs.replaceChildren(...names.map((name) => {
        const item = document.createElement('li');
        item.textContent = name;
        return item;
    }));
    updateMultiResume();
});

function updateMultiResume() {
    const count = multiplayer.players.size;
    multiResume.textContent = multiplayer.code
        ? `Partie ${multiplayer.code} · ${count + 1} joueur${count ? 's' : ''}`
        : 'Hors ligne';
    updateOnlineList();
}

// Couleur de l'avion (livrée) : appliquée à notre avion et envoyée aux autres joueurs
const multiLivree = document.getElementById('multi-livree');
for (const [id, livery] of Object.entries(LIVERIES)) multiLivree.add(new Option(livery.label, id));
try {
    const saved = localStorage.getItem('livree');
    if (isLivery(saved)) multiplayer.livery = saved;
} catch { /* stockage indisponible */ }
multiLivree.value = multiplayer.livery;
multiLivree.addEventListener('change', () => {
    multiplayer.livery = isLivery(multiLivree.value) ? multiLivree.value : DEFAULT_LIVERY;
    if (aircraftModel) paintAircraft(aircraftModel, multiplayer.livery);
    try { localStorage.setItem('livree', multiplayer.livery); } catch { /* stockage indisponible */ }
});

// Liste "En ligne" du bandeau : joueurs de la partie, distance et altitude, qui parle à la radio
const onlineMenu = document.getElementById('online');
const onlineNombre = document.getElementById('online-nombre');
const onlineListe = document.getElementById('online-liste');
const onlinePartie = document.getElementById('online-partie-nom');
let onlineTimer = 0;

function formatAltitude(feet) {
    return `${(Math.round(Math.max(0, feet) / 10) * 10).toLocaleString('fr-FR')} ft`;
}

function playerRow(name, color, info, speaking) {
    const item = document.createElement('li');
    item.classList.toggle('parle', speaking);
    const dot = document.createElement('span');
    dot.className = 'joueur-pastille';
    dot.style.background = color;
    const label = document.createElement('span');
    label.className = 'joueur-nom';
    label.textContent = name;
    const detail = document.createElement('span');
    detail.className = 'joueur-info';
    detail.textContent = info;
    item.append(dot, label, detail);
    return item;
}

function updateOnlineList() {
    onlineNombre.textContent = multiplayer.code ? String(multiplayer.players.size + 1) : '0';
    onlinePartie.textContent = multiplayer.code
        ? `Partie ${multiplayer.code}`
        : 'Hors ligne : créez ou rejoignez une partie pour voler à plusieurs';
    if (!multiplayer.code) {
        onlineListe.replaceChildren();
        return;
    }
    const rows = [playerRow(`${multiplayer.name} (vous)`, RemotePlayers.color(multiplayer.livery),
        formatAltitude((aircraft.position.y - WHEEL_HEIGHT) / 0.3048), radio.talking)];
    for (const player of remotePlayers.list()) {
        const distance = formatNM(player.position.distanceTo(aircraft.position));
        rows.push(playerRow(player.name, player.color,
            player.crashed ? 'crash' : player.offline ? 'hors ligne' : `${distance} NM · ${formatAltitude(player.altitude)}`, player.speaking));
    }
    // Joueurs connus dont l'avion n'est pas encore affiché (modèle 3D en cours de chargement)
    for (const [id, player] of multiplayer.players) {
        if (!remotePlayers.planes.has(id)) rows.push(playerRow(player.name, RemotePlayers.color(player.livery), '…', false));
    }
    onlineListe.replaceChildren(...rows);
}

onlineMenu.querySelector('.menu-titre').addEventListener('click', () => updateOnlineList());
document.getElementById('online-multi').addEventListener('click', (event) => {
    closeMenus();
    openMultiDialog();
    event.currentTarget.blur();
});

// Radio : maintenir N pour parler ; le bouton du menu "En ligne" autorise le micro à l'avance
const radioStatut = document.getElementById('radio-statut');
const radioButton = document.getElementById('radio-activer');
const radioIndicator = document.getElementById('radio-indicateur');
let radioMessageTimer = 0;

radioButton.addEventListener('click', (event) => {
    radio.enable();
    event.currentTarget.blur();
});
radio.addEventListener('state', ({ detail }) => {
    radioStatut.textContent = detail.text;
    radioStatut.classList.toggle('erreur', !detail.ready);
    radioButton.hidden = detail.ready;
    // Aussi à l'écran : le menu est souvent fermé quand on appuie sur N
    if (!detail.ready) showRadioMessage(detail.text);
});
radio.addEventListener('talk', ({ detail }) => {
    if (detail.id) {
        if (detail.on) remotePlayers.speaking.add(detail.id);
        else remotePlayers.speaking.delete(detail.id);
    }
    clearTimeout(radioMessageTimer);
    updateRadioIndicator();
    updateOnlineList();
});

function showRadioMessage(text) {
    radioIndicator.textContent = text;
    radioIndicator.classList.remove('emission');
    radioIndicator.hidden = false;
    clearTimeout(radioMessageTimer);
    radioMessageTimer = setTimeout(updateRadioIndicator, 3500);
}

// Voyant : "ÉMISSION RADIO" quand on parle, sinon le nom de ceux qui parlent
function updateRadioIndicator() {
    const names = [...remotePlayers.speaking].map((id) => multiplayer.players.get(id)?.name).filter(Boolean);
    radioIndicator.classList.toggle('emission', radio.talking);
    radioIndicator.textContent = radio.talking ? 'ÉMISSION RADIO' : names.length ? `RADIO · ${names.join(', ')}` : '';
    radioIndicator.hidden = !radio.talking && !names.length;
}

function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyN' && !event.repeat && !isTypingTarget(event.target)) radio.setTalking(true);
});
window.addEventListener('keyup', (event) => {
    if (event.code === 'KeyN') radio.setTalking(false);
});
window.addEventListener('blur', () => radio.setTalking(false));

// Crash d'un autre joueur : explosion à l'endroit de l'impact, bruit moins fort et retardé de loin
const remoteCrashes = [];
remotePlayers.addEventListener('crash', ({ detail }) => {
    const effect = new CrashEffect();
    const ground = terrain.heightAt(detail.position.x, detail.position.z);
    effect.start(detail.position.clone().setY(Math.max(ground, detail.position.y - WHEEL_HEIGHT)));
    scene.add(effect.group);
    remoteCrashes.push(effect);
    const distance = detail.position.distanceTo(camera.position);
    sounds.play('crash', { volume: THREE.MathUtils.clamp(60 / distance, 0.05, 1), delay: Math.min(3, distance / 343) });
});

function updateRemoteCrashes(delta) {
    for (let i = remoteCrashes.length - 1; i >= 0; i--) {
        const effect = remoteCrashes[i];
        effect.update(delta);
        if (!effect.group.visible) {
            scene.remove(effect.group);
            remoteCrashes.splice(i, 1);
        }
    }
}

// Carte : bouton du bandeau ou touche M
const mapPanel = document.getElementById('carte');
const mapButton = document.getElementById('carte-bouton');
const mapView = new MapView(document.getElementById('carte-canvas'), {
    heightAt: (x, z) => terrain.heightAt(x, z),
    worldSize: terrain.size,
    shapes: airport.mapShapes,
    runways: airport.runways,
    navaids: [airport.vor],
});

function toggleMap(open = mapPanel.hidden) {
    mapPanel.hidden = !open;
    mapButton.setAttribute('aria-pressed', String(open));
    if (open) updateMap(0, true);
}

function updateMap(delta, now = false) {
    if (mapPanel.hidden) return;
    const own = { position: aircraft.position, heading: controls.getHeading(), color: RemotePlayers.color(multiplayer.livery) };
    if (now) mapView.draw(own, remotePlayers.list());
    else mapView.update(delta, own, remotePlayers.list());
}

mapButton.addEventListener('click', (event) => {
    toggleMap();
    event.currentTarget.blur();
});
document.getElementById('carte-fermer').addEventListener('click', () => toggleMap(false));
for (const [id, step] of [['carte-plus', 1], ['carte-moins', -1]]) {
    document.getElementById(id).addEventListener('click', (event) => {
        mapView.zoomBy(step);
        updateMap(0, true);
        event.currentTarget.blur();
    });
}
document.getElementById('carte-canvas').addEventListener('wheel', (event) => {
    event.preventDefault();
    mapView.zoomBy(event.deltaY < 0 ? 1 : -1);
    updateMap(0, true);
}, { passive: false });
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM' && !event.repeat && !isTypingTarget(event.target)) toggleMap();
});

// Lien d'invitation : index.html?partie=CODE rejoint directement la partie
const invitation = new URLSearchParams(location.search).get('partie');
if (invitation) {
    multiCode.value = invitation.toUpperCase();
    multiplayer.join(invitation, pseudo());
    openMultiDialog();
}
updateOnlineList();

// Instruments de la cabine : valeurs lues sur les commandes
function cockpitState() {
    return {
        speed: controls.getSpeed(),
        altitude: controls.getAltitude() - WHEEL_HEIGHT,
        verticalSpeed: controls.getVerticalSpeed(),
        heading: controls.getHeading(),
        roll: controls.getRoll(),
        pitchDeg: Math.atan(controls.getPitchRate()) * 180 / Math.PI,
        throttle: controls.getThrottle(),
        inputs: controls.getInputs(),
        flapSetting: controls.getFlapSetting(),
        flaps: controls.getFlaps(),
        trim: controls.getTrim(),
        takeoffTrim: controls.getTakeoffTrim(),
        trimLimits: controls.getTrimLimits(),
        trimSpeed: controls.getTrimSpeed(),
        onGround: controls.isOnGround(),
        crashed: controls.isCrashed(),
        stallWarning: controls.isNearStall(),
        ils: { ...ils.state, active: ils.active },
        vor: vor.state,
        systems,
        flapLevel: controls.getFlapLevel(),
    };
}

// ILS : disponible près de la piste, dans l'axe d'approche. Bouton sur le tableau de bord en cabine,
// bouton à l'écran en vue extérieure, touche I dans les deux cas.
const ils = new ILS(airport.runways, airport.runwayLength);

// VOR (NAV1) : balise de l'aérodrome. Indicateur au tableau de bord ; en vue extérieure, touche O.
// OBS : J / K (Maj : 10° par appui), H : centrer l'aiguille sur la route directe vers la balise
const vor = new VOR(airport.vor);
const vorPanel = document.getElementById('vor-panneau');
const vorCanvas = document.getElementById('vor-canvas');
let vorShown = false, vorTimer = 0;
window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) return;
    if (event.code === 'KeyJ' || event.code === 'KeyK') vor.turnCourse((event.code === 'KeyJ' ? -1 : 1) * (event.shiftKey ? 10 : 1));
    if (event.code === 'KeyH' && !event.repeat) vor.centerTo();
    if (event.code === 'KeyO' && !event.repeat) vorShown = !vorShown;
});

// Boutons du panneau VOR en vue extérieure
for (const [id, action] of [['vor-moins', () => vor.turnCourse(-1)], ['vor-plus', () => vor.turnCourse(1)], ['vor-to', () => vor.centerTo()]]) {
    document.getElementById(id).addEventListener('click', (event) => {
        action();
        vorTimer = 0;
        event.currentTarget.blur();
    });
}

function updateVor(delta) {
    vor.update(aircraft.position);
    vorPanel.hidden = !(chaseView && vorShown);
    if (vorPanel.hidden || (vorTimer -= delta) > 0) return;
    vorTimer = 0.1;
    const ctx = vorCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#25272b';
    ctx.fillRect(0, 0, vorCanvas.width, vorCanvas.height);
    vorIndicator(ctx, vorCanvas.width / 2, 112, 92, vor.state);
}
const ilsButton = document.getElementById('ils-bouton');
const ilsPanel = document.getElementById('ils-panneau');
const ilsLoc = document.getElementById('ils-loc');
const ilsGs = document.getElementById('ils-gs');
const ilsText = document.getElementById('ils-texte');

function toggleIls() {
    ils.toggle();
    updateIls();
}

function updateIls() {
    const state = ils.update(aircraft.position);
    const showButton = chaseView && state.available && !controls.isCrashed();
    ilsButton.hidden = !showButton;
    ilsButton.classList.toggle('actif', ils.active);
    if (showButton) ilsButton.textContent = ils.active ? `ILS ${state.runway} ✓` : `ILS ${state.runway} disponible`;

    ilsPanel.hidden = !(chaseView && ils.active);
    if (ilsPanel.hidden) return;
    // Aiguilles : ±40 % de la taille du cadran en butée
    ilsLoc.style.left = `${50 + state.localizer * 40}%`;
    ilsGs.style.top = `${50 - state.glideslope * 40}%`;
    ilsGs.hidden = state.distance <= 0;
    // Unités aéronautiques : distance en milles nautiques, hauteurs en pieds
    ilsText.textContent = `Piste ${state.runway} · ${(state.distance / 1852).toFixed(1)} NM\n`
        + `Hauteur ${Math.round(state.height / 0.3048)} ft (idéal ${Math.round(state.glideHeight / 0.3048)} ft)\n${ils.advice()}`;
}

ilsButton.addEventListener('click', (event) => {
    toggleIls();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyI' && !event.repeat && !(event.target instanceof HTMLInputElement)) toggleIls();
});

// Commande de la cabine sous le pointeur : { id, side, vertical } (voir Cockpit.controlAt)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function controlAt(event) {
    if (chaseView || choosingSpawn) return null;
    const rect = view.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(cockpit.clickables, false)[0];
    return hit ? cockpit.controlAt(hit) : null;
}
function obsUnderPointer(event) {
    return controlAt(event)?.id === 'obs';
}

// Action d'une commande : clic (step = côté cliqué : -1 / +1) ou molette (step = -1 / +1). fine : Maj (pas plus grand)
function useControl(control, step, wheel = false, fine = false) {
    const { id } = control;
    const trimStep = THREE.MathUtils.degToRad(fine ? 5 : 1);
    if (id === 'ils') toggleIls();
    else if (id === 'obs') vor.turnCourse(step * (fine ? 10 : 1));
    else if (id === 'mags') systems.turnMagnetos(step);
    else if (id.startsWith('switch:') || id.startsWith('breaker:')) {
        if (wheel) return false;
        systems.toggle(id.split(':')[1]);
    } else if (id === 'panelLights') systems.setPanelLights(systems.panelLights + step * 0.1);
    else if (id.startsWith('flaps:')) {
        // Molette ou levier 3D (moitié haute : rentrer, basse : sortir) : un cran ; échelle : cran cliqué
        if (wheel || id === 'flaps:lever') controls.setFlapLevel(THREE.MathUtils.clamp(controls.getFlapLevel() + (wheel ? -step : step), 0, 3));
        else controls.setFlapLevel(Number(id.split(':')[1]));
    } else if (id === 'throttle') controls.throttle = THREE.MathUtils.clamp(controls.throttle + step * (fine ? 0.02 : 0.1), 0, 1);
    else if (id === 'mixture') systems.setMixture(systems.mixture + step * (fine ? 0.02 : 0.1));
    else if (id === 'trimWheel') {
        const [min, max] = controls.getTrimLimits().map(THREE.MathUtils.degToRad);
        controls.trim = THREE.MathUtils.clamp(controls.trim + step * trimStep, min, max);
    } else if (id === 'fuelShutoff') {
        if (wheel) return false;
        systems.toggleFuelShutoff();
    } else if (id === 'fuelSelector') systems.turnFuelSelector(step);
    else if (id === 'brake') {
        if (wheel) return false;
        controls.parkingBrake = !controls.parkingBrake;
        systems.brake = controls.parkingBrake;
    } else return false;
    if (id !== 'trimWheel') sounds.click(); // la molette de trim fait ses crans d'elle-même (voir la boucle)
    return true;
}

// En cabine : clic (sans glisser) sur une commande. Boutons rotatifs : côté gauche = moins, côté droit = plus ;
// manettes (gaz, mixture) et molette de trim : moitié haute = pousser / piquer, moitié basse = tirer / cabrer
view.addEventListener('click', (event) => {
    if (dragDistance > 6) return;
    const control = controlAt(event);
    if (!control) return;
    const vertical = ['throttle', 'mixture'].includes(control.id) ? -control.vertical
        : ['trimWheel', 'flaps:lever'].includes(control.id) ? control.vertical : control.side;
    useControl(control, vertical || 1, false, event.shiftKey);
});
// Main au-dessus d'une commande : curseur "main"
view.addEventListener('pointermove', (event) => {
    if (drag || chaseView) {
        if (!drag) view.style.cursor = '';
        return;
    }
    view.style.cursor = controlAt(event) ? 'pointer' : '';
});

// Bruits de l'environnement : pluie (étouffée en cabine), roulement des pneus selon le revêtement
function updateSounds() {
    // Pluie là où est l'avion : rien au-dessus des nuages ; gouttes sur le pare-brise et bruit en conséquence
    const rain = storm.rainAt(camera.position.y);
    cockpit.setRain(rain);
    sounds.setLoop('rain', rain * (chaseView ? 0.8 : 0.25));
    sounds.setLoop('rainCockpit', rain * (chaseView ? 0 : 0.9));
    const rolling = controls.isOnGround() && !controls.isCrashed() ? Math.min(1, controls.getSpeed() / 20) * 0.6 : 0;
    const grass = controls.getSurface() === 'grass';
    const rate = 0.7 + controls.getSpeed() / 40;
    sounds.setLoop('rollAsphalt', grass ? 0 : rolling, rate);
    sounds.setLoop('rollGrass', grass ? rolling : 0, rate);
    // Moteur des volets : seulement pendant qu'ils bougent, clac de fin de course à l'arrêt ; plus fort en cabine
    // (il est dans l'aile, au-dessus)
    const flaps = controls.getFlaps();
    const moving = Math.abs(flaps - lastFlaps) > 1e-5 && !choosingSpawn;
    if (flapsMoving && !moving) sounds.play('flapsStop', { volume: chaseView ? 0.25 : 0.6 });
    flapsMoving = moving;
    lastFlaps = flaps;
    sounds.setLoop('flapMotor', moving ? (chaseView ? 0.25 : 0.7) : 0, 1);
    // Pompe à carburant électrique : bourdonnement tant qu'elle tourne (sous le plancher, à peine audible dehors)
    sounds.setLoop('fuelPump', systems.fuelPumpRunning && !choosingSpawn ? (chaseView ? 0.05 : 0.22) : 0, 1.7);
}

const aircraftVelocity = new THREE.Vector3();
const lastAircraftPosition = aircraft.position.clone();

// Compteur de performances (touche P) : images par seconde, temps de calcul, appels de dessin, triangles
const perfPanel = document.getElementById('perf');
const perf = { frames: 0, time: 0, cpu: 0, calls: 0, triangles: 0, last: performance.now() };
renderer.info.autoReset = false; // le post-traitement dessine en plusieurs passes : on compte l'image entière
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyP' && !event.repeat && !(event.target instanceof HTMLInputElement)) settings.set('perf', !settings.values.perf);
});

// Paramètres graphiques : menu ouvert depuis la case "Paramètre" du bandeau ou le bouton ⚙ Qualité
const settings = new Settings();
const settingsDialog = document.getElementById('reglages-dialog');
let fpsLimit = 0;   // 0 = pas de limite (fréquence de l'écran)

function applySettings(values) {
    fpsLimit = values.fps;
    graphics.targetFps = values.fps || 60;
    graphics.setResolution(values.resolution);
    graphics.setAntialias(values.antialias);
    graphics.setShadows(values.shadows);
    graphics.setBloom(values.bloom);
    clouds.setDetail(values.clouds);
    cloudLayer.setEnabled(values.cloudLayer);
    terrain.setDetail(values.terrain);
    decorDensity = values.decor;
    applyDecorDensity();
    perfPanel.hidden = !values.perf;
    remotePlayers.showLabels = values.labels;
    radio.setVolume(values.radioVolume);
    Object.assign(controls.assists, {
        rotation: values.rotationAuto,
        stallProtection: values.stallProtection,
        smoothLiftoff: values.smoothLiftoff,
    });
}

settings.buildForm(document.getElementById('reglages-liste'));
settings.addEventListener('change', ({ detail }) => applySettings(detail));
applySettings(settings.values);

function openSettings() {
    settingsDialog.showModal();
}
document.getElementById('paramètre').addEventListener('click', openSettings);
document.getElementById('paramètre').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openSettings();
});
document.getElementById('qualite').addEventListener('click', (event) => {
    openSettings();
    event.currentTarget.blur();
});
document.getElementById('reglages-fermer').addEventListener('click', () => settingsDialog.close());

function updatePerf(cpuTime) {
    perf.frames++;
    perf.cpu += cpuTime;
    perf.calls += renderer.info.render.calls;
    perf.triangles += renderer.info.render.triangles;
    renderer.info.reset();
    const now = performance.now();
    if (now - perf.last < 1000) return;
    const n = perf.frames, elapsed = (now - perf.last) / 1000;
    perfPanel.textContent = `${(n / elapsed).toFixed(0)} i/s  ·  JS ${(perf.cpu / n).toFixed(1)} ms/image
`
        + `${Math.round(perf.calls / n)} appels de dessin  ·  ${(perf.triangles / n / 1000).toFixed(0)} k triangles
`
        + `résolution ×${renderer.getPixelRatio().toFixed(2)}  ·  ${view.width}×${view.height}`;
    perfPanel.dataset.fps = (n / elapsed).toFixed(1);
    Object.assign(perf, { frames: 0, cpu: 0, calls: 0, triangles: 0, last: now });
}

let nextFrameTime = 0;
let lastTrim = controls.getTrim(), trimTravel = 0, lastFlaps = 0, flapsMoving = false;

renderer.setAnimationLoop((time)=>{
    // Limite d'images par seconde (réglage) : on saute les rafraîchissements d'écran en trop
    if (fpsLimit > 0) {
        const interval = 1000 / fpsLimit;
        if (time < nextFrameTime - 1.5) return;
        nextFrameTime = Math.max(nextFrameTime + interval, time); // rattrape le retard sans s'emballer
    }
    // Changement de résolution AVANT de dessiner : redimensionner le canvas l'efface ; fait après le dessin,
    // l'image affichée était vide (éclair noir) jusqu'à l'image suivante
    graphics.adaptResolution();
    const frameStart = performance.now();
    const delta = clock.getDelta();

    if (!choosingSpawn) controls.update( delta );
    aircraft.updateMatrixWorld();
    if (delta > 0) aircraftVelocity.subVectors(aircraft.position, lastAircraftPosition).divideScalar(delta);
    lastAircraftPosition.copy(aircraft.position);

    // Secousses : s'amortissent, entretenues au roulage (plus fort dans l'herbe). Elles croissent avec la vitesse
    // jusqu'à ~40 km/h, puis diminuent : à l'approche du décollage, l'aile porte l'avion et déleste les roues
    shake *= Math.exp(-4 * delta);
    if (controls.isOnGround() && !controls.isCrashed()) {
        const speed = controls.getSpeed();
        const wheelLoad = Math.max(0.15, 1 - (speed / (controls.rotateSpeed * 1.5)) ** 2);
        shake = Math.max(shake, Math.min(speed, 12) * wheelLoad * (controls.getSurface() === 'grass' ? 0.0015 : 0.0003));
    }
    updateHeadTarget( delta );
    updateSpawnMarkers();
    updateCamera( delta );
    // Molette de trim (touches W / X, ou à la souris) : un cran entendu tous les 0,6°
    trimTravel += Math.abs(controls.getTrim() - lastTrim);
    lastTrim = controls.getTrim();
    if (trimTravel >= 0.6) {
        trimTravel = 0;
        sounds.click(0.22);
    }

    updatePropeller( delta );
    // Systèmes : moteur, carburant, électricité ; le modèle de vol en reçoit la puissance et l'alimentation des volets
    if (!controls.isCrashed() && !choosingSpawn) systems.update(delta, controls.getThrottle(), controls.getSpeed());
    controls.model.enginePower = systems.power;
    controls.model.flapsPowered = systems.flapsPowered;
    const engineVolume = controls.isCrashed() || choosingSpawn ? 0 : (chaseView ? 1 : 0.7) * THREE.MathUtils.clamp(systems.rpm / 600, 0, 1);
    engineSound.update(controls.getThrottle() * systems.power, engineVolume, systems.running ? 1 : 0.45);
    updateSounds();
    if (!choosingSpawn) multiplayer.update( aircraft, controls.getThrottle() * systems.power, { crashed: controls.isCrashed(), crashes: crashCount } );
    camera.updateMatrixWorld();
    engineSound.setListener( camera );
    remotePlayers.engineVolume = chaseView ? 1 : 0.6; // moteurs des autres étouffés en cabine
    remotePlayers.update( delta, aircraft.position, camera, clock.elapsedTime );
    updateRemoteCrashes( delta );
    updateMap( delta );
    // Liste "En ligne" ouverte : distances et altitudes mises à jour chaque seconde
    if ((onlineTimer -= delta) <= 0) {
        onlineTimer = 1;
        if (!onlineMenu.querySelector('.menu-contenu').hidden) updateOnlineList();
    }
    clouds.update( camera );
    cloudLayer.update( delta, camera, weather.wind );
    for (const object of detailedObjects) {
        object.visible = object.boundingSphere.distanceToPoint(camera.position) < DETAIL_DISTANCE;
    }
    nightSky.update( camera );
    storm.update( delta, camera, aircraftVelocity, chaseView ? 0 : 3 );
    airport.update( delta, weather.wind, camera );
    airport.updateHangars( delta, aircraft.position );
    crashEffect.update( delta );
    aircraftLights.update( camera, clock.elapsedTime );
    updateIls();
    updateVor( delta );
    controlSurfaces?.update( delta, controls.getInputs(), controls.getFlaps() );
    // Instruments et manches animés en cabine, et en vue extérieure quand on est assez près pour les voir
    if (!chaseView || camera.position.distanceTo(aircraft.position) < 30) cockpit.update( delta, cockpitState() );
    updateFog();
    updateStallWarning();

    shadowCenter.set(aircraft.position.x, terrain.heightAt(aircraft.position.x, aircraft.position.z), aircraft.position.z);
    graphics.update( shadowCenter );
    graphics.setAlarm( controls.isStalled() ? 0.5 + 0.3 * Math.sin(clock.elapsedTime * 10) : 0 );
    graphics.render();
    updatePerf(performance.now() - frameStart);
});
