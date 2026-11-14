import {
    Box3,
    BoxGeometry,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    MathUtils,
    Matrix3,
    Mesh,
    MeshStandardMaterial,
    Vector3
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Airport } from './Airport.js';
import { isTablet } from './Device.js';
import { track } from './Loading.js';
import { mergeStatic } from './MergeStatic.js';

// Porte-avions (carte « Mer ») : il prend la place d'un aérodrome (départs, hangar, tour, ILS, Wardog) mais tout se
// passe sur son pont, DECK m au-dessus de l'eau. Repère du navire : origine au milieu du pont, étrave vers -z (nord
// quand rotation = 0), tribord vers +x. Navire immobile (au mouillage).
//
// Modèle : USS Harry S. Truman (CVN-75, classe Nimitz) du projet FlightGear, à sa taille réelle (pont de 333 m sur
// 78 m, à 20 m au-dessus de l'eau ; le F-15, 19,4 m, y est à l'échelle). Converti par asset/blender/build_carrier.py
// (asset/carrier/truman.glb). Toutes les positions ci-dessous sont relevées sur ce modèle :
// - piste oblique (appontage) : part de l'arrière, à 9,2° vers bâbord ; quatre brins d'arrêt (WIRES, m après le seuil)
// - deux catapultes d'étrave (CATAPULTS : départ juste devant le déflecteur de souffle, direction, course), pour
//   décoller en ~2 s (voir « Porte-avions » dans simulator.js)
// - îlot à tribord (obstacles), coque sous le pont (la percuter : crash, voir simulator.js)

const DECK = 20;                      // hauteur du pont au-dessus de l'eau (m)
const ANGLE = Math.atan2(6.05, 37.3); // piste oblique : 9,2° à bâbord de l'axe du navire (du brin 1 au brin 4)
// Contour du pont (repère du navire) : tribord de l'étrave à la poupe, puis bâbord de la poupe à l'étrave (aileron
// bâbord de la piste oblique, ascenseurs compris : ils sont en haut)
const DECK_OUTLINE = [
    [13, -165], [15, -148], [17, -120], [19, -104], [20, -92], [23, -84], [28, -76], [34, -68], [35.5, -64],
    [36, -8], [36.5, 112], [30, 116], [29, 132], [28, 140], [27, 144], [21, 148], [17.5, 152], [18, 163],
    [-17, 163], [-18, 152], [-19, 148], [-20, 132], [-24, 128], [-30, 124], [-40, 120], [-38.5, 116],
    [-38.5, -20], [-41, -28], [-42.5, -34], [-42.5, -60], [-35, -68], [-29, -76], [-23, -84], [-21.5, -92],
    [-21, -96], [-20, -108], [-19, -120], [-17.5, -144], [-16, -156], [-15, -165],
];
// Piste oblique : seuil 48 m avant le premier brin (repère du navire), longueur, largeur
const LANDING_DIR = { x: -Math.sin(ANGLE), z: -Math.cos(ANGLE) };
const WIRE_1 = { x: -2.4, z: 111.7 };
const RUNWAY = { x: WIRE_1.x - 48 * LANDING_DIR.x, z: WIRE_1.z - 48 * LANDING_DIR.z, length: 215, width: 24 };
const WIRES = [48, 61, 73, 86];                             // brins d'arrêt : distance au seuil (m)
// Catapultes d'étrave : navette au départ (la roulette de nez de l'avion se pose dessus, voir noseWheelAhead dans
// simulator.js), direction (un peu vers bâbord), course de la navette
const CATAPULTS = [
    { x: 17.31, z: -62.88, dx: -0.0904, dz: -0.9959, stroke: 95.6 },   // n° 1, tribord
    { x: -8.31, z: -56.97, dx: -0.0290, dz: -0.9996, stroke: 98.5 },   // n° 2, bâbord
];
// Îlot (passerelle, mât avant et radars) et mât arrière : obstacles
const ISLAND = [
    { minX: 21.5, maxX: 37, minZ: 37, maxZ: 70, height: 45 },
    { minX: 26, maxX: 35.5, minZ: 73, maxZ: 83.5, height: 23.5 },
];
const PARK = { x: 23, z: 118 };      // avion présenté au « hangar » (pont arrière, à tribord), nez vers bâbord
const MODEL_URL = isTablet() ? 'asset/carrier/truman-mobile.glb' : 'asset/carrier/truman.glb';
let modelLoading = null;   // (un seul chargement pour les deux navires : chacun en prend une copie)
// Navette de chaque catapulte : toutes les pièces autour de son départ (m le long de l'axe : en arrière, en avant ; de
// côté ; au-dessus et au-dessous du pont), d'un seul tenant : rampe sous la roulette, corps gris et ses rails, de
// 3,4 m derrière à 1,4 m devant, enfoncés jusqu'à 12 cm dans la fente. Avant, seul ce qui dépassait du pont était pris :
// le corps, qui plonge dans la fente, restait sur place et la navette avançait en deux morceaux
const SHUTTLE_BOX = { back: 3.6, front: 1.6, side: 0.8, top: 0.5, bottom: 0.2 };
const SHUTTLE_PAUSE = 1;      // s : navette arrêtée en bout de course après le lancement
const SHUTTLE_RETURN = 12;    // m/s : puis elle revient à son départ
let shuttleParts = null;      // par catapulte : [{ geometry, material }] (pris dans le modèle, voir extractShuttles)

function insideShuttle(c, p) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const along = dx * c.dx + dz * c.dz, lateral = dx * c.dz - dz * c.dx;
    return p.y > DECK - SHUTTLE_BOX.bottom && p.y < DECK + SHUTTLE_BOX.top && along > -SHUTTLE_BOX.back
        && along < SHUTTLE_BOX.front && Math.abs(lateral) < SHUTTLE_BOX.side;
}

// Navettes des catapultes : dans le modèle, elles sont fondues dans le pont. Leurs triangles en sont retirés (réduits à
// un point) et refaits en pièces à part (mêmes matériaux), placées au départ de chaque catapulte (origine : son départ,
// au niveau de la mer), qu'on fait avancer avec l'avion (voir moveShuttle)
function extractShuttles(scene) {
    scene.updateMatrixWorld(true);
    const parts = CATAPULTS.map(() => new Map());   // matériau -> { nom d'attribut -> valeurs }
    const v = [new Vector3(), new Vector3(), new Vector3()], n = new Vector3();
    scene.traverse((mesh) => {
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index;
        const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
        const count = index ? index.count : position.count;
        let changed = false;
        for (let t = 0; t + 2 < count; t += 3) {
            const ids = [t, t + 1, t + 2].map((i) => (index ? index.getX(i) : i));
            ids.forEach((id, k) => v[k].fromBufferAttribute(position, id).applyMatrix4(mesh.matrixWorld));
            // (face au ras du pont : le pont lui-même, laissé en place)
            if (v.every((p) => Math.abs(p.y - DECK) < 0.002)) continue;
            const cat = CATAPULTS.findIndex((c) => v.every((p) => insideShuttle(c, p)));
            if (cat < 0) continue;
            const c = CATAPULTS[cat];
            let part = parts[cat].get(mesh.material);
            if (!part) parts[cat].set(mesh.material, part = {});
            ids.forEach((id, k) => {
                for (const [name, attribute] of Object.entries(geometry.attributes)) {
                    const values = part[name] ??= [];
                    if (name === 'position') values.push(v[k].x - c.x, v[k].y, v[k].z - c.z);
                    else if (name === 'normal') {
                        n.fromBufferAttribute(attribute, id).applyMatrix3(normalMatrix).normalize();
                        values.push(n.x, n.y, n.z);
                    } else for (let j = 0; j < attribute.itemSize; j++) values.push(attribute.getComponent(id, j));
                }
            });
            if (index) {
                index.setX(t + 1, ids[0]);
                index.setX(t + 2, ids[0]);
            } else {
                for (const i of [t + 1, t + 2]) position.setXYZ(i, position.getX(t), position.getY(t), position.getZ(t));
            }
            changed = true;
        }
        if (changed) (index ?? position).needsUpdate = true;
    });
    return parts.map((map) => [...map].map(([material, attributes]) => {
        const geometry = new BufferGeometry();
        for (const [name, values] of Object.entries(attributes)) {
            const itemSize = name === 'position' || name === 'normal' ? 3 : values.length / (attributes.position.length / 3);
            geometry.setAttribute(name, new Float32BufferAttribute(values, itemSize));
        }
        return { geometry, material };
    }));
}

// Point dans un polygone (règle pair-impair)
function insidePolygon(polygon, x, z) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

// Navires de la carte « Mer » (équipe bleue puis rouge en Wardog Navy). ~6,9 km l'un de l'autre, face à face
const CARRIERS = {
    bleu: {
        id: 'pa-bleu', label: 'PA BLEU', position: { x: 0, z: 0 }, rotation: 0, carrier: true, color: 0x2f7fd0, number: '01',
        aerodrome: { icao: 'PABL', name: 'Porte-avions bleu', taxiway: 'A', frequencies: { ground: '121.875', tower: '118.300', approach: '120.450', info: '124.550' } },
        speech: { fr: 'porte-avions bleu', en: 'blue carrier' },
        vor: { ident: 'PAB', frequency: '113.50' }, ils: '110.30',
        hangars: ['PONT ENVOL'], parked: [], lakes: [],
        description: 'Porte-avions de l\'équipe bleue, en pleine mer',
    },
    rouge: {
        id: 'pa-rouge', label: 'PA ROUGE', position: { x: 5200, z: -4520 }, rotation: Math.PI, carrier: true, color: 0xd0473c, number: '02',
        aerodrome: { icao: 'PARG', name: 'Porte-avions rouge', taxiway: 'B', frequencies: { ground: '121.700', tower: '119.250', approach: '120.900', info: '123.500' } },
        speech: { fr: 'porte-avions rouge', en: 'red carrier' },
        vor: { ident: 'PAR', frequency: '115.20' }, ils: '109.70',
        hangars: ['PONT ENVOL'], parked: [], lakes: [],
        description: 'Porte-avions de l\'équipe rouge, en pleine mer',
    },
};

class Carrier extends Airport {
    constructor(config) {
        super(config);
        this.isCarrier = true;
        this.deckHeight = DECK;
        const rotation = this.rotation;
        const world = (x, z) => this.toWorld(x, z);
        const vector = (x, y, z) => { const p = world(x, z); return new Vector3(p.x, y, p.z); };

        // Pistes : la piste oblique (appontage) et l'axe de la catapulte tribord (décollage), toutes deux vers l'avant
        const landingDir = new Vector3(LANDING_DIR.x, 0, LANDING_DIR.z);
        const cat = CATAPULTS[0];
        const local = [
            { threshold: new Vector3(RUNWAY.x, DECK, RUNWAY.z), direction: landingDir, length: RUNWAY.length, aim: WIRES[2] },
            { threshold: new Vector3(cat.x, DECK, cat.z), direction: new Vector3(cat.dx, 0, cat.dz), length: cat.stroke, aim: 30 },
        ];
        this._landing = local[0];
        this.runways = local.map((r) => {
            const direction = this.directionToWorld(r.direction);
            const localHeading = MathUtils.radToDeg(Math.atan2(r.direction.x, -r.direction.z));   // (0 = vers l'étrave)
            const heading = ((localHeading - this._rotationDeg) % 360 + 360) % 360;
            const left = new Vector3(direction.z, 0, -direction.x);
            const threshold = vector(r.threshold.x, DECK, r.threshold.z);
            return {
                name: String(Math.round(heading / 10) || 36).padStart(2, '0'), heading, airport: this, length: r.length,
                ilsFrequency: config.ils, threshold, direction, aimPoint: threshold.clone().addScaledVector(direction, r.aim),
                left, circuit: 'left', circuitSide: left.clone(),
            };
        });
        this.runwayLength = RUNWAY.length;
        // Catapultes (repère monde) : navette au départ, direction, course
        this.catapults = CATAPULTS.map((c, i) => ({
            index: i + 1, start: vector(c.x, DECK, c.z), direction: this.directionToWorld(new Vector3(c.dx, 0, c.dz)),
            stroke: c.stroke, heading: rotation + Math.atan2(-c.dx, -c.dz), carrier: this,
        }));
        // Navettes : position le long de la course (m), tenue par un avion ou non, attente en bout de course
        this._shuttles = CATAPULTS.map(() => ({ along: 0, held: false, pause: 0, group: null }));
        this.start = world(cat.x, cat.z);
        const spawnAt = (id, name, detail, x, z, heading, extra = {}) => {
            const p = world(x, z);
            return { id: `${config.id}-${id}`, name, detail, x: p.x, z: p.z, heading: heading + rotation, airport: this, ...extra };
        };
        this.spawns = [
            spawnAt('cat1', 'Catapulte 1', 'Tribord avant · postcombustion pour être lancé', cat.x, cat.z, Math.atan2(-cat.dx, -cat.dz),
                { cold: false, catapult: this.catapults[0] }),
            spawnAt('cat2', 'Catapulte 2', 'Bâbord avant · postcombustion pour être lancé', CATAPULTS[1].x, CATAPULTS[1].z,
                Math.atan2(-CATAPULTS[1].dx, -CATAPULTS[1].dz), { cold: false, catapult: this.catapults[1] }),
            spawnAt('pont', 'Pont arrière', 'Avion éteint, derrière l\'îlot : à mettre en route', PARK.x, PARK.z, Math.PI / 2, { cold: true, stand: 'P1' }),
        ];
        this.aerodrome = { ...config.aerodrome, speech: config.speech, holdingX: 0,
            stands: [{ name: 'P1', ...world(PARK.x, PARK.z), free: true }] };
        this.vor = { ...config.vor, ...world(30, 55), y: DECK + 40 };   // (sur le mât de l'îlot)
        this.ndb = vector(0, DECK, 0);
        this.hangars = [{ ...world(PARK.x, PARK.z), name: config.hangars[0],
            spot: { ...world(PARK.x, PARK.z), heading: Math.PI / 2 + rotation } }];
        // Carte (MapView) : le pont, en trois rectangles
        this.mapShapes = [
            { minX: -17, maxX: 17, minZ: -165, maxZ: 163 }, { minX: -42, maxX: -17, minZ: -64, maxZ: 122 },
            { minX: 17, maxX: 36, minZ: -70, maxZ: 145 },
        ].map((r) => ({ ...this.rectToWorld(r), kind: 'asphalt' }));
        this.center = vector(0, 0, 0);
        this.lakes = [];
        // Vues du choix du départ (mêmes noms que celles d'un aérodrome, voir SPAWN_VIEWS dans simulator.js)
        this.spawnViews = {
            ensemble: { label: 'Vue d\'ensemble', target: [0, DECK, 0], yaw: 0.6, pitch: 0.75, distance: 520 },
            rwy36: { label: 'Catapultes', target: [5, DECK, -100], yaw: 0.5, pitch: 0.38, distance: 150 },
            rwy18: { label: 'Piste oblique', target: [-6, DECK, 90], yaw: Math.PI - 0.6, pitch: 0.4, distance: 180 },
            parking: { label: 'Pont arrière', target: [PARK.x, DECK, PARK.z], yaw: -Math.PI / 2 - 0.5, pitch: 0.5, distance: 110 },
        };
        // Survol du menu principal : autour du navire
        this.menuView = { radius: 360, height: 110, target: [0, DECK, 0] };
        this._deckLights = null;
    }

    // Pont en (x, z) : sa hauteur, sinon null
    platformAt(x, z) {
        const p = this.toLocal(x, z);
        if (Math.abs(p.x) > 44 || Math.abs(p.z) > 166) return null;
        return insidePolygon(DECK_OUTLINE, p.x, p.z) ? DECK : null;
    }

    // Brins d'arrêt : position dans l'axe de la piste oblique (m après le seuil) et écart latéral, avion en (x, z)
    landingAreaAt(x, z) {
        const p = this.toLocal(x, z), r = this._landing;
        const dx = p.x - r.threshold.x, dz = p.z - r.threshold.z;
        return { along: dx * r.direction.x + dz * r.direction.z, lateral: Math.abs(dx * -r.direction.z + dz * r.direction.x) };
    }

    get wires() { return WIRES; }

    reliefFactor() { return 1; }
    dipFactor() { return 1; }
    terrainLimit() { return Infinity; }
    contains(x, z, margin = 0) {
        const p = this.toLocal(x, z);
        return Math.abs(p.x) < 50 + margin && Math.abs(p.z) < 172 + margin;
    }
    surfaceAt() { return 'asphalt'; }
    zoneAt(x, z) {
        if (this.platformAt(x, z) === null) return 'grass';
        const { along, lateral } = this.landingAreaAt(x, z);
        return along > -5 && along < RUNWAY.length && lateral < RUNWAY.width / 2 ? 'runway' : 'apron';
    }
    nearHolding() { return false; }
    standAt(x, z) {
        const p = this.toLocal(x, z);
        return Math.hypot(p.x - PARK.x, p.z - PARK.z) < 12 ? 'P1' : null;
    }

    build() {
        const group = this.group;
        const team = this.config.color;
        const model = new Group();
        group.add(model);
        // Modèle chargé en arrière-plan (écran de chargement : « Aérodromes ») ; copie pour chaque navire (géométrie et
        // textures partagées)
        modelLoading ??= track('aerodromes', 'Porte-avions (USS Truman)', () => new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
            gltf.scene.traverse((child) => {
                if (!child.isMesh) return;
                child.receiveShadow = true;
                child.castShadow = !child.material.transparent;
                child.material.side = DoubleSide;   // (faces du modèle FlightGear pas toutes orientées)
            });
            shuttleParts = extractShuttles(gltf.scene);   // (avant les copies : géométrie du pont partagée)
            return gltf.scene;
        }), { weight: 4 });
        modelLoading.then((scene) => {
            model.add(scene.clone());
            model.updateMatrixWorld(true);
            shuttleParts.forEach((parts, i) => {
                const shuttle = new Group();
                for (const { geometry, material } of parts) {
                    const mesh = new Mesh(geometry, material);
                    mesh.castShadow = mesh.receiveShadow = true;
                    shuttle.add(mesh);
                }
                group.add(shuttle);
                this._shuttles[i].group = shuttle;
                this._placeShuttle(i);
            });
        }, () => {});

        // Bande à la couleur de l'équipe, autour de l'îlot (les deux navires sont le même modèle)
        const island = ISLAND[0];
        const stripe = new Mesh(new BoxGeometry(island.maxX - island.minX - 4, 1.4, island.maxZ - island.minZ - 6),
            new MeshStandardMaterial({ color: team, roughness: 0.6 }));
        stripe.position.set((island.minX + island.maxX) / 2, DECK + 12, (island.minZ + island.maxZ) / 2);
        group.add(stripe);
        for (const box of ISLAND) {
            this.obstacles.push(new Box3(new Vector3(box.minX, DECK, box.minZ), new Vector3(box.maxX, DECK + box.height, box.maxZ)));
        }

        // Feux de bord du pont (allumés la nuit, voir setNight) : petits plots le long de la piste oblique
        const lightMaterial = new MeshStandardMaterial({ color: 0x222222, emissive: 0xffe9b0, emissiveIntensity: 0.05 });
        const r = this._landing, side = new Vector3(-r.direction.z, 0, r.direction.x);
        const lights = new Group();
        const stud = new BoxGeometry(0.5, 0.15, 0.5);
        for (let along = 0; along <= RUNWAY.length; along += 12) {
            for (const s of [-1, 1]) {
                const light = new Mesh(stud, lightMaterial);
                light.position.copy(r.threshold).addScaledVector(r.direction, along).addScaledVector(side, s * RUNWAY.width / 2);
                light.position.y = DECK + 0.08;
                if (!insidePolygon(DECK_OUTLINE, light.position.x, light.position.z)) continue;
                lights.add(light);
            }
        }
        group.add(lights);
        this._deckLights = lightMaterial;
        stripe.castShadow = true;
        mergeStatic(lights);
        group.position.set(this._ox, 0, this._oz);
        group.rotation.y = this.rotation;
        group.updateMatrixWorld(true);
        this._obstaclesToWorld();
        return group;
    }

    setLightsEnabled() {}
    addParkedPlanes() {}
    addFloodlights() {}
    updateHangars() {}
    setNight(night) {
        if (this._deckLights) this._deckLights.emissiveIntensity = 0.05 + 2.5 * night;
    }

    // Navette de la catapulte n° index (1, 2) tenue sous la roulette de nez, à along m de son départ (lancement en cours)
    moveShuttle(index, along) {
        const s = this._shuttles[index - 1];
        s.along = MathUtils.clamp(along, 0, CATAPULTS[index - 1].stroke);
        s.held = true;
        s.pause = SHUTTLE_PAUSE;
        this._placeShuttle(index - 1);
    }
    // Avion lâché (envolé, ou sorti de la catapulte) : la navette s'arrête, puis revient à son départ (voir update)
    releaseShuttle(index) {
        this._shuttles[index - 1].held = false;
    }
    _placeShuttle(i) {
        const s = this._shuttles[i], c = CATAPULTS[i];
        s.group?.position.set(c.x + c.dx * s.along, 0, c.z + c.dz * s.along);
    }
    update(delta) {
        for (const [i, s] of this._shuttles.entries()) {
            if (s.held || s.along === 0) continue;
            if (s.pause > 0) s.pause -= delta;
            else {
                s.along = Math.max(0, s.along - SHUTTLE_RETURN * delta);
                this._placeShuttle(i);
            }
        }
    }
}

export { Carrier, CARRIERS };
