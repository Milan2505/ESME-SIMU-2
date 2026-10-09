import {
    BoxGeometry,
    CanvasTexture,
    Color,
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
    ShaderMaterial,
    SphereGeometry,
    SRGBColorSpace,
    Vector3
} from 'three';

// Cabine de Cessna 172 modélisée ici, vue depuis la place gauche (pilote).
// Repère : origine à hauteur des yeux sur l'axe de l'avion, -z vers l'avant.
const EYE = new Vector3(-0.3, 0, 0);
const PANEL = { width: 1.2, height: 0.4, y: -0.3, z: -0.75 };
const CANVAS = { width: 1536, height: 512 };
const PX_PER_M = CANVAS.width / PANEL.width;
const PANEL_NIGHT_LIGHT = new Color(0xffbf45); // éclairage ambré des instruments

// Position d'un point du tableau (repère cabine) en pixels du canvas
function toCanvas(x, y) {
    return [(x + PANEL.width / 2) * PX_PER_M, (PANEL.y + PANEL.height / 2 - y) * PX_PER_M];
}

const deg = MathUtils.degToRad;

// --- Dessin des instruments (angle 0 = midi, sens horaire) ---------------------------

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

function arc(ctx, cx, cy, r, from, to, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r, from - Math.PI / 2, to - Math.PI / 2);
    ctx.stroke();
}

function ticks(ctx, cx, cy, r, { from, to, count, every = 1, labels = null, size = 22 }) {
    ctx.strokeStyle = '#eee';
    ctx.fillStyle = '#eee';
    ctx.font = `bold ${size}px DejaVu Sans Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= count; i++) {
        const a = from + ((to - from) * i) / count;
        const major = i % every === 0;
        const [x0, y0] = polar(cx, cy, r * (major ? 0.8 : 0.88), a);
        const [x1, y1] = polar(cx, cy, r * 0.97, a);
        ctx.lineWidth = major ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        if (major && labels) {
            const text = labels(i / every);
            if (text !== null) {
                const [tx, ty] = polar(cx, cy, r * 0.62, a);
                ctx.fillText(text, tx, ty);
            }
        }
    }
}

function needle(ctx, cx, cy, length, angle, width = 7, color = '#f5f5f5') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-width / 2, length * 0.15);
    ctx.lineTo(-width / 3, -length + width);
    ctx.lineTo(0, -length);
    ctx.lineTo(width / 3, -length + width);
    ctx.lineTo(width / 2, length * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx, cy, width, 0, Math.PI * 2);
    ctx.fill();
}

function caption(ctx, cx, cy, text, size = 16) {
    ctx.fillStyle = '#d4d6d9';
    ctx.font = `${size}px DejaVu Sans Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
}

function airspeed(ctx, cx, cy, r, kmh) {
    bezel(ctx, cx, cy, r);
    const angleOf = (v) => deg(-160 + (Math.min(v, 260) / 260) * 320);
    arc(ctx, cx, cy, r * 0.93, angleOf(50), angleOf(140), '#ddd', 8);
    arc(ctx, cx, cy, r * 0.86, angleOf(60), angleOf(200), '#2ecc40', 9);
    arc(ctx, cx, cy, r * 0.86, angleOf(200), angleOf(240), '#ffdc00', 9);
    arc(ctx, cx, cy, r * 0.86, angleOf(240), angleOf(244), '#ff2a1a', 12);
    ticks(ctx, cx, cy, r, { from: angleOf(0), to: angleOf(260), count: 26, every: 4, labels: (i) => String(i * 40) });
    caption(ctx, cx, cy + r * 0.32, 'KM/H');
    caption(ctx, cx, cy - r * 0.3, 'ANÉMO', 14);
    needle(ctx, cx, cy, r * 0.85, angleOf(Math.max(0, kmh)));
}

function attitude(ctx, cx, cy, r, rollRad, pitchDeg) {
    bezel(ctx, cx, cy, r);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(rollRad);
    const shift = MathUtils.clamp(pitchDeg, -40, 40) * (r / 30);
    ctx.fillStyle = '#2f7fd0';
    ctx.fillRect(-2 * r, -3 * r + shift, 4 * r, 3 * r);
    ctx.fillStyle = '#7a4a22';
    ctx.fillRect(-2 * r, shift, 4 * r, 3 * r);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-2 * r, shift);
    ctx.lineTo(2 * r, shift);
    for (let p = -30; p <= 30; p += 10) {
        if (p === 0) continue;
        const y = shift - p * (r / 30);
        const half = r * (Math.abs(p) % 20 === 0 ? 0.3 : 0.18);
        ctx.moveTo(-half, y);
        ctx.lineTo(half, y);
    }
    ctx.stroke();
    // Échelle d'inclinaison (tourne avec l'horizon)
    for (const a of [-60, -30, -20, -10, 10, 20, 30, 60]) {
        const [x0, y0] = polar(0, 0, r * 0.8, deg(a));
        const [x1, y1] = polar(0, 0, r * 0.95, deg(a));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    }
    ctx.restore();
    // Maquette d'avion fixe
    ctx.strokeStyle = '#ff9f1a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy);
    ctx.lineTo(cx - r * 0.18, cy);
    ctx.lineTo(cx, cy + r * 0.1);
    ctx.lineTo(cx + r * 0.18, cy);
    ctx.lineTo(cx + r * 0.55, cy);
    ctx.stroke();
    ctx.fillStyle = '#ff9f1a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.95);
    ctx.lineTo(cx - 10, cy - r * 0.78);
    ctx.lineTo(cx + 10, cy - r * 0.78);
    ctx.fill();
}

function altimeter(ctx, cx, cy, r, meters) {
    bezel(ctx, cx, cy, r);
    ticks(ctx, cx, cy, r, { from: 0, to: deg(360), count: 50, every: 5, labels: (i) => (i < 10 ? String(i) : null) });
    // Fenêtre numérique
    ctx.fillStyle = '#222';
    ctx.fillRect(cx - 52, cy + r * 0.28, 104, 32);
    ctx.fillStyle = '#7fff7f';
    ctx.font = 'bold 22px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(meters)} m`, cx, cy + r * 0.28 + 17);
    caption(ctx, cx, cy - r * 0.3, 'ALT ×100 m', 13);
    needle(ctx, cx, cy, r * 0.5, deg((meters / 1000) * 360), 10);   // petite aiguille : 1000 m par tour
    needle(ctx, cx, cy, r * 0.88, deg((meters / 100) * 360), 6);    // grande aiguille : 100 m par tour
}

function turnCoordinator(ctx, cx, cy, r, rollRad, slip) {
    bezel(ctx, cx, cy, r);
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 4;
    for (const a of [-110, -90, 70, 90]) {
        const [x0, y0] = polar(cx, cy, r * 0.75, deg(a));
        const [x1, y1] = polar(cx, cy, r * 0.95, deg(a));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    }
    caption(ctx, cx - r * 0.6, cy + r * 0.35, 'G', 18);
    caption(ctx, cx + r * 0.6, cy + r * 0.35, 'D', 18);
    caption(ctx, cx, cy - r * 0.45, 'VIRAGE', 13);
    // Maquette inclinée selon le virage
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-MathUtils.clamp(rollRad, -deg(35), deg(35)) * 0.6);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(-r * 0.7, -5, r * 1.4, 10);
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-3, -28, 6, 20);
    ctx.restore();
    // Bille (dérapage)
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.62, r * 0.45, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx + MathUtils.clamp(slip, -1, 1) * r * 0.32, cy + r * 0.62, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 17, cy + r * 0.48); ctx.lineTo(cx - 17, cy + r * 0.76);
    ctx.moveTo(cx + 17, cy + r * 0.48); ctx.lineTo(cx + 17, cy + r * 0.76);
    ctx.stroke();
}

function headingIndicator(ctx, cx, cy, r, heading) {
    bezel(ctx, cx, cy, r);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(deg(-heading));
    ctx.strokeStyle = '#eee';
    ctx.fillStyle = '#eee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const names = { 0: 'N', 9: 'E', 18: 'S', 27: 'O' };
    for (let d = 0; d < 360; d += 5) {
        const major = d % 10 === 0;
        const [x0, y0] = polar(0, 0, r * (major ? 0.8 : 0.87), deg(d));
        const [x1, y1] = polar(0, 0, r * 0.97, deg(d));
        ctx.lineWidth = major ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        if (d % 30 === 0) {
            const [tx, ty] = polar(0, 0, r * 0.62, deg(d));
            ctx.save();
            ctx.translate(tx, ty);
            ctx.rotate(deg(d));
            ctx.font = `bold ${names[d / 10] ? 26 : 20}px DejaVu Sans Mono, monospace`;
            ctx.fillText(names[d / 10] ?? String(d / 10), 0, 0);
            ctx.restore();
        }
    }
    ctx.restore();
    // Maquette fixe et index de cap
    ctx.strokeStyle = '#ff9f1a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.35); ctx.lineTo(cx, cy + r * 0.3);
    ctx.moveTo(cx - r * 0.28, cy - r * 0.05); ctx.lineTo(cx + r * 0.28, cy - r * 0.05);
    ctx.moveTo(cx - r * 0.12, cy + r * 0.25); ctx.lineTo(cx + r * 0.12, cy + r * 0.25);
    ctx.stroke();
    ctx.fillStyle = '#ff9f1a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.8);
    ctx.lineTo(cx - 9, cy - r * 0.97);
    ctx.lineTo(cx + 9, cy - r * 0.97);
    ctx.fill();
}

function variometer(ctx, cx, cy, r, vs) {
    bezel(ctx, cx, cy, r);
    const angleOf = (v) => deg(-90 + (MathUtils.clamp(v, -10, 10) / 10) * 170);
    ticks(ctx, cx, cy, r, { from: angleOf(-10), to: angleOf(10), count: 20, every: 5, labels: (i) => (i === 0 ? null : String(Math.abs(i * 5 - 10))) }); // un seul « 10 » (en haut)
    caption(ctx, cx + r * 0.2, cy - r * 0.32, 'MONTÉE', 13);
    caption(ctx, cx + r * 0.2, cy + r * 0.32, 'DESCENTE', 13);
    caption(ctx, cx + r * 0.25, cy, 'm/s', 15);
    needle(ctx, cx, cy, r * 0.85, angleOf(vs));
}

function tachometer(ctx, cx, cy, r, rpm) {
    bezel(ctx, cx, cy, r);
    const angleOf = (v) => deg(-130 + (Math.min(v, 3500) / 3500) * 260);
    arc(ctx, cx, cy, r * 0.86, angleOf(2100), angleOf(2700), '#2ecc40', 9);
    arc(ctx, cx, cy, r * 0.86, angleOf(2700), angleOf(2760), '#ff2a1a', 12);
    ticks(ctx, cx, cy, r, { from: angleOf(0), to: angleOf(3500), count: 35, every: 5, labels: (i) => String(i * 5), size: 18 });
    caption(ctx, cx, cy + r * 0.35, 'RPM ×100', 13);
    needle(ctx, cx, cy, r * 0.85, angleOf(rpm), 6);
}

function annunciator(ctx, x, y, text, on, color) {
    ctx.fillStyle = on ? color : '#34363a';
    ctx.fillRect(x, y, 120, 38);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, 120, 38);
    ctx.fillStyle = on ? '#111' : '#a8acb2'; // éteint mais lisible
    ctx.font = 'bold 20px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 60, y + 20);
}

// Volets : graduations 0 / 10 / 20 / 30°, l'index suit la position réelle
function flapIndicator(ctx, x, y, setting, position) {
    ctx.fillStyle = '#151618';
    ctx.fillRect(x, y, 76, 140);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, 76, 140);
    caption(ctx, x + 38, y + 14, 'VOLETS', 13);
    ctx.font = 'bold 15px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 3; i++) {
        const ty = y + 36 + i * 30;
        ctx.fillStyle = i * 10 === setting ? '#fff' : '#c4c8cc';
        ctx.fillText(`${i * 10}`, x + 34, ty);
        ctx.fillRect(x + 40, ty - 1, 10, 2);
    }
    const py = y + 36 + position * 90;
    ctx.fillStyle = '#ff9f1a';
    ctx.beginPath();
    ctx.moveTo(x + 52, py);
    ctx.lineTo(x + 68, py - 8);
    ctx.lineTo(x + 68, py + 8);
    ctx.fill();
}

function radio(ctx, x, y, label, active, standby) {
    ctx.fillStyle = '#151618';
    ctx.fillRect(x, y, 330, 70);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, 330, 70);
    ctx.fillStyle = '#050505';
    ctx.fillRect(x + 60, y + 15, 250, 40);
    ctx.fillStyle = '#39ff6a';
    ctx.font = 'bold 26px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${active}  ${standby}`, x + 70, y + 36);
    caption(ctx, x + 30, y + 36, label, 14);
}

// --- ILS ---------------------------------------------------------------------------

const ILS_BUTTON = { x: 1305, y: 150, width: 110, height: 70 };

// Bouton ILS : éteint hors de portée, cerclé d'orange quand disponible, vert quand actif
function ilsButton(ctx, b, ils) {
    const available = ils?.available, active = ils?.active;
    ctx.fillStyle = active ? '#1f7a33' : '#1c1d20';
    ctx.fillRect(b.x, b.y, b.width, b.height);
    ctx.strokeStyle = active ? '#39ff6a' : available ? '#ffb000' : '#6a6e74';
    ctx.lineWidth = available ? 5 : 3;
    ctx.strokeRect(b.x, b.y, b.width, b.height);
    ctx.fillStyle = active ? '#d9ffe0' : available ? '#ffb000' : '#a8acb2';
    ctx.font = 'bold 30px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ILS', b.x + b.width / 2, b.y + b.height / 2 - 6);
    ctx.font = '13px DejaVu Sans Mono, monospace';
    ctx.fillText(active ? `RWY ${ils.runway}` : available ? 'APPUYER' : '—', b.x + b.width / 2, b.y + b.height - 12);
}

// Indicateur ILS : aiguille verticale = localizer, horizontale = glide, drapeaux si pas de signal
function ilsIndicator(ctx, cx, cy, r, ils, time) {
    bezel(ctx, cx, cy, r);
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        for (const [x, y] of [[cx + i * r * 0.32, cy], [cx, cy + i * r * 0.32]]) {
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    ctx.strokeRect(cx - 9, cy - 9, 18, 18);
    caption(ctx, cx, cy - r * 0.78, 'ILS', 13);

    if (!ils?.active) {
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(cx - r * 0.55, cy + r * 0.45, 46, 20);
        ctx.fillRect(cx + r * 0.1, cy + r * 0.45, 46, 20);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('LOC', cx - r * 0.55 + 23, cy + r * 0.45 + 11);
        ctx.fillText('GS', cx + r * 0.1 + 23, cy + r * 0.45 + 11);
        return;
    }
    const range = r * 0.66;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#f5f5f5';
    ctx.beginPath();
    ctx.moveTo(cx + ils.localizer * range, cy - r * 0.8);
    ctx.lineTo(cx + ils.localizer * range, cy + r * 0.8);
    ctx.stroke();
    if (ils.distance > 0) {
        ctx.strokeStyle = '#ffd34d';
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.8, cy - ils.glideslope * range);
        ctx.lineTo(cx + r * 0.8, cy - ils.glideslope * range);
        ctx.stroke();
    }
    caption(ctx, cx, cy + r * 1.22, `${(ils.distance / 1000).toFixed(1)} km · idéal ${Math.round(ils.glideHeight)} m`, 13);
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

// --- Cabine ------------------------------------------------------------------------

class Cockpit {
    constructor() {
        this.group = new Group();
        this.eye = EYE.clone();
        this._time = 0;
        this._sinceDraw = Infinity;
        this._smooth = { pitch: 0, roll: 0, yaw: 0, rpm: 0, slip: 0 };

        const canvas = document.createElement('canvas');
        canvas.width = CANVAS.width;
        canvas.height = CANVAS.height;
        this._ctx = canvas.getContext('2d');
        this.panelTexture = new CanvasTexture(canvas);
        this.panelTexture.colorSpace = SRGBColorSpace;
        this.panelTexture.anisotropy = 8;

        const plastic = new MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.85 });
        const frame = new MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.7 });
        const headliner = new MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.95 });
        const seat = new MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 });
        const paint = new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
        const black = new MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
        this._panelMaterial = new MeshStandardMaterial({
            map: this.panelTexture, emissiveMap: this.panelTexture, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6,
        });

        const add = (mesh, x, y, z) => {
            mesh.position.set(x, y, z);
            this.group.add(mesh);
            return mesh;
        };

        // Tableau de bord, casquette anti-reflet et bas du tableau
        this.panel = add(new Mesh(new PlaneGeometry(PANEL.width, PANEL.height), this._panelMaterial), 0, PANEL.y, PANEL.z);
        add(new Mesh(new BoxGeometry(1.26, 0.05, 0.3), plastic), 0, -0.08, -0.88);
        add(new Mesh(new BoxGeometry(1.26, 0.42, 0.2), plastic), 0, -0.71, -0.86);
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
            // Aile haute posée sur le toit, bord d'attaque au-dessus du haut du pare-brise (comme sur un Cessna),
            // vue par les vitres latérales, et hauban
            add(new Mesh(new BoxGeometry(4.9, 0.14, 1.7), paint), side * (0.65 + 2.45), 0.45, 0.42);
            this._beam(new Vector3(side * 0.66, -0.78, 0.15), new Vector3(side * 2.7, 0.38, 0.4), 0.05, paint);
            // Sièges avant
            add(new Mesh(new BoxGeometry(0.46, 0.1, 0.48), seat), side * 0.3, -0.62, 0.3);
            const back = add(new Mesh(new BoxGeometry(0.46, 0.65, 0.09), seat), side * 0.3, -0.27, 0.6);
            back.rotation.x = -0.18;
        }
        this._beam(new Vector3(0, -0.05, -0.98), new Vector3(0, 0.37, -0.42), 0.035, frame); // montant central

        // Manches (yokes) : la colonne avance / recule, le volant tourne
        this._yokes = [-0.3, 0.3].map((x) => {
            const column = new Group();
            column.position.set(x, -0.475, -0.75); // sort sous les instruments, comme dans un vrai Cessna
            const shaft = new Mesh(new CylinderGeometry(0.018, 0.018, 0.4, 10), frame);
            shaft.rotation.x = Math.PI / 2;
            shaft.position.z = 0.1;
            const wheel = new Group();
            wheel.position.z = 0.3;
            const hub = new Mesh(new CylinderGeometry(0.035, 0.035, 0.05, 12), black);
            hub.rotation.x = Math.PI / 2;
            const bar = new Mesh(new BoxGeometry(0.3, 0.035, 0.03), black);
            bar.position.y = -0.01;
            wheel.add(hub, bar);
            for (const side of [-1, 1]) {
                const grip = new Mesh(new BoxGeometry(0.035, 0.11, 0.04), black);
                grip.position.set(side * 0.15, 0.03, 0);
                grip.rotation.z = side * 0.25;
                wheel.add(grip);
            }
            column.add(shaft, wheel);
            this.group.add(column);
            return { column, wheel };
        });

        // Manette des gaz (tirette noire au centre du tableau)
        this._throttle = new Group();
        const [tx, ty] = [-0.06, -0.46];
        this._throttle.position.set(tx, ty, PANEL.z);
        const rod = new Mesh(new CylinderGeometry(0.006, 0.006, 0.12, 8), new MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 }));
        rod.rotation.x = Math.PI / 2;
        rod.position.z = 0.06;
        this._throttleKnob = new Mesh(new SphereGeometry(0.022, 16, 12), black);
        this._throttleKnob.scale.set(1, 1, 0.7);
        this._throttle.add(rod, this._throttleKnob);
        this.group.add(this._throttle);
        this._throttleCanvas = toCanvas(tx, ty);

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

        this.group.traverse((child) => {
            child.castShadow = false;
            child.receiveShadow = false;
        });
    }

    // Poutre de section carrée entre deux points (montants, haubans)
    _beam(a, b, thickness, material) {
        const length = a.distanceTo(b);
        const mesh = new Mesh(new BoxGeometry(thickness, length, thickness), material);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()));
        this.group.add(mesh);
        return mesh;
    }

    // night : 0 = jour, 0,5 = tempête, 1 = nuit
    setNight(night) {
        // Tableau rétroéclairé : blanc de jour (lisible à l'ombre de la casquette), ambré la nuit et
        // en tempête, comme l'éclairage d'instruments d'un vrai avion (n'éblouit pas)
        const warm = Math.min(1, night * 2);
        this._panelMaterial.emissive.set(0xffffff).lerp(PANEL_NIGHT_LIGHT, warm);
        this._panelMaterial.emissiveIntensity = 0.5 + 0.4 * night;
        this._glassMaterial.uniforms.uLight.value = 1 - 0.8 * night; // reflets du ciel bien plus faibles la nuit
    }

    // Clic sur le tableau de bord (coordonnées de texture du point touché) : renvoie le bouton cliqué
    buttonAt(uv) {
        const x = uv.x * CANVAS.width, y = (1 - uv.y) * CANVAS.height;
        const b = ILS_BUTTON;
        return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height ? 'ils' : null;
    }

    setRain(intensity) {
        this.windshieldMaterial.uniforms.uIntensity.value = intensity;
        this._windshield.visible = intensity > 0;
    }

    // state : valeurs de PlaneControls (voir simulator.js)
    update(delta, state) {
        this._time += delta;
        const s = this._smooth;
        const k = 1 - Math.exp(-10 * delta);
        s.pitch += (state.inputs.pitch - s.pitch) * k;
        s.roll += (state.inputs.roll - s.roll) * k;
        s.yaw += (state.inputs.yaw - s.yaw) * k;
        const rpm = state.crashed ? 0 : 750 + state.throttle * 1950 + state.speed * 4;
        s.rpm += (rpm - s.rpm) * (1 - Math.exp(-3 * delta));
        s.slip += (-s.yaw * 0.6 - s.slip) * (1 - Math.exp(-4 * delta));

        for (const yoke of this._yokes) {
            yoke.column.position.z = -0.75 + s.pitch * 0.07;
            yoke.wheel.rotation.z = s.roll * 0.6;
        }
        this._throttle.position.z = PANEL.z + 0.02 + (1 - state.throttle) * 0.08;

        const u = this.windshieldMaterial.uniforms;
        u.uTime.value = this._time;
        u.uSpeed.value = state.speed;

        // Le tableau de bord (canvas 1536×512, puis envoi à la carte graphique) est coûteux :
        // ~25 fois par seconde suffit pour des aiguilles fluides
        this._sinceDraw += delta;
        if (this._sinceDraw >= 1 / 25) {
            this._sinceDraw = 0;
            this._drawPanel(state);
        }
    }

    _drawPanel(state) {
        const ctx = this._ctx;
        const { width: w, height: h } = CANVAS;
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // Fond du tableau (gris anthracite, légères vis)
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#2f3237');
        g.addColorStop(1, '#25272b');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        const r = 88, col = 190, [px] = toCanvas(EYE.x, 0);
        const top = 132, bottom = 368;
        airspeed(ctx, px - col, top, r, state.speed * 3.6);
        attitude(ctx, px, top, r, state.roll, state.pitchDeg);
        altimeter(ctx, px + col, top, r, state.altitude);
        turnCoordinator(ctx, px - col, bottom, r, state.roll, this._smooth.slip);
        headingIndicator(ctx, px, bottom, r, state.heading);
        variometer(ctx, px + col, bottom, r, state.verticalSpeed);
        tachometer(ctx, 790, bottom - 10, 72, this._smooth.rpm);

        annunciator(ctx, 730, 60, 'STALL', state.stallWarning && Math.sin(this._time * 20) > 0, '#ff3b2f');
        annunciator(ctx, 730, 110, 'FREINS', state.inputs.brake > 0 && state.onGround, '#ffb000');
        annunciator(ctx, 730, 160, 'SOL', state.onGround, '#39d353');
        flapIndicator(ctx, 870, 60, state.flapSetting, state.flaps);

        radio(ctx, 960, 60, 'COM1', '118.30', '121.50');
        radio(ctx, 960, 150, 'NAV1', '110.30', '113.90');
        ilsButton(ctx, ILS_BUTTON, state.ils);
        // Transpondeur
        radio(ctx, 960, 240, 'XPDR', '7000', 'ALT');

        // Repère de la manette des gaz
        const [tx, ty] = this._throttleCanvas;
        caption(ctx, tx, ty - 34, 'GAZ', 16);
        caption(ctx, tx, ty + 30, `${Math.round(state.throttle * 100)} %`, 16);

        // Indicateur ILS (à la place de la boîte à gants)
        ilsIndicator(ctx, 1385, 400, 82, state.ils, this._time);

        this.panelTexture.needsUpdate = true;
    }
}

export { Cockpit };
