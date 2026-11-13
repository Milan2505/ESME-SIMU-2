import { AdditiveBlending, DoubleSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';

// Bouclier après le décollage (multijoueur, voir simulator.js) : bulle bleutée autour de l'avion, plus lumineuse sur
// ses bords (comme une bulle de savon), parcourue de lignes qui défilent. Elle s'efface dans les dernières secondes.
// Un seul maillage par avion, ajouté à son groupe ; caché quand le bouclier est coupé.

const RADIUS = { f15: 13, c172: 8 };   // m (F-15 : ~19 m de long ; Cessna : ~8 m, 11 m d'envergure)

const geometry = new SphereGeometry(1, 32, 20);
const material = new ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
            vLocal = position;
            vec4 world = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = normalize(-world.xyz);
            gl_Position = projectionMatrix * world;
        }`,
    fragmentShader: /* glsl */ `
        uniform float time;
        uniform float strength;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
            float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
            rim = pow(rim, 2.5);
            float lines = smoothstep(0.85, 1.0, sin(vLocal.y * 28.0 - time * 4.0) * 0.5 + 0.5) * 0.25;
            float a = (0.06 + rim * 0.75 + lines * (0.3 + rim)) * strength;
            gl_FragColor = vec4(vec3(0.45, 0.8, 1.0) * a, a);
        }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
});

class Shield {
    constructor(type = 'c172') {
        // (matériau propre à chaque bouclier : son intensité ; le programme du shader reste partagé)
        this.material = material.clone();
        this.material.uniforms = { time: { value: 0 }, strength: { value: 0 } };
        this.mesh = new Mesh(geometry, this.material);
        this.mesh.name = 'bouclier';
        this.mesh.renderOrder = 5;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.setType(type);
    }

    setType(type) {
        this.mesh.scale.setScalar(RADIUS[type] ?? RADIUS.c172);
    }

    // remaining : secondes de bouclier restantes (0 : coupé) ; time : horloge (s), pour l'animation
    update(remaining, time, visible = true) {
        const on = remaining > 0 && visible;
        this.mesh.visible = on;
        if (!on) return;
        // Pleine intensité, puis s'efface sur les 3 dernières secondes en clignotant
        const fade = remaining > 3 ? 1 : (remaining / 3) * (0.6 + 0.4 * Math.sin(time * 18));
        this.material.uniforms.strength.value = Math.max(0, fade);
        this.material.uniforms.time.value = time;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.material.dispose();
    }
}

export { Shield };
