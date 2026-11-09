import { MathUtils, Vector3 } from 'three';
import { GUN } from './Weapons.js';

// Affichage du combat, par-dessus l'écran de vol (vue cabine et extérieure) :
// - mode air-air : réticule du canon (point où seront les obus à la distance de la cible la plus proche), cadres sur
//   les avions des autres joueurs (nom, distance) et point d'anticipation (où sera la cible quand les obus y
//   arriveront : réticule dessus = coups au but) ;
// - mode air-sol : losange sur la croix rouge, distance, temps avant l'impact du missile ;
// - munitions, état des dégâts (structure, réacteurs, ailes, empennage), écran qui rougit quand on est touché,
//   croix blanche quand nos obus touchent, messages (cible hors de portée, abattu…).

const GREEN = 'rgba(90, 255, 130, 0.95)';
const RED = 'rgba(255, 60, 50, 0.95)';
const TARGET_RANGE = 6000;     // m : avions encadrés jusqu'à 6 km
const GUN_RANGE = 1800;        // m : au-delà, le réticule reste réglé à 600 m
const DEFAULT_RANGE = 600;
const MESSAGE_TIME = 3;        // s

const _point = new Vector3(), _camera = new Vector3(), _dir = new Vector3(), _lead = new Vector3(), _pipper = new Vector3();

function formatKm(meters) {
    return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

class WeaponHud {
    constructor(canvas, view) {
        this.canvas = canvas;
        this.view = view;
        this.ctx = canvas.getContext('2d');
        this._rect = '';
        this._shown = false;
        this._message = '';
        this._messageTime = 0;
        this._messageRed = false;
        this.flash = 0;   // écran rouge (touché)
    }

    message(text, red = false) {
        this._message = text;
        this._messageTime = MESSAGE_TIME;
        this._messageRed = red;
    }

    _resize() {
        const r = this.view.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const key = `${r.left}/${r.top}/${r.width}/${r.height}/${dpr}`;
        if (key === this._rect) return;
        this._rect = key;
        Object.assign(this.canvas.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        this.canvas.width = Math.max(1, Math.round(r.width * dpr));
        this.canvas.height = Math.max(1, Math.round(r.height * dpr));
        this._dpr = dpr;
        this._w = r.width;
        this._h = r.height;
    }

    // Point du monde -> pixels (CSS) de l'écran ; null derrière la caméra
    _project(world, camera) {
        _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
        _camera.setFromMatrixPosition(camera.matrixWorld);
        if (_point.subVectors(world, _camera).dot(_dir) <= 0.5) return null;
        _point.copy(world).project(camera);
        return { x: (_point.x + 1) / 2 * this._w, y: (1 - _point.y) / 2 * this._h };
    }

    // s : { camera, aircraft, velocity, weapons, damage, jet, armed, targets, getVelocity(id), cabin }
    update(delta, visible, s = null) {
        this._messageTime = Math.max(0, this._messageTime - delta);
        this.flash = Math.max(0, this.flash - delta * 1.5);
        const show = visible && s && (s.jet || s.damage.damaged || this._messageTime > 0 || this.flash > 0);
        if (!show) {
            if (this._shown) {
                this._shown = false;
                this.canvas.hidden = true;
            }
            return;
        }
        if (!this._shown) {
            this._shown = true;
            this.canvas.hidden = false;
        }
        this._resize();
        const ctx = this.ctx, W = this._w, H = this._h;
        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        // Touché : bords de l'écran rouges
        if (this.flash > 0) {
            const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
            g.addColorStop(0, 'rgba(255,0,0,0)');
            g.addColorStop(1, `rgba(255,0,0,${0.55 * Math.min(1, this.flash)})`);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
        }

        const { camera, weapons } = s;
        ctx.lineWidth = 2;
        ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
        ctx.textBaseline = 'middle';
        let pipper = null;

        if (s.jet && s.armed) {
            camera.updateMatrixWorld();
            _camera.setFromMatrixPosition(camera.matrixWorld);
            const focal = H / 2 / Math.tan(MathUtils.degToRad(camera.fov) / 2);
            // Cible la plus proche devant nous (réticule réglé à sa distance)
            let nearest = null;
            const boxes = [];
            for (const t of s.targets) {
                const distance = t.group.position.distanceTo(s.aircraft.position);
                if (distance > TARGET_RANGE) continue;
                const screen = this._project(t.group.position, camera);
                if (!screen) continue;
                boxes.push({ t, distance, screen });
                if (distance < GUN_RANGE && (!nearest || distance < nearest.distance)) nearest = { t, distance, screen };
            }
            if (!weapons.agMode) {
                const range = nearest ? nearest.distance : DEFAULT_RANGE;
                weapons.bulletPoint(s.aircraft, s.velocity, range, _pipper);
                pipper = this._project(_pipper, camera);
                // Point d'anticipation : la cible dans le temps de vol des obus
                let lead = null;
                if (nearest) {
                    const time = range / GUN.velocity;
                    _lead.copy(nearest.t.group.position).addScaledVector(nearest.t.velocity, time);
                    lead = this._project(_lead, camera);
                }
                const size = nearest ? Math.max(10, 16 / nearest.distance * focal) : 0;
                const onTarget = pipper && lead && Math.hypot(pipper.x - lead.x, pipper.y - lead.y) < Math.max(8, size * 0.5);
                for (const b of boxes) {
                    const near = nearest && b.t === nearest.t;
                    const color = near && onTarget ? RED : GREEN;
                    const half = MathUtils.clamp(14 / b.distance * focal, 9, 60);
                    ctx.strokeStyle = ctx.fillStyle = color;
                    ctx.strokeRect(b.screen.x - half, b.screen.y - half, half * 2, half * 2);
                    ctx.textAlign = 'center';
                    ctx.fillText(`${b.t.name} ${formatKm(b.distance)}`, b.screen.x, b.screen.y + half + 11);
                    if (near && lead) {
                        ctx.beginPath();
                        ctx.moveTo(lead.x, lead.y - 6); ctx.lineTo(lead.x + 6, lead.y); ctx.lineTo(lead.x, lead.y + 6); ctx.lineTo(lead.x - 6, lead.y);
                        ctx.closePath();
                        ctx.fill();
                        ctx.beginPath();
                        ctx.setLineDash([3, 4]);
                        ctx.moveTo(b.screen.x, b.screen.y);
                        ctx.lineTo(lead.x, lead.y);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                }
                // Réticule : cercle, point central, arc de distance (plein à 1 800 m)
                if (pipper) {
                    ctx.strokeStyle = ctx.fillStyle = onTarget ? RED : GREEN;
                    ctx.beginPath();
                    ctx.arc(pipper.x, pipper.y, 22, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(pipper.x, pipper.y, 2.5, 0, Math.PI * 2);
                    ctx.fill();
                    if (nearest) {
                        ctx.lineWidth = 4;
                        ctx.beginPath();
                        ctx.arc(pipper.x, pipper.y, 27, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * nearest.distance / GUN_RANGE);
                        ctx.stroke();
                        ctx.lineWidth = 2;
                    }
                    if (onTarget) {
                        ctx.textAlign = 'center';
                        ctx.fillText('TIR', pipper.x, pipper.y - 38);
                    }
                }
            } else {
                // Mode air-sol : autres avions juste encadrés ; croix entourée d'un losange
                ctx.strokeStyle = ctx.fillStyle = GREEN;
                for (const b of boxes) {
                    const half = MathUtils.clamp(14 / b.distance * focal, 9, 60);
                    ctx.strokeRect(b.screen.x - half, b.screen.y - half, half * 2, half * 2);
                }
                if (weapons.target) {
                    const screen = this._project(weapons.target, camera);
                    const range = weapons.target.distanceTo(s.aircraft.position);
                    if (screen) {
                        ctx.strokeStyle = ctx.fillStyle = RED;
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        ctx.moveTo(screen.x, screen.y - 26); ctx.lineTo(screen.x + 26, screen.y);
                        ctx.lineTo(screen.x, screen.y + 26); ctx.lineTo(screen.x - 26, screen.y);
                        ctx.closePath();
                        ctx.stroke();
                        ctx.lineWidth = 2;
                        ctx.textAlign = 'center';
                        ctx.fillText(`${weapons.targetLocked ? 'CROIX POSÉE · ' : ''}${formatKm(range)}`, screen.x, screen.y + 40);
                    }
                }
            }

            // Munitions et mode (en haut, au centre)
            const impact = weapons.nextImpact;
            const lines = [
                `${weapons.agMode ? 'AIR-SOL' : 'AIR-AIR'}   M61 ${String(weapons.ammo).padStart(3, ' ')}   AGM-65 ×${weapons.missiles}`,
                weapons.agMode
                    ? (weapons.target ? `Clic : poser la croix · → : missile${weapons.targetLocked ? ' · ← : déplacer' : ''}` : 'Visez le sol (souris)')
                    : '↑ : canon · ↓ : mode air-sol',
            ];
            if (impact !== null) lines.push(`MISSILE EN VOL · IMPACT ${Math.ceil(impact)} s`);
            this._box(ctx, W / 2, 62, lines, GREEN);
        }

        // Nos obus touchent : croix blanche
        if (weapons.hitMarker > 0) {
            const c = pipper ?? { x: W / 2, y: H / 2 };
            ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, weapons.hitMarker * 4)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                ctx.moveTo(c.x + dx * 10, c.y + dy * 10);
                ctx.lineTo(c.x + dx * 20, c.y + dy * 20);
            }
            ctx.stroke();
            ctx.lineWidth = 2;
        }

        // Dégâts : barres à gauche (vert -> orange -> rouge, feu clignotant)
        if (s.damage.damaged) {
            const items = s.damage.status(s.jet);
            const x = 14, y0 = 110, rowH = 18, w = 150;
            ctx.fillStyle = 'rgba(10,12,16,0.6)';
            ctx.fillRect(x - 6, y0 - 22, w + 12, items.length * rowH + 30);
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fff';
            ctx.fillText('DÉGÂTS', x, y0 - 10);
            items.forEach((item, i) => {
                const y = y0 + i * rowH + 6;
                const v = MathUtils.clamp(item.value, 0, 1);
                const blink = item.fire && Math.floor(performance.now() / 250) % 2 === 0;
                ctx.fillStyle = blink ? '#ff8a20' : '#d8dde3';
                ctx.fillText(item.fire ? `${item.label} FEU` : item.label, x, y);
                const color = v > 0.66 ? '#4cd964' : v > 0.33 ? '#ffb000' : '#ff3b30';
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.fillRect(x + 82, y - 5, w - 82, 10);
                ctx.fillStyle = color;
                ctx.fillRect(x + 82, y - 5, (w - 82) * v, 10);
            });
        }

        // Message (au centre)
        if (this._messageTime > 0 && this._message) {
            ctx.globalAlpha = Math.min(1, this._messageTime);
            ctx.font = 'bold 18px DejaVu Sans Mono, monospace';
            this._box(ctx, W / 2, H * 0.3, [this._message], this._messageRed ? RED : '#ffffff');
            ctx.globalAlpha = 1;
        }
    }

    _box(ctx, cx, cy, lines, color) {
        const lineH = parseInt(ctx.font.match(/(\d+)px/)?.[1] ?? '13', 10) + 6;
        const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24;
        const height = lines.length * lineH + 10;
        ctx.fillStyle = 'rgba(10,12,16,0.6)';
        ctx.fillRect(cx - width / 2, cy - height / 2, width, height);
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        lines.forEach((line, i) => ctx.fillText(line, cx, cy - height / 2 + 5 + lineH * (i + 0.5)));
    }
}

export { WeaponHud };
