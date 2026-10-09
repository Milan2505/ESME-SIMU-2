import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Utils3dLoader } from './js/Utils3d.js';
import { PlaneControls } from './js/PlaneControls.js';
import { loadCSV } from './js/DataLoader.js';
import { Terrain } from './js/Terrain.js';
import { Clouds } from './js/Clouds.js';
import { StallWarning } from './js/StallWarning.js';
import { EngineSound } from './js/EngineSound.js';
import { Graphics } from './js/Graphics.js';
import { Multiplayer } from './js/Multiplayer.js';
import { RemotePlayers } from './js/RemotePlayers.js';

const CAM_FOV = 60, CAM_NEAR = 0.1, CAM_FAR = 3000;
const COLOR_GROUND = 0x219313, COLOR_LIGHT = 0xfdfefe;
const ROLL_SPEED = 0.3;
const WORLD_SIZE = 1000;      // zone de placement aléatoire des objets
const START_ALTITUDE = 100;
const HORIZON_PCT_PER_DEG = 0.425;

// Avion du joueur : Cessna 172 low poly de Vojtěch Balák (Poly Pizza, CC-BY 3.0)
const AIRCRAFT_MODEL = 'asset/cessna.glb';
const COCKPIT_OFFSET = new THREE.Vector3(0, 0.9, -0.3);    // place du pilote (repère avion)
const CHASE_OFFSET = new THREE.Vector3(0, 3.5, 15);         // caméra extérieure : derrière et au-dessus
const CHASE_TARGET = new THREE.Vector3(0, 1.5, -8);        // point visé, devant l'avion
const CHASE_STIFFNESS = 4;                                 // rapidité avec laquelle la caméra suit

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
};
const DEFAULT_SCALE = [10, 20, 10];

// Ambiances du panneau Météo
const WEATHERS = {
    jour:       { label: 'Jour',       sky: 0x5dade2, fogNear: 400, fogFar: 2400, hemi: 1.2, sun: 2.0, turbulence: 0,
                  atmosphere: { elevation: 40, azimuth: 150, turbidity: 2, rayleigh: 3, fog: 0x8fb4d6 },
                  clouds: { coverage: 0.45, light: 0xffffff, dark: 0x8f9bb0 } },
    nuit:       { label: 'Nuit',       sky: 0x0b1a2e, fogNear: 200, fogFar: 1000, hemi: 0.15, sun: 0.1, turbulence: 0,
                  clouds: { coverage: 0.3, light: 0x3a4660, dark: 0x111827 } },
    brouillard: { label: 'Brouillard', sky: 0xbfc9ca, fogNear: 10,  fogFar: 220,  hemi: 1.0, sun: 0.6, turbulence: 0.2,
                  clouds: { coverage: 0.8, light: 0xe5e8e8, dark: 0xaab7b8 } },
    tempete:    { label: 'Tempête',    sky: 0x4d5656, fogNear: 40,  fogFar: 450,  hemi: 0.5, sun: 0.3, turbulence: 1,
                  clouds: { coverage: 1, light: 0x7f8c8d, dark: 0x2c3e50, opacity: 1, brightness: 1.2 } },
};

const view = document.getElementById('ecran');
const camera = new THREE.PerspectiveCamera(CAM_FOV, view.clientWidth / view.clientHeight, CAM_NEAR, CAM_FAR);

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true });
const terrain = new Terrain(renderer, { grassTint: COLOR_GROUND });
const clouds = new Clouds();
const stallWarning = new StallWarning();
const engineSound = new EngineSound();
let weather = null;
const hemiLight = new THREE.HemisphereLight(COLOR_LIGHT, COLOR_GROUND);
const sunLight = new THREE.DirectionalLight(COLOR_LIGHT);
const graphics = new Graphics(renderer, scene, camera, sunLight);
const multiplayer = new Multiplayer();
const remotePlayers = new RemotePlayers(scene, multiplayer);

const loader = new Utils3dLoader();

// Les commandes pilotent l'avion ; la caméra le suit (cabine ou vue extérieure)
const aircraft = new THREE.Group();
const controls = new PlaneControls( aircraft );
let propeller = null;
let chaseView = true;
const clock = new THREE.Clock();

const back = document.getElementById('background');
const cercle = document.getElementById('cercle');
const gasHandle = document.querySelector('#gas .square');
const gauges = {
    vitesse:  document.getElementById('cadran-1'),
    altitude: document.getElementById('cadran-2'),
    vario:    document.getElementById('cadran-3'),
    cap:      document.getElementById('cadran-4'),
};

controls.rollSpeed = ROLL_SPEED;
controls.groundHeight = (x, z) => terrain.heightAt(x, z);
controls.minAltitude = 1.5; // hauteur des roues sous le centre de l'avion

renderer.setPixelRatio(window.devicePixelRatio);
scene.fog = new THREE.Fog(0xffffff);
terrain.mesh.receiveShadow = true;
scene.add( terrain.mesh );
scene.add( clouds.mesh );
scene.add( hemiLight );
scene.add( sunLight );
scene.add( aircraft );
aircraft.position.y = START_ALTITUDE;
controls.saveState();

new GLTFLoader().load(AIRCRAFT_MODEL, (gltf) => {
    const model = gltf.scene;
    model.position.z = -2; // centre l'avion sur l'aile (le modèle a son origine vers le nez)
    propeller = model.getObjectByName('Propeller_Cone');
    // Recentre l'hélice sur son axe pour qu'elle tourne sans voilage
    const center = new THREE.Box3().setFromObject(propeller).getCenter(new THREE.Vector3());
    propeller.traverse((child) => child.geometry?.translate(-center.x, -center.y, 0));
    propeller.position.set(center.x, center.y, 0);
    model.traverse((child) => { child.castShadow = true; });
    aircraft.add(model);
    remotePlayers.setTemplate(model);
    updateView();
}, undefined, (error) => console.error(error));

// Vue cabine / vue extérieure (bouton ou touche V)
const viewButton = document.getElementById('vue');

function updateView() {
    aircraft.children.forEach((child) => { child.visible = chaseView; });
    viewButton.textContent = chaseView ? '🎥 Vue cabine' : '🎥 Vue extérieure';
}

function toggleView() {
    chaseView = !chaseView;
    updateView();
}

viewButton.addEventListener('click', (event) => {
    toggleView();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyV' && !event.repeat && !(event.target instanceof HTMLInputElement)) toggleView();
});
updateView();

// Après une réinitialisation (bouton ou touche R), la caméra se replace d'un coup
controls.addEventListener('reset', () => {
    aircraft.updateMatrixWorld();
    updateCamera(0, true);
});

const _cameraTarget = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

function updateCamera(delta, snap = false) {
    if (!chaseView) {
        camera.position.copy(COCKPIT_OFFSET).applyMatrix4(aircraft.matrixWorld);
        camera.quaternion.copy(aircraft.quaternion);
        return;
    }
    // Caméra de poursuite : suit l'avion avec un peu de retard, reste au-dessus du sol
    _cameraTarget.copy(CHASE_OFFSET).applyMatrix4(aircraft.matrixWorld);
    const ground = terrain.heightAt(_cameraTarget.x, _cameraTarget.z) + 2;
    _cameraTarget.y = Math.max(_cameraTarget.y, ground);
    camera.position.lerp(_cameraTarget, snap ? 1 : 1 - Math.exp(-CHASE_STIFFNESS * delta));
    camera.up.set(0, 1, 0);
    camera.lookAt(_lookAt.copy(CHASE_TARGET).applyMatrix4(aircraft.matrixWorld));
}

// Le canvas est dimensionné par la grille CSS : on adapte le rendu à sa taille réelle
function resize() {
    const width = view.clientWidth, height = view.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    graphics.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();

// Construction de la scène à partir du modèle de données (data/)
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
            for (let i = 0; i < nombre; i++) {
                const tmp = obj.clone();
                const o = placed[i];

                if (o) {
                    tmp.scale.set(Number(o.scalex), Number(o.scaley), Number(o.scalez));
                    tmp.position.set(Number(o.x), Number(o.y), Number(o.z));
                    tmp.position.y += terrain.heightAt(tmp.position.x, tmp.position.z);
                } else {
                    tmp.scale.set(...scale);
                    const x = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                    const z = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                    // Légèrement enfoncé pour ne pas flotter sur les pentes
                    tmp.position.set(x, terrain.heightAt(x, z) - 0.5, z);
                    tmp.rotation.y = Math.random() * Math.PI * 2;
                }
                tmp.traverse((child) => { child.castShadow = true; });
                scene.add(tmp);
            }
        });
    }
}

buildWorld().catch((error) => console.error(error));

// Panneau Météo
function setWeather(name) {
    const w = weather = WEATHERS[name];
    scene.background = new THREE.Color(w.sky); // caché par le ciel atmosphérique s'il est actif
    graphics.setAtmosphere(w.atmosphere ?? null);
    hemiLight.color.set(w.sky).lerp(new THREE.Color(COLOR_LIGHT), 0.5);
    hemiLight.intensity = w.hemi;
    sunLight.intensity = w.sun;
    controls.turbulence = w.turbulence;
    clouds.setWeather(w.clouds);

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

// Plein écran : tout le cockpit (écran de vol + instruments), bouton ou touche F
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
    }, { once: true });
}

function updateStallWarning() {
    alarme.classList.toggle('actif', controls.isStalled());
    stallWarning.update(controls.isNearStall());
}

// Brouillard de la météo, épaissi quand l'avion traverse un nuage ("jour blanc")
const cloudFogColor = new THREE.Color();
const shadowCenter = new THREE.Vector3();

function updateFog() {
    const density = clouds.densityAt(camera.position);
    cloudFogColor.set(weather.clouds.light);
    scene.fog.color.set(weather.atmosphere?.fog ?? weather.sky).lerp(cloudFogColor, density);
    scene.fog.near = THREE.MathUtils.lerp(weather.fogNear, 0, density);
    scene.fog.far = THREE.MathUtils.lerp(weather.fogFar, 30, density);
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
    multiResume.textContent = multiplayer.code ? `Partie ${multiplayer.code}` : 'Hors ligne';
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
    const count = multiplayer.players.size;
    multiResume.textContent = multiplayer.code
        ? `Partie ${multiplayer.code} · ${count + 1} joueur${count ? 's' : ''}`
        : 'Hors ligne';
});

// Instruments
function setGauge(gauge, angle, text) {
    gauge.querySelector('.aiguille').style.transform = `translateX(-50%) rotate(${angle}deg)`;
    gauge.querySelector('.valeur').textContent = text;
}

function updateInstruments() {
    // Horizon artificiel : on tourne d'abord autour du centre, puis on décale
    // perpendiculairement à l'horizon (sur horizon_back.png, 10° = 4.25 % de la hauteur)
    const roll = controls.getRoll();
    const pitchDeg = Math.atan(controls.getPitchRate()) * 180 / Math.PI;

    back.style.transform = `rotate(${roll}rad) translateY(${pitchDeg * HORIZON_PCT_PER_DEG}%)`;
    cercle.style.transform = `rotate(${roll}rad)`;

    const kmh = controls.getSpeed() * 3.6;
    const altitude = controls.getAltitude();
    const vario = controls.getVerticalSpeed();
    const heading = controls.getHeading();

    // Vitesse : 0 -> 270 km/h sur 300°
    setGauge(gauges.vitesse, -150 + Math.min(kmh / 270, 1) * 300, `${Math.round(kmh)} km/h`);
    // Altimètre : un tour pour 100 m
    setGauge(gauges.altitude, (altitude % 100) * 3.6, `${Math.round(altitude)} m`);
    // Variomètre : ±20 m/s, zéro à gauche (9 h)
    setGauge(gauges.vario, -90 + Math.max(-1, Math.min(1, vario / 20)) * 160, `${vario >= 0 ? '+' : ''}${vario.toFixed(1)} m/s`);
    // Cap : l'aiguille indique le cap, 0° = nord
    setGauge(gauges.cap, heading, `${String(Math.round(heading) % 360).padStart(3, '0')}°`);

    gasHandle.style.bottom = `calc(${controls.getThrottle()} * (100% - var(--manette)))`;
}

renderer.setAnimationLoop(()=>{
    const delta = clock.getDelta();

    controls.update( delta );
    aircraft.updateMatrixWorld();
    updateCamera( delta );
    if (propeller) propeller.rotation.z += (20 + 80 * controls.getThrottle()) * delta;
    engineSound.update(controls.getThrottle(), chaseView ? 1 : 0.7);
    multiplayer.update( aircraft, controls.getThrottle() );
    remotePlayers.update( delta );
    clouds.update( camera );
    updateFog();
    updateInstruments();
    updateStallWarning();

    shadowCenter.set(aircraft.position.x, terrain.heightAt(aircraft.position.x, aircraft.position.z), aircraft.position.z);
    graphics.update( shadowCenter );
    graphics.setAlarm( controls.isStalled() ? 0.5 + 0.3 * Math.sin(clock.elapsedTime * 10) : 0 );
    graphics.render();
});
