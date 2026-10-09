import {
    AdditiveBlending,
    CanvasTexture,
    Group,
    PointLight,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3
} from 'three';

const FIRE_DURATION = 1.4;
const SMOKE_DURATION = 6;

// Bouffée floue (dégradé radial irrégulier)
function puffTexture() {
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
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

// Explosion au crash : boule de feu, lueur, puis panache de fumée noire
class CrashEffect {
    constructor() {
        this.group = new Group();
        this.group.visible = false;
        this._time = 0;
        const map = puffTexture();

        this._fire = Array.from({ length: 16 }, () => {
            const sprite = new Sprite(new SpriteMaterial({
                map, color: 0xffa040, blending: AdditiveBlending, transparent: true, depthWrite: false,
            }));
            sprite.material.color.multiplyScalar(4); // > 1 : halo du bloom
            sprite.userData.velocity = new Vector3();
            this.group.add(sprite);
            return sprite;
        });
        this._smoke = Array.from({ length: 28 }, () => {
            const sprite = new Sprite(new SpriteMaterial({ map, color: 0x1c1c1c, transparent: true, depthWrite: false }));
            sprite.userData.velocity = new Vector3();
            this.group.add(sprite);
            return sprite;
        });
        this._light = new PointLight(0xff7a2a, 0, 150, 2);
        this._light.position.y = 3;
        this.group.add(this._light);
    }

    start(position) {
        this.group.position.copy(position);
        this.group.visible = true;
        this._time = 0;
        for (const sprite of this._fire) {
            sprite.position.set(0, 0.5, 0);
            sprite.userData.velocity.set(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).multiplyScalar(9);
        }
        this._smoke.forEach((sprite, i) => {
            sprite.position.set((Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4);
            sprite.userData.velocity.set((Math.random() - 0.5) * 2, 3 + Math.random() * 4, (Math.random() - 0.5) * 2);
            sprite.userData.delay = (i / this._smoke.length) * 2.5; // la fumée continue de sortir
        });
    }

    stop() {
        this.group.visible = false;
        this._light.intensity = 0;
    }

    update(delta) {
        if (!this.group.visible) return;
        const t = (this._time += delta);

        for (const sprite of this._fire) {
            const life = Math.min(1, t / FIRE_DURATION);
            sprite.position.addScaledVector(sprite.userData.velocity, delta);
            sprite.userData.velocity.multiplyScalar(1 - 2 * delta);
            sprite.scale.setScalar(2 + 9 * Math.sqrt(life));
            sprite.material.opacity = 1 - life;
        }
        for (const sprite of this._smoke) {
            const local = t - sprite.userData.delay;
            sprite.visible = local > 0;
            if (local <= 0) continue;
            const life = Math.min(1, local / SMOKE_DURATION);
            sprite.position.addScaledVector(sprite.userData.velocity, delta);
            sprite.scale.setScalar(4 + 20 * life);
            sprite.material.opacity = 0.75 * Math.min(1, local * 3) * (1 - life);
        }
        // Lueur orangée qui faiblit en vacillant
        this._light.intensity = Math.max(0, 3000 * (1 - t / 3)) * (0.75 + 0.25 * Math.sin(t * 40));
        if (t > SMOKE_DURATION + 3) this.stop();
    }
}

export { CrashEffect };
