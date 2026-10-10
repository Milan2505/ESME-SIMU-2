import {
    BoxGeometry,
    CanvasTexture,
    CylinderGeometry,
    ExtrudeGeometry,
    Group,
    Path,
    Mesh,
    MeshStandardMaterial,
    RepeatWrapping,
    Shape,
    SphereGeometry,
    SRGBColorSpace,
    TorusGeometry
} from 'three';
import { LAYOUT } from './PanelControls.js';
import { BREAKERS, TOGGLES } from './Systems.js';

// Commandes de la cabine en 3D : clé des magnétos, rockers master / avionique, disjoncteurs, interrupteurs à
// bascule, molettes (éclairage, OBS), boutons tirés (aération, statique, robinet carburant), levier des volets,
// molette de trim, poignée du sélecteur de réservoir. Placées sur les logements dessinés par PanelControls.js,
// animées selon l'état (Systems.js) ; chaque pièce porte userData.control (clic, voir Cockpit.controlAt).

const deg = (d) => d * Math.PI / 180;

const chrome = new MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.85, roughness: 0.28 });
const steel = new MeshStandardMaterial({ color: 0x8c9095, metalness: 0.7, roughness: 0.4 });
const blackPlastic = new MeshStandardMaterial({ color: 0x141416, roughness: 0.55 });
const knobGrey = new MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.5, roughness: 0.35 });
const white = new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
// Matériaux éclairés par le tableau la nuit (voir setLighting)
const LIT_MATERIALS = [];
const breakerGrey = new MeshStandardMaterial({ color: 0x45484d, metalness: 0.3, roughness: 0.45 });
const collar = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.15 });

// Cylindre dont l'axe est l'axe z (perpendiculaire au tableau, vers le pilote)
function zCylinder(r, length, material, segments = 20) {
    const geometry = new CylinderGeometry(r, r, length, segments);
    geometry.rotateX(Math.PI / 2);
    return new Mesh(geometry, material);
}

// Texture de crans pour une molette (bandes sombres / claires)
function ridgesTexture(count) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < count; i++) {
        const x = (i / count) * 256;
        const g = ctx.createLinearGradient(x, 0, x + 256 / count, 0);
        g.addColorStop(0, '#8a8d92');
        g.addColorStop(0.5, '#2a2b2e');
        g.addColorStop(1, '#8a8d92');
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 256 / count, 8);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    return texture;
}

LIT_MATERIALS.push(chrome, steel, blackPlastic, knobGrey, white, breakerGrey);

class Controls3D {
    // group : groupe de la cabine ; panelPoint(cx, cy) / pedestalPoint(cx, cy) / floorPoint(cx, cy) : position (repère
    // cabine) d'un pixel des canvas du tableau, du pupitre et du plancher ; subTop : haut du sous-panneau (px)
    constructor(group, { panelPoint, pedestalPoint, floorPoint, subTop, obs }) {
        this.group = group;
        this.clickables = [];
        this._parts = {};
        const L = LAYOUT;
        const sub = (x, y) => panelPoint(x, subTop + y);

        // Contact des magnétos : barillet de serrure (enjoliveur chromé, face noire, fente) et vraie clé de contact
        // qui sort du tableau : tige métallique, tête plate noire avec son trou de porte-clés. Toute la clé tourne
        // autour de son axe (perpendiculaire au tableau) d'une position à l'autre
        const mags = this._add('mags', sub(L.mags.x, L.mags.y));
        const bezel = new Mesh(new TorusGeometry(0.0145, 0.0035, 10, 32), chrome);
        bezel.position.z = 0.003;
        const face = zCylinder(0.0145, 0.004, blackPlastic, 32);
        face.position.z = 0.002;
        const barrel = zCylinder(0.0075, 0.003, chrome, 24);   // cylindre de la serrure
        barrel.position.z = 0.0055;
        mags.add(bezel, face, barrel);
        const key = new Group();
        // Tige (lame engagée dans la serrure) et épaulement
        const blade = new Mesh(new BoxGeometry(0.0022, 0.006, 0.012), chrome);
        blade.position.z = 0.012;
        const shoulder = new Mesh(new BoxGeometry(0.003, 0.011, 0.004), chrome);
        shoulder.position.z = 0.019;
        // Tête de la clé : profil arrondi percé d'un trou, dans le plan qui contient l'axe de la clé
        const bow = new Shape();
        bow.moveTo(0, -0.0075);
        bow.lineTo(0.012, -0.011);
        bow.absarc(0.022, 0, 0.011, -Math.PI / 2, Math.PI / 2, false);
        bow.lineTo(0, 0.0075);
        bow.lineTo(0, -0.0075);
        const hole = new Path();
        hole.absarc(0.026, 0, 0.0035, 0, Math.PI * 2, true);
        bow.holes.push(hole);
        const bowGeometry = new ExtrudeGeometry(bow, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 16 });
        bowGeometry.translate(0, 0, -0.002);
        bowGeometry.rotateY(-Math.PI / 2);   // profil (x, y) -> (axe de la clé z, largeur y), épaisseur selon x
        const head = new Mesh(bowGeometry, blackPlastic);
        head.position.z = 0.021;
        // Logo chromé sur la tête (petit insert)
        const insert = new Mesh(new BoxGeometry(0.0052, 0.008, 0.008), chrome);
        insert.position.z = 0.031;
        key.add(blade, shoulder, head, insert);
        mags.add(key);
        this._parts.magKey = key;

        // Rockers master ALT / BAT (rouges) et avionique (blanc), basculent autour d'un axe horizontal
        const rockerMesh = (id, x, w, color) => {
            const m = L.master;
            const root = this._add(`switch:${id}`, sub(x + w / 2, m.y + m.h / 2));
            const size = [w / 1280 * 0.92, m.h / 1280 * 0.95, 0.012];
            const body = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial({ color, roughness: 0.45 }));
            body.position.z = 0.006;
            const ridge = new Mesh(new BoxGeometry(size[0] * 0.9, 0.003, 0.002), new MeshStandardMaterial({ color: 0x000000, roughness: 0.8 }));
            ridge.position.z = 0.0125;
            root.add(body, ridge);
            this._parts[id] = root;
        };
        rockerMesh('masterAlt', L.master.x, L.master.w, 0xd8402a);
        rockerMesh('masterBat', L.master.x + L.master.w + 4, L.master.w, 0xd8402a);
        rockerMesh('avionics', L.avionics.x, L.avionics.w, 0xf0f0f0);

        // Disjoncteurs : bouton noir, collerette blanche visible quand il est sorti
        BREAKERS.forEach((b, i) => {
            const root = this._add(`breaker:${b.id}`, sub(L.breakers.x0 + i * L.breakers.step, L.breakers.y));
            const ring = zCylinder(0.0085, 0.006, collar);
            const button = zCylinder(0.0075, 0.008, breakerGrey);
            // Pastille claire sur le dessus (comme le chiffre des ampères sur un vrai disjoncteur)
            const cap = zCylinder(0.0042, 0.001, white, 14);
            cap.position.z = 0.0045;
            button.add(cap);
            root.add(ring, button);
            this._parts[`breaker:${b.id}`] = { ring, button };
        });

        // Interrupteurs à bascule : écrou chromé, levier et boule
        const toggle = (id, point) => {
            const root = this._add(`switch:${id}`, point);
            root.add(zCylinder(0.009, 0.004, chrome, 6).translateZ(0.002));
            const lever = new Group();
            const stem = zCylinder(0.0022, 0.022, chrome, 10);
            stem.position.z = 0.011;
            const tip = new Mesh(new SphereGeometry(0.0042, 12, 8), chrome);
            tip.position.z = 0.022;
            lever.add(stem, tip);
            lever.position.z = 0.004;
            root.add(lever);
            this._parts[`toggle:${id}`] = lever;
        };
        TOGGLES.forEach((t, i) => toggle(t.id, sub(L.toggles.x0 + i * L.toggles.step, L.toggles.y)));
        toggle('elt', sub(L.elt.x, L.elt.y));

        // Molettes : éclairage du tableau et OBS du VOR (repère blanc sur la face)
        const rotary = (id, point, r) => {
            const root = this._add(id, point);
            const body = zCylinder(r, 0.012, knobGrey, 24);
            body.position.z = 0.006;
            const mark = new Mesh(new BoxGeometry(0.002, r * 0.8, 0.001), white);
            mark.position.set(0, r * 0.45, 0.0125);
            const turn = new Group();
            turn.add(body, mark);
            root.add(turn);
            this._parts[id] = turn;
        };
        rotary('panelLights', sub(L.panelLights.x, L.panelLights.y), 0.015);
        rotary('obs', panelPoint(obs.x, obs.y), 0.014);

        // Boutons tirés (aération, prise statique de secours) et robinet carburant sur le pupitre
        const pull = (id, point, color, control = `switch:${id}`) => {
            const root = this._add(control, point);
            const shaft = zCylinder(0.004, 0.03, steel, 10);
            shaft.position.z = -0.01;
            const head = zCylinder(0.012, 0.012, new MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.4 }), 20);
            head.position.z = 0.006;
            const moving = new Group();
            moving.add(shaft, head);
            root.add(moving);
            this._parts[control] = moving;
        };
        for (const [id, p] of Object.entries(L.pulls)) pull(id, sub(p.x, p.y), p.color);
        pull('fuelShutoff', pedestalPoint(L.fuelShutoff.x, L.fuelShutoff.y), 0xc62d1f, 'fuelShutoff');

        // Levier des volets : poignée qui coulisse dans la fente
        const f = L.flaps;
        const flapRoot = this._add('flaps:lever', sub(f.x + 84, f.y + f.h / 2));
        const handle = new Group();
        handle.add(new Mesh(new BoxGeometry(0.004, 0.006, 0.02), steel).translateZ(0.01));
        handle.add(new Mesh(new BoxGeometry(0.036, 0.012, 0.014), white).translateZ(0.024));
        flapRoot.add(handle);
        this._parts.flapHandle = handle;
        this._flapSpan = (f.h * 3 / 4) / 1280;

        // Molette de trim : roue verticale crantée qui dépasse du pupitre
        const t = L.trimWheel;
        const trimRoot = this._add('trimWheel', pedestalPoint(t.x + t.w / 2, t.y + t.h / 2));
        const wheelGeometry = new CylinderGeometry(0.075, 0.075, 0.034, 40);
        wheelGeometry.rotateZ(Math.PI / 2);
        const ridges = ridgesTexture(24);
        ridges.repeat.set(3, 1);
        const wheel = new Mesh(wheelGeometry, [
            new MeshStandardMaterial({ map: ridges, roughness: 0.6 }),
            blackPlastic, blackPlastic,
        ]);
        wheel.position.z = -0.047;   // dépasse de ~3 cm de la face du pupitre
        trimRoot.add(wheel);
        this._parts.trimWheel = wheel;

        // Sélecteur de réservoir : poignée blanche effilée sur le plancher
        const selRoot = this._add('fuelSelector', floorPoint(128, 100 + L.fuelSelector.y));
        const selector = new Group();
        const pointer = new Mesh(new BoxGeometry(0.018, 0.016, 0.075), white);
        pointer.position.set(0, 0.008, -0.03);
        const tail = new Mesh(new BoxGeometry(0.03, 0.014, 0.03), white);
        tail.position.set(0, 0.007, 0.012);
        const hub = new Mesh(new CylinderGeometry(0.008, 0.008, 0.02, 12), blackPlastic);
        hub.position.y = 0.01;
        selector.add(pointer, tail, hub);
        selRoot.add(selector);
        this._parts.selector = selector;
        // Bague décorative autour du moyeu
        const ring = new Mesh(new TorusGeometry(0.02, 0.002, 6, 24), steel);
        ring.rotation.x = Math.PI / 2;
        selRoot.add(ring);
    }

    // Commande racine : groupe placé au point donné, ses pièces cliquables
    _add(control, point) {
        const root = new Group();
        root.position.copy(point);
        root.userData.control = control;
        this.group.add(root);
        this._roots ??= [];
        this._roots.push(root);
        return root;
    }

    // À appeler après la construction des pièces : toutes deviennent cliquables
    finalize() {
        for (const root of this._roots) {
            root.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = false;
                child.receiveShadow = true;
                this.clickables.push(child);
            });
        }
    }

    // Éclairage du tableau (rhéostat PANEL LT) : les commandes en relief en reçoivent un peu (sinon noires la nuit)
    setLighting(intensity, color) {
        for (const material of LIT_MATERIALS) {
            material.emissive.copy(color);
            material.emissiveIntensity = intensity;
        }
    }

    // state : { systems, flapLevel, trim (degrés), vorCourse (degrés) } ; k : lissage (0 -> 1) de cette image
    update(state, k) {
        const s = state.systems, P = this._parts;
        const ease = (object, property, target) => { object[property] += (target - object[property]) * k; };
        ease(P.magKey.rotation, 'z', -deg(LAYOUT.mags.angles[s.magnetos]));
        for (const id of ['masterAlt', 'masterBat', 'avionics']) ease(P[id].rotation, 'x', s.switches[id] ? -0.14 : 0.14);
        for (const b of BREAKERS) {
            const { ring, button } = P[`breaker:${b.id}`];
            const out = !s.breakers[b.id];
            ease(button.position, 'z', out ? 0.011 : 0.004);
            ease(ring.position, 'z', out ? 0.004 : -0.002);
        }
        for (const t of [...TOGGLES.map((x) => x.id), 'elt']) ease(P[`toggle:${t}`].rotation, 'x', s.switches[t] ? -0.55 : 0.55);
        ease(P.panelLights.rotation, 'z', -deg(-135 + 270 * s.panelLights));
        ease(P.obs.rotation, 'z', -deg(state.vorCourse * 3));
        for (const id of Object.keys(LAYOUT.pulls)) ease(P[`switch:${id}`].position, 'z', s.switches[id] ? 0.018 : 0);
        ease(P.fuelShutoff.position, 'z', s.fuelShutoff ? 0.022 : 0);
        ease(P.flapHandle.position, 'y', this._flapSpan / 2 - (state.flapLevel / 3) * this._flapSpan);
        // Molette de trim : tourne avec le trim (à piquer : le haut de la roue part vers l'avant)
        ease(P.trimWheel.rotation, 'x', deg(state.trim * 12));
        ease(P.selector.rotation, 'y', -deg([-90, 0, 90][s.fuelSelector]));
    }
}

export { Controls3D };
