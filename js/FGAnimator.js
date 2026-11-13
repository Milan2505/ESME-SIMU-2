import { Color, Matrix4, Vector3 } from 'three';

// Rejoue dans le jeu les animations d'un appareil FlightGear converti par Blender (voir asset/blender/build_r44.py) :
// aiguilles et tambours des instruments, interrupteurs, manches, rotors, voyants, pièces montrées ou cachées.
// Chaque animation du fichier JSON vise des objets du modèle (par leur nom) et lit une « propriété » FlightGear
// (« rotors/main/rpm », « controls/electric/battery-switch »…) : le jeu remplit ces propriétés (props) avec ses propres
// valeurs, l'animateur en déduit la position de chaque pièce.
// Types rejoués : rotate, spin, translate, slider, scale (matrice de la pièce), select (visible ou non), material
// (éclairage des instruments : émission), textranslate (défilement de la texture : tambours, chiffres des radios).
// Zones cliquables (pick) : clicAt() renvoie la zone sous la souris, activate() applique ses liaisons
// (property-toggle, -assign, -adjust, -swap) aux propriétés et renvoie celles qui ont changé.

const _axis = new Vector3();
const _matrix = new Matrix4();
const _step = new Matrix4();
const _rotation = new Matrix4();
const _back = new Matrix4();
const _center = new Vector3();

// Valeur d'une table d'interpolation [[entrée, sortie], …] (bornée aux extrémités)
function interpolate(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
        if (x <= table[i][0]) {
            const [x0, y0] = table[i - 1], [x1, y1] = table[i];
            return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        }
    }
    return table[table.length - 1][1];
}

const clean = (name) => (name ?? '').replace(/^\//, '').replace(/\[0\]/g, '');

class FGAnimator {
    // data : contenu de r44-anim.json ; roots : objets 3D chargés (extérieur, cockpit…) où chercher les pièces
    constructor(data, roots) {
        this.props = new Map();
        this.time = 0;
        this._owned = new WeakSet();   // matériaux copiés par cet animateur (voir _material)
        this._spin = new Map();        // angle de chaque rotation continue (spin), en degrés
        const objects = new Map();
        for (const root of roots) {
            root.traverse((object) => { if (object.name && !objects.has(object.name)) objects.set(object.name, object); });
        }
        // Animations par pièce, dans l'ordre (la première est la plus « intérieure »)
        this.parts = new Map();
        this.selects = [];
        this.materials = [];
        this.textures = [];
        for (const anim of data.animations) {
            // (angle des rotors : propre à cet animateur, voir _spin)
            const targets = anim.objects.map((name) => objects.get(name)).filter(Boolean);
            if (!targets.length) continue;
            if (anim.type === 'select') this.selects.push({ anim, targets });
            else if (anim.type === 'material') this.materials.push(this._material(anim, targets));
            else if (anim.type === 'textranslate') this.textures.push(...targets.map((object) => this._texture(anim, object)).filter(Boolean));
            else {
                for (const object of targets) {
                    if (!this.parts.has(object)) {
                        object.matrixAutoUpdate = false;
                        // Position de repos : celle du modèle d'origine (gardée dans userData : une copie du modèle, faite
                        // pendant qu'il est animé, repart quand même de la bonne)
                        object.userData.fgBase ??= object.matrix.toArray();
                        this.parts.set(object, { base: new Matrix4().fromArray(object.userData.fgBase), anims: [] });
                    }
                    this.parts.get(object).anims.push(anim);
                }
            }
        }
        // Zones cliquables : maillages de chaque zone (pour le lancer de rayon)
        this.picks = [];
        this._pickOf = new Map();   // maillage -> zone (pas dans userData : three.js le recopie en JSON à chaque clone)
        this.pickMeshes = [];
        for (const pick of data.picks) {
            const meshes = [];
            for (const name of pick.objects) {
                objects.get(name)?.traverse((m) => { if (m.isMesh) meshes.push(m); });
            }
            if (!meshes.length) continue;
            const entry = { ...pick, meshes };
            for (const mesh of meshes) this._attachPick(mesh, entry);
            this.picks.push(entry);
            this.pickMeshes.push(...meshes);
        }
    }

    // Une pièce peut porter plusieurs zones (un bouton de souris chacune : la clé, tournée dans un sens ou dans
    // l'autre) : leurs actions sont réunies
    _attachPick(mesh, entry) {
        const before = this._pickOf.get(mesh);
        this._pickOf.set(mesh, before ? { ...before, actions: [...before.actions, ...entry.actions] } : entry);
    }

    // Zone cliquable ajoutée par le jeu (commande sans zone dans le modèle FlightGear) : objets, actions, nom
    // replace : la zone remplace celles du modèle sur ces pièces (au lieu de s'y ajouter)
    addPick(objects, actions, file, replace = false) {
        const meshes = [];
        for (const object of objects) object.traverse((m) => { if (m.isMesh) meshes.push(m); });
        if (!meshes.length) return;
        const entry = { objects: objects.map((o) => o.name), actions, file, meshes };
        for (const mesh of meshes) {
            if (replace) this._pickOf.set(mesh, entry);
            else this._attachPick(mesh, entry);
        }
        this.picks.push(entry);
        this.pickMeshes.push(...meshes);
    }

    get(name) {
        const value = this.props.get(clean(name));
        return value === undefined ? 0 : value;
    }

    set(name, value) {
        this.props.set(clean(name), value);
    }

    // Toutes les valeurs d'un coup ({ propriété: valeur })
    assign(values) {
        for (const name in values) this.props.set(clean(name), values[name]);
    }

    // Condition FlightGear (arbre exporté par build_r44.py)
    test(c) {
        if (!c) return true;
        if (c.property !== undefined) return Boolean(this.get(c.property));
        if (c.and) return c.and.every((x) => this.test(x));
        if (c.or) return c.or.some((x) => this.test(x));
        if (c.not) return !this.test(c.not);
        if (c.op) {
            const a = this.get(c.a);
            const b = c.b?.property !== undefined ? this.get(c.b.property) : c.b?.value;
            switch (c.op) {
                case 'equals': return a == b;   // (nombres et textes, comme FlightGear)
                case 'not-equals': return a != b;
                case 'less-than': return a < b;
                case 'greater-than': return a > b;
                case 'less-than-equals': return a <= b;
                case 'greater-than-equals': return a >= b;
            }
        }
        return true;
    }

    // Valeur d'une animation : propriété, quantifiée (step, scroll, bias), table ou facteur + décalage, bornée
    value(anim) {
        let x = Number(this.get(anim.property)) || 0;
        if (anim.step) {
            const s = anim.step, bias = anim.bias ?? 0;
            const t = (x + bias) / s;
            let q = Math.floor(t) * s;
            const frac = (t - Math.floor(t)) * s;
            if (anim.scroll && frac > s - anim.scroll) q += s * (frac - (s - anim.scroll)) / anim.scroll;
            x = q;
        }
        let v = anim.interpolation ? interpolate(anim.interpolation, x)
            : x * (anim.factor ?? 1) + (anim['offset-deg'] ?? anim['offset-m'] ?? 0);
        const min = anim['min-deg'] ?? anim['min-m'] ?? anim.min, max = anim['max-deg'] ?? anim['max-m'] ?? anim.max;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        return v;
    }

    // delta : secondes écoulées (rotors : rotation continue)
    update(delta) {
        this.time += delta;
        for (const [object, part] of this.parts) {
            _matrix.identity();
            for (const anim of part.anims) {
                if (anim.condition && !this.test(anim.condition)) continue;
                const [ax, ay, az] = anim.axis ?? [0, 1, 0];
                _axis.set(ax, ay, az);
                if (anim.type === 'rotate' || anim.type === 'spin' || anim.type === 'knob') {
                    let degrees;
                    if (anim.type === 'spin') {
                        // (tr/min × facteur) -> degrés, cumulés
                        degrees = ((this._spin.get(anim) ?? 0) + (Number(this.get(anim.property)) || 0) * (anim.factor ?? 1) * 6 * delta) % 360;
                        this._spin.set(anim, degrees);

                    } else degrees = this.value(anim);
                    // Rotation autour de l'axe passant par le centre : T(c) · R · T(-c)
                    _center.fromArray(anim.center);
                    _rotation.makeRotationAxis(_axis.normalize(), degrees * Math.PI / 180);
                    _step.makeTranslation(_center.x, _center.y, _center.z).multiply(_rotation)
                        .multiply(_back.makeTranslation(-_center.x, -_center.y, -_center.z));
                    _matrix.premultiply(_step);
                } else if (anim.type === 'translate' || anim.type === 'slider') {
                    const m = this.value(anim);
                    _matrix.premultiply(_step.makeTranslation(_axis.x * m, _axis.y * m, _axis.z * m));
                }
            }
            object.matrix.multiplyMatrices(_matrix, part.base);
            object.matrixWorldNeedsUpdate = true;
        }
        for (const { anim, targets } of this.selects) {
            const visible = this.test(anim.condition);
            for (const object of targets) object.visible = visible;
        }
        for (const m of this.materials) {
            const on = this.test(m.anim.condition);
            const factor = m.anim['emission-factor-prop'] ? Number(this.get(m.anim['emission-factor-prop'])) || 0 : 1;
            const k = on ? factor : 0;
            if (k === m.level) continue;
            m.level = k;
            for (const material of m.list) material.emissive.copy(m.color).multiplyScalar(k);
        }
        for (const t of this.textures) {
            const v = t.anim.condition && !this.test(t.anim.condition) ? 0 : this.value(t.anim);
            if (v === t.value) continue;
            t.value = v;
            const du = t.anim.axis[0] * v, dv = t.anim.axis[1] * v;
            const uv = t.attribute.array, base = t.base;
            for (let i = 0; i < uv.length; i += 2) {
                uv[i] = base[i] + du;
                uv[i + 1] = base[i + 1] + dv;
            }
            t.attribute.needsUpdate = true;
        }
    }

    // Matériaux propres aux pièces éclairées (leur émission change sans toucher le reste du modèle)
    _material(anim, targets) {
        const list = [];
        for (const object of targets) {
            object.traverse((mesh) => {
                if (!mesh.isMesh || !mesh.material?.emissive) return;
                if (!this._owned.has(mesh.material)) {   // (copie propre à cet animateur : pas partagée avec une copie du modèle)
                    mesh.material = mesh.material.clone();
                    this._owned.add(mesh.material);
                }
                list.push(mesh.material);
            });
        }
        const [r, g, b] = anim.emission ?? [0, 0, 0];
        return { anim, list, color: new Color(r, g, b), level: -1 };
    }

    // Défilement de texture : coordonnées de texture propres à la pièce (géométrie copiée)
    _texture(anim, object) {
        let mesh = null;
        object.traverse((m) => { if (!mesh && m.isMesh) mesh = m; });
        if (!mesh?.geometry.attributes.uv) return null;
        mesh.geometry = mesh.geometry.clone();
        const attribute = mesh.geometry.attributes.uv;
        return { anim, attribute, base: Float32Array.from(attribute.array), value: null };
    }

    // Zone cliquable d'un maillage, ou undefined
    pickOf(mesh) {
        return this._pickOf.get(mesh);
    }

    // Zone cliquable sous le rayon (Raycaster déjà placé), ou null
    pickAt(raycaster) {
        const hit = raycaster.intersectObjects(this.pickMeshes, false).find((h) => h.object.visible);
        return hit ? this._pickOf.get(hit.object) : null;
    }

    // Applique les liaisons d'une zone pour un bouton de souris (0 gauche, 1 milieu, 2 droit, 3 molette haut,
    // 4 molette bas) ; renvoie les propriétés changées et les commandes Nasal rencontrées (à traiter par le jeu)
    activate(pick, button = 0) {
        const changed = [], nasal = [], game = [];
        const actions = pick.actions.filter((a) => !a.buttons.length || a.buttons.includes(button));
        for (const action of actions) {
            for (const b of action.bindings) {
                const name = clean(b.property);
                // Commande du jeu (zone ajoutée par addPick : radios du jeu…) : rendue telle quelle
                if (b.command === 'game') {
                    game.push(b);
                    continue;
                }
                if (b.command === 'nasal') {
                    nasal.push(b.script ?? '');
                    continue;
                }
                if (!name && b.command !== 'property-swap') continue;
                if (b.command === 'property-toggle') {
                    this.set(name, !this.get(name));
                } else if (b.command === 'property-assign') {
                    this.set(name, b.value ?? 0);
                } else if (b.command === 'property-adjust') {
                    let v = Number(this.get(name)) || 0;
                    if (b.step !== undefined) v += b.step;
                    else v = v > ((b.min ?? 0) + (b.max ?? 1)) / 2 ? (b.min ?? 0) : (b.max ?? 1);   // (tirette : tout ou rien)
                    if (b.wrap && b.min !== undefined && b.max !== undefined) {
                        const span = b.max - b.min;
                        if (v > b.max) v -= span;
                        if (v < b.min) v += span;
                    } else {
                        if (b.min !== undefined) v = Math.max(b.min, v);
                        if (b.max !== undefined) v = Math.min(b.max, v);
                    }
                    this.set(name, Math.round(v * 1e6) / 1e6);
                } else if (b.command === 'property-swap' && b.properties?.length === 2) {
                    const [p, q] = b.properties.map(clean);
                    const v = this.get(p);
                    this.set(p, this.get(q));
                    this.set(q, v);
                    changed.push(q);
                    changed.push(p);
                    continue;
                } else continue;
                changed.push(name);
            }
        }
        return { changed, nasal, game, file: pick.file };
    }
}

export { FGAnimator, interpolate };
