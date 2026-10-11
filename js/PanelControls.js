// Commandes cliquables dessinées sur les canvas du pupitre central (molette de trim, micro, robinet carburant) et du
// plancher (sélecteur de réservoir). Chaque dessin enregistre sa zone cliquable (Hotspots) ; l'action est faite par
// simulator.js. Les commandes elles-mêmes sont en 3D (Controls3D.js) ; le tableau de bord est dans Panel172.js.

const FONT = '"Arial Narrow", Arial, sans-serif';

// Position des commandes (px des canvas du pupitre et du plancher)
const PEDESTAL_LAYOUT = {
    trimWheel: { x: 30, y: 34, w: 46, h: 186 },
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

function drawPedestal(ctx, hotspots, w, h, systems, trim) {
    ctx.fillStyle = '#1b1c1e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2c2d30';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    const { x: wx, y: wy, w: ww, h: wh } = PEDESTAL_LAYOUT.trimWheel;
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
    label(ctx, 'NOSE\nDOWN', wx + ww / 2, 14, 9);
    label(ctx, 'NOSE\nUP', wx + ww / 2, wy + wh + 18, 9);
    hotspots.rect('trimWheel', wx - 6, wy - 6, ww + 12, wh + 12);
    // Repère de trim : index qui suit le tab, marque TAKE OFF
    const sx = 96, s0 = wy + 10, s1 = wy + wh - 10;
    ctx.fillStyle = '#050505';
    ctx.fillRect(sx - 4, s0 - 6, 18, s1 - s0 + 12);
    const yOf = (d) => s0 + ((d - trim.min) / (trim.max - trim.min)) * (s1 - s0);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(sx + 14, yOf(trim.takeoff) - 1, 10, 2);
    ctx.save();
    ctx.translate(sx + 32, yOf(trim.takeoff));
    ctx.rotate(Math.PI / 2);
    label(ctx, 'TAKE OFF', 0, 0, 9);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(sx + 12, yOf(trim.deg));
    ctx.lineTo(sx, yOf(trim.deg) - 6);
    ctx.lineTo(sx, yOf(trim.deg) + 6);
    ctx.fill();
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
