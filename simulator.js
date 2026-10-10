import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Utils3dLoader } from './js/Utils3d.js';
import { PlaneControls } from './js/PlaneControls.js';
import { loadCSV } from './js/DataLoader.js';
import { Terrain } from './js/Terrain.js';
import { Clouds } from './js/Clouds.js';
import { StallWarning } from './js/StallWarning.js';
import { EngineSound } from './js/EngineSound.js';
import { SoundEffects } from './js/SoundEffects.js';
import { Graphics } from './js/Graphics.js';
import { Multiplayer } from './js/Multiplayer.js';
import { RemotePlayers } from './js/RemotePlayers.js';
import { Airport } from './js/Airport.js';
import { NightSky } from './js/NightSky.js';
import { Storm } from './js/Storm.js';
import { Cockpit } from './js/Cockpit.js';
import { CrashEffect } from './js/CrashEffect.js';
import { ControlSurfaces } from './js/ControlSurfaces.js';
import { Settings } from './js/Settings.js';
import { AircraftLights } from './js/AircraftLights.js';
import { ILS } from './js/ILS.js';

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
const WHEEL_HEIGHT = 1.25;                                  // centre de l'avion au-dessus du sol, roues posées
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
    nuit:       { label: 'Nuit',       sky: 0x0b1a2e, fogNear: 300, fogFar: 1600, hemi: 0.18, sun: 0.35, turbulence: 0,
                  night: 1, stars: 1, wind: 0.2, sunColor: 0x9fb4e8, moon: { elevation: 35, azimuth: 220 },
                  clouds: { coverage: 0.15, light: 0x2c3650, dark: 0x0e1422, opacity: 0.6, brightness: 1 } },
    brouillard: { label: 'Brouillard', sky: 0xbfc9ca, fogNear: 10,  fogFar: 220,  hemi: 1.0, sun: 0.6, turbulence: 0.2,
                  night: 0.2, wind: 0.1,
                  clouds: { coverage: 0.8, light: 0xe5e8e8, dark: 0xaab7b8 } },
    tempete:    { label: 'Tempête',    sky: 0x3b4444, fogNear: 40,  fogFar: 450,  hemi: 0.4, sun: 0.2, turbulence: 1,
                  night: 0.5, wind: 1, rain: 1, lightning: true,
                  clouds: { coverage: 1, light: 0x7f8c8d, dark: 0x2c3e50, opacity: 1, brightness: 1.2 } },
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
const remotePlayers = new RemotePlayers(scene, multiplayer);

const loader = new Utils3dLoader();

// Les commandes pilotent l'avion ; la caméra le suit (cabine ou vue extérieure)
const aircraft = new THREE.Group();
const controls = new PlaneControls( aircraft );
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
scene.add( clouds.mesh );
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
const aircraftLights = new AircraftLights(aircraft);
const landingLight = new THREE.SpotLight(0xfff3d6, 0, 400, THREE.MathUtils.degToRad(14), 0.6, 1.6);
// Phare dans le bord d'attaque de l'aile gauche, comme sur un vrai Cessna 172
// (dans le nez, il éclairait les pales de l'hélice qui passaient devant : flashs blancs)
landingLight.position.set(-2.2, 1.12, -3);
// Visé ~2° sous l'horizon (sol éclairé surtout vers 50-120 m) : visible depuis la cabine au-dessus du tableau de bord
landingLight.target.position.set(-1.2, -2.4, -80);
aircraft.add(landingLight, landingLight.target);

new GLTFLoader().load(AIRCRAFT_MODEL, (gltf) => {
    const model = aircraftModel = gltf.scene;
    model.position.z = -2; // centre l'avion sur l'aile (le modèle a son origine vers le nez)
    propeller = model.getObjectByName('Propeller_Cone');
    // Recentre l'hélice sur son axe pour qu'elle tourne sans voilage
    const center = new THREE.Box3().setFromObject(propeller).getCenter(new THREE.Vector3());
    propeller.traverse((child) => child.geometry?.translate(-center.x, -center.y, 0));
    propeller.position.set(center.x, center.y, 0);
    // Ailerons, profondeur, direction et volets deviennent des pièces mobiles (aussi sur les copies du modèle)
    controlSurfaces = new ControlSurfaces(model, propeller);
    // Copie aux vitres opaques pour les avions garés et ceux des autres joueurs (ils n'ont pas d'intérieur)
    const template = model.clone();
    makeWindowsTransparent(model, propeller);
    model.traverse((child) => { child.castShadow = child.material !== cabinGlass; }); // le soleil entre par les vitres
    setupPropellerBlur(propeller); // après : le disque flou ne fait pas d'ombre
    aircraft.add(model);
    aircraftLights.setOccluder(model);
    remotePlayers.setTemplate(template);
    airport.addParkedPlanes(template);
    rebuildObstacles(); // + les avions garés
    updateView();
}, undefined, (error) => console.error(error));

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
    const size = box.getSize(new THREE.Vector3());
    propellerDisc = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(size.x, size.y) / 2, 48),
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    propellerDisc.position.z = propeller.worldToLocal(box.getCenter(new THREE.Vector3())).z;
    propeller.add(propellerDisc);
    propellerParts.add(propellerDisc);
}

function updatePropeller(delta) {
    if (!propeller) return;
    const spin = controls.isCrashed() ? 0 : 20 + 80 * controls.getThrottle(); // rad/s
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
    viewButton.textContent = chaseView ? '🎥 Vue cabine' : '🎥 Vue extérieure';
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

function recenterCamera() {
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
    if (chaseView) {
        orbit.yaw -= dx * ORBIT_SPEED;
        orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * ORBIT_SPEED, -0.35, 1.45);
    } else {
        head.yaw = THREE.MathUtils.clamp(head.yaw - dx * ORBIT_SPEED * 0.7, -2.6, 2.6);
        head.pitch = THREE.MathUtils.clamp(head.pitch - dy * ORBIT_SPEED * 0.7, -1.0, 1.1);
    }
});
for (const type of ['pointerup', 'pointercancel']) view.addEventListener(type, () => { drag = null; });
view.addEventListener('dblclick', recenterCamera);
view.addEventListener('wheel', (event) => {
    event.preventDefault();
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
    aircraft.updateMatrixWorld();
    updateCamera(0, true);
    crashEffect.stop();
    aircraft.visible = true;
    updateView();
    crashBanner.classList.remove('actif');
    clearTimeout(crashTimer);
});

const _cameraTarget = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _headQuaternion = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
let shake = 0;

const crashCamera = { position: new THREE.Vector3(), target: new THREE.Vector3() };

function updateCamera(delta, snap = false) {
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
        // Caméra de poursuite en orbite autour de l'avion : suit avec un peu de retard, reste au-dessus du sol
        _offset.set(0, 0, orbit.distance).applyAxisAngle(_xAxis, -orbit.pitch).applyAxisAngle(_yAxis, orbit.yaw);
        _cameraTarget.copy(_offset).applyMatrix4(aircraft.matrixWorld);
        const ground = terrain.heightAt(_cameraTarget.x, _cameraTarget.z) + 2;
        _cameraTarget.y = Math.max(_cameraTarget.y, ground);
        camera.position.lerp(_cameraTarget, snap ? 1 : 1 - Math.exp(-CHASE_STIFFNESS * delta));
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
    nightSky.setVisibility(w.stars ?? 0, w.sky);
    storm.setWeather({ rain: w.rain ?? 0, lightning: w.lightning ?? false });
    cockpit.setRain(w.rain ?? 0);
    cockpit.setNight(w.night);
    airport.setNight(w.night);
    aircraftLights.setNight(w.night);
    // Phare seulement de nuit : une lumière, même éteinte, alourdit le calcul de tous les matériaux
    landingLight.visible = w.night >= 0.5;
    landingLight.intensity = 12000;

    for (const button of document.querySelectorAll('#météo button')) {
        button.classList.toggle('actif', button.dataset.meteo === name);
    }
}

const meteoPanel = document.getElementById('météo');
for (const [name, w] of Object.entries(WEATHERS)) {
    const button = document.createElement('button');
    button.textContent = w.label;
    button.dataset.meteo = name;
    button.addEventListener('click', () => {
        setWeather(name);
        button.blur(); // garde le clavier pour le pilotage (Espace ne re-clique pas)
    });
    meteoPanel.appendChild(button);
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
    fullscreenButton.textContent = document.fullscreenElement ? '⛶ Quitter le plein écran' : '⛶ Plein écran';
});

// Volets : le bouton sort un cran (rentre tout après le dernier), touches G / T
const flapsButton = document.getElementById('volets');
function updateFlapsButton() {
    flapsButton.textContent = `🪽 Volets : ${controls.getFlapSetting()}°`;
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
controls.addEventListener('crash', ({ reason }) => {
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

function updateFog() {
    const density = clouds.densityAt(camera.position);
    cloudFogColor.set(weather.clouds.light);
    scene.fog.color.set(weather.atmosphere?.fog ?? weather.sky).lerp(cloudFogColor, density).lerp(flashColor, storm.flash * 0.6);
    scene.background.set(weather.sky).lerp(flashColor, storm.flash * 0.6);
    scene.fog.near = THREE.MathUtils.lerp(weather.fogNear, 0, density);
    scene.fog.far = THREE.MathUtils.lerp(weather.fogFar, 30, density);
    hemiLight.intensity = weather.hemi + storm.flash * 2.5;
}

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

// Lien d'invitation : index.html?partie=CODE rejoint directement la partie
const invitation = new URLSearchParams(location.search).get('partie');
if (invitation) {
    multiCode.value = invitation.toUpperCase();
    multiplayer.join(invitation, pseudo());
    openMultiDialog();
}
window.addEventListener('pagehide', () => multiplayer.leave());
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
}

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
        onGround: controls.isOnGround(),
        crashed: controls.isCrashed(),
        stallWarning: controls.isNearStall(),
        ils: { ...ils.state, active: ils.active },
    };
}

// ILS : disponible près de la piste, dans l'axe d'approche. Bouton sur le tableau de bord en cabine,
// bouton à l'écran en vue extérieure, touche I dans les deux cas.
const ils = new ILS(airport.runways, airport.runwayLength);
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
    ilsText.textContent = `Piste ${state.runway} · ${(state.distance / 1000).toFixed(1)} km\n`
        + `Hauteur ${Math.round(state.height)} m (idéal ${Math.round(state.glideHeight)} m)\n${ils.advice()}`;
}

ilsButton.addEventListener('click', (event) => {
    toggleIls();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyI' && !event.repeat && !(event.target instanceof HTMLInputElement)) toggleIls();
});

// En cabine : clic (sans glisser) sur un bouton du tableau de bord
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
view.addEventListener('click', (event) => {
    if (chaseView || dragDistance > 6) return;
    const rect = view.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(cockpit.panel)[0];
    if (hit && cockpit.buttonAt(hit.uv) === 'ils') toggleIls();
});

// Bruits de l'environnement : pluie (étouffée en cabine), roulement des pneus selon le revêtement
function updateSounds() {
    const rain = storm.rain;
    sounds.setLoop('rain', rain * (chaseView ? 0.8 : 0.25));
    sounds.setLoop('rainCockpit', rain * (chaseView ? 0 : 0.9));
    const rolling = controls.isOnGround() && !controls.isCrashed() ? Math.min(1, controls.getSpeed() / 20) * 0.6 : 0;
    const grass = controls.getSurface() === 'grass';
    const rate = 0.7 + controls.getSpeed() / 40;
    sounds.setLoop('rollAsphalt', grass ? 0 : rolling, rate);
    sounds.setLoop('rollGrass', grass ? rolling : 0, rate);
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
    terrain.setDetail(values.terrain);
    decorDensity = values.decor;
    applyDecorDensity();
    perfPanel.hidden = !values.perf;
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

    controls.update( delta );
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
    updateCamera( delta );

    updatePropeller( delta );
    engineSound.update(controls.getThrottle(), controls.isCrashed() ? 0 : chaseView ? 1 : 0.7);
    updateSounds();
    multiplayer.update( aircraft, controls.getThrottle() );
    remotePlayers.update( delta );
    clouds.update( camera );
    for (const object of detailedObjects) {
        object.visible = object.boundingSphere.distanceToPoint(camera.position) < DETAIL_DISTANCE;
    }
    nightSky.update( camera );
    storm.update( delta, camera, aircraftVelocity, chaseView ? 0 : 3 );
    airport.update( delta, weather.wind, camera );
    crashEffect.update( delta );
    aircraftLights.update( camera, clock.elapsedTime );
    updateIls();
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
