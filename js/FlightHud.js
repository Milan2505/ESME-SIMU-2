// Informations de vol en vue extérieure (à la manière des simulateurs grand public) : dessinées sur un calque par-dessus
// l'écran de vol, rafraîchi ~20 fois par seconde.
// - en haut à gauche : rose des caps, avion au centre, flèche du vent (entre l'avion et les graduations) ; cap et vent
//   (direction d'où il vient, force) dans les cases dessous ;
// - en bas à gauche : bande de vitesse (kt, arcs de l'anémomètre), vitesse vraie, compte-tours, carburant, incidence ;
// - en bas à droite : volets, trim (repère de décollage), bande d'altitude (pieds, calage), variomètre (ft/min).

const KT = 1.943844;          // m/s -> nœuds
const FT = 1 / 0.3048;        // m -> pieds
const REFRESH = 0.05;         // s
// Arcs de l'anémomètre du Cessna 172 (kt) : blanc (volets), vert (normal), jaune (prudence), trait rouge (VNE)
const ARCS = { white: [33, 85], green: [44, 129], yellow: [129, 163], vne: 163 };
const RPM_MAX = 3000, RPM_RED = 2700;

const COLORS = {
    panel: 'rgba(18, 22, 28, 0.78)',
    header: 'rgba(48, 54, 64, 0.92)',
    border: 'rgba(255, 255, 255, 0.18)',
    text: '#ffffff',
    dim: '#aeb6c2',
    accent: '#5ec8ff',
    green: '#3ad06a',
    yellow: '#f2c230',
    red: '#e8443a',
    white: '#f2f2f2',
};

class FlightHud {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this._timer = 0;
        this._shown = false;
    }

    // data : { speed (m/s, anémomètre), tas (m/s), altitude (m), verticalSpeed (m/s), heading (deg), rpm, fuel (0 -> 1),
    // alpha, stallAlpha (deg), flaps (deg réels), flapTarget (deg), trim, trimMin, trimMax, takeoffTrim (deg), baro (hPa),
    // windDirection (deg, d'où vient le vent), windSpeed (kt) }
    update(delta, visible, data) {
        if (!visible) {
            if (this._shown) {
                this.canvas.hidden = true;
                this._shown = false;
            }
            return;
        }
        if (!this._shown) {
            this.canvas.hidden = false;
            this._shown = true;
            this._timer = 0;
        }
        if ((this._timer -= delta) > 0) return;
        this._timer = REFRESH;
        this._resize();
        this._draw(data);
    }

    _resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.round(this.canvas.clientWidth * ratio), height = Math.round(this.canvas.clientHeight * ratio);
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        this.ratio = ratio;
    }

    _draw(d) {
        const { ctx, canvas } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Unité : tout est dessiné pour un écran de 1280 × 720, puis mis à l'échelle (sans dépasser)
        const u = Math.min(canvas.width / 1280, canvas.height / 720);
        if (u <= 0) return;
        ctx.setTransform(u, 0, 0, u, 0, 0);
        const W = canvas.width / u, H = canvas.height / u;
        const m = 14, bottom = H - m;

        this._compass(m + 78, m + 78, 70, d.heading, d.windDirection, d.windSpeed);

        // Bas gauche
        let x = m;
        this._speedTape(x, bottom - 210, 62, 210, d.speed * KT, d.tas * KT);
        x += 70;
        this._rpm(x, bottom - 110, 90, 110, d.rpm);
        x += 98;
        this._bar(x, bottom - 110, 44, 110, 'FUEL', d.fuel, `${Math.round(d.fuel * 100)}%`,
            [[0, 0.15, COLORS.red], [0.15, 0.3, COLORS.yellow], [0.3, 1, COLORS.green]]);
        x += 52;
        const aoa = d.stallAlpha > 0 ? Math.max(0, Math.min(1, d.alpha / d.stallAlpha)) : 0;
        this._bar(x, bottom - 110, 44, 110, 'AOA', aoa, `${Math.round(d.alpha)}°`,
            [[0, 0.75, COLORS.green], [0.75, 0.9, COLORS.yellow], [0.9, 1, COLORS.red]]);

        // Bas droite
        let r = W - m;
        r -= 54;
        this._vsTape(r, bottom - 210, 54, 210, d.verticalSpeed * FT * 60);
        r -= 8 + 76;
        this._altitudeTape(r, bottom - 210, 76, 210, d.altitude * FT + (d.baro - 1013) * 27.3, d.baro);
        r -= 8 + 44;
        this._trim(r, bottom - 110, 44, 110, d);
        r -= 8 + 44;
        const flaps = d.flapMax > 0 ? d.flaps / d.flapMax : 0;
        this._bar(r, bottom - 110, 44, 110, 'FLAPS', 1 - flaps, `${Math.round(d.flaps)}°`, null, true,
            d.flapMax > 0 ? 1 - d.flapTarget / d.flapMax : 1);
    }

    // --- Pièces ------------------------------------------------------------------------------------------------
    _box(x, y, w, h, title) {
        const { ctx } = this;
        ctx.fillStyle = COLORS.panel;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        if (!title) return y;
        ctx.fillStyle = COLORS.header;
        ctx.fillRect(x, y, w, 18);
        this._text(title, x + w / 2, y + 9, 11, COLORS.text, 'center', 'bold');
        return y + 18;
    }

    _text(text, x, y, size, color = COLORS.text, align = 'left', weight = '') {
        const { ctx } = this;
        ctx.font = `${weight} ${size}px "DejaVu Sans Mono", Consolas, monospace`;
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
    }

    // Case de valeur (fond noir, chiffres blancs) : sous les jauges, au centre des bandes
    _valueBox(x, y, w, h, text, color = COLORS.text, size = 15) {
        const { ctx } = this;
        ctx.fillStyle = '#05080c';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = COLORS.white;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
        this._text(text, x + w / 2, y + h / 2 + 1, size, color, 'center', 'bold');
    }

    // Rose des caps : graduations tous les 10°, lettres N E S W et 3 / 6 / 12…, avion fixe au centre
    _compass(cx, cy, r, heading, windDirection = 0, windSpeed = 0) {
        const { ctx } = this;
        ctx.save();
        ctx.fillStyle = 'rgba(70, 90, 60, 0.78)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        for (let deg = 0; deg < 360; deg += 10) {
            const a = (deg - heading) * Math.PI / 180 - Math.PI / 2;
            const major = deg % 30 === 0;
            const r0 = r - (major ? 10 : 6);
            ctx.strokeStyle = COLORS.white;
            ctx.lineWidth = major ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
            ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            ctx.stroke();
            if (major) {
                const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg] ?? String(deg / 10);
                ctx.save();
                ctx.translate(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20));
                ctx.rotate(a + Math.PI / 2);
                this._text(label, 0, 0, label.length === 1 && isNaN(label) ? 13 : 11, deg === 0 ? COLORS.yellow : COLORS.white, 'center', 'bold');
                ctx.restore();
            }
        }
        // Vent : flèche dans l'anneau libre entre l'avion et le cercle intérieur, du côté d'où il vient, pointée vers
        // l'avion (sens où il souffle)
        const calm = windSpeed < 1;
        if (!calm) {
            const a = (windDirection - heading) * Math.PI / 180 - Math.PI / 2;
            const ux = Math.cos(a), uy = Math.sin(a), tail = r * 0.5, head = 17;
            ctx.strokeStyle = COLORS.accent;
            ctx.fillStyle = COLORS.accent;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx + ux * tail, cy + uy * tail);
            ctx.lineTo(cx + ux * (head + 7), cy + uy * (head + 7));
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx + ux * head, cy + uy * head);
            ctx.lineTo(cx + ux * (head + 9) - uy * 5, cy + uy * (head + 9) + ux * 5);
            ctx.lineTo(cx + ux * (head + 9) + uy * 5, cy + uy * (head + 9) - ux * 5);
            ctx.closePath();
            ctx.fill();
        }
        // Repère du cap en haut, avion au centre
        ctx.fillStyle = COLORS.yellow;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r + 1);
        ctx.lineTo(cx - 6, cy - r - 9);
        ctx.lineTo(cx + 6, cy - r - 9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = COLORS.white;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 12);
        ctx.lineTo(cx + 2.5, cy - 4);
        ctx.lineTo(cx + 13, cy);
        ctx.lineTo(cx + 13, cy + 3);
        ctx.lineTo(cx + 2.5, cy + 2);
        ctx.lineTo(cx + 2, cy + 8);
        ctx.lineTo(cx + 6, cy + 11);
        ctx.lineTo(cx - 6, cy + 11);
        ctx.lineTo(cx - 2, cy + 8);
        ctx.lineTo(cx - 2.5, cy + 2);
        ctx.lineTo(cx - 13, cy + 3);
        ctx.lineTo(cx - 13, cy);
        ctx.lineTo(cx - 2.5, cy - 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        this._valueBox(cx - 24, cy + r + 8, 48, 20, `${String(Math.round(heading) % 360).padStart(3, '0')}°`, COLORS.text, 13);
        const windText = calm ? 'VENT CALME'
            : `VENT ${String(Math.round(windDirection) % 360 || 360).padStart(3, '0')}° ${Math.round(windSpeed)} kt`;
        this._valueBox(cx - 60, cy + r + 32, 120, 20, windText, COLORS.accent, 12);
    }

    // Bande défilante verticale : value au centre ; step : écart entre graduations ; labelEvery : graduations chiffrées
    _tape(x, y, w, h, value, range, step, labelEvery, format, side = 'right') {
        const { ctx } = this;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        const scale = h / (2 * range), mid = y + h / 2;
        const first = Math.floor((value - range) / step) * step;
        for (let v = first; v <= value + range; v += step) {
            const py = mid - (v - value) * scale;
            const labelled = Math.round(v / step) % Math.round(labelEvery / step) === 0;
            const len = labelled ? 12 : 6;
            ctx.strokeStyle = COLORS.white;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const edge = side === 'right' ? x + w : x;
            ctx.moveTo(edge, py);
            ctx.lineTo(side === 'right' ? edge - len : edge + len, py);
            ctx.stroke();
            if (labelled) this._text(format(v), side === 'right' ? x + w - 16 : x + 16, py, 13, COLORS.white, side === 'right' ? 'right' : 'left', 'bold');
        }
        ctx.restore();
        return { scale, mid };
    }

    _speedTape(x, y, w, h, kt, tasKt) {
        const top = this._box(x, y, w, h, 'AIRSPEED');
        this._text('KTS', x + w / 2, top + 8, 10, COLORS.accent, 'center', 'bold');
        const tapeY = top + 16, tapeH = h - (tapeY - y) - 22;
        const range = 30;
        const { scale, mid } = this._tape(x, tapeY, w - 8, tapeH, Math.max(0, kt), range, 5, 10, (v) => (v >= 0 ? String(v) : ''));
        // Arcs colorés à droite
        const { ctx } = this;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, tapeY, w, tapeH);
        ctx.clip();
        const yOf = (v) => mid - (v - Math.max(0, kt)) * scale;
        const arc = ([a, b], color, offset) => {
            ctx.fillStyle = color;
            ctx.fillRect(x + w - 8 + offset, yOf(b), 3, yOf(a) - yOf(b));
        };
        arc(ARCS.white, COLORS.white, 0);
        arc(ARCS.green, COLORS.green, 4);
        arc(ARCS.yellow, COLORS.yellow, 4);
        ctx.fillStyle = COLORS.red;
        ctx.fillRect(x + w - 8, yOf(ARCS.vne) - 1.5, 8, 3);
        ctx.restore();
        const color = kt > ARCS.vne ? COLORS.red : kt > ARCS.yellow[0] ? COLORS.yellow : COLORS.text;
        this._valueBox(x + 2, mid - 12, w - 12, 24, String(Math.max(0, Math.round(kt))), color, 17);
        this._text(`TAS ${Math.round(Math.max(0, tasKt))}KT`, x + w / 2, y + h - 11, 10, COLORS.dim, 'center', 'bold');
    }

    _altitudeTape(x, y, w, h, ft, baro) {
        const top = this._box(x, y, w, h, 'ALTITUDE');
        const tapeY = top + 4, tapeH = h - (tapeY - y) - 22;
        const { mid } = this._tape(x + 8, tapeY, w - 8, tapeH, ft, 300, 20, 100, (v) => String(v), 'left');
        this._valueBox(x + 10, mid - 12, w - 14, 24, String(Math.round(ft / 10) * 10), COLORS.text, 15);
        const inHg = baro * 0.02953;
        this._text(`${inHg.toFixed(2)}IN`, x + w / 2, y + h - 11, 10, COLORS.accent, 'center', 'bold');
    }

    _vsTape(x, y, w, h, fpm) {
        const top = this._box(x, y, w, h, 'VS');
        const tapeY = top + 6, tapeH = h - (tapeY - y) - 24;
        const mid = tapeY + tapeH / 2, half = tapeH / 2 - 6;
        const { ctx } = this;
        // Échelle non linéaire (plus fine près de 0) : ±2000 ft/min
        const yOf = (v) => mid - Math.sign(v) * Math.sqrt(Math.min(1, Math.abs(v) / 2000)) * half;
        for (const v of [-2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000]) {
            const py = yOf(v), labelled = v % 1000 === 0;
            ctx.strokeStyle = COLORS.white;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x + 6, py);
            ctx.lineTo(x + (labelled ? 16 : 11), py);
            ctx.stroke();
            if (labelled) this._text(String(Math.abs(v / 1000)), x + 22, py, 12, COLORS.white, 'left', 'bold');
        }
        // Aiguille
        const py = yOf(Math.max(-2000, Math.min(2000, fpm)));
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + w - 4, mid);
        ctx.lineTo(x + 8, py);
        ctx.stroke();
        this._valueBox(x + 3, y + h - 22, w - 6, 19, String(Math.round(fpm / 10) * 10), COLORS.text, 12);
    }

    // Compte-tours : cadran, arc vert / rouge, aiguille ; valeur dessous
    _rpm(x, y, w, h, rpm) {
        const top = this._box(x, y, w, h, 'ENGINE #1');
        const { ctx } = this;
        const cx = x + w / 2, cy = top + 46, r = 32;
        const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
        const angle = (v) => a0 + (a1 - a0) * Math.max(0, Math.min(1, v / RPM_MAX));
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1);
        ctx.stroke();
        ctx.strokeStyle = COLORS.green;
        ctx.beginPath();
        ctx.arc(cx, cy, r, angle(2100), angle(RPM_RED));
        ctx.stroke();
        ctx.strokeStyle = COLORS.red;
        ctx.beginPath();
        ctx.arc(cx, cy, r, angle(RPM_RED), a1);
        ctx.stroke();
        const a = angle(rpm);
        ctx.strokeStyle = COLORS.white;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
        ctx.stroke();
        this._text('RPM', cx, cy + 14, 9, COLORS.dim, 'center', 'bold');
        this._valueBox(x + 8, y + h - 24, w - 16, 20, String(Math.round(rpm)), rpm > RPM_RED ? COLORS.red : COLORS.text, 14);
    }

    // Jauge verticale : value 0 -> 1 (remplie depuis le bas, ou curseur seul) ; zones : [[de, à, couleur]]
    _bar(x, y, w, h, title, value, label, zones, cursor = false, target = null) {
        const top = this._box(x, y, w, h, title);
        const { ctx } = this;
        const bx = x + w / 2 - 6, by = top + 6, bh = h - (by - y) - 30;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(bx, by, 12, bh);
        const v = Math.max(0, Math.min(1, value));
        if (zones) {
            for (const [a, b, color] of zones) {
                const from = Math.min(v, a), to = Math.min(v, b);
                if (to <= from) continue;
                ctx.fillStyle = color;
                ctx.fillRect(bx, by + bh * (1 - to), 12, bh * (to - from));
            }
        }
        if (cursor) {
            // Curseur (position réelle), repère creux à la position demandée
            const py = by + bh * (1 - v);
            ctx.fillStyle = COLORS.white;
            ctx.beginPath();
            ctx.moveTo(bx - 2, py);
            ctx.lineTo(bx - 9, py - 5);
            ctx.lineTo(bx - 9, py + 5);
            ctx.closePath();
            ctx.fill();
            ctx.fillRect(bx, py - 1.5, 12, 3);
            if (target !== null) {
                const ty = by + bh * (1 - target);
                ctx.strokeStyle = COLORS.accent;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(bx + 14, ty - 3, 6, 6);
            }
        }
        this._valueBox(x + 4, y + h - 23, w - 8, 19, label, COLORS.text, 11);
    }

    // Trim : DN en haut, UP en bas, repère TO (décollage), curseur et pourcentage
    _trim(x, y, w, h, d) {
        const top = this._box(x, y, w, h, 'TRIM');
        const { ctx } = this;
        const bx = x + w / 2 - 4, by = top + 14, bh = h - (by - y) - 38;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(bx, by, 8, bh);
        this._text('DN', x + 4, top + 7, 9, COLORS.dim, 'left', 'bold');
        this._text('UP', x + 4, by + bh + 8, 9, COLORS.dim, 'left', 'bold');
        const span = d.trimMax - d.trimMin;
        const yOf = (deg) => by + bh * (deg - d.trimMin) / (span || 1);   // à cabrer (+) vers le bas
        const to = yOf(d.takeoffTrim);
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(bx - 1, to - 6, 10, 12);
        this._text('TO', bx - 3, to, 9, COLORS.green, 'right', 'bold');
        const py = yOf(Math.max(d.trimMin, Math.min(d.trimMax, d.trim)));
        ctx.fillStyle = COLORS.white;
        ctx.beginPath();
        ctx.moveTo(bx + 10, py);
        ctx.lineTo(bx + 17, py - 5);
        ctx.lineTo(bx + 17, py + 5);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(bx, py - 1.5, 8, 3);
        const percent = d.trim >= 0 ? d.trim / (d.trimMax || 1) : -d.trim / (d.trimMin || -1);
        this._valueBox(x + 4, y + h - 23, w - 8, 19, `${Math.round(percent * 100)}%`, COLORS.text, 11);
    }
}

export { FlightHud };
