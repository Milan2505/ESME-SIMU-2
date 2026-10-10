import {
    AdditiveBlending,
    BoxGeometry,
    CapsuleGeometry,
    CircleGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    ExtrudeGeometry,
    DoubleSide,
    Group,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    PointLight,
    Raycaster,
    Shape,
    ShaderMaterial,
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
// Le modèle n'est pas symétrique : le saumon gauche est plus bas (y 1,01 à 1,16, x -5,56)
// que le droit (y 1,26 à 1,41, x 5,51). Bord d'attaque des saumons : z -2,78.
const LIGHTS = [
    // Bouts d'aile : verre en amande encastré dans la face extérieure du saumon (x -5,56 / 5,51), à l'avant
    // (bord d'attaque à z -2,78), tourné vers l'extérieur et un peu vers l'avant
    { kind: 'nav',     color: 0xff2414, position: [-5.57, 1.08, -2.63],  sector: [deg(-110), deg(0)],  size: 1.1 },
    { kind: 'nav',     color: 0x18ff3c, position: [5.52, 1.33, -2.63],   sector: [deg(0), deg(110)],   size: 1.1 },
    // Feu de queue, encastré dans le bout du cône de queue (modèle : z 6,52 -> 4,52), sous la direction
    { kind: 'nav',     color: 0xffffff, position: [-0.03, 1.2, 4.5],    sector: [deg(110), deg(250)], size: 0.8 },
    // Sommet de la partie fixe de la dérive
    { kind: 'beacon',  color: 0xff1a0a, position: [-0.07, 3.5, 4.35],                                   size: 1.6 },
    // Strobes : dans le même bloc que le feu de navigation (diode blanche côté saumon), comme sur un vrai Cessna
    { kind: 'strobe',  color: 0xf2f6ff, position: [-5.575, 1.08, -2.61],                                size: 3.2 },
    { kind: 'strobe',  color: 0xf2f6ff, position: [5.525, 1.33, -2.61],                                 size: 3.2 },
    // Phare d'atterrissage dans le bord d'attaque de l'aile gauche (z -2,869 à cet endroit) : éblouissant vu de face, allumé de nuit
    { kind: 'landing', color: 0xfff4dc, position: [-2.2, 1.12, -2.872],                                  size: 3.5 },
];
const SECTOR_FADE = deg(6);     // fondu aux limites de secteur

// --- Luminaires (modélisés d'après ceux d'un Cessna 172) -------------------------------------
// Chaque feu a un boîtier et un verre teinté ; le verre s'illumine (émissif, capté par le halo) quand le feu
// éclaire l'observateur, et reste coloré éteint, comme un vrai verre de feu. Repère du luminaire = repère avion.
const metalMaterial = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.25, metalness: 0.85 });   // socle, réflecteur
const blackMaterial = new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
// Enjoliveur argenté (pas tout à fait métallique : sans carte d'environnement, un métal pur paraît noir)
const chromeMaterial = new MeshStandardMaterial({ color: 0xd4d8dc, roughness: 0.22, metalness: 0.55 });

// Verre teinté qui s'allume : couleur du verre éclaircie, transparent, émissif à la couleur du feu
function lensMaterial(color, opacity = 0.75) {
    return new MeshStandardMaterial({
        color: new Color(color).lerp(new Color(0xffffff), 0.08), emissive: color, emissiveIntensity: 0.1,
        roughness: 0.08, metalness: 0, transparent: true, opacity, depthWrite: false,
    });
}

// Contour en amande (pointu aux deux bouts), largeur w, hauteur h, centré
function almond(w, h) {
    const shape = new Shape();
    shape.moveTo(-w / 2, 0);
    shape.quadraticCurveTo(0, h, w / 2, 0);
    shape.quadraticCurveTo(0, -h, -w / 2, 0);
    return shape;
}

// Diodes de strobe logées dans le bloc du feu de navigation, par côté (-1 gauche, 1 droite) : le strobe y fait clignoter la sienne
const strobeLeds = new Map();

// Feu encastré en amande, tourné vers -z : enjoliveur chromé, verre bombé, diode derrière le verre.
// strobeSide : 0 = une seule diode ; -1 / 1 = diode du feu côté intérieur et diode blanche de strobe côté saumon
function addAlmondLight(group, glows, w, h, color, opacity, strobeSide = 0) {
    const bezelShape = almond(w + 0.022, h + 0.016);
    bezelShape.holes.push(almond(w, h));
    const bezelGeometry = new ExtrudeGeometry(bezelShape, {
        depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 20,
    });
    bezelGeometry.rotateY(Math.PI);                         // extrudé vers -z (vers l'avant de la surface)
    const bezel = new Mesh(bezelGeometry, chromeMaterial);
    bezel.castShadow = true;
    // Verre bombé : demi-ellipsoïde qui sort à peine de l'enjoliveur
    const glass = new Mesh(new SphereGeometry(1, 28, 14), lensMaterial(color, opacity));
    glass.scale.set(w * 0.47, h * 0.42, 0.012);
    glass.renderOrder = 1;
    // Diode (bloc lumineux) visible à travers le verre
    const ledMaterial = new MeshStandardMaterial({ color: 0x333333, emissive: color, emissiveIntensity: 0.1, roughness: 0.4 });
    const ledWidth = strobeSide ? w * 0.22 : w * 0.38;
    const led = new Mesh(new BoxGeometry(ledWidth, h * 0.32, 0.006), ledMaterial);
    led.position.set(-strobeSide * w * 0.13, 0, -0.002);
    const base = new Mesh(new BoxGeometry(w * 0.6, h * 0.5, 0.004), blackMaterial);  // fond du logement
    base.position.z = 0.001;
    group.add(base, led, glass, bezel);
    glows.push(glass.material, ledMaterial);
    if (strobeSide) {
        const strobeMaterial = new MeshStandardMaterial({ color: 0xcfd4d8, emissive: 0xf2f6ff, emissiveIntensity: 0.1, roughness: 0.3 });
        const strobe = new Mesh(new BoxGeometry(w * 0.16, h * 0.28, 0.006), strobeMaterial);
        strobe.position.set(strobeSide * w * 0.15, 0, -0.002);
        group.add(strobe);
        strobeLeds.set(strobeSide, strobeMaterial);
    }
}

function createFixture(def) {
    const group = new Group();
    const glows = [];
    const lens = (geometry, material, x = 0, y = 0, z = 0) => {
        const mesh = new Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.renderOrder = 1;
        group.add(mesh);
        glows.push(material);
        return mesh;
    };
    const part = (geometry, material, x = 0, y = 0, z = 0) => {
        const mesh = new Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        group.add(mesh);
        return mesh;
    };
    const side = Math.sign(def.position[0]);
    if (def.kind === 'nav' && Math.abs(def.position[0]) > 2) {
        // Bout d'aile : feu en amande encastré à l'avant du saumon, comme sur les Cessna 172 récents (verre teinté
        // rouge à gauche, vert à droite) ; allongé dans le sens de la corde, tourné vers l'extérieur et 20° vers l'avant.
        // Diode du feu à l'avant, diode du strobe derrière
        addAlmondLight(group, glows, 0.15, 0.05, def.color, 0.6, side);
        group.rotation.y = -side * deg(70);
    } else if (def.kind === 'nav') {
        // Feu de queue : petit verre blanc au bout du cône de queue, sur une embase
        part(new CylinderGeometry(0.032, 0.036, 0.04, 14), metalMaterial, 0, 0, -0.03).rotation.x = Math.PI / 2;
        lens(new SphereGeometry(0.03, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), lensMaterial(def.color, 0.65), 0, 0, -0.01)
            .rotation.x = Math.PI / 2;                      // dôme tourné vers l'arrière
    } else if (def.kind === 'beacon') {
        // Gyrophare sur la dérive : socle, verre rouge cylindrique à dôme
        part(new CylinderGeometry(0.035, 0.05, 0.035, 16), metalMaterial, 0, -0.06, 0);
        lens(new CapsuleGeometry(0.03, 0.045, 6, 16), lensMaterial(def.color, 0.8), 0, -0.005, 0);
    } else if (def.kind === 'strobe') {
        // Strobe : pas de luminaire à lui, il fait éclater sa diode dans le bloc du feu de navigation
        const led = strobeLeds.get(side);
        if (led) glows.push(led);
    } else {
        // Phare d'atterrissage : capot transparent affleurant le bord d'attaque, réflecteur et ampoule derrière
        // (le bord d'attaque est plein : réflecteur et ampoule juste devant lui, sous le capot)
        part(new CircleGeometry(0.045, 20), metalMaterial, 0, 0, 0.004).rotation.y = Math.PI;   // face vers l'avant
        lens(new CircleGeometry(0.02, 16), new MeshStandardMaterial({ color: 0xfff6e0, emissive: def.color, emissiveIntensity: 0.1 }), 0, 0, 0.001)
            .rotation.y = Math.PI;
        const cover = new Mesh(new BoxGeometry(0.28, 0.1, 0.008), lensMaterial(0xe8f0f4, 0.3));
        cover.position.z = -0.006;
        cover.renderOrder = 1;
        group.add(cover);
    }
    group.position.fromArray(def.position);
    return { group, glows };
}

const _eye = new Vector3();
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
function createBeam() {
    const length = 45;
    const geometry = new ConeGeometry(7, length, 24, 1, true);
    geometry.translate(0, -length / 2, 0);        // sommet du cône au phare
    geometry.rotateX(Math.PI / 2 - deg(2));       // pointe vers l'avant (-z), un peu vers le bas (comme le SpotLight)
    const material = new ShaderMaterial({
        uniforms: { uLength: { value: length }, uStrength: { value: 0.11 } },
        vertexShader: /* glsl */`
            varying float vAlong;
            varying float vEdge;
            void main() {
                vAlong = length(position) / 45.0;
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
        this.night = 0;
        this.landingLight = false;
        this.switches = null;   // interrupteurs (avion du joueur) ; null : tous les feux allumés, phare la nuit
        this.occluder = null;   // modèle de l'avion : un feu caché derrière lui n'a pas de halo
        this._lastTime = 0;
        this.lights = LIGHTS.map((def) => {
            const position = new Vector3(...def.position);
            // Luminaire : boîtier et verre, qui s'illumine (voir createFixture)
            const { group: bulb, glows } = createFixture(def);
            // Halo optique
            const flare = new Sprite(new SpriteMaterial({
                map: flareTexture(), color: def.color, blending: AdditiveBlending, transparent: true, depthWrite: false,
            }));
            flare.position.copy(position);
            this.group.add(bulb, flare);
            // Feux portés par l'aile (bouts d'aile, phare) : recalés sur l'aile de la cabine en vue intérieure
            const wing = Math.abs(def.position[0]) > 2;
            return { ...def, wing, base: position.clone(), position, bulb, glows, flare, baseColor: flare.material.color.clone(), visibility: 1 };
        });
        // Une lumière par bout d'aile : couleur du feu de navigation, blanche pendant l'éclat du strobe
        this.tipLights = !castLight ? [] : this.lights.filter((light) => light.kind === 'nav' && light.wing).map((nav) => {
            const side = Math.sign(nav.base.x);
            const light = new PointLight(nav.color, 0, TIP_LIGHT_RANGE, 2);
            light.position.set(nav.base.x + side * 0.4, nav.base.y + 0.1, nav.base.z + 0.3);   // un peu à l'extérieur
            light.visible = false;
            light.userData.navColor = new Color(nav.color);
            this.group.add(light);
            return light;
        });
        this.beam = createBeam();
        this.beam.position.set(-2.2, 1.12, -3);
        this.beam.visible = false;
        this.group.add(this.beam);
        parent.add(this.group);
    }

    // night : 0 = jour (feux discrets), 1 = nuit (halos larges) ; landingLight : phare allumé
    setNight(night, landingLight = night >= 0.5) {
        this.night = night;
        this.landingLight = landingLight;
        this.beam.visible = landingLight;
        // De nuit seulement, comme le phare (voir simulator.js) : le jour, elles ne se verraient pas
        for (const light of this.tipLights) light.visible = landingLight;
    }

    // Interrupteurs de la cabine : { nav, beacon, strobe, land }
    setSwitches(switches) {
        this.switches = switches;
        this.landingLight = switches.land;
        this.beam.visible = switches.land && this.night >= 0.5;
        for (const light of this.tipLights) light.visible = this.night >= 0.5 && (switches.nav || switches.strobe);
    }

    // Le halo d'un feu masqué par l'avion lui-même (aile, fuselage) s'efface
    // Vue cabine : l'aile modélisée dans la cabine (voir Cockpit.js) est 0,5 m plus en arrière et plus haute que
    // celle du modèle extérieur ; les feux d'aile s'y recalent (bord d'attaque à z -2,28, extrados vers y 1,35)
    setCabinView(cabin) {
        this._cabin = cabin;
        for (const light of this.lights) {
            if (!light.wing) continue;
            light.position.copy(light.base);
            // Phare au nez du bord d'attaque arrondi de la cabine (z -2,28) ; feux de bout d'aile sur ses saumons (x ±5,55)
            if (cabin && light.kind === 'landing') light.position.set(light.base.x, 1.35, -2.285);
            else if (cabin) light.position.set(Math.sign(light.base.x) * 5.555, 1.35, light.base.z + 0.5);
            light.bulb.position.copy(light.position);
        }
        // Faisceau recalé avec le phare ; un peu plus discret vu de la cabine (on est tout près du cône)
        this._cabin = cabin;
        this.beam.position.set(-2.2, cabin ? 1.35 : 1.12, cabin ? -2.4 : -3);
        this.beam.material.uniforms.uStrength.value = cabin ? 0.09 : 0.11;
    }

    setOccluder(model) {
        this.occluder = model;
    }

    update(camera, time) {
        const delta = Math.min(0.1, Math.max(0, time - this._lastTime));
        this._lastTime = time;
        _eye.copy(camera.position);
        this.parent.worldToLocal(_eye);
        const occluder = this._cabin ? null : this.occluder; // pas de test en cabine (modèle caché, sauf l'hélice)
        const beaconPhase = (time % 1) * Math.PI * 2;      // anticollision : un tour par seconde
        const strobe = time % 1.4;                          // strobes : double éclat toutes les 1,4 s
        const strobeOn = strobe < 0.05 || (strobe > 0.16 && strobe < 0.21);
        const sw = this.switches ?? { nav: true, beacon: true, strobe: true, land: this.landingLight };
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
            const enabled = light.kind === 'landing' ? sw.land : sw[light.kind];
            if (!enabled) {
                intensity = 0;
            } else if (light.kind === 'nav') {
                intensity = sectorVisibility(Math.atan2(toEye.x, -toEye.z), light.sector);
            } else if (light.kind === 'landing') {
                // Faisceau vers l'avant : éblouit quand on est dans l'axe, invisible de côté et de l'arrière
                const facing = -toEye.z / Math.max(distance, 0.01);
                intensity = this.landingLight ? Math.pow(Math.max(0, facing), 4) : 0;
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

            // Verre toujours en place : teinté quand le feu ne nous éclaire pas (hors secteur, entre deux éclats),
            // très lumineux sinon (au-delà de 1 : capté par le halo du bloom)
            let glow = 0.1 + 3 * Math.min(1, intensity * 1.5);
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
