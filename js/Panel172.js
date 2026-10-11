import {
    BoxGeometry,
    CanvasTexture,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    ExtrudeGeometry,
    Group,
    LatheGeometry,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Path,
    PlaneGeometry,
    RepeatWrapping,
    ShaderMaterial,
    Shape,
    SRGBColorSpace,
    Vector2,
    Vector3
} from 'three';
import { BREAKERS, AVIONICS_BREAKERS, TOGGLES } from './Systems.js';
import { XPDR_MODES, DAVTRON_TOP, DAVTRON_BOTTOM, formatCom, formatNav } from './Avionics.js';
import {
    ATLAS_SIZE, CELLS, SPRITES, ATLAS_RADIUS, AI_PX_PER_R, PLATES, PLATE_SCALE, FACE, DISPLAY,
    asiAngle, vsiAngle, tachAngle, halfAngle, drawAtlas, drawPlates, drawFace, drawDisplays
} from './InstrumentArt.js';

// Tableau de bord du Cessna 172 en 3D, d'après le schéma de référence (Cessna 172, Cockpit Revolution) :
// tôle grise découpée et sous-panneau noir, casquette, instruments ronds en retrait derrière leur vitre (cadrans,
// roses et aiguilles en relief), pile radio (audio, deux NAV/COM, DME, transpondeur), compas magnétique,
// boutons et interrupteurs. Les positions sont celles du schéma, en px de l'image (2394 x 1765) : 2 030 px par mètre.

const S = 2030;                 // px du schéma par mètre (tableau de 0,92 m, celui du Cessna 172 FlightGear)
const X0 = 1344, Y0 = 195;      // milieu du tableau, haut du tableau (px)
const TOP = -0.1;               // haut du tableau (repère cabine)
const FACE_Z = -0.75;           // face du tableau
const SHEET = 0.004;            // épaisseur de la tôle
const m = (px) => px / S;
const deg = (d) => d * Math.PI / 180;

// Point du schéma -> repère cabine (dz : vers le pilote)
function at(ax, ay, dz = 0) {
    return new Vector3((ax - X0) / S, TOP - (ay - Y0) / S, FACE_Z + dz);
}

// Positions des instruments et commandes (px du schéma)
const BIG = { hole: 71, dial: 61, depth: 0.012 };
const SMALL = { hole: 56, dial: 47, depth: 0.01 };
const LAYOUT = {
    instruments: {
        asi: [765, 333], ai: [938, 333], alt: [1110, 333], vor1: [1278, 333],
        tc: [765, 515], dg: [938, 515], vsi: [1110, 515], vor2: [1278, 515],
        tach: [1110, 704], adf: [1278, 704],
        davtron: [607, 343], fuel: [491, 493], egt: [612, 493], oil: [491, 637], vac: [612, 637],
    },
    avionicsBreakers: AVIONICS_BREAKERS.map((b, i) => ({ ...b, x: 470 + i * 42.3, y: 787 })),
    mags: { x: 468, y: 928 },
    master: { x: 558, y: 928 },
    breakers: BREAKERS.map((b, i) => ({ ...b, x: [626, 665, 704, 742, 781, 820, 859, 949, 985][i], y: 886 })),
    toggles: TOGGLES.map((t, i) => ({ ...t, x: 626 + i * 38.9, y: 958 })),
    avionics: { x: 895, y: 926 },
    altStatic: { x: 1129, y: 899 },
    panelLights: { x: 1030, y: 966 },
    ga: { x: 1275, y: 933 },
    throttle: { x: 1338, y: 967 },
    mixture: { x: 1449, y: 967 },
    flaps: { scaleX: 1636, slotX: 1690, top: 875, step: 30 },
    cabinAir: { x: 1852, y: 889 },
    cabinHeat: { x: 1852, y: 956 },
    glovebox: { x0: 1939, y0: 853, x1: 2225, y1: 987 },
    elt: { x: 1972, y: 326 },
    hobbs: { x: 2062, y: 333 },
    annunciator: { x0: 1000, y0: 213, x1: 1162, y1: 247 },
    stack: { x0: 1378, y0: 300, x1: 1678, y1: 757 },
    yokes: [{ x: 930, y: 700 }, { x: 1767, y: 700 }],
    brake: { x: 716, y: 1046 },
};

// Contour du tableau (px, y vers le haut) : coins supérieurs arrondis sous la casquette, bossage central en bas
function panelOutline(shape) {
    shape.moveTo(730, -195);
    shape.lineTo(1958, -195);
    shape.absellipse(1958, -425, 320, 230, Math.PI / 2, 0, true);
    shape.lineTo(2278, -1015);
    shape.lineTo(1556, -1015);
    shape.lineTo(1500, -1071);
    shape.lineTo(1193, -1071);
    shape.lineTo(1137, -1015);
    shape.lineTo(410, -1015);
    shape.lineTo(410, -425);
    shape.absellipse(730, -425, 320, 230, Math.PI, Math.PI / 2, true);
    return shape;
}

// Géométrie en px du schéma -> mètres, face avant à FACE_Z + front ; uv de la face du tableau
function toCabin(geometry, front, depthPx) {
    const position = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i);
        uv.setXY(i, (x - FACE.x0) / FACE.width, 1 - (-y - FACE.y0) / FACE.height);
    }
    geometry.translate(-X0, Y0, -depthPx);
    geometry.scale(1 / S, 1 / S, 1 / S);
    geometry.translate(0, TOP, FACE_Z + front);
    return geometry;
}

// uv d'une géométrie (0 -> 1) ramenés à une zone de l'atlas (px, y vers le bas)
function mapUV(geometry, region, size = ATLAS_SIZE, height = size) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (region.x + uv.getX(i) * region.w) / size, 1 - (region.y + (1 - uv.getY(i)) * region.h) / height);
    }
    return geometry;
}

function zCylinder(r, length, material, segments = 24) {
    const geometry = new CylinderGeometry(r, r, length, segments);
    geometry.rotateX(Math.PI / 2);
    return new Mesh(geometry, material);
}

function knurlTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 32; i++) {
        const g = ctx.createLinearGradient(i * 8, 0, i * 8 + 8, 0);
        g.addColorStop(0, '#9a9da2');
        g.addColorStop(0.5, '#2a2b2e');
        g.addColorStop(1, '#9a9da2');
        ctx.fillStyle = g;
        ctx.fillRect(i * 8, 0, 8, 8);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    return texture;
}

// Vitre d'instrument : presque invisible de face, reflet du ciel aux angles rasants et léger reflet en biais
const instrumentGlass = new ShaderMaterial({
    uniforms: { uLight: { value: 1 } },
    vertexShader: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec2 vUv;
        void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = -mvPosition.xyz;
            vUv = uv;
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: /* glsl */`
        uniform float uLight;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec2 vUv;
        void main() {
            float facing = abs(dot(normalize(vNormal), normalize(vView)));
            float fresnel = pow(1.0 - facing, 3.0);
            float sheen = smoothstep(0.08, 0.0, abs(vUv.x + vUv.y - 1.25)) * 0.08;
            vec3 color = vec3(0.82, 0.88, 0.95) * uLight;
            gl_FragColor = vec4(color, 0.025 + 0.3 * fresnel + sheen * uLight);
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false,
});

class Panel172 {
    // group : groupe de la cabine (Cockpit)
    constructor(group) {
        this.group = group;
        this.clickables = [];
        this.dynamic = [];          // pièces qui bougent ou se cliquent (pas de fusion, voir MergeStatic)
        this._p = {};               // pièces animées
        this._compassHeading = 0;
        this._displayKey = '';
        this._sinceDisplay = Infinity;

        this.atlas = new CanvasTexture(drawAtlas());
        this.atlas.colorSpace = SRGBColorSpace;
        this.atlas.anisotropy = 8;
        const plates = new CanvasTexture(drawPlates());
        plates.colorSpace = SRGBColorSpace;
        plates.anisotropy = 8;
        const face = new CanvasTexture(drawFace(LAYOUT));
        face.colorSpace = SRGBColorSpace;
        face.anisotropy = 8;
        const displayCanvas = document.createElement('canvas');
        displayCanvas.width = 1024;
        displayCanvas.height = 512;
        this._displayCtx = displayCanvas.getContext('2d');
        this.displayTexture = new CanvasTexture(displayCanvas);
        this.displayTexture.colorSpace = SRGBColorSpace;
        this.displayTexture.anisotropy = 4;

        // Matériaux : cadrans et façades rétroéclairés (éclairage des instruments), afficheurs lumineux
        const lit = (map, extra = {}) => new MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.75, ...extra });
        this.materials = {
            face: lit(face, { roughness: 0.8 }),
            dial: lit(this.atlas),
            sprite: lit(this.atlas, { transparent: true }),
            plates: lit(plates, { roughness: 0.6 }),
        };
        this._display = new MeshBasicMaterial({ map: this.displayTexture, color: 0xe8e8e8 });
        this._edge = new MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.7 });
        this._bezel = new MeshStandardMaterial({ color: 0x18181a, roughness: 0.45, metalness: 0.3, side: DoubleSide });
        this._black = new MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.6 });
        this._knurled = new MeshStandardMaterial({ map: knurlTexture(), color: 0x6a6d72, metalness: 0.4, roughness: 0.4 });
        this._knobBlack = new MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.2 });
        this._knobCap = new MeshStandardMaterial({ color: 0x141416, roughness: 0.35, metalness: 0.3 });
        this._white = new MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.05 });
        this._lamp = new MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffa000, emissiveIntensity: 0 });

        this._buildSheet();
        this._buildGlareshield();
        this._buildInstruments();
        this._buildStack();
        this._buildPanelItems();
        this._buildCompass();
    }

    // --- Tôle du tableau, dos, casquette -------------------------------------------------------------------
    _buildSheet() {
        const shape = panelOutline(new Shape());
        const hole = (cx, cy, r) => {
            const path = new Path();
            path.absarc(cx, -cy, r, 0, Math.PI * 2, true);
            shape.holes.push(path);
        };
        for (const [key, [x, y]] of Object.entries(LAYOUT.instruments)) hole(x, y, (this._isSmall(key) ? SMALL : BIG).hole);
        for (const y of LAYOUT.yokes) hole(y.x, y.y, 42);
        const rect = (x0, y0, x1, y1) => {
            const path = new Path();
            path.moveTo(x0, -y0); path.lineTo(x0, -y1); path.lineTo(x1, -y1); path.lineTo(x1, -y0); path.lineTo(x0, -y0);
            shape.holes.push(path);
        };
        const st = LAYOUT.stack, gb = LAYOUT.glovebox;
        rect(st.x0, st.y0, st.x1, st.y1);
        rect(gb.x0, gb.y0, gb.x1, gb.y1);
        const depth = SHEET * S;
        const geometry = toCabin(new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 40 }), 0, depth);
        this.sheet = new Mesh(geometry, [this.materials.face, this._edge]);
        this.group.add(this.sheet);
        // Dos du tableau (vu de l'extérieur à travers le pare-brise ; fond de la pile radio et des passages)
        const backDepth = 0.17 * S;
        const back = toCabin(new ExtrudeGeometry(panelOutline(new Shape()), { depth: backDepth, bevelEnabled: false, curveSegments: 24 }), -0.03, backDepth);
        this.group.add(new Mesh(back, this._black));
        // Boîte à gants : caisson et porte (s'ouvre vers le bas)
        const w = m(gb.x1 - gb.x0), h = m(gb.y1 - gb.y0), c = at((gb.x0 + gb.x1) / 2, (gb.y0 + gb.y1) / 2);
        const inside = new MeshStandardMaterial({ color: 0x242426, roughness: 0.9, side: DoubleSide });
        for (const [sx, sy, px, py] of [[w, 0.028, 0, h / 2], [w, 0.028, 0, -h / 2], [0.028, h, -w / 2, 0], [0.028, h, w / 2, 0]]) {
            const wall = new Mesh(new PlaneGeometry(sx === 0.028 ? 0.028 : w, sy === 0.028 ? 0.028 : h), inside);
            if (sx === 0.028) wall.rotation.y = Math.PI / 2;
            else wall.rotation.x = Math.PI / 2;
            wall.position.set(c.x + px, c.y + py, FACE_Z - 0.014);
            this.group.add(wall);
        }
        const book = new Mesh(new BoxGeometry(0.11, 0.07, 0.02), new MeshStandardMaterial({ color: 0x1d3b6e, roughness: 0.8 }));
        book.position.set(c.x - 0.03, c.y - 0.01, FACE_Z - 0.018);
        this.group.add(book);
        const door = new Group();
        door.position.set(c.x, c.y - h / 2, FACE_Z + 0.003);
        const panel = new Mesh(new BoxGeometry(w - 0.002, h - 0.002, 0.006), new MeshStandardMaterial({ color: 0x18181a, roughness: 0.55 }));
        panel.position.y = h / 2;
        const latch = new Mesh(new BoxGeometry(0.03, 0.008, 0.006), new MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.8, roughness: 0.3 }));
        latch.position.set(0, h - 0.012, 0.005);
        door.add(panel, latch);
        this._control(door, 'glovebox');
        this._p.glovebox = door;
    }

    _buildGlareshield() {
        const shape = new Shape();
        shape.moveTo(410, -545);
        shape.lineTo(410, -425);
        shape.absellipse(730, -425, 320, 230, Math.PI, Math.PI / 2, true);
        shape.lineTo(1958, -195);
        shape.absellipse(1958, -425, 320, 230, Math.PI / 2, 0, true);
        shape.lineTo(2278, -545);
        shape.absarc(2285.5, -545, 7.5, Math.PI, Math.PI * 2, false);
        shape.lineTo(2293, -425);
        shape.absellipse(1958, -425, 335, 265, 0, Math.PI / 2, false);
        shape.lineTo(730, -160);
        shape.absellipse(730, -425, 335, 265, Math.PI / 2, Math.PI, false);
        shape.lineTo(395, -545);
        shape.absarc(402.5, -545, 7.5, Math.PI, Math.PI * 2, false);
        const depth = 0.3 * S;
        const geometry = toCabin(new ExtrudeGeometry(shape, {
            depth, bevelEnabled: true, bevelThickness: 6, bevelSize: 5, bevelSegments: 3, curveSegments: 40,
        }), 0.03 - m(6), depth);
        this.glareshield = new Mesh(geometry, new MeshStandardMaterial({ color: 0x161617, roughness: 0.95 }));
        this.group.add(this.glareshield);
    }

    _isSmall(key) {
        return ['davtron', 'fuel', 'egt', 'oil', 'vac'].includes(key);
    }

    // --- Instruments ---------------------------------------------------------------------------------------
    // Boîtier : collerette noire en entonnoir du bord du trou jusqu'au cadran, vitre, quatre vis
    _case(key) {
        const [x, y] = LAYOUT.instruments[key];
        const size = this._isSmall(key) ? SMALL : BIG;
        const root = new Group();
        root.position.copy(at(x, y));
        this.group.add(root);
        const rh = m(size.hole), rd = m(size.dial);
        const profile = [new Vector2(rh, 0.0002), new Vector2(rh * 0.97, -0.0022), new Vector2(rd * 1.06, -size.depth + 0.0025), new Vector2(rd, -size.depth)];
        const bezel = new Mesh(new LatheGeometry(profile, 56), this._bezel);
        bezel.rotation.x = Math.PI / 2;
        root.add(bezel);
        const glass = new Mesh(new CircleGeometry(rh * 0.985, 48), instrumentGlass);
        glass.position.z = -0.0025;
        glass.renderOrder = 6;
        root.add(glass);
        for (const a of [45, 135, 225, 315]) {
            const screw = zCylinder(m(6), 0.002, this._black, 12);
            screw.position.set(Math.cos(deg(a)) * m(size.hole + 14), Math.sin(deg(a)) * m(size.hole + 14), 0.001);
            root.add(screw);
        }
        const inst = { root, rd, z: -size.depth, mpp: rd / ATLAS_RADIUS };
        this._p[key] = inst;
        return inst;
    }

    // Disque de l'atlas (cadran, rose) au fond du boîtier ; layer : décalage vers la vitre (0,5 mm par couche)
    _disc(inst, cellKey, layer = 0, parent = inst.root) {
        const geometry = mapUV(new CircleGeometry(inst.rd, 64), CELLS[cellKey]);
        const mesh = new Mesh(geometry, layer === 0 ? this.materials.dial : this.materials.sprite);
        mesh.position.z = inst.z + layer * 0.0005;
        mesh.renderOrder = layer;
        parent.add(mesh);
        return mesh;
    }

    // Sprite de l'atlas (aiguille, drapeau, maquette) ; pivot à l'origine de la pièce ; rotate : quart de tour
    _sprite(inst, key, layer, { parent = inst.root, rotate = 0, x = 0, y = 0 } = {}) {
        const s = SPRITES[key], k = inst.mpp;
        const geometry = mapUV(new PlaneGeometry(s.w * k, s.h * k), s);
        geometry.translate((s.w / 2 - s.px) * k, -(s.h / 2 - s.py) * k, 0);
        if (rotate) geometry.rotateZ(rotate);
        const mesh = new Mesh(geometry, this.materials.sprite);
        mesh.position.set(x, y, inst.z + layer * 0.0005);
        mesh.renderOrder = layer;
        parent.add(mesh);
        return mesh;
    }

    // Bouton moleté sur la tôle, au coin d'un instrument (ou ailleurs) ; renvoie la partie qui tourne
    _knob(control, ax, ay, r, { length = 0.012, material = this._knurled, dz = 0 } = {}) {
        const root = new Group();
        root.position.copy(at(ax, ay, dz));
        const turn = new Group();
        const body = zCylinder(m(r), length, material, 24);
        body.position.z = length / 2;
        const cap = zCylinder(m(r) * 0.92, 0.001, this._knobCap, 24);
        cap.position.z = length + 0.0005;
        const mark = new Mesh(new BoxGeometry(m(r) * 0.12, m(r) * 0.7, 0.0006), this._white);
        mark.position.set(0, m(r) * 0.45, length + 0.001);
        turn.add(body, cap, mark);
        root.add(turn);
        this.group.add(root);
        this._control(root, control);
        return turn;
    }

    // Pièce cliquable : la commande est portée par la racine (voir Cockpit.controlAt)
    _control(root, control) {
        if (root.parent !== this.group) this.group.add(root);
        root.userData.control = control;
        this.dynamic.push(root);
        root.traverse((child) => { if (child.isMesh) this.clickables.push(child); });
    }

    _buildInstruments() {
        const p = this._p;
        // Anémomètre
        let i = this._case('asi');
        this._disc(i, 'asi');
        p.asiNeedle = this._sprite(i, 'asiNeedle', 4);

        // Horizon artificiel : carte (assiette) dans un groupe qui tourne (inclinaison) avec sa couronne
        i = this._case('ai');
        const roll = new Group();
        roll.position.z = 0;
        i.root.add(roll);
        const card = new Mesh(mapUV(new PlaneGeometry(i.rd * 2.1, i.rd * 4.2), CELLS.aiCard), this.materials.dial);
        card.position.z = i.z;
        roll.add(card);
        // Fond noir derrière la carte (vu en biais)
        this._disc(i, 'back', 0).position.z = i.z - 0.0008;
        this._disc(i, 'aiRing', 2, roll);
        p.aiRoll = roll;
        p.aiCard = card;
        this._sprite(i, 'bankPointer', 3, { y: i.rd * 0.86 });
        p.aiPlane = this._sprite(i, 'aiPlane', 4);
        this._knob('ai', 938, 418, 9, { length: 0.01 });

        // Altimètre : calage (fenêtre) et trois aiguilles
        i = this._case('alt');
        this._disc(i, 'alt');
        const kollsman = new Mesh(mapUV(new PlaneGeometry(i.rd * 0.36, i.rd * 0.19), DISPLAY.kollsman, 1024, 512), this._display);
        kollsman.position.set(i.rd * 0.56, 0, i.z + 0.0003);
        i.root.add(kollsman);
        p.alt10k = this._sprite(i, 'alt10k', 3);
        p.altShort = this._sprite(i, 'altShort', 4);
        p.altLong = this._sprite(i, 'altLong', 5);
        this._knob('baro', 1044, 399, 13);

        // Coordinateur de virage : maquette, bille, drapeau OFF
        i = this._case('tc');
        this._disc(i, 'tc');
        p.tcPlane = this._sprite(i, 'tcPlane', 3);
        p.ball = this._sprite(i, 'ball', 2);
        p.tcFlag = this._sprite(i, 'flagOFF', 2, { x: -i.rd * 0.35, y: i.rd * 0.2 });

        // Conservateur de cap : rose mobile, repères fixes, curseur de cap ; boutons PUSH (recalage) et HDG (curseur)
        i = this._case('dg');
        p.dgCard = this._disc(i, 'dgCard', 0);
        p.dgBug = new Group();
        i.root.add(p.dgBug);
        this._sprite(i, 'hdgBug', 1, { parent: p.dgBug, y: i.rd * 0.93 });
        this._disc(i, 'dgOverlay', 2);
        this._knob('dg', 872, 581, 13);
        this._knob('hdgBug', 1004, 581, 13, { material: new MeshStandardMaterial({ map: this._knurled.map, color: 0xd98a2a, metalness: 0.3, roughness: 0.4 }) });

        i = this._case('vsi');
        this._disc(i, 'vsi');
        p.vsiNeedle = this._sprite(i, 'vsiNeedle', 4);

        // VOR 1 (avec glide) et VOR 2 : rose de l'OBS, aiguilles d'écart, drapeaux TO / FR / NAV / GS
        for (const [key, glide, obs] of [['vor1', true, [1212, 399]], ['vor2', false, [1212, 581]]]) {
            i = this._case(key);
            this._disc(i, 'back');
            const nav = { inst: i, card: this._disc(i, 'navCard', 1) };
            this._disc(i, glide ? 'nav1Overlay' : 'nav2Overlay', 2);
            nav.to = this._sprite(i, 'flagTO', 3, { x: i.rd * 0.42, y: i.rd * 0.3 });
            nav.from = this._sprite(i, 'flagFR', 3, { x: i.rd * 0.42, y: -i.rd * 0.3 });
            nav.flag = this._sprite(i, 'flagNAV', 3, { x: -i.rd * 0.42, y: i.rd * 0.3 });
            const bar = (w, h) => {
                const mesh = new Mesh(new BoxGeometry(w, h, 0.0006), this._white);
                mesh.position.z = i.z + 0.0025;
                mesh.renderOrder = 4;
                i.root.add(mesh);
                return mesh;
            };
            nav.cdi = bar(i.rd * 0.045, i.rd * 1.3);
            if (glide) {
                nav.gs = bar(i.rd * 1.3, i.rd * 0.045);
                nav.gsFlag = this._sprite(i, 'flagGS', 3, { x: -i.rd * 0.42, y: -i.rd * 0.3 });
            }
            nav.knob = this._knob(key === 'vor1' ? 'obs' : 'obs2', obs[0], obs[1], 13);
            p[key] = nav;
        }

        i = this._case('tach');
        this._disc(i, 'tach');
        const hours = new Mesh(mapUV(new PlaneGeometry(i.rd * 0.72, i.rd * 0.19), DISPLAY.tachHours, 1024, 512), this._display);
        hours.position.set(0, -i.rd * 0.44, i.z + 0.0003);
        i.root.add(hours);
        p.tachNeedle = this._sprite(i, 'tachNeedle', 4);

        // ADF : rose mobile (bouton HDG), aiguille jaune vers la balise
        i = this._case('adf');
        this._disc(i, 'back');
        p.adfCard = this._disc(i, 'navCard', 1);
        this._disc(i, 'adfOverlay', 2);
        p.adfNeedle = this._sprite(i, 'adfNeedle', 4, { rotate: Math.PI / 2 });
        this._knob('adf', 1212, 770, 13, { material: new MeshStandardMaterial({ map: this._knurled.map, color: 0xc9a227, metalness: 0.3, roughness: 0.4 }) });

        // Instruments moteur : deux aiguilles par cadran
        for (const key of ['fuel', 'egt', 'oil', 'vac']) {
            i = this._case(key);
            this._disc(i, key);
            p[`${key}Left`] = this._sprite(i, 'smallNeedle', 3);
            p[`${key}Right`] = this._sprite(i, 'smallNeedle', 4);
        }

        // Davtron M803 : thermomètre / voltmètre (haut), horloge et chronomètres (bas), boutons SELECT et CONTROL
        i = this._case('davtron');
        this._disc(i, 'davtron');
        for (const [key, y] of [['davtronTop', 0.33], ['davtronBottom', -0.15]]) {
            const lcd = new Mesh(mapUV(new PlaneGeometry(i.rd * 1.3, i.rd * 0.36), DISPLAY[key], 1024, 512), this._display);
            lcd.position.set(0, i.rd * y, i.z + 0.0003);
            i.root.add(lcd);
        }
        for (const [control, x] of [['davtron:select', -0.45], ['davtron:control', 0.45]]) {
            const root = new Group();
            root.position.copy(i.root.position).add(new Vector3(i.rd * x, -i.rd * 0.76, i.z));
            const button = zCylinder(i.rd * 0.09, 0.004, new MeshStandardMaterial({ color: 0x2f7fd8, roughness: 0.4 }), 16);
            button.position.z = 0.002;
            root.add(button);
            this._control(root, control);
        }
    }

    // --- Pile radio ------------------------------------------------------------------------------------------
    _buildStack() {
        const st = LAYOUT.stack, p = this._p;
        const units = [
            { plate: 'audio', y0: 302, y1: 365 },
            { plate: 'navcom', id: 'navcom1', y0: 368, y1: 462 },
            { plate: 'navcom', id: 'navcom2', y0: 465, y1: 558 },
            { plate: null, y0: 560, y1: 622 },
            { plate: 'dme', y0: 625, y1: 683 },
            { plate: 'xpdr', y0: 686, y1: 755 },
        ];
        const darkBox = new MeshStandardMaterial({ color: 0x141416, roughness: 0.6 });
        for (const u of units) {
            const w = m(st.x1 - st.x0 - 2), h = m(u.y1 - u.y0 - 1);
            const center = at((st.x0 + st.x1) / 2, (u.y0 + u.y1) / 2);
            const box = new Mesh(new BoxGeometry(w, h, 0.03), darkBox);
            box.position.set(center.x, center.y, FACE_Z - 0.012);
            this.group.add(box);
            if (!u.plate) continue;
            const plate = PLATES[u.plate];
            const front = new Mesh(mapUV(new PlaneGeometry(w, h), { x: 0, y: plate.y * PLATE_SCALE, w: 1024, h: plate.h * PLATE_SCALE }, 1024), this.materials.plates);
            front.position.set(center.x, center.y, FACE_Z + 0.0031);
            this.group.add(front);
            u.local = (ux, uy, dz = 0) => at(st.x0 + ux, u.y0 + uy, 0.0031 + dz);
        }
        // Afficheur : plan de l'afficheur posé sur la façade (local : px de la façade)
        const display = (u, region, x0, y0, x1, y1) => {
            const mesh = new Mesh(mapUV(new PlaneGeometry(m(x1 - x0), m(y1 - y0)), region, 1024, 512), this._display);
            mesh.position.copy(u.local((x0 + x1) / 2, (y0 + y1) / 2, 0.0004));
            this.group.add(mesh);
            return mesh;
        };
        // Bouton-poussoir rectangulaire
        const button = (u, control, ux, uy, w, h, material = this._white) => {
            const root = new Group();
            root.position.copy(u.local(ux, uy));
            const key = new Mesh(new BoxGeometry(m(w), m(h), 0.004), material);
            key.position.z = 0.002;
            root.add(key);
            if (control) this._control(root, control);
            else this.group.add(root);
            return key;
        };
        // Double bouton concentrique : extérieur (MHz) et intérieur (kHz)
        const dual = (u, prefix, ux, uy) => {
            const outer = new Group();
            outer.position.copy(u.local(ux, uy));
            const ring = zCylinder(m(13), 0.008, this._knobBlack, 28);
            ring.position.z = 0.004;
            outer.add(ring);
            this._control(outer, `${prefix}:outer`);
            const inner = new Group();
            inner.position.copy(u.local(ux, uy));
            const knob = zCylinder(m(7.5), 0.015, this._knobBlack, 20);
            knob.position.z = 0.0075;
            inner.add(knob);
            this._control(inner, `${prefix}:inner`);
        };
        const small = (u, control, ux, uy, r = 6) => {
            const root = new Group();
            root.position.copy(u.local(ux, uy));
            const knob = zCylinder(m(r), 0.008, this._knobBlack, 16);
            knob.position.z = 0.004;
            root.add(knob);
            if (control) this._control(root, control);
            else this.group.add(root);
            return root;
        };
        const [audio, nc1, nc2, , dme, xpdr] = units;

        // Boîte audio : haut-parleurs (rangée du haut, cliquable), casque (décor), sélecteur du micro
        p.audioButtons = {};
        ['tel', 'com1', 'com2', 'nav1', 'nav2', 'dme', 'mkr', 'adf', 'auto'].forEach((id, k) => {
            p.audioButtons[id] = button(audio, `audio:${id}`, 77 + k * 18, 22, 12, 11);
            button(audio, null, 77 + k * 18, 46, 12, 11);
        });
        p.mic = small(audio, 'audio:mic', 268, 28, 9);

        // NAV/COM 1 et 2 : afficheur, bouton marche / volume, permutation, double bouton
        for (const [u, n] of [[nc1, 1], [nc2, 2]]) {
            display(u, DISPLAY[`navcom${n}`], 12, 10, 288, 38);
            small(u, `power:navcom${n}`, 37, 68, 6.5);
            small(u, null, 194, 68, 6.5);
            button(u, `com${n}:swap`, 92, 66, 18, 9);
            button(u, `nav${n}:swap`, 230, 66, 18, 9);
            dual(u, `com${n}`, 130, 66);
            dual(u, `nav${n}`, 272, 66);
            button(u, null, 76, 87, 6, 6, this._knobBlack);
            button(u, null, 222, 87, 6, 6, this._knobBlack);
        }

        // DME : afficheur, inverseur RMT / FREQ / GS-T, marche
        display(dme, DISPLAY.dme, 8, 5, 220, 30);
        const lever = (u, control, ux, uy) => {
            const root = new Group();
            root.position.copy(u.local(ux, uy));
            root.add(zCylinder(m(4), 0.002, this._knobBlack, 6).translateZ(0.001));
            const stick = new Group();
            const stem = zCylinder(m(1.6), 0.012, new MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.85, roughness: 0.3 }), 8);
            stem.position.z = 0.006;
            stick.add(stem);
            root.add(stick);
            this._control(root, control);
            return stick;
        };
        p.dmeMode = lever(dme, 'dme:mode', 255, 20);
        p.dmePower = lever(dme, 'power:dme', 226, 44);
        small(dme, null, 275, 42, 11);

        // Transpondeur : sélecteur de mode, IDENT, voyant de réponse, quatre boutons de code sous leurs fenêtres
        display(xpdr, DISPLAY.xpdr, 100, 6, 296, 29);
        p.xpdrMode = small(xpdr, 'xpdr:mode', 33, 25, 9);
        const markMesh = new Mesh(new BoxGeometry(m(2), m(8), 0.001), this._white);
        markMesh.position.set(0, m(4), 0.0085);
        p.xpdrMode.add(markMesh);
        button(xpdr, 'xpdr:ident', 84, 30, 18, 9, this._knobBlack);
        p.reply = new Mesh(new BoxGeometry(m(8), m(6), 0.002), this._lamp.clone());
        p.reply.position.copy(xpdr.local(84, 20, 0.001));
        this.group.add(p.reply);
        for (let k = 0; k < 4; k++) small(xpdr, `xpdr:d${k}`, 124.5 + k * 49, 44, 8);
    }

    // --- Panneau d'alarmes, Hobbs, cache des passages de manche ---------------------------------------------------
    _buildPanelItems() {
        const a = LAYOUT.annunciator;
        const box = new Mesh(new BoxGeometry(m(a.x1 - a.x0 + 8), m(a.y1 - a.y0 + 8), 0.006), this._black);
        box.position.copy(at((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, 0.003));
        this.group.add(box);
        const screen = new Mesh(mapUV(new PlaneGeometry(m(a.x1 - a.x0), m(a.y1 - a.y0)), DISPLAY.annunciator, 1024, 512), this._display);
        screen.position.copy(at((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, 0.0062));
        this.group.add(screen);
        const h = LAYOUT.hobbs;
        const hobbs = new Mesh(mapUV(new PlaneGeometry(m(46), m(14)), DISPLAY.hobbs, 1024, 512), this._display);
        hobbs.position.copy(at(h.x, h.y, 0.0005));
        this.group.add(hobbs);
        // Passages des manches : fourreau noir (cliquable : remet les manches cachés)
        for (const y of LAYOUT.yokes) {
            const root = new Group();
            root.position.copy(at(y.x, y.y, -0.015));
            const sleeve = new Mesh(new CylinderGeometry(m(42), m(42), 0.03, 32, 1, true), this._bezel);
            sleeve.rotation.x = Math.PI / 2;
            const back = new Mesh(new CircleGeometry(m(42), 32), this._black);
            back.position.z = -0.014;
            root.add(sleeve, back);
            this._control(root, 'yokes');
            for (const [dx, dy] of [[-46, -46], [46, -46], [-46, 46], [46, 46]]) {
                const screw = zCylinder(m(6), 0.002, this._black, 12);
                screw.position.copy(at(y.x + dx, y.y + dy, 0.001));
                this.group.add(screw);
            }
        }
        // Prises casque (plaques beiges sous les coins du tableau)
        const tan = new MeshStandardMaterial({ color: 0xc8b48e, roughness: 0.8 });
        for (const x of [459, 2230]) {
            const plate = new Mesh(new BoxGeometry(m(96), m(118), 0.004), tan);
            plate.position.copy(at(x, 1078, -0.004));
            this.group.add(plate);
            for (const y of [1055, 1100]) {
                const jack = zCylinder(m(12), 0.004, this._knobBlack, 6);
                jack.position.copy(at(x, y, 0));
                this.group.add(jack);
            }
        }
    }

    // --- Compas magnétique (sur la casquette) -------------------------------------------------------------------
    _buildCompass() {
        const root = new Group();
        root.position.set(0, TOP + m(35) + 0.003, FACE_Z - 0.05);
        const housing = new MeshStandardMaterial({ color: 0x141415, roughness: 0.5 });
        const y0 = 0.045, r = 0.024;
        const box = (w, h, d, x, y, z) => {
            const mesh = new Mesh(new BoxGeometry(w, h, d), housing);
            mesh.position.set(x, y, z);
            root.add(mesh);
        };
        // Boîtier ouvert à l'avant : dos, dessus, dessous, joues ; pied posé sur la casquette
        box(0.075, 0.056, 0.01, 0, y0, -0.031);
        box(0.075, 0.012, 0.064, 0, y0 + 0.016, 0);
        box(0.075, 0.012, 0.064, 0, y0 - 0.016, 0);
        for (const side of [-1, 1]) box(0.012, 0.044, 0.064, side * 0.0315, y0, 0);
        box(0.03, y0 - 0.022, 0.03, 0, (y0 - 0.022) / 2, -0.01);
        // Rose : cylindre, caps croissants vers la droite vus de face
        const cardGeometry = mapUV(new CylinderGeometry(r, r, 0.016, 64, 1, true), SPRITES.compassCard);
        this._p.compassCard = new Mesh(cardGeometry, this.materials.dial);
        this._p.compassCard.position.set(0, y0, 0);
        root.add(this._p.compassCard);
        const lubber = new Mesh(new BoxGeometry(0.0012, 0.018, 0.001), new MeshStandardMaterial({ color: 0xff8a12, emissive: 0xff8a12, emissiveIntensity: 0.3 }));
        lubber.position.set(0, y0, r + 0.003);
        root.add(lubber);
        const glass = new Mesh(new PlaneGeometry(0.052, 0.022), instrumentGlass);
        glass.position.set(0, y0, 0.0322);
        glass.renderOrder = 6;
        root.add(glass);
        this.group.add(root);
        this.dynamic.push(this._p.compassCard);
    }

    // emissive : couleur de l'éclairage (blanc le jour, ambré la nuit) ; intensity : éclairage des instruments
    // night : la tôle du tableau reste sombre (seuls les instruments et les inscriptions des radios sont éclairés)
    setLighting(emissive, intensity, night = 0) {
        for (const [key, material] of Object.entries(this.materials)) {
            material.emissive.copy(emissive);
            const factor = key === 'face' ? 0.55 - 0.45 * Math.min(1, night * 1.5) : key === 'plates' ? 0.55 : 1;
            material.emissiveIntensity = intensity * factor;
        }
        instrumentGlass.uniforms.uLight.value = Math.max(0.15, 1 - intensity);
    }

    // state : voir Cockpit.update ; delta (s)
    update(delta, s) {
        const p = this._p, sys = s.systems, av = s.avionics;
        const z = (mesh, angle) => { mesh.rotation.z = -angle; };
        z(p.asiNeedle, asiAngle(s.speedKt));
        // Horizon : carte décalée de r/30 par degré, groupe tourné de l'inclinaison
        p.aiRoll.rotation.z = -s.gyro.roll;
        p.aiCard.position.y = -Math.max(-25, Math.min(25, s.gyro.pitch)) * (p.ai.rd / 30);
        p.aiPlane.position.y = av.aiOffset * 0.001;
        const ft = s.altitudeFt + (av.baro - 1013) * 27.3;
        z(p.altLong, (ft / 1000) * Math.PI * 2);
        z(p.altShort, (ft / 10000) * Math.PI * 2);
        z(p.alt10k, (ft / 100000) * Math.PI * 2);
        p.tcPlane.rotation.z = Math.max(-0.6, Math.min(0.6, s.turnRate));
        const slip = Math.max(-1, Math.min(1, s.slip)), rd = p.tc.rd;
        p.ball.position.set(slip * rd * 0.34, -rd * 0.44 + slip * slip * rd * 0.06, p.ball.position.z);
        p.tcFlag.visible = !sys.turnCoordinatorPowered;
        const heading = s.gyro.heading + av.dgOffset;
        p.dgCard.rotation.z = deg(heading);
        p.dgBug.rotation.z = deg(heading - av.hdgBug);
        z(p.vsiNeedle, vsiAngle(s.vsFpm));
        z(p.tachNeedle, tachAngle(s.rpm));
        for (const [key, nav, course] of [['vor1', s.nav1, s.obs1], ['vor2', s.nav2, av.obs2]]) {
            const n = p[key], r = n.inst.rd;
            n.card.rotation.z = deg(course);
            n.knob.rotation.z = -deg(course * 3);
            const signal = nav.available;
            n.cdi.position.x = (signal ? nav.deviation : 0) * r * 0.6;
            n.to.visible = signal && nav.to === true;
            n.from.visible = signal && nav.to === false;
            n.flag.visible = !signal;
            if (n.gs) {
                n.gs.position.y = (nav.glide ? nav.glideslope : 0) * r * 0.48;
                n.gsFlag.visible = !nav.glide;
            }
        }
        p.adfCard.rotation.z = deg(av.adfCard);
        p.adfNeedle.rotation.z = -deg(s.adf ?? 90);
        // Instruments moteur
        const gauge = (key, left, right) => {
            z(p[`${key}Left`], halfAngle(-1, left));
            z(p[`${key}Right`], halfAngle(1, right));
        };
        const e = s.engine;
        gauge('fuel', e.fuelL, e.fuelR);
        gauge('egt', e.egt, e.ff);
        gauge('oil', e.oilT, e.oilP);
        gauge('vac', e.vac, e.amp);
        // Compas : rose amortie (suit le cap avec un peu de retard et de balancement)
        const diff = ((s.heading - this._compassHeading + 540) % 360) - 180;
        this._compassHeading += diff * (1 - Math.exp(-1.6 * delta));
        p.compassCard.rotation.y = -deg(this._compassHeading + Math.sin(performance.now() / 700) * Math.min(4, Math.abs(diff) * 0.3));
        // Radios
        const k = 1 - Math.exp(-14 * delta);
        p.xpdrMode.rotation.z += (-deg([-110, -55, 0, 55, 110][XPDR_MODES.indexOf(av.xpdr.mode)]) - p.xpdrMode.rotation.z) * k;
        p.mic.rotation.z += ((av.audio.mic === 'com1' ? deg(25) : -deg(25)) - p.mic.rotation.z) * k;
        for (const [id, key] of Object.entries(p.audioButtons)) key.position.z += ((av.audio[id] ? 0.0005 : 0.002) - key.position.z) * k;
        p.dmeMode.rotation.y = deg([-25, 0, 25][['RMT', 'FREQ', 'GS/T'].indexOf(av.dme.mode)]);
        p.dmePower.rotation.x = av.units.dme ? -0.5 : 0.5;
        const replying = s.xpdrPowered && (av.xpdr.mode === 'ON' || av.xpdr.mode === 'ALT') && (performance.now() % 2300 < 90 || performance.now() < av.xpdr.identUntil)
            || s.xpdrPowered && av.xpdr.mode === 'TST';
        p.reply.material.emissiveIntensity = replying ? 2 : 0;
        p.glovebox.rotation.x += ((s.gloveboxOpen ? 1.25 : 0) - p.glovebox.rotation.x) * k;

        // Afficheurs : redessinés quand leur contenu change (au plus 10 fois par seconde)
        this._sinceDisplay += delta;
        if (this._sinceDisplay >= 0.1) {
            const d = this._displayState(s);
            const key = JSON.stringify(d);
            if (key !== this._displayKey) {
                this._displayKey = key;
                this._sinceDisplay = 0;
                drawDisplays(this._displayCtx, d);
                this.displayTexture.needsUpdate = true;
            }
        }
    }

    _displayState(s) {
        const av = s.avionics, sys = s.systems;
        const navcom = (n) => {
            if (!s[`navcom${n}Powered`]) return null;
            const com = av[`com${n}`], nav = av[`nav${n}`];
            return {
                comActive: formatCom(com.active).slice(0, 7), comStandby: formatCom(com.standby).slice(0, 7),
                navActive: formatNav(nav.active), navStandby: formatNav(nav.standby),
                tx: s.transmitting && av.audio.mic === `com${n}`, rx: s.receiving && av.audio.mic === `com${n}`,
            };
        };
        let dme = null;
        if (s.dmePowered && av.units.dme) {
            const d = s.dme;
            if (!d) dme = { left: '---', middle: '---', right: av.dme.mode === 'FREQ' ? formatNav(av.nav1.active) : '--' };
            else {
                const left = d.nm < 100 ? d.nm.toFixed(1) : String(Math.round(d.nm));
                if (av.dme.mode === 'FREQ') dme = { left, middle: '', right: formatNav(av.nav1.active) };
                else dme = { left, middle: String(Math.min(999, Math.round(d.kt))).padStart(3, ' '), right: d.min > 99 ? '--' : String(Math.round(d.min)).padStart(2, '0') };
            }
        }
        const w = sys.warnings, ann = sys.annunciatorsPowered;
        const now = new Date();
        const davtron = (top) => {
            if (!sys.busPowered) return null;
            const d = av.davtron;
            if (top) {
                const mode = DAVTRON_TOP[d.top];
                if (mode === 'E') return { value: sys.volts.toFixed(1), unit: 'E', tag: '' };
                if (mode === 'F') return { value: String(Math.round(s.oat * 1.8 + 32)), unit: 'F', tag: '' };
                return { value: String(Math.round(s.oat)), unit: 'C', tag: '' };
            }
            const mode = DAVTRON_BOTTOM[d.bottom];
            const clock = (seconds) => {
                const t = Math.max(0, Math.floor(seconds));
                const hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60;
                return hh > 0 ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
            };
            if (mode === 'UT') return { value: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`, unit: '', tag: 'UT' };
            if (mode === 'LT') return { value: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, unit: '', tag: 'LT' };
            if (mode === 'FT') return { value: clock(d.flightStart === null ? 0 : (performance.now() - d.flightStart) / 1000), unit: '', tag: 'FT' };
            return { value: clock(d.timerStart === null ? 0 : (performance.now() - d.timerStart) / 1000), unit: '', tag: 'ET' };
        };
        return {
            navcom1: navcom(1), navcom2: navcom(2), dme,
            xpdr: { code: av.xpdr.code },
            annunciator: {
                lowFuelL: ann && w.lowFuelL, lowFuelR: ann && w.lowFuelR, oilPress: ann && w.oilPress,
                vacL: ann && w.vacL, vacR: ann && w.vacR, volts: ann && w.volts, pitchTrim: false,
            },
            davtronTop: davtron(true), davtronBottom: davtron(false),
            tachHours: sys.tachHours.toFixed(1).replace('.', '').padStart(5, '0'),
            hobbs: sys.hobbs.toFixed(1).replace('.', '').padStart(6, '0'),
            kollsman: String(Math.round(av.baro)),
        };
    }
}

export { Panel172, LAYOUT as PANEL_LAYOUT, at as panelPoint, m as panelLength, FACE_Z as PANEL_FACE_Z, TOP as PANEL_TOP };
