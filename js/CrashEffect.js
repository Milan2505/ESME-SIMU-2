import {
    CanvasTexture,
    Color,
    Group,
    SRGBColorSpace,
    Vector3
} from 'three';
import { Billboards } from './Billboards.js';

const FIRE_DURATION = 1.4;
const SMOKE_DURATION = 6;
const FIRE_COUNT = 16, SMOKE_COUNT = 28;
const FIRE_COLOR = new Color(0xffa040).multiplyScalar(4);   // > 1 : halo du bloom
const SMOKE_COLOR = new Color(0x1c1c1c);

// Bouffée floue (dégradé radial irrégulier) : dessinée une fois, partagée par toutes les explosions (avant : une
// nouvelle image et 44 matériaux à chaque explosion, jamais libérés : la mémoire graphique grossissait en combat)
let _puffMap = null;
function puffTexture() {
    if (_puffMap) return _puffMap;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 12; i++) {
        const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 25 + Math.random() * 30;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
    }
    _puffMap = new CanvasTexture(canvas);
    _puffMap.colorSpace = SRGBColorSpace;
    return _puffMap;
}

const _world = new Vector3();

// Explosion au crash : boule de feu lumineuse (halo du bloom), puis panache de fumée noire. Deux lots de particules
// (voir Billboards.js) : deux appels de dessin par explosion. Réutilisable : start() la relance ailleurs
class CrashEffect {
    constructor() {
        this.group = new Group();
        this.group.userData.transient = true;   // (objet passager : voir countSceneObjects dans simulator.js)
        this.group.visible = false;
        this._time = 0;
        const map = puffTexture();
        const particle = () => ({ position: new Vector3(), velocity: new Vector3(), delay: 0 });
        this._fire = Array.from({ length: FIRE_COUNT }, particle);
        this._smoke = Array.from({ length: SMOKE_COUNT }, particle);
        // Positions en repère monde (les lots se placent eux-mêmes au centre de leurs particules)
        this._smokeBatch = new Billboards(SMOKE_COUNT, { map });
        this._fireBatch = new Billboards(FIRE_COUNT, { map, additive: true });
        this._origin = new Vector3();
        this.group.add(this._smokeBatch, this._fireBatch);
    }

    start(position) {
        this._origin.copy(position);
        this.group.visible = true;
        this._time = 0;
        for (const p of this._fire) {
            p.position.set(0, 0.5, 0);
            p.velocity.set(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).multiplyScalar(9);
        }
        this._smoke.forEach((p, i) => {
            p.position.set((Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4);
            p.velocity.set((Math.random() - 0.5) * 2, 3 + Math.random() * 4, (Math.random() - 0.5) * 2);
            p.delay = (i / this._smoke.length) * 2.5; // la fumée continue de sortir
        });
        this.update(0);
    }

    stop() {
        this.group.visible = false;
    }

    update(delta) {
        if (!this.group.visible) return;
        const t = (this._time += delta);
        // (le groupe reste à l'origine : les lots sont placés en repère monde)
        const fire = this._fireBatch;
        fire.begin();
        const fireLife = Math.min(1, t / FIRE_DURATION);
        for (const p of this._fire) {
            p.position.addScaledVector(p.velocity, delta);
            p.velocity.multiplyScalar(1 - 2 * delta);
            fire.add(_world.copy(p.position).add(this._origin), 2 + 9 * Math.sqrt(fireLife), FIRE_COLOR.r, FIRE_COLOR.g, FIRE_COLOR.b, 1 - fireLife);
        }
        fire.end();
        const smoke = this._smokeBatch;
        smoke.begin();
        for (const p of this._smoke) {
            const local = t - p.delay;
            if (local <= 0) continue;
            const life = Math.min(1, local / SMOKE_DURATION);
            p.position.addScaledVector(p.velocity, delta);
            smoke.add(_world.copy(p.position).add(this._origin), 4 + 20 * life, SMOKE_COLOR.r, SMOKE_COLOR.g, SMOKE_COLOR.b,
                0.75 * Math.min(1, local * 3) * (1 - life));
        }
        smoke.end();
        if (t > SMOKE_DURATION + 3) this.stop();
    }

    dispose() {
        this.group.removeFromParent();
        this._smokeBatch.dispose();
        this._fireBatch.dispose();
    }
}

export { CrashEffect };
