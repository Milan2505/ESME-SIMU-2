import {
    AdditiveBlending,
    CanvasTexture,
    Group,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3
} from 'three';

// Dégâts au combat (multijoueur) : obus de 20 mm du canon M61 et souffle des missiles air-sol (voir Weapons.js).
// Chaque coup touche une partie de l'avion, qui a son propre effet sur le vol (FlightModel.damage) :
// - réacteur / moteur : perte de poussée, puis extinction ; il peut prendre feu (le feu ronge la structure, puis
//   l'extincteur l'éteint au bout de quelques secondes) ;
// - aile : moins de portance de ce côté, l'avion part en roulis de ce côté ; au-delà d'un seuil, l'aile se rompt ;
// - empennage : gouvernes moins efficaces ;
// - fuselage, cabine : structure (cabine : plus grave) ; chaque trou ajoute de la traînée.
// Structure à 0 : avion détruit (crash). Ordres de grandeur réels : un obus explosif de 20 mm fait un trou de 20 à
// 40 cm ; il en faut une dizaine (bien placés) à une quinzaine pour abattre un chasseur, deux ou trois pour un avion
// léger. Le Cessna est donc bien plus fragile.

// Coups possibles (codes envoyés par le tireur, voir Multiplayer.sendHit) :
// f fuselage, c cabine, eL / eR réacteur (moteur du Cessna : eL), wL / wR aile, t empennage
const ZONES = new Set(['f', 'c', 'eL', 'eR', 'wL', 'wR', 't']);
const GUN = {   // par obus de 20 mm explosif
    f: { structure: 6 },
    c: { structure: 14 },
    e: { structure: 4, engine: 34 },
    w: { structure: 4, wing: 0.12 },
    t: { structure: 5, tail: 0.15 },
};
const LIGHT_AIRCRAFT = 2.2;     // Cessna : dégâts multipliés (structure légère, sans blindage)
const ENGINE_FIRE_CHANCE = 0.3; // réacteur touché : risque de feu
const FIRE_DAMAGE = 2.5;        // structure perdue par seconde de feu
const BLAST_RADIUS = 50;        // m : souffle et éclats d'un missile (charge de 136 kg)
const BLAST_DAMAGE = 240;       // au point d'impact ; ~16 m : avion détruit

let _puffMap = null;
// Bouffée floue (dégradé radial irrégulier), comme celle de CrashEffect
function puffTexture() {
    if (_puffMap) return _puffMap;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 8; i++) {
        const x = 32 + (Math.random() - 0.5) * 22, y = 32 + (Math.random() - 0.5) * 22, r = 12 + Math.random() * 16;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.4)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
    }
    _puffMap = new CanvasTexture(canvas);
    _puffMap.colorSpace = SRGBColorSpace;
    return _puffMap;
}

// Traînée de fumée (et flammes) derrière un avion touché, ou derrière un missile. Bouffées dans le repère du monde :
// elles restent sur place pendant que l'avion avance
class SmokeTrail {
    constructor(scene, { count = 90, color = 0x2a2a2a, size = 5, life = 4 } = {}) {
        this.scene = scene;
        this.group = new Group();
        this.group.frustumCulled = false;
        this.size = size;
        this.life = life;
        const map = puffTexture();
        this._puffs = Array.from({ length: count }, () => {
            const sprite = new Sprite(new SpriteMaterial({ map, color, transparent: true, depthWrite: false, opacity: 0 }));
            sprite.visible = false;
            sprite.userData = { age: 0, life: 1, velocity: new Vector3(), size: 1 };
            this.group.add(sprite);
            return sprite;
        });
        this._fire = Array.from({ length: 24 }, () => {
            const sprite = new Sprite(new SpriteMaterial({ map, color: 0xff8a30, blending: AdditiveBlending, transparent: true, depthWrite: false }));
            sprite.material.color.multiplyScalar(3);   // > 1 : halo du bloom
            sprite.visible = false;
            sprite.userData = { age: 0, life: 1, velocity: new Vector3(), size: 1 };
            this.group.add(sprite);
            return sprite;
        });
        this._next = 0;
        this._nextFire = 0;
        this._smokeTimer = 0;
        this._fireTimer = 0;
        this._last = null;
        scene.add(this.group);
    }

    _emit(pool, index, position, velocity, size, life) {
        const sprite = pool[index];
        sprite.position.copy(position);
        sprite.userData.velocity.copy(velocity);
        sprite.userData.age = 0;
        sprite.userData.life = life * (0.8 + Math.random() * 0.4);
        sprite.userData.size = size * (0.8 + Math.random() * 0.4);
        sprite.visible = true;
    }

    // level : 0 (rien) -> 1 (épaisse fumée noire) ; fire : flammes ; velocity : vitesse de l'avion (les bouffées en
    // gardent un peu)
    update(delta, position, level, fire = false, velocity = null) {
        if (this._last === null) this._last = position.clone();
        const moved = this._last.distanceTo(position);
        // Bouffées réparties sur le chemin parcouru depuis l'image précédente (traînée continue, même vite)
        if (level > 0.02) {
            this._smokeTimer -= delta;
            if (this._smokeTimer <= 0) {
                this._smokeTimer = 0.06 / Math.min(1, level + 0.2);
                const steps = Math.min(4, 1 + Math.floor(moved / (this.size * 1.5)));
                for (let i = 0; i < steps; i++) {
                    const p = _p.copy(this._last).lerp(position, (i + 1) / steps);
                    p.x += (Math.random() - 0.5) * 0.8;
                    p.y += (Math.random() - 0.5) * 0.8;
                    p.z += (Math.random() - 0.5) * 0.8;
                    _v.set((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5);
                    if (velocity) _v.addScaledVector(velocity, 0.08);
                    this._emit(this._puffs, this._next, p, _v, this.size * (0.6 + level * 0.6), this.life);
                    this._puffs[this._next].material.opacity = 0;
                    this._puffs[this._next].userData.opacity = 0.35 + 0.5 * level;
                    this._next = (this._next + 1) % this._puffs.length;
                }
            }
        }
        if (fire) {
            this._fireTimer -= delta;
            if (this._fireTimer <= 0) {
                this._fireTimer = 0.03;
                _v.set(0, 0.5, 0);
                if (velocity) _v.addScaledVector(velocity, 0.6);
                this._emit(this._fire, this._nextFire, position, _v, this.size * 0.55, 0.35);
                this._nextFire = (this._nextFire + 1) % this._fire.length;
            }
        }
        this._last.copy(position);

        for (const sprite of this._puffs) {
            if (!sprite.visible) continue;
            const d = sprite.userData;
            d.age += delta;
            const t = d.age / d.life;
            if (t >= 1) {
                sprite.visible = false;
                continue;
            }
            sprite.position.addScaledVector(d.velocity, delta);
            sprite.scale.setScalar(d.size * (0.6 + 2.2 * t));
            sprite.material.opacity = d.opacity * Math.min(1, t * 8) * (1 - t);
        }
        for (const sprite of this._fire) {
            if (!sprite.visible) continue;
            const d = sprite.userData;
            d.age += delta;
            const t = d.age / d.life;
            if (t >= 1) {
                sprite.visible = false;
                continue;
            }
            sprite.position.addScaledVector(d.velocity, delta);
            sprite.scale.setScalar(d.size * (1 - 0.6 * t));
            sprite.material.opacity = 1 - t;
        }
    }

    // Plus rien n'est émis ; true quand toutes les bouffées ont disparu
    get empty() {
        return !this._puffs.some((s) => s.visible) && !this._fire.some((s) => s.visible);
    }

    // Recommence ailleurs sans traînée entre les deux positions (réapparition)
    jump() {
        this._last = null;
    }

    dispose() {
        this.scene.remove(this.group);
        for (const sprite of [...this._puffs, ...this._fire]) sprite.material.dispose();
    }
}
const _p = new Vector3(), _v = new Vector3();

// État des dégâts de l'avion du joueur
class Damage extends EventTarget {
    constructor() {
        super();
        this.reset();
    }

    reset() {
        this.structure = 100;          // % : 0 = avion détruit
        this.engines = [100, 100];     // % par réacteur (gauche, droite) ; Cessna : seul le premier compte
        this.wings = [0, 0];           // dégâts de chaque aile (0 -> 1 : rompue)
        this.tail = 0;                 // dégâts de l'empennage (0 -> 1)
        this.fire = [0, 0];            // s de feu restantes par réacteur
        this.destroyed = false;
        this.attacker = null;          // nom du dernier joueur qui nous a touchés
        this.attackerId = null;
        this.lastHit = -Infinity;      // performance.now() du dernier coup reçu
        this.hits = 0;                 // coups reçus depuis le départ
        this.lastZone = null;
    }

    get onFire() {
        return this.fire[0] > 0 || this.fire[1] > 0;
    }

    // 0 (intact) -> 1 : fumée émise
    get smoke() {
        const engines = Math.max(100 - this.engines[0], 100 - this.engines[1]) / 100;
        return Math.min(1, Math.max((100 - this.structure) / 70, engines * 0.8, (this.wings[0] + this.wings[1]) * 0.5));
    }

    // Coups de canon reçus : zones (voir ZONES), attaquant { id, name } ; light : avion léger (Cessna)
    applyHits(zones, attacker, light = false) {
        if (this.destroyed) return;
        const k = light ? LIGHT_AIRCRAFT : 1;
        for (const zone of zones) {
            if (!ZONES.has(zone)) continue;
            const kind = zone[0];
            const side = zone[1] === 'R' ? 1 : 0;
            const hit = GUN[kind];
            this.structure -= hit.structure * k * (0.7 + Math.random() * 0.6);
            if (hit.engine) {
                const engine = light ? 0 : side;
                this.engines[engine] = Math.max(0, this.engines[engine] - hit.engine * k);
                if (Math.random() < ENGINE_FIRE_CHANCE * (light ? 1.5 : 1) && this.fire[engine] <= 0) this.fire[engine] = 6 + Math.random() * 12;
            }
            if (hit.wing) this.wings[side] = Math.min(1, this.wings[side] + hit.wing * k * (0.7 + Math.random() * 0.6));
            if (hit.tail) this.tail = Math.min(1, this.tail + hit.tail * k);
            this.lastZone = zone;
            this.hits++;
        }
        this._hitBy(attacker);
    }

    // Souffle d'un missile qui explose à distance (m) de l'avion
    applyBlast(distance, attacker, light = false) {
        if (this.destroyed || distance >= BLAST_RADIUS) return false;
        const k = light ? LIGHT_AIRCRAFT : 1;
        const damage = BLAST_DAMAGE * (1 - distance / BLAST_RADIUS) ** 2 * k;
        this.structure -= damage;
        // Éclats : réacteurs et ailes criblés
        for (const i of [0, 1]) {
            this.engines[i] = Math.max(0, this.engines[i] - damage * (0.5 + Math.random()));
            this.wings[i] = Math.min(1, this.wings[i] + damage / 250 * Math.random());
            if (damage > 20 && Math.random() < 0.5) this.fire[i] = Math.max(this.fire[i], 8 + Math.random() * 10);
        }
        this.lastZone = 'blast';
        this.hits++;
        this._hitBy(attacker);
        return true;
    }

    _hitBy(attacker) {
        this.lastHit = performance.now();
        if (attacker) {
            this.attacker = attacker.name;
            this.attackerId = attacker.id;
        }
        this.dispatchEvent(new CustomEvent('hit'));
    }

    // À chaque image : feu, effets sur le vol ; jet : F-15 (deux réacteurs), sinon Cessna (un moteur)
    update(delta, model, jet) {
        for (const i of [0, 1]) {
            if (this.fire[i] <= 0) continue;
            this.fire[i] -= delta;   // l'extincteur finit par l'éteindre
            this.structure -= FIRE_DAMAGE * delta;
            this.engines[i] = Math.max(0, this.engines[i] - 4 * delta);
        }
        // Poussée : un réacteur endommagé perd de la poussée, éteint il n'en donne plus
        const engineFactor = (health) => (health <= 0 ? 0 : 0.35 + 0.65 * health / 100);
        const d = model.damage;
        d.thrust = jet ? (engineFactor(this.engines[0]) + engineFactor(this.engines[1])) / 2 : engineFactor(this.engines[0]);
        d.wingLift[0] = 1 - 0.45 * this.wings[0];
        d.wingLift[1] = 1 - 0.45 * this.wings[1];
        d.drag = (100 - Math.max(0, this.structure)) * 0.0004 + 0.03 * (this.wings[0] + this.wings[1]);
        d.control = 1 - 0.6 * this.tail;

        if (this.destroyed) return;
        let reason = null;
        if (this.wings[0] >= 1 || this.wings[1] >= 1) reason = `Aile arrachée${this.attacker ? ` par ${this.attacker}` : ''}`;
        else if (this.structure <= 0) reason = this.attacker ? `Abattu par ${this.attacker}` : 'Avion détruit';
        if (reason) {
            this.destroyed = true;
            this.dispatchEvent(new CustomEvent('destroyed', { detail: { reason, attacker: this.attacker, attackerId: this.attackerId } }));
        }
    }

    // Résumé pour l'affichage : [{ label, value (0 -> 1, 1 = intact), bad }]
    status(jet) {
        const items = [{ label: 'STRUCT', value: Math.max(0, this.structure) / 100 }];
        if (jet) {
            items.push({ label: 'RÉAC G', value: this.engines[0] / 100, fire: this.fire[0] > 0 });
            items.push({ label: 'RÉAC D', value: this.engines[1] / 100, fire: this.fire[1] > 0 });
        } else {
            items.push({ label: 'MOTEUR', value: this.engines[0] / 100, fire: this.fire[0] > 0 });
        }
        items.push({ label: 'AILE G', value: 1 - this.wings[0] });
        items.push({ label: 'AILE D', value: 1 - this.wings[1] });
        items.push({ label: 'EMPEN', value: 1 - this.tail });
        return items;
    }

    get damaged() {
        return this.hits > 0;
    }
}

export { Damage, SmokeTrail, ZONES, BLAST_RADIUS };
