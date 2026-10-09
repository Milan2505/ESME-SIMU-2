import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    MathUtils,
    Mesh,
    Vector3
} from 'three';

// Gouvernes animées du Cessna (asset/cessna.glb). Le modèle est d'un seul tenant : on découpe sa géométrie
// le long de la ligne de charnière de chaque gouverne, et la partie arrière devient une pièce mobile.
// Coordonnées dans le repère du modèle (x vers la droite, y vers le haut, z vers la queue).
//   region : boîte où chercher les triangles de la gouverne
//   hinge  : deux points de la ligne de charnière
//   down   : direction où part le bord de fuite quand la gouverne est braquée positivement
const SURFACES = {
    aileronLeft:  { region: [[-5.6, 1.0, -1.0], [-2.93, 1.5, 1.0]], hinge: [[-2.94, 1.26, 0.33], [-5.51, 1.31, 0.08]], down: [0, -1, 0] },
    aileronRight: { region: [[2.93, 1.0, -1.0], [5.6, 1.5, 1.0]],   hinge: [[2.94, 1.26, 0.33], [5.51, 1.31, 0.08]],   down: [0, -1, 0] },
    flapLeft:     { region: [[-2.95, 1.0, -1.0], [-0.72, 1.5, 1.0]], hinge: [[-0.75, 1.2, 0.36], [-2.94, 1.24, 0.36]], down: [0, -1, 0] },
    flapRight:    { region: [[0.72, 1.0, -1.0], [2.95, 1.5, 1.0]],   hinge: [[0.75, 1.2, 0.36], [2.94, 1.24, 0.36]],   down: [0, -1, 0] },
    elevator:     { region: [[-2.4, 1.0, 4.8], [2.4, 1.45, 6.6]],    hinge: [[-2.3, 1.22, 5.8], [2.3, 1.22, 5.8]],     down: [0, -1, 0], minAbsX: 0.12 },
    rudder:       { region: [[-0.15, 1.72, 4.8], [0.15, 3.5, 7.3]],  hinge: [[0, 1.7, 6.64], [0, 3.42, 6.6]],          down: [-1, 0, 0] },
};

// Débattements max (degrés)
const AILERON_TRAVEL = 20;
const ELEVATOR_TRAVEL = 25;
const RUDDER_TRAVEL = 25;
const FLAP_TRAVEL = 35;
const OVERLAP = 0.06;   // la partie fixe dépasse un peu sous la gouverne : pas de jour à la charnière (m)

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

function insideRegion(region, p, minAbsX = 0) {
    const [min, max] = region;
    return p.x >= min[0] && p.x <= max[0] && p.y >= min[1] && p.y <= max[1] && p.z >= min[2] && p.z <= max[2]
        && Math.abs(p.x) >= minAbsX;
}

// Coupe un triangle (sommets + normales) par un plan : renvoie les polygones devant / derrière
function clipTriangle(points, normals, planePoint, planeNormal) {
    const front = [], back = [];
    const d = points.map((p) => _a.subVectors(p, planePoint).dot(planeNormal));
    for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        const vertex = { p: points[i], n: normals[i] };
        (d[i] >= 0 ? front : back).push(vertex);
        if ((d[i] > 0 && d[j] < 0) || (d[i] < 0 && d[j] > 0)) {
            const t = d[i] / (d[i] - d[j]);
            const cut = { p: points[i].clone().lerp(points[j], t), n: normals[i].clone().lerp(normals[j], t).normalize() };
            front.push(cut);
            back.push(cut);
        }
    }
    return { front, back };
}

// Ajoute un polygone convexe (en éventail) aux tableaux de positions / normales
function pushPolygon(polygon, positions, normals, offset) {
    for (let i = 1; i + 1 < polygon.length; i++) {
        for (const v of [polygon[0], polygon[i], polygon[i + 1]]) {
            positions.push(v.p.x - offset.x, v.p.y - offset.y, v.p.z - offset.z);
            normals.push(v.n.x, v.n.y, v.n.z);
        }
    }
}

function geometryFrom(positions, normals) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    return geometry;
}

class ControlSurfaces {
    // model : modèle du Cessna chargé par GLTFLoader ; exclude : objet à ne pas découper (l'hélice)
    constructor(model, exclude = null) {
        this.pivots = {};
        this.deflections = { aileron: 0, elevator: 0, rudder: 0, flaps: 0 }; // -1 -> 1 (volets : 0 -> 1)

        const meshes = [];
        model.traverse((child) => {
            if (child.isMesh && !(exclude && isDescendant(child, exclude))) meshes.push(child);
        });

        for (const [name, surface] of Object.entries(SURFACES)) {
            const a = new Vector3(...surface.hinge[0]), b = new Vector3(...surface.hinge[1]);
            const axis = b.clone().sub(a).normalize();
            const down = new Vector3(...surface.down);
            // Plan de charnière : contient l'axe, sa normale pointe vers le bord de fuite (+z)
            const planeNormal = new Vector3().crossVectors(axis, down).normalize();
            if (planeNormal.z < 0) planeNormal.negate();
            // Sens de rotation : un angle positif envoie le bord de fuite vers "down"
            if (new Vector3().crossVectors(axis, planeNormal).dot(down) < 0) axis.negate();

            const pivot = new Group();
            pivot.name = name;
            pivot.position.copy(a);
            pivot.userData.axis = axis;

            for (const mesh of meshes) {
                const split = this._split(mesh, surface, a, planeNormal);
                if (!split) continue;
                mesh.geometry.dispose();
                mesh.geometry = split.remainder;
                mesh.material.side = DoubleSide; // l'aile découpée est ouverte à la charnière
                const part = new Mesh(split.surface, mesh.material);
                part.castShadow = true;
                pivot.add(part);
            }
            if (pivot.children.length) {
                meshes[0].parent.add(pivot);
                this.pivots[name] = pivot;
            }
        }
    }

    _split(mesh, surface, hingePoint, planeNormal) {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const position = geometry.attributes.position, normal = geometry.attributes.normal;
        const keep = { positions: [], normals: [] }, moving = { positions: [], normals: [] };
        const zero = new Vector3();
        let changed = false;

        for (let i = 0; i < position.count; i += 3) {
            const points = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, i + k));
            const normals = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(normal, i + k));
            _b.copy(points[0]).add(points[1]).add(points[2]).divideScalar(3);
            if (!insideRegion(surface.region, _b, surface.minAbsX)) {
                pushPolygon([0, 1, 2].map((k) => ({ p: points[k], n: normals[k] })), keep.positions, keep.normals, zero);
                continue;
            }
            const { front } = clipTriangle(points, normals, hingePoint, planeNormal);
            if (front.length >= 3) {
                pushPolygon(front, moving.positions, moving.normals, hingePoint);
                changed = true;
            }
            _c.copy(hingePoint).addScaledVector(planeNormal, OVERLAP);
            const { back } = clipTriangle(points, normals, _c, planeNormal);
            if (back.length >= 3) pushPolygon(back, keep.positions, keep.normals, zero);
        }
        if (!changed) return null;
        return {
            remainder: geometryFrom(keep.positions, keep.normals),
            surface: geometryFrom(moving.positions, moving.normals),
        };
    }

    // inputs : commandes du pilote (-1 -> 1, + = cabrer / gauche) ; flaps : 0 -> 1
    update(delta, inputs, flaps) {
        const d = this.deflections;
        const k = 1 - Math.exp(-8 * delta); // les gouvernes suivent le manche avec un peu de retard
        d.aileron += (inputs.roll - d.aileron) * k;
        d.elevator += (inputs.pitch - d.elevator) * k;
        d.rudder += (inputs.yaw - d.rudder) * k;
        d.flaps = flaps;

        // Roulis à gauche : aileron gauche levé, aileron droit baissé
        this._set('aileronLeft', -d.aileron * AILERON_TRAVEL);
        this._set('aileronRight', d.aileron * AILERON_TRAVEL);
        // Cabrer : bord de fuite de la profondeur vers le haut
        this._set('elevator', -d.elevator * ELEVATOR_TRAVEL);
        // Palonnier à gauche : direction vers la gauche
        this._set('rudder', d.rudder * RUDDER_TRAVEL);
        this._set('flapLeft', d.flaps * FLAP_TRAVEL);
        this._set('flapRight', d.flaps * FLAP_TRAVEL);
    }

    _set(name, degrees) {
        const pivot = this.pivots[name];
        if (pivot) pivot.quaternion.setFromAxisAngle(pivot.userData.axis, MathUtils.degToRad(degrees));
    }
}

function isDescendant(object, ancestor) {
    for (let o = object; o; o = o.parent) if (o === ancestor) return true;
    return false;
}

export { ControlSurfaces };
