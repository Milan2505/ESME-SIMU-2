import {
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    RepeatWrapping,
    SRGBColorSpace,
    TextureLoader,
    Vector3
} from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

// Textures CC0 de Poly Haven (https://polyhaven.com), voir asset/textures/
const TEXTURES = {
    grass: 'asset/textures/aerial_grass_rock_diff_1k.jpg',
    rock:  'asset/textures/aerial_rocks_02_diff_1k.jpg',
    snow:  'asset/textures/snow_02_diff_1k.jpg',
};

function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// Relief procédural : plaine au centre, collines autour, montagnes au loin
class Terrain {
    constructor(renderer, {
        size = 6000,          // côté du terrain
        segments = 384,       // finesse du maillage
        flatRadius = 80,      // zone plate au centre (point de départ)
        hillHeight = 15,
        mountainStart = 350,  // distance où les montagnes commencent
        mountainFull = 1100,  // distance où elles atteignent leur hauteur max
        mountainHeight = 320,
        snowHeight = 190,
        tile = 60,            // taille d'une répétition de texture (m)
        grassTint = 0x219313,
        flatten = () => 1,    // facteur de relief en (x, z) : 0 = sol plat (aérodrome), 1 = relief normal
    } = {}) {
        this.noise = new ImprovedNoise();
        Object.assign(this, { flatRadius, hillHeight, mountainStart, mountainFull, mountainHeight, flatten });

        this.size = size;
        this.mesh = new Mesh(this._createGeometry(segments), this._createMaterial(renderer, { snowHeight, tile, grassTint }));
    }

    // Finesse du maillage (réglage "Détail du sol") ; les collisions utilisent heightAt, indépendant du maillage
    setDetail(segments) {
        if (this.mesh.geometry.parameters?.widthSegments === segments) return;
        this.mesh.geometry.dispose();
        this.mesh.geometry = this._createGeometry(segments);
    }

    _createGeometry(segments) {
        const geometry = new PlaneGeometry(this.size, this.size, segments, segments);
        geometry.rotateX(- Math.PI / 2);
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
            position.setY(i, this.heightAt(position.getX(i), position.getZ(i)));
        }
        geometry.computeVertexNormals();
        return geometry;
    }

    // Hauteur du sol au point (x, z), utilisée aussi pour poser les objets et pour les collisions
    heightAt(x, z) {
        const relief = this.flatten(x, z);
        if (relief <= 0) return 0;
        const r = Math.hypot(x, z);

        // Collines : bruit doux
        let hills = 0, amp = 1, freq = 1 / 250;
        for (let o = 0; o < 3; o++) {
            hills += this.noise.noise(x * freq, z * freq, 0.5) * amp;
            amp *= 0.5; freq *= 2;
        }

        // Montagnes : bruit "en crêtes" pour des sommets marqués
        let mountains = 0, total = 0;
        amp = 1; freq = 1 / 700;
        for (let o = 0; o < 5; o++) {
            const ridge = 1 - Math.abs(this.noise.noise(x * freq, z * freq, 7.3));
            mountains += ridge * ridge * amp;
            total += amp;
            amp *= 0.5; freq *= 2;
        }
        mountains /= total;

        return relief * (hills * this.hillHeight * smoothstep(this.flatRadius, this.flatRadius * 4, r)
            + mountains * this.mountainHeight * smoothstep(this.mountainStart, this.mountainFull, r));
    }

    _createMaterial(renderer, { snowHeight, tile, grassTint }) {
        const loader = new TextureLoader();
        const textures = {};
        for (const [name, url] of Object.entries(TEXTURES)) {
            const texture = loader.load(url);
            texture.colorSpace = SRGBColorSpace;
            texture.wrapS = texture.wrapT = RepeatWrapping;
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
            textures[name] = texture;
        }

        const material = new MeshStandardMaterial({ roughness: 1 });
        const tint = new Vector3(...[16, 8, 0].map((shift) => ((grassTint >> shift) & 0xff) / 255));

        // Mélange herbe / roche / neige selon la pente et l'altitude
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, {
                tGrass: { value: textures.grass },
                tRock: { value: textures.rock },
                tSnow: { value: textures.snow },
                uGrassTint: { value: tint },
                uTile: { value: tile },
                uSnowHeight: { value: snowHeight },
            });

            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>
                    varying vec3 vTerrainPos;
                    varying vec3 vTerrainNormal;`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    vTerrainPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    vTerrainNormal = normalize(mat3(modelMatrix) * normal);`);

            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
                    uniform sampler2D tGrass;
                    uniform sampler2D tRock;
                    uniform sampler2D tSnow;
                    uniform vec3 uGrassTint;
                    uniform float uTile;
                    uniform float uSnowHeight;
                    varying vec3 vTerrainPos;
                    varying vec3 vTerrainNormal;

                    // Deux échelles mélangées pour casser la répétition vue de haut
                    vec3 terrainSample(sampler2D tex, vec2 uv) {
                        return mix(texture2D(tex, uv).rgb, texture2D(tex, uv * 0.13).rgb, 0.5);
                    }`)
                .replace('#include <map_fragment>', `
                    vec2 terrainUv = vTerrainPos.xz / uTile;
                    vec3 grass = terrainSample(tGrass, terrainUv);
                    grass = mix(grass, grass * uGrassTint * 2.5, 0.6);
                    vec3 rock = terrainSample(tRock, terrainUv);
                    vec3 snow = terrainSample(tSnow, terrainUv);

                    float slope = 1.0 - normalize(vTerrainNormal).y;
                    float rockAmount = clamp(smoothstep(0.12, 0.3, slope)
                        + smoothstep(uSnowHeight * 0.4, uSnowHeight * 0.8, vTerrainPos.y), 0.0, 1.0);
                    float snowAmount = smoothstep(uSnowHeight, uSnowHeight + 40.0, vTerrainPos.y)
                        * (1.0 - smoothstep(0.35, 0.6, slope));

                    vec3 terrainColor = mix(mix(grass, rock, rockAmount), snow, snowAmount);
                    diffuseColor.rgb *= terrainColor;`);
        };
        return material;
    }
}

export { Terrain };
