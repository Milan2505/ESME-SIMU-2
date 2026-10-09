import {
    ACESFilmicToneMapping,
    MathUtils,
    PCFSoftShadowMap,
    Vector2,
    Vector3
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Vignettage + étalonnage léger, et voile rouge sur les bords pendant le décrochage
const GradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        uVignette: { value: 0.35 },    // assombrissement des bords
        uSaturation: { value: 1.1 },
        uAlarm: { value: 0 },          // 0 -> 1 : intensité du voile rouge
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uVignette;
        uniform float uSaturation;
        uniform float uAlarm;
        varying vec2 vUv;

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            color.rgb = mix(vec3(luma), color.rgb, uSaturation);

            float edge = smoothstep(0.35, 0.85, length(vUv - 0.5) * 1.4);
            color.rgb *= 1.0 - uVignette * edge;
            color.rgb = mix(color.rgb, vec3(0.8, 0.05, 0.05) * max(luma, 0.4), uAlarm * edge);
            gl_FragColor = color;
        }
    `,
};

const SHADOW_SIZE = 120;        // demi-côté de la zone d'ombres autour de l'avion (m)
const SUN_DISTANCE = 400;

// Ciel atmosphérique, ombres portées et post-traitement
class Graphics {
    constructor(renderer, scene, camera, sunLight) {
        Object.assign(this, { renderer, scene, camera, sunLight });
        this.sunDirection = new Vector3(0, 1, 0);

        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.75;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFSoftShadowMap;

        // Ombres : la zone couverte suit l'avion
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(2048, 2048);
        Object.assign(sunLight.shadow.camera, {
            left: -SHADOW_SIZE, right: SHADOW_SIZE, top: SHADOW_SIZE, bottom: -SHADOW_SIZE,
            near: 1, far: SUN_DISTANCE * 2,
        });
        sunLight.shadow.bias = -0.0005;
        sunLight.shadow.normalBias = 0.3;
        scene.add(sunLight.target);

        // Ciel : diffusion atmosphérique (Rayleigh / Mie)
        this.sky = new Sky();
        this.sky.scale.setScalar(2500); // doit rester dans le champ de la caméra (far)
        const skyMaterial = this.sky.material;
        skyMaterial.uniforms.mieCoefficient.value = 0.003;
        skyMaterial.uniforms.mieDirectionalG.value = 0.8;
        // Exposition propre au ciel (sinon il sature en blanc avec l'exposition de la scène)
        skyMaterial.uniforms.uSkyExposure = { value: 0.45 };
        skyMaterial.fragmentShader = skyMaterial.fragmentShader
            .replace('void main() {', 'uniform float uSkyExposure;\nvoid main() {')
            .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * uSkyExposure, 1.0 );');
        scene.add(this.sky);

        // Post-traitement
        this.composer = new EffectComposer(renderer);
        this.composer.addPass(new RenderPass(scene, camera));
        this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.25, 0.4, 0.92);
        this.composer.addPass(this.bloom);
        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.grade);
        this.composer.addPass(new OutputPass());
    }

    // atmosphere : { elevation, azimuth, turbidity, rayleigh } (degrés), ou null pour un ciel uni
    setAtmosphere(atmosphere, { elevation = 50, azimuth = 150 } = {}) {
        const sun = atmosphere ?? { elevation, azimuth };
        this.sunDirection.setFromSphericalCoords(
            1, MathUtils.degToRad(90 - sun.elevation), MathUtils.degToRad(sun.azimuth)
        );
        this.sky.visible = Boolean(atmosphere);
        if (atmosphere) {
            const uniforms = this.sky.material.uniforms;
            uniforms.turbidity.value = atmosphere.turbidity;
            uniforms.rayleigh.value = atmosphere.rayleigh;
            uniforms.sunPosition.value.copy(this.sunDirection);
        }
    }

    setAlarm(level) {
        this.grade.uniforms.uAlarm.value = level;
    }

    setSize(width, height) {
        this.composer.setSize(width, height);
    }

    // shadowCenter : point autour duquel calculer les ombres (le sol sous l'avion)
    update(shadowCenter) {
        this.sky.position.copy(this.camera.position);
        this.sunLight.target.position.copy(shadowCenter);
        this.sunLight.position.copy(shadowCenter).addScaledVector(this.sunDirection, SUN_DISTANCE);
    }

    render() {
        this.composer.render();
    }
}

export { Graphics };
