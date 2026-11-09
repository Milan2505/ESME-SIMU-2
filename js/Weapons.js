import {
    AdditiveBlending,
    BoxGeometry,
    CanvasTexture,
    ConeGeometry,
    CylinderGeometry,
    DoubleSide,
    DynamicDrawUsage,
    Group,
    InstancedMesh,
    MathUtils,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3
} from 'three';
import { sharedAudioContext } from './AudioUnlock.js';
import { SmokeTrail } from './Damage.js';

// Armement du F-15 :
// - canon M61A1 Vulcan de 20 mm (comme le vrai F-15C : six tubes rotatifs dans l'emplanture de l'aile droite,
//   940 obus, 6 000 coups/min soit 100 par seconde, 1 030 m/s à la sortie du tube ; ~0,3 s pour lancer les tubes).
//   Chaque obus est simulé (vitesse de l'avion + vitesse de sortie, pesanteur, petite dispersion), avec son traceur ;
//   le tireur décide des coups au but sur les avions qu'il voit (formes de PlaneCollision.js) et les envoie au joueur
//   touché (Multiplayer.sendHit), qui en subit les dégâts (Damage.js) ;
// - missiles air-sol AGM-65 Maverick (4) : tirés sur la croix rouge posée au sol (mode air-sol), ils y arrivent
//   exactement (trajectoire calculée d'avance de l'avion jusqu'à la croix, en piqué sur la fin), propulsés jusqu'à
//   ~320 m/s. Chez les autres joueurs, le même missile refait la même trajectoire (même départ, même croix).
// Repère avion : x à droite, y en haut, nez vers -z (comme FlightModel et PlaneCollision).

const deg = MathUtils.degToRad;
const GRAVITY = 9.81;

const GUN = {
    rounds: 940,
    rate: 100,                        // obus par seconde
    velocity: 1030,                   // m/s (sortie du tube)
    spinUp: 0.3,                      // s avant le premier obus
    dispersion: 0.0035,               // rad (~3,5 mrad : gerbe de ~2 m à 600 m)
    elevation: deg(1),                // ligne de tir un peu au-dessus de l'axe de l'avion (harmonisation)
    life: 2.5,                        // s : au-delà, l'obus s'autodétruit (~2,5 km)
    muzzle: new Vector3(1.75, 0.75, -1.4),   // emplanture de l'aile droite
};
const MISSILE = {
    count: 4,
    maxSpeed: 320,                    // m/s
    acceleration: 75,                 // m/s² (moteur-fusée)
    minRange: 300,                    // m
    maxRange: 16000,                  // m
    offBoresight: deg(110),           // la croix ne doit pas être derrière l'avion
    rails: [new Vector3(-2.6, -0.55, 1.2), new Vector3(2.6, -0.55, 1.2)],   // pylônes sous les ailes
    terminalDive: deg(30),            // piqué minimal sur la croix
};
// Missile air-air AIM-9 Sidewinder (autodirecteur infrarouge) : verrouillage automatique d'un avion devant le nez,
// puis il le poursuit (navigation avec anticipation, virage limité), fusée de proximité
const AAM = {
    maxSpeed: 850,                    // m/s (~Mach 2,5)
    acceleration: 300,                // m/s² (moteur-fusée)
    minRange: 300,                    // m
    maxRange: 10000,                  // m
    seeker: deg(25),                  // cône où l'autodirecteur accroche une cible
    keep: deg(35),                    // il la garde jusqu'à cet angle
    lockTime: 1.2,                    // s pour verrouiller
    turnG: 35,                        // facteur de charge maxi du missile
    life: 20,                         // s : au-delà, autodestruction
    fuse: 12,                         // m : fusée de proximité
    reload: 0.5,                      // s entre deux tirs (rechargé tout de suite)
};
const AAM_ZONES = ['f', 'f', 'eL', 'eR', 'wL', 'wR', 't', 'c'];
const WEAPON_ORDER = ['gun', 'aa', 'missile'];
const MAX_BULLETS = 500;
const UNLIMITED = true;              // munitions illimitées (obus et missiles ne s'épuisent pas)
// Rythme du combat (munitions illimitées) : le canon chauffe, le missile se recharge
const HEAT_TIME = 4;                  // s de tir continu jusqu'à la surchauffe (~400 obus)
const COOL_RATE = 0.35;               // refroidissement (fraction par seconde, détente lâchée)
const COOLED = 0.3;                   // après une surchauffe : le canon retire sous ce niveau
const MISSILE_RELOAD = 0.5;           // s entre deux missiles (le pylône est rechargé tout de suite)
const STORE_RELOAD = 0.5;             // s : le missile parti réapparaît sur son pylône
const HIT_FLUSH = 0.1;                // s : coups au but regroupés avant envoi
const TRACER_COLOR = 0xffb347;

// Formes des avions pour les coups au but (repère avion), avec la partie touchée (voir Damage.js) ; reprises des boîtes
// de collision (PlaneCollision.js). Ordre : les plus précises d'abord
const HIT_BOXES = {
    f15: [
        { box: [-1.6, 1.6, -0.7, 1.5, -9.8, 9.4], zone: (p) => (p.z > 3 ? (p.x < 0 ? 'eL' : 'eR') : p.z < -4.5 && p.y > 0.4 ? 'c' : 'f') },
        { box: [-6.3, 6.3, 0.3, 0.9, -0.3, 5.6], zone: (p) => (p.x < 0 ? 'wL' : 'wR') },
        { box: [-4.2, 4.2, -0.05, 0.2, 6.4, 9.7], zone: () => 't' },
        { box: [-1.85, -1.6, 0.26, 3.5, 5.3, 8.45], zone: () => 't' },
        { box: [1.6, 1.85, 0.26, 3.5, 5.3, 8.45], zone: () => 't' },
    ],
    c172: [
        { box: [-0.65, 0.65, -0.6, 1.45, -5.15, 3.3], zone: (p) => (p.z < -3.3 ? 'eL' : p.z < -0.5 ? 'c' : 'f') },
        { box: [-6.65, 6.65, 0.95, 1.5, -2.85, -0.85], zone: (p) => (Math.abs(p.x) < 0.65 ? 'c' : p.x < 0 ? 'wL' : 'wR') },
        { box: [-2.1, 2.1, 0.15, 0.4, 2.3, 3.25], zone: () => 't' },
        { box: [-0.15, 0.15, 0.25, 2.05, 2.6, 4.6], zone: () => 't' },
    ],
};
const HIT_RANGE = 14;   // m : au-delà de cette distance du centre de l'avion, le segment de l'obus est ignoré

const _a = new Vector3(), _b = new Vector3(), _d = new Vector3(), _v = new Vector3(), _q = new Quaternion();
const _m = new Matrix4(), _inv = new Matrix4(), _scale = new Vector3(), _z = new Vector3(0, 0, 1);
const _fwd = new Vector3(), _up = new Vector3(), _right = new Vector3(), _p = new Vector3();

// Segment [a, b] (repère avion) contre une boîte : fraction du segment au premier contact, ou null
function segmentBox(a, b, box) {
    let t0 = 0, t1 = 1;
    for (let axis = 0; axis < 3; axis++) {
        const start = a.getComponent(axis), dir = b.getComponent(axis) - start;
        const min = box[axis * 2], max = box[axis * 2 + 1];
        if (Math.abs(dir) < 1e-9) {
            if (start < min || start > max) return null;
            continue;
        }
        let near = (min - start) / dir, far = (max - start) / dir;
        if (near > far) [near, far] = [far, near];
        t0 = Math.max(t0, near);
        t1 = Math.min(t1, far);
        if (t0 > t1) return null;
    }
    return t0;
}

// Texture de la croix rouge posée au sol (cible des missiles)
function crossTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(255, 30, 30, 1)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(48, 48); ctx.lineTo(208, 208);
    ctx.moveTo(208, 48); ctx.lineTo(48, 208);
    ctx.stroke();
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.stroke();
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

function glowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,220,150,0.8)');
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

// Petits effets d'impact : éclairs (obus qui touchent un avion) et poussière (obus qui tapent le sol)
class Impacts {
    constructor(group, glow) {
        this._sparks = Array.from({ length: 40 }, () => {
            const s = new Sprite(new SpriteMaterial({ map: glow, color: 0xffd080, blending: AdditiveBlending, transparent: true, depthWrite: false }));
            s.material.color.multiplyScalar(4);
            s.visible = false;
            s.userData = { age: 0, life: 0.15, size: 3 };
            group.add(s);
            return s;
        });
        this._dust = Array.from({ length: 60 }, () => {
            const s = new Sprite(new SpriteMaterial({ map: glow, color: 0x8a7a60, transparent: true, depthWrite: false }));
            s.visible = false;
            s.userData = { age: 0, life: 1, size: 4 };
            group.add(s);
            return s;
        });
        this._nextSpark = 0;
        this._nextDust = 0;
    }

    spark(position, size = 3) {
        const s = this._sparks[this._nextSpark];
        this._nextSpark = (this._nextSpark + 1) % this._sparks.length;
        s.position.copy(position);
        Object.assign(s.userData, { age: 0, life: 0.12 + Math.random() * 0.08, size: size * (0.7 + Math.random() * 0.6) });
        s.visible = true;
    }

    dust(position) {
        const s = this._dust[this._nextDust];
        this._nextDust = (this._nextDust + 1) % this._dust.length;
        s.position.copy(position);
        s.position.y += 1;
        Object.assign(s.userData, { age: 0, life: 0.8 + Math.random() * 0.6, size: 3 + Math.random() * 3 });
        s.visible = true;
        this.spark(position, 2);
    }

    update(delta) {
        for (const s of this._sparks) {
            if (!s.visible) continue;
            const d = s.userData;
            d.age += delta;
            if (d.age >= d.life) { s.visible = false; continue; }
            s.scale.setScalar(d.size * (1 - d.age / d.life * 0.5));
            s.material.opacity = 1 - d.age / d.life;
        }
        for (const s of this._dust) {
            if (!s.visible) continue;
            const d = s.userData;
            d.age += delta;
            const t = d.age / d.life;
            if (t >= 1) { s.visible = false; continue; }
            s.position.y += 1.5 * delta;
            s.scale.setScalar(d.size * (0.5 + 1.5 * t));
            s.material.opacity = 0.7 * (1 - t);
        }
    }
}

// Missile AGM-65 : corps blanc, quatre ailettes, jet du moteur ; trajectoire = courbe de Bézier cubique de la
// position de tir à la croix, parcourue à la vitesse du missile (table des longueurs d'arc)
class Missile {
    constructor(scene, mesh, glow, { from, velocity, target, ownerId, ownerName, own }) {
        this.scene = scene;
        this.ownerId = ownerId;
        this.ownerName = ownerName;
        this.own = own;
        this.target = target.clone();
        this.object = mesh.clone();
        this.flame = new Sprite(new SpriteMaterial({ map: glow, color: 0xffa040, blending: AdditiveBlending, transparent: true, depthWrite: false }));
        this.flame.material.color.multiplyScalar(5);
        this.flame.scale.setScalar(2.2);
        this.flame.position.set(0, 0, 1.4);
        this.object.add(this.flame);
        scene.add(this.object);
        this.trail = new SmokeTrail(scene, { count: 160, color: 0xd8d8d8, size: 2.2, life: 5 });
        this.speed = Math.max(120, velocity.length());
        this.age = 0;
        this.travelled = 0;
        this.done = false;
        this.exploded = false;
        this.position = from.clone();

        // Courbe : départ dans l'axe de la vitesse de l'avion, arrivée en piqué sur la croix
        const p0 = from.clone(), p3 = target.clone();
        const length = p0.distanceTo(p3);
        const start = velocity.lengthSq() > 1 ? velocity.clone().normalize() : p3.clone().sub(p0).normalize();
        const flat = p3.clone().sub(p0).setY(0);
        if (flat.lengthSq() < 1) flat.copy(start).setY(0);
        if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
        flat.normalize();
        const line = Math.atan2(p0.y - p3.y, Math.hypot(p3.x - p0.x, p3.z - p0.z));
        const dive = Math.max(MISSILE.terminalDive, line);
        const end = flat.multiplyScalar(Math.cos(dive)).add(new Vector3(0, -Math.sin(dive), 0)).normalize();
        this.points = [p0, p0.clone().addScaledVector(start, length * 0.35), p3.clone().addScaledVector(end, -length * 0.35), p3];
        // Table des longueurs d'arc
        this._lut = [0];
        this._samples = 96;
        let previous = p0.clone(), total = 0;
        for (let i = 1; i <= this._samples; i++) {
            const point = this._bezier(i / this._samples, new Vector3());
            total += point.distanceTo(previous);
            this._lut.push(total);
            previous = point;
        }
        this.length = total;
        this._place(0);
    }

    _bezier(t, target) {
        const [p0, p1, p2, p3] = this.points;
        const u = 1 - t;
        return target.set(0, 0, 0)
            .addScaledVector(p0, u * u * u)
            .addScaledVector(p1, 3 * u * u * t)
            .addScaledVector(p2, 3 * u * t * t)
            .addScaledVector(p3, t * t * t);
    }

    // Paramètre de la courbe pour une distance parcourue
    _param(distance) {
        const lut = this._lut;
        if (distance >= this.length) return 1;
        let lo = 0, hi = lut.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (lut[mid] < distance) lo = mid; else hi = mid;
        }
        const f = (distance - lut[lo]) / Math.max(1e-6, lut[hi] - lut[lo]);
        return (lo + f) / this._samples;
    }

    _place(distance) {
        const t = this._param(distance);
        this._bezier(t, this.position);
        this._bezier(Math.min(1, t + 0.002), _b);
        _d.subVectors(_b, this.position);
        if (_d.lengthSq() < 1e-8) {
            this._bezier(Math.max(0, t - 0.002), _b);
            _d.subVectors(this.position, _b);
        }
        this.object.position.copy(this.position);
        if (_d.lengthSq() > 1e-8) this.object.quaternion.setFromUnitVectors(_z.set(0, 0, -1), _d.normalize());
    }

    // ground(x, z) : hauteur du sol ; true quand le missile explose
    update(delta, ground) {
        if (this.exploded) {
            this.trail.update(delta, this.position, 0);
            this.done = this.trail.empty;
            return false;
        }
        this.age += delta;
        this.speed = Math.min(MISSILE.maxSpeed, this.speed + MISSILE.acceleration * delta);
        this.travelled += this.speed * delta;
        this._place(this.travelled);
        this.flame.scale.setScalar(1.8 + Math.random() * 0.8);
        this.trail.update(delta, this.position, 0.75, false);
        // Arrivé sur la croix ; ou relief sur le chemin (colline entre l'avion et la croix)
        const arrived = this.travelled >= this.length;
        const hitGround = !arrived && this.position.distanceTo(this.target) > 30 && this.position.y < ground(this.position.x, this.position.z);
        if (arrived || hitGround || this.age > 120) {
            if (arrived) this.position.copy(this.target);
            this.exploded = true;
            this.scene.remove(this.object);
            return true;
        }
        return false;
    }

    get timeToImpact() {
        return Math.max(0, (this.length - this.travelled) / Math.max(1, this.speed));
    }

    dispose() {
        this.scene.remove(this.object);
        this.flame.material.dispose();
        this.trail.dispose();
    }
}

// Missile air-air : vole droit devant à la sortie du rail, puis rallie sa cible en visant le point où elle sera
// (anticipation), avec un virage limité par son facteur de charge ; explose à moins de AAM.fuse m de la cible
class AAMissile {
    constructor(scene, mesh, glow, { from, velocity, targetId, ownerId, ownerName, own }) {
        this.scene = scene;
        this.targetId = targetId;
        this.ownerId = ownerId;
        this.ownerName = ownerName;
        this.own = own;
        this.object = mesh.clone();
        this.object.scale.setScalar(1.2);
        this.flame = new Sprite(new SpriteMaterial({ map: glow, color: 0xffb060, blending: AdditiveBlending, transparent: true, depthWrite: false }));
        this.flame.material.color.multiplyScalar(6);
        this.flame.position.set(0, 0, 1.4);
        this.object.add(this.flame);
        scene.add(this.object);
        this.trail = new SmokeTrail(scene, { count: 220, color: 0xe6e6e6, size: 1.8, life: 6 });
        this.position = from.clone();
        this.speed = Math.max(150, velocity.length());
        this.direction = velocity.lengthSq() > 1 ? velocity.clone().normalize() : new Vector3(0, 0, -1);
        this.age = 0;
        this.exploded = false;
        this.done = false;
        this.miss = Infinity;          // distance à la cible au moment de l'explosion
        this._aim = new Vector3();
        this._last = new Vector3();
    }

    // target : { position, velocity } ou null (cible perdue) ; true quand le missile explose
    update(delta, ground, target) {
        if (this.exploded) {
            this.trail.update(delta, this.position, 0);
            this.done = this.trail.empty;
            return false;
        }
        this.age += delta;
        this.speed = Math.min(AAM.maxSpeed, this.speed + AAM.acceleration * delta);
        // Guidage (après 0,3 s de vol droit : dégagement de l'avion)
        if (target && this.age > 0.3) {
            const distance = this.position.distanceTo(target.position);
            const time = distance / Math.max(100, this.speed);
            this._aim.copy(target.position).addScaledVector(target.velocity, time).sub(this.position).normalize();
            const angle = this.direction.angleTo(this._aim);
            const maxTurn = AAM.turnG * 9.81 / this.speed * delta;
            if (angle > 1e-5) this.direction.lerp(this._aim, Math.min(1, maxTurn / angle)).normalize();
        }
        this._last.copy(this.position);
        this.position.addScaledVector(this.direction, this.speed * delta);
        this.object.position.copy(this.position);
        this.object.quaternion.setFromUnitVectors(_z.set(0, 0, -1), this.direction);
        this.flame.scale.setScalar(1.6 + Math.random() * 0.8);
        this.trail.update(delta, this.position, 0.6, false);
        // Fusée de proximité : point du trajet le plus proche de la cible
        if (target) {
            _d.subVectors(this.position, this._last);
            const t = MathUtils.clamp(_d.dot(_v.subVectors(target.position, this._last)) / Math.max(1e-6, _d.lengthSq()), 0, 1);
            _a.copy(this._last).addScaledVector(_d, t);
            const miss = _a.distanceTo(target.position);
            // (dans le rayon de la fusée : explose au point le plus proche, pas dès l'entrée dans le rayon)
            if (miss <= AAM.fuse && t < 1) {
                this.miss = miss;
                this.position.copy(_a);
                return this._explode();
            }
        }
        if (this.position.y < ground(this.position.x, this.position.z) || this.age > AAM.life) return this._explode();
        return false;
    }

    _explode() {
        this.exploded = true;
        this.scene.remove(this.object);
        return true;
    }

    dispose() {
        this.scene.remove(this.object);
        this.flame.material.dispose();
        this.trail.dispose();
    }
}

// Sons synthétisés : rafale du canon (« brrrt » à 100 coups/s, en boucle tant qu'on tire), départ du missile
class WeaponSounds {
    constructor() {
        this.ctx = null;
    }

    _init() {
        if (this.ctx) return true;
        try {
            this.ctx = sharedAudioContext();
        } catch {
            return false;
        }
        const ctx = this.ctx, rate = ctx.sampleRate;
        this.master = ctx.createGain();
        this.master.gain.value = 0.7;
        this.master.connect(ctx.destination);
        // Rafale : 50 coups (0,5 s), chacun un claquement grave et un souffle
        const period = Math.round(rate / GUN.rate);
        const gun = ctx.createBuffer(1, period * 50, rate);
        const data = gun.getChannelData(0);
        let low = 0;
        for (let i = 0; i < data.length; i++) {
            const phase = (i % period) / period;
            const env = Math.exp(-phase * 5);
            low += ((Math.random() * 2 - 1) - low) * 0.3;
            data[i] = (low * 0.8 + Math.sin(i / rate * Math.PI * 2 * 85) * 0.5) * env;
        }
        this.gunBuffer = gun;
        // Souffle du moteur-fusée (3 s)
        const whoosh = ctx.createBuffer(1, rate * 3, rate);
        const w = whoosh.getChannelData(0);
        let smooth = 0;
        for (let i = 0; i < w.length; i++) {
            const t = i / rate;
            smooth += ((Math.random() * 2 - 1) - smooth) * 0.15;
            w[i] = smooth * Math.min(1, t * 20) * Math.exp(-t * 0.9) * 1.6;
        }
        this.whooshBuffer = whoosh;
        this.own = this._loop(1);
        this.remote = this._loop(0);
        return true;
    }

    _loop(gainValue) {
        const source = this.ctx.createBufferSource();
        source.buffer = this.gunBuffer;
        source.loop = true;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 3500;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        source.connect(filter).connect(gain).connect(this.master);
        source.start();
        return { gain, filter, level: gainValue };
    }

    // own : notre canon (0 -> 1) ; remote : canon des autres (0 -> 1, selon la distance) ; cabin : son étouffé
    update(own, remote, cabin) {
        if (!this.ctx) {
            if (own <= 0 && remote <= 0) return;
            if (!this._init()) return;
        }
        const now = this.ctx.currentTime;
        this.own.gain.gain.setTargetAtTime(own * (cabin ? 0.55 : 0.8), now, 0.02);
        this.own.filter.frequency.setTargetAtTime(cabin ? 1400 : 3500, now, 0.05);
        this.remote.gain.gain.setTargetAtTime(remote * 0.8, now, 0.03);
        this.remote.filter.frequency.setTargetAtTime(1200 + 2000 * remote, now, 0.05);
    }

    // Autodirecteur de l'AIM-9 dans le casque : 'off', 'search' (grondement grave), 'lock' (tonalité aiguë)
    seeker(state) {
        if (state === this._seekerState) return;
        this._seekerState = state;
        if (state !== 'off' && !this._init()) return;
        if (!this.ctx) return;
        if (!this._seeker) {
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            const lfo = this.ctx.createOscillator();
            lfo.frequency.value = 18;
            const depth = this.ctx.createGain();
            depth.gain.value = 60;
            lfo.connect(depth).connect(osc.frequency);
            const gain = this.ctx.createGain();
            gain.gain.value = 0;
            osc.connect(gain).connect(this.master);
            osc.start();
            lfo.start();
            this._seeker = { osc, gain, depth };
        }
        const now = this.ctx.currentTime, k = this._seeker;
        k.gain.gain.setTargetAtTime(state === 'off' ? 0 : state === 'lock' ? 0.12 : 0.07, now, 0.05);
        k.osc.frequency.setTargetAtTime(state === 'lock' ? 1250 : 420, now, 0.03);
        k.depth.gain.setTargetAtTime(state === 'lock' ? 8 : 60, now, 0.05);
    }

    whoosh(volume = 1) {
        if (!this._init()) return;
        const source = this.ctx.createBufferSource();
        source.buffer = this.whooshBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1800;
        const gain = this.ctx.createGain();
        gain.gain.value = volume;
        source.connect(filter).connect(gain).connect(this.master);
        source.start();
    }
}

class Weapons extends EventTarget {
    // terrain : hauteur du sol (heightAt)
    constructor(scene, { terrain }) {
        super();
        this.scene = scene;
        this.terrain = terrain;
        this.group = new Group();
        scene.add(this.group);
        const glow = glowTexture();
        this._glow = glow;
        this.impacts = new Impacts(this.group, glow);
        this.sounds = new WeaponSounds();

        this.ammo = GUN.rounds;
        this.missiles = MISSILE.count;
        this.trigger = false;          // détente tenue
        this.firing = false;           // obus qui partent (envoyé aux autres joueurs)
        this.selected = 'gun';         // arme choisie : 'gun' (canon) ou 'missile'
        this.switchFlash = 0;          // s : animation du changement d'arme (affichage)
        this.heat = 0;                 // chauffe du canon (0 -> 1)
        this.overheated = false;       // surchauffe : le canon ne tire plus jusqu'à refroidissement
        this.reload = 0;               // s avant que le missile suivant soit prêt
        this.aaReload = 0;             // s avant que le missile air-air suivant soit prêt
        this.gunKey = false;           // touche → tenue : canon, quelle que soit l'arme choisie
        this.stores = null;            // missiles visibles sur les pylônes (F15Stores.js) : { aa: [g, d], ag: [g, d] }
        this._side = { aa: 0, ag: 0 }; // pylône du prochain tir (alterne gauche / droite)
        this._storeTimers = [];        // missiles partis, qui réapparaissent sur leur pylône
        this.aaInFlight = [];          // missiles air-air en vol (les nôtres et ceux des autres)
        this.lockId = null;            // avion accroché par l'autodirecteur (identifiant du joueur)
        this.lockName = '';
        this.lockProgress = 0;         // 0 -> 1 : verrouillage en cours
        this.locked = false;           // verrouillé : tirez
        this.target = null;            // point du sol sous la croix rouge (mode missile) ; null : rien
        this.targetLocked = false;
        this.inFlight = [];            // missiles en vol
        this.hitMarker = 0;            // s : nos obus viennent de toucher un avion
        this._spin = 0;                // tubes lancés (0 -> 1)
        this._roundTimer = 0;
        this._railIndex = 0;
        this._pendingHits = new Map(); // id -> zones
        this._hitTimer = 0;
        this._remoteFire = new Map();  // id -> temps jusqu'au prochain obus des autres joueurs

        // Obus : tableau fixe, traceurs dessinés en une fois (boîtes allongées, épaisseur selon la distance)
        this._bullets = Array.from({ length: MAX_BULLETS }, () => ({
            alive: false, own: false, age: 0, position: new Vector3(), previous: new Vector3(), velocity: new Vector3(),
        }));
        this._nextBullet = 0;
        const tracerMaterial = new MeshBasicMaterial({ color: TRACER_COLOR, toneMapped: false, transparent: true, opacity: 0.95,
            blending: AdditiveBlending, depthWrite: false });
        tracerMaterial.color.multiplyScalar(3);   // > 1 : halo du bloom
        this.tracers = new InstancedMesh(new BoxGeometry(1, 1, 1), tracerMaterial, MAX_BULLETS);
        this.tracers.instanceMatrix.setUsage(DynamicDrawUsage);
        this.tracers.frustumCulled = false;
        this.tracers.count = 0;
        this.group.add(this.tracers);

        // Éclair de bouche du canon
        this.muzzleFlash = new Sprite(new SpriteMaterial({ map: glow, color: 0xffc070, blending: AdditiveBlending, transparent: true, depthWrite: false }));
        this.muzzleFlash.material.color.multiplyScalar(4);
        this.muzzleFlash.visible = false;
        this.group.add(this.muzzleFlash);

        // Croix rouge au sol (toujours dessinée par-dessus le relief, taille selon la distance)
        this.cross = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
            map: crossTexture(), transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: DoubleSide,
        }));
        this.cross.rotation.x = -Math.PI / 2;
        this.cross.renderOrder = 20;
        this.cross.visible = false;
        this.group.add(this.cross);

        // Modèle du missile (cloné à chaque tir)
        const missile = new Group();
        const white = new MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5, metalness: 0.2 });
        const dark = new MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6 });
        const body = new Mesh(new CylinderGeometry(0.153, 0.153, 2.2, 12), white);
        body.rotation.x = Math.PI / 2;
        const nose = new Mesh(new ConeGeometry(0.153, 0.35, 12), dark);   // autodirecteur
        nose.rotation.x = -Math.PI / 2;
        nose.position.z = -1.27;
        missile.add(body, nose);
        for (let i = 0; i < 4; i++) {
            const fin = new Mesh(new BoxGeometry(0.02, 0.36, 0.5), white);
            const angle = i * Math.PI / 2 + Math.PI / 4;
            fin.position.set(Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0.8);
            fin.rotation.z = angle - Math.PI / 2;
            missile.add(fin);
            const wing = new Mesh(new BoxGeometry(0.02, 0.3, 0.9), white);
            wing.position.set(Math.cos(angle) * 0.28, Math.sin(angle) * 0.28, -0.1);
            wing.rotation.z = angle - Math.PI / 2;
            missile.add(wing);
        }
        missile.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this._missileMesh = missile;
    }

    // Réarmement complet (nouveau départ)
    rearm() {
        this.ammo = GUN.rounds;
        this.missiles = MISSILE.count;
        this.trigger = false;
        this.firing = false;
        this._spin = 0;
        this.targetLocked = false;
        this.target = null;            // (nouveau départ : plus de croix)
        this.heat = 0;
        this.overheated = false;
        this.reload = 0;
        this.aaReload = 0;
        this.gunKey = false;
        for (const store of this._storeTimers) store.mesh.visible = true;
        this._storeTimers.length = 0;
        this._resetLock();
    }

    // Missiles visibles sous les ailes (F15Stores.js)
    setStores(stores) {
        this.stores = stores;
    }

    // Point de départ d'un missile : celui du pylône (il disparaît, puis réapparaît : rechargé), sinon un rail fixe
    _launchPoint(kind, aircraft) {
        const side = this._side[kind];
        this._side[kind] = 1 - side;
        const mesh = this.stores?.[kind]?.[side];
        if (mesh) {
            aircraft.updateMatrixWorld(true);
            const point = mesh.getWorldPosition(new Vector3());
            mesh.visible = false;
            this._storeTimers.push({ mesh, time: STORE_RELOAD });
            return point;
        }
        return MISSILE.rails[side].clone().applyQuaternion(aircraft.quaternion).add(aircraft.position);
    }

    _resetLock() {
        if (this.locked) this.dispatchEvent(new CustomEvent('lockLost'));
        this.lockId = null;
        this.lockName = '';
        this.lockProgress = 0;
        this.locked = false;
    }

    // Change d'arme (canon <-> missile) ; arme donnée : celle-là
    select(weapon = WEAPON_ORDER[(WEAPON_ORDER.indexOf(this.selected) + 1) % WEAPON_ORDER.length]) {
        if (weapon === this.selected) return;
        this._resetLock();
        this.selected = weapon;
        this.trigger = false;
        this.switchFlash = 0.5;
        this.target = null;
        this.dispatchEvent(new CustomEvent('select', { detail: { weapon } }));
    }

    _message(text) {
        this.dispatchEvent(new CustomEvent('message', { detail: { text } }));
    }

    // Point du sol sous un rayon (origine, direction normalisée), ou null jusqu'à maxDistance
    groundPoint(origin, direction, maxDistance = MISSILE.maxRange + 4000, target = new Vector3()) {
        const height = (x, z) => this.terrain.heightAt(x, z);
        let t = 0, previous = 0;
        while (t < maxDistance) {
            const step = 4 + t * 0.01;
            previous = t;
            t += step;
            _p.copy(origin).addScaledVector(direction, t);
            if (_p.y <= height(_p.x, _p.z)) {
                // Affinage par dichotomie entre les deux derniers pas
                let lo = previous, hi = t;
                for (let i = 0; i < 12; i++) {
                    const mid = (lo + hi) / 2;
                    _p.copy(origin).addScaledVector(direction, mid);
                    if (_p.y <= height(_p.x, _p.z)) hi = mid; else lo = mid;
                }
                target.copy(origin).addScaledVector(direction, hi);
                target.y = height(target.x, target.z);
                return target;
            }
        }
        return null;
    }

    // Rayon de la caméra passant par un point de l'écran (ndc : -1 -> 1 ; null : centre)
    _rayFrom(camera, ndc) {
        _a.setFromMatrixPosition(camera.matrixWorld);
        _b.set(ndc?.x ?? 0, ndc?.y ?? 0, 0.5).unproject(camera).sub(_a).normalize();
        return [_a.clone(), _b.clone()];
    }

    // Mode missile : la croix suit le point visé (souris, ou centre de l'écran)
    aim(camera, ndc) {
        const [origin, direction] = this._rayFrom(camera, ndc);
        this.target = this.groundPoint(origin, direction, MISSILE.maxRange + 4000, this.target ?? new Vector3());
    }

    // Pose la croix au point visé (clic)
    lockAt(camera, ndc) {
        const [origin, direction] = this._rayFrom(camera, ndc);
        const point = this.groundPoint(origin, direction);
        if (!point) return this._message('Pas de sol sous la croix');
        this.target = point;
        this.targetLocked = true;
    }

    unlock() {
        this.targetLocked = false;
    }

    // Missile sur le point du sol visé à l'écran (ndc ; null : croix actuelle) : il y arrive exactement
    fireMissileAt(camera, ndc, aircraft, velocity, ownId, ownName) {
        if (ndc) this.aim(camera, ndc);
        return this.fireMissile(aircraft, velocity, ownId, ownName);
    }

    // Tir d'un missile sur la croix ; aircraft : objet de l'avion, velocity : sa vitesse (m/s)
    fireMissile(aircraft, velocity, ownId, ownName) {
        if (this.missiles <= 0) return this._message('Plus de missiles');
        if (this.reload > 0) return false;   // (pylône suivant pas encore prêt : jauge sur la carte de l'arme)
        if (!this.target) return this._message('Visez le sol : la croix rouge montre où ira le missile');
        const range = aircraft.position.distanceTo(this.target);
        if (range < MISSILE.minRange) return this._message('Cible trop proche');
        if (range > MISSILE.maxRange) return this._message(`Cible hors de portée (${(range / 1000).toFixed(1)} km > 16 km)`);
        _fwd.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
        _d.subVectors(this.target, aircraft.position).normalize();
        if (_fwd.angleTo(_d) > MISSILE.offBoresight) return this._message("Croix trop en arrière de l'avion");
        const from = this._launchPoint('ag', aircraft);
        const data = { from, velocity: velocity.clone(), target: this.target.clone() };
        if (!UNLIMITED) this.missiles--;
        this.reload = MISSILE_RELOAD;
        this._launch({ ...data, ownerId: ownId, ownerName: ownName, own: true });
        this.dispatchEvent(new CustomEvent('missile', { detail: data }));
        // (la croix reste posée : on peut tirer plusieurs missiles au même endroit)
        return true;
    }

    // Autodirecteur : accroche l'avion le plus proche de l'axe du nez (dans le cône, à portée), le verrouille en
    // AAM.lockTime ; événements 'lock' (verrouillé : « LOCK LOCK ») et 'lockLost'
    _updateLock(delta, own, targets) {
        if (this.selected !== 'aa' || !own.armed) {
            if (this.lockId || this.lockProgress) this._resetLock();
            return;
        }
        _fwd.set(0, 0, -1).applyQuaternion(own.aircraft.quaternion);
        const angleTo = (t) => {
            const distance = t.group.position.distanceTo(own.aircraft.position);
            if (distance < AAM.minRange * 0.5 || distance > AAM.maxRange) return Infinity;
            return _fwd.angleTo(_d.subVectors(t.group.position, own.aircraft.position));
        };
        let current = this.lockId ? targets.find((t) => t.id === this.lockId) : null;
        if (current && angleTo(current) > AAM.keep) current = null;
        if (!current) {
            if (this.lockId) this._resetLock();
            let best = null, bestAngle = AAM.seeker;
            for (const t of targets) {
                const angle = angleTo(t);
                if (angle < bestAngle) { best = t; bestAngle = angle; }
            }
            if (!best) return;
            this.lockId = best.id;
            this.lockName = best.name;
            this.lockProgress = 0;
            current = best;
        }
        this.lockProgress = Math.min(1, this.lockProgress + delta / AAM.lockTime);
        if (this.lockProgress >= 1 && !this.locked) {
            this.locked = true;
            this.dispatchEvent(new CustomEvent('lock', { detail: { id: current.id, name: current.name } }));
        }
    }

    // Tir d'un missile air-air sur l'avion verrouillé
    fireAA(aircraft, velocity, ownId, ownName) {
        if (!this.locked || !this.lockId) return this._message('Pas de verrouillage : gardez un avion dans le cercle');
        if (this.aaReload > 0) return false;
        const from = this._launchPoint('aa', aircraft);
        const data = { from, velocity: velocity.clone(), targetId: this.lockId };
        this.aaReload = AAM.reload;
        this._launchAA({ ...data, ownerId: ownId, ownerName: ownName, own: true });
        this.dispatchEvent(new CustomEvent('aamissile', { detail: data }));
        return true;
    }

    // Missile air-air tiré par un autre joueur (refait chez nous, sur la même cible)
    addRemoteAA(data, ownerId, ownerName, listener) {
        const missile = this._launchAA({ ...data, ownerId, ownerName, own: false });
        const distance = listener ? missile.position.distanceTo(listener) : 0;
        this.sounds.whoosh(MathUtils.clamp(80 / Math.max(1, distance), 0, 0.8));
    }

    _launchAA(options) {
        const missile = new AAMissile(this.scene, this._missileMesh, this._glow, options);
        this.aaInFlight.push(missile);
        if (options.own) this.sounds.whoosh(1);
        return missile;
    }

    // Missile tiré par un autre joueur (même trajectoire que chez lui)
    addRemoteMissile(data, ownerId, ownerName, listener) {
        const missile = this._launch({ ...data, ownerId, ownerName, own: false });
        const distance = listener ? missile.position.distanceTo(listener) : 0;
        this.sounds.whoosh(MathUtils.clamp(80 / Math.max(1, distance), 0, 0.8));
    }

    _launch(options) {
        const missile = new Missile(this.scene, this._missileMesh, this._glow, options);
        this.inFlight.push(missile);
        // Nos missiles : point d'impact marqué au sol (croix fixe) jusqu'à l'explosion
        if (options.own) {
            missile.marker = this.cross.clone();
            missile.marker.position.copy(options.target);
            missile.marker.position.y += 0.3;
            missile.marker.visible = true;
            this.group.add(missile.marker);
        }
        if (options.own) this.sounds.whoosh(1);
        return missile;
    }

    _spawnBullet(origin, velocity, own) {
        const bullet = this._bullets[this._nextBullet];
        this._nextBullet = (this._nextBullet + 1) % MAX_BULLETS;
        bullet.alive = true;
        bullet.own = own;
        bullet.age = 0;
        bullet.position.copy(origin);
        bullet.previous.copy(origin);
        bullet.velocity.copy(velocity);
    }

    // Un obus tiré depuis un avion (matrice monde, vitesse) ; décalage dans la rafale (s) pour répartir les obus
    // tirés pendant une même image
    _shoot(matrix, velocity, own, offset) {
        _q.setFromRotationMatrix(_m.extractRotation(matrix));
        _fwd.set(0, 0, -1).applyQuaternion(_q);
        _up.set(0, 1, 0).applyQuaternion(_q);
        _right.set(1, 0, 0).applyQuaternion(_q);
        const elevation = GUN.elevation + (Math.random() - 0.5) * 2 * GUN.dispersion;
        const drift = (Math.random() - 0.5) * 2 * GUN.dispersion;
        _d.copy(_fwd).addScaledVector(_up, elevation).addScaledVector(_right, drift).normalize();
        _v.copy(velocity).addScaledVector(_d, GUN.velocity);
        _a.copy(GUN.muzzle).applyMatrix4(matrix).addScaledVector(_v, offset);
        this._spawnBullet(_a, _v, own);
    }

    // Point où seront nos obus à une distance donnée (pipper du HUD) : position de l'avion, vitesse, pesanteur
    bulletPoint(aircraft, velocity, range, target = new Vector3()) {
        _fwd.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
        _up.set(0, 1, 0).applyQuaternion(aircraft.quaternion);
        _d.copy(_fwd).addScaledVector(_up, GUN.elevation).normalize();
        const t = range / GUN.velocity;
        target.copy(GUN.muzzle).applyQuaternion(aircraft.quaternion).add(aircraft.position)
            .addScaledVector(velocity, t).addScaledVector(_d, GUN.velocity * t);
        target.y -= 0.5 * GRAVITY * t * t;
        return target;
    }

    // Temps de vol d'un obus jusqu'à une distance (s)
    static flightTime(range) {
        return range / GUN.velocity;
    }

    // À chaque image.
    // own : { aircraft, velocity, armed (F-15 en vol), id, name } ; camera ;
    // targets : avions des autres joueurs [{ id, name, type, group }] (coups au but) ;
    // shooters : autres joueurs qui tirent [{ id, matrix, velocity }] (traceurs seulement)
    update(delta, { own, camera, targets = [], shooters = [], cabin = false }) {
        const ground = (x, z) => this.terrain.heightAt(x, z);

        // Notre canon : les tubes se lancent, puis 100 obus par seconde tant que la détente est tenue
        this.switchFlash = Math.max(0, this.switchFlash - delta);
        this.reload = Math.max(0, this.reload - delta);
        this.aaReload = Math.max(0, this.aaReload - delta);
        this._updateLock(delta, own, targets);
        this.sounds.seeker(this.selected === 'aa' && own.armed ? (this.locked ? 'lock' : 'search') : 'off');
        const wantFire = ((this.trigger && this.selected === 'gun') || this.gunKey) && own.armed && this.ammo > 0 && !this.overheated;
        // Missiles partis : réapparaissent sur leur pylône
        for (let i = this._storeTimers.length - 1; i >= 0; i--) {
            const store = this._storeTimers[i];
            if ((store.time -= delta) <= 0) {
                store.mesh.visible = true;
                this._storeTimers.splice(i, 1);
            }
        }
        this._spin = wantFire ? Math.min(1, this._spin + delta / GUN.spinUp) : 0;
        this.firing = wantFire && this._spin >= 1;
        if (this.trigger && own.armed && this.ammo <= 0 && !this._emptyWarned) {
            this._emptyWarned = true;
            this._message('Canon vide');
        }
        if (!this.trigger) this._emptyWarned = false;
        if (this.firing) {
            own.aircraft.updateMatrixWorld();
            this._roundTimer -= delta;
            while (this._roundTimer <= 0 && this.ammo > 0) {
                this._shoot(own.aircraft.matrixWorld, own.velocity, true, -this._roundTimer);
                if (!UNLIMITED) this.ammo--;
                this._roundTimer += 1 / GUN.rate;
            }
            this.muzzleFlash.position.copy(GUN.muzzle).applyMatrix4(own.aircraft.matrixWorld)
                .add(_d.set(0, 0, -1.5).applyQuaternion(own.aircraft.quaternion));
            this.muzzleFlash.scale.setScalar(1.2 + Math.random() * 1.4);
            this.muzzleFlash.visible = Math.random() > 0.2;
        } else {
            this._roundTimer = 0;
            this.muzzleFlash.visible = false;
        }
        // Chauffe du canon : surchauffe après ~4 s de tir continu, il faut lâcher la détente le temps qu'il refroidisse
        if (this.firing) this.heat = Math.min(1, this.heat + delta / HEAT_TIME);
        else this.heat = Math.max(0, this.heat - COOL_RATE * delta);
        if (this.heat >= 1 && !this.overheated) {
            this.overheated = true;
            this.dispatchEvent(new CustomEvent('overheat'));
        }
        if (this.overheated && this.heat <= COOLED) this.overheated = false;

        // Canons des autres joueurs (traceurs vus de chez nous)
        let remoteLoudness = 0;
        const listener = camera ? _p.setFromMatrixPosition(camera.matrixWorld).clone() : null;
        for (const shooter of shooters) {
            let timer = (this._remoteFire.get(shooter.id) ?? 0) - delta;
            while (timer <= 0) {
                this._shoot(shooter.matrix, shooter.velocity, false, -timer);
                timer += 1 / GUN.rate;
            }
            this._remoteFire.set(shooter.id, timer);
            if (listener) {
                const distance = _a.setFromMatrixPosition(shooter.matrix).distanceTo(listener);
                remoteLoudness = Math.max(remoteLoudness, MathUtils.clamp(60 / Math.max(1, distance), 0, 1));
            }
        }
        for (const id of this._remoteFire.keys()) if (!shooters.some((s) => s.id === id)) this._remoteFire.delete(id);
        this.sounds.update(this.firing ? 1 : 0, remoteLoudness, cabin);

        // Obus : vol, sol, coups au but (nos obus seulement)
        for (const target of targets) {
            target.group.updateMatrixWorld();
            target.inverse = (target.inverse ?? new Matrix4()).copy(target.group.matrixWorld).invert();
        }
        let count = 0;
        const cameraPosition = listener;
        for (const bullet of this._bullets) {
            if (!bullet.alive) continue;
            bullet.age += delta;
            if (bullet.age > GUN.life) { bullet.alive = false; continue; }
            bullet.previous.copy(bullet.position);
            bullet.velocity.y -= GRAVITY * delta;
            bullet.position.addScaledVector(bullet.velocity, delta);
            // Coup au but
            if (bullet.own && this._hitTest(bullet, targets)) { bullet.alive = false; continue; }
            // Sol
            const h = ground(bullet.position.x, bullet.position.z);
            if (bullet.position.y <= h) {
                bullet.alive = false;
                if (bullet.own || Math.random() < 0.5) this.impacts.dust(_a.copy(bullet.position).setY(h));
                continue;
            }
            // Traceur : de la position précédente à l'actuelle (au plus 14 m), épaisseur selon la distance
            const length = Math.min(14, bullet.previous.distanceTo(bullet.position));
            if (length < 0.01) continue;
            const distance = cameraPosition ? bullet.position.distanceTo(cameraPosition) : 100;
            const thickness = MathUtils.clamp(distance * 0.0022, 0.08, 4);
            _d.subVectors(bullet.position, bullet.previous).normalize();
            _q.setFromUnitVectors(_z.set(0, 0, 1), _d);
            _a.copy(bullet.position).addScaledVector(_d, -length / 2);
            _m.compose(_a, _q, _scale.set(thickness, thickness, length));
            this.tracers.setMatrixAt(count++, _m);
        }
        this.tracers.count = count;
        this.tracers.instanceMatrix.needsUpdate = true;
        this.impacts.update(delta);

        // Coups au but regroupés et envoyés au joueur touché
        this._hitTimer -= delta;
        if (this._hitTimer <= 0 && this._pendingHits.size) {
            this._hitTimer = HIT_FLUSH;
            for (const [id, zones] of this._pendingHits) this.dispatchEvent(new CustomEvent('hits', { detail: { id, zones } }));
            this._pendingHits.clear();
        }
        this.hitMarker = Math.max(0, this.hitMarker - delta);

        // Missiles
        for (let i = this.inFlight.length - 1; i >= 0; i--) {
            const missile = this.inFlight[i];
            if (missile.update(delta, ground)) {
                this.dispatchEvent(new CustomEvent('explosion', { detail: {
                    position: missile.position.clone(), ownerId: missile.ownerId, ownerName: missile.ownerName, own: missile.own,
                } }));
            }
            if (missile.marker && (missile.exploded || missile.done)) {
                this.group.remove(missile.marker);
                missile.marker = null;
            }
            if (missile.marker && cameraPosition) {
                // Marque d'impact : pulse, assez grande pour se voir de loin
                const pulse = 1 + 0.15 * Math.sin(missile.age * 12);
                missile.marker.scale.setScalar(Math.max(8, cameraPosition.distanceTo(missile.target) * 0.03) * pulse);
            }
            if (missile.done) {
                missile.dispose();
                this.inFlight.splice(i, 1);
            }
        }

        // Missiles air-air : cible = avion d'un autre joueur, ou le nôtre (missile d'un autre joueur sur nous)
        for (let i = this.aaInFlight.length - 1; i >= 0; i--) {
            const missile = this.aaInFlight[i];
            let target = null;
            if (own.id && missile.targetId === own.id) target = own.alive ? { position: own.aircraft.position, velocity: own.velocity } : null;
            else {
                const t = targets.find((x) => x.id === missile.targetId);
                if (t) target = { position: t.group.position, velocity: t.velocity ?? _v.set(0, 0, 0) };
            }
            if (missile.update(delta, ground, target)) {
                const hit = missile.miss <= AAM.fuse;
                // Notre missile explose près de sa cible : éclats -> coups au but envoyés au joueur touché
                if (missile.own && hit && missile.targetId !== own.id) {
                    const count = missile.miss < 5 ? 20 : missile.miss < 9 ? 13 : 8;
                    const zones = this._pendingHits.get(missile.targetId) ?? [];
                    for (let k = 0; k < count; k++) zones.push(AAM_ZONES[Math.floor(Math.random() * AAM_ZONES.length)]);
                    this._pendingHits.set(missile.targetId, zones);
                    this.hitMarker = 0.6;
                }
                this.dispatchEvent(new CustomEvent('explosion', { detail: {
                    position: missile.position.clone(), ownerId: missile.ownerId, ownerName: missile.ownerName, own: missile.own,
                    kind: 'aa', hit, targetId: missile.targetId,
                } }));
            }
            if (missile.done) {
                missile.dispose();
                this.aaInFlight.splice(i, 1);
            }
        }

        // Croix rouge : au sol, assez grande pour se voir de loin
        const showCross = this.target && own.armed && this.selected === 'missile';
        this.cross.visible = Boolean(showCross);
        if (showCross) {
            this.cross.position.copy(this.target);
            this.cross.position.y += 0.3;
            const distance = cameraPosition ? cameraPosition.distanceTo(this.target) : 500;
            this.cross.scale.setScalar(Math.max(10, distance * 0.035));
        }
    }

    // Segment parcouru par un obus contre les avions des autres joueurs
    _hitTest(bullet, targets) {
        for (const target of targets) {
            const boxes = HIT_BOXES[target.type] ?? HIT_BOXES.c172;
            _a.copy(bullet.previous).applyMatrix4(target.inverse);
            _b.copy(bullet.position).applyMatrix4(target.inverse);
            // Rejet rapide : segment loin du centre de l'avion
            _d.subVectors(_b, _a);
            const t = MathUtils.clamp(-_a.dot(_d) / Math.max(1e-9, _d.lengthSq()), 0, 1);
            if (_v.copy(_a).addScaledVector(_d, t).length() > HIT_RANGE) continue;
            let best = Infinity, zone = null;
            for (const shape of boxes) {
                const f = segmentBox(_a, _b, shape.box);
                if (f !== null && f < best) {
                    best = f;
                    zone = shape;
                }
            }
            if (!zone) continue;
            const local = _v.copy(_a).lerp(_b, best);
            const code = zone.zone(local);
            const zones = this._pendingHits.get(target.id) ?? [];
            if (zones.length < 30) zones.push(code);
            this._pendingHits.set(target.id, zones);
            this.impacts.spark(local.applyMatrix4(target.group.matrixWorld), 3.5);
            this.hitMarker = 0.35;
            return true;
        }
        return false;
    }

    // Plus de missiles ni d'obus dans le ciel (changement de partie)
    clear() {
        for (const missile of this.inFlight) {
            if (missile.marker) this.group.remove(missile.marker);
            missile.dispose();
        }
        for (const missile of this.aaInFlight) missile.dispose();
        this.aaInFlight.length = 0;
        this.inFlight.length = 0;
        for (const bullet of this._bullets) bullet.alive = false;
        this.tracers.count = 0;
        this._pendingHits.clear();
    }

    get nextImpact() {
        const own = this.inFlight.filter((m) => m.own && !m.exploded);
        return own.length ? Math.min(...own.map((m) => m.timeToImpact)) : null;
    }
}

export { Weapons, GUN, MISSILE, UNLIMITED, MISSILE_RELOAD, AAM };
