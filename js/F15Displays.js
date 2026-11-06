import { CanvasTexture, MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

// Écrans du cockpit du F-15C, dessinés en direct (vert sur fond noir, comme les vrais tubes) sur les surfaces des
// écrans du modèle FlightGear (VSDImage, TEWSImage, MPCDImage, voir F15Cockpit.js) :
// - VSD (Vertical Situation Display, en haut à gauche) : radar APG-63 en balayage air-air (RWS), présentation « B-scope »
//   (azimut en abscisse, distance en ordonnée) : échos des autres avions de la partie dans le cône de ±60°, avec leur
//   altitude (milliers de pieds), barre de balayage, horizon artificiel, curseur d'acquisition, échelle de distance
//   (clic : moitié gauche plus courte, moitié droite plus longue), « STBY » au sol (radar en attente, pas d'émission
//   train sur roues) ;
// - TEWS (Tactical Electronic Warfare System, en haut à droite) : détecteur d'alerte radar ALR-56 : les radars qui
//   éclairent l'avion, placés à leur relèvement : radars de surveillance des aérodromes (« S »), radars d'autres F-15
//   dont le nez est tourné vers nous (« 15 ») ; le plus proche est entouré (menace prioritaire) ;
// - MPCD (Multi-Purpose Color Display, en bas à gauche) : page armement : silhouette de l'avion et ses points d'emport
//   (vides : le F-15 du simulateur vole sans charges), canon (940 obus), interrupteur MASTER ARM, libellés des boutons.
// Écrans éteints sans courant ; le radar et le TEWS demandent les génératrices (un réacteur en marche).

const GREEN = '#5dff7a', DIM = 'rgba(93,255,122,0.45)', FAINT = 'rgba(93,255,122,0.18)';
const NM = 1852;
const RANGES = [10, 20, 40, 80, 160];   // NM
const SCAN = 60;                        // ° de part et d'autre du nez
const deg = MathUtils.degToRad;

function screen(width, height, size) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(size * Math.min(1, width / height));
    canvas.height = Math.round(size * Math.min(1, height / width));
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: texture, toneMapped: false }));
    mesh.renderOrder = 1;
    return { mesh, texture, ctx: canvas.getContext('2d'), W: canvas.width, H: canvas.height };
}

// Relèvement (°, -180 -> 180, + = à droite) et distance (m) d'un point vu de l'avion
function relative(own, x, z) {
    const dx = x - own.position.x, dz = z - own.position.z;
    let bearing = MathUtils.radToDeg(Math.atan2(dx, -dz)) - own.heading;
    bearing = ((bearing + 540) % 360) - 180;
    return { bearing, distance: Math.hypot(dx, dz) };
}

class F15Displays {
    constructor() {
        this.range = 2;           // indice dans RANGES (40 NM)
        this._next = 0;
        this._sweep = 0;          // position de la barre de balayage (-1 -> 1)
        this._sweepDir = 1;
        this._hits = new Map();   // échos affichés (gardés jusqu'au passage suivant du balayage)
    }

    // Surfaces : { vsd, tews, mpcd } : { center (Vector3, repère du cockpit), width, height }
    build(group, surfaces) {
        const make = (s, size) => {
            const d = screen(s.width, s.height, size);
            d.mesh.position.copy(s.center);
            d.mesh.position.z += 0.0006;   // juste devant la vitre du modèle
            group.add(d.mesh);
            return d;
        };
        this.vsd = make(surfaces.vsd, 320);
        this.tews = make(surfaces.tews, 320);
        this.mpcd = make(surfaces.mpcd, 360);
        this.vsd.mesh.userData.control = 'jet:vsdRange';
        return [this.vsd.mesh];   // cliquable : échelle de distance du radar
    }

    stepRange(step) {
        this.range = MathUtils.clamp(this.range + step, 0, RANGES.length - 1);
        this._hits.clear();
    }

    // data : { time, delta, powered, radarPower, onGround, own: { position, heading, pitchDeg, rollDeg, altitudeFt },
    // targets: [{ position, heading, altitude (ft), type, name }], sites: [{ x, z }], gun, masterArm }
    update(data) {
        if (!this.vsd) return;
        // Balayage du radar : un aller-retour de ±60° en ~4 s
        this._sweep += this._sweepDir * data.delta / 2;
        if (Math.abs(this._sweep) >= 1) {
            this._sweep = MathUtils.clamp(this._sweep, -1, 1);
            this._sweepDir *= -1;
        }
        if (data.time < this._next) return;
        this._next = data.time + 1 / 15;
        this._drawVsd(data);
        this._drawTews(data);
        this._drawMpcd(data);
    }

    _blank(d) {
        d.ctx.fillStyle = '#020604';
        d.ctx.fillRect(0, 0, d.W, d.H);
        d.texture.needsUpdate = true;
    }

    _drawVsd(data) {
        const d = this.vsd, { ctx, W, H } = d;
        if (!data.powered) return this._blank(d);
        ctx.fillStyle = '#020604';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = ctx.fillStyle = GREEN;
        ctx.lineWidth = 2;
        ctx.font = 'bold 15px monospace';
        ctx.textBaseline = 'middle';
        const L = 34, R = W - 20, T = 26, B = H - 34;   // zone du B-scope
        const range = RANGES[this.range];
        // Cadre en coins, graduations d'azimut (tous les 10°) et de distance (quarts)
        ctx.strokeStyle = DIM;
        ctx.beginPath();
        for (const [x, y, sx, sy] of [[L, T, 1, 1], [R, T, -1, 1], [L, B, 1, -1], [R, B, -1, -1]]) {
            ctx.moveTo(x + sx * 14, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * 14);
        }
        for (let a = -SCAN; a <= SCAN; a += 10) {
            const x = L + (a + SCAN) / (2 * SCAN) * (R - L);
            ctx.moveTo(x, B + 4); ctx.lineTo(x, B + (a % 30 === 0 ? 12 : 8));
        }
        for (let q = 1; q < 4; q++) {
            const y = B - q / 4 * (B - T);
            ctx.moveTo(L - 8, y); ctx.lineTo(L - 3, y);
        }
        ctx.stroke();
        ctx.strokeStyle = GREEN;
        // Échelle de distance (en haut à gauche), mode et cadence
        ctx.textAlign = 'left';
        ctx.fillText(String(range), 4, T + 2);
        ctx.font = 'bold 12px monospace';
        ctx.fillText('RWS', L + 4, 12);
        ctx.textAlign = 'right';
        ctx.fillText('MED', R, 12);
        ctx.textAlign = 'center';
        ctx.fillText('4B', (L + R) / 2, 12);
        if (!data.radarPower || data.onGround) {
            // Radar en attente : pas d'émission (train sur roues, ou pas de génératrice)
            ctx.font = 'bold 22px monospace';
            ctx.fillText('STBY', (L + R) / 2, (T + B) / 2);
            this._hits.clear();
        } else {
            // Barre de balayage (curseur d'azimut de l'antenne, en bas) et échos : un écho apparaît quand la barre passe
            // dessus et reste jusqu'au passage suivant
            const sweepX = L + (this._sweep + 1) / 2 * (R - L);
            ctx.beginPath();
            ctx.moveTo(sweepX, B + 14); ctx.lineTo(sweepX - 5, B + 22); ctx.lineTo(sweepX + 5, B + 22); ctx.closePath();
            ctx.fill();
            const own = data.own;
            for (const target of data.targets) {
                const { bearing, distance } = relative(own, target.position.x, target.position.z);
                const nm = distance / NM;
                if (Math.abs(bearing) > SCAN || nm > range) continue;
                const x = L + (bearing + SCAN) / (2 * SCAN) * (R - L);
                if (Math.abs(x - sweepX) < 10) this._hits.set(target.id ?? target.name, { x, y: B - nm / range * (B - T), alt: target.altitude, seen: data.time });
            }
            for (const [key, hit] of this._hits) {
                if (data.time - hit.seen > 4.5) { this._hits.delete(key); continue; }
                ctx.fillRect(hit.x - 5, hit.y - 3, 10, 6);
                ctx.font = 'bold 12px monospace';
                ctx.textAlign = 'left';
                ctx.fillText(String(Math.max(0, Math.round(hit.alt / 1000))), hit.x + 8, hit.y);
            }
            // Curseur d'acquisition (deux barres) au centre, avec la tranche d'altitude couverte par le balayage
            const cx = (L + R) / 2, cy = T + (B - T) * 0.62;
            ctx.beginPath();
            ctx.moveTo(cx - 6, cy - 9); ctx.lineTo(cx - 6, cy + 9);
            ctx.moveTo(cx + 6, cy - 9); ctx.lineTo(cx + 6, cy + 9);
            ctx.stroke();
            const cover = Math.round(range * NM * Math.tan(deg(5)) / 0.3048 / 1000);
            const alt = Math.round(own.altitudeFt / 1000);
            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(String(alt + cover).padStart(2, '0'), cx + 10, cy - 10);
            ctx.fillText(String(alt - cover).padStart(2, '0'), cx + 10, cy + 10);
        }
        // Horizon artificiel (assiette et inclinaison), en tirets
        ctx.save();
        ctx.beginPath();
        ctx.rect(L, T, R - L, B - T);
        ctx.clip();
        ctx.translate((L + R) / 2, (T + B) / 2 + data.own.pitchDeg * 2.2);
        ctx.rotate(deg(data.own.rollDeg));
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = DIM;
        ctx.beginPath();
        ctx.moveTo(-W, 0); ctx.lineTo(-18, 0); ctx.moveTo(18, 0); ctx.lineTo(W, 0);
        ctx.stroke();
        ctx.restore();
        d.texture.needsUpdate = true;
    }

    _drawTews(data) {
        const d = this.tews, { ctx, W, H } = d;
        if (!data.powered) return this._blank(d);
        ctx.fillStyle = '#020604';
        ctx.fillRect(0, 0, W, H);
        const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 10;
        ctx.strokeStyle = FAINT;
        ctx.lineWidth = 1.5;
        // Cercles (lointain, menace) et graduations tous les 30°
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.moveTo(cx + r * 0.5, cy);
        ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
        for (let a = 0; a < 360; a += 30) {
            const s = Math.sin(deg(a)), c = Math.cos(deg(a));
            ctx.moveTo(cx + s * (r - 8), cy - c * (r - 8)); ctx.lineTo(cx + s * r, cy - c * r);
        }
        ctx.stroke();
        ctx.strokeStyle = ctx.fillStyle = GREEN;
        ctx.lineWidth = 2;
        // Avion au centre
        ctx.beginPath();
        ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 6); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
        ctx.stroke();
        if (!data.radarPower) {
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('STBY', cx, cy + 30);
            d.texture.needsUpdate = true;
            return;
        }
        // Radars qui nous éclairent : position sur l'écran selon le relèvement ; anneau intérieur = menace proche
        const own = data.own, emitters = [];
        for (const site of data.sites) {
            const { bearing, distance } = relative(own, site.x, site.z);
            if (distance < 110 * NM) emitters.push({ bearing, distance, label: 'S', lethal: false });
        }
        for (const target of data.targets) {
            if (target.type !== 'f15') continue;
            const { bearing, distance } = relative(own, target.position.x, target.position.z);
            // Son radar couvre ±60° autour de son nez : il nous éclaire si nous sommes dans ce cône
            const back = ((target.heading - (own.heading + bearing + 180)) % 360 + 540) % 360 - 180;
            if (Math.abs(back) < SCAN && distance < 80 * NM) emitters.push({ bearing, distance, label: '15', lethal: distance < 20 * NM });
        }
        // Priorité : radars de chasseurs (le plus proche d'abord), puis radars de surveillance
        emitters.sort((a, b) => (a.label === 'S') - (b.label === 'S') || a.distance - b.distance);
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        emitters.slice(0, 8).forEach((e, i) => {
            const k = e.lethal ? 0.38 : 0.78;
            const x = cx + Math.sin(deg(e.bearing)) * r * k, y = cy - Math.cos(deg(e.bearing)) * r * k;
            ctx.fillText(e.label, x, y);
            if (i === 0) {
                // Menace prioritaire : losange
                ctx.beginPath();
                ctx.moveTo(x, y - 15); ctx.lineTo(x + 15, y); ctx.lineTo(x, y + 15); ctx.lineTo(x - 15, y); ctx.closePath();
                ctx.stroke();
            }
        });
        d.texture.needsUpdate = true;
    }

    _drawMpcd(data) {
        const d = this.mpcd, { ctx, W, H } = d;
        if (!data.powered) return this._blank(d);
        ctx.fillStyle = '#020604';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = ctx.fillStyle = GREEN;
        ctx.lineWidth = 2;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        // Libellés des boutons du pourtour
        ctx.font = 'bold 12px monospace';
        const top = ['A/A', 'A/G', 'PROG', 'BIT', 'MENU'], bottom = ['JETT', 'STAT', 'MODE', 'PACS', 'DATA'];
        top.forEach((t, i) => ctx.fillText(t, (i + 0.5) * W / 5, 12));
        bottom.forEach((t, i) => ctx.fillText(t, (i + 0.5) * W / 5, H - 12));
        // Silhouette de l'avion (vue de dessus) et points d'emport : vides
        const cx = W / 2, cy = H / 2 + 6, s = W / 300;
        ctx.beginPath();
        const outline = [[0, -95], [12, -60], [16, -20], [95, 25], [95, 40], [20, 32], [22, 70], [50, 88], [50, 98], [12, 92], [0, 96]];
        outline.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x * s, cy + y * s) : ctx.moveTo(cx + x * s, cy + y * s)));
        [...outline].reverse().forEach(([x, y]) => ctx.lineTo(cx - x * s, cy + y * s));
        ctx.stroke();
        ctx.font = 'bold 11px monospace';
        const stations = [[-62, 30, 'LW'], [62, 30, 'RW'], [-26, 0, 'LC'], [26, 0, 'RC'], [0, 18, 'CL'], [-26, 55, 'LF'], [26, 55, 'RF']];
        for (const [x, y, name] of stations) {
            ctx.strokeStyle = DIM;
            ctx.strokeRect(cx + x * s - 12, cy + y * s - 8, 24, 16);
            ctx.fillStyle = DIM;
            ctx.fillText(name, cx + x * s, cy + y * s);
        }
        ctx.strokeStyle = ctx.fillStyle = GREEN;
        // Canon, armement principal, master arm
        ctx.font = 'bold 15px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`GUN ${data.gun}`, 14, 40);
        ctx.font = 'bold 12px monospace';
        ctx.fillText('M61 HEI', 14, 58);
        ctx.textAlign = 'right';
        ctx.fillText('NO STORES', W - 14, 40);
        ctx.fillText(data.masterArm ? 'ARM' : 'SAFE', W - 14, 58);
        ctx.textAlign = 'center';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(`FUEL ${Math.round(data.fuelLb / 100) * 100}`, cx, H - 36);
        d.texture.needsUpdate = true;
    }
}

export { F15Displays };
