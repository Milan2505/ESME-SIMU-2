import {
    AdditiveBlending,
    Box3,
    CanvasTexture,
    CylinderGeometry,
    DoubleSide,
    Group,
    Mesh,
    MeshBasicMaterial,
    Sprite,
    SpriteMaterial,
    TorusGeometry,
    Vector3
} from 'three';
import { PANEL_LAYOUT, panelPoint, panelLength } from './Panel172.js';

// Mode Initiation : un moniteur accompagne l'élève de l'avion éteint au parking jusqu'à l'arrêt moteur après un tour de
// piste. À chaque étape, il dit quoi faire et pourquoi (voix + texte), la commande ou l'instrument concerné clignote et
// la caméra s'y tourne. L'étape suivante vient quand l'action est faite.
// Niveau 1 : le moniteur tient la radio (l'élève pilote). Niveau 2 : l'élève fait la radio, le moniteur lui souffle
// quoi dire (le bouton du message clignote dans le panneau radio).

const KT = 1.94384;
const FT = 3.28084;
const ADVICE_COOLDOWN = 14;     // s entre deux conseils du même type
const GUIDE_REACHED = 14;       // m : balise de roulage atteinte

const headingDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
const cap = (h) => String(Math.round(((h % 360) + 360) % 360) || 360).padStart(3, '0');
const capSpoken = (h) => [...cap(h)].map((d) => ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'][d]).join(' ');

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
        this._time = 0;
        this._htmlTargets = [];
        this._advice = new Map();
    }

    // --- Démarrage / arrêt ---------------------------------------------------------------------
    start(level, cameraGuide = true) {
        this.level = level === 2 ? 2 : 1;
        this.cameraGuide = cameraGuide;
        this.active = true;
        this.steps = buildSteps(this.level);
        this.index = -1;
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
        this.highlighter.set([]);
        this.guide.clear();
        this._setHtml([]);
        this.ui.panel.hidden = true;
        this.onChange?.();
    }

    // --- Étapes ------------------------------------------------------------------------------------
    get step() {
        return this.steps?.[this.index] ?? null;
    }

    _next() {
        this.index++;
        const step = this.step;
        if (!step) return this.stop();
        this._state = { entered: this._time, spoken: false, speaking: false, sent: 0, flags: {} };
        this.highlighter.set([]);
        this._setHtml([]);
        if (step.guide) this.guide.set(step.guide(this._context()));
        if (step.clearGuide) this.guide.clear();
        this._render();   // le moniteur parle quand le moment de l'étape arrive (voir update)
    }

    _enter() {
        const step = this.step;
        const c = this._context();
        this._state.spoken = true;
        step.enter?.(c, this);
        const targets = typeof step.target === 'function' ? step.target(c) : step.target;
        const list = (Array.isArray(targets) ? targets : targets ? [targets] : []);
        this.highlighter.set(list.filter((t) => !t.startsWith('html:') && !t.startsWith('radio:')));
        this._htmlFromStep = list.filter((t) => t.startsWith('html:') || t.startsWith('radio:'));
        // Caméra : vers la commande à utiliser (vue cabine), ou place du pilote
        if (this.cameraGuide) {
            const where = this.highlighter.targets[0];
            if (step.camera === 'pilot' || (!where && step.camera !== 'none')) this.pilotView();
            else if (where && step.camera !== 'none') this.focusCabin(where.center, where.radius);
        }
        if (step.radio && this.level === 2) this.openAtc(true);
        this._say(typeof step.say === 'function' ? step.say(c, this) : step.say);
        this._render();
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
        const where = this.highlighter.targets[0];
        if (where && step.camera !== 'pilot') this.focusCabin(where.center, where.radius);
    }

    // Recentrer la caméra sur la commande à utiliser
    show() {
        const where = this.highlighter.targets[0];
        if (where) this.focusCabin(where.center, where.radius);
        else this.pilotView();
    }

    skip() {
        if (this.active) this._next();
    }

    // Situation pour les conditions des étapes
    _context() {
        const s = this.atc.s;
        const c = {
            sys: this.systems, controls: this.controls, avionics: this.avionics, atc: this.atc, s, level: this.level,
            onGround: this.controls.isOnGround(), speedKt: this.controls.getIndicatedSpeed() * KT,
            agl: s?.agl ?? 0, heading: this.controls.getHeading(), flaps: this.controls.getFlapLevel(),
            throttle: this.controls.getThrottle(), rpm: this.systems.rpm, roll: this.controls.getRoll(),
            airborne: Boolean(s?.airborne), position: this.aircraft.position,
        };
        const rw = s?.active;
        if (rw) {
            const p = this.aircraft.position;
            c.runway = rw;
            c.along = (p.x - rw.threshold.x) * rw.direction.x + (p.z - rw.threshold.z) * rw.direction.z;
            c.lateral = (p.x - rw.threshold.x) * rw.left.x + (p.z - rw.threshold.z) * rw.left.z;
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
        const c = this._context();
        // Conditions des étapes : une situation incomplète (avion crashé, hors de l'aérodrome…) vaut « pas encore »
        const safe = (fn) => { try { return fn(); } catch { return false; } };
        if (!this._state.spoken) {
            if (safe(() => step.wait(c))) this._enter();
            else return;
        }
        if (this.level === 1) this._autoRadio(step, c);
        else this._radioHints(step, c);
        this._adviseFlight(c);
        if ((this._htmlTick = (this._htmlTick ?? 0) + delta) > 0.25) {
            this._htmlTick = 0;
            this.refreshHtml();
        }
        // Étape faite (et le moniteur a fini sa phrase, sauf urgence en vol)
        const done = step.done ? safe(() => step.done(c, this._state.flags, delta)) : Boolean(step.radio);
        const talked = !this._state.speaking || (step.urgent && this._time - this._state.entered > 2.5);
        const radioDone = !step.radio || (safe(() => step.radio.until(c)) && !this.atc.busy && !this.atc.pending);
        if (step.next) {
            this.ui.next.hidden = false;
            return;
        }
        if (done && radioDone && talked && this._time - this._state.entered > 0.6) {
            if (step.praise) this._praise();
            this._next();
        }
    }

    // Bouton « Continuer » (étapes d'explication)
    continue() {
        const step = this.step;
        if (!step?.next || !this._state.spoken) return;
        this._next();
    }

    _praise() {
        const words = ['Très bien.', 'Parfait.', 'C\'est ça.', 'Bien.'];
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
        if (!step.radio || !this._state.spoken || this._state.speaking) return;
        if (step.radio.until(c)) return;
        const option = atc.options.find((o) => step.radio.ids.includes(o.id));
        if (option && this._time - (this._state.lastSend ?? -99) > 8) {
            this._state.lastSend = this._time;
            atc.choose(option.id);
        }
    }

    // Niveau 2 : l'élève fait la radio ; ce qu'il doit dire clignote dans le panneau, le moniteur le souffle
    _radioHints(step, c) {
        const atc = this.atc;
        const hints = [];
        let line = '';
        if (atc.pending && !atc.busy) {
            hints.push('html:.atc-collationner');
            line = `Collationnez : « ${atc.pending.message.text} »`;
            if (this._state.readbackHint !== atc.pending) {
                this._state.readbackHint = atc.pending;
                this.openAtc(true);
                this._say('Le contrôleur attend votre collationnement : répétez ses instructions. Cliquez sur « Collationner ».');
            }
        } else if (atc.suggestion && !atc.busy) {
            hints.push('html:.atc-frequence-conseil');
            line = 'Changez de fréquence : cliquez sur la case clignotante';
            if (this._state.freqHint !== atc.suggestion) {
                this._state.freqHint = atc.suggestion;
                this.openAtc(true);
                this._say('Changez de fréquence : affichez celle du contrôleur qui vous gère maintenant, la case clignote dans le panneau radio.');
            }
        } else if (atc.squawk && atc.transponder !== atc.squawk && !atc.busy) {
            hints.push('html:#atc-xpdr');
            line = `Affichez ${atc.squawk} au transpondeur (case Transpondeur, puis Entrée)`;
            if (this._state.squawkHint !== atc.squawk) {
                this._state.squawkHint = atc.squawk;
                this.openAtc(true);
                this._say(`Le contrôleur vous a donné un code transpondeur : ${[...atc.squawk].join(' ')}. Tapez-le dans la case Transpondeur du panneau radio, puis Entrée. Il permet au radar de vous identifier.`);
            }
        } else if (step.radio && this._state.spoken && !step.radio.until(c)) {
            const option = atc.options.find((o) => step.radio.ids.includes(o.id));
            if (option) {
                hints.push(`radio:${option.id}`);
                line = `Dites : « ${option.message.text} »`;
            } else if (atc.busy) line = 'Écoutez la réponse…';
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
        advise('stall', c.airborne && this.controls.isNearStall(), 'Attention, vitesse trop faible ! Rendez la main : poussez un peu sur le manche, touche Z.');
        advise('bank', c.airborne && Math.abs(c.roll) > 0.62, 'Trop incliné : revenez vers 20 à 30 degrés d\'inclinaison.');
        advise('taxi', c.onGround && c.speedKt > 18 && c.s && c.s.zone !== 'runway', 'Vous roulez trop vite. Au roulage, pas plus de 10 nœuds : réduisez les gaz, freinez avec B.');
        advise('fast', c.airborne && c.speedKt > 125, 'Trop vite pour le tour de piste : réduisez les gaz.');
        advise('low', c.airborne && c.agl < 300 && !c.s?.final && c.along !== undefined && c.along < 0, 'Vous êtes trop bas : remettez de la puissance et remontez vers 1000 pieds.');
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
        this.ui.next.hidden = !step.next;
        if (!this._state.spoken) this.ui.text.textContent = step.waiting ?? 'Continuez…';
        this.ui.hint.hidden = true;
    }

    // Fin : bilan
    summary() {
        const minutes = Math.round((performance.now() - this.startedAt) / 60000);
        return `Vol terminé en ${minutes} minute${minutes > 1 ? 's' : ''}, ${this.stats.advice} conseil${this.stats.advice > 1 ? 's' : ''} du moniteur en cours de route.`;
    }
}

// --- Le programme : de l'avion éteint au parking à l'arrêt moteur après un tour de piste ----------------------------
// Étape : { phase, title, say (texte ou fonction), why, target (commande(s), 'inst:…', 'html:…', 'radio:…'),
//   camera ('pilot' | 'none'), done (c, flags, delta), wait (c) : moment où le moniteur parle, next (bouton Continuer),
//   radio { ids, until } : message radio à faire passer (niveau 1 : par le moniteur), guide (balises de roulage),
//   urgent (en vol : on n'attend pas la fin de la phrase), praise }
function buildSteps(level) {
    const L1 = level === 1;
    const steps = [];
    const add = (phase, step) => steps.push({ phase, praise: Boolean(step.done), ...step });
    const radio = (phase, { title, ids, until, say1, say2, why, ...rest }) => add(phase, {
        title, why, radio: { ids, until }, say: L1 ? say1 : say2, ...rest,
    });

    // --- Présentation -------------------------------------------------------------------------------
    let P = 'Présentation';
    add(P, { title: 'Bienvenue à bord', next: true, camera: 'pilot',
        say: L1 ? 'Bonjour et bienvenue ! Je suis votre moniteur. Aujourd\'hui, nous allons faire un tour de piste complet : mise en route, roulage, décollage, tour de piste, atterrissage et retour au parking. Je m\'occupe de la radio, vous vous concentrez sur le pilotage. Cliquez sur Continuer quand vous êtes prêt.'
            : 'Bonjour et bienvenue ! Je suis votre moniteur. Aujourd\'hui, nous allons faire un tour de piste complet, et cette fois c\'est vous qui parlez aux contrôleurs. Je vous soufflerai quoi dire à chaque étape. Cliquez sur Continuer quand vous êtes prêt.',
        why: 'Astuce : la caméra se tourne vers chaque commande à utiliser, et celle-ci clignote en jaune. Le bouton Montrer la retrouve, Répéter me fait redire la consigne.' });
    add(P, { title: 'Regarder autour de soi', next: true, camera: 'pilot',
        say: 'Pour regarder autour de vous, glissez avec la souris. La molette zoome. Les touches 1 à 9 donnent des vues rapprochées du tableau de bord, et C recentre la vue. On clique sur les boutons et interrupteurs pour les manœuvrer.' });
    add(P, { title: 'Les instruments de vol', next: true, target: ['inst:asi', 'inst:ai', 'inst:alt'],
        say: 'Voici les trois instruments les plus importants. À gauche, l\'anémomètre : la vitesse par rapport à l\'air, en nœuds. Au centre, l\'horizon artificiel : l\'attitude de l\'avion, nez haut ou bas, ailes inclinées. À droite, l\'altimètre : l\'altitude, en pieds.',
        why: 'Vitesse, assiette, altitude : ce trio se surveille en permanence.' });
    add(P, { title: 'Les autres instruments', next: true, target: ['inst:tc', 'inst:dg', 'inst:vsi'],
        say: 'En dessous : l\'indicateur de virage avec sa bille, qui doit rester au centre ; le conservateur de cap, qui donne la direction ; et le variomètre, qui dit si l\'on monte ou si l\'on descend.' });

    // --- Avant la mise en route ---------------------------------------------------------------------------
    P = 'Avant la mise en route';
    add(P, { title: 'Frein de parking', target: 'brake', done: (c) => c.controls.parkingBrake,
        say: 'Première vérification : le frein de parking doit être serré, sinon l\'avion avancera dès la mise en route. Il clignote sous le tableau : s\'il est desserré, cliquez dessus.',
        why: 'Un avion qui démarre frein desserré peut rouler tout seul vers un obstacle.' });
    add(P, { title: 'Batterie : master BAT', target: 'switch:masterBat', done: (c) => c.sys.switches.masterBat,
        say: 'On met l\'avion sous tension. Cliquez sur la moitié droite de l\'interrupteur rouge MASTER, marquée BAT.',
        why: 'La batterie alimente le démarreur, la radio et les instruments électriques.' });
    add(P, { title: 'Feu anticollision', target: 'switch:beacon', done: (c) => c.sys.switches.beacon,
        say: 'Allumez le feu anticollision : l\'interrupteur BCN, dans la rangée du bas.',
        why: 'Ce feu rouge tournant prévient les personnes autour que le moteur va démarrer.' });
    add(P, { title: 'Avionique', target: 'switch:avionics', done: (c) => c.sys.switches.avionics,
        say: 'Allumez l\'avionique : la moitié gauche de l\'interrupteur blanc AVIONICS, marquée BUS 1. Elle alimente la radio et le transpondeur.' });
    if (L1) {
        add(P, { title: 'Écouter l\'ATIS', next: true, camera: 'pilot', enter: (c) => c.atc.playAtis(),
            say: 'Avant d\'appeler, on écoute l\'ATIS : le bulletin météo enregistré de l\'aérodrome. Il donne la piste en service, le vent et le calage altimétrique. Écoutez, puis cliquez sur Continuer.' });
    } else {
        add(P, { title: 'Écouter l\'ATIS', target: 'html:#atc-atis', enter: (c, t) => t.openAtc(true),
            done: (c) => c.atc.log.some((l) => l.from === 'atis') && !c.atc.busy,
            say: 'Avant d\'appeler, on écoute l\'ATIS : le bulletin météo enregistré. Dans le panneau radio, cliquez sur Écouter l\'ATIS. Retenez sa lettre : vous la donnerez au contrôleur.' });
    }
    radio(P, { title: 'Demander la mise en route', ids: ['startupFirst', 'startup'], until: (c) => c.atc.state !== 'idle',
        why: 'On ne démarre pas sans l\'accord du contrôleur au sol.',
        say1: 'J\'appelle le contrôleur Sol pour demander la mise en route. Écoutez l\'échange : indicatif, position, information ATIS reçue, puis la demande.',
        say2: 'Appelez le contrôleur Sol pour demander la mise en route. Le message est déjà rédigé : cliquez sur la case qui clignote dans le panneau radio.' });

    // --- Mise en route ------------------------------------------------------------------------------
    P = 'Mise en route';
    add(P, { title: 'Robinet d\'essence', target: 'fuelShutoff', done: (c) => !c.sys.fuelShutoff,
        say: 'Vérifiez le robinet d\'essence : le bouton rouge au pied du tableau doit être enfoncé. S\'il est tiré, cliquez dessus.' });
    add(P, { title: 'Sélecteur de réservoirs', target: 'fuelSelector', done: (c) => c.sys.fuelSelector === 1,
        say: 'Le sélecteur de réservoirs, au plancher, doit être sur BOTH : on prend l\'essence des deux ailes.' });
    add(P, { title: 'Mixture plein riche', target: 'mixture', done: (c) => c.sys.mixture >= 0.95,
        say: 'Poussez la mixture à fond : la manette rouge. Cliquez sur sa moitié haute, ou appuyez plusieurs fois sur U.',
        why: 'Mixture : le dosage air-essence. Plein riche pour démarrer et au sol.' });
    add(P, { title: 'Amorçage : pompe électrique', target: 'switch:fuelPump', done: (c) => c.sys.switches.fuelPump && c.sys.prime >= 2,
        say: 'Allumez la pompe électrique, FUEL PUMP, et laissez-la tourner trois secondes : elle envoie de l\'essence dans les cylindres.',
        why: 'Un moteur amorcé démarre du premier coup.' });
    add(P, { title: 'Pompe coupée', target: 'switch:fuelPump', done: (c) => !c.sys.switches.fuelPump,
        say: 'C\'est amorcé : coupez la pompe.' });
    add(P, { title: 'Gaz : un centimètre', target: 'throttle', done: (c) => c.throttle >= 0.05 && c.throttle <= 0.35,
        say: 'Ouvrez un peu les gaz : un clic sur le haut de la manette noire, ou la barre Espace un court instant.',
        why: 'Un filet de gaz aide le moteur à partir, sans qu\'il s\'emballe.' });
    add(P, { title: 'Démarrage : clé sur START', target: 'mags', done: (c) => c.sys.running,
        say: 'Regardez dehors que personne n\'est près de l\'hélice, puis tournez la clé jusqu\'à START : cliquez sur sa droite plusieurs fois, ou utilisez la molette. Si le moteur ne part pas, recommencez.',
        why: 'La clé passe par OFF, R, L, BOTH puis START, qui lance le démarreur.' });
    add(P, { title: 'Alternateur', target: 'switch:masterAlt', done: (c) => c.sys.switches.masterAlt,
        say: 'Le moteur tourne ! Branchez l\'alternateur : la moitié gauche de l\'interrupteur MASTER, marquée ALT. C\'est lui qui recharge la batterie.' });
    add(P, { title: 'Feux de navigation', target: 'switch:nav', done: (c) => c.sys.switches.nav,
        say: 'Allumez les feux de navigation, NAV : rouge à gauche, vert à droite, blanc à l\'arrière.' });
    add(P, { title: 'Transpondeur', target: 'xpdr:mode', done: (c) => c.avionics.xpdr.mode === 'ALT',
        say: 'Passez le transpondeur sur ALT : cliquez sur la droite de son sélecteur, deux fois.',
        why: 'Le transpondeur répond au radar en donnant notre code et notre altitude.' });

    // --- Roulage --------------------------------------------------------------------------------------
    P = 'Roulage';
    radio(P, { title: 'Demander le roulage', ids: ['taxiFirst', 'taxi'], until: (c) => ['taxi', 'holding', 'lineup', 'takeoff'].includes(c.atc.state),
        why: 'Le contrôleur indique le chemin jusqu\'au point d\'attente de la piste en service.',
        say1: 'J\'annonce au Sol que nous sommes prêts à rouler. Écoutez bien le chemin qu\'il nous donne.',
        say2: 'Annoncez au Sol que vous êtes prêt à rouler. Écoutez bien sa réponse, puis collationnez-la : on répète toujours une instruction pour montrer qu\'on l\'a comprise.' });
    add(P, { title: 'Phare de roulage', target: 'switch:taxi', done: (c) => c.sys.switches.taxi,
        say: 'Allumez le phare de roulage, TAXI.' });
    add(P, { title: 'Desserrer le frein', target: 'brake', done: (c) => !c.controls.parkingBrake,
        say: 'Desserrez le frein de parking en cliquant dessus.' });
    add(P, { title: 'Rouler jusqu\'au point d\'attente', camera: 'pilot', clearGuide: false,
        guide: () => [[312, -20], [312, 0], [285, 0]],
        done: (c) => c.s?.nearHolding && c.speedKt < 4,
        say: 'Suivez les anneaux jaunes jusqu\'au point d\'attente. Gaz avec Espace et Ctrl, direction avec A et E, freins avec B. Au roulage, on ne dépasse pas la vitesse d\'un homme qui court : environ 10 nœuds. Arrêtez-vous au dernier anneau, avant la piste.',
        why: 'Le point d\'attente est la limite à ne pas franchir sans l\'autorisation de la Tour.' });

    // --- Avant le décollage ------------------------------------------------------------------------------
    P = 'Avant le décollage';
    add(P, { title: 'Frein de parking', target: 'brake', done: (c) => c.controls.parkingBrake, clearGuide: true,
        say: 'Serrez le frein de parking pour les essais moteur.' });
    add(P, { title: 'Essai moteur : 1700 tours', target: ['throttle', 'inst:tach'], done: (c) => c.rpm > 1600,
        say: 'Mettez les gaz jusqu\'à environ 1700 tours par minute, lus au compte-tours qui clignote.' });
    add(P, { title: 'Essai des magnétos', target: ['mags', 'inst:tach'],
        done: (c, f) => {
            if (c.sys.magnetos === 1) f.r = true;
            if (c.sys.magnetos === 2) f.l = true;
            return f.r && f.l && c.sys.magnetos === 3;
        },
        say: 'Essai des magnétos : tournez la clé sur R, regardez le régime baisser un peu, puis sur L, puis revenez sur BOTH. Clic à gauche de la clé pour revenir en arrière.',
        why: 'Chaque magnéto allume les bougies seule : si le régime chute trop sur l\'une, elle est défaillante.' });
    add(P, { title: 'Gaz réduits', target: 'throttle', done: (c) => c.throttle < 0.12,
        say: 'Les deux magnétos sont bonnes. Réduisez les gaz : touche Ctrl ou bas de la manette.' });
    add(P, { title: 'Volets 10°', target: 'flaps:lever', done: (c) => c.flaps === 1,
        say: 'Sortez un cran de volets, 10 degrés : touche G, ou cliquez sur le bas du levier des volets.',
        why: 'Les volets donnent plus de portance : l\'avion décolle plus tôt.' });
    add(P, { title: 'Phare et strobes', target: ['switch:land', 'switch:strobe'], done: (c) => c.sys.switches.land && c.sys.switches.strobe,
        say: 'Allumez le phare d\'atterrissage, LAND, et les feux à éclats, STROBE : on doit nous voir de loin.' });
    radio(P, { title: 'Prêt au départ', ids: ['readyHold', 'readyFirst'], until: (c) => ['takeoff', 'lineup'].includes(c.atc.state),
        why: 'Au point d\'attente, on appelle la Tour : elle gère la piste et le tour de piste.',
        say1: 'J\'annonce à la Tour que nous sommes prêts au départ. Attendons son autorisation.',
        say2: 'Annoncez à la Tour que vous êtes prêt au départ, puis attendez son autorisation et collationnez-la.' });
    add(P, { title: 'Frein desserré, alignement', target: 'brake', camera: 'pilot',
        done: (c) => !c.controls.parkingBrake && c.s?.zone === 'runway' && headingDiff(c.heading, c.s.active.heading) < 15,
        say: (c) => `Nous sommes autorisés. Desserrez le frein, entrez sur la piste et alignez-vous face au cap ${capSpoken(c.s?.active?.heading ?? 0)}, sur l'axe.`,
        why: 'S\'aligner bien droit évite de partir de travers en prenant de la vitesse.' });

    // --- Décollage et tour de piste -----------------------------------------------------------------------
    P = 'Décollage';
    add(P, { title: 'Plein gaz', camera: 'pilot', urgent: true, target: 'inst:asi',
        done: (c) => c.airborne,
        say: 'Plein gaz : maintenez la barre Espace. Gardez l\'axe avec A et E. À 55 nœuds sur l\'anémomètre, tirez doucement sur le manche, touche S, pour décoller.' });
    add(P, { title: 'Montée', camera: 'none', urgent: true, target: 'inst:asi',
        done: (c) => c.agl > 300,
        say: 'Vous volez ! Gardez 75 nœuds en montée : nez plus haut si l\'on va trop vite, plus bas si l\'on ralentit.' });
    add(P, { title: 'Volets rentrés', target: 'flaps:lever', camera: 'none', urgent: true, done: (c) => c.flaps === 0,
        say: 'Rentrez les volets : touche T.' });
    P = 'Tour de piste';
    add(P, { title: 'Virage vent traversier', camera: 'none', urgent: true, target: 'inst:dg',
        wait: (c) => c.agl > 550, waiting: 'Continuez la montée droit devant jusqu\'à 600 pieds.',
        done: (c) => headingDiff(c.heading, c.runway.heading - 90) < 20,
        say: (c) => `Virage à gauche, cap ${capSpoken(c.runway.heading - 90)}, avec 20 degrés d'inclinaison : touche Q pour incliner, et un peu de S pour tenir le nez. Continuez de monter vers 1000 pieds.` });
    add(P, { title: 'Virage vent arrière', camera: 'none', urgent: true, target: 'inst:dg',
        wait: (c) => c.lateral > 650, waiting: 'Continuez en vent traversier, montée vers 1000 pieds.',
        done: (c) => c.s?.downwind || headingDiff(c.heading, c.runway.heading + 180) < 20,
        say: (c) => `Encore à gauche : cap ${capSpoken(c.runway.heading + 180)}, la branche vent arrière. La piste doit défiler à gauche, parallèle.` });
    radio(P, { title: 'Report vent arrière', ids: ['downwind'], until: (c) => ['downwind', 'continue', 'landing', 'touchgo'].includes(c.atc.state), camera: 'none',
        say1: 'J\'annonce notre position à la Tour : vent arrière.',
        say2: 'Annoncez votre position à la Tour : vent arrière. Le message clignote dans le panneau radio.' });
    add(P, { title: 'Palier à 1000 pieds', camera: 'none', target: ['inst:alt', 'throttle'], urgent: true,
        done: (c) => c.agl > 800 && c.rpm < 2450,
        say: 'À 1000 pieds, mettez l\'avion en palier : nez un peu plus bas et réduisez à environ 2300 tours. Le variomètre doit revenir vers zéro.',
        why: 'Le tour de piste se fait à hauteur constante, 1000 pieds au-dessus du terrain.' });
    add(P, { title: 'Vérifications avant atterrissage', target: ['switch:fuelPump', 'mixture'], camera: 'none',
        done: (c) => c.sys.switches.fuelPump && c.sys.mixture >= 0.95,
        say: 'Vérifications avant l\'atterrissage : pompe électrique allumée, mixture plein riche.' });
    add(P, { title: 'Travers du seuil : réduire', camera: 'none', urgent: true, target: ['throttle', 'flaps:lever'],
        wait: (c) => c.along < 50, waiting: 'Continuez en vent arrière, à 1000 pieds.',
        done: (c) => c.flaps >= 1 && c.throttle < 0.4,
        say: 'Nous passons le bout de la piste : réduisez les gaz vers 1500 tours et sortez un cran de volets, touche G. Laissez la vitesse descendre vers 70 nœuds.' });
    add(P, { title: 'Virage en étape de base', camera: 'none', urgent: true, target: 'inst:dg',
        wait: (c) => c.along < -650, waiting: 'Continuez en descente douce, 70 nœuds.',
        done: (c) => headingDiff(c.heading, c.runway.heading + 90) < 25,
        say: (c) => `Virage à gauche en étape de base, cap ${capSpoken(c.runway.heading + 90)}. Sortez un deuxième cran de volets.` });
    add(P, { title: 'Dernier virage', camera: 'none', urgent: true,
        wait: (c) => c.lateral < 520, waiting: 'Étape de base : descente vers 600 pieds, 70 nœuds.',
        done: (c) => Boolean(c.s?.final),
        say: 'Dernier virage à gauche : alignez-vous sur l\'axe de la piste.' });
    radio(P, { title: 'Report finale', ids: ['finalFull'], until: (c) => ['landing', 'continue'].includes(c.atc.state), camera: 'none',
        say1: 'J\'annonce que nous sommes en finale pour un atterrissage complet.',
        say2: 'Annoncez la finale pour un atterrissage complet, puis collationnez l\'autorisation d\'atterrir.' });
    add(P, { title: 'Finale', camera: 'none', urgent: true, target: ['inst:asi', 'flaps:lever'],
        done: (c) => c.agl < 60,
        say: 'Volets pleins, touche G. Visez le début de la piste : il doit rester fixe dans le pare-brise. Tenez 65 nœuds, les gaz règlent la pente.',
        why: 'Les lampes du PAPI, à gauche de la piste : deux blanches et deux rouges, vous êtes sur la bonne pente.' });
    P = 'Atterrissage';
    add(P, { title: 'Arrondi', camera: 'none', urgent: true, done: (c) => c.onGround,
        say: 'Gaz tout réduits, touche Ctrl. Tout près du sol, tirez progressivement pour garder l\'avion en l\'air le plus longtemps possible : il se pose tout seul.' });
    add(P, { title: 'Freinage', camera: 'none', urgent: true, done: (c) => c.speedKt < 12,
        say: 'Posé ! Gardez l\'axe avec A et E, et freinez avec B.' });

    // --- Après l'atterrissage -------------------------------------------------------------------------------
    P = 'Après l\'atterrissage';
    add(P, { title: 'Dégager la piste', camera: 'none',
        guide: () => [[250, 0], [275, 0]],
        done: (c) => c.s && c.s.zone !== 'runway' && c.s.zone !== 'entry',
        say: 'Dégagez la piste par la voie de circulation au milieu, à droite : roulez doucement jusqu\'au deuxième anneau jaune, après le point d\'attente.' });
    radio(P, { title: 'Piste dégagée', ids: ['vacated'], until: (c) => ['toGround', 'taxiIn'].includes(c.atc.state) || c.atc.freq === 'ground',
        say1: 'J\'annonce à la Tour que la piste est dégagée. Elle va nous renvoyer vers le Sol.',
        say2: 'Annoncez à la Tour que la piste est dégagée, puis passez sur la fréquence du Sol.' });
    add(P, { title: 'Volets, phares', target: ['flaps:lever', 'switch:land', 'switch:strobe'],
        done: (c) => c.flaps === 0 && !c.sys.switches.land && !c.sys.switches.strobe,
        say: 'Rentrez les volets, touche T, et éteignez le phare d\'atterrissage et les strobes.' });
    radio(P, { title: 'Retour au parking', ids: ['groundIn'], until: (c) => c.atc.state === 'taxiIn',
        say1: 'Je demande au Sol le roulage vers le parking.',
        say2: 'Appelez le Sol pour rouler vers le parking.' });
    add(P, { title: 'Rouler jusqu\'au parking', camera: 'pilot',
        guide: (c) => {
            const stand = c.atc.aerodrome.stands.find((st) => st.name === c.atc.assignedStand) ?? { x: 336, z: -20 };
            const points = [[285, 0], [312, 0], [312, stand.z], [334, stand.z]];
            return c.position.x > 290 ? points.slice(1) : points;   // déjà sur la voie du parking : pas de retour en arrière
        },
        done: (c) => c.s?.stand === c.atc.assignedStand && c.speedKt < 2,
        say: (c) => `Suivez les anneaux jusqu'à la place ${c.atc.assignedStand}, et arrêtez-vous dessus.` });

    // --- Arrêt -------------------------------------------------------------------------------------------
    P = 'Arrêt';
    add(P, { title: 'Frein de parking', target: 'brake', clearGuide: true, done: (c) => c.controls.parkingBrake,
        say: 'Serrez le frein de parking.' });
    radio(P, { title: 'Fin de vol à la radio', ids: ['parked'], until: (c) => !c.atc.contact,
        say1: 'J\'annonce au Sol que nous sommes au parking et que nous quittons la fréquence.',
        say2: 'Annoncez au Sol que vous êtes au parking et quittez la fréquence.' });
    add(P, { title: 'Phare et pompe', target: ['switch:taxi', 'switch:fuelPump'], done: (c) => !c.sys.switches.taxi && !c.sys.switches.fuelPump,
        say: 'Éteignez le phare de roulage et la pompe électrique.' });
    add(P, { title: 'Avionique coupée', target: ['switch:avionics', 'switch:avionics2'], done: (c) => !c.sys.switches.avionics && !c.sys.switches.avionics2,
        say: 'Coupez l\'avionique, les deux moitiés de l\'interrupteur AVIONICS.',
        why: 'On l\'éteint avant le moteur : les variations de tension pourraient abîmer la radio.' });
    add(P, { title: 'Arrêt du moteur : mixture', target: 'mixture', done: (c) => !c.sys.running,
        say: 'On arrête le moteur en tirant la mixture à fond, sur l\'étouffoir : touche Y maintenue, ou bas de la manette rouge.',
        why: 'Couper l\'essence plutôt que l\'allumage vide les cylindres : pas de retour de flamme.' });
    add(P, { title: 'Magnétos sur OFF', target: 'mags', done: (c) => c.sys.magnetos === 0,
        say: 'Tournez la clé sur OFF : clic à gauche de la clé.' });
    add(P, { title: 'Master coupé', target: ['switch:masterBat', 'switch:masterAlt', 'switch:beacon', 'switch:nav'],
        done: (c) => !c.sys.switches.masterBat && !c.sys.switches.masterAlt,
        say: 'Éteignez les feux, puis coupez le MASTER, BAT et ALT. L\'avion est arrêté.' });
    add(P, { title: 'Bravo !', next: true, camera: 'pilot',
        say: (c, tutorial) => `Bravo, vous avez réalisé votre premier tour de piste complet ! ${tutorial.summary()} ${L1 ? 'Quand vous serez à l\'aise, essayez le niveau 2 : c\'est vous qui ferez la radio.' : 'Vous savez maintenant piloter et parler aux contrôleurs : essayez un vol en solo !'}` });
    for (const step of steps) step.wait ??= () => true;
    return steps;
}

export { Initiation };
