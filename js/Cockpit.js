import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    CircleGeometry,
    Float32BufferAttribute,
    Color,
    ExtrudeGeometry,
    Path,
    Shape,
    ShapeGeometry,
    Vector2,
    CylinderGeometry,
    DoubleSide,
    Group,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    RepeatWrapping,
    ShaderMaterial,
    SRGBColorSpace,
    TorusGeometry,
    Vector3
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from './MergeStatic.js';
import { Controls3D } from './Controls3D.js';
import { Panel172, PANEL_LAYOUT, panelPoint, panelLength, PANEL_FACE_Z } from './Panel172.js';
import { PEDESTAL_LAYOUT, Hotspots, drawPedestal, drawFuelSelector } from './PanelControls.js';
import { TANK_CAPACITY } from './Systems.js';

// Cabine de Cessna 172 modélisée ici, vue depuis la place gauche (pilote). Le tableau de bord est dans Panel172.js.
// Repère : origine à hauteur des yeux sur l'axe de l'avion, -z vers l'avant.
const EYE = new Vector3(-0.265, 0.1, 0); // face à l'horizon artificiel ; on voit le sol par-dessus le tableau
// Manches : sortent du tableau par leur passage (course poussé / tiré), le volant tourne
const YOKE_TRAVEL = 0.1;          // m de chaque côté du neutre
const YOKE_TURN = Math.PI / 2;    // 90° de chaque côté
const YOKE_OUT = 0.16;            // longueur de colonne hors du tableau au neutre
// Pupitre central (molette de trim, robinet carburant) et sélecteur de réservoir au plancher : 1 280 px par mètre
const PX_PER_M = 1280;
const PEDESTAL = { width: 0.2, height: 0.23, x: 0, y: -0.778, z: -0.598 };   // haut juste sous le bossage du tableau
const FUEL_PLATE = { width: 0.2, height: 0.156, x: 0, y: -0.884, z: -0.45 };
// Unités aéronautiques : la physique est en mètres et m/s, les instruments en nœuds et en pieds
const KT = 3600 / 1852;   // m/s -> nœuds
const FT = 1 / 0.3048;    // m -> pieds
const NM = 1852;          // mille nautique (m)
const PANEL_NIGHT_LIGHT = new Color(0xffbf45); // éclairage ambré des instruments
const WHITE = new Color(0xffffff);

const deg = MathUtils.degToRad;

// --- Indicateur VOR dessiné (panneau VOR de la vue extérieure) -------------------------
function polar(cx, cy, r, angle) {
    return [cx + Math.sin(angle) * r, cy - Math.cos(angle) * r];
}

function bezel(ctx, cx, cy, r) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.12);
    g.addColorStop(0, '#111');
    g.addColorStop(0.5, '#4a4d52');
    g.addColorStop(1, '#1c1d20');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0c0c0d';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
}

function caption(ctx, cx, cy, text, size = 16) {
    ctx.fillStyle = '#d4d6d9';
    ctx.font = `${size}px DejaVu Sans Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
}

// --- VOR ---------------------------------------------------------------------------

// Indicateur VOR (OBS / CDI) : rose graduée tournée pour afficher la route choisie en haut, aiguille d'écart
// (un point = 2°, butée = 10°), drapeau TO / FROM, drapeau NAV rouge sans signal, bouton OBS, indicatif et DME
function vorIndicator(ctx, cx, cy, r, vor) {
    bezel(ctx, cx, cy, r);
    const course = vor?.course ?? 0;
    // Rose graduée
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#e6e6e6';
    ctx.fillStyle = '#e6e6e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 5) {
        const a = deg(d - course);
        const long = d % 10 === 0;
        const [x1, y1] = polar(0, 0, r * 0.97, a), [x2, y2] = polar(0, 0, r * (long ? 0.85 : 0.9), a);
        ctx.lineWidth = long ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (d % 30 === 0) {
            const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] ?? String(d / 10);
            ctx.save();
            ctx.rotate(a);
            ctx.font = `bold ${Math.round(r * 0.17)}px DejaVu Sans Mono, monospace`;
            ctx.fillText(label, 0, -r * 0.72);
            ctx.restore();
        }
    }
    ctx.restore();
    // Repères de route : triangle en haut (route), petit en bas (réciproque)
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.84);
    ctx.lineTo(cx - r * 0.08, cy - r * 1.0);
    ctx.lineTo(cx + r * 0.08, cy - r * 1.0);
    ctx.fill();
    ctx.fillStyle = '#e6e6e6';
    ctx.fillRect(cx - 2, cy + r * 0.86, 4, r * 0.12);
    // Points de l'échelle d'écart
    const scale = r * 0.13;
    ctx.strokeStyle = '#e6e6e6';
    ctx.lineWidth = 2;
    for (let i = -5; i <= 5; i++) {
        if (i === 0) continue;
        ctx.beginPath();
        ctx.arc(cx + i * scale, cy + r * 0.05, 3.5, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.05, r * 0.08, 0, Math.PI * 2);
    ctx.stroke();

    const signal = vor?.available && !vor.overhead;
    if (signal) {
        // Aiguille d'écart de route
        const x = cx + vor.deviation * scale * 5;
        ctx.strokeStyle = '#f5f5f5';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, cy - r * 0.55);
        ctx.lineTo(x, cy + r * 0.62);
        ctx.stroke();
        // TO / FROM : triangle blanc vers le haut (TO) ou vers le bas (FROM)
        const fx = cx + r * 0.45, fy = cy - r * 0.32;
        ctx.fillStyle = '#f5f5f5';
        ctx.beginPath();
        if (vor.to) { ctx.moveTo(fx, fy - 12); ctx.lineTo(fx - 13, fy + 8); ctx.lineTo(fx + 13, fy + 8); }
        else { ctx.moveTo(fx, fy + 12); ctx.lineTo(fx - 13, fy - 8); ctx.lineTo(fx + 13, fy - 8); }
        ctx.fill();
        ctx.font = 'bold 11px DejaVu Sans Mono, monospace';
        ctx.fillText(vor.to ? 'TO' : 'FR', fx, fy + (vor.to ? 20 : -20));
    } else {
        // Drapeau NAV : pas de signal (hors de portée, ou à la verticale de la balise)
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(cx + r * 0.2, cy - r * 0.42, 52, 22);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px DejaVu Sans Mono, monospace';
        ctx.fillText('NAV', cx + r * 0.2 + 26, cy - r * 0.42 + 12);
    }
    // Route sélectionnée, indicatif, DME
    ctx.fillStyle = '#050505';
    ctx.fillRect(cx - 30, cy - r * 0.42 - 12, 60, 24);
    ctx.fillStyle = '#ffd34d';
    ctx.font = 'bold 18px DejaVu Sans Mono, monospace';
    ctx.fillText(String(Math.round(course)).padStart(3, '0'), cx, cy - r * 0.42);
    caption(ctx, cx, cy + r * 0.38, vor?.ident ? `${vor.ident} ${vor.frequency}` : 'VOR', 12);
    caption(ctx, cx + r * 0.25, cy + r * 1.24, signal ? `DME ${vor.dmeNM.toFixed(1)} NM` : 'VOR', 13);
    // Bouton OBS (moleté) : clic à gauche -1°, à droite +1°, molette ; touches J / K
    const kx = cx - r * 0.97, ky = cy + r, kr = Math.max(14, r * 0.32);
    ctx.fillStyle = '#2b2d31';
    ctx.beginPath();
    ctx.arc(kx, ky, kr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a8e94';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
        const [x1, y1] = polar(kx, ky, kr, i * Math.PI / 8), [x2, y2] = polar(kx, ky, kr - 4, i * Math.PI / 8);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.fillStyle = '#e6e6e6';
    ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('- OBS +', kx, ky);
}

// --- Vitres ----------------------------------------------------------------------------

// Verre légèrement teinté : presque invisible de face, de plus en plus réfléchissant aux angles rasants (Fresnel)
const glassShader = {
    vertexShader: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = -mvPosition.xyz;
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: /* glsl */`
        uniform vec3 uTint;
        uniform vec3 uReflect;
        uniform float uLight;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
            float facing = abs(dot(normalize(vNormal), normalize(vView)));
            float fresnel = pow(1.0 - facing, 3.0);
            vec3 color = mix(uTint * 0.6, uReflect, fresnel) * uLight;
            gl_FragColor = vec4(color, 0.07 + 0.38 * fresnel);
            #include <colorspace_fragment>
        }
    `,
};

// --- Aile vue de la cabine -------------------------------------------------------------
// Profil NACA 2412 (cambrure 2 % à 40 % de la corde, épaisseur 12 %) extrudé sur l'envergure, centré en x = 0.
// Bord d'attaque arrondi (normales lissées le long du profil), extrémités fermées.
function wingGeometry({ span, chord, leadingEdge, y, points = 24 }) {
    const m = 0.02, p = 0.4, t = 0.12;
    const surface = (x, upper) => {
        const camber = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x);
        const slope = Math.atan(x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) ** 2) * (p - x));
        const thickness = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
        const sign = upper ? 1 : -1;
        return [x - sign * thickness * Math.sin(slope), camber + sign * thickness * Math.cos(slope)];
    };
    // Contour fermé (z, y) : extrados du bord de fuite au bord d'attaque, puis intrados ; points resserrés au bord d'attaque
    const outline = [];
    for (let i = points; i >= 0; i--) outline.push(surface((1 - Math.cos(Math.PI * i / points)) / 2, true));
    for (let i = 1; i < points; i++) outline.push(surface((1 - Math.cos(Math.PI * i / points)) / 2, false));
    const profile = outline.map(([x, h]) => [leadingEdge + x * chord, y + h * chord]);
    const n = profile.length, half = span / 2;
    const position = [], normal = [], index = [];
    // Flancs : deux vertices par point du profil (un à chaque saumon), normale perpendiculaire au contour
    profile.forEach(([z, h], i) => {
        const [z0, h0] = profile[(i - 1 + n) % n], [z1, h1] = profile[(i + 1) % n];
        const length = Math.hypot(z1 - z0, h1 - h0) || 1;
        for (const x of [-half, half]) {
            position.push(x, h, z);
            normal.push(0, -(z1 - z0) / length, (h1 - h0) / length);
        }
    });
    for (let i = 0; i < n; i++) {
        const a0 = i * 2, a1 = a0 + 1, b0 = ((i + 1) % n) * 2, b1 = b0 + 1;
        index.push(a0, a1, b0, a1, b1, b0);
    }
    // Saumons : éventail depuis le centre du profil
    const center = profile.reduce(([sz, sh], [z, h]) => [sz + z / n, sh + h / n], [0, 0]);
    for (const [x, nx] of [[-half, -1], [half, 1]]) {
        const start = position.length / 3;
        position.push(x, center[1], center[0]);
        normal.push(nx, 0, 0);
        for (const [z, h] of profile) {
            position.push(x, h, z);
            normal.push(nx, 0, 0);
        }
        for (let i = 0; i < n; i++) {
            const a = start + 1 + i, b = start + 1 + (i + 1) % n;
            if (nx > 0) index.push(start, b, a);
            else index.push(start, a, b);
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
    geometry.setIndex(index);
    return geometry;
}

// --- Pluie sur le pare-brise ---------------------------------------------------------

const windshieldShader = {
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform float uTime;
        uniform float uIntensity;
        uniform float uSpeed;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

        // Une couche de gouttes : une goutte (ou rien) par case, poussée vers le haut par le vent relatif
        float drops(vec2 uv, float scale, float t, float seed) {
            vec2 grid = vec2(scale * 2.4, scale);
            vec2 g = uv * grid;
            float column = floor(g.x);
            g.y -= t * (0.3 + hash(vec2(column, seed)) * 0.7) * (0.05 + uSpeed * 0.12);
            vec2 id = floor(g);
            vec2 f = fract(g) - 0.5;
            vec2 offset = vec2(hash(id + seed), hash(id + seed + 4.1)) - 0.5;
            vec2 d = (f - offset * 0.6) * vec2(1.0, 1.0 / (1.0 + uSpeed * 0.08));
            float size = 0.05 + 0.08 * hash(id + seed + 9.3);
            float l = length(d);
            // Goutte : bord plus marqué que le centre (effet de lentille)
            float body = smoothstep(size, size * 0.6, l);
            float rim = body * smoothstep(size * 0.2, size * 0.9, l);
            return (0.35 * body + 0.65 * rim) * step(0.7, hash(id + seed + 2.7));
        }

        void main() {
            float d = max(drops(vUv, 7.0, uTime, 1.0), drops(vUv, 12.0, uTime * 1.3, 7.0) * 0.7);
            gl_FragColor = vec4(vec3(0.75, 0.8, 0.86), (0.06 + d * 0.3) * uIntensity);
            #include <colorspace_fragment>
        }
    `,
};

// --- Manche (yoke) du Cessna 172 SP -----------------------------------------------------
// Volant en « cornes de bélier » d'après le schéma : cadre en U extrudé et arrondi, deux ouvertures de part et
// d'autre du moyeu, poignées inclinées au bout des cornes. Coordonnées en px du schéma (1 557 px/m), centre du moyeu.
const YOKE_OUTER = [[0, 146], [180, 142], [262, 120], [296, 78], [292, 25], [266, -40], [228, -100], [212, -140], [206, -172],
    [172, -180], [148, -150], [134, -112], [98, -100]];
const YOKE_OPENING = [[92, -78], [128, -78], [148, -44], [176, 14], [200, 56], [192, 74], [92, 74]];

const YOKE_SCALE = 0.85;          // un peu plus petit que sur le schéma (largeur 32 cm, comme le vrai)

function yokeGeometry() {
    const k = YOKE_SCALE / 1557;
    const shape = new Shape();
    const outline = [...YOKE_OUTER, ...YOKE_OUTER.slice().reverse().map(([x, y]) => [-x, y])];
    outline.forEach(([x, y], i) => (i ? shape.lineTo(x * k, -y * k) : shape.moveTo(x * k, -y * k)));
    for (const side of [-1, 1]) {
        const hole = new Path();
        const points = side > 0 ? YOKE_OPENING : YOKE_OPENING.slice().reverse();
        points.forEach(([x, y], i) => (i ? hole.lineTo(side * x * k, -y * k) : hole.moveTo(side * x * k, -y * k)));
        shape.holes.push(hole);
    }
    const geometry = new ExtrudeGeometry(shape, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.007, bevelSegments: 4, curveSegments: 8 });
    geometry.translate(0, 0, -0.013);
    return geometry;
}

// Logo du moyeu (Skyhawk SP)
function yokeLogo() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1c';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#5a5c60';
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SKYHAWK', 128, 84);
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillText('SP', 128, 112);
    ctx.fillRect(112, 14, 32, 38);
    ctx.fillStyle = '#1a1a1c';
    ctx.fillRect(118, 20, 8, 26);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

function knurlTexture(light, dark, count = 28) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < count; i++) {
        const x = (i / count) * 256, g = ctx.createLinearGradient(x, 0, x + 256 / count, 0);
        g.addColorStop(0, light);
        g.addColorStop(0.5, dark);
        g.addColorStop(1, light);
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 256 / count, 8);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    return texture;
}

// --- Cabine ------------------------------------------------------------------------

class Cockpit {
    constructor() {
        this.group = new Group();
        this.eye = EYE.clone();
        this._time = 0;
        this._smooth = { pitch: 0, roll: 0, yaw: 0, rpm: 0, slip: 0, vs: 0, oilTemp: 0 };
        this._night = 0;
        this._gyro = null;
        this.clickables = [];                         // surfaces et boutons cliquables (voir controlAt)
        this._hotspots = {};

        const plastic = new MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.85 });
        const frame = new MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.7 });
        const headliner = new MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.95 });
        const seat = new MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 });
        const paint = new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
        const black = new MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
        const yokeBlack = new MeshStandardMaterial({ color: 0x232326, roughness: 0.38, metalness: 0.15 });

        const add = (mesh, x, y, z) => {
            mesh.position.set(x, y, z);
            this.group.add(mesh);
            return mesh;
        };

        // Tableau de bord, casquette, instruments, radios (Panel172)
        this.panel = new Panel172(this.group);
        this.clickables.push(...this.panel.clickables);
        // Planche inclinée de l'avant de la casquette jusqu'au bas du pare-brise du modèle extérieur
        // (y -0,24 / z -1,36 dans ce repère) : comble le vide vu à travers le pare-brise depuis l'extérieur
        const deck = add(new Mesh(new BoxGeometry(1.3, 0.02, 0.43), plastic), 0, -0.17, -1.19);
        deck.rotation.x = -Math.atan2(0.2, 0.38);
        add(new Mesh(new BoxGeometry(1.26, 0.42, 0.2), plastic), 0, -0.71, -0.86);   // bas du tableau (devant les genoux)
        const trim = new MeshStandardMaterial({ color: 0x8e877a, roughness: 0.9 });      // garnitures de porte
        const carpet = new MeshStandardMaterial({ color: 0x2c2a28, roughness: 1 });
        add(new Mesh(new BoxGeometry(1.3, 0.02, 2.1), carpet), 0, -0.9, 0.2);         // plancher (moquette)
        add(new Mesh(new BoxGeometry(1.3, 0.05, 1.6), headliner), 0, 0.385, 0.38);   // plafond
        add(new Mesh(new BoxGeometry(1.3, 1.3, 0.04), headliner), 0, -0.25, 1.2);    // cloison arrière
        add(new Mesh(new BoxGeometry(1.1, 0.12, 0.42), seat), 0, -0.6, 0.95);         // banquette arrière
        add(new Mesh(new BoxGeometry(1.1, 0.5, 0.08), seat), 0, -0.32, 1.14);

        // Vitres : pare-brise, vitres de porte et vitres arrière (verre teinté, reflets aux angles rasants)
        this._glassMaterial = new ShaderMaterial({
            uniforms: { uTint: { value: new Color(0x9ec3cf) }, uReflect: { value: new Color(0xdfe9f2) }, uLight: { value: 1 } },
            vertexShader: glassShader.vertexShader,
            fragmentShader: glassShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
        });
        // Contour d'une vitre latérale dans le plan (z, y), posée à la position x
        const sideGlass = (x, outline) => {
            const glass = new Mesh(new ShapeGeometry(new Shape(outline.map(([z, y]) => new Vector2(z, y)))), this._glassMaterial);
            glass.geometry.rotateY(-Math.PI / 2); // plan (z, y) -> repère cabine
            glass.position.x = x;
            glass.renderOrder = 2;
            this.group.add(glass);
        };

        for (const side of [-1, 1]) {
            // Portes : garniture, accoudoir, poignée
            add(new Mesh(new BoxGeometry(0.04, 0.6, 1.95), trim), side * 0.65, -0.6, 0.2);
            add(new Mesh(new BoxGeometry(0.08, 0.05, 0.55), plastic), side * 0.6, -0.4, 0.1);
            add(new Mesh(new BoxGeometry(0.03, 0.03, 0.14), frame), side * 0.615, -0.33, -0.3);
            // Montants de pare-brise, de porte, encadrements de vitre (bas et haut)
            this._beam(new Vector3(side * 0.6, -0.05, -0.98), new Vector3(side * 0.62, 0.37, -0.42), 0.06, frame);
            this._beam(new Vector3(side * 0.64, -0.3, 0.68), new Vector3(side * 0.62, 0.37, 0.78), 0.06, frame);
            this._beam(new Vector3(side * 0.64, -0.3, -0.78), new Vector3(side * 0.64, -0.3, 1.18), 0.04, frame);
            this._beam(new Vector3(side * 0.63, 0.36, -0.42), new Vector3(side * 0.63, 0.36, 1.18), 0.04, frame);
            this._beam(new Vector3(side * 0.6, -0.05, -0.98), new Vector3(side * 0.64, -0.3, -0.78), 0.04, frame);
            sideGlass(side * 0.645, [[-0.78, -0.3], [0.66, -0.3], [0.76, 0.36], [-0.42, 0.36], [-0.97, -0.05]]);
            sideGlass(side * 0.645, [[0.8, -0.3], [1.18, -0.3], [1.18, 0.36], [0.8, 0.36]]);
            // Hauban d'aile
            this._beam(new Vector3(side * 0.66, -0.78, 0.15), new Vector3(side * 2.7, 0.38, 0.4), 0.05, paint);
            // Sièges avant
            add(new Mesh(new BoxGeometry(0.46, 0.1, 0.48), seat), side * 0.3, -0.62, 0.3);
            const back = add(new Mesh(new BoxGeometry(0.46, 0.65, 0.09), seat), side * 0.3, -0.27, 0.6);
            back.rotation.x = -0.18;
        }
        // Pas de montant central : le pare-brise du Cessna 172 est d'un seul tenant
        // Aile haute posée sur le toit, d'un saumon à l'autre, bord d'attaque au-dessus du haut du pare-brise
        // (comme sur un Cessna), vue par les vitres latérales : profil arrondi NACA 2412, celui du vrai Cessna 172
        this.group.add(new Mesh(wingGeometry({ span: 11.1, chord: 1.7, leadingEdge: -0.43, y: 0.45 }), paint));

        // Manches : la colonne coulisse dans son passage du tableau (poussé / tiré), le volant tourne
        const yokeShape = yokeGeometry();
        const logo = new MeshStandardMaterial({ map: yokeLogo(), roughness: 0.5 });
        const chromeShaft = new MeshStandardMaterial({ color: 0xb8bbbf, metalness: 0.85, roughness: 0.3 });
        this._yokeClickables = [];
        this.yokesVisible = true;
        this._yokes = PANEL_LAYOUT.yokes.map(({ x, y }, index) => {
            const column = new Group();
            const base = panelPoint(x, y);
            column.position.set(base.x, base.y, PANEL_FACE_Z);
            // Colonne chromée : dépasse de 16 cm au neutre, le reste est caché dans le tableau
            const shaft = new Mesh(new CylinderGeometry(0.0145, 0.0145, 0.42, 16), chromeShaft);
            shaft.rotation.x = Math.PI / 2;
            shaft.position.z = YOKE_OUT - 0.21;
            const wheel = new Group();
            wheel.position.z = YOKE_OUT;
            const frameMesh = new Mesh(yokeShape, yokeBlack);
            // Moyeu : bloc arrondi devant le cadre, logo
            const k = YOKE_SCALE;
            const hub = new Mesh(new RoundedBoxGeometry(0.09, 0.115, 0.05, 4, 0.012), yokeBlack);
            hub.position.set(0, -0.005, 0.012);
            const logoPlate = new Mesh(new CircleGeometry(0.026, 32), logo);
            logoPlate.scale.set(1, 0.55, 1);
            logoPlate.position.set(0, -0.04, 0.0375);
            wheel.add(frameMesh, hub, logoPlate);
            // Poignées au bout des cornes (arrondies, inclinées vers l'extérieur)
            const gripGeometry = new RoundedBoxGeometry(0.032, 0.042, 0.038, 4, 0.01);
            for (const side of [-1, 1]) {
                const grip = new Mesh(gripGeometry, yokeBlack);
                grip.position.set(side * 0.162 * k, 0.15 * k, 0.004);
                grip.rotation.z = -side * 0.42;
                wheel.add(grip);
            }
            // Manche gauche : bouton rouge (déconnexion du pilote automatique) et interrupteur de trim électrique
            if (index === 0) {
                const red = new Mesh(new CylinderGeometry(0.004, 0.004, 0.006, 12), new MeshStandardMaterial({ color: 0xd8241b, roughness: 0.4 }));
                red.position.set(-0.155 * k, 0.178 * k, 0.012);
                const rocker = new Mesh(new BoxGeometry(0.01, 0.016, 0.008), new MeshStandardMaterial({ color: 0xbfc1c4, metalness: 0.6, roughness: 0.35 }));
                rocker.position.set(-0.17 * k, 0.155 * k, 0.025);
                rocker.rotation.z = 0.42;
                wheel.add(red, rocker);
            }
            // Clic sur un manche : on le cache (pour voir le bas du tableau), clic sur son passage : il revient
            column.userData.control = 'yokes';
            column.traverse((child) => { if (child.isMesh) this._yokeClickables.push(child); });
            column.add(shaft, wheel);
            this.group.add(column);
            return { column, wheel, z: PANEL_FACE_Z };
        });

        // Manette des gaz (gros bouton gris moleté) et de mixture (rouge, crantée) : tirées vers le pilote = réduit /
        // appauvri ; une tige les relie au tableau
        const rodMaterial = new MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 });
        const lever = (layout, control, build) => {
            const group = new Group();
            const p = panelPoint(layout.x, layout.y);
            group.position.set(p.x, p.y, PANEL_FACE_Z);
            const rod = new Mesh(new CylinderGeometry(0.005, 0.005, 0.12, 8), rodMaterial);
            rod.rotation.x = Math.PI / 2;
            rod.position.z = -0.06;
            const knob = build();
            for (const child of [rod, knob]) child.userData.control = control;
            knob.traverse((child) => { if (child.isMesh) this.clickables.push(child); });
            group.add(rod, knob);
            group.userData.control = control;
            this.group.add(group);
            // Bague de friction autour du passage
            const ring = new Mesh(new TorusGeometry(panelLength(40), 0.003, 8, 32), black);
            ring.position.set(p.x, p.y, PANEL_FACE_Z + 0.002);
            this.group.add(ring);
            return group;
        };
        this._throttle = lever(PANEL_LAYOUT.throttle, 'throttle', () => {
            const knob = new Group();
            const body = new Mesh(new CylinderGeometry(0.019, 0.019, 0.022, 32), new MeshStandardMaterial({ map: knurlTexture('#c9cbce', '#55575b'), metalness: 0.5, roughness: 0.35 }));
            body.rotation.x = Math.PI / 2;
            body.position.z = 0.011;
            const cap = new Mesh(new CylinderGeometry(0.0165, 0.0165, 0.002, 32), new MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.6, roughness: 0.3 }));
            cap.rotation.x = Math.PI / 2;
            cap.position.z = 0.023;
            knob.add(body, cap);
            return knob;
        });
        this._mixture = lever(PANEL_LAYOUT.mixture, 'mixture', () => {
            const knob = new Group();
            const red = new MeshStandardMaterial({ color: 0xd2321f, roughness: 0.45, flatShading: true });
            const cog = new Mesh(new CylinderGeometry(0.024, 0.024, 0.016, 12), red);
            cog.rotation.x = Math.PI / 2;
            cog.position.z = 0.008;
            const dome = new Mesh(new CylinderGeometry(0.014, 0.016, 0.012, 24), new MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.6, roughness: 0.3 }));
            dome.rotation.x = Math.PI / 2;
            dome.position.z = 0.02;
            knob.add(cog, dome);
            return knob;
        });

        // Frein de parking : poignée sous le tableau, à gauche ; tirée vers le pilote = serré
        this._brakeLever = new Group();
        const bp = panelPoint(PANEL_LAYOUT.brake.x, PANEL_LAYOUT.brake.y);
        this._brakeLever.position.set(bp.x, bp.y, PANEL_FACE_Z);
        const brakeStem = new Mesh(new CylinderGeometry(0.005, 0.005, 0.08, 8), rodMaterial);
        brakeStem.rotation.x = Math.PI / 2;
        brakeStem.position.z = -0.03;
        const brakeHandle = new Mesh(new BoxGeometry(0.12, 0.024, 0.016), new MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5 }));
        brakeHandle.position.z = 0.012;
        brakeHandle.geometry.translate(0.02, 0, 0);
        this._brakeLever.add(brakeStem, brakeHandle);
        this._brakeLever.userData.control = 'brake';
        this.group.add(this._brakeLever);
        this.clickables.push(brakeHandle, brakeStem);

        // Pupitre central (molette de trim, robinet carburant) et sélecteur de réservoir au plancher
        this._sideMaterials = [];
        const canvasPlane = (spec, name) => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(spec.width * PX_PER_M);
            canvas.height = Math.round(spec.height * PX_PER_M);
            const texture = new CanvasTexture(canvas);
            texture.colorSpace = SRGBColorSpace;
            texture.anisotropy = 8;
            const material = new MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.6 });
            this._sideMaterials.push(material);
            const mesh = new Mesh(new PlaneGeometry(spec.width, spec.height), material);
            mesh.userData.surface = name;
            this.clickables.push(mesh);
            this._hotspots[name] = new Hotspots();
            return { mesh, ctx: canvas.getContext('2d'), texture };
        };
        add(new Mesh(new BoxGeometry(0.22, PEDESTAL.height, 0.16), plastic), 0, PEDESTAL.y, PEDESTAL.z - 0.082);
        this._pedestal = canvasPlane(PEDESTAL, 'pedestal');
        add(this._pedestal.mesh, PEDESTAL.x, PEDESTAL.y, PEDESTAL.z);
        this._fuelPlate = canvasPlane(FUEL_PLATE, 'fuel');
        this._fuelPlate.mesh.rotation.x = -Math.PI / 2;
        add(this._fuelPlate.mesh, FUEL_PLATE.x, FUEL_PLATE.y, FUEL_PLATE.z);

        // Commandes en 3D du sous-panneau, du pupitre et du plancher
        const pixel = (spec, cx, cy) => new Vector3(spec.x - spec.width / 2 + cx / PX_PER_M, spec.y + spec.height / 2 - cy / PX_PER_M, spec.z);
        this._controls3D = new Controls3D(this.group, {
            panelPoint,
            px: panelLength,
            layout: PANEL_LAYOUT,
            pedestalPoint: (cx, cy) => pixel(PEDESTAL, cx, cy),
            floorPoint: (cx, cy) => new Vector3(FUEL_PLATE.x - FUEL_PLATE.width / 2 + cx / PX_PER_M, FUEL_PLATE.y,
                FUEL_PLATE.z - FUEL_PLATE.height / 2 + cy / PX_PER_M),
            pedestalLayout: PEDESTAL_LAYOUT,
        });
        this._controls3D.finalize();
        this.clickables.push(...this._controls3D.clickables);
        this._baseClickables = this.clickables;
        this.clickables = [...this._baseClickables, ...this._yokeClickables];

        // Pare-brise : film d'eau et gouttes en cas de pluie
        const start = new Vector3(0, -0.05, -0.98), end = new Vector3(0, 0.37, -0.42);
        this.windshieldMaterial = new ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uSpeed: { value: 0 } },
            vertexShader: windshieldShader.vertexShader,
            fragmentShader: windshieldShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
        });
        this._windshield = new Mesh(new PlaneGeometry(1.2, start.distanceTo(end)), this.windshieldMaterial);
        this._windshield.position.copy(start).add(end).multiplyScalar(0.5);
        this._windshield.rotation.x = Math.atan2(end.z - start.z, end.y - start.y);
        this._windshield.visible = false;
        this._windshield.renderOrder = 3;
        this.group.add(this._windshield);
        const windshieldGlass = new Mesh(this._windshield.geometry, this._glassMaterial);
        windshieldGlass.position.copy(this._windshield.position);
        windshieldGlass.rotation.copy(this._windshield.rotation);
        windshieldGlass.renderOrder = 2;
        this.group.add(windshieldGlass);

        // Éléments de la vue cabine seulement : en vue extérieure, la coque du modèle les remplace
        // (aile, haubans, montants, plafond, cloison, vitres et pluie dépasseraient de la coque ou feraient doublon)
        const cabinOnly = new Set([headliner, paint, this._glassMaterial, this.windshieldMaterial]);
        this.group.traverse((child) => {
            child.castShadow = false;
            child.receiveShadow = true; // la coque fait de l'ombre à l'intérieur en vue extérieure
            if (cabinOnly.has(child.material)) child.userData.cabinOnly = true;
        });
        // Pièces fixes fusionnées par matériau (même image, bien moins d'appels de dessin) ; restent à part ce qui
        // bouge ou se clique : manches, gaz, mixture, frein, commandes 3D, instruments, pare-brise, surfaces cliquables
        const dynamic = new Set([this._throttle, this._mixture, this._brakeLever, this._windshield,
            ...this._yokes.map((yoke) => yoke.column), ...(this._controls3D._roots ?? []), ...this.panel.dynamic, ...this.clickables]);
        // Instruments : aiguilles, roses et maquettes bougent ; leurs boîtiers (enfants fixes) restent groupés
        const moving = new Set([...this.clickables, ...this._yokeClickables]);
        mergeStatic(this.group, (node) => dynamic.has(node) || moving.has(node) || node.renderOrder > 0 || this._isInstrument(node));
    }

    // Boîtier d'instrument (groupe à part : ses aiguilles et cartes bougent)
    _isInstrument(node) {
        return Object.values(this.panel._p).some((part) => part?.root === node || part?.inst?.root === node);
    }

    // Manches visibles ou cachés (pour voir et toucher le bas du tableau, comme dans les simulateurs du commerce)
    setYokesVisible(visible) {
        this.yokesVisible = visible;
        for (const yoke of this._yokes) yoke.column.visible = visible;
        this.clickables = visible ? [...this._baseClickables, ...this._yokeClickables] : this._baseClickables;
    }

    // exterior : vue extérieure (on voit l'intérieur à travers les vitres du modèle)
    setExterior(exterior) {
        this._exterior = exterior;
        this.group.traverse((child) => {
            if (child.userData.cabinOnly) child.visible = !exterior;
        });
        if (!exterior) this._windshield.visible = this.windshieldMaterial.uniforms.uIntensity.value > 0;
    }

    // Poutre de section carrée entre deux points (montants, haubans)
    _beam(a, b, thickness, material) {
        const length = a.distanceTo(b);
        const mesh = new Mesh(new BoxGeometry(thickness, length, thickness), material);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()));
        mesh.userData.cabinOnly = true; // montants, encadrements, haubans : structure propre à la vue cabine
        this.group.add(mesh);
        return mesh;
    }

    // night : 0 = jour, 0,5 = tempête, 1 = nuit
    setNight(night) {
        this._night = night;
        this._glassMaterial.uniforms.uLight.value = 1 - 0.8 * night; // reflets du ciel bien plus faibles la nuit
    }

    // Commande sous un point touché par un rayon (intersection three.js avec this.clickables) :
    // { id, side (-1 gauche / 1 droite), vertical (-1 haut / 1 bas) } ou null
    controlAt(hit) {
        // Pièce 3D : la commande est portée par la pièce ou un de ses parents ; côté cliqué par rapport à son centre
        let root = hit.object;
        while (root && !root.userData.control && root !== this.group) root = root.parent;
        if (root?.userData.control) {
            const point = this.group.worldToLocal(hit.point.clone());
            const center = this.group.worldToLocal(root.getWorldPosition(new Vector3()));
            return { id: root.userData.control, side: point.x < center.x ? -1 : 1, vertical: point.y > center.y ? -1 : 1 };
        }
        const surface = hit.object.userData.surface;
        if (!surface || !hit.uv) return null;
        const canvas = this[surface === 'pedestal' ? '_pedestal' : '_fuelPlate'].ctx.canvas;
        return this._hotspots[surface].at(hit.uv.x * canvas.width, (1 - hit.uv.y) * canvas.height);
    }

    // Pupitre et sélecteur de réservoir : redessinés (et renvoyés à la carte graphique) seulement quand ce
    // qu'ils affichent change (trim, robinet, réservoir)
    _drawPedestal(state) {
        const trim = { deg: state.trim, min: state.trimLimits[0], max: state.trimLimits[1], takeoff: state.takeoffTrim };
        const p = this._pedestal, f = this._fuelPlate, sys = state.systems;
        const pedestalKey = `${trim.deg.toFixed(2)}|${trim.min}|${trim.max}|${trim.takeoff}|${sys.fuelShutoff}`;
        if (pedestalKey !== this._pedestalKey) {
            this._pedestalKey = pedestalKey;
            this._hotspots.pedestal.clear();
            drawPedestal(p.ctx, this._hotspots.pedestal, p.ctx.canvas.width, p.ctx.canvas.height, sys, trim);
            p.texture.needsUpdate = true;
        }
        if (sys.fuelSelector !== this._fuelKey) {
            this._fuelKey = sys.fuelSelector;
            this._hotspots.fuel.clear();
            drawFuelSelector(f.ctx, this._hotspots.fuel, f.ctx.canvas.width, f.ctx.canvas.height, sys);
            f.texture.needsUpdate = true;
        }
    }

    setRain(intensity) {
        this.windshieldMaterial.uniforms.uIntensity.value = intensity;
        this._windshield.visible = intensity > 0 && !this._exterior;
    }

    // state : valeurs de PlaneControls, des systèmes et des radios (voir simulator.js)
    update(delta, state) {
        this._time += delta;
        const s = this._smooth, sys = state.systems;
        const k = 1 - Math.exp(-10 * delta);
        s.pitch += (state.inputs.pitch - s.pitch) * k;
        s.roll += (state.inputs.roll - s.roll) * k;
        s.yaw += (state.inputs.yaw - s.yaw) * k;
        s.rpm += ((state.crashed ? 0 : sys.rpm) - s.rpm) * (1 - Math.exp(-6 * delta));
        s.slip += (-s.yaw * 0.6 - s.slip) * (1 - Math.exp(-4 * delta));
        s.vs += (state.verticalSpeed - s.vs) * (1 - Math.exp(-2 * delta));   // variomètre : un peu de retard
        s.oilTemp += ((sys.running ? 0.62 : 0) - s.oilTemp) * (1 - Math.exp(-delta / 90));

        for (const yoke of this._yokes) {
            yoke.column.position.z = yoke.z + s.pitch * YOKE_TRAVEL;   // tiré vers le pilote pour cabrer
            yoke.wheel.rotation.z = s.roll * YOKE_TURN;                // volant tourné jusqu'à 90°
        }
        this._throttle.position.z = PANEL_FACE_Z + 0.004 + (1 - state.throttle) * 0.08;
        this._mixture.position.z = PANEL_FACE_Z + 0.004 + (1 - sys.mixture) * 0.08;
        this._controls3D.update({ systems: sys, flapLevel: state.flapLevel, flaps: state.flaps, trim: state.trim }, k);
        // Frein de parking : poignée tirée quand il est serré
        this._brakeLever.position.z += ((state.parkingBrake ? 0.05 : 0) + PANEL_FACE_Z - this._brakeLever.position.z) * k;
        // Éclairage des instruments : rhéostat, alimentation électrique ; ambré la nuit
        const intensity = 0.12 + (0.38 + 0.4 * this._night) * sys.panelLighting;
        const emissive = WHITE.clone().lerp(PANEL_NIGHT_LIGHT, Math.min(1, this._night * 2));
        this.panel.setLighting(emissive, intensity, this._night);
        for (const material of this._sideMaterials) material.emissiveIntensity = intensity;

        const u = this.windshieldMaterial.uniforms;
        u.uTime.value = this._time;
        u.uSpeed.value = state.speed;

        // Gyroscopes entraînés par la dépression (pompe du moteur) : figés moteur arrêté
        if (sys.vacuum || !this._gyro) this._gyro = { roll: state.roll, pitch: state.pitchDeg + state.avionics.aiOffset * 0.8, heading: state.heading };
        const powered = sys.gaugesPowered;
        const amp = !sys.busPowered ? 0.5 : sys.alternatorOn ? 0.56 + (1 - sys.battery) * 0.3 : 0.38;
        this.panel.update(delta, {
            ...state,
            speedKt: state.speed * KT,
            altitudeFt: state.altitude * FT,
            vsFpm: s.vs * FT * 60,
            rpm: s.rpm,
            gyro: this._gyro,
            turnRate: sys.turnCoordinatorPowered ? MathUtils.clamp(state.roll, -deg(35), deg(35)) * 0.6 : 0,
            slip: s.slip,
            engine: {
                fuelL: powered ? sys.fuel[0] / TANK_CAPACITY : 0,
                fuelR: powered ? sys.fuel[1] / TANK_CAPACITY : 0,
                egt: powered && sys.running ? Math.min(0.95, 0.25 + 0.35 * state.throttle + 0.6 * Math.max(0, 1 - sys.mixture)) : 0,
                ff: powered ? sys.fuelFlow / 19 : 0,
                oilT: powered ? s.oilTemp : 0,
                oilP: powered && sys.running ? 0.3 + 0.45 * Math.min(1, s.rpm / 2400) : 0,
                vac: sys.vacuum ? 0.5 + Math.min(0.05, s.rpm / 60000) : 0,
                amp,
            },
        });

        // Pupitre : redessiné quand il change
        this._drawPedestal(state);
    }
}

export { Cockpit, vorIndicator };
