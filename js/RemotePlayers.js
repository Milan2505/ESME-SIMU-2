import {
    CanvasTexture,
    Group,
    Quaternion,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3
} from 'three';
import { LIVERIES, paintAircraft } from './Liveries.js';

const SMOOTHING = 8;            // lissage de l'orientation
const POSITION_CORRECTION = 3;  // rapidité du recalage sur la position prédite
const MAX_EXTRAPOLATION = 1;    // prédiction au plus 1 s après le dernier message (s)
const SNAP_DISTANCE = 60;       // au-delà, on replace l'avion directement (réinitialisation…) (m)
const LABEL_HEIGHT = 0.065;     // hauteur de l'étiquette : ~6,5 % de la hauteur de l'écran, quelle que soit la distance
const LABEL_OFFSET = 3;         // étiquette au-dessus de l'avion (m)
const LABEL_REFRESH = 0.5;      // distance et altitude de l'étiquette mises à jour toutes les 0,5 s
const LABEL_MIN_DISTANCE = 12;  // tout près : étiquette masquée (elle cacherait l'avion)
const FT = 0.3048, NM = 1852;

const _forward = new Vector3();

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

    draw(name, detail, color, speaking) {
        const text = `${name}|${detail}|${color}|${speaking}`;
        if (text === this._text) return;
        this._text = text;
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0, 0, 512, 168);
        // Cadre et pointe
        ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
        ctx.strokeStyle = speaking ? '#39ff6a' : color;
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
        ctx.fillStyle = speaking ? '#39ff6a' : color;
        ctx.fill();
        // Texte
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'white';
        ctx.font = 'bold 54px DejaVu Sans Mono, monospace';
        ctx.fillText(name, 256, 50, 470);
        ctx.font = 'bold 34px DejaVu Sans Mono, monospace';
        ctx.fillStyle = speaking ? '#39ff6a' : '#d8dde3';
        ctx.fillText(speaking ? 'RADIO' : detail, 256, 104, 470);
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
    constructor(scene, multiplayer, { engineSound = null, altitudeOffset = 0 } = {}) {
        super();
        this.scene = scene;
        this.multiplayer = multiplayer;
        this.engineSound = engineSound;
        this.altitudeOffset = altitudeOffset;   // hauteur de l'avion au-dessus du sol, roues posées (m)
        this.showLabels = true;
        this.engineVolume = 1;                  // moins fort en cabine
        this.template = null;          // modèle 3D de l'avion (fourni quand il est chargé)
        this.planes = new Map();       // id -> { group, model, label, propeller, engine, livery, crashes, … }
        this.speaking = new Set();     // joueurs qui parlent à la radio
        this._targetPosition = new Vector3();
        this._targetQuaternion = new Quaternion();
        this._velocity = new Vector3();
        this._labelTimer = 0;

        multiplayer.addEventListener('players', () => this._sync());
    }

    setTemplate(model) {
        this.template = model;
        this._sync();
    }

    // Couleur d'affichage d'un joueur (étiquette, carte, liste)
    static color(livery) {
        return (LIVERIES[livery] ?? LIVERIES.origine).color;
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
                color: RemotePlayers.color(state.livery),
                position: plane.group.position,
                heading: (Math.atan2(_forward.x, -_forward.z) * 180 / Math.PI + 360) % 360,
                altitude: (plane.group.position.y - this.altitudeOffset) / FT,
                crashed: state.crashed,
                speaking: this.speaking.has(id),
            });
        }
        return result;
    }

    // ownPosition : position de l'avion du joueur (distance affichée sur les étiquettes)
    update(delta, ownPosition) {
        const now = performance.now();
        const positionAlpha = 1 - Math.exp(-POSITION_CORRECTION * delta);
        const rotationAlpha = 1 - Math.exp(-SMOOTHING * delta);
        this._labelTimer -= delta;
        const refreshLabels = this._labelTimer <= 0;
        if (refreshLabels) this._labelTimer = LABEL_REFRESH;

        for (const [id, plane] of this.planes) {
            const state = this.multiplayer.players.get(id);
            if (!state) continue;

            // Prédiction : position reçue + vitesse × ancienneté du message
            // (temps depuis la réception + attente sur le serveur + trajets réseau aller/retour)
            const age = Math.min(MAX_EXTRAPOLATION,
                (now - state.receivedAt + (state.age ?? 0)) / 1000 + this.multiplayer.latency);
            this._velocity.fromArray(state.v ?? [0, 0, 0]);
            this._targetPosition.fromArray(state.p).addScaledVector(this._velocity, state.crashed ? 0 : age);
            this._targetQuaternion.fromArray(state.q);

            const group = plane.group;
            if (plane.fresh || group.position.distanceTo(this._targetPosition) > SNAP_DISTANCE) {
                group.position.copy(this._targetPosition);
                group.quaternion.copy(this._targetQuaternion);
                plane.fresh = false;
            } else {
                // L'avion avance avec sa vitesse, puis se recale en douceur sur la prédiction
                group.position.addScaledVector(this._velocity, delta).lerp(this._targetPosition, positionAlpha);
                group.quaternion.slerp(this._targetQuaternion, rotationAlpha);
            }
            if (plane.propeller) plane.propeller.rotation.z += (20 + 80 * state.t) * delta;

            // Livrée changée en cours de partie
            if (state.livery !== plane.livery) {
                plane.livery = state.livery;
                paintAircraft(plane.model, state.livery);
            }

            // Crash : explosion à l'endroit de l'impact, l'avion disparaît jusqu'à ce que le joueur reparte
            if (state.crashes > plane.crashes) this.dispatchEvent(new CustomEvent('crash', {
                detail: { name: state.name, position: this._targetPosition.clone() },
            }));
            plane.crashes = state.crashes;
            group.visible = !state.crashed;

            // Moteur (créé dès que le son est débloqué par une action du joueur)
            plane.engine ??= this.engineSound?.createRemote() ?? null;
            plane.engine?.update(group.position, state.t, state.crashed ? 0 : this.engineVolume, delta);

            // Étiquette
            const label = plane.label;
            const distance = ownPosition ? group.position.distanceTo(ownPosition) : Infinity;
            label.sprite.visible = this.showLabels && !state.crashed && distance > LABEL_MIN_DISTANCE;
            label.sprite.position.copy(group.position).y += LABEL_OFFSET;
            if (refreshLabels || plane.label._text === '') {
                const altitude = Math.max(0, (group.position.y - this.altitudeOffset) / FT);
                const detail = `${formatNM(distance)} NM · `
                    + `${(Math.round(altitude / 10) * 10).toLocaleString('fr-FR')} ft`;
                label.draw(state.name, detail, RemotePlayers.color(state.livery), this.speaking.has(id));
            }
        }
    }

    // Crée / supprime les avions selon la liste des joueurs
    _sync() {
        if (!this.template) return;
        const players = this.multiplayer.players;

        for (const [id, plane] of this.planes) {
            if (!players.has(id)) {
                this.scene.remove(plane.group, plane.label.sprite);
                plane.label.dispose();
                plane.engine?.dispose();
                this.planes.delete(id);
            }
        }
        for (const [id, player] of players) {
            if (this.planes.has(id)) continue;
            const model = this.template.clone();
            model.visible = true; // le modèle d'origine est masqué en vue cabine
            model.traverse((child) => {
                if (child.isMesh) child.castShadow = true;
            });
            paintAircraft(model, player.livery);
            const group = new Group();
            group.add(model);
            const label = new Label();
            this.scene.add(group, label.sprite);
            this.planes.set(id, {
                group, model, label,
                propeller: model.getObjectByName('Propeller_Cone'),
                engine: null,
                livery: player.livery,
                crashes: player.crashes,   // les crashs d'avant notre arrivée ne font pas exploser l'avion
                fresh: true,
            });
        }
    }
}

export { RemotePlayers, formatNM };
