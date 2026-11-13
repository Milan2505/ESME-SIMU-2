import { Matrix4, Vector3 } from 'three';

// Collision entre avions (garés, autres joueurs) : chaque autre avion est un assemblage de boîtes dans son repère
// (aile, fuselage, empennage, dérive, relevées sur le modèle affiché) ; on y teste quelques points de notre avion
// (bouts d'aile, nez, queue…). Seuls les avions à moins de RANGE m sont regardés : quasiment rien à calculer en vol.

// Boîtes [xmin, xmax, ymin, ymax, zmin, zmax] dans le repère avion (origine : position de l'avion, roues 0,81 m dessous ;
// nez vers -z)
const SHAPE = [
    [-6.65, 6.65, 0.95, 1.5, -2.85, -0.85],   // aile
    [-0.65, 0.65, -0.6, 1.45, -5.15, 3.3],    // fuselage (hélice comprise)
    [-2.1, 2.1, 0.15, 0.4, 2.3, 3.25],        // empennage horizontal
    [-0.15, 0.15, 0.25, 2.05, 2.6, 4.6],      // dérive et gouverne de direction
];
// Points de notre avion qui touchent d'abord (même repère)
const PROBES = [
    [6.6, 1.25, -1.8], [-6.6, 1.25, -1.8], [3.3, 1.25, -1.8], [-3.3, 1.25, -1.8],   // aile
    [0, 0.3, -5.1], [0, 1.4, -2], [0, 0.6, 0], [0, 1, 4.4], [0, 1.95, 4.2],          // nez, cabine, fuselage, queue, dérive
    [2.05, 0.28, 2.8], [-2.05, 0.28, 2.8],                                           // empennage
].map(([x, y, z]) => new Vector3(x, y, z));
// F-15 (taille réelle, origine du modèle, roues 2,05 m dessous) : aile, fuselage (entrées d'air comprises),
// stabilisateurs, deux dérives
const F15_SHAPE = [
    [-6.3, 6.3, 0.3, 0.9, -0.3, 5.6],
    [-1.6, 1.6, -0.7, 1.5, -9.8, 9.4],
    [-4.2, 4.2, -0.05, 0.2, 6.4, 9.7],
    [-1.85, -1.6, 0.26, 3.5, 5.3, 8.45], [1.6, 1.85, 0.26, 3.5, 5.3, 8.45],
];
const F15_PROBES = [
    [6.2, 0.6, 4.6], [-6.2, 0.6, 4.6], [3.5, 0.6, 2.5], [-3.5, 0.6, 2.5],
    [0, 0.3, -9.7], [0, 1.6, -4], [0, 0.5, 9.2], [1.75, 3.4, 8.2], [-1.75, 3.4, 8.2], [4.1, 0.05, 9], [-4.1, 0.05, 9],
].map(([x, y, z]) => new Vector3(x, y, z));
// R44 (origine du modèle FlightGear, ~2,2 m derrière le mât, patins 1,64 m dessous) : disque du rotor (10 m), cabine,
// poutre de queue, dérive et rotor anticouple
const R44_SHAPE = [
    [-3.6, 3.6, 1.45, 1.85, -5.8, 1.4],      // disque du rotor (carré inscrit, mince)
    [-0.75, 0.75, -1.65, 0.9, -4.7, -0.9],   // cabine et patins
    [-0.3, 0.3, -0.5, 0.6, -0.9, 3.4],       // poutre de queue
    [-0.4, 0.4, -0.6, 1.2, 3.4, 4.3],        // dérive, rotor anticouple
];
const R44_PROBES = [
    [5.0, 1.65, -2.2], [-5.0, 1.65, -2.2], [0, 1.65, -7.2], [0, 1.65, 2.8],   // bouts de pales
    [0, -0.6, -4.6], [0.7, -1.6, -3.6], [-0.7, -1.6, -3.6], [0, 0.4, 4.1], [-0.25, 0.4, 3.6],
].map(([x, y, z]) => new Vector3(x, y, z));
const SHAPES = { c172: SHAPE, f15: F15_SHAPE, r44: R44_SHAPE };
const PROBE_SETS = { c172: PROBES, f15: F15_PROBES, r44: R44_PROBES };
const RANGE = 26;   // m entre les deux avions : au-delà, pas de contact possible (F-15 : 19,5 m de long)

const _own = new Matrix4();
const _toOther = new Matrix4();
const _point = new Vector3();
const _unit = new Vector3(1, 1, 1);

// own : notre avion (position, quaternion) ; others : matrices monde des autres avions (Matrix4 ; matrix.planeType :
// 'c172' par défaut, ou 'f15') ; ownType : type de notre avion ; vrai au contact
function planesCollide(own, others, ownType = 'c172') {
    const probes = PROBE_SETS[ownType] ?? PROBES;
    _own.compose(own.position, own.quaternion, _unit);
    for (const matrix of others) {
        const e = matrix.elements;
        if (Math.hypot(e[12] - own.position.x, e[13] - own.position.y, e[14] - own.position.z) > RANGE) continue;
        _toOther.copy(matrix).invert().multiply(_own);
        const shape = SHAPES[matrix.planeType] ?? SHAPE;
        for (const probe of probes) {
            _point.copy(probe).applyMatrix4(_toOther);
            for (const [x0, x1, y0, y1, z0, z1] of shape) {
                if (_point.x > x0 && _point.x < x1 && _point.y > y0 && _point.y < y1 && _point.z > z0 && _point.z < z1) return true;
            }
        }
    }
    return false;
}

export { planesCollide };
