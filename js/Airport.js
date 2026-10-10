import {
    AdditiveBlending,
    BackSide,
    BoxGeometry,
    Box3,
    BufferGeometry,
    CanvasTexture,
    Color,
    CylinderGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    InstancedMesh,
    MathUtils,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    Points,
    PointsMaterial,
    RepeatWrapping,
    Shape,
    ShapeGeometry,
    Sprite,
    SpriteMaterial,
    SphereGeometry,
    SRGBColorSpace,
    TextureLoader,
    Vector2,
    Vector3
} from 'three';
import { flareTexture } from './LightFlare.js';

// Petit aérodrome : une piste nord-sud, un taxiway, un parking, une tour, un terminal et deux hangars.
// Tout est modélisé ici (pas de modèle externe) ; le relief est aplani autour (voir reliefFactor).
const RUNWAY = { x: 220, z: 0, length: 700, width: 30 };
const TAXIWAY = { minX: 235, maxX: 300, minZ: -8, maxZ: 8 };
const APRON = { minX: 300, maxX: 365, minZ: -95, maxZ: 95 };
const FLAT_ZONE = { minX: 180, maxX: 440, minZ: -390, maxZ: 390, blend: 160 };
// Enrobé entre le parking et les portes des hangars (hangars à x 380-410, z 1-29 et 48-76)
const HANGAR_APRON = { minX: 365, maxX: 381, minZ: -2, maxZ: 79 };
// Raquettes de retournement (casquettes) aux deux bouts de piste, côté est : élargissement de 17 m sur 60 m,
// biseauté côté piste, pour faire demi-tour avant de décoller (piste sans bretelle aux extrémités)
const TURN_PAD = { width: 17, length: 60, taper: 20 };
const TURN_PADS = [1, -1].map((end) => {
    const tip = RUNWAY.z + end * RUNWAY.length / 2;
    const x0 = RUNWAY.x + RUNWAY.width / 2;
    return { end, minX: x0, maxX: x0 + TURN_PAD.width, minZ: Math.min(tip, tip - end * TURN_PAD.length), maxZ: Math.max(tip, tip - end * TURN_PAD.length) };
});
// Places de stationnement : axe de chaque avion garé (3 Cessna, carpeXL, DRAVION : data/objet.csv), x du nez
const STANDS = [-80, -60, -40, 15, 45];
const TAXILANE_X = 310;      // voie de circulation du parking (axe nord-sud)
// Balise VOR de l'aérodrome (VOR conventionnel : abri, plan réflecteur circulaire, antenne centrale), au nord-est
const VOR_STATION = { x: 330, z: -215, ident: 'ESM', frequency: '113.50' };
const DOOR_TRIGGER = 70;     // les portes d'un hangar s'ouvrent quand l'avion approche à moins de 70 m (s)
const DOOR_TIME = 6;         // durée d'ouverture / fermeture (s)
const LOGO = 'ESME_LOGO_BASELINE_QUADRI_2021.png';
const LIGHT_HEIGHT = 0.36;   // hauteur du verre des feux de bord (feux surélevés)
const HANGARS = [{ x: 395, z: 15, name: 'ESME AÉRO-CLUB' }, { x: 395, z: 62, name: 'HANGAR 2' }]
    .map((h) => ({ ...h, minX: h.x - 15, maxX: h.x + 15, minZ: h.z - 14, maxZ: h.z + 14 }));
// Mâts d'éclairage du parking (asset/light-square-cross, Kenney, CC0) : en bordure est, derrière la queue des
// avions garés, entre le parking et les bâtiments. Le modèle mesure 0,6 m : à l'échelle 20, un mât de 12 m.
// Le 3e est aligné sur les autres, mais face à l'espace entre les deux hangars (devant le premier, il gênait l'accès aux portes)
const FLOODLIGHTS = { points: [[APRON.maxX - 2, -90], [APRON.maxX - 2, -30], [APRON.maxX - 2, 38.5], [APRON.maxX - 2, 90]], scale: 20 };
const FLOODLIGHT_LAMPS = [[0.1875, 0], [-0.1875, 0], [0, 0.1875], [0, -0.1875]]; // bouts des 4 bras (repère du modèle)
const FLOODLIGHT_LAMP_Y = 0.57;
const WIND_DIRECTION = 0; // le vent vient du nord (la manche à air pointe vers le sud)
// Point d'attente de la bretelle A, avant la piste (OACI : marque de type A, panneaux obligatoires)
const HOLDING_X = RUNWAY.x + 45;
const YELLOW = '#f2c200';

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

// Bretelle : enrobé, axe jaune, bords jaunes, marque de point d'attente (type A : 2 lignes continues côté bretelle,
// 2 lignes en tirets côté piste). Dessin en mètres, haut du canvas = nord
const PX = 20; // pixels par mètre
function taxiwayTexture(maxAnisotropy) {
    const w = TAXIWAY.maxX - TAXIWAY.minX, h = TAXIWAY.maxZ - TAXIWAY.minZ;
    return canvasTexture(w * PX, h * PX, (ctx, cw, ch) => {
        speckle(ctx, cw, ch, '#45464a', 0.12, 90000);
        ctx.setTransform(PX, 0, 0, PX, 0, 0);
        ctx.fillStyle = YELLOW;
        // Bords et axe (élargis à 0,2 / 0,3 m : lisibles de loin)
        ctx.fillRect(0, 0.35, w, 0.2);
        ctx.fillRect(0, h - 0.55, w, 0.2);
        ctx.fillRect(0, h / 2 - 0.15, w, 0.3);
        // Point d'attente : 4 lignes de 0,3 m espacées de 0,3 m en travers de la bretelle, tirets côté piste
        const x = HOLDING_X - TAXIWAY.minX;
        for (const [offset, dashed] of [[0, true], [0.6, true], [1.2, false], [1.8, false]]) {
            if (!dashed) ctx.fillRect(x + offset, 0.55, 0.3, h - 1.1);
            else for (let z = 0.55; z < h - 0.55; z += 2) ctx.fillRect(x + offset, z, 0.3, Math.min(1, h - 0.55 - z));
        }
    }, { anisotropy: maxAnisotropy });
}

// Lignes d'entrée sur la piste (fond transparent) : quarts de cercle de l'axe de la bretelle vers l'axe de piste
const LEAD_ON = { minX: RUNWAY.x - 1, maxX: TAXIWAY.minX + 1, minZ: -17, maxZ: 17 };
function leadOnTexture() {
    const w = LEAD_ON.maxX - LEAD_ON.minX, h = LEAD_ON.maxZ - LEAD_ON.minZ;
    return canvasTexture(w * PX, h * PX, (ctx) => {
        ctx.setTransform(PX, 0, 0, PX, -LEAD_ON.minX * PX, -LEAD_ON.minZ * PX); // dessin en coordonnées monde (x, z)
        ctx.strokeStyle = YELLOW;
        ctx.lineWidth = 0.3;
        const r = TAXIWAY.minX - RUNWAY.x;
        // Vers le nord (piste 36) : centre (bord de piste, -r) ; vers le sud (piste 18) : centre (bord de piste, +r)
        ctx.beginPath();
        ctx.arc(TAXIWAY.minX, -r, r, Math.PI / 2, Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(TAXIWAY.minX, r, r, -Math.PI / 2, -Math.PI, true);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(TAXIWAY.minX, 0);
        ctx.lineTo(LEAD_ON.maxX, 0);
        ctx.stroke();
    });
}

// Parking : dalles de béton de 5 m, ligne de bord jaune, voie de circulation (axe jaune nord-sud raccordé à la
// bretelle), et pour chaque place : ligne d'entrée courbe, barre d'arrêt, numéro, limites de place (blanc).
// Route de service (lignes blanches) entre les places et les hangars. Dessin en coordonnées monde (x, z)
const APRON_PX = 12;
function apronTexture(maxAnisotropy) {
    const w = APRON.maxX - APRON.minX, h = APRON.maxZ - APRON.minZ;
    return canvasTexture(w * APRON_PX, h * APRON_PX, (ctx, cw, ch) => {
        speckle(ctx, cw, ch, '#8b8a86', 0.08, 120000);
        ctx.setTransform(APRON_PX, 0, 0, APRON_PX, -APRON.minX * APRON_PX, -APRON.minZ * APRON_PX);
        // Joints des dalles
        ctx.strokeStyle = 'rgba(40,40,40,0.45)';
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        for (let x = APRON.minX; x <= APRON.maxX; x += 5) { ctx.moveTo(x, APRON.minZ); ctx.lineTo(x, APRON.maxZ); }
        for (let z = APRON.minZ; z <= APRON.maxZ; z += 5) { ctx.moveTo(APRON.minX, z); ctx.lineTo(APRON.maxX, z); }
        ctx.stroke();
        // Bord du parking (double ligne jaune), interrompu à l'arrivée de la bretelle et vers les hangars
        ctx.strokeStyle = YELLOW;
        ctx.lineWidth = 0.2;
        const edge = (x1, z1, x2, z2) => { ctx.beginPath(); ctx.moveTo(x1, z1); ctx.lineTo(x2, z2); ctx.stroke(); };
        for (const inset of [0.6, 1]) {
            edge(APRON.minX + inset, APRON.minZ + inset, APRON.minX + inset, TAXIWAY.minZ - 1);
            edge(APRON.minX + inset, TAXIWAY.maxZ + 1, APRON.minX + inset, APRON.maxZ - inset);
            edge(APRON.minX + inset, APRON.minZ + inset, APRON.maxX - inset, APRON.minZ + inset);
            edge(APRON.minX + inset, APRON.maxZ - inset, APRON.maxX - inset, APRON.maxZ - inset);
        }
        // Voie de circulation : axe jaune raccordé à l'axe de la bretelle par deux courbes
        ctx.lineWidth = 0.3;
        edge(TAXILANE_X, APRON.minZ + 4, TAXILANE_X, APRON.maxZ - 4);
        const r = TAXILANE_X - APRON.minX;
        ctx.beginPath(); ctx.arc(APRON.minX, -r, r, Math.PI / 2, 0, true); ctx.stroke();
        ctx.beginPath(); ctx.arc(APRON.minX, r, r, -Math.PI / 2, 0); ctx.stroke();
        // Places : ligne d'entrée (courbe de 10 m depuis la voie), barre d'arrêt au nez, numéro
        STANDS.forEach((z, i) => {
            const side = z > 0 ? -1 : 1; // on arrive par le côté le plus proche de la bretelle
            ctx.lineWidth = 0.3;
            ctx.beginPath();
            ctx.moveTo(TAXILANE_X, z + side * 10);
            ctx.arc(TAXILANE_X + 10, z + side * 10, 10, Math.PI, side > 0 ? -Math.PI / 2 : Math.PI / 2, side < 0);
            ctx.lineTo(354, z);
            ctx.stroke();
            ctx.fillStyle = YELLOW;
            ctx.fillRect(331.5, z - 2, 0.5, 4);                          // barre d'arrêt (nez de l'avion)
            // Limites de la place (blanc), à mi-chemin entre deux places voisines
            ctx.fillStyle = '#eeeeee';
            for (const dz of [-9.5, 9.5]) ctx.fillRect(322, z + dz - 0.1, 34, 0.2);
            // Numéro, lisible en arrivant par la voie (vers l'est)
            ctx.save();
            ctx.translate(356.5, z);
            ctx.rotate(Math.PI / 2);
            ctx.fillStyle = YELLOW;
            ctx.font = 'bold 4px DejaVu Sans, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), 0, 0);
            ctx.restore();
        });
        // Route de service (véhicules), entre les places et les hangars : deux lignes blanches discontinues
        ctx.fillStyle = '#eeeeee';
        for (const x of [358.5, 362.5]) for (let z = APRON.minZ + 2; z < APRON.maxZ - 2; z += 4) ctx.fillRect(x, z, 0.15, 2);
    }, { anisotropy: maxAnisotropy });
}

// Raquette de retournement : bande de TURN_PAD.width m le long de la piste, biseautée du côté du milieu de piste
function turnPadGeometry(pad) {
    const tip = pad.end > 0 ? pad.maxZ : pad.minZ;
    const inner = pad.end > 0 ? pad.minZ : pad.maxZ;
    const points = [
        [pad.minX, inner], [pad.maxX, inner + pad.end * TURN_PAD.taper], [pad.maxX, tip], [pad.minX, tip],
    ].map(([x, z]) => new Vector2(x, -z));   // plan (x, -z) : tourné ensuite à plat
    const geometry = new ShapeGeometry(new Shape(points));
    // Coordonnées de texture : position dans le rectangle de la raquette (élargi à la piste pour la ligne)
    const position = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
        uv.setXY(i, (position.getX(i) - pad.minX) / TURN_PAD.width, 1 - (-position.getY(i) - pad.minZ) / (pad.maxZ - pad.minZ));
    }
    return geometry;
}

// Enrobé de la raquette et ligne jaune de demi-tour : l'axe de piste s'en écarte, fait le tour de la raquette et revient
function turnPadTexture(pad, maxAnisotropy) {
    const w = TURN_PAD.width, h = pad.maxZ - pad.minZ;
    const px = 16;
    return canvasTexture(w * px, h * px, (ctx, cw, ch) => {
        speckle(ctx, cw, ch, '#3d3e41', 0.12, 30000);
        ctx.setTransform(px, 0, 0, px, -pad.minX * px, -pad.minZ * px); // coordonnées monde (x, z)
        const tip = pad.end > 0 ? pad.maxZ : pad.minZ, e = pad.end;
        const x0 = pad.minX;
        // Bords de la raquette (jaune)
        ctx.strokeStyle = YELLOW;
        ctx.lineWidth = 0.2;
        ctx.beginPath();
        ctx.moveTo(pad.maxX - 0.4, tip);
        ctx.lineTo(pad.maxX - 0.4, tip - e * (TURN_PAD.length - TURN_PAD.taper));
        ctx.lineTo(x0, tip - e * TURN_PAD.length);
        ctx.stroke();
    }, { anisotropy: maxAnisotropy });
}

// Ligne jaune de demi-tour (fond transparent, posée sur la piste et la raquette) : elle quitte l'axe de piste,
// fait le tour de la raquette en forme de goutte et revient sur l'axe dans l'autre sens
function turnLoopArea(pad) {
    return { minX: RUNWAY.x - 1, maxX: pad.maxX, minZ: pad.minZ, maxZ: pad.maxZ };
}
function turnLoopTexture(pad) {
    const area = turnLoopArea(pad);
    const px = 16;
    return canvasTexture((area.maxX - area.minX) * px, (area.maxZ - area.minZ) * px, (ctx) => {
        ctx.setTransform(px, 0, 0, px, -area.minX * px, -area.minZ * px); // coordonnées monde (x, z)
        ctx.strokeStyle = YELLOW;
        ctx.lineWidth = 0.3;
        const tip = pad.end > 0 ? pad.maxZ : pad.minZ, e = pad.end, c = RUNWAY.x;
        ctx.beginPath();
        ctx.moveTo(c, tip - e * 52);
        ctx.bezierCurveTo(c, tip - e * 36, c + 26, tip - e * 34, c + 27, tip - e * 18);
        ctx.bezierCurveTo(c + 28, tip - e * 4, c + 3, tip - e * 3, c, tip - e * 20);
        ctx.stroke();
    });
}

// Panneau d'aérodrome : cases côte à côte { text, bg, fg, width (m), size, border }, hauteur 0,8 m
function signTexture(panels, height = 0.8) {
    const total = panels.reduce((sum, p) => sum + p.width, 0);
    const px = 128;
    return canvasTexture(Math.round(total * px), Math.round(height * px), (ctx, cw, ch) => {
        let x = 0;
        for (const panel of panels) {
            const w = panel.width * px;
            ctx.fillStyle = panel.bg;
            ctx.fillRect(x, 0, w, ch);
            if (panel.border) {
                ctx.strokeStyle = panel.fg;
                ctx.lineWidth = 5;
                ctx.strokeRect(x + 9, 9, w - 18, ch - 18);
            }
            ctx.fillStyle = panel.fg;
            ctx.font = `bold ${panel.size ?? 64}px DejaVu Sans, Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(panel.text, x + w / 2, ch / 2 + 3, w - 24);
            x += w;
        }
    });
}

// Bardage métallique nervuré (bacs acier) : nervures verticales, `ribs` par mètre sur `width` m ; `lines` joints horizontaux
function claddingTexture(base, ribs, width, { lines = 0 } = {}) {
    const texture = canvasTexture(128, 64, (ctx, w, h) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x++) {
            const v = Math.sin((x / w) * Math.PI * 2);
            ctx.fillStyle = v > 0.6 ? 'rgba(255,255,255,0.18)' : v < -0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0)';
            ctx.fillRect(x, 0, 1, h);
        }
        if (lines) {
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(0, 0, w, 2);
        }
    });
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(width * ribs, lines || 1);
    return texture;
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
        // Balise VOR (antenne à 6,5 m de haut)
        this.vor = { ...VOR_STATION, y: 6.5 };
        // Contours pour la carte (MapView.js)
        this._hangars = [];          // portes animées et éclairage intérieur, voir updateHangars
        this.mapShapes = [{ ...TAXIWAY, kind: 'asphalt' }, { ...APRON, kind: 'asphalt' }, { ...HANGAR_APRON, kind: 'asphalt' },
            ...TURN_PADS.map((pad) => ({ ...pad, kind: 'asphalt' })), { ...RUNWAY_RECT, kind: 'runway' }];
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
        return inside(RUNWAY_RECT, x, z) || inside(TAXIWAY, x, z) || inside(APRON, x, z) || inside(HANGAR_APRON, x, z)
            || TURN_PADS.some((pad) => inside(pad, x, z)) || HANGARS.some((h) => inside(h, x, z)) ? 'asphalt' : 'grass';
    }

    build(renderer) {
        const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
        this._buildGround(maxAnisotropy);
        this._buildBuildings();
        this._buildWindsock();
        this._buildLights();
        this._buildPapi();
        this._buildVor();
        this.group.traverse((child) => {
            if (child.isMesh) {
                child.receiveShadow = true;
                child.castShadow = !child.userData.flat;
            }
        });
        return this.group;
    }

    // Avions garés sur le parking : copies du Cessna du joueur, repeintes
    addParkedPlanes(model, wheelHeight) {
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
            holder.position.set(spot.x, wheelHeight - 0.01, spot.z); // roues posées sur le parking
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
        for (const [fx, z] of FLOODLIGHTS.points) {
            const mast = model.clone();
            mast.position.set(fx, 0, z);
            mast.scale.setScalar(FLOODLIGHTS.scale);
            this.group.add(mast);
            // Obstacle : le mât seul (les bras sont trop haut pour un avion qui roule)
            this.obstacles.push(new Box3(new Vector3(fx - 0.5, 0, z - 0.5), new Vector3(fx + 0.5, 12, z + 0.5)));
            for (const [dx, dz] of FLOODLIGHT_LAMPS) {
                lamps.push(fx + dx * FLOODLIGHTS.scale, FLOODLIGHT_LAMP_Y * FLOODLIGHTS.scale, z + dz * FLOODLIGHTS.scale);
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
        // Centrée sous le mât (les 4 projecteurs éclairent tout autour)
        for (const [fx, z] of FLOODLIGHTS.points) {
            this._flat(new PlaneGeometry(34, 34), this._poolMaterial, fx, 0.04, z);
        }
        this.setNight(this._night);
    }

    // night : 0 = jour, 1 = nuit (feux et fenêtres allumés)
    setNight(night) {
        this._night = night;
        this.lightsMaterial.size = 1.6 + 1.6 * night;
        this.lightsMaterial.color.setScalar(0.6 + 2.4 * night);
        for (const material of this._glowingMaterials) material.emissiveIntensity = 0.05 + 1.6 * night;
        // Verres des feux de bord : colorés le jour, lumineux la nuit (au-delà de 1 : halo du bloom)
        if (this._lensMaterial) this._lensMaterial.color.setScalar(0.75 + 2.5 * night);
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

        // Bretelle (taxiway) avec ses marques jaunes : axe, bords, point d'attente
        this._flat(new PlaneGeometry(TAXIWAY.maxX - TAXIWAY.minX, TAXIWAY.maxZ - TAXIWAY.minZ), surface(taxiwayTexture(maxAnisotropy)),
            (TAXIWAY.minX + TAXIWAY.maxX) / 2, 0.015, (TAXIWAY.minZ + TAXIWAY.maxZ) / 2);
        // Lignes d'entrée sur la piste : l'axe jaune de la bretelle tourne vers l'axe de piste, dans les deux sens
        const leadOn = new MeshStandardMaterial({
            map: leadOnTexture(), transparent: true, depthWrite: false, roughness: 0.95,
            polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        });
        this._flat(new PlaneGeometry(LEAD_ON.maxX - LEAD_ON.minX, LEAD_ON.maxZ - LEAD_ON.minZ), leadOn,
            (LEAD_ON.minX + LEAD_ON.maxX) / 2, 0.03, (LEAD_ON.minZ + LEAD_ON.maxZ) / 2);

        // Parking en dalles de béton, avec ses marques (voie de circulation, places, numéros, route de service)
        this._flat(new PlaneGeometry(APRON.maxX - APRON.minX, APRON.maxZ - APRON.minZ), surface(apronTexture(maxAnisotropy)),
            (APRON.minX + APRON.maxX) / 2, 0.015, (APRON.minZ + APRON.maxZ) / 2);
        // Enrobé jusqu'aux portes des hangars
        const asphalt = (w, h) => canvasTexture(256, 256, (ctx, cw, ch) => speckle(ctx, cw, ch, '#45464a', 0.12, 8000), { repeat: [w / 10, h / 10] });
        const hw = HANGAR_APRON.maxX - HANGAR_APRON.minX, hh = HANGAR_APRON.maxZ - HANGAR_APRON.minZ;
        this._flat(new PlaneGeometry(hw, hh), surface(asphalt(hw, hh)),
            (HANGAR_APRON.minX + HANGAR_APRON.maxX) / 2, 0.016, (HANGAR_APRON.minZ + HANGAR_APRON.maxZ) / 2);
        // Raquettes de retournement aux bouts de piste, avec la ligne jaune de demi-tour
        for (const pad of TURN_PADS) {
            this._flat(turnPadGeometry(pad), surface(turnPadTexture(pad, maxAnisotropy)), 0, 0.017, 0);
            const area = turnLoopArea(pad);
            this._flat(new PlaneGeometry(area.maxX - area.minX, area.maxZ - area.minZ), new MeshStandardMaterial({
                map: turnLoopTexture(pad), transparent: true, depthWrite: false, roughness: 0.95,
                polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
            }), (area.minX + area.maxX) / 2, 0.03, (area.minZ + area.maxZ) / 2);
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

        // Hangars métalliques : toit à deux pans, bardage nervuré, portes coulissantes entrouvertes vers le parking
        for (const h of HANGARS) this._buildHangar(h.x, h.z, h.name);
        this._buildSigns();
    }

    // Hangar de 30 × 28 m (x, z : centre), murs de 8 m, faîtage à 10,5 m ; portes côté ouest (parking)
    _buildHangar(x, z, name) {
        const D = 30, W = 28, H = 8, RIDGE = 10.5;
        const hangar = new Group();
        hangar.position.set(x, 0, z);
        const metal = (map, extra = {}) => new MeshStandardMaterial({ map, metalness: 0.35, roughness: 0.6, ...extra });
        const wallMaterial = metal(claddingTexture('#c9d0d6', 4, D));
        const endMaterial = metal(claddingTexture('#c9d0d6', 4, W), { side: DoubleSide });
        const roofMaterial = metal(claddingTexture('#5f6873', 3, D + 1), { metalness: 0.45, roughness: 0.5 });
        const doorMaterial = metal(claddingTexture('#f1f3f4', 5, 4.5, { lines: 4 }), { metalness: 0.3, roughness: 0.55 });
        const trim = new MeshStandardMaterial({ color: 0x2d3e50, roughness: 0.6 });
        const add = (geometry, material, px, py, pz) => {
            const mesh = new Mesh(geometry, material);
            mesh.position.set(px, py, pz);
            hangar.add(mesh);
            return mesh;
        };
        // Murs latéraux et mur du fond
        for (const side of [-1, 1]) add(new BoxGeometry(D, H, 0.3), wallMaterial, 0, H / 2, side * W / 2);
        add(new BoxGeometry(0.3, H, W), endMaterial, D / 2, H / 2, 0);
        // Pignons (triangles sous le toit), devant et derrière
        const gable = new Shape([new Vector2(-W / 2, H), new Vector2(W / 2, H), new Vector2(0, RIDGE)]);
        for (const [px, angle] of [[-D / 2, -Math.PI / 2], [D / 2, Math.PI / 2]]) {
            add(new ShapeGeometry(gable), endMaterial, px, 0, 0).rotation.y = angle;
        }
        // Toit à deux pans (débord de 0,6 m)
        const run = W / 2 + 0.6, rise = RIDGE - H + 0.1;
        const slope = Math.atan2(rise, run);
        const translucent = new MeshStandardMaterial({ color: 0xcfe0e8, roughness: 0.3, metalness: 0.1 });
        for (const side of [-1, 1]) {
            add(new BoxGeometry(D + 1, 0.15, Math.hypot(run, rise)), roofMaterial, 0, H + rise / 2, side * run / 2).rotation.x = side * slope;
            // Gouttière le long de l'avant-toit, descente au coin avant
            add(new BoxGeometry(D + 1, 0.2, 0.25), trim, 0, H - 0.05, side * (W / 2 + 0.55));
            add(new BoxGeometry(0.15, H, 0.15), trim, -D / 2 + 0.3, H / 2, side * (W / 2 + 0.55));
            // Bandeau éclairant en haut des murs latéraux (plaques translucides)
            add(new BoxGeometry(D - 4, 0.9, 0.05), translucent, 0, H - 1.1, side * (W / 2 + 0.16));
        }
        // Faîtière
        add(new BoxGeometry(D + 1, 0.25, 0.6), trim, 0, RIDGE + 0.1, 0);
        // Façade : linteau au-dessus des portes, poteaux d'angle, rail des portes
        add(new BoxGeometry(0.5, H - 7.2, W), trim, -D / 2, 7.2 + (H - 7.2) / 2, 0);
        for (const side of [-1, 1]) add(new BoxGeometry(0.5, 7.2, 0.4), trim, -D / 2, 3.6, side * (W / 2 - 0.2));
        add(new BoxGeometry(0.3, 0.2, W), trim, -D / 2 - 0.1, 7.15, 0);
        // Portes coulissantes : 6 vantaux de 4,5 m sur 3 rails parallèles ; ouvertes, ils s'empilent aux deux bouts
        // (ouverture de 18 m), fermés ils se suivent sur toute la largeur. Animés par updateHangars
        const panelZ = (i) => -W / 2 + 0.4 + 2.25 + i * 4.53;
        const panels = [0, 1, 2, 3, 4, 5].map((i) => {
            const left = i < 3, track = left ? i : 5 - i;
            const mesh = add(new BoxGeometry(0.2, 7.1, 4.5), doorMaterial, -D / 2 + 0.1 + track * 0.25, 3.55, panelZ(i));
            return { mesh, closedZ: panelZ(i), openZ: panelZ(left ? 0 : 5) };
        });
        // Intérieur sombre, vu par l'ouverture
        // Intérieur : murs sombres, sol blanc (résine époxy, brillante)
        const innerWall = new MeshStandardMaterial({ color: 0x3a4048, roughness: 1, side: BackSide, emissive: 0xfff6e8, emissiveIntensity: 0 });
        const floor = new MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.35, metalness: 0.05, side: BackSide, emissive: 0xfff6e8, emissiveIntensity: 0 });
        const interior = add(new BoxGeometry(D - 0.8, H - 0.3, W - 0.8), [innerWall, innerWall, innerWall, floor, innerWall, innerWall],
            0.2, (H - 0.3) / 2 + 0.05, 0); // sol 5 cm au-dessus du terrain (sinon l'herbe apparaît dedans)
        interior.userData.flat = true; // pas d'ombre portée
        // Plafonniers : 3 rangées de rampes LED sous le toit, allumées quand les portes s'ouvrent
        const ceiling = new MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff6e8, emissiveIntensity: 0 });
        for (const lz of [-8, 0, 8]) for (const lx of [-9, -3, 3, 9]) add(new BoxGeometry(3, 0.12, 0.35), ceiling, lx, H - 0.45, lz);
        // Porte de service sur le côté
        add(new BoxGeometry(1, 2.1, 0.08), trim, -D / 2 + 4, 1.05, W / 2 + 0.17);
        // Enseigne sur le linteau, logo ESME sur le pignon et sur les murs latéraux, projecteurs (allumés la nuit)
        const signMap = signTexture([{ text: name, bg: '#1c2c3c', fg: '#ffffff', width: 12, size: 64 }], 0.75);
        const signMaterial = new MeshStandardMaterial({ map: signMap, emissiveMap: signMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
        add(new PlaneGeometry(12, 0.75), signMaterial, -D / 2 - 0.27, 7.6, 0).rotation.y = -Math.PI / 2;
        const logo = new MeshStandardMaterial({ map: this._logoTexture(), transparent: true, alphaTest: 0.5, roughness: 0.6 });
        add(new PlaneGeometry(2.3, 2.3), logo, -D / 2 - 0.05, H + 1.15, 0).rotation.y = -Math.PI / 2;
        for (const side of [-1, 1]) add(new PlaneGeometry(5.5, 5.5), logo, 6, 3.8, side * (W / 2 + 0.17)).rotation.y = side > 0 ? 0 : Math.PI;
        const lamp = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 0 });
        for (const side of [-1, 1]) add(new BoxGeometry(0.5, 0.25, 0.8), lamp, -D / 2 - 0.5, 8.2, side * 8);
        this._glowingMaterials.push(signMaterial, lamp);

        this.group.add(hangar);
        hangar.updateMatrixWorld(true);
        // Obstacles : murs, toit, linteau et vantaux empilés ; la porte ne bloque que fermée (on peut entrer)
        const box = (minX, maxX, minY, maxY, minZ, maxZ) => new Box3(new Vector3(x + minX, minY, z + minZ), new Vector3(x + maxX, maxY, z + maxZ));
        const stack = W / 2 - (-panelZ(0) - 2.25);   // les vantaux empilés occupent 4,9 m de chaque côté
        this.obstacles.push(
            box(D / 2 - 0.2, D / 2 + 0.2, 0, H, -W / 2, W / 2),                      // fond
            box(-D / 2, D / 2, 0, H, W / 2 - 0.2, W / 2 + 0.2),                      // murs latéraux
            box(-D / 2, D / 2, 0, H, -W / 2 - 0.2, -W / 2 + 0.2),
            box(-D / 2 - 0.5, D / 2 + 0.5, H, RIDGE + 0.3, -W / 2 - 0.6, W / 2 + 0.6), // toit
            box(-D / 2 - 0.3, -D / 2 + 0.8, 7.2, H, -W / 2, W / 2),                  // linteau
            box(-D / 2 - 0.1, -D / 2 + 0.8, 0, 7.2, W / 2 - stack, W / 2),           // vantaux empilés
            box(-D / 2 - 0.1, -D / 2 + 0.8, 0, 7.2, -W / 2, -W / 2 + stack),
        );
        const door = box(-D / 2 - 0.1, -D / 2 + 0.8, 0, 7.2, -W / 2, W / 2);
        this.obstacles.push(door);
        this._hangars.push({
            front: new Vector3(x - D / 2, 0, z), panels, open: 0, door, doorBox: door.clone(),
            lights: [ceiling, innerWall, floor],
        });
    }

    _logoTexture() {
        if (!this._logo) {
            this._logo = new TextureLoader().load(LOGO);
            this._logo.colorSpace = SRGBColorSpace;
            this._logo.anisotropy = 4;
        }
        return this._logo;
    }

    // Portes des hangars : s'ouvrent quand l'avion approche, se referment quand il s'éloigne ; les plafonniers
    // s'allument avec l'ouverture. position : avion du joueur
    updateHangars(delta, position) {
        for (const hangar of this._hangars) {
            const near = position && position.distanceTo(hangar.front) < DOOR_TRIGGER;
            const target = near ? 1 : 0;
            if (hangar.open === target) continue;
            hangar.open = Math.min(1, Math.max(0, hangar.open + (near ? 1 : -1) * delta / DOOR_TIME));
            const t = hangar.open * hangar.open * (3 - 2 * hangar.open);   // départ et arrivée en douceur
            for (const panel of hangar.panels) panel.mesh.position.z = MathUtils.lerp(panel.closedZ, panel.openZ, t);
            // La porte ne bloque plus l'avion une fois grande ouverte
            if (hangar.open > 0.95) hangar.door.makeEmpty();
            else hangar.door.copy(hangar.doorBox);
            const [ceiling, wall, floor] = hangar.lights;
            ceiling.emissiveIntensity = 3 * t;
            wall.emissiveIntensity = 0.12 * t;
            floor.emissiveIntensity = 0.35 * t;
        }
    }

    // Panneaux du point d'attente, de chaque côté de la bretelle, tournés vers les avions qui viennent du parking :
    // obligatoire (rouge) "18 - 36" (à gauche la piste 18, à droite la 36), position "A" (noir), information
    // "TORA 700 m" (longueur de piste utilisable au décollage, jaune). Éclairés la nuit
    _buildSigns() {
        const red = { text: '18 - 36', bg: '#c8102e', fg: '#ffffff', width: 1.9 };
        const location = { text: 'A', bg: '#111111', fg: YELLOW, width: 0.8, border: true };
        const info = { text: `TORA ${RUNWAY.length} m`, bg: YELLOW, fg: '#111111', width: 2.6, size: 54 };
        const back = new MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
        const post = new MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.5, metalness: 0.4 });
        const place = (panels, z) => {
            const width = panels.reduce((sum, p) => sum + p.width, 0);
            const map = signTexture(panels);
            const face = new MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
            this._glowingMaterials.push(face);
            // Faces de la boîte (+x, -x, +y, -y, +z, -z) : +x, vers le parking, porte le panneau
            const box = new Mesh(new BoxGeometry(0.25, 0.8, width), [face, back, back, back, back, back]);
            box.position.set(HOLDING_X + 3, 0.9, z);
            this.group.add(box);
            for (const side of [-1, 1]) {
                const leg = new Mesh(new BoxGeometry(0.08, 0.5, 0.08), post);
                leg.position.set(HOLDING_X + 3, 0.25, z + side * (width / 2 - 0.3));
                this.group.add(leg);
            }
        };
        const margin = TAXIWAY.maxZ + 4;
        place([red, location], margin);                // à gauche en roulant vers la piste (au sud)
        place([location, red, info], -margin - 1.4);   // à droite (au nord)
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
        const lights = [];     // { x, z, color, kind } : feux surélevés (support, boîtier, verre)
        const add = (x, z, color, kind = 'runway') => {
            positions.push(x, LIGHT_HEIGHT + 0.05, z);
            colors.push(color.r, color.g, color.b);
            lights.push({ x, z, color, kind });
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
        // Taxiway : feux bleus (plus bas)
        for (let x = TAXIWAY.minX + 5; x <= TAXIWAY.maxX; x += 10) {
            add(x, TAXIWAY.minZ - 1, blue, 'taxi');
            add(x, TAXIWAY.maxZ + 1, blue, 'taxi');
        }

        // Halo (la nuit) : points lumineux à la hauteur des verres
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
        this.lightsMaterial = new PointsMaterial({
            size: 1.5, map: flareTexture(), vertexColors: true, transparent: true,
            depthWrite: false, blending: AdditiveBlending,
        });
        this.group.add(new Points(geometry, this.lightsMaterial));

        // Feux surélevés (comme les vrais feux de balisage) : embase vissée au sol, tige jaune cassable (un avion qui
        // la heurte la casse sans dommage), boîtier noir, verre bombé coloré. Dessinés en instances : un appel par pièce
        const parts = [
            { geometry: new CylinderGeometry(0.11, 0.13, 0.04, 12), material: new MeshStandardMaterial({ color: 0x5c5f63, roughness: 0.7, metalness: 0.4 }), y: 0.02 },
            { geometry: new CylinderGeometry(0.025, 0.03, 1, 8), material: new MeshStandardMaterial({ color: 0xe0b400, roughness: 0.6 }), stem: true },
            { geometry: new CylinderGeometry(0.075, 0.06, 0.08, 14), material: new MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.3 }), y: LIGHT_HEIGHT - 0.07 },
            { geometry: new SphereGeometry(0.068, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lens: true, y: LIGHT_HEIGHT - 0.035 },
        ];
        this._lensMaterial = new MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
        const matrix = new Matrix4();
        for (const part of parts) {
            const mesh = new InstancedMesh(part.geometry, part.lens ? this._lensMaterial : part.material, lights.length);
            lights.forEach((light, i) => {
                const top = light.kind === 'taxi' ? LIGHT_HEIGHT - 0.1 : LIGHT_HEIGHT;   // feux de taxiway plus bas
                const drop = LIGHT_HEIGHT - top;
                if (part.stem) matrix.makeScale(1, top - 0.1, 1).setPosition(light.x, (top - 0.1) / 2 + 0.03, light.z);
                else matrix.makeTranslation(light.x, part.y - drop, light.z);
                mesh.setMatrixAt(i, matrix);
                if (part.lens) mesh.setColorAt(i, light.color.clone().lerp(new Color(1, 1, 1), 0.15));
            });
            mesh.castShadow = !part.lens;
            this.group.add(mesh);
        }
    }

    // VOR conventionnel : abri technique blanc, plan réflecteur circulaire (contrepoids) sur pieds, antenne centrale
    // sous radôme conique, couronne d'antennes de mesure et feu d'obstacle rouge au sommet
    _buildVor() {
        const { x, z } = VOR_STATION;
        const vor = new Group();
        vor.position.set(x, 0, z);
        const white = new MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.7 });
        const metal = new MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.45, metalness: 0.6 });
        const dark = new MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6 });
        const add = (geometry, material, px, py, pz) => {
            const mesh = new Mesh(geometry, material);
            mesh.position.set(px, py, pz);
            vor.add(mesh);
            return mesh;
        };
        // Abri technique (sous le plan réflecteur), porte et climatiseur
        add(new BoxGeometry(4, 2.6, 4), white, 0, 1.3, 0);
        add(new BoxGeometry(0.05, 2, 0.9), dark, 2.02, 1, 0.8);
        add(new BoxGeometry(0.4, 0.6, 0.8), metal, 2.2, 0.9, -0.8);
        // Plan réflecteur : disque grillagé de 14 m sur pieds, à 3,4 m
        add(new CylinderGeometry(7, 7, 0.12, 40), metal, 0, 3.4, 0);
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            add(new CylinderGeometry(0.08, 0.08, 3.4, 6), metal, Math.cos(a) * 5.5, 1.7, Math.sin(a) * 5.5);
        }
        // Couronne d'antennes (petits mâts) au bord du disque
        for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            add(new CylinderGeometry(0.03, 0.03, 0.8, 5), white, Math.cos(a) * 6.6, 3.85, Math.sin(a) * 6.6);
        }
        // Antenne centrale : socle et radôme conique blanc ("salière")
        add(new CylinderGeometry(0.7, 0.9, 0.9, 20), white, 0, 3.9, 0);
        add(new CylinderGeometry(0.15, 0.75, 1.8, 20), white, 0, 5.25, 0);
        const beacon = add(new SphereGeometry(0.15, 10, 8), new MeshStandardMaterial({ color: 0xff2010, emissive: 0xff2010, emissiveIntensity: 0.5 }), 0, 6.3, 0);
        this._glowingMaterials.push(beacon.material);
        // Panneau d'identification
        const map = signTexture([{ text: `VOR ${VOR_STATION.ident} ${VOR_STATION.frequency}`, bg: '#ffffff', fg: '#111111', width: 3.2, size: 44 }], 0.6);
        add(new PlaneGeometry(3.2, 0.6), new MeshStandardMaterial({ map, roughness: 0.7 }), 2.03, 2.1, -0.1).rotation.y = Math.PI / 2;

        this.group.add(vor);
        vor.updateMatrixWorld(true);
        this.obstacles.push(new Box3().setFromObject(vor).expandByScalar(-0.5));
    }
}

export { Airport };
