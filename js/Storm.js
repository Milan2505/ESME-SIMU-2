import {
    BufferGeometry,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    ShaderMaterial,
    Vector3
} from 'three';

// Gouttes : segments fixes dans le monde, répétés dans une boîte qui suit la caméra.
// Chaque goutte est étirée selon sa vitesse par rapport à l'avion (effet de vitesse).
const rainVertexShader = /* glsl */`
    attribute float aEnd;          // 0 = tête de la goutte, 1 = queue
    uniform vec3 uCenter;
    uniform vec3 uOffset;
    uniform vec3 uTrail;
    uniform float uBox;
    uniform float uIntensity;
    uniform float uNear;           // pas de gouttes à l'intérieur de la cabine
    uniform float uBase;           // base des nuages : la pluie tombe de là
    uniform float uFade;           // dans le nuage, la pluie s'estompe sur cette hauteur (au-dessus : plus de pluie)
    varying float vAlpha;

    void main() {
        vec3 p = position * uBox + uOffset;
        p = uCenter + mod(p - uCenter, uBox) - 0.5 * uBox;
        float dist = length(p - uCenter);
        vAlpha = (1.0 - smoothstep(0.2 * uBox, 0.5 * uBox, dist)) * smoothstep(uNear, uNear + 1.0, dist)
            * uIntensity * (1.0 - 0.6 * aEnd)
            * (1.0 - smoothstep(uBase, uBase + uFade, p.y));
        p -= uTrail * aEnd;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
`;

const rainFragmentShader = /* glsl */`
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
        gl_FragColor = vec4(uColor, vAlpha * 0.45);
        #include <colorspace_fragment>
    }
`;

const FALL_SPEED = 11;         // vitesse de chute des gouttes (m/s)
const STREAK_TIME = 0.035;     // "temps de pose" : longueur des traînées
const SOUND_SPEED = 340;

function random(min, max) {
    return min + Math.random() * (max - min);
}

// Tempête : pluie, éclairs (avec flash lumineux) et tonnerre
class Storm {
    constructor({ drops = 9000, box = 60, groundHeight = () => 0, sounds = null } = {}) {
        this.groundHeight = groundHeight;
        this.sounds = sounds;
        this.rain = 0;               // intensité de la pluie (0 -> 1)
        this.lightning = false;
        this.flash = 0;              // éclat de l'éclair en cours (0 -> 1), pour l'éclairage de la scène
        this.cloudBase = null;       // base des nuages (m) : pas de pluie au-dessus de la couche
        this.cloudTop = null;

        const seeds = [], ends = [];
        for (let i = 0; i < drops; i++) {
            const x = Math.random(), y = Math.random(), z = Math.random();
            seeds.push(x, y, z, x, y, z);
            ends.push(0, 1);
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(seeds, 3));
        geometry.setAttribute('aEnd', new Float32BufferAttribute(ends, 1));

        this.rainMaterial = new ShaderMaterial({
            uniforms: {
                uCenter: { value: new Vector3() },
                uOffset: { value: new Vector3() },
                uTrail: { value: new Vector3() },
                uBox: { value: box },
                uIntensity: { value: 0 },
                uNear: { value: 0 },
                uBase: { value: 1e6 },
                uFade: { value: 40 },
                uColor: { value: new Vector3(0.75, 0.8, 0.88) },
            },
            vertexShader: rainVertexShader,
            fragmentShader: rainFragmentShader,
            transparent: true,
            depthWrite: false,
        });
        this.rainMesh = new LineSegments(geometry, this.rainMaterial);
        this.rainMesh.frustumCulled = false;
        this.rainMesh.visible = false;
        this.rainMesh.renderOrder = 2;

        this._box = box;
        this._wind = new Vector3(2, -FALL_SPEED, 1.5);
        this._relative = new Vector3();

        this.boltMaterial = new LineBasicMaterial({ fog: false, transparent: true, depthWrite: false });
        this.boltMaterial.color.setRGB(6, 6, 9); // > 1 : capté par le bloom (halo)
        this.bolt = new LineSegments(new BufferGeometry(), this.boltMaterial);
        this.bolt.frustumCulled = false;
        this.bolt.visible = false;

        this._nextStrike = random(2, 6);
        this._strikeTime = -1;
        this._strikeStrength = 0;
    }

    // rain : 0 -> 1 ; lightning : éclairs actifs ; clouds : { base, top } de la couche nuageuse (la pluie en tombe)
    setWeather({ rain = 0, lightning = false, clouds = null } = {}) {
        this.rain = rain;
        this.lightning = lightning;
        this.cloudBase = clouds?.base ?? null;
        this.cloudTop = clouds?.top ?? null;
        const u = this.rainMaterial.uniforms;
        u.uBase.value = clouds ? clouds.base : 1e6;
        u.uFade.value = clouds ? (clouds.top - clouds.base) * 0.6 : 40;
        this.rainMesh.visible = rain > 0;
        this.rainMaterial.uniforms.uIntensity.value = rain;
        if (!lightning) {
            this.bolt.visible = false;
            this.flash = 0;
        }
    }

    // Pluie à l'altitude donnée : pleine sous les nuages, s'estompe dans le nuage, nulle au-dessus
    rainAt(y) {
        if (this.cloudBase === null) return this.rain;
        const fade = (this.cloudTop - this.cloudBase) * 0.6;
        const t = Math.min(1, Math.max(0, (y - this.cloudBase) / fade));
        return this.rain * (1 - t * t * (3 - 2 * t));
    }

    // velocity : vitesse de l'avion (m/s, repère monde) ; near : rayon sans gouttes autour de la caméra (m)
    update(delta, camera, velocity, near = 0) {
        if (this.rain > 0) {
            const u = this.rainMaterial.uniforms;
            u.uCenter.value.copy(camera.position);
            u.uNear.value = near;
            u.uOffset.value.addScaledVector(this._wind, delta);
            for (const axis of ['x', 'y', 'z']) u.uOffset.value[axis] %= this._box;
            this._relative.subVectors(this._wind, velocity);
            u.uTrail.value.copy(this._relative).multiplyScalar(STREAK_TIME);
        }
        if (this.lightning) this._updateLightning(delta, camera);
    }

    _updateLightning(delta, camera) {
        this._nextStrike -= delta;
        if (this._nextStrike <= 0) {
            this._strike(camera);
            this._nextStrike = random(3, 10);
        }
        if (this._strikeTime < 0) return;

        // Scintillement typique : plusieurs décharges successives en ~0,4 s
        this._strikeTime += delta;
        const t = this._strikeTime;
        const pulse = t < 0.06 ? 1 : t < 0.12 ? 0.25 : t < 0.2 ? 0.85 : t < 0.26 ? 0.2 : t < 0.38 ? 0.55 * (1 - (t - 0.26) / 0.12) : 0;
        this.flash = pulse * this._strikeStrength;
        this.bolt.visible = pulse > 0.3;
        this.boltMaterial.opacity = pulse;
        if (t > 0.4) {
            this._strikeTime = -1;
            this.flash = 0;
            this.bolt.visible = false;
        }
    }

    _strike(camera) {
        // Deux éclairs sur trois tombent dans le champ de vision, les autres n'importe où
        const center = camera.position;
        camera.getWorldDirection(this._relative);
        const ahead = Math.atan2(this._relative.z, this._relative.x);
        const angle = Math.random() < 0.67 ? ahead + random(-0.6, 0.6) : Math.random() * Math.PI * 2;
        const distance = random(250, 1600);
        const x = center.x + Math.cos(angle) * distance;
        const z = center.z + Math.sin(angle) * distance;
        // L'éclair part de la base des nuages
        const top = this.cloudBase !== null ? random(this.cloudBase, this.cloudBase + 30) : random(260, 340);
        const bottom = this.groundHeight(x, z);

        const positions = [];
        // Tracé principal en zigzag, avec quelques branches
        const segment = (x0, y0, z0, steps, length, spread) => {
            let px = x0, py = y0, pz = z0;
            for (let i = 0; i < steps && py > bottom; i++) {
                const nx = px + random(-spread, spread);
                const ny = Math.max(bottom, py - length * random(0.6, 1.2));
                const nz = pz + random(-spread, spread);
                positions.push(px, py, pz, nx, ny, nz);
                if (spread > 8 && Math.random() < 0.18) segment(nx, ny, nz, 4 + Math.floor(Math.random() * 4), length * 0.6, spread * 0.8);
                px = nx; py = ny; pz = nz;
            }
        };
        segment(x, top, z, 40, (top - bottom) / 24, 14);

        this.bolt.geometry.dispose();
        this.bolt.geometry = new BufferGeometry();
        this.bolt.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        this._strikeTime = 0;
        this._strikeStrength = Math.max(0.25, 1 - distance / 2000);

        // Le tonnerre arrive avec le retard du son (340 m/s), plus faible quand l'éclair est loin
        if (this.sounds) {
            const name = `thunder${1 + Math.floor(Math.random() * 3)}`;
            this.sounds.play(name, { delay: distance / SOUND_SPEED, volume: Math.max(0.25, 1.2 - distance / 1800) });
        }
    }
}

export { Storm };
