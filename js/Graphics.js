import {
    ACESFilmicToneMapping,
    BackSide,
    CubeCamera,
    HalfFloatType,
    MathUtils,
    Mesh,
    PCFShadowMap,
    Scene,
    ShaderMaterial,
    SphereGeometry,
    Vector2,
    Vector3,
    WebGLCubeRenderTarget,
    WebGLRenderTarget
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Halo lumineux (bloom) dont le résultat reste dans sa propre texture (quart de résolution) : il est ajouté
// à l'image dans la passe finale. L'original le recollait dans la texture de la scène (multi-échantillonnée) :
// une passe plein écran en MSAA 4x et une seconde résolution MSAA à chaque image.
class BloomPass extends UnrealBloomPass {
    get texture() {
        return this.renderTargetsHorizontal[0].texture;
    }

    render(renderer, writeBuffer, readBuffer) {
        renderer.getClearColor(this._oldClearColor);
        this.oldClearAlpha = renderer.getClearAlpha();
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setClearColor(this.clearColor, 0);

        // 1. Zones lumineuses
        this.highPassUniforms.tDiffuse.value = readBuffer.texture;
        this.highPassUniforms.luminosityThreshold.value = this.threshold;
        this.fsQuad.material = this.materialHighPassFilter;
        renderer.setRenderTarget(this.renderTargetBright);
        renderer.clear();
        this.fsQuad.render(renderer);

        // 2. Flou à résolutions décroissantes
        let input = this.renderTargetBright;
        for (let i = 0; i < this.nMips; i++) {
            const material = this.separableBlurMaterials[i];
            this.fsQuad.material = material;
            material.uniforms.colorTexture.value = input.texture;
            material.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
            renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
            renderer.clear();
            this.fsQuad.render(renderer);
            material.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
            material.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
            renderer.setRenderTarget(this.renderTargetsVertical[i]);
            renderer.clear();
            this.fsQuad.render(renderer);
            input = this.renderTargetsVertical[i];
        }

        // 3. Assemblage des niveaux, dans this.texture
        this.fsQuad.material = this.compositeMaterial;
        this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
        this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
        this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
        renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
        renderer.clear();
        this.fsQuad.render(renderer);

        renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
        renderer.autoClear = oldAutoClear;
    }
}

// Passe finale unique : halo + étalonnage (vignettage, saturation, voile rouge du décrochage) + tone mapping
// et sRGB (OutputPass). Une seule passe plein écran au lieu de trois.
class FinalPass extends OutputPass {
    constructor(bloomTexture) {
        super();
        Object.assign(this.uniforms, {
            tBloom: { value: bloomTexture },
            uBloom: { value: 1 },          // 0 : halo désactivé
            uVignette: { value: 0.35 },    // assombrissement des bords
            uSaturation: { value: 1.1 },
            uAlarm: { value: 0 },          // 0 -> 1 : intensité du voile rouge
        });
        this.material.fragmentShader = this.material.fragmentShader
            .replace('uniform sampler2D tDiffuse;', /* glsl */`uniform sampler2D tDiffuse;
                uniform sampler2D tBloom;
                uniform float uBloom;
                uniform float uVignette;
                uniform float uSaturation;
                uniform float uAlarm;`)
            .replace('gl_FragColor = texture2D( tDiffuse, vUv );', /* glsl */`gl_FragColor = texture2D( tDiffuse, vUv );
                if (uBloom > 0.0) gl_FragColor.rgb += texture2D( tBloom, vUv ).rgb;

                float luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                gl_FragColor.rgb = mix(vec3(luma), gl_FragColor.rgb, uSaturation);
                float edge = smoothstep(0.35, 0.85, length(vUv - 0.5) * 1.4);
                gl_FragColor.rgb *= 1.0 - uVignette * edge;
                gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.8, 0.05, 0.05) * max(luma, 0.4), uAlarm * edge);`);
    }
}

// Ciel pré-calculé : simple lecture dans la cubemap (le shader atmosphérique est coûteux par pixel)
const SkyDomeShader = {
    vertexShader: /* glsl */`
        varying vec3 vDirection;
        void main() {
            vDirection = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position.z = gl_Position.w; // au fond : caché (sans calcul) derrière le relief déjà dessiné
        }
    `,
    fragmentShader: /* glsl */`
        uniform samplerCube tSky;
        varying vec3 vDirection;
        void main() {
            gl_FragColor = vec4(textureCube(tSky, vDirection).rgb, 1.0);
        }
    `,
};
const SKY_CUBE_SIZE = 512;      // côté d'une face de la cubemap du ciel

const SHADOW_SIZE = 120;        // demi-côté de la zone d'ombres autour de l'avion (m)
const SUN_DISTANCE = 400;

// Résolution adaptative : si l'image ralentit, on calcule moins de pixels (puis on remonte quand ça va mieux)
// Jamais sous un pixel calculé par pixel CSS : en dessous, l'image agrandie paraît pixelisée malgré l'anticrénelage
// (sur un écran HD, un pixel calculé couvrait plus de 3 pixels physiques à 0,6). Plus bas : réglage manuel 75 % / 50 %.
const MIN_PIXEL_RATIO = 1;
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

        // Ciel : diffusion atmosphérique (Rayleigh / Mie). Il ne dépend que de la météo : calculé une fois
        // dans une cubemap (voir setAtmosphere), la scène n'affiche qu'un dôme qui lit cette texture.
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
        this.skyScene = new Scene().add(this.sky);
        const skyTarget = new WebGLCubeRenderTarget(SKY_CUBE_SIZE, { type: HalfFloatType });
        this.skyCamera = new CubeCamera(1, 5000, skyTarget);
        this.skyDome = new Mesh(new SphereGeometry(2000, 32, 16), new ShaderMaterial({
            ...SkyDomeShader,
            uniforms: { tSky: { value: skyTarget.texture } },
            side: BackSide,
            depthWrite: false,
        }));
        this.skyDome.frustumCulled = false;
        this.skyDome.renderOrder = 1; // après le décor opaque : seuls les pixels de ciel visibles sont calculés
        scene.add(this.skyDome);

        // Post-traitement
        // Anticrénelage : rendu multi-échantillonné (MSAA 4x). L'option "antialias" du renderer
        // ne s'applique pas au post-traitement, qui dessine dans ses propres textures.
        const size = renderer.getDrawingBufferSize(new Vector2());
        const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
        this.composer = new EffectComposer(renderer, target);
        // Aucune passe n'échange les textures (la passe finale dessine à l'écran) : la scène est toujours
        // dessinée dans la 1re, la 2e ne sert pas -> pas de multi-échantillonnage pour elle.
        this.composer.renderTarget2.samples = 0;
        this.composer.addPass(new RenderPass(scene, camera));
        this.bloom = new BloomPass(new Vector2(256, 256), 0.25, 0.4, 0.92);
        // Halo calculé à mi-résolution : il est flou de toute façon, 4 fois moins de pixels à traiter
        const setBloomSize = this.bloom.setSize.bind(this.bloom);
        this.bloom.setSize = (width, height) => setBloomSize(Math.ceil(width / 2), Math.ceil(height / 2));
        this.composer.addPass(this.bloom);
        this.final = new FinalPass(this.bloom.texture);
        this.composer.addPass(this.final);

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
        this.final.uniforms.uBloom.value = enabled ? 1 : 0;
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
        if (fps < LOW_FPS * this.targetFps && ratio > this._autoMinRatio() + 0.01) {
            this.setPixelRatio(Math.max(this._autoMinRatio(), ratio - PIXEL_RATIO_STEP));
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
        return Math.max(this._autoMinRatio(), Math.min(this.maxPixelRatio, Math.sqrt(PIXEL_BUDGET / (width * height))));
    }

    // Densité de pixels min en résolution automatique (celle de l'écran si elle est plus basse)
    _autoMinRatio() {
        return Math.min(MIN_PIXEL_RATIO, this.maxPixelRatio);
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
        this.skyDome.visible = Boolean(atmosphere);
        if (atmosphere) {
            const uniforms = this.sky.material.uniforms;
            uniforms.turbidity.value = atmosphere.turbidity;
            uniforms.rayleigh.value = atmosphere.rayleigh;
            uniforms.sunPosition.value.copy(this.sunDirection);
            this.skyCamera.update(this.renderer, this.skyScene);
        }
    }

    setAlarm(level) {
        this.final.uniforms.uAlarm.value = level;
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
        this.skyDome.position.copy(this.camera.position);
        this.sunLight.target.position.copy(shadowCenter);
        this.sunLight.position.copy(shadowCenter).addScaledVector(this.sunDirection, SUN_DISTANCE);
    }

    render() {
        this.composer.render();
    }
}

export { Graphics };
