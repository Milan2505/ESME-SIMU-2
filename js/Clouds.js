import {
    Color,
    DynamicDrawUsage,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    SRGBColorSpace,
    TextureLoader,
    UniformsLib,
    UniformsUtils
} from 'three';

// 4 "bouffées" du pack Smoke Particle Assets de Kenney (CC0), regroupées en 2x2
const PUFF_ATLAS = 'asset/textures/cloud_puffs.png';
const PUFF_SPREAD = 0.75;   // étendue des bouffées dans un nuage (1 = largeur entière : morceaux plus espacés)

const vertexShader = /* glsl */`
    attribute vec3 aOffset;
    attribute float aSize;
    attribute float aShade;
    attribute float aTile;
    attribute float aRotation;
    attribute float aRank;
    attribute float aLod;
    uniform float uCoverage;
    uniform float uDetail;
    varying vec2 vUv;
    varying float vShade;
    varying float vAlpha;
    #include <fog_pars_vertex>

    void main() {
        // Bouffée inutile (nuage absent avec cette couverture, ou retirée par le réglage de qualité) :
        // placée hors de l'écran, aucun pixel n'est calculé
        if (aRank > uCoverage || aLod > uDetail) {
            gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
            vAlpha = 0.0;
            return;
        }
        // Moins de bouffées : chacune un peu plus grosse pour garder des nuages pleins
        float size = aSize * mix(1.35, 1.0, uDetail);

        // Billboard : le quad fait toujours face à la caméra
        vec4 mvPosition = modelViewMatrix * vec4(aOffset, 1.0);
        float c = cos(aRotation), s = sin(aRotation);
        mvPosition.xy += mat2(c, s, -s, c) * position.xy * size;

        vec2 tile = vec2(mod(aTile, 2.0), floor(aTile / 2.0));
        vUv = (uv + tile) * 0.5;
        // Bas de chaque bouffée un peu plus sombre (volume)
        vShade = aShade * (0.75 + 0.25 * uv.y);
        // Les bouffées s'effacent quand on passe au travers, et selon la couverture nuageuse
        float dist = -mvPosition.z;
        vAlpha = smoothstep(size * 0.15, size * 0.8, dist);

        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

const fragmentShader = /* glsl */`
    uniform sampler2D uMap;
    uniform vec3 uLight;
    uniform vec3 uDark;
    uniform float uOpacity;
    uniform float uBrightness;
    varying vec2 vUv;
    varying float vShade;
    varying float vAlpha;
    #include <fog_pars_fragment>

    void main() {
        // Bouffées plus opaques (nuages denses) : renforce les zones semi-transparentes, garde les bords doux
        float a = texture2D(uMap, vUv).a;
        float alpha = (1.0 - (1.0 - a) * (1.0 - a)) * vAlpha * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(mix(uDark, uLight, vShade) * uBrightness, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
    }
`;

function random(min, max) {
    return min + Math.random() * (max - min);
}

// Nuages "volumétriques" : chaque nuage est un amas de bouffées en forme de cumulus
class Clouds {
    constructor({
        count = 70,           // nombre de nuages
        radius = 2800,        // zone couverte autour du centre
        minBase = 180,        // altitude de la base des nuages
        maxBase = 360,
        minWidth = 120,
        maxWidth = 320,
    } = {}) {
        this.clouds = [];
        const puffs = [];

        for (let i = 0; i < count; i++) {
            const width = random(minWidth, maxWidth);
            // Bouffées resserrées : réparties dans 75 % du volume, mais gardent la taille prévue pour le nuage
            // entier -> elles se chevauchent davantage, le nuage paraît compact au lieu d'un amas de morceaux
            const height = width * random(0.35, 0.6) * PUFF_SPREAD;
            const cloud = {
                x: random(-radius, radius),
                y: random(minBase, maxBase),
                z: random(-radius, radius),
                rx: width / 2 * PUFF_SPREAD, ry: height, rz: width / 2 * PUFF_SPREAD * random(0.6, 1),
                rank: Math.random(),  // les nuages de rang < couverture sont visibles
            };
            this.clouds.push(cloud);

            const n = Math.round(width / 5); // moins de bouffées, un peu plus grosses : moins de superpositions à dessiner
            for (let p = 0; p < n; p++) {
                // Point dans un demi-ellipsoïde : base plate, sommet bombé
                const angle = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random());
                const dx = Math.cos(angle) * r * cloud.rx;
                const dz = Math.sin(angle) * r * cloud.rz;
                const dome = 1 - r * r;
                const dy = height * dome * Math.pow(Math.random(), 0.6);
                puffs.push({
                    x: cloud.x + dx, y: cloud.y + dy, z: cloud.z + dz,
                    size: random(0.19, 0.34) * width * (0.6 + 0.4 * dome),
                    shade: 0.3 + 0.7 * Math.pow(dy / height, 0.7),
                    tile: Math.floor(Math.random() * 4),
                    rotation: Math.random() * Math.PI * 2,
                    rank: cloud.rank,
                    lod: Math.random(),   // gardée si lod < détail (réglage de qualité)
                });
            }
        }
        this.puffs = puffs;

        const geometry = new InstancedBufferGeometry();
        geometry.copy(new PlaneGeometry(1, 1));
        geometry.instanceCount = puffs.length;
        const attributes = { aOffset: 3, aSize: 1, aShade: 1, aTile: 1, aRotation: 1, aRank: 1, aLod: 1 };
        for (const [name, size] of Object.entries(attributes)) {
            const attribute = new InstancedBufferAttribute(new Float32Array(puffs.length * size), size);
            attribute.setUsage(DynamicDrawUsage);
            geometry.setAttribute(name, attribute);
        }

        const map = new TextureLoader().load(PUFF_ATLAS);
        map.colorSpace = SRGBColorSpace;

        this.material = new ShaderMaterial({
            uniforms: UniformsUtils.merge([UniformsLib.fog, {
                uMap: { value: null },
                uLight: { value: new Color(0xffffff) },
                uDark: { value: new Color(0x8f9bb0) },
                uOpacity: { value: 1 },
                uBrightness: { value: 1 },   // > 1 avec le tone mapping (rendu HDR)
                uCoverage: { value: 0.5 },
                uDetail: { value: 1 },       // part des bouffées dessinées (réglage de qualité)
            }]),
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            fog: true,
        });
        this.material.uniforms.uMap.value = map;

        this.mesh = new Mesh(geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;

        this._order = puffs.map((_, i) => i);
        this._distances = new Float32Array(puffs.length);
        this._frame = 0;
        this._sort(0, 0, 0);
    }

    // couverture : 0 = ciel dégagé, 1 = tous les nuages ; couleurs éclairée / ombre
    setWeather({ coverage, light, dark, opacity = 1, brightness = 2 }) {
        this.material.uniforms.uCoverage.value = coverage;
        this.material.uniforms.uLight.value.set(light);
        this.material.uniforms.uDark.value.set(dark);
        this.material.uniforms.uOpacity.value = opacity;
        this.material.uniforms.uBrightness.value = brightness;
    }

    // Qualité des nuages : 0 = pas de nuages, 0 -> 1 = part des bouffées dessinées
    setDetail(detail) {
        this.mesh.visible = detail > 0;
        this.material.uniforms.uDetail.value = detail;
    }

    // Densité du nuage à la position donnée (0 = dehors, 1 = au cœur), pour le "jour blanc"
    densityAt(position) {
        if (!this.mesh.visible) return 0; // nuages désactivés : pas de "jour blanc"
        const coverage = this.material.uniforms.uCoverage.value;
        let density = 0;
        for (const c of this.clouds) {
            if (c.rank > coverage) continue;
            const dx = (position.x - c.x) / c.rx;
            const dy = (position.y - c.y - c.ry * 0.4) / (c.ry * 0.7);
            const dz = (position.z - c.z) / c.rz;
            density = Math.max(density, Math.min(1, (1 - (dx * dx + dy * dy + dz * dz)) * 2));
        }
        return density;
    }

    update(camera) {
        // Tri du plus loin au plus proche (transparence correcte), pas à chaque image
        if (this._frame++ % 10 === 0) {
            this._sort(camera.position.x, camera.position.y, camera.position.z);
        }
    }

    _sort(cx, cy, cz) {
        const { puffs, _order: order, _distances: distances } = this;
        for (let i = 0; i < puffs.length; i++) {
            const p = puffs[i];
            distances[i] = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
        }
        order.sort((a, b) => distances[b] - distances[a]);

        const attr = this.mesh.geometry.attributes;
        for (let i = 0; i < order.length; i++) {
            const p = puffs[order[i]];
            attr.aOffset.array.set([p.x, p.y, p.z], i * 3);
            attr.aSize.array[i] = p.size;
            attr.aShade.array[i] = p.shade;
            attr.aTile.array[i] = p.tile;
            attr.aRotation.array[i] = p.rotation;
            attr.aRank.array[i] = p.rank;
            attr.aLod.array[i] = p.lod;
        }
        for (const name in attr) {
            if (name.startsWith('a')) attr[name].needsUpdate = true;
        }
    }
}

export { Clouds };
