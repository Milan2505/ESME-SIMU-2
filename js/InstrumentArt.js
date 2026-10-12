// Dessins du tableau de bord du Cessna 172 (Panel172.js en fait des pièces 3D) :
// - atlas des instruments : cadrans fixes, roses mobiles, aiguilles et drapeaux, dessinés une seule fois ;
// - façades des radios (boîte audio, NAV/COM, DME, transpondeur) ;
// - face du tableau (inscriptions, plaques, vis) ;
// - afficheurs (fréquences, DME, transpondeur, horloge, compteurs, calage altimétrique, alarmes), redessinés
//   seulement quand ce qu'ils affichent change.
// Angles des cadrans : 0 = midi, sens horaire (radians).

import { TANK_CAPACITY } from './Systems.js';

const FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const TAU = Math.PI * 2;
const deg = (d) => d * Math.PI / 180;

// --- Atlas : cases de 400 px, cadran de rayon 200 px (= rayon du cadran en 3D) -------------------------------
const ATLAS_SIZE = 2048;
const CELL = 400;
const R = 200;
const cell = (col, row, w = 1, h = 1) => ({ x: col * CELL, y: row * CELL, w: w * CELL, h: h * CELL });
const CELLS = {
    asi: cell(0, 0), aiRing: cell(1, 0), aiCard: cell(2, 0, 1, 2), alt: cell(3, 0), tc: cell(4, 0),
    planes: cell(0, 1), dgCard: cell(1, 1), dgOverlay: cell(3, 1), vsi: cell(4, 1),
    back: cell(0, 2), navCard: cell(1, 2), nav1Overlay: cell(2, 2), nav2Overlay: cell(3, 2), tach: cell(4, 2),
    fuel: cell(0, 3), egt: cell(1, 3), oil: cell(2, 3), vac: cell(3, 3), adfOverlay: cell(4, 3),
    needles: cell(0, 4), davtron: cell(1, 4), compass: cell(2, 4, 3, 1),
};
// Sprites (zone px de l'atlas et pivot dans la zone) : aiguilles de 170 px (0,85 rayon) pivot en bas
const needleSlot = (i) => ({ x: CELLS.needles.x + (i % 10) * 40, y: CELLS.needles.y + Math.floor(i / 10) * 200, w: 40, h: 200, px: 20, py: 175 });
const C = CELLS.compass;
const SPRITES = {
    asiNeedle: needleSlot(0), altLong: needleSlot(1), altShort: needleSlot(2), alt10k: needleSlot(3),
    vsiNeedle: needleSlot(4), tachNeedle: needleSlot(5), smallNeedle: needleSlot(6),
    aiPlane: { x: CELLS.planes.x, y: CELLS.planes.y, w: 400, h: 200, px: 200, py: 100 },
    tcPlane: { x: CELLS.planes.x, y: CELLS.planes.y + 200, w: 400, h: 200, px: 200, py: 100 },
    adfNeedle: { x: C.x, y: C.y + 170, w: 360, h: 40, px: 180, py: 20 },
    flagTO: { x: C.x + 370, y: C.y + 170, w: 80, h: 40, px: 40, py: 20 },
    flagFR: { x: C.x + 460, y: C.y + 170, w: 80, h: 40, px: 40, py: 20 },
    flagNAV: { x: C.x + 550, y: C.y + 170, w: 80, h: 40, px: 40, py: 20 },
    flagGS: { x: C.x + 640, y: C.y + 170, w: 80, h: 40, px: 40, py: 20 },
    flagOFF: { x: C.x + 730, y: C.y + 170, w: 80, h: 40, px: 40, py: 20 },
    ball: { x: C.x + 820, y: C.y + 170, w: 40, h: 40, px: 20, py: 20 },
    bankPointer: { x: C.x + 870, y: C.y + 170, w: 40, h: 40, px: 20, py: 20 },
    hdgBug: { x: C.x + 920, y: C.y + 170, w: 40, h: 40, px: 20, py: 20 },
    compassCard: { x: C.x, y: C.y, w: 1200, h: 160 },
};

// --- Échelles des instruments (valeur -> angle) -------------------------------------------------------------
const ASI_POINTS = [[0, 0], [40, 25], [60, 75], [80, 120], [100, 165], [120, 205], [140, 245], [160, 280], [180, 310], [200, 340]];
function asiAngle(kt) {
    const v = Math.max(0, Math.min(200, kt));
    for (let i = 1; i < ASI_POINTS.length; i++) {
        const [v1, a1] = ASI_POINTS[i], [v0, a0] = ASI_POINTS[i - 1];
        if (v <= v1) return deg(a0 + (a1 - a0) * (v - v0) / (v1 - v0));
    }
    return deg(340);
}
const vsiAngle = (fpm) => deg(-90 + Math.max(-2000, Math.min(2000, fpm)) / 2000 * 170);
const tachAngle = (rpm) => deg(-150 + Math.max(0, Math.min(3500, rpm)) / 3500 * 285);
// Demi-jauge (instruments moteur) : côté -1 gauche / 1 droit, valeur 0 (bas) -> 1 (haut)
const halfAngle = (side, value) => deg(side * (140 - 100 * Math.max(0, Math.min(1, value))));

// --- Outils de dessin -----------------------------------------------------------------------------------------
function polar(cx, cy, r, a) {
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
}

function text(ctx, str, x, y, size, color = '#f2f2f2', align = 'center', weight = 'bold', font = FONT) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const lines = String(str).split('\n');
    lines.forEach((line, i) => ctx.fillText(line, x, y + (i - (lines.length - 1) / 2) * size * 1.08));
}

function line(ctx, x0, y0, x1, y1, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
}

function tick(ctx, cx, cy, r0, r1, a, width, color = '#f2f2f2') {
    const [x0, y0] = polar(cx, cy, r0, a), [x1, y1] = polar(cx, cy, r1, a);
    line(ctx, x0, y0, x1, y1, width, color);
}

function band(ctx, cx, cy, r, a0, a1, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.min(a0, a1) - Math.PI / 2, Math.max(a0, a1) - Math.PI / 2);
    ctx.stroke();
}

function disc(ctx, cx, cy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
}

// Fond de cadran noir mat, très léger dégradé
function dialBack(ctx, cx, cy, r = R) {
    const g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#202124');
    g.addColorStop(1, '#0c0c0d');
    disc(ctx, cx, cy, r, g);
}

// Texte posé le long d'un rayon (lisible, droit)
function radialLabel(ctx, str, cx, cy, r, a, size, color = '#f2f2f2') {
    const [x, y] = polar(cx, cy, r, a);
    text(ctx, str, x, y, size, color);
}

// Dans une case de l'atlas : origine au coin, détourée
function inCell(ctx, c, draw) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.clip();
    ctx.translate(c.x, c.y);
    draw();
    ctx.restore();
}

// --- Instruments de vol --------------------------------------------------------------------------------------
function drawAsi(ctx) {
    const cx = R, cy = R;
    dialBack(ctx, cx, cy);
    band(ctx, cx, cy, R * 0.79, asiAngle(40), asiAngle(85), R * 0.07, '#f4f4f4');
    band(ctx, cx, cy, R * 0.88, asiAngle(48), asiAngle(129), R * 0.08, '#21b24b');
    band(ctx, cx, cy, R * 0.88, asiAngle(129), asiAngle(163), R * 0.08, '#f6d32d');
    tick(ctx, cx, cy, R * 0.74, R * 0.96, asiAngle(163), R * 0.035, '#e5281f');
    for (let v = 40; v <= 200; v += 5) {
        const major = v % 10 === 0;
        tick(ctx, cx, cy, R * (major ? 0.8 : 0.86), R * 0.96, asiAngle(v), major ? 5 : 3);
    }
    for (let v = 40; v <= 200; v += 20) radialLabel(ctx, String(v), cx, cy, R * 0.6, asiAngle(v), R * 0.17);
    text(ctx, 'AIRSPEED', cx, cy - R * 0.3, R * 0.085);
    text(ctx, 'KNOTS', cx, cy + R * 0.3, R * 0.1);
}

// Carte mobile de l'horizon : 2,1 rayons de large, 4,2 de haut ; horizon au centre, r/30 par degré d'assiette
const AI_PX_PER_R = 400 / 2.1;
function drawAiCard(ctx) {
    const w = 400, h = 800, cx = w / 2, cy = h / 2, k = AI_PX_PER_R / 30;
    const sky = ctx.createLinearGradient(0, 0, 0, cy);
    sky.addColorStop(0, '#1767b8');
    sky.addColorStop(1, '#4ba3ea');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, cy);
    const ground = ctx.createLinearGradient(0, cy, 0, h);
    ground.addColorStop(0, '#8a5a2e');
    ground.addColorStop(1, '#5a3618');
    ctx.fillStyle = ground;
    ctx.fillRect(0, cy, w, h - cy);
    // Lignes de fuite au sol
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    for (const a of [-60, -30, 30, 60]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.tan(deg(a)) * 160, cy + 160);
        ctx.stroke();
    }
    line(ctx, 0, cy, w, cy, 5, '#ffffff');
    for (let p = -25; p <= 25; p += 5) {
        if (p === 0) continue;
        const y = cy - p * k, half = AI_PX_PER_R * (p % 10 === 0 ? 0.3 : 0.15);
        line(ctx, cx - half, y, cx + half, y, 3, '#ffffff');
        if (p % 10 === 0) {
            text(ctx, String(Math.abs(p)), cx - half - 18, y, 20, '#ffffff');
            text(ctx, String(Math.abs(p)), cx + half + 18, y, 20, '#ffffff');
        }
    }
}

// Couronne d'inclinaison (tourne avec l'horizon) : bleue en haut, brune en bas, graduations 10/20/30/45/60/90
function drawAiRing(ctx) {
    const cx = R, cy = R, r0 = R * 0.76;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.arc(cx, cy, r0, 0, TAU, true);
    ctx.clip();
    ctx.fillStyle = '#2f86d8';
    ctx.fillRect(0, 0, 2 * R, R);
    ctx.fillStyle = '#7a4a22';
    ctx.fillRect(0, R, 2 * R, R);
    ctx.restore();
    for (const a of [10, 20, 30, 60, 90]) {
        for (const s of [-1, 1]) tick(ctx, cx, cy, r0, R * (a % 30 === 0 ? 0.98 : 0.9), deg(s * a), a % 30 === 0 ? 7 : 4, '#ffffff');
    }
    for (const s of [-1, 1]) {
        const [x, y] = polar(cx, cy, R * 0.86, deg(s * 45));
        disc(ctx, x, y, 7, '#ffffff');
    }
    // Repère zéro (triangle blanc)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r0 - 2);
    ctx.lineTo(cx - 13, cy - R * 0.97);
    ctx.lineTo(cx + 13, cy - R * 0.97);
    ctx.fill();
}

// Maquette d'avion de l'horizon (orange) et maquette du coordinateur de virage (blanche)
function drawPlanes(ctx) {
    // Horizon : demi-case du haut, centre (200, 100)
    ctx.fillStyle = '#ff8a12';
    ctx.strokeStyle = '#3a1d00';
    ctx.lineWidth = 2;
    const wing = (sign) => {
        ctx.beginPath();
        ctx.moveTo(200 + sign * 150, 96);
        ctx.lineTo(200 + sign * 52, 96);
        ctx.lineTo(200 + sign * 30, 118);
        ctx.lineTo(200 + sign * 20, 118);
        ctx.lineTo(200 + sign * 44, 106);
        ctx.lineTo(200 + sign * 150, 106);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    };
    wing(-1);
    wing(1);
    disc(ctx, 200, 101, 9, '#ff8a12');
    // Coordinateur : demi-case du bas, centre (200, 300) ; ailes de 1,5 rayon, fuselage rond, dérive
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.roundRect(200 - 150, 300 - 7, 300, 14, 7);
    ctx.fill();
    disc(ctx, 200, 300, 24, '#f4f4f4');
    ctx.fillRect(196, 300 - 46, 8, 30);
    ctx.fillRect(170, 300 - 50, 60, 8);
    disc(ctx, 200, 300, 8, '#222');
}

function drawAlt(ctx) {
    const cx = R, cy = R;
    dialBack(ctx, cx, cy);
    for (let i = 0; i < 50; i++) {
        const major = i % 5 === 0;
        tick(ctx, cx, cy, R * (major ? 0.8 : 0.88), R * 0.97, i / 50 * TAU, major ? 6 : 3);
    }
    for (let i = 0; i < 10; i++) radialLabel(ctx, String(i), cx, cy, R * 0.64, i / 10 * TAU, R * 0.2);
    text(ctx, 'ALTIMETER', cx, cy - R * 0.3, R * 0.085);
    text(ctx, '100 FEET', cx - R * 0.08, cy + R * 0.32, R * 0.065);
    // Fenêtre du calage (affichée par-dessus) et zone hachurée sous 10 000 ft
    ctx.fillStyle = '#000';
    ctx.fillRect(cx + R * 0.38, cy - R * 0.1, R * 0.36, R * 0.2);
    text(ctx, 'hPa', cx + R * 0.56, cy + R * 0.18, R * 0.06, '#cfcfcf');
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx + R * 0.02, cy + R * 0.4, R * 0.22, R * 0.14);
    ctx.clip();
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(cx, cy + R * 0.4, R * 0.3, R * 0.2);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    for (let i = -4; i < 8; i++) line(ctx, cx + i * 14, cy + R * 0.6, cx + i * 14 + 30, cy + R * 0.35, 6, '#111');
    ctx.restore();
}

function drawTc(ctx) {
    const cx = R, cy = R;
    dialBack(ctx, cx, cy);
    for (const a of [-90, 90]) tick(ctx, cx, cy, R * 0.74, R * 0.96, deg(a), 7);
    for (const a of [-110, 110]) tick(ctx, cx, cy, R * 0.74, R * 0.96, deg(a), 7);
    text(ctx, 'L', cx - R * 0.83, cy + R * 0.45, R * 0.13);
    text(ctx, 'R', cx + R * 0.83, cy + R * 0.45, R * 0.13);
    text(ctx, 'TURN COORDINATOR', cx, cy - R * 0.5, R * 0.075);
    text(ctx, 'D.C.\nELEC.', cx + R * 0.5, cy - R * 0.33, R * 0.05, '#cfcfcf');
    text(ctx, '2 MIN', cx, cy + R * 0.66, R * 0.08);
    text(ctx, 'NO PITCH\nINFORMATION', cx, cy + R * 0.82, R * 0.055);
    // Bille : tube de verre courbe
    ctx.fillStyle = '#d9dcdf';
    ctx.beginPath();
    ctx.ellipse(cx, cy + R * 0.42, R * 0.46, R * 0.1, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#9fa4a9';
    ctx.beginPath();
    ctx.ellipse(cx, cy + R * 0.46, R * 0.42, R * 0.05, 0, 0, TAU);
    ctx.fill();
    line(ctx, cx - R * 0.11, cy + R * 0.31, cx - R * 0.11, cy + R * 0.53, 4, '#111');
    line(ctx, cx + R * 0.11, cy + R * 0.31, cx + R * 0.11, cy + R * 0.53, 4, '#111');
}

// Rose (conservateur de cap, VOR, ADF) : graduations tous les 5°, chiffres tous les 30°
function drawRose(ctx, { numbersAt = 0.66, size = 0.17, letters = true } = {}) {
    const cx = R, cy = R;
    dialBack(ctx, cx, cy);
    for (let d = 0; d < 360; d += 5) {
        const major = d % 10 === 0;
        tick(ctx, cx, cy, R * (major ? 0.8 : 0.87), R * 0.96, deg(d), major ? 5 : 3);
    }
    for (let d = 0; d < 360; d += 30) {
        const label = letters ? { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] ?? String(d / 10) : String(d / 10);
        const [x, y] = polar(cx, cy, R * numbersAt, deg(d));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(deg(d));
        text(ctx, label, 0, 0, R * size);
        ctx.restore();
    }
}

function drawDgOverlay(ctx) {
    const cx = R, cy = R, orange = '#ff8a12';
    ctx.strokeStyle = orange;
    ctx.lineCap = 'round';
    line(ctx, cx, cy - R * 0.36, cx, cy + R * 0.34, 9, orange);
    line(ctx, cx - R * 0.32, cy - R * 0.04, cx + R * 0.32, cy - R * 0.04, 10, orange);
    line(ctx, cx - R * 0.14, cy + R * 0.3, cx + R * 0.14, cy + R * 0.3, 8, orange);
    ctx.lineCap = 'butt';
    ctx.fillStyle = orange;
    ctx.beginPath();
    ctx.moveTo(cx, cy - R * 0.78);
    ctx.lineTo(cx - 13, cy - R * 0.97);
    ctx.lineTo(cx + 13, cy - R * 0.97);
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    for (let a = 45; a < 360; a += 45) {
        const [x0, y0] = polar(cx, cy, R * 0.98, deg(a));
        const [x1, y1] = polar(cx, cy, R * 0.88, deg(a - 3));
        const [x2, y2] = polar(cx, cy, R * 0.88, deg(a + 3));
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.fill();
    }
}

// VOR : repères fixes (index de route, réciproque, points d'écart) ; glide (VOR 1) : échelle verticale à droite
function drawNavOverlay(ctx, glide) {
    const cx = R, cy = R;
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.moveTo(cx, cy - R * 0.76);
    ctx.lineTo(cx - 14, cy - R * 0.97);
    ctx.lineTo(cx + 14, cy - R * 0.97);
    ctx.fill();
    ctx.fillRect(cx - 4, cy + R * 0.8, 8, R * 0.17);
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 3;
    for (let i = -5; i <= 5; i++) {
        if (i === 0) continue;
        ctx.beginPath();
        ctx.arc(cx + i * R * 0.12, cy, 6, 0, TAU);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.07, 0, TAU);
    ctx.stroke();
    if (glide) {
        for (let i = -4; i <= 4; i++) {
            if (i === 0) continue;
            ctx.beginPath();
            ctx.arc(cx + R * 0.62, cy + i * R * 0.12, 5, 0, TAU);
            ctx.stroke();
        }
        line(ctx, cx + R * 0.56, cy, cx + R * 0.68, cy, 3, '#f4f4f4');
        text(ctx, 'GS', cx - R * 0.5, cy - R * 0.38, R * 0.07, '#cfcfcf');
    }
    text(ctx, 'NAV', cx, cy + R * 0.45, R * 0.07, '#cfcfcf');
}

function drawAdfOverlay(ctx) {
    const cx = R, cy = R;
    ctx.fillStyle = '#ff8a12';
    ctx.beginPath();
    ctx.moveTo(cx, cy - R * 0.76);
    ctx.lineTo(cx - 14, cy - R * 0.97);
    ctx.lineTo(cx + 14, cy - R * 0.97);
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    for (let a = 45; a < 360; a += 45) {
        const [x, y] = polar(cx, cy, R * 0.92, deg(a));
        disc(ctx, x, y, 5, '#f4f4f4');
    }
    text(ctx, 'ADF', cx, cy + R * 0.42, R * 0.08, '#cfcfcf');
    // Maquette fixe au centre
    line(ctx, cx - R * 0.16, cy + R * 0.02, cx + R * 0.16, cy + R * 0.02, 5, '#cfcfcf');
    line(ctx, cx, cy - R * 0.12, cx, cy + R * 0.16, 5, '#cfcfcf');
}

function drawVsi(ctx) {
    const cx = R, cy = R;
    dialBack(ctx, cx, cy);
    for (let v = -2000; v <= 2000; v += 100) {
        const major = v % 500 === 0;
        tick(ctx, cx, cy, R * (major ? 0.78 : 0.87), R * 0.97, vsiAngle(v), major ? 6 : 3);
    }
    for (const v of [500, 1000, 1500, 2000]) {
        for (const s of v === 2000 ? [1] : [-1, 1]) radialLabel(ctx, String(v / 100), cx, cy, R * 0.6, vsiAngle(s * v), R * 0.17);
    }
    radialLabel(ctx, '0', cx, cy, R * 0.6, vsiAngle(0), R * 0.17);
    text(ctx, 'UP', cx - R * 0.42, cy - R * 0.33, R * 0.09);
    text(ctx, 'DOWN', cx - R * 0.38, cy + R * 0.33, R * 0.09);
    text(ctx, 'VERTICAL SPEED', cx + R * 0.1, cy - R * 0.12, R * 0.075);
    text(ctx, '100 FEET PER MINUTE', cx + R * 0.1, cy + R * 0.04, R * 0.055);
}

function drawTach(ctx) {
    const cx = R, cy = R;
    dialBack(ctx, cx, cy);
    band(ctx, cx, cy, R * 0.9, tachAngle(2100), tachAngle(2700), R * 0.08, '#21b24b');
    tick(ctx, cx, cy, R * 0.8, R * 0.98, tachAngle(2700), 8, '#e5281f');
    for (let v = 0; v <= 3500; v += 100) {
        const major = v % 500 === 0;
        tick(ctx, cx, cy, R * (major ? 0.8 : 0.87), R * 0.96, tachAngle(v), major ? 6 : 3);
    }
    for (let v = 500; v <= 3500; v += 500) {
        if (v === 3500) continue;
        radialLabel(ctx, String(v / 100), cx, cy, R * 0.63, tachAngle(v), R * 0.17);
    }
    text(ctx, 'RPM', cx, cy - R * 0.32, R * 0.09);
    text(ctx, 'X100', cx, cy - R * 0.2, R * 0.06);
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - R * 0.36, cy + R * 0.34, R * 0.72, R * 0.2);
    text(ctx, 'HOURS', cx, cy + R * 0.64, R * 0.07);
}

// Instrument moteur double : deux demi-échelles autour d'un pivot central
function halfScale(ctx, side, { green = null, red = null, labels = [], ticks = 5 }) {
    const cx = R, cy = R;
    for (let i = 0; i < ticks; i++) {
        const v = i / (ticks - 1);
        tick(ctx, cx, cy, R * 0.74, R * 0.9, halfAngle(side, v), 5);
    }
    if (green) band(ctx, cx, cy, R * 0.83, halfAngle(side, green[0]), halfAngle(side, green[1]), R * 0.09, '#21b24b');
    if (red) tick(ctx, cx, cy, R * 0.72, R * 0.94, halfAngle(side, red), 7, '#e5281f');
    for (const [v, str] of labels) radialLabel(ctx, str, cx, cy, R * 0.56, halfAngle(side, v), R * 0.12);
}

function sideWord(ctx, word, side) {
    const letters = word.split('');
    letters.forEach((ch, i) => text(ctx, ch, R + side * R * 0.86, R + (i - (letters.length - 1) / 2) * R * 0.15, R * 0.14));
}

function drawFuel(ctx) {
    dialBack(ctx, R, R);
    const labels = [[0, '0'], [0.2, '5'], [0.4, '10'], [0.6, '15'], [0.8, '20'], [1, '25']];
    halfScale(ctx, -1, { labels, ticks: 6, red: 0 });
    halfScale(ctx, 1, { labels, ticks: 6, red: 0 });
    sideWord(ctx, 'LEFT', -1);
    sideWord(ctx, 'RIGHT', 1);
    text(ctx, 'FUEL', R, R * 0.26, R * 0.13);
    text(ctx, 'QTY', R, R * 1.72, R * 0.14);
    text(ctx, 'GALLONS', R, R * 1.42, R * 0.06, '#cfcfcf');
    text(ctx, `${TANK_CAPACITY} GAL USABLE EACH`, R, R * 1.52, R * 0.045, '#cfcfcf');
}

function drawEgt(ctx) {
    dialBack(ctx, R, R);
    halfScale(ctx, -1, { ticks: 9 });
    halfScale(ctx, 1, { green: [0.25, 0.65], labels: [[0, '0'], [0.5, '10'], [1, '19']], ticks: 5 });
    sideWord(ctx, 'EGT', -1);
    text(ctx, 'F\nF', R * 1.62, R * 0.55, R * 0.13);
    text(ctx, 'FUEL\nFLOW', R * 1.4, R * 1.62, R * 0.06, '#cfcfcf');
    text(ctx, 'GAL/HR', R * 1.32, R * 1.38, R * 0.05, '#cfcfcf');
}

function drawOil(ctx) {
    dialBack(ctx, R, R);
    halfScale(ctx, -1, { green: [0.17, 1], red: 1, labels: [[0, '75'], [0.5, '150'], [1, '245']], ticks: 5 });
    halfScale(ctx, 1, { green: [0.43, 0.78], red: 1, labels: [[0, '0'], [0.5, '60'], [1, '115']], ticks: 5 });
    sideWord(ctx, 'TEMP', -1);
    sideWord(ctx, 'PRESS', 1);
    text(ctx, 'OIL', R, R * 1.72, R * 0.14);
}

function drawVac(ctx) {
    dialBack(ctx, R, R);
    halfScale(ctx, -1, { green: [0.375, 0.625], labels: [[0, '3'], [0.5, '5'], [1, '7']], ticks: 5 });
    halfScale(ctx, 1, { labels: [[0, '-60'], [0.5, '0'], [1, '+60']], ticks: 5 });
    sideWord(ctx, 'VAC', -1);
    sideWord(ctx, 'AMP', 1);
}

function drawDavtronFace(ctx) {
    const cx = R, cy = R;
    disc(ctx, cx, cy, R, '#151516');
    text(ctx, 'O.A.T.', cx - R * 0.38, cy - R * 0.74, R * 0.1);
    text(ctx, 'VOLTS', cx + R * 0.38, cy - R * 0.74, R * 0.1);
    disc(ctx, cx, cy - R * 0.76, 9, '#e5281f');
    // Logements des deux afficheurs (affichés par-dessus)
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.roundRect(cx - R * 0.68, cy - R * 0.6, R * 1.36, R * 1.06, 14);
    ctx.fill();
    text(ctx, 'SELECT', cx - R * 0.42, cy + R * 0.6, R * 0.1);
    text(ctx, 'CONTROL', cx + R * 0.42, cy + R * 0.6, R * 0.1);
    text(ctx, 'DAVTRON', cx, cy + R * 0.86, R * 0.08, '#bfbfbf');
}

// --- Aiguilles et drapeaux ---------------------------------------------------------------------------------------
// Aiguille dans une case de 40 x 200, pivot (20, 175) : longueur 170 px, queue 25 px
function needleShape(ctx, slot, { width = 12, tip = 6, tail = 25, color = '#f4f4f4', hub = true, length = 170 }) {
    const { x, y, px, py } = slot, cx = x + px, cy = y + py;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - width / 2, cy + tail);
    ctx.lineTo(cx - tip / 2, cy - length + 14);
    ctx.lineTo(cx, cy - length);
    ctx.lineTo(cx + tip / 2, cy - length + 14);
    ctx.lineTo(cx + width / 2, cy + tail);
    ctx.closePath();
    ctx.fill();
    if (hub) disc(ctx, cx, cy, 12, '#2a2a2c');
}

function drawSprites(ctx) {
    const S = SPRITES;
    needleShape(ctx, S.asiNeedle, { width: 13, tip: 5 });
    needleShape(ctx, S.altLong, { width: 9, tip: 5 });
    needleShape(ctx, S.altShort, { width: 22, tip: 14, length: 110 });
    // 10 000 ft : fine aiguille terminée par un triangle
    needleShape(ctx, S.alt10k, { width: 4, tip: 4, hub: false, length: 175 });
    {
        const { x, y, px, py } = S.alt10k;
        ctx.fillStyle = '#f4f4f4';
        ctx.beginPath();
        ctx.moveTo(x + px, y + py - 175);
        ctx.lineTo(x + px - 14, y + py - 150);
        ctx.lineTo(x + px + 14, y + py - 150);
        ctx.fill();
    }
    needleShape(ctx, S.vsiNeedle, { width: 13, tip: 5 });
    needleShape(ctx, S.tachNeedle, { width: 13, tip: 5 });
    needleShape(ctx, S.smallNeedle, { width: 16, tip: 8, length: 160 });
    // ADF : flèche jaune traversant le cadran (zone horizontale, pointe vers la droite)
    {
        const { x, y, w, h } = S.adfNeedle, cy = y + h / 2;
        ctx.fillStyle = '#ffd21a';
        ctx.fillRect(x + 20, cy - 4, w - 60, 8);
        ctx.beginPath();
        ctx.moveTo(x + w - 2, cy);
        ctx.lineTo(x + w - 46, cy - 15);
        ctx.lineTo(x + w - 46, cy + 15);
        ctx.fill();
        ctx.fillRect(x + 4, cy - 10, 26, 20);
        disc(ctx, x + w / 2, cy, 12, '#2a2a2c');
    }
    const flag = (s, label, bg, fg = '#fff', stripes = false) => {
        ctx.fillStyle = bg;
        ctx.fillRect(s.x + 2, s.y + 4, s.w - 4, s.h - 8);
        if (stripes) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(s.x + 2, s.y + 4, s.w - 4, s.h - 8);
            ctx.clip();
            for (let i = -2; i < 8; i++) line(ctx, s.x + i * 14, s.y + s.h, s.x + i * 14 + 20, s.y, 5, '#f4f4f4');
            ctx.restore();
        }
        if (label) text(ctx, label, s.x + s.w / 2, s.y + s.h / 2 + 1, 24, fg);
    };
    flag(S.flagTO, 'TO', '#f4f4f4', '#111');
    flag(S.flagFR, 'FR', '#f4f4f4', '#111');
    flag(S.flagNAV, '', '#d8241b', '#fff', true);
    flag(S.flagGS, '', '#d8241b', '#fff', true);
    flag(S.flagOFF, 'OFF', '#d8241b');
    {
        const { x, y } = S.ball;
        const g = ctx.createRadialGradient(x + 14, y + 14, 2, x + 20, y + 20, 18);
        g.addColorStop(0, '#666');
        g.addColorStop(1, '#050505');
        disc(ctx, x + 20, y + 20, 18, g);
    }
    {
        const { x, y } = S.bankPointer;
        ctx.fillStyle = '#ff8a12';
        ctx.beginPath();
        ctx.moveTo(x + 20, y + 4);
        ctx.lineTo(x + 6, y + 36);
        ctx.lineTo(x + 34, y + 36);
        ctx.fill();
    }
    {
        const { x, y } = S.hdgBug;
        ctx.fillStyle = '#ff8a12';
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 4);
        ctx.lineTo(x + 38, y + 4);
        ctx.lineTo(x + 38, y + 36);
        ctx.lineTo(x + 28, y + 36);
        ctx.lineTo(x + 20, y + 22);
        ctx.lineTo(x + 12, y + 36);
        ctx.lineTo(x + 2, y + 36);
        ctx.fill();
    }
}

// Rose du compas : bande déroulée sur 360°, caps croissants vers la droite (comme vue de face dans l'avion)
function drawCompassCard(ctx) {
    const { x, y, w, h } = SPRITES.compassCard;
    ctx.fillStyle = '#141414';
    ctx.fillRect(x, y, w, h);
    for (let d = 0; d < 360; d += 5) {
        const px = x + (d / 360) * w, major = d % 10 === 0;
        line(ctx, px, y + h, px, y + h - (major ? 46 : 28), major ? 4 : 2.5, '#f4f4f4');
        if (d % 30 === 0) {
            const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] ?? String(d / 10);
            text(ctx, label, px, y + 50, label.length === 1 && /[NESW]/.test(label) ? 64 : 50);
        }
    }
}

// Atlas complet (dessiné une fois)
function drawAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS_SIZE;
    const ctx = canvas.getContext('2d');
    const c = CELLS;
    inCell(ctx, c.asi, () => drawAsi(ctx));
    inCell(ctx, c.aiCard, () => drawAiCard(ctx));
    inCell(ctx, c.aiRing, () => drawAiRing(ctx));
    inCell(ctx, c.planes, () => drawPlanes(ctx));
    inCell(ctx, c.alt, () => drawAlt(ctx));
    inCell(ctx, c.tc, () => drawTc(ctx));
    inCell(ctx, c.dgCard, () => drawRose(ctx));
    inCell(ctx, c.dgOverlay, () => drawDgOverlay(ctx));
    inCell(ctx, c.vsi, () => drawVsi(ctx));
    inCell(ctx, c.back, () => dialBack(ctx, R, R));
    inCell(ctx, c.navCard, () => {
        drawRose(ctx, { numbersAt: 0.68, size: 0.15 });
        // Centre transparent : les repères fixes et les aiguilles sont devant, le fond derrière
        ctx.globalCompositeOperation = 'destination-out';
        disc(ctx, R, R, R * 0.74, '#000');
        ctx.globalCompositeOperation = 'source-over';
    });
    inCell(ctx, c.nav1Overlay, () => drawNavOverlay(ctx, true));
    inCell(ctx, c.nav2Overlay, () => drawNavOverlay(ctx, false));
    inCell(ctx, c.adfOverlay, () => drawAdfOverlay(ctx));
    inCell(ctx, c.tach, () => drawTach(ctx));
    inCell(ctx, c.fuel, () => drawFuel(ctx));
    inCell(ctx, c.egt, () => drawEgt(ctx));
    inCell(ctx, c.oil, () => drawOil(ctx));
    inCell(ctx, c.vac, () => drawVac(ctx));
    inCell(ctx, c.davtron, () => drawDavtronFace(ctx));
    drawSprites(ctx);
    drawCompassCard(ctx);
    return canvas;
}

// --- Façades des radios (2048 x 2048 ; 6,83 px par px de la référence : petites inscriptions lisibles) ----------
const PLATE_SIZE = 2048;
const PLATE_SCALE = PLATE_SIZE / 300;
const PLATES = {
    audio: { y: 0, h: 63 }, navcom: { y: 63, h: 94 }, dme: { y: 157, h: 58 }, xpdr: { y: 215, h: 69 },
};

function drawPlates() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PLATE_SIZE;
    const ctx = canvas.getContext('2d');
    const plate = (key, color, draw) => {
        const p = PLATES[key];
        ctx.save();
        ctx.scale(PLATE_SCALE, PLATE_SCALE);
        ctx.translate(0, p.y);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 300, p.h);
        const g = ctx.createLinearGradient(0, 0, 0, p.h);
        g.addColorStop(0, 'rgba(255,255,255,0.08)');
        g.addColorStop(1, 'rgba(0,0,0,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 300, p.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(1, 1, 298, p.h - 2);
        draw(p.h);
        ctx.restore();
    };
    // Inscriptions 20 % plus grandes que celles du schéma sur les façades noires (lisibles depuis la place du pilote)
    let k = 1;
    const t = (str, x, y, size, color = '#ffffff', align = 'center') => text(ctx, str, x, y, size * k, color, align);
    // Boîte de mélange audio (gris clair) : marqueurs, rangées haut-parleur / casque, sélecteur micro
    plate('audio', '#c9cbce', (h) => {
        t('BENDIX/KING', 6, 6, 4, '#333', 'left');
        t('KMA 26', 294, h - 5, 3.6, '#333', 'right');
        ctx.fillStyle = '#2b2b2e';
        ctx.fillRect(10, 12, 24, 44);
        for (const [i, c] of [[0, '#3b6cff'], [1, '#e8b100'], [2, '#e8e8e8']]) {
            ctx.fillStyle = c;
            ctx.fillRect(14, 15 + i * 13, 8, 10);
        }
        t('A\nO\nM', 28, 33, 4, '#e8e8e8');
        t('MKR', 22, 9, 3.5, '#333');
        t('SPEAKER', 140, 8, 3.6, '#333');
        t('PHONE', 140, h - 5, 3.6, '#333');
        const names = ['TEL', 'COM 1', 'COM 2', 'NAV 1', 'NAV 2', 'DME', 'MKR', 'ADF', 'AUTO'];
        names.forEach((n, i) => t(n, 77 + i * 18, 33.5, 3.3, '#222'));
        t('COM1', 255, 10, 3.6, '#222');
        t('COM2', 282, 13, 3.6, '#222');
        t('TEL', 246, 26, 3.4, '#222');
        t('INT', 289, 25, 3.4, '#222');
        t('OFF', 248, 38, 3.4, '#222');
        t('EXT', 290, 38, 3.4, '#222');
        t('MIC', 268, h - 6, 3.6, '#222');
    });
    k = 1.2;
    // NAV/COM : afficheur sur toute la largeur, puis commandes COM (gauche) et NAV (droite)
    plate('navcom', '#18181a', (h) => {
        t('BENDIX/KING', 5, 5, 3.6, '#f2f2f2', 'left');
        t('KX 155A TSO', 295, 5, 3.6, '#f2f2f2', 'right');
        ctx.fillStyle = '#050505';
        ctx.fillRect(12, 9, 276, 30);
        t('COMM', 37, 52, 4.2);
        t('STBY', 92, 52, 4.2);
        t('PULL\nTEST', 20, 70, 3.6);
        t('OFF', 30, 84, 3.6);
        t('NAV', 194, 52, 4.2);
        t('STBY', 230, 52, 4.2);
        t('PULL\nIDENT', 178, 70, 3.6);
        t('CHAN', 86, 87, 3.6);
        t('PULL 25K', 127, 89, 3.6);
        t('MODE', 235, 87, 3.6);
        t('PULL OBS', 277, 89, 3.6);
        t('TIMER', 232, 80, 3.4);
    });
    plate('dme', '#18181a', (h) => {
        ctx.fillStyle = '#050505';
        ctx.fillRect(8, 5, 212, 25);
        t('NM', 30, 33, 3.6, '#c88a2a');
        t('MHZ', 120, 33, 3.6, '#c88a2a');
        t('BENDIX/KING', 6, h - 5, 3.6, '#f2f2f2', 'left');
        t('RMT', 236, 9, 3.6);
        t('FREQ', 254, 9, 3.6);
        t('GS/T', 274, 9, 3.6);
        t('DME', 290, 9, 3.6, '#f2f2f2', 'right');
        t('OFF', 210, 41, 3.6);
        t('KN 62A', 294, h - 5, 3.6, '#f2f2f2', 'right');
    });
    plate('xpdr', '#18181a', (h) => {
        t('ON', 33, 9, 3.8);
        t('SBY', 13, 16, 3.8);
        t('ALT', 49, 16, 3.8);
        t('OFF', 11, 33, 3.8);
        t('TST', 51, 33, 3.8);
        t('IDENT', 84, 40, 3.8);
        t('R', 84, 14, 3.8);
        t('KT 76A', 6, h - 9, 3.6, '#f2f2f2', 'left');
        t('BENDIX/KING', 6, h - 3, 3.4, '#f2f2f2', 'left');
    });
    return canvas;
}

// --- Face du tableau (px de la référence ; texture 1,5 px par px) -------------------------------------------------
const FACE = { x0: 330, y0: 120, width: 2048, height: 1024, scale: 1.5 };

function drawFace(layout) {
    const canvas = document.createElement('canvas');
    canvas.width = FACE.width * FACE.scale;
    canvas.height = FACE.height * FACE.scale;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(FACE.scale, 0, 0, FACE.scale, -FACE.x0 * FACE.scale, -FACE.y0 * FACE.scale);
    const t = (str, x, y, size, color = '#f0f0f0', align = 'center', weight = 'bold') => text(ctx, str, x, y, size, color, align, weight);
    // Tableau gris, plaque des instruments de vol un peu plus foncée ; ombre de la casquette en haut
    ctx.fillStyle = '#8b8c8e';
    ctx.fillRect(FACE.x0, FACE.y0, FACE.width, FACE.height);
    ctx.fillStyle = '#9a9b9d';
    ctx.fillRect(410, 190, 270, 660);
    ctx.fillStyle = '#818284';
    ctx.fillRect(683, 205, 680, 400);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(683, 205, 680, 400);
    const shade = ctx.createLinearGradient(0, 190, 0, 300);
    shade.addColorStop(0, 'rgba(0,0,0,0.35)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(FACE.x0, 190, FACE.width, 110);
    // Vis du tableau
    const screw = (x, y, r = 7, light = '#6f7174', dark = '#2c2d2f') => {
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
        g.addColorStop(0, light);
        g.addColorStop(1, dark);
        disc(ctx, x, y, r, g);
        line(ctx, x - r * 0.6, y, x + r * 0.6, y, 1.4, 'rgba(0,0,0,0.6)');
    };
    for (const [x, y] of [[695, 240], [858, 238], [1020, 232], [1185, 238], [1355, 250], [1505, 232], [1825, 233], [1977, 237],
        [2180, 310], [692, 600], [1015, 595], [1350, 600], [862, 622], [1180, 832], [880, 830], [1767, 822], [440, 225]]) screw(x, y);
    // Inscriptions et plaques
    t('MANEUVERING SPEED: 105 KIAS', 607, 266, 8.5);
    t('WARNING', 452, 355, 7, '#f0f0f0', 'left');
    t('ASSURE THAT ALL CONTAMINANTS,\nINCLUDING WATER, ARE REMOVED FROM\nFUEL AND FUEL SYSTEM BEFORE FLIGHT.\nFAILURE TO ASSURE CONTAMINANT FREE\nFUEL AND HEED ALL SAFETY INSTRUCTIONS\nAND OWNER ADVISORIES PRIOR TO FLIGHT\nCAN RESULT IN BODILY INJURY OR DEATH.',
        452, 390, 5.6, '#e6e6e6', 'left', 'normal');
    t('WARNING:', 682, 618, 8, '#f0f0f0', 'left');
    t('ASSURE THAT SEAT IS LOCKED IN POSITION PRIOR TO TAXI, TAKE-OFF, AND LANDING.\nFAILURE TO PROPERLY LATCH SEAT AND HEED ALL SAFETY INSTRUCTIONS CAN\nRESULT IN BODILY INJURY OR DEATH.',
        682, 642, 6.8, '#ececec', 'left', 'normal');
    t('WARNING:', 682, 662, 8, '#f0f0f0', 'left');
    t('PITOT HEAT MUST BE ON WHEN OPERATING BELOW 40° F IN\nINSTRUMENT METEOROLOGICAL CONDITIONS.', 682, 680, 6.8, '#ececec', 'left', 'normal');
    ctx.fillStyle = '#111';
    ctx.fillRect(680, 706, 128, 24);
    t('AVOID CONTINUOUS OPERATION\nAT OR BELOW 2000 RPM ABOVE\n20 IN. Hg MANIFOLD PRESSURE', 744, 718, 5.6);
    t('SMOKING PROHIBITED', 2172, 350, 8, '#e8e8e8', 'center', 'normal');
    ctx.fillStyle = '#111';
    ctx.fillRect(1920, 656, 98, 32);
    t('DO NOT OPERATE\nPITOT HEAT, PROP HEAT OR\nCABIN POWER CONVERTER\nWHILE OPERATING\nAIR CONDITIONING SYSTEM', 1969, 672, 5);
    // Cadres des passages des manches
    ctx.strokeStyle = '#2a2b2d';
    ctx.lineWidth = 3;
    for (const x of [930, 1767]) {
        ctx.beginPath();
        ctx.moveTo(x - 66, 850);
        ctx.lineTo(x - 66, 730);
        ctx.quadraticCurveTo(x - 66, 712, x - 48, 712);
        ctx.moveTo(x + 66, 850);
        ctx.lineTo(x + 66, 730);
        ctx.quadraticCurveTo(x + 66, 712, x + 48, 712);
        ctx.stroke();
    }
    // Rangée de disjoncteurs de l'avionique
    ctx.fillStyle = '#161618';
    ctx.beginPath();
    ctx.roundRect(438, 745, 417, 70, 6);
    ctx.fill();
    for (const b of layout.avionicsBreakers) t(b.label, b.x, 760, 6.5);
    // Plaque de l'ELT et compteur Hobbs
    ctx.fillStyle = '#232325';
    ctx.fillRect(1938, 280, 62, 92);
    t('ELT', 1969, 288, 8);
    t('ON', 1946, 307, 5);
    t('ARMED', 1948, 325, 4.6);
    t('RESET\nTEST', 1948, 343, 4.6);
    t('NOT FOR\nAIRCRAFT', 1969, 365, 3.5, '#bbb');
    ctx.fillStyle = '#1a1a1c';
    ctx.beginPath();
    ctx.roundRect(2022, 314, 80, 38, 6);
    ctx.fill();
    t('Honeywell', 2062, 320, 5, '#ddd');
    t('HOURS', 2062, 347, 4.2, '#ddd');
    // Ombre du passage de la pile radio
    ctx.fillStyle = '#0d0d0e';
    ctx.fillRect(1374, 296, 308, 465);

    // --- Sous-panneau noir -----------------------------------------------------------------------------------
    ctx.fillStyle = '#1c1c1e';
    ctx.fillRect(FACE.x0, 848, FACE.width, 300);
    ctx.fillStyle = '#111';
    ctx.fillRect(FACE.x0, 848, FACE.width, 3);
    for (const [x, y] of [[434, 860], [434, 985], [505, 860], [505, 985], [1050, 860], [1050, 985], [895, 860], [895, 985],
        [1690, 985], [2245, 860], [2245, 985]]) screw(x, y, 6, '#9a9b9d', '#3a3b3d');
    // Volets : échelle UP / 10° / 20° / FULL (fonds ; les inscriptions sont dans drawLabels)
    const f = layout.flaps;
    [['#2b3c9c'], ['#3da2e0'], ['#f4f4f4'], ['#f4f4f4']].forEach(([color], i) => {
        ctx.fillStyle = color;
        ctx.fillRect(f.scaleX - 12, f.top + i * f.step - f.step / 2, 24, f.step);
    });
    ctx.fillStyle = '#050505';
    ctx.fillRect(f.slotX - 4, f.top - 8, 8, f.step * 3 + 16);
    return canvas;
}
const MAG_LABELS = [['OFF', -70], ['R', -38], ['L', -8], ['BOTH', 24], ['START', 58]];

// --- Inscriptions du sous-panneau noir (couche transparente devant la face, 4 px par px de la référence) -----------
// Sur la face (1,5 px par px), une inscription de 6 px ne faisait que 9 pixels de haut : floue de près
const LABELS = { x0: 390, y0: 845, width: 1560, height: 160, scale: 4 };
const MAG_LABEL_RADIUS = 48;    // autour de l'anneau chromé de la clé (rayon extérieur ~36 px)

function drawLabels(layout) {
    const canvas = document.createElement('canvas');
    canvas.width = LABELS.width * LABELS.scale;
    canvas.height = LABELS.height * LABELS.scale;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(LABELS.scale, 0, 0, LABELS.scale, -LABELS.x0 * LABELS.scale, -LABELS.y0 * LABELS.scale);
    const t = (str, x, y, size, color = '#f4f4f4', align = 'center', weight = 'bold') => text(ctx, str, x, y, size, color, align, weight);
    const L = layout;
    t('MAGNETOS', L.mags.x, 861, 6.5);
    MAG_LABELS.forEach(([str, a]) => {
        const [x, y] = polar(L.mags.x, L.mags.y, MAG_LABEL_RADIUS, deg(a));
        t(str, x, y, 6);
    });
    t('MASTER', L.master.x, 876, 7);
    t('ON', L.master.x - 34, 900, 6);
    t('ALT BAT', L.master.x, 976, 6.5);
    L.breakers.forEach((b) => t(b.label, b.x, 866, 6.2));
    t('LAND\nLT', L.breakers[1].x, 906, 5.2);
    L.toggles.forEach((s) => {
        t(s.label, s.x, 934, 6.2);
        t('OFF', s.x, 990, 6.2);
    });
    // Accolade LIGHTS au-dessus des feux
    const lights = L.toggles.filter((s) => s.group === 'LIGHTS');
    const l0 = lights[0].x - 12, l1 = lights[lights.length - 1].x + 12;
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1.4;
    const lm = (l0 + l1) / 2;
    ctx.beginPath();
    ctx.moveTo(l0, 926); ctx.lineTo(l0, 920); ctx.lineTo(lm - 18, 920);
    ctx.moveTo(lm + 18, 920); ctx.lineTo(l1, 920); ctx.lineTo(l1, 926);
    ctx.stroke();
    t('LIGHTS', (l0 + l1) / 2, 920, 6.2);
    t('AVIONICS\nMASTER', L.avionics.x, 876, 6.2);
    t('ON', L.avionics.x - 30, 902, 6);
    t('ON', L.avionics.x + 30, 902, 6);
    t('BUS\n1', L.avionics.x - 11, 976, 5.6);
    t('BUS\n2', L.avionics.x + 11, 976, 5.6);
    t('ALT STATIC AIR\nPULL ON', L.altStatic.x, 937, 6.2);
    t('INST LT', L.panelLights.x, 936, 6.2);
    t('OFF', L.panelLights.x - 20, 990, 5.6);
    t('BRT', L.panelLights.x + 20, 990, 5.6);
    t('GA', L.ga.x, 905, 6.2);
    t('THROTTLE\nPUSH\nOPEN', L.throttle.x, 912, 6.2);
    t('MIXTURE\nPULL\nLEAN', L.mixture.x, 912, 6.2);
    // Volets : échelle UP / 10° / 20° / FULL
    const f = L.flaps;
    t('WING FLAPS', f.scaleX + 30, 853, 6.5);
    const zones = [['#2b3c9c', 'UP', '110'], ['#3da2e0', '10°', '85'], ['#f4f4f4', '20°', ''], ['#f4f4f4', 'FULL', '']];
    zones.forEach(([color, label, speed], i) => {
        const y0 = f.top + i * f.step - f.step / 2;
        if (speed) t(speed, f.scaleX, y0 + f.step / 2, 6.2, i === 0 ? '#fff' : '#111');
        t(label, f.scaleX + 30, y0 + f.step / 2, 6.2);
    });
    t('CABIN AIR\nPULL\nON', L.cabinAir.x - 46, L.cabinAir.y, 6.2);
    t('CABIN HEAT\nPULL\nON', L.cabinHeat.x - 46, L.cabinHeat.y, 6.2);
    return canvas;
}


// --- Afficheurs ------------------------------------------------------------------------------------------------
// Zones du canvas des afficheurs (1024 x 512) ; leur proportion est celle de la fenêtre en 3D
const DISPLAY = {
    navcom1: { x: 0, y: 0, w: 1000, h: 102 },
    navcom2: { x: 0, y: 104, w: 1000, h: 102 },
    dme: { x: 0, y: 208, w: 690, h: 81 },
    xpdr: { x: 0, y: 292, w: 680, h: 80 },
    annunciator: { x: 0, y: 376, w: 560, h: 100 },
    davtronTop: { x: 700, y: 208, w: 320, h: 88 },
    davtronBottom: { x: 700, y: 300, w: 320, h: 88 },
    tachHours: { x: 580, y: 392, w: 220, h: 56 },
    hobbs: { x: 580, y: 452, w: 180, h: 56 },
    kollsman: { x: 820, y: 392, w: 190, h: 100 },
};

// Chiffres à 7 segments (afficheurs à diodes) ; '.' et ':' étroits, ' ' blanc
const SEGMENTS = {
    0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
    '-': 'g', E: 'adefg', F: 'aefg', C: 'adef', A: 'abcefg', L: 'def', U: 'bcdef', T: 'defg', H: 'bcefg', P: 'abefg', r: 'eg',
};
function seg7(ctx, str, x, y, h, color, align = 'left') {
    const w = h * 0.52, gap = h * 0.2, t = h * 0.12;
    // Largeur d'un caractère : points étroits, « 1 » étroit (segments de droite seulement)
    const advance = (ch) => (ch === '.' || ch === ':' ? h * 0.18 : ch === '1' ? w * 0.3 + gap : w + gap);
    const width = [...str].reduce((s, ch) => s + advance(ch), 0);
    let px = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    ctx.save();
    ctx.fillStyle = color;
    const seg = (x0, y0, horizontal, length) => {
        ctx.beginPath();
        if (horizontal) {
            ctx.moveTo(x0, y0); ctx.lineTo(x0 + t / 2, y0 - t / 2); ctx.lineTo(x0 + length - t / 2, y0 - t / 2);
            ctx.lineTo(x0 + length, y0); ctx.lineTo(x0 + length - t / 2, y0 + t / 2); ctx.lineTo(x0 + t / 2, y0 + t / 2);
        } else {
            ctx.moveTo(x0, y0); ctx.lineTo(x0 + t / 2, y0 + t / 2); ctx.lineTo(x0 + t / 2, y0 + length - t / 2);
            ctx.lineTo(x0, y0 + length); ctx.lineTo(x0 - t / 2, y0 + length - t / 2); ctx.lineTo(x0 - t / 2, y0 + t / 2);
        }
        ctx.fill();
    };
    for (const ch of str) {
        if (ch === '.' || ch === ':') {
            if (ch === '.') ctx.fillRect(px + h * 0.02, y + h - t, t, t);
            else { ctx.fillRect(px + h * 0.03, y + h * 0.3, t, t); ctx.fillRect(px + h * 0.03, y + h * 0.65, t, t); }
            px += h * 0.18;
            continue;
        }
        const on = SEGMENTS[ch] ?? '';
        const s = 0.08 * h;   // inclinaison
        const half = h / 2;
        if (ch === '1') px -= w * 0.7;   // « 1 » : segments de droite, cellule étroite
        if (on.includes('a')) seg(px + s * 2, y, true, w);
        if (on.includes('g')) seg(px + s, y + half, true, w);
        if (on.includes('d')) seg(px, y + h, true, w);
        if (on.includes('f')) seg(px + s * 2, y, false, half);
        if (on.includes('b')) seg(px + w + s * 2, y, false, half);
        if (on.includes('e')) seg(px + s, y + half, false, half);
        if (on.includes('c')) seg(px + w + s, y + half, false, half);
        px += ch === '1' ? w * 0.7 + w * 0.3 + gap : w + gap;
    }
    ctx.restore();
    return width;
}

const LED = '#ff6a1a', LED_DIM = '#ff8c3a';

// state : chaînes et valeurs prêtes à afficher (voir Panel172._displayState)
function drawDisplays(ctx, d) {
    const fill = (r, color) => { ctx.fillStyle = color; ctx.fillRect(r.x, r.y, r.w, r.h); };
    const D = DISPLAY;
    for (const key of ['navcom1', 'navcom2']) {
        const r = D[key], s = d[key];
        fill(r, '#060606');
        if (!s) continue;
        const h = r.h * 0.48, y = r.y + r.h * 0.24;
        seg7(ctx, s.comActive, r.x + 15, y, h, LED);
        text(ctx, s.tx ? 'T' : '', r.x + 250, r.y + r.h * 0.32, r.h * 0.2, LED);
        text(ctx, 'R', r.x + 250, r.y + r.h * 0.66, r.h * 0.2, s.rx ? LED : '#2a1206');
        seg7(ctx, s.comStandby, r.x + 265, y, h, LED_DIM);
        ctx.fillStyle = '#3a1a08';
        ctx.fillRect(r.x + 492, r.y + 8, 3, r.h - 16);
        seg7(ctx, s.navActive, r.x + 508, y, h, LED);
        seg7(ctx, s.navStandby, r.x + 985, y, h, LED_DIM, 'right');
    }
    {
        const r = D.dme, s = d.dme;
        fill(r, '#060606');
        if (s) {
            const h = r.h * 0.62, y = r.y + r.h * 0.14;
            seg7(ctx, s.left, r.x + 210, y, h, LED, 'right');
            seg7(ctx, s.middle, r.x + 470, y, h, LED, 'right');
            seg7(ctx, s.right, r.x + 670, y, h, LED, 'right');
        }
    }
    {
        // Transpondeur : chiffres dans les fenêtres au-dessus des quatre boutons (mécaniques : toujours visibles)
        const r = D.xpdr, s = d.xpdr;
        fill(r, '#18181a');
        s.code.split('').forEach((ch, i) => {
            const cx = r.x + r.w * (0.125 + i * 0.25);
            ctx.fillStyle = '#050505';
            ctx.fillRect(cx - 34, r.y + 8, 68, r.h - 16);
            text(ctx, ch, cx, r.y + r.h / 2 + 2, r.h * 0.7, '#f4f4f4');
        });
    }
    {
        // Panneau d'alarmes : ambre (carburant, dépression), rouge (pression d'huile, tension)
        const r = D.annunciator, a = d.annunciator;
        fill(r, '#050505');
        const item = (str, x, y, lit, color) => text(ctx, str, r.x + x, r.y + y, 26, lit ? color : '#2b2b2b');
        item('L', 40, 30, a.lowFuelL, '#ffb000');
        item('LOW FUEL', 150, 30, a.lowFuelL || a.lowFuelR, '#ffb000');
        item('R', 260, 30, a.lowFuelR, '#ffb000');
        item('PITCH TRIM', 430, 30, a.pitchTrim, '#ffb000');
        item('OIL PRESS', 110, 72, a.oilPress, '#ff3b2f');
        item('L', 255, 72, a.vacL, '#ffb000');
        item('VAC', 310, 72, a.vacL || a.vacR, '#ffb000');
        item('R', 365, 72, a.vacR, '#ffb000');
        item('VOLTS', 470, 72, a.volts, '#ff3b2f');
    }
    for (const key of ['davtronTop', 'davtronBottom']) {
        // Afficheur à cristaux liquides rétroéclairé orange, chiffres sombres
        const r = D[key], s = d[key];
        fill(r, s ? '#e58a2e' : '#3a2a1a');
        if (!s) continue;
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, 'rgba(255,255,255,0.18)');
        g.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        seg7(ctx, s.value, r.x + r.w - 52, r.y + r.h * 0.18, r.h * 0.62, '#2a1a0a', 'right');
        text(ctx, s.unit, r.x + r.w - 26, r.y + r.h * 0.5, r.h * 0.36, '#2a1a0a');
        if (s.tag) text(ctx, s.tag, r.x + 22, r.y + r.h * 0.5, r.h * 0.26, '#2a1a0a');
    }
    // Compteurs mécaniques : chiffres blancs sur tambours noirs, dixièmes sur fond blanc
    const counter = (r, str) => {
        fill(r, '#0a0a0a');
        const n = str.length, w = r.w / n;
        [...str].forEach((ch, i) => {
            const last = i === n - 1;
            ctx.fillStyle = last ? '#efefef' : '#141414';
            ctx.fillRect(r.x + i * w + 2, r.y + 4, w - 4, r.h - 8);
            text(ctx, ch, r.x + (i + 0.5) * w, r.y + r.h / 2 + 1, r.h * 0.7, last ? '#111' : '#f2f2f2', 'center', 'bold', 'Arial, sans-serif');
        });
    };
    counter(D.tachHours, d.tachHours);
    counter(D.hobbs, d.hobbs);
    {
        const r = D.kollsman;
        fill(r, '#0a0a0a');
        text(ctx, d.kollsman, r.x + r.w / 2, r.y + r.h / 2 + 2, r.h * 0.62, '#f2f2f2', 'center', 'bold', 'Arial, sans-serif');
    }
}

export {
    ATLAS_SIZE, CELLS, SPRITES, R as ATLAS_RADIUS, AI_PX_PER_R, PLATES, PLATE_SIZE, PLATE_SCALE, FACE, LABELS, DISPLAY,
    asiAngle, vsiAngle, tachAngle, halfAngle, drawAtlas, drawPlates, drawFace, drawLabels, drawDisplays,
};
