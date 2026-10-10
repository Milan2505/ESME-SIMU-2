import {
    AdditiveBlending,
    BoxGeometry,
    Box3,
    BufferGeometry,
    CanvasTexture,
    Color,
    CylinderGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    Points,
    PointsMaterial,
    RepeatWrapping,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3
} from 'three';
import { flareTexture } from './LightFlare.js';

// Petit aérodrome : une piste nord-sud, un taxiway, un parking, une tour, un terminal et deux hangars.
// Tout est modélisé ici (pas de modèle externe) ; le relief est aplani autour (voir reliefFactor).
const RUNWAY = { x: 220, z: 0, length: 700, width: 30 };
const TAXIWAY = { minX: 235, maxX: 300, minZ: -8, maxZ: 8 };
const APRON = { minX: 300, maxX: 365, minZ: -95, maxZ: 95 };
const FLAT_ZONE = { minX: 180, maxX: 440, minZ: -390, maxZ: 390, blend: 160 };
// Mâts d'éclairage du parking (asset/light-square-cross, Kenney, CC0) : en bordure est, derrière la queue des
// avions garés, entre le parking et les bâtiments. Le modèle mesure 0,6 m : à l'échelle 20, un mât de 12 m.
const FLOODLIGHTS = { x: APRON.maxX - 2, z: [-90, -30, 30, 90], scale: 20 };
const FLOODLIGHT_LAMPS = [[0.1875, 0], [-0.1875, 0], [0, 0.1875], [0, -0.1875]]; // bouts des 4 bras (repère du modèle)
const FLOODLIGHT_LAMP_Y = 0.57;
const WIND_DIRECTION = 0; // le vent vient du nord (la manche à air pointe vers le sud)

const _toEye = new Vector3();

function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function inside(rect, x, z, margin = 0) {
    return x >= rect.minX - margin && x <= rect.maxX + margin && z >= rect.minZ - margin && z <= rect.maxZ + margin;
}

const RUNWAY_RECT = {
    minX: RUNWAY.x - RUNWAY.width / 2, maxX: RUNWAY.x + RUNWAY.width / 2,
    minZ: RUNWAY.z - RUNWAY.length / 2, maxZ: RUNWAY.z + RUNWAY.length / 2,
};

function canvasTexture(width, height, draw, { repeat = null, anisotropy = 8 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = anisotropy;
    if (repeat) {
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.repeat.set(...repeat);
    }
    return texture;
}

// Grain d'enrobé / de béton
function speckle(ctx, width, height, base, amount, count) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < count; i++) {
        const v = Math.random() * amount * 2 - amount;
        ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
        ctx.fillRect(Math.random() * width, Math.random() * height, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
}

// Marquages OACI (piste de 30 m) : seuil "piano" de 8 bandes centrées, numéros 36 / 18,
// plots de point d'aiming, axe discontinu, bandes de bord. Distances en mètres depuis chaque extrémité.
const THRESHOLD_OFFSET = 6;      // début des bandes de seuil
const AIMING_POINT = 150;        // point visé à l'atterrissage (PAPI et pente ILS calés dessus)

function runwayTexture(maxAnisotropy) {
    const { width: w, length: l } = RUNWAY;
    return canvasTexture(256, 4096, (ctx, cw, ch) => {
        speckle(ctx, cw, ch, '#3b3c3e', 0.12, 60000);
        ctx.setTransform(cw / w, 0, 0, ch / l, 0, 0); // dessin en mètres (haut du canvas = nord)
        ctx.fillStyle = '#e8e8e8';
        // Bandes de bord (0,9 m)
        ctx.fillRect(0.5, 0, 0.9, l);
        ctx.fillRect(w - 1.4, 0, 0.9, l);

        // Marquages d'une extrémité, en coordonnées "depuis le bout de piste" (y = 0 au bout, y croissant vers le centre)
        const markings = (number) => {
            // Seuil : 4 bandes de 1,5 m de chaque côté de l'axe, espacées de 1,5 m, longues de 30 m
            for (let i = 0; i < 4; i++) {
                ctx.fillRect(w / 2 - 3 - i * 3, THRESHOLD_OFFSET, 1.5, 30);
                ctx.fillRect(w / 2 + 1.5 + i * 3, THRESHOLD_OFFSET, 1.5, 30);
            }
            // Numéro de piste (9 m de haut), lisible par l'avion qui arrive vers ce seuil
            ctx.save();
            ctx.translate(w / 2, THRESHOLD_OFFSET + 30 + 12 + 4.5);
            ctx.rotate(Math.PI);
            ctx.font = 'bold 9px DejaVu Sans Mono, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(number, 0, 0);
            ctx.restore();
            // Plots de point d'aiming : 2 rectangles de 4 × 45 m
            ctx.fillRect(w / 2 - 6 - 4, AIMING_POINT - 10, 4, 45);
            ctx.fillRect(w / 2 + 6, AIMING_POINT - 10, 4, 45);
        };
        markings('18'); // extrémité nord : piste 18 (on y atterrit cap au sud)
        ctx.save();
        ctx.translate(w, l);
        ctx.rotate(Math.PI); // extrémité sud : mêmes marquages, retournés
        markings('36');      // piste 36 (on y atterrit cap au nord)
        ctx.restore();

        // Axe : traits de 30 m, espaces de 20 m, entre les deux numéros
        for (let z = 75; z < l - 100; z += 50) ctx.fillRect(w / 2 - 0.45, z, 0.9, 30);
    }, { anisotropy: maxAnisotropy });
}

function sockTexture() {
    return canvasTexture(64, 64, (ctx, w, h) => {
        for (let i = 0; i < 5; i++) {
            ctx.fillStyle = i % 2 ? '#f4f4f4' : '#ff5a12';
            ctx.fillRect(0, (i * h) / 5, w, h / 5);
        }
    });
}

class Airport {
    constructor() {
        this.group = new Group();
        this.obstacles = [];         // boîtes à ne pas percuter (bâtiments, avions garés…)
        this.start = { x: RUNWAY.x, z: RUNWAY.z + RUNWAY.length / 2 - 15 }; // seuil sud, cap au nord
        // Les deux sens d'atterrissage : seuil (bout de piste), direction d'atterrissage, point visé
        this.runways = [
            { name: '36', heading: 0, threshold: new Vector3(RUNWAY.x, 0, RUNWAY.z + RUNWAY.length / 2), direction: new Vector3(0, 0, -1) },
            { name: '18', heading: 180, threshold: new Vector3(RUNWAY.x, 0, RUNWAY.z - RUNWAY.length / 2), direction: new Vector3(0, 0, 1) },
        ];
        for (const runway of this.runways) {
            runway.aimPoint = runway.threshold.clone().addScaledVector(runway.direction, AIMING_POINT);
            runway.left = new Vector3(runway.direction.z, 0, -runway.direction.x); // à gauche de l'avion qui atterrit
        }
        this.runwayLength = RUNWAY.length;
        // Contours pour la carte (MapView.js)
        this.mapShapes = [{ ...TAXIWAY, kind: 'asphalt' }, { ...APRON, kind: 'asphalt' }, { ...RUNWAY_RECT, kind: 'runway' }];
        this._papi = [];
        this._night = 0;
        this._time = 0;
    }

    // 0 au milieu de l'aérodrome (sol plat), 1 loin autour (relief normal)
    reliefFactor(x, z) {
        const dx = Math.max(FLAT_ZONE.minX - x, 0, x - FLAT_ZONE.maxX);
        const dz = Math.max(FLAT_ZONE.minZ - z, 0, z - FLAT_ZONE.maxZ);
        return smoothstep(0, FLAT_ZONE.blend, Math.hypot(dx, dz));
    }

    // Zone où l'on ne place pas d'arbres ni de rochers
    contains(x, z, margin = 0) {
        return inside(FLAT_ZONE, x, z, margin);
    }

    surfaceAt(x, z) {
        return inside(RUNWAY_RECT, x, z) || inside(TAXIWAY, x, z) || inside(APRON, x, z) ? 'asphalt' : 'grass';
    }

    build(renderer) {
        const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
        this._buildGround(maxAnisotropy);
        this._buildBuildings();
        this._buildWindsock();
        this._buildLights();
        this._buildPapi();
        this.group.traverse((child) => {
            if (child.isMesh) {
                child.receiveShadow = true;
                child.castShadow = !child.userData.flat;
            }
        });
        return this.group;
    }

    // Avions garés sur le parking : copies du Cessna du joueur, repeintes
    addParkedPlanes(model) {
        const spots = [
            { x: 338, z: -80, color: 0xc0392b },
            { x: 338, z: -60, color: 0x2e86c1 },
            { x: 338, z: -40, color: 0xf1c40f },
        ];
        for (const spot of spots) {
            const plane = model.clone();
            plane.visible = true;
            plane.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = true;
                if (child.material.name === 'Red') {
                    child.material = child.material.clone();
                    child.material.color.set(spot.color);
                }
            });
            const holder = new Group();
            holder.position.set(spot.x, 1.24, spot.z); // roues posées sur le parking
            holder.rotation.y = Math.PI / 2;           // nez vers la piste (ouest)
            holder.add(plane);
            this.group.add(holder);
            holder.updateMatrixWorld(true);
            this.obstacles.push(new Box3().setFromObject(holder).expandByScalar(-1));
        }
    }

    // Mâts d'éclairage du parking. La nuit : halo sur chaque projecteur et flaque de lumière au sol
    // (simulées : de vraies lumières seraient calculées pour chaque pixel de la scène, très coûteux)
    addFloodlights(model) {
        model.traverse((child) => { if (child.isMesh) child.castShadow = true; });
        const lamps = [];
        for (const z of FLOODLIGHTS.z) {
            const mast = model.clone();
            mast.position.set(FLOODLIGHTS.x, 0, z);
            mast.scale.setScalar(FLOODLIGHTS.scale);
            this.group.add(mast);
            // Obstacle : le mât seul (les bras sont trop haut pour un avion qui roule)
            this.obstacles.push(new Box3(new Vector3(FLOODLIGHTS.x - 0.5, 0, z - 0.5), new Vector3(FLOODLIGHTS.x + 0.5, 12, z + 0.5)));
            for (const [dx, dz] of FLOODLIGHT_LAMPS) {
                lamps.push(FLOODLIGHTS.x + dx * FLOODLIGHTS.scale, FLOODLIGHT_LAMP_Y * FLOODLIGHTS.scale, z + dz * FLOODLIGHTS.scale);
            }
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(lamps, 3));
        this._floodlightMaterial = new PointsMaterial({
            size: 5, map: flareTexture(), color: 0xffd9a0, transparent: true,
            depthWrite: false, blending: AdditiveBlending,
        });
        this._floodlightHalos = new Points(geometry, this._floodlightMaterial);
        this.group.add(this._floodlightHalos);

        // Flaque de lumière : disque dégradé posé sur le béton, un par mât
        const pool = canvasTexture(128, 128, (ctx, w, h) => {
            const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
            g.addColorStop(0, 'rgba(255,220,170,1)');
            g.addColorStop(0.5, 'rgba(255,210,150,0.45)');
            g.addColorStop(1, 'rgba(255,200,140,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        });
        // Décalage de profondeur plus fort que celui des surfaces (béton, asphalte : -2, voir _buildGround),
        // sinon la flaque reste cachée sous le parking et n'éclaire que l'herbe autour
        this._poolMaterial = new MeshBasicMaterial({
            map: pool, transparent: true, depthWrite: false, blending: AdditiveBlending,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        });
        for (const z of FLOODLIGHTS.z) {
            this._flat(new PlaneGeometry(34, 34), this._poolMaterial, FLOODLIGHTS.x - 6, 0.04, z);
        }
        this.setNight(this._night);
    }

    // night : 0 = jour, 1 = nuit (feux et fenêtres allumés)
    setNight(night) {
        this._night = night;
        this.lightsMaterial.size = 1.6 + 1.6 * night;
        this.lightsMaterial.color.setScalar(0.6 + 2.4 * night);
        for (const material of this._glowingMaterials) material.emissiveIntensity = 0.05 + 1.6 * night;
        if (this._floodlightMaterial) {
            // Allumés seulement quand il fait sombre (nuit, et un peu par temps d'orage)
            this._floodlightHalos.visible = night > 0.2;
            this._floodlightMaterial.color.set(0xffd9a0).multiplyScalar(1 + 2 * night);
            this._poolMaterial.visible = night > 0.2;
            this._poolMaterial.opacity = 0.4 * night;
        }
    }

    update(delta, windStrength, camera) {
        this._updatePapi(camera);
        this._time += delta;
        const t = this._time;
        // Manche à air : se gonfle avec le vent, flotte en rafales
        const droop = MathUtils.lerp(1.2, 0.08, windStrength) + Math.sin(t * 7) * 0.05 * (1 + windStrength);
        this._sock.rotation.x = droop; // > 0 : la manche pend vers le sol
        this._sock.rotation.z = Math.sin(t * 2.3) * 0.12 * (0.3 + windStrength);
        // Feu d'obstacle rouge clignotant en haut de la tour
        this._beacon.visible = Math.sin(t * Math.PI) > 0;
    }

    // PAPI : 4 feux à gauche de la piste, au niveau du point visé. Chaque feu est blanc si l'on est
    // au-dessus de son angle, rouge en dessous : sur la bonne pente (3°), 2 blancs + 2 rouges.
    _buildPapi() {
        const housing = new MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });
        const angles = [3.5, 3.17, 2.83, 2.5]; // du feu le plus proche de la piste au plus éloigné
        for (const runway of this.runways) {
            angles.forEach((angle, i) => {
                const position = runway.aimPoint.clone().addScaledVector(runway.left, RUNWAY.width / 2 + 15 + i * 9);
                const box = new Mesh(new BoxGeometry(1.4, 0.7, 1.4), housing);
                box.position.copy(position).setY(0.35);
                const light = new Sprite(new SpriteMaterial({
                    map: flareTexture(), blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false,
                }));
                light.position.copy(position).setY(0.5).addScaledVector(runway.direction, -0.8);
                this.group.add(box, light);
                this._papi.push({ light, runway, angle: MathUtils.degToRad(angle) });
            });
        }
    }

    _updatePapi(camera) {
        if (!camera) return;
        for (const papi of this._papi) {
            const toEye = _toEye.subVectors(camera.position, papi.light.position);
            const before = -toEye.dot(papi.runway.direction);   // distance en amont du feu, dans l'axe d'approche
            // Optique directionnelle : visible seulement depuis l'approche
            const visible = before > 0 && Math.abs(toEye.dot(papi.runway.left)) < before * 0.6;
            papi.light.visible = visible;
            if (!visible) continue;
            const elevation = Math.atan2(toEye.y, Math.hypot(toEye.x, toEye.z));
            papi.light.material.color.set(elevation > papi.angle ? 0xffffff : 0xff2010).multiplyScalar(2 + 4 * this._night);
            // Taille quasi constante à l'écran : reste visible de loin
            papi.light.scale.setScalar(Math.max(2.5, toEye.length() * 0.012));
        }
    }

    _flat(geometry, material, x, y, z, rotationY = 0) {
        geometry.rotateX(-Math.PI / 2);
        const mesh = new Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.rotation.y = rotationY;
        mesh.userData.flat = true;
        this.group.add(mesh);
        return mesh;
    }

    _buildGround(maxAnisotropy) {
        // Décalage de profondeur : évite le scintillement avec le terrain juste dessous
        const surface = (map, color = 0xffffff) => new MeshStandardMaterial({
            map, color, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });

        this._flat(new PlaneGeometry(RUNWAY.width, RUNWAY.length), surface(runwayTexture(maxAnisotropy)),
            RUNWAY.x, 0.02, RUNWAY.z);

        const asphalt = canvasTexture(256, 256, (ctx, w, h) => speckle(ctx, w, h, '#45464a', 0.12, 8000),
            { repeat: [(TAXIWAY.maxX - TAXIWAY.minX) / 10, (TAXIWAY.maxZ - TAXIWAY.minZ) / 10] });
        this._flat(new PlaneGeometry(TAXIWAY.maxX - TAXIWAY.minX, TAXIWAY.maxZ - TAXIWAY.minZ), surface(asphalt),
            (TAXIWAY.minX + TAXIWAY.maxX) / 2, 0.015, (TAXIWAY.minZ + TAXIWAY.maxZ) / 2);
        // Ligne jaune du taxiway
        this._flat(new PlaneGeometry(TAXIWAY.maxX - TAXIWAY.minX, 0.4), surface(null, 0xf2c200),
            (TAXIWAY.minX + TAXIWAY.maxX) / 2, 0.03, 0);

        // Parking en dalles de béton
        const concrete = canvasTexture(256, 256, (ctx, w, h) => {
            speckle(ctx, w, h, '#8b8a86', 0.08, 8000);
            ctx.strokeStyle = 'rgba(40,40,40,0.5)';
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, w, h);
            ctx.beginPath();
            ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
            ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
            ctx.stroke();
        }, { repeat: [(APRON.maxX - APRON.minX) / 10, (APRON.maxZ - APRON.minZ) / 10] });
        this._flat(new PlaneGeometry(APRON.maxX - APRON.minX, APRON.maxZ - APRON.minZ), surface(concrete),
            (APRON.minX + APRON.maxX) / 2, 0.015, (APRON.minZ + APRON.maxZ) / 2);
        // Marques de stationnement jaunes
        // Places de stationnement (axe de chaque avion) : 3 Cessna, puis carpeXL et DRAVION (data/objet.csv)
        for (const z of [-80, -60, -40, 15, 45]) {
            this._flat(new PlaneGeometry(26, 0.3), surface(null, 0xf2c200), 340, 0.03, z);
        }
    }

    _buildBuildings() {
        const wall = new MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.9 });
        const darkWall = new MeshStandardMaterial({ color: 0x5d6d7e, roughness: 0.8 });
        const roof = new MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8 });

        // Fenêtres du terminal : allumées la nuit
        const windowsMap = canvasTexture(256, 64, (ctx, w, h) => {
            ctx.fillStyle = '#e9e4d8';
            ctx.fillRect(0, 0, w, h);
            for (let x = 8; x < w; x += 32) {
                ctx.fillStyle = '#26323d';
                ctx.fillRect(x, 20, 22, 26);
            }
        });
        const emissiveMap = canvasTexture(256, 64, (ctx, w, h) => {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
            for (let x = 8; x < w; x += 32) {
                ctx.fillStyle = Math.random() < 0.75 ? '#ffd28a' : '#000';
                ctx.fillRect(x, 20, 22, 26);
            }
        });
        const terminalMaterial = new MeshStandardMaterial({
            map: windowsMap, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8,
        });
        const glass = new MeshStandardMaterial({
            color: 0x1d3b4a, metalness: 0.6, roughness: 0.15, emissive: 0xffe2a8, emissiveIntensity: 0,
        });
        this._glowingMaterials = [terminalMaterial, glass];

        // Terminal (fenêtres sur les façades longues)
        const terminal = new Mesh(new BoxGeometry(16, 6, 40),
            [terminalMaterial, terminalMaterial, roof, roof, wall, wall]); // faces +x, -x, +y, -y, +z, -z
        terminal.position.set(392, 3, -40);
        this.group.add(terminal);
        this._addObstacle(terminal);
        const terminalRoof = new Mesh(new BoxGeometry(17, 0.6, 41), roof);
        terminalRoof.position.set(392, 6.3, -40);
        this.group.add(terminalRoof);

        // Tour de contrôle : fût, vigie vitrée octogonale, toit et antenne
        const shaft = new Mesh(new BoxGeometry(5, 18, 5), wall);
        shaft.position.set(392, 9, -75);
        this.group.add(shaft);
        this._addObstacle(shaft);
        const cabBase = new Mesh(new CylinderGeometry(4.6, 3.6, 1.5, 8), darkWall);
        cabBase.position.set(392, 18.75, -75);
        const cab = new Mesh(new CylinderGeometry(4.8, 4.4, 3.5, 8), glass);
        cab.position.set(392, 21.25, -75);
        const cabRoof = new Mesh(new CylinderGeometry(5.4, 5.4, 0.6, 8), roof);
        cabRoof.position.set(392, 23.3, -75);
        const antenna = new Mesh(new CylinderGeometry(0.08, 0.12, 5, 6), darkWall);
        antenna.position.set(392, 26.1, -75);
        this.group.add(cabBase, cab, cabRoof, antenna);
        this._addObstacle(cab);
        this._beacon = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial({
            color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 4,
        }));
        this._beacon.position.set(392, 28.7, -75);
        this.group.add(this._beacon);

        // Hangars : toit en demi-cylindre en tôle ondulée, ouverture vers le parking
        const corrugated = canvasTexture(128, 16, (ctx, w, h) => {
            for (let x = 0; x < w; x++) {
                const v = 150 + 40 * Math.sin((x / w) * Math.PI * 16);
                ctx.fillStyle = `rgb(${v},${v + 4},${v + 8})`;
                ctx.fillRect(x, 0, 1, h);
            }
        }, { repeat: [1, 6] });
        const sheet = new MeshStandardMaterial({ map: corrugated, metalness: 0.4, roughness: 0.55, side: DoubleSide });
        const door = new MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.7, side: DoubleSide });

        for (const z of [15, 62]) {
            const hangar = new Group();
            hangar.position.set(395, 0, z);
            const arch = new Mesh(new CylinderGeometry(14, 14, 30, 24, 1, true, -Math.PI / 2, Math.PI), sheet);
            arch.rotation.z = Math.PI / 2;
            const back = new Mesh(new CylinderGeometry(14, 14, 0.3, 24, 1, false, -Math.PI / 2, Math.PI), sheet);
            back.rotation.z = Math.PI / 2;
            back.position.x = 15;
            // Porte : demi-disque sombre côté parking
            const front = new Mesh(new CylinderGeometry(13.8, 13.8, 0.2, 24, 1, false, -Math.PI / 2, Math.PI), door);
            front.rotation.z = Math.PI / 2;
            front.position.x = -14.8;
            hangar.add(arch, back, front);
            this.group.add(hangar);
            hangar.updateMatrixWorld(true);
            this.obstacles.push(new Box3().setFromObject(hangar).expandByScalar(-2));
        }
    }

    _addObstacle(mesh) {
        mesh.updateMatrixWorld(true);
        this.obstacles.push(new Box3().setFromObject(mesh));
    }

    _buildWindsock() {
        const pole = new Mesh(new CylinderGeometry(0.08, 0.12, 6, 8), new MeshStandardMaterial({ color: 0xdddddd }));
        pole.position.set(255, 3, -300);
        this.group.add(pole);

        // Pivot en haut du mât, la manche pend vers le bas sans vent et s'oriente sous le vent
        const pivot = new Group();
        pivot.position.set(255, 5.9, -300);
        pivot.rotation.y = WIND_DIRECTION;
        this._sock = new Group();
        // Tronc de cône ouvert : large à l'entrée (mât), étroit au bout, axe vers +z (le sud)
        const cone = new CylinderGeometry(0.18, 0.45, 3.5, 12, 1, true);
        cone.translate(0, 1.75, 0);
        cone.rotateX(Math.PI / 2);
        const sock = new Mesh(cone, new MeshStandardMaterial({ map: sockTexture(), side: DoubleSide, roughness: 0.9 }));
        this._sock.add(sock);
        pivot.add(this._sock);
        this.group.add(pivot);
    }

    _buildLights() {
        const positions = [], colors = [];
        const add = (x, z, color) => {
            positions.push(x, 0.5, z);
            colors.push(color.r, color.g, color.b);
        };
        const white = new Color(1, 0.95, 0.8), green = new Color(0.1, 1, 0.2), red = new Color(1, 0.08, 0.05);
        const blue = new Color(0.15, 0.3, 1);
        const half = RUNWAY.length / 2, side = RUNWAY.width / 2 + 1.5;

        // Feux de bord de piste tous les 50 m, feux de seuil verts et d'extrémité rouges
        for (let z = -half; z <= half; z += 50) {
            add(RUNWAY.x - side, RUNWAY.z + z, white);
            add(RUNWAY.x + side, RUNWAY.z + z, white);
        }
        for (let x = -RUNWAY.width / 2; x <= RUNWAY.width / 2; x += 3) {
            add(RUNWAY.x + x, RUNWAY.z + half + 2, green);
            add(RUNWAY.x + x, RUNWAY.z - half - 2, red);
        }
        // Taxiway : feux bleus
        for (let x = TAXIWAY.minX + 5; x <= TAXIWAY.maxX; x += 10) {
            add(x, TAXIWAY.minZ - 1, blue);
            add(x, TAXIWAY.maxZ + 1, blue);
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
        this.lightsMaterial = new PointsMaterial({
            size: 1.5, map: flareTexture(), vertexColors: true, transparent: true,
            depthWrite: false, blending: AdditiveBlending,
        });
        this.group.add(new Points(geometry, this.lightsMaterial));
    }
}

export { Airport };
