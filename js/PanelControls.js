// Commandes cliquables dessinées sur les canvas du pupitre central (molette de trim, micro, robinet carburant) et du
// plancher (sélecteur de réservoir). Chaque dessin enregistre sa zone cliquable (Hotspots) ; l'action est faite par
// simulator.js. Les commandes elles-mêmes sont en 3D (Controls3D.js) ; le tableau de bord est dans Panel172.js.

const FONT = '"Arial Narrow", Arial, sans-serif';

// Position des commandes (px des canvas du pupitre et du plancher)
const PEDESTAL_LAYOUT = {
    trimWheel: { x: 94, y: 46, w: 20, h: 148 },   // fente où dépasse la roulette (Controls3D.js)
    trimIndicator: { x: 64, top: 124, bottom: 212 }, // fente de l'indicateur de position (bille), à gauche de la roulette
    fuelShutoff: { x: 200, y: 254 },
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

// --- Pupitre central : molette de trim et repère, micro, prises, robinet carburant ---------------------------

// Fente creusée dans la plaque : fond sombre, bord ombré en haut à gauche, éclairé en bas à droite
function slot(ctx, x, y, w, h, r) {
    ctx.fillStyle = '#16171a';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(x - 1, y - 1, w + 2, h + 2, r + 1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 2, w, h, r);
    ctx.stroke();
}

// Molette de trim du C172 (comme le vrai pupitre) : roulette fine à droite (3D, dans sa fente), et à sa gauche
// « NOSE DOWN » / double flèche / « NOSE UP », la fente de l'indicateur où glisse une bille, et le repère ▶ TAKE OFF
function drawTrim(ctx, hotspots, trim) {
    const { x: wx, y: wy, w: ww, h: wh } = PEDESTAL_LAYOUT.trimWheel;
    const { x: ix, top, bottom } = PEDESTAL_LAYOUT.trimIndicator;
    slot(ctx, wx, wy, ww, wh, 4);
    hotspots.rect('trimWheel', wx - 8, wy - 4, ww + 16, wh + 8);
    // Sens : texte et double flèche au-dessus de l'indicateur
    const ax = ix + 2;
    label(ctx, 'NOSE\nDOWN', ax, 22, 9, '#e9eaec');
    label(ctx, 'NOSE\nUP', ax, 106, 9, '#e9eaec');
    ctx.strokeStyle = '#e9eaec';
    ctx.fillStyle = '#e9eaec';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ax, 42);
    ctx.lineTo(ax, 86);
    ctx.stroke();
    for (const [y, dir] of [[38, -1], [90, 1]]) {
        ctx.beginPath();
        ctx.moveTo(ax, y);
        ctx.lineTo(ax - 3.5, y - dir * 8);
        ctx.lineTo(ax + 3.5, y - dir * 8);
        ctx.fill();
    }
    // Indicateur : bille dans sa fente (NOSE DOWN en haut), position réelle du tab
    const sw = 18;
    slot(ctx, ix - sw / 2, top - 4, sw, bottom - top + 8, sw / 2);
    const yOf = (d) => top + 6 + ((d - trim.min) / (trim.max - trim.min)) * (bottom - top - 12);
    // Repère décollage : « TAKE » ▶ « OFF », à gauche de la fente
    const ty = yOf(trim.takeoff);
    label(ctx, 'TAKE', ix - 34, ty - 15, 9, '#e9eaec');
    label(ctx, 'OFF', ix - 34, ty + 15, 9, '#e9eaec');
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath();
    ctx.moveTo(ix - 14, ty);
    ctx.lineTo(ix - 25, ty - 6);
    ctx.lineTo(ix - 25, ty + 6);
    ctx.fill();
    const by = yOf(trim.deg), r = 6.5;
    const ball = ctx.createRadialGradient(ix - 2, by - 2, 1, ix, by, r);
    ball.addColorStop(0, '#ffffff');
    ball.addColorStop(0.6, '#d9d9d6');
    ball.addColorStop(1, '#8e8e8a');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(ix + 1, by + 1.5, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(ix, by, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawPedestal(ctx, hotspots, w, h, systems, trim) {
    // Plaque grise (comme le pupitre du C172), léger dégradé de lumière
    const plate = ctx.createLinearGradient(0, 0, w, h);
    plate.addColorStop(0, '#6c6e72');
    plate.addColorStop(1, '#55575b');
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3e4044';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    drawTrim(ctx, hotspots, trim);
    // Micro accroché (décor) et son cordon
    label(ctx, 'MIC JACK', 214, 12, 8);
    ctx.fillStyle = '#2a2a2c';
    ctx.beginPath();
    ctx.roundRect(150, 26, 58, 150, 18);
    ctx.fill();
    ctx.strokeStyle = '#b39b5a';
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, 'Cessna', 179, 44, 10);
    ctx.fillStyle = '#111';
    ctx.fillRect(171, 64, 16, 44);
    ctx.strokeStyle = '#3a3a3c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let y = 30; y < 200; y += 6) {
        ctx.moveTo(228, y);
        ctx.lineTo(240, y + 4);
    }
    ctx.stroke();
    // Prises (décor)
    label(ctx, 'AUX\nAUDIO\nIN', 40, 250, 8);
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.arc(40, 274, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2b2e';
    ctx.beginPath();
    ctx.arc(110, 262, 14, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, 'POWER\nOUTLET', 110, 262, 6);
    // Robinet carburant (tirer = fermé)
    const { x: cx, y: cy } = PEDESTAL_LAYOUT.fuelShutoff;
    label(ctx, 'FUEL SHUTOFF\nPULL OFF', cx, cy + 26, 8);
    ctx.fillStyle = systems.fuelShutoff ? '#ffd34d' : '#c0392b';
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
    hotspots.circle('fuelShutoff', cx, cy, 22);
}

// --- Sélecteur de réservoir (plancher, entre les sièges) ------------------------------------

function drawFuelSelector(ctx, hotspots, w, h, systems) {
    ctx.fillStyle = '#4d4038';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2b231e';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    label(ctx, 'TAKEOFF\nLANDING', w / 2 - 40, 16, 8);
    label(ctx, 'BOTH\n53 gal', w / 2, 16, 8);
    label(ctx, 'ALL FLIGHT\nATTITUDES', w / 2 + 44, 16, 8);
    label(ctx, 'FUEL\nSELECTOR', w - 40, 50, 8);
    label(ctx, 'LEFT\n26.5 gal\nLEVEL\nFLIGHT\nONLY', 26, h / 2 + 26, 8);
    label(ctx, 'RIGHT\n26.5 gal\nLEVEL\nFLIGHT\nONLY', w - 26, h / 2 + 26, 8);
    // Contour de la poignée (forme en ailes du vrai sélecteur)
    const cx = w / 2, cy = h / 2 + 18;
    ctx.strokeStyle = '#e6e6e6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 80, cy - 4); ctx.lineTo(cx - 60, cy - 18); ctx.lineTo(cx + 60, cy - 18); ctx.lineTo(cx + 80, cy - 4);
    ctx.lineTo(cx + 80, cy + 4); ctx.lineTo(cx + 60, cy + 18); ctx.lineTo(cx - 60, cy + 18); ctx.lineTo(cx - 80, cy + 4);
    ctx.closePath();
    ctx.stroke();
    hotspots.rect('fuelSelector', 0, 0, w, h);
}

export { PEDESTAL_LAYOUT, Hotspots, drawPedestal, drawFuelSelector };
