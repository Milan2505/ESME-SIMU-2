// Carte vue de dessus (bouton Carte du bandeau, touche M) : relief, aérodrome, avion du joueur et des autres joueurs.
// Nord en haut. Le relief est calculé une seule fois, à la première ouverture.

const NM = 1852;
const RELIEF_PIXELS = 320;               // finesse de l'image du relief (pour tout le terrain)
const ZOOMS = [6000, 3000, 1500, 700];   // largeur montrée par la carte (m)
const REDRAW = 1 / 12;                   // carte redessinée 12 fois par seconde au plus (s)

// Couleur du relief selon l'altitude (m), ombrée selon la pente (lumière venant du nord-ouest)
function reliefColor(height, shade) {
    let r, g, b;
    if (height < 8) [r, g, b] = [86, 140, 64];
    else if (height < 60) [r, g, b] = [104, 146, 70];
    else if (height < 130) [r, g, b] = [128, 132, 86];
    else if (height < 280) [r, g, b] = [134, 118, 98];
    else [r, g, b] = [222, 225, 230];   // neige seulement sur les plus hauts sommets
    const k = Math.max(0.55, Math.min(1.35, 1 + shade));
    return [r * k, g * k, b * k];
}

class MapView {
    // heightAt(x, z) : hauteur du sol ; worldSize : côté du terrain (m) ; shapes : pistes et parkings [{ minX, maxX, minZ, maxZ, kind }]
    // runways : [{ name, threshold }]
    constructor(canvas, { heightAt, worldSize, shapes = [], runways = [], navaids = [], zooms = ZOOMS }) {
        this.canvas = canvas;
        this.heightAt = heightAt;
        this.worldSize = worldSize;
        this.shapes = shapes;
        this.runways = runways;
        this.navaids = navaids;
        this.zooms = zooms;       // balises (VOR) : { x, z, ident, frequency }
        this.zoom = 1;
        this._relief = null;
        this._timer = 0;
    }

    zoomBy(step) {
        this.zoom = Math.max(0, Math.min(this.zooms.length - 1, this.zoom + step));
        this._timer = 0;
    }

    // own : { position, heading (degrés), color } ; others : liste de RemotePlayers.list()
    update(delta, own, others) {
        this._timer -= delta;
        if (this._timer > 0) return;
        this._timer = REDRAW;
        this.draw(own, others);
    }

    draw(own, others) {
        const canvas = this.canvas;
        const ratio = window.devicePixelRatio || 1;
        const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
        if (!width || !height) return;
        if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
        const ctx = canvas.getContext('2d');
        this._relief ??= this._buildRelief();

        // Fenêtre montrée : centrée sur l'avion du joueur, sans sortir du terrain
        const half = this.worldSize / 2;
        const span = this.zooms[Math.min(this.zoom, this.zooms.length - 1)];
        const view = span / 2;
        const cx = Math.max(-half + view, Math.min(half - view, own.position.x));
        const cz = Math.max(-half + view, Math.min(half - view, own.position.z));
        const scale = width / span;   // pixels par mètre
        const toX = (x) => (x - cx) * scale + width / 2;
        const toY = (z) => (z - cz) * scale + height / 2;
        this.project = (x, z) => [toX(x), toY(z)];   // pour dessiner par-dessus la carte

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.fillStyle = '#4d7d3c';
        ctx.fillRect(0, 0, width, height);
        const pixel = this.worldSize / RELIEF_PIXELS;
        ctx.drawImage(this._relief,
            (cx - view + half) / pixel, (cz - span * height / width / 2 + half) / pixel, span / pixel, span * height / width / pixel,
            0, 0, width, height);

        // Aérodrome
        for (const shape of this.shapes) {
            ctx.fillStyle = shape.kind === 'runway' ? '#3a3d42' : '#6b6e73';
            ctx.fillRect(toX(shape.minX), toY(shape.minZ), (shape.maxX - shape.minX) * scale, (shape.maxZ - shape.minZ) * scale);
        }
        ctx.fillStyle = 'white';
        ctx.font = `bold ${Math.round(11 * ratio)}px DejaVu Sans Mono, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const runway of this.runways) {
            const outward = runway.direction ? -runway.direction.z : 0;   // le numéro est écrit avant le seuil
            ctx.fillText(runway.name, toX(runway.threshold.x), toY(runway.threshold.z) + outward * 14 * ratio);
        }

        // Balises VOR : hexagone bleu, indicatif et fréquence
        for (const nav of this.navaids) {
            const x = toX(nav.x), y = toY(nav.z), size = 7 * ratio;
            ctx.strokeStyle = '#1f5fbf';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.lineWidth = 2 * ratio;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) ctx.lineTo(x + Math.cos(i * Math.PI / 3) * size, y + Math.sin(i * Math.PI / 3) * size);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#1f5fbf';
            ctx.beginPath();
            ctx.arc(x, y, 1.6 * ratio, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = `bold ${Math.round(10 * ratio)}px DejaVu Sans Mono, monospace`;
            ctx.textAlign = 'left';
            ctx.lineWidth = 3 * ratio;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.strokeText(`VOR ${nav.ident} ${nav.frequency}`, x + 10 * ratio, y);
            ctx.fillText(`VOR ${nav.ident} ${nav.frequency}`, x + 10 * ratio, y);
        }

        // Autres joueurs, puis le joueur (dessus)
        for (const player of others) {
            if (player.crashed) continue;
            this._plane(ctx, toX(player.position.x), toY(player.position.z), player.heading, player.color, 8 * ratio);
            ctx.font = `bold ${Math.round(11 * ratio)}px DejaVu Sans Mono, monospace`;
            ctx.textAlign = 'left';
            ctx.lineWidth = 3 * ratio;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
            const text = `${player.name}${player.offline ? ' (hors ligne)' : player.speaking ? ' (radio)' : ''}`;
            const sub = `${(Math.round(Math.max(0, player.altitude) / 10) * 10).toLocaleString('fr-FR')} ft`;
            const x = toX(player.position.x) + 11 * ratio, y = toY(player.position.z);
            ctx.strokeText(text, x, y - 6 * ratio);
            ctx.strokeText(sub, x, y + 7 * ratio);
            ctx.fillStyle = player.speaking ? '#39ff6a' : 'white';
            ctx.fillText(text, x, y - 6 * ratio);
            ctx.fillStyle = '#d8dde3';
            ctx.fillText(sub, x, y + 7 * ratio);
        }
        if (!own.hidden) this._plane(ctx, toX(own.position.x), toY(own.position.z), own.heading, own.color, 10 * ratio, true);

        this._scaleBar(ctx, width, height, scale, ratio);
        // Nord
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.lineWidth = 3 * ratio;
        ctx.font = `bold ${Math.round(13 * ratio)}px DejaVu Sans Mono, monospace`;
        ctx.textAlign = 'center';
        const nx = width - 20 * ratio;
        ctx.beginPath();
        ctx.moveTo(nx, 8 * ratio);
        ctx.lineTo(nx + 7 * ratio, 20 * ratio);
        ctx.lineTo(nx - 7 * ratio, 20 * ratio);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.strokeText('N', nx, 32 * ratio);
        ctx.fillText('N', nx, 32 * ratio);
        ctx.restore();
    }

    // Silhouette d'avion vue de dessus, nez vers le cap
    _plane(ctx, x, y, heading, color, size, self = false) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(heading * Math.PI / 180);
        ctx.beginPath();
        ctx.moveTo(0, -size);                       // nez
        ctx.lineTo(size * 0.18, -size * 0.35);
        ctx.lineTo(size, -size * 0.1);              // aile droite
        ctx.lineTo(size, size * 0.12);
        ctx.lineTo(size * 0.15, size * 0.05);
        ctx.lineTo(size * 0.12, size * 0.65);
        ctx.lineTo(size * 0.45, size * 0.85);       // empennage
        ctx.lineTo(size * 0.45, size);
        ctx.lineTo(-size * 0.45, size);
        ctx.lineTo(-size * 0.45, size * 0.85);
        ctx.lineTo(-size * 0.12, size * 0.65);
        ctx.lineTo(-size * 0.15, size * 0.05);
        ctx.lineTo(-size, size * 0.12);             // aile gauche
        ctx.lineTo(-size, -size * 0.1);
        ctx.lineTo(-size * 0.18, -size * 0.35);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = size * (self ? 0.22 : 0.16);
        ctx.strokeStyle = self ? 'white' : 'rgba(0, 0, 0, 0.8)';
        ctx.stroke();
        ctx.restore();
    }

    // Échelle en milles nautiques (NM)
    _scaleBar(ctx, width, height, scale, ratio) {
        const nm = [0.1, 0.25, 0.5, 1].find((value) => value * NM * scale >= 70 * ratio) ?? 1;
        const length = nm * NM * scale;
        const x = 14 * ratio, y = height - 16 * ratio;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.lineWidth = 5 * ratio;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + length, y);
        ctx.stroke();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2 * ratio;
        ctx.stroke();
        ctx.font = `bold ${Math.round(11 * ratio)}px DejaVu Sans Mono, monospace`;
        ctx.textAlign = 'left';
        ctx.lineWidth = 3 * ratio;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        const text = `${nm.toLocaleString('fr-FR')} NM`;
        ctx.strokeText(text, x, y - 10 * ratio);
        ctx.fillStyle = 'white';
        ctx.fillText(text, x, y - 10 * ratio);
    }

    _buildRelief() {
        const n = RELIEF_PIXELS, pixel = this.worldSize / n, half = this.worldSize / 2;
        const heights = new Float32Array(n * n);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) heights[j * n + i] = this.heightAt(-half + (i + 0.5) * pixel, -half + (j + 0.5) * pixel);
        }
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = n;
        const ctx = canvas.getContext('2d');
        const image = ctx.createImageData(n, n);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const h = heights[j * n + i];
                // Ombrage : pente vers le nord-ouest éclairée, vers le sud-est dans l'ombre
                const dx = heights[j * n + Math.min(n - 1, i + 1)] - heights[j * n + Math.max(0, i - 1)];
                const dz = heights[Math.min(n - 1, j + 1) * n + i] - heights[Math.max(0, j - 1) * n + i];
                const [r, g, b] = reliefColor(h, -(dx + dz) / (pixel * 2) * 1.2);
                const k = (j * n + i) * 4;
                image.data[k] = r;
                image.data[k + 1] = g;
                image.data[k + 2] = b;
                image.data[k + 3] = 255;
            }
        }
        ctx.putImageData(image, 0, 0);
        return canvas;
    }
}

export { MapView };
