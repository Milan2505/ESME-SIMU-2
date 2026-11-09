import {
    BoxGeometry,
    CircleGeometry,
    ConeGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry
} from 'three';

// Armement visible sur le F-15 (repère avion : x à droite, y en haut, nez vers -z ; mètres) :
// - canon M61A1 : bouche du canon dans l'emplanture de l'aile droite (six tubes au fond de la trappe) ;
// - sous chaque aile, un pylône avec un AGM-65 Maverick (air-sol) dessous et un AIM-9 Sidewinder (air-air) sur le
//   rail extérieur. Au tir, le missile du pylône disparaît (c'est lui qui part, voir Weapons.js) puis réapparaît : il
//   est rechargé tout de suite (munitions illimitées).
// Les autres joueurs voient les mêmes emports (copiés avec le modèle du F-15).

const GREY = new MeshStandardMaterial({ color: 0x8c949c, roughness: 0.6, metalness: 0.3 });
const WHITE = new MeshStandardMaterial({ color: 0xe6e6df, roughness: 0.5, metalness: 0.15 });
const OLIVE = new MeshStandardMaterial({ color: 0xb8bba6, roughness: 0.55, metalness: 0.15 });
const DARK = new MeshStandardMaterial({ color: 0x1d2024, roughness: 0.35, metalness: 0.6 });
const GLASS = new MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.9 });
const BAND = new MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5 });   // bande jaune : charge militaire

// Emplacements (repère avion)
const PYLON_X = 3.2;
const STATIONS = {
    pylon: { y: 0.12, z: 3.0 },
    ag: { y: -0.27, z: 2.7 },      // AGM-65 sous le pylône
    aa: { x: 3.62, y: 0.0, z: 2.5 },   // AIM-9 sur le rail extérieur
};
const GUN_MUZZLE = [1.75, 0.75, -1.4];

// Corps de missile le long de -z : cylindre, ogive (ou dôme de verre), ailettes ; length, radius en m
function missileBody({ length, radius, body, nose, finSpan, finLength, wings = 0, wingSpan = 0, band = true }) {
    const g = new Group();
    const tube = new Mesh(new CylinderGeometry(radius, radius, length, 14), body);
    tube.rotation.x = Math.PI / 2;
    g.add(tube);
    const noseMesh = nose === 'dome'
        ? new Mesh(new SphereGeometry(radius, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), GLASS)
        : new Mesh(new ConeGeometry(radius, radius * 3.2, 14), body);
    noseMesh.rotation.x = -Math.PI / 2;
    noseMesh.position.z = -length / 2 - (nose === 'dome' ? 0 : radius * 1.6);
    g.add(noseMesh);
    if (band) {
        const ring = new Mesh(new CylinderGeometry(radius * 1.01, radius * 1.01, 0.08, 14), BAND);
        ring.rotation.x = Math.PI / 2;
        ring.position.z = -length * 0.18;
        g.add(ring);
    }
    // Ailettes arrière (en croix) et ailes / canards avant
    const fins = (span, chord, z, material) => {
        for (let i = 0; i < 4; i++) {
            const fin = new Mesh(new BoxGeometry(0.012, span, chord), material);
            const angle = i * Math.PI / 2 + Math.PI / 4;
            fin.position.set(Math.cos(angle) * (radius + span / 2), Math.sin(angle) * (radius + span / 2), z);
            fin.rotation.z = angle - Math.PI / 2;
            g.add(fin);
        }
    };
    fins(finSpan, finLength, length / 2 - finLength / 2, body);
    if (wings) fins(wingSpan, wings, -length / 2 + wings, body);
    const nozzle = new Mesh(new CylinderGeometry(radius * 0.7, radius * 0.8, 0.05, 12), DARK);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = length / 2 + 0.02;
    g.add(nozzle);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
}

// AIM-9 Sidewinder : 2,9 m, 127 mm, dôme infrarouge, canards à l'avant
function aim9() {
    return missileBody({ length: 2.87, radius: 0.064, body: WHITE, nose: 'dome', finSpan: 0.2, finLength: 0.3, wings: 0.18, wingSpan: 0.13 });
}

// AGM-65 Maverick : 2,5 m, 305 mm, dôme de l'autodirecteur, longues ailes
function agm65() {
    return missileBody({ length: 2.25, radius: 0.153, body: OLIVE, nose: 'dome', finSpan: 0.2, finLength: 0.55, band: true });
}

// Canon : trappe sombre et six tubes dans l'emplanture droite, bouche vers l'avant
function gunPort() {
    const g = new Group();
    const port = new Mesh(new CylinderGeometry(0.1, 0.12, 0.7, 16, 1, true), DARK);
    port.rotation.x = Math.PI / 2;
    port.position.z = 0.35;
    g.add(port);
    for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const barrel = new Mesh(new CylinderGeometry(0.014, 0.014, 0.6, 8), GREY);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.32);
        g.add(barrel);
    }
    const back = new Mesh(new CircleGeometry(0.1, 16), DARK);
    back.position.z = 0.6;
    g.add(back);
    g.position.set(...GUN_MUZZLE);
    return g;
}

// Emports du F-15, dans le repère de l'avion ; model : modèle chargé (ses emports sont rangés dedans, compensés de sa
// propre transformation)
function buildF15Stores(model) {
    const group = new Group();
    group.name = 'emports';
    const aa = [], ag = [];
    for (const side of [-1, 1]) {
        const pylon = new Mesh(new BoxGeometry(0.14, 0.3, 1.9), GREY);
        pylon.position.set(side * PYLON_X, STATIONS.pylon.y, STATIONS.pylon.z);
        pylon.castShadow = true;
        // Rail de l'AIM-9 sur le côté extérieur du pylône
        const rail = new Mesh(new BoxGeometry(0.34, 0.05, 1.5), GREY);
        rail.position.set(side * (PYLON_X + 0.2), STATIONS.aa.y + 0.09, STATIONS.aa.z);
        const maverick = agm65();
        maverick.position.set(side * PYLON_X, STATIONS.ag.y, STATIONS.ag.z);
        const sidewinder = aim9();
        sidewinder.position.set(side * STATIONS.aa.x, STATIONS.aa.y, STATIONS.aa.z);
        group.add(pylon, rail, maverick, sidewinder);
        ag.push(maverick);
        aa.push(sidewinder);
    }
    const gun = gunPort();
    group.add(gun);
    if (model) {
        model.updateMatrix();
        group.applyMatrix4(model.matrix.clone().invert());
        model.add(group);
    }
    return { group, aa, ag, gun };
}

// Emports d'un F-15 copié (autres joueurs) : retrouvés par leur nom
function findF15Stores(model) {
    return model.getObjectByName('emports') ?? null;
}

export { buildF15Stores, findF15Stores, GUN_MUZZLE };
