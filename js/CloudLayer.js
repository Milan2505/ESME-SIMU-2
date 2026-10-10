import {
    BackSide,
    Color,
    FrontSide,
    Group,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    UniformsLib,
    UniformsUtils
} from 'three';

// Couche nuageuse continue (stratus) pour les ciels couverts : un plafond gris, percé de quelques trouées, qui suit
// la caméra (le motif, lui, reste fixe au sol et dérive lentement avec le vent). Deux surfaces : le dessous, gris
// sombre, et le dessus, blanc, vu quand on passe au-dessus ; entre les deux, on est dans le nuage ("jour blanc").
// Bien moins coûteux que des milliers de bouffées : deux grands plans, un bruit calculé par pixel.

const SIZE = 6000;          // côté des plans (m) : jusqu'à la limite de la vue (caméra : 3000 m)
const OCTAVES = 5;

const vertexShader = /* glsl */`
    varying vec3 vWorld;
    #include <fog_pars_vertex>
    void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

const fragmentShader = /* glsl */`
    uniform vec3 uColor;
    uniform vec3 uShadow;
    uniform float uCoverage;
    uniform float uScale;
    uniform vec2 uDrift;
    uniform float uOpacity;
    uniform float uBrightness;
    uniform float uTop;          // 1 : dessus (éclairé par le soleil), 0 : dessous
    uniform vec2 uSun;           // direction du soleil (plan horizontal)
    varying vec3 vWorld;
    #include <fog_pars_fragment>

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
    // Moutonnement ("coton") : grosses boursouflures (~400 m), bosses (~120 m) et petits flocons (~35 m)
    float wool(vec2 p) {
        return fbm3(p / 400.0) * 0.45 + fbm3(p / 120.0 + 7.7) * 0.35 + fbm3(p / 35.0 + 3.1) * 0.2;
    }

    void main() {
        vec2 p = vWorld.xz + uDrift;
        float n = fbm(p / uScale);
        // Détail estompé au loin (sinon il scintille). Distance calculée ici : le plan n'a que 4 sommets, à plus de 3 km
        float detail = 1.0 - smoothstep(900.0, 2600.0, distance(vWorld, cameraPosition));
        float w = wool(p);
        // Couverture : 1 = plafond presque continu ; bords des trouées effilochés par le moutonnement
        float edge = n + (w - 0.5) * 0.22 * detail;
        float cloud = smoothstep(1.0 - uCoverage - 0.06, 1.0 - uCoverage + 0.14, edge);
        float alpha = cloud * uOpacity;
        if (alpha < 0.01) discard;
        // Relief des bosses éclairé par le soleil : pente vers le soleil claire, versant opposé et creux sombres
        float slope = (w - wool(p + uSun * 15.0)) * 14.0;
        float hollow = smoothstep(0.3, 0.7, w);
        vec3 color;
        if (uTop > 0.5) {
            // Dessus : sommets des bosses blancs, creux gris, versant au soleil éclairé, versant opposé dans l'ombre
            float light = 0.45 + 0.55 * hollow + slope;
            color = mix(uShadow, uColor, clamp(mix(0.8, light, detail), 0.0, 1.08));
        } else {
            // Dessous : plus sombre là où la couche est épaisse (sous les bosses), plus clair dans les creux
            float thick = smoothstep(0.35, 0.8, n) * 0.45 + hollow * 0.55 * detail;
            color = mix(uColor, uShadow, clamp(thick - slope * 0.5 * detail, 0.0, 1.0));
        }
        // Bord des trouées plus clair (nuage mince)
        color = mix(color, uColor, (1.0 - cloud) * 0.5);
        gl_FragColor = vec4(color * uBrightness, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
    }
`;

// Même bruit qu'en GLSL (approché), pour savoir si la caméra est dans une trouée
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
function fbm(x, y) {
    let value = 0, amplitude = 0.5;
    for (let o = 0; o < OCTAVES; o++) {
        value += amplitude * noise(x, y);
        x = x * 2.03 + 17.1;
        y = y * 2.03 + 9.4;
        amplitude *= 0.5;
    }
    return value;
}
function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function createMaterial() {
    return new ShaderMaterial({
        uniforms: UniformsUtils.merge([UniformsLib.fog, {
            uColor: { value: new Color() },
            uShadow: { value: new Color() },
            uCoverage: { value: 0.85 },
            uScale: { value: 900 },
            uDrift: { value: [0, 0] },
            uOpacity: { value: 0.97 },
            uBrightness: { value: 1 },
            uTop: { value: 0 },
            uSun: { value: [0.5, -0.866] },     // soleil au sud-est (azimut 150°), comme le jour
        }]),
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        fog: true,
    });
}

class CloudLayer {
    constructor() {
        this.mesh = new Group();
        this.mesh.visible = false;
        this.enabled = true;    // réglage de qualité
        this.config = null;     // couche de la météo en cours (null : pas de couche)
        this._drift = [0, 0];
        const geometry = new PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2);
        this.bottom = new Mesh(geometry, createMaterial());
        this.top = new Mesh(geometry, createMaterial());
        // Chaque surface n'est dessinée que du côté où on la voit (deux fois moins de calcul)
        this.bottom.material.side = BackSide;   // vue d'en dessous
        this.top.material.side = FrontSide;     // vue d'au-dessus
        this.top.material.uniforms.uTop.value = 1;
        for (const plane of [this.bottom, this.top]) {
            plane.frustumCulled = false;
            plane.renderOrder = 1;
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
            u.uBrightness.value = gain;
        };
        // Dessous gris (ombre du nuage) ; dessus éclairé par le soleil
        set(this.bottom, new Color(dark).lerp(new Color(light), 0.6), new Color(dark).multiplyScalar(0.85), 0.9);
        set(this.top, light, new Color(light).lerp(new Color(dark), 0.55), 0.97);
        this.bottom.position.y = config.base;
        this.top.position.y = config.top;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this._apply();
    }

    // Densité du nuage à la position donnée (0 = dehors, 1 = au cœur), pour le "jour blanc"
    densityAt(position) {
        if (!this.mesh.visible) return 0;
        const { base, top, coverage, scale = 900 } = this.config;
        if (position.y < base - 15 || position.y > top + 15) return 0;
        const n = fbm((position.x + this._drift[0]) / scale, (position.z + this._drift[1]) / scale);
        const cloud = smoothstep(1 - coverage - 0.08, 1 - coverage + 0.18, n);
        // Plus dense au milieu de l'épaisseur, fondu sur 15 m aux bords
        const depth = Math.min(position.y - base + 15, top + 15 - position.y) / 30;
        return cloud * Math.min(1, depth);
    }

    // wind : 0 -> 1 (le vent vient du nord : la couche dérive vers le sud)
    update(delta, camera, wind) {
        if (!this.mesh.visible) return;
        this._drift[1] -= wind * 6 * delta;
        // Les plans suivent la caméra (le motif reste attaché au sol, voir uDrift)
        this.mesh.position.x = camera.position.x;
        this.mesh.position.z = camera.position.z;
        for (const plane of [this.bottom, this.top]) plane.material.uniforms.uDrift.value = this._drift;
    }

    _apply() {
        this.mesh.visible = Boolean(this.config) && this.enabled;
    }
}

export { CloudLayer };
