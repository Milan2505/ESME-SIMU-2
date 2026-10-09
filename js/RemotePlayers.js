import {
    CanvasTexture,
    Color,
    Group,
    Quaternion,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3
} from 'three';

const SMOOTHING = 8;            // lissage de l'orientation
const POSITION_CORRECTION = 3;  // rapidité du recalage sur la position prédite
const MAX_EXTRAPOLATION = 1;    // prédiction au plus 1 s après le dernier message (s)
const SNAP_DISTANCE = 60;       // au-delà, on replace l'avion directement (réinitialisation…) (m)

// Couleur stable pour un joueur, tirée de son identifiant
function playerColor(id) {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return new Color().setHSL(((hash >>> 0) % 360) / 360, 0.75, 0.5);
}

function createLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.roundRect(0, 8, 256, 48, 12);
    ctx.fill();
    ctx.font = 'bold 30px DejaVu Sans Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.fillText(text, 128, 33);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, fog: false, depthWrite: false }));
    sprite.scale.set(8, 2, 1);
    sprite.position.y = 4;
    return sprite;
}

// Affiche les avions des autres joueurs à partir de l'état reçu par Multiplayer
class RemotePlayers {
    constructor(scene, multiplayer) {
        this.scene = scene;
        this.multiplayer = multiplayer;
        this.template = null;          // modèle 3D de l'avion (fourni quand il est chargé)
        this.planes = new Map();       // id -> { group, propeller }
        this._targetPosition = new Vector3();
        this._targetQuaternion = new Quaternion();
        this._velocity = new Vector3();

        multiplayer.addEventListener('players', () => this._sync());
    }

    setTemplate(model) {
        this.template = model;
        this._sync();
    }

    update(delta) {
        const now = performance.now();
        const positionAlpha = 1 - Math.exp(-POSITION_CORRECTION * delta);
        const rotationAlpha = 1 - Math.exp(-SMOOTHING * delta);

        for (const [id, plane] of this.planes) {
            const state = this.multiplayer.players.get(id);
            if (!state) continue;

            // Prédiction : position reçue + vitesse × ancienneté du message
            // (temps depuis la réception + attente sur le serveur + trajets réseau aller/retour)
            const age = Math.min(MAX_EXTRAPOLATION,
                (now - state.receivedAt + (state.age ?? 0)) / 1000 + this.multiplayer.latency);
            this._velocity.fromArray(state.v ?? [0, 0, 0]);
            this._targetPosition.fromArray(state.p).addScaledVector(this._velocity, age);
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
        }
    }

    // Crée / supprime les avions selon la liste des joueurs
    _sync() {
        if (!this.template) return;
        const players = this.multiplayer.players;

        for (const [id, plane] of this.planes) {
            if (!players.has(id)) {
                this.scene.remove(plane.group);
                plane.group.traverse((child) => child.material?.map?.dispose());
                this.planes.delete(id);
            }
        }
        for (const [id, player] of players) {
            if (this.planes.has(id)) continue;
            const color = playerColor(id);
            const model = this.template.clone();
            model.visible = true; // le modèle d'origine est masqué en vue cabine
            // Peinture : la couleur du joueur remplace le blanc du fuselage
            model.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = true;
                if (child.material.name === 'White') {
                    child.material = child.material.clone();
                    child.material.color.copy(color);
                }
            });
            const group = new Group();
            group.add(model, createLabel(player.name, color));
            this.scene.add(group);
            this.planes.set(id, { group, propeller: model.getObjectByName('Propeller_Cone'), fresh: true });
        }
    }
}

export { RemotePlayers };
