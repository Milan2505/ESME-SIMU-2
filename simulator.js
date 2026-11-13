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
import { Multiplayer, cleanRegistration, TEAM_MAX } from './js/Multiplayer.js';
import { Chat } from './js/Chat.js';
import { RemotePlayers, formatNM } from './js/RemotePlayers.js';
import { AirportNetwork } from './js/Airport.js';
import { Carrier, CARRIERS } from './js/Carrier.js';
import { City } from './js/City.js';
import { NightSky } from './js/NightSky.js';
import { Storm } from './js/Storm.js';
import { Cockpit, vorIndicator } from './js/Cockpit.js';
import { VOR } from './js/VOR.js';
import { Systems, TANK_CAPACITY, MAGNETOS, FUEL_SELECTOR } from './js/Systems.js';
import { tabletRegistry } from './js/TabletRegistry.js';
import { TabletPanels } from './js/TabletPanels.js';
import { makeDraggable } from './js/Draggable.js';
import { CrashEffect } from './js/CrashEffect.js';
import { ControlSurfaces, Gear } from './js/ControlSurfaces.js';
import { Settings } from './js/Settings.js';
import { AircraftLights, beaconOn } from './js/AircraftLights.js';
import { ILS } from './js/ILS.js';
import { Radio } from './js/Radio.js';
import { MapView } from './js/MapView.js';
import { ATC, METARS } from './js/ATC.js';
import { Wind } from './js/Wind.js';
import { RadioVoices } from './js/RadioVoices.js';
import { Initiation } from './js/Initiation.js';
import { FlightHud } from './js/FlightHud.js';
import { WeightBalance, WB_GALLON, computeLoad } from './js/WeightBalance.js';
import { Scenery } from './js/Scenery.js';
import { Avionics, parseFrequency } from './js/Avionics.js';
import { TouchControls } from './js/TouchControls.js';
import { isTablet, isPhone, isStandalone, isIOS } from './js/Device.js';
import { track, task, progress, LoadingScreen } from './js/Loading.js';
// Tablette : marque sur la page (bande de la barre d'état d'iOS en plein écran, voir style.css)
document.documentElement.classList.toggle('tablette', isTablet());
document.documentElement.classList.toggle('telephone', isPhone());   // (téléphone : interface tactile compacte)
// Tablette : ni zoom de la page, ni sélection de texte. Safari (iPad) ignore « user-scalable=no » du viewport : deux
// touchers rapides sur un bouton zoomaient la page, et un doigt posé un peu longtemps (freins, manche, gaz) sélectionnait
// le texte voisin (loupe, poignées bleues, menu Copier). En plus des règles de style.css (touch-action, user-select) :
// - pincement à deux doigts : les « gesture » de Safari sont annulés (le zoom de la caméra, lui, lit les pointeurs) ;
// - double toucher : le 2e toucher rapide est annulé (sinon zoom) et son clic rejoué à la main, pour que deux touchers
//   rapides sur un bouton (volets, trim…) comptent bien deux fois ;
// - appui long : ni menu contextuel, ni sélection. Les cases de saisie (immatriculation, transpondeur…) restent normales.
if (isTablet()) {
    const textField = (target) => target instanceof Element
        && Boolean(target.closest('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"]'));
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    }
    let lastTapEnd = 0, tapStart = null;
    document.addEventListener('touchstart', (event) => {
        tapStart = event.touches.length === 1 ? { target: event.target, x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    }, { passive: true, capture: true });
    document.addEventListener('touchend', (event) => {
        const now = performance.now();
        const quick = now - lastTapEnd < 400;
        lastTapEnd = now;
        if (!quick || event.touches.length > 0 || textField(event.target)) return;
        event.preventDefault();   // pas de zoom au double toucher
        // Toucher sur place (pas un glissé) : le clic que Safari n'enverra plus est rejoué
        const touch = event.changedTouches[0];
        if (tapStart && touch && tapStart.target === event.target
            && Math.hypot(touch.clientX - tapStart.x, touch.clientY - tapStart.y) < 12) {
            const clickable = event.target instanceof Element ? event.target.closest('button, a, label, summary, [role="button"], input, select') : null;
            clickable?.click();
        }
    }, { passive: false, capture: true });
    document.addEventListener('contextmenu', (event) => { if (!textField(event.target)) event.preventDefault(); });
    document.addEventListener('selectstart', (event) => { if (!textField(event.target)) event.preventDefault(); });
}
import { planesCollide } from './js/PlaneCollision.js';
import { BankAngleWarning, alarmBank } from './js/BankAngleWarning.js';
import { TerrainWarning } from './js/TerrainWarning.js';
import { loadAircraft, loadCabinParts, buildCabinShell, setRegistration, setDaylight, GROUND_Y, CABIN_ORIGIN, AIRCRAFT_SCALE } from './js/C172Model.js';
import { LIVERIES, DEFAULT_LIVERY, isLivery, paintAircraft } from './js/Liveries.js';
import { CESSNA_172 } from './js/Cessna172.js';
import { F15 } from './js/F15.js';
import { JetSystems, JET_MIL } from './js/JetSystems.js';
import { loadF15, cloneF15, paintF15, animateF15, inletSchedule, moveInlets, INLET_MAX, F15_LIVERIES, F15_DEFAULT_LIVERY, isF15Livery, F15_LIGHT_LAYOUT, F15_WHEEL_BOTTOM } from './js/F15Model.js';
import { F15Cockpit } from './js/F15Cockpit.js';
import { JetSound } from './js/JetSound.js';
import { VERSION, VERSION_DATE } from './js/Version.js';
import { Weapons } from './js/Weapons.js';
import { Damage, SmokeTrail } from './js/Damage.js';
import { Shield } from './js/Shield.js';
import { WeaponHud } from './js/WeaponHud.js';
import { F15Warnings } from './js/F15Warnings.js';
import { buildF15Stores } from './js/F15Stores.js';
import { HeliModel } from './js/HeliModel.js';
import { R44Systems } from './js/R44Systems.js';
import { R44Sound } from './js/R44Sound.js';
import { R44Cockpit, cloneR44, paintR44, R44_LIVERIES, R44_DEFAULT_LIVERY, isR44Livery, R44_LIGHT_LAYOUT, R44_SKID_HEIGHT } from './js/R44Model.js';

// Toujours la dernière version publiée, malgré le cache de 10 min de GitHub Pages (voir sw.js)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((error) => console.warn(error));

const CAM_FOV = 60, COCKPIT_FOV = 62, CAM_NEAR = 0.1, CAM_FAR = 3000;
const COLOR_GROUND = 0x219313, COLOR_LIGHT = 0xfdfefe;
// Lumière renvoyée par le sol : vert-gris sourd (un vert pur teintait en vert le dessous des ailes et le ventre de l'avion)
const COLOR_GROUND_BOUNCE = 0x5d6450;
const WORLD_SIZE = 1000;      // zone de placement aléatoire des objets
const CRASH_RESET_DELAY = 5000; // retour au point de départ après un crash (ms)

// Avions : Cessna 172P (C172Model.js, asset/c172p.glb) ou F-15C Eagle (F15Model.js, asset/f15/), choisi au hangar
// (voir setAircraftType). Ce qui dépend de l'avion : fiche AIRCRAFT_PROFILES ; valeurs de l'avion piloté ci-dessous
const AIRCRAFT_PROFILES = {
    c172: {
        label: 'Cessna 172', atcType: 'Cessna 172',
        wheelHeight: -GROUND_Y,                                          // origine de l'avion au-dessus du sol, roues posées
        cockpitPosition: CABIN_ORIGIN.clone().multiplyScalar(AIRCRAFT_SCALE),   // cabine (repère avion)
        cabinScale: AIRCRAFT_SCALE,                                      // cabine agrandie comme le modèle
        cockpitTilt: THREE.MathUtils.degToRad(-6),                       // regard à peine baissé : horizon dégagé au-dessus du capot
        chaseDistance: 15.4, chasePitch: Math.atan2(3.5, 15), chaseTarget: new THREE.Vector3(0, 1.5, -8),
    },
    f15: {
        label: 'F-15C Eagle', atcType: 'F-15',
        wheelHeight: -F15_WHEEL_BOTTOM,
        cockpitPosition: new THREE.Vector3(),                            // cockpit déjà à sa place dans le repère avion
        cabinScale: 1,
        cockpitTilt: THREE.MathUtils.degToRad(-9),                       // HUD au milieu, instruments en bas
        chaseDistance: 31, chasePitch: Math.atan2(5, 30), chaseTarget: new THREE.Vector3(0, 1.2, -16),
    },
    // Robinson R44 Raven II (R44Model.js, asset/r44/) : hélicoptère, place du pilote à droite
    r44: {
        label: 'Robinson R44', atcType: 'R44',
        wheelHeight: R44_SKID_HEIGHT,
        cockpitPosition: new THREE.Vector3(),
        cabinScale: 1,
        cockpitTilt: THREE.MathUtils.degToRad(-10),                      // tableau bas, sol visible par la bulle
        chaseDistance: 17, chasePitch: Math.atan2(3.5, 16), chaseTarget: new THREE.Vector3(0, 0.6, -3),
    },
};
let aircraftType = 'c172';
let WHEEL_HEIGHT = AIRCRAFT_PROFILES.c172.wheelHeight;
let COCKPIT_POSITION = AIRCRAFT_PROFILES.c172.cockpitPosition.clone();
let CABIN_SCALE = AIRCRAFT_PROFILES.c172.cabinScale;
let COCKPIT_TILT = AIRCRAFT_PROFILES.c172.cockpitTilt;
let CHASE_DISTANCE = AIRCRAFT_PROFILES.c172.chaseDistance;   // caméra extérieure : distance à l'avion
let CHASE_PITCH = AIRCRAFT_PROFILES.c172.chasePitch;         // … et hauteur (angle au-dessus de l'avion)
const CHASE_TARGET = AIRCRAFT_PROFILES.c172.chaseTarget.clone();   // point visé, devant l'avion
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
let shaderWarmup = null, sceneObjects = -1, warmCheckUntil = 0, nextWarmCheck = 0;   // voir checkNewShaders
// Pas d'anticrénelage sur le canvas : il est fait dans les textures du post-traitement (Graphics.js). Le canvas ne
// reçoit qu'une copie de l'image finale ; l'anticréneler calculait 4 échantillons par pixel pour rien (coûteux en plein écran)
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false });
// La carte graphique peut couper l'affichage 3D (surcharge, pilote, plantage du processus graphique de Chrome) :
// la page continue de tourner mais l'écran reste gris, sans erreur. On le signale, avec un bouton pour recharger
view.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    document.getElementById('contexte-perdu').hidden = false;
    // Pas revenue d'elle-même en 4 s : rechargement automatique, retour dans la partie (voir recoverFromFreeze)
    setTimeout(() => { if (renderer.getContext().isContextLost()) recoverFromFreeze('carte graphique perdue'); }, 4000);
});
view.addEventListener('webglcontextrestored', () => {
    document.getElementById('contexte-perdu').hidden = true;
    // Textures calculées une seule fois (ciel, imposteurs d'arbres) : revenues vides, on les redessine (sinon ciel noir,
    // fréquent sur tablette et téléphone). À l'image suivante : three.js a fini de recréer son état
    requestAnimationFrame(() => {
        try { graphics.redrawSky(); scenery.redrawImpostors(); } catch { /* ciel uni à défaut */ }
    });
});
document.getElementById('contexte-perdu-recharger').addEventListener('click', () => location.reload());
// Aérodromes (ESME, MONTVAL) : airport répond comme un aérodrome seul, celui choisi au départ (airport.current)
// Carte chargée : 'campagne' (ESME et AIX, dans les collines), 'ville' (ESME et AIX, une grande ville entre les deux) ou
// 'mer' (deux porte-avions en pleine mer). Choisie au
// menu principal (gardée d'une visite à l'autre), ou imposée par la partie multijoueur rejointe : changer de carte
// recharge la page (tout le monde est construit au chargement). ?carte=mer dans l'adresse la choisit aussi
const MAP_LABELS = { campagne: 'Campagne', ville: 'Ville', mer: 'Mer' };
const MAP = (() => {
    const asked = new URLSearchParams(location.search).get('carte');
    const valid = (name) => (Object.hasOwn(MAP_LABELS, name ?? '') ? name : 'campagne');
    try {
        if (valid(asked) === asked) localStorage.setItem('carte', asked);
        return valid(localStorage.getItem('carte'));
    } catch {
        return valid(asked);
    }
})();
const SEA = MAP === 'mer';
const airport = SEA ? new AirportNetwork([CARRIERS.bleu, CARRIERS.rouge], (config) => new Carrier(config)) : new AirportNetwork();
// Carte « Ville » : la ville (sol plat et sans montagnes sous elle, voir flatten et clearings ci-dessous)
const city = MAP === 'ville' ? new City({ airport }) : null;
// Vallée dégagée dans l'axe de chaque piste : ~2,5 km de chaque côté, ~1 km de large (plaine ondulée, lacs)
// Terrain de 16 km : une vallée par aérodrome, allongée dans l'axe de sa piste, et des couloirs d'approche dégagés
const terrain = new Terrain(renderer, { grassTint: COLOR_GROUND,
    flatten: city ? (x, z) => Math.min(airport.reliefFactor(x, z), city.reliefFactor(x, z)) : (x, z) => airport.reliefFactor(x, z),
    clearings: [...airport.allRunways.filter((rw, i) => i % 2 === 0).map((rw) => {
        const mx = rw.threshold.x + rw.direction.x * rw.length / 2, mz = rw.threshold.z + rw.direction.z * rw.length / 2;
        const along = Math.abs(rw.direction.z) > 0.5;   // piste nord-sud
        return { x: mx, z: mz, rx: along ? 1050 : 2500, rz: along ? 2500 : 1050 };
    }), ...(city ? [city.clearing] : [])],
    limit: (x, z) => airport.terrainLimit(x, z), dips: (x, z) => airport.dipFactor(x, z), lakes: airport.lakes,
    ocean: SEA ? { depth: 40 } : null, platformAt: (x, z) => airport.platformAt(x, z) });
const clouds = new Clouds();
const cloudLayer = new CloudLayer();
const nightSky = new NightSky();
const stallWarning = new StallWarning();
const bankAngleWarning = new BankAngleWarning();
const terrainWarning = new TerrainWarning();
const engineSound = new EngineSound();
const jetSound = new JetSound();   // réacteurs du F-15
const r44Sound = new R44Sound();   // moteur, rotor et alarmes du R44
const sounds = new SoundEffects();
const storm = new Storm({ groundHeight: (x, z) => terrain.heightAt(x, z), sounds });
const cessnaCockpit = new Cockpit();
const jetCockpit = new F15Cockpit();   // (chargé avec le F-15)
const heliCockpit = new R44Cockpit();  // (chargé avec le R44 : il porte aussi l'extérieur)
let cockpit = cessnaCockpit;           // cabine de l'avion piloté
try { if (localStorage.getItem('manches') === '0') cockpit.setYokesVisible(false); } catch { /* stockage indisponible */ }
const crashEffect = new CrashEffect();
let weather = null;
let weatherName = 'jour';   // nom de la météo choisie (envoyé aux autres joueurs : celle du créateur donne le vent)
const hemiLight = new THREE.HemisphereLight(COLOR_LIGHT, COLOR_GROUND_BOUNCE);
const sunLight = new THREE.DirectionalLight(COLOR_LIGHT);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // au-delà : très coûteux, gain à peine visible (+ MSAA)
const graphics = new Graphics(renderer, scene, camera, sunLight);
// Téléphone : au plus ~0,9 million de pixels calculés par image en résolution automatique (2,1 millions ailleurs). Sur un
// écran très dense (3 pixels physiques par pixel CSS), il en calculait autant qu'un ordinateur en Full HD : ~40 Mo de
// tampons d'image en mémoire graphique, pour une image à peine plus fine sur un si petit écran
if (isPhone()) graphics.pixelBudget = 0.9e6;
const multiplayer = new Multiplayer();
multiplayer.map = MAP;
// Porte-avions : règles d'appontage et de catapultage (solo : choix du menu principal ; en partie : celles du créateur)
let soloCarrierRules = 'arcade';
try { soloCarrierRules = localStorage.getItem('pa-regles') === 'realiste' ? 'realiste' : 'arcade'; } catch { /* stockage indisponible */ }
multiplayer.carrierRules = soloCarrierRules;
const carrierRules = () => (multiplayer.code ? multiplayer.carrierRules : soloCarrierRules);
const remotePlayers = new RemotePlayers(scene, multiplayer, { engineSound, jetSound, heliSound: r44Sound,
    altitudeOffset: { c172: AIRCRAFT_PROFILES.c172.wheelHeight, f15: AIRCRAFT_PROFILES.f15.wheelHeight, r44: AIRCRAFT_PROFILES.r44.wheelHeight },
    registrationFor: (id) => registrationFor(id) });
remotePlayers.onJetNeeded = () => setupJet().catch(() => {});   // un autre joueur vole en F-15
remotePlayers.onHeliNeeded = () => setupHeli().catch(() => {});   // … ou en R44
remotePlayers.prepare = (object) => prepareForDisplay(object);
// Wardog : étiquettes (et carte) à la couleur de l'équipe
remotePlayers.colorFor = (id, state) => (multiplayer.mode === 'wardog' && state.team ? { bleu: '#3d8fd6', rouge: '#e0473c' }[state.team] : null);   // avions des autres : compilés avant d'apparaître
// Tour de contrôle (contrôleur automatique) : immatriculation française réaliste du Cessna
// Vent variable (force et direction selon la météo) : agit sur l'avion, annoncé par l'ATIS et les contrôleurs
const wind = new Wind();
// Voix de la radio : voix réalistes (téléchargées à la première ouverture de la fenêtre), sinon voix de l'ordinateur
const radioVoices = new RadioVoices();
const f15Warnings = new F15Warnings({ voices: radioVoices });   // alarmes du F-15 (voyants, voix, HUD)
const atc = new ATC({ airport, wind, voices: radioVoices, sounds, registration: 'F-HESM', aircraftType: 'Cessna 172' });
const radio = new Radio(multiplayer);

const loader = new Utils3dLoader();

// Les commandes pilotent l'avion ; la caméra le suit (cabine ou vue extérieure)
const aircraft = new THREE.Group();
const controls = new PlaneControls( aircraft );
// Systèmes de l'avion (électricité, moteur, carburant, feux) commandés depuis la cabine
const cessnaSystems = new Systems();
const jetSystems = new JetSystems();
const heliSystems = new R44Systems();
let systems = cessnaSystems;           // systèmes de l'avion piloté
// R44 : son propre modèle de vol (hélicoptère), branché à la place de celui des avions (voir setAircraftType)
const planeModel = controls.model;
const heliModel = new HeliModel(aircraft);
heliModel.engine = heliSystems;
const jetFlight = { ...F15 };          // caractéristiques du F-15 pour le modèle de vol (masse : suit le carburant)
// Radios du tableau (NAV/COM, transpondeur, DME, ADF...), lien avec le contrôle aérien (voir syncRadios)
const avionics = new Avionics();
const radioSync = { freq: null, code: null };
let gloveboxOpen = false;
// Décor instancié, par type d'objet : { meshes, total, obstacles } (voir buildWorld)
const decorGroups = [];
let decorDensity = 1;
// 'realiste' (forêts, villages, rochers et fleurs réalistes : par défaut) ou 'classique' (anciens assets stylisés seuls)
let decorStyle = 'realiste';
// Anciens assets (data/type objet.csv) affichés seulement en style classique : arbres, fleurs, rochers, tentes stylisés
const CLASSIC_ASSETS = new Set(['TREE', 'TREE_F', 'FLOWER_Y', 'FLOWER_P', 'ROCK', 'TENT']);
// Décor réaliste (Scenery.js) : rien dans l'axe d'approche de la piste (x 220, nord-sud), ni sur l'aérodrome
// Forêts et villages réalistes autour de chaque aérodrome (régions : centres), rien dans l'axe des pistes
// (carte « Ville » : ni bois ni villages dans la ville et sur ses abords)
const scenery = new Scenery(scene, { renderer, terrain, airport,
    corridor: (x, z) => airport.inCorridor(x, z) || Boolean(city?.contains(x, z, 120)),
    regions: airport.list.map((a) => ({ x: a.center.x, z: a.center.z })) });
let aircraftModel = null;
let propeller = null;
let propellerParts = new Set();   // pièces de l'hélice (estompées quand elle tourne vite)
let propellerDisc = null;          // disque de flou de l'hélice qui tourne vite
let controlSurfaces = null;
let gear = null;                  // roulette de nez orientable, roues qui roulent
let chaseView = true;
const clock = new THREE.Clock();

// Sur un lac, l'avion s'enfonce à mesure qu'il ralentit : roues 45 cm sous la surface à la vitesse d'amerrissage,
// ventre dans l'eau au pas ; presque arrêté, il coule lentement (un C172 sur roues ne flotte pas), le nez (moteur)
// d'abord. Quand l'eau atteint l'aile, il a coulé. Le fond du lac l'arrête (eau peu profonde près des rives)
const WATER_SINK = 0.45, WATER_SINK_SLOW = 1.3, WATER_SINK_RATE = 0.15;   // m, m, m/s
let waterSink = WATER_SINK;   // enfoncement actuel des roues sous la surface
let sunk = false;             // crash en cours : avion coulé (pas d'explosion)
function waterLake(x, z) {
    const lake = terrain.lakeAt(x, z);
    return lake && terrain.groundAt(x, z, lake) < lake.level - WATER_SINK ? lake : null;
}
// Sous l'eau, sol des roues : le fond, ou waterSink sous la surface si le fond est plus bas. Continu à la rive (avant :
// marche de 45 cm entre la surface de l'eau et le sol enfoncé, la normale du sol basculait et l'avion tremblait)
controls.groundHeight = (x, z) => {
    // Porte-avions : sous le niveau du pont (en vol, plus de 3 m en dessous), c'est la mer et non le pont qui est sous
    // l'avion (sinon, passer sous le débord du pont le faisait « atterrir » dessus) ; la coque arrête l'avion
    if (SEA && !controls.isOnGround() && aircraft.position.y < (airport.platformAt(x, z) ?? -Infinity) - 3) {
        return Math.max(-40, -waterSink);
    }
    const lake = terrain.lakeAt(x, z);
    if (!lake) return terrain.heightAt(x, z);
    const ground = terrain.groundAt(x, z, lake);
    return ground < lake.level ? Math.max(ground, lake.level - waterSink) : ground;
};
function updateWaterSink(delta) {
    const onWater = controls.isOnGround() && !controls.isCrashed() && controls.getSurface() === 'water';
    const lake = onWater ? waterLake(aircraft.position.x, aircraft.position.z) : null;
    if (!lake) {
        waterSink = WATER_SINK;
        return;
    }
    const wingHeight = controls.model.aircraft.wingHeight;
    const speed = controls.getSpeed();
    const target = speed < 2 ? wingHeight + 1
        : THREE.MathUtils.lerp(WATER_SINK_SLOW, WATER_SINK, THREE.MathUtils.smoothstep(speed, 2, 18));
    waterSink += THREE.MathUtils.clamp(target - waterSink, -0.6 * delta, (speed < 2 ? WATER_SINK_RATE : 0.4) * delta);
    // Nez qui plonge (moteur lourd) à mesure que l'avion coule ; l'assiette est recalculée à chaque image au sol
    aircraft.rotateX(-THREE.MathUtils.degToRad(10) * THREE.MathUtils.smoothstep(waterSink, WATER_SINK_SLOW, wingHeight));
    // Eau au-dessus du bas des roues (le fond peut retenir l'avion avant)
    const depth = lake.level - (aircraft.position.y - WHEEL_HEIGHT);
    if (depth > wingHeight - 0.2) {
        sunk = true;
        controls.model.crash("L'avion a coulé");
    }
}
controls.surfaceAt = (x, z) => (waterLake(x, z) ? 'water' : airport.surfaceAt(x, z));

// --- Porte-avions (carte « Mer ») -------------------------------------------------------------------------------
// Deux règles, choisies à la création de la partie (en solo : au menu principal) :
// - Arcade : sur une catapulte, gaz à fond (≥ 80 %) -> lancé en ~2 s ; au toucher de la piste oblique, train sorti, un
//   brin d'arrêt est toujours accroché (crosse automatique)
// - Réaliste : crosse d'appontage à sortir (touche 9), toucher entre le premier et le dernier brin, sinon « bolter » :
//   remettre les gaz et refaire un tour ; catapulte : arrêté dessus, postcombustion (≥ 95 %), puis touche 0
// Catapulte : l'avion est tenu dans l'axe et poussé jusqu'à LAUNCH_SPEED au bout de la course, nez relevé (il s'envole).
// Brins : décélération pour s'arrêter en ~ARREST_DISTANCE m, l'avion reste tenu tant que les gaz ne sont pas réduits
const LAUNCH_SPEED = 78;        // m/s en bout de catapulte (~150 kt)
const LAUNCH_SPEED_C172 = 35;   // (Cessna : ~70 kt, il s'envole bien avant)
const ARREST_DISTANCE = 85;     // m
const carrierOps = { launch: null, arrest: null, hook: false, armed: false, hintAt: 0, onCat: null };
function carrierMessage(text, red = false) {
    if (aircraftType === 'f15') weaponHud.message(text, red);
    showRadioMessage(text);
}
// Catapulte sous l'avion (presque arrêté au départ de la course, à peu près dans l'axe), sinon null. Tolérances
// larges : une fois dessus, l'avion est accroché et remis exactement dans l'axe (voir updateCarrier)
function catapultUnder() {
    const p = aircraft.position;
    for (const field of airport.list) {
        for (const cat of field.catapults ?? []) {
            const dx = p.x - cat.start.x, dz = p.z - cat.start.z;
            const along = dx * cat.direction.x + dz * cat.direction.z;
            const lateral = Math.abs(dx * cat.direction.z - dz * cat.direction.x);
            const yaw = Math.atan2(-cat.direction.x, -cat.direction.z);
            const misaligned = Math.abs(Math.atan2(Math.sin(controls.model._groundYaw - yaw), Math.cos(controls.model._groundYaw - yaw)));
            if (along > -14 && along < 14 && lateral < 6 && misaligned < THREE.MathUtils.degToRad(20)) return { cat, yaw };
        }
    }
    return null;
}
function carrierTouchdown() {
    if (!SEA || aircraftType === 'r44') return;   // (R44 : il se pose où il veut sur le pont, sans brin)
    carrierOps.arrest = null;
    const field = airport.carrierAt(aircraft.position.x, aircraft.position.z);
    if (!field) return;
    const { along, lateral } = field.landingAreaAt(aircraft.position.x, aircraft.position.z);
    if (lateral > 14 || along < -10 || along > 140) return;   // (hors de la piste oblique : simple roulage)
    const realistic = carrierRules() === 'realiste';
    const wires = field.wires;
    const caught = realistic ? carrierOps.hook && along > wires[0] - 8 && along < wires.at(-1) + 6 : along < 120;
    if (!caught) {
        carrierMessage(realistic && !carrierOps.hook ? 'BOLTER : crosse rentrée (touche 9), remettez les gaz !' : 'BOLTER : brins manqués, remettez les gaz !', true);
        return;
    }
    const wire = wires.reduce((best, w, i) => (Math.abs(w - along) < Math.abs(wires[best] - along) ? i : best), 0) + 1;
    const speed = controls.getSpeed();
    carrierOps.arrest = { decel: Math.max(8, speed * speed / (2 * ARREST_DISTANCE)), stopped: false, wire };
    carrierMessage(`Brin n° ${wire} accroché !`);
}
// Fin de catapulte : l'avion passe en vol, dans l'axe, à la vitesse donnée (m/s), un peu montant et nez levé (même
// passage que FlightModel quand l'aile porte le poids, voir _updateGround)
let launchGhostUntil = 0;   // (autres joueurs traversables jusque-là après un catapultage, voir checkPlaneCollisions)
function launchOffDeck(model, cat, speed) {
    launchGhostUntil = performance.now() + 3000;
    model.onGround = false;
    model._settleRoll = model._settlePitch = model._gear = model._gearSpeed = 0;
    model.velocity.set(cat.direction.x, 0, cat.direction.z).normalize().multiplyScalar(speed);
    model.velocity.y = 2;
    model.airspeed = speed;
    model._liftoffBlend = model.assists.smoothLiftoff ? 1 : 0;
    model._weathervaneBlend = 1;
    model._angularVelocity.set(0, 0, 0);
    model._pathAngle = null;
    model._alphaCommand = null;
    model._release = 0;
    // Assiette refaite proprement : dans l'axe de la catapulte, ailes à plat, nez levé (sans la pente du sol vue au bord
    // du pont, voir FlightModel._groundNormal)
    const pitch = Math.max(model._groundPitch, THREE.MathUtils.degToRad(aircraftType === 'f15' ? 8 : 5));
    model.alpha = model._liftoffAlpha = pitch;
    aircraft.quaternion.setFromEuler(new THREE.Euler(pitch, Math.atan2(-cat.direction.x, -cat.direction.z), 0, 'YXZ'));
    aircraft.position.y += 0.05;
    model.dispatchEvent({ type: 'liftoff' });
}
function updateCarrier(delta) {
    const model = controls.model;
    if (controls.isCrashed()) {
        carrierOps.launch = carrierOps.arrest = null;
        return;
    }
    // Coque : sous le niveau du pont, au-dessus du navire (voir controls.groundHeight) -> percutée
    const deck = airport.platformAt(aircraft.position.x, aircraft.position.z);
    if (!controls.isOnGround() && deck !== null && aircraft.position.y < deck - 3 && aircraft.position.y > -3) {
        controls.collide('Collision avec le porte-avions');
        return;
    }
    // R44 : ni catapulte ni brins d'arrêt (il décolle et se pose à la verticale)
    if (aircraftType === 'r44') {
        carrierOps.launch = carrierOps.arrest = carrierOps.onCat = null;
        return;
    }
    const realistic = carrierRules() === 'realiste';
    if (!realistic) carrierOps.hook = model.gearDown;   // (arcade : crosse sortie avec le train)

    // Brin accroché : freinage, puis l'avion reste tenu (gaz à réduire)
    const arrest = carrierOps.arrest;
    if (arrest) {
        if (!controls.isOnGround()) carrierOps.arrest = null;
        else if (!arrest.stopped) {
            model.airspeed = Math.max(0, model.airspeed - arrest.decel * delta);
            if (model.airspeed === 0) {
                arrest.stopped = true;
                if (!realistic) controls.throttle = 0;
                carrierMessage(`Appontage réussi (brin n° ${arrest.wire}) ! Réduisez les gaz pour libérer le brin`);
            }
        } else {
            model.airspeed = 0;
            if (controls.throttle < 0.25) carrierOps.arrest = null;   // brin libéré
        }
    }

    // Catapulte : lancement en cours
    const launch = carrierOps.launch;
    if (launch) {
        const { cat, yaw } = launch;
        // Vitesse visée : par rapport à l'air (vent de face ou arrière compté). Avant, par rapport au pont : avec du vent
        // arrière (en multijoueur, le vent vient du code de la partie et de la météo du créateur), l'avion arrivait en
        // bout de rampe trop lent pour l'air, ne s'envolait pas et tombait du pont
        const headwind = -(wind.vector.x * cat.direction.x + wind.vector.z * cat.direction.z);
        const target = Math.max(10, (aircraftType === 'f15' ? LAUNCH_SPEED : LAUNCH_SPEED_C172) - headwind);
        model._groundYaw = yaw;
        const dx = aircraft.position.x - cat.start.x, dz = aircraft.position.z - cat.start.z;
        const along = dx * cat.direction.x + dz * cat.direction.z;
        // Bout de course : la navette lâche l'avion, qui quitte le pont lancé (comme une vraie catapulte), même si l'aile
        // ne porte pas encore tout son poids
        if (controls.isOnGround() && along >= cat.stroke) {
            launchOffDeck(model, cat, Math.max(model.airspeed, target));
            carrierOps.launch = null;
            return;
        }
        if (controls.isOnGround()) {
            // Tenu dans l'axe de la catapulte, accéléré pour atteindre la vitesse visée en bout de course. Freins
            // (frein de parc, touche tenue) sans effet : la navette tire l'avion
            aircraft.position.x = cat.start.x + cat.direction.x * along;
            aircraft.position.z = cat.start.z + cat.direction.z * along;
            const remaining = Math.max(1, cat.stroke - along);
            const accel = Math.max(0, target * target - model.airspeed * model.airspeed) / (2 * remaining);
            model.airspeed += (Math.max(accel, 5) + (model.controls?.brake ?? 0) * (model.aircraft?.brakes ?? 0)) * delta;
            if (along >= cat.stroke - 2) {
                model.airspeed = Math.max(model.airspeed, target);
                model._groundPitch = Math.max(model._groundPitch, THREE.MathUtils.degToRad(aircraftType === 'f15' ? 10 : 7));
            }
        }
        if (!controls.isOnGround() || along > cat.stroke + 5) {
            carrierOps.launch = null;
            launchGhostUntil = performance.now() + 3000;   // (envolé avant le bout de course : de même)
        }
        return;
    }

    // Sur une catapulte : accroché à la navette, l'avion est tenu immobile dans l'axe (barre de retenue) le temps de
    // mettre les gaz, puis lancé. Avant, il n'était que « repéré » arrêté sur la catapulte : en poussant les gaz
    // progressivement (clavier, manette tactile), il roulait avant d'atteindre 80 % et sortait de la catapulte sans
    // être lancé (« catapulte inopérante » pour un joueur, alors qu'elle marchait pour qui mettait plein gaz d'un coup)
    if (!carrierOps.onCat) {
        const found = controls.isOnGround() && controls.getSpeed() < 6 && !carrierOps.arrest ? catapultUnder() : null;
        if (!found) {
            carrierOps.armed = false;
            return;
        }
        carrierOps.onCat = found;
        carrierOps.armed = false;
        carrierMessage(realistic ? `Catapulte ${found.cat.index} accrochée : postcombustion (gaz ≥ 95 %), puis touche 0 pour le lancement`
            : `Catapulte ${found.cat.index} accrochée : gaz à fond (≥ 80 %) pour être lancé`);
    }
    const under = carrierOps.onCat;
    if (!controls.isOnGround()) {
        carrierOps.onCat = null;
        return;
    }
    aircraft.position.x = under.cat.start.x;
    aircraft.position.z = under.cat.start.z;
    model._groundYaw = under.yaw;
    model.airspeed = 0;
    const ready = realistic ? controls.throttle >= 0.95 && carrierOps.armed : controls.throttle >= 0.8;
    if (!ready) return;
    carrierOps.launch = { cat: under.cat, yaw: under.yaw };
    carrierOps.onCat = null;
    carrierOps.armed = false;
    model._groundYaw = under.yaw;
    shake = Math.max(shake, 0.6);
    carrierMessage(`Catapulte ${under.cat.index} : lancement !`);
}
controls.addEventListener('reset', () => { carrierOps.launch = carrierOps.arrest = carrierOps.onCat = null; });
// Réaliste : crosse d'appontage (touche 9), lancement de la catapulte (touche 0)
window.addEventListener('keydown', (event) => {
    if (!SEA || event.repeat || isTypingTarget(event.target) || choosingSpawn || inMenu) return;
    if (carrierRules() !== 'realiste') return;
    if (event.code === 'Digit9' || event.code === 'Numpad9') {
        carrierOps.hook = !carrierOps.hook;
        carrierMessage(carrierOps.hook ? 'Crosse d\'appontage sortie' : 'Crosse d\'appontage rentrée');
    }
    if ((event.code === 'Digit0' || event.code === 'Numpad0') && carrierOps.onCat) {
        if (controls.throttle < 0.95) carrierMessage('Catapulte : poussez d\'abord la postcombustion (gaz ≥ 95 %)', true);
        else carrierOps.armed = true;
    }
});

// Gerbes d'écume quand l'avion roule (ou glisse) sur un lac : gouttes lancées par les roues, retombant dans l'eau
const waterSpray = (() => {
    const COUNT = 260, SPRAY_WHEELS = [[-1.3, 0.6], [1.3, 0.6], [0, -1.5]];   // roues (x, z, repère avion, m)
    const positions = new Float32Array(COUNT * 3), velocities = new Float32Array(COUNT * 3), life = new Float32Array(COUNT);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const sprite = (() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.4, 'rgba(235,242,245,0.45)');
        g.addColorStop(1, 'rgba(235,242,245,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    })();
    const material = new THREE.PointsMaterial({ map: sprite, size: 1.5, transparent: true, depthWrite: false });
    material.color.setScalar(1.7);   // écume blanche au soleil (le rendu final assombrit les blancs)
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    let next = 0, debt = 0;
    const local = new THREE.Vector3(), push = new THREE.Vector3();
    for (let i = 0; i < COUNT; i++) positions[i * 3 + 1] = -1e4;
    return {
        update(delta, active) {
            const speed = controls.getSpeed();
            if (active && speed > 1.5) {
                debt += delta * Math.min(220, 12 * speed);
                push.set(0, 0, 1).applyQuaternion(aircraft.quaternion);   // vers l'arrière de l'avion
                while (debt >= 1) {
                    debt -= 1;
                    const [wx, wz] = SPRAY_WHEELS[next % SPRAY_WHEELS.length];
                    local.set(wx * AIRCRAFT_SCALE, 0, wz * AIRCRAFT_SCALE).applyQuaternion(aircraft.quaternion).add(aircraft.position);
                    const lake = waterLake(local.x, local.z);
                    const i = next++ % COUNT;
                    positions.set([local.x, (lake ? lake.level : local.y - 1) + 0.1, local.z], i * 3);
                    const side = (Math.random() - 0.5) * 2, up = 1.5 + Math.random() * Math.min(5, speed * 0.25);
                    velocities.set([push.x * speed * 0.35 + side * 1.5, up, push.z * speed * 0.35 + side * 1.5], i * 3);
                    life[i] = 0.7 + Math.random() * 0.6;
                }
            }
            let alive = false;
            for (let i = 0; i < COUNT; i++) {
                if (life[i] <= 0) continue;
                life[i] -= delta;
                velocities[i * 3 + 1] -= 9.81 * delta;
                for (let k = 0; k < 3; k++) positions[i * 3 + k] += velocities[i * 3 + k] * delta;
                if (life[i] <= 0) positions[i * 3 + 1] = -1e4;
                else alive = true;
            }
            points.visible = alive;
            geometry.attributes.position.needsUpdate = alive;
        },
    };
})();
controls.minAltitude = WHEEL_HEIGHT;

scene.fog = new THREE.Fog(0xffffff);
terrain.mesh.receiveShadow = true;
scene.add( terrain.mesh );
scene.add( airport.build(renderer) );
if (city) {
    city.terrain = terrain;
    scene.add(city.build());
}
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
jetCockpit.group.visible = false;
aircraft.add(jetCockpit.group);   // (dans le repère avion, à taille réelle)

// Feux de navigation (rouge à gauche, vert à droite, blanc à l'arrière), anticollision et phare d'atterrissage
// Extérieur de l'avion (modèle, feux, phare)
const airframe = new THREE.Group();
aircraft.add(airframe);
const cessnaLights = new AircraftLights(airframe, { castLight: true });
let aircraftLights = cessnaLights;     // feux de l'avion piloté
// Intensités (cd) : sol éclairé au niveau d'un éclairage de jour (soleil : 2), pas au-delà ; cônes serrés : le bas du
// faisceau ne touche le sol que loin devant (un cône de 20° l'éclairait à 5 m de l'avion : sol brûlé, pilote ébloui)
const LANDING_LIGHT = 3000, TAXI_LIGHT = 320;
const cessnaLandingLight = new THREE.SpotLight(0xfff3d6, 0, 400, THREE.MathUtils.degToRad(11), 0.55, 1.6); // phare d'atterrissage
// Phare dans le bord d'attaque de l'aile gauche, comme sur un vrai Cessna 172
// (dans le nez, il éclairait les pales de l'hélice qui passaient devant : flashs blancs)
cessnaLandingLight.position.set(-2.92, 1.14, -2.3).multiplyScalar(AIRCRAFT_SCALE);
// Visé ~2° sous l'horizon (sol éclairé surtout vers 50-120 m) : visible depuis la cabine au-dessus du tableau de bord
cessnaLandingLight.target.position.set(-1.2, -1.8, -80);
airframe.add(cessnaLandingLight, cessnaLandingLight.target);
// Phare de roulage : à côté, faisceau large et court, plongeant vers le sol devant l'avion (vers 10-25 m), un peu
// tourné vers l'extérieur : éclaire la voie de circulation et ses bords dans les virages
const cessnaTaxiLight = new THREE.SpotLight(0xfff3d6, 0, 120, THREE.MathUtils.degToRad(28), 0.75, 1.6);
cessnaTaxiLight.position.set(-2.807, 1.14, -2.3).multiplyScalar(AIRCRAFT_SCALE);
cessnaTaxiLight.target.position.set(-5, -2.8, -30);
airframe.add(cessnaTaxiLight, cessnaTaxiLight.target);
let landingLight = cessnaLandingLight, taxiLight = cessnaTaxiLight;

// F-15 : extérieur, feux et phares (sur la jambe du train avant), dans son propre groupe, caché en Cessna
const jetFrame = new THREE.Group();
jetFrame.visible = false;
aircraft.add(jetFrame);
const jetLights = new AircraftLights(jetFrame, { castLight: true, layout: F15_LIGHT_LAYOUT });
const jetLandingLight = new THREE.SpotLight(0xfff3d6, 0, 500, THREE.MathUtils.degToRad(10), 0.55, 1.6);
jetLandingLight.position.set(0, -0.82, -3.8);
jetLandingLight.target.position.set(0, -2.5, -90);
const jetTaxiLight = new THREE.SpotLight(0xfff3d6, 0, 140, THREE.MathUtils.degToRad(26), 0.75, 1.6);
jetTaxiLight.position.set(0, -1.0, -3.7);
jetTaxiLight.target.position.set(0, -3.5, -30);
jetFrame.add(jetLandingLight, jetLandingLight.target, jetTaxiLight, jetTaxiLight.target);
// R44 : extérieur, feux et phares (deux phares dans le nez, l'un plus plongeant), caché en avion
const heliFrame = new THREE.Group();
heliFrame.visible = false;
aircraft.add(heliFrame);
const heliLights = new AircraftLights(heliFrame, { castLight: true, layout: R44_LIGHT_LAYOUT });
const heliLandingLight = new THREE.SpotLight(0xfff3d6, 0, 400, THREE.MathUtils.degToRad(12), 0.55, 1.6);
heliLandingLight.position.set(-0.065, -0.85, -4.6);
heliLandingLight.target.position.set(-0.5, -6, -70);
const heliTaxiLight = new THREE.SpotLight(0xfff3d6, 0, 140, THREE.MathUtils.degToRad(24), 0.75, 1.6);
heliTaxiLight.position.set(0.065, -0.85, -4.6);
heliTaxiLight.target.position.set(0.5, -12, -30);
heliFrame.add(heliLandingLight, heliLandingLight.target, heliTaxiLight, heliTaxiLight.target);
heliCockpit.group.visible = false;
aircraft.add(heliCockpit.group);
// Avion non piloté (Cessna en F-15, F-15 en Cessna) et son cockpit : cachés, leurs positions ne sont plus recalculées à
// chaque image. three.js le faisait même pour les objets cachés (~1 000 pièces de trop, ~8 % du temps de calcul) ;
// redevenus visibles, ils sont recalculés avant d'être dessinés
function skipWhenHidden(object) {
    const update = object.updateMatrixWorld;
    object.updateMatrixWorld = function (force) {
        if (this.visible) update.call(this, force);
    };
}
for (const object of [airframe, jetFrame, heliFrame, cessnaCockpit.group, jetCockpit.group, heliCockpit.group]) skipWhenHidden(object);

// Feux réellement allumés : interrupteurs et alimentation ; phares seulement de nuit (le jour, ils ne se
// verraient pas et chaque lumière alourdit le rendu)
function applyLights() {
    const lights = { ...systems.lights };
    // F-15 : phares sur la jambe du train avant, éteints train rentré
    if (aircraftType === 'f15' && controls.model.gearPosition < 0.99) lights.land = lights.taxi = false;
    const dark = (weather?.night ?? 0) >= 0.5;
    aircraftLights.setSwitches(lights);
    landingLight.visible = lights.land && dark;
    taxiLight.visible = lights.taxi && dark;
}
for (const s of [cessnaSystems, jetSystems, heliSystems]) {
    s.addEventListener('change', () => { if (s === systems) applyLights(); });
    // Démarrage raté : message à l'écran (raison et marche à suivre)
    s.addEventListener('startfail', ({ detail }) => { if (s === systems) showRadioMessage(detail); });
}
cessnaSystems.addEventListener('start', () => { if (systems === cessnaSystems) engineSound.playStart(chaseView ? 1 : 0.45); });
cessnaSystems.addEventListener('stop', () => { if (systems === cessnaSystems && !controls.isCrashed()) engineSound.playStop(chaseView ? 1 : 0.45); });
jetSystems.addEventListener('start', ({ detail }) => { if (systems === jetSystems) showViewLabel(`Réacteur ${detail.side ? 'droit' : 'gauche'} allumé`); });
heliSystems.addEventListener('start', () => {
    if (systems !== heliSystems) return;
    showViewLabel('Moteur démarré : embrayez (CLUTCH, touche T), puis montez le régime');
    r44Sound.play('starter', chaseView ? 0.8 : 0.5);
});

// Avion du joueur, et copie aux textures plus légères pour les avions garés et ceux des autres joueurs (suivi par
// l'écran de chargement ; un échec du réseau se réessaie)
function setupAircraft() {
    if (aircraftModel) return Promise.resolve();
    return loadAircraft().then(({ model, template, parts }) => {
        aircraftModel = model;
        propeller = parts.propeller;
        controlSurfaces = new ControlSurfaces(parts.pivots);
        gear = parts.gear ? new Gear(parts.gear, AIRCRAFT_SCALE) : null;
        setupPropellerBlur(propeller);
        airframe.add(model);
        cockpit.fitInsideHull(model);                    // rien de la cabine ne traverse les flancs
        const shell = buildCabinShell(model);
        cockpit.addCabinShell(shell);   // garnitures intérieures : l'envers de la carrosserie
        track('avion', 'Cabine (cabin.glb)', () => loadCabinParts(shell)).catch(() => {});   // carénages, aérateurs (Blender)
        cockpit.setWindshieldGlass(model);               // pluie sur la vitre du pare-brise
        setRegistration(model, atc.registration);
        paintAircraft(model, multiplayer.livery);
        cessnaLights.setOccluder(model);
        cessnaLights.setRudder(parts.pivots.rudder);
        singlePassTransparents(aircraft);   // (Cessna et sa cabine, voir singlePassTransparents)
        remotePlayers.setTemplate(template);
        airport.addParkedPlanes(template, WHEEL_HEIGHT, (plane, livery, registration) => {
            setRegistration(plane, registration);
            paintAircraft(plane, livery);
        });
        rebuildObstacles(); // + les avions garés
    });
}
track('avion', 'Cessna 172 (c172p.glb)', setupAircraft).catch(() => {});

// F-15 : modèle et cockpit chargés à la demande (choix au hangar, ou un autre joueur en F-15) : 11 Mo
let jetModel = null, jetLoading = null;
function setupJet() {
    if (jetModel) return Promise.resolve();
    if (!jetLoading) {
        markHeavyLoad(true);   // (F-15 : ~11 Mo de modèles et cockpit, voir LOAD_MARK)
        setTimeout(() => {
            jetLoading?.finally(() => setTimeout(() => markHeavyLoad(false), 3000)).catch(() => {});
        }, 0);
    }
    jetLoading ??= Promise.all([loadF15(), jetCockpit.load()]).then(([{ model }]) => {
        jetModel = model;
        jetFrame.add(model);
        // Armement visible : canon, pylônes, AIM-9 et AGM-65 sous les ailes (aussi sur les F-15 des autres joueurs)
        weapons.setStores(buildF15Stores(model));
        jetLights.setOccluder(model);
        paintF15(model, isF15Livery(multiplayer.livery) ? multiplayer.livery : savedJetLivery());
        remotePlayers.setJetTemplate(cloneF15(model));
        jetSound.unlock().catch(() => {});
        weapons.sounds.preload();   // (son du canon : enregistrement du M61A1, prêt dès la première rafale)
        jetCockpit.setNight(weather?.night ?? 0);
        jetCockpit.setExterior(chaseView);
        // Shaders et textures du F-15 et de son cockpit préparés tout de suite, en arrière-plan (au hangar, ou au menu en
        // multijoueur) : l'écran de chargement n'avait préparé que le Cessna, et la première image en F-15 figeait
        // ~0,7 s, puis ~8 s de petits à-coups (textures du cockpit envoyées à la carte graphique au fil des vues)
        prepareForDisplay(jetFrame).catch(() => {});
        prepareForDisplay(jetCockpit.group).catch(() => {});
    }).catch((error) => {
        jetLoading = null;
        throw error;
    });
    return jetLoading;
}

// R44 : extérieur, cockpit et animations chargés à la demande (choix au hangar, ou un autre joueur en R44) : ~6 Mo
let heliLoading = null;
function setupHeli() {
    if (heliCockpit.ready) return Promise.resolve();
    heliLoading ??= heliCockpit.load().then(() => {
        heliFrame.add(heliCockpit.exterior);
        heliLights.setOccluder(heliCockpit.model);
        paintR44(heliCockpit.model, isR44Livery(multiplayer.livery) ? multiplayer.livery : savedHeliLivery());
        heliCockpit.setRegistration(atc.registration);
        heliCockpit.setExterior(chaseView);
        heliCockpit.setNight(weather?.night ?? 0);
        heliLights.setNight(weather?.night ?? 0);
        remotePlayers.setHeliTemplate(heliCockpit.model, (group) => cloneR44(group));
        r44Sound.unlock().catch(() => {});
        prepareForDisplay(heliFrame).catch(() => {});
        prepareForDisplay(heliCockpit.group).catch(() => {});
    }).catch((error) => {
        heliLoading = null;
        throw error;
    });
    return heliLoading;
}
function savedHeliLivery() {
    try {
        const id = localStorage.getItem('livree-r44');
        return isR44Livery(id) ? id : R44_DEFAULT_LIVERY;
    } catch {
        return R44_DEFAULT_LIVERY;
    }
}

// Chaque image, en R44 : poignée des gaz (touches Y / U), frein rotor (touche B, appareil posé), sons, alarmes
const GRIP_RATE = 0.35;   // part de la course de la poignée par seconde
function updateHeli(delta) {
    const sys = heliSystems, model = heliModel;
    const grip = mixtureKeys.KeyU - mixtureKeys.KeyY;
    if (grip && !choosingSpawn) sys.setGrip(sys.grip + grip * GRIP_RATE * Math.min(delta, 0.1));
    model.rotorBrake = sys.rotorBrake = model.controls.brake > 0.5 && controls.isOnGround();
    const quiet = controls.isCrashed() || choosingSpawn || inMenu;
    const volume = quiet ? 0 : (chaseView ? 1 : 0.7) * spawnFade * spawnFade;
    r44Sound.setCabin(!chaseView);
    const warn = sys.warnings;
    r44Sound.update({
        engineRpm: sys.rpm, running: sys.running, cranking: sys.cranking, rotorRpm: model.rotorRpm,
        load: THREE.MathUtils.clamp(model.rotorThrust / (model.aircraft.mass * 9.81), 0, 1.3) * 0.8,
        // Claquement des pales : descente dans son propre sillage, arrondi (forte traction), anneaux tourbillonnaires
        slap: THREE.MathUtils.clamp(-model.velocity.y / 6, 0, 1) * 0.6 + model.vortexRing * 0.6 + Math.max(0, model.loadFactor - 1.2),
        speed: model.airspeed, horn: warn.lowRpmHorn && !quiet,
    }, volume);
}

// Verrière du F-15 : ouverte (1) ou fermée (0), elle s'ouvre / se ferme en ~5 s (vérin) ; position transmise aux
// autres joueurs. Ouverte seulement au sol, à moins de 40 kt (au-delà, elle se referme)
let jetCanopy = 0, jetCanopyOpen = false;
let jetGearWas = 1, jetSpeedbrakeWas = false;
const CANOPY_TIME = 5;

// Chaque image, en F-15 : poussée des réacteurs et masse (carburant) pour le modèle de vol, animation de l'avion,
// verrière, bruits du train et de l'aérofrein
function updateJet(delta) {
    const model = controls.model;
    model.jetThrust = controls.isCrashed() ? 0 : jetSystems.thrust;
    jetFlight.mass = F15.emptyMass + jetSystems.fuelKg;
    // Verrière : la commande suit l'interrupteur des systèmes (ouverte au parking) ; refermée en roulant vite
    jetCanopyOpen = jetSystems.switches.canopy;
    if (jetCanopyOpen && (!controls.isOnGround() || controls.getSpeed() > 20)) jetSystems.switches.canopy = jetCanopyOpen = false;
    // Hangar, menu, choix du départ, arrivée sur le départ (son qui monte) : verrière, train et aérofrein prennent
    // directement leur position, sans bruit (avant : à l'arrivée au hangar, la verrière s'ouvrait en jouant le vérin)
    // (au hangar, la verrière s'anime quand même, en silence : elle se ferme après le choix du F-15, voir openHangar)
    const quiet = choosingSpawn || inMenu || spawnFade < 1 || controls.isCrashed();
    const canopyBefore = jetCanopy;
    jetCanopy = quiet && !inHangar ? (jetCanopyOpen ? 1 : 0)
        : THREE.MathUtils.clamp(jetCanopy + (jetCanopyOpen ? 1 : -1) * delta / CANOPY_TIME, 0, 1);
    const volume = quiet ? 0 : chaseView ? 0.8 : 0.6;
    if ((canopyBefore === 0 && jetCanopy > 0) || (canopyBefore === 1 && jetCanopy < 1)) jetSound.play('canopy-trans', volume * 0.6);
    if (canopyBefore > 0 && jetCanopy === 0) jetSound.play('canopy-close2', volume);
    // Train : bruit de la manœuvre, puis des trappes ; les phares suivent (sur la jambe avant)
    const gear = model.gearPosition;
    // (bruit de la manœuvre elle-même : boucle de JetSound, voir gearMoving plus bas)
    if ((jetGearWas < 1 && gear === 1) || (jetGearWas > 0 && gear === 0)) {
        jetSound.play('gear-door-close', volume);
        applyLights();
    }
    // Phares éteints dès que la jambe commence à rentrer (avant : seulement une fois rentrée, leurs halos et faisceaux
    // restaient en l'air sous le nez pendant la manœuvre)
    if (jetGearWas === 1 && gear < 1) applyLights();
    jetGearWas = gear;
    if (model.speedbrakeOut !== jetSpeedbrakeWas) {
        jetSpeedbrakeWas = model.speedbrakeOut;
        jetSound.play('air-brakes', volume * 0.7);
    }
    if (quiet) model.speedbrake = model.speedbrakeOut ? 1 : 0;
    if (!jetModel) return;
    const inputs = controls.getInputs();
    // Entrées d'air : commande du calculateur (Mach, incidence, au sol, pression hydraulique : réacteurs tournants),
    // suivie par les vérins (voir inletSchedule)
    const hydraulics = jetSystems.engines.some((e) => e.running && e.n2 > 40);
    moveInlets(jetInlet, inletSchedule({ mach: model.airspeed / 340, alphaDeg: THREE.MathUtils.radToDeg(model.alpha),
        onGround: controls.isOnGround(), hydraulics, airspeed: model.airspeed }), delta);
    animateF15(jetModel, {
        pitch: inputs.pitch, roll: inputs.roll, yaw: inputs.yaw, flaps: controls.getFlaps(), speedbrake: model.speedbrake,
        canopy: jetCanopy, gear, steer: THREE.MathUtils.clamp(inputs.yaw + inputs.roll * 0.5, -1, 1),
        wheelSpeed: controls.getSpeed(), onGround: controls.isOnGround(),
        n2: jetSystems.engines.map((e) => e.n2), ab: jetSystems.engines.map((e) => e.ab), time: clock.elapsedTime,
        inlet: jetInlet.inlet, ramp4: jetInlet.ramp4,
    }, delta);
}
const jetInlet = { inlet: INLET_MAX, ramp4: INLET_MAX };   // position des entrées d'air (degrés), voir inletSchedule

// Train (touche Y, poignée du cockpit) ; aérofrein (touche U, bouton de la manette des gaz)
function toggleGear() {
    const model = controls.model;
    if (!model.setGear(!model.gearDown)) {
        if (model.onGround) showViewLabel('Train : impossible de le rentrer au sol');
        return;
    }
    showViewLabel(model.gearDown ? 'Train : sortie' : 'Train : rentrée');
}
function toggleSpeedbrake() {
    controls.model.speedbrakeOut = !controls.model.speedbrakeOut;
    showViewLabel(controls.model.speedbrakeOut ? 'Aérofrein sorti' : 'Aérofrein rentré');
}

// Commandes du cockpit du F-15 (voir F15Cockpit.js : CONTROLS) et de la tablette
function jetCommand(name, step = 1) {
    const sys = jetSystems;
    if (name === 'jfs') sys.pullJfs();
    else if (name === 'crank') sys.crankEngine(step < 0 ? 0 : 1);
    else if (name === 'crankL') sys.crankEngine(0);
    else if (name === 'crankR') sys.crankEngine(1);
    else if (name === 'gear') toggleGear();
    else if (name === 'speedbrake') toggleSpeedbrake();
    else if (name === 'canopy') {
        if (!sys.switches.canopy && (!controls.isOnGround() || controls.getSpeed() > 20)) {
            showViewLabel('Verrière : seulement au sol, presque arrêté');
            return;
        }
        sys.toggle('canopy');
    } else if (name === 'lights') {
        // Phares (interrupteur à 3 positions) : éteints -> roulage -> atterrissage
        const { land, taxi } = sys.switches;
        Object.assign(sys.switches, !land && !taxi ? { taxi: true, land: false } : taxi && !land ? { taxi: false, land: true } : { taxi: false, land: false });
        sys.toggle('_');   // (prévient les feux)
    } else if (name === 'caution') {
        jetCockpit.acknowledgeCaution();
        f15Warnings.acknowledge();
    } else if (name === 'gearSilence') f15Warnings.silenceGear();
    else if (name === 'vsdRange') {
        // Écran radar : moitié gauche = échelle plus courte, droite = plus longue
        jetCockpit.displays.stepRange(step < 0 ? -1 : 1);
        showViewLabel(`Radar : ${[10, 20, 40, 80, 160][jetCockpit.displays.range]} NM`);
    }
    else if (name === 'strobe') {
        sys.switches.beacon = !sys.switches.strobe;
        sys.toggle('strobe');
    } else sys.toggle(name);
}

// Livrée du F-15 choisie la dernière fois (mémorisée à part de celle du Cessna)
function savedJetLivery() {
    try {
        const id = localStorage.getItem('livree-f15');
        return isF15Livery(id) ? id : F15_DEFAULT_LIVERY;
    } catch {
        return F15_DEFAULT_LIVERY;
    }
}

// Changement d'avion (hangar) : modèle, cabine, systèmes, modèle de vol, sons, caméras, livrée. F-15 : chargé à la
// première demande. L'avion repart du hangar, éteint (voir openHangar)
async function setAircraftType(type) {
    type = type === 'f15' || type === 'r44' ? type : 'c172';
    if (type === 'f15') await setupJet();
    if (type === 'r44') await setupHeli();
    const jet = type === 'f15', heli = type === 'r44', cessna = type === 'c172';
    const changed = type !== aircraftType;
    aircraftType = type;
    try { localStorage.setItem('avion', type); } catch { /* stockage indisponible */ }
    const profile = AIRCRAFT_PROFILES[type];
    airframe.visible = cessna;
    jetFrame.visible = jet;
    heliFrame.visible = heli;
    cessnaCockpit.group.visible = cessna;
    jetCockpit.group.visible = jet;
    heliCockpit.group.visible = heli;
    cockpit = jet ? jetCockpit : heli ? heliCockpit : cessnaCockpit;
    systems = jet ? jetSystems : heli ? heliSystems : cessnaSystems;
    aircraftLights = jet ? jetLights : heli ? heliLights : cessnaLights;
    landingLight = jet ? jetLandingLight : heli ? heliLandingLight : cessnaLandingLight;
    taxiLight = jet ? jetTaxiLight : heli ? heliTaxiLight : cessnaTaxiLight;
    // Le phare de l'avion caché s'éteint (une lumière allumée, même cachée, compte)
    for (const light of [cessnaLandingLight, cessnaTaxiLight, jetLandingLight, jetTaxiLight, heliLandingLight, heliTaxiLight]) light.visible = false;
    // Modèle de vol : hélicoptère (HeliModel) ou avion (FlightModel), qui reprend l'environnement de l'autre
    controls.useModel(heli ? heliModel : planeModel);
    controls.throttleRate = heli ? 0.3 : 1;   // (collectif : levé ou baissé plus doucement que les gaz d'un avion)
    if (heli) controls.parkingBrake = false;  // (patins : pas de frein de parc ; B serre le frein rotor)
    WHEEL_HEIGHT = profile.wheelHeight;
    controls.minAltitude = WHEEL_HEIGHT;
    COCKPIT_POSITION.copy(profile.cockpitPosition);
    CABIN_SCALE = profile.cabinScale;
    COCKPIT_TILT = profile.cockpitTilt;
    CHASE_DISTANCE = profile.chaseDistance;
    CHASE_PITCH = profile.chasePitch;
    CHASE_TARGET.copy(profile.chaseTarget);
    // Modèle de vol de l'avion : caractéristiques de l'avion ; il repart de zéro (volets, trim, train)
    if (!heli) {
        const model = controls.model;
        model.aircraft = jet ? jetFlight : CESSNA_172;
        model.rotateSpeed = model.aircraft.rotateSpeed;
        model.flapLevel = Math.min(model.flapLevel, model.aircraft.flapLevels.length - 1);
        model.gearDown = true;
        model.gearPosition = 1;
        model.speedbrakeOut = false;
        model.speedbrake = 0;
        model.cgOffset = 0;
    }
    jetGearWas = 1;
    // Caméras de la cabine
    CABIN_VIEWS = jet ? F15_VIEWS : heli ? R44_VIEWS : CESSNA_VIEWS;
    VIEW_ORDER = jet ? VIEW_ORDER_F15 : heli ? VIEW_ORDER_R44 : VIEW_ORDER_C172;
    PILOT_EYE.copy(cockpit.eye);
    if (changed) recenterCamera();
    // Contrôleurs, multijoueur, livrée
    atc.aircraftType = profile.atcType;
    multiplayer.aircraft = type;
    refreshLiveryOptions();
    let saved = null;
    try { saved = localStorage.getItem(jet ? 'livree-f15' : heli ? 'livree-r44' : 'livree'); } catch { /* stockage indisponible */ }
    setLivery(saved ?? (jet ? F15_DEFAULT_LIVERY : heli ? R44_DEFAULT_LIVERY : DEFAULT_LIVERY), false);
    updateView();
    applyLights();
    updateAircraftChoice();
    document.dispatchEvent(new CustomEvent('aircraft-change', { detail: type }));
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
    const blur = THREE.MathUtils.clamp((spin - 8) / 20, 0, 1);   // au ralenti (~800 tr/min), déjà un disque flou
    propellerDisc.material.opacity = 0.15 * blur; // à peine visible, comme une vraie hélice lancée
    for (const part of propellerParts) {
        if (part === propellerDisc) continue;
        part.material.opacity = 1 - 0.8 * blur;
        // Pales en rotation : pas d'ombre (d'une image à l'autre, leur ombre sautait sur le capot, le pare-brise et le
        // tableau). Le cône, rond, garde la sienne
        if (part.name !== 'Spinner') part.castShadow = blur < 0.05;
    }
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
    if (inHangar || inMenu) return;   // au hangar et au menu : toujours en vue extérieure
    chaseView = !chaseView;
    updateView();
    updateCamera(0, true);
}

viewButton.addEventListener('click', (event) => {
    toggleView();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target) || event.repeat) return;
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
const CESSNA_VIEWS = {
    1: { label: 'Pilote', yaw: 0, pitch: 0, fov: COCKPIT_FOV },
    2: { label: 'Instruments de vol', eye: [-0.17, -0.02, -0.25], target: [-0.153, -0.23, -0.75], fov: 50, close: true },
    3: { label: 'Magnétos, master et disjoncteurs', eye: [-0.36, -0.12, -0.3], target: [-0.36, -0.43, -0.75], fov: 45, close: true },
    4: { label: 'Interrupteurs et avionique', eye: [-0.25, -0.12, -0.3], target: [-0.25, -0.46, -0.75], fov: 45, close: true },
    5: { label: 'Volets, aération, boîte à gants', eye: [0.2, -0.1, -0.3], target: [0.27, -0.45, -0.75], fov: 50, close: true },
    6: { label: 'Radios (NAV/COM, DME, transpondeur)', eye: [0.0, -0.05, -0.3], target: [0.09, -0.27, -0.75], fov: 45, close: true },
    7: { label: 'Gaz, mixture, éclairage', eye: [-0.05, -0.12, -0.3], target: [0.02, -0.46, -0.75], fov: 45, close: true },
    8: { label: 'Pupitre (trim, robinet)', eye: [-0.1, -0.2, -0.25], target: [0, -0.657, -0.744], fov: 50, close: true },
    9: { label: 'Sélecteur de réservoir', eye: [-0.05, -0.3, -0.3], target: [0, -0.76, -0.64], fov: 50, close: true },
    0: { label: 'Côté gauche', yaw: 1.0, pitch: 0.25, fov: 75 },
};
// F-15 (repère avion, œil du pilote en 0, 1,40, -5,0) : HUD, tableau, consoles gauche (gaz, train) et droite
// (JFS, réacteurs, génératrices), et regard sur le côté
const F15_VIEWS = {
    1: { label: 'Pilote', yaw: 0, pitch: 0, fov: COCKPIT_FOV },
    2: { label: 'HUD', eye: [0, 1.42, -5.2], target: [0, 1.39, -6.5], fov: 40, close: true },
    3: { label: 'Instruments de vol (ADI, HSI, badin, altimètre)', eye: [0, 1.15, -5.35], target: [0, 0.94, -5.71], fov: 50, close: true },
    4: { label: 'Moteurs et carburant', eye: [0.22, 1.12, -5.42], target: [0.27, 0.95, -5.71], fov: 42, close: true },
    5: { label: 'Console gauche (gaz, train, phares)', eye: [-0.25, 1.15, -5.2], target: [-0.38, 0.72, -5.55], fov: 55, close: true },
    6: { label: 'Console droite (JFS, réacteurs, génératrices)', eye: [0.25, 1.12, -5.25], target: [0.35, 0.68, -5.66], fov: 50, close: true },
    7: { label: 'Écrans (radar, contre-mesures)', eye: [0, 1.2, -5.3], target: [0, 1.0, -5.71], fov: 60, close: true },
    0: { label: 'Côté gauche', yaw: 1.2, pitch: 0.15, fov: 75 },
};
// R44 (repère appareil, œil du pilote à droite en 0,25, -0,12, -3,4) : tableau au milieu, entre les deux sièges
const R44_VIEWS = {
    1: { label: 'Pilote', yaw: 0, pitch: 0, fov: COCKPIT_FOV },
    2: { label: 'Instruments (badin, horizon, altimètre, tachymètre)', eye: [0.12, -0.33, -3.75], target: [0, -0.54, -4.22], fov: 45, close: true },
    3: { label: 'Interrupteurs, clé, moteur, carburant', eye: [0.1, -0.45, -3.72], target: [0, -0.69, -4.07], fov: 42, close: true },
    4: { label: 'Radios (audio, NAV/COM, transpondeur)', eye: [0.1, -0.55, -3.62], target: [-0.03, -0.83, -3.96], fov: 45, close: true },
    5: { label: 'Collectif et cyclique', eye: [0.3, -0.25, -3.3], target: [0.0, -0.85, -3.45], fov: 60 },
    6: { label: 'Compas et fil de laine', eye: [0.15, -0.12, -3.6], target: [0, -0.2, -4.3], fov: 50, close: true },
    0: { label: 'Côté gauche', yaw: 1.1, pitch: 0.05, fov: 75 },
};
let CABIN_VIEWS = CESSNA_VIEWS;
const VIEW_ORDER_C172 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0], VIEW_ORDER_F15 = [1, 2, 3, 4, 5, 6, 7, 0], VIEW_ORDER_R44 = [1, 2, 3, 4, 5, 6, 0];
let VIEW_ORDER = VIEW_ORDER_C172;
let cabinView = 1;
let headTarget = null;               // regard en cours de rejointe (glissement doux)
const eyeTarget = PILOT_EYE.clone(); // l'œil glisse vers sa place

function setCabinViewPreset(number) {
    const preset = CABIN_VIEWS[number];
    if (!preset) return;
    if (chaseView) toggleView();
    cabinView = number;
    cockpit.setYokesHiddenByView(Boolean(preset.close));
    // (F-15 : positions données dans le repère avion, ramenées au repère de la cabine : même chose, échelle 1)
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

// Manettes des gaz et de la mixture : clic gauche maintenu, glisser vers le haut pour pousser, vers le bas pour tirer
// (la tête ne tourne pas pendant ce temps)
const LEVERS = new Set(['throttle', 'mixture']);
const LEVER_TRAVEL = 220;   // px de glissement pour toute la course
let leverDrag = null;
let dragDistance = 0;
// Écran tactile : deux doigts écartés ou rapprochés = zoom (comme la molette)
const fingers = new Map();
let pinch = null;
const fingerSpread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
view.addEventListener('pointerdown', (event) => {
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.size === 2) {
        pinch = fingerSpread();
        leverDrag = null;
        dragDistance = Infinity;   // pas de clic sur une commande à la fin du geste
        return;
    }
    drag = { x: event.clientX, y: event.clientY };
    dragDistance = 0;
    const lever = event.button === 0 ? controlAt(event) : null;
    leverDrag = lever && LEVERS.has(lever.id) ? { id: lever.id, y: event.clientY, notch: null } : null;
    view.setPointerCapture(event.pointerId);
    view.focus();
});
view.addEventListener('pointermove', (event) => {
    if (fingers.has(event.pointerId)) fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch !== null && fingers.size >= 2) {
        const spread = fingerSpread();
        if (spread > 0) applyZoom(pinch / spread - 1);
        pinch = spread;
        return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag = { x: event.clientX, y: event.clientY };
    dragDistance += Math.abs(dx) + Math.abs(dy);
    if (leverDrag) {
        moveLever(leverDrag, -(event.clientY - leverDrag.y) / LEVER_TRAVEL);
        leverDrag.y = event.clientY;
        return;
    }
    if (dx || dy) headTarget = null;   // la souris reprend la main sur une vue préréglée
    if (choosingSpawn && !inHangar && !inMenu) {
        const goal = spawnCam.goal;
        if (event.buttons & 2) {
            // Bouton droit : déplace le point visé, dans le plan du sol (vitesse selon la distance)
            const s = goal.distance * 0.0016, cos = Math.cos(goal.yaw), sin = Math.sin(goal.yaw);
            goal.target.x -= (dx * cos + dy * sin) * s;
            goal.target.z -= (-dx * sin + dy * cos) * s;
        } else {
            goal.yaw -= dx * 0.005;
            goal.pitch = THREE.MathUtils.clamp(goal.pitch + dy * 0.004, 0.12, 1.5);
        }
        markSpawnView(null);
        return;
    }
    if (chaseView) {
        orbit.yaw -= dx * ORBIT_SPEED;
        orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * ORBIT_SPEED, -0.35, 1.45);
    } else {
        head.yaw = THREE.MathUtils.clamp(head.yaw - dx * ORBIT_SPEED * 0.7, -2.6, 2.6);
        head.pitch = THREE.MathUtils.clamp(head.pitch - dy * ORBIT_SPEED * 0.7, -1.0, 1.1);
    }
});
for (const type of ['pointerup', 'pointercancel']) view.addEventListener(type, (event) => {
    fingers.delete(event.pointerId);
    if (fingers.size < 2) pinch = null;
    // Un doigt levé après le pincement : l'autre reprend la caméra là où il est (sans saut)
    const rest = fingers.size === 1 ? [...fingers.values()][0] : null;
    drag = rest ? { ...rest } : null;
    leverDrag = null;
});
// Manette glissée de amount (part de la course, + = pousser) ; un petit clic tous les dixièmes de course
function moveLever(lever, amount) {
    if (!amount) return;
    let value;
    if (lever.id === 'throttle') value = controls.throttle = THREE.MathUtils.clamp(controls.throttle + amount, 0, 1);
    else {
        systems.setMixture(systems.mixture + amount);
        value = systems.mixture;
    }
    const notch = Math.round(value * 10);
    if (lever.notch !== null && notch !== lever.notch) sounds.click();
    lever.notch = notch;
}
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
    applyZoom(Math.sign(event.deltaY) * 0.1);
}, { passive: false });
// Zoom : zoom > 0 éloigne (molette vers soi, doigts rapprochés), en part de la distance ou du champ de vision
function applyZoom(zoom) {
    if (choosingSpawn && !inHangar && !inMenu) {
        spawnCam.goal.distance = THREE.MathUtils.clamp(spawnCam.goal.distance * (1 + zoom * 1.5), 40, 1100);
        markSpawnView(null);
        return;
    }
    if (chaseView) {
        orbit.distance = THREE.MathUtils.clamp(orbit.distance * (1 + zoom), 7, 90);
    } else {
        camera.fov = THREE.MathUtils.clamp(camera.fov * (1 + zoom), 30, 85);
        camera.updateProjectionMatrix();
    }
}

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
const chaseForward = new THREE.Vector3(0, 0, -1);   // caméra extérieure : axe de l'avion lissé (repère monde)
let chaseHeading = 0;                                 // … et son cap (rad)
const _headQuaternion = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
let shake = 0;

const crashCamera = { position: new THREE.Vector3(), target: new THREE.Vector3() };

// Choix du départ en cours : pas encore d'avion dans le monde ; la caméra survole lentement l'aérodrome
let choosingSpawn = false;
// Au lancement, avant le choix du départ : l'avion présenté au hangar (voir openHangar)
let inHangar = false;
// Menu principal affiché (voir openMainMenu)
let inMenu = false;
// Caméra du choix du départ : point visé, cap (0 : caméra au sud, regard vers le nord), hauteur angulaire, distance.
// goal : vers où elle glisse (vues préréglées, souris)
const SPAWN_VIEWS = {
    ensemble: { label: 'Vue d\'ensemble', target: [250, 0, 20], yaw: 0.35, pitch: 1.05, distance: 720 },
    rwy36:    { label: 'Piste 36 (sud)', target: [220, 0, 300], yaw: 0.5, pitch: 0.42, distance: 170 },
    rwy18:    { label: 'Piste 18 (nord)', target: [220, 0, -300], yaw: Math.PI - 0.5, pitch: 0.42, distance: 170 },
    parking:  { label: 'Parking et hangars', target: [360, 0, 35], yaw: -Math.PI / 2 - 0.4, pitch: 0.55, distance: 190 },
};
// Vues données dans le repère de l'aérodrome (piste nord-sud) : placées et tournées comme l'aérodrome choisi
const spawnViewState = (view, field = airport.current) => {
    // (porte-avions : ses propres vues, sous les mêmes noms)
    const key = Object.keys(SPAWN_VIEWS).find((name) => SPAWN_VIEWS[name] === view);
    view = field.spawnViews?.[key] ?? view;
    const p = field.toWorld(view.target[0], view.target[2]);
    return { target: new THREE.Vector3(p.x, view.target[1], p.z), yaw: view.yaw + field.rotation, pitch: view.pitch, distance: view.distance };
};
const spawnCam = { ...spawnViewState(SPAWN_VIEWS.ensemble), goal: spawnViewState(SPAWN_VIEWS.ensemble) };
// Vue préréglée choisie (null : caméra déplacée à la souris) ; snap : sans glissement
function setSpawnView(name, snap = false) {
    spawnCam.goal = spawnViewState(SPAWN_VIEWS[name]);
    if (snap) Object.assign(spawnCam, spawnViewState(SPAWN_VIEWS[name]));
    markSpawnView(name);
}
function markSpawnView(name) {
    for (const button of document.querySelectorAll('#depart-vues button')) button.classList.toggle('actif', button.dataset.vue === name);
}

function updateCamera(delta, snap = false) {
    if (inHangar) {
        // Hangar : la caméra tourne lentement autour de l'avion, à hauteur d'homme (cercle de 11 m, dans les murs)
        // (F-15, 19,5 m de long : cercle de 13 m, plus haut, champ plus large)
        const jet = aircraftType === 'f15';
        const angle = 2.2 + clock.elapsedTime * 0.06, radius = jet ? 13 : 11;
        const p = aircraft.position;
        camera.position.set(p.x + Math.cos(angle) * radius, p.y + (jet ? 4.5 : 3), p.z + Math.sin(angle) * radius);
        camera.up.set(0, 1, 0);
        camera.lookAt(p.x, p.y + (jet ? 0.5 : 1), p.z);
        const fov = jet ? 72 : CAM_FOV;
        if (camera.fov !== fov) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
        }
        return;
    }
    if (inMenu) {
        // Menu principal : survol lent autour de l'aérodrome (un tour en ~4 min)
        const a = clock.elapsedTime * 0.026;
        // (porte-avions : autour du navire ; ville : au-dessus des tours)
        const around = airport.main.menuView ?? (city && { radius: 950, height: 300, target: [0, 90, 0] });
        if (around) {
            const c = airport.main.menuView ? airport.main.center : city.center;
            camera.position.set(c.x + Math.cos(a) * around.radius, around.height, c.z + Math.sin(a) * around.radius);
            camera.lookAt(c.x, around.target[1], c.z);
        } else {
            camera.position.set(215 + Math.cos(a) * 520, 140, 20 + Math.sin(a) * 520);
            camera.lookAt(260, 10, 20);
        }
        camera.up.set(0, 1, 0);
        if (camera.fov !== CAM_FOV) {
            camera.fov = CAM_FOV;
            camera.updateProjectionMatrix();
        }
        return;
    }
    if (choosingSpawn && !inHangar) {
        // Choix du départ : caméra libre autour d'un point de l'aérodrome (vues préréglées, souris), glisse vers sa cible
        const k = snap ? 1 : 1 - Math.exp(-4 * delta);
        const c = spawnCam, goal = spawnCam.goal;
        c.target.lerp(goal.target, k);
        c.yaw += (goal.yaw - c.yaw) * k;
        c.pitch += (goal.pitch - c.pitch) * k;
        c.distance += (goal.distance - c.distance) * k;
        camera.position.set(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch))
            .multiplyScalar(c.distance).add(c.target);
        camera.up.set(0, 1, 0);
        camera.lookAt(c.target);
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
        camera.position.copy(cockpit.eye).multiplyScalar(CABIN_SCALE).add(COCKPIT_POSITION).applyMatrix4(aircraft.matrixWorld);
        _headQuaternion.setFromEuler(_euler.set(head.pitch + COCKPIT_TILT, head.yaw, 0));
        camera.quaternion.copy(aircraft.quaternion).multiply(_headQuaternion);
    } else {
        // Caméra de poursuite en orbite autour de l'avion, reste au-dessus du sol. Elle suit exactement la position
        // de l'avion ; seule sa direction autour de lui suit avec un peu de retard (virages, tangage). Lisser la position
        // elle-même la laissait traîner derrière l'avion d'autant plus qu'il allait vite (zoomée à 7 m : ~20 m en vol),
        // puis revenir d'un coup quand il ralentissait ou tournait
        // Stable : elle suit le cap de l'avion (et un peu sa montée), lissés, mais jamais son inclinaison : l'horizon
        // reste droit, l'avion s'incline devant elle. Avant, l'écart caméra-avion tournait avec toute l'orientation de
        // l'avion (roulis compris) : en virage serré ou en boucle, la caméra balançait et se retournait
        _offset.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
        if (snap) chaseForward.copy(_offset);
        else chaseForward.lerp(_offset, 1 - Math.exp(-CHASE_STIFFNESS * 0.6 * delta)).normalize();
        const horizontal = Math.hypot(chaseForward.x, chaseForward.z);
        if (horizontal > 0.2) chaseHeading = Math.atan2(-chaseForward.x, -chaseForward.z);   // (à la verticale : cap gardé)
        const climb = THREE.MathUtils.clamp(Math.atan2(chaseForward.y, horizontal), -1.2, 1.2) * 0.5;
        const pitch = THREE.MathUtils.clamp(orbit.pitch - climb, -0.6, 1.45);
        _offset.set(0, 0, orbit.distance).applyAxisAngle(_xAxis, -pitch).applyAxisAngle(_yAxis, chaseHeading + orbit.yaw);
        camera.position.copy(aircraft.position).add(_offset);
        camera.position.y = Math.max(camera.position.y, terrain.heightAt(camera.position.x, camera.position.z) + 2);
        camera.up.set(0, 1, 0);
        // Point visé : un peu devant l'avion (dans l'axe lissé), l'avion lui-même quand on tourne autour
        _lookAt.copy(chaseForward).multiplyScalar(-CHASE_TARGET.z * Math.max(0, Math.cos(orbit.yaw)) * 0.5)
            .add(aircraft.position);
        _lookAt.y += CHASE_TARGET.y;
        camera.lookAt(_lookAt);
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
    // Le canvas redimensionné est vide : on redessine tout de suite (sinon éclair noir jusqu'à l'image suivante). Pas
    // avant la première compilation des shaders en arrière-plan (voir checkNewShaders), ni pendant
    if (weather && sceneObjects >= 0 && !shaderWarmup) graphics.render();
}
new ResizeObserver(resize).observe(view);
resize();

// Construction de la scène à partir du modèle de données (data/)
// Réglage "Arbres et décor" : n'affiche qu'une partie des exemplaires (ceux de objet.csv d'abord)
function applyDecorDensity() {
    const classic = decorStyle === 'classique';
    for (const group of decorGroups) {
        const count = Math.max(1, Math.round(group.total * decorDensity));
        group.hidden = CLASSIC_ASSETS.has(group.codeType) && !classic;
        for (const mesh of group.meshes) {
            mesh.count = count;
            mesh.visible = !group.hidden;
        }
    }
    scenery.setDensity(decorDensity);
    scenery.setVisible(!classic && !SEA);
    if (!classic && !SEA) buildScenery().then(rebuildObstacles, () => { /* échec : voir l'écran de chargement */ });
    rebuildObstacles();
}

// Forêts et villages (Scenery.js, arbres générés : plusieurs secondes) : suivis par l'écran de chargement, avec leur
// avancement. Seulement s'ils sont affichés (réglage « Décor ») : en style classique, rien n'est construit
let sceneryLoading = null;
function buildScenery() {
    if (!sceneryLoading) {
        sceneryLoading = track('decor', 'Forêts et villages (arbres générés)', () => scenery.build(), { weight: 6 });
        scenery.onProgress = (fraction) => progress(sceneryLoading.item, fraction);
        sceneryLoading.catch(() => {});
    }
    return scenery.build();
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
    if (city) controls.obstacles.push(...city.obstacles);   // (immeubles et tours de la ville)
}

// Données (CSV) puis un modèle OBJ par type d'objet, chacun suivi par l'écran de chargement (nouvel essai possible)
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

        track('decor', `${asset.split('/').pop()}.obj`, () => loader.loadAsync(asset).then((obj) => {
            if (decorGroups.some((group) => group.codeType === type.codeType)) return;   // (déjà là)
            // Position, orientation et taille de chaque exemplaire
            const placement = new THREE.Object3D();
            const matrices = [];
            // Autant d'exemplaires tirés au hasard autour de chaque autre aérodrome (même place relative)
            const random = Math.max(0, nombre - placed.length), total = nombre + random * (airport.list.length - 1);
            for (let i = 0; i < total; i++) {
                const o = placed[i];
                const field = i < nombre ? airport.main : airport.list[1 + Math.floor((i - nombre) / random)];
                const origin = field.toWorld(0, 0);
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
                        x = origin.x + Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                        z = origin.z + Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                    } while (airport.contains(x, z, 30) || terrain.lakeAt(x, z, 10) || city?.contains(x, z, 30));
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
        })).catch(() => {});
    }
}

if (!SEA) track('decor', 'Données du décor (data/*.csv)', buildWorld).catch(() => {});   // (en mer : ni arbres ni maisons)

// Mâts d'éclairage du parking de l'aéroport (construits dans Airport.js)
airport.addFloodlights();
rebuildObstacles();

// Panneau Météo
function setWeather(name) {
    const w = weather = WEATHERS[name];
    weatherName = name;
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
    city?.setNight(w.night);
    cessnaLights.setNight(w.night);
    jetLights.setNight(w.night);
    jetCockpit.setNight(w.night);
    heliLights.setNight(w.night);
    heliCockpit.setNight(w.night);
    applyLights();
    remotePlayers.setNight(w.night);
    // Phare seulement de nuit : une lumière, même éteinte, alourdit le calcul de tous les matériaux
    // Avion en route (moteur en marche) : de nuit, le pilote allume le phare (interrupteur LAND, modifiable en cabine).
    // Avion éteint au parking : on ne touche à rien, c'est au pilote de tout allumer
    if (systems.running) systems.switches.land = w.night >= 0.5;
    systems.dispatchEvent(new Event('change'));
    for (const light of [cessnaLandingLight, jetLandingLight]) light.intensity = LANDING_LIGHT;
    for (const light of [cessnaTaxiLight, jetTaxiLight]) light.intensity = TAXI_LIGHT;

    for (const button of [...meteoButtons.children, ...(document.getElementById('mp-meteo')?.children ?? [])]) {
        button.classList.toggle('actif', button.dataset.meteo === name);
    }
    document.getElementById('météo-actuelle').textContent = w.label;
    // Quantité de nuages réglable seulement en météo Jour
    cloudCover.hidden = name !== 'jour';
    if (name === 'jour') atc.setCloudCover(w.clouds.coverage);
}

// Menus du bandeau (Commandes, Météo) : un clic sur la case déroule son contenu ; clic ailleurs ou Échap : fermé
const menus = [...document.querySelectorAll('.menu')];
// Contenu déroulant de chaque menu, gardé ici : sur iPad, il est affiché dans un panneau (TabletRegistry.js), hors du menu
const menuContent = new Map(menus.map((menu) => [menu, menu.querySelector('.menu-contenu')]));
function closeMenus(except = null) {
    for (const menu of menus) {
        if (menu === except) continue;
        menu.querySelector('.menu-titre').setAttribute('aria-expanded', 'false');
        const content = menuContent.get(menu);
        if (menu.contains(content)) content.hidden = true;   // (affiché dans un panneau de l'iPad : il y reste)
    }
}
for (const menu of menus) {
    const title = menu.querySelector('.menu-titre');
    title.addEventListener('click', () => {
        const open = title.getAttribute('aria-expanded') !== 'true';
        closeMenus(menu);
        title.setAttribute('aria-expanded', String(open));
        menuContent.get(menu).hidden = !open;
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

// Plein écran selon l'appareil :
// - ordinateur : plein écran du navigateur, au premier clic et touche F (pas de bouton) ;
// - tablette Android : plein écran du navigateur, au premier toucher et bouton ⛶ ;
// - iPad, dans le navigateur : pas de plein écran du navigateur. Celui de Safari se quitte d'un simple balayage vers le
//   bas et bloque le clavier (« Il semble que vous saisissiez du texte en plein écran »), deux protections d'iPadOS
//   qu'une page ne peut pas désactiver ; Chrome, Brave… ne l'ont pas du tout. Le vrai plein écran : le simulateur ouvert
//   depuis son icône sur l'écran d'accueil (appli web, voir manifest.webmanifest). Le bouton ⛶ ouvre le guide pour
//   l'installer (#plein-ecran-dialog), affiché aussi tout seul au premier lancement ;
// - iPad, depuis l'écran d'accueil : déjà en plein écran, pas de bouton.
const fullscreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
function requestFullscreen() {
    const request = simulatorElement.requestFullscreen ?? simulatorElement.webkitRequestFullscreen;
    return Promise.resolve(request?.call(simulatorElement)).catch(() => { /* refusé par le navigateur : on reste en fenêtre */ });
}
const exitFullscreen = () => (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
const fullscreenApi = Boolean(simulatorElement.requestFullscreen || simulatorElement.webkitRequestFullscreen);
const iosBrowser = isIOS() && !isStandalone();   // iPad dans le navigateur : guide d'installation
const fullscreenGuide = document.getElementById('plein-ecran-dialog');
const guideOptOut = document.getElementById('pe-ne-plus');
function openFullscreenGuide() {
    if (fullscreenGuide.open) return;
    try { guideOptOut.checked = localStorage.getItem('guide-plein-ecran') === '0'; } catch { /* stockage indisponible */ }
    fullscreenGuide.showModal();
}
document.getElementById('pe-fermer').addEventListener('click', () => fullscreenGuide.close());
fullscreenGuide.addEventListener('click', (event) => { if (event.target === fullscreenGuide) fullscreenGuide.close(); });   // toucher à côté
guideOptOut.addEventListener('change', () => {
    try { localStorage.setItem('guide-plein-ecran', guideOptOut.checked ? '0' : '1'); } catch { /* stockage indisponible */ }
});
// Premier affichage du menu sur iPad (navigateur) : le guide s'ouvre seul, une fois par visite, sauf « Ne plus afficher »
let guideShown = false;
function showFullscreenGuideOnce() {
    if (!iosBrowser || guideShown) return;
    guideShown = true;
    try { if (localStorage.getItem('guide-plein-ecran') === '0') return; } catch { /* stockage indisponible */ }
    openFullscreenGuide();
}
function toggleFullscreen() {
    if (isIOS()) {
        if (fullscreenElement()) exitFullscreen();
        else if (iosBrowser) openFullscreenGuide();
        return;
    }
    if (!fullscreenApi) return;
    if (fullscreenElement()) exitFullscreen();
    else requestFullscreen();
}
const fullscreenButtons = [...document.querySelectorAll('[data-plein-ecran]')];
// Boutons ⛶ : sur tablette seulement (Android : plein écran ; iPad dans le navigateur : guide). Sur iPad, le libellé
// annonce le guide
const showButtons = isTablet() && (isIOS() ? iosBrowser : fullscreenApi);
for (const button of fullscreenButtons) button.hidden = !showButtons;
document.getElementById('mp-astuce-ipad').hidden = !iosBrowser;
// iPhone : même marche à suivre, mais le bouton Partager de Safari est dans sa barre du bas (en haut en paysage)
if (isPhone()) {
    for (const span of document.querySelectorAll('[data-appareil]')) span.textContent = 'iPhone';
    for (const span of document.querySelectorAll('[data-partager]')) span.textContent = "dans la barre de Safari, en bas ou en haut selon le sens de l'écran";
}
// Un bouton par écran : ⛶ de la barre de menus (en vol) et celui du menu principal (au lancement)
for (const button of fullscreenButtons) {
    button.addEventListener('click', (event) => {
        toggleFullscreen();
        event.currentTarget.blur(); // garde le clavier pour le pilotage
    });
}
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyF' && !event.repeat && !isTypingTarget(event.target)) toggleFullscreen();
});
// En arrivant sur le simulateur : plein écran dès le premier clic ou la première touche (le navigateur refuse le plein
// écran sans geste du joueur). Une seule fois : quitté ensuite, il n'est plus imposé
function enterFullscreenOnce(event) {
    // Fenêtre ouverte (Multijoueur…) : pas maintenant. Le plein écran passait par-dessus elle et la cachait : en
    // arrivant par un lien d'invitation, la fenêtre « Rejoindre » disparaissait au premier clic
    if (document.querySelector('dialog[open]')) return;
    window.removeEventListener('pointerdown', enterFullscreenOnce, true);
    window.removeEventListener('keydown', enterFullscreenOnce, true);
    if (isIOS()) return;   // iPad : pas de plein écran du navigateur (voir plus haut)
    if (fullscreenElement() || event.code === 'KeyF' || event.key === 'Escape') return;   // F : géré par la touche
    if (event.target instanceof Element && event.target.closest('[data-plein-ecran]')) return;   // le bouton s'en charge
    requestFullscreen();
}
window.addEventListener('pointerdown', enterFullscreenOnce, true);
window.addEventListener('keydown', enterFullscreenOnce, true);
// iPad : Safari interdit toute saisie au clavier en plein écran (protection contre les faux claviers) et affiche alors
// « Il semble que vous saisissiez du texte en plein écran ». Une case de texte touchée (transpondeur, immatriculation,
// pseudo…) fait donc d'abord quitter le plein écran : le clavier s'ouvre normalement, le bouton ⛶ le remet ensuite
document.addEventListener('focusin', (event) => {
    const field = event.target;
    const typing = field instanceof HTMLTextAreaElement
        || (field instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'color', 'file'].includes(field.type));
    if (typing && isIOS() && fullscreenElement()) exitFullscreen();
});
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
function onFullscreenChange() {
    const label = fullscreenElement() ? 'Quitter le plein écran' : 'Plein écran';
    for (const button of fullscreenButtons) (button.querySelector('.libelle') ?? button).textContent = label;
    // Fenêtres ouvertes (Multijoueur, Paramètres, Masse et centrage…) : le plein écran se termine après le clic qui les
    // a ouvertes et passe par-dessus elles. Cachées dessous mais toujours « modales », elles bloquaient tous les clics :
    // plus rien n'était cliquable. Rouvertes par-dessus (leur fermeture éclair est invisible pour le reste du jeu :
    // l'événement « close » est arrêté, sinon fermer la fenêtre Multijoueur lançait la partie)
    if (!fullscreenElement()) return;
    for (const dialog of document.querySelectorAll('dialog[open]')) {
        if (!dialog.matches(':modal')) continue;
        dialog.addEventListener('close', (event) => event.stopImmediatePropagation(), { capture: true, once: true });
        dialog.close();
        dialog.showModal();
    }
}

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

// Alarme de décrochage : bandeau à l'écran + alarme sonore Airbus ("STALL" + cricket) ; alarme d'inclinaison
// (« BANK ANGLE », puis le pilote : « Bank angle, check! »), voir BankAngleWarning.js
const alarme = document.getElementById('alarme');
const bankAlarm = document.getElementById('alarme-inclinaison');
const terrainAlarm = document.getElementById('alarme-terrain');   // « SINK RATE » / « PULL UP », voir TerrainWarning.js

// Le navigateur n'autorise le son qu'après une action du joueur
// À chaque geste, pas seulement au premier : sur iPad, seul un toucher relâché ou un clic autorise le son, et un son
// dont le chargement a échoué est rechargé (chaque unlock ne fait rien une fois prêt). Un seul contexte audio pour
// tout le simulateur, relancé à chaque geste et au retour sur la page (voir AudioUnlock.js)
function unlockSounds() {
    radio.unlock();
    stallWarning.unlock().catch((error) => console.error(error));
    bankAngleWarning.unlock().catch((error) => console.error(error));
    terrainWarning.unlock().catch((error) => console.error(error));
    if (jetModel) jetSound.unlock().catch((error) => console.error(error));
    engineSound.unlock().catch((error) => console.error(error));
    sounds.unlock().catch((error) => console.error(error));
}
for (const type of ['keydown', 'pointerdown', 'touchend', 'click']) window.addEventListener(type, unlockSounds, true);

const _wingAxis = new THREE.Vector3();
// Alarmes du Cessna (DÉCROCHAGE, BANK ANGLE, EGPWS) : le F-15 a les siennes (F15Warnings.js, voir updateF15Warnings)
function updateStallWarning(delta) {
    const cessna = aircraftType === 'c172';
    alarme.classList.toggle('actif', cessna && controls.isStalled());
    stallWarning.update(cessna && controls.isNearStall());
    const p = aircraft.position;
    const height = (p.y - WHEEL_HEIGHT - terrain.heightAt(p.x, p.z)) / 0.3048;
    // Roulis seulement (jamais le tangage) : voir alarmBank
    const deg = THREE.MathUtils.radToDeg;
    const wingTilt = Math.asin(THREE.MathUtils.clamp(_wingAxis.set(1, 0, 0).applyQuaternion(aircraft.quaternion).y, -1, 1));
    const bank = alarmBank(deg(controls.getRoll()), deg(Math.atan(controls.getPitchRate())), deg(wingTilt));
    // (pas d'alarme d'inclinaison sur le F-15 : un chasseur vire couramment à plus de 45°)
    bankAngleWarning.update(bank, aircraftType === 'c172' && !controls.isOnGround() && !controls.isCrashed() && !choosingSpawn, height);
    bankAlarm.classList.toggle('actif', bankAngleWarning.active);
    // Proximité du sol (EGPWS) : SINK RATE, TERRAIN TERRAIN, PULL UP
    terrainWarning.update(delta, {
        airborne: cessna && !controls.isOnGround() && !controls.isCrashed() && !choosingSpawn,
        position: p, velocity: controls.model.velocity, height,
        ground: (x, z) => terrain.heightAt(x, z), offset: WHEEL_HEIGHT,
    });
    terrainAlarm.classList.toggle('actif', terrainWarning.level !== null);
    terrainAlarm.classList.toggle('pull-up', terrainWarning.level === 'pull');
    terrainAlarm.textContent = terrainWarning.level === 'sink' ? 'SINK RATE' : 'PULL UP';
}

// Sol : crissement des pneus au toucher, secousses, crash
const crashBanner = document.getElementById('crash');
const crashReason = document.getElementById('crash-raison');
let crashTimer = 0;

controls.addEventListener('touchdown', ({ impact }) => {
    carrierTouchdown();
    shake = Math.max(shake, Math.min(0.5, impact * 0.08));
    // Bref "couic" des roues qui se mettent à tourner : extrait court du son de dérapage (7 s en boucle à l'origine),
    // plus long et plus fort si le toucher est dur
    const hard = THREE.MathUtils.clamp(impact / 3, 0, 1);
    if (controls.getSpeed() > 8) sounds.play('screech', { volume: 0.25 + 0.75 * hard, offset: 0.3, duration: 0.25 + 0.35 * hard });
});
let crashCount = 0;   // envoyé aux autres joueurs : chaque nouveau crash fait exploser notre avion chez eux
controls.addEventListener('crash', ({ reason }) => {
    crashCount++;
    crashReason.textContent = `${reason} — retour au point de départ…`;
    crashBanner.classList.add('actif');
    // (abattu en vol : l'explosion a lieu en l'air, là où est l'avion)
    const wreck = aircraft.position.clone().setY(Math.max(terrain.heightAt(aircraft.position.x, aircraft.position.z), aircraft.position.y - WHEEL_HEIGHT));
    // Avion coulé : il reste visible, l'aile au ras de l'eau ; sinon il disparaît dans la boule de feu
    const sinking = sunk;
    sunk = false;
    if (!sinking) {
        crashEffect.start(wreck);
        aircraft.visible = false;
    }
    // Caméra de crash : en retrait derrière le point d'impact, au-dessus du sol
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(aircraft.quaternion).setY(0);
    if (back.lengthSq() < 0.01) back.set(0, 0, 1);
    crashCamera.position.copy(wreck).addScaledVector(back.normalize(), 35);
    crashCamera.position.y = Math.max(wreck.y, terrain.heightAt(crashCamera.position.x, crashCamera.position.z)) + 14;
    crashCamera.target.copy(wreck).setY(wreck.y + 4);
    camera.fov = CAM_FOV;
    camera.updateProjectionMatrix();
    if (!sinking) {
        sounds.play('crash');
        shake = 1.2;
    }
    clearTimeout(crashTimer);
    crashTimer = setTimeout(() => controls.reset(), CRASH_RESET_DELAY);
});

// Brouillard de la météo, épaissi quand l'avion traverse un nuage ("jour blanc"), éclairé par les éclairs
const cloudFogColor = new THREE.Color();
const flashColor = new THREE.Color(0xc8d0ff);
const shadowCenter = new THREE.Vector3();
// Centre des ombres du décor (arbres, maisons) : au sol, sous l'avion (voir Graphics.update)
const decorShadowCenter = new THREE.Vector3();
const pilotEyeWorld = new THREE.Vector3();

const ABOVE_CLOUDS_BLEND = 8;    // m de part et d'autre du dessus de la nappe : ciel bleu, plein soleil, air calme (presque
                                 // immédiat en sortant du nuage, encore noyé dans son brouillard en dessous)
const ABOVE_CLOUDS_SKY = new THREE.Color(0x6f9fd2), ABOVE_CLOUDS_FOG = new THREE.Color(0xc4d4e3);
const ABOVE_CLOUDS_SUN = 2.0, ABOVE_CLOUDS_HEMI = 1.2;   // plein jour au-dessus de la nappe, même par temps d'orage
const _sunColor = new THREE.Color(), _white = new THREE.Color(COLOR_LIGHT);

// Distance de vue (réglage) : 3 km = brume d'origine de chaque météo. Plus loin, la brume des météos dégagées (jour,
// nuageux, nuit : fogFar ≥ 1 km) recule d'autant ; brouillard et tempête restent bouchés
let viewDistance = 3000;
function updateFog() {
    const reach = viewDistance / 3000;
    const fogScale = weather.fogFar >= 1000 ? reach : 1;
    // Turbulence : au-dessus de la couche nuageuse (tempête, ciel couvert), l'air est calme ; fondu sur les 16 m autour
    // du dessus de la nappe (même réglé sans nappe affichée : les nuages restent là pour la physique)
    const aircraftAbove = cloudLayer.heightAboveTop(aircraft.position);
    const aboveLayer = aircraftAbove === null ? 0 : THREE.MathUtils.smoothstep(aircraftAbove, -ABOVE_CLOUDS_BLEND, ABOVE_CLOUDS_BLEND);
    controls.turbulence = weather.turbulence * (1 - aboveLayer);
    const density = Math.max(clouds.densityAt(camera.position), cloudLayer.densityAt(camera.position));
    // Au-dessus de la couche nuageuse : ciel bleu, vue dégagée et plein soleil, dès la sortie du dessus réel de la nappe
    // (bosses et creux compris : avant, l'altitude moyenne du sommet laissait l'avion sous un ciel d'orage, hors du
    // nuage, entre les surfaces)
    const cameraAbove = cloudLayer.mesh.visible ? cloudLayer.heightAboveTop(camera.position) : null;
    const above = cameraAbove === null ? 0 : THREE.MathUtils.smoothstep(cameraAbove, -ABOVE_CLOUDS_BLEND, ABOVE_CLOUDS_BLEND);
    // Éclairs : sous les nuages, tout le ciel s'éclaire ; au-dessus, seule la nappe s'illumine par l'intérieur
    const flash = storm.flash * (1 - above);
    cloudLayer.setFlash(storm.flash, storm.strikeAt.x, storm.strikeAt.z);
    storm.bolt.visible &&= above < 0.5;
    cloudFogColor.set(weather.clouds.light);
    scene.fog.color.set(weather.atmosphere?.fog ?? weather.sky).lerp(ABOVE_CLOUDS_FOG, above)
        .lerp(cloudFogColor, density).lerp(flashColor, flash * 0.6);
    scene.background.set(weather.sky).lerp(ABOVE_CLOUDS_SKY, above).lerp(flashColor, flash * 0.6);
    scene.fog.near = THREE.MathUtils.lerp(THREE.MathUtils.lerp(weather.fogNear * fogScale, 600 * reach, above), 0, density);
    scene.fog.far = THREE.MathUtils.lerp(THREE.MathUtils.lerp(weather.fogFar * fogScale, 2800 * reach, above), 30, density);
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
    multiplayer.watchLobby(true);   // « Parties en cours » : annonces écoutées tant que la fenêtre est ouverte
    renderLobby(null);
    renderTeams();   // (équipes, « Entrer dans la partie » : selon qu'on est au menu ou en vol)
}
multiDialog.addEventListener('close', () => multiplayer.watchLobby(false));

// Parties en cours (salon, voir Multiplayer.watchLobby) : créateur, nombre et pseudos des joueurs. En choisir une
// prépare le champ du code : il faut toujours le taper (demandé au créateur), il n'est jamais affiché
const lobbyBox = document.getElementById('multi-salon');
const lobbyList = document.getElementById('multi-parties');
const lobbyVisible = document.getElementById('multi-visible');
let lobbyChoice = null, lobbyOpenedAt = 0;
function renderLobby(games) {
    if (games === null) lobbyOpenedAt = performance.now();
    games ??= [...multiplayer.lobby.entries()].map(([id, e]) => ({ id, ...e }));
    const inGame = Boolean(multiplayer.code);
    lobbyBox.hidden = inGame;
    lobbyVisible.parentElement.hidden = inGame;
    if (inGame) return;
    if (!games.length) {
        const searching = performance.now() - lobbyOpenedAt < 4000;
        const empty = document.createElement('li');
        empty.className = 'multi-salon-vide';
        empty.textContent = searching ? 'Recherche des parties…' : "Aucune partie en cours pour l'instant : créez-en une !";
        lobbyList.replaceChildren(empty);
        if (searching) setTimeout(() => { if (multiDialog.open && !multiplayer.lobby.size) renderLobby(); }, 4200);
        return;
    }
    games.sort((a, b) => b.players - a.players || a.host.localeCompare(b.host));
    lobbyList.replaceChildren(...games.map((game) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.toggle('choisie', game.id === lobbyChoice);
        const title = document.createElement('strong');
        title.textContent = `Partie de ${game.host}`;
        const detail = document.createElement('small');
        const mode = game.mode === 'wardog'
            ? `Wardog${game.map === 'mer' ? ' Navy' : game.map === 'ville' ? ' en ville' : ''}${game.troll ? ' troll' : ''} · bleus ${game.teams.bleu}/${TEAM_MAX} · rouges ${game.teams.rouge}/${TEAM_MAX}` : `Vol libre${game.map === 'mer' ? ' en mer' : game.map === 'ville' ? ' en ville' : ''}`;
        detail.textContent = `${mode} · ${game.players} joueur${game.players > 1 ? 's' : ''}${game.names.length ? ` · ${game.names.join(', ')}` : ''}`;
        button.append(title, detail);
        button.addEventListener('click', () => {
            lobbyChoice = game.id;
            multiCode.value = '';
            multiCode.focus();
            multiStatut.classList.remove('erreur');
            multiStatut.textContent = `Partie de ${game.host} : tapez son code (demandez-le à ${game.host}), puis « Rejoindre »`;
            renderLobby();
        });
        item.append(button);
        return item;
    }));
}
multiplayer.addEventListener('lobby', ({ detail }) => { if (multiDialog.open) renderLobby(detail); });
// Partie rejointe ou quittée : la liste est cachée en partie, remontrée après
multiplayer.addEventListener('status', () => { if (multiDialog.open) renderLobby(); });
lobbyVisible.addEventListener('change', () => multiplayer.setListed(lobbyVisible.checked));
document.getElementById('multi').addEventListener('click', openMultiDialog);
document.getElementById('multi').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openMultiDialog();
});

// Pseudo : fenêtre Multijoueur et menu Profil (en vol), les deux champs restent d'accord. Changé en cours de partie, il
// part avec le prochain message d'état (plusieurs fois par seconde) : les autres le voient aussitôt sur l'étiquette de
// notre avion, dans la liste des joueurs et le salon
const profilePseudo = document.getElementById('profil-pseudo');
try { multiPseudo.value = profilePseudo.value = localStorage.getItem('pseudo') ?? ''; } catch { /* stockage indisponible */ }
function pseudo() {
    const name = multiPseudo.value.replace(/\s+/g, ' ').trim().slice(0, 20) || 'Pilote';
    try { localStorage.setItem('pseudo', name); } catch { /* stockage indisponible */ }
    return name;
}
function renamePilot(source) {
    multiPseudo.value = profilePseudo.value = source.value.replace(/\s+/g, ' ').trim().slice(0, 20);
    const name = pseudo();
    if (name === multiplayer.name) return;
    multiplayer.name = name;
    if (multiplayer.code) {
        multiplayer.dispatchEvent(new CustomEvent('players', { detail: [...multiplayer.players.keys()] }));   // listes refaites
        chat.add(null, `Vous vous appelez maintenant ${name}`);
    }
}
for (const field of [multiPseudo, profilePseudo]) {
    field.addEventListener('change', () => renamePilot(field));
    field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            renamePilot(field);
            field.blur();   // (rend le clavier au pilotage)
        }
    });
}

// Mode de la partie à créer : Vol libre (classique) ou Wardog (deux équipes, capture des terrains)
let createMode = 'libre';
const modeHelp = document.getElementById('multi-mode-aide');
const MODE_HELP = {
    libre: 'Vol libre à plusieurs : chacun vole où il veut, combat possible en F-15.',
    wardog: `Wardog : équipe bleue (départ ESME) contre équipe rouge (départ AIX), ${TEAM_MAX} pilotes au plus par `
        + 'équipe. Capturez le terrain adverse : restez dans sa zone (2 km, sous 300 m) sans ennemi pendant 30 s.',
    navy: `Wardog Navy : en mer, chaque équipe part de son porte-avions, ${TEAM_MAX} pilotes au plus par équipe. Capturez le `
        + 'porte-avions adverse : restez dans sa zone (2 km, sous 300 m) sans ennemi pendant 30 s.',
    'wardog-troll': 'Wardog troll : comme Wardog, mais chaque fois que vous êtes abattu… What is love ?',
};
// Wardog troll : carte masquée, révélée (ou remasquée) par le ruban « Démasquer » sous les modes de jeu
const trollReveal = document.getElementById('troll-reveal');
trollReveal.addEventListener('click', () => {
    const card = document.querySelector('#multi-modes button[data-mode="wardog-troll"]');
    card.hidden = !card.hidden;
    trollReveal.textContent = card.hidden ? '🎭 Démasquer' : '🎭 Masquer';
    trollReveal.setAttribute('aria-expanded', String(!card.hidden));
    if (card.hidden && createMode === 'wardog-troll') document.querySelector('#multi-modes button[data-mode="wardog"]').click();
});
for (const button of document.querySelectorAll('#multi-modes button')) {
    button.addEventListener('click', () => {
        createMode = button.dataset.mode;
        for (const other of document.querySelectorAll('#multi-modes button')) {
            other.classList.toggle('actif', other === button);
            other.setAttribute('aria-checked', String(other === button));
        }
        updateCreateChoice();
    });
}
// Carte de la partie à créer, et règles des porte-avions (en mer) ; Wardog en mer : « Wardog Navy »
let createMap = MAP, createRules = soloCarrierRules;
function updateCreateChoice() {
    for (const button of document.querySelectorAll('#multi-cartes button')) {
        button.classList.toggle('actif', button.dataset.carte === createMap);
        button.setAttribute('aria-checked', String(button.dataset.carte === createMap));
    }
    for (const button of document.querySelectorAll('#multi-pa button')) {
        button.classList.toggle('actif', button.dataset.regles === createRules);
        button.setAttribute('aria-checked', String(button.dataset.regles === createRules));
    }
    document.getElementById('multi-pa').hidden = createMap !== 'mer' || Boolean(multiplayer.code);
    const navy = createMap === 'mer';
    document.querySelector('#multi-modes button[data-mode="wardog"] strong').textContent = navy ? 'Wardog Navy' : 'Wardog';
    document.querySelector('#multi-modes button[data-mode="wardog"] small').textContent = navy
        ? 'Bleus contre rouges : capturez le porte-avions adverse' : 'Bleus contre rouges : capturez le terrain adverse';
    modeHelp.textContent = createMode === 'wardog' && navy ? MODE_HELP.navy : MODE_HELP[createMode];
    if (createMode === 'wardog-troll' && navy) modeHelp.textContent += ' (en mer, depuis les porte-avions)';
}
for (const button of document.querySelectorAll('#multi-cartes button')) {
    button.addEventListener('click', () => { createMap = button.dataset.carte; updateCreateChoice(); });
}
for (const button of document.querySelectorAll('#multi-pa button')) {
    button.addEventListener('click', () => { createRules = button.dataset.regles; updateCreateChoice(); });
}
updateCreateChoice();
document.getElementById('multi-creer').addEventListener('click', () => {
    const mode = createMode === 'wardog-troll' ? 'wardog' : createMode, troll = createMode === 'wardog-troll';
    // Autre carte que celle chargée : la page se recharge sur la bonne carte, puis crée la partie (voir resumeAfterUpdate)
    if (createMap !== MAP) {
        try {
            sessionStorage.setItem('esme-mise-a-jour', JSON.stringify({ creer: { mode, troll, regles: createRules, listee: lobbyVisible.checked }, le: Date.now() }));
            localStorage.setItem('carte', createMap);
        } catch { /* stockage indisponible */ }
        multiStatut.classList.remove('erreur');
        multiStatut.textContent = `Chargement de la carte ${MAP_LABELS[createMap]}…`;
        location.replace(location.pathname);
        return;
    }
    multiplayer.carrierRules = createRules;
    multiplayer.setListed(lobbyVisible.checked);
    multiplayer.create(pseudo(), mode, troll);
    renderTeams();
});

// Wardog : choix de l'équipe, avec les places restantes ; une équipe complète ne peut pas être choisie
const teamsBox = document.getElementById('multi-equipes');
const TEAM_LABELS = { bleu: 'Équipe bleue', rouge: 'Équipe rouge' };
const enterButton = document.getElementById('multi-entrer');
let teamChosenEarly = false;   // équipe choisie avant la confirmation de la partie : on y entre à la confirmation
multiplayer.addEventListener('status', () => { if (!multiplayer.code) teamChosenEarly = false; });
function renderTeams() {
    const wardog = Boolean(multiplayer.code) && multiplayer.mode === 'wardog';
    if (!wardog) setTeamStep(false);
    document.getElementById('multi-modes').hidden = modeHelp.hidden = document.getElementById('multi-modes-titre').hidden
        = trollReveal.hidden = document.getElementById('multi-cartes').hidden = document.getElementById('multi-cartes-titre').hidden
        = Boolean(multiplayer.code);
    document.getElementById('multi-pa').hidden = createMap !== 'mer' || Boolean(multiplayer.code);
    // « Rejoindre la partie » : depuis le menu, une fois la partie créée ou rejointe (Wardog : mène au choix de l'équipe) ;
    // en vol, en Wardog : « Changer d'équipe ». Seulement une fois la partie confirmée : avant, pendant les quelques secondes
    // de connexion, le mode n'était pas encore connu et le bouton menait au choix de l'aérodrome comme en vol libre (puis
    // le choix de l'équipe s'ouvrait par-dessus en apprenant que c'était du Wardog)
    enterButton.hidden = !(multiplayer.joined && (inMenu || wardog));
    enterButton.textContent = inMenu ? 'Rejoindre la partie →' : 'Changer d’équipe →';
    updateAircraftChoice();
    if (!wardog) return;
    for (const team of ['bleu', 'rouge']) {
        const button = document.getElementById(`equipe-${team}`);
        const room = multiplayer.teamRoom(team);
        const mine = multiplayer.team === team;
        button.textContent = mine ? `${TEAM_LABELS[team]} ✓ (votre équipe)` : `${TEAM_LABELS[team]} · ${room > 0 ? `${room} place${room > 1 ? 's' : ''}` : 'complète'}`;
        button.disabled = !mine && room <= 0;
        button.classList.toggle('actif', mine);
    }
}
for (const team of ['bleu', 'rouge']) {
    document.getElementById(`equipe-${team}`).addEventListener('click', () => {
        // En vol, sa propre équipe : rien ne change, la fenêtre se ferme (avant : retour au hangar, avion perdu en plein vol)
        if (!inMenu && multiplayer.team === team && !teamChosenEarly) {
            multiDialog.close();
            return;
        }
        if (!multiplayer.setTeam(team)) {
            multiStatut.textContent = `${TEAM_LABELS[team]} complète (${TEAM_MAX} pilotes au plus)`;
            multiStatut.classList.add('erreur');
            renderTeams();
            return;
        }
        multiStatut.classList.remove('erreur');
        renderTeams();
        // Partie rejointe avec le code : le mode (Wardog) est connu ~1 s avant que la partie soit confirmée. Une équipe
        // choisie pendant ce temps est gardée, et l'on entre dès la confirmation (voir l'événement 'joined'). Avant, le
        // clic ne faisait rien d'autre que cocher l'équipe : on restait bloqué sur le choix de l'équipe
        if (!multiplayer.joined) {
            teamChosenEarly = true;
            multiStatut.textContent = `${TEAM_LABELS[team]} choisie : connexion à la partie…`;
            return;
        }
        multiStatut.textContent = `Vous êtes dans l'${TEAM_LABELS[team].toLowerCase()}`;
        // Équipe choisie (créateur compris) : on entre dans la partie, directement au hangar du terrain de l'équipe (pas
        // de choix de l'aérodrome : chaque équipe a le sien). En cours de partie, de même au hangar de la nouvelle équipe
        // (avant : l'avion restait là où il était, souvent sur la base adverse)
        enterMultiplayerGame();
    });
}
// Entrer dans la partie créée ou rejointe : fenêtre fermée, puis Wardog -> hangar du terrain de l'équipe (F-15) ;
// vol libre -> choix de l'aérodrome. En vol (fenêtre rouverte) : Wardog -> hangar de l'équipe, sinon rien
function enterMultiplayerGame() {
    if (!multiplayer.joined) return;   // (connexion en cours : mode de la partie pas encore connu)
    const team = wardog();
    if (team && !multiplayer.team) return;   // (l'équipe d'abord)
    if (multiDialog.open) multiDialog.close();
    if (inMenu) {
        closeMainMenu();
        enterGame(team ? openTeamHangar : openAirportChoice);
    } else if (team) openTeamHangar();
}
// Wardog : étape du choix de l'équipe (le reste de la fenêtre est masqué, voir style.css : etape-equipe)
// Derrière, seulement l'aérodrome d'ESME en direct (survol du menu) : textes et cases du menu principal masqués
function setTeamStep(on) {
    multiDialog.classList.toggle('etape-equipe', on);
    document.getElementById('menu-principal').classList.toggle('vue-seule', on);
}
function showTeamStep() {
    setTeamStep(true);
    if (!multiDialog.open) openMultiDialog();
    renderTeams();
}
enterButton.addEventListener('click', () => (wardog() ? showTeamStep() : enterMultiplayerGame()));
document.getElementById('equipe-retour').addEventListener('click', () => setTeamStep(false));
multiDialog.addEventListener('close', () => setTeamStep(false));
// Wardog : hangar du terrain de l'équipe (le sien au départ, d'ailleurs l'un de ceux qu'elle tient), en F-15 : le Cessna
// n'est pas fait pour le combat
async function openTeamHangar() {
    leaveFlightScreens();
    leaveHangar();
    airportPanel.hidden = true;
    const allowed = allowedFields();
    const home = airport.list[HOME_TEAMS.indexOf(multiplayer.team)];
    selectAirport(allowed.includes(home) ? home : allowed[0]);
    if (aircraftType !== 'f15') {
        try {
            await setAircraftType('f15');
        } catch (error) {
            console.error(error);
            showRadioMessage('F-15 : chargement impossible (vérifiez la connexion), réessayez');
        }
    }
    openHangar();
}
for (const type of ['players', 'mode', 'team', 'status']) multiplayer.addEventListener(type, () => renderTeams());
// Fenêtre fermée en vol, en Wardog, sans équipe (partie révélée Wardog après coup) : l'équipe qui a le moins de pilotes.
// Au menu, on peut la refermer sans choisir : on n'entre dans la partie qu'une fois l'équipe choisie
multiDialog.addEventListener('close', () => {
    if (!inMenu && multiplayer.code && multiplayer.mode === 'wardog' && !multiplayer.team) {
        const counts = multiplayer.teamCounts();
        multiplayer.setTeam(counts.bleu <= counts.rouge ? 'bleu' : 'rouge');
    }
});
// Le mode n'est connu qu'en recevant l'état du créateur : la partie rejointe se révèle Wardog -> choix de l'équipe
multiplayer.addEventListener('mode', ({ detail }) => {
    if (detail.mode === 'wardog' && !multiplayer.team && resumeState?.equipe && resumeState.partie === multiplayer.code) {
        // (retour après une mise à jour ou un changement de carte : même équipe, si elle a encore de la place ; on y
        // entre dès la confirmation de la partie)
        if (multiplayer.setTeam(resumeState.equipe) && !multiplayer.joined) teamChosenEarly = true;
    }
    if (detail.mode === 'wardog' && !multiplayer.team) {
        multiStatut.classList.remove('erreur');
        multiStatut.textContent = 'Partie Wardog : choisissez votre équipe';
        if (!multiplayer.isHost) showTeamStep();   // (partie rejointe : directement au choix de l'équipe)
    }
});
// Partie rejointe sur une autre carte que la nôtre : la page se recharge sur la carte de la partie, puis y revient
// toute seule (voir resumeAfterUpdate)
multiplayer.addEventListener('map', ({ detail }) => {
    try {
        localStorage.setItem('carte', detail.map);
        sessionStorage.setItem('esme-mise-a-jour', JSON.stringify({ partie: detail.code, hote: false, score: multiplayer.score,
            equipe: multiplayer.team ?? undefined, le: Date.now() }));
    } catch {
        multiStatut.textContent = `Cette partie se joue sur la carte ${MAP_LABELS[detail.map]} : choisissez-la au menu principal`;
        return;
    }
    multiStatut.classList.remove('erreur');
    multiStatut.textContent = `Partie sur la carte ${MAP_LABELS[detail.map]} : chargement…`;
    location.replace(location.pathname);
});
// Rejoindre : le code tapé. Celui de la partie où l'on est déjà (créée dans cette fenêtre) : on y reste. Avant,
// « Rejoindre » quittait d'abord la partie (seul dedans, elle disparaissait), puis la cherchait : « Aucune partie avec le
// code… » alors que le code était bon
function joinTyped() {
    const code = multiCode.value.trim().toUpperCase();
    if (!code) return;
    if (code === multiplayer.code) {
        multiStatut.textContent = `Vous êtes déjà dans la partie ${code} : les autres joueurs tapent ce code sur leur appareil (ou ouvrent le lien)`;
        multiStatut.classList.remove('erreur');
        return;
    }
    multiplayer.join(code, pseudo());
}
document.getElementById('multi-rejoindre').addEventListener('click', joinTyped);
multiCode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinTyped();
});
document.getElementById('multi-quitter').addEventListener('click', () => multiplayer.leave());
document.getElementById('multi-fermer').addEventListener('click', () => multiDialog.close());
// Partie rejointe (code tapé ou lien d'invitation) : la fenêtre se ferme toute seule ; depuis le menu principal, on
// passe directement au choix de l'aérodrome (voir l'événement close). Le créateur garde la fenêtre (code à partager)
// Entrée dans une partie (en général au menu) : ce qui figeait le jeu en vol est préparé tout de suite
// - projecteurs des autres avions ajoutés à la scène (toute nouvelle lumière fait recompiler tous les shaders) ;
// - F-15 chargé d'avance (sauf tablettes, mémoire limitée) : sinon, en Cessna, il se chargeait (11 Mo, préparation du
//   modèle) en plein vol, quand un autre joueur prenait un F-15
multiplayer.addEventListener('status', () => {
    if (!multiplayer.code) return;
    if (remotePlayers.ensureSpots() && sceneObjects >= 0) compileScene().catch(() => {});
    if (!isTablet()) setupJet().catch(() => {});
});
multiplayer.addEventListener('joined', ({ detail }) => {
    const early = teamChosenEarly;
    teamChosenEarly = false;
    if (detail.host) return;
    // Wardog, équipe déjà choisie pendant la connexion : on entre tout de suite (hangar du terrain de l'équipe)
    if (multiplayer.mode === 'wardog' && multiplayer.team && early) {
        multiStatut.textContent = `Partie ${detail.code} rejointe : ${TEAM_LABELS[multiplayer.team].toLowerCase()}`;
        enterMultiplayerGame();
        return;
    }
    if (!multiDialog.open) return;
    // Wardog : la fenêtre reste ouverte pour choisir son équipe (elle se ferme une fois l'équipe choisie). Avant, elle se
    // fermait au bout de 1,2 s et l'équipe était tirée d'office
    if (multiplayer.mode === 'wardog' && !multiplayer.team) {
        multiStatut.classList.remove('erreur');
        multiStatut.textContent = `Partie ${detail.code} rejointe (Wardog) : choisissez votre équipe`;
        showTeamStep();
        return;
    }
    // (vol libre : on entre tout de suite, au choix de l'aérodrome)
    setTimeout(() => { if (multiDialog.open && multiplayer.code === detail.code && inMenu) enterMultiplayerGame(); }, 1200);
});

// Retour dans la partie après un rechargement pour mise à jour (voir installUpdate) : rejointe d'office, sans
// clic. Le créateur la recrée avec le même code et le même mode (les autres ne voient qu'une courte absence) ; en
// Wardog, l'équipe d'avant est reprise et l'on arrive directement à son hangar ; le score d'avant est gardé
let resumeState = null;
try {
    resumeState = JSON.parse(sessionStorage.getItem('esme-mise-a-jour') ?? 'null');
    sessionStorage.removeItem('esme-mise-a-jour');
} catch { /* stockage indisponible */ }
if (resumeState && !(Date.now() - resumeState.le < 5 * 60000)) resumeState = null;   // (vieux de plus de 5 min : ignoré)
function resumeAfterUpdate() {
    const saved = resumeState;
    // Carte changée au choix du départ (vol libre en solo) : retour au choix du départ, sur la nouvelle carte
    // (une fois tout le script exécuté : appelé pendant le chargement, enterGame utilisait des variables déclarées plus
    // loin (worldWarm) et plantait, la page restait au menu sur la nouvelle carte)
    if (saved?.volLibre) {
        resumeState = null;
        setTimeout(() => {
            closeMainMenu();
            enterGame(openAirportChoice);
        });
        return;
    }
    if (saved?.creer) {
        resumeState = null;
        const c = saved.creer;
        openMultiDialog();
        multiplayer.carrierRules = createRules = c.regles === 'realiste' ? 'realiste' : 'arcade';
        multiplayer.setListed(c.listee !== false);
        multiplayer.create(pseudo(), c.mode, c.troll);
        renderTeams();
        updateCreateChoice();
        return;
    }
    if (!saved?.partie || new URLSearchParams(location.search).get('partie')) return;
    multiplayer.addEventListener('joined', ({ detail }) => {
        if (detail.code !== saved.partie) return;
        resumeState = null;   // (équipe reprise une seule fois : plus tard, on la choisit comme d'habitude)
        multiplayer.score = { kills: saved.score?.kills | 0, deaths: saved.score?.deaths | 0 };
        // (créateur : la fenêtre ne se ferme pas d'elle-même, voir l'événement 'joined' plus haut)
        if (detail.host) {
            if (multiplayer.mode === 'wardog' && saved.equipe) multiplayer.setTeam(saved.equipe);
            enterMultiplayerGame();
        }
    }, { once: true });
    openMultiDialog();
    multiStatut.classList.remove('erreur');
    multiStatut.textContent = `Mise à jour installée : retour dans la partie ${saved.partie}…`;
    if (saved.hote) {
        multiplayer.setListed(saved.listee !== false);
        multiplayer.create(pseudo(), saved.mode, saved.troll, saved.partie);
    } else multiplayer.join(saved.partie, pseudo());
}

const multiPartage = document.getElementById('multi-partage');
const multiCodePartie = document.getElementById('multi-code-partie');
const multiCodeValeur = document.getElementById('multi-code-valeur');
document.getElementById('multi-copier-code').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
        await navigator.clipboard.writeText(multiplayer.code ?? '');
        button.textContent = 'Code copié ✓';
        setTimeout(() => { button.textContent = 'Copier le code'; }, 2000);
    } catch {
        getSelection().selectAllChildren(multiCodeValeur);   // copie manuelle (Ctrl+C)
    }
});
const multiLien = document.getElementById('multi-lien');

// Vent de la partie : tiré au hasard à chaque vol en solo ; en multijoueur, tiré du code de la partie (le même pour
// tous ses joueurs, voir Wind.setSeed)
function newWind(seed) {
    wind.setSeed(seed);
    atc.resetRunwayInUse();
}
const codeSeed = (code) => [...code].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
let windCode = null;
multiplayer.addEventListener('status', ({ detail }) => {
    if (multiplayer.code !== windCode) {
        windCode = multiplayer.code;
        if (windCode) newWind(codeSeed(windCode));
    }
    if (multiplayer.code && initiation?.active) initiation.stop();
    multiStatut.textContent = detail.text;
    multiStatut.classList.toggle('erreur', detail.error);
    updateMultiResume();
    multiPartage.hidden = !multiplayer.code;
    multiLien.value = multiplayer.link;
    // Code de la partie : en grand (la case CODE sert seulement à rejoindre la partie d'un autre)
    multiCodePartie.hidden = !multiplayer.code;
    multiCodeValeur.textContent = multiplayer.code ?? '';
    closeGameButton.hidden = !(multiplayer.code && multiplayer.isHost);
});
// Créateur de la partie : « Fermer la partie » la termine pour tous (les autres joueurs repassent en solo)
const closeGameButton = document.getElementById('multi-fermer-partie');
closeGameButton.addEventListener('click', () => {
    const others = multiplayer.players.size;
    if (others && !confirm(`Fermer la partie ${multiplayer.code} ? ${others} autre${others > 1 ? 's' : ''} joueur${others > 1 ? 's' : ''} ${others > 1 ? 'seront renvoyés' : 'sera renvoyé'} en solo.`)) return;
    multiplayer.close();
    updateModes();
});
// Partie fermée par son créateur : on continue en solo, avec un message à l'écran
multiplayer.addEventListener('closed', ({ detail }) => {
    updateModes();
    showRadioMessage(`La partie ${detail.code} a été fermée par son créateur : vous volez maintenant en solo`);
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

// Tchat de la partie : messages affichés sur l'écran de vol chez tous les joueurs (voir Chat.js). Entrée pour écrire,
// sauf dans un écran sans pilotage (menu, hangar, choix du départ) ou une fenêtre ouverte
const chat = new Chat({
    multiplayer,
    root: document.getElementById('tchat'),
    canType: (event) => !isTypingTarget(event.target) && !document.querySelector('dialog[open]')
        && !event.target.closest?.('button, a, select, [role=button]')   // Entrée sur un bouton : le bouton seul
        && !inMenu && !inHangar && spawnDialog.hidden && airportPanel.hidden,
    onClose: () => view.focus(),   // le clavier repart au pilotage
});

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
// caption : mot écrit à droite du numéro, dans une pastille allongée (porte-avions : « CATAPULTE »)
function numberSprite(text, caption = '') {
    const canvas = document.createElement('canvas');
    canvas.height = 128;
    canvas.width = caption ? 512 : 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    if (caption) ctx.roundRect(8, 8, canvas.width - 16, 112, 56);
    else ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1a1a1a';
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 72px DejaVu Sans, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 70);
    if (caption) {
        ctx.font = 'bold 50px DejaVu Sans, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(caption, 116, 68, canvas.width - 140);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, toneMapped: false, sizeAttenuation: false }));
    sprite.scale.set(0.055 * canvas.width / 128, 0.055, 1);
    sprite.center.set(0.5, -0.35);   // numéro au-dessus de la case (ne la cache pas)
    sprite.renderOrder = 12;
    return sprite;
}
// Une case par départ de chaque aérodrome ; seules celles de l'aérodrome choisi sont montrées (voir openSpawnDialog)
for (const field of airport.list) field.spawns.forEach((spawn, i) => {
    const size = 24, height = 8;
    const marker = new THREE.Group();
    marker.position.set(spawn.x, terrain.heightAt(spawn.x, spawn.z) + 0.1, spawn.z);   // (porte-avions : sur le pont)
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
    // (catapulte d'un porte-avions : « CATAPULTE » à côté du numéro)
    const label = numberSprite(String(i + 1), /^Catapulte/.test(spawn.name) ? 'CATAPULTE' : '');
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
    if (!choosingSpawn || inHangar) return null;
    const rect = view.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    spawnRaycaster.setFromCamera(ndc, camera);
    const shown = spawnMarkers.children.filter((marker) => marker.visible);   // (cases de l'aérodrome choisi)
    const boxes = shown.map((marker) => marker.children[0]);
    const hit = spawnRaycaster.intersectObjects(boxes, false)[0];
    if (hit) return hit.object.userData.spawn;
    // Au loin, les cases sont petites à l'écran : tolérance autour de leur centre
    let best = null, bestDistance = 40;
    for (const marker of shown) {
        const p = marker.position.clone().project(camera);
        const d = Math.hypot((p.x - ndc.x) * rect.width / 2, (p.y - ndc.y) * rect.height / 2);
        if (d < bestDistance) [best, bestDistance] = [marker.userData.spawn, d];
    }
    return best;
}

// Régime du gyroscope de l'indicateur de virage (0 -> 1) et état de la pompe, pour les bruits (voir updateSounds)
let gyroSpin = 0, lastGyroTime = performance.now(), fuelPumpOn = false, beaconWasOn = false;
let spawnFade = 0;   // montée du son du moteur après un départ (0 -> 1)

// État de l'avion au point de départ : prêt à voler sur la piste, éteint au parking (frein serré, gaz réduits)
function applySpawnState() {
    systems.reset();
    // Toupie déjà lancée sur la piste, arrêtée au parking (pas de ralentissement entendu au départ)
    gyroSpin = currentSpawn.cold ? 0 : 1;
    spawnFade = 0;
    atc.reset(currentSpawn);
    avionics.reset(Boolean(currentSpawn.cold));
    gloveboxOpen = false;
    avionics.com1.active = parseFrequency(airport.aerodrome.frequencies[atc.freq]);
    // Radios réglées sur l'aérodrome de départ : COM 2 sur son Info, NAV 1 et 2 sur son VOR, ILS en attente sur la NAV 1
    avionics.com2.active = parseFrequency(airport.aerodrome.frequencies.info);
    avionics.nav1.active = avionics.nav2.active = parseFrequency(airport.vor.frequency);
    avionics.nav1.standby = parseFrequency(airport.current.ilsFrequency);
    radioSync.freq = atc.freq;
    radioSync.code = avionics.xpdr.code = atc.transponder;
    if (currentSpawn.cold) {
        systems.coldAndDark();
        controls.throttle = 0;
        // (R44 : pas de frein de parc sur des patins ; le frein rotor se serre à la touche B, voir updateHeli)
        controls.parkingBrake = systems.brake = aircraftType !== 'r44';
    } else {
        // Sur la piste, prêt au décollage : pompe électrique, phare d'atterrissage et de roulage, strobes, anticollision
        // et feux de navigation allumés (volets : voir runwayFlaps)
        controls.parkingBrake = systems.brake = false;
        Object.assign(systems.switches, aircraftType === 'f15' ? { land: true, taxi: true, strobe: true, beacon: true, nav: true }
            : aircraftType === 'r44' ? { land: true, strobe: true, beacon: true, nav: true }
            : { fuelPump: true, land: true, taxi: true, strobe: true, beacon: true, nav: true });
    }
    applyLights();
}
// R44 : après chaque remise au départ, le rotor tourne à son régime si le moteur tourne et qu'il est embrayé (prêt à
// décoller), il est arrêté sinon ; collectif en bas
controls.addEventListener('reset', () => {
    if (aircraftType !== 'r44') return;
    if (heliSystems.running && heliSystems.clutch >= 1) heliModel.spinUp();
    else if (heliModel.onGround) heliModel.rotorSpeed = 0;
    if (heliModel.onGround) controls.throttle = 0;
});

// Départ de piste : volets au 1er cran (10°), déjà sortis. Après chaque remise au point de départ (choix du départ,
// touche R, après un crash) : la remise à zéro du modèle rentre les volets
const RUNWAY_FLAP_LEVEL = 1;
function runwayFlaps() {
    if (currentSpawn.cold || !controls.model.onGround) return;
    const model = controls.model, levels = model.aircraft.flapLevels;
    controls.setFlapLevel(RUNWAY_FLAP_LEVEL);
    model.flaps = levels[RUNWAY_FLAP_LEVEL] / levels[levels.length - 1];
}
controls.addEventListener('reset', runwayFlaps);

// Départ : relief proche construit en entier, shaders compilés, cabine affichée : pic de mémoire. Page fermée pendant ces
// secondes (téléphone) : qualité réduite d'un cran à la réouverture (voir LOAD_MARK). Avant, seuls l'écran de chargement
// et le chargement du F-15 étaient couverts
let spawnMarkTimer = 0;
function spawnAt(spawn) {
    markHeavyLoad(true);
    clearTimeout(spawnMarkTimer);
    spawnMarkTimer = setTimeout(() => { if (!jetLoading || jetModel) markHeavyLoad(false); }, 15000);
    watchNewShaders();
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
    for (const marker of spawnMarkers.children) marker.visible = marker.userData.spawn.airport === airport.current;
    renderAirportTabs();
    setSpawnView('ensemble', true);
}
// Onglets des aérodromes, en haut du choix du départ : changer d'aérodrome refait la liste et la vue
const airportTabs = document.getElementById('depart-aerodromes');
function renderAirportTabs() {
    // Vues préréglées : numéros des pistes de l'aérodrome choisi
    const [first, second] = airport.current.runways;
    document.getElementById('depart-carte').hidden = Boolean(multiplayer.code);   // (partie : carte de la partie)
    for (const button of spawnViewButtons.children) {
        if (airport.current.spawnViews) break;   // (porte-avions : ses propres vues, voir labelSpawnViews)
        if (button.dataset.vue === 'rwy36') button.textContent = `Piste ${first.name}`;
        if (button.dataset.vue === 'rwy18') button.textContent = `Piste ${second.name}`;
    }
    airportTabs.replaceChildren(...allowedFields().map((field) => {
        const button = document.createElement('button');
        button.textContent = `${field.label} · ${field.runways.map((rw) => rw.name).join('/')}`;
        button.title = field.description;
        button.classList.toggle('actif', field === airport.current);
        button.addEventListener('click', () => {
            selectAirport(field);
            openSpawnDialog();
            button.blur();
        });
        return button;
    }));
}
// Boutons des vues préréglées (au-dessus de la liste des départs) ; survoler un départ de la liste n'y bouge pas
const spawnViewButtons = document.getElementById('depart-vues');
for (const [name, v] of Object.entries(SPAWN_VIEWS)) {
    const button = document.createElement('button');
    button.textContent = v.label;
    button.dataset.vue = name;
    button.addEventListener('click', () => { setSpawnView(name); button.blur(); });
    spawnViewButtons.append(button);
}
// Noms des vues selon le terrain choisi (porte-avions : catapultes, piste oblique, pont arrière)
function labelSpawnViews() {
    for (const button of spawnViewButtons.children) {
        button.textContent = (airport.current.spawnViews ?? SPAWN_VIEWS)[button.dataset.vue]?.label ?? button.textContent;
    }
}
airport.addEventListener('change', labelSpawnViews);
labelSpawnViews();

function closeSpawnDialog() {
    leaveHangar();
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
    setMenuBar(true);
}

// Barre de menus (Commandes, Météo, Carte, Tour, En ligne, Profil, Paramètres) : affichée en début de partie, Échap la
// cache ou la réaffiche. Pas pendant le menu principal, au hangar, au choix du départ, ni quand une fenêtre est ouverte (Échap
// la ferme) ; un menu déroulé est d'abord refermé (voir closeMenus)
const escapeHint = document.getElementById('astuce-echap');
let escapeHintTimer = 0;
function showEscapeHint() {
    if (simulatorElement.classList.contains('barre')) return;
    escapeHint.classList.remove('cache');
    clearTimeout(escapeHintTimer);
    escapeHintTimer = setTimeout(() => escapeHint.classList.add('cache'), 5000);
}
function setMenuBar(visible) {
    simulatorElement.classList.toggle('barre', visible);
    if (!visible) closeMenus();
    else {
        escapeHint.classList.add('cache');
        fitMenuBar();
    }
}
// Barre du haut : la même que sur ordinateur (mêmes cases, libellés et couleurs). Si elle dépasse la largeur de
// l'écran, texte et marges de toutes les cases sont réduits d'un même facteur jusqu'à ce qu'elle tienne (voir
// style.css). Si le texte devenait trop petit pour être lu (tablette en portrait), la barre passe sur deux lignes
// (rien n'est masqué ni regroupé). Refait au redimensionnement, au changement d'orientation et quand un libellé change
// (fréquence, nombre de joueurs, météo)
const MENU_BAR_READABLE = 0.7;   // en dessous (texte < ~10 px), deux lignes plutôt qu'une
const MENU_BAR_MIN_SCALE = 0.45;
const menuBarCells = ['commandes', 'météo', 'carte-case', 'atc-case', 'online', 'profil', 'paramètre', 'masse-bouton',
    'mode-photo', 'barre-plein-ecran', 'quitter-partie'].map((id) => document.getElementById(id));
// Facteur de réduction pour que la barre tienne dans la largeur (dans sa disposition actuelle)
function shrinkMenuBar() {
    const style = simulatorElement.style;
    const box = simulatorElement.getBoundingClientRect();
    const limit = box.right - (parseFloat(getComputedStyle(simulatorElement).paddingRight) || 0);
    const span = () => {
        const cells = menuBarCells.filter((cell) => cell.offsetWidth > 0).map((cell) => cell.getBoundingClientRect());
        return { left: Math.min(...cells.map((r) => r.left)), right: Math.max(...cells.map((r) => r.right)) };
    };
    let scale = 1;
    style.setProperty('--barre-echelle', '1');
    for (let i = 0; i < 6; i++) {
        const { left, right } = span();
        if (right <= limit + 0.5) break;
        // Les bordures ne rétrécissent pas : on vise un peu plus bas que la simple règle de trois
        scale = Math.max(MENU_BAR_MIN_SCALE, scale * ((limit - left) / (right - left)) * 0.98);
        style.setProperty('--barre-echelle', scale.toFixed(3));
        if (scale === MENU_BAR_MIN_SCALE) break;
    }
    return scale;
}
function fitMenuBar() {
    if (!simulatorElement.classList.contains('barre')) return;
    simulatorElement.classList.remove('barre-2-lignes');
    if (shrinkMenuBar() >= MENU_BAR_READABLE) return;
    simulatorElement.classList.add('barre-2-lignes');
    shrinkMenuBar();
}
let menuBarFitQueued = false;
function queueFitMenuBar() {
    if (menuBarFitQueued) return;
    menuBarFitQueued = true;
    requestAnimationFrame(() => { menuBarFitQueued = false; fitMenuBar(); });
}
window.addEventListener('resize', queueFitMenuBar);
window.addEventListener('orientationchange', queueFitMenuBar);
document.fonts?.ready.then(queueFitMenuBar);
const menuBarObserver = new MutationObserver(queueFitMenuBar);
for (const cell of menuBarCells) menuBarObserver.observe(cell, { childList: true, characterData: true, subtree: true });
window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.repeat) return;
    if (event.target?.id === 'tchat-saisie') return;   // Échap ferme le champ du tchat (voir Chat.js)
    if (inMenu || inHangar || !spawnDialog.hidden || !airportPanel.hidden || document.querySelector('dialog[open]')) return;
    if (menus.some((menu) => menu.contains(menuContent.get(menu)) && !menuContent.get(menu).hidden)) return;   // Échap referme d'abord le menu
    const visible = !simulatorElement.classList.contains('barre');
    setMenuBar(visible);
    if (!visible) showEscapeHint();   // barre cachée : rappel pour la retrouver
}, true);

view.addEventListener('pointermove', (event) => {
    if (!choosingSpawn) return;
    spawnHover = spawnUnderPointer(event);
    view.style.cursor = spawnHover ? 'pointer' : '';
});
view.addEventListener('click', (event) => {
    if (dragDistance > 6) return;   // fin d'un glisser de la caméra, pas un clic
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
// Retours en arrière depuis le vol (menu Commandes, panneau SOL de la tablette), le choix du départ ou le hangar : au
// hangar (changer d'avion, de livrée) ou au choix de l'aérodrome. Avant, une fois en vol, seul le départ se changeait :
// pour prendre un autre avion, il fallait repasser par le menu principal (et quitter la partie multijoueur)
function leaveFlightScreens() {
    if (initiation?.active) initiation.stop();   // (la leçon se fait sur le Cessna, au départ prévu)
    closeMenus();
    setMenuBar(false);
    tabletPanels?.closeAll();
    spawnDialog.hidden = true;
    spawnHover = null;
    spawnMarkers.visible = false;
    view.style.cursor = '';
}
function backToHangar() {
    if (wardog() && multiplayer.team) return openTeamHangar();   // (en F-15, au terrain de l'équipe)
    leaveFlightScreens();
    openHangar();
}
function backToAirportChoice() {
    leaveFlightScreens();
    leaveHangar();
    openAirportChoice();
}
for (const [id, action] of [['retour-hangar', backToHangar], ['depart-hangar', backToHangar], ['retour-aerodrome', backToAirportChoice],
    ['hangar-aerodromes', backToAirportChoice]]) {
    document.getElementById(id).addEventListener('click', (event) => {
        action();
        event.currentTarget.blur();
    });
}
// Hangar : au lancement, l'avion est présenté dans le hangar de l'aéro-club, éteint, portes ouvertes et plafonniers
// allumés (l'avion est tout près des portes, voir Airport.updateHangars). À côté : livrée et immatriculation ; le
// bouton passe au choix du départ. Comme pendant le choix du départ, rien ne bouge (ni physique, ni son, ni réseau)
// Aérodrome choisi : départs, hangar, tour de contrôle, radios ; le départ par défaut devient sa première piste
function selectAirport(field) {
    airport.setCurrent(field);
    if (currentSpawn.airport !== airport.current) currentSpawn = airport.current.spawns[0];
}

// Choix de l'aérodrome (après Vol libre / Multijoueur, avant le hangar) : une case par terrain (pistes, fréquences,
// balises) ; la survoler y amène la caméra, la cliquer ouvre son hangar
const airportPanel = document.getElementById('aerodrome-panneau');
const airportList = document.getElementById('aerodrome-liste');
function openAirportChoice() {
    inHangar = false;
    hangarPanel.hidden = true;
    spawnDialog.hidden = true;
    choosingSpawn = true;
    aircraft.visible = false;
    spawnMarkers.visible = false;
    airportPanel.hidden = false;
    setSpawnView('ensemble', true);
    // (Wardog : seulement les terrains tenus par notre équipe)
    const allowed = allowedFields();
    if (!allowed.includes(airport.current)) selectAirport(allowed[0]);
    airportList.replaceChildren(...airport.list.filter((field) => allowed.includes(field)).map((field, i) => {
        const button = document.createElement('button');
        const number = document.createElement('span');
        number.className = 'depart-numero';
        number.textContent = String(i + 1);
        const text = document.createElement('span');
        text.textContent = `${field.aerodrome.name} (${field.aerodrome.icao})`;
        const detail = document.createElement('small');
        detail.textContent = `${field.description} · pistes ${field.runways.map((rw) => rw.name).join(' / ')} · `
            + `Tour ${field.aerodrome.frequencies.tower} · VOR ${field.vor.ident} ${field.vor.frequency} · ILS ${field.ilsFrequency}`;
        text.append(detail);
        button.append(number, text);
        button.classList.toggle('survol', field === airport.current);
        button.addEventListener('pointerenter', () => {
            // Saut direct (sans survol de la carte entre les deux : le relief n'aurait pas le temps d'être construit)
            spawnCam.goal = spawnViewState(SPAWN_VIEWS.ensemble, field);
            Object.assign(spawnCam, spawnViewState(SPAWN_VIEWS.ensemble, field));
            markSpawnView(null);
        });
        button.addEventListener('click', () => {
            selectAirport(field);
            openHangar();
        });
        return button;
    }));
}
document.getElementById('aerodrome-menu').addEventListener('click', () => {
    airportPanel.hidden = true;
    openMainMenu();
});

const hangarPanel = document.getElementById('hangar-panneau');
let viewBeforeHangar = null;
let hangarCanopyTimer = 0;
function openHangar() {
    const hangar = airport.hangars[0];   // (aérodrome choisi)
    inHangar = choosingSpawn = true;
    airportPanel.hidden = true;
    hangarPanel.hidden = false;
    systems.reset();
    systems.coldAndDark();
    controls.throttle = 0;
    applyLights();
    // Au milieu du hangar, nez vers les portes
    aircraft.position.set(hangar.spot.x, 0, hangar.spot.z);
    aircraft.rotation.set(0, hangar.spot.heading, 0);
    controls.placeOnGround();
    aircraft.position.y += 0.05;   // sol du hangar, un peu au-dessus du terrain
    aircraft.visible = true;
    // F-15 : verrière d'abord ouverte, puis elle se ferme sous les yeux du joueur (animation, sans bruit au hangar)
    clearTimeout(hangarCanopyTimer);
    if (aircraftType === 'f15') {
        jetCanopy = 1;
        hangarCanopyTimer = setTimeout(() => {
            if (inHangar && aircraftType === 'f15') jetSystems.switches.canopy = false;
        }, 1200);
    }
    // Vue extérieure (en vue cabine, la carrosserie est masquée)
    viewBeforeHangar = chaseView;
    if (!chaseView) {
        chaseView = true;
        updateView();
    }
}
function leaveHangar() {
    if (!inHangar) return;
    inHangar = false;
    hangarPanel.hidden = true;
    if (viewBeforeHangar === false) {
        chaseView = false;
        updateView();
    }
}
// Choix de l'avion au hangar : Cessna 172 ou F-15C (chargé à la première demande, ~11 Mo)
const aircraftButtons = [...document.querySelectorAll('#hangar-avions [data-avion]')];
const HANGAR_DESCRIPTIONS = {
    c172: "Cessna 172 de l'aéro-club, au hangar. Personnalisez-le avant de partir.",
    f15: 'F-15C Eagle, au hangar, éteint. Mise en route : BATT, JFS, ENG MASTER, puis lancement de '
        + 'chaque réacteur (voir le manuel). Train : touche Y, aérofrein : U, postcombustion : gaz au-delà de 85 %.',
    r44: 'Robinson R44 Raven II, au hangar, éteint. Mise en route : MASTER BATT, gaz fermés, clé sur START ; '
        + 'moteur parti : CLUTCH (touche T), puis gaz (U) vers 80 % et GOVERNOR (touche G). Collectif : Espace / Ctrl, '
        + 'cyclique : Z Q S D, palonniers : A / E. Aide au stationnaire : menu Paramètres.',
};
function updateAircraftChoice() {
    // Wardog : F-15 seulement (le Cessna n'est pas fait pour le combat) : la case du Cessna est retirée du hangar
    const jetOnly = Boolean(multiplayer.code) && multiplayer.mode === 'wardog';   // (pas wardog() : appelé dès le chargement)
    for (const button of aircraftButtons) {
        button.classList.toggle('actif', button.dataset.avion === aircraftType);
        button.hidden = jetOnly && button.dataset.avion !== 'f15';
        button.disabled = button.hidden;
    }
    // Wardog : le terrain est celui de l'équipe, pas de choix de l'aérodrome
    for (const id of ['hangar-aerodromes', 'retour-aerodrome']) document.getElementById(id).hidden = jetOnly;
    document.getElementById('hangar-description').textContent = HANGAR_DESCRIPTIONS[aircraftType];
    // Immatriculation : peinte sur le Cessna ; sur le F-15, le numéro est celui de la livrée (indicatif radio seulement)
    for (const input of registrationInputs) input.title = aircraftType === 'f15' ? 'Indicatif radio (le numéro peint est celui de la livrée)' : '';
}
for (const button of aircraftButtons) {
    button.addEventListener('click', async () => {
        const type = button.dataset.avion;
        if (type === aircraftType) return;
        const label = button.textContent;
        for (const b of aircraftButtons) b.disabled = true;
        if ((type === 'f15' && !jetModel) || (type === 'r44' && !heliCockpit.ready)) button.textContent = 'Chargement…';
        try {
            await setAircraftType(type);
            if (inHangar) openHangar();   // l'avion choisi, éteint, au milieu du hangar
        } catch (error) {
            console.error(error);
            showRadioMessage(`${type === 'r44' ? 'R44' : 'F-15'} : chargement impossible (vérifiez la connexion), réessayez`);
        } finally {
            button.textContent = label;
            for (const b of aircraftButtons) b.disabled = false;
            updateAircraftChoice();   // (Wardog : Cessna toujours grisé)
            button.blur();
        }
    });
}

document.getElementById('hangar-partir').addEventListener('click', () => {
    leaveHangar();
    openSpawnDialog();
});

// Menu principal : au lancement (et depuis le menu Commandes), par-dessus la page ; derrière, l'aérodrome en direct,
// survolé lentement. Vol libre et Multijoueur mènent au hangar, puis au choix du départ ; Initiation part directement
const mainMenu = document.getElementById('menu-principal');
function openMainMenu() {
    if (initiation?.active) initiation.stop();
    // Le menu ne garde rien du vol : fenêtre radio fermée, contrôleurs remis à zéro (émission coupée), journal vidé
    atc.reset();
    atc.clearLog();
    document.getElementById('atc').hidden = true;
    document.getElementById('atc-bouton').setAttribute('aria-pressed', 'false');
    document.getElementById('atc-sous-titre').hidden = true;
    inHangar = false;
    hangarPanel.hidden = true;
    airportPanel.hidden = true;
    document.getElementById('carte-panneau').hidden = true;
    spawnDialog.hidden = true;
    spawnMarkers.visible = false;
    choosingSpawn = inMenu = true;
    aircraft.visible = false;
    mainMenu.hidden = false;
    showFullscreenGuideOnce();
    setMenuBar(false);
    setPhotoMode(false);
    document.getElementById('mp-multi-detail').textContent = multiplayer.code
        ? `Partie ${multiplayer.code} en cours` : 'Partie privée entre amis';
    document.getElementById('mp-vol-libre').focus();
    checkVersion();
}

// Numéro de version (nombre de commits, voir tools/version.sh) au menu principal ; à chaque ouverture du menu, celui
// publié en ligne est relu : plus récent (page restée ouverte pendant une mise à jour) -> bouton pour recharger
const versionLabel = document.getElementById('mp-version');
const [vy, vm, vd] = VERSION_DATE.split('-');
versionLabel.textContent = `Version 0.${VERSION} (${vd}/${vm}/${vy})`;
// Relue à son adresse ordinaire, celle que le rechargement utilisera (revalidée auprès du serveur : no-cache). Avant,
// avec ?t=… (adresse toujours nouvelle), le serveur de GitHub Pages renvoyait la toute dernière version, alors que le
// rechargement recevait encore pendant ~10 min sa copie gardée de l'ancien code : la page rechargée se croyait encore
// en retard et voulait réinstaller la mise à jour en boucle (en partie : quitter et rejoindre à chaque fois)
function checkVersion() {
    fetch('js/Version.js', { cache: 'no-cache' })
        .then((response) => (response.ok ? response.text() : ''))
        .then((text) => {
            const online = Number(text.match(/VERSION\s*=\s*(\d+)/)?.[1]);
            if (!(online > VERSION) || triedRecently(online)) return;   // (déjà tentée : rien avant UPDATE_RETRY)
            pendingVersion = online;   // (installée au prochain moment calme, voir updateWhenCalm)
            versionLabel.replaceChildren(`Version 0.${VERSION} · `, Object.assign(document.createElement('a'), {
                href: '#', textContent: `version 0.${online} disponible, recharger`,
                onclick: (event) => { event.preventDefault(); location.reload(); },
            }));
            versionLabel.querySelector('a').style.color = '#ffcf5a';
        })
        .catch(() => {});   // hors ligne : on garde la version affichée
}

// --- Mises à jour en cours de partie, presque sans rien faire -----------------------------------------------------
// Le code d'une page ouverte ne peut pas être remplacé à chaud : la page se recharge. La version en ligne est relue
// toutes les minutes ; plus récente, la page se recharge d'elle-même au prochain moment calme (menu ou hangar sans
// fenêtre ouverte, choix de l'aérodrome, ou juste après avoir été abattu ou s'être écrasé), jamais en plein vol. Un
// bandeau discret le signale entre-temps (« Installer maintenant » pour ne pas attendre). En partie, on y revient
// tout seul après le rechargement : même code, même équipe, même score (voir resumeAfterUpdate)
const UPDATE_CHECK_EVERY = 60000;   // ms
const UPDATE_KEY = 'esme-mise-a-jour';
let pendingVersion = 0;
const updateBanner = document.getElementById('maj');
setInterval(() => { if (!document.hidden) checkVersion(); }, UPDATE_CHECK_EVERY);
function calmMoment() {
    if (document.querySelector('dialog[open]')) return false;          // (fenêtre ouverte : saisie en cours, réglages…)
    if (!document.getElementById('troll')?.hidden) return false;       // (Wardog troll : on laisse la musique)
    return inMenu || inHangar || choosingSpawn || controls.isCrashed();
}
// Rechargement vers la nouvelle version ; false : déjà tenté pour cette version il y a moins de 5 min (ancien code
// encore servi), pas de boucle de rechargements. force : clic sur « Installer maintenant », on recharge quand même
const UPDATE_RETRY = 5 * 60000;   // ms
function triedRecently(version) {
    try {
        const tried = JSON.parse(sessionStorage.getItem(`${UPDATE_KEY}-tentee`) ?? 'null');
        return tried?.v === version && Date.now() - tried.le < UPDATE_RETRY;
    } catch {
        return false;
    }
}
function installUpdate(force = false) {
    try {
        if (!force && triedRecently(pendingVersion)) {
            pendingVersion = 0;   // (bandeau retiré ; la version en ligne sera relue après UPDATE_RETRY)
            return false;
        }
        sessionStorage.setItem(`${UPDATE_KEY}-tentee`, JSON.stringify({ v: pendingVersion, le: Date.now() }));
        if (multiplayer.code) {
            sessionStorage.setItem(UPDATE_KEY, JSON.stringify({ partie: multiplayer.code, hote: multiplayer.isHost,
                mode: multiplayer.mode, troll: multiplayer.troll, equipe: multiplayer.team, score: multiplayer.score,
                listee: multiplayer.listed, le: Date.now() }));
        }
    } catch {
        if (!force) return false;   // (stockage indisponible : pas de garde-fou contre la boucle, seulement sur clic)
    }
    location.replace(location.pathname);
    return true;
}
function updateWhenCalm() {
    updateBanner.hidden = !pendingVersion;
    if (!pendingVersion) return;
    updateBanner.querySelector('span').textContent = `Mise à jour 0.${pendingVersion} prête : installée à la prochaine pause`;
    if (calmMoment() && !installUpdate()) updateBanner.hidden = true;   // (déjà tentée : on réessaiera plus tard)
}
setInterval(updateWhenCalm, 2000);
updateBanner.querySelector('button').addEventListener('click', () => {
    installUpdate(true);   // (clic : on recharge quoi qu'il arrive)
});
function closeMainMenu() {
    if (!inMenu) return;
    inMenu = false;
    mainMenu.hidden = true;
}
document.getElementById('mp-vol-libre').addEventListener('click', () => {
    if (multiplayer.code) {
        if (!confirm(`Quitter la partie ${multiplayer.code} et voler en solo ?`)) return;
        multiplayer.leave();
        updateModes();
    }
    openMapChoice('solo');
});
// Multijoueur : d'abord la carte de la partie à créer (déjà dans une partie : directement la fenêtre de la partie). Une
// partie rejointe impose toujours sa carte (voir l'événement 'map' plus haut)
document.getElementById('mp-multi').addEventListener('click', () => (multiplayer.code ? openMultiDialog() : openMapChoice('multi')));

// Choix de la carte (page à part, ouverte par Vol libre et Multijoueur) : Campagne, Ville ou Mer, et en mer les règles
// des porte-avions. Le menu principal reste derrière (aérodrome survolé). En solo, une autre carte que celle chargée
// recharge la page puis revient au choix de l'aérodrome (voir resumeAfterUpdate) ; en multijoueur, elle devient la carte
// de la partie à créer (la page se recharge à la création, voir #multi-creer)
const mapChoicePanel = document.getElementById('carte-panneau');
const mapChoiceList = document.getElementById('carte-liste');
const MAP_CHOICES = {
    campagne: { label: 'Campagne', detail: 'Aérodromes d’ESME et d’AIX, dans les collines' },
    ville: { label: 'Ville', detail: 'ESME et AIX, une grande ville entre les deux' },
    mer: { label: 'Mer · porte-avions', detail: 'Deux porte-avions en pleine mer : catapulte et brins d’arrêt' },
};
let mapChoiceFor = 'solo', mapChoice = MAP;
function renderMapChoice() {
    for (const button of mapChoiceList.children) {
        const on = button.dataset.carte === mapChoice;
        button.classList.toggle('survol', on);
        button.setAttribute('aria-checked', String(on));
    }
    document.getElementById('carte-pa').hidden = mapChoice !== 'mer';
    const rules = mapChoiceFor === 'multi' ? createRules : soloCarrierRules;
    for (const button of document.getElementById('carte-pa-regles').children) button.classList.toggle('actif', button.dataset.regles === rules);
}
for (const [name, { label, detail }] of Object.entries(MAP_CHOICES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.carte = name;
    button.setAttribute('role', 'radio');
    const number = document.createElement('span');
    number.className = 'depart-numero';
    number.textContent = String(mapChoiceList.children.length + 1);
    const text = document.createElement('span');
    text.textContent = label;
    const small = document.createElement('small');
    small.textContent = detail;
    text.append(small);
    button.append(number, text);
    button.addEventListener('click', () => { mapChoice = name; renderMapChoice(); });
    button.addEventListener('dblclick', () => { mapChoice = name; continueMapChoice(); });
    mapChoiceList.appendChild(button);
}
for (const [name, label] of Object.entries({ arcade: 'Arcade', realiste: 'Réaliste' })) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.regles = name;
    button.title = name === 'arcade' ? 'Catapulte et brins d’arrêt automatiques' : 'Crosse à sortir (touche 9), catapulte à lancer (touche 0)';
    button.addEventListener('click', () => {
        button.blur();
        if (mapChoiceFor === 'multi') createRules = name;
        else document.querySelector(`#depart-pa-regles [data-regles="${name}"]`)?.click();   // (solo : gardé, comme au choix du départ)
        updateCreateChoice();
        renderMapChoice();
    });
    document.getElementById('carte-pa-regles').appendChild(button);
}
function openMapChoice(purpose) {
    mapChoiceFor = purpose;
    mapChoice = purpose === 'multi' ? createMap : MAP;
    document.getElementById('carte-aide').textContent = purpose === 'multi'
        ? 'Carte de la partie que vous allez créer. Une partie rejointe par son code garde sa propre carte.'
        : 'Vous pourrez en changer au choix du départ.';
    mainMenu.hidden = true;
    mapChoicePanel.hidden = false;
    renderMapChoice();
    mapChoiceList.querySelector('.survol')?.focus();
}
function continueMapChoice() {
    mapChoicePanel.hidden = true;
    if (mapChoiceFor === 'multi') {
        createMap = mapChoice;
        updateCreateChoice();
        mainMenu.hidden = false;
        openMultiDialog();
        return;
    }
    if (mapChoice !== MAP) {
        try {
            localStorage.setItem('carte', mapChoice);
            sessionStorage.setItem('esme-mise-a-jour', JSON.stringify({ volLibre: true, le: Date.now() }));
        } catch { /* stockage indisponible */ }
        location.replace(`${location.pathname}?carte=${mapChoice}`);
        return;
    }
    newWind(Math.floor(Math.random() * 2 ** 32));   // nouvelle partie solo : nouveau vent
    closeMainMenu();
    enterGame(openAirportChoice);
}
document.getElementById('carte-continuer').addEventListener('click', continueMapChoice);
document.getElementById('carte-menu').addEventListener('click', () => {
    mapChoicePanel.hidden = true;
    mainMenu.hidden = false;
    document.getElementById('mp-vol-libre').focus();
});
// Survol ou toucher du bouton : connexion aux relais commencée tout de suite (liste des parties plus vite à l'ouverture)
for (const type of ['pointerenter', 'focus', 'pointerdown']) document.getElementById('mp-multi').addEventListener(type, () => multiplayer.preconnect());
// (fermer la fenêtre au menu n'entre plus dans la partie : bouton « Entrer dans la partie » ou choix de l'équipe, voir
// enterMultiplayerGame ; « Multijoueur » la rouvre)
document.getElementById('mp-initiation').addEventListener('click', () => openInitiation());
document.getElementById('mp-parametres').addEventListener('click', () => openSettings());
const menuWeather = document.getElementById('mp-meteo');
for (const [name, w] of Object.entries(WEATHERS)) {
    const button = document.createElement('button');
    button.textContent = w.label;
    button.dataset.meteo = name;
    button.classList.toggle('actif', w === weather);
    button.addEventListener('click', () => setWeather(name));
    menuWeather.appendChild(button);
}
// Carte (choix du départ, vol libre en solo) : une autre carte recharge la page, puis revient au choix du départ
// (voir resumeAfterUpdate). En partie multijoueur, la carte est celle de la partie : pas de choix
const departMaps = document.getElementById('depart-cartes');
for (const [name, label] of Object.entries({ campagne: 'Campagne', ville: 'Ville', mer: 'Mer · porte-avions' })) {
    const button = document.createElement('button');
    button.textContent = label;
    button.classList.toggle('actif', name === MAP);
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(name === MAP));
    button.addEventListener('click', () => {
        button.blur();
        if (name === MAP || multiplayer.code) return;
        try {
            localStorage.setItem('carte', name);
            sessionStorage.setItem('esme-mise-a-jour', JSON.stringify({ volLibre: true, le: Date.now() }));
        } catch { /* stockage indisponible */ }
        location.replace(`${location.pathname}?carte=${name}`);
    });
    departMaps.appendChild(button);
}
document.getElementById('depart-pa').hidden = !SEA;
const departRules = document.getElementById('depart-pa-regles');
for (const [name, label] of Object.entries({ arcade: 'Arcade', realiste: 'Réaliste' })) {
    const button = document.createElement('button');
    button.textContent = label;
    button.dataset.regles = name;
    button.setAttribute('role', 'radio');
    button.title = name === 'arcade' ? 'Catapulte et brins d\'arrêt automatiques' : 'Crosse à sortir (touche 9), catapulte à lancer (touche 0)';
    button.addEventListener('click', () => {
        button.blur();
        soloCarrierRules = createRules = name;
        try { localStorage.setItem('pa-regles', name); } catch { /* stockage indisponible */ }
        for (const other of departRules.children) {
            other.classList.toggle('actif', other === button);
            other.setAttribute('aria-checked', String(other === button));
        }
        updateCreateChoice();
    });
    button.classList.toggle('actif', name === soloCarrierRules);
    button.setAttribute('aria-checked', String(name === soloCarrierRules));
    departRules.appendChild(button);
}
// Initiation : leçons faites pour l'aérodrome d'ESME (cartes Campagne et Ville)
if (SEA) {
    const lesson = document.getElementById('mp-initiation');
    lesson.disabled = true;
    lesson.querySelector('small').textContent = 'Pas en mer : changez de carte dans Vol libre';
}
// Wardog en mer : départ des porte-avions
if (SEA) {
    document.querySelector('.multi-equipes-aide').textContent = 'Bleus : porte-avions bleu · Rouges : porte-avions rouge. Vous arrivez sur le pont de votre navire, en F-15.';
}
document.getElementById('hangar-menu').addEventListener('click', openMainMenu);
// Petit clic au survol d'une case du menu (et des boutons de météo) ; muet tant que le navigateur n'a pas autorisé
// le son (premier clic ou première touche)
for (const button of mainMenu.querySelectorAll('.mp-bouton, .mp-choix button')) {
    button.addEventListener('pointerenter', () => sounds.click(0.12, 2600));
    button.addEventListener('focus', () => { if (button.matches(':focus-visible')) sounds.click(0.12, 2600); });
    button.addEventListener('click', () => sounds.click(0.25, 1800));
}
// Barre de menus (Échap) : « Mode photo » masque les infos de vol et les panneaux superposés ; le même bouton les
// remet. La barre se referme pour dégager la vue (Échap la rouvre pour sortir du mode photo)
const photoButton = document.getElementById('mode-photo');
function setPhotoMode(on) {
    simulatorElement.classList.toggle('photo', on);
    photoButton.classList.toggle('actif', on);
    // (« mode » caché sur écran étroit, voir .long dans style.css)
    photoButton.innerHTML = on ? '<span class="long">Quitter le mode photo</span><span class="court">Quitter photo</span>'
        : '<span class="long">Mode photo</span><span class="court">Photo</span>';
}
photoButton.addEventListener('click', (event) => {
    event.currentTarget.blur();
    const on = !simulatorElement.classList.contains('photo');
    setPhotoMode(on);
    if (on) setMenuBar(false);
});
// iPad (pas de barre de menus) : seul bouton à l'écran en mode photo, pour en sortir
document.getElementById('photo-sortie').addEventListener('click', (event) => {
    event.currentTarget.blur();
    setPhotoMode(false);
});

// Barre de menus (Échap) : « Quitter la partie » arrête le vol (et quitte la partie multijoueur en cours), puis
// revient au menu principal
document.getElementById('quitter-partie').addEventListener('click', (event) => {
    event.currentTarget.blur();
    const question = multiplayer.code
        ? `Quitter la partie ${multiplayer.code} et revenir au menu principal ?`
        : 'Quitter le vol et revenir au menu principal ?';
    if (!confirm(question)) return;
    if (multiplayer.code) {
        multiplayer.leave();
        updateModes();
    }
    openMainMenu();
});
openMainMenu();
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
const liverySelects = ['profil-livree', 'multi-livree', 'hangar-livree'].map((id) => document.getElementById(id)).filter(Boolean);
// Listes des livrées : celles de l'avion piloté (couleurs du Cessna, ou livrées d'escadrons du F-15)
function refreshLiveryOptions() {
    const list = aircraftType === 'f15' ? F15_LIVERIES : aircraftType === 'r44' ? R44_LIVERIES : LIVERIES;
    for (const select of liverySelects) {
        select.replaceChildren(...Object.entries(list).map(([id, livery]) => new Option(livery.label, id)));
    }
}
refreshLiveryOptions();
function setLivery(id, save = true) {
    const jet = aircraftType === 'f15', heli = aircraftType === 'r44';
    multiplayer.livery = jet ? (isF15Livery(id) ? id : F15_DEFAULT_LIVERY)
        : heli ? (isR44Livery(id) ? id : R44_DEFAULT_LIVERY) : (isLivery(id) ? id : DEFAULT_LIVERY);
    for (const select of liverySelects) select.value = multiplayer.livery;
    if (jet) {
        if (jetModel) paintF15(jetModel, multiplayer.livery);
    } else if (heli) {
        if (heliCockpit.ready) paintR44(heliCockpit.model, multiplayer.livery);
    } else if (aircraftModel) paintAircraft(aircraftModel, multiplayer.livery);
    if (save) try { localStorage.setItem(jet ? 'livree-f15' : heli ? 'livree-r44' : 'livree', multiplayer.livery); } catch { /* stockage indisponible */ }
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
    // (score de la partie au bout de la ligne : victoires / fois abattu, voir updateScores)
    const scoreText = (score) => (score && (score.kills || score.deaths) ? ` · ${score.kills} V / ${score.deaths} A` : '');
    const rows = [playerRow(`${multiplayer.name} (vous)`, RemotePlayers.color(multiplayer.livery),
        formatAltitude((aircraft.position.y - WHEEL_HEIGHT) / 0.3048) + scoreText(multiplayer.score), radio.talking)];
    for (const player of remotePlayers.list()) {
        const distance = formatNM(player.position.distanceTo(aircraft.position));
        const score = scoreText(multiplayer.players.get(player.id)?.score);
        rows.push(playerRow(player.name, player.color,
            (player.crashed ? 'crash' : player.offline ? 'hors ligne' : `${distance} NM · ${formatAltitude(player.altitude)}`) + score, player.speaking));
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

// Champ où l'on tape du texte (pseudo, code, transpondeur…) : les touches ne pilotent pas. Une case à cocher, un curseur,
// une liste ou un bouton restés sélectionnés après un clic ne bloquent pas le clavier (voir ci-dessous)
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);
function isTypingTarget(target) {
    return (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)) || target instanceof HTMLTextAreaElement;
}
// Touche de pilotage pendant qu'une commande de la page a le focus (bouton, case, curseur, liste) : le focus retourne
// à la vue, sans que la touche agisse sur la commande (Espace ne re-clique pas un bouton, une lettre ne change pas la
// liste des voix, les flèches ne bougent pas un curseur)
window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === view || isTypingTarget(target) || target.isContentEditable) return;
    if (!/^(Key|Digit)|^(Space|ControlLeft|ShiftLeft|Arrow)/.test(event.code) || event.altKey || event.metaKey) return;
    if (!target.matches('button, select, input, [tabindex]') || target.closest('dialog[open]')) return;
    if (inMenu || inHangar || !spawnDialog.hidden || !airportPanel.hidden) return;   // écrans sans pilotage : clavier libre
    if (event.code === 'Space' || target instanceof HTMLSelectElement || target instanceof HTMLInputElement) event.preventDefault();
    target.blur();
    view.focus();
}, true);
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyN' && !event.repeat && !isTypingTarget(event.target)) radio.setTalking(true);
});
window.addEventListener('keyup', (event) => {
    if (event.code === 'KeyN') radio.setTalking(false);
});
window.addEventListener('blur', () => radio.setTalking(false));

// Crash d'un autre joueur : explosion à l'endroit de l'impact, bruit moins fort et retardé de loin
// Explosions réutilisées (avant : une nouvelle à chaque fois, jamais libérée : la mémoire graphique grossissait en combat)
const remoteCrashes = [];
const spareCrashes = [];
function startExplosion(position) {
    const effect = spareCrashes.pop() ?? new CrashEffect();
    effect.start(position);
    scene.add(effect.group);
    remoteCrashes.push(effect);
    return effect;
}
remotePlayers.addEventListener('crash', ({ detail }) => {
    const ground = terrain.heightAt(detail.position.x, detail.position.z);
    startExplosion(detail.position.clone().setY(Math.max(ground, detail.position.y - WHEEL_HEIGHT)));
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
            if (spareCrashes.length < 12) spareCrashes.push(effect);
            else effect.dispose();
        }
    }
}

// Carte : bouton du bandeau ou touche M
const mapPanel = document.getElementById('carte');
// Carte : déplaçable n'importe où sur l'écran (glisser sa barre de titre), position gardée
makeDraggable(mapPanel, mapPanel.querySelector('.carte-entete'), 'esme-fenetre-carte');
const mapButton = document.getElementById('carte-bouton');
const mapView = new MapView(document.getElementById('carte-canvas'), {
    heightAt: (x, z) => terrain.heightAt(x, z),
    waterAt: (x, z) => { const lake = terrain.lakeAt(x, z); return Boolean(lake) && terrain.groundAt(x, z, lake) < lake.level; },
    worldSize: 16000,   // (zone des deux aérodromes ; le terrain s'étend plus loin, pour la distance de vue)
    shapes: city ? [{ kind: 'city', label: 'VILLE', x: city.center.x, z: city.center.z, radius: city.radius }, ...airport.mapShapes]
        : airport.mapShapes,
    runways: airport.allRunways,
    navaids: airport.vors,
});

function toggleMap(open = mapPanel.hidden) {
    // iPad : une seule fenêtre flottante à la fois (radio, carte, panneaux SOL / SYSTÈMES)
    if (open && isTablet()) {
        if (!atcPanel.hidden) toggleAtc(false);
        tabletPanels?.closeAll();
    }
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
// Fenêtre radio : déplaçable n'importe où sur l'écran (glisser sa barre de titre), position gardée
makeDraggable(atcPanel, atcPanel.querySelector('.carte-entete'), 'esme-fenetre-radio');
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
setAtcButtonLabel('Tour', airport.aerodrome.frequencies.tower);
window.speechSynthesis?.getVoices();   // charge la liste des voix à l'avance

function toggleAtc(open = atcPanel.hidden) {
    // iPad : une seule fenêtre flottante à la fois (radio, carte, panneaux SOL / SYSTÈMES)
    if (open && isTablet()) {
        if (!mapPanel.hidden) toggleMap(false);
        tabletPanels?.closeAll();
    }
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

// Radio COM : une case par fréquence ; on écoute et on parle sur celle qui est affichée (refaites quand on change
// d'aérodrome : fréquences différentes)
function renderAtcStations() {
atcCom.replaceChildren(...atc.stations.map(({ id, name, label: word, frequency }) => {
    const button = document.createElement('button');
    button.dataset.station = id;
    button.title = `Afficher ${name} sur la radio`;
    const label = document.createElement('strong');
    label.textContent = word;   // « Sol », « Tour »… (le nom de l'aérodrome est dans le titre de la fenêtre)
    const value = document.createElement('span');
    value.textContent = frequency;
    button.append(label, value);
    button.addEventListener('click', () => { atc.setFrequency(id); view.focus(); });
    return button;
}));
}
// Aérodrome contacté (fenêtre Tour) : ses fréquences remplacent celles de l'autre, et la même station (Sol, Tour…)
// s'affiche sur la COM au micro
const atcFields = document.getElementById('atc-aerodromes');
atcFields.replaceChildren(...airport.list.map((field) => {
    const button = document.createElement('button');
    button.textContent = `${field.aerodrome.name} (${field.aerodrome.icao})`;
    button.title = `Contacter ${field.aerodrome.name}`;
    button.addEventListener('click', () => {
        airport.setCurrent(field);
        avionics.showOnCom(avionics.audio.mic, parseFrequency(field.aerodrome.frequencies[atc.freq]));
        view.focus();
    });
    return button;
}));
const renderAtcFields = () => airport.list.forEach((field, i) => atcFields.children[i].classList.toggle('actif', field === airport.current));
renderAtcStations();
airport.addEventListener('change', () => { watchNewShaders(); atc.cutAtis(); renderAtcStations(); renderAtcFields(); renderAtc(); });
renderAtcFields();

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

// Case de la barre : « Tour · 118.300 » (fréquence cachée sur écran étroit, voir .long)
function setAtcButtonLabel(station, frequency) {
    const long = document.createElement('span');
    long.className = 'long';
    long.textContent = ` · ${frequency}`;
    atcButton.replaceChildren(station, long);
}

function renderAtc() {
    const { icao, name, frequencies } = airport.aerodrome;
    const station = atc.stations.find((st) => st.id === atc.freq);
    setAtcButtonLabel(station.label, frequencies[atc.freq]);
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
        label.textContent = from === 'pilot' ? who ?? 'VOUS' : from === 'atis' ? 'ATIS' : from === 'info' ? 'COM' : who;
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
const registrationInputs = ['hangar-immat', 'profil-immat'].map((id) => document.getElementById(id)).filter(Boolean);
// Immatriculation choisie par le joueur (hangar, menu Profil), sinon celle tirée de son identifiant
function registrationFor(id) {
    const chosen = multiplayer.players.get(id)?.registration;
    if (chosen) return chosen;
    let h = 7;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return `F-H${letters[h % 26]}${letters[(h >>> 5) % 26]}${letters[(h >>> 10) % 26]}`;
}
function updateRegistration() {
    // Voix de pilote attitrée : celle que les autres joueurs entendent (calculée d'après l'identifiant), la même toute la partie
    radioVoices.setPlayerId(multiplayer.code ? multiplayer.id : '');
    const fallback = multiplayer.code ? registrationFor(multiplayer.id) : 'F-HESM';
    atc.setRegistration(multiplayer.registration || fallback);
    for (const input of registrationInputs) input.placeholder = fallback;
    if (aircraftModel) setRegistration(aircraftModel, atc.registration);   // peinte sur le fuselage
    heliCockpit.setRegistration(atc.registration);                       // (R44 : sur la poutre et le tableau)
    document.getElementById('atc-indicatif').textContent = atc.registration;
}
multiplayer.addEventListener('status', updateRegistration);
// Champs d'immatriculation (hangar, menu Profil) : gardés d'accord, enregistrée dans le navigateur. Vide : celle par
// défaut (F-HESM en solo, tirée de l'identifiant en multijoueur) ; invalide : refusée (champ en rouge)
function setCustomRegistration(text, save = true) {
    multiplayer.registration = cleanRegistration(text);
    for (const input of registrationInputs) {
        input.value = multiplayer.registration;
        input.classList.remove('invalide');
    }
    updateRegistration();
    if (save) try { localStorage.setItem('immatriculation', multiplayer.registration); } catch { /* stockage indisponible */ }
}
for (const input of registrationInputs) {
    input.addEventListener('input', () => {
        const text = input.value.toUpperCase();
        if (input.value !== text) input.value = text;
        input.classList.toggle('invalide', text !== '' && !cleanRegistration(text));
    });
    input.addEventListener('change', () => {
        if (input.value.trim() === '' || cleanRegistration(input.value)) setCustomRegistration(input.value);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
    });
}
let savedRegistration = '';
try { savedRegistration = localStorage.getItem('immatriculation') ?? ''; } catch { /* stockage indisponible */ }
setCustomRegistration(savedRegistration, false);

// Sous-titre de l'émission en cours ; la fenêtre s'ouvre d'elle-même quand un contrôleur attend un collationnement
let atcSubtitleTimer = 0;
atc.addEventListener('transmit', ({ from, text, station, label, on }) => {
    clearTimeout(atcSubtitleTimer);
    if (on) {
        const who = from === 'pilot' ? label ?? 'VOUS' : from === 'atis' ? 'ATIS' : from === 'remote' ? label : ATC_SHORT[station];
        atcSubtitle.textContent = `${who} : ${text}`;
        atcSubtitle.className = `atc-${from}`;
        atcSubtitle.hidden = false;
    } else {
        atcSubtitleTimer = setTimeout(() => { atcSubtitle.hidden = true; }, 1500);
        if (from === 'atc' && atcPanel.hidden && atc.pending && !inMenu) toggleAtc(true);
    }
});

const _atcForward = new THREE.Vector3();
// Radio de bord <-> contrôle aérien : la COM choisie au micro (boîte audio) règle la station écoutée ; un changement
// fait dans la fenêtre Tour (ou par le contrôleur) s'affiche sur cette COM. Transpondeur : même code des deux côtés
const stationOn = (khz) => Object.keys(airport.aerodrome.frequencies).find((id) => parseFrequency(airport.aerodrome.frequencies[id]) === khz) ?? null;
// Fréquence d'un autre aérodrome affichée sur la COM (en route vers lui) : c'est désormais lui qui répond (tour,
// ILS conseillé, places de parking) ; le point de départ (touche R) ne change pas
function followTunedAirport(khz) {
    if (stationOn(khz)) return;
    const other = airport.list.find((field) => Object.values(field.aerodrome.frequencies).some((f) => parseFrequency(f) === khz));
    if (other) airport.setCurrent(other);
}
function syncRadios() {
    const micCom = avionics.audio.mic, com = avionics[micCom];
    if (atc.freq !== radioSync.freq) avionics.showOnCom(micCom, parseFrequency(airport.aerodrome.frequencies[atc.freq]));
    if (atc.transponder !== radioSync.code) avionics.xpdr.code = atc.transponder;
    else if (avionics.xpdr.code !== atc.transponder) atc.setTransponder(avionics.xpdr.code);
    if (!choosingSpawn) followTunedAirport(com.active);
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
        buttons: { next: $('moniteur-continuer'), repeat: $('moniteur-repeter'), show: $('moniteur-montrer'), skipSpeech: $('moniteur-couper'), quit: $('moniteur-quitter') },
    },
    // Leçon en anglais : contrôleurs en anglais aussi (phraséologie OACI) ; langue d'avant rétablie à la fin
    setRadioLanguage: (lang) => setAtcLanguage(lang),
    // Départ : avion éteint au parking N4, en solo, vue cabine
    startCold: () => {
        multiplayer.leave();
        newWind(Math.floor(Math.random() * 2 ** 32));   // chaque leçon : nouveau vent, donc piste en service tirée à nouveau
        atc.clearLog();
        selectAirport(airport.main);   // les leçons ont lieu à ESME
        airportPanel.hidden = true;
        const spawn = airport.spawns.find((sp) => sp.id === 'stand4') ?? airport.spawns.find((sp) => sp.cold);
        closeMainMenu();
        leaveHangar();
        if (choosingSpawn) closeSpawnDialog();
        spawnAt(spawn);
        setCabinViewPreset(1);
        setMenuBar(true);
    },
    focusCabin,
    pilotView: () => setCabinViewPreset(1),
    openAtc: (open) => { if (atcPanel.hidden === open) toggleAtc(open); },
    // Pendant la leçon : vent sans dérive lente, la piste en service reste celle de l'ATIS (Tour, anneaux, moniteur)
    onChange: () => { wind.setHold(initiation.active); updateModes(); },
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
        const level = Number(button.dataset.niveau), cameraGuide = $('initiation-camera').checked;
        if (aircraftType !== 'c172') setAircraftType('c172');   // la leçon se fait sur le Cessna
        enterGame(() => {
            initiation.start(level, cameraGuide, lang);
            view.focus();
        });
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
$('moniteur-couper').addEventListener('click', keepFocus(() => initiation.skipSpeech()));
$('moniteur-quitter').addEventListener('click', keepFocus(() => {
    const message = initiation.lang === 'en' ? 'Quit the lesson? The aeroplane stays where it is, in solo mode.' : 'Quitter l\'initiation ? L\'avion reste où il est, en solo.';
    if (confirm(message)) initiation.stop();
}));
updateModes();

// Lien d'invitation : index.html?partie=CODE rejoint directement la partie
const invitation = new URLSearchParams(location.search).get('partie');
// Arrivée par le lien envoyé par un autre joueur : une seule chose à faire, cliquer « Rejoindre la partie » ; la
// fenêtre se ferme toute seule une fois dans la partie et l'on passe au choix de l'aérodrome
const invitationBox = document.getElementById('multi-invitation');
const invitationButton = document.getElementById('multi-invitation-rejoindre');
function endInvitation() {
    multiDialog.classList.remove('invitation');
    invitationBox.hidden = true;
}
if (invitation) {
    const code = invitation.toUpperCase();
    multiCode.value = code;
    document.getElementById('multi-invitation-code').textContent = code;
    invitationBox.hidden = false;
    multiDialog.classList.add('invitation');
    multiStatut.textContent = '';
    openMultiDialog();
    invitationButton.addEventListener('click', () => {
        invitationButton.disabled = true;
        invitationButton.textContent = 'Connexion…';
        multiplayer.join(code, pseudo());
    });
    multiplayer.addEventListener('status', ({ detail }) => {
        if (!detail.error || invitationBox.hidden) return;
        invitationButton.disabled = false;
        invitationButton.textContent = 'Réessayer';
    });
    multiplayer.addEventListener('joined', () => { invitationButton.textContent = 'Partie rejointe ✓'; }, { once: true });
    multiDialog.addEventListener('close', endInvitation, { once: true });
}
resumeAfterUpdate();
updateOnlineList();

// Masse et centrage (menu principal) : à la fermeture de la fenêtre, le chargement est appliqué à l'avion. Le carburant
// choisi remplit les réservoirs (et sert à chaque remise au départ) ; masse et centrage suivent ensuite le carburant
// restant, à chaque image : l'avion s'allège et son centrage avance en vol
const CG_REFERENCE = 1.0;   // m : centrage pour lequel le modèle de vol est réglé (cgOffset = 0)
const weightBalance = new WeightBalance(document.getElementById('masse-dialog'), (load) => applyLoad(load), { runwayLength: airport.runwayLength });
let currentLoad = { ...weightBalance.load };
function applyLoad(load) {
    currentLoad = { ...load };
    cessnaSystems.fuelLoad = [load.fuelLeft / WB_GALLON, load.fuelRight / WB_GALLON];
    cessnaSystems.fuel = [...cessnaSystems.fuelLoad];
    cessnaSystems.dispatchEvent(new Event('change'));
    updateLoad();
}
function updateLoad() {
    if (aircraftType !== 'c172') return;   // (masse du F-15 : voir updateJet ; R44 : masse fixe)
    const loaded = computeLoad({ ...currentLoad, fuelLeft: cessnaSystems.fuel[0] * WB_GALLON, fuelRight: cessnaSystems.fuel[1] * WB_GALLON });
    controls.model.aircraft.mass = loaded.mass;
    controls.model.cgOffset = loaded.cg - CG_REFERENCE;
}
applyLoad(weightBalance.load);
document.getElementById('mp-masse').addEventListener('click', () => weightBalance.open());
// Aussi dans la barre de menus (Échap), pendant le vol
document.getElementById('masse-bouton').addEventListener('click', (event) => {
    event.currentTarget.blur();
    closeMenus();
    weightBalance.open();
});

// Informations de vol en vue extérieure (vitesse, moteur, carburant, incidence, volets, trim, altitude, vario, cap),
// comme dans les simulateurs grand public ; cachées en cabine, au menu, au choix du départ et après un crash
const flightHud = new FlightHud(document.getElementById('hud'));
// Téléphone en portrait : jauges dimensionnées sur la largeur de l'écran (chaque rangée tient dans sa moitié : voir _row)
if (isPhone()) flightHud.designWidth = 760;
flightHud.avoid = document.getElementById('moniteur');
function updateHud(delta) {
    const visible = chaseView && !choosingSpawn && !controls.isCrashed() && settings.values.hud !== false;
    simulatorElement.classList.toggle('sans-hud', !visible);   // panneaux ILS : remis en bas sans les infos de vol
    const levels = controls.model.aircraft.flapLevels, flapMax = levels[levels.length - 1];
    const [trimMin, trimMax] = controls.getTrimLimits();
    flightHud.update(delta, visible, visible ? {
        speed: controls.getIndicatedSpeed(),
        tas: controls.getSpeed(),
        altitude: controls.getAltitude() - WHEEL_HEIGHT,
        verticalSpeed: controls.getVerticalSpeed(),
        heading: controls.getHeading(),
        rpm: systems.rpm,
        n2: aircraftType === 'f15' ? jetSystems.engines.map((e) => e.n2) : undefined,
        ab: aircraftType === 'f15' ? jetSystems.afterburner : 0,
        throttle: controls.getThrottle(),   // (F-15 : case « GAZ % » du cadran des réacteurs)
        fuel: systems.fuelFraction,
        alpha: controls.isOnGround() ? 0 : THREE.MathUtils.radToDeg(controls.model.alpha),
        stallAlpha: THREE.MathUtils.radToDeg(controls.model.stallAlpha()),
        flaps: controls.getFlaps() * flapMax,
        flapTarget: controls.getFlapSetting(),
        flapMax,
        trim: controls.getTrim(), trimMin, trimMax, takeoffTrim: controls.getTakeoffTrim(),
        baro: avionics.baro,
        windDirection: wind.direction, windSpeed: wind.speed,
    } : null);
}

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
        sideAcceleration: controls.model.sideAcceleration,
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
        // R44 : rotor et commandes (cockpit animé, voir R44Model.js)
        heli: aircraftType === 'r44' ? {
            rotorRpm: heliModel.rotorRpm, collective: controls.model.throttle,
            cyclicPitch: heliModel.cyclic.pitch, cyclicRoll: heliModel.cyclic.roll, pedal: heliModel.pedal,
            bladePitchDeg: THREE.MathUtils.radToDeg(heliModel.collective),
            coningDeg: THREE.MathUtils.clamp(heliModel.rotorThrust / 9000 * 2.2, 0, 5),
            slipDeg: THREE.MathUtils.radToDeg(heliModel.beta),
        } : null,
        jet: aircraftType === 'f15' ? {
            g: controls.model.loadFactor,
            mach: controls.getSpeed() / 340,
            alpha: controls.isOnGround() ? 0 : THREE.MathUtils.radToDeg(controls.model.alpha),
            beta: THREE.MathUtils.radToDeg(controls.model.beta),
            gear: controls.model.gearPosition,
            canopy: jetCanopy,
            // Écrans : autres avions de la partie (radar, alerte radar), radars des aérodromes
            radar: {
                position: aircraft.position,
                // (avion sous bouclier : absent du radar, comme du viseur)
                targets: remotePlayers.list().filter((p) => !p.crashed && !p.offline && !p.shielded),
                sites: airport.list.map((field) => ({ x: field.center.x, z: field.center.z })),
            },
            fuelFlowKgH: jetSystems.engines.map((e) => (e.running ? jetSystems.fuelFlow / Math.max(1, jetSystems.engines.filter((x) => x.running).length) : 0)),
            alarms: f15Warnings.alarms,   // voyants d'alarme (F15Warnings.js)
        } : null,
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
// Chaque aérodrome a son VOR et son ILS (fréquences : voir AIRPORTS dans Airport.js) ; l'ADF pointe la balise NDB
// de l'aérodrome le plus proche
const vorByKhz = new Map(airport.vors.map((station) => [parseFrequency(station.frequency), station]));
const ilsByKhz = new Map(airport.list.map((a) => [parseFrequency(a.ilsFrequency), a.ilsFrequency]));
const nearestAirport = () => airport.nearest(aircraft.position.x, aircraft.position.z);
const nearestIlsKhz = () => parseFrequency(nearestAirport().ilsFrequency);
const dmeTrack = { distance: null, kt: 0 };
function navReceiver(khz, powered, receiver, glide) {
    if (!powered) return { available: false };
    if (vorByKhz.has(khz) && receiver.station === vorByKhz.get(khz)) {
        const s = receiver.state;
        return { available: s.available && !s.overhead, deviation: s.deviation, to: s.to, glide: false, distance: s.distance };
    }
    if (ilsByKhz.has(khz) && ils.state.available && ils.state.frequency === ilsByKhz.get(khz)) {
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
        const ndb = nearestAirport().ndb;
        const bearing = Math.atan2(ndb.x - aircraft.position.x, -(ndb.z - aircraft.position.z)) * 180 / Math.PI;
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
const ils = new ILS(airport.allRunways, airport.runwayLength);

// VOR (NAV1) : balise de l'aérodrome. Indicateur au tableau de bord ; en vue extérieure, touche O.
// OBS : J / K (Maj : 10° par appui), H : centrer l'aiguille sur la route directe vers la balise
const vor = new VOR(airport.vor);
const vor2 = new VOR(airport.vor);       // NAV 2 (même balise, son propre OBS)
const vorPanel = document.getElementById('vor-panneau');
const vorCanvas = document.getElementById('vor-canvas');
let vorShown = false, vorTimer = 0;
// Indicateurs VOR et ILS en vue extérieure : affichés ou masqués ensemble par le bouton « VOR / ILS » (menu Commandes,
// commandes tactiles : sur tablette, sans clavier, le VOR n'était accessible qu'avec la touche O) ; touche O : VOR seul.
// L'ILS n'apparaît que réglé sur la NAV 1 (bouton « ILS disponible », touche I)
let ilsShown = true;
const navPanelsButton = document.getElementById('nav-panneaux');
// État du bouton : celui du VOR (masqué au départ ; l'ILS, lui, s'affiche d'office dès qu'il est réglé)
function updateNavPanelsButton() {
    const shown = vorShown;
    navPanelsButton.textContent = `VOR / ILS : ${shown ? 'affichés' : 'masqués'}`;
    navPanelsButton.classList.toggle('actif', shown);
    document.querySelector('[data-tactile="nav"]')?.classList.toggle('allume', shown);
}
function toggleNavPanels() {
    const show = !vorShown;
    vorShown = ilsShown = show;
    vorTimer = ilsTimer = 0;
    updateNavPanelsButton();
}
navPanelsButton.addEventListener('click', (event) => {
    toggleNavPanels();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) return;
    if (event.code === 'KeyJ' || event.code === 'KeyK') vor.turnCourse((event.code === 'KeyJ' ? -1 : 1) * (event.shiftKey ? 10 : 1));
    if (event.code === 'KeyH' && !event.repeat) vor.centerTo();
    if (event.code === 'KeyO' && !event.repeat) {
        vorShown = !vorShown;
        updateNavPanelsButton();
    }
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
    // Balise reçue : celle de la fréquence affichée sur chaque NAV (sinon la dernière)
    vor.station = vorByKhz.get(avionics.nav1.active) ?? vor.station;
    vor2.station = vorByKhz.get(avionics.nav2.active) ?? vor2.station;
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
const ilsCanvas = document.getElementById('ils-canvas');
const ilsText = document.getElementById('ils-texte');
let ilsTimer = 0;

// ILS : affiché sur la NAV 1 (fréquence 110.30) ; touche I et bouton en vue extérieure : y passer ou en revenir
function toggleIls() {
    avionics.toggleNav1(nearestIlsKhz());
    ilsTimer = 0;
    updateIls();
}

function updateIls(delta = 0) {
    // ILS affiché sur la NAV 1, sinon celui de l'aérodrome le plus proche (bouton « ILS disponible »)
    const tuned = ilsByKhz.get(avionics.nav1.active);
    const state = ils.update(aircraft.position, tuned ?? nearestAirport().ilsFrequency);
    ils.active = state.available && Boolean(tuned) && avionics.powered(systems).navcom1;
    const showButton = chaseView && state.available && !controls.isCrashed();
    ilsButton.hidden = !showButton;
    ilsButton.classList.toggle('actif', ils.active);
    if (showButton) ilsButton.textContent = ils.active ? `ILS ${state.runway} ✓` : `ILS ${state.runway} disponible`;

    ilsPanel.hidden = !(chaseView && ils.active && ilsShown);
    if (ilsPanel.hidden || (ilsTimer -= delta) > 0) return;
    ilsTimer = 0.1;
    // Même indicateur que le VOR (touche O), route de la piste en haut, aiguille de pente en plus
    const ctx = ilsCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#25272b';
    ctx.fillRect(0, 0, ilsCanvas.width, ilsCanvas.height);
    vorIndicator(ctx, ilsCanvas.width / 2, 112, 92, { ...state, ils: true, glide: state.distance > 0 });
    // Unités aéronautiques : distance en milles nautiques, hauteurs en pieds
    ilsText.textContent = `Piste ${state.runway} · ${(state.distance / 1852).toFixed(1)} NM\n`
        + `Hauteur ${Math.round(state.height / 0.3048)} ft (idéal ${Math.round(state.glideHeight / 0.3048)} ft)\n${ils.advice()}`;
}

ilsButton.addEventListener('click', (event) => {
    toggleIls();
    event.currentTarget.blur(); // garde le clavier pour le pilotage
});
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyI' && !event.repeat && !isTypingTarget(event.target)) toggleIls();
});

// Commande de la cabine sous le pointeur : { id, side, vertical } (voir Cockpit.controlAt)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function controlAt(event) {
    if (chaseView || choosingSpawn) return null;
    const rect = view.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // (pièces cachées ignorées : three.js les touche quand même ; dans le R44, le manche caché du copilote, devant la
    // console, prenait des clics destinés aux interrupteurs)
    const hit = raycaster.intersectObjects(cockpit.clickables, false).find((h) => shownInScene(h.object));
    return hit ? cockpit.controlAt(hit) : null;
}
function shownInScene(object) {
    for (let o = object; o; o = o.parent) if (!o.visible) return false;
    return true;
}
function obsUnderPointer(event) {
    return controlAt(event)?.id === 'obs';
}

// R44 : clic ou molette sur une commande du cockpit (zones cliquables du modèle FlightGear, voir FGAnimator) ; les
// propriétés FlightGear changées sont reportées sur les systèmes. button : 0 clic (côté droit), 2 clic côté gauche,
// 3 / 4 molette. Clé : clic à droite vers START (démarreur), à gauche vers OFF
function useR44Control(pick, button) {
    const { changed, nasal, game, file } = heliCockpit.activate(pick, button);
    // Radios (KX 165, KT 76A) : ce sont celles du jeu (contrôle aérien, VOR), réglées comme sur le Cessna
    for (const b of game) avionics.use(b.id, b.step, false);
    if (game.length) {
        r44Sound.play('click', 0.6);
        return true;
    }
    if (!changed.length && !nasal.length) return false;
    const a = heliCockpit.animator, sys = heliSystems;
    for (const name of changed) {
        const v = a.get(name);
        if (name === 'controls/electric/battery-switch') sys.switches.masterBat = Boolean(v);
        else if (name === 'controls/electric/engine/generator') sys.switches.alternator = Boolean(v);
        else if (name === 'controls/engines/engine/clutch') sys.switches.clutch = Boolean(v);
        else if (name === 'controls/engines/engine/governor') sys.switches.governor = Boolean(v);
        else if (name === 'controls/electric/key') sys.setKey(v);
        else if (name === 'controls/engines/engine/mixture') sys.setMixture(v);
        else if (name === 'sim/model/r44/controls/lighting/nav-lights') sys.switches.nav = Boolean(v);
        else if (name === 'sim/model/r44/controls/lighting/beacon') sys.switches.strobe = sys.switches.beacon = Boolean(v);
        else if (name === 'sim/multiplay/generic/bool[16]') sys.switches.land = Boolean(v);
        else if (name === 'controls/lighting/instruments-norm') sys.setPanelLights(v);
        else if (name === 'instrumentation/altimeter/setting-inhg') avionics.baro = Math.round(THREE.MathUtils.clamp(v * 33.8639, 950, 1050));
    }
    // Poignées des portes (scripts Nasal de l'intérieur) : portes avant ouvertes ou fermées
    if (nasal.length && file === 'Interior/interior.xml') {
        heliCockpit.toggleDoors();
        r44Sound.play(heliCockpit.doorsOpen ? 'door-open' : 'door-close', 1);
    }
    sys.dispatchEvent(new Event('change'));
    if (changed.some((n) => n === 'controls/electric/key')) showViewLabel(`Clé : ${['OFF', 'R', 'L', 'BOTH', 'START'][sys.key]}`);
    if (changed.some((n) => n === 'controls/engines/engine/governor')) showViewLabel(`Régulateur (GOVERNOR) : ${sys.switches.governor ? 'marche' : 'arrêt'}`);
    r44Sound.play('click', 0.8);
    return true;
}

// Action d'une commande : clic (step = côté cliqué : -1 / +1) ou molette (step = -1 / +1). fine : Maj (pas plus grand)
function useControl(control, step, wheel = false, fine = false) {
    const { id } = control;
    if (id.startsWith('jet:')) {
        if (wheel) return false;
        jetCommand(id.slice(4), step);
        sounds.click();
        return true;
    }
    if (id === 'r44') return useR44Control(control.pick, wheel ? (step > 0 ? 3 : 4) : step > 0 ? 0 : 2);
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
    else if (id.startsWith('visor:')) {
        if (wheel) return false;
        cockpit.toggleVisor(+id.split(':')[1]);
    }
    else if (id === 'mags') systems.turnMagnetos(step);
    else if (id.startsWith('switch:') || id.startsWith('breaker:')) {
        if (wheel) return false;
        systems.toggle(id.split(':')[1]);
    } else if (id === 'panelLights') systems.setPanelLights(systems.panelLights + step * 0.1);
    // Plafonnier : clic d'un côté ou de l'autre de la lampe, par quart ; molette : par dixième
    else if (id === 'domeLight') systems.setDomeLight(systems.domeLight + step * (wheel || fine ? 0.1 : 0.25));
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
    cockpit.panel.turnKnob(id, step);   // bouton rotatif : il pivote d'un cran
    if (id !== 'trimWheel') sounds.click(); // la molette de trim fait ses crans d'elle-même (voir la boucle)
    return true;
}

// Boutons rotatifs (fréquences, transpondeur, calage, cap, OBS, ADF, gyro, éclairages) : réglés à la molette seulement,
// comme un vrai bouton qu'on tourne (Maj : plus vite) ; le clic ne les change plus
const WHEEL_ONLY = /^((com|nav)[12]:(outer|inner)|xpdr:(mode|d\d)|baro|hdgBug|dg|ai|obs2?|adf|panelLights|domeLight)$/;
// En cabine : clic (sans glisser) sur une commande : interrupteurs, boutons, sélecteurs ;
// manettes (gaz, mixture) et molette de trim : moitié haute = pousser / piquer, moitié basse = tirer / cabrer
view.addEventListener('click', (event) => {
    if (dragDistance > 6) return;
    const control = controlAt(event);
    if (!control) return;
    if (WHEEL_ONLY.test(control.id)) return;   // bouton rotatif : à la molette
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
    // (manettes : flèches haut / bas, elles se glissent)
    const control = controlAt(event);
    view.style.cursor = !control ? '' : LEVERS.has(control.id) ? 'ns-resize' : 'pointer';
});

// Bruits de l'environnement : pluie (étouffée en cabine), roulement des pneus selon le revêtement
function updateSounds() {
    // Pluie là où est l'avion : rien au-dessus des nuages ; gouttes sur le pare-brise et bruit en conséquence
    const rain = storm.rainAt(camera.position.y);
    cockpit.setRain(rain);
    sounds.setLoop('rain', rain * (chaseView ? 0.8 : 0.25));
    sounds.setLoop('rainCockpit', rain * (chaseView ? 0 : 0.9));
    // (menu, hangar, choix du départ : vol figé, mais l'avion peut être resté « au sol en roulant » si on a quitté
    // en pleine course : sans ce test, le roulement des pneus continuait au menu)
    const rolling = controls.isOnGround() && !controls.isCrashed() && !choosingSpawn
        ? Math.min(1, controls.getSpeed() / 20) * 0.6 : 0;
    const surface = controls.getSurface(), grass = surface === 'grass', water = surface === 'water';
    const rate = 0.7 + controls.getSpeed() / 40;
    sounds.setLoop('rollAsphalt', grass || water ? 0 : rolling, rate);
    // Sur l'eau : le bruissement de l'herbe, plus grave et plus fort, fait le clapotis des roues qui fendent l'eau
    sounds.setLoop('rollGrass', grass ? rolling : water ? Math.min(1, rolling * 1.6) : 0, water ? rate * 0.55 : rate);
    // Moteur des volets : seulement pendant qu'ils bougent, clac de fin de course à l'arrêt ; plus fort en cabine
    // (il est dans l'aile, au-dessus)
    const flaps = controls.getFlaps();
    const moving = Math.abs(flaps - lastFlaps) > 1e-5 && !choosingSpawn;
    if (flapsMoving && !moving) sounds.play('flapsStop', { volume: chaseView ? 0.06 : 0.15 });
    flapsMoving = moving;
    lastFlaps = flaps;
    // (fichier enregistré bas, -25 dBFS ; volontairement discret)
    sounds.setLoop('flapMotor', moving ? (chaseView ? 0.08 : 0.2) : 0, 1);
    // Pompe à carburant électrique (pompe auxiliaire du c182s) : bourdonnement tant qu'elle tourne, bruit de
    // ralentissement à l'arrêt (sous le plancher, à peine audible dehors ; fichiers enregistrés bas, -34 dBFS)
    const pumpOn = systems.fuelPumpRunning && !choosingSpawn;
    if (fuelPumpOn && !pumpOn && !choosingSpawn) sounds.play('fuelPumpStop', { volume: chaseView ? 0.04 : 0.25 });
    fuelPumpOn = pumpOn;
    sounds.setLoop('fuelPump', pumpOn ? (chaseView ? 0.04 : 0.25) : 0, 1);
    // Gyroscope électrique de l'indicateur de virage (gyro.wav du c172p) : sous tension, la toupie monte en régime
    // en ~3 s ; coupée, elle ralentit en roue libre (~45 s). Hauteur du son = régime ; volume en racine du régime
    // pour que le sifflement reste audible pendant toute la décélération
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastGyroTime) / 1000);
    lastGyroTime = now;
    if (choosingSpawn) gyroSpin = 0;
    else gyroSpin = systems.turnCoordinatorPowered
        ? Math.min(1, gyroSpin + dt / 3)
        : Math.max(0, gyroSpin - dt / 45);
    const gyroLevel = choosingSpawn ? 0 : Math.sqrt(gyroSpin) * (chaseView ? 0.02 : 0.13);
    sounds.setLoop('gyro', gyroLevel, Math.max(0.05, gyroSpin));
    // Ambiance extérieure : léger souffle d'air et oiseaux, avion au sol seulement, très étouffée en cabine. Couverte
    // par le moteur : presque plus rien dès le ralenti (~800 tr/min). Pas d'oiseaux la nuit ni sous la pluie ; le
    // souffle suit le vent de la météo
    const onGround = controls.isOnGround() && !controls.isCrashed() && !choosingSpawn;
    const engineMask = THREE.MathUtils.clamp(1 - systems.rpm / 700, 0.06, 1);
    const ambience = onGround ? engineMask : 0;
    const day = 1 - (weather?.night ?? 0);
    sounds.setLoop('birds', ambience * day * (1 - rain) * (chaseView ? 0.05 : 0.01));
    sounds.setLoop('breeze', ambience * (0.4 + 0.6 * (weather?.wind ?? 0.3)) * (chaseView ? 0.15 : 0.03));
    // Feu anticollision : petit tic à chaque allumage (double éclat, en phase avec AircraftLights), rien à l'extinction.
    // Entendu de l'extérieur seulement
    const beaconLit = systems.lights.beacon && !choosingSpawn && beaconOn(clock.elapsedTime);
    if (beaconLit && !beaconWasOn && chaseView) sounds.click(0.1, 1300 + Math.random() * 200);
    beaconWasOn = beaconLit;
}

const aircraftVelocity = new THREE.Vector3();
const lastAircraftPosition = aircraft.position.clone();

// Compteur de performances (touche P) : images par seconde, temps de calcul, appels de dessin, triangles
const perfPanel = document.getElementById('perf');
const perf = { frames: 0, time: 0, cpu: 0, calls: 0, triangles: 0, last: performance.now() };
renderer.info.autoReset = false; // le post-traitement dessine en plusieurs passes : on compte l'image entière
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyP' && !event.repeat && !isTypingTarget(event.target)) settings.set('perf', !settings.values.perf);
});

// Paramètres graphiques : menu ouvert depuis la case "Paramètre" du bandeau ou le bouton ⚙ Qualité
// Tablette : qualité « Moyen » par défaut (« Haut » faisait chuter les images par seconde en vol sur iPad)
// Qualité par défaut (tant que le joueur n'a rien choisi) : téléphone « Bas » (sa mémoire est bien plus petite : en « Moyen »,
// anticrénelage, ombres, halo et décor faisaient dépasser la limite de Safari, qui fermait la page au chargement de la
// partie), tablette « Moyen », ordinateur « Haut »
const settings = new Settings({ defaultPreset: isPhone() ? 'bas' : isTablet() ? 'moyen' : 'haut' });

// Page morte pendant un chargement lourd (partie, F-15) : sur téléphone et tablette, Safari ferme la page sans prévenir
// quand elle dépasse sa mémoire. Le chargement est marqué dans le stockage du navigateur pendant qu'il dure ; marque
// encore là à l'ouverture suivante = la page est morte en chargeant : qualité ramenée à « Bas » et joueur prévenu
const LOAD_MARK = 'esme-chargement-en-cours';
function markHeavyLoad(on) {
    try {
        if (on) localStorage.setItem(LOAD_MARK, String(Date.now()));
        else localStorage.removeItem(LOAD_MARK);
    } catch { /* stockage indisponible */ }
}
let crashedWhileLoading = false;
try {
    const mark = Number(localStorage.getItem(LOAD_MARK));
    crashedWhileLoading = mark > 0 && Date.now() - mark < 20 * 60 * 1000;
    localStorage.removeItem(LOAD_MARK);
} catch { /* stockage indisponible */ }
// Page fermée pendant un chargement ou un départ : un cran plus bas (Bas, puis Très bas : décor d'origine, sans nuages).
// Avant, seulement « Bas » : sur téléphone, c'était déjà le réglage par défaut, rien ne changeait et la page refermait
const lowerPreset = settings.preset === 'tresbas' ? null : settings.preset === 'bas' ? 'tresbas' : 'bas';
if (crashedWhileLoading && lowerPreset) {
    settings.applyPreset(lowerPreset);
    const notice = document.createElement('section');
    notice.className = 'mp-carte';
    const title = document.createElement('h2');
    title.textContent = 'Qualité réduite automatiquement';
    const text = document.createElement('p');
    text.textContent = 'La page s\'est fermée pendant le dernier chargement (mémoire de l\'appareil dépassée) : la qualité graphique '
        + `est passée à « ${lowerPreset === 'tresbas' ? 'Très bas' : 'Bas'} ». Vous pourrez la remonter dans Paramètres.`;
    notice.append(title, text);
    document.getElementById('mp-astuce-ipad').before(notice);
}
const settingsDialog = document.getElementById('reglages-dialog');
let fpsLimit = 0;   // 0 = pas de limite (fréquence de l'écran)

function applySettings(values) {
    watchNewShaders();
    fpsLimit = values.fps;
    graphics.targetFps = values.fps || 60;
    graphics.setResolution(values.resolution);
    graphics.setAntialias(values.antialias);
    graphics.setShadows(values.shadows);
    graphics.setBloom(values.bloom);
    clouds.setDetail(values.clouds);
    cloudLayer.setEnabled(values.cloudLayer);
    terrain.setDetail(values.terrain);
    // Distance de vue : limite de la caméra ; la brume de beau temps s'éloigne d'autant (voir updateFog)
    viewDistance = values.visibility ?? 3000;
    camera.far = viewDistance;
    camera.updateProjectionMatrix();
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
        crosswindCorrection: values.crosswind ?? false,
    });
    heliModel.assists.heliStability = values.heliStability ?? true;   // (R44 : son propre modèle de vol)
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
        + `résolution ×${renderer.getPixelRatio().toFixed(2)}  ·  ${view.width}×${view.height}`
        + (freezeLog.length ? `
à-coups : ${freezeLog.length}  ·  dernier : ${Math.max(freezeLog.at(-1).image, freezeLog.at(-1).horsImage)} ms`
            + ` (${freezeLog.at(-1).parts[0] ?? (freezeLog.at(-1).horsImage >= FREEZE_MS ? 'hors image' : '?')})` : '');
    perfPanel.dataset.fps = (n / elapsed).toFixed(1);
    Object.assign(perf, { frames: 0, cpu: 0, calls: 0, triangles: 0, last: now });
}

// --- Enregistreur d'à-coups -----------------------------------------------------------------------------------------
// Chaque image de plus de FREEZE_MS, ou chaque trou de plus de FREEZE_MS entre deux images, est noté avec le temps
// passé dans chaque partie de la boucle (vol, réseau, autres joueurs, combat, relief, rendu…). Un trou sans image lente
// vient d'ailleurs : message réseau, chargement, ramasse-miettes (tâches longues relevées à part, et messages réseau
// lents par Multiplayer.js). Consultable dans la console : esmeFreezes() ; résumé dans le panneau de performances
const FREEZE_MS = 100;
const freezeLog = [];           // 40 derniers à-coups
const longTasks = [];           // 40 dernières tâches longues du navigateur (> 100 ms), dans ou hors des images
let frameSections = {}, sectionStart = 0, lastFrameEnd = 0;
function freezeFrameStart(now) {
    frameSections = {};
    sectionStart = now;
    freezeFrameStart.gap = lastFrameEnd ? now - lastFrameEnd : 0;   // temps hors image depuis la précédente
}
function lap(name) {
    const now = performance.now();
    frameSections[name] = (frameSections[name] ?? 0) + now - sectionStart;
    sectionStart = now;
}
function freezeFrameEnd() {
    const now = performance.now();
    const frame = Object.values(frameSections).reduce((a, b) => a + b, 0);
    const gap = freezeFrameStart.gap;
    lastFrameEnd = now;
    if (frame < FREEZE_MS && gap < FREEZE_MS) return;
    const parts = Object.entries(frameSections).filter(([, ms]) => ms >= 5).sort((a, b) => b[1] - a[1])
        .map(([name, ms]) => `${name} ${Math.round(ms)} ms`);
    freezeLog.push({
        at: Math.round(now / 1000), image: Math.round(frame), horsImage: Math.round(gap), parts,
        joueurs: multiplayer.players.size, missiles: weapons.inFlight.length + weapons.aaInFlight.length,
        avion: aircraftType, vue: chaseView ? 'extérieure' : 'cabine',
    });
    if (freezeLog.length > 40) freezeLog.shift();
}
// Onglet caché : le navigateur suspend les images ; au retour, ce trou n'est pas un à-coup
document.addEventListener('visibilitychange', () => { lastFrameEnd = 0; });
try {
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            if (entry.duration < FREEZE_MS || document.hidden) continue;
            longTasks.push({ at: Math.round(entry.startTime / 1000), ms: Math.round(entry.duration) });
            if (longTasks.length > 40) longTasks.shift();
        }
    }).observe({ type: 'longtask', buffered: false });
} catch { /* navigateur sans tâches longues (Safari) */ }
// Erreurs JavaScript pendant le jeu (40 dernières, regroupées par message) : partie du jeu, message, début de la pile,
// nombre de fois, dernière fois. Consultables dans esmeFreezes().erreurs (gardées après un rechargement automatique)
const loopErrors = [];
function recordError(part, error) {
    const message = String(error?.message ?? error).slice(0, 200);
    const stack = String(error?.stack ?? '').split(String.fromCharCode(10)).slice(1, 5).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ');
    const known = loopErrors.find((e) => e.partie === part && e.message === message);
    if (known) {
        known.fois++;
        known.derniere = Math.round(performance.now() / 1000);
        return;
    }
    loopErrors.push({ partie: part, message, pile: stack, fois: 1, premiere: Math.round(performance.now() / 1000), derniere: Math.round(performance.now() / 1000) });
    if (loopErrors.length > 40) loopErrors.shift();
    console.error(`Erreur (${part}) :`, error);
}
function guard(part, work) {
    try {
        work();
    } catch (error) {
        recordError(part, error);
    }
}
window.addEventListener('error', (event) => recordError('page', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => recordError('promesse', event.reason));

// Rapport de la session précédente, si elle s'est terminée par un rechargement automatique (voir recoverFromFreeze)
let previousFreeze = null;
try {
    previousFreeze = JSON.parse(sessionStorage.getItem('esme-freeze-precedent') ?? 'null');
    sessionStorage.removeItem('esme-freeze-precedent');
} catch { /* stockage indisponible */ }
// Retour dans la même partie après un rechargement automatique : le score d'avant est repris (victoires, fois abattu)
if (previousFreeze?.partie && previousFreeze.score) {
    multiplayer.addEventListener('joined', ({ detail }) => {
        if (detail.code !== previousFreeze.partie || previousFreeze.scoreRestored) return;
        previousFreeze.scoreRestored = true;
        multiplayer.score = { kills: previousFreeze.score.kills | 0, deaths: previousFreeze.score.deaths | 0 };
    });
}
// Accès de diagnostic depuis la console (F12) : scène, moteur de rendu, caméra
// (armes, dégâts et cibles : créés plus bas dans le fichier, lus seulement à l'usage)
window.esmeDebug = { scene, renderer, camera, controls, multiplayer, airport, terrain,
    get weapons() { return weapons; }, get damage() { return damage; }, cibles: () => lastCombatTargets.map((t) => t.name) };
window.esmeFreezes = () => ({ erreurs: loopErrors.slice(), aCoups: freezeLog.slice(), tachesLongues: longTasks.slice(), messagesLents: multiplayer.slowMessages.slice(),
    ...(previousFreeze ? { avantRechargement: previousFreeze } : {}) });

// --- Filet de sécurité contre le jeu figé pour de bon -----------------------------------------------------------------
// Page visible, code libre (le contrôle ci-dessous tourne à l'heure), mais plus aucune image depuis FREEZE_STALL ms :
// l'affichage est bloqué (carte graphique plantée ou perdue, image figée sans fin). La page se recharge alors d'elle-
// même, ce qui libère toute la mémoire (le « vidage » le plus complet), et propose de revenir dans la partie en cours
// (lien d'invitation, un clic). Le rapport d'à-coups d'avant est gardé : esmeFreezes().avantRechargement
// (Un blocage du code lui-même empêche tout contrôle : seul le navigateur peut alors arrêter la page)
const FREEZE_STALL = 8000;
let lastLoopAt = performance.now(), lastWatch = performance.now(), stalledChecks = 0, recovering = false;
function recoverFromFreeze(reason) {
    if (recovering) return;
    recovering = true;
    const code = multiplayer.code;
    try {
        sessionStorage.setItem('esme-freeze-precedent', JSON.stringify({ raison: reason, le: new Date().toISOString(), partie: code,
            score: code ? multiplayer.score : null, erreurs: loopErrors.slice(-20), aCoups: freezeLog.slice(-20), tachesLongues: longTasks.slice(-20), messagesLents: multiplayer.slowMessages.slice(-20) }));
    } catch { /* stockage indisponible */ }
    console.warn('Jeu figé, rechargement automatique :', reason);
    location.href = code ? `${location.pathname}?partie=${code}` : location.pathname;
}
setInterval(() => {
    const now = performance.now();
    const onTime = now - lastWatch < 1500;   // contrôle à l'heure : le code n'est pas bloqué
    lastWatch = now;
    if (document.hidden || !onTime || now - lastLoopAt < FREEZE_STALL) {
        stalledChecks = 0;
        return;
    }
    if (++stalledChecks >= 3) recoverFromFreeze('affichage bloqué (plus aucune image)');
}, 1000);
document.addEventListener('visibilitychange', () => { lastLoopAt = performance.now(); });

// Ménage régulier (toutes les 2 min) : listes de dessin de three.js refaites, explosions de réserve au-delà de 4
// libérées, suivi des joueurs partis oublié
setInterval(() => {
    renderer.renderLists.dispose();
    while (spareCrashes.length > 4) spareCrashes.pop().dispose();
    for (const id of playerTrack.keys()) if (!multiplayer.players.has(id)) playerTrack.delete(id);
}, 120000);

let nextFrameTime = 0;
let lastTrim = controls.getTrim(), trimTravel = 0, lastFlaps = 0, flapsMoving = false;
// Mixture au clavier : U enrichit (pousse), Y appauvrit (tire), tant que la touche est tenue (course entière en ~2,5 s)
const MIXTURE_RATE = 0.4;
const mixtureKeys = { KeyU: 0, KeyY: 0 };
window.addEventListener('keydown', (event) => {
    if (event.code in mixtureKeys && !isTypingTarget(event.target)) mixtureKeys[event.code] = 1;
    // F-15 : Y sort / rentre le train, U sort / rentre l'aérofrein (pas de mixture sur un réacteur)
    if (aircraftType !== 'f15' || event.repeat || isTypingTarget(event.target) || choosingSpawn || controls.isCrashed()) return;
    if (event.code === 'KeyY') toggleGear();
    if (event.code === 'KeyU') toggleSpeedbrake();
});
window.addEventListener('keyup', (event) => {
    if (event.code in mixtureKeys) mixtureKeys[event.code] = 0;
});
window.addEventListener('blur', () => { mixtureKeys.KeyU = mixtureKeys.KeyY = 0; panelLightsKey = 0; });
// R44 au clavier (en plus des commandes du cockpit, à la souris) : Y / U ferment / ouvrent la poignée des gaz (voir
// updateHeli) ; T embraye ou débraye le rotor (CLUTCH), Maj + T : MASTER BATT ; G : régulateur (GOVERNOR), Maj + G :
// alternateur ; X tourne la clé vers START (démarreur), Maj + X en arrière (portes : clic sur leur poignée).
// (W / X, trim des avions, et G / T, volets : sans objet sur le R44)
window.addEventListener('keydown', (event) => {
    if (aircraftType !== 'r44' || event.repeat || isTypingTarget(event.target) || choosingSpawn || controls.isCrashed()) return;
    const name = event.code === 'KeyT' ? (event.shiftKey ? 'masterBat' : 'clutch')
        : event.code === 'KeyG' ? (event.shiftKey ? 'alternator' : 'governor') : event.code === 'KeyX' ? 'key' : null;
    if (name) heliCommand(name, event.shiftKey ? -1 : 1);
});
// Commandes du R44 (clavier, tablette) : interrupteurs (masterBat, clutch, alternator, governor, nav, strobe, land),
// clé (key, step : +1 vers START, -1 vers OFF), mixture ; message affiché, déclic
function heliCommand(name, step = 1) {
    const sys = heliSystems;
    let text;
    if (name === 'key') {
        sys.turnMagnetos(step);
        text = `Clé : ${['OFF', 'R', 'L', 'BOTH', 'START'][sys.key]}${sys.key === 4 ? ' (démarreur)' : ''}`;
    } else if (name === 'mixture') {
        sys.setMixture(sys.mixture > 0.5 ? 0 : 1);
        text = `Mixture : ${sys.mixture > 0.5 ? 'riche (poussée)' : 'coupée (tirée)'}`;
    } else {
        sys.toggle(name);
        const on = sys.switches[name];
        text = {
            masterBat: `MASTER BATT : ${on ? 'marche' : 'arrêt'}`,
            clutch: on ? 'CLUTCH : embrayage (tension des courroies ~20 s)' : 'CLUTCH : débrayage',
            alternator: `Alternateur (ALT) : ${on ? 'marche' : 'arrêt'}`,
            governor: on ? 'Régulateur (GOVERNOR) : marche (actif au-dessus de 80 %)' : 'Régulateur (GOVERNOR) : arrêt',
        }[name] ?? null;
    }
    r44Sound.play('click', chaseView ? 0.4 : 0.8);
    if (text) showViewLabel(text);
}
// Éclairage des instruments au clavier : L éclaircit, Maj + L assombrit, tant que la touche est tenue (course entière en ~2 s)
const PANEL_LIGHTS_RATE = 0.5;
let panelLightsKey = 0, panelLightsTravel = 0;
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyL' && !isTypingTarget(event.target)) panelLightsKey = event.shiftKey ? -1 : 1;
});
window.addEventListener('keyup', (event) => {
    if (event.code === 'KeyL') panelLightsKey = 0;
});

// Shaders compilés en arrière-plan (compileAsync, KHR_parallel_shader_compile) quand de nouveaux objets arrivent dans la
// scène : sinon, la première image qui les montre fige la page le temps de les compiler (plusieurs secondes sur un
// portable). Pendant les phases de chargement (lancement, départ, autre aérodrome, réglages), une fois par seconde :
// nombre d'objets changé -> compilation ; l'image n'est pas redessinée tant qu'elle dure (8 s au plus)
function watchNewShaders(seconds = 30) {
    warmCheckUntil = Math.max(warmCheckUntil, performance.now() + seconds * 1000);
}
// Objets dessinés de la scène, sans les objets passagers (missiles, fumées, explosions, leurres, avions des autres
// joueurs : marqués userData.transient, leurs shaders sont prêts d'avance ou compilés à part, voir prepareForDisplay).
// Avant, ils étaient comptés : en combat, leur nombre changeait sans cesse, et pendant les 30 s qui suivent chaque
// apparition (départ, touche R, retour après avoir été abattu) toute la scène était recompilée chaque seconde, le
// dessin suspendu pendant ce temps : le jeu se figeait par à-coups, plusieurs secondes d'affilée
function countSceneObjects() {
    let objects = 0;
    const visit = (o) => {
        if (o.userData.transient) return;
        if (o.isMesh || o.isPoints || o.isLine || o.isSprite) objects++;
        for (const child of o.children) visit(child);
    };
    visit(scene);
    return objects;
}
const MAX_RENDER_PAUSE = 250;
const MENU_FPS = 30;            // images/s au plus derrière le menu principal   // ms : le dessin n'attend jamais plus longtemps une compilation en arrière-plan
let shaderWarmupStart = 0;
function checkNewShaders(now) {
    if (shaderWarmup || now > warmCheckUntil || now < nextWarmCheck) return;
    nextWarmCheck = now + 1000;
    const objects = countSceneObjects();
    if (objects === sceneObjects) return;
    sceneObjects = objects;
    const timeout = new Promise((resolve) => setTimeout(resolve, 8000));
    // Compilés pour la cible où la scène est vraiment dessinée (post-traitement, voir Graphics) : sinon, autre variante
    // des shaders (espace de couleur, tone mapping), recompilée quand même à la première image
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(graphics.composer.renderTarget1);
    const compiling = renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(previous);
    shaderWarmupStart = now;
    shaderWarmup = Promise.race([compiling, timeout]).catch(() => {}).finally(() => { shaderWarmup = null; });
}
watchNewShaders(120);

// Commandes tactiles (tablettes) : manche, gaz et boutons sur l'écran de vol (voir TouchControls.js)
const touchControls = new TouchControls(document.getElementById('tactile'), controls, {
    view: () => toggleView(),
    recenter: () => recenterCamera(),
    menu: () => setMenuBar(!simulatorElement.classList.contains('barre')),
    flaps: (step) => controls.setFlapLevel(controls.getFlapLevel() + step),
    train: () => toggleGear(),
    aerofrein: () => toggleSpeedbrake(),
    feu: (on) => pullTrigger(on),
    arme: () => switchWeapon(),
    leurres: () => dropFlares(),
});
// Boutons propres au F-15 (train, aérofrein) : montrés seulement en F-15 ; allumés train sorti / aérofrein sorti
document.addEventListener('aircraft-change', ({ detail }) => {
    for (const button of document.querySelectorAll('#tactile [data-jet]')) button.hidden = detail !== 'f15';
    // Menu Commandes : aide du clavier de l'avion ou du R44 (collectif, cyclique, mise en route) ; pas de volets sur le R44
    const heli = detail === 'r44';
    for (const row of document.querySelectorAll('#commandes [data-aide]')) row.hidden = (row.dataset.aide === 'r44') !== heli;
    flapsButton.hidden = heli;
});
updateNavPanelsButton();

// Interface tablette (boutons SOL / SYSTÈMES, panneaux de tuiles déplaçables) : sur tablette seulement, en vol, en plus de
// la barre de menus. Le contenu est décrit dans TabletRegistry.js ; tabletApi lui donne accès aux fonctions existantes
const tabletApi = {
    get systems() { return systems; },
    jetSystems, jet: () => aircraftType === 'f15', jetCommand, jetGear: () => controls.model.gearDown, jetSpeedbrake: () => controls.model.speedbrakeOut,
    heliSystems, heliModel, heliCommand, heli: () => aircraftType === 'r44',
    controls, vor, atc, MAGNETOS, FUEL_SELECTOR,
    click: (id) => document.getElementById(id)?.click(),
    // Contenu d'un menu de la barre (Météo, Profil, En ligne), affiché dans un panneau sur iPad
    menuContent: (id) => menuContent.get(document.getElementById(id)),
    atcStation: () => atcButton.textContent.toUpperCase(),
    useControl: (control, step, wheel = false) => useControl(control, step, wheel),
    // Menu de la barre (Profil…) : barre affichée, menu déroulé
    openBarMenu: (id) => {
        setMenuBar(true);
        const title = document.querySelector(`#${id} .menu-titre`);
        if (title?.getAttribute('aria-expanded') !== 'true') title?.click();
    },
    trimDegrees: () => THREE.MathUtils.radToDeg(controls.trim),
    setBrakes: (on) => { touchControls.holdBrake = on; },
    toggleNavPanels, navPanelsShown: () => vorShown,
    toggleIls, ilsLabel: () => (ils.active ? 'RÉGLÉ' : 'NON RÉGLÉ'),
    toggleMap: () => toggleMap(), mapOpen: () => !mapPanel.hidden,
    toggleAtc: () => toggleAtc(), atcOpen: () => !atcPanel.hidden,
    setAtcVoice, setAtcLanguage,
    setTalking: (on) => radio.setTalking(on),
    toggleView, recenterCamera, chaseView: () => chaseView,
    cabinView: () => (chaseView ? '—' : cabinView),
    stepCabinView: (step) => {
        const i = VIEW_ORDER.indexOf(cabinView);
        setCabinViewPreset(chaseView ? 1 : VIEW_ORDER[(i + step + VIEW_ORDER.length) % VIEW_ORDER.length]);
    },
    togglePhotoMode: () => {
        tabletPanels?.closeAll();
        setPhotoMode(!simulatorElement.classList.contains('photo'));
    },
    photoMode: () => simulatorElement.classList.contains('photo'),
    toggleFullscreen, fullscreen: () => Boolean(fullscreenElement()),
    setting: (key) => settings.values[key],
    toggleSetting: (key) => settings.set(key, key === 'hud' ? settings.values.hud === false : !settings.values[key]),
    weatherLabel: () => WEATHERS[weatherName]?.label ?? weatherName,
    stepWeather: (step) => {
        const names = Object.keys(WEATHERS);
        setWeather(names[(names.indexOf(weatherName) + step + names.length) % names.length]);
    },
    openSettings: () => openSettings(),
};
const tabletPanels = isTablet() ? new TabletPanels(document.getElementById('tablette-ui'), tabletRegistry(tabletApi), {
    // Panneaux posés à droite de la rose des caps (HUD) et du panneau du moniteur (Initiation), en haut à gauche
    leftReserve: () => tabletLeftReserve(),
    // Ne pas poser un panneau, par défaut, sur les jauges, la rose des caps, le moniteur ou les commandes tactiles
    obstacles: () => {
        const rects = [];
        const hud = document.getElementById('hud');
        if (!hud.hidden && flightHud.boxes) {
            const r = hud.getBoundingClientRect();
            for (const b of flightHud.boxes) rects.push({ x: r.left + b.x, y: r.top + b.y, w: b.w, h: b.h });
        }
        for (const node of [document.getElementById('moniteur'), ...document.getElementById('tactile').children]) {
            if (!node || node.hidden || !node.offsetWidth) continue;
            const r = node.getBoundingClientRect();
            rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
        }
        return rects;
    },
    // Un seul panneau flottant à la fois sur iPad : fenêtre radio et carte refermées
    onOpen: () => {
        if (!atcPanel.hidden) toggleAtc(false);
        if (!mapPanel.hidden) toggleMap(false);
    },
}) : null;
// Largeur occupée en haut à gauche (px) : rose des caps, panneau du moniteur
function tabletLeftReserve() {
    const cap = flightHud.boxes?.find((b) => b.name === 'CAP');
    const monitor = document.getElementById('moniteur');
    const area = simulatorElement.getBoundingClientRect();
    const monitorRight = monitor && !monitor.hidden && monitor.offsetWidth ? monitor.getBoundingClientRect().right - area.left : 0;
    return Math.max(cap && !document.getElementById('hud').hidden ? cap.x + cap.w : 0, monitorRight) + 8;
}
if (touchControls.enabled) escapeHint.textContent = '☰ Menus : afficher les menus';

// Collision avec les autres avions : garés (aérodromes) et ceux des autres joueurs, à leur forme (voir PlaneCollision.js)
const _unitScale = new THREE.Vector3(1, 1, 1);
const otherPlanes = [], remoteMatrices = [];   // (matrices des autres joueurs réutilisées d'une image à l'autre)
// Deux joueurs qui apparaissent l'un sur l'autre (même départ choisi, touche R, retour au départ après un crash) :
// avant, ils s'écrasaient tous les deux à l'instant même. Un joueur qui apparaît en touchant déjà l'autre devient
// traversable pour lui ; la collision revient dès qu'ils ne se touchent plus. Même règle des deux côtés :
// - nous apparaissons : remise au départ (événement reset) ;
// - un autre joueur apparaît : son compteur d'apparitions change (envoyé avec sa position, voir Multiplayer.js). Son
//   avion peut glisser quelques images jusqu'à sa nouvelle place (RemotePlayers ne le replace d'un coup qu'au-delà de
//   60 m) : l'apparition compte pendant APPEAR_WINDOW. Joueur d'une ancienne version (sans compteur) : un saut de plus
//   de PLAYER_JUMP d'une image à l'autre compte comme une apparition
// Un avion qui nous rattrape ou nous percute en vol n'est jamais concerné : il n'apparaît pas, il arrive
const APPEAR_WINDOW = 1500;                 // ms
const PLAYER_JUMP = 30;                     // m (en vol : ~1 m par image au plus)
const ghostPlayers = new Set();             // joueurs traversables tant qu'ils nous touchent (identifiants)
const playerTrack = new Map();              // identifiant -> { position, spawns, appearUntil } au dernier contrôle
const _oneMatrix = [];
let spawnCount = 0, ownAppearUntil = 0;
controls.addEventListener('reset', () => {
    spawnCount++;
    ownAppearUntil = performance.now() + APPEAR_WINDOW;
});
function checkPlaneCollisions() {
    if (choosingSpawn || controls.isCrashed()) return;
    otherPlanes.length = 0;
    otherPlanes.push(...airport.parkedPlanes);
    if (multiplayer.code) {
        const now = performance.now();
        let i = 0;
        for (const player of remotePlayers.list()) {
            if (player.offline || player.crashed || !player.quaternion) {
                playerTrack.delete(player.id);   // (son retour sera une apparition)
                ghostPlayers.delete(player.id);
                continue;
            }
            const matrix = remoteMatrices[i++] ??= new THREE.Matrix4();
            matrix.compose(player.position, player.quaternion, _unitScale);
            _oneMatrix[0] = matrix;
            matrix.planeType = player.type;
            const touching = planesCollide(aircraft, _oneMatrix, aircraftType);
            const spawns = multiplayer.players.get(player.id)?.spawns ?? null;
            let seen = playerTrack.get(player.id);
            if (!seen) {
                seen = { position: player.position.clone(), spawns, appearUntil: now + APPEAR_WINDOW };
                playerTrack.set(player.id, seen);
            } else if (spawns !== seen.spawns || seen.position.distanceTo(player.position) > PLAYER_JUMP) {
                seen.appearUntil = now + APPEAR_WINDOW;
            }
            seen.spawns = spawns;
            seen.position.copy(player.position);
            // (catapulte : accroché, lancé, et 3 s après : un autre joueur sur le pont, sur la même catapulte ou juste
            // devant, se traverse ; avant, l'avion lancé explosait contre lui au bout de la rampe)
            const catapulting = carrierOps.launch || carrierOps.onCat || now < launchGhostUntil;
            if (touching && (now < seen.appearUntil || now < ownAppearUntil || catapulting)) ghostPlayers.add(player.id);
            else if (!touching) ghostPlayers.delete(player.id);
            if (!ghostPlayers.has(player.id)) otherPlanes.push(matrix);
        }
    } else {
        ghostPlayers.clear();
        playerTrack.clear();
    }
    if (planesCollide(aircraft, otherPlanes, aircraftType)) controls.collide('Collision avec un autre avion');
}

// --- Combat (F-15) : canon M61, missiles air-sol AGM-65, dégâts (voir Weapons.js, Damage.js, WeaponHud.js) ---------
// Touches : ↑ (tenir) canon ; ↓ mode air-sol (croix rouge au sol, qui suit la souris ; clic : la poser) ;
// → missile sur la croix ; ← reprendre la croix posée. Armes seulement en F-15, en vol. Dégâts subis sur les deux avions.
const weapons = new Weapons(scene, { terrain });
const damage = new Damage();
const ownSmoke = new SmokeTrail(scene);
const weaponHud = new WeaponHud(document.getElementById('armement'), view);
const OWN_SMOKE_SOURCE = { f15: new THREE.Vector3(0, 0.4, 8.5), c172: new THREE.Vector3(0, 0.3, -4), r44: new THREE.Vector3(0, 0.2, 0) };
const _smokeSource = new THREE.Vector3();
let pointerNdc = null;   // souris sur la vue (coordonnées -1 -> 1) : la croix rouge la suit

// Bouclier après le décollage (multijoueur, convention de la partie) : pendant SHIELD_TIME s après avoir quitté le sol,
// l'avion ne peut être ni touché ni verrouillé, et ne peut pas tirer. Bulle bleue visible de tous (Shield.js).
// Il faut être resté SHIELD_GROUND s au sol (rebond à l'atterrissage, touch-and-go : pas de nouveau bouclier) ; un
// départ, même en vol, et l'arrivée dans une partie en vol en donnent un.
const SHIELD_TIME = 10, SHIELD_GROUND = 3;   // s
let shieldUntil = 0, shieldGroundTime = SHIELD_GROUND;
const ownShield = new Shield(aircraftType);
aircraft.add(ownShield.mesh);
controls.addEventListener('reset', () => {
    shieldUntil = 0;
    shieldGroundTime = SHIELD_GROUND;
});
const shieldLeft = () => Math.max(0, (shieldUntil - performance.now()) / 1000);
function updateShield(delta) {
    if (!multiplayer.code || controls.isCrashed() || choosingSpawn || inHangar) {
        shieldUntil = 0;
        shieldGroundTime = SHIELD_GROUND;
    } else if (controls.isOnGround()) {
        shieldGroundTime += delta;
    } else {
        if (shieldGroundTime >= SHIELD_GROUND) shieldUntil = performance.now() + SHIELD_TIME * 1000;
        shieldGroundTime = 0;
    }
    ownShield.setType(aircraftType);
    ownShield.update(shieldLeft(), clock.elapsedTime, chaseView);   // (en cabine : seulement le bandeau du HUD)
}

// En vol, prêt au combat (leurres) ; armes : en plus, hors bouclier
const combatReady = () => aircraftType === 'f15' && !choosingSpawn && !inHangar && !inMenu && !controls.isCrashed()
    && !controls.isOnGround();
const weaponsArmed = () => combatReady() && shieldLeft() === 0;
function weaponsBlocked() {
    if (controls.isOnGround()) return "Armes : seulement en vol (décollez d'abord)";
    const left = shieldLeft();
    return left > 0 ? `Armes bloquées encore ${Math.ceil(left)} s après le décollage (bouclier)` : 'Armes indisponibles';
}
const inFlightScreen = () => !choosingSpawn && !inHangar && !inMenu && !document.querySelector('dialog[open]');
function screenNdc(event) {
    const r = view.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width * 2 - 1, y: -((event.clientY - r.top) / r.height) * 2 + 1 };
}
// Commandes de tir (F-15, en vol) : deux armes, on en choisit une (cartes en haut de l'écran, voir WeaponHud.js)
// - clic droit (ou ↓) : changer d'arme (CANON <-> MISSILE) ;
// - clic gauche (ou → ou ↑) : tirer avec l'arme choisie. Canon : tant qu'on tient (il chauffe : lâcher pour le refroidir) ;
//   missile : la croix rouge suit la souris au sol, le clic tire le missile exactement là (point d'impact marqué,
//   compte à rebours), puis le pylône suivant se recharge (1,5 s).
// Le clic droit glissé tourne toujours la caméra. Tablette : boutons ARME et FEU (missile : ou toucher le sol).
let mouseFiring = false;
view.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') pointerNdc = screenNdc(event);
});
view.addEventListener('pointerleave', () => { pointerNdc = null; });
view.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !weaponsArmed() || controlAt(event)) return;
    if (event.pointerType === 'mouse') {
        drag = null;   // (le clic gauche tire : pas de rotation de la caméra)
        if (weapons.selected === 'gun') {
            mouseFiring = true;
            setTrigger(true);
        } else if (weapons.selected === 'aa') {
            fireAA();
        } else {
            camera.updateMatrixWorld();
            fireMissile(screenNdc(event));
        }
    }
});
view.addEventListener('pointerup', (event) => {
    if (event.button === 0 && mouseFiring) {
        mouseFiring = false;
        setTrigger(false);
        return;
    }
    if (!weaponsArmed() || dragDistance > 6) return;
    if (event.pointerType === 'mouse' && event.button === 2) switchWeapon();   // clic droit (sans glisser)
    else if (event.pointerType !== 'mouse' && weapons.selected === 'missile' && !controlAt(event)) {
        // Doigt sur le sol, en mode missile : missile sur ce point
        camera.updateMatrixWorld();
        fireMissile(screenNdc(event));
    }
});

function switchWeapon() {
    if (aircraftType !== 'f15') return weaponHud.message('Armes : seulement sur le F-15');
    mouseFiring = false;
    weapons.select();
}
weapons.addEventListener('select', ({ detail }) => {
    // Petit « clac » du sélecteur d'arme
    sounds.click(0.6, detail.weapon === 'gun' ? 1800 : 1100);
    setTimeout(() => sounds.click(0.45, detail.weapon === 'gun' ? 1300 : 800), 70);
});
weapons.addEventListener('overheat', () => {
    weaponHud.message('Canon en surchauffe : lâchez la détente', true);
    sounds.click(0.5, 500);
});
function setTrigger(on) {
    weapons.trigger = on;
    if (on && aircraftType === 'f15' && !weaponsArmed() && inFlightScreen()) {
        weaponHud.message(weaponsBlocked());
    }
}
// Missile sur le point visé à l'écran (ndc ; null : là où est la croix, sous la souris ou au centre)
function fireMissile(ndc = null) {
    if (aircraftType !== 'f15') return weaponHud.message('Armes : seulement sur le F-15');
    if (!weaponsArmed()) return weaponHud.message(weaponsBlocked());
    if (weapons.selected !== 'missile') weapons.select('missile');
    camera.updateMatrixWorld();
    weapons.fireMissileAt(camera, ndc ?? pointerNdc, aircraft, controls.model.velocity, multiplayer.id, multiplayer.name);
}
// Missile air-air sur l'avion verrouillé
function fireAA() {
    if (!weaponsArmed()) return weaponHud.message(weaponsBlocked());
    weapons.fireAA(aircraft, controls.model.velocity, multiplayer.id, multiplayer.name);
}
// Tir avec l'arme choisie (clavier ↑, bouton FEU)
function pullTrigger(on) {
    if (weapons.selected === 'gun') setTrigger(on);
    else if (!on) return;
    else if (weapons.selected === 'aa') fireAA();
    else fireMissile();
}
// Autodirecteur verrouillé : « LOCK, LOCK » (voix d'alarme du F-15)
weapons.addEventListener('lock', ({ detail }) => {
    f15Warnings.announce('lock');
    weaponHud.message(`LOCK : ${detail.name} — tirez !`, true);
});
// Notre missile air-air part : refait chez les autres joueurs (et la cible est prévenue)
weapons.addEventListener('aamissile', ({ detail }) => {
    multiplayer.sendAAMissile(detail);
    weaponHud.message('FOX 2 !', true);
    f15Warnings.announce('fox2');
});
// Leurres (←) : envoyés aux autres (ils les voient, et les missiles leurrés le sont chez tous)
function dropFlares() {
    if (aircraftType !== 'f15') return weaponHud.message('Leurres : seulement sur le F-15');
    if (!combatReady()) return weaponHud.message("Leurres : seulement en vol (décollez d'abord)");
    weapons.dropFlares(aircraft, controls.model.velocity, multiplayer.id, { afterburner: jetSystems.afterburner });
}
weapons.addEventListener('flares', ({ detail }) => {
    multiplayer.sendFlares(detail);
    sounds.click(0.5, 600);
    setTimeout(() => sounds.click(0.4, 500), 90);
    if (detail.decoyed.length) weaponHud.message(`Missile leurré ! (${detail.decoyed.length})`);
});
multiplayer.addEventListener('flares', ({ detail }) => {
    weapons.addRemoteFlares(new THREE.Vector3().fromArray(detail.position), new THREE.Vector3().fromArray(detail.velocity), detail.decoyed);
});
multiplayer.addEventListener('aamissile', ({ detail }) => {
    weapons.addRemoteAA({ from: new THREE.Vector3().fromArray(detail.from), velocity: new THREE.Vector3().fromArray(detail.velocity),
        targetId: detail.targetId, missileId: detail.missileId }, detail.id, detail.name, camera.position);
    if (detail.atMe && !controls.isCrashed() && shieldLeft() === 0) {
        // (alerte de tir : tonalité du détecteur radar du vrai F-15, voir WeaponSounds.rwr ; plus de voix « Missile »)
        weaponHud.message(`MISSILE EN APPROCHE ! (${detail.name}) ← : LEURRES`, true);
    }
});
window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft'].includes(event.code)) return;
    if (!inFlightScreen()) return;
    event.preventDefault();
    if (event.repeat) return;
    if (aircraftType !== 'f15') return weaponHud.message('Armes : seulement sur le F-15');
    // → (ou ↑) : tire avec l'arme choisie, comme le clic gauche (canon : tant qu'on la tient ; AIM-9 : sur l'avion
    // verrouillé ; AGM-65 : sur la croix rouge). Avant, → tirait toujours au canon, quelle que soit l'arme choisie
    if (event.code === 'ArrowUp' || event.code === 'ArrowRight') pullTrigger(true);
    else if (event.code === 'ArrowLeft') dropFlares();
    else switchWeapon();
});
window.addEventListener('keyup', (event) => {
    if (event.code === 'ArrowUp' || event.code === 'ArrowRight') setTrigger(false);
});
window.addEventListener('blur', () => {
    setTrigger(false);
    weapons.gunKey = false;
});

// Nos obus touchent un joueur : envoyé au joueur touché ; nos missiles : refaits chez les autres
weapons.addEventListener('hits', ({ detail }) => multiplayer.sendHit(detail.id, detail.zones));
weapons.addEventListener('missile', ({ detail }) => multiplayer.sendMissile(detail));
weapons.addEventListener('message', ({ detail }) => weaponHud.message(detail.text));
// Missile qui explose (le nôtre ou celui d'un autre joueur) : boule de feu, bruit (retardé de loin), souffle sur notre avion
weapons.addEventListener('explosion', ({ detail }) => {
    startExplosion(detail.position);
    const distance = detail.position.distanceTo(camera.position);
    // Explosion de missile enregistrée (F-15 de FlightGear) ; pas encore chargée : bruit d'explosion du jeu
    const blastVolume = THREE.MathUtils.clamp(150 / distance, 0.08, 1), blastDelay = Math.min(4, distance / 343);
    if (!weapons.sounds.explosion(blastVolume, blastDelay)) sounds.play('crash', { volume: blastVolume, delay: blastDelay });
    if (distance < 400) shake = Math.max(shake, 0.8 * (1 - distance / 400));
    if (controls.isCrashed() || choosingSpawn || inHangar) return;
    if (detail.kind === 'aa') return;   // (missile air-air : les dégâts viennent du tireur, voir Weapons.js)
    if (controls.isOnGround() || shieldLeft() > 0) return;   // au sol ou sous bouclier : intouchable (anti spawn-kill)
    if (!detail.own && !isEnemy(detail.ownerId)) return;   // (Wardog : missile d'un équipier, sans effet sur nous)
    const attacker = detail.own ? { id: null, name: 'votre propre missile' } : { id: detail.ownerId, name: detail.ownerName };
    damage.applyBlast(aircraft.position.distanceTo(detail.position), attacker, aircraftType !== 'f15');
});
multiplayer.addEventListener('missile', ({ detail }) => {
    weapons.addRemoteMissile({
        from: new THREE.Vector3().fromArray(detail.from), velocity: new THREE.Vector3().fromArray(detail.velocity),
        target: new THREE.Vector3().fromArray(detail.target),
    }, detail.id, detail.name, camera.position);
});
// Obus d'un autre joueur sur notre avion
multiplayer.addEventListener('hit', ({ detail }) => {
    // Au sol : intouchable (pas d'avion abattu au départ, au parking ou en roulant) ; Wardog : pas de tir ami
    if (controls.isCrashed() || choosingSpawn || inHangar || controls.isOnGround() || shieldLeft() > 0 || !isEnemy(detail.id)) return;
    damage.applyHits(detail.zones, { id: detail.id, name: detail.name }, aircraftType !== 'f15');
});
damage.addEventListener('hit', () => {
    weaponHud.flash = 1;
    shake = Math.max(shake, 0.3);
    weapons.sounds.strike();   // obus qui frappent le fuselage (enregistrement du F-15)
});
// Abattu : annoncé une seule fois par vie (le tireur s'ajoute la victoire, voir l'événement 'kill'), compté dans notre
// score. Avant, seule la destruction par les dégâts comptait : un avion touché qui finissait au sol (réacteurs coupés,
// commandes molles) ne rapportait rien à personne, et c'était le cas le plus fréquent
let deathReported = false;
const KILL_CREDIT_TIME = 30000;   // ms : crash dans les 30 s après un coup reçu -> victoire au dernier tireur
function reportDeath(attackerId, reason) {
    if (deathReported) return;
    deathReported = true;
    multiplayer.sendKill(attackerId, reason);
    if (multiplayer.code) {
        multiplayer.score.deaths++;   // (score : voir updateScores)
        flashScore(attackerId);
    }
    // Wardog troll : abattu par un joueur (pas un simple crash) ; console : pourquoi l'écran n'apparaît pas, le cas échéant
    console.info('[troll] abattu', { tireur: attackerId, mode: multiplayer.mode, troll: multiplayer.troll });
    if (attackerId && wardog() && multiplayer.troll) showTroll();
}

// Wardog troll : abattu -> image en grand et refrain de « What is Love » (TROLL_SONGS, extrait à fournir, voir
// asset/troll/LISEZMOI.txt), de TROLL_START à TROLL_START + TROLL_TIME ; un clic ferme plus tôt
const TROLL_SONGS = ['mp3', 'm4a', 'ogg', 'wav'].map((ext) => `asset/troll/what-is-love.${ext}`);   // (le premier présent)
const TROLL_START = 15;     // s : début du refrain dans le fichier (15 : entrée du lead synthé de la boucle générée)
const TROLL_TIME = 12000;   // ms
const trollPanel = document.getElementById('troll');
const trollMissing = document.createElement('small');   // (musique introuvable : dit quel fichier ajouter)
trollPanel.append(trollMissing);
let trollAudio = null, trollTimer = 0;
function hideTroll() {
    clearTimeout(trollTimer);
    trollPanel.hidden = true;
    trollAudio?.pause();
}
// Premier fichier de la liste qui se lit (null : aucun)
async function trollSong() {
    for (const src of TROLL_SONGS) {
        const audio = new Audio(src);
        const ok = await new Promise((resolve) => {
            audio.addEventListener('canplay', () => resolve(true), { once: true });
            audio.addEventListener('error', () => resolve(false), { once: true });
            audio.load();
        });
        if (ok) return audio;
    }
    return null;
}
let trollLoading = null;
async function showTroll() {
    trollPanel.hidden = false;
    trollMissing.textContent = '';
    clearTimeout(trollTimer);
    trollTimer = setTimeout(hideTroll, TROLL_TIME);
    trollAudio ??= await (trollLoading ??= trollSong());
    if (!trollAudio) {
        trollLoading = null;   // (fichier ajouté entre-temps : retrouvé la fois suivante)
        trollMissing.textContent = 'Musique introuvable : ajoutez asset/troll/what-is-love.mp3';
        return;
    }
    if (trollPanel.hidden) return;   // (fermé pendant le chargement)
    trollAudio.volume = 0.9;
    trollAudio.currentTime = TROLL_START;
    trollAudio.play().catch((error) => { trollMissing.textContent = `Musique bloquée par le navigateur (${error.name})`; });
}
trollPanel.addEventListener('click', hideTroll);
damage.addEventListener('destroyed', ({ detail }) => {
    if (controls.isCrashed()) return;
    reportDeath(detail.attackerId, detail.reason);
    controls.collide(detail.reason);
});
controls.addEventListener('crash', ({ reason }) => {
    if (deathReported || !damage.attackerId || performance.now() - damage.lastHit > KILL_CREDIT_TIME) return;
    reportDeath(damage.attackerId, `Abattu par ${damage.attacker} (${reason.toLowerCase()})`);
});
multiplayer.addEventListener('kill', ({ detail }) => {
    chat.add(null, detail.byName ? `💥 ${detail.byName} a abattu ${detail.name}` : `💥 ${detail.name} : ${detail.reason}`);
    if (detail.mine) {
        multiplayer.score.kills++;   // la victime nous désigne comme tireur : victoire pour nous
        weaponHud.message(`${detail.name} abattu ! +${POINTS_PER_KILL} points`, true);
    }
    flashScore(detail.mine ? multiplayer.id : detail.by);
});

// --- Mode Wardog : deux équipes, capture des terrains ---------------------------------------------------------------
// Équipe bleue au départ d'ESME (premier aérodrome), rouge au départ du second. Un terrain se capture en restant dans sa
// zone (CAPTURE_RADIUS, sous CAPTURE_HEIGHT au-dessus du sol) sans ennemi : CAPTURE_TIME s pour un pilote, plus vite à
// plusieurs (3 au plus) ; un défenseur dans la zone la bloque, et sans attaquant elle redescend. Terrain pris :
// CAPTURE_POINTS points ; une équipe qui tient tous les terrains gagne la manche (WIN_POINTS), puis les terrains
// reviennent à leur équipe de départ. Un seul joueur, l'arbitre (le créateur, ou un autre s'il part), fait ces calculs
// et les publie avec son état ; on ne peut partir que d'un terrain tenu par son équipe
const TEAM_COLORS = { bleu: '#3d8fd6', rouge: '#e0473c' };
const TEAM_NAMES = { bleu: 'bleue', rouge: 'rouge' };
const HOME_TEAMS = ['bleu', 'rouge'];   // équipe de départ de chaque aérodrome (ordre de airport.list)
const CAPTURE_RADIUS = 2000, CAPTURE_HEIGHT = 300, CAPTURE_TIME = 30, CAPTURE_DECAY = 15, CAPTURE_POINTS = 300, WIN_POINTS = 1000;
const ROUND_PAUSE = 15000;   // ms entre la victoire et la manche suivante
const wardog = () => Boolean(multiplayer.code) && multiplayer.mode === 'wardog';
const teamOf = (id) => (id === multiplayer.id ? multiplayer.team : multiplayer.players.get(id)?.team ?? null);
// Adversaire (hors Wardog : tout le monde)
function isEnemy(id) {
    if (!wardog() || !id) return true;
    const team = teamOf(id);
    return !team || !multiplayer.team || team !== multiplayer.team;
}
function initialCapture(round = 1, points = { bleu: 0, rouge: 0 }) {
    return { fields: airport.list.map((field, i) => ({ owner: HOME_TEAMS[i] ?? null, progress: 0, attacker: null })),
        points: { ...points }, winner: null, round };
}
// Terrains d'où notre équipe peut partir (tous hors Wardog ; aucun tenu : celui de départ de l'équipe)
function allowedFields() {
    if (!wardog() || !multiplayer.team) return airport.list;
    const capture = multiplayer.captureState ?? initialCapture();
    const owned = airport.list.filter((field, i) => capture.fields[i]?.owner === multiplayer.team);
    return owned.length ? owned : [airport.list[HOME_TEAMS.indexOf(multiplayer.team)] ?? airport.list[0]];
}
// Arbitre : une fois par seconde
let winnerAt = 0, lastCapture = null;
function refereeTick() {
    if (!wardog()) {
        multiplayer.capture = null;
        return;
    }
    if (multiplayer.referee !== multiplayer.id) {
        multiplayer.capture = null;
        return;
    }
    // (devenu arbitre en cours de partie : on reprend l'état publié par le précédent)
    const capture = multiplayer.capture ??= lastCapture ? structuredClone(lastCapture) : initialCapture();
    const now = performance.now();
    if (capture.winner) {
        winnerAt ||= now;
        if (now - winnerAt >= ROUND_PAUSE) {
            multiplayer.capture = initialCapture(capture.round + 1, capture.points);
            winnerAt = 0;
        }
        return;
    }
    // Pilotes en vol : nous, et les autres joueurs (position reçue), avec leur équipe
    const pilots = [];
    if (multiplayer.team && !controls.isCrashed() && !choosingSpawn && !inHangar) {
        const p = aircraft.position;
        pilots.push({ team: multiplayer.team, x: p.x, z: p.z, agl: p.y - WHEEL_HEIGHT - terrain.heightAt(p.x, p.z) });
    }
    for (const player of multiplayer.players.values()) {
        if (!player.team || player.crashed || player.away) continue;
        const [x, y, z] = player.p;
        const wheel = AIRCRAFT_PROFILES[player.aircraft]?.wheelHeight ?? 0;
        pilots.push({ team: player.team, x, z, agl: y - wheel - terrain.heightAt(x, z) });
    }
    airport.list.forEach((field, i) => {
        const f = capture.fields[i];
        if (!f) return;
        const inZone = pilots.filter((pl) => Math.hypot(pl.x - field.center.x, pl.z - field.center.z) < CAPTURE_RADIUS && pl.agl < CAPTURE_HEIGHT);
        const attackers = inZone.filter((pl) => pl.team !== f.owner);
        const defenders = inZone.filter((pl) => pl.team === f.owner);
        if (attackers.length && !defenders.length) {
            const team = attackers[0].team;
            if (f.attacker !== team) {
                f.attacker = team;
                f.progress = 0;
            }
            f.progress += Math.min(3, attackers.length) / CAPTURE_TIME;
            if (f.progress >= 1) {
                f.owner = team;
                f.progress = 0;
                f.attacker = null;
                capture.points[team] += CAPTURE_POINTS;
            }
        } else if (!attackers.length) {
            f.progress = Math.max(0, f.progress - 1 / CAPTURE_DECAY);
            if (f.progress === 0) f.attacker = null;
        }   // (attaquants et défenseurs : capture bloquée)
    });
    const owners = new Set(capture.fields.map((f) => f.owner));
    if (owners.size === 1 && [...owners][0]) {
        capture.winner = [...owners][0];
        capture.points[capture.winner] += WIN_POINTS;
        winnerAt = now;
    }
}
setInterval(() => { guard('wardog', refereeTick); guard('wardog', updateWardog); }, 1000);

// Bandeau Wardog (en haut au centre) et annonces dans le tchat : terrain pris, manche gagnée, nouvelle manche
const wardogPanel = document.getElementById('wardog');
let wardogKey = '', previousCapture = null;
function teamPoints(capture) {
    const points = { bleu: capture?.points.bleu ?? 0, rouge: capture?.points.rouge ?? 0 };
    if (multiplayer.team) points[multiplayer.team] += multiplayer.score.kills * POINTS_PER_KILL;
    for (const player of multiplayer.players.values()) if (player.team) points[player.team] += (player.score?.kills ?? 0) * POINTS_PER_KILL;
    return points;
}
function updateWardog() {
    const show = wardog() && !inMenu && !inHangar;
    wardogPanel.hidden = !show;
    if (!wardog()) {
        previousCapture = lastCapture = null;
        return;
    }
    const capture = multiplayer.captureState;
    if (capture) lastCapture = capture;
    // Annonces (chez tous les joueurs, d'après l'état de l'arbitre)
    if (capture && previousCapture && capture.round === previousCapture.round) {
        capture.fields.forEach((f, i) => {
            const before = previousCapture.fields[i];
            if (before && f.owner !== before.owner && f.owner) {
                chat.add(null, `🚩 L'équipe ${TEAM_NAMES[f.owner]} a capturé ${airport.list[i]?.label ?? 'un terrain'} !`);
                if (f.owner === multiplayer.team) weaponHud.message(`${airport.list[i]?.label} capturé ! +${CAPTURE_POINTS} points`, true);
                else if (before.owner === multiplayer.team) weaponHud.message(`${airport.list[i]?.label} perdu !`, true);
            }
        });
        if (capture.winner && !previousCapture.winner) {
            chat.add(null, `🏆 Victoire de l'équipe ${TEAM_NAMES[capture.winner]} (+${WIN_POINTS} points) : nouvelle manche dans ${ROUND_PAUSE / 1000} s`);
            weaponHud.message(capture.winner === multiplayer.team ? 'VICTOIRE !' : 'DÉFAITE…', true);
        }
    }
    if (capture && previousCapture && capture.round !== previousCapture.round) {
        chat.add(null, `🔄 Manche ${capture.round} : chaque équipe reprend son terrain`);
    }
    previousCapture = capture ? structuredClone(capture) : null;
    if (!show) return;
    const points = teamPoints(capture);
    const fields = (capture ?? initialCapture()).fields.map((f, i) => {
        const name = airport.list[i]?.label ?? `Terrain ${i + 1}`;
        const owner = f.owner ? `<span class="${f.owner}">■</span>` : '□';
        const bar = f.attacker && f.progress > 0
            ? `<span class="barre"><span style="width:${Math.round(f.progress * 100)}%;background:${TEAM_COLORS[f.attacker]}"></span></span>` : '';
        return `<span>${owner} ${name}${bar}</span>`;
    }).join('');
    const notice = capture?.winner ? `<div class="annonce">Victoire de l'équipe ${TEAM_NAMES[capture.winner]} !</div>` : '';
    const team = multiplayer.team ? `<span class="${multiplayer.team}">vous : ${TEAM_NAMES[multiplayer.team]}</span> · ` : '';
    const html = `<div class="equipes"><span class="bleu">BLEUS ${points.bleu}</span> · <span class="rouge">ROUGES ${points.rouge}</span></div>`
        + `<div class="terrains">${team}${fields}</div>${notice}`;
    if (html !== wardogKey) {
        wardogKey = html;
        wardogPanel.innerHTML = html;   // (contenu fait ici : noms des terrains et nombres, aucun texte venu du réseau)
    }
}

// --- Tableau des scores (multijoueur) --------------------------------------------------------------------------------
// Chaque joueur compte ses victoires et le nombre de fois où il a été abattu, et les envoie avec son état
// (Multiplayer.score) : tout le monde voit le même tableau. POINTS_PER_KILL points par avion abattu. En haut à droite
// pendant une partie à plusieurs ; la ligne du tireur s'éclaire un instant à chaque victoire
const POINTS_PER_KILL = 100;
const scoresPanel = document.getElementById('scores');
const scoresBody = document.getElementById('scores-lignes');
let scoreFlash = { id: null, until: 0 }, scoresKey = '';
function flashScore(id) {
    if (id) scoreFlash = { id, until: performance.now() + 3000 };
    updateScores();
}
function updateScores() {
    // (en Wardog : toujours, même seul dans la partie, avec les points des équipes et les terrains en tête)
    const show = Boolean(multiplayer.code) && (multiplayer.players.size > 0 || wardog()) && !inMenu && !inHangar;
    scoresPanel.hidden = !show;
    if (!show) return;
    const rows = [{ id: multiplayer.id, name: multiplayer.name, ...multiplayer.score, me: true },
        ...[...multiplayer.players].map(([id, p]) => ({ id, name: p.name, ...(p.score ?? { kills: 0, deaths: 0 }), me: false }))];
    const teams = wardog();
    for (const row of rows) row.team = teams ? teamOf(row.id) : null;
    const order = { bleu: 0, rouge: 1, null: 2 };
    rows.sort((a, b) => (teams ? order[a.team] - order[b.team] : 0) || b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
    const flashId = performance.now() < scoreFlash.until ? scoreFlash.id : null;
    const key = JSON.stringify([rows, flashId, teams ? teamPoints(multiplayer.captureState) : null]);
    if (key === scoresKey) return;   // (rien de changé : pas de reconstruction)
    scoresKey = key;
    const points = teams ? teamPoints(multiplayer.captureState) : null;
    let currentTeam;
    scoresBody.replaceChildren(...rows.flatMap((row) => {
        const lines = [];
        if (teams && row.team !== currentTeam) {
            currentTeam = row.team;
            const header = document.createElement('tr');
            header.className = `equipe ${row.team ?? ''}`;
            const td = document.createElement('td');
            td.colSpan = 4;
            td.textContent = row.team ? `Équipe ${TEAM_NAMES[row.team]} · ${points[row.team]} pts` : 'Sans équipe';
            header.append(td);
            lines.push(header);
        }
        const tr = document.createElement('tr');
        tr.classList.toggle('moi', row.me);
        tr.classList.toggle('flash', row.id === flashId);
        for (const value of [row.me ? `${row.name} (vous)` : row.name, row.kills, row.deaths, row.kills * POINTS_PER_KILL]) {
            const td = document.createElement('td');
            td.textContent = String(value);
            tr.append(td);
        }
        if (row.team) tr.firstChild.style.color = TEAM_COLORS[row.team];
        lines.push(tr);
        return lines;
    }));
}
setInterval(updateScores, 1000);
multiplayer.addEventListener('players', () => updateScores());
// Tablette, téléphone : tableau des joueurs replié par défaut, déplié d'un toucher (voir layoutTouchOverlays)
const scoresToggle = document.getElementById('scores-bascule');
scoresToggle.addEventListener('click', () => {
    const open = scoresToggle.getAttribute('aria-expanded') !== 'true';
    scoresToggle.setAttribute('aria-expanded', String(open));
    scoresToggle.textContent = open ? 'Joueurs ▴' : 'Joueurs ▾';
    layoutTouchOverlays();
});

// --- Panneaux de l'écran de vol sur tablette et téléphone --------------------------------------------------------------
// Sur un écran tactile, les jauges remontent au-dessus du manche et des gaz, et la colonne SOL / SYSTÈMES / RADIO occupe
// le haut à droite : à leurs places fixes, le tableau des scores (Wardog), le tchat et le panneau des dégâts passaient
// dessus (et dessous les uns des autres sur téléphone). Ils sont posés ici dans une place libre : hors des jauges, de la
// rose des caps, des commandes tactiles, des boutons de l'iPad, des cartes d'armes et les uns des autres
const OVERLAY_MARGIN = 8, OVERLAY_STEP = 8;
const overlaps = (a, b) => a.x < b.x + b.w + OVERLAY_MARGIN && b.x < a.x + a.w + OVERLAY_MARGIN
    && a.y < b.y + b.h + OVERLAY_MARGIN && b.y < a.y + a.h + OVERLAY_MARGIN;
const rectOf = (node) => {
    if (!node || node.hidden || !node.offsetWidth) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
};
// Première place libre de taille w × h dans bounds, de haut en bas ; sur une même hauteur, la plus à gauche (side 'left')
// ou la plus à droite ('right'). Aucune : null
function freeSpot(w, h, bounds, obstacles, side) {
    const xMin = bounds.x + OVERLAY_MARGIN, xMax = bounds.x + bounds.w - w - OVERLAY_MARGIN;
    for (let y = bounds.y + OVERLAY_MARGIN; y <= bounds.y + bounds.h - h - OVERLAY_MARGIN; y += OVERLAY_STEP) {
        for (let i = 0; xMin + i * OVERLAY_STEP <= xMax + OVERLAY_STEP - 1; i++) {
            const x = side === 'left' ? Math.min(xMax, xMin + i * OVERLAY_STEP) : Math.max(xMin, xMax - i * OVERLAY_STEP);
            const spot = { x, y, w, h };
            if (!obstacles.some((o) => overlaps(spot, o))) return spot;
        }
    }
    return null;
}
function layoutTouchOverlays() {
    if (!simulatorElement.classList.contains('jeu')) return;
    const area = simulatorElement.getBoundingClientRect(), screen = view.getBoundingClientRect();
    const bounds = { x: screen.left, y: screen.top, w: screen.width, h: screen.height };
    const obstacles = [];
    const hud = document.getElementById('hud');
    if (!hud.hidden && flightHud.boxes) {
        const r = hud.getBoundingClientRect();
        for (const b of flightHud.boxes) obstacles.push({ x: r.left + b.x, y: r.top + b.y, w: b.w, h: b.h });
    }
    const tactile = document.getElementById('tactile');
    if (!tactile.hidden) for (const node of tactile.children) obstacles.push(rectOf(node));
    const column = rectOf(document.querySelector('.tb-colonne'));
    // Jauges de droite du HUD : à gauche de ces boutons s'ils sont à leur hauteur (voir FlightHud.topRightReserve)
    const hudRect = hud.getBoundingClientRect();
    flightHud.topRightReserve = column ? { left: column.x - hudRect.left, bottom: column.y + column.h - hudRect.top } : null;
    obstacles.push(column, rectOf(document.getElementById('moniteur')), rectOf(document.getElementById('ils-bouton')),
        rectOf(document.getElementById('alarmes-f15')), ...[...document.getElementById('nav-zone').children].map(rectOf));
    // Cartes d'armes (en haut, au centre) : sous les boutons de l'iPad s'ils sont en ligne au-dessus (téléphone)
    const cardsWidth = Math.min(3 * 180 + 24, screen.width - 24);
    const cardsLeft = screen.left + (screen.width - cardsWidth) / 2;
    const underColumn = column && column.y + column.h - screen.top < 100 && column.x < cardsLeft + cardsWidth && column.x + column.w > cardsLeft;
    weaponHud.layout.top = underColumn ? Math.max(0, column.y + column.h - screen.top + 6 - 18) : 0;
    const cards = weaponHud.areas.cards;
    if (cards) obstacles.push({ x: screen.left + cards.x, y: screen.top + cards.y, w: cards.w, h: cards.h });
    const place = (node, w, h, side) => {
        const spot = freeSpot(w, h, bounds, obstacles.filter(Boolean), side);
        if (!spot) return null;
        obstacles.push(spot);
        if (node) Object.assign(node.style, { left: `${spot.x - area.left}px`, top: `${spot.y - area.top}px` });
        return spot;
    };
    // Tableau des scores : en haut à droite de préférence (comme sur ordinateur)
    if (!scoresPanel.hidden) place(scoresPanel, scoresPanel.offsetWidth, scoresPanel.offsetHeight, 'right');
    // Dégâts (place gardée dès qu'il est affiché) : à gauche, sous la rose des caps de préférence
    if (weaponHud.areas.damage || damage.damaged) {
        const size = weaponHud.damageSize.w ? weaponHud.damageSize : { w: 162, h: 138 };
        const spot = place(null, size.w, size.h, 'left');
        weaponHud.layout.damage = spot ? { x: spot.x - screen.left, y: spot.y - screen.top } : null;
    }
    // Tchat : place réservée pour quelques messages (sinon il sauterait d'une place à l'autre à chaque message)
    // Faute de place (téléphone), plus étroit et moins haut
    const chatPanel = document.getElementById('tchat');
    if (!chatPanel.hidden) {
        for (const [w, h] of [[320, 90], [240, 64], [180, 64]]) {
            const width = Math.min(w, screen.width * 0.45);
            const spot = place(null, width, h, 'left');
            if (!spot) continue;
            Object.assign(chatPanel.style, { left: `${spot.x - area.left}px`, top: `${spot.y - area.top}px`, width: `${width}px` });
            break;
        }
    }
}
if (isTablet()) setInterval(layoutTouchOverlays, 250);
// Nouveau départ : avion réparé, réarmé
controls.addEventListener('reset', () => {
    deathReported = false;
    damage.reset();
    weapons.rearm();
    ownSmoke.jump();
});

// Alarmes du F-15 (F15Warnings.js) : voyants du cockpit, voix, HUD ; en vue extérieure, voyants allumés en haut de l'écran
const f15AlarmPanel = document.getElementById('alarmes-f15');
let f15AlarmText = '';
function updateF15Warnings(frameDelta) {
    const delta = Math.min(frameDelta, 0.1);
    const active = aircraftType === 'f15' && !choosingSpawn && !inMenu && !inHangar;
    f15Warnings.volume = chaseView ? 0.8 : 1;
    f15Warnings.update(delta, active ? {
        powered: jetSystems.busPowered, airborne: !controls.isOnGround(), crashed: controls.isCrashed(),
        position: aircraft.position, velocity: controls.model.velocity, ground: (x, z) => terrain.heightAt(x, z),
        wheelHeight: WHEEL_HEIGHT, speed: controls.getSpeed(), g: controls.model.loadFactor, mass: controls.model.aircraft.mass,
        mach: controls.getSpeed() / 340, gear: controls.model.gearPosition, speedbrake: controls.model.speedbrake,
        canopy: jetCanopy, fuelKg: jetSystems.fuelKg, engines: jetSystems.engines, systemWarnings: jetSystems.warnings,
        jfsLow: jetSystems.jfsRunning && !jetSystems.jfsReady, damage,
    } : null);
    const show = active && chaseView && !controls.isCrashed() && !simulatorElement.classList.contains('photo');
    const items = show ? f15Warnings.list() : [];
    const text = items.map((i) => `${i.warning ? '!' : ''}${i.label}`).join('|');
    if (text !== f15AlarmText) {
        f15AlarmText = text;
        f15AlarmPanel.replaceChildren(...items.map((item) => {
            const span = document.createElement('span');
            span.textContent = item.label;
            if (item.warning) span.className = 'alarme';
            return span;
        }));
    }
    f15AlarmPanel.hidden = items.length === 0;
}

let lastCombatTargets = [];   // (diagnostic : cibles de la dernière image, voir esmeDebug.cibles)
function updateCombat(frameDelta) {
    const delta = Math.min(frameDelta, 0.1);   // même pas maximal que le modèle de vol (onglet en arrière-plan, à-coup)
    const jet = aircraftType === 'f15';
    updateShield(delta);
    const armed = weaponsArmed();
    // Cibles : seulement les avions en vol (ceux au sol ne peuvent être ni touchés ni verrouillés : pas de spawn-kill)
    // Cibles : ennemis en vol seulement. Wardog : les équipiers n'apparaissent pas dans le viseur (ni triangle, ni cadre, ni
    // verrouillage de l'AIM-9) et nos obus ne peuvent pas les toucher (coups au but calculés sur ces cibles seulement ; chez
    // eux, un coup venu d'un équipier est de toute façon ignoré)
    const planes = multiplayer.code ? remotePlayers.combatList() : [];
    const targets = planes.filter((t) => {
        const p = t.group.position;
        t.agl = p.y - (AIRCRAFT_PROFILES[t.type]?.wheelHeight ?? 0) - terrain.heightAt(p.x, p.z);   // hauteur sol (m), pour le radar
        return t.agl > 4 && isEnemy(t.id);
    });
    lastCombatTargets = targets;
    // Alerte radar : un autre joueur nous accroche ou nous a verrouillés
    let threat = { state: 'off', name: '' };
    // (sous bouclier : personne ne peut nous accrocher, pas d'alerte même si un joueur d'une ancienne version le fait)
    if (multiplayer.code && !controls.isCrashed() && !choosingSpawn && shieldLeft() === 0) {
        for (const player of multiplayer.players.values()) {
            if (player.lockOn !== multiplayer.id || player.crashed) continue;
            if (player.lockOnLocked) threat = { state: 'lock', name: player.name };
            else if (threat.state === 'off') threat = { state: 'search', name: player.name };
        }
    }
    weapons.threat = threat.state;
    weapons.threatName = threat.name;   // (RWR : nouvelle menace, « new guy »)
    camera.updateMatrixWorld();
    // Mode missile : la croix rouge suit la souris au sol (au centre de l'écran sans souris)
    if (armed && weapons.selected === 'missile') weapons.aim(camera, pointerNdc);
    weapons.update(delta, {
        own: { aircraft, velocity: controls.model.velocity, armed, id: multiplayer.id, alive: !controls.isCrashed() && !choosingSpawn },
        camera, targets, cabin: !chaseView,
        // (traçantes du canon de tous les autres joueurs, équipiers compris : purement visuelles, sans dégâts)
        shooters: planes.filter((t) => t.firing && t.type === 'f15').map((t) => ({ id: t.id, matrix: t.group.matrixWorld, velocity: t.velocity })),
    });
    // Fumée et flammes derrière notre avion touché
    const crashed = controls.isCrashed();
    if (!choosingSpawn && !crashed) damage.update(delta, controls.model, jet);
    _smokeSource.copy(OWN_SMOKE_SOURCE[aircraftType] ?? OWN_SMOKE_SOURCE.c172).applyQuaternion(aircraft.quaternion).add(aircraft.position);
    ownSmoke.update(delta, _smokeSource, crashed || choosingSpawn ? 0 : damage.smoke, damage.onFire && !crashed && !choosingSpawn, controls.model.velocity);
    const visible = !inMenu && !inHangar && !choosingSpawn && !simulatorElement.classList.contains('photo');
    weaponHud.update(delta, visible, {
        camera, aircraft, velocity: controls.model.velocity, weapons, damage, jet, armed, targets, touch: touchControls.enabled, threat, cabin: !chaseView,
        shield: shieldLeft(),
    });
}

// --- Chargement et entrée en partie -----------------------------------------------------------------------------
// Tout ce qui sert au vol se charge dès l'ouverture de la page, pendant le menu principal (voir Loading.js). À l'entrée
// en partie (Vol libre, Multijoueur, Initiation), l'écran de chargement attend ce qui manque, compile les shaders et
// dessine quelques images derrière lui (préchauffage), puis la partie s'ouvre d'elle-même (son : clics du menu).
// Relevé avant ce changement : 0,8 s figée à l'arrivée au hangar (shaders compilés à leur première image), des à-coups
// de 130 à 270 ms en vol (vue cabine, décollage), sons (18 Mo) téléchargés seulement au premier clic

// Sons : téléchargés et décodés tout de suite (contexte audio encore suspendu : il démarre au premier geste)
for (const sound of [stallWarning, bankAngleWarning, terrainWarning, engineSound, sounds]) sound.unlock().catch(() => { /* refait au prochain geste */ });
// Ciel étoilé : chargé d'avance (avant : au premier passage à la nuit, en vol)
nightSky.preload();

// Dalles du terrain vues depuis chaque endroit où la caméra peut sauter (aérodromes, hangars, départs, menu) :
// construites d'avance et gardées (voir Terrain.prebuild)
function terrainViewpoints() {
    const points = [];
    for (const field of airport.list) {
        for (const spawn of field.spawns) points.push(new THREE.Vector3(spawn.x, 0, spawn.z));
        for (const hangar of field.hangars) points.push(new THREE.Vector3(hangar.spot.x, 0, hangar.spot.z));
        for (const view of Object.values(SPAWN_VIEWS)) {
            const s = spawnViewState(view, field);
            points.push(s.target.clone(), new THREE.Vector3(s.target.x + Math.sin(s.yaw) * Math.cos(s.pitch) * s.distance, 0,
                s.target.z + Math.cos(s.yaw) * Math.cos(s.pitch) * s.distance));
        }
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) points.push(new THREE.Vector3(215 + Math.cos(a) * 520, 0, 20 + Math.sin(a) * 520));
    return points;
}
const terrainLoading = track('terrain', 'Relief autour des aérodromes', () => new Promise((resolve) => setTimeout(resolve, 200))
    .then(() => terrain.prebuild(terrainViewpoints(), Math.max(viewDistance, scene.fog?.far ?? 0, 2400) + 600,
        (fraction) => progress(terrainLoading.item, fraction))), { weight: 3 });
terrainLoading.catch(() => {});

const loadingScreen = new LoadingScreen(document.getElementById('chargement'));
let worldWarm = false;   // préchauffage fait (une fois par visite : les parties suivantes entrent tout de suite)
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// Shaders de tout ce qui est dans la scène (même caché), pour la cible où elle est vraiment dessinée (voir
// checkNewShaders) ; attend leur fin (20 s au plus)
function compileScene() {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(graphics.composer.renderTarget1);
    const compiling = renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(previous);
    return Promise.race([compiling, new Promise((resolve) => setTimeout(resolve, 20000))]);
}

// Textures envoyées à la carte graphique maintenant (sinon : à la première image qui les montre, 200 ms d'à-coup)
function uploadTextures() {
    const seen = new Set();
    const upload = (texture) => {
        if (!texture?.isTexture || seen.has(texture) || texture.isRenderTargetTexture) return;
        seen.add(texture);
        const image = texture.image;
        if (!image || image.complete === false || (image.width ?? 1) === 0) return;
        try { renderer.initTexture(texture); } catch { /* texture pas encore prête : envoyée à sa première image */ }
    };
    scene.traverse((object) => {
        for (const material of [object.material].flat()) {
            if (!material) continue;
            for (const value of Object.values(material)) upload(value);
            for (const uniform of Object.values(material.uniforms ?? {})) upload(uniform?.value);
        }
    });
}

// Objet qui va apparaître en vol (avion d'un autre joueur) : textures envoyées à la carte graphique et shaders compilés
// en arrière-plan (compileAsync) pendant que le jeu continue de tourner ; avant, la première image qui le montrait
// figeait le jeu le temps de tout compiler. Résolu au plus tard après 8 s
// Matériaux transparents visibles des deux côtés : three.js les dessine en deux passes (faces arrière, puis avant) et les
// marque « modifiés » à chaque passe, ce qui lui fait recalculer leur programme de dessin deux fois par image et par
// objet (cockpit du F-15 : ~2 500 fois par seconde, ~7 % du temps de calcul en vol). Sur les avions (vitres,
// instruments, chiffres, HUD, pièces plates), une seule passe donne la même image
function singlePassTransparents(root) {
    root.traverse((child) => {
        for (const material of [child.material].flat()) {
            if (material?.transparent && material.side === THREE.DoubleSide) material.forceSinglePass = true;
        }
    });
}

function prepareForDisplay(object) {
    singlePassTransparents(object);
    const seen = new Set();
    object.traverse((child) => {
        for (const material of [child.material].flat()) {
            if (!material) continue;
            for (const value of [...Object.values(material), ...Object.values(material.uniforms ?? {}).map((u) => u?.value)]) {
                if (!value?.isTexture || seen.has(value) || value.isRenderTargetTexture) continue;
                seen.add(value);
                const image = value.image;
                if (!image || image.complete === false || (image.width ?? 1) === 0) continue;
                try { renderer.initTexture(value); } catch { /* envoyée à sa première image */ }
            }
        }
    });
    const previous = renderer.getRenderTarget();
    let compiling;
    try {
        renderer.setRenderTarget(graphics.composer.renderTarget1);   // (variante des shaders du rendu réel, voir checkNewShaders)
        object.updateMatrixWorld(true);
        compiling = renderer.compileAsync(object, camera, scene);
    } catch (error) {
        compiling = Promise.reject(error);
    } finally {
        renderer.setRenderTarget(previous);
    }
    return Promise.race([compiling, new Promise((resolve) => setTimeout(resolve, 8000))]);
}

// Mise à jour de ce qui dépend de la caméra (sans physique, ni son, ni réseau), comme le fait chaque image du vol
function updateWarmView() {
    aircraft.updateMatrixWorld();
    camera.updateMatrixWorld();
    const drawRange = Math.max(scene.fog?.far ?? 3000, 2400) + 600;
    pilotEyeWorld.copy(cockpit.eye).multiplyScalar(CABIN_SCALE).add(COCKPIT_POSITION).applyMatrix4(aircraft.matrixWorld);
    terrain.update(camera.position, drawRange, true);
    airport.update(0, Math.min(1, wind.speed / 20), camera, wind.direction, pilotEyeWorld, drawRange + 1500);
    airport.updateHangars(0, aircraft.position);
    decorShadowCenter.set(aircraft.position.x, terrain.heightAt(aircraft.position.x, aircraft.position.z), aircraft.position.z);
    scenery.update(camera.position, clock.elapsedTime, decorShadowCenter);
    clouds.update(camera);
    cloudLayer.update(0, camera, weather.wind);
    nightSky.update(camera);
    for (const object of detailedObjects) {
        object.visible = object.boundingSphere.distanceToPoint(camera.position) < DETAIL_DISTANCE;
    }
    aircraftLights.update(camera, clock.elapsedTime);
    if (aircraft.visible) cockpit.update(0, cockpitState());
    updateFog();
    graphics.update(aircraft.position, !chaseView, decorShadowCenter);
}

// Place l'avion et la caméra comme à une étape de la partie : vue d'ensemble d'un aérodrome, hangar, piste (vue
// extérieure), cabine. De nuit, en piste, tous les feux de l'avion allumés (les lumières changent les shaders)
function placeWarmView(kind, field) {
    const dark = (weather?.night ?? 0) >= 0.5;
    inMenu = false;
    inHangar = kind === 'hangar';
    choosingSpawn = kind === 'ensemble' || kind === 'hangar';
    chaseView = kind !== 'cabine';
    updateView();
    aircraft.visible = kind !== 'ensemble';
    if (kind === 'ensemble') {
        Object.assign(spawnCam, spawnViewState(SPAWN_VIEWS.ensemble, field));
        spawnCam.goal = spawnViewState(SPAWN_VIEWS.ensemble, field);
    } else if (kind === 'hangar') {
        const spot = field.hangars[0].spot;
        aircraft.position.set(spot.x, 0, spot.z);
        aircraft.rotation.set(0, spot.heading, 0);
        controls.placeOnGround();
        aircraft.position.y += 0.05;
        aircraftLights.setSwitches({});
        landingLight.visible = taxiLight.visible = false;
    } else {
        const spawn = field.spawns[0];
        aircraft.position.set(spawn.x, 0, spawn.z);
        aircraft.rotation.set(0, spawn.heading, 0);
        controls.placeOnGround();
        aircraftLights.setSwitches({ land: true, taxi: true, strobe: true, beacon: true, nav: true });
        landingLight.visible = taxiLight.visible = dark;
    }
    aircraft.updateMatrixWorld();
    updateCamera(0, true);
}

async function warmUpWorld() {
    const views = airport.list.flatMap((field) => ['ensemble', 'hangar', 'piste', 'cabine'].map((kind) => [kind, field]));
    const compiling = task('shaders', 'Shaders', { weight: views.length });
    const warming = task('prechauffage', 'Images de préchauffage', { weight: views.length });
    const saved = { position: aircraft.position.clone(), quaternion: aircraft.quaternion.clone(), visible: aircraft.visible,
        chaseView, inHangar, inMenu, choosingSpawn, markers: spawnMarkers.visible,
        spawnCam: { ...spawnCam, target: spawnCam.target.clone() } };
    spawnMarkers.visible = false;
    try {
        uploadTextures();
        for (const [i, [kind, field]] of views.entries()) {
            placeWarmView(kind, field);
            updateWarmView();
            await compileScene();
            compiling.progress((i + 1) / views.length);
            // Quelques images dessinées derrière l'écran de chargement : ombres, post-traitement, variantes de shaders
            // que la compilation d'avance ne couvre pas, géométries et textures envoyées à la carte graphique
            for (let frame = 0; frame < 3; frame++) {
                updateWarmView();
                graphics.render();
                await nextFrame();
            }
            warming.progress((i + 1) / views.length);
        }
        compiling.done();
        warming.done();
    } catch (error) {
        // Préchauffage raté : on joue quand même (au pire, quelques à-coups comme avant)
        console.error('Préchauffage :', error);
        compiling.done();
        warming.done();
    } finally {
        aircraft.position.copy(saved.position);
        aircraft.quaternion.copy(saved.quaternion);
        aircraft.visible = saved.visible;
        ({ chaseView, inHangar, inMenu, choosingSpawn } = saved);
        spawnMarkers.visible = saved.markers;
        Object.assign(spawnCam, saved.spawnCam);
        updateView();
        applyLights();
        aircraft.updateMatrixWorld();
        // Objets déjà compilés : pas de nouvelle compilation au prochain contrôle (voir checkNewShaders)
        sceneObjects = countSceneObjects();
    }
}

// Entrée en partie : écran de chargement si quelque chose manque (la première fois : toujours, pour le préchauffage)
async function enterGame(start) {
    if (worldWarm && loadingScreen.ready) {
        start();
        return;
    }
    markHeavyLoad(true);   // (page fermée d'ici la fin : qualité réduite à la prochaine ouverture, voir LOAD_MARK)
    try {
        await loadingScreen.open(async () => {
            if (worldWarm) return;
            await warmUpWorld();
            worldWarm = true;
        });
    } finally {
        markHeavyLoad(false);
    }
    clock.getDelta();              // (pas de saut du temps après l'attente)
    graphics.holdResolution();     // ni de baisse de résolution : les i/s de l'attente ne comptent pas
    start();
}

let initiationErrorShown = false;
let lastTouchInset = '', lastLeftReserve = -1;
// Avion choisi la dernière fois (hangar) : repris au lancement (le F-15 se charge pendant le menu principal)
try {
    const savedType = localStorage.getItem('avion');
    if (savedType === 'f15' || savedType === 'r44') setAircraftType(savedType).catch(() => setAircraftType('c172'));
} catch { /* stockage indisponible */ }

// Boucle d'images protégée : une erreur dans une image ne l'arrête plus. three.js ne redemande l'image suivante qu'après
// la fin de celle-ci : une seule erreur figeait le jeu pour de bon (image immobile, réseau toujours actif), puis le
// filet de sécurité rechargeait la page (« déconnecté », score perdu). L'image fautive est sautée, l'erreur notée
// (voir recordError) et le jeu continue
renderer.setAnimationLoop((time) => {
    try {
        drawFrame(time);
    } catch (error) {
        recordError('image', error);
        try { graphics.render(); } catch { /* rien de plus à faire pour cette image */ }
    }
});
function drawFrame(time) {
    lastLoopAt = performance.now();   // (filet de sécurité : la boucle tourne, voir watchFreeze)
    // Écran de chargement : rien n'est dessiné derrière lui (sauf les images du préchauffage, voir warmUpWorld) ; toute
    // la puissance va au chargement
    if (loadingScreen.active) return;
    // Limite d'images par seconde (réglage) : on saute les rafraîchissements d'écran en trop
    // Menu principal : décor du fond (survol lent de l'aérodrome) à MENU_FPS images/s au plus. Avant, il était redessiné
    // à pleine vitesse pendant que tout le reste se chargeait derrière lui (relief, arbres, avions, sons) : la moitié du
    // temps de l'ordinateur y passait, le chargement et le menu en étaient ralentis
    const limit = inMenu ? (fpsLimit > 0 ? Math.min(fpsLimit, MENU_FPS) : MENU_FPS) : fpsLimit;
    if (limit > 0) {
        const interval = 1000 / limit;
        if (time < nextFrameTime - 1.5) return;
        nextFrameTime = Math.max(nextFrameTime + interval, time); // rattrape le retard sans s'emballer
    }
    // Changement de résolution AVANT de dessiner : redimensionner le canvas l'efface ; fait après le dessin,
    // l'image affichée était vide (éclair noir) jusqu'à l'image suivante
    graphics.adaptResolution();
    const frameStart = performance.now();
    freezeFrameStart(frameStart);
    const delta = clock.getDelta();

    wind.update();
    controls.model.wind.copy(wind.vector);
    if (!choosingSpawn) controls.update( delta );
    checkPlaneCollisions();
    if (!choosingSpawn) updateWaterSink( delta );
    if (SEA && !choosingSpawn) updateCarrier( delta );
    aircraft.updateMatrixWorld();
    if (delta > 0) aircraftVelocity.subVectors(aircraft.position, lastAircraftPosition).divideScalar(delta);
    lastAircraftPosition.copy(aircraft.position);
    lap('vol');

    // Secousses : s'amortissent, entretenues au roulage (plus fort dans l'herbe). Elles croissent avec la vitesse
    // jusqu'à ~40 km/h, puis diminuent : à l'approche du décollage, l'aile porte l'avion et déleste les roues
    shake *= Math.exp(-4 * delta);
    if (controls.isOnGround() && !controls.isCrashed()) {
        const speed = controls.getSpeed();
        const wheelLoad = Math.max(0.15, 1 - (speed / (controls.rotateSpeed * 1.5)) ** 2);
        const roughness = { grass: 0.0015, water: 0.0022 }[controls.getSurface()] ?? 0.0003;
        shake = Math.max(shake, Math.min(speed, 12) * wheelLoad * roughness);
    }
    updateHeadTarget( delta );
    // Une erreur de la leçon ne doit jamais figer le simulateur (radio, caméra et rendu viennent après)
    try { initiation.update( delta ); }
    catch (error) { if (!initiationErrorShown) { initiationErrorShown = true; console.error('Initiation :', error); } }
    updateSpawnMarkers();
    updateAtc( delta );
    updateCamera( delta );
    lap('caméra, ATC, initiation');
    // Molette de trim (touches W / X, ou à la souris) : un cran entendu tous les 0,6°
    trimTravel += Math.abs(controls.getTrim() - lastTrim);
    lastTrim = controls.getTrim();
    if (trimTravel >= 0.6) {
        trimTravel = 0;
        sounds.click(0.22);
    }

    updatePropeller( delta );
    // Systèmes : moteur, carburant, électricité ; le modèle de vol en reçoit la puissance et l'alimentation des volets
    const mixtureInput = aircraftType === 'c172' ? mixtureKeys.KeyU - mixtureKeys.KeyY : 0;
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
    const jet = aircraftType === 'f15', heli = aircraftType === 'r44', cessna = aircraftType === 'c172';
    if (jet) updateJet(delta);
    if (heli) updateHeli(delta);
    // Au départ (choix du spawn, touche R), le moteur qui tourne déjà monte en ~1 s au lieu d'arriver d'un coup :
    // ses graves, relevés, faisaient un "boum" comme un coup de tonnerre
    spawnFade = choosingSpawn ? 0 : Math.min(1, spawnFade + delta / 1.2);
    // En cabine : plus faible et étouffé (passe-bas)
    engineSound.setCabin(!chaseView);
    const engineVolume = controls.isCrashed() || choosingSpawn ? 0 : (chaseView ? 1 : 0.45) * spawnFade * spawnFade;
    engineSound.update(cessna ? systems.rpm : 0, cessna ? engineVolume : 0, { running: cessna && systems.running, cranking: cessna && systems.cranking });
    jetSound.setCabin(!chaseView);
    jetSound.update({
        engines: jetSystems.engines, jfs: jet && jetSystems.jfsRunning, jfsLevel: jetSystems.jfs, speed: controls.getSpeed(),
        aoaWarning: jet && controls.isNearStall() && !choosingSpawn,
        gearMoving: jet && controls.model.gearPosition > 0 && controls.model.gearPosition < 1,
    }, jet ? (controls.isCrashed() || choosingSpawn ? 0 : (chaseView ? 0.6 : 0.4) * spawnFade * spawnFade) : 0);   // (avant 1 / 0,7 : couvrait les alarmes)
    updateSounds();
    waterSpray.update(delta, controls.getSurface() === 'water' && controls.isOnGround() && !controls.isCrashed());
    updateLoad();
    guard('HUD', () => updateHud(delta));
    lap('systèmes, sons, HUD');
    // Envoyé aussi au menu, au hangar et au choix du départ (avion masqué chez les autres, comme une épave) : avant,
    // rien ne partait tant que le joueur n'avait pas choisi son départ, et personne ne pouvait rejoindre sa partie
    // (« Aucune partie avec le code… » alors que le code était bon)
    guard('réseau', () => multiplayer.update( aircraft, jet ? (systems.running ? controls.getThrottle() : 0) : controls.getThrottle() * systems.power, {
        crashed: controls.isCrashed() || choosingSpawn, crashes: crashCount, spawns: spawnCount, lights: systems.lights, rpm: systems.rpm, weather: weatherName,
        jet: jet ? { gear: controls.model.gearPosition, speedbrake: controls.model.speedbrake, flaps: controls.getFlaps(), ab: jetSystems.afterburner, canopy: jetCanopy } : null,
        // (dégâts envoyés comme épaisseur de fumée × 70 : voir RemotePlayers)
        combat: { firing: weapons.firing, damage: controls.isCrashed() ? 0 : damage.smoke * 70, burning: damage.onFire && !controls.isCrashed(),
            lock: weapons.lockId, locked: weapons.locked, shield: shieldLeft() },
    } ));
    // Multijoueur : le vent suit la météo du créateur de la partie (tous les joueurs ont le même vent)
    const host = multiplayer.code && !multiplayer.isHost ? [...multiplayer.players.values()].find((p) => p.owner) : null;
    wind.setShared(host?.weather ? METARS[host.weather] ?? null : null);
    camera.updateMatrixWorld();
    engineSound.setListener( camera );
    jetSound.setListener( camera );
    r44Sound.setListener( camera );
    lap('réseau (envoi)');
    remotePlayers.engineVolume = chaseView ? 1 : 0.6; // moteurs des autres étouffés en cabine
    guard('autres joueurs', () => remotePlayers.update( delta, aircraft.position, camera, clock.elapsedTime ));
    guard('explosions', () => updateRemoteCrashes( delta ));
    lap('autres joueurs');
    guard('combat', () => updateCombat( delta ));
    lap('combat');
    guard('carte', () => updateMap( delta ));
    // Liste "En ligne" ouverte : distances et altitudes mises à jour chaque seconde
    if ((onlineTimer -= delta) <= 0) {
        onlineTimer = 1;
        if (!menuContent.get(onlineMenu).hidden) updateOnlineList();
    }
    clouds.setSeeThrough( choosingSpawn && !inHangar ); // choix de l'aérodrome / du départ, vu d'en haut
    clouds.update( camera );
    cloudLayer.update( delta, camera, weather.wind );
    for (const object of detailedObjects) {
        object.visible = object.boundingSphere.distanceToPoint(camera.position) < DETAIL_DISTANCE;
    }
    nightSky.update( camera );
    storm.update( delta, camera, aircraftVelocity, chaseView ? 0 : 3 );
    lap('carte, nuages, ciel');
    // PAPI : couleur vue de l'œil du pilote, même en vue extérieure
    pilotEyeWorld.copy(cockpit.eye).multiplyScalar(CABIN_SCALE).add(COCKPIT_POSITION).applyMatrix4(aircraft.matrixWorld);
    // Dessin limité à ce qui est visible : dalles du terrain et aérodromes au-delà du brouillard cachés
    const drawRange = Math.max(scene.fog?.far ?? 3000, 2400) + 600;
    terrain.update( camera.position, drawRange );
    airport.update( delta, Math.min(1, wind.speed / 20), camera, wind.direction, pilotEyeWorld, drawRange + 1500 );
    airport.updateHangars( delta, aircraft.position );
    decorShadowCenter.set(aircraft.position.x, terrain.heightAt(aircraft.position.x, aircraft.position.z), aircraft.position.z);
    scenery.update( camera.position, clock.elapsedTime, decorShadowCenter );
    terrain.animate( clock.elapsedTime );
    lap('relief, aérodromes, décor');
    crashEffect.update( delta );
    aircraftLights.update( camera, clock.elapsedTime );
    updateIls(delta);
    updateVor( delta );
    if (cessna) controlSurfaces?.update( delta, controls.getInputs(), controls.getFlaps(), controls.getTrim() );
    if (gear && cessna) {
        const inputs = controls.getInputs();
        gear.update( delta, inputs.yaw + inputs.roll * 0.5, controls.getSpeed(), controls.isOnGround() );   // même braquage que FlightModel
    }
    // Instruments et manches animés en cabine, et en vue extérieure quand on est assez près pour les voir
    // (R44 : toujours, ses rotors tournent par cette animation)
    if (heli || !chaseView || camera.position.distanceTo(aircraft.position) < 30) cockpit.update( delta, cockpitState() );
    updateFog();
    updateStallWarning(delta);
    lap('cabine, instruments');

    // Ombres : zone centrée sur l'avion (elle s'étend dans l'axe du soleil : l'ombre de l'avion au sol y reste, même en
    // vol) ; en cabine, zone resserrée (ombres fines dans l'habitacle)
    shadowCenter.copy(aircraft.position);
    graphics.update( shadowCenter, !chaseView, decorShadowCenter );
    graphics.setAlarm( aircraftType === 'c172' && controls.isStalled() ? 0.5 + 0.3 * Math.sin(clock.elapsedTime * 10) : 0 );
    updateF15Warnings( delta );
    touchControls.update(!inMenu && !inHangar && !choosingSpawn && !simulatorElement.classList.contains('photo'));
    tabletPanels?.update(delta, !inMenu && !inHangar && !choosingSpawn && !simulatorElement.classList.contains('photo'));
    flightHud.bottomInset = touchControls.inset;   // jauges du HUD au-dessus des commandes tactiles
    // Bouton et panneau ILS (bas gauche) : au-dessus des jauges, qui montent elles-mêmes au-dessus du manche tactile
    if (tabletPanels) {
        const reserve = Math.round(tabletLeftReserve());
        if (reserve !== lastLeftReserve) {
            lastLeftReserve = reserve;
            simulatorElement.style.setProperty('--reserve-gauche', `${reserve}px`);
        }
    }
    const insetKey = `${touchControls.inset.left}/${touchControls.inset.right}/${touchControls.insetWidth.left}/${touchControls.insetWidth.right}`;
    if (insetKey !== lastTouchInset) {
        lastTouchInset = insetKey;
        simulatorElement.style.setProperty('--tactile-gauche', `${touchControls.inset.left}px`);
        simulatorElement.style.setProperty('--tactile-droite', `${touchControls.inset.right}px`);
        simulatorElement.style.setProperty('--tactile-largeur-gauche', `${touchControls.insetWidth.left}px`);
        simulatorElement.style.setProperty('--tactile-largeur-droite', `${touchControls.insetWidth.right}px`);
    }
    lap('ombres, alarmes, tactile');
    checkNewShaders(performance.now());
    // Compilation en arrière-plan : le dessin l'attend au plus MAX_RENDER_PAUSE ms (avant : jusqu'à 8 s, et sans fin si
    // three.js ne signalait jamais la fin, par exemple après une erreur dans un shader)
    // (en vol seulement ; au menu, au hangar et au choix du départ, l'image attend la fin de la compilation comme avant :
    // dessiner plus tôt forçait toute la compilation d'un coup, la page figeait jusqu'à 3,5 s pendant le chargement)
    const renderPause = inMenu || inHangar || choosingSpawn ? 8000 : MAX_RENDER_PAUSE;
    if (!shaderWarmup || performance.now() - shaderWarmupStart > renderPause) graphics.render();
    lap('rendu');
    freezeFrameEnd();
    updatePerf(performance.now() - frameStart);
}

// Démarrage réussi (voir index.html : écran d'erreur et nouvel essai si le simulateur ne démarre pas)
window.esmeStarted = true;
try { sessionStorage.removeItem('esme-relance'); } catch { /* stockage indisponible */ }
