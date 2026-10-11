import { Matrix4, Mesh } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Fusionne les pièces fixes d'un groupe qui partagent le même matériau : même image, mais un seul appel de dessin
// (et une seule fois dans la passe d'ombres) au lieu d'un par pièce. La carte graphique passe moins de temps à
// changer d'objet, ce qui coûte bien plus que les triangles eux-mêmes.
// keep(objet) : true pour une pièce (et tout ce qu'elle contient) qui bouge, change, ou que le code utilise
// (cliquable, animée, montrée / cachée seule…). Les matériaux transparents ne sont pas fusionnés (ordre d'affichage).
// Renvoie le nombre de pièces fusionnées.
function mergeStatic(root, keep = () => false) {
    root.updateMatrixWorld(true);
    const toRoot = new Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map();

    const visit = (node) => {
        if (node !== root && keep(node)) return;   // pièce gardée telle quelle, avec ses enfants
        if (node.isMesh && canMerge(node)) {
            const geometry = node.geometry;
            const key = [node.material.uuid, node.castShadow, node.receiveShadow, node.renderOrder, node.layers.mask,
                Boolean(node.userData.cabinOnly), Boolean(node.userData.flat), geometry.index ? 'i' : 'n',
                Object.keys(geometry.attributes).sort().join(',')].join('|');
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(node);
        }
        for (const child of [...node.children]) visit(child);
    };
    visit(root);

    let merged = 0;
    const matrix = new Matrix4();
    for (const meshes of buckets.values()) {
        if (meshes.length < 2) continue;
        const geometries = meshes.map((mesh) => {
            const geometry = mesh.geometry.clone();
            geometry.applyMatrix4(matrix.multiplyMatrices(toRoot, mesh.matrixWorld));
            for (const name of Object.keys(geometry.morphAttributes)) delete geometry.morphAttributes[name];
            geometry.clearGroups();
            return geometry;
        });
        const geometry = mergeGeometries(geometries, false);
        for (const g of geometries) g.dispose();
        if (!geometry) continue;
        const first = meshes[0];
        const mesh = new Mesh(geometry, first.material);
        mesh.castShadow = first.castShadow;
        mesh.receiveShadow = first.receiveShadow;
        mesh.renderOrder = first.renderOrder;
        mesh.layers.mask = first.layers.mask;
        mesh.userData = { ...first.userData, merged: meshes.length };
        mesh.name = `fusion (${meshes.length})`;
        root.add(mesh);
        for (const m of meshes) m.removeFromParent();
        merged += meshes.length;
    }
    return merged;
}

// Pièce simple : un seul matériau opaque, visible, pas de squelette ni d'instances, pas d'image miroir
// (une échelle négative inverserait les faces), pas de rendu personnalisé
function canMerge(mesh) {
    if (mesh.isInstancedMesh || mesh.isSkinnedMesh || Array.isArray(mesh.material)) return false;
    if (!mesh.visible || mesh.material.transparent || mesh.material.visible === false) return false;
    if (mesh.customDepthMaterial || mesh.customDistanceMaterial || mesh.onBeforeRender !== Mesh.prototype.onBeforeRender) return false;
    if (Object.keys(mesh.geometry.morphAttributes).length || mesh.userData.surface || mesh.userData.control) return false;
    if (mesh.matrixWorld.determinant() < 0) return false;
    let parent = mesh.parent;
    while (parent) {
        if (!parent.visible) return false;
        parent = parent.parent;
    }
    return true;
}

export { mergeStatic };
