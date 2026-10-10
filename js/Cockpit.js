import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Float32BufferAttribute,
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
import { Controls3D } from './Controls3D.js';
import { Hotspots, drawSubpanel, drawEngineGauges, drawAnnunciators, drawPedestal, drawFuelSelector } from './PanelControls.js';

// Cabine de Cessna 172 modélisée ici, vue depuis la place gauche (pilote).
// Repère : origine à hauteur des yeux sur l'axe de l'avion, -z vers l'avant.
const EYE = new Vector3(-0.3, 0.1, 0); // hauteur d'œil : on voit le sol par-dessus le tableau à ~12° sous l'horizon
// Tableau : instruments en haut (0,4 m), sous-panneau d'interrupteurs en bas (0,14 m), comme dans un Cessna 172
const PANEL = { width: 1.2, height: 0.54, y: -0.37, z: -0.75 };
// Manches : colonne au ras du tableau (comme dans un Cessna), course poussé / tiré et rotation du volant
const YOKE_Z = -0.75;
const YOKE_TRAVEL = 0.1;          // m de chaque côté du neutre
const YOKE_TURN = Math.PI / 2;    // 90° de chaque côté
const CANVAS = { width: 1536, height: 691 };
const SUBPANEL_TOP = 512;          // début du sous-panneau dans le canvas (px)
// Pupitre central (molette de trim, robinet carburant) et sélecteur de réservoir au plancher : 1 280 px par mètre
const PEDESTAL = { width: 0.2, height: 0.25, x: 0, y: -0.765, z: -0.598 };
const FUEL_PLATE = { width: 0.2, height: 0.156, x: 0, y: -0.884, z: -0.45 };
// Unités aéronautiques : la physique est en mètres et m/s, les instruments en nœuds et en pieds
const KT = 3600 / 1852;   // m/s -> nœuds
const FT = 1 / 0.3048;    // m -> pieds
const NM = 1852;          // mille nautique (m)
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

function airspeed(ctx, cx, cy, r, knots) {
    bezel(ctx, cx, cy, r);
    // Arcs du Cessna 172 (nœuds) : blanc = volets utilisables (décrochage volets sortis -> 85 kt),
    // vert = décrochage lisse -> vitesse max en air agité, jaune = air calme seulement, rouge = à ne jamais dépasser
    const angleOf = (v) => deg(-160 + (Math.min(v, 200) / 200) * 320);
    arc(ctx, cx, cy, r * 0.93, angleOf(43), angleOf(85), '#ddd', 8);
    arc(ctx, cx, cy, r * 0.86, angleOf(49), angleOf(128), '#2ecc40', 9);
    arc(ctx, cx, cy, r * 0.86, angleOf(128), angleOf(163), '#ffdc00', 9);
    arc(ctx, cx, cy, r * 0.86, angleOf(163), angleOf(165), '#ff2a1a', 12);
    ticks(ctx, cx, cy, r, { from: angleOf(0), to: angleOf(200), count: 40, every: 4, size: 17, labels: (i) => (i >= 2 ? String(i * 20) : null) }); // chiffres à partir de 40 kt, comme sur un C172
    caption(ctx, cx, cy - r * 0.13, 'KT', 15); // au-dessus du pivot : l'aiguille au repos ne le cache pas
    caption(ctx, cx, cy - r * 0.3, 'ANÉMO', 14);
    needle(ctx, cx, cy, r * 0.85, angleOf(Math.max(0, knots)));
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

function altimeter(ctx, cx, cy, r, feet) {
    bezel(ctx, cx, cy, r);
    ticks(ctx, cx, cy, r, { from: 0, to: deg(360), count: 50, every: 5, labels: (i) => (i < 10 ? String(i) : null) });
    // Fenêtre numérique
    ctx.fillStyle = '#222';
    ctx.fillRect(cx - 56, cy + r * 0.28, 112, 32);
    ctx.fillStyle = '#7fff7f';
    ctx.font = 'bold 22px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(feet)} ft`, cx, cy + r * 0.28 + 17);
    caption(ctx, cx, cy - r * 0.3, 'ALT ×100 ft', 13);
    needle(ctx, cx, cy, r * 0.5, deg((feet / 10000) * 360), 10);  // petite aiguille : 10 000 ft par tour
    needle(ctx, cx, cy, r * 0.88, deg((feet / 1000) * 360), 6);   // grande aiguille : 1 000 ft par tour
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

// Variomètre en pieds par minute : ±2 000 ft/min, graduations tous les 100 ft/min, chiffres en centaines
function variometer(ctx, cx, cy, r, fpm) {
    bezel(ctx, cx, cy, r);
    const angleOf = (v) => deg(-90 + (MathUtils.clamp(v, -2000, 2000) / 2000) * 170);
    ticks(ctx, cx, cy, r, { from: angleOf(-2000), to: angleOf(2000), count: 40, every: 5,
        labels: (i) => (i === 0 || i === 4 ? null : String(Math.abs(i * 5 - 20))) }); // un seul « 20 » (en haut)
    caption(ctx, cx + r * 0.2, cy - r * 0.32, 'MONTÉE', 13);
    caption(ctx, cx + r * 0.2, cy + r * 0.32, 'DESCENTE', 13);
    caption(ctx, cx + r * 0.1, cy + r * 0.15, '×100 ft/min', 11);
    needle(ctx, cx, cy, r * 0.85, angleOf(fpm));
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

function stallLed(ctx, x, y, on) {
    ctx.fillStyle = '#0b0b0c';
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 9);
    g.addColorStop(0, on ? '#ffd0c8' : '#7a2a24');
    g.addColorStop(0.5, on ? '#ff2a1a' : '#4a1512');
    g.addColorStop(1, on ? '#a80f05' : '#2a0b09');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    if (on) {
        // Halo autour de la LED allumée
        const halo = ctx.createRadialGradient(x, y, 8, x, y, 26);
        halo.addColorStop(0, 'rgba(255, 60, 40, 0.55)');
        halo.addColorStop(1, 'rgba(255, 60, 40, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.fill();
    }
    caption(ctx, x, y + 24, 'STALL', 11);
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

// Trim de profondeur : angle du tab en degrés, PIQ (butée à piquer) en haut, CAB en bas, repère de décollage (T/O) ;
// sous l'échelle : l'angle et la vitesse que l'avion tient manche lâché
function trimIndicator(ctx, x, y, trimDeg, takeoffDeg, [minDeg, maxDeg], trimKnots) {
    const h = 190, top = y + 46, bottom = y + h - 30;
    ctx.fillStyle = '#151618';
    ctx.fillRect(x, y, 76, h);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, 76, h);
    caption(ctx, x + 38, y + 14, 'TRIM', 13);
    caption(ctx, x + 38, y + 32, 'PIQ', 12);
    caption(ctx, x + 38, y + h - 12, 'CAB', 12);
    const yOf = (d) => top + ((d - minDeg) / (maxDeg - minDeg)) * (bottom - top);
    ctx.fillStyle = '#c4c8cc';
    ctx.font = 'bold 11px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let d = Math.ceil(minDeg / 4) * 4; d <= maxDeg; d += 4) {
        const major = d % 20 === 0;
        ctx.fillRect(x + 28, yOf(d) - 1, major ? 14 : 8, 2);
        if (d === 0) ctx.fillText('0', x + 25, yOf(d));
    }
    // Repère de décollage
    ctx.fillStyle = '#39d353';
    ctx.fillRect(x + 26, yOf(takeoffDeg) - 2, 18, 4);
    ctx.fillText('T/O', x + 25, yOf(takeoffDeg));
    const py = yOf(trimDeg);
    ctx.fillStyle = '#ff9f1a';
    ctx.beginPath();
    ctx.moveTo(x + 46, py);
    ctx.lineTo(x + 62, py - 8);
    ctx.lineTo(x + 62, py + 8);
    ctx.fill();
    // Angle du tab et vitesse tenue manche lâché (avec ces volets) : pour aller plus vite, trimer à piquer
    ctx.fillStyle = '#050505';
    ctx.fillRect(x, y + h + 6, 76, 46);
    ctx.strokeRect(x, y + h + 6, 76, 46);
    ctx.fillStyle = '#39ff6a';
    ctx.font = 'bold 15px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'center';
    const sign = trimDeg > 0.5 ? '+' : '';
    ctx.fillText(`${sign}${Math.round(trimDeg)}°`, x + 38, y + h + 19);
    ctx.fillText(`${Math.round(trimKnots)} KT`, x + 38, y + h + 39);
}

function radio(ctx, x, y, label, active, standby, powered = true) {
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
    if (powered) ctx.fillText(`${active}  ${standby}`, x + 70, y + 36);
    caption(ctx, x + 30, y + 36, label, 14);
}

// --- ILS ---------------------------------------------------------------------------

const ILS_BUTTON = { x: 1305, y: 236, width: 110, height: 62 };
// Indicateur VOR en haut à droite (hors de la zone cachée par le manche droit) et son bouton OBS cliquable
const VOR_GAUGE = { x: 1458, y: 138, r: 62 };
const OBS_KNOB = { x: VOR_GAUGE.x - 60, y: VOR_GAUGE.y + 62, r: 20 };

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
    caption(ctx, cx, cy + r * 1.22, `${(ils.distance / NM).toFixed(1)} NM · idéal ${Math.round(ils.glideHeight * FT)} ft`, 13);
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

// --- Cabine ------------------------------------------------------------------------

class Cockpit {
    constructor() {
        this.group = new Group();
        this.eye = EYE.clone();
        this._time = 0;
        this._sinceDraw = Infinity;
        this._smooth = { pitch: 0, roll: 0, yaw: 0, rpm: 0, slip: 0 };
        this._night = 0;
        this._gyro = null;
        this.clickables = [];                         // surfaces et boutons cliquables (voir controlAt)
        this._hotspots = { panel: new Hotspots() };

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
        this.panel.userData.surface = 'panel';
        this.clickables.push(this.panel);
        // Boîtier du tableau : le plan des instruments n'a qu'une face (vers le pilote) ; vu de l'extérieur,
        // à travers le pare-brise, on voit ce dos plein au lieu d'un trou
        add(new Mesh(new BoxGeometry(PANEL.width + 0.06, PANEL.height + 0.02, 0.2), plastic), 0, PANEL.y, PANEL.z - 0.105);
        add(new Mesh(new BoxGeometry(1.26, 0.05, 0.3), plastic), 0, -0.08, -0.88);
        // Planche inclinée de l'avant de la casquette jusqu'au bas du pare-brise du modèle extérieur
        // (y -0,24 / z -1,36 dans ce repère) : comble le vide vu à travers le pare-brise depuis l'extérieur
        const deck = add(new Mesh(new BoxGeometry(1.3, 0.02, 0.43), plastic), 0, -0.17, -1.19);
        deck.rotation.x = -Math.atan2(0.2, 0.38);
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

        // Manches (yokes) : la colonne coulisse dans le tableau (poussé / tiré), le volant tourne
        this._yokes = [-0.3, 0.3].map((x) => {
            const column = new Group();
            column.position.set(x, -0.475, YOKE_Z); // sort sous les instruments, comme dans un vrai Cessna
            // Colonne : dépasse de 16 cm au neutre, le reste est caché dans le tableau (encore dedans manche poussé)
            const shaft = new Mesh(new CylinderGeometry(0.018, 0.018, 0.4, 10), frame);
            shaft.rotation.x = Math.PI / 2;
            shaft.position.z = -0.04;
            const wheel = new Group();
            wheel.position.z = 0.16;
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

        // Manette des gaz (tirette noire au centre du tableau) : le groupe est centré sur le bouton,
        // la tige part du bouton et s'enfonce dans le tableau (plein gaz : enfoncée, réduit : tirée vers le pilote)
        this._throttle = new Group();
        const [tx, ty] = [-0.06, -0.46];
        this._throttle.position.set(tx, ty, PANEL.z);
        const rod = new Mesh(new CylinderGeometry(0.006, 0.006, 0.12, 8), new MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 }));
        rod.rotation.x = Math.PI / 2;
        rod.position.z = -0.06;
        this._throttleKnob = new Mesh(new SphereGeometry(0.022, 16, 12), black);
        this._throttleKnob.scale.set(1, 1, 0.7);
        this._throttle.add(rod, this._throttleKnob);
        this.group.add(this._throttle);
        this._throttleCanvas = toCanvas(tx, ty);
        this._throttleKnob.userData.control = 'throttle';
        // Manette de mixture : bouton rouge moleté, sous le compte-tours (tirée = appauvrie, à fond = étouffoir)
        this._mixture = new Group();
        const [mxm, mym] = [0.04, ty];   // même hauteur que la manette des gaz, à sa droite
        this._mixture.position.set(mxm, mym, PANEL.z);
        const mixtureRod = rod.clone();
        const red = new MeshStandardMaterial({ color: 0xc62d1f, roughness: 0.5 });
        const mixtureKnob = new Mesh(new SphereGeometry(0.02, 16, 12), red);
        mixtureKnob.scale.set(1, 1, 0.7);
        mixtureKnob.userData.control = 'mixture';
        const ridges = new Mesh(new CylinderGeometry(0.027, 0.027, 0.012, 10), red);
        ridges.rotation.x = Math.PI / 2;
        ridges.position.z = -0.006;
        this._mixture.add(mixtureRod, mixtureKnob, ridges);
        this.group.add(this._mixture);
        this._mixtureCanvas = toCanvas(mxm, mym);
        this.clickables.push(this._throttleKnob, mixtureKnob);

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
        add(new Mesh(new BoxGeometry(0.22, 0.25, 0.16), plastic), 0, PEDESTAL.y, PEDESTAL.z - 0.082);
        this._pedestal = canvasPlane(PEDESTAL, 'pedestal');
        // Manette de frein (gâchette) sur le flanc gauche du pupitre, à côté de la molette de trim :
        // tirée vers le haut = freins serrés
        this._brakeLever = new Group();
        this._brakeLever.position.set(-0.112, -0.69, PEDESTAL.z - 0.03);
        const brakeArm = new Mesh(new BoxGeometry(0.014, 0.014, 0.075), black);
        brakeArm.position.z = 0.0375;
        const brakeGrip = new Mesh(new BoxGeometry(0.02, 0.026, 0.035), new MeshStandardMaterial({ color: 0xb02418, roughness: 0.5 }));
        brakeGrip.position.z = 0.085;
        for (const part of [brakeArm, brakeGrip]) part.userData.control = 'brake';
        const brakePivot = new Mesh(new CylinderGeometry(0.012, 0.012, 0.02, 12), frame);
        brakePivot.rotation.z = Math.PI / 2;
        this._brakeLever.add(brakeArm, brakeGrip, brakePivot);
        this.group.add(this._brakeLever);
        this.clickables.push(brakeArm, brakeGrip);
        add(this._pedestal.mesh, PEDESTAL.x, PEDESTAL.y, PEDESTAL.z);
        this._fuelPlate = canvasPlane(FUEL_PLATE, 'fuel');
        this._fuelPlate.mesh.rotation.x = -Math.PI / 2;
        add(this._fuelPlate.mesh, FUEL_PLATE.x, FUEL_PLATE.y, FUEL_PLATE.z);

        // Commandes en 3D, posées sur les logements dessinés dans les canvas
        const pixel = (spec, cx, cy) => new Vector3(spec.x - spec.width / 2 + cx / PX_PER_M, spec.y + spec.height / 2 - cy / PX_PER_M, spec.z);
        this._controls3D = new Controls3D(this.group, {
            panelPoint: (cx, cy) => pixel({ ...PANEL, x: 0 }, cx, cy),
            pedestalPoint: (cx, cy) => pixel(PEDESTAL, cx, cy),
            floorPoint: (cx, cy) => new Vector3(FUEL_PLATE.x - FUEL_PLATE.width / 2 + cx / PX_PER_M, FUEL_PLATE.y,
                FUEL_PLATE.z - FUEL_PLATE.height / 2 + cy / PX_PER_M),
            subTop: SUBPANEL_TOP,
            obs: OBS_KNOB,
        });
        this._controls3D.finalize();
        this.clickables.push(...this._controls3D.clickables);

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
        // Tableau rétroéclairé : blanc de jour (lisible à l'ombre de la casquette), ambré la nuit et
        // en tempête, comme l'éclairage d'instruments d'un vrai avion (n'éblouit pas)
        const warm = Math.min(1, night * 2);
        this._panelMaterial.emissive.set(0xffffff).lerp(PANEL_NIGHT_LIGHT, warm);
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
        const object = hit.object;
        const surface = object.userData.surface;
        if (!surface || !hit.uv) return null;
        const canvas = surface === 'panel' ? CANVAS : this[surface === 'pedestal' ? '_pedestal' : '_fuelPlate'].ctx.canvas;
        return this._hotspots[surface].at(hit.uv.x * canvas.width, (1 - hit.uv.y) * canvas.height);
    }

    _drawPedestal(state) {
        const trim = { deg: state.trim, min: state.trimLimits[0], max: state.trimLimits[1], takeoff: state.takeoffTrim };
        const p = this._pedestal, f = this._fuelPlate;
        this._hotspots.pedestal.clear();
        drawPedestal(p.ctx, this._hotspots.pedestal, p.ctx.canvas.width, p.ctx.canvas.height, state.systems, trim);
        p.texture.needsUpdate = true;
        this._hotspots.fuel.clear();
        drawFuelSelector(f.ctx, this._hotspots.fuel, f.ctx.canvas.width, f.ctx.canvas.height, state.systems);
        f.texture.needsUpdate = true;
    }

    setRain(intensity) {
        this.windshieldMaterial.uniforms.uIntensity.value = intensity;
        this._windshield.visible = intensity > 0 && !this._exterior;
    }

    // state : valeurs de PlaneControls (voir simulator.js)
    update(delta, state) {
        this._time += delta;
        const s = this._smooth;
        const k = 1 - Math.exp(-10 * delta);
        s.pitch += (state.inputs.pitch - s.pitch) * k;
        s.roll += (state.inputs.roll - s.roll) * k;
        s.yaw += (state.inputs.yaw - s.yaw) * k;
        s.rpm += ((state.crashed ? 0 : state.systems.rpm) - s.rpm) * (1 - Math.exp(-6 * delta));
        s.slip += (-s.yaw * 0.6 - s.slip) * (1 - Math.exp(-4 * delta));

        for (const yoke of this._yokes) {
            yoke.column.position.z = YOKE_Z + s.pitch * YOKE_TRAVEL;   // tiré vers le pilote pour cabrer
            yoke.wheel.rotation.z = s.roll * YOKE_TURN;                // volant tourné jusqu'à 90°
        }
        this._throttle.position.z = PANEL.z + 0.02 + (1 - state.throttle) * 0.08;
        this._mixture.position.z = PANEL.z + 0.02 + (1 - state.systems.mixture) * 0.08;
        this._controls3D.update({ systems: state.systems, flapLevel: state.flapLevel, trim: state.trim, vorCourse: state.vor?.course ?? 0 }, k);
        // Manette de frein : relevée quand les freins sont serrés (touche B ou manette)
        const brake = state.inputs.brake > 0 ? 1 : 0;
        this._brakeLever.rotation.x += (brake * 0.6 - 0.15 - this._brakeLever.rotation.x) * k;
        // Éclairage des instruments : rhéostat, alimentation électrique
        this._panelMaterial.emissiveIntensity = 0.12 + (0.38 + 0.4 * this._night) * state.systems.panelLighting;
        for (const material of this._sideMaterials) material.emissiveIntensity = this._panelMaterial.emissiveIntensity;

        const u = this.windshieldMaterial.uniforms;
        u.uTime.value = this._time;
        u.uSpeed.value = state.speed;

        // Le tableau de bord (canvas 1536×512, puis envoi à la carte graphique) est coûteux :
        // ~25 fois par seconde suffit pour des aiguilles fluides
        this._sinceDraw += delta;
        if (this._sinceDraw >= 1 / 25) {
            this._sinceDraw = 0;
            this._drawPanel(state);
            this._drawPedestal(state);
        }
    }

    _drawPanel(state) {
        const ctx = this._ctx;
        const { width: w, height: h } = CANVAS;
        const sys = state.systems;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        this._hotspots.panel.clear();

        // Fond du tableau (gris anthracite, légères vis)
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#2f3237');
        g.addColorStop(1, '#25272b');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        const r = 88, col = 190, [px] = toCanvas(EYE.x, 0);
        const top = 132, bottom = 368;
        airspeed(ctx, px - col, top, r, state.speed * KT);
        // Gyroscopes entraînés par la dépression (pompe du moteur) : figés moteur arrêté
        if (sys.vacuum || !this._gyro) this._gyro = { roll: state.roll, pitch: state.pitchDeg, heading: state.heading };
        attitude(ctx, px, top, r, this._gyro.roll, this._gyro.pitch);
        altimeter(ctx, px + col, top, r, state.altitude * FT);
        turnCoordinator(ctx, px - col, bottom, r, sys.turnCoordinatorPowered ? state.roll : 0, this._smooth.slip);
        if (!sys.turnCoordinatorPowered) {
            ctx.fillStyle = '#c0392b';
            ctx.fillRect(px - col - 24, bottom + r * 0.38, 48, 18);
            caption(ctx, px - col, bottom + r * 0.38 + 9, 'OFF', 13);
        }
        headingIndicator(ctx, px, bottom, r, this._gyro.heading);
        variometer(ctx, px + col, bottom, r, state.verticalSpeed * FT * 60);
        tachometer(ctx, 790, bottom - 40, 72, this._smooth.rpm);   // remonté : place pour l'étiquette de la mixture
        // Manette de mixture (rouge), sous le compte-tours
        const [mx, my] = this._mixtureCanvas;
        // Étiquette au-dessus du bouton, comme celle des gaz (dessous, le bouton en relief la cache vu du siège)
        caption(ctx, mx - 12, my - 34, `MIXTURE ${Math.round(sys.mixture * 100)} %`, 14);

        // Alarme de décrochage : petite LED rouge à gauche de l'anémomètre, clignote un peu avant le décrochage
        stallLed(ctx, px - col - r - 34, top - 30, state.stallWarning && Math.sin(this._time * 20) > 0);
        flapIndicator(ctx, 870, 60, state.flapSetting, state.flaps);
        trimIndicator(ctx, 870, 215, state.trim, state.takeoffTrim, state.trimLimits, state.trimSpeed * KT);

        const avionics = sys.avionicsPowered;
        radio(ctx, 960, 60, 'COM1', '118.30', '121.50', avionics);
        radio(ctx, 960, 150, 'NAV1', state.vor?.frequency ?? '113.50', '110.30', avionics);
        ilsButton(ctx, ILS_BUTTON, avionics ? state.ils : null);
        this._hotspots.panel.rect('ils', ILS_BUTTON.x, ILS_BUTTON.y, ILS_BUTTON.width, ILS_BUTTON.height);
        // Transpondeur
        radio(ctx, 960, 240, 'XPDR', '7000', 'ALT', avionics);
        // Instruments moteur et panneau d'alarmes (sous les radios)
        drawEngineGauges(ctx, 960, 372, sys);
        drawAnnunciators(ctx, 960, 438, 330, sys, this._time);
        // Sous-panneau : interrupteurs, disjoncteurs, volets
        drawSubpanel(ctx, this._hotspots.panel, SUBPANEL_TOP, w, h - SUBPANEL_TOP, sys, { level: state.flapLevel, position: state.flaps });

        // Repère de la manette des gaz
        const [tx, ty] = this._throttleCanvas;
        caption(ctx, tx, ty - 34, 'GAZ', 16);
        // À gauche du trou : vu de la place pilote, le bouton tiré se projette en dessous et un peu à droite
        caption(ctx, tx - 62, ty, `${Math.round(state.throttle * 100)} %`, 16);

        // Indicateur ILS (à la place de la boîte à gants)
        vorIndicator(ctx, VOR_GAUGE.x, VOR_GAUGE.y, VOR_GAUGE.r, avionics ? state.vor : null);
        this._hotspots.panel.circle('obs', OBS_KNOB.x, OBS_KNOB.y, OBS_KNOB.r + 6);
        ilsIndicator(ctx, 1385, 400, 82, avionics ? state.ils : null, this._time);

        this.panelTexture.needsUpdate = true;
    }
}

export { Cockpit, vorIndicator };
