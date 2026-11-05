import {
    AdditiveBlending,
    Box3,
    CanvasTexture,
    CylinderGeometry,
    DoubleSide,
    Group,
    Mesh,
    MeshBasicMaterial,
    Path,
    Shape,
    ShapeGeometry,
    Sprite,
    SpriteMaterial,
    TorusGeometry,
    Vector3
} from 'three';
import { PANEL_LAYOUT, panelPoint, panelLength } from './Panel172.js';
import { isTablet } from './Device.js';

// Mode Initiation : un moniteur accompagne l'élève de l'avion éteint au parking jusqu'à l'arrêt moteur après un tour de
// piste. À chaque étape, il dit quoi faire et pourquoi (voix + texte), la commande ou l'instrument concerné clignote et
// la caméra s'y tourne. L'étape suivante vient d'elle-même quand l'action est faite (ou l'explication finie).
// Niveau 1 : le moniteur tient la radio (l'élève pilote). Niveau 2 : l'élève fait la radio, le moniteur lui souffle
// quoi dire (le bouton du message clignote dans le panneau radio).

const KT = 1.94384;
const FT = 3.28084;
const ADVICE_COOLDOWN = 14;     // s entre deux conseils du même type
const GUIDE_REACHED = 14;       // m : balise de roulage atteinte
const GLANCE = 3.5;             // s : en vol, coup d'œil sur la commande à manœuvrer avant de revenir dehors
const READ_PAUSE = 1.2;         // s après la fin d'une explication avant l'étape suivante

const headingDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
const cap = (h) => String(Math.round(((h % 360) + 360) % 360) || 360).padStart(3, '0');
const DIGITS_FR = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
const DIGITS_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const capSpoken = (h) => [...cap(h)].map((d) => DIGITS_FR[d]).join(' ');
const capSpokenEn = (h) => [...cap(h)].map((d) => DIGITS_EN[d]).join(' ');

// --- Clignotement : anneau lumineux autour d'une commande ou d'un instrument (vu à travers tout) ------------------
function ringTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 40, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,220,60,0)');
    g.addColorStop(0.55, 'rgba(255,220,60,1)');
    g.addColorStop(0.75, 'rgba(255,240,150,0.9)');
    g.addColorStop(1, 'rgba(255,220,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new CanvasTexture(canvas);
    return texture;
}

class Highlighter {
    constructor(cockpit) {
        this.cockpit = cockpit;
        this.material = new SpriteMaterial({ map: ringTexture(), color: 0xffd23c, transparent: true, depthTest: false, depthWrite: false,
            blending: AdditiveBlending, toneMapped: false });
        this.sprites = [];
        this.targets = [];
    }

    // Repère de la cabine : centre et rayon (m) d'une cible 'inst:asi' ou d'une commande ('switch:masterBat'…)
    locate(target) {
        if (target.startsWith('inst:')) {
            const p = PANEL_LAYOUT.instruments[target.slice(5)];
            if (!p) return null;
            return { center: panelPoint(p[0], p[1], 0.01), radius: panelLength(target === 'inst:tach' ? 56 : 71) };
        }
        const group = this.cockpit.group;
        group.updateMatrixWorld(true);
        const roots = [];
        group.traverse((child) => {
            if (child.userData.control === target && child.parent?.userData.control !== target) roots.push(child);
        });
        if (!roots.length) return null;
        const box = new Box3();
        for (const root of roots) box.expandByObject(root);
        if (box.isEmpty()) return null;
        const center = group.worldToLocal(box.getCenter(new Vector3()));
        const scale = group.getWorldScale(new Vector3()).x;
        const size = box.getSize(new Vector3()).length() / scale;
        return { center, radius: Math.max(0.012, Math.min(0.09, size * 0.55)) };
    }

    set(targets) {
        for (const sprite of this.sprites) sprite.removeFromParent();
        this.sprites = [];
        this.targets = [];
        for (const target of targets) {
            const where = this.locate(target);
            if (!where) continue;
            const sprite = new Sprite(this.material);
            sprite.position.copy(where.center);
            sprite.userData.radius = where.radius;
            sprite.renderOrder = 999;
            this.cockpit.group.add(sprite);
            this.sprites.push(sprite);
            this.targets.push({ target, ...where });
        }
    }

    update(time) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 7);
        this.material.opacity = 0.35 + 0.65 * pulse;
        for (const sprite of this.sprites) sprite.scale.setScalar(sprite.userData.radius * (2.4 + 0.5 * pulse));
    }
}

// --- Balises de roulage : anneaux jaunes au sol, la prochaine pulse ------------------------------------------------
class GroundGuide {
    constructor(scene, groundHeight) {
        this.scene = scene;
        this.groundHeight = groundHeight;
        this.group = new Group();
        scene.add(this.group);
        this.material = new MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false });
        this.beamMaterial = new MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.18, toneMapped: false, depthWrite: false,
            side: DoubleSide, blending: AdditiveBlending });
        this.points = [];
    }

    set(points) {
        this.group.clear();
        this.points = points.map(([x, z]) => {
            const marker = new Group();
            marker.position.set(x, this.groundHeight(x, z) + 0.25, z);
            const ring = new Mesh(new TorusGeometry(4, 0.35, 8, 40), this.material);
            ring.rotation.x = Math.PI / 2;
            const beam = new Mesh(new CylinderGeometry(0.6, 0.6, 18, 12, 1, true), this.beamMaterial);
            beam.position.y = 9;
            marker.add(ring, beam);
            this.group.add(marker);
            return marker;
        });
    }

    clear() {
        this.set([]);
    }

    // Balise atteinte : elle disparaît, la suivante pulse
    update(position, time) {
        const next = this.points[0];
        if (!next) return;
        if (Math.hypot(position.x - next.position.x, position.z - next.position.z) < GUIDE_REACHED) {
            next.removeFromParent();
            this.points.shift();
            return;
        }
        this.points.forEach((marker, i) => {
            const s = i === 0 ? 1 + 0.15 * Math.sin(time * 5) : 0.6;
            marker.scale.setScalar(s);
            marker.visible = i < 3;
        });
    }

    get remaining() {
        return this.points.length;
    }
}

// --- Cadres du tour de piste : couloir en l'air à suivre, du décollage à la courte finale ------------------------------
// Sommets du circuit, par rapport au seuil de la piste du décollage : [le long de l'axe (m), vers le côté du tour de piste
// (m, à gauche ou à droite selon la piste, voir Airport.js), hauteur (ft)].
// Le premier (après l'envol) est posé devant l'avion aligné, voir FlightPath.set
const CIRCUIT = [
    [450, 0, 80],          // après l'envol
    [2100, 0, 600],        // virage vent traversier
    [2100, 1000, 1000],    // virage vent arrière
    [0, 1000, 1000],       // travers du seuil : on réduit
    [-1800, 1000, 750],    // virage en étape de base
    [-1800, 0, 450],       // dernier virage
    [-200, 0, 60],         // courte finale (pente ~4°, vers le point d'aboutissement)
];
const CIRCUIT_TURN = 400;      // m : rayon des virages (20° d'inclinaison à 75 kt)
const LIFTOFF_RUN = 400;       // m de l'avion aligné au premier cadre
const FRAME_SPACING = 160;     // m entre deux cadres
const FRAMES_AHEAD = 10;       // cadres bien marqués devant l'avion (les suivants, plus pâles, tracent tout le circuit)
// Début de chaque virage du circuit (là où le tracé commence à tourner), pour les consignes du moniteur
const TURN_AT = {
    crosswind: CIRCUIT[1][0] - CIRCUIT_TURN,   // le long de l'axe
    downwind: CIRCUIT[2][1] - CIRCUIT_TURN,    // à côté de l'axe
    base: CIRCUIT[4][0] + CIRCUIT_TURN,        // le long de l'axe
    final: CIRCUIT[5][1] + CIRCUIT_TURN,       // à côté de l'axe
};
const TURN_LEAD = 4;           // s : la consigne de virage est dite ce temps avant (le temps de l'entendre)

class FlightPath {
    constructor(scene, groundHeight) {
        this.groundHeight = groundHeight;
        this.group = new Group();
        scene.add(this.group);
        this.material = new MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.75, toneMapped: false, depthWrite: false, side: DoubleSide });
        this.farMaterial = new MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.3, toneMapped: false, depthWrite: false, side: DoubleSide });
        // Cadre de 60 × 36 m, montant de 1,2 m
        const shape = new Shape().moveTo(-30, -18).lineTo(30, -18).lineTo(30, 18).lineTo(-30, 18).closePath();
        shape.holes.push(new Path().moveTo(-28.8, -16.8).lineTo(-28.8, 16.8).lineTo(28.8, 16.8).lineTo(28.8, -16.8).closePath());
        this.geometry = new ShapeGeometry(shape);
        this.frames = [];
        this.next = 0;
    }

    get shown() {
        return this.frames.length > 0;
    }

    // Pose les cadres le long du circuit de la piste rw (coins arrondis) ; start : position de l'avion le long de l'axe
    // (aligné au milieu de la piste : le premier cadre est devant lui, pas derrière)
    set(rw, start = 0) {
        this.clear();
        const field = this.groundHeight(rw.threshold.x, rw.threshold.z);
        const point = ([along, lateral, ft]) => new Vector3(
            rw.threshold.x + rw.direction.x * along + rw.circuitSide.x * lateral,
            field + ft * 0.3048,
            rw.threshold.z + rw.direction.z * along + rw.circuitSide.z * lateral);
        const first = Math.min(TURN_AT.crosswind - FRAME_SPACING, Math.max(CIRCUIT[0][0], start + LIFTOFF_RUN));
        const corners = [[first, 0, CIRCUIT[0][2]], ...CIRCUIT.slice(1)].map(point);
        // Tracé fin : lignes droites, virages en arc (courbe de Bézier entre l'entrée et la sortie du virage)
        const path = [corners[0]];
        for (let i = 1; i < corners.length - 1; i++) {
            const c = corners[i];
            const a = c.clone().sub(corners[i - 1]), b = corners[i + 1].clone().sub(c);
            const r = Math.min(CIRCUIT_TURN, a.length() / 2, b.length() / 2);
            const enter = c.clone().addScaledVector(a.normalize(), -r), exit = c.clone().addScaledVector(b.normalize(), r);
            for (let k = 0; k <= 8; k++) {
                const t = k / 8;
                path.push(enter.clone().multiplyScalar((1 - t) ** 2).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(exit, t * t));
            }
        }
        path.push(corners[corners.length - 1]);
        // Cadres à intervalle régulier, chacun face à la trajectoire
        let carry = 0;
        for (let i = 0; i < path.length - 1; i++) {
            const from = path[i], seg = path[i + 1].clone().sub(from), length = seg.length();
            const dir = seg.clone().divideScalar(length);
            for (let d = carry; d < length; d += FRAME_SPACING) {
                const frame = new Mesh(this.geometry, this.material);
                frame.position.copy(from).addScaledVector(dir, d);
                frame.lookAt(frame.position.clone().add(dir));
                frame.userData.dir = dir;
                frame.visible = false;
                this.group.add(frame);
                this.frames.push(frame);
            }
            carry = (carry - length) % FRAME_SPACING;
            if (carry < 0) carry += FRAME_SPACING;
        }
        this.next = 0;
    }

    clear() {
        this.group.clear();
        this.frames = [];
        this.next = 0;
    }

    // Cadre franchi (dépassé, ou coupé dans un virage) : il disparaît. Tous les suivants restent affichés, jusqu'à la
    // finale : les plus proches bien marqués, les autres pâles
    update(position, time) {
        if (this.next >= this.frames.length) return;   // tous franchis (ou aucun)
        let best = this.next, bestDistance = Infinity;
        for (let i = this.next; i < Math.min(this.frames.length, this.next + 20); i++) {
            const d = this.frames[i].position.distanceTo(position);
            if (d < bestDistance) { bestDistance = d; best = i; }
        }
        const nearest = this.frames[best];
        const passed = _offset.copy(position).sub(nearest.position).dot(nearest.userData.dir) > 0;
        this.next = Math.min(this.frames.length, best + (passed ? 1 : 0));
        this.frames.forEach((frame, i) => {
            frame.visible = i >= this.next;
            frame.material = i < this.next + FRAMES_AHEAD ? this.material : this.farMaterial;
        });
        this.material.opacity = 0.6 + 0.15 * Math.sin(time * 4);
    }
}
const _offset = new Vector3();
const _up = new Vector3(0, 1, 0);

// --- Le moniteur -----------------------------------------------------------------------------------------------------
class Initiation {
    // deps : { systems, controls, avionics, atc, cockpit, airport, scene, aircraft, voices, ui, startCold, focusCabin,
    //          pilotView, isCabinView, openAtc, groundHeight, onChange }
    constructor(deps) {
        Object.assign(this, deps);
        this.active = false;
        this.level = 1;
        this.cameraGuide = true;
        this.highlighter = new Highlighter(this.cockpit);
        this.guide = new GroundGuide(this.scene, this.groundHeight);
        this.path = new FlightPath(this.scene, this.groundHeight);
        this._time = 0;
        this._htmlTargets = [];
        this._advice = new Map();
    }

    // --- Démarrage / arrêt ---------------------------------------------------------------------
    // lang : 'fr' ou 'en' (consignes, voix du moniteur et radio dans cette langue pendant la leçon)
    start(level, cameraGuide = true, lang = 'fr') {
        this.level = level === 2 ? 2 : 1;
        this.cameraGuide = cameraGuide;
        this.lang = lang === 'en' ? 'en' : 'fr';
        this.active = true;
        this._radioLang = this.atc.lang;
        this.setRadioLanguage?.(this.lang);
        this.voices.preloadInstructor?.(this.lang, this.level === 2);
        // Niveau 1 : c'est le moniteur qui parle à la radio, l'élève ne dit rien : ses messages sont affichés à son nom
        this.atc.pilotLabel = this.level === 1 ? this._t('INSTRUCTEUR', 'INSTRUCTOR') : null;
        this._labels();
        this.steps = buildSteps(this.level, this.lang);
        this.index = -1;
        this._runway = null;   // piste du décollage, fixée à l'alignement : tout le tour de piste s'y rapporte
        this._owed = [];       // messages radio d'étapes passées sans avoir été faits (voir _owe)
        this.startedAt = performance.now();
        this.stats = { advice: 0 };
        this.startCold();
        this.ui.panel.hidden = false;
        this._next();
        this.onChange?.();
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        this.voices.stopInstructor();
        this.voices.student = false;   // hors leçon : voix de pilote habituelle
        this.atc.pilotLabel = null;     // hors leçon : c'est le joueur qui parle (« VOUS »)
        // Radio rendue dans sa langue d'avant la leçon
        if (this._radioLang && this._radioLang !== this.atc.lang) this.setRadioLanguage?.(this._radioLang);
        this.highlighter.set([]);
        this.guide.clear();
        this.path.clear();
        this._setHtml([]);
        this.atc.standby = false;
        this.ui.panel.hidden = true;
        this.onChange?.();
    }

    _t(fr, en) {
        return this.lang === 'en' ? en : fr;
    }

    // Libellés des boutons du panneau dans la langue de la leçon
    _labels() {
        const b = this.ui.buttons ?? {};
        const set = (el, fr, en) => { if (el) el.textContent = this._t(fr, en); };
        set(b.next, 'Terminer ▸', 'Finish ▸');
        set(b.repeat, 'Répéter', 'Repeat');
        set(b.show, 'Montrer', 'Show');
        set(b.skipSpeech, 'Passer ▸▸', 'Skip ▸▸');
        set(b.quit, 'Quitter', 'Quit');
    }

    // --- Étapes ------------------------------------------------------------------------------------
    get step() {
        return this.steps?.[this.index] ?? null;
    }

    _next() {
        // Étape de roulage finie : ses anneaux restants disparaissent (sauf si la suivante en pose d'autres)
        const previous = this.step;
        if (previous) this._owe(previous, this._context());
        if (this._state?.glanceUntil && this.cameraGuide) this.pilotView();   // coup d'œil en cours : on revient dehors
        this.index++;
        if (previous?.guide && !this.step?.guide) this.guide.clear();
        const step = this.step;
        if (!step) return this.stop();
        this._state = { entered: this._time, spoken: false, speaking: false, sent: 0, flags: {} };
        this.highlighter.set([]);
        this._setHtml([]);
        if (step.guide) this.guide.set(step.guide(this._context()));
        if (step.clearGuide) this.guide.clear();
        this._render();   // le moniteur parle quand le moment de l'étape arrive (voir update)
    }

    // Étape quittée avant que son message radio soit fait (en vol, l'avion arrive déjà à l'étape suivante) : le message
    // reste dû. Niveau 1 : le moniteur le fait dès que possible ; niveau 2 : il clignote dans le panneau radio
    _owe(step, c) {
        if (!step?.radio?.ids.length || this._owed.some((o) => o.step === step)) return;
        let said = false;
        try { said = step.radio.until(c); } catch { /* situation incomplète : pas encore fait */ }
        if (!said) this._owed.push({ step, missing: 0 });
    }

    // Messages dus encore à faire : fait, ou plus proposé par la radio depuis 3 s (la phase est passée) -> oublié
    _updateOwed(c, delta) {
        const atc = this.atc;
        const usable = atc.radioOk && !atc.busy && !atc.pending && !atc.blockedBy;
        this._owed = this._owed.filter((o) => {
            try { if (o.step.radio.until(c)) return false; } catch { /* pas encore */ }
            if (usable) o.missing = atc.options.some((option) => o.step.radio.ids.includes(option.id)) ? 0 : o.missing + delta;
            return o.missing < 3;
        });
    }

    // Message radio à faire maintenant : celui de l'étape en cours, sinon le plus ancien message dû
    _dueRadio(step, c) {
        const atc = this.atc;
        const list = [];
        let current = false;
        try { current = Boolean(step.radio?.ids.length) && this._state.spoken && !step.radio.until(c); } catch { /* pas encore */ }
        if (current) list.push({ step, owed: false });
        for (const o of this._owed) list.push({ step: o.step, owed: true });
        for (const due of list) {
            const option = atc.options.find((o) => due.step.radio.ids.includes(o.id));
            if (option) return { ...due, option };
        }
        return null;
    }

    _enter() {
        const step = this.step;
        const c = this._context();
        this._state.spoken = true;
        this._state.spokenAt = this._time;
        step.enter?.(c, this);
        const targets = step.parts ? this._remainingParts(step, c) : typeof step.target === 'function' ? step.target(c) : step.target;
        const list = (Array.isArray(targets) ? targets : targets ? [targets] : []);
        this.highlighter.set(list.filter((t) => !t.startsWith('html:') && !t.startsWith('radio:')));
        this._htmlFromStep = list.filter((t) => t.startsWith('html:') || t.startsWith('radio:'));
        this._look(step);
        if (step.radio && this.level === 2) this.openAtc(true);
        this._say(typeof step.say === 'function' ? step.say(c, this) : step.say);
        this._render();
    }

    // Étape à plusieurs commandes : celles qui restent à manœuvrer, dans l'ordre
    _remainingParts(step, c) {
        const left = step.parts.filter(([, done]) => { try { return !done(c); } catch { return true; } }).map(([target]) => target);
        return left.length ? left : [step.parts[step.parts.length - 1][0]];
    }

    // La commande suivante devient la cible : elle clignote seule et la caméra s'y tourne
    _refreshParts(step, c) {
        const left = this._remainingParts(step, c);
        if (left[0] === this._state.partTarget) return;
        this._state.partTarget = left[0];
        if (!this._state.partsStarted) { this._state.partsStarted = true; return; }   // la première est posée par _enter
        this.highlighter.set(left.filter((t) => !t.startsWith('html:') && !t.startsWith('radio:')));
        this._look(step);
    }

    // Caméra : vers la commande à utiliser (vue cabine), ou place du pilote. En vol (camera 'none'), on garde les yeux
    // dehors, sauf un coup d'œil de quelques secondes sur la commande à manœuvrer (pas sur un instrument)
    _look(step) {
        if (!this.cameraGuide) return;
        const where = this._where();
        if (step.camera === 'pilot' || (!where && step.camera !== 'none')) this.pilotView();
        else if (where && step.camera !== 'none') this.focusCabin(where.center, where.radius);
        else if (step.camera === 'none' && step.flight) {
            const control = this.highlighter.targets.find((t) => !t.target.startsWith('inst:'));
            if (!control) return;
            this.focusCabin(control.center, control.radius);
            this._state.glanceUntil = this._time + GLANCE;
        }
    }

    _say(text) {
        if (!text) return;
        this.ui.text.textContent = text;
        this._state.speaking = true;
        const token = this._state;
        this.voices.speakInstructor(text).finally(() => {
            if (token === this._state) token.speaking = false;
        });
    }

    repeat() {
        const step = this.step;
        if (!step || !this._state.spoken) return;
        const c = this._context();
        this._say(typeof step.say === 'function' ? step.say(c, this) : step.say);
        const where = this._where();
        if (where && step.camera !== 'pilot') this.focusCabin(where.center, where.radius);
        if (step.camera === 'none') this._state.glanceUntil = this._time + GLANCE;
    }

    // Où regarder : la première commande, ou (frame) toutes les cibles dans la même vue (clé et compte-tours)
    _where() {
        const targets = this.highlighter.targets;
        if (!this.step?.frame || targets.length < 2) return targets[0];
        const center = new Vector3();
        for (const t of targets) center.add(t.center);
        center.divideScalar(targets.length);
        const radius = Math.max(...targets.map((t) => t.center.distanceTo(center) + t.radius));
        return { center, radius };
    }

    // Bouton « Passer » : le moniteur se tait et l'action de l'étape se fait toute seule (interrupteurs, frein, mixture,
    // mise en route, volets, trim, message radio, roulage : l'avion est posé au bout du chemin). En vol, le pilotage
    // (décollage, virages, atterrissage) reste à l'élève : l'étape passe simplement à la suivante
    skipSpeech() {
        const step = this.step;
        if (!step) return;
        if (!this._state.spoken) this._enter();   // étape pas encore commencée : elle commence et se fait aussitôt
        this.voices.stopInstructor();
        this._state.speaking = false;
        this._state.skipped = true;   // niveau 2 : la radio de l'étape se fait comme au niveau 1 (voir update)
        try { this._autoDo(step); } catch (error) { console.error(error); }
        if (step.flight) return this._next();
        // ATIS : coupé (ou, pas encore lancé, seulement écrit dans le journal radio) ; l'étape passe dès la fin
        if (step.atis) {
            this._state.afterDone = true;
            this.atc.skipAtis();
        }
        if (step.next) this._next();
    }

    // Action de l'étape faite à la place de l'élève : step.act, ou chaque commande à manœuvrer mise dans la bonne position
    _autoDo(step) {
        const c = this._context();
        if (step.act) return step.act(c, this);
        const single = typeof step.target === 'string' && step.done ? [[step.target, (cc) => step.done(cc, this._state.flags, 0)]] : [];
        for (const [target, ok] of step.parts ?? single) this._satisfy(target, ok, step);
        if (step.guide) this.teleport(step.guide(c));   // roulage : au bout des anneaux
    }

    // Commande mise dans une position qui satisfait ok(c) (essais successifs : allumé/éteint, crans de volets…)
    _satisfy(target, ok, step) {
        const sys = this.systems, ctl = this.controls;
        const check = () => { try { return ok(this._context()); } catch { return false; } };
        if (check()) return;
        const tries = {
            brake: [() => this.setBrake(true), () => this.setBrake(false)],
            'flaps:lever': [0, 1, 2, 3].map((n) => () => ctl.setFlapLevel(n)),
            mixture: [() => sys.setMixture(1), () => sys.setMixture(0)],
            throttle: [0.15, 0, 0.3, 0.6, 1].map((v) => () => { ctl.throttle = v; }),
            fuelShutoff: [() => { if (sys.fuelShutoff) sys.toggleFuelShutoff(); }],
            fuelSelector: [() => sys.turnFuelSelector(1 - sys.fuelSelector)],
            mags: [() => sys.turnMagnetos(-sys.magnetos)],
            'xpdr:mode': [() => { this.avionics.xpdr.mode = 'ALT'; }],
            trimWheel: step.flight ? [] : [() => { ctl.trim = ctl.model.aircraft.takeoffTrim; }],   // en vol : l'élève trime
        }[target] ?? (target.startsWith('switch:') ? [() => sys.toggle(target.slice(7))] : []);
        for (const attempt of tries) {
            attempt();
            if (check()) return;
        }
    }

    // Avion posé, arrêté, au bout d'un chemin de roulage (dernier point, dans l'axe du dernier tronçon), ou au cap donné
    teleport(points, heading = null) {
        const [x, z] = points[points.length - 1];
        const [px, pz] = points[points.length - 2] ?? [x, z + 1];
        const h = heading ?? Math.atan2(x - px, -(z - pz)) * 180 / Math.PI;
        this.aircraft.position.set(x, this.aircraft.position.y, z);
        this.aircraft.quaternion.setFromAxisAngle(_up, -h * Math.PI / 180);
        this.controls.placeOnGround();
        this.guide.clear();
    }

    setBrake(on) {
        this.controls.parkingBrake = this.systems.brake = on;
    }

    // Recentrer la caméra sur la commande à utiliser
    show() {
        const where = this._where();
        if (where) this.focusCabin(where.center, where.radius);
        else this.pilotView();
    }

    // Situation pour les conditions des étapes
    _context() {
        const s = this.atc.s;
        const c = {
            sys: this.systems, controls: this.controls, avionics: this.avionics, atc: this.atc, s, level: this.level,
            onGround: this.controls.isOnGround(), speedKt: this.controls.getIndicatedSpeed() * KT,
            groundKt: this.controls.getSpeed() * KT,   // au sol : vitesse de roulage, sans le vent de face (lu à l'anémomètre)
            agl: s?.agl ?? 0, heading: this.controls.getHeading(), flaps: this.controls.getFlapLevel(),
            throttle: this.controls.getThrottle(), rpm: this.systems.rpm, roll: this.controls.getRoll(),
            airborne: Boolean(s?.airborne), position: this.aircraft.position,
            atcOpen: !document.getElementById('atc').hidden,
        };
        c.lead = (c.speedKt / KT) * TURN_LEAD;   // m parcourus pendant la consigne de virage
        const rw = this._runway ?? s?.active;
        if (rw) {
            const p = this.aircraft.position;
            c.runway = rw;
            c.along = (p.x - rw.threshold.x) * rw.direction.x + (p.z - rw.threshold.z) * rw.direction.z;
            c.lateral = (p.x - rw.threshold.x) * rw.circuitSide.x + (p.z - rw.threshold.z) * rw.circuitSide.z;   // > 0 : côté du circuit
        }
        return c;
    }

    // --- À chaque image ----------------------------------------------------------------------------
    update(delta) {
        if (!this.active) return;
        this._time += delta;
        this.highlighter.update(this._time);
        this.guide.update(this.aircraft.position, this._time);
        const step = this.step;
        if (!step) return;
        // Au décollage : la piste où l'avion est aligné devient celle de la leçon (cadres, virages), même si la piste
        // en service change ensuite
        if (step.flight && !this._runway && this.atc.s) {
            const h = this.controls.getHeading();
            this._runway = this.atc.airport.runways.reduce((a, b) => (headingDiff(h, b.heading) < headingDiff(h, a.heading) ? b : a));
        }
        const c = this._context();
        this._updateOwed(c, delta);
        // En vol (décollage -> atterrissage) : les cadres de tout le tour de piste, devant l'avion aligné
        if (step.flight && !this.path.shown && c.runway) this.path.set(c.runway, c.along);
        else if (!step.flight && this.path.shown) this.path.clear();
        this.path.update(this.aircraft.position, this._time);
        // Conditions des étapes : une situation incomplète (avion crashé, hors de l'aérodrome…) vaut « pas encore »
        const safe = (fn) => { try { return fn(); } catch { return false; } };
        // En vol, la leçon ne s'arrête jamais : l'avion arrive au moment d'une étape suivante (virage, travers du
        // seuil…) -> on y passe directement, même si l'étape en cours attendait encore son moment ; une étape en attente
        // déjà accomplie (virage fait plus tôt) est sautée ; une étape dite passe après un délai (geste oublié)
        if (step.flight) {
            for (let k = 1; k <= 4; k++) {
                const later = this.steps[this.index + k];
                if (!later?.flight) break;
                if (later.hasWait && safe(() => later.wait(c))) {
                    for (let j = this.index; j < this.index + k; j++) this._owe(this.steps[j], c);
                    this.index += k - 1;
                    this._next();
                    return;
                }
            }
            if (!this._state.spoken && step.hasWait && step.done && safe(() => step.done(c, this._state.flags, delta))) {
                this._next();
                return;
            }
        }
        // Au sol, une seule voix à la fois : le moniteur attend la fin d'un échange radio pour parler, et la Tour attend
        // qu'il ait fini pour donner une autorisation (au niveau 1, il a la même voix que le pilote à la radio)
        this.atc.standby = Boolean(this._state.speaking) && !step.flight;
        if (!this._state.spoken) {
            const radioQuiet = !this.atc.busy && !(this.level === 1 && this.atc.pending);
            if (safe(() => step.wait(c)) && (step.urgent || radioQuiet)) this._enter();
            else return;
        }
        if (step.parts) this._refreshParts(step, c);
        if (this._state.glanceUntil && this._time > this._state.glanceUntil) {
            this._state.glanceUntil = null;
            if (this.cameraGuide) this.pilotView();
        }
        // Commande manœuvrée, la suite se passe dehors : la cible s'éteint, retour à la vue du pilote
        if (step.lookOutWhen && !this._state.lookedOut && safe(() => step.lookOutWhen(c))) {
            this._state.lookedOut = true;
            this.highlighter.set([]);
            if (this.cameraGuide) this.pilotView();
        }
        // Action à faire une fois la consigne dite (ATIS : il ne démarre pas pendant que le moniteur parle)
        if (step.afterSay && !this._state.afterDone && !this._state.speaking) {
            this._state.afterDone = true;
            step.afterSay(c, this);
        }
        if (this.level === 1 || this._state.skipped) this._autoRadio(step, c);
        else this._radioHints(step, c);
        this._adviseFlight(c);
        if ((this._htmlTick = (this._htmlTick ?? 0) + delta) > 0.25) {
            this._htmlTick = 0;
            this.refreshHtml();
        }
        // Étape faite (et le moniteur a fini sa phrase, sauf urgence en vol)
        const done = step.done ? safe(() => step.done(c, this._state.flags, delta)) : Boolean(step.radio);
        // Voix réaliste encore en téléchargement (premier lancement) : on n'attend pas qu'il ait parlé, juste le temps
        // de lire la consigne. Et quelle que soit la voix, jamais plus que le temps de dire la phrase (son bloqué par le
        // navigateur, calcul de la voix en retard : la leçon ne reste pas figée)
        const length = this.ui.text.textContent.length;
        const elapsed = this._time - (this._state.spokenAt ?? 0);
        const reading = (this.voices.status?.state === 'loading' && elapsed > 2 + length * 0.05) || elapsed > 4 + length * 0.08;
        const talked = !this._state.speaking || this._state.skipped || reading || (step.urgent && this._time - this._state.entered > 2.5);
        const radioDone = !step.radio || (safe(() => step.radio.until(c)) && !this.atc.busy && !this.atc.pending);
        // Explication sans action : l'étape suivante vient seule, une fois la consigne dite et le temps de la lire
        // (la dernière, le bilan, reste affichée : bouton Terminer)
        if (step.end) {
            this.ui.next.hidden = false;
            return;
        }
        if (step.next) {
            const read = Math.max(3, this.ui.text.textContent.length * 0.04 + (step.why ? step.why.length * 0.03 : 0));
            if (talked && this._time - this._state.spokenAt > read) {
                this._state.readUntil ??= this._time + READ_PAUSE;
                if (this._time > this._state.readUntil) this._next();
            }
            return;
        }
        if (done && radioDone && talked && this._time - this._state.entered > 0.6) {
            if (step.praise) this._praise();
            this._next();
            return;
        }
        if (step.flight && step.auto && talked && this._time - this._state.spokenAt > step.auto) this._next();
    }

    // Bouton « Terminer » (bilan de fin)
    continue() {
        const step = this.step;
        if (!(step?.next || step?.end) || !this._state.spoken) return;
        this._next();
    }

    _praise() {
        const words = this._t(['Très bien.', 'Parfait.', "C'est ça.", 'Bien.'], ['Very good.', 'Perfect.', "That's it.", 'Good.']);
        this.ui.praise.textContent = words[Math.floor(Math.random() * words.length)];
        this.ui.praise.classList.remove('visible');
        void this.ui.praise.offsetWidth;
        this.ui.praise.classList.add('visible');
    }

    // Niveau 1 : le moniteur fait la radio (appels, collationnements, changements de fréquence, transpondeur)
    _autoRadio(step, c) {
        const atc = this.atc;
        if (atc.busy || atc.blockedBy) return;
        if (atc.pending) {
            if (this._state.speaking && !step.flight) return;   // collationnement à la fin de sa phrase
            this._readbackDelay = (this._readbackDelay ?? 0) + 1;
            if (this._readbackDelay > 40) {   // ~0,7 s : le temps de réagir
                this._readbackDelay = 0;
                atc.choose('readback');
            }
            return;
        }
        this._readbackDelay = 0;
        if (atc.squawk && atc.transponder !== atc.squawk) atc.setTransponder(atc.squawk);
        if (atc.suggestion) {
            atc.setFrequency(atc.suggestion);
            return;
        }
        const due = this._dueRadio(step, c);
        // Message d'une étape passée : la radio d'abord, le moniteur s'interrompt pour le faire
        if (!due || (this._state.speaking && !due.owed)) return;
        if (due && this._time - (this._lastSend ?? -99) > 8) {
            if (this._state.speaking) this.voices.stopInstructor();
            this._lastSend = this._time;
            atc.choose(due.option.id);
        }
    }

    // Niveau 2 : l'élève fait la radio ; ce qu'il doit dire clignote dans le panneau, le moniteur le souffle
    _radioHints(step, c) {
        const atc = this.atc;
        const hints = [];
        let line = '';
        if (atc.pending && !atc.busy) {
            hints.push('html:.atc-collationner');
            line = this._t(`Collationnez : « ${atc.pending.message.text} »`, `Read back: "${atc.pending.message.text}"`);
            if (this._state.readbackHint !== atc.pending) {
                this._state.readbackHint = atc.pending;
                this.openAtc(true);
                this._say(this._t('Le contrôleur attend votre collationnement : répétez ses instructions. Cliquez sur « Collationner ».',
                    'The controller is waiting for your read-back: repeat his instructions. Click the flashing read-back box.'));
            }
        } else if (atc.suggestion && !atc.busy) {
            hints.push('html:.atc-frequence-conseil');
            line = this._t('Changez de fréquence : cliquez sur la case clignotante', 'Change frequency: click the flashing box');
            if (this._state.freqHint !== atc.suggestion) {
                this._state.freqHint = atc.suggestion;
                this.openAtc(true);
                this._say(this._t('Changez de fréquence : affichez celle du contrôleur qui vous gère maintenant, la case clignote dans le panneau radio.',
                    'Change frequency: select the controller who is now in charge of you, the box is flashing in the radio panel.'));
            }
        } else if (atc.squawk && atc.transponder !== atc.squawk && !atc.busy) {
            hints.push('html:#atc-xpdr');
            line = this._t(`Affichez ${atc.squawk} au transpondeur (case Transpondeur, puis Entrée)`, `Squawk ${atc.squawk} (Transponder box, then Enter)`);
            if (this._state.squawkHint !== atc.squawk) {
                this._state.squawkHint = atc.squawk;
                this.openAtc(true);
                this._say(this._t(`Le contrôleur vous a donné un code transpondeur : ${[...atc.squawk].join(' ')}. Tapez-le dans la case Transpondeur du panneau radio, puis Entrée. Il permet au radar de vous identifier.`,
                    `The controller gave you a transponder code: ${[...atc.squawk].join(' ')}. Type it in the Transponder box of the radio panel, then press Enter. It lets the radar identify you.`));
            }
        } else {
            const due = this._dueRadio(step, c);
            if (due) {
                hints.push(`radio:${due.option.id}`);
                line = this._t(`Dites : « ${due.option.message.text} »`, `Say: "${due.option.message.text}"`);
                // Message oublié d'une étape passée : le moniteur le rappelle, une fois
                if (due.owed && this._owedHint !== due.step) {
                    this._owedHint = due.step;
                    this.openAtc(true);
                    this._say(this._t(`N'oubliez pas le message radio « ${due.step.title} » : il clignote dans le panneau radio.`,
                        `Don't forget the "${due.step.title}" radio call: it is flashing in the radio panel.`));
                }
            } else if (step.radio && atc.busy) line = this._t('Écoutez la réponse…', 'Listen to the answer…');
        }
        this.ui.hint.textContent = line;
        this.ui.hint.hidden = !line;
        this._htmlFromHints = hints;
    }

    // Conseils en vol et au roulage (vitesse, inclinaison…), sans répéter trop souvent
    _adviseFlight(c) {
        const advise = (key, condition, text) => {
            if (!condition) return;
            const last = this._advice.get(key) ?? -1e9;
            if (this._time - last < ADVICE_COOLDOWN) return;
            this._advice.set(key, this._time);
            this.stats.advice++;
            this.ui.advice.textContent = text;
            this.ui.advice.classList.remove('visible');
            void this.ui.advice.offsetWidth;
            this.ui.advice.classList.add('visible');
            if (!this._state.speaking) this._say(text);
        };
        const t = (fr, en) => this._t(fr, en);
        advise('stall', c.airborne && this.controls.isNearStall(), t('Attention, vitesse trop faible ! Rendez la main : poussez un peu sur le manche, touche Z.',
            'Careful, speed too low! Ease off: push the yoke forward a little, Z key.'));
        advise('bank', c.airborne && Math.abs(c.roll) > 0.62, t("Trop incliné : revenez vers 20 à 30 degrés d'inclinaison.", 'Too much bank: come back to 20 to 30 degrees.'));
        advise('taxi', c.onGround && c.groundKt > 18 && c.s && c.s.zone !== 'runway', t('Vous roulez trop vite. Au roulage, pas plus de 10 nœuds : réduisez les gaz, freinez avec B.',
            'You are taxiing too fast. No more than 10 knots: reduce power, brake with B.'));
        advise('fast', c.airborne && c.speedKt > 125, t('Trop vite pour le tour de piste : réduisez les gaz.', 'Too fast for the circuit: reduce power.'));
        advise('low', c.airborne && c.agl < 300 && !c.s?.final && c.along !== undefined && c.along < 0, t('Vous êtes trop bas : remettez de la puissance et remontez vers 1000 pieds.',
            'You are too low: add power and climb back to 1000 feet.'));
    }

    // --- Éléments de la page qui clignotent (panneau radio) --------------------------------------------
    refreshHtml() {
        const list = [...(this._htmlFromStep ?? []), ...(this._htmlFromHints ?? [])];
        this._setHtml(list);
    }

    _setHtml(list) {
        for (const element of this._htmlTargets) element.classList.remove('tuto-cible');
        this._htmlTargets = [];
        if (!this.active) return;
        for (const target of list) {
            const selector = target.startsWith('radio:') ? `#atc-choix [data-option="${target.slice(6)}"]` : target.slice(5);
            for (const element of document.querySelectorAll(selector)) {
                element.classList.add('tuto-cible');
                this._htmlTargets.push(element);
            }
        }
    }

    _render() {
        const step = this.step;
        if (!step) return;
        this.ui.phase.textContent = step.phase;
        this.ui.title.textContent = step.title;
        this.ui.count.textContent = `${this.index + 1} / ${this.steps.length}`;
        this.ui.progress.style.width = `${(100 * this.index) / this.steps.length}%`;
        this.ui.why.textContent = step.why ?? '';
        this.ui.why.hidden = !step.why;
        this.ui.next.hidden = !step.end;
        if (!this._state.spoken) this.ui.text.textContent = step.waiting ?? this._t('Continuez…', 'Carry on…');
        this.ui.hint.hidden = true;
    }

    // Fin : bilan
    summary() {
        const minutes = Math.round((performance.now() - this.startedAt) / 60000);
        return this._t(`Vol terminé en ${minutes} minute${minutes > 1 ? 's' : ''}, ${this.stats.advice} conseil${this.stats.advice > 1 ? 's' : ''} du moniteur en cours de route.`,
            `Flight completed in ${minutes} minute${minutes > 1 ? 's' : ''}, with ${this.stats.advice} piece${this.stats.advice > 1 ? 's' : ''} of advice from your instructor along the way.`);
    }
}

// Anneaux de roulage du point d'attente à l'alignement : la voie de circulation rejoint la piste en son milieu ; on entre
// sur la piste, on la remonte jusqu'au seuil de la piste en service (à côté de l'axe), demi-tour, arrêt aligné sur l'axe
const LINEUP_PATH = [[500, 22], [470, 8], [370, 8], [270, 8], [170, 8], [80, 10], [40, 10], [22, 0], [40, -10], [70, 0]];
const LINEUP_AT = 70;   // m : point d'alignement, après le seuil
function lineUpGuide(c) {
    const rw = c.s ? c.atc.departureRunway : null;
    if (!rw) return [];
    // Côté de la piste où se trouve l'avion (celui de la voie de circulation)
    const side = (c.position.x - rw.threshold.x) * rw.left.x + (c.position.z - rw.threshold.z) * rw.left.z > 0 ? 1 : -1;
    return LINEUP_PATH.map(([along, lateral]) => [rw.threshold.x + rw.direction.x * along + rw.left.x * lateral * side,
        rw.threshold.z + rw.direction.z * along + rw.left.z * lateral * side]);
}
// Distance au seuil de la piste du départ, le long de l'axe (m)
const alongDeparture = (c) => {
    const rw = c.atc.departureRunway;
    return (c.position.x - rw.threshold.x) * rw.direction.x + (c.position.z - rw.threshold.z) * rw.direction.z;
};

// --- Le programme : de l'avion éteint au parking à l'arrêt moteur après un tour de piste ----------------------------
// Étape : { phase, title, say (texte ou fonction), why, target (commande(s), 'inst:…', 'html:…', 'radio:…'),
//   camera ('pilot' | 'none'), done (c, flags, delta), wait (c) : moment où le moniteur parle, next (explication sans
//   action : la suite vient une fois la consigne dite), end (bilan : bouton Terminer),
//   radio { ids, until } : message radio à faire passer (niveau 1 : par le moniteur), guide (balises de roulage),
//   urgent (en vol : on n'attend pas la fin de la phrase), praise, frame (toutes les cibles dans la même vue),
//   lookOutWhen (c) : commande faite, la caméra revient à la vue du pilote }
function buildSteps(level, lang = 'fr') {
    const L1 = level === 1;
    const EN = lang === 'en';
    const T = (fr, en) => (EN ? en : fr);
    const capSay = (h) => (EN ? capSpokenEn(h) : capSpoken(h));
    // Piste dite comme à la radio : « piste trois six » / « runway three six »
    // Côté du tour de piste de la piste de la leçon : virages, touche d'inclinaison, caps des branches
    const right = (c) => c.runway?.circuit === 'right';
    const hand = (c) => (right(c) ? T('droite', 'right') : T('gauche', 'left'));
    const bankKey = (c) => (right(c) ? 'D' : 'Q');
    const turned = (c, deg) => c.runway.heading + (right(c) ? deg : -deg);   // cap après un virage de deg° côté circuit
    const rwySay = (rw) => T(`piste ${[...rw.name].map((d) => DIGITS_FR[d]).join(' ')}`, `runway ${[...rw.name].map((d) => DIGITS_EN[d]).join(' ')}`);
    const steps = [];
    // Phases : clé (les étapes en vol avancent d'elles-mêmes) et nom affiché
    const PH = {
        intro: T('Présentation', 'Introduction'), prestart: T('Avant la mise en route', 'Before start'), start: T('Mise en route', 'Engine start'),
        taxi: T('Roulage', 'Taxi'), before: T('Avant le décollage', 'Before take-off'), takeoff: T('Décollage', 'Take-off'),
        circuit: T('Tour de piste', 'Traffic circuit'), landing: T('Atterrissage', 'Landing'), after: T("Après l'atterrissage", 'After landing'),
        shutdown: T('Arrêt', 'Shutdown'),
    };
    const FLIGHT = new Set(['takeoff', 'circuit', 'landing']);
    const add = (key, step) => steps.push({ phase: PH[key], flight: FLIGHT.has(key), praise: Boolean(step.done), ...step });
    const radio = (key, { title, ids, until, say1, say2, why, ...rest }) => add(key, {
        title, why, radio: { ids, until }, say: L1 ? say1 : say2, ...rest,
    });

    // --- Présentation -------------------------------------------------------------------------------
    let P = 'intro';
    add(P, { title: T('Bienvenue à bord', 'Welcome aboard'), next: true, camera: 'pilot',
        say: L1 ? T("Bonjour et bienvenue ! Je suis votre moniteur. Aujourd'hui, nous allons faire un tour de piste complet : mise en route, roulage, décollage, tour de piste, atterrissage et retour au parking. Je m'occupe de la radio, vous vous concentrez sur le pilotage.",
            "Hello and welcome! I'm your flight instructor. Today we'll fly a complete traffic circuit: engine start, taxi, take-off, circuit, landing and back to the parking. I'll handle the radio, you focus on flying.")
            : T("Bonjour et bienvenue ! Je suis votre moniteur. Aujourd'hui, nous allons faire un tour de piste complet, et cette fois c'est vous qui parlez aux contrôleurs. Je vous soufflerai quoi dire à chaque étape.",
                "Hello and welcome! I'm your flight instructor. Today we'll fly a complete traffic circuit, and this time you'll talk to the controllers yourself. I'll tell you what to say at each step."),
        why: T('Astuce : la caméra se tourne vers chaque commande à utiliser, et celle-ci clignote en jaune. Le bouton Montrer la retrouve, Répéter me fait redire la consigne.',
            'Tip: the camera turns towards each control you need, and it flashes yellow. Show finds it again, Repeat makes me say the instruction again.') });
    add(P, { title: T('Regarder autour de soi', 'Looking around'), next: true, camera: 'pilot',
        say: T('Pour regarder autour de vous, glissez avec la souris. La molette zoome. Les touches 1 à 9 donnent des vues rapprochées du tableau de bord, et C recentre la vue. On clique sur les boutons et interrupteurs pour les manœuvrer.',
            'To look around, drag with the mouse. The wheel zooms. Keys 1 to 9 give close-up views of the instrument panel, and C re-centres the view. You click on knobs and switches to operate them.') });
    add(P, { title: T('Les instruments de vol', 'The flight instruments'), next: true, target: ['inst:asi', 'inst:ai', 'inst:alt'],
        say: T("Voici les trois instruments les plus importants. À gauche, l'anémomètre : la vitesse par rapport à l'air, en nœuds. Au centre, l'horizon artificiel : l'attitude de l'avion, nez haut ou bas, ailes inclinées. À droite, l'altimètre : l'altitude, en pieds.",
            'Here are the three most important instruments. On the left, the airspeed indicator: our speed through the air, in knots. In the middle, the attitude indicator: nose up or down, wings banked. On the right, the altimeter: our altitude, in feet.'),
        why: T('Vitesse, assiette, altitude : ce trio se surveille en permanence.', 'Speed, attitude, altitude: keep an eye on these three all the time.') });
    add(P, { title: T('Les autres instruments', 'The other instruments'), next: true, target: ['inst:tc', 'inst:dg', 'inst:vsi'],
        say: T("En dessous : l'indicateur de virage avec sa bille, qui doit rester au centre ; le conservateur de cap, qui donne la direction ; et le variomètre, qui dit si l'on monte ou si l'on descend.",
            'Below them: the turn coordinator with its ball, which should stay centred; the heading indicator, which gives our direction; and the vertical speed indicator, which tells us if we are climbing or descending.') });

    // --- Avant la mise en route ---------------------------------------------------------------------------
    P = 'prestart';
    add(P, { title: T('Frein de parking', 'Parking brake'), target: 'brake', done: (c) => c.controls.parkingBrake,
        say: T("Première vérification : le frein de parking doit être serré, sinon l'avion avancera dès la mise en route. Il clignote sous le tableau : s'il est desserré, cliquez dessus.",
            'First check: the parking brake must be set, otherwise the aeroplane will move as soon as the engine starts. It is flashing under the panel: if it is released, click on it.'),
        why: T('Un avion qui démarre frein desserré peut rouler tout seul vers un obstacle.', 'An aeroplane started with the brake off can roll into an obstacle on its own.') });
    add(P, { title: T('Batterie : master BAT', 'Battery: master BAT'), target: 'switch:masterBat', done: (c) => c.sys.switches.masterBat,
        say: T("On met l'avion sous tension. Cliquez sur la moitié droite de l'interrupteur rouge MASTER, marquée BAT.",
            "Let's power up the aeroplane. Click the right half of the red MASTER switch, marked BAT."),
        why: T('La batterie alimente le démarreur, la radio et les instruments électriques.', 'The battery powers the starter, the radio and the electric instruments.') });
    add(P, { title: T('Feu anticollision', 'Beacon'), target: 'switch:beacon', done: (c) => c.sys.switches.beacon,
        say: T("Allumez le feu anticollision : l'interrupteur BCN, dans la rangée du bas.", 'Switch on the anti-collision beacon: the BCN switch, in the bottom row.'),
        why: T('Ce feu rouge tournant prévient les personnes autour que le moteur va démarrer.', 'This rotating red light warns people around that the engine is about to start.') });
    add(P, { title: T('Avionique', 'Avionics'), target: 'switch:avionics', done: (c) => c.sys.switches.avionics,
        say: T("Allumez l'avionique : la moitié gauche de l'interrupteur blanc AVIONICS, marquée BUS 1. Elle alimente la radio et le transpondeur.",
            'Switch on the avionics: the left half of the white AVIONICS switch, marked BUS 1. It powers the radio and the transponder.') });
    // iPad : pas de barre de menus, la fenêtre radio s'ouvre par le bouton RADIO (panneaux de la tablette)
    const tablet = isTablet();
    add(P, { title: T('Afficher la radio', 'Show the radio'), target: tablet ? 'html:.tb-principal[data-principal="radio"], [data-tuile="fenetre-radio"]' : 'html:#atc-bouton', camera: 'none', done: (c) => c.atcOpen, act: (c, t) => t.openAtc(true),
        say: tablet
            ? T("Affichez le panneau radio : touchez RADIO en haut à droite, encadré en jaune, puis TOUR et FENÊTRE RADIO. Les messages échangés avec le contrôleur s'y affichent.",
                'Show the radio panel: tap RADIO at the top right, framed in yellow, then TOUR and FENÊTRE RADIO. The messages exchanged with the controller appear there.')
            : T("Affichez le panneau radio : dans la barre de menus en haut, cliquez sur Tour, encadré en jaune. Les messages échangés avec le contrôleur s'y affichent. Si la barre est cachée, la touche Échap la fait réapparaître.",
                'Show the radio panel: in the menu bar at the top, click Tour, framed in yellow. The messages exchanged with the controller appear there. If the bar is hidden, the Escape key brings it back.'),
        why: T('Le panneau radio garde la trace écrite de chaque message : utile si on a mal entendu.', 'The radio panel keeps a written record of every message: useful if you missed something.') });
    if (L1) {
        add(P, { title: T("Écouter l'ATIS", 'Listen to the ATIS'), camera: 'pilot', afterSay: (c) => c.atc.playAtis(), praise: false, atis: true,
            done: (c) => c.atc.log.some((l) => l.from === 'atis') && !c.atc.busy,
            say: T("Avant d'appeler, on écoute l'ATIS : le bulletin météo enregistré de l'aérodrome. Il donne la piste en service, le vent et le calage altimétrique. Écoutez bien.",
                'Before calling, we listen to the ATIS: the recorded weather broadcast of the airfield. It gives the runway in use, the wind and the altimeter setting. Listen carefully.') });
    } else {
        add(P, { title: T("Écouter l'ATIS", 'Listen to the ATIS'), target: 'html:#atc-atis', enter: (c, t) => t.openAtc(true), atis: true,
            done: (c) => c.atc.log.some((l) => l.from === 'atis') && !c.atc.busy,
            say: T("Avant d'appeler, on écoute l'ATIS : le bulletin météo enregistré. Dans le panneau radio, cliquez sur Écouter l'ATIS. Retenez sa lettre : vous la donnerez au contrôleur.",
                'Before calling, we listen to the ATIS: the recorded weather broadcast. In the radio panel, click the ATIS button. Remember its letter: you will give it to the controller.') });
    }
    radio(P, { title: T('Demander la mise en route', 'Request start-up'), ids: ['startupFirst', 'startup'], until: (c) => c.atc.state !== 'idle',
        why: T("On ne démarre pas sans l'accord du contrôleur au sol.", "We don't start the engine without the ground controller's approval."),
        say1: T("J'appelle le contrôleur Sol pour demander la mise en route. Écoutez l'échange : indicatif, position, information ATIS reçue, puis la demande.",
            "I'm calling Ground to request start-up. Listen to the call: call sign, position, ATIS information received, then the request."),
        say2: T('Appelez le contrôleur Sol pour demander la mise en route. Le message est déjà rédigé : cliquez sur la case qui clignote dans le panneau radio.',
            'Call Ground to request start-up. The message is ready: click the flashing box in the radio panel.') });

    // --- Mise en route ------------------------------------------------------------------------------
    P = 'start';
    add(P, { title: T("Robinet d'essence", 'Fuel shut-off valve'), target: 'fuelShutoff', done: (c) => !c.sys.fuelShutoff,
        say: T("Vérifiez le robinet d'essence : le bouton rouge au pied du tableau doit être enfoncé. S'il est tiré, cliquez dessus.",
            'Check the fuel shut-off valve: the red knob at the bottom of the panel must be pushed in. If it is pulled out, click on it.') });
    add(P, { title: T('Sélecteur de réservoirs', 'Fuel selector'), target: 'fuelSelector', done: (c) => c.sys.fuelSelector === 1,
        say: T("Le sélecteur de réservoirs, au plancher, doit être sur BOTH : on prend l'essence des deux ailes.", 'The fuel selector, on the floor, must be on BOTH: we take fuel from both wings.') });
    add(P, { title: T('Mixture plein riche', 'Mixture rich'), target: 'mixture', done: (c) => c.sys.mixture >= 0.95,
        say: T('Poussez la mixture à fond : la manette rouge. Cliquez sur sa moitié haute, ou appuyez plusieurs fois sur U.', 'Push the mixture fully in: the red knob. Click its upper half, or press U several times.'),
        why: T('Mixture : le dosage air-essence. Plein riche pour démarrer et au sol.', 'The mixture sets the fuel-air ratio. Full rich for starting and on the ground.') });
    add(P, { title: T('Pompe électrique', 'Fuel pump'), target: 'switch:fuelPump', done: (c) => c.sys.switches.fuelPump,
        say: T("Allumez la pompe électrique, FUEL PUMP : elle envoie de l'essence dans les cylindres. Elle reste allumée jusqu'à 900 pieds en montée.",
            'Switch on the electric FUEL PUMP: it sends fuel into the cylinders. It stays on until 900 feet in the climb.'),
        why: T("Un moteur amorcé démarre du premier coup. Ensuite, la pompe électrique double la pompe du moteur pendant le roulage, le décollage et la montée initiale : si celle-ci lâchait près du sol, le moteur resterait alimenté.",
            'A primed engine starts first time. Then the electric pump backs up the engine-driven pump during taxi, take-off and the initial climb: if that one failed close to the ground, the engine would still get fuel.') });
    add(P, { title: T('Gaz : un centimètre', 'Throttle: open slightly'), target: 'throttle', done: (c) => c.throttle >= 0.05 && c.throttle <= 0.35,
        say: T('Ouvrez un peu les gaz : un clic sur le haut de la manette noire, ou la barre Espace un court instant.', 'Open the throttle slightly: one click on the top of the black knob, or a short press on the space bar.'),
        why: T("Un filet de gaz aide le moteur à partir, sans qu'il s'emballe.", 'A little throttle helps the engine start without racing.') });
    add(P, { title: T('Démarrage : clé sur START', 'Start: key to START'), target: 'mags', done: (c) => c.sys.running,
        act: (c) => { if (!c.sys.running) c.sys.turnMagnetos(4 - c.sys.magnetos); },
        say: T("Regardez dehors que personne n'est près de l'hélice, puis tournez la clé jusqu'à START : cliquez sur sa droite plusieurs fois, ou utilisez la molette. Si le moteur ne part pas, recommencez.",
            "Look outside to make sure nobody is near the propeller, then turn the key to START: click its right side several times, or use the mouse wheel. If the engine doesn't start, try again."),
        why: T('La clé passe par OFF, R, L, BOTH puis START, qui lance le démarreur.', 'The key goes through OFF, R, L, BOTH and then START, which cranks the starter.') });
    add(P, { title: T('Volets 10°', 'Flaps 10°'), target: 'flaps:lever', done: (c) => c.flaps === 1,
        say: T('Le moteur tourne ! Sortez le premier cran de volets, 10 degrés : touche G, ou cliquez sur le bas du levier des volets. Ils restent sortis pour le décollage.',
            'The engine is running! Set the first stage of flap, 10 degrees: G key, or click the bottom of the flap lever. They stay down for take-off.'),
        why: T("Au décollage, les volets donnent plus de portance : l'avion quitte le sol plus tôt et à plus faible vitesse.",
            'For take-off, the flaps give more lift: the aeroplane leaves the ground sooner and at a lower speed.') });
    add(P, { title: T('Alternateur', 'Alternator'), target: 'switch:masterAlt', done: (c) => c.sys.switches.masterAlt,
        say: T("Branchez l'alternateur : la moitié gauche de l'interrupteur MASTER, marquée ALT. C'est lui qui recharge la batterie.",
            'Switch on the alternator: the left half of the MASTER switch, marked ALT. It charges the battery.') });
    add(P, { title: T('Feux de navigation', 'Navigation lights'), target: 'switch:nav', done: (c) => c.sys.switches.nav,
        say: T("Allumez les feux de navigation, NAV : rouge à gauche, vert à droite, blanc à l'arrière.", 'Switch on the NAV lights: red on the left, green on the right, white at the tail.') });
    add(P, { title: T('Transpondeur', 'Transponder'), target: 'xpdr:mode', done: (c) => c.avionics.xpdr.mode === 'ALT',
        say: T('Passez le transpondeur sur ALT : cliquez sur la droite de son sélecteur, deux fois.', 'Set the transponder to ALT: click the right side of its selector twice.'),
        why: T('Le transpondeur répond au radar en donnant notre code et notre altitude.', 'The transponder answers the radar with our code and our altitude.') });

    // --- Roulage --------------------------------------------------------------------------------------
    P = 'taxi';
    radio(P, { title: T('Demander le roulage', 'Request taxi'), ids: ['taxiFirst', 'taxi'], until: (c) => ['taxi', 'holding', 'lineup', 'takeoff'].includes(c.atc.state),
        why: T("Le contrôleur indique le chemin jusqu'au point d'attente de la piste en service.", 'The controller gives the route to the holding point of the runway in use.'),
        say1: T("J'annonce au Sol que nous sommes prêts à rouler. Écoutez bien le chemin qu'il nous donne.", "I'm telling Ground we are ready to taxi. Listen carefully to the route he gives us."),
        say2: T("Annoncez au Sol que vous êtes prêt à rouler. Écoutez bien sa réponse, puis collationnez-la : on répète toujours une instruction pour montrer qu'on l'a comprise.",
            'Tell Ground you are ready to taxi. Listen carefully to the answer, then read it back: we always repeat an instruction to show we understood it.') });
    add(P, { title: T('Phare de roulage', 'Taxi light'), target: 'switch:taxi', done: (c) => c.sys.switches.taxi,
        say: T('Allumez le phare de roulage, TAXI.', 'Switch on the TAXI light.') });
    add(P, { title: T('Desserrer le frein', 'Release the brake'), target: 'brake', done: (c) => !c.controls.parkingBrake,
        say: T('Desserrez le frein de parking en cliquant dessus.', 'Release the parking brake by clicking on it.') });
    add(P, { title: T("Rouler jusqu'au point d'attente", 'Taxi to the holding point'), camera: 'pilot',
        guide: () => [[312, -20], [312, 0], [272, 0]],   // dernier anneau juste avant la ligne d'attente (x = 265)
        act: (c, t) => t.teleport([[312, 0], [272, 0]]),
        done: (c) => c.s?.nearHolding && c.groundKt < 4,
        say: T("Suivez les anneaux jaunes jusqu'au point d'attente. Gaz avec Espace et Ctrl, direction avec A et E, freins avec B. Au roulage, on ne dépasse pas la vitesse d'un homme qui court : environ 10 nœuds. Arrêtez-vous au dernier anneau, avant la piste.",
            'Follow the yellow rings to the holding point. Throttle with Space and Ctrl, steering with A and E, brakes with B. When taxiing, no faster than a running man: about 10 knots. Stop at the last ring, before the runway.'),
        why: T("Le point d'attente est la limite à ne pas franchir sans l'autorisation de la Tour.", 'The holding point is the line you must not cross without clearance from the Tower.') });

    // --- Avant le décollage ------------------------------------------------------------------------------
    P = 'before';
    add(P, { title: T('Frein de parking', 'Parking brake'), target: 'brake', done: (c) => c.controls.parkingBrake, clearGuide: true,
        say: T('Serrez le frein de parking pour les essais moteur.', 'Set the parking brake for the engine run-up.') });
    add(P, { title: T('Essai moteur : 1700 tours', 'Run-up: 1700 RPM'), target: ['throttle', 'inst:tach'], done: (c) => c.rpm > 1600,
        act: (c, t) => { t.setBrake(true); c.controls.throttle = 0.55; },
        say: T("Mettez les gaz jusqu'à environ 1700 tours par minute, lus au compte-tours qui clignote.", 'Open the throttle to about 1700 RPM, read on the flashing tachometer.') });
    // Chutes de régime mesurées pendant l'essai (redites par le moniteur à l'étape suivante)
    const mag = { base: 0, l: 0, r: 0 };
    add(P, { title: T('Essai des magnétos', 'Magneto check'), target: ['inst:tach', 'mags'], frame: true,
        act: (c, t) => {   // chutes habituelles d'un moteur en bon état
            Object.assign(mag, { base: c.rpm, l: 80, r: 110 });
            Object.assign(t._state.flags, { l: true, r: true });
            c.sys.turnMagnetos(3 - c.sys.magnetos);
        },
        done: (c, f) => {
            const m = c.sys.magnetos;
            if (m === 3 && !f.r && !f.l) { mag.base = c.rpm; mag.l = mag.r = 0; }
            if (m === 1) { f.r = true; mag.r = Math.max(mag.r, mag.base - c.rpm); }
            if (m === 2) { f.l = true; mag.l = Math.max(mag.l, mag.base - c.rpm); }
            return f.r && f.l && m === 3;
        },
        say: T("Essai des magnétos. Gardez l'œil sur le compte-tours. Tournez la clé d'un cran vers la gauche, sur L, d'un clic à gauche de la clé : le régime doit baisser, de 150 tours par minute au plus. Attendez qu'il se stabilise, puis un cran de plus, sur R : même chose, et pas plus de 50 tours d'écart avec L. Revenez enfin sur BOTH : le régime remonte. Clic à droite de la clé pour revenir.",
            'Magneto check. Keep your eye on the tachometer. Turn the key one notch left, to L, by clicking its left side: the RPM should drop, by 150 RPM at most. Let it settle, then one more notch, to R: same again, and no more than 50 RPM difference from L. Finally go back to BOTH: the RPM comes back up. Click the right side of the key to turn it back.'),
        why: T("Chaque cylindre a deux bougies, chacune allumée par sa propre magnéto. Sur une seule magnéto, une seule étincelle par cylindre : le mélange brûle moins vite, le moteur perd un peu de puissance, d'où une petite chute. Chute trop forte ou moteur qui tousse : bougie encrassée ou magnéto défaillante, on ne part pas. Aucune chute du tout : la magnéto ne se coupe plus, elle pourrait démarrer le moteur toute seule si on tourne l'hélice à la main.",
            "Each cylinder has two spark plugs, each fired by its own magneto. On a single magneto there is only one spark per cylinder: the mixture burns more slowly, the engine loses a little power, hence a small drop. Too big a drop or a rough engine: fouled plug or faulty magneto, we don't go. No drop at all: the magneto no longer switches off, and it could start the engine by itself if someone turns the propeller by hand.") });
    add(P, { title: T('Gaz réduits', 'Throttle idle'), target: 'throttle', done: (c) => c.throttle < 0.12,
        say: () => {
            const l = Math.round(mag.l / 10) * 10, r = Math.round(mag.r / 10) * 10, gap = Math.abs(l - r);
            return T(`Chute de ${l} tours sur L, ${r} sur R, ${gap} d'écart : moins de 150 et moins de 50, les deux magnétos sont bonnes. Réduisez les gaz : touche Ctrl ou bas de la manette.`,
                `A drop of ${l} RPM on L, ${r} on R, ${gap} apart: under 150 and under 50, both magnetos are good. Throttle back to idle: Ctrl key or the bottom of the knob.`);
        } });
    add(P, { title: T('Trim au repère décollage', 'Trim to take-off'), target: 'trimWheel',
        done: (c) => Math.abs(c.controls.getTrim() - c.controls.getTakeoffTrim()) < 1.5,
        say: T('Vérifiez le trim : la petite roue sur le pupitre, entre les sièges. Son index doit être sur le repère TAKE OFF. Touches W et X pour le régler, ou la molette sur la roue.',
            'Check the trim: the small wheel on the pedestal, between the seats. Its pointer must be on the TAKE OFF mark. W and X keys to adjust it, or the mouse wheel on the trim wheel.'),
        why: T("Le trim règle la vitesse que l'avion garde manche lâché. Au repère décollage, il monte tout seul vers la bonne vitesse après l'envol.",
            'The trim sets the speed the aeroplane holds hands-off. On the take-off mark, it climbs at the right speed on its own after lift-off.') });
    add(P, { title: T('Phare et strobes', 'Landing light and strobes'), parts: [['switch:land', (c) => c.sys.switches.land], ['switch:strobe', (c) => c.sys.switches.strobe], ['switch:fuelPump', (c) => c.sys.switches.fuelPump]],
        done: (c) => c.sys.switches.land && c.sys.switches.strobe && c.sys.switches.fuelPump,
        say: T("Allumez le phare d'atterrissage, LAND, et les feux à éclats, STROBE : on doit nous voir de loin. La pompe électrique, FUEL PUMP, est toujours allumée.",
            'Switch on the LAND light and the STROBE lights: we must be seen from far away. The electric FUEL PUMP is still on.') });
    radio(P, { title: T("Demande d'alignement", 'Request line up'), ids: ['lineupHold', 'lineupFirst'], until: (c) => ['holding', 'lineup', 'takeoff'].includes(c.atc.state),
        why: T("Au point d'attente, on appelle la Tour, qui gère la piste : on lui demande l'alignement. Le départ, on l'annoncera une fois aligné.",
            'At the holding point, we call the Tower, which controls the runway: we request line up. We will report ready for departure once lined up.'),
        say1: T("J'appelle la Tour pour demander l'alignement. Écoutons sa réponse.", "I'm calling the Tower to request line up. Let's listen to the answer."),
        say2: T("Appelez la Tour pour demander l'alignement, puis collationnez sa réponse.", 'Call the Tower to request line up, then read back the answer.') });
    add(P, { title: T("Autorisés à s'aligner", 'Cleared to line up'), camera: 'pilot', praise: false,
        wait: (c) => c.atc.state !== 'holding', waiting: T("La Tour nous fait attendre au point d'attente : du trafic utilise la piste. Restez arrêté.",
            'The Tower is holding us short: there is traffic using the runway. Stay where you are.'),
        done: (c) => ['lineup', 'takeoff'].includes(c.atc.state) && !c.atc.pending && !c.atc.busy,
        say: T("La Tour nous autorise à remonter la piste et à nous aligner : on entre sur la piste, on va jusqu'au seuil, mais on ne décolle pas encore.",
            'The Tower clears us to backtrack and line up: we enter the runway and go to the threshold, but we do not take off yet.') });
    add(P, { title: T('Frein desserré, alignement', 'Line up'), target: 'brake', lookOutWhen: (c) => !c.controls.parkingBrake, guide: lineUpGuide,
        act: (c, t) => { t.setBrake(false); t.teleport(lineUpGuide(c), c.atc.departureRunway.heading); },
        done: (c) => !c.controls.parkingBrake && c.s?.zone === 'runway' && headingDiff(c.heading, c.atc.departureRunway.heading) < 15 && c.groundKt < 5
            && alongDeparture(c) < LINEUP_AT + 80,
        say: (c) => T(`Desserrez le frein, puis suivez les anneaux jaunes : entrez sur la piste et remontez-la, doucement, jusqu'au seuil de la ${rwySay(c.atc.departureRunway)}. Là, demi-tour, et alignez-vous sur l'axe, face au cap ${capSay(c.atc.departureRunway.heading)}. Arrêtez-vous au dernier anneau : freins avec B.`,
            `Release the brake, then follow the yellow rings: enter the runway and backtrack, slowly, to the threshold of ${rwySay(c.atc.departureRunway)}. There, turn around and line up on the centre line, heading ${capSay(c.atc.departureRunway.heading)}. Stop at the last ring: brakes with B.`),
        why: T("La voie de circulation arrive au milieu de la piste : on remonte jusqu'au seuil pour avoir toute la longueur de piste devant soi au décollage. S'aligner bien droit évite de partir de travers en prenant de la vitesse.",
            'The taxiway joins the middle of the runway: we backtrack to the threshold to have the whole runway length ahead for take-off. Lining up straight keeps us from veering off as we pick up speed.') });
    radio(P, { title: T('Prêt au départ', 'Ready for departure'), ids: ['readyRunway', 'readyFirst'], camera: 'pilot',
        until: (c) => c.atc.state === 'takeoff', done: (c) => c.atc.state === 'takeoff' && !c.atc.pending,
        why: T("Aligné, on annonce prêt au départ. La Tour n'autorise le décollage que si la piste est libre et que personne n'est en finale ; elle donne le vent et le compte rendu à faire : vent arrière, main gauche ou main droite selon la piste.",
            'Once lined up, we report ready for departure. The Tower only clears us if the runway is clear and nobody is on final; it gives the wind and the report to make: downwind, left- or right-hand depending on the runway.'),
        say1: T("Nous sommes alignés. Gardez les freins, touche B. J'annonce à la Tour que nous sommes prêts au départ, et je collationnerai l'autorisation.",
            "We are lined up. Hold the brakes, B key. I'm telling the Tower we are ready for departure, and I'll read back the clearance."),
        say2: T("Nous sommes alignés. Gardez les freins, touche B. Annoncez à la Tour que vous êtes prêt au départ, puis collationnez l'autorisation de décollage.",
            'We are lined up. Hold the brakes, B key. Tell the Tower you are ready for departure, then read back the take-off clearance.') });

    // --- Décollage et tour de piste -----------------------------------------------------------------------
    P = 'takeoff';
    add(P, { title: T('Plein gaz', 'Full power'), camera: 'pilot', urgent: true, target: 'inst:asi',
        done: (c) => c.airborne,
        say: T("Plein gaz : maintenez la barre Espace. Gardez l'axe avec A et E. À 55 nœuds sur l'anémomètre, tirez doucement sur le manche, touche S, pour décoller.",
            'Full power: hold the space bar. Keep the centre line with A and E. At 55 knots on the airspeed indicator, gently pull back on the yoke, S key, to take off.') });
    add(P, { title: T('Montée', 'Climb'), camera: 'none', urgent: true, target: 'inst:asi',
        done: (c) => c.agl > 300,
        say: T("Vous volez ! Gardez 75 nœuds en montée : nez plus haut si l'on va trop vite, plus bas si l'on ralentit. Passez dans les cadres jaunes : ils dessinent tout le tour de piste.",
            "You're flying! Hold 75 knots in the climb: nose up if we're too fast, nose down if we slow down. Fly through the yellow frames: they trace the whole circuit.") });
    P = 'circuit';
    add(P, { title: T('Trim de montée', 'Climb trim'), target: 'trimWheel', camera: 'none', urgent: true, auto: 14,
        done: (c, f, dt) => (f.t = (f.t ?? 0) + (Math.abs(c.controls.getInputs().pitch) < 0.05 ? dt : 0)) > 4,
        say: T("Soulagez le manche avec le trim : touches W pour piquer, X pour cabrer, jusqu'à ce que l'avion tienne ses 75 nœuds tout seul, sans que vous teniez le manche.",
            'Take the pressure off the yoke with the trim: W for nose down, X for nose up, until the aeroplane holds 75 knots on its own, hands off.'),
        why: T("Le trim annule l'effort sur le manche : l'avion garde sa vitesse tout seul, vous pilotez plus finement et sans fatigue.",
            'The trim removes the force on the yoke: the aeroplane keeps its speed by itself, so you fly more precisely and without tiring.') });
    add(P, { title: T('Virage vent traversier', 'Crosswind turn'), camera: 'none', urgent: true, target: 'inst:dg', auto: 35,
        wait: (c) => c.along > TURN_AT.crosswind - c.lead && c.agl > 300, waiting: T("Continuez la montée droit devant, dans les cadres, vers 600 pieds.", 'Keep climbing straight ahead, through the frames, to 600 feet.'),
        done: (c) => headingDiff(c.heading, turned(c, 90)) < 20,
        say: (c) => T(`Virage à ${hand(c)} maintenant, en suivant les cadres : cap ${capSay(turned(c, 90))}, avec 20 degrés d'inclinaison. Touche ${bankKey(c)} pour incliner, et un peu de S pour tenir le nez. Continuez de monter vers 1000 pieds.`,
            `Turn ${hand(c)} now, following the frames: heading ${capSay(turned(c, 90))}, with 20 degrees of bank. ${bankKey(c)} key to bank, and a little S to hold the nose up. Keep climbing to 1000 feet.`) });
    add(P, { title: T('900 pieds : volets, phare, pompe', '900 feet: flaps, light, pump'), camera: 'none', urgent: true, auto: 25,
        parts: [['flaps:lever', (c) => c.flaps === 0], ['switch:land', (c) => !c.sys.switches.land], ['switch:fuelPump', (c) => !c.sys.switches.fuelPump]],
        wait: (c) => c.agl > 880 && c.lateral > 100, waiting: T('Continuez la montée à 75 nœuds.', 'Keep climbing at 75 knots.'),
        done: (c) => c.flaps === 0 && !c.sys.switches.land && !c.sys.switches.fuelPump,
        say: T("900 pieds : rentrez les volets, touche T. Puis éteignez le phare d'atterrissage, LAND, et la pompe électrique, FUEL PUMP.",
            '900 feet: retract the flaps, T key. Then switch off the LAND light and the electric FUEL PUMP.'),
        why: T("Loin du sol, la pompe de secours et le phare ne servent plus ; volets rentrés, l'avion traîne moins et monte mieux.",
            'Away from the ground, the backup pump and the landing light are no longer needed; with the flaps up, the aeroplane has less drag and climbs better.') });
    add(P, { title: T('Virage vent arrière', 'Downwind turn'), camera: 'none', urgent: true, target: 'inst:dg', auto: 40,
        wait: (c) => c.lateral > TURN_AT.downwind - c.lead && c.along > 200, waiting: T('Continuez en vent traversier, montée vers 1000 pieds.', 'Continue on crosswind, climbing to 1000 feet.'),
        done: (c) => c.s?.downwind || headingDiff(c.heading, c.runway.heading + 180) < 20,
        say: (c) => T(`Virage à ${hand(c)} maintenant : cap ${capSay(c.runway.heading + 180)}, la branche vent arrière. La piste doit défiler à ${hand(c)}, parallèle.`,
            `Turn ${hand(c)} now: heading ${capSay(c.runway.heading + 180)}, the downwind leg. The runway should slide by on our ${hand(c)}, parallel.`) });
    radio(P, { title: T('Report vent arrière', 'Downwind report'), ids: ['downwind'], until: (c) => ['downwind', 'continue', 'landing', 'touchgo'].includes(c.atc.state), camera: 'none', auto: 25,
        say1: T("J'annonce notre position à la Tour : vent arrière.", "I'm reporting our position to the Tower: downwind."),
        say2: T('Annoncez votre position à la Tour : vent arrière. Le message clignote dans le panneau radio.', 'Report your position to the Tower: downwind. The message is flashing in the radio panel.') });
    add(P, { title: T("Palier : assiette d'attente", 'Level off: holding attitude'), camera: 'none', target: ['inst:alt', 'throttle'], urgent: true, auto: 20,
        done: (c) => c.agl > 800 && c.rpm < 2250,
        say: T("À 1000 pieds, passez en palier, en assiette d'attente : réduisez la puissance vers 2100 tours et gardez le nez juste au-dessus de l'horizon. La vitesse se stabilise vers 85 nœuds, le variomètre revient à zéro.",
            'At 1000 feet, level off in the holding attitude: reduce power to about 2100 RPM and keep the nose just above the horizon. The speed settles around 85 knots, the vertical speed back to zero.'),
        why: T("L'assiette d'attente : un palier à vitesse réduite, qui laisse le temps de préparer l'atterrissage sans arriver trop vite. Le tour de piste se fait à 1000 pieds au-dessus du terrain.",
            'The holding attitude: level flight at reduced speed, which leaves time to prepare the landing without arriving too fast. The circuit is flown 1000 feet above the airfield.') });
    add(P, { title: T('Trim en palier', 'Level trim'), target: 'trimWheel', camera: 'none', urgent: true, auto: 15,
        done: (c, f, dt) => (f.t = (f.t ?? 0) + (Math.abs(c.controls.getInputs().pitch) < 0.05 && Math.abs(c.s?.agl - 1000) < 250 ? dt : 0)) > 4,
        say: T("Retrimez pour le palier : W ou X jusqu'à ce que l'avion reste à 1000 pieds manche lâché. Le variomètre doit rester sur zéro.",
            'Re-trim for level flight: W or X until the aeroplane stays at 1000 feet hands off. The vertical speed should stay at zero.') });
    add(P, { title: T('Vent arrière : phare, pompe, volets', 'Downwind: light, pump, flaps'), camera: 'none', auto: 30,
        parts: [['switch:land', (c) => c.sys.switches.land], ['switch:fuelPump', (c) => c.sys.switches.fuelPump], ['mixture', (c) => c.sys.mixture >= 0.95], ['flaps:lever', (c) => c.flaps >= 1]],
        done: (c) => c.sys.switches.land && c.sys.switches.fuelPump && c.sys.mixture >= 0.95 && c.flaps >= 1,
        say: T("Vérifications vent arrière : allumez le phare d'atterrissage et la pompe électrique, mixture plein riche, puis sortez un cran de volets, 10 degrés : touche G.",
            'Downwind checks: switch on the landing light and the fuel pump, mixture full rich, then set one stage of flap, 10 degrees: G key.'),
        why: T("On prépare l'atterrissage : phare pour être vu, pompe de secours près du sol, premier cran de volets pour ralentir avant l'approche.",
            'We prepare for landing: light to be seen, backup pump close to the ground, first stage of flap to slow down before the approach.') });
    add(P, { title: T('Travers du seuil : réduire', 'Abeam the threshold: reduce'), camera: 'none', urgent: true, target: 'throttle', auto: 20,
        wait: (c) => c.along < 50 && c.lateral > 250, waiting: T('Continuez en vent arrière, à 1000 pieds.', 'Continue downwind at 1000 feet.'),
        done: (c) => c.throttle < 0.4,
        say: T('Nous passons le bout de la piste : réduisez les gaz vers 1500 tours pour commencer la descente. Laissez la vitesse descendre vers 70 nœuds, puis trimez pour la garder : touche X.',
            'We are passing the end of the runway: reduce power to about 1500 RPM to start the descent. Let the speed come back to 70 knots, then trim to hold it: X key.') });
    add(P, { title: T('Virage en étape de base', 'Base turn'), camera: 'none', urgent: true, target: 'inst:dg', auto: 35,
        wait: (c) => c.along < TURN_AT.base + c.lead && c.lateral > 250, waiting: T('Continuez en descente douce, 70 nœuds.', 'Continue a gentle descent at 70 knots.'),
        done: (c) => headingDiff(c.heading, turned(c, -90)) < 25,
        say: (c) => T(`Virage à ${hand(c)} maintenant, en étape de base : cap ${capSay(turned(c, -90))}, en suivant les cadres.`,
            `Turn ${hand(c)} now onto base leg: heading ${capSay(turned(c, -90))}, following the frames.`) });
    add(P, { title: T('Volets 20°', 'Flaps 20°'), target: 'flaps:lever', camera: 'none', urgent: true, auto: 15, done: (c) => c.flaps >= 2,
        say: T('Sortez un deuxième cran de volets, 20 degrés : touche G.', 'Set a second stage of flap, 20 degrees: G key.'),
        why: T("Plus de volets : l'avion vole plus lentement et descend plus fort, sans prendre de vitesse.", 'More flap: the aeroplane flies slower and descends more steeply without picking up speed.') });
    add(P, { title: T('Dernier virage', 'Final turn'), camera: 'none', urgent: true, auto: 40,
        wait: (c) => c.lateral < TURN_AT.final + c.lead && c.along < -1000, waiting: T('Étape de base : descente vers 500 pieds, 70 nœuds, dans les cadres.', 'Base leg: descend to 500 feet, 70 knots, through the frames.'),
        done: (c) => Boolean(c.s?.final),
        say: (c) => T(`Dernier virage à ${hand(c)} maintenant : cap ${capSay(c.runway.heading)}, alignez-vous sur l'axe de la piste.`,
            `Final turn to the ${hand(c)} now: heading ${capSay(c.runway.heading)}, line up with the runway centre line.`) });
    add(P, { title: T('Volets pleins', 'Full flaps'), target: 'flaps:lever', camera: 'none', urgent: true, auto: 12, done: (c) => c.flaps >= 3,
        say: T('Volets pleins, 30 degrés : touche G. Puis retrimez pour 65 nœuds, touche X.', 'Full flaps, 30 degrees: G key. Then re-trim for 65 knots, X key.') });
    radio(P, { title: T('Report finale', 'Final report'), ids: ['finalFull'], until: (c) => ['landing', 'continue'].includes(c.atc.state), camera: 'none', auto: 25,
        say1: T("J'annonce que nous sommes en finale pour un atterrissage complet.", "I'm reporting final for a full stop landing."),
        say2: T("Annoncez la finale pour un atterrissage complet, puis collationnez l'autorisation d'atterrir.", 'Report final for a full stop, then read back the landing clearance.') });
    add(P, { title: T('Finale', 'Final approach'), camera: 'none', urgent: true, target: 'inst:asi',
        done: (c) => c.agl < 60,
        say: T('Gardez 65 nœuds. Visez le début de la piste : il doit rester fixe dans le pare-brise. Les gaz règlent la pente.',
            'Hold 65 knots. Aim at the start of the runway: it should stay fixed in the windscreen. Power controls the glide path.'),
        why: T('Les lampes du PAPI, à gauche de la piste : deux blanches et deux rouges, vous êtes sur la bonne pente.', 'The PAPI lights, left of the runway: two white and two red means you are on the glide path.') });
    P = 'landing';
    add(P, { title: T('Arrondi', 'Flare'), camera: 'none', urgent: true, done: (c) => c.onGround,
        say: T("Gaz tout réduits, touche Ctrl. Tout près du sol, tirez progressivement pour garder l'avion en l'air le plus longtemps possible : il se pose tout seul.",
            'Throttle to idle, Ctrl key. Just above the ground, gradually pull back to keep the aeroplane flying as long as possible: it will settle on its own.') });
    add(P, { title: T('Freinage', 'Braking'), camera: 'none', urgent: true, done: (c) => c.onGround && c.groundKt < 12,
        say: T("Posé ! Gardez l'axe avec A et E, et freinez avec B.", 'Touchdown! Keep the centre line with A and E, and brake with B.') });

    // --- Après l'atterrissage -------------------------------------------------------------------------------
    P = 'after';
    add(P, { title: T('Dégager la piste', 'Vacate the runway'), camera: 'none',
        guide: () => [[250, 0], [275, 0]],
        act: (c, t) => t.teleport([[250, 0], [275, 0]]),
        done: (c) => c.s && c.s.zone !== 'runway' && c.s.zone !== 'entry',
        say: (c) => {
            const left = c.runway && (275 - c.runway.threshold.x) * c.runway.left.x + (0 - c.runway.threshold.z) * c.runway.left.z > 0;
            return T(`Dégagez la piste par la voie de circulation au milieu, à ${left ? 'gauche' : 'droite'} : roulez doucement jusqu'au deuxième anneau jaune, après le point d'attente.`,
                `Vacate the runway via the taxiway in the middle, on the ${left ? 'left' : 'right'}: taxi slowly to the second yellow ring, past the holding point.`);
        } });
    radio(P, { title: T('Piste dégagée', 'Runway vacated'), ids: ['vacated'], until: (c) => ['toGround', 'taxiIn'].includes(c.atc.state) || c.atc.freq === 'ground',
        say1: T("J'annonce à la Tour que la piste est dégagée. Elle va nous renvoyer vers le Sol.", "I'm telling the Tower we have vacated the runway. It will send us to Ground."),
        say2: T('Annoncez à la Tour que la piste est dégagée, puis passez sur la fréquence du Sol.', 'Report runway vacated to the Tower, then change to the Ground frequency.') });
    add(P, { title: T('Volets, phares', 'Flaps and lights'), parts: [['flaps:lever', (c) => c.flaps === 0], ['switch:land', (c) => !c.sys.switches.land], ['switch:strobe', (c) => !c.sys.switches.strobe]],
        done: (c) => c.flaps === 0 && !c.sys.switches.land && !c.sys.switches.strobe,
        say: T("Rentrez les volets, touche T, et éteignez le phare d'atterrissage et les strobes.", 'Retract the flaps, T key, and switch off the landing light and the strobes.') });
    radio(P, { title: T('Retour au parking', 'Taxi to parking'), ids: ['groundIn'], until: (c) => c.atc.state === 'taxiIn',
        say1: T('Je demande au Sol le roulage vers le parking.', "I'm asking Ground for taxi to the parking."),
        say2: T('Appelez le Sol pour rouler vers le parking.', 'Call Ground for taxi to the parking.') });
    add(P, { title: T("Rouler jusqu'au parking", 'Taxi to the stand'), camera: 'pilot',
        guide: (c) => {
            const stand = c.atc.aerodrome.stands.find((st) => st.name === c.atc.assignedStand) ?? { x: 336, z: -20 };
            const points = [[285, 0], [312, 0], [312, stand.z], [334, stand.z]];
            return c.position.x > 290 ? points.slice(1) : points;   // déjà sur la voie du parking : pas de retour en arrière
        },
        done: (c) => c.s?.stand === c.atc.assignedStand && c.groundKt < 2,
        say: (c) => T(`Suivez les anneaux jusqu'à la place ${c.atc.assignedStand}, et arrêtez-vous dessus.`, `Follow the rings to stand ${c.atc.assignedStand} and stop on it.`) });

    // --- Arrêt -------------------------------------------------------------------------------------------
    P = 'shutdown';
    add(P, { title: T('Frein de parking', 'Parking brake'), target: 'brake', clearGuide: true, done: (c) => c.controls.parkingBrake,
        say: T('Serrez le frein de parking.', 'Set the parking brake.') });
    radio(P, { title: T('Fin de vol à la radio', 'End of flight call'), ids: ['parked'], until: (c) => !c.atc.contact,
        say1: T("J'annonce au Sol que nous sommes au parking et que nous quittons la fréquence.", "I'm telling Ground we are parked and leaving the frequency."),
        say2: T('Annoncez au Sol que vous êtes au parking et quittez la fréquence.', 'Tell Ground you are parked and leave the frequency.') });
    add(P, { title: T('Phare et pompe', 'Taxi light and pump'), parts: [['switch:taxi', (c) => !c.sys.switches.taxi], ['switch:fuelPump', (c) => !c.sys.switches.fuelPump]], done: (c) => !c.sys.switches.taxi && !c.sys.switches.fuelPump,
        say: T('Éteignez le phare de roulage et la pompe électrique.', 'Switch off the taxi light and the fuel pump.') });
    add(P, { title: T('Avionique coupée', 'Avionics off'), parts: [['switch:avionics', (c) => !c.sys.switches.avionics], ['switch:avionics2', (c) => !c.sys.switches.avionics2]], done: (c) => !c.sys.switches.avionics && !c.sys.switches.avionics2,
        say: T("Coupez l'avionique, les deux moitiés de l'interrupteur AVIONICS.", 'Switch off the avionics, both halves of the AVIONICS switch.'),
        why: T("On l'éteint avant le moteur : les variations de tension pourraient abîmer la radio.", 'We switch it off before the engine: voltage spikes could damage the radio.') });
    add(P, { title: T('Arrêt du moteur : mixture', 'Engine stop: mixture'), target: 'mixture', done: (c) => !c.sys.running,
        say: T("On arrête le moteur en tirant la mixture à fond, sur l'étouffoir : touche Y maintenue, ou bas de la manette rouge.",
            'We stop the engine by pulling the mixture fully out, to idle cut-off: hold the Y key, or click the bottom of the red knob.'),
        why: T("Couper l'essence plutôt que l'allumage vide les cylindres : pas de retour de flamme.", 'Cutting the fuel rather than the ignition empties the cylinders: no backfire.') });
    add(P, { title: T('Magnétos sur OFF', 'Magnetos OFF'), target: 'mags', done: (c) => c.sys.magnetos === 0,
        say: T('Tournez la clé sur OFF : clic à gauche de la clé.', 'Turn the key to OFF: click the left side of the key.') });
    add(P, { title: T('Master coupé', 'Master off'), parts: [['switch:beacon', (c) => !c.sys.switches.beacon], ['switch:nav', (c) => !c.sys.switches.nav], ['switch:masterAlt', (c) => !c.sys.switches.masterAlt], ['switch:masterBat', (c) => !c.sys.switches.masterBat]],
        done: (c) => !c.sys.switches.masterBat && !c.sys.switches.masterAlt,
        say: T("Éteignez les feux, puis coupez le MASTER, BAT et ALT. L'avion est arrêté.", 'Switch off the lights, then the MASTER, BAT and ALT. The aeroplane is shut down.') });
    add(P, { title: T('Bravo !', 'Well done!'), end: true, camera: 'pilot',
        say: (c, tutorial) => T(`Bravo, vous avez réalisé votre premier tour de piste complet ! ${tutorial.summary()} ${L1 ? "Quand vous serez à l'aise, essayez le niveau 2 : c'est vous qui ferez la radio." : 'Vous savez maintenant piloter et parler aux contrôleurs : essayez un vol en solo !'}`,
            `Well done, you have flown your first complete circuit! ${tutorial.summary()} ${L1 ? 'When you feel comfortable, try level 2: you will handle the radio yourself.' : 'You can now fly and talk to the controllers: try a solo flight!'}`) });
    for (const step of steps) {
        step.hasWait = Boolean(step.wait);
        step.wait ??= () => true;
    }
    return steps;
}

export { Initiation, buildSteps };
