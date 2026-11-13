import {
    Box3,
    BoxGeometry,
    CanvasTexture,
    CylinderGeometry,
    ExtrudeGeometry,
    Group,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    Shape,
    ShapeGeometry,
    SRGBColorSpace,
    Vector3
} from 'three';
import { Airport } from './Airport.js';
import { mergeStatic } from './MergeStatic.js';

// Porte-avions (carte « Mer ») : il prend la place d'un aérodrome (départs, hangar, tour, ILS, Wardog) mais tout se
// passe sur son pont, DECK m au-dessus de l'eau. Repère du navire : origine au milieu du pont, étrave vers -z (nord
// quand rotation = 0), tribord vers +x. Navire immobile (au mouillage).
//
// - Piste oblique (appontage) : part de l'arrière, à 9° vers bâbord ; quatre brins d'arrêt (WIRES, m après le seuil)
// - Deux catapultes à l'avant (CATAPULTS), pour décoller en ~2 s (voir « Porte-avions » dans simulator.js)
// - Îlot à tribord (obstacle), coque sous le pont (la percuter : crash, voir simulator.js)

const DECK = 19;                     // hauteur du pont au-dessus de l'eau (m)
const ANGLE = MathUtils.degToRad(9); // piste oblique : 9° à bâbord de l'axe du navire
// Contour du pont (repère du navire, sens horaire vu de dessus) : étrave fine, aileron bâbord de la piste oblique
const DECK_OUTLINE = [
    [-11, -166], [11, -166], [20, -140], [25, -100], [37, -40], [38, 120], [32, 160], [16, 168],
    [-16, 168], [-24, 150], [-40, 110], [-46, 30], [-44, -20], [-40, -60], [-22, -110], [-16, -145],
];
// Coque à la ligne de flottaison : plus étroite que le pont (le pont la déborde, surtout à bâbord)
const HULL_OUTLINE = [
    [-4, -170], [4, -170], [14, -130], [19, -60], [20, 100], [17, 150], [10, 164],
    [-10, 164], [-17, 150], [-20, 100], [-19, -60], [-14, -130],
];
const RUNWAY = { x: 2, z: 150, length: 190, width: 24 };   // seuil (repère du navire), longueur, largeur
const WIRES = [42, 54, 66, 78];                             // brins d'arrêt : distance au seuil (m)
const CATAPULTS = [
    { x: 7, z: -50, stroke: 110 },     // tribord
    { x: -9, z: -64, stroke: 96 },     // bâbord
];
const ISLAND = { minX: 27, maxX: 36, minZ: 6, maxZ: 46, height: 22 };
const PARK = { x: 22, z: 100 };      // avion présenté au « hangar » (pont arrière, à tribord), nez vers bâbord

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
        const landingDir = new Vector3(-Math.sin(ANGLE), 0, -Math.cos(ANGLE));
        const cat = CATAPULTS[0];
        const local = [
            { threshold: new Vector3(RUNWAY.x, DECK, RUNWAY.z), direction: landingDir, length: RUNWAY.length, aim: WIRES[2] },
            { threshold: new Vector3(cat.x, DECK, cat.z), direction: new Vector3(0, 0, -1), length: cat.stroke, aim: 30 },
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
        // Catapultes (repère monde) : départ, direction, course
        this.catapults = CATAPULTS.map((c, i) => ({
            index: i + 1, start: vector(c.x, DECK, c.z), direction: this.directionToWorld(new Vector3(0, 0, -1)),
            stroke: c.stroke, heading: rotation,
        }));
        this.start = world(cat.x, cat.z);
        const spawnAt = (id, name, detail, x, z, heading, extra = {}) => {
            const p = world(x, z);
            return { id: `${config.id}-${id}`, name, detail, x: p.x, z: p.z, heading: heading + rotation, airport: this, ...extra };
        };
        this.spawns = [
            spawnAt('cat1', 'Catapulte 1', 'Tribord avant · gaz à fond pour être lancé', CATAPULTS[0].x, CATAPULTS[0].z, 0, { cold: false }),
            spawnAt('cat2', 'Catapulte 2', 'Bâbord avant · gaz à fond pour être lancé', CATAPULTS[1].x, CATAPULTS[1].z, 0, { cold: false }),
            spawnAt('pont', 'Pont arrière', 'Avion éteint, derrière l\'îlot : à mettre en route', PARK.x, PARK.z, Math.PI / 2, { cold: true, stand: 'P1' }),
        ];
        this.aerodrome = { ...config.aerodrome, speech: config.speech, holdingX: 0,
            stands: [{ name: 'P1', ...world(PARK.x, PARK.z), free: true }] };
        this.vor = { ...config.vor, ...world(30, 20), y: DECK + 30 };   // (sur le mât de l'îlot)
        this.ndb = vector(0, DECK, 0);
        this.hangars = [{ ...world(PARK.x, PARK.z), name: config.hangars[0],
            spot: { ...world(PARK.x, PARK.z), heading: Math.PI / 2 + rotation } }];
        // Carte (MapView) : le pont, en trois rectangles
        this.mapShapes = [
            { minX: -16, maxX: 24, minZ: -166, maxZ: 168 }, { minX: -44, maxX: -16, minZ: -60, maxZ: 140 },
            { minX: 24, maxX: 38, minZ: -40, maxZ: 160 },
        ].map((r) => ({ ...this.rectToWorld(r), kind: 'asphalt' }));
        this.center = vector(0, 0, 0);
        this.lakes = [];
        // Vues du choix du départ (mêmes noms que celles d'un aérodrome, voir SPAWN_VIEWS dans simulator.js)
        this.spawnViews = {
            ensemble: { label: 'Vue d\'ensemble', target: [0, DECK, 0], yaw: 0.6, pitch: 0.75, distance: 520 },
            rwy36: { label: 'Catapultes', target: [0, DECK, -80], yaw: 0.5, pitch: 0.38, distance: 140 },
            rwy18: { label: 'Piste oblique', target: [-12, DECK, 90], yaw: Math.PI - 0.6, pitch: 0.4, distance: 170 },
            parking: { label: 'Pont arrière', target: [20, DECK, 90], yaw: -Math.PI / 2 - 0.5, pitch: 0.5, distance: 110 },
        };
        // Survol du menu principal : autour du navire
        this.menuView = { radius: 360, height: 110, target: [0, DECK, 0] };
        this._deckLights = null;
    }

    // Pont en (x, z) : sa hauteur, sinon null
    platformAt(x, z) {
        const p = this.toLocal(x, z);
        if (Math.abs(p.x) > 48 || Math.abs(p.z) > 170) return null;
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
        const grey = new MeshStandardMaterial({ color: 0x6d747b, roughness: 0.75, metalness: 0.1 });
        const darkGrey = new MeshStandardMaterial({ color: 0x3c4146, roughness: 0.8 });
        const boot = new MeshStandardMaterial({ color: 0x5a2422, roughness: 0.8 });   // peinture antisalissure sous la flottaison
        const teamPaint = new MeshStandardMaterial({ color: team, roughness: 0.6 });

        // Coque : de 8 m sous l'eau au pont ; la partie immergée en rouge sombre
        const shapeOf = (outline) => new Shape(outline.map(([x, z]) => ({ x, y: -z })));
        const extrude = (outline, bottom, top, material) => {
            const geometry = new ExtrudeGeometry(shapeOf(outline), { depth: top - bottom, bevelEnabled: false });
            geometry.rotateX(-Math.PI / 2);
            geometry.translate(0, bottom, 0);
            return new Mesh(geometry, material);
        };
        group.add(extrude(HULL_OUTLINE, -8, 0.4, boot));
        group.add(extrude(HULL_OUTLINE, 0.4, DECK - 2.5, grey));
        // Débord du pont (galeries) : dalle épaisse sous le pont, sur tout son contour
        group.add(extrude(DECK_OUTLINE, DECK - 2.5, DECK - 0.05, darkGrey));

        // Pont : marquages dessinés (piste oblique, brins, catapultes, numéro)
        const deckGeometry = new ShapeGeometry(shapeOf(DECK_OUTLINE));
        deckGeometry.rotateX(-Math.PI / 2);
        const minX = -48, maxX = 40, minZ = -168, maxZ = 170;
        const uv = deckGeometry.attributes.uv, pos = deckGeometry.attributes.position;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - minX) / (maxX - minX), 1 - (pos.getZ(i) - minZ) / (maxZ - minZ));
        const deck = new Mesh(deckGeometry, new MeshStandardMaterial({ map: this._deckTexture(minX, maxX, minZ, maxZ), roughness: 0.85 }));
        deck.position.y = DECK;
        deck.userData.flat = true;
        group.add(deck);

        // Îlot : superstructure, passerelle vitrée, mât et radars ; bande à la couleur de l'équipe
        const island = new Mesh(new BoxGeometry(ISLAND.maxX - ISLAND.minX, ISLAND.height, ISLAND.maxZ - ISLAND.minZ), grey);
        island.position.set((ISLAND.minX + ISLAND.maxX) / 2, DECK + ISLAND.height / 2, (ISLAND.minZ + ISLAND.maxZ) / 2);
        group.add(island);
        const bridge = new Mesh(new BoxGeometry(ISLAND.maxX - ISLAND.minX + 1, 3, 14), new MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.2, metalness: 0.4 }));
        bridge.position.set(island.position.x, DECK + ISLAND.height - 4, ISLAND.minZ + 8);
        group.add(bridge);
        const stripe = new Mesh(new BoxGeometry(ISLAND.maxX - ISLAND.minX + 0.4, 1.6, ISLAND.maxZ - ISLAND.minZ + 0.4), teamPaint);
        stripe.position.set(island.position.x, DECK + ISLAND.height - 8, island.position.z);
        group.add(stripe);
        const mast = new Mesh(new CylinderGeometry(0.6, 1, 14, 8), darkGrey);
        mast.position.set(island.position.x, DECK + ISLAND.height + 7, ISLAND.minZ + 16);
        group.add(mast);
        const radar = new Mesh(new BoxGeometry(6, 1.6, 0.6), darkGrey);
        radar.position.set(island.position.x, DECK + ISLAND.height + 12, ISLAND.minZ + 16);
        group.add(radar);
        const dome = new Mesh(new CylinderGeometry(1.6, 1.6, 2.4, 12), new MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.6 }));
        dome.position.set(island.position.x, DECK + ISLAND.height + 1.2, ISLAND.maxZ - 8);
        group.add(dome);
        this.obstacles.push(new Box3(new Vector3(ISLAND.minX, DECK, ISLAND.minZ), new Vector3(ISLAND.maxX, DECK + ISLAND.height + 14, ISLAND.maxZ)));

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
                lights.add(light);
            }
        }
        group.add(lights);
        this._deckLights = lightMaterial;

        group.traverse((child) => {
            if (child.isMesh) {
                child.receiveShadow = true;
                child.castShadow = !child.userData.flat;
            }
        });
        mergeStatic(group);
        group.position.set(this._ox, 0, this._oz);
        group.rotation.y = this.rotation;
        group.updateMatrixWorld(true);
        this._obstaclesToWorld();
        return group;
    }

    // Marquages du pont, dessinés une fois : antidérapant gris foncé, piste oblique (bords blancs, axe pointillé jaune),
    // brins d'arrêt, rails des catapultes, numéro du navire à l'avant et à l'arrière
    _deckTexture(minX, maxX, minZ, maxZ) {
        const W = 512, H = 2048, sx = W / (maxX - minX), sz = H / (maxZ - minZ);
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        const px = (x) => (x - minX) * sx, pz = (z) => (z - minZ) * sz;
        ctx.fillStyle = '#41464b';
        ctx.fillRect(0, 0, W, H);
        // Grain du revêtement
        for (let i = 0; i < 9000; i++) {
            ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.05)`;
            ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
        }
        const line = (x1, z1, x2, z2, color, width, dash = []) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width * sx;
            ctx.setLineDash(dash.map((d) => d * sz));
            ctx.beginPath();
            ctx.moveTo(px(x1), pz(z1));
            ctx.lineTo(px(x2), pz(z2));
            ctx.stroke();
        };
        const r = this._landing, d = r.direction, side = { x: -d.z, z: d.x };
        const at = (along, lateral) => [r.threshold.x + d.x * along + side.x * lateral, r.threshold.z + d.z * along + side.z * lateral];
        // Piste oblique : bords blancs, axe pointillé, seuil
        for (const s of [-1, 1]) line(...at(0, s * RUNWAY.width / 2), ...at(RUNWAY.length, s * RUNWAY.width / 2), '#e8e8e2', 0.6);
        line(...at(0, 0), ...at(RUNWAY.length, 0), '#e6c229', 0.5, [6, 6]);
        line(...at(0, -RUNWAY.width / 2), ...at(0, RUNWAY.width / 2), '#e8e8e2', 1);
        // Brins d'arrêt (câbles en travers de la piste)
        for (const w of WIRES) line(...at(w, -RUNWAY.width / 2 + 1), ...at(w, RUNWAY.width / 2 - 1), '#14171a', 0.35);
        // Catapultes : rails et zone de lancement
        for (const c of CATAPULTS) {
            line(c.x, c.z, c.x, c.z - c.stroke, '#23272b', 0.5);
            line(c.x - 3, c.z + 2, c.x + 3, c.z + 2, '#d03a2e', 0.5);
            line(c.x, c.z + 6, c.x, c.z - c.stroke, '#e8e8e2', 0.18, [2, 4]);
        }
        // Ligne de sécurité (foul line) de la piste oblique, en rouge et blanc
        line(...at(-10, -RUNWAY.width / 2 - 4), ...at(RUNWAY.length, -RUNWAY.width / 2 - 4), '#c8302a', 0.3, [3, 3]);
        // Numéro du navire, à l'avant et sur l'arrière de la piste
        ctx.fillStyle = '#e8e8e2';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(22 * sz)}px sans-serif`;
        ctx.setLineDash([]);
        ctx.save();
        ctx.translate(px(0), pz(-128));
        ctx.fillText(this.config.number, 0, 0);
        ctx.restore();
        ctx.save();
        ctx.translate(px(at(18, 0)[0]), pz(at(18, 0)[1]));
        ctx.rotate(Math.PI - ANGLE);
        ctx.fillText(this.config.number, 0, 0);
        ctx.restore();
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;
        return texture;
    }

    setLightsEnabled() {}
    addParkedPlanes() {}
    addFloodlights() {}
    updateHangars() {}
    setNight(night) {
        if (this._deckLights) this._deckLights.emissiveIntensity = 0.05 + 2.5 * night;
    }
    update() {}
}

export { Carrier, CARRIERS };
