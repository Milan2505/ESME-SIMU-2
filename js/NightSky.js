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
    #define SKY_START 0.3

    void main() {
        vec3 d = normalize(vDirection);
        // Sous l'horizon (au-delà du bord du terrain, vu d'altitude) : ciel en miroir, pour couvrir tout l'horizon
        float elevation = asin(clamp(abs(d.y), 0.0, 1.0));
        // Image équirectangulaire de l'hémisphère : bas = horizon, haut = zénith
        // Le bas du panorama photographié contient des collines (silhouettes 2D) : on ne garde que le ciel
        // au-dessus d'elles (SKY_START), étiré jusqu'à l'horizon. Le relief 3D du jeu fait le reste.
        float v = SKY_START + (1.0 - SKY_START) * clamp(elevation / (0.5 * PI), 0.0, 1.0);
        vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, v);
        vec3 stars = texture2D(uMap, uv).rgb * uBrightness;
        // Étoiles jusqu'à l'horizon ; légère brume au ras de l'horizon seulement
        vec3 color = mix(stars, uHorizon, 0.45 * (1.0 - smoothstep(0.0, 0.06, abs(d.y))));
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
                uBrightness: { value: 0.85 },
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
