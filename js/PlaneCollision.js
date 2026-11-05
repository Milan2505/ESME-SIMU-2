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
const RANGE = 16;   // m entre les deux avions : au-delà, pas de contact possible (envergure 13,3 m)

const _own = new Matrix4();
const _toOther = new Matrix4();
const _point = new Vector3();
const _unit = new Vector3(1, 1, 1);

// own : notre avion (position, quaternion) ; others : matrices monde des autres avions (Matrix4) ; vrai au contact
function planesCollide(own, others) {
    _own.compose(own.position, own.quaternion, _unit);
    for (const matrix of others) {
        const e = matrix.elements;
        if (Math.hypot(e[12] - own.position.x, e[13] - own.position.y, e[14] - own.position.z) > RANGE) continue;
        _toOther.copy(matrix).invert().multiply(_own);
        for (const probe of PROBES) {
            _point.copy(probe).applyMatrix4(_toOther);
            for (const [x0, x1, y0, y1, z0, z1] of SHAPE) {
                if (_point.x > x0 && _point.x < x1 && _point.y > y0 && _point.y < y1 && _point.z > z0 && _point.z < z1) return true;
            }
        }
    }
    return false;
}

export { planesCollide };
