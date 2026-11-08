import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    IcosahedronGeometry,
    InstancedMesh,
    Matrix4,
    MeshLambertMaterial,
    MeshStandardMaterial,
    Quaternion,
    RepeatWrapping,
    SRGBColorSpace,
    Vector3
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { loadTexture } from './Loading.js';

// Rochers et prairies fleuries du décor réaliste (remplacent les rochers et fleurs stylisés d'origine, qui ne restent
// qu'avec le réglage « Anciens assets »).
// - Rochers : formes générées (sphère déformée par du bruit, quelques plans de fracture, base enfouie), texture de roche
//   photographiée plaquée en triplanaire (rock_face_03, Poly Haven, CC0), mousse sur le dessus. Éboulis sur les pentes,
//   blocs et cailloux épars dans la plaine. Deux niveaux de détail (près : ~1 000 triangles, loin : ~180).
// - Fleurs : touffes d'herbe et de fleurs sauvages à taille réelle (coquelicots, boutons d'or, marguerites, bleuets,
//   fleurs violettes), en taches dans les prés autour des aérodromes, balancées par le vent. Dessinées seulement de près.
// Tout est placé de la même façon à chaque partie (tirage à graine fixe, fourni par Scenery).

const ROCK_TEXTURE = 'asset/textures/rock_face_03_diff_1k.jpg';
const ROCK_SHAPES = 6;
const ROCK_NEAR = 260;           // m : rochers détaillés en deçà
const ROCK_FAR = 2200;           // m : plus de rochers au-delà
const FLOWER_FAR = 230;          // m : plus de fleurs au-delà (trop petites)
const FLOWER_SPECIES = [
    // pétales (sRGB), cœur, nombre de pétales, rayon de la corolle (m), hauteur des tiges (m)
    { name: 'coquelicot', petal: [0.78, 0.07, 0.04], heart: [0.08, 0.06, 0.05], petals: 4, radius: 0.04, height: [0.35, 0.6] },
    { name: 'bouton d\'or', petal: [0.98, 0.8, 0.08], heart: [0.85, 0.6, 0.05], petals: 5, radius: 0.022, height: [0.25, 0.45] },
    { name: 'marguerite', petal: [0.95, 0.95, 0.9], heart: [0.95, 0.72, 0.08], petals: 13, radius: 0.032, height: [0.3, 0.5] },
    { name: 'bleuet', petal: [0.22, 0.38, 0.88], heart: [0.2, 0.18, 0.45], petals: 8, radius: 0.024, height: [0.3, 0.5] },
    { name: 'violette', petal: [0.56, 0.33, 0.72], heart: [0.9, 0.85, 0.5], petals: 6, radius: 0.018, height: [0.18, 0.35] },
];
const GRASS_COLORS = [[0.33, 0.45, 0.16], [0.4, 0.5, 0.2], [0.28, 0.4, 0.14], [0.45, 0.52, 0.24]];

// --- Rochers -------------------------------------------------------------------------------------------------
// Forme d'un rocher : même déformation (fonction de la direction) quel que soit le détail -> les deux niveaux de
// détail ont la même silhouette
function rockGeometry(detail, shape) {
    const noise = new ImprovedNoise();
    let geometry = new IcosahedronGeometry(1, detail);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry = mergeVertices(geometry);
    // Plans de fracture (faces planes d'une roche cassée), propres à chaque forme
    const planes = [];
    for (let k = 0; k < 4; k++) {
        const a = shape * 2.39 + k * 1.7, b = Math.sin(shape * 3.1 + k * 2.3) * 0.9;
        planes.push({ n: new Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)), d: 0.72 + 0.12 * Math.sin(shape + k * 4.1) });
    }
    const position = geometry.attributes.position, v = new Vector3(), n = new Vector3();
    const o = shape * 7.3;
    for (let i = 0; i < position.count; i++) {
        n.fromBufferAttribute(position, i).normalize();
        const r = 1 + 0.3 * noise.noise(n.x * 1.3 + o, n.y * 1.3, n.z * 1.3)
            + 0.13 * noise.noise(n.x * 3 + o, n.y * 3 + 5.1, n.z * 3)
            + 0.05 * noise.noise(n.x * 7, n.y * 7 + o, n.z * 7 + 2.7);
        v.copy(n).multiplyScalar(r);
        for (const plane of planes) {
            const d = v.dot(plane.n);
            if (d > plane.d) v.addScaledVector(plane.n, plane.d - d);
        }
        // Base aplatie (enfouie dans le sol)
        if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.25;
        position.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    return geometry;
}

function rockMaterial(texture) {
    const material = new MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.tRock = { value: texture };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                varying vec3 vRockPos;
                varying vec3 vRockNormal;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vec4 rockWorld = vec4(transformed, 1.0);
                vec3 rockNormal = objectNormal;
                #ifdef USE_INSTANCING
                    rockWorld = instanceMatrix * rockWorld;
                    rockNormal = mat3(instanceMatrix) * rockNormal;
                #endif
                vRockPos = (modelMatrix * rockWorld).xyz;
                vRockNormal = normalize(mat3(modelMatrix) * rockNormal);`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D tRock;
                varying vec3 vRockPos;
                varying vec3 vRockNormal;`)
            // Texture plaquée sur les trois plans (pas d'étirement sur les flancs), mousse et lichens sur le dessus,
            // pied plus sombre (terre, humidité)
            .replace('#include <map_fragment>', `
                vec3 rn = normalize(vRockNormal);
                vec3 rw = pow(abs(rn), vec3(4.0));
                rw /= rw.x + rw.y + rw.z;
                vec3 rp = vRockPos / 3.5;
                vec3 rockColor = texture2D(tRock, rp.zy).rgb * rw.x + texture2D(tRock, rp.xz).rgb * rw.y
                    + texture2D(tRock, rp.xy).rgb * rw.z;
                float patches = 0.5 + 0.5 * sin(vRockPos.x * 1.7 + sin(vRockPos.z * 1.3)) * sin(vRockPos.z * 1.9 + vRockPos.y);
                float moss = smoothstep(0.5, 0.85, rn.y) * smoothstep(0.25, 0.7, patches);
                rockColor = mix(rockColor, rockColor * vec3(0.5, 0.68, 0.3), moss * 0.75);
                diffuseColor.rgb *= rockColor;`);
    };
    material.customProgramCacheKey = () => 'nature-rock';
    return material;
}

// --- Fleurs --------------------------------------------------------------------------------------------------
// Touffe : brins d'herbe (un triangle effilé chacun) et fleurs (tige, corolle de pétales autour d'un cœur), en
// couleurs de sommets. Normales vers le haut : éclairée comme le pré qui la porte (pas de face noire à contre-jour)
function flowerClump(rnd, species) {
    const positions = [], colors = [];
    const color = new Color();
    const push = (x, y, z, [r, g, b], jitter = 0) => {
        positions.push(x, y, z);
        const k = 1 + (rnd() - 0.5) * jitter;
        color.setRGB(r * k, g * k, b * k, SRGBColorSpace);
        colors.push(color.r, color.g, color.b);
    };
    const RADIUS = 0.35;
    for (let i = 0; i < 18; i++) {
        const a = rnd() * Math.PI * 2, d = RADIUS * Math.sqrt(rnd());
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const h = 0.18 + rnd() * 0.3, w = 0.012 + rnd() * 0.012, side = rnd() * Math.PI;
        const lean = (rnd() - 0.5) * 0.25, leanA = rnd() * Math.PI * 2;
        const green = GRASS_COLORS[Math.floor(rnd() * GRASS_COLORS.length)];
        const base = green.map((c) => c * 0.6);
        push(x - Math.cos(side) * w, 0, z - Math.sin(side) * w, base, 0.2);
        push(x + Math.cos(side) * w, 0, z + Math.sin(side) * w, base, 0.2);
        push(x + Math.cos(leanA) * lean * h, h, z + Math.sin(leanA) * lean * h, green, 0.3);
    }
    const flowers = 9 + Math.floor(rnd() * 7);
    for (let f = 0; f < flowers; f++) {
        const a = rnd() * Math.PI * 2, d = RADIUS * 0.85 * Math.sqrt(rnd());
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const [h0, h1] = species.height;
        const h = h0 + (h1 - h0) * rnd();
        const tx = x + (rnd() - 0.5) * 0.08, tz = z + (rnd() - 0.5) * 0.08;
        // Tige
        const side = rnd() * Math.PI, w = 0.006;
        const stem = [0.25, 0.4, 0.13];
        push(x - Math.cos(side) * w, 0, z - Math.sin(side) * w, stem);
        push(x + Math.cos(side) * w, 0, z + Math.sin(side) * w, stem);
        push(tx, h, tz, stem);
        // Corolle (légèrement penchée), pétales en losange autour du cœur
        // (corolles un peu plus grandes que nature : à taille exacte, elles disparaissaient à quelques mètres)
        const r = species.radius * 1.5 * (0.8 + rnd() * 0.4), tilt = (rnd() - 0.5) * 0.5, spin = rnd() * Math.PI * 2;
        const n = species.petals, half = Math.PI / n * 0.8;
        for (let p = 0; p < n; p++) {
            const pa = spin + p / n * Math.PI * 2;
            const corner = (angle, radius) => [tx + Math.cos(angle) * radius, h + Math.sin(angle) * radius * tilt, tz + Math.sin(angle) * radius];
            const left = corner(pa - half, r * 0.45), right = corner(pa + half, r * 0.45), tip = corner(pa, r);
            push(tx, h + 0.004, tz, species.heart);
            push(...left, species.petal, 0.15);
            push(...tip, species.petal, 0.15);
            push(tx, h + 0.004, tz, species.heart);
            push(...tip, species.petal, 0.15);
            push(...right, species.petal, 0.15);
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    return geometry;
}

// Vent : le haut des touffes se balance (rien au pied), décalé d'une touffe à l'autre
function flowerMaterial(time) {
    const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uNatureTime = time;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                uniform float uNatureTime;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef USE_INSTANCING
                    float phase = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
                #else
                    float phase = 0.0;
                #endif
                float sway = transformed.y * transformed.y * 0.5;
                transformed.x += sway * (sin(uNatureTime * 1.9 + phase) + 0.4 * sin(uNatureTime * 4.3 + phase * 1.7));
                transformed.z += sway * 0.6 * sin(uNatureTime * 1.4 + phase * 1.3);`);
        // Normale toujours vers le haut, même vue de dos (deux faces : sinon la moitié des brins paraissait noire)
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
                normal = normalize(vNormal);`);
    };
    material.customProgramCacheKey = () => 'nature-flower';
    return material;
}

class Nature {
    // group : groupe du décor réaliste ; terrain : { heightAt } ; rnd : tirage à graine fixe ; free(x, z, marge) : place
    // libre (zone décorée, hors aérodrome, axe des pistes, lacs, villages) ; grass(x, z, pente) : pré assez plat
    constructor(group, { terrain, renderer, rnd, free, grass, regions }) {
        Object.assign(this, { group, terrain, rnd, free, grass, regions });
        this.density = 1;
        this.time = { value: 0 };
        const texture = loadTexture('decor', ROCK_TEXTURE, (map) => {
            map.colorSpace = SRGBColorSpace;
            map.wrapS = map.wrapT = RepeatWrapping;
            map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        });
        this._buildRocks(rockMaterial(texture));
        this._buildFlowers(flowerMaterial(this.time));
    }

    // Pente du sol (1 - normale.y)
    _slope(x, z) {
        const e = 4, h = (dx, dz) => this.terrain.heightAt(x + dx, z + dz);
        return 1 - 2 * e / Math.hypot(h(e, 0) - h(-e, 0), 2 * e, h(0, e) - h(0, -e));
    }

    _buildRocks(material) {
        const rnd = this.rnd, rocks = [];
        const rock = (x, z, size) => {
            if (!this.free(x, z, size)) return;
            rocks.push({ x, z, size, shape: Math.floor(rnd() * ROCK_SHAPES), yaw: rnd() * Math.PI * 2,
                tiltX: (rnd() - 0.5) * 0.35, tiltZ: (rnd() - 0.5) * 0.35,
                stretch: [0.8 + rnd() * 0.5, 0.55 + rnd() * 0.4, 0.75 + rnd() * 0.45], tint: 0.8 + rnd() * 0.3, order: rnd() });
        };
        for (const region of this.regions) {
            // Éboulis : sur les pentes et au pied des montagnes, rochers groupés
            for (let k = 0, tries = 0; k < 110 && tries < 6000; tries++) {
                const x = region.x + (rnd() * 2 - 1) * 2700, z = region.z + (rnd() * 2 - 1) * 2700;
                const slope = this._slope(x, z);
                if (slope < 0.1 && this.terrain.heightAt(x, z) < 45) continue;
                const n = 3 + Math.floor(rnd() * 7);
                for (let i = 0; i < n; i++) {
                    const a = rnd() * Math.PI * 2, d = rnd() * 30;
                    rock(x + Math.cos(a) * d, z + Math.sin(a) * d, (i === 0 ? 3.5 : 1.2) + rnd() * (i === 0 ? 5 : 3));
                }
                k++;
            }
            // Plaine : blocs isolés au bord des prés, avec quelques cailloux autour
            for (let k = 0, tries = 0; k < 160 && tries < 4000; tries++) {
                const a = rnd() * Math.PI * 2, d = 200 + rnd() * 2300;
                const x = region.x + Math.cos(a) * d, z = region.z + Math.sin(a) * d;
                if (!this.free(x, z, 3)) continue;
                rock(x, z, 0.9 + rnd() * 1.6);
                for (let i = Math.floor(rnd() * 4); i > 0; i--) {
                    const b = rnd() * Math.PI * 2, e = 1.5 + rnd() * 3;
                    rock(x + Math.cos(b) * e, z + Math.sin(b) * e, 0.25 + rnd() * 0.45);
                }
                k++;
            }
        }
        // Ordre aléatoire : le réglage de densité garde les premiers, répartis partout
        rocks.sort((a, b) => a.order - b.order);
        const q = new Quaternion(), tilt = new Quaternion(), up = new Vector3(0, 1, 0), axis = new Vector3();
        const tint = new Color();
        for (const r of rocks) {
            const ground = this.terrain.heightAt(r.x, r.z);
            q.setFromAxisAngle(up, r.yaw);
            tilt.setFromAxisAngle(axis.set(1, 0, 0), r.tiltX);
            q.multiply(tilt);
            tilt.setFromAxisAngle(axis.set(0, 0, 1), r.tiltZ);
            q.multiply(tilt);
            const scale = new Vector3(...r.stretch).multiplyScalar(r.size);
            // Enfoncé d'autant plus que la pente est forte (sinon le côté aval flotte au-dessus du sol)
            const sink = 0.15 + Math.min(0.45, this._slope(r.x, r.z) * 1.6);
            r.matrix = new Matrix4().compose(new Vector3(r.x, ground - sink * scale.y, r.z), q, scale);
            r.position = new Vector3(r.x, ground, r.z);
            r.color = tint.setScalar(r.tint).clone();
            const half = Math.max(scale.x, scale.z) * 0.85;
            r.box = r.size > 1.2 ? new Box3(new Vector3(r.x - half, ground - 1, r.z - half), new Vector3(r.x + half, ground + scale.y * 0.9, r.z + half)) : null;
        }
        this.rocks = rocks;
        // Par forme : maillage détaillé (près) et simplifié (loin)
        this.rockMeshes = [];
        for (let shape = 0; shape < ROCK_SHAPES; shape++) {
            const count = rocks.filter((r) => r.shape === shape).length || 1;
            const lods = [6, 2].map((detail, lod) => {
                const mesh = new InstancedMesh(rockGeometry(detail, shape), material, count);
                mesh.castShadow = lod === 0;
                mesh.receiveShadow = true;
                mesh.frustumCulled = false;
                mesh.count = 0;
                mesh.setColorAt(0, tint.setScalar(1));
                this.group.add(mesh);
                return mesh;
            });
            this.rockMeshes.push(lods);
        }
    }

    _buildFlowers(material) {
        const rnd = this.rnd;
        // Formes de touffe : deux par espèce
        const shapes = [];
        for (const species of FLOWER_SPECIES) for (let v = 0; v < 2; v++) shapes.push(flowerClump(rnd, species));
        const clumps = [];
        for (const region of this.regions) {
            // Taches fleuries dans les prés autour de l'aérodrome : une ou deux espèces par tache, plus dense au centre
            for (let k = 0, tries = 0; k < 75 && tries < 5000; tries++) {
                const a = rnd() * Math.PI * 2, d = 90 + rnd() * 1900;
                const x = region.x + Math.cos(a) * d, z = region.z + Math.sin(a) * d;
                if (!this.free(x, z, 5) || !this.grass(x, z, 0.08)) continue;
                const radius = 10 + rnd() * 20;
                const main = Math.floor(rnd() * FLOWER_SPECIES.length), other = Math.floor(rnd() * FLOWER_SPECIES.length);
                const n = Math.round(radius * radius * (0.3 + rnd() * 0.25));
                for (let i = 0; i < n; i++) {
                    const b = rnd() * Math.PI * 2, e = radius * Math.pow(rnd(), 0.7);
                    const cx = x + Math.cos(b) * e, cz = z + Math.sin(b) * e;
                    if (!this.free(cx, cz, 0)) continue;
                    const species = rnd() < 0.75 ? main : other;
                    clumps.push({ x: cx, z: cz, shape: species * 2 + (rnd() < 0.5 ? 0 : 1), yaw: rnd() * Math.PI * 2,
                        scale: 0.8 + rnd() * 0.45, order: rnd() });
                }
                k++;
            }
        }
        clumps.sort((a, b) => a.order - b.order);
        const q = new Quaternion(), up = new Vector3(0, 1, 0);
        for (const c of clumps) {
            c.position = new Vector3(c.x, this.terrain.heightAt(c.x, c.z) - 0.02, c.z);
            c.matrix = new Matrix4().compose(c.position, q.setFromAxisAngle(up, c.yaw), new Vector3(c.scale, c.scale, c.scale));
        }
        this.clumps = clumps;
        this.flowerMeshes = shapes.map((geometry, shape) => {
            // Au plus les touffes à portée (FLOWER_FAR), bornées par le nombre de touffes de cette forme
            const count = Math.min(6000, clumps.filter((c) => c.shape === shape).length) || 1;
            const mesh = new InstancedMesh(geometry, material, count);
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            mesh.count = 0;
            this.group.add(mesh);
            return mesh;
        });
    }

    setDensity(density) {
        this.density = density;
    }

    // Obstacles (gros rochers affichés)
    get obstacles() {
        const shown = Math.round(this.rocks.length * this.density);
        const boxes = [];
        for (let i = 0; i < shown; i++) if (this.rocks[i].box) boxes.push(this.rocks[i].box);
        return boxes;
    }

    // Vent dans les fleurs (chaque image)
    animate(time) {
        this.time.value = time;
    }

    // Répartition selon la caméra (quand elle a bougé : voir Scenery.update) ; farthest : fin du brouillard (m)
    layout(camera, farthest) {
        const rockFar2 = Math.min(ROCK_FAR, farthest) ** 2, near2 = ROCK_NEAR * ROCK_NEAR;
        const counts = this.rockMeshes.map(() => [0, 0]);
        const shown = Math.round(this.rocks.length * this.density);
        for (let i = 0; i < shown; i++) {
            const r = this.rocks[i];
            const d2 = r.position.distanceToSquared(camera);
            if (d2 > rockFar2) continue;
            const lod = d2 < near2 ? 0 : 1, mesh = this.rockMeshes[r.shape][lod];
            const k = counts[r.shape][lod]++;
            mesh.setMatrixAt(k, r.matrix);
            mesh.setColorAt(k, r.color);
        }
        this.rockMeshes.forEach((lods, shape) => lods.forEach((mesh, lod) => {
            mesh.count = counts[shape][lod];
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }));

        const flowerFar2 = Math.min(FLOWER_FAR, farthest) ** 2;
        const flowerCounts = this.flowerMeshes.map(() => 0);
        const flowersShown = Math.round(this.clumps.length * this.density);
        for (let i = 0; i < flowersShown; i++) {
            const c = this.clumps[i];
            if (c.position.distanceToSquared(camera) > flowerFar2) continue;
            const mesh = this.flowerMeshes[c.shape];
            if (flowerCounts[c.shape] >= mesh.instanceMatrix.count) continue;
            mesh.setMatrixAt(flowerCounts[c.shape]++, c.matrix);
        }
        this.flowerMeshes.forEach((mesh, shape) => {
            mesh.count = flowerCounts[shape];
            mesh.instanceMatrix.needsUpdate = true;
        });
    }
}

export { Nature };
