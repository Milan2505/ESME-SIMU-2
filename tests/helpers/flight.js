// Banc d'essai du modèle de vol hors navigateur (node --test) : un avion seul au-dessus d'un sol plat, sans vent, hasard
// à graine fixe, et de petits automatismes de test (tenue de vitesse, d'altitude, d'inclinaison) pour mesurer des
// performances stabilisées. Unités SI (m, m/s, rad) ; conversions ci-dessous.
import { Object3D, Vector3 } from 'three';
import { FlightModel } from '../../js/FlightModel.js';
import { RigidBodyModel } from '../../js/RigidBodyModel.js';
import { CESSNA_172 } from '../../js/Cessna172.js';
import { seededRandom } from '../../js/Random.js';

export const KT = 0.514444;        // m/s par nœud
export const FT = 0.3048;          // m par pied
export const FPM = FT / 60;        // m/s par ft/min
export const G = 9.81;
export const DT = 1 / 60;          // pas d'appel (le modèle sous-découpe lui-même à 1/120 s)
export const deg = (d) => d * Math.PI / 180;

const _front = new Vector3(), _right = new Vector3(), _up = new Vector3();

// Avion (copie des caractéristiques : jamais la constante partagée) posé au sol en (0, 0, 0), nez au nord (-z)
// model : 'simplifie' (FlightModel) ou 'realiste' (RigidBodyModel, 6 axes) ; par défaut, celui de TEST_MODEL (variable
// d'environnement), sinon le simplifié
export const MODELS = ['simplifie', 'realiste'];
export function makeAircraft({ aircraft = CESSNA_172, seed = 1, surface = 'asphalt', groundHeight = () => 0, model: kind = process.env.TEST_MODEL ?? 'simplifie' } = {}) {
    const object = new Object3D();
    const model = kind === 'realiste' ? new RigidBodyModel(object, { ...aircraft }) : new FlightModel(object, { ...aircraft });
    model.groundHeight = groundHeight;
    model.surfaceAt = () => surface;
    model.random = seededRandom(seed);
    model.placeOnGround();
    model.restart(true);
    return { object, model, kind };
}

// Avion en vol stabilisé : altitude (m), vitesse (m/s), cap nord, volets rentrés, trim de décollage
export function airborne(fixture, { altitude = 300, speed = 50, throttle = 0.6 } = {}) {
    const { object, model } = fixture;
    object.position.set(0, altitude, 0);
    object.quaternion.identity();
    model.restart(false);
    model.velocity.set(0, 0, -speed);
    model.airspeed = speed;
    model.throttle = throttle;
    return fixture;
}

// Fait avancer de seconds secondes ; pilot(t) peut agir à chaque pas (commandes), until(t) arrête plus tôt (vrai)
export function run(fixture, seconds, { pilot, until } = {}) {
    const { model } = fixture;
    let t = 0;
    while (t < seconds && !model.crashed) {
        pilot?.(t);
        model.step(DT);
        t += DT;
        if (until?.(t)) break;
    }
    return t;
}

// Attitude : inclinaison (rad, + = aile gauche basse... non : + = penché à gauche, comme FlightModel), assiette, cap (°)
export function attitude(fixture) {
    const q = fixture.object.quaternion;
    _front.set(0, 0, -1).applyQuaternion(q);
    _right.set(1, 0, 0).applyQuaternion(q);
    _up.set(0, 1, 0).applyQuaternion(q);
    return {
        bank: Math.atan2(_right.y, _up.y),
        pitch: Math.asin(Math.max(-1, Math.min(1, _front.y))),
        heading: (Math.atan2(_front.x, -_front.z) * 180 / Math.PI + 360) % 360,
    };
}

// Automatismes de test : chacun rend une fonction pilot(t) à passer à run(). Ils agissent sur model.controls et
// model.throttle, comme le ferait un joueur ; gains modestes et intégrateurs bornés (pas de pompage)
// speedHold : vitesse tenue au manche ; indicated : vitesse lue au badin (KIAS, comme les vitesses du manuel) au lieu de la
// vitesse vraie
export function speedHold(fixture, target, { gain = 0.1, integral = 0.01, damping = 0.3, indicated = false } = {}) {
    if (fixture.kind === 'realiste') return speedHoldByPitch(fixture, target, { indicated });
    let acc = 0, previous = null;
    return () => {
        const speed = indicated ? fixture.model.indicatedSpeed : fixture.model.airspeed;
        const error = speed - target;                    // trop vite : on tire (pitch > 0 = cabrer)
        const rate = previous === null ? 0 : (speed - previous) / DT;   // accélération : on anticipe
        previous = speed;
        acc = Math.max(-0.8, Math.min(0.8, acc + error * integral * DT));
        fixture.model.controls.pitch = Math.max(-1, Math.min(1, gain * error + acc + damping * rate));
    };
}
export function altitudeHold(fixture, target, { gain = 0.03, integral = 0.003, damping = 0.1 } = {}) {   // altitude tenue au manche
    let acc = 0;
    return () => {
        const { model, object } = fixture;
        const error = target - object.position.y;        // trop bas : on tire
        acc = Math.max(-0.6, Math.min(0.6, acc + error * integral * DT));
        model.controls.pitch = Math.max(-1, Math.min(1, gain * error + acc - damping * model.velocity.y));
    };
}
export function coordinate(fixture, { gain = 0.3, integral = 0.3 } = {}) {   // bille au milieu, au palonnier
    let acc = 0;
    return () => {
        const side = fixture.model.sideAcceleration;     // + = poussé vers la droite : bille à gauche, pied gauche (yaw > 0)
        acc = Math.max(-1, Math.min(1, acc + side * integral * DT));
        fixture.model.controls.yaw = Math.max(-1, Math.min(1, gain * side + acc));
    };
}
export function speedWithThrottle(fixture, target, { gain = 0.1, integral = 0.02 } = {}) {   // vitesse tenue aux gaz
    let acc = 0;
    return () => {
        const error = target - fixture.model.airspeed;   // trop lent : plus de gaz
        acc = Math.max(-0.6, Math.min(0.6, acc + error * integral * DT));
        fixture.model.throttle = Math.max(0, Math.min(1, 0.6 + gain * error + acc));
    };
}
export function bankHold(fixture, target, { gain = 2.5, damping = 1.2 } = {}) {   // inclinaison tenue aux ailerons
    let previous = null;
    return () => {
        const { bank } = attitude(fixture);
        const rate = previous === null ? 0 : (bank - previous) / DT;
        previous = bank;
        fixture.model.controls.roll = Math.max(-1, Math.min(1, gain * (target - bank) - damping * rate));
    };
}
export function combine(...pilots) {
    return (t) => { for (const pilot of pilots) pilot(t); };
}

// Moyenne d'une grandeur sur les seconds dernières secondes d'un vol (après un temps d'établissement)
export function average(fixture, seconds, read, pilot) {
    let sum = 0, n = 0;
    run(fixture, seconds, { pilot: (t) => { pilot?.(t); sum += read(); n++; } });
    return sum / n;
}

// Rotation au décollage comme un pilote : manche au neutre jusqu'à la vitesse de rotation (indiquée), puis le nez est levé
// vers une assiette (degrés) sans à-coup. (Les deux modèles : au modèle réaliste, une traction fixe au manche fait monter
// le nez à plus de 30°/s, ce qu'aucun pilote ne fait)
export function rotationPilot(fixture, { rotateKt = 51, pitchDeg = 8, gain = 0.06, damping = 0.04, base = 0.1 } = {}) {
    let previous = null;
    return () => {
        const { model } = fixture;
        const { pitch } = attitude(fixture);
        const rate = previous === null ? 0 : (pitch - previous) / DT;
        previous = pitch;
        if (model.indicatedSpeed < rotateKt * KT) { model.controls.pitch = 0; return; }
        const error = (pitchDeg * Math.PI / 180 - pitch) * 180 / Math.PI;
        model.controls.pitch = Math.max(-0.5, Math.min(0.8, base + gain * error - damping * rate * 180 / Math.PI));
    };
}
// Assiette tenue au manche (degrés)
export function pitchHold(fixture, pitchDeg, { gain = 0.06, damping = 0.04, base = 0.05 } = {}) {
    let previous = null;
    return () => {
        const { pitch } = attitude(fixture);
        const rate = previous === null ? 0 : (pitch - previous) / DT;
        previous = pitch;
        fixture.model.controls.pitch = Math.max(-1, Math.min(1, base + gain * (pitchDeg - pitch * 180 / Math.PI) - damping * rate * 180 / Math.PI));
    };
}
// Cap tenu au palonnier (degrés, comme attitude().heading) : axe de piste au décollage, pied droit en montée
export function headingHold(fixture, headingDeg, { gain = 0.08, damping = 0.15 } = {}) {
    let previous = null;
    return () => {
        const { heading } = attitude(fixture);
        const error = ((headingDeg - heading + 540) % 360) - 180;          // > 0 : il faut tourner à droite
        const rate = previous === null ? 0 : (((heading - previous + 540) % 360) - 180) / DT;
        previous = heading;
        fixture.model.controls.yaw = Math.max(-1, Math.min(1, -(gain * error - damping * rate)));   // yaw + = à gauche
    };
}
// Modèle réaliste : la vitesse se tient par l'assiette (boucle externe : assiette visée selon l'écart de vitesse, son
// intégrale et l'accélération), l'assiette par le manche (boucle interne, amortie par la vitesse de tangage). Au modèle
// réaliste, le manche braque la profondeur : une action directe du manche sur la vitesse ferait osciller la trajectoire
function speedHoldByPitch(fixture, target, { indicated = false, gain = 0.4, integral = 0.02, damping = 2.5, inner = 0.05 } = {}) {
    let acc = null, previous = null, previousPitch = null;
    return () => {
        const { model } = fixture;
        const speed = indicated ? model.indicatedSpeed : model.airspeed;
        const { pitch } = attitude(fixture);
        acc ??= pitch * 180 / Math.PI;                               // départ : assiette actuelle
        const error = speed - target;                                // trop vite : on lève le nez
        const rate = previous === null ? 0 : (speed - previous) / DT;
        previous = speed;
        acc = Math.max(-20, Math.min(25, acc + error * integral * DT * 10));
        const pitchTarget = Math.max(-20, Math.min(25, acc + gain * error + damping * rate));
        const pitchRate = previousPitch === null ? 0 : (pitch - previousPitch) / DT;
        previousPitch = pitch;
        const command = inner * (pitchTarget - pitch * 180 / Math.PI) - 0.05 * pitchRate * 180 / Math.PI;
        // (profondeur en effort dans les deux sens, voir RigidBodyModel : gain compensé)
        const elevatorGain = Math.min(1, 15 * 47.88 / Math.max(1, 0.5 * 1.225 * model.calibratedSpeed ** 2));
        model.controls.pitch = Math.max(-1, Math.min(1, command / elevatorGain));
    };
}
