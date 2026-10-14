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
import { BREAKERS, AVIONICS_BREAKERS, TOGGLES } from './Systems.js';

// Commandes de la cabine en 3D : clé des magnétos, rockers master / avionique / ELT, disjoncteurs, interrupteurs à
// bascule, rhéostat d'éclairage, boutons tirés (aération, chauffage, statique, robinet carburant), levier des volets
// et son index, molette de trim, poignée du sélecteur de réservoir. Positions du tableau : px du schéma de
// référence (voir Panel172.js) ; animées selon l'état (Systems.js) ; chaque pièce porte userData.control.

const deg = (d) => d * Math.PI / 180;
const MAG_ANGLES = [-70, -38, -8, 24, 58];

const chrome = new MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.85, roughness: 0.28 });
const steel = new MeshStandardMaterial({ color: 0x8c9095, metalness: 0.7, roughness: 0.4 });
const blackPlastic = new MeshStandardMaterial({ color: 0x141416, roughness: 0.55 });
const white = new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
const breakerBlack = new MeshStandardMaterial({ color: 0x1e1f22, metalness: 0.2, roughness: 0.45 });
const collar = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.15 });

// Cylindre dont l'axe est l'axe z (perpendiculaire au tableau, vers le pilote)
function zCylinder(r, length, material, segments = 20) {
    const geometry = new CylinderGeometry(r, r, length, segments);
    geometry.rotateX(Math.PI / 2);
    return new Mesh(geometry, material);
}

// Texture de crans pour une molette (bandes sombres / claires)
function ridgesTexture(count, light = '#8a8d92', dark = '#2a2b2e') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < count; i++) {
        const x = (i / count) * 256;
        const g = ctx.createLinearGradient(x, 0, x + 256 / count, 0);
        g.addColorStop(0, light);
        g.addColorStop(0.5, dark);
        g.addColorStop(1, light);
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 256 / count, 8);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    return texture;
}

// Chiffre des ampères sur la tête d'un disjoncteur
const ampMaterials = {};
function ampMaterial(amps) {
    if (ampMaterials[amps]) return ampMaterials[amps];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#f2f2f2';
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(amps), 32, 34);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return (ampMaterials[amps] = new MeshStandardMaterial({ map: texture, roughness: 0.45 }));
}

class Controls3D {
    // group : groupe de la cabine ; panelPoint(ax, ay) : point du tableau (px du schéma) ; px(n) : longueur en m ;
    // layout : positions (Panel172) ; pedestalPoint / floorPoint : px des canvas du pupitre et du plancher
    constructor(group, { panelPoint, px, layout, pedestalPoint, floorPoint, pedestalLayout }) {
        this.group = group;
        this.clickables = [];
        this._parts = {};
        const L = layout;
        const at = (p) => panelPoint(p.x, p.y);

        // Contact des magnétos : barillet de serrure chromé et vraie clé de contact qui tourne autour de son axe
        const mags = this._add('mags', at(L.mags));
        const bezel = new Mesh(new TorusGeometry(0.0145, 0.0035, 10, 32), chrome);
        bezel.position.z = 0.003;
        const face = zCylinder(0.0145, 0.004, blackPlastic, 32);
        face.position.z = 0.002;
        const barrel = zCylinder(0.0075, 0.003, chrome, 24);
        barrel.position.z = 0.0055;
        mags.add(bezel, face, barrel);
        const key = new Group();
        const blade = new Mesh(new BoxGeometry(0.0022, 0.006, 0.012), chrome);
        blade.position.z = 0.012;
        const shoulder = new Mesh(new BoxGeometry(0.003, 0.011, 0.004), chrome);
        shoulder.position.z = 0.019;
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
        bowGeometry.rotateY(-Math.PI / 2);
        const head = new Mesh(bowGeometry, blackPlastic);
        head.position.z = 0.021;
        const insert = new Mesh(new BoxGeometry(0.0052, 0.008, 0.008), chrome);
        insert.position.z = 0.031;
        key.add(blade, shoulder, head, insert);
        mags.add(key);
        this._parts.magKey = key;

        // Rockers : master ALT / BAT (rouges), avionique BUS 1 / BUS 2 (blancs), ELT (rouge) ; basculent en haut = ON.
        // Comme sur le vrai tableau : chaque moitié est une bascule à deux pans (haut plus sombre, bas plus clair, liseré
        // clair et lèvre sombre au pied), les deux moitiés côte à côte dans un cadre noir encastré
        const rocker = (id, x, y, w, h, colors) => {
            const root = this._add(`switch:${id}`, panelPoint(x, y));
            const width = px(w) * 0.97, height = px(h) * 0.94;
            const mat = (color, roughness = 0.45) => new MeshStandardMaterial({ color, roughness });
            const tilt = 0.16;   // pente des deux pans (rad)
            const upper = new Mesh(new BoxGeometry(width, height * 0.5, 0.006), mat(colors.upper));
            upper.position.set(0, height * 0.25, 0.007);
            upper.rotation.x = -tilt;
            // Pan du bas : tourné à l'opposé de la lumière du tableau, un peu auto-éclairé pour garder sa teinte claire
            const lower = new Mesh(new BoxGeometry(width, height * 0.5, 0.006), new MeshStandardMaterial({
                color: colors.lower, roughness: 0.38, emissive: colors.lower, emissiveIntensity: 0.28 }));
            lower.position.set(0, -height * 0.25, 0.007);
            lower.rotation.x = tilt;
            const stripe = new Mesh(new BoxGeometry(width * 0.96, height * 0.035, 0.0012), mat(colors.stripe, 0.3));
            stripe.position.set(0, -height * 0.36, 0.0097);
            stripe.rotation.x = tilt;
            const lip = new Mesh(new BoxGeometry(width, height * 0.07, 0.006), mat(colors.lip, 0.6));
            lip.position.set(0, -height * 0.47, 0.0066);
            lip.rotation.x = tilt;
            const core = new Mesh(new BoxGeometry(width * 0.98, height * 0.96, 0.008), mat(colors.lip, 0.7));   // corps sous les pans
            core.position.z = 0.004;
            root.add(core, upper, lower, stripe, lip);
            this._parts[id] = root;
        };
        // Cadre noir encastré autour d'une paire de bascules (centre, largeur et hauteur en px du schéma)
        const frame = (x, y, w, h) => {
            const group = new Group();
            group.position.copy(panelPoint(x, y));
            const black = new MeshStandardMaterial({ color: 0x101012, roughness: 0.5 });
            const border = px(5), W = px(w), H = px(h);
            for (const [bw, bh, bx, by] of [[W, border, 0, (H - border) / 2], [W, border, 0, -(H - border) / 2],
                [border, H, -(W - border) / 2, 0], [border, H, (W - border) / 2, 0]]) {
                const bar = new Mesh(new BoxGeometry(bw, bh, 0.01), black);
                bar.position.set(bx, by, 0.005);
                group.add(bar);
            }
            const well = new Mesh(new BoxGeometry(W, H, 0.002), new MeshStandardMaterial({ color: 0x060607, roughness: 0.9 }));
            well.position.z = 0.0005;
            group.add(well);
            this.group.add(group);
        };
        const RED = { upper: 0xb83a2c, lower: 0xd2734c, stripe: 0xf3c9a4, lip: 0x8c2219 };
        const WHITE = { upper: 0xd9dadc, lower: 0xf4f4f4, stripe: 0xffffff, lip: 0x8f9194 };
        frame(L.master.x, L.master.y, 60, 84);
        rocker('masterAlt', L.master.x - 12.5, L.master.y, 25, 74, RED);
        rocker('masterBat', L.master.x + 12.5, L.master.y, 25, 74, RED);
        frame(L.avionics.x, L.avionics.y, 52, 84);
        rocker('avionics', L.avionics.x - 10.5, L.avionics.y, 21, 74, WHITE);
        rocker('avionics2', L.avionics.x + 10.5, L.avionics.y, 21, 74, WHITE);
        rocker('elt', L.elt.x, L.elt.y, 16, 42, { upper: 0xb8241b, lower: 0xd8402a, stripe: 0xf3b0a0, lip: 0x7a1510 });

        // Disjoncteurs : bouton noir chiffré, collerette blanche visible quand il est sorti
        for (const b of [...L.breakers, ...L.avionicsBreakers]) {
            const root = this._add(`breaker:${b.id}`, at(b));
            const ring = zCylinder(0.0075, 0.006, collar);
            const button = zCylinder(0.0068, 0.008, breakerBlack);
            const cap = new Mesh(new CylinderGeometry(0.0062, 0.0062, 0.0006, 20), ampMaterial(b.amps));
            cap.rotation.x = Math.PI / 2;
            cap.rotation.y = Math.PI;
            cap.position.z = 0.0043;
            button.add(cap);
            root.add(ring, button);
            this._parts[`breaker:${b.id}`] = { ring, button };
        }

        // Interrupteurs à bascule : écrou chromé, levier et boule
        for (const t of L.toggles) {
            const root = this._add(`switch:${t.id}`, at(t));
            root.add(zCylinder(0.008, 0.004, chrome, 6).translateZ(0.002));
            const lever = new Group();
            const stem = zCylinder(0.002, 0.02, chrome, 10);
            stem.position.z = 0.01;
            const tip = new Mesh(new SphereGeometry(0.0038, 12, 8), chrome);
            tip.position.z = 0.02;
            lever.add(stem, tip);
            lever.position.z = 0.004;
            root.add(lever);
            this._parts[`toggle:${t.id}`] = lever;
        }

        // Rhéostat d'éclairage des instruments
        {
            const root = this._add('panelLights', at(L.panelLights));
            const turn = new Group();
            const body = zCylinder(0.011, 0.011, new MeshStandardMaterial({ map: ridgesTexture(24), roughness: 0.5 }), 24);
            body.position.z = 0.0055;
            const mark = new Mesh(new BoxGeometry(0.0016, 0.008, 0.001), white);
            mark.position.set(0, 0.005, 0.0112);
            turn.add(body, mark);
            root.add(turn);
            this._parts.panelLights = turn;
        }

        // Boutons tirés : prise statique de secours (rouge), aération et chauffage (gros boutons moletés)
        const pull = (control, point, r, material, ring = null) => {
            const root = this._add(control, point);
            if (ring) root.add(new Mesh(new TorusGeometry(r * 1.25, r * 0.2, 8, 24), ring).translateZ(0.002));
            const moving = new Group();
            const shaft = zCylinder(0.004, 0.03, steel, 10);
            shaft.position.z = -0.01;
            const head = zCylinder(r, 0.014, material, 28);
            head.position.z = 0.007;
            const cap = zCylinder(r * 0.82, 0.001, blackPlastic, 24);
            cap.position.z = 0.0145;
            moving.add(shaft, head, cap);
            root.add(moving);
            this._parts[control] = moving;
        };
        const knurl = new MeshStandardMaterial({ map: ridgesTexture(28, '#c9cbce', '#4a4c50'), metalness: 0.5, roughness: 0.35 });
        pull('switch:altStatic', at(L.altStatic), 0.0085, new MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.4 }), new MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.5 }));
        pull('switch:cabinAir1', at(L.cabinAir), 0.014, knurl, blackPlastic);
        pull('switch:cabinHeat', at(L.cabinHeat), 0.014, knurl, blackPlastic);
        pull('fuelShutoff', pedestalPoint(pedestalLayout.fuelShutoff.x, pedestalLayout.fuelShutoff.y), 0.012, new MeshStandardMaterial({ color: 0xc62d1f, metalness: 0.4, roughness: 0.4 }));

        // Levier des volets : palette blanche qui coulisse dans la fente ; index de la position réelle
        const f = L.flaps;
        const flapRoot = this._add('flaps:lever', panelPoint(f.slotX, f.top + 1.5 * f.step));
        const handle = new Group();
        handle.add(new Mesh(new BoxGeometry(0.004, 0.006, 0.02), steel).translateZ(0.01));
        const paddle = new Mesh(new BoxGeometry(0.03, 0.011, 0.012), white);
        paddle.position.set(0.008, 0, 0.024);
        handle.add(paddle);
        flapRoot.add(handle);
        this._parts.flapHandle = handle;
        this._flapSpan = px(f.step * 3);
        this._flapIndex = new Mesh(new BoxGeometry(0.006, 0.003, 0.002), new MeshStandardMaterial({ color: 0xff8a12, emissive: 0xff8a12, emissiveIntensity: 0.2 }));
        const index = this._add('flaps:index', panelPoint(f.scaleX - 20, f.top + 1.5 * f.step));
        index.add(this._flapIndex);
        // Échelle cliquable (un cran par zone)
        for (let i = 0; i < 4; i++) {
            const zone = this._add(`flaps:${i}`, panelPoint(f.scaleX + 14, f.top + i * f.step));
            const hit = new Mesh(new BoxGeometry(px(60), px(f.step), 0.002), new MeshStandardMaterial({ visible: false }));
            zone.add(hit);
        }

        // Molette de trim : roue verticale crantée qui dépasse du pupitre
        const t = pedestalLayout.trimWheel;
        const trimRoot = this._add('trimWheel', pedestalPoint(t.x + t.w / 2, t.y + t.h / 2));
        const wheelGeometry = new CylinderGeometry(0.075, 0.075, 0.034, 40);
        wheelGeometry.rotateZ(Math.PI / 2);
        const ridges = ridgesTexture(24);
        ridges.repeat.set(3, 1);
        const wheel = new Mesh(wheelGeometry, [new MeshStandardMaterial({ map: ridges, roughness: 0.6 }), blackPlastic, blackPlastic]);
        wheel.position.z = -0.047;
        trimRoot.add(wheel);
        this._parts.trimWheel = wheel;

        // Sélecteur de réservoir : poignée blanche effilée sur le plancher
        const selRoot = this._add('fuelSelector', floorPoint(128, 100 + pedestalLayout.fuelSelector.y));
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

    // À appeler après la construction des pièces : toutes deviennent cliquables (sauf l'index des volets)
    finalize() {
        for (const root of this._roots) {
            if (root.userData.control === 'flaps:index') continue;
            root.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = false;
                child.receiveShadow = true;
                this.clickables.push(child);
            });
        }
    }

    // state : { systems, flapLevel, flaps (position réelle 0 -> 1), trim (degrés) } ; k : lissage (0 -> 1)
    update(state, k) {
        const s = state.systems, P = this._parts;
        const ease = (object, property, target) => { object[property] += (target - object[property]) * k; };
        ease(P.magKey.rotation, 'z', -deg(MAG_ANGLES[s.magnetos]));
        for (const id of ['masterAlt', 'masterBat', 'avionics', 'avionics2', 'elt']) ease(P[id].rotation, 'x', s.switches[id] ? -0.14 : 0.14);
        for (const b of [...BREAKERS, ...AVIONICS_BREAKERS]) {
            const { ring, button } = P[`breaker:${b.id}`];
            const out = !s.breakers[b.id];
            ease(button.position, 'z', out ? 0.01 : 0.004);
            ease(ring.position, 'z', out ? 0.004 : -0.002);
        }
        for (const t of TOGGLES) ease(P[`toggle:${t.id}`].rotation, 'x', s.switches[t.id] ? -0.55 : 0.55);
        ease(P.panelLights.rotation, 'z', -deg(-135 + 270 * s.panelLights));
        for (const id of ['altStatic', 'cabinAir1', 'cabinHeat']) ease(P[`switch:${id}`].position, 'z', s.switches[id] ? 0.018 : 0);
        ease(P.fuelShutoff.position, 'z', s.fuelShutoff ? 0.022 : 0);
        ease(P.flapHandle.position, 'y', this._flapSpan / 2 - (state.flapLevel / 3) * this._flapSpan);
        this._flapIndex.position.y = this._flapSpan / 2 - state.flaps * this._flapSpan;
        // Molette de trim : tourne avec le trim (à piquer : le haut de la roue part vers l'avant)
        ease(P.trimWheel.rotation, 'x', deg(state.trim * 12));
        ease(P.selector.rotation, 'y', -deg([-90, 0, 90][s.fuelSelector]));
    }
}

export { Controls3D };
