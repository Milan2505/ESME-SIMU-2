import {
    BackSide,
    Color,
    FrontSide,
    Group,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    UniformsLib,
    UniformsUtils,
    Vector2,
    Vector3
} from 'three';

// Couche nuageuse continue (stratus / nappe d'orage) pour les ciels couverts. Vraie nappe en relief : deux surfaces
// maillées (dessus et dessous) déformées par un bruit, avec des bosses de 100 à 400 m qui dépassent vraiment (silhouette
// à l'horizon, parallaxe), et des trouées où dessus et dessous se rejoignent (parois). Le maillage suit la caméra par
// pas de maille (le relief reste fixe au sol et dérive lentement avec le vent).
// Entre les deux surfaces, on est dans le nuage ("jour blanc", voir densityAt).

const SIZE = 6000;          // côté du maillage (m) : jusqu'à la limite de la vue (caméra : 3000 m)
const SEGMENTS = 160;       // mailles resserrées près de la caméra (~9 m) et larges au loin (~65 m), voir le vertex shader
const SNAP = 10;            // pas de déplacement du maillage avec la caméra (m)
const OCTAVES = 5;

const noiseGLSL = /* glsl */`
    uniform float uCoverage;
    uniform float uScale;
    uniform vec2 uDrift;
    float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }
    float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
        float value = 0.0, amplitude = 0.5;
        for (int o = 0; o < ${OCTAVES}; o++) {
            value += amplitude * noise(p);
            p = p * 2.03 + vec2(17.1, 9.4);
            amplitude *= 0.5;
        }
        return value;
    }
    float fbm3(vec2 p) {
        float value = 0.0, amplitude = 0.5;
        for (int o = 0; o < 3; o++) {
            value += amplitude * noise(p);
            p = p * 2.07 + vec2(5.3, 11.7);
            amplitude *= 0.5;
        }
        return value;
    }
    // Relief : grosses boursouflures (~400 m) et bosses (~120 m)
    float bumps(vec2 p) {
        return fbm3(p / 400.0) * 0.6 + fbm3(p / 120.0 + 7.7) * 0.4;
    }
    // Présence du nuage (0 = trouée, 1 = nappe)
    float cover(vec2 p, float b) {
        float n = fbm(p / uScale) + (b - 0.5) * 0.2;
        return smoothstep(1.0 - uCoverage - 0.06, 1.0 - uCoverage + 0.16, n);
    }
`;

const vertexShader = /* glsl */`
    uniform float uBase;
    uniform float uTop;
    uniform float uSide;        // 1 : dessus, -1 : dessous
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vCover;
    varying float vBumps;
    ${noiseGLSL}
    #include <fog_pars_vertex>

    // Hauteur de la surface au point p (monde, dérive comprise). Dessus : bosses au-dessus du sommet moyen ;
    // dessous : plafond ondulé. Dans les trouées, les deux surfaces se rejoignent au milieu de l'épaisseur (parois)
    float surface(vec2 p, out float c, out float b) {
        b = bumps(p);
        c = cover(p, b);
        float thick = uTop - uBase;
        float middle = uBase + thick * 0.45;
        if (uSide > 0.0) return mix(middle, uTop + (b - 0.5) * thick * 2.4, c);
        return mix(middle, uBase - (b - 0.35) * thick * 0.5, c);
    }

    // Hauteur d'un point voisin : même présence du nuage (elle varie lentement), seul le relief est recalculé
    float neighbour(vec2 p, float c) {
        float b = bumps(p);
        float thick = uTop - uBase;
        float middle = uBase + thick * 0.45;
        if (uSide > 0.0) return mix(middle, uTop + (b - 0.5) * thick * 2.4, c);
        return mix(middle, uBase - (b - 0.35) * thick * 0.5, c);
    }

    void main() {
        // Mailles resserrées au centre (près de la caméra), élargies au bord : x -> 0,25 x + 0,75 x²
        vec2 t = position.xz / ${SIZE / 2}.0;
        vec2 warped = sign(t) * (0.25 * abs(t) + 0.75 * t * t) * ${SIZE / 2}.0;
        vec4 world = modelMatrix * vec4(warped.x, 0.0, warped.y, 1.0);
        vec2 p = world.xz + uDrift;
        float c, b;
        world.y = surface(p, c, b);
        // Normale par différences finies (vers l'extérieur du nuage)
        float hx = neighbour(p + vec2(10.0, 0.0), c);
        float hz = neighbour(p + vec2(0.0, 10.0), c);
        vNormal = normalize(vec3(world.y - hx, 10.0, world.y - hz)) * uSide;
        vCover = c;
        vBumps = b;
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

const fragmentShader = /* glsl */`
    uniform vec3 uColor;
    uniform vec3 uShadow;
    uniform vec3 uSun;
    uniform float uSide;
    uniform float uOpacity;
    uniform float uBrightness;
    uniform float uFlash;        // éclair en cours (0 -> 1)
    uniform vec2 uFlashAt;       // position de l'éclair (x, z)
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vCover;
    varying float vBumps;
    ${noiseGLSL}
    #include <fog_pars_fragment>

    void main() {
        float alpha = smoothstep(0.02, 0.35, vCover) * uOpacity;
        if (alpha < 0.01) discard;
        vec2 p = vWorld.xz + uDrift;
        // Petits flocons (~35 m) dans l'ombrage, estompés au loin (sinon ils scintillent)
        float detail = 1.0 - smoothstep(600.0, 2200.0, distance(vWorld, cameraPosition));
        float fine = fbm3(p / 35.0 + 3.1);
        vec3 normal = normalize(vNormal);
        vec3 toCamera = normalize(cameraPosition - vWorld);
        vec3 color;
        if (uSide > 0.0) {
            // Dessus : éclairé par le soleil, creux et versants opposés dans l'ombre, bords lumineux à contre-jour
            float lambert = clamp(dot(normal, uSun), 0.0, 1.0);
            float light = 0.25 + 0.8 * lambert + (fine - 0.5) * 0.35 * detail;
            light *= mix(0.7, 1.0, smoothstep(0.25, 0.75, vBumps));
            color = mix(uShadow, uColor, clamp(light, 0.0, 1.05));
            float rim = pow(1.0 - clamp(dot(normal, toCamera), 0.0, 1.0), 4.0) * clamp(dot(-toCamera, uSun) + 0.3, 0.0, 1.0);
            color += uColor * rim * 0.2;
        } else {
            // Dessous : sombre là où la nappe est épaisse (sous les bosses), plus clair dans les creux et près des trouées
            float thick = smoothstep(0.3, 0.8, vBumps) * vCover;
            color = mix(uColor, uShadow, clamp(thick + (0.5 - fine) * 0.25 * detail, 0.0, 1.0));
        }
        // Éclair : la nappe s'illumine de l'intérieur autour de l'impact
        float glow = uFlash * exp(-distance(vWorld.xz, uFlashAt) / 450.0);
        color += vec3(0.75, 0.8, 1.0) * glow * (uSide > 0.0 ? 0.8 : 1.4);
        gl_FragColor = vec4(color * uBrightness, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
    }
`;

// Même bruit qu'en GLSL (approché), pour savoir si la caméra est dans le nuage
function fract(x) {
    return x - Math.floor(x);
}
function hash(x, y) {
    let px = fract(x * 123.34), py = fract(y * 456.21);
    const d = px * (px + 45.32) + py * (py + 45.32);
    px += d;
    py += d;
    return fract(px * py);
}
function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, octaves = OCTAVES, k = 2.03, ox = 17.1, oy = 9.4) {
    let value = 0, amplitude = 0.5;
    for (let o = 0; o < octaves; o++) {
        value += amplitude * noise(x, y);
        x = x * k + ox;
        y = y * k + oy;
        amplitude *= 0.5;
    }
    return value;
}
function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function createMaterial(side) {
    return new ShaderMaterial({
        uniforms: UniformsUtils.merge([UniformsLib.fog, {
            uColor: { value: new Color() },
            uShadow: { value: new Color() },
            uCoverage: { value: 0.85 },
            uScale: { value: 900 },
            uDrift: { value: new Vector2() },
            uBase: { value: 300 },
            uTop: { value: 380 },
            uSide: { value: side },
            uSun: { value: new Vector3(0.43, 0.64, -0.64).normalize() },   // soleil au sud-est, comme le jour
            uOpacity: { value: 0.98 },
            uBrightness: { value: 1 },
            uFlash: { value: 0 },
            uFlashAt: { value: new Vector2() },
        }]),
        vertexShader,
        fragmentShader,
        transparent: true,
        // Écrit sa profondeur : les bouffées de nuages et la pluie cachées par la nappe ne passent plus au travers
        depthWrite: true,
        side: side > 0 ? FrontSide : BackSide,   // chaque surface n'est dessinée que du côté où on la voit
        fog: true,
    });
}

class CloudLayer {
    constructor() {
        this.mesh = new Group();
        this.mesh.visible = false;
        this.enabled = true;    // réglage de qualité
        this.config = null;     // couche de la météo en cours (null : pas de couche)
        this._drift = new Vector2();
        const geometry = new PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
        this.top = new Mesh(geometry, createMaterial(1));
        this.bottom = new Mesh(geometry, createMaterial(-1));
        for (const plane of [this.bottom, this.top]) {
            plane.frustumCulled = false;
            plane.renderOrder = 0;   // avant les bouffées (renderOrder 1) : celles qu'elle cache sont écartées
            this.mesh.add(plane);
        }
    }

    // config : { base, top, coverage, scale } (altitudes en m) ; light / dark : couleurs des nuages de la météo
    // Luminosité sous 1 : une si grande surface au-delà du blanc ferait déborder le halo (bloom) sur tout l'écran
    setWeather(config, { light = 0xffffff, dark = 0x777777 } = {}) {
        this.config = config;
        this._apply();
        if (!config) return;
        const set = (plane, color, shadow, gain) => {
            const u = plane.material.uniforms;
            u.uColor.value.set(color);
            u.uShadow.value.set(shadow);
            u.uCoverage.value = config.coverage;
            u.uScale.value = config.scale ?? 900;
            u.uBase.value = config.base;
            u.uTop.value = config.top;
            u.uBrightness.value = gain;
        };
        // Dessus éclairé par le soleil (au-dessus de l'orage aussi : c'est le plein jour là-haut) ; dessous gris
        set(this.top, 0xf4f6f8, new Color(0x8794a5).lerp(new Color(dark), 0.2), 0.97);
        set(this.bottom, new Color(dark).lerp(new Color(light), 0.6), new Color(dark).multiplyScalar(0.85), 0.9);
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this._apply();
    }

    // Éclair : flash (0 -> 1) et position (x, z) de l'impact
    setFlash(flash, x = 0, z = 0) {
        for (const plane of [this.top, this.bottom]) {
            plane.material.uniforms.uFlash.value = flash;
            plane.material.uniforms.uFlashAt.value.set(x, z);
        }
    }

    // Densité du nuage à la position donnée (0 = dehors, 1 = au cœur), pour le "jour blanc"
    densityAt(position) {
        if (!this.mesh.visible) return 0;
        const { base, top, coverage, scale = 900 } = this.config;
        const thick = top - base;
        if (position.y < base - thick * 0.6 || position.y > top + thick * 0.9) return 0;
        const px = position.x + this._drift.x, pz = position.z + this._drift.y;
        const b = fbm(px / 400, pz / 400, 3, 2.07, 5.3, 11.7) * 0.6
            + fbm(px / 120 + 7.7, pz / 120 + 7.7, 3, 2.07, 5.3, 11.7) * 0.4;
        const c = smoothstep(1 - coverage - 0.06, 1 - coverage + 0.16, fbm(px / scale, pz / scale) + (b - 0.5) * 0.2);
        // Entre les deux surfaces (mêmes formules que le shader), fondu sur 15 m
        const middle = base + thick * 0.45;
        const upper = middle + (top + (b - 0.5) * thick * 2.4 - middle) * c;
        const lower = middle + (base - (b - 0.35) * thick * 0.5 - middle) * c;
        return c * smoothstep(-5, 10, Math.min(position.y - lower, upper - position.y));
    }

    // Altitude du dessus de la nappe (moyenne), pour savoir si la caméra est au-dessus
    get topAltitude() {
        return this.config ? this.config.top : Infinity;
    }

    // wind : 0 -> 1 (le vent vient du nord : la couche dérive vers le sud)
    update(delta, camera, wind) {
        if (!this.mesh.visible) return;
        this._drift.y -= wind * 6 * delta;
        // Le maillage suit la caméra (par pas de 10 m : près de la caméra, ses sommets retombent sur les mêmes points
        // du monde ; au loin, les mailles sont larges mais le relief aussi, il ne bouge pas visiblement)
        this.mesh.position.x = Math.round(camera.position.x / SNAP) * SNAP;
        this.mesh.position.z = Math.round(camera.position.z / SNAP) * SNAP;
        for (const plane of [this.bottom, this.top]) plane.material.uniforms.uDrift.value.copy(this._drift);
    }

    _apply() {
        this.mesh.visible = Boolean(this.config) && this.enabled;
    }
}

export { CloudLayer };
