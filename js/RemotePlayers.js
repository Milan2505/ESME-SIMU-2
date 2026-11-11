import {
    CanvasTexture,
    Group,
    Quaternion,
    SpotLight,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3
} from 'three';
import { LIVERIES, paintAircraft } from './Liveries.js';
import { setRegistration } from './C172Model.js';
import { AircraftLights } from './AircraftLights.js';
import { cloneF15, lowDetailF15, paintF15, animateF15, F15_LIVERIES, F15_LIGHT_LAYOUT } from './F15Model.js';
import { SmokeTrail } from './Damage.js';

const SMOOTHING = 8;            // lissage de l'orientation
const POSITION_CORRECTION = 3;  // rapidité du recalage sur la position prédite
const MAX_EXTRAPOLATION = 1;    // prédiction au plus 1 s après le dernier message (s)
const SNAP_DISTANCE = 60;       // au-delà, on replace l'avion directement (réinitialisation…) (m)
// … ou au-delà de la distance parcourue en SNAP_TIME s à sa vitesse : un F-15 à 300 m/s fait 45 m entre deux messages,
// et un message en retard sur un relais public le décalait de plus de 60 m : l'avion « sautait » au lieu de glisser
const SNAP_TIME = 0.8;
const LABEL_HEIGHT = 0.065;     // hauteur de l'étiquette : ~6,5 % de la hauteur de l'écran, quelle que soit la distance
const LABEL_OFFSET = 3;         // étiquette au-dessus de l'avion (m)
const LABEL_REFRESH = 0.5;      // distance et altitude de l'étiquette mises à jour toutes les 0,5 s
const OFFLINE_DELAY = 3000;     // sans nouvelles depuis 3 s : joueur hors ligne (retiré au bout de 8 s, voir Multiplayer.js)
const LABEL_MIN_DISTANCE = 12;
// F-15 des autres en configuration lisse (train, volets, aérofrein rentrés, verrière fermée) à plus de LOW_DETAIL_DISTANCE :
// version fusionnée (voir lowDetailF15), même image avec ~3 fois moins d'appels de dessin ; de près, le modèle complet
// (soufflantes qui tournent dans les entrées d'air)
const LOW_DETAIL_DISTANCE = 80;
// Avions des joueurs partis gardés (par type) : un joueur qui revient (page cachée plus de 8 s, coupure réseau, nouveau
// départ après rechargement) ou un nouveau joueur reprend l'un d'eux. Avant, son avion était recréé et ses shaders
// recompilés : à-coup chez tous les autres joueurs à chaque retour
const SPARE_PLANES = 3;
const CLEAN = 0.01;  // tout près : étiquette masquée (elle cacherait l'avion)
const FT = 0.3048, NM = 1852;
// Phare des autres avions : même lumière que celui du joueur (simulator.js). Réserve de 2 projecteurs, attribués aux
// avions phare allumé les plus proches (une lumière par avion alourdirait trop le rendu)
const LANDING_SPOTS = 2;
const LANDING_LIGHT = { intensity: 12000, distance: 400, angle: 20 * Math.PI / 180, penumbra: 0.65, decay: 1.6,
    position: [-2.2, 1.12, -3], target: [-1.2, -2.4, -80] };

const _forward = new Vector3();
const _smokePoint = new Vector3();
// Fumée d'un avion touché : sortie des réacteurs (F-15), moteur à l'avant (Cessna) ; repère avion
const SMOKE_SOURCE = { f15: new Vector3(0, 0.4, 8.5), c172: new Vector3(0, 0.3, -4) };

// Distance en milles nautiques : 2 décimales de près (0,05 NM = ~90 m), 1 au-delà
function formatNM(meters) {
    const digits = meters < NM ? 2 : 1;
    return (meters / NM).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Étiquette au-dessus d'un avion : pseudo, distance et altitude, cadre à la couleur de sa livrée.
// Taille fixe à l'écran et toujours devant le décor : on repère les autres joueurs de loin.
class Label {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 512;
        this.canvas.height = 168;
        this.texture = new CanvasTexture(this.canvas);
        this.texture.colorSpace = SRGBColorSpace;
        this.sprite = new Sprite(new SpriteMaterial({
            map: this.texture, fog: false, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false,
        }));
        this.sprite.center.set(0.5, 0);    // ancrée par le bas (la pointe vise l'avion)
        this.sprite.scale.set(LABEL_HEIGHT * 512 / 168, LABEL_HEIGHT, 1);
        this.sprite.renderOrder = 10;
        this._text = '';
    }

    draw(name, detail, color, speaking, offline = false) {
        const text = `${name}|${detail}|${color}|${speaking}|${offline}`;
        if (text === this._text) return;
        this._text = text;
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0, 0, 512, 168);
        // Cadre et pointe
        ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
        const accent = offline ? '#8a8f96' : speaking ? '#39ff6a' : color;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.roundRect(6, 6, 500, 128, 18);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(236, 137);
        ctx.lineTo(256, 164);
        ctx.lineTo(276, 137);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.fill();
        // Texte
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = offline ? '#b8bcc2' : 'white';
        ctx.font = 'bold 54px DejaVu Sans Mono, monospace';
        ctx.fillText(name, 256, 50, 470);
        ctx.font = 'bold 34px DejaVu Sans Mono, monospace';
        ctx.fillStyle = offline ? '#ffb000' : speaking ? '#39ff6a' : '#d8dde3';
        ctx.fillText(offline ? 'HORS LIGNE' : speaking ? 'RADIO' : detail, 256, 104, 470);
        this.texture.needsUpdate = true;
    }

    dispose() {
        this.texture.dispose();
        this.sprite.material.dispose();
    }
}

// Affiche les avions des autres joueurs à partir de l'état reçu par Multiplayer :
// vraies couleurs (livrée choisie par chaque joueur), son du moteur, explosion quand ils se crashent.
// Événement 'crash' { name, position } : un joueur vient de s'écraser.
class RemotePlayers extends EventTarget {
    // registrationFor(id) : immatriculation peinte sur l'avion d'un joueur
    // altitudeOffset : hauteur des roues sous l'origine de l'avion, par type ({ c172, f15 }) ; jetSound : réacteurs (F-15)
    constructor(scene, multiplayer, { engineSound = null, jetSound = null, altitudeOffset = 0, registrationFor = null } = {}) {
        super();
        this.scene = scene;
        this.multiplayer = multiplayer;
        this.engineSound = engineSound;
        this.jetSound = jetSound;
        this.altitudeOffsets = typeof altitudeOffset === 'number' ? { c172: altitudeOffset, f15: altitudeOffset } : altitudeOffset;
        this.jetTemplate = null;       // F-15 (chargé à la demande, voir setJetTemplate)
        this.onJetNeeded = null;       // appelé quand un autre joueur vole en F-15 et que son modèle n'est pas encore chargé
        this.registrationFor = registrationFor;
        this.showLabels = true;
        this.night = 0;                         // feux des avions : discrets le jour, halos larges la nuit
        this.engineVolume = 1;                  // moins fort en cabine
        this.template = null;          // modèle 3D de l'avion (fourni quand il est chargé)
        this.planes = new Map();       // id -> { group, model, label, propeller, engine, livery, crashes, … }
        this._spareLabels = [];         // étiquettes des joueurs partis, réutilisées (voir _sync)
        this._sparePlanes = {};         // avions des joueurs partis, par type, réutilisés (voir _reuse)
        this.speaking = new Set();     // joueurs qui parlent à la radio
        this._targetPosition = new Vector3();
        this._targetQuaternion = new Quaternion();
        this._velocity = new Vector3();
        this._labelTimer = 0;
        // prepare(objet) -> Promise : shaders compilés et textures envoyées à la carte graphique avant que l'avion
        // apparaisse (voir simulator.js) ; sans : il apparaît tout de suite (la première image qui le montre compile)
        this.prepare = null;
        this.colorFor = null;   // (id, état) -> couleur de l'étiquette et de la carte, ou null : celle de la livrée (Wardog : équipe)

        multiplayer.addEventListener('players', () => this._sync());
    }

    setTemplate(model) {
        this._dropSpares('c172');   // (avions gardés faits sur l'ancien modèle)
        this.template = model;
        this._sync();
    }

    setJetTemplate(model) {
        this._dropSpares('f15');
        this.jetTemplate = model;
        this.jetLowTemplate = null;   // version fusionnée (configuration lisse, voir update) : faite au premier F-15 d'un autre joueur
        this._sync();
    }

    _dropSpares(type) {
        for (const plane of this._sparePlanes[type] ?? []) this._release(plane);
        this._sparePlanes[type] = [];
    }

    _altitudeOffset(state) {
        return this.altitudeOffsets[state?.aircraft] ?? this.altitudeOffsets.c172;
    }

    // Ambiance (météo) : feux de navigation, anticollision, strobes et phare des autres avions
    setNight(night) {
        this.night = night;
        for (const plane of this.planes.values()) plane.lights.setNight(night);
    }

    // Couleur d'affichage d'un joueur (étiquette, carte, liste)
    static color(livery) {
        return (LIVERIES[livery] ?? F15_LIVERIES[livery] ?? LIVERIES.origine).color;
    }

    // Avions affichés : position lissée, cap (degrés), altitude (ft), pour la carte et la liste des joueurs
    list() {
        const result = [];
        for (const [id, plane] of this.planes) {
            const state = this.multiplayer.players.get(id);
            if (!state) continue;
            _forward.set(0, 0, -1).applyQuaternion(plane.group.quaternion);
            result.push({
                id,
                name: state.name,
                type: plane.type,
                color: this.colorFor?.(id, state) ?? RemotePlayers.color(state.livery),
                position: plane.group.position,
                quaternion: plane.group.quaternion,
                heading: (Math.atan2(_forward.x, -_forward.z) * 180 / Math.PI + 360) % 360,
                altitude: (plane.group.position.y - this._altitudeOffset(state)) / FT,
                crashed: state.crashed,
                offline: this.isOffline(state),
                speaking: this.speaking.has(id),
            });
        }
        return result;
    }

    // Combat : avions visibles des autres joueurs (cibles du canon) et leur canon ({ id, name, type, group, firing,
    // velocity })
    combatList() {
        const result = [];
        for (const [id, plane] of this.planes) {
            const state = this.multiplayer.players.get(id);
            if (!state || state.crashed || !plane.group.visible || this.isOffline(state)) continue;
            result.push({ id, name: state.name, type: plane.type, group: plane.group, firing: state.firing,
                velocity: (plane.velocity ??= new Vector3()).fromArray(state.v ?? [0, 0, 0]) });
        }
        return result;
    }

    // Joueur qui n'est plus sur la page du simulateur, ou dont on n'a plus de nouvelles
    isOffline(state) {
        return state.away || performance.now() - state.receivedAt > OFFLINE_DELAY;
    }

    // ownPosition : position de l'avion du joueur (distance affichée sur les étiquettes) ;
    // camera et time (s) : orientation et clignotement des feux
    update(delta, ownPosition, camera = null, time = 0) {
        const now = performance.now();
        const positionAlpha = 1 - Math.exp(-POSITION_CORRECTION * delta);
        const rotationAlpha = 1 - Math.exp(-SMOOTHING * delta);
        this._labelTimer -= delta;
        const refreshLabels = this._labelTimer <= 0;
        if (refreshLabels) this._labelTimer = LABEL_REFRESH;

        for (const [id, plane] of this.planes) {
            const state = this.multiplayer.players.get(id);
            if (!state) continue;
            // Filet de sécurité : avion affiché d'un autre type que celui que le joueur pilote -> refait (voir _sync)
            if ((state.aircraft === 'f15' ? 'f15' : 'c172') !== plane.type && !this._resyncing) {
                this._resyncing = true;
                queueMicrotask(() => { this._resyncing = false; this._sync(); });
            }

            // Prédiction : position reçue + vitesse × ancienneté du message
            // (temps depuis la réception + attente sur le serveur + trajets réseau aller/retour)
            const age = Math.min(MAX_EXTRAPOLATION,
                (now - state.receivedAt + (state.age ?? 0)) / 1000 + this.multiplayer.latency);
            this._velocity.fromArray(state.v ?? [0, 0, 0]);
            // Hors ligne : l'avion est figé chez ce joueur, on ne le fait plus avancer
            const offline = this.isOffline(state);
            if (offline) this._velocity.set(0, 0, 0);
            this._targetPosition.fromArray(state.p).addScaledVector(this._velocity, state.crashed ? 0 : age);
            this._targetQuaternion.fromArray(state.q);

            const group = plane.group;
            const snap = Math.max(SNAP_DISTANCE, this._velocity.length() * SNAP_TIME);
            if (plane.fresh || group.position.distanceTo(this._targetPosition) > snap) {
                group.position.copy(this._targetPosition);
                group.quaternion.copy(this._targetQuaternion);
                plane.fresh = false;
                    } else {
                // L'avion avance avec sa vitesse, puis se recale en douceur sur la prédiction
                group.position.addScaledVector(this._velocity, delta).lerp(this._targetPosition, positionAlpha);
                group.quaternion.slerp(this._targetQuaternion, rotationAlpha);
            }
            // Hélice : au régime de son moteur (lissé entre deux messages), arrêtée moteur coupé. Joueur sur une ancienne
            // version (sans régime) : déduit des gaz, comme avant
            const rpm = state.rpm ?? 800 + 2000 * state.t;
            plane.rpm = plane.rpm === undefined ? rpm : plane.rpm + (rpm - plane.rpm) * Math.min(1, delta * 3);
            if (plane.propeller && !state.crashed) plane.propeller.rotation.z += plane.rpm / 2700 * 100 * delta;
            // F-15 : train, volets, aérofrein, verrière, postcombustion, tuyères (état transmis par le joueur)
            if (plane.type === 'f15') {
                const j = state.jet ?? {};
                const n2 = plane.rpm / 27, ab = j.ab ?? 0;
                plane.anim.time += delta;
                const clean = (j.gear ?? 1) < CLEAN && (j.flaps ?? 0) < CLEAN && (j.speedbrake ?? 0) < CLEAN && (j.canopy ?? 0) < CLEAN;
                const useLow = Boolean(plane.low) && clean && ownPosition && group.position.distanceTo(ownPosition) > LOW_DETAIL_DISTANCE;
                // La version non affichée est détachée (pas cachée) : three.js recalcule les positions de tout ce qui est
                // attaché, même caché (~600 pièces par F-15)
                if (plane.low && useLow !== plane.usingLow) {
                    plane.usingLow = useLow;
                    group.remove(useLow ? plane.model : plane.low);
                    group.add(useLow ? plane.low : plane.model);
                    plane.lights.occluder = useLow ? plane.low : plane.model;   // (occultation des feux)
                }
                animateF15(useLow ? plane.low : plane.model, {
                    pitch: 0, roll: 0, yaw: 0, flaps: j.flaps ?? 0, speedbrake: j.speedbrake ?? 0, canopy: j.canopy ?? 0,
                    gear: j.gear ?? 1, steer: 0, wheelSpeed: 0, onGround: false, n2: [n2, n2], ab: [ab, ab], time: plane.anim.time,
                }, delta);
            }

            // Livrée changée en cours de partie
            if (state.livery !== plane.livery) {
                plane.livery = state.livery;
                if (plane.type === 'f15') {
                    paintF15(plane.model, state.livery);
                    if (plane.low) paintF15(plane.low, state.livery);
                } else paintAircraft(plane.model, state.livery);
            }
            // Immatriculation choisie ou changée en cours de partie (peinte sur le Cessna)
            if (this.registrationFor && plane.type !== 'f15') setRegistration(plane.model, this.registrationFor(id));

            // Crash : explosion à l'endroit de l'impact, l'avion disparaît jusqu'à ce que le joueur reparte
            if (state.crashes > plane.crashes) this.dispatchEvent(new CustomEvent('crash', {
                detail: { name: state.name, position: this._targetPosition.clone() },
            }));
            plane.crashes = state.crashes;
            group.visible = !state.crashed && plane.ready;
            // Avion touché : traînée de fumée (de plus en plus épaisse), flammes s'il brûle
            const smoke = state.crashed ? 0 : Math.min(1, state.damage / 70);
            if (smoke > 0 || plane.trail) {
                plane.trail ??= new SmokeTrail(this.scene);
                _smokePoint.copy(SMOKE_SOURCE[plane.type] ?? SMOKE_SOURCE.c172).applyQuaternion(group.quaternion).add(group.position);
                plane.trail.update(delta, _smokePoint, smoke, state.burning && !state.crashed, this._velocity);
            }
            // Feux : les interrupteurs de ce joueur (phare, navigation, anticollision, strobes)
            plane.lights.setSwitches(state.lights);
            if (camera && group.visible) {
                group.updateMatrixWorld();
                plane.lights.update(camera, time + plane.lightPhase);
            }

            // Moteur (créé dès que le son est débloqué par une action du joueur)
            plane.engine ??= (plane.type === 'f15' ? this.jetSound : this.engineSound)?.createRemote() ?? null;
            plane.engine?.update(group.position, state.t, state.crashed ? 0 : this.engineVolume, delta, state.rpm === null ? null : plane.rpm);

            // Étiquette
            const label = plane.label;
            const distance = ownPosition ? group.position.distanceTo(ownPosition) : Infinity;
            label.sprite.visible = this.showLabels && !state.crashed && plane.ready && distance > LABEL_MIN_DISTANCE;
            label.sprite.position.copy(group.position).y += LABEL_OFFSET;
            if (refreshLabels || plane.label._text === '') {
                const altitude = Math.max(0, (group.position.y - this._altitudeOffset(state)) / FT);
                const detail = `${formatNM(distance)} NM · `
                    + `${(Math.round(altitude / 10) * 10).toLocaleString('fr-FR')} ft`;
                label.draw(state.name, detail, this.colorFor?.(id, state) ?? RemotePlayers.color(state.livery), this.speaking.has(id), offline);
            }
        }
        this._updateLandingLights(ownPosition);
    }

    // Projecteurs de la réserve : à créer dès qu'on entre dans une partie (au menu), pas à l'arrivée du premier joueur.
    // Toute lumière ajoutée à la scène oblige three.js à recompiler les shaders de TOUS les matériaux : créés en vol,
    // à l'arrivée du premier autre joueur, ils figeaient le jeu une à plusieurs secondes
    ensureSpots() {
        if (this._spots) return false;
        this._spots = Array.from({ length: LANDING_SPOTS }, () => {
            const L = LANDING_LIGHT;
            const spot = new SpotLight(0xfff3d6, 0, L.distance, L.angle, L.penumbra, L.decay);
            this.scene.add(spot, spot.target);
            return spot;
        });
        return true;
    }

    // Projecteurs de la réserve placés sur les avions phare allumé les plus proches (de nuit)
    _updateLandingLights(ownPosition) {
        if (!this.planes.size && !this._spots) return;
        this.ensureSpots();
        const lit = this.night >= 0.5 ? [...this.planes.entries()]
            .filter(([id, plane]) => plane.group.visible && this.multiplayer.players.get(id)?.lights.land)
            .map(([, plane]) => plane)
            .sort((a, b) => (ownPosition ? a.group.position.distanceTo(ownPosition) - b.group.position.distanceTo(ownPosition) : 0))
            : [];
        this._spots.forEach((spot, i) => {
            const plane = lit[i];
            spot.intensity = plane ? LANDING_LIGHT.intensity : 0;
            if (!plane) return;
            const frame = plane.lights.parent;   // repère redressé de l'extérieur de l'avion (comme pour le joueur)
            frame.updateMatrixWorld();
            spot.position.fromArray(LANDING_LIGHT.position).applyMatrix4(frame.matrixWorld);
            spot.target.position.fromArray(LANDING_LIGHT.target).applyMatrix4(frame.matrixWorld);
            spot.target.updateMatrixWorld();
        });
    }

    // Avion retiré : ce qui lui appartient est rendu à la carte graphique (os des pétales des tuyères, matériaux et
    // géométries propres à sa copie : livrée, feux…), pas ce qu'il partage avec le modèle d'origine. Avant, chaque
    // joueur qui partait et revenait (page cachée plus de 8 s, coupure réseau, changement d'avion) en laissait un peu
    _release(plane) {
        const templates = plane.type === 'f15' ? [this.jetTemplate, this.jetLowTemplate] : [this.template];
        this._shared ??= new WeakMap();
        const shared = new Set();
        for (const template of templates) {
            if (!template) continue;
            if (!this._shared.has(template)) {
                const set = new Set();
                template.traverse((o) => {
                    if (o.geometry) set.add(o.geometry);
                    for (const m of [o.material].flat()) if (m) set.add(m);
                });
                this._shared.set(template, set);
            }
            for (const item of this._shared.get(template)) shared.add(item);
        }
        const release = (o) => {
            if (o.isSkinnedMesh) o.skeleton?.dispose();
            if (o.geometry && !shared?.has(o.geometry)) o.geometry.dispose();
            for (const m of [o.material].flat()) if (m && !shared?.has(m)) m.dispose();
        };
        plane.group.traverse(release);
        if (plane.low && !plane.low.parent) plane.low.traverse(release);
        if (!plane.model.parent) plane.model.traverse(release);
    }

    // Crée / supprime les avions selon la liste des joueurs
    _sync() {
        if (!this.template) return;
        const players = this.multiplayer.players;

        for (const [id, plane] of this.planes) {
            // Parti, ou passé à un autre avion (Cessna <-> F-15) : son avion est retiré (puis recréé ci-dessous)
            if (!players.has(id) || (players.get(id).aircraft ?? 'c172') !== plane.type) {
                this.scene.remove(plane.group, plane.label.sprite);
                // Étiquette gardée pour le prochain joueur (voir _spareLabels), pas libérée
                if (this._spareLabels.length < 16) this._spareLabels.push(plane.label);
                else plane.label.dispose();
                plane.engine?.dispose();
                // Avion gardé en réserve pour le prochain joueur sur le même avion (voir _sparePlanes), pas libéré
                const spares = this._sparePlanes[plane.type] ??= [];
                plane.trail?.dispose();   // (fumée : refaite s'il est de nouveau touché)
                plane.trail = null;
                if (spares.length < SPARE_PLANES) spares.push(plane);
                else this._release(plane);
                this.planes.delete(id);
            }
        }
        for (const [id, player] of players) {
            if (this.planes.has(id)) continue;
            const type = player.aircraft === 'f15' ? 'f15' : 'c172';
            if (type === 'f15' && !this.jetTemplate) {
                this.onJetNeeded?.();   // modèle du F-15 chargé à la demande, l'avion apparaît ensuite
                continue;
            }
            const spare = this._sparePlanes[type]?.pop();
            if (spare) {
                this._reuse(id, player, spare);
                continue;
            }
            const model = type === 'f15' ? cloneF15(this.jetTemplate) : this.template.clone();
            model.visible = true; // le modèle d'origine est masqué en vue cabine
            model.traverse((child) => {
                if (child.isMesh) child.castShadow = true;
            });
            // F-15 : version fusionnée en plus (configuration lisse, voir update), cachée au départ
            // (faite seulement quand un autre joueur vole en F-15 : en solo, ni le temps de la construire ni sa mémoire,
            // ~10 Mo, qui comptent sur téléphone et tablette)
            if (type === 'f15') this.jetLowTemplate ??= lowDetailF15(this.jetTemplate);
            const low = type === 'f15' ? cloneF15(this.jetLowTemplate) : null;
            if (low) {
                low.traverse((child) => { if (child.isMesh) child.castShadow = true; });
                paintF15(low, player.livery);
            }
            if (type === 'f15') paintF15(model, player.livery);
            else {
                paintAircraft(model, player.livery);
                if (this.registrationFor) setRegistration(model, this.registrationFor(id));
            }
            const group = new Group();
            group.add(model);   // (version fusionnée attachée à sa place quand elle sert, voir update)
            // Feux : les mêmes que sur notre avion, cachés par leur propre avion quand il est entre eux et nous
            const airframe = new Group();
            group.add(airframe);
            const lights = new AircraftLights(airframe, type === 'f15' ? { layout: F15_LIGHT_LAYOUT } : {});
            lights.setOccluder(model);
            lights.setNight(this.night);
            // Étiquettes réutilisées : en libérer une libérait aussi son shader quand c'était la dernière, et l'arrivée
            // suivante d'un joueur le recompilait à la première image où elle se voyait (à-coup)
            const label = this._spareLabels.pop() ?? new Label();
            label._text = '';
            group.userData.transient = label.sprite.userData.transient = true;   // (shaders préparés à part, voir prepare)
            this.scene.add(group, label.sprite);
            const plane = {
                group, model, low, label, type, anim: { time: 0 },
                propeller: model.getObjectByName('Propeller_Cone'),
                engine: null,
                lights,
                lightPhase: Math.random() * 10,   // clignotements décalés d'un avion à l'autre
                livery: player.livery,
                crashes: player.crashes,   // les crashs d'avant notre arrivée ne font pas exploser l'avion
                fresh: true,
                ready: !this.prepare,
            };
            this.planes.set(id, plane);
            this._prepare(plane);
        }
    }

    // Avion d'un joueur parti, repris pour un joueur qui arrive (ou le même qui revient) : repeint à sa livrée, remis à
    // zéro. Ses matériaux et ses shaders sont déjà prêts : pas de copie du modèle ni de compilation
    _reuse(id, player, plane) {
        const label = this._spareLabels.pop() ?? new Label();
        label._text = '';
        label.sprite.userData.transient = true;
        if (plane.livery !== player.livery) {
            if (plane.type === 'f15') {
                paintF15(plane.model, player.livery);
                if (plane.low) paintF15(plane.low, player.livery);
            } else paintAircraft(plane.model, player.livery);
        }
        if (this.registrationFor && plane.type !== 'f15') setRegistration(plane.model, this.registrationFor(id));
        plane.lights.setNight(this.night);
        Object.assign(plane, {
            label, anim: { time: 0 }, engine: null, rpm: undefined, livery: player.livery, crashes: player.crashes,
            fresh: true, ready: !this.prepare, lightPhase: Math.random() * 10,
        });
        this.scene.add(plane.group, label.sprite);
        this.planes.set(id, plane);
        this._prepare(plane);
    }

    // Caché le temps que ses shaders se compilent en arrière-plan (quelques dixièmes de seconde) : le jeu continue de
    // tourner, au lieu de figer à la première image qui le montre (avion repris : déjà prêts, c'est immédiat)
    _prepare(plane) {
        if (!this.prepare) return;
        const { group, label } = plane;
        group.visible = false;
        // (version non affichée — fusionnée ou complète — et étiquette attachées le temps de l'appel : prepare compile tout
        // de suite ce qui est attaché. Sans l'étiquette, son shader se compilait à la première image où elle entrait dans
        // la vue, en plein vol : à-coup mesuré en partie à deux, ~1 s en rendu logiciel)
        const detached = [plane.model, plane.low].filter((o) => o && !o.parent);
        for (const o of detached) group.add(o);
        group.add(label.sprite);
        const preparing = this.prepare(group);
        for (const o of detached) group.remove(o);
        this.scene.add(label.sprite);
        preparing.catch(() => {}).finally(() => { plane.ready = true; });
    }
}

export { RemotePlayers, formatNM };
