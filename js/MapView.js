// Carte vue de dessus (bouton Carte du bandeau, touche M) : relief, aérodrome, avion du joueur et des autres joueurs.
// Nord en haut. Le relief est calculé une seule fois, à la première ouverture.

const NM = 1852;
const RELIEF_PIXELS = 480;               // finesse de l'image du relief (pour tout le terrain : ~33 m par pixel)
const ZOOMS = [14000, 6000, 3000, 1500, 700];   // largeur montrée par la carte (m) ; la plus large montre les deux aérodromes
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

// Couleur de la trajectoire selon l'altitude ramenée à [0, 1] : bleu (bas), vert, jaune, rouge (haut)
function altitudeColor(f) {
    const k = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
    return `hsl(${Math.round(210 * (1 - k))}, 85%, 55%)`;
}

// Points de la trajectoire espacés de `interval` secondes au moins (premier et dernier gardés), positions finies seulement
function trackPoints(samples, interval = 1) {
    const out = [];
    let last = null;
    for (const s of samples ?? []) {
        if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
        if (!last || s.t - last.t >= interval) { out.push(s); last = s; }
    }
    const end = [...(samples ?? [])].reverse().find((s) => Number.isFinite(s.x) && Number.isFinite(s.z));
    if (end && out[out.length - 1] !== end) out.push(end);
    return out;
}

// Position et cap (degrés) à l'instant t, interpolés entre deux échantillons (cap par le plus court chemin) ; t ramené
// à la durée du vol ; null sans échantillon
function trackPoseAt(samples, t) {
    const n = samples?.length ?? 0;
    if (!n) return null;
    if (t <= samples[0].t) return { x: samples[0].x, z: samples[0].z, hdg: samples[0].hdg ?? 0 };
    if (t >= samples[n - 1].t) return { x: samples[n - 1].x, z: samples[n - 1].z, hdg: samples[n - 1].hdg ?? 0 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].t <= t) lo = mid; else hi = mid; }
    const a = samples[lo], b = samples[hi];
    const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    const turn = ((((b.hdg ?? 0) - (a.hdg ?? 0)) % 360) + 540) % 360 - 180;
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, hdg: (((a.hdg ?? 0) + turn * k) % 360 + 360) % 360 };
}

class MapView {
    // heightAt(x, z) : hauteur du sol ; worldSize : côté du terrain (m) ; shapes : pistes et parkings [{ minX, maxX, minZ, maxZ, kind }]
    // runways : [{ name, threshold }]
    // ndbs : balises NDB [{ ident, khz, position: { x, z }, kind: 'ndb' | 'locator' }]
    constructor(canvas, { heightAt, waterAt = () => false, worldSize, shapes = [], runways = [], navaids = [], ndbs = [], zooms = ZOOMS }) {
        this.canvas = canvas;
        this.heightAt = heightAt;
        this.waterAt = waterAt;   // vrai sur un lac
        this.worldSize = worldSize;
        this.shapes = shapes;
        this.runways = runways;
        this.navaids = navaids;
        this.ndbs = ndbs;
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

    // Relief d'une autre carte (même terrain) réutilisé au lieu d'être recalculé (230 400 appels à heightAt) : la
    // carte du débriefing partage celle du jeu ; calculé une seule fois, par la première des deux qui dessine
    shareRelief(other) {
        if (other && other !== this) this._reliefSource = other;
        return this;
    }

    // Cadrage continu sur un rectangle du terrain (m), marge relative de chaque côté ; remplace le cadrage sur
    // l'avion et les zooms discrets jusqu'à clearFit()
    fit(minX, maxX, minZ, maxZ, margin = 0.1) {
        this._fit = { minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ), margin };
        this._timer = 0;
        return this;
    }

    // Cadrage sur une trajectoire enregistrée (échantillons { x, z } de js/FlightRecorder.js)
    fitTrack(samples, margin = 0.1) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const s of samples ?? []) {
            if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
            minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
        }
        if (minX > maxX) return this.clearFit();
        return this.fit(minX, maxX, minZ, maxZ, margin);
    }

    clearFit() {
        this._fit = null;
        this._timer = 0;
        return this;
    }

    // Fenêtre montrée pour un canvas de width × height pixels : centre (m) et largeur (m). Sans fit : centrée sur
    // l'avion du joueur, largeur du zoom choisi ; avec fit : rectangle entier visible, 1 km de large au moins. Toujours
    // dans le terrain quand la largeur le permet.
    viewWindow(width, height, own) {
        const half = this.worldSize / 2;
        let span, x, z;
        if (this._fit) {
            const f = this._fit;
            const aspect = width / height;
            const w = (f.maxX - f.minX) * (1 + 2 * f.margin), h = (f.maxZ - f.minZ) * (1 + 2 * f.margin);
            span = Math.min(this.worldSize, Math.max(1000, w, h * aspect));
            x = (f.minX + f.maxX) / 2;
            z = (f.minZ + f.maxZ) / 2;
        } else {
            span = this.zooms[Math.min(this.zoom, this.zooms.length - 1)];
            x = own.position.x;
            z = own.position.z;
        }
        const view = span / 2;
        const viewZ = this._fit ? Math.min(half, span * height / width / 2) : view;
        return {
            cx: Math.max(-half + view, Math.min(half - view, x)),
            cz: Math.max(-half + viewZ, Math.min(half - viewZ, z)),
            span,
        };
    }

    draw(own = { hidden: true, position: { x: 0, z: 0 } }, others = []) {
        const canvas = this.canvas;
        const ratio = window.devicePixelRatio || 1;
        const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
        if (!width || !height) return;
        if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
        const ctx = canvas.getContext('2d');
        const source = this._reliefSource;
        this._relief ??= source ? (source._relief ??= source._buildRelief()) : this._buildRelief();

        // Fenêtre montrée : centrée sur l'avion du joueur (ou cadrée par fit), sans sortir du terrain
        const half = this.worldSize / 2;
        const { cx, cz, span } = this.viewWindow(width, height, own);
        const view = span / 2;
        const scale = width / span;   // pixels par mètre
        this._scale = scale;
        this._ratio = ratio;
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
            // Ville (carte « Ville ») : disque gris clair et son nom
            if (shape.kind === 'city') {
                ctx.fillStyle = 'rgba(150, 150, 155, 0.75)';
                ctx.beginPath();
                ctx.arc(toX(shape.x), toY(shape.z), shape.radius * scale, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#2b2d31';
                ctx.font = `bold ${Math.round(12 * ratio)}px DejaVu Sans, sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(shape.label, toX(shape.x), toY(shape.z));
                continue;
            }
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

        // Balises NDB : point central entouré de cercles pointillés (symbole des cartes aéronautiques), indicatif et
        // fréquence ; locators plus petits
        for (const ndb of this.ndbs) {
            const p = ndb.position ?? ndb;
            const x = toX(p.x), y = toY(p.z), small = ndb.kind === 'locator';
            const size = (small ? 5 : 7) * ratio;
            ctx.fillStyle = '#8a3b8f';
            for (const [radius, count] of small ? [[size, 10]] : [[size * 0.6, 8], [size, 12]]) {
                for (let i = 0; i < count; i++) {
                    const a = i / count * Math.PI * 2;
                    ctx.beginPath();
                    ctx.arc(x + Math.cos(a) * radius, y + Math.sin(a) * radius, 0.9 * ratio, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.beginPath();
            ctx.arc(x, y, 1.8 * ratio, 0, Math.PI * 2);
            ctx.fill();
            const label = `${small ? 'L' : 'NDB'} ${ndb.ident} ${ndb.khz}`;
            ctx.font = `bold ${Math.round(10 * ratio)}px DejaVu Sans Mono, monospace`;
            ctx.textAlign = 'left';
            ctx.lineWidth = 3 * ratio;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.strokeText(label, x + size + 3 * ratio, y);
            ctx.fillText(label, x + size + 3 * ratio, y);
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

    // Trajectoire enregistrée (échantillons de js/FlightRecorder.js : t, x, z, alt (ft), hdg), à dessiner juste après
    // draw() : trait coloré selon l'altitude (légende min / max en haut à gauche), un point par seconde environ ;
    // repères [{ x, z, label, color }] ; avion à l'instant cursorT (s), position et cap interpolés
    drawTrack(samples, { cursorT = null, markers = [], color = '#ffd23c' } = {}) {
        if (!this.project || !samples?.length) return;
        const ctx = this.canvas.getContext('2d');
        const ratio = this._ratio ?? 1;
        const points = trackPoints(samples, 1);
        let lo = Infinity, hi = -Infinity;
        for (const p of points) if (Number.isFinite(p.alt)) { lo = Math.min(lo, p.alt); hi = Math.max(hi, p.alt); }
        if (!(lo <= hi)) lo = hi = 0;
        const range = Math.max(1, hi - lo);

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Liseré sombre sous tout le trait, puis segments colorés
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 5 * ratio;
        ctx.beginPath();
        points.forEach((p, i) => {
            const [x, y] = this.project(p.x, p.z);
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke();
        ctx.lineWidth = 3 * ratio;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            const [x0, y0] = this.project(a.x, a.z), [x1, y1] = this.project(b.x, b.z);
            ctx.strokeStyle = altitudeColor((((a.alt + b.alt) / 2) - lo) / range);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }

        // Repères : rond blanc cerclé de leur couleur, libellé
        ctx.font = `bold ${Math.round(11 * ratio)}px DejaVu Sans Mono, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const marker of markers) {
            if (!Number.isFinite(marker.x) || !Number.isFinite(marker.z)) continue;
            const [x, y] = this.project(marker.x, marker.z);
            ctx.beginPath();
            ctx.arc(x, y, 5 * ratio, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.lineWidth = 2.5 * ratio;
            ctx.strokeStyle = marker.color ?? '#e8443a';
            ctx.stroke();
            if (!marker.label) continue;
            ctx.lineWidth = 3 * ratio;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.strokeText(marker.label, x + 9 * ratio, y);
            ctx.fillStyle = marker.color ?? 'white';
            ctx.fillText(marker.label, x + 9 * ratio, y);
        }

        // Légende des altitudes : dégradé et bornes (ft)
        const lx = 12 * ratio, ly = 12 * ratio, lw = 110 * ratio, lh = 8 * ratio;
        const gradient = ctx.createLinearGradient(lx, 0, lx + lw, 0);
        for (let k = 0; k <= 4; k++) gradient.addColorStop(k / 4, altitudeColor(k / 4));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(lx - 4 * ratio, ly - 4 * ratio, lw + 8 * ratio, lh + 22 * ratio);
        ctx.fillStyle = gradient;
        ctx.fillRect(lx, ly, lw, lh);
        ctx.font = `bold ${Math.round(10 * ratio)}px DejaVu Sans Mono, monospace`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'white';
        const ft = (v) => `${(Math.round(v / 10) * 10).toLocaleString('fr-FR')} ft`;
        ctx.textAlign = 'left';
        ctx.fillText(ft(lo), lx, ly + lh + 3 * ratio);
        ctx.textAlign = 'right';
        ctx.fillText(ft(hi), lx + lw, ly + lh + 3 * ratio);
        ctx.restore();

        // Avion à l'instant du curseur
        if (cursorT !== null && cursorT !== undefined) {
            const at = trackPoseAt(samples, cursorT);
            if (at) {
                const [x, y] = this.project(at.x, at.z);
                this._plane(ctx, x, y, at.hdg, color, 10 * ratio, true);
            }
        }
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
                const [r, g, b] = this.waterAt(-half + (i + 0.5) * pixel, -half + (j + 0.5) * pixel)
                    ? [64, 120, 160] : reliefColor(h, -(dx + dz) / (pixel * 2) * 1.2);
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

export { MapView, altitudeColor, trackPoints, trackPoseAt };
