import {
    AdditiveBlending,
    Color,
    ConeGeometry,
    DoubleSide,
    Group,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry,
    SpotLight,
    PointLight,
    CylinderGeometry,
    Raycaster,
    ShaderMaterial,
    Sprite,
    SpriteMaterial,
    Vector3
} from 'three';
import { flareTexture } from './LightFlare.js';
import { AIRCRAFT_SCALE } from './C172Model.js';

// Feux extérieurs du Cessna, placés sur le modèle (repère avion : x à droite, y en haut, -z vers l'avant).
// Feux de navigation directionnels (règles OACI) : rouge à gauche et vert à droite visibles de l'avant
// jusqu'à 110° sur leur côté, blanc de queue visible de l'arrière (les 140° restants).
const deg = MathUtils.degToRad;
// Positions : les feux du modèle (C172Model.js, repère avion avant agrandissement). mesh : pièces du modèle qui
// servent de verre (elles s'allument) ; rudder : feu porté par la gouverne de direction (il la suit quand elle braque)
const LIGHTS = [
    { kind: 'nav',     color: 0xff2414, position: [-5.64, 1.165, -2.086], sector: [deg(-110), deg(0)],  size: 1.1, mesh: ['LeftNavLight'] },
    { kind: 'nav',     color: 0x18ff3c, position: [5.641, 1.169, -2.087], sector: [deg(0), deg(110)],   size: 1.1, mesh: ['RightNavLight'] },
    // Feu de queue : au bord de fuite de la gouverne de direction
    { kind: 'nav',     color: 0xffffff, position: [0, 1.612, 3.85],      sector: [deg(110), deg(250)], size: 0.8, mesh: ['RearNavLight'], rudder: true },
    // Anticollision : au sommet de la dérive (partie fixe, au-dessus de la gouverne)
    { kind: 'beacon',  color: 0xff1a0a, position: [0, 1.69, 3.27],                                      size: 1.6 },
    // Strobes : verre clair à part, en goutte, sur le flanc du saumon juste derrière le feu de navigation (comme sur
    // les Cessna 172) ; luminaire ajouté au modèle (voir strobeFixture)
    { kind: 'strobe',  color: 0xf2f6ff, position: [-5.652, 1.172, -1.94],                               size: 3.2 },
    { kind: 'strobe',  color: 0xf2f6ff, position: [5.652, 1.172, -1.94],                                size: 3.2 },
    // Phares dans le bord d'attaque de l'aile gauche : atterrissage (extérieur, faisceau étroit vers l'avant) et
    // roulage (intérieur, faisceau large)
    { kind: 'landing', color: 0xfff4dc, position: [-2.92, 1.143, -2.28],                                size: 3.5, mesh: ['lightlanding'] },
    { kind: 'taxi',    color: 0xfff4dc, position: [-2.807, 1.14, -2.282],                               size: 2.6, mesh: ['lighttaxi'] },
];
const SECTOR_FADE = deg(6);     // fondu aux limites de secteur

// Verre des feux du modèle : teinté à la couleur du feu (rouge ou vert profond de jour, éclairci il paraissait
// saumon), lumineux quand le feu éclaire l'observateur (émissif, capté par le halo)
function lensMaterial(color) {
    return new MeshStandardMaterial({
        color: new Color(color).multiplyScalar(0.7), emissive: color, emissiveIntensity: 0.1,
        roughness: 0.12, metalness: 0,
    });
}

// Strobe de bout d'aile : embase grise plate contre le saumon, verre clair bombé et allongé dans le sens de la corde
// (pointe vers l'arrière). Repère avion (avant agrandissement) ; side : -1 gauche, 1 droite. Rend le matériau du verre
function strobeFixture(group, position, side) {
    const fixture = new Group();
    fixture.position.fromArray(position);
    const base = new Mesh(new SphereGeometry(1, 24, 12), new MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.3, metalness: 0.2 }));
    base.scale.set(0.004, 0.026, 0.06);
    const lens = new Mesh(new SphereGeometry(1, 28, 16), new MeshStandardMaterial({
        color: 0xe9eef2, emissive: 0xf2f6ff, emissiveIntensity: 0.1, roughness: 0.05, metalness: 0,
        transparent: true, opacity: 0.85,
    }));
    lens.scale.set(0.014, 0.019, 0.05);
    lens.position.set(side * 0.003, 0, 0.004);
    // Bulbe vers l'avant, pointe vers l'arrière : la moitié arrière du verre est étirée
    const position_ = lens.geometry.attributes.position;
    for (let i = 0; i < position_.count; i++) {
        const z = position_.getZ(i);
        if (z > 0) position_.setZ(i, z * 1.5);
    }
    lens.geometry.computeVertexNormals();
    base.position.x = -side * 0.003;
    fixture.add(base, lens);
    group.add(fixture);
    return lens.material;
}

// Feu anticollision (beacon) sur le sommet de la dérive : embase métallique, dôme rouge transparent, ampoule, et
// réflecteur demi-cylindrique qui tourne dedans (le faisceau balaie l'horizon un tour par seconde). Remplace le petit
// dôme du modèle. Rend { reflector, glows }
function beaconFixture(group, position) {
    const fixture = new Group();
    fixture.position.set(position[0], 1.668, position[2]);
    const metal = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.7 });
    const base = new Mesh(new CylinderGeometry(0.03, 0.036, 0.012, 24), metal);
    base.position.y = 0.006;
    const domeMaterial = new MeshStandardMaterial({ color: 0xc81a10, emissive: 0xff1a0a, emissiveIntensity: 0.1, roughness: 0.08,
        transparent: true, opacity: 0.7, depthWrite: false });
    const wall = new Mesh(new CylinderGeometry(0.025, 0.027, 0.03, 28, 1, true), domeMaterial);
    wall.position.y = 0.027;
    const cap = new Mesh(new SphereGeometry(0.025, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial);
    cap.position.y = 0.042;
    wall.renderOrder = cap.renderOrder = 1;
    const bulbMaterial = new MeshStandardMaterial({ color: 0xffd8c8, emissive: 0xff3a20, emissiveIntensity: 0.1 });
    const bulb = new Mesh(new SphereGeometry(0.006, 12, 8), bulbMaterial);
    bulb.position.y = 0.03;
    // Réflecteur : coque derrière l'ampoule, ouverture vers +z (orientée par update)
    const reflector = new Group();
    reflector.position.y = 0.03;
    const shell = new Mesh(new CylinderGeometry(0.017, 0.017, 0.024, 16, 1, true, Math.PI / 2, Math.PI),
        new MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.15, metalness: 0.9, side: DoubleSide }));
    reflector.add(shell);
    fixture.add(base, reflector, bulb, wall, cap);
    group.add(fixture);
    return { reflector, glows: [domeMaterial, bulbMaterial] };
}

const _eye = new Vector3();
const _hinge = new Vector3();
const _worldLight = new Vector3();
const _ray = new Vector3();
const _raycaster = new Raycaster();
const FLARE_OFFSET = 0.6;
// Lumière portée par les bouts d'aile (avion du joueur, la nuit) : lueur du feu de navigation en continu,
// éclair blanc du strobe qui éclaire le sol, les objets proches et l'avion (comme le phare)
const NAV_GLOW = 2.5;          // candelas : lueur rouge / verte sur le bout d'aile et le sol juste dessous
const STROBE_FLASH = 120;      // candelas : éclair du strobe
const TIP_LIGHT_RANGE = 40;    // portée (m)       // halo avancé vers la caméra : ne traverse pas l'aile ni le fuselage (m)

// Visibilité d'un feu dans un secteur [début, fin] d'azimut (0 = droit devant, + = vers la droite),
// avec un fondu aux limites
function sectorVisibility(azimuth, [start, end]) {
    const center = (start + end) / 2, half = (end - start) / 2;
    const offset = Math.abs(MathUtils.euclideanModulo(azimuth - center + Math.PI, Math.PI * 2) - Math.PI);
    return 1 - MathUtils.smoothstep(offset, half - SECTOR_FADE, half + SECTOR_FADE);
}

// Faisceau du phare d'atterrissage : cône de lumière additive qui s'estompe avec la distance,
// visible la nuit (poussière, humidité de l'air). Légèrement incliné vers le sol.
// length, radius : longueur et rayon au bout du cône (m) ; tilt : angle sous l'horizon
function createBeam(length = 45, radius = 7, tilt = deg(2)) {
    const geometry = new ConeGeometry(radius, length, 24, 1, true);
    geometry.translate(0, -length / 2, 0);        // sommet du cône au phare
    geometry.rotateX(Math.PI / 2 - tilt);         // pointe vers l'avant (-z), un peu vers le bas (comme le SpotLight)
    const material = new ShaderMaterial({
        uniforms: { uLength: { value: length }, uStrength: { value: 0.11 } },
        vertexShader: /* glsl */`
            varying float vAlong;
            varying float vEdge;
            void main() {
                vAlong = length(position) / ${length.toFixed(1)};
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vec3 n = normalize(normalMatrix * normal);
                vEdge = abs(dot(n, normalize(-mvPosition.xyz)));   // bords du cône plus transparents
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: /* glsl */`
            uniform float uStrength;
            varying float vAlong;
            varying float vEdge;
            void main() {
                // Apparaît à partir de quelques mètres du phare (pas de voile laiteux près de l'ampoule), s'estompe au loin
                float alpha = uStrength * smoothstep(0.02, 0.25, vAlong) * (1.0 - smoothstep(0.0, 1.0, vAlong)) * vEdge;
                gl_FragColor = vec4(vec3(1.0, 0.96, 0.86) * alpha, 1.0);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });
    const beam = new Mesh(geometry, material);
    beam.frustumCulled = false;
    return beam;
}

class AircraftLights {
    // castLight : les bouts d'aile éclairent vraiment la scène (seulement pour l'avion du joueur : chaque lumière
    // alourdit le calcul de tous les matériaux)
    constructor(parent, { castLight = false } = {}) {
        this.parent = parent;
        this.group = new Group();
        this.group.scale.setScalar(AIRCRAFT_SCALE);   // positions ci-dessus : modèle avant agrandissement
        this.night = 0;
        this.landingLight = false;
        this.switches = null;   // interrupteurs (avion du joueur) ; null : tous les feux allumés, phare la nuit
        this.occluder = null;   // modèle de l'avion : un feu caché derrière lui n'a pas de halo
        this._lastTime = 0;
        this.lights = LIGHTS.map((def) => {
            const position = new Vector3(...def.position);
            // Halo optique
            const flare = new Sprite(new SpriteMaterial({
                map: flareTexture(), color: def.color, blending: AdditiveBlending, transparent: true, depthWrite: false,
            }));
            flare.position.copy(position);
            this.group.add(flare);
            // Feux portés par l'aile (bouts d'aile, phare) : recalés sur l'aile de la cabine en vue intérieure
            const wing = Math.abs(def.position[0]) > 2;
            // glows : matériaux des verres (feux du modèle, voir setOccluder ; strobes : leur propre verre)
            let glows = [];
            if (def.kind === 'strobe') glows = [strobeFixture(this.group, def.position, Math.sign(def.position[0]))];
            if (def.kind === 'beacon') {
                this.beaconFixture = beaconFixture(this.group, def.position);
                glows = this.beaconFixture.glows;
            }
            return { ...def, wing, base: position.clone(), position, glows, flare, baseColor: flare.material.color.clone(), visibility: 1 };
        });
        // Une lumière par bout d'aile : couleur du feu de navigation, blanche pendant l'éclat du strobe. Les feux sont
        // tournés vers l'extérieur : projecteur au faisceau très large (80° autour de l'axe) dirigé vers l'extérieur
        // de l'aile et un peu vers le bas ; il éclaire le sol et les objets à côté, pas le fuselage ni l'aile
        this.tipLights = !castLight ? [] : this.lights.filter((light) => light.kind === 'nav' && light.wing).map((nav) => {
            const side = Math.sign(nav.base.x);
            const light = new SpotLight(nav.color, 0, TIP_LIGHT_RANGE, MathUtils.degToRad(80), 0.6, 2);
            light.position.set(nav.base.x + side * 0.05, nav.base.y, nav.base.z);
            light.target.position.set(nav.base.x + side * 10, nav.base.y - 3, nav.base.z);
            light.visible = false;
            light.userData.navColor = new Color(nav.color);
            this.group.add(light, light.target);
            return light;
        });
        // Anticollision (avion du joueur, la nuit) : éclair rouge sur la dérive, le dessus du fuselage et le sol
        this.beaconLight = castLight ? new PointLight(0xff2010, 0, 30, 2) : null;
        if (this.beaconLight) {
            this.beaconLight.position.set(0, 1.74, 3.27);
            this.beaconLight.visible = false;
            this.group.add(this.beaconLight);
        }
        // Faisceaux : atterrissage (long, étroit, presque à l'horizontale), roulage (court, large, plongeant)
        this.beam = createBeam();
        this.beam.position.set(-2.92, 1.14, -2.4);
        this.taxiBeam = createBeam(14, 6, deg(8));
        this.taxiBeam.position.set(-2.807, 1.14, -2.4);
        this.taxiBeam.material.uniforms.uStrength.value = 0.05;
        for (const beam of [this.beam, this.taxiBeam]) {
            beam.visible = false;
            this.group.add(beam);
        }
        parent.add(this.group);
    }

    // night : 0 = jour (feux discrets), 1 = nuit (halos larges) ; landingLight : phare allumé
    setNight(night, landingLight = night >= 0.5) {
        this.night = night;
        this.landingLight = landingLight;
        this.beam.visible = this.taxiBeam.visible = landingLight;
        // De nuit seulement, comme le phare (voir simulator.js) : le jour, elles ne se verraient pas
        for (const light of this.tipLights) light.visible = landingLight;
        if (this.beaconLight) this.beaconLight.visible = night >= 0.5 && (this.switches?.beacon ?? true);
    }

    // Interrupteurs de la cabine : { nav, beacon, strobe, land }
    setSwitches(switches) {
        this.switches = switches;
        this.landingLight = switches.land;
        this.beam.visible = switches.land && this.night >= 0.5;
        this.taxiBeam.visible = switches.taxi && this.night >= 0.5;
        for (const light of this.tipLights) light.visible = this.night >= 0.5 && (switches.nav || switches.strobe);
        if (this.beaconLight) this.beaconLight.visible = this.night >= 0.5 && switches.beacon;
    }

    // Vue cabine : les feux restent sur l'aile (la même que vue de l'extérieur) ; faisceau un peu plus discret vu
    // de la cabine (on est tout près du cône)
    setCabinView(cabin) {
        this._cabin = cabin;
        // Roulage : faisceau large et proche, plus discret (sinon, devant l'avion, on est dedans et l'image blanchit)
        // Vue cabine : on est juste derrière les faisceaux, leur voile couvrait la vue : à peine visibles
        this.beam.material.uniforms.uStrength.value = cabin ? 0.03 : 0.11;
        this.taxiBeam.material.uniforms.uStrength.value = cabin ? 0.012 : 0.05;
    }

    // Modèle de l'avion : il cache les feux qui sont derrière lui, et ses feux (verres) s'allument
    setOccluder(model) {
        this.occluder = model;
        for (const name of ['Beacon']) {
            const mesh = model.getObjectByName(name);
            if (mesh) mesh.visible = false;   // remplacé par beaconFixture
        }
        for (const light of this.lights) {
            if (!light.mesh) continue;
            light.glows = [];
            for (const name of light.mesh) {
                const mesh = model.getObjectByName(name);
                if (!mesh?.isMesh) continue;
                mesh.material = lensMaterial(light.color);   // propre à ce feu (le matériau d'origine est partagé)
                light.glows.push(mesh.material);
            }
        }
    }

    // Gouverne de direction (pivot sur sa charnière, voir C172Model.js) : elle porte le feu de queue (le verre du modèle
    // y est rattaché ; ici, son halo la suit). L'anticollision est sur la partie fixe de la dérive
    setRudder(pivot) {
        this.rudder = pivot;
    }

    _followRudder() {
        const pivot = this.rudder;
        if (!pivot?.parent) return;
        // Charnière dans le repère des feux
        _hinge.copy(pivot.position);
        pivot.parent.localToWorld(_hinge);
        this.group.worldToLocal(_hinge);
        for (const light of this.lights) {
            if (!light.rudder) continue;
            light.position.copy(light.base).sub(_hinge).applyQuaternion(pivot.quaternion).add(_hinge);
        }
    }

    update(camera, time) {
        const delta = Math.min(0.1, Math.max(0, time - this._lastTime));
        this._lastTime = time;
        _eye.copy(camera.position);
        this.group.updateWorldMatrix(true, false);
        this.group.worldToLocal(_eye);                      // repère des feux (agrandi avec l'avion)
        const occluder = this._cabin ? null : this.occluder; // pas de test en cabine (modèle caché, sauf l'hélice)
        const beaconPhase = (time % 1) * Math.PI * 2;      // anticollision : un tour par seconde
        const strobe = time % 1.4;                          // strobes : double éclat toutes les 1,4 s
        const strobeOn = strobe < 0.05 || (strobe > 0.16 && strobe < 0.21);
        const sw = this.switches ?? { nav: true, beacon: true, strobe: true, land: this.landingLight, taxi: this.landingLight };
        this._followRudder();
        // Réflecteur du beacon : ouverture tournée vers l'azimut du faisceau (0 = avant, + = droite)
        if (this.beaconFixture && sw.beacon) this.beaconFixture.reflector.rotation.y = Math.PI - beaconPhase;
        if (this.beaconLight?.visible) {
            // Deux éclats par tour vus de partout (le faisceau balaie tout autour) : lumière pulsée
            this.beaconLight.intensity = 6 * Math.pow(Math.max(0, Math.cos(beaconPhase * 2)), 8);
        }
        for (const light of this.tipLights) {
            const flash = strobeOn && sw.strobe;
            if (flash) light.color.setRGB(1, 1, 1);
            else light.color.copy(light.userData.navColor);
            light.intensity = flash ? STROBE_FLASH : sw.nav ? NAV_GLOW : 0;
        }

        for (const light of this.lights) {
            const toEye = _eye.clone().sub(light.position);
            const distance = toEye.length();
            let intensity = 1;
            const enabled = light.kind === 'landing' ? sw.land : sw[light.kind];   // taxi : sw.taxi
            if (!enabled) {
                intensity = 0;
            } else if (light.kind === 'nav') {
                intensity = sectorVisibility(Math.atan2(toEye.x, -toEye.z), light.sector);
            } else if (light.kind === 'landing' || light.kind === 'taxi') {
                // Faisceau vers l'avant : éblouit quand on est dans l'axe, invisible de côté et de l'arrière (roulage :
                // faisceau large, visible sur un angle plus grand)
                const facing = -toEye.z / Math.max(distance, 0.01);
                intensity = Math.pow(Math.max(0, facing), light.kind === 'taxi' ? 2 : 4);
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
                _worldLight.copy(light.position).applyMatrix4(this.group.matrixWorld);
                _ray.subVectors(_worldLight, camera.position);
                const far = _ray.length() - 0.35; // le feu est fixé contre la carlingue : on ne teste pas les derniers cm
                _raycaster.set(camera.position, _ray.normalize());
                _raycaster.far = Math.max(0, far);
                target = _raycaster.intersectObject(occluder, true).length ? 0 : 1;
            }
            light.visibility += (target - light.visibility) * Math.min(1, delta * 20);
            intensity *= light.kind === 'strobe' ? target : light.visibility; // l'éclair d'un strobe est trop bref pour un fondu

            // Verre toujours en place : teinté quand le feu ne nous éclaire pas (hors secteur, entre deux éclats),
            // très lumineux sinon (au-delà de 1 : capté par le halo du bloom). Feux colorés de jour : éclat modéré (un
            // rouge saturé très lumineux vire à l'orange au rendu ; le halo suffit à les voir) ; strobe : éclair blanc
            const peak = light.kind === 'strobe' || light.kind === 'landing' || light.kind === 'taxi' ? 3 : 0.8 + 2.2 * this.night;
            let glow = 0.1 + peak * Math.min(1, intensity * 1.5);
            // Feu de navigation vu hors de son secteur (de l'arrière, règle OACI : pas de halo) : le verre reste
            // allumé, plus faiblement, la nuit
            if (light.kind === 'nav' && sw.nav) glow = Math.max(glow, 0.1 + 0.9 * this.night);
            for (const material of light.glows) material.emissiveIntensity = glow;
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
