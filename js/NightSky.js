import {
    BackSide,
    Color,
    Mesh,
    ShaderMaterial,
    SphereGeometry,
    SRGBColorSpace,
    TextureLoader
} from 'three';

// Ciel étoilé et Voie lactée : moitié haute du panorama "Rogland Clear Night" de Poly Haven (CC0),
// voir asset/textures/. Le bas du panorama (relief photographié) n'est pas utilisé.
const NIGHT_SKY = 'asset/textures/night_sky.jpg';

const vertexShader = /* glsl */`
    varying vec3 vDirection;
    void main() {
        vDirection = position; // sphère centrée sur la caméra : la position donne la direction
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = /* glsl */`
    uniform sampler2D uMap;
    uniform vec3 uHorizon;
    uniform float uBrightness;
    uniform float uOpacity;
    uniform float uFlash;
    varying vec3 vDirection;
    #define PI 3.141592653589793

    void main() {
        vec3 d = normalize(vDirection);
        float elevation = asin(clamp(d.y, -1.0, 1.0));
        // Image équirectangulaire de l'hémisphère : bas = horizon, haut = zénith
        vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, clamp(elevation / (0.5 * PI), 0.0, 1.0));
        vec3 stars = texture2D(uMap, uv).rgb * uBrightness;
        // Fondu vers la brume de l'horizon (le relief et le brouillard prennent le relais)
        vec3 color = mix(uHorizon, stars, smoothstep(0.0, 0.18, d.y));
        color += uFlash * vec3(0.6, 0.65, 0.8);
        gl_FragColor = vec4(color, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

class NightSky {
    constructor({ radius = 2400 } = {}) {
        const map = new TextureLoader().load(NIGHT_SKY);
        map.colorSpace = SRGBColorSpace;

        this.material = new ShaderMaterial({
            uniforms: {
                uMap: { value: map },
                uHorizon: { value: new Color(0x0b1a2e) },
                uBrightness: { value: 1.6 },
                uOpacity: { value: 1 },
                uFlash: { value: 0 },
            },
            vertexShader,
            fragmentShader,
            side: BackSide,
            depthWrite: false,
            transparent: true,
            fog: false,
        });
        this.mesh = new Mesh(new SphereGeometry(radius, 64, 32), this.material);
        this.mesh.renderOrder = -1;     // dessiné en premier, derrière tout le reste
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
    }

    // visibility : 0 = invisible (jour), 1 = nuit claire
    setVisibility(visibility, horizonColor) {
        this.mesh.visible = visibility > 0;
        this.material.uniforms.uOpacity.value = visibility;
        if (horizonColor !== undefined) this.material.uniforms.uHorizon.value.set(horizonColor);
    }

    update(camera) {
        this.mesh.position.copy(camera.position);
    }
}

export { NightSky };
