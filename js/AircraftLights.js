import {
    AdditiveBlending,
    Group,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    Raycaster,
    SphereGeometry,
    Sprite,
    SpriteMaterial,
    Vector3
} from 'three';
import { flareTexture } from './LightFlare.js';

// Feux extérieurs du Cessna, placés sur le modèle (repère avion : x à droite, y en haut, -z vers l'avant).
// Feux de navigation directionnels (règles OACI) : rouge à gauche et vert à droite visibles de l'avant
// jusqu'à 110° sur leur côté, blanc de queue visible de l'arrière (les 140° restants).
const deg = MathUtils.degToRad;
const LIGHTS = [
    { kind: 'nav',    color: 0xff2414, position: [-5.62, 1.33, -2.62], sector: [deg(-110), deg(0)],   size: 1.1 },
    { kind: 'nav',    color: 0x18ff3c, position: [5.62, 1.33, -2.62],  sector: [deg(0), deg(110)],    size: 1.1 },
    { kind: 'nav',    color: 0xffffff, position: [0, 1.38, 5.2],      sector: [deg(110), deg(250)],  size: 0.9 },
    { kind: 'beacon', color: 0xff1a0a, position: [0, 3.52, 4.45],                                    size: 1.6 },
    { kind: 'strobe', color: 0xf2f6ff, position: [-5.58, 1.3, -1.75],                                size: 3.2 },
    { kind: 'strobe', color: 0xf2f6ff, position: [5.58, 1.3, -1.75],                                 size: 3.2 },
];
const SECTOR_FADE = deg(6);     // fondu aux limites de secteur

const _eye = new Vector3();
const _worldLight = new Vector3();
const _ray = new Vector3();
const _raycaster = new Raycaster();
const FLARE_OFFSET = 0.6;       // halo avancé vers la caméra : ne traverse pas l'aile ni le fuselage (m)

// Visibilité d'un feu dans un secteur [début, fin] d'azimut (0 = droit devant, + = vers la droite),
// avec un fondu aux limites
function sectorVisibility(azimuth, [start, end]) {
    const center = (start + end) / 2, half = (end - start) / 2;
    const offset = Math.abs(MathUtils.euclideanModulo(azimuth - center + Math.PI, Math.PI * 2) - Math.PI);
    return 1 - MathUtils.smoothstep(offset, half - SECTOR_FADE, half + SECTOR_FADE);
}

class AircraftLights {
    constructor(parent) {
        this.parent = parent;
        this.group = new Group();
        this.night = 0;
        this.occluder = null;   // modèle de l'avion : un feu caché derrière lui n'a pas de halo
        this._lastTime = 0;
        this.lights = LIGHTS.map((def) => {
            const position = new Vector3(...def.position);
            // Ampoule (petite sphère très lumineuse, captée par le bloom)
            const bulbMaterial = new MeshBasicMaterial({ color: def.color });
            bulbMaterial.color.multiplyScalar(4);
            const bulb = new Mesh(new SphereGeometry(def.kind === 'strobe' ? 0.05 : 0.07, 10, 8), bulbMaterial);
            bulb.position.copy(position);
            // Halo optique
            const flare = new Sprite(new SpriteMaterial({
                map: flareTexture(), color: def.color, blending: AdditiveBlending, transparent: true, depthWrite: false,
            }));
            flare.position.copy(position);
            this.group.add(bulb, flare);
            return { ...def, position, bulb, flare, baseColor: flare.material.color.clone(), visibility: 1 };
        });
        parent.add(this.group);
    }

    // night : 0 = jour (feux discrets), 1 = nuit (halos larges)
    setNight(night) {
        this.night = night;
    }

    // Le halo d'un feu masqué par l'avion lui-même (aile, fuselage) s'efface
    setOccluder(model) {
        this.occluder = model;
    }

    update(camera, time) {
        const delta = Math.min(0.1, Math.max(0, time - this._lastTime));
        this._lastTime = time;
        _eye.copy(camera.position);
        this.parent.worldToLocal(_eye);
        const occluder = this.occluder?.visible ? this.occluder : null; // pas de test en cabine (modèle caché)
        const beaconPhase = (time % 1) * Math.PI * 2;      // anticollision : un tour par seconde
        const strobe = time % 1.4;                          // strobes : double éclat toutes les 1,4 s
        const strobeOn = strobe < 0.05 || (strobe > 0.16 && strobe < 0.21);

        for (const light of this.lights) {
            const toEye = _eye.clone().sub(light.position);
            const distance = toEye.length();
            let intensity = 1;
            if (light.kind === 'nav') {
                intensity = sectorVisibility(Math.atan2(toEye.x, -toEye.z), light.sector);
            } else if (light.kind === 'beacon') {
                // Faisceau tournant : éclat bref quand il balaie vers l'observateur
                const azimuth = Math.atan2(toEye.x, -toEye.z);
                intensity = Math.pow(Math.max(0, Math.cos(beaconPhase - azimuth)), 6);
            } else {
                intensity = strobeOn ? 1 : 0;
            }

            // Occultation par l'avion : rayon de la caméra vers le feu, fondu rapide pour éviter le clignotement
            let target = 1;
            if (occluder && intensity > 0.02) {
                _worldLight.copy(light.position).applyMatrix4(this.parent.matrixWorld);
                _ray.subVectors(_worldLight, camera.position);
                const far = _ray.length() - 0.35; // le feu est fixé contre la carlingue : on ne teste pas les derniers cm
                _raycaster.set(camera.position, _ray.normalize());
                _raycaster.far = Math.max(0, far);
                target = _raycaster.intersectObject(occluder, true).length ? 0 : 1;
            }
            light.visibility += (target - light.visibility) * Math.min(1, delta * 20);
            intensity *= light.kind === 'strobe' ? target : light.visibility; // l'éclair d'un strobe est trop bref pour un fondu

            light.bulb.visible = intensity > 0.02 || light.kind === 'nav';
            light.flare.visible = intensity > 0.02;
            if (!light.flare.visible) continue;
            light.flare.position.copy(light.position).addScaledVector(toEye, FLARE_OFFSET / Math.max(distance, 0.01));
            const brightness = (1.2 + 2.3 * this.night) * intensity;
            light.flare.material.color.copy(light.baseColor).multiplyScalar(brightness);
            // Halo plus large la nuit ; grossit un peu avec la distance pour rester visible de loin
            const size = light.size * (0.45 + 0.55 * this.night) * (1 + distance * 0.012);
            light.flare.scale.setScalar(size * (0.6 + 0.4 * intensity));
        }
    }
}

export { AircraftLights };
