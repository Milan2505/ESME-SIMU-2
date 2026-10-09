import {
    ACESFilmicToneMapping,
    HalfFloatType,
    MathUtils,
    PCFShadowMap,
    Vector2,
    Vector3,
    WebGLRenderTarget
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

// Résolution adaptative : si l'image ralentit, on calcule moins de pixels (puis on remonte quand ça va mieux)
const MIN_PIXEL_RATIO = 0.6;
// Résolution automatique : au plus ~2 millions de pixels calculés par image (Full HD), quelle que soit la taille
// de l'écran. Sans ce plafond, le plein écran sur un grand écran HD calculait 3 à 4 fois plus de pixels.
const PIXEL_BUDGET = 2.1e6;
const PIXEL_RATIO_STEP = 0.2;
const LOW_FPS = 0.85;           // sous 85 % des i/s visées : on baisse la résolution
const HIGH_FPS = 0.95;          // au-dessus de 95 % pendant plusieurs secondes : on la remonte

// Ciel atmosphérique, ombres portées et post-traitement
class Graphics {
    constructor(renderer, scene, camera, sunLight) {
        Object.assign(this, { renderer, scene, camera, sunLight });
        this.sunDirection = new Vector3(0, 1, 0);

        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.75;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap; // ombres filtrées, nettement moins coûteuses que PCFSoft

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
        // Anticrénelage : rendu multi-échantillonné (MSAA 4x). L'option "antialias" du renderer
        // ne s'applique pas au post-traitement, qui dessine dans ses propres textures.
        const size = renderer.getDrawingBufferSize(new Vector2());
        const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
        this.composer = new EffectComposer(renderer, target);
        // La 2e texture ne reçoit que l'étalonnage (une image déjà lissée) : inutile de la multi-échantillonner.
        // Les passes Grade et Output échangent chacune les textures : la scène est donc toujours dessinée dans la 1re.
        this.composer.renderTarget2.samples = 0;
        this.composer.addPass(new RenderPass(scene, camera));
        this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.25, 0.4, 0.92);
        // Halo calculé à mi-résolution : il est flou de toute façon, 4 fois moins de pixels à traiter
        const setBloomSize = this.bloom.setSize.bind(this.bloom);
        this.bloom.setSize = (width, height) => setBloomSize(Math.ceil(width / 2), Math.ceil(height / 2));
        this.composer.addPass(this.bloom);
        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.grade);
        this.composer.addPass(new OutputPass());

        this.maxPixelRatio = renderer.getPixelRatio();
        this._cssSize = { width: 1, height: 1 };
        this.autoResolution = true;
        this.targetFps = 60;            // i/s visées (réglage "Images par seconde")
        this._quality = { frames: 0, start: performance.now(), goodSeconds: 0, holdUntil: 0, raisedAt: -Infinity, noRaiseUntil: 0 };
    }

    // --- Réglages de qualité (menu Paramètres) ---

    // resolution : 'auto' (adaptative) ou densité de pixels fixe (1 = un pixel calculé par pixel CSS)
    setResolution(resolution) {
        this.autoResolution = resolution === 'auto';
        this.setPixelRatio(this.autoResolution ? this._autoMaxRatio() : resolution);
        this._quality.goodSeconds = 0;
        this._quality.holdUntil = performance.now() + 2000;
    }

    // samples : 0 (sans), 2 ou 4 (MSAA)
    setAntialias(samples) {
        const target = this.composer.renderTarget1; // celle où la scène est dessinée (voir constructeur)
        if (target.samples === samples) return;
        target.samples = samples;
        target.dispose(); // recréée à la prochaine image avec le nouvel échantillonnage
    }

    setBloom(enabled) {
        this.bloom.enabled = enabled;
    }

    // size : 0 (sans ombres), 1024, 2048 ou 4096 (finesse de la carte d'ombres)
    setShadows(size) {
        const enabled = size > 0;
        this.renderer.shadowMap.enabled = enabled;
        this.sunLight.castShadow = enabled;
        if (enabled && this.sunLight.shadow.mapSize.x !== size) {
            this.sunLight.shadow.mapSize.set(size, size);
            this.sunLight.shadow.map?.dispose();
            this.sunLight.shadow.map = null; // recréée à la bonne taille
        }
    }

    // À appeler à chaque image : ajuste la résolution selon les images par seconde mesurées
    adaptResolution() {
        const q = this._quality;
        const now = performance.now();
        q.frames++;
        if (now - q.start < 1000) return;
        const fps = (q.frames * 1000) / (now - q.start);
        q.frames = 0;
        q.start = now;
        if (!this.autoResolution || document.hidden || now < q.holdUntil) return;

        const ratio = this.renderer.getPixelRatio();
        q.goodSeconds = fps > HIGH_FPS * this.targetFps ? q.goodSeconds + 1 : 0;
        if (fps < LOW_FPS * this.targetFps && ratio > MIN_PIXEL_RATIO) {
            this.setPixelRatio(Math.max(MIN_PIXEL_RATIO, ratio - PIXEL_RATIO_STEP));
            q.holdUntil = now + 2000;       // laisse le temps de mesurer le nouvel état
            // Remontée qui a fait rechuter les i/s : on ne réessaie pas avant 30 s (évite le yo-yo de résolution)
            if (now - q.raisedAt < 6000) q.noRaiseUntil = now + 30000;
        } else if (q.goodSeconds >= 8 && now > q.noRaiseUntil && ratio < this._autoMaxRatio() - 0.01) {
            this.setPixelRatio(Math.min(this._autoMaxRatio(), ratio + PIXEL_RATIO_STEP));
            q.goodSeconds = 0;
            q.holdUntil = now + 2000;
            q.raisedAt = now;
        }
    }

    // Densité de pixels max en résolution automatique : celle de l'écran, dans la limite du budget de pixels
    _autoMaxRatio() {
        const { width, height } = this._cssSize;
        return Math.max(MIN_PIXEL_RATIO, Math.min(this.maxPixelRatio, Math.sqrt(PIXEL_BUDGET / (width * height))));
    }

    setPixelRatio(ratio) {
        this.renderer.setPixelRatio(ratio);
        this.composer.setPixelRatio(ratio);
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
        const grew = width * height > this._cssSize.width * this._cssSize.height * 1.2;
        this._cssSize = { width, height };
        if (this.autoResolution) {
            // Agrandissement (plein écran) : on part directement du plafond du budget de pixels,
            // puis l'adaptation aux i/s reprend après un court délai
            const max = this._autoMaxRatio();
            const ratio = grew ? max : Math.min(this.renderer.getPixelRatio(), max);
            this.renderer.setPixelRatio(ratio);
            this._quality.goodSeconds = 0;
            this._quality.holdUntil = performance.now() + 1500;
        }
        // Suit la densité de pixels (sinon rendu flou / crénelé sur les écrans haute définition)
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
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
