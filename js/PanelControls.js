// Commandes cliquables de la cabine, dessinées sur les canvas du tableau de bord, du pupitre central et du plancher :
// sous-panneau (magnétos, master, avionique, disjoncteurs, interrupteurs de feux, éclairage du tableau, volets,
// aération), instruments moteur et panneau d'alarmes, molette de trim et robinet carburant, sélecteur de réservoir.
// Chaque dessin enregistre sa zone cliquable (Hotspots) ; l'action est faite par simulator.js.

import { BREAKERS, TOGGLES, MAGNETOS, TANK_CAPACITY } from './Systems.js';

const deg = (d) => d * Math.PI / 180;
const SOCKETS_ONLY = true;
const FONT = 'DejaVu Sans, Arial, sans-serif';

// Position des commandes (px des canvas ; sous-panneau : y depuis son haut). Les commandes elles-mêmes sont en 3D
// (Controls3D.js) ; les canvas n'en dessinent que le logement, les inscriptions et les échelles
const LAYOUT = {
    mags: { x: 78, y: 112, r: 30, angles: [-70, -38, -8, 24, 58] },
    master: { x: 150, y: 40, w: 34, h: 92 },
    avionics: { x: 262, w: 44 },
    breakers: { x0: 468, step: 70, y: 50 },
    toggles: { x0: 672, step: 58, y: 128 },
    panelLights: { x: 1380, y: 140 },
    flaps: { x: 1222, y: 32, h: 120 },
    pulls: { cabinAir1: { x: 1380, y: 62, color: 0x9a9da2 }, altStatic: { x: 1470, y: 62, color: 0xd23a2a } },
    elt: { x: 1470, y: 140 },
    trimWheel: { x: 30, y: 30, w: 46, h: 230 },
    fuelShutoff: { x: 192, y: 258 },
    fuelSelector: { y: 18 },     // centre : décalage vertical depuis le milieu de la plaque
};

// Zones cliquables d'un canvas : { id, x, y, w, h } (rectangle) ou { id, cx, cy, r } (disque)
class Hotspots {
    constructor() {
        this.list = [];
    }

    clear() {
        this.list.length = 0;
    }

    rect(id, x, y, w, h) {
        this.list.push({ id, x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
    }

    circle(id, cx, cy, r) {
        this.list.push({ id, x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, cx, cy, r });
    }

    // Contrôle sous le point (x, y) en pixels : { id, side (-1 gauche / 1 droite), vertical (-1 haut / 1 bas) }
    at(x, y) {
        for (let i = this.list.length - 1; i >= 0; i--) {
            const h = this.list[i];
            const inside = h.r !== undefined ? Math.hypot(x - h.cx, y - h.cy) <= h.r : x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h;
            if (inside) return { id: h.id, side: x < h.cx ? -1 : 1, vertical: y < h.cy ? -1 : 1, fraction: (y - h.y) / h.h };
        }
        return null;
    }
}

function label(ctx, text, x, y, size = 11, color = '#e8e8e8', align = 'center') {
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    text.split('\n').forEach((line, i, lines) => ctx.fillText(line, x, y + (i - (lines.length - 1) / 2) * (size + 1)));
}

function screw(ctx, x, y) {
    const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 8);
    g.addColorStop(0, '#6c6f74');
    g.addColorStop(1, '#232427');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
}

// Bouton rond moleté vu de face ; angle : repère blanc (0 = en haut)
function knob(ctx, x, y, r, angle = null, color = '#9a9da2') {
    ctx.fillStyle = '#0b0b0c';
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.fill();
    if (SOCKETS_ONLY) return;   // bouton en 3D : seulement son logement
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#f2f2f2');
    g.addColorStop(0.5, color);
    g.addColorStop(1, '#3a3c40');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (angle !== null) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(angle) * r * 0.2, y - Math.cos(angle) * r * 0.2);
        ctx.lineTo(x + Math.sin(angle) * r * 0.9, y - Math.cos(angle) * r * 0.9);
        ctx.stroke();
    }
}

// Interrupteur à bascule chromé : levier en haut = ON
function toggleSwitch(ctx, x, y, on) {
    ctx.fillStyle = '#0b0b0c';
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fill();
    if (SOCKETS_ONLY) return;
    const g = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, 13);
    g.addColorStop(0, '#e6e6e6');
    g.addColorStop(1, '#6d7075');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    // Levier : part du centre vers le haut (ON) ou le bas (OFF), boule au bout
    const dir = on ? -1 : 1;
    ctx.strokeStyle = '#d9dadc';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + dir * 20);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.arc(x, y + dir * 21, 6, 0, Math.PI * 2);
    ctx.fill();
}

// Disjoncteur : enclenché (enfoncé) ou sorti (collerette blanche visible)
function breaker(ctx, x, y, amps, on) {
    if (SOCKETS_ONLY) {
        ctx.fillStyle = '#050505';
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
        label(ctx, `${amps} A`, x, y + 22, 8, '#b8bbc0');
        return;
    }
    if (!on) {
        ctx.fillStyle = '#f0f0f0';
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.fill();
    }
    const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, on ? 12 : 13);
    g.addColorStop(0, '#5d6066');
    g.addColorStop(1, '#141517');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, on ? 12 : 13, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, String(amps), x, y + 1, 11, '#ffffff');
}

// Rocker (master, avionique) : partie haute enfoncée = ON
function rocker(ctx, x, y, w, h, on, colors) {
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    if (SOCKETS_ONLY) return;
    const [top, bottom] = on ? [colors.pressed, colors.raised] : [colors.raised, colors.pressed];
    ctx.fillStyle = top;
    ctx.fillRect(x, y, w, h / 2);
    ctx.fillStyle = bottom;
    ctx.fillRect(x, y + h / 2, w, h / 2);
    // Arête de bascule et reflet du côté relevé
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + 2, on ? y + h - 8 : y + 2, w - 4, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y + h / 2 - 1, w, 2);
}

// --- Sous-panneau (bas du tableau de bord) -------------------------------------------------

// Zones à éviter : colonnes des manches (vues par le pilote devant le sous-panneau)
function drawSubpanel(ctx, hotspots, top, width, height, systems, flaps) {
    const s = systems;
    ctx.fillStyle = '#161718';
    ctx.fillRect(0, top, width, height);
    ctx.fillStyle = '#0c0c0d';
    ctx.fillRect(0, top, width, 3);
    for (const [x, y] of [[14, top + 14], [14, top + height - 14], [width - 14, top + 14], [width - 14, top + height - 14]]) screw(ctx, x, y);

    // Magnétos : clé sur 5 positions (OFF R L BOTH START)
    const mx = 78, my = top + 112, mr = 30;
    label(ctx, 'MAGNETOS', mx, top + 22, 11);
    const positions = LAYOUT.mags.angles;
    // Position de la clé : pastille claire et texte noir (lisible même sous l'éclairage ambré de nuit), point
    // lumineux sur le cadran ; les autres positions sont atténuées
    MAGNETOS.forEach((name, i) => {
        const a = deg(positions[i]);
        const tx = mx + Math.sin(a) * (mr + 24), ty = my - Math.cos(a) * (mr + 24);
        if (i === s.magnetos) {
            ctx.font = `bold 13px ${FONT}`;
            const w = ctx.measureText(name).width + 10;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(tx - w / 2, ty - 9, w, 18, 6);
            ctx.fill();
            label(ctx, name, tx, ty, 13, '#000000');
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(mx + Math.sin(a) * (mr + 7), my - Math.cos(a) * (mr + 7), 4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            label(ctx, name, tx, ty, 10, '#6f7378');
        }
    });
    knob(ctx, mx, my, mr, null, '#8e9196');
    // Clé (en 3D)
    const ka = deg(positions[s.magnetos]);
    if (!SOCKETS_ONLY) ctx.save();
    else { ctx.save(); ctx.globalAlpha = 0; }
    ctx.translate(mx, my);
    ctx.rotate(ka);
    ctx.fillStyle = '#2b2b2e';
    ctx.fillRect(-7, -mr * 1.05, 14, mr * 2.1);
    ctx.fillStyle = '#c9cbcf';
    ctx.fillRect(-4, -mr * 0.95, 8, mr * 1.9);
    ctx.restore();
    hotspots.circle('mags', mx, my, mr + 26);

    // Master : ALT (gauche) et BAT (droite), rouge
    const bx = 150, by = top + 40, bw = 34, bh = 92;
    label(ctx, 'MASTER', bx + bw, top + 22, 11);
    rocker(ctx, bx, by, bw, bh, s.switches.masterAlt, { pressed: '#b3261e', raised: '#ef5b3a' });
    rocker(ctx, bx + bw + 4, by, bw, bh, s.switches.masterBat, { pressed: '#b3261e', raised: '#ef5b3a' });
    label(ctx, 'ALT', bx + bw / 2, by + bh + 14, 10);
    label(ctx, 'BAT', bx + bw * 1.5 + 4, by + bh + 14, 10);
    label(ctx, 'ON', bx - 14, by + 14, 10);
    hotspots.rect('switch:masterAlt', bx, by, bw, bh);
    hotspots.rect('switch:masterBat', bx + bw + 4, by, bw, bh);

    // Avionique : rocker blanc
    const ax = 262, aw = 44;
    label(ctx, 'AVIONICS\nMASTER', ax + aw / 2, top + 24, 10);
    rocker(ctx, ax, by, aw, bh, s.switches.avionics, { pressed: '#bfc1c4', raised: '#f4f4f4' });
    label(ctx, 'ON', ax + aw + 14, by + 14, 10);
    hotspots.rect('switch:avionics', ax, by, aw, bh);

    // Disjoncteurs (rangée du haut), entre les manches
    const x0 = 468, step = 70;
    BREAKERS.forEach((b, i) => {
        const x = x0 + i * step, y = top + 50;
        label(ctx, b.label, x, top + 22, 9);
        breaker(ctx, x, y, b.amps, s.breakers[b.id]);
        hotspots.circle(`breaker:${b.id}`, x, y, 18);
    });
    // Interrupteurs (rangée du bas) : pompe, feux, réchauffage pitot. Entre la barre du manche gauche et la poignée
    // du manche droit (vus depuis le siège, les manches cachent le bas du sous-panneau ailleurs)
    const toggleY = top + 128, t0 = 672, tStep = 58;
    TOGGLES.forEach((t, i) => {
        const x = t0 + i * tStep;
        label(ctx, t.label, x, toggleY - 38, 9);
        toggleSwitch(ctx, x, toggleY, s.switches[t.id]);
        label(ctx, 'OFF', x, toggleY + 40, 9, '#b8bbc0');
        hotspots.rect(`switch:${t.id}`, x - 22, toggleY - 30, 44, 60);
    });
    // Accolade "LIGHTS" au-dessus des feux
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1.5;
    const l0 = t0 + tStep - 20, l1 = t0 + 4 * tStep + 20, ly = toggleY - 56;
    ctx.beginPath();
    ctx.moveTo(l0, ly + 6); ctx.lineTo(l0, ly); ctx.lineTo(l1, ly); ctx.lineTo(l1, ly + 6);
    ctx.stroke();
    ctx.fillStyle = '#161718';
    ctx.fillRect((l0 + l1) / 2 - 26, ly - 6, 52, 12);
    label(ctx, 'LIGHTS', (l0 + l1) / 2, ly, 9);

    // Rhéostat d'éclairage du tableau (molette) : de -135° (éteint) à +135° (plein)
    const rx = 1380, ry = top + 140;
    label(ctx, 'PANEL LT', rx, ry - 38, 10);
    knob(ctx, rx, ry, 22, deg(-135 + 270 * s.panelLights));
    label(ctx, 'OFF', rx - 30, ry + 30, 8, '#b8bbc0');
    label(ctx, 'BRT', rx + 30, ry + 30, 8, '#b8bbc0');
    hotspots.circle('panelLights', rx, ry, 30);
    // Lampe témoin d'éclairage : allumée si le tableau est éclairé
    ctx.fillStyle = s.panelLighting > 0 ? '#ffbf45' : '#3a3022';
    ctx.beginPath();
    ctx.arc(rx + 44, ry - 22, 5, 0, Math.PI * 2);
    ctx.fill();

    // Volets : échelle et levier (UP / 10 / 20 / FULL), à droite du manche droit
    const fx = 1222, fy = top + 32, fh = 120;
    label(ctx, 'WING FLAPS', fx + 38, top + 18, 10);
    const zones = [['UP', '#2b2f8f'], ['10°', '#5aa9e6'], ['20°', '#f2f2f2'], ['FULL', '#f2f2f2']];
    zones.forEach(([text, color], i) => {
        const zy = fy + (i * fh) / 4;
        ctx.fillStyle = color;
        ctx.fillRect(fx, zy, 26, fh / 4);
        label(ctx, text, fx + 46, zy + fh / 8, 10);
        hotspots.rect(`flaps:${i}`, fx - 4, zy, 110, fh / 4);
    });
    label(ctx, '110', fx + 13, fy + fh / 8, 9, '#ffffff');
    label(ctx, '85', fx + 13, fy + (3 * fh) / 8, 9, '#111111');
    // Fente et levier (suit le cran demandé)
    ctx.fillStyle = '#050505';
    ctx.fillRect(fx + 70, fy, 8, fh);
    // (levier en 3D)
    // Index de position réelle (les volets mettent quelques secondes à sortir)
    ctx.fillStyle = '#ff9f1a';
    const iy = fy + flaps.position * (fh * 3 / 4) + fh / 8;
    ctx.beginPath();
    ctx.moveTo(fx - 2, iy); ctx.lineTo(fx - 12, iy - 6); ctx.lineTo(fx - 12, iy + 6);
    ctx.fill();

    // Aération cabine et prise statique de secours (boutons tirés = ouverts), ELT
    const pull = (id, x, y, text, on, color) => {
        label(ctx, text, x, y - 36, 9);
        knob(ctx, x, y, on ? 20 : 17, null, color);
        if (on) label(ctx, 'OUT', x, y + 30, 8, '#ffd34d');
        hotspots.circle(`switch:${id}`, x, y, 24);
    };
    pull('cabinAir1', 1380, top + 62, 'CABIN AIR\nPULL ON', s.switches.cabinAir1, '#9a9da2');
    pull('altStatic', 1470, top + 62, 'ALT STATIC\nPULL ON', s.switches.altStatic, '#d23a2a');
    label(ctx, 'ELT', 1470, top + 104, 10);
    toggleSwitch(ctx, 1470, top + 140, s.switches.elt);
    hotspots.rect('switch:elt', 1448, top + 112, 44, 56);
}

// --- Instruments moteur et panneau d'alarmes ----------------------------------------------

function smallGauge(ctx, x, y, r, title) {
    ctx.fillStyle = '#0b0b0c';
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111214';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, title, x, y + r * 0.62, 9);
}

// Aiguille d'une demi-jauge : côté gauche (-1) ou droit (1), valeur 0 -> 1 (bas -> haut)
function halfNeedle(ctx, x, y, r, side, value, color = '#f5f5f5') {
    const a = deg(side * (140 - 100 * Math.max(0, Math.min(1, value))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + side * r * 0.1, y);
    ctx.lineTo(x + Math.sin(a) * r * 0.85, y - Math.cos(a) * r * 0.85);
    ctx.stroke();
}

function halfScale(ctx, x, y, r, side, green = null) {
    ctx.strokeStyle = '#d9d9d9';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
        const a = deg(side * (140 - 25 * i));
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(a) * r * 0.78, y - Math.cos(a) * r * 0.78);
        ctx.lineTo(x + Math.sin(a) * r * 0.92, y - Math.cos(a) * r * 0.92);
        ctx.stroke();
    }
    if (green) {
        ctx.strokeStyle = '#2ecc40';
        ctx.lineWidth = 4;
        ctx.beginPath();
        const a0 = deg(side * (140 - 100 * green[0]) - 90), a1 = deg(side * (140 - 100 * green[1]) - 90);
        ctx.arc(x, y, r * 0.86, Math.min(a0, a1), Math.max(a0, a1));
        ctx.stroke();
    }
}

function drawEngineGauges(ctx, x, y, systems) {
    const s = systems, powered = s.gaugesPowered;
    const r = 46;
    // Jauges carburant gauche / droite (gallons)
    const g1 = x + 52;
    smallGauge(ctx, g1, y, r, 'FUEL QTY');
    label(ctx, 'L', g1 - r * 0.55, y - r * 0.5, 10);
    label(ctx, 'R', g1 + r * 0.55, y - r * 0.5, 10);
    halfScale(ctx, g1, y, r, -1);
    halfScale(ctx, g1, y, r, 1);
    halfNeedle(ctx, g1, y, r, -1, powered ? s.fuel[0] / TANK_CAPACITY : 0);
    halfNeedle(ctx, g1, y, r, 1, powered ? s.fuel[1] / TANK_CAPACITY : 0);
    label(ctx, `${s.fuel[0].toFixed(0)}  ${s.fuel[1].toFixed(0)}`, g1, y + r * 0.25, 9, powered ? '#ffd34d' : '#555');
    // Huile : température (gauche) et pression (droite)
    const g2 = x + 165;
    smallGauge(ctx, g2, y, r, 'OIL');
    label(ctx, 'T', g2 - r * 0.55, y - r * 0.5, 10);
    label(ctx, 'P', g2 + r * 0.55, y - r * 0.5, 10);
    halfScale(ctx, g2, y, r, -1, [0.35, 0.8]);
    halfScale(ctx, g2, y, r, 1, [0.4, 0.8]);
    const warm = s.running ? 0.6 : 0.25;
    halfNeedle(ctx, g2, y, r, -1, powered ? warm : 0);
    halfNeedle(ctx, g2, y, r, 1, powered ? Math.min(1, s.rpm / 3000) * (s.running ? 1 : 0.2) : 0);
    // Dépression (gauche) et ampèremètre (droite)
    const g3 = x + 278;
    smallGauge(ctx, g3, y, r, 'VAC  AMP');
    halfScale(ctx, g3, y, r, -1, [0.45, 0.75]);
    halfScale(ctx, g3, y, r, 1);
    halfNeedle(ctx, g3, y, r, -1, s.vacuum ? 0.6 : 0);
    const amp = !powered ? 0.5 : s.alternatorOn ? 0.58 : s.busPowered ? 0.3 : 0.5;
    halfNeedle(ctx, g3, y, r, 1, amp);
}

// Panneau d'alarmes (en haut au centre d'un vrai 172) : texte ambre / rouge allumé, gris éteint
function drawAnnunciators(ctx, x, y, w, systems, time) {
    const s = systems, on = s.annunciatorsPowered, warn = s.warnings;
    ctx.fillStyle = '#050505';
    ctx.fillRect(x, y, w, 52);
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, 52);
    const blink = Math.sin(time * 8) > -0.3;
    const item = (text, tx, ty, lit, color) => label(ctx, text, tx, ty, 12, on && lit ? color : '#3c3c3c');
    item('L', x + 20, y + 16, warn.lowFuelL && blink, '#ffb000');
    item('LOW FUEL', x + 80, y + 16, warn.lowFuelL || warn.lowFuelR, '#ffb000');
    item('R', x + 140, y + 16, warn.lowFuelR && blink, '#ffb000');
    item('OIL PRESS', x + 70, y + 37, warn.oilPress, '#ff3b2f');
    item('L', x + 170, y + 37, warn.vacL, '#ffb000');
    item('VAC', x + 200, y + 37, warn.vacL || warn.vacR, '#ffb000');
    item('R', x + 230, y + 37, warn.vacR, '#ffb000');
    item('VOLTS', x + 285, y + 37, warn.volts, '#ff3b2f');
    item('PITCH TRIM', x + 250, y + 16, false, '#ffb000');
}

// --- Pupitre central : molette de trim, repère, micro, robinet carburant --------------------

function drawPedestal(ctx, hotspots, w, h, systems, trim) {
    ctx.fillStyle = '#1b1c1e';
    ctx.fillRect(0, 0, w, h);
    // Molette de trim : on voit défiler ses crans quand on la tourne
    const wx = 30, wy = 30, ww = 46, wh = 230;
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
    const offset = ((trim.deg * 7) % 30 + 30) % 30;
    for (let y = wy - 30 + offset; !SOCKETS_ONLY && y < wy + wh; y += 30) {
        if (y < wy - 8) continue;
        const g = ctx.createLinearGradient(wx, y, wx, y + 22);
        g.addColorStop(0, '#5a5c60');
        g.addColorStop(0.5, '#2a2b2e');
        g.addColorStop(1, '#0d0d0e');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(wx, Math.max(wy, y), ww, Math.min(22, wy + wh - y), 9);
        ctx.fill();
    }
    label(ctx, 'NOSE\nDOWN', wx + ww / 2, 14, 9);
    label(ctx, 'NOSE\nUP', wx + ww / 2, h - 30, 9);
    hotspots.rect('trimWheel', wx - 6, wy - 6, ww + 12, wh + 12);
    // Repère de la manette de frein (sur le flanc gauche du pupitre)
    ctx.save();
    ctx.translate(11, 145);
    ctx.rotate(-Math.PI / 2);
    label(ctx, systems.brake ? 'FREIN SERRÉ' : 'FREIN', 0, 0, 9, systems.brake ? '#ff6a4a' : '#b8bbc0');
    ctx.restore();
    // Repère de trim (TAKE OFF)
    const sx = 96, s0 = 50, s1 = 250;
    ctx.fillStyle = '#050505';
    ctx.fillRect(sx - 4, s0 - 6, 18, s1 - s0 + 12);
    const yOf = (d) => s0 + ((d - trim.min) / (trim.max - trim.min)) * (s1 - s0);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(sx + 14, yOf(trim.takeoff) - 1, 10, 2);
    label(ctx, 'T/O', sx + 40, yOf(trim.takeoff), 9);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(sx + 12, yOf(trim.deg));
    ctx.lineTo(sx, yOf(trim.deg) - 6);
    ctx.lineTo(sx, yOf(trim.deg) + 6);
    ctx.fill();
    // Micro (décor)
    ctx.fillStyle = '#2a2a2c';
    ctx.beginPath();
    ctx.roundRect(160, 26, 64, 150, 18);
    ctx.fill();
    ctx.strokeStyle = '#b39b5a';
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, 'Cessna', 192, 46, 10);
    ctx.fillStyle = '#111';
    ctx.fillRect(184, 66, 16, 40);
    label(ctx, 'MIC', 192, 190, 9);
    // Robinet carburant (tirer = fermé)
    const cx = 192, cy = 258;
    label(ctx, 'FUEL SHUTOFF\nPULL OFF', cx, cy - 46, 9);
    ctx.fillStyle = systems.fuelShutoff ? '#ffd34d' : '#c0392b';
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fill();
    knob(ctx, cx, cy, systems.fuelShutoff ? 20 : 16);
    if (systems.fuelShutoff) label(ctx, 'OFF', cx, cy + 36, 10, '#ffd34d');
    hotspots.circle('fuelShutoff', cx, cy, 30);
}

// --- Sélecteur de réservoir (plancher, entre les sièges) ------------------------------------

function drawFuelSelector(ctx, hotspots, w, h, systems) {
    ctx.fillStyle = '#4d4038';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2b231e';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    label(ctx, 'FUEL SELECTOR', w / 2, 16, 11);
    label(ctx, 'BOTH\n53 gal', w / 2, 40, 10);
    label(ctx, 'LEFT\n26.5 gal', 38, h / 2 + 30, 10);
    label(ctx, 'RIGHT\n26.5 gal', w - 38, h / 2 + 30, 10);
    // Contour de la poignée (forme en T du vrai sélecteur)
    const cx = w / 2, cy = h / 2 + 18;
    ctx.strokeStyle = '#e6e6e6';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 82, cy - 14, 164, 28);
    // Poignée blanche effilée, tournée vers le réservoir choisi
    const angle = deg([-90, 0, 90][systems.fuelSelector]);
    ctx.save();
    if (SOCKETS_ONLY) ctx.globalAlpha = 0;   // poignée en 3D
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath();
    ctx.moveTo(0, -70);
    ctx.lineTo(16, -10);
    ctx.lineTo(16, 30);
    ctx.lineTo(-16, 30);
    ctx.lineTo(-16, -10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    hotspots.rect('fuelSelector', 0, 0, w, h);
}

export { LAYOUT, Hotspots, drawSubpanel, drawEngineGauges, drawAnnunciators, drawPedestal, drawFuelSelector };
