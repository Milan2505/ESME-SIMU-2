import {
    AdditiveBlending,
    DynamicDrawUsage,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    NormalBlending,
    PlaneGeometry,
    ShaderMaterial,
    UniformsLib,
    UniformsUtils,
    Vector3
} from 'three';

// Particules (bouffées de fumée, flammes, éclairs, leurres) dessinées toutes ensemble : un seul appel de dessin pour un
// lot entier, au lieu d'un Sprite (et d'un matériau) par particule. Avant, une traînée de missile de 220 bouffées
// coûtait 220 appels de dessin, et chaque explosion en ajoutait 44 : en combat, plusieurs milliers par image.
// Même rendu qu'un Sprite : carré face à la caméra, taille en mètres (plus petit au loin), texture × couleur, opacité,
// brouillard, tone mapping. La couleur peut dépasser 1 (halo du bloom).
// Usage, à chaque image : begin(), puis add(position, taille, r, g, b, opacité) pour chaque particule vivante, puis end().

const VERTEX = /* glsl */ `
attribute vec4 offsetSize;   // position relative au centre du lot (m), taille (m)
attribute vec4 tint;         // couleur (rgb, peut dépasser 1), opacité
varying vec2 vUv;
varying vec4 vTint;
#include <fog_pars_vertex>
void main() {
    vUv = uv;
    vTint = tint;
    vec4 mvPosition = modelViewMatrix * vec4(offsetSize.xyz, 1.0);
    mvPosition.xy += position.xy * offsetSize.w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vTint;
#include <fog_pars_fragment>
void main() {
    vec4 texel = texture2D(map, vUv);
    gl_FragColor = vec4(vTint.rgb * texel.rgb, texel.a * vTint.a);
    if (gl_FragColor.a < 0.002) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
}
`;

const _quad = new PlaneGeometry(1, 1);
const _center = new Vector3();

class Billboards extends Mesh {
    // map : texture des particules ; additive : mélange additif (feu, éclairs) ; fog : soumis au brouillard
    constructor(capacity, { map, additive = false, fog = true } = {}) {
        const geometry = new InstancedBufferGeometry();
        // (copies propres à chaque lot : libérer un lot ne doit pas libérer les tampons d'un autre)
        geometry.index = _quad.index.clone();
        geometry.setAttribute('position', _quad.attributes.position.clone());
        geometry.setAttribute('uv', _quad.attributes.uv.clone());
        const offsetSize = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
        const tint = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
        geometry.setAttribute('offsetSize', offsetSize);
        geometry.setAttribute('tint', tint);
        geometry.instanceCount = 0;
        const material = new ShaderMaterial({
            uniforms: UniformsUtils.merge([UniformsLib.fog, { map: { value: null } }]),
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            transparent: true,
            depthWrite: false,
            blending: additive ? AdditiveBlending : NormalBlending,
            fog,
        });
        material.uniforms.map.value = map;
        super(geometry, material);
        this.frustumCulled = false;
        this.capacity = capacity;
        this._count = 0;
        this._points = [];
    }

    begin() {
        this._count = 0;
        this._points.length = 0;
    }

    add(position, size, r, g, b, alpha) {
        if (this._count >= this.capacity || alpha <= 0.001 || size <= 0) return;
        const i = this._count++;
        this._points.push(position.x, position.y, position.z, size);
        const t = this.geometry.attributes.tint.array;
        t[i * 4] = r;
        t[i * 4 + 1] = g;
        t[i * 4 + 2] = b;
        t[i * 4 + 3] = alpha;
    }

    // Le lot est placé au centre de ses particules (ordre d'affichage parmi les objets transparents, comme les Sprites,
    // et précision des positions relatives loin de l'origine)
    end() {
        const n = this._count, p = this._points;
        const geometry = this.geometry;
        geometry.instanceCount = n;
        this.visible = n > 0;
        if (!n) return;
        _center.set(0, 0, 0);
        for (let i = 0; i < n; i++) _center.x += p[i * 4], _center.y += p[i * 4 + 1], _center.z += p[i * 4 + 2];
        _center.divideScalar(n);
        this.position.copy(_center);
        this.updateMatrix();
        this.matrixWorldNeedsUpdate = true;
        const o = geometry.attributes.offsetSize.array;
        for (let i = 0; i < n; i++) {
            o[i * 4] = p[i * 4] - _center.x;
            o[i * 4 + 1] = p[i * 4 + 1] - _center.y;
            o[i * 4 + 2] = p[i * 4 + 2] - _center.z;
            o[i * 4 + 3] = p[i * 4 + 3];
        }
        for (const name of ['offsetSize', 'tint']) {
            const attribute = geometry.attributes[name];
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, n * 4);
            attribute.needsUpdate = true;
        }
    }

    dispose() {
        this.removeFromParent();
        this.geometry.dispose();
        this.material.dispose();
    }
}

export { Billboards };
