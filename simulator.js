import * as THREE from 'three';
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
import { ControlSurfaces, Gear } from './js/ControlSurfaces.js';
import { Settings } from './js/Settings.js';
import { AircraftLights } from './js/AircraftLights.js';
import { ILS } from './js/ILS.js';
import { Radio } from './js/Radio.js';
import { MapView } from './js/MapView.js';
import { ATC } from './js/ATC.js';
import { Wind } from './js/Wind.js';
import { RadioVoices } from './js/RadioVoices.js';
import { Initiation } from './js/Initiation.js';
import { Scenery } from './js/Scenery.js';
import { Avionics, parseFrequency } from './js/Avionics.js';
import { loadAircraft, buildCabinShell, setRegistration, setDaylight, GROUND_Y, CABIN_ORIGIN, AIRCRAFT_SCALE } from './js/C172Model.js';
import { LIVERIES, DEFAULT_LIVERY, isLivery, paintAircraft } from './js/Liveries.js';

// Toujours la dernière version publiée, malgré le cache de 10 min de GitHub Pages (voir sw.js)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((error) => console.warn(error));

const CAM_FOV = 60, COCKPIT_FOV = 62, CAM_NEAR = 0.1, CAM_FAR = 3000;
const COLOR_GROUND = 0x219313, COLOR_LIGHT = 0xfdfefe;
// Lumière renvoyée par le sol : vert-gris sourd (un vert pur teintait en vert le dessous des ailes et le ventre de l'avion)
const COLOR_GROUND_BOUNCE = 0x5d6450;
const WORLD_SIZE = 1000;      // zone de placement aléatoire des objets
const CRASH_RESET_DELAY = 5000; // retour au point de départ après un crash (ms)

// Avion : Cessna 172P du projet FlightGear (C172Model.js, asset/c172p.glb)
const WHEEL_HEIGHT = -GROUND_Y;                             // origine de l'avion au-dessus du sol, roues posées
const COCKPIT_POSITION = CABIN_ORIGIN.clone().multiplyScalar(AIRCRAFT_SCALE); // cabine (hauteur des yeux) dans le repère avion
const COCKPIT_TILT = THREE.MathUtils.degToRad(-13);         // regard baissé : horizon au tiers haut de l'écran, tableau en bas
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
                  // rayleigh bas : ciel bien bleu (avec ce shader, plus de diffusion Rayleigh blanchit le ciel) ; brume bleutée assortie
                  atmosphere: { elevation: 40, azimuth: 150, turbidity: 1.8, rayleigh: 1, fog: 0x86acd8 },
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
// La carte graphique peut couper l'affichage 3D (surcharge, pilote, plantage du processus graphique de Chrome) :
// la page continue de tourner mais l'écran reste gris, sans erreur. On le signale, avec un bouton pour recharger
view.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    document.getElementById('contexte-perdu').hidden = false;
});
view.addEventListener('webglcontextrestored', () => { document.getElementById('contexte-perdu').hidden = true; });
document.getElementById('contexte-perdu-recharger').addEventListener('click', () => location.reload());
const airport = new Airport();
// Vallée dégagée dans l'axe de la piste (x 220, nord-sud) : ~2,3 km de chaque côté, ~0,7 km de large
const terrain = new Terrain(renderer, { grassTint: COLOR_GROUND, flatten: (x, z) => airport.reliefFactor(x, z),
    clearing: { x: 220, z: 0, rx: 750, rz: 2300 } });
const clouds = new Clouds();
const cloudLayer = new CloudLayer();
const nightSky = new NightSky();
const stallWarning = new StallWarning();
const engineSound = new EngineSound();
const sounds = new SoundEffects();
const storm = new Storm({ groundHeight: (x, z) => terrain.heightAt(x, z), sounds });
const cockpit = new Cockpit();
try { if (localStorage.getItem('manches') === '0') cockpit.setYokesVisible(false); } catch { /* stockage indisponible */ }
const crashEffect = new CrashEffect();
let weather = null;
const hemiLight = new THREE.HemisphereLight(COLOR_LIGHT, COLOR_GROUND_BOUNCE);
const sunLight = new THREE.DirectionalLight(COLOR_LIGHT);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // au-delà : très coûteux, gain à peine visible (+ MSAA)
const graphics = new Graphics(renderer, scene, camera, sunLight);
const multiplayer = new Multiplayer();
const remotePlayers = new RemotePlayers(scene, multiplayer, { engineSound, altitudeOffset: WHEEL_HEIGHT, registrationFor: (id) => registrationFor(id) });
// Tour de contrôle (contrôleur automatique) : immatriculation française réaliste du Cessna
// Vent variable (force et direction selon la météo) : agit sur l'avion, annoncé par l'ATIS et les contrôleurs
const wind = new Wind();
// Voix de la radio : voix réalistes (téléchargées à la première ouverture de la fenêtre), sinon voix de l'ordinateur
const radioVoices = new RadioVoices();
const atc = new ATC({ airport, wind, voices: radioVoices, sounds, registration: 'F-HESM', aircraftType: 'Cessna 172' });
const radio = new Radio(multiplayer);

const loader = new Utils3dLoader();

// Les commandes pilotent l'avion ; la caméra le suit (cabine ou vue extérieure)
const aircraft = new THREE.Group();
const controls = new PlaneControls( aircraft );
// Systèmes de l'avion (électricité, moteur, carburant, feux) commandés depuis la cabine
const systems = new Systems();
// Radios du tableau (NAV/COM, transpondeur, DME, ADF...), lien avec le contrôle aérien (voir syncRadios)
const avionics = new Avionics();
const radioSync = { freq: null, code: null };
let gloveboxOpen = false;
// Décor instancié, par type d'objet : { meshes, total, obstacles } (voir buildWorld)
const decorGroups = [];
let decorDensity = 1;
let decorStyle = 'realiste';   // 'classique' (arbres stylisés), 'realiste' (forêts et villages), 'mixte' (les deux)
const CLASSIC_TREES = new Set(['TREE', 'TREE_F']);
// Décor réaliste (Scenery.js) : rien dans l'axe d'approche de la piste (x 220, nord-sud), ni sur l'aérodrome
const scenery = new Scenery(scene, { renderer, terrain, airport, corridor: (x, z) => Math.abs(x - 220) < 150 && Math.abs(z) < 3000 });
let aircraftModel = null;
let propeller = null;
let propellerParts = new Set();   // pièces de l'hélice (estompées quand elle tourne vite)
let propellerDisc = null;          // disque de flou de l'hélice qui tourne vite
let controlSurfaces = null;
let gear = null;                  // roulette de nez orientable, roues qui roulent
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
cockpit.group.scale.setScalar(AIRCRAFT_SCALE);   // agrandie comme le modèle de l'avion
aircraft.add(cockpit.group);

// Feux de navigation (rouge à gauche, vert à droite, blanc à l'arrière), anticollision et phare d'atterrissage
// Extérieur de l'avion (modèle, feux, phare)
const airframe = new THREE.Group();
aircraft.add(airframe);
const aircraftLights = new AircraftLights(airframe, { castLight: true });
// Intensités (cd) : sol éclairé au niveau d'un éclairage de jour (soleil : 2), pas au-delà ; cônes serrés : le bas du
// faisceau ne touche le sol que loin devant (un cône de 20° l'éclairait à 5 m de l'avion : sol brûlé, pilote ébloui)
const LANDING_LIGHT = 3000, TAXI_LIGHT = 320;
const landingLight = new THREE.SpotLight(0xfff3d6, 0, 400, THREE.MathUtils.degToRad(11), 0.55, 1.6); // phare d'atterrissage
// Phare dans le bord d'attaque de l'aile gauche, comme sur un vrai Cessna 172
// (dans le nez, il éclairait les pales de l'hélice qui passaient devant : flashs blancs)
landingLight.position.set(-2.92, 1.14, -2.3).multiplyScalar(AIRCRAFT_SCALE);
// Visé ~2° sous l'horizon (sol éclairé surtout vers 50-120 m) : visible depuis la cabine au-dessus du tableau de bord
landingLight.target.position.set(-1.2, -1.8, -80);
airframe.add(landingLight, landingLight.target);
// Phare de roulage : à côté, faisceau large et court, plongeant vers le sol devant l'avion (vers 10-25 m), un peu
// tourné vers l'extérieur : éclaire la voie de circulation et ses bords dans les virages
const taxiLight = new THREE.SpotLight(0xfff3d6, 0, 120, THREE.MathUtils.degToRad(28), 0.75, 1.6);
taxiLight.position.set(-2.807, 1.14, -2.3).multiplyScalar(AIRCRAFT_SCALE);
taxiLight.target.position.set(-5, -2.8, -30);
airframe.add(taxiLight, taxiLight.target);

// Feux réellement allumés : interrupteurs et alimentation ; phares seulement de nuit (le jour, ils ne se
// verraient pas et chaque lumière alourdit le rendu)
function applyLights() {
    const lights = systems.lights;
    const dark = (weather?.night ?? 0) >= 0.5;
    aircraftLights.setSwitches(lights);
    landingLight.visible = lights.land && dark;
    taxiLight.visible = lights.taxi && dark;
}
systems.addEventListener('change', applyLights);
// Démarrage raté : message à l'écran (raison et marche à suivre)
systems.addEventListener('start', () => engineSound.playStart(chaseView ? 1 : 0.7));
systems.addEventListener('stop', () => { if (!controls.isCrashed()) engineSound.playStop(chaseView ? 1 : 0.7); });
systems.addEventListener('startfail', ({ detail }) => showRadioMessage(detail));

// Avion du joueur, et copie aux textures plus légères pour les avions garés et ceux des autres joueurs
loadAircraft().then(({ model, template, parts }) => {
    aircraftModel = model;
    propeller = parts.propeller;
    controlSurfaces = new ControlSurfaces(parts.pivots);
    gear = parts.gear ? new Gear(parts.gear, AIRCRAFT_SCALE) : null;
    setupPropellerBlur(propeller);
    airframe.add(model);
    cockpit.addCabinShell(buildCabinShell(model));   // garnitures intérieures : l'envers de la carrosserie
    setRegistration(model, atc.registration);
    paintAircraft(model, multiplayer.livery);
    aircraftLights.setOccluder(model);
    aircraftLights.setRudder(parts.pivots.rudder);
    remotePlayers.setTemplate(template);
    airport.addParkedPlanes(template, WHEEL_HEIGHT, (plane, livery, registration) => {
        setRegistration(plane, registration);
        paintAircraft(plane, livery);
    });
    rebuildObstacles(); // + les avions garés
}).catch((error) => console.error(error));

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
    const blur = THREE.MathUtils.clamp((spin - 8) / 20, 0, 1);   // au ralenti (~800 tr/min), déjà un disque flou
    propellerDisc.material.opacity = 0.15 * blur; // à peine visible, comme une vraie hélice lancée
    for (const part of propellerParts) if (part !== propellerDisc) part.material.opacity = 1 - 0.8 * blur;
}

// Vue cabine / vue extérieure (bouton ou touche V)
const viewButton = document.getElementById('vue');

function updateView() {
    // L'avion reste entier en vue cabine (aile, capot et hélice vus par les vitres ; l'extérieur du fuselage ne se
    // voit pas de l'intérieur) ; l'intérieur reste affiché en vue extérieure : on le voit à travers les vitres
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

// Caméras de la cabine : touches 1 à 9 et 0, ou Tab / Maj + Tab pour passer à la suivante / précédente.
// eye : position de l'œil (repère cabine, comme Cockpit.js ; par défaut : place du pilote) ; target : point visé
// (sinon yaw / pitch : direction du regard) ; fov : champ de vision ; close : caméra rapprochée sur une partie du
// tableau, comme un pilote qui se penche (manches cachés le temps de la vue)
const PILOT_EYE = cockpit.eye.clone();
const CABIN_VIEWS = {
    1: { label: 'Pilote', yaw: 0, pitch: 0, fov: COCKPIT_FOV },
    2: { label: 'Instruments de vol', eye: [-0.17, -0.02, -0.25], target: [-0.153, -0.23, -0.75], fov: 50, close: true },
    3: { label: 'Magnétos, master et disjoncteurs', eye: [-0.36, -0.12, -0.3], target: [-0.36, -0.43, -0.75], fov: 45, close: true },
    4: { label: 'Interrupteurs et avionique', eye: [-0.25, -0.12, -0.3], target: [-0.25, -0.46, -0.75], fov: 45, close: true },
    5: { label: 'Volets, aération, boîte à gants', eye: [0.2, -0.1, -0.3], target: [0.27, -0.45, -0.75], fov: 50, close: true },
    6: { label: 'Radios (NAV/COM, DME, transpondeur)', eye: [0.0, -0.05, -0.3], target: [0.09, -0.27, -0.75], fov: 45, close: true },
    7: { label: 'Gaz, mixture, éclairage', eye: [-0.05, -0.12, -0.3], target: [0.02, -0.46, -0.75], fov: 45, close: true },
    8: { label: 'Pupitre (trim, robinet)', eye: [-0.1, -0.2, -0.25], target: [0, -0.657, -0.6], fov: 50, close: true },
    9: { label: 'Sélecteur de réservoir', eye: [-0.05, -0.3, -0.25], target: [0, -0.884, -0.45], fov: 50, close: true },
    0: { label: 'Côté gauche', yaw: 1.0, pitch: 0.25, fov: 75 },
};
const VIEW_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
let cabinView = 1;
let headTarget = null;               // regard en cours de rejointe (glissement doux)
const eyeTarget = PILOT_EYE.clone(); // l'œil glisse vers sa place

function setCabinViewPreset(number) {
    const preset = CABIN_VIEWS[number];
    if (!preset) return;
    if (chaseView) toggleView();
    cabinView = number;
    cockpit.setYokesHiddenByView(Boolean(preset.close));
    if (preset.eye) eyeTarget.fromArray(preset.eye);
    else eyeTarget.copy(PILOT_EYE);
    let { yaw, pitch } = preset;
    if (preset.target) {
        const [tx, ty, tz] = preset.target;
        const dx = tx - eyeTarget.x, dy = ty - eyeTarget.y, dz = tz - eyeTarget.z;
        yaw = Math.atan2(-dx, -dz);
        pitch = Math.atan2(dy, Math.hypot(dx, dz)) - COCKPIT_TILT;
    }
    headTarget = { yaw, pitch, fov: preset.fov };
    showViewLabel(preset.label);
}

// Nom de la caméra, affiché brièvement en haut de l'écran
const viewLabel = document.getElementById('nom-vue');
let viewLabelTimer = 0;
function showViewLabel(text) {
    viewLabel.textContent = text;
    viewLabel.classList.add('visible');
    clearTimeout(viewLabelTimer);
    viewLabelTimer = setTimeout(() => viewLabel.classList.remove('visible'), 1500);
}

// Mode Initiation : la caméra se tourne vers une commande (centre et rayon dans le repère de la cabine) ; l'œil s'en
// approche un peu, comme un pilote qui se penche, manches cachés le temps de la vue
function focusCabin(target, radius) {
    if (chaseView) toggleView();
    const direction = target.clone().sub(PILOT_EYE);
    const distance = direction.length();
    const keep = THREE.MathUtils.clamp(radius * 9, 0.3, 0.55);
    eyeTarget.copy(PILOT_EYE).addScaledVector(direction, Math.max(0, distance - keep) / distance);
    cockpit.setYokesHiddenByView(true);
    const dx = target.x - eyeTarget.x, dy = target.y - eyeTarget.y, dz = target.z - eyeTarget.z;
    headTarget = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) - COCKPIT_TILT, fov: 48 };
}

function updateHeadTarget(delta) {
    if (chaseView) return;
    const k = 1 - Math.exp(-8 * delta);
    cockpit.eye.lerp(eyeTarget, k);
    if (!headTarget) return;
    head.yaw += (headTarget.yaw - head.yaw) * k;
    head.pitch += (headTarget.pitch - head.pitch) * k;
    camera.fov += (headTarget.fov - camera.fov) * k;
    camera.updateProjectionMatrix();
    if (Math.abs(headTarget.yaw - head.yaw) + Math.abs(headTarget.pitch - head.pitch) + Math.abs(headTarget.fov - camera.fov) / 100 < 0.002) headTarget = null;
}

window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) return;
    if (event.code === 'Tab') {
        // Caméra suivante (Maj : précédente) ; depuis la vue extérieure : place du pilote
        event.preventDefault();
        if (event.repeat) return;
        const i = VIEW_ORDER.indexOf(cabinView);
        const step = event.shiftKey ? -1 : 1;
        setCabinViewPreset(chaseView ? 1 : VIEW_ORDER[(i + step + VIEW_ORDER.length) % VIEW_ORDER.length]);
        return;
    }
    if (event.repeat) return;
    const match = /^(?:Digit|Numpad)(\d)$/.exec(event.code);
    if (match) setCabinViewPreset(Number(match[1]));
});

function recenterCamera() {
    headTarget = null;
    cabinView = 1;
    cockpit.setYokesHiddenByView(false);
    eyeTarget.copy(PILOT_EYE);
    cockpit.eye.copy(PILOT_EYE);
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
        camera.position.copy(cockpit.eye).multiplyScalar(AIRCRAFT_SCALE).add(COCKPIT_POSITION).applyMatrix4(aircraft.matrixWorld);
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
    const classicShown = decorStyle !== 'realiste';
    for (const group of decorGroups) {
        const count = Math.max(1, Math.round(group.total * decorDensity));
        group.hidden = CLASSIC_TREES.has(group.codeType) && !classicShown;
        for (const mesh of group.meshes) {
            mesh.count = count;
            mesh.visible = !group.hidden;
        }
    }
    scenery.setDensity(decorDensity);
    scenery.setVisible(decorStyle !== 'classique');
    if (decorStyle !== 'classique') scenery.build().then(rebuildObstacles);
    rebuildObstacles();
}

// Obstacles : bâtiments et avions de l'aéroport, et seulement le décor affiché (pas de crash contre un arbre invisible)
function rebuildObstacles() {
    controls.obstacles = [...airport.obstacles];
    for (const group of decorGroups) {
        if (group.hidden) continue;
        const count = group.meshes[0]?.count ?? group.total;
        controls.obstacles.push(...group.obstacles.slice(0, count));
    }
    if (scenery.group.visible) controls.obstacles.push(...scenery.obstacles);
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
            const group = { meshes: [], total: matrices.length, obstacles: [], codeType: type.codeType };
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
    setDaylight(1 - 0.92 * w.night);   // lumière renvoyée sur l'avion et dans la cabine : presque rien la nuit
    controls.turbulence = w.turbulence;
    clouds.setWeather(w.clouds);
    atc.setWeather(name, w);
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
    landingLight.intensity = LANDING_LIGHT;
    taxiLight.intensity = TAXI_LIGHT;

    for (const button of meteoButtons.children) button.classList.toggle('actif', button.dataset.meteo === name);
    document.getElementById('météo-actuelle').textContent = w.label;
    // Quantité de nuages réglable seulement en météo Jour
    cloudCover.hidden = name !== 'jour';
    if (name === 'jour') atc.setCloudCover(w.clouds.coverage);
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

// Météo Jour : curseur de quantité de nuages (0 = ciel clair ; 50 % = couverture 1, les autres météos nuageuses ;
// 100 % = 4 fois plus de nuages), retenu d'une visite à l'autre. Progressif : réglage fin dans les ciels peu nuageux
const cloudCover = document.getElementById('couverture');
const cloudCoverInput = document.getElementById('couverture-curseur');
const MAX_COVERAGE = 4;
function setDayCoverage(percent) {
    WEATHERS.jour.clouds.coverage = MAX_COVERAGE * (percent / 100) ** 2;
    cloudCoverInput.value = percent;
    document.getElementById('couverture-valeur').textContent = `${percent} %`;
    if (weather === WEATHERS.jour) {
        clouds.setWeather(weather.clouds);
        atc.setCloudCover(weather.clouds.coverage);
    }
}
let dayPercent = 35;   // ~ couverture 0,5 : quelques beaux cumulus
try {
    const saved = localStorage.getItem('nuages-jour');
    if (saved !== null) dayPercent = Math.min(100, Math.max(0, Number(saved) || 0));
} catch { /* stockage indisponible : valeur par défaut */ }
setDayCoverage(dayPercent);
cloudCoverInput.addEventListener('input', () => {
    setDayCoverage(Number(cloudCoverInput.value));
    try { localStorage.setItem('nuages-jour', cloudCoverInput.value); } catch { /* sans effet */ }
});
cloudCoverInput.addEventListener('change', () => cloudCoverInput.blur()); // garde le clavier pour le pilotage

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
const pilotEyeWorld = new THREE.Vector3();

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
    if (multiplayer.code && initiation?.active) initiation.stop();
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
    atc.reset(currentSpawn);
    avionics.reset(Boolean(currentSpawn.cold));
    gloveboxOpen = false;
    avionics.com1.active = parseFrequency(airport.aerodrome.frequencies[atc.freq]);
    radioSync.freq = atc.freq;
    radioSync.code = avionics.xpdr.code = atc.transponder;
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
    updateModes();
    updateOnlineList();
}

// Modes de jeu : Solo (aucune partie) ou Multijoueur (partie en cours ou en connexion). Solo quitte la partie
const soloCase = document.getElementById('solo');
const soloResume = document.getElementById('solo-resume');
function updateModes() {
    const multi = Boolean(multiplayer.code);
    const lesson = Boolean(initiation?.active);
    soloCase.classList.toggle('actif', !multi && !lesson);
    document.getElementById('multi').classList.toggle('actif', multi);
    document.getElementById('initiation').classList.toggle('actif', lesson);
    document.getElementById('initiation-resume').textContent = lesson ? `Niveau ${initiation.level} en cours` : 'Avec un moniteur';
    soloResume.textContent = multi ? 'Quitter la partie' : lesson ? 'Quitter l\'initiation' : 'Mode actuel';
}
function playSolo() {
    if (multiplayer.code && !confirm(`Quitter la partie ${multiplayer.code} et voler en solo ?`)) return;
    if (initiation?.active && !confirm('Quitter l\'initiation et voler en solo ?')) return;
    initiation?.stop();
    multiplayer.leave();
    multiDialog.close();
    updateModes();
    view.focus();   // clavier rendu au pilotage
}
soloCase.addEventListener('click', playSolo);
soloCase.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') playSolo();
});
updateModes();

// Couleur de l'avion (livrée) : appliquée à notre avion et envoyée aux autres joueurs. Choisie dans le menu Profil
// (solo et multijoueur) ou dans le panneau Multijoueur : les deux listes restent d'accord
const liverySelects = ['profil-livree', 'multi-livree'].map((id) => document.getElementById(id)).filter(Boolean);
for (const select of liverySelects) {
    for (const [id, livery] of Object.entries(LIVERIES)) select.add(new Option(livery.label, id));
}
function setLivery(id, save = true) {
    multiplayer.livery = isLivery(id) ? id : DEFAULT_LIVERY;
    for (const select of liverySelects) select.value = multiplayer.livery;
    if (aircraftModel) paintAircraft(aircraftModel, multiplayer.livery);
    if (save) try { localStorage.setItem('livree', multiplayer.livery); } catch { /* stockage indisponible */ }
}
let savedLivery = null;
try { savedLivery = localStorage.getItem('livree'); } catch { /* stockage indisponible */ }
setLivery(isLivery(savedLivery) ? savedLivery : multiplayer.livery, false);
for (const select of liverySelects) {
    select.addEventListener('change', () => {
        setLivery(select.value);
        select.blur();   // garde le clavier pour le pilotage
    });
}

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

// --- Contrôle aérien : fenêtre (bouton "Tour" du bandeau), fréquences Sol / Tour / Approche, messages au choix
// selon la phase du vol, personnes à bord, transpondeur ------------------------------------------------------
const atcPanel = document.getElementById('atc');
const atcButton = document.getElementById('atc-bouton');
const atcJournal = document.getElementById('atc-journal');
const atcChoices = document.getElementById('atc-choix');
const atcSubtitle = document.getElementById('atc-sous-titre');
const atcVoiceButton = document.getElementById('atc-voix');
const atcAtisButton = document.getElementById('atc-atis');
const atcCom = document.getElementById('atc-com');
const atcPersons = document.getElementById('atc-bord');
const atcTransponder = document.getElementById('atc-xpdr');
const atcSquawk = document.getElementById('atc-code-demande');
const ATC_SHORT = { ground: 'SOL', tower: 'TOUR', approach: 'APP', info: 'INFO' };
document.getElementById('atc-indicatif').textContent = atc.registration;
atcButton.textContent = `Tour · ${airport.aerodrome.frequencies.tower}`;
window.speechSynthesis?.getVoices();   // charge la liste des voix à l'avance

function toggleAtc(open = atcPanel.hidden) {
    atcPanel.hidden = !open;
    atcButton.setAttribute('aria-pressed', String(open));
    if (open) {
        radioVoices.preload();
        renderAtc();
    }
    view.focus();
}
atcButton.addEventListener('click', () => toggleAtc());
document.getElementById('atc-fermer').addEventListener('click', () => toggleAtc(false));

function setAtcLanguage(lang) {
    atc.setLanguage(lang);
    for (const button of document.querySelectorAll('[data-langue]')) button.classList.toggle('actif', button.dataset.langue === atc.lang);
    try { localStorage.setItem('atc-langue', atc.lang); } catch { /* stockage indisponible */ }
}
for (const button of document.querySelectorAll('[data-langue]')) {
    button.addEventListener('click', () => { setAtcLanguage(button.dataset.langue); view.focus(); });
}
function setAtcVoice(on) {
    atc.setVoice(on);
    atcVoiceButton.setAttribute('aria-pressed', String(on));
    atcVoiceButton.textContent = on ? 'Voix ✓' : 'Voix ✗';
    try { localStorage.setItem('atc-voix', on ? '1' : '0'); } catch { /* stockage indisponible */ }
}
atcVoiceButton.addEventListener('click', () => { setAtcVoice(!atc.voice); view.focus(); });
atcAtisButton.addEventListener('click', () => { sounds.unlock(); atc.playAtis(); view.focus(); });
const atcLeaveButton = document.getElementById('atc-quitter');
atcLeaveButton.addEventListener('click', () => { sounds.unlock(); atc.leaveFrequency(); view.focus(); });

// Type de voix : réalistes (neuronales) ou de l'ordinateur ; état du téléchargement
const atcVoiceType = document.getElementById('atc-voix-type');
const atcVoiceStatus = document.getElementById('atc-voix-etat');
atcVoiceType.addEventListener('change', () => {
    radioVoices.setMode(atcVoiceType.value);
    try { localStorage.setItem('atc-voix-type', radioVoices.mode); } catch { /* stockage indisponible */ }
    view.focus();
});
function renderVoiceStatus() {
    const { state, progress } = radioVoices.status;
    atcVoiceStatus.textContent = radioVoices.mode === 'system' ? ''
        : state === 'loading' ? `Téléchargement des voix réalistes : ${Math.round(progress * 100)} % (une seule fois)`
        : state === 'error' ? "Voix réalistes indisponibles : voix de l'ordinateur"
        : '';
    atcVoiceStatus.hidden = !atcVoiceStatus.textContent;
    // Aussi dans l'écran de choix du départ (les voix se téléchargent pendant ce temps)
    const departVoice = document.getElementById('depart-voix');
    departVoice.textContent = radioVoices.mode === 'neural' && state === 'loading'
        ? `Voix radio réalistes : téléchargement ${Math.round(progress * 100)} % (une seule fois, continue en vol)`
        : radioVoices.mode === 'neural' && state === 'ready' ? 'Voix radio réalistes prêtes ✓' : '';
    departVoice.hidden = !departVoice.textContent;
}
radioVoices.addEventListener('status', renderVoiceStatus);

// Radio COM : une case par fréquence ; on écoute et on parle sur celle qui est affichée
atcCom.replaceChildren(...atc.stations.map(({ id, name, frequency }) => {
    const button = document.createElement('button');
    button.dataset.station = id;
    button.title = `Afficher ${name} sur la radio`;
    const label = document.createElement('strong');
    label.textContent = name.split(' ').slice(1).join(' ');
    const value = document.createElement('span');
    value.textContent = frequency;
    button.append(label, value);
    button.addEventListener('click', () => { atc.setFrequency(id); view.focus(); });
    return button;
}));

// Personnes à bord (annoncées au premier contact)
atcPersons.addEventListener('change', () => {
    atc.setPersons(Number(atcPersons.value));
    try { localStorage.setItem('atc-bord', String(atc.persons)); } catch { /* stockage indisponible */ }
    view.focus();
});

// Transpondeur : 4 chiffres de 0 à 7, validés par Entrée ou en quittant la case
function applyTransponder() {
    const ok = atc.setTransponder(atcTransponder.value.trim());
    atcTransponder.classList.toggle('erreur', !ok);
    if (!ok) atcTransponder.value = atc.transponder;
}
atcTransponder.addEventListener('change', applyTransponder);
atcTransponder.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        applyTransponder();
        view.focus();
    }
});

{
    let lang = 'fr', voice = true, persons = 2;
    try {
        lang = localStorage.getItem('atc-langue') ?? 'fr';
        voice = localStorage.getItem('atc-voix') !== '0';
        persons = Number(localStorage.getItem('atc-bord') ?? 2);
        radioVoices.mode = localStorage.getItem('atc-voix-type') === 'system' ? 'system' : 'neural';
    } catch { /* stockage indisponible */ }
    atcVoiceType.value = radioVoices.mode;
    // Voix réalistes téléchargées et préparées dès l'ouverture de la page (fil séparé : rien ne se fige), pour être
    // prêtes au premier message radio
    radioVoices.preload();
    setAtcLanguage(lang);
    setAtcVoice(voice);
    atc.setPersons(persons);
    atcPersons.value = String(atc.persons);
}

function renderAtc() {
    const { icao, name, frequencies } = airport.aerodrome;
    const station = atc.stations.find((st) => st.id === atc.freq);
    atcButton.textContent = `${station.name.split(' ').slice(1).join(' ')} · ${frequencies[atc.freq]}`;
    if (atcPanel.hidden) return;
    document.getElementById('atc-titre').textContent = `${icao} · ${station.name}`;
    document.getElementById('atc-frequence').textContent = frequencies[atc.freq];
    for (const button of atcCom.children) button.classList.toggle('actif', button.dataset.station === atc.freq);
    if (document.activeElement !== atcTransponder) atcTransponder.value = atc.transponder;
    atcSquawk.textContent = atc.squawk && atc.squawk !== atc.transponder ? `demandé : ${atc.squawk}` : '';
    document.getElementById('atc-etat').textContent = atc.status;
    atcAtisButton.textContent = `Écouter l'ATIS · ${atc.atisLetter}`;
    atcAtisButton.disabled = atc.busy;
    atcLeaveButton.disabled = !atc.canLeaveFrequency;
    atcJournal.replaceChildren(...atc.log.slice(-8).map(({ from, text, station: who }) => {
        const item = document.createElement('li');
        item.className = `atc-${from}`;
        const label = document.createElement('b');
        label.textContent = from === 'pilot' ? 'VOUS' : from === 'atis' ? 'ATIS' : from === 'info' ? 'COM' : who;
        item.append(label, ' ', text);
        return item;
    }));
    atcJournal.scrollTop = atcJournal.scrollHeight;
    const note = (text) => {
        const p = document.createElement('p');
        p.className = 'atc-attente';
        p.textContent = text;
        return p;
    };
    if (atc.blockedBy && !atc.busy) atcChoices.replaceChildren(note(`Fréquence occupée : ${atc.blockedBy} est en communication. Attendez la fin de l'échange.`));
    else if (atc.busy) atcChoices.replaceChildren(note(atc.blockedBy ? `Fréquence occupée : ${atc.blockedBy} est en communication…` : 'Émission en cours…'));
    else {
        const children = atc.options.map((option) => {
            const button = document.createElement('button');
            button.dataset.option = option.id;
            if (option.id === 'readback') button.className = 'atc-collationner';
            if (option.id === 'sayAgain') button.className = 'atc-repetez';
            const label = document.createElement('strong');
            label.textContent = option.label;
            const phrase = document.createElement('span');
            phrase.textContent = option.message.text;
            button.append(label, phrase);
            button.addEventListener('click', () => {
                sounds.unlock();
                atc.choose(option.id);
                view.focus();
            });
            return button;
        });
        // Rien à dire sur cette fréquence : celle qui gère l'avion à cet endroit
        if (atc.suggestion) {
            const target = atc.stations.find((st) => st.id === atc.suggestion);
            const button = document.createElement('button');
            button.className = 'atc-frequence-conseil';
            const label = document.createElement('strong');
            label.textContent = 'Changer de fréquence';
            const phrase = document.createElement('span');
            phrase.textContent = `Ici, c'est ${target.name} qui vous gère : afficher ${target.frequency}`;
            button.append(label, phrase);
            button.addEventListener('click', () => { atc.setFrequency(target.id); view.focus(); });
            children.unshift(button);
        }
        if (!children.length) children.push(note(choosingSpawn ? 'Choisissez un point de départ.'
            : 'Rien à transmettre pour le moment : les messages proposés suivent la phase du vol.'));
        atcChoices.replaceChildren(...children);
    }
    initiation?.refreshHtml();
}
atc.addEventListener('change', renderAtc);

// Multijoueur : radio partagée (on entend l'échange des autres sur la même fréquence) ; une immatriculation par
// joueur (F-H + 3 lettres tirées de son identifiant), F-HESM en solo
atc.addEventListener('broadcast', ({ message }) => multiplayer.sendAtc(message));
multiplayer.addEventListener('atc', ({ detail }) => {
    atc.receiveRemote({ ...detail, name: multiplayer.players.get(detail.id)?.name ?? 'Pilote' });
});
function registrationFor(id) {
    let h = 7;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return `F-H${letters[h % 26]}${letters[(h >>> 5) % 26]}${letters[(h >>> 10) % 26]}`;
}
function updateRegistration() {
    // Voix de pilote attitrée : celle que les autres joueurs entendent (calculée d'après l'identifiant), la même toute la partie
    radioVoices.setPlayerId(multiplayer.code ? multiplayer.id : '');
    atc.setRegistration(multiplayer.code ? registrationFor(multiplayer.id) : 'F-HESM');
    if (aircraftModel) setRegistration(aircraftModel, atc.registration);   // peinte sur le fuselage
    document.getElementById('atc-indicatif').textContent = atc.registration;
}
multiplayer.addEventListener('status', updateRegistration);
updateRegistration();

// Sous-titre de l'émission en cours ; la fenêtre s'ouvre d'elle-même quand un contrôleur attend un collationnement
let atcSubtitleTimer = 0;
atc.addEventListener('transmit', ({ from, text, station, label, on }) => {
    clearTimeout(atcSubtitleTimer);
    if (on) {
        const who = from === 'pilot' ? 'VOUS' : from === 'atis' ? 'ATIS' : from === 'remote' ? label : ATC_SHORT[station];
        atcSubtitle.textContent = `${who} : ${text}`;
        atcSubtitle.className = `atc-${from}`;
        atcSubtitle.hidden = false;
    } else {
        atcSubtitleTimer = setTimeout(() => { atcSubtitle.hidden = true; }, 1500);
        if (from === 'atc' && atcPanel.hidden && atc.pending) toggleAtc(true);
    }
});

const _atcForward = new THREE.Vector3();
// Radio de bord <-> contrôle aérien : la COM choisie au micro (boîte audio) règle la station écoutée ; un changement
// fait dans la fenêtre Tour (ou par le contrôleur) s'affiche sur cette COM. Transpondeur : même code des deux côtés
const stationOn = (khz) => Object.keys(airport.aerodrome.frequencies).find((id) => parseFrequency(airport.aerodrome.frequencies[id]) === khz) ?? null;
function syncRadios() {
    const micCom = avionics.audio.mic, com = avionics[micCom];
    if (atc.freq !== radioSync.freq) avionics.showOnCom(micCom, parseFrequency(airport.aerodrome.frequencies[atc.freq]));
    if (atc.transponder !== radioSync.code) avionics.xpdr.code = atc.transponder;
    else if (avionics.xpdr.code !== atc.transponder) atc.setTransponder(avionics.xpdr.code);
    const station = stationOn(com.active);
    if (station && station !== atc.freq) atc.setFrequency(station);
    atc.setRadio(Boolean(avionics.powered(systems)[micCom === 'com1' ? 'navcom1' : 'navcom2']), Boolean(station), (com.active / 1000).toFixed(3));
    radioSync.freq = atc.freq;
    radioSync.code = atc.transponder;
}

function updateAtc(delta) {
    syncRadios();
    _atcForward.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
    const ground = terrain.heightAt(aircraft.position.x, aircraft.position.z);
    atc.update(delta, {
        position: aircraft.position,
        heading: (Math.atan2(_atcForward.x, -_atcForward.z) * 180 / Math.PI + 360) % 360,
        onGround: controls.isOnGround(),
        agl: Math.max(0, aircraft.position.y - WHEEL_HEIGHT - ground) / 0.3048,
        speed: controls.getSpeed(),
        engine: systems.running,
        active: !choosingSpawn && !controls.isCrashed(),
        traffic: multiplayer.code ? remotePlayers.list().map((p) => ({ ...p, callsign: registrationFor(p.id) })) : [],
    });
}

// --- Mode Initiation : un moniteur guide l'élève (voir Initiation.js) -----------------------------------------------
const $ = (id) => document.getElementById(id);
var initiation = new Initiation({
    systems, controls, avionics, atc, cockpit, airport, scene, aircraft, voices: radioVoices,
    groundHeight: (x, z) => terrain.heightAt(x, z),
    ui: {
        panel: $('moniteur'), phase: $('moniteur-phase'), count: $('moniteur-compte'), progress: $('moniteur-progression'),
        title: $('moniteur-titre'), text: $('moniteur-texte'), why: $('moniteur-pourquoi'), hint: $('moniteur-souffle'),
        advice: $('moniteur-conseil'), praise: $('moniteur-bravo'), next: $('moniteur-continuer'),
        buttons: { next: $('moniteur-continuer'), repeat: $('moniteur-repeter'), show: $('moniteur-montrer'), skip: $('moniteur-passer'), quit: $('moniteur-quitter') },
    },
    // Leçon en anglais : contrôleurs en anglais aussi (phraséologie OACI) ; langue d'avant rétablie à la fin
    setRadioLanguage: (lang) => setAtcLanguage(lang),
    // Départ : avion éteint au parking N4, en solo, vue cabine
    startCold: () => {
        multiplayer.leave();
        const spawn = airport.spawns.find((sp) => sp.id === 'stand4') ?? airport.spawns.find((sp) => sp.cold);
        if (choosingSpawn) closeSpawnDialog();
        spawnAt(spawn);
        setCabinViewPreset(1);
    },
    focusCabin,
    pilotView: () => setCabinViewPreset(1),
    openAtc: (open) => { if (atcPanel.hidden === open) toggleAtc(open); },
    onChange: () => updateModes(),
});
const initiationDialog = $('initiation-dialog');
function openInitiation() {
    initiationDialog.showModal();
}
$('initiation').addEventListener('click', openInitiation);
$('initiation').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openInitiation();
});
for (const button of initiationDialog.querySelectorAll('[data-niveau]')) {
    button.addEventListener('click', () => {
        if (multiplayer.code && !confirm(`Quitter la partie ${multiplayer.code} pour l'initiation ?`)) return;
        initiationDialog.close();
        sounds.unlock();
        radioVoices.preload();
        const lang = initiationDialog.querySelector('[data-langue-lecon].actif')?.dataset.langueLecon ?? 'fr';
        try { localStorage.setItem('initiation-langue', lang); } catch { /* stockage indisponible */ }
        initiation.start(Number(button.dataset.niveau), $('initiation-camera').checked, lang);
        view.focus();
    });
}
$('initiation-annuler').addEventListener('click', () => initiationDialog.close());
// Langue de la leçon : boutons Français / English (retenue d'une visite à l'autre)
const lessonLanguages = [...initiationDialog.querySelectorAll('[data-langue-lecon]')];
function setLessonLanguage(lang) {
    for (const button of lessonLanguages) button.classList.toggle('actif', button.dataset.langueLecon === lang);
}
for (const button of lessonLanguages) button.addEventListener('click', () => setLessonLanguage(button.dataset.langueLecon));
{
    let lang = 'fr';
    try { lang = localStorage.getItem('initiation-langue') ?? 'fr'; } catch { /* stockage indisponible */ }
    setLessonLanguage(lang === 'en' ? 'en' : 'fr');
}
const keepFocus = (handler) => () => { handler(); view.focus(); };
$('moniteur-continuer').addEventListener('click', keepFocus(() => initiation.continue()));
$('moniteur-repeter').addEventListener('click', keepFocus(() => initiation.repeat()));
$('moniteur-montrer').addEventListener('click', keepFocus(() => initiation.show()));
$('moniteur-passer').addEventListener('click', keepFocus(() => initiation.skip()));
$('moniteur-quitter').addEventListener('click', keepFocus(() => {
    const message = initiation.lang === 'en' ? 'Quit the lesson? The aeroplane stays where it is, in solo mode.' : 'Quitter l\'initiation ? L\'avion reste où il est, en solo.';
    if (confirm(message)) initiation.stop();
}));
updateModes();

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
        speed: controls.getIndicatedSpeed(),
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
        systems,
        avionics,
        ...navInstruments(),
        oat: atc.metar.temp - 2 * Math.max(0, controls.getAltitude() - WHEEL_HEIGHT) / 0.3048 / 1000,
        transmitting: radioTransmit.pilot,
        receiving: radioTransmit.other,
        gloveboxOpen,
        parkingBrake: controls.parkingBrake,
        flapLevel: controls.getFlapLevel(),
    };
}

// Émission en cours (voyants T / R des NAV/COM)
const radioTransmit = { pilot: false, other: false };
atc.addEventListener('transmit', ({ from, on }) => {
    if (from === 'pilot') radioTransmit.pilot = on;
    else radioTransmit.other = on;
});

// Radionavigation : NAV 1 / NAV 2 (VOR ou ILS selon la fréquence affichée), DME (sur la NAV 1), ADF (balise NDB
// fixe au milieu des pistes, rose réglée au bouton HDG)
const VOR_FREQ = parseFrequency(airport.vor.frequency), ILS_FREQ = 110300;
const NDB = airport.runways[0].threshold.clone().add(airport.runways[1].threshold).multiplyScalar(0.5);
const dmeTrack = { distance: null, kt: 0 };
function navReceiver(khz, powered, receiver, glide) {
    if (!powered) return { available: false };
    if (khz === VOR_FREQ) {
        const s = receiver.state;
        return { available: s.available && !s.overhead, deviation: s.deviation, to: s.to, glide: false, distance: s.distance };
    }
    if (khz === ILS_FREQ && ils.state.available) {
        const s = ils.state;
        return { available: true, deviation: s.localizer, to: null, glide: glide && s.distance > 0, glideslope: s.glideslope, distance: s.distance };
    }
    return { available: false };
}
function navInstruments() {
    const powered = avionics.powered(systems);
    const nav1 = navReceiver(avionics.nav1.active, powered.navcom1, vor, true);
    const nav2 = navReceiver(avionics.nav2.active, powered.navcom2, vor2, false);
    let dme = null;
    if (powered.dme && nav1.available && dmeTrack.distance !== null) {
        const nm = nav1.distance / 1852;
        dme = { nm, kt: dmeTrack.kt, min: dmeTrack.kt > 30 ? nm / dmeTrack.kt * 60 : 999 };
    }
    let adf = 90;   // aiguille au repos (pas de signal)
    if (powered.adf) {
        const bearing = Math.atan2(NDB.x - aircraft.position.x, -(NDB.z - aircraft.position.z)) * 180 / Math.PI;
        adf = ((bearing - controls.getHeading()) % 360 + 360) % 360;
    }
    return {
        nav1, nav2, dme, adf, obs1: vor.course,
        navcom1Powered: powered.navcom1, navcom2Powered: powered.navcom2, dmePowered: powered.dme, xpdrPowered: powered.xpdr,
    };
}
// Vitesse sol du DME : variation de la distance à la balise (lissée)
function updateDme(delta) {
    const nav1 = navReceiver(avionics.nav1.active, true, vor, false);
    if (!nav1.available || delta <= 0) {
        dmeTrack.distance = null;
        return;
    }
    if (dmeTrack.distance !== null) {
        const kt = Math.abs(nav1.distance - dmeTrack.distance) / delta * 3600 / 1852;
        dmeTrack.kt += (kt - dmeTrack.kt) * (1 - Math.exp(-delta / 2));
    }
    dmeTrack.distance = nav1.distance;
}

// ILS : disponible près de la piste, dans l'axe d'approche. Bouton sur le tableau de bord en cabine,
// bouton à l'écran en vue extérieure, touche I dans les deux cas.
const ils = new ILS(airport.runways, airport.runwayLength);

// VOR (NAV1) : balise de l'aérodrome. Indicateur au tableau de bord ; en vue extérieure, touche O.
// OBS : J / K (Maj : 10° par appui), H : centrer l'aiguille sur la route directe vers la balise
const vor = new VOR(airport.vor);
const vor2 = new VOR(airport.vor);       // NAV 2 (même balise, son propre OBS)
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
    vor2.setCourse(avionics.obs2);
    vor2.update(aircraft.position);
    avionics.update(delta, { airborne: !controls.isOnGround(), vacuum: systems.vacuum });
    updateDme(delta);
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

// ILS : affiché sur la NAV 1 (fréquence 110.30) ; touche I et bouton en vue extérieure : y passer ou en revenir
function toggleIls() {
    avionics.toggleNav1(ILS_FREQ);
    updateIls();
}

function updateIls() {
    const state = ils.update(aircraft.position);
    ils.active = state.available && avionics.nav1.active === ILS_FREQ && avionics.powered(systems).navcom1;
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
    if (id === 'obs') vor.turnCourse(step * (fine ? 10 : 1));
    else if (id === 'yokes') {
        if (wheel) return false;
        cockpit.setYokesVisible(!cockpit.yokesVisible);
        try { localStorage.setItem('manches', cockpit.yokesVisible ? '1' : '0'); } catch { /* stockage indisponible */ }
    }
    else if (id === 'glovebox') {
        if (wheel) return false;
        gloveboxOpen = !gloveboxOpen;
    } else if (/^(com[12]|nav[12]|power|xpdr|dme|audio|davtron|baro|hdgBug|dg|ai|obs2|adf)(:|$)/.test(id)) {
        if (wheel && /swap|ident|power|audio|davtron|dme/.test(id)) return false;
        avionics.use(id, step, fine);
    }
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
    if (flapsMoving && !moving) sounds.play('flapsStop', { volume: chaseView ? 0.6 : 1.4 });
    flapsMoving = moving;
    lastFlaps = flaps;
    // (fichier enregistré bas, -25 dBFS : gain > 1 pour passer au-dessus du moteur)
    sounds.setLoop('flapMotor', moving ? (chaseView ? 0.8 : 2.2) : 0, 1);
    // Pompe à carburant électrique : bourdonnement tant qu'elle tourne (sous le plancher, à peine audible dehors)
    sounds.setLoop('fuelPump', systems.fuelPumpRunning && !choosingSpawn ? (chaseView ? 0.008 : 0.045) : 0, 1.7);
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
    decorStyle = values.decorStyle ?? 'realiste';
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
// Mixture au clavier : U enrichit (pousse), Y appauvrit (tire), tant que la touche est tenue (course entière en ~2,5 s)
const MIXTURE_RATE = 0.4;
const mixtureKeys = { KeyU: 0, KeyY: 0 };
window.addEventListener('keydown', (event) => {
    if (event.code in mixtureKeys && !isTypingTarget(event.target)) mixtureKeys[event.code] = 1;
});
window.addEventListener('keyup', (event) => {
    if (event.code in mixtureKeys) mixtureKeys[event.code] = 0;
});
window.addEventListener('blur', () => { mixtureKeys.KeyU = mixtureKeys.KeyY = 0; panelLightsKey = 0; });
// Éclairage des instruments au clavier : L éclaircit, Maj + L assombrit, tant que la touche est tenue (course entière en ~2 s)
const PANEL_LIGHTS_RATE = 0.5;
let panelLightsKey = 0, panelLightsTravel = 0;
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyL' && !isTypingTarget(event.target)) panelLightsKey = event.shiftKey ? -1 : 1;
});
window.addEventListener('keyup', (event) => {
    if (event.code === 'KeyL') panelLightsKey = 0;
});

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

    wind.update();
    controls.model.wind.copy(wind.vector);
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
    initiation.update( delta );
    updateSpawnMarkers();
    updateAtc( delta );
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
    const mixtureInput = mixtureKeys.KeyU - mixtureKeys.KeyY;
    if (mixtureInput && !choosingSpawn) systems.setMixture(systems.mixture + mixtureInput * MIXTURE_RATE * Math.min(delta, 0.1));
    if (panelLightsKey && !choosingSpawn) {
        const before = systems.panelLights;
        systems.setPanelLights(before + panelLightsKey * PANEL_LIGHTS_RATE * Math.min(delta, 0.1));
        // Un cran du rhéostat entendu tous les 10 %
        panelLightsTravel += Math.abs(systems.panelLights - before);
        if (panelLightsTravel >= 0.1) {
            panelLightsTravel = 0;
            sounds.click(chaseView ? 0.15 : 0.3);
        }
    }
    if (!controls.isCrashed() && !choosingSpawn) systems.update(delta, controls.getThrottle(), controls.getSpeed());
    controls.model.enginePower = systems.power;
    controls.model.flapsPowered = systems.flapsPowered;
    const engineVolume = controls.isCrashed() || choosingSpawn ? 0 : (chaseView ? 1 : 0.7);
    engineSound.update(systems.rpm, engineVolume, { running: systems.running, cranking: systems.cranking });
    updateSounds();
    if (!choosingSpawn) multiplayer.update( aircraft, controls.getThrottle() * systems.power, { crashed: controls.isCrashed(), crashes: crashCount, lights: systems.lights } );
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
    // PAPI : couleur vue de l'œil du pilote, même en vue extérieure
    pilotEyeWorld.copy(cockpit.eye).multiplyScalar(AIRCRAFT_SCALE).add(COCKPIT_POSITION).applyMatrix4(aircraft.matrixWorld);
    airport.update( delta, Math.min(1, wind.speed / 20), camera, wind.direction, pilotEyeWorld );
    airport.updateHangars( delta, aircraft.position );
    scenery.update( camera.position, clock.elapsedTime );
    crashEffect.update( delta );
    aircraftLights.update( camera, clock.elapsedTime );
    updateIls();
    updateVor( delta );
    controlSurfaces?.update( delta, controls.getInputs(), controls.getFlaps(), controls.getTrim() );
    if (gear) {
        const inputs = controls.getInputs();
        gear.update( delta, inputs.yaw + inputs.roll * 0.5, controls.getSpeed(), controls.isOnGround() );   // même braquage que FlightModel
    }
    // Instruments et manches animés en cabine, et en vue extérieure quand on est assez près pour les voir
    if (!chaseView || camera.position.distanceTo(aircraft.position) < 30) cockpit.update( delta, cockpitState() );
    updateFog();
    updateStallWarning();

    // Ombres : zone centrée sur l'avion (elle s'étend dans l'axe du soleil : l'ombre de l'avion au sol y reste, même en
    // vol) ; en cabine, zone resserrée (ombres fines dans l'habitacle)
    shadowCenter.copy(aircraft.position);
    graphics.update( shadowCenter, !chaseView );
    graphics.setAlarm( controls.isStalled() ? 0.5 + 0.3 * Math.sin(clock.elapsedTime * 10) : 0 );
    graphics.render();
    updatePerf(performance.now() - frameStart);
});
