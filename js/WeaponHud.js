import { MathUtils, Vector3 } from 'three';
import { GUN, MISSILE, MISSILE_RELOAD, AAM } from './Weapons.js';

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
const _view = new Vector3();
const HUD_CABIN_ALPHA = 0.5;   // opacité des symboles de tir en cabine (comme la symbologie du HUD)
const HUD_ZONE = 0.34;   // rayon de la zone du triangle de cible (fraction du plus petit côté de l'écran)
// Radar (triangle rouge qui montre l'ennemi) : comme un vrai radar, il ne voit pas un avion qui vole au ras du sol (noyé
// dans les échos du relief), ni un avion trop loin
const RADAR_MIN_HEIGHT = 100 * 0.3048;   // m au-dessus du sol (100 ft) : en dessous, invisible au radar
const RADAR_RANGE = 12000;               // m
const radarSees = (t, distance) => distance <= RADAR_RANGE && (t.agl ?? Infinity) >= RADAR_MIN_HEIGHT;

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
            // En cabine, les symboles de tir se superposent au HUD du F-15 : même opacité que sa symbologie (projetée sur
            // le verre, plus pâle) ; avant, le réticule ressortait bien plus fort que le reste du HUD
            ctx.globalAlpha = s.cabin ? HUD_CABIN_ALPHA : 1;
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
            const gunMode = weapons.selected === 'gun';
            if (gunMode) {
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
                // Réticule : cercle, point central, arc de distance (plein à 1 800 m) ; rouge en surchauffe
                if (pipper) {
                    ctx.strokeStyle = ctx.fillStyle = onTarget || weapons.overheated ? RED : GREEN;
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
                    ctx.textAlign = 'center';
                    if (weapons.overheated) ctx.fillText('SURCHAUFFE', pipper.x, pipper.y - 38);
                    else if (onTarget) ctx.fillText('TIR', pipper.x, pipper.y - 38);
                }
            } else if (weapons.selected === 'aa') {
                // Missile air-air : cercle de l'autodirecteur autour de l'axe du nez ; avion accroché : losange qui se
                // resserre pendant le verrouillage, puis carré rouge « LOCK » et « SHOOT »
                _lead.set(0, 0, -3000).applyQuaternion(s.aircraft.quaternion).add(s.aircraft.position);
                const bore = this._project(_lead, camera);
                const radius = Math.tan(AAM.seeker) * focal;
                // (plus de cercle de l'autodirecteur : centré sur l'axe du nez, il chevauchait la symbologie du HUD ; le
                // triangle rouge montre la cible, le losange et le carré « LOCK » le verrouillage)
                if (bore) {
                    ctx.strokeStyle = ctx.fillStyle = weapons.locked ? RED : GREEN;
                    ctx.textAlign = 'center';
                    ctx.fillText(weapons.locked ? 'AIM-9 · LOCK' : weapons.lockId ? 'AIM-9 · VERROUILLAGE…' : 'AIM-9 · CHERCHE', bore.x, bore.y + radius + 14);
                }
                for (const b of boxes) {
                    const half = MathUtils.clamp(14 / b.distance * focal, 9, 60);
                    const isLock = b.t.id === weapons.lockId;
                    ctx.textAlign = 'center';
                    if (isLock && weapons.locked) {
                        ctx.strokeStyle = ctx.fillStyle = RED;
                        ctx.lineWidth = 3;
                        ctx.strokeRect(b.screen.x - half - 6, b.screen.y - half - 6, half * 2 + 12, half * 2 + 12);
                        ctx.lineWidth = 2;
                        ctx.font = 'bold 15px DejaVu Sans Mono, monospace';
                        ctx.fillText('LOCK', b.screen.x, b.screen.y + half + 36);   // (dessous : le triangle est au-dessus)
                        ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
                        ctx.fillText(`${b.t.name} ${formatKm(b.distance)}`, b.screen.x, b.screen.y + half + 18);
                    } else if (isLock) {
                        const r = half + 6 + 40 * (1 - weapons.lockProgress);
                        ctx.strokeStyle = ctx.fillStyle = 'rgba(255, 210, 70, 1)';
                        ctx.beginPath();
                        ctx.moveTo(b.screen.x, b.screen.y - r); ctx.lineTo(b.screen.x + r, b.screen.y);
                        ctx.lineTo(b.screen.x, b.screen.y + r); ctx.lineTo(b.screen.x - r, b.screen.y);
                        ctx.closePath();
                        ctx.stroke();
                        ctx.fillText(`${b.t.name} ${formatKm(b.distance)}`, b.screen.x, b.screen.y + r + 12);
                    } else {
                        ctx.strokeStyle = ctx.fillStyle = GREEN;
                        ctx.strokeRect(b.screen.x - half, b.screen.y - half, half * 2, half * 2);
                        ctx.fillText(`${b.t.name} ${formatKm(b.distance)}`, b.screen.x, b.screen.y + half + 11);
                    }
                }
                // Triangle rouge pointé sur la cible (avion accroché, sinon le plus proche à portée)
                // (seulement les avions que le radar voit : assez haut au-dessus du sol, pas trop loin)
                const seen = s.targets.map((t) => ({ t, d: t.group.position.distanceTo(s.aircraft.position) })).filter((x) => radarSees(x.t, x.d));
                const guide = seen.find((x) => x.t.id === weapons.lockId)?.t ?? seen.sort((a, b) => a.d - b.d)[0]?.t;
                if (guide) this._targetTriangle(ctx, W, H, camera, guide, weapons.locked, guide.group.position.distanceTo(s.aircraft.position));
                // Verrouillé : « SHOOT » clignotant sous le cercle
                if (weapons.locked && bore && Math.floor(performance.now() / 200) % 2 === 0) {
                    ctx.fillStyle = RED;
                    ctx.font = 'bold 26px DejaVu Sans Mono, monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText('SHOOT', bore.x, bore.y + radius + 42);
                    ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
                }
            } else {
                // Mode missile : les avions restent encadrés ; viseur au sol (losange qui tourne), anneau de rechargement
                ctx.strokeStyle = 'rgba(90, 255, 130, 0.5)';
                for (const b of boxes) {
                    const half = MathUtils.clamp(14 / b.distance * focal, 9, 60);
                    ctx.strokeRect(b.screen.x - half, b.screen.y - half, half * 2, half * 2);
                }
                if (weapons.target) {
                    const screen = this._project(weapons.target, camera);
                    const range = weapons.target.distanceTo(s.aircraft.position);
                    const inRange = range >= MISSILE.minRange && range <= MISSILE.maxRange;
                    if (screen) {
                        const ready = weapons.reload <= 0;
                        ctx.strokeStyle = ctx.fillStyle = inRange ? RED : 'rgba(200,200,200,0.8)';
                        ctx.lineWidth = 2.5;
                        ctx.save();
                        ctx.translate(screen.x, screen.y);
                        ctx.rotate(inRange && ready ? performance.now() / 600 : Math.PI / 4);
                        ctx.strokeRect(-20, -20, 40, 40);
                        ctx.restore();
                        if (!ready) {
                            ctx.lineWidth = 4;
                            ctx.beginPath();
                            ctx.arc(screen.x, screen.y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - weapons.reload / MISSILE_RELOAD));
                            ctx.stroke();
                        }
                        ctx.lineWidth = 2;
                        ctx.textAlign = 'center';
                        ctx.font = 'bold 14px DejaVu Sans Mono, monospace';
                        const label = !inRange ? (range > MISSILE.maxRange ? 'TROP LOIN' : 'TROP PRÈS') : ready ? 'FEU !' : 'RECHARGE…';
                        ctx.fillText(`${label}  ${formatKm(range)}`, screen.x, screen.y + 48);
                        ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
                    }
                }
            }
            // Nos missiles en vol : point d'impact et compte à rebours (les deux modes)
            ctx.textAlign = 'center';
            for (const m of weapons.inFlight) {
                if (!m.own || m.exploded) continue;
                const screen = this._project(m.target, camera);
                if (!screen) continue;
                ctx.strokeStyle = ctx.fillStyle = RED;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, 12, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillText(`IMPACT ${Math.ceil(m.timeToImpact)} s`, screen.x, screen.y - 22);
            }

            // Cartes des armes (en haut, au centre) : arme choisie en évidence, chauffe du canon, rechargement du missile
            ctx.globalAlpha = 1;
            this._cards(ctx, W, weapons, s.touch);
        }

        // Alerte radar : un autre joueur nous accroche / nous a verrouillés
        if (s.threat && s.threat.state !== 'off' && (s.threat.state === 'search' || Math.floor(performance.now() / 180) % 2 === 0)) {
            ctx.font = 'bold 20px DejaVu Sans Mono, monospace';
            const text = s.threat.state === 'lock' ? `VERROUILLÉ PAR ${s.threat.name} ! ← : LEURRES` : `ACCROCHÉ PAR ${s.threat.name}`;
            this._box(ctx, W / 2, H * 0.72, [text], s.threat.state === 'lock' ? RED : '#ffd24a');
            ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
        }
        // Leurres en recharge : petite jauge sous les cartes
        if (s.jet && s.armed && weapons.flareReload > 0) {
            ctx.fillStyle = 'rgba(255, 240, 192, 0.9)';
            ctx.textAlign = 'center';
            ctx.font = 'bold 12px DejaVu Sans Mono, monospace';
            ctx.fillText(`LEURRES ${Math.ceil(weapons.flareReload)} s`, W / 2, 122);
            ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
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

    // Triangle rouge sur la cible, qui ne sort jamais de la zone du HUD (cercle au centre de l'écran) : cible dans la
    // zone, il est posé juste au-dessus d'elle, pointe vers le bas ; ailleurs (même derrière nous), il reste sur le bord
    // de la zone et pointe vers elle. Plein quand la cible est verrouillée
    _targetTriangle(ctx, W, H, camera, target, locked, distance) {
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * HUD_ZONE;
        camera.updateMatrixWorld();
        _view.copy(target.group.position).applyMatrix4(camera.matrixWorldInverse);   // repère de la caméra (devant : z < 0)
        let dx, dy, inside = false;
        if (_view.z < 0) {
            const p = this._project(target.group.position, camera);
            dx = p.x - cx;
            dy = p.y - cy;
            inside = Math.hypot(dx, dy) <= R;
        } else {
            dx = _view.x;
            dy = -_view.y;
            if (Math.hypot(dx, dy) < 1e-3) dy = 1;   // pile derrière : vers le bas
        }
        const length = Math.hypot(dx, dy) || 1;
        ctx.save();
        ctx.strokeStyle = ctx.fillStyle = RED;
        ctx.lineWidth = 2.5;
        let x, y, angle;
        if (inside) {
            x = cx + dx;
            y = cy + dy - 22;              // au-dessus de la cible
            angle = Math.PI / 2;           // pointe vers le bas, sur elle
        } else {
            x = cx + dx / length * R;
            y = cy + dy / length * R;
            angle = Math.atan2(dy, dx);    // pointe vers la cible
        }
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-10, -11); ctx.lineTo(-10, 11);
        ctx.closePath();
        if (locked) ctx.fill();
        ctx.stroke();
        ctx.restore();
        if (!inside) {
            ctx.fillStyle = RED;
            ctx.textAlign = 'center';
            ctx.fillText(formatKm(distance), cx + dx / length * (R - 48), cy + dy / length * (R - 48));
        }
    }

    // Deux cartes : CANON / MISSILE ; l'arme choisie est éclairée (et grossit un instant au changement)
    _cards(ctx, W, weapons, touch) {
        const gap = 12, ch = 62, top = 18;
        const cw = Math.min(180, (W - 24 - 2 * gap) / 3);
        const x0 = W / 2 - (3 * cw + 2 * gap) / 2;
        const blink = Math.floor(performance.now() / 250) % 2 === 0;
        const cards = [
            { key: 'gun', title: 'CANON M61', color: [90, 255, 130],
                value: weapons.heat, bar: weapons.overheated ? (blink ? 'SURCHAUFFE' : '') : weapons.heat > 0.7 ? 'CHAUD' : 'CHAUFFE',
                barColor: weapons.overheated || weapons.heat > 0.7 ? '#ff4a3a' : weapons.heat > 0.4 ? '#ffb000' : '#4cd964' },
            { key: 'aa', title: 'AIM-9 AIR-AIR', color: [255, 210, 70],
                value: weapons.aaReload > 0 ? 1 - weapons.aaReload / AAM.reload : weapons.locked ? 1 : weapons.lockProgress,
                bar: weapons.aaReload > 0 ? 'RECHARGE' : weapons.locked ? (blink ? 'LOCK' : '') : weapons.lockId ? 'VERROU…' : 'CHERCHE',
                barColor: weapons.aaReload > 0 ? '#ffb000' : weapons.locked ? '#ff4a3a' : '#ffd24a' },
            { key: 'missile', title: 'AGM-65 AIR-SOL', color: [255, 80, 70],
                value: weapons.reload > 0 ? 1 - weapons.reload / MISSILE_RELOAD : 1, bar: weapons.reload > 0 ? 'RECHARGE' : 'PRÊT',
                barColor: weapons.reload > 0 ? '#ffb000' : '#4cd964' },
        ];
        cards.forEach((card, i) => {
            const active = weapons.selected === card.key;
            const grow = active ? 1 + 0.12 * Math.min(1, weapons.switchFlash / 0.5) : 1;
            const w = cw * grow, h = ch * grow;
            const x = x0 + i * (cw + gap) + (cw - w) / 2, y = top;
            const [r, g, b] = card.color;
            ctx.globalAlpha = active ? 1 : 0.55;
            ctx.fillStyle = active ? `rgba(${r},${g},${b},0.18)` : 'rgba(10,12,16,0.55)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = `rgba(${r},${g},${b},${active ? 1 : 0.5})`;
            ctx.lineWidth = active ? 3 : 1.5;
            ctx.strokeRect(x, y, w, h);
            // Icône : obus (canon) ou missile
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            const ix = x + 12, iy = y + 22;
            if (card.key === 'gun') {
                for (let k = 0; k < 3; k++) {
                    ctx.fillRect(ix + k * 9, iy - 8, 5, 14);
                    ctx.beginPath();
                    ctx.arc(ix + k * 9 + 2.5, iy - 8, 2.5, Math.PI, 0);
                    ctx.fill();
                }
            } else {
                ctx.fillRect(ix, iy - 3, 22, 6);
                ctx.beginPath();
                ctx.moveTo(ix + 22, iy - 3); ctx.lineTo(ix + 29, iy); ctx.lineTo(ix + 22, iy + 3);
                ctx.fill();
                ctx.fillRect(ix - 2, iy - 7, 5, 14);
            }
            ctx.textAlign = 'left';
            ctx.font = `bold ${active ? 15 : 13}px DejaVu Sans Mono, monospace`;
            ctx.fillText(card.title, x + 46, y + 20, w - 54);
            ctx.font = 'bold 11px DejaVu Sans Mono, monospace';
            ctx.fillStyle = '#d8dde3';
            ctx.fillText(active ? 'CHOISI · ∞' : '∞', x + 46, y + 37, w - 120);
            // Jauge (chauffe du canon, rechargement du missile)
            const bx = x + 10, by = y + h - 14, bw = w - 20;
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillRect(bx, by, bw, 7);
            ctx.fillStyle = card.barColor;
            ctx.fillRect(bx, by, bw * MathUtils.clamp(card.value, 0, 1), 7);
            ctx.textAlign = 'right';
            ctx.fillText(card.bar, x + w - 10, y + 37);
        });
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.font = 'bold 12px DejaVu Sans Mono, monospace';
        ctx.textAlign = 'center';
        const hint = touch ? "ARME : changer d'arme · FEU : tirer (air-sol : ou toucher le sol)"
            : weapons.selected === 'gun' ? 'Clic gauche (ou ↑ / →) : tirer · Clic droit (ou ↓) : arme suivante · ← : leurres'
                : weapons.selected === 'aa' ? 'Gardez l\'avion dans le petit cercle : verrou · Clic gauche (ou ↑) : tir · → : canon · ← : leurres'
                    : 'Clic gauche sur le sol (ou ↑) : missile · → : canon · Clic droit (ou ↓) : arme suivante';
        const tw = ctx.measureText(hint).width + 20;
        ctx.fillStyle = 'rgba(10,12,16,0.6)';
        ctx.fillRect(W / 2 - tw / 2, top + ch + 8, tw, 20);
        ctx.fillStyle = '#e8edf2';
        ctx.fillText(hint, W / 2, top + ch + 18);
        ctx.font = 'bold 13px DejaVu Sans Mono, monospace';
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
