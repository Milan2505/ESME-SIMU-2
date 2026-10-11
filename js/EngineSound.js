// Son du moteur de Cessna 172 : trois boucles enregistrées dans la cabine d'un vrai Cessna 172 (ralenti, point fixe,
// plein gaz), mélangées et accélérées selon le régime (tr/min). Démarreur, mise en route et arrêt : sons FlightGear c172p.
// Sources et licences : asset/sounds/LICENSE.txt
// Fournit aussi le moteur des avions des autres joueurs, placé dans l'espace (distance, gauche/droite).

// Boucles : régime auquel chacune a été enregistrée (mesuré sur l'enregistrement) et niveau relatif (dB)
const LAYERS = [
    { name: 'idle', url: 'asset/sounds/c172-cabin-idle.wav', rpm: 1083, level: -7 },
    { name: 'runup', url: 'asset/sounds/c172-cabin-runup.wav', rpm: 1716, level: -3 },
    { name: 'full', url: 'asset/sounds/c172-cabin-full.wav', rpm: 2436, level: 0 },
];
const ONE_SHOTS = {
    crank: 'asset/sounds/engine-crank.wav',
    start: 'asset/sounds/engine-start.wav',
    cut: 'asset/sounds/engine-cut.wav',
};
const SOUND_SPEED = 343;   // m/s : effet Doppler (le son monte quand l'avion approche, descend quand il s'éloigne)
const IDLE_RPM = 750, FULL_RPM = 2700;

// Mélange des boucles selon le régime : chacune est accélérée / ralentie pour coller au régime, et pèse d'autant plus
// que son régime d'enregistrement est proche (interpolation en échelle logarithmique entre deux boucles voisines)
function mixLayers(loops, rpm, volume, now, doppler = 1) {
    rpm = Math.max(300, rpm);
    const l = Math.log(rpm);
    for (let i = 0; i < LAYERS.length; i++) {
        const layer = LAYERS[i];
        const below = LAYERS[i - 1], above = LAYERS[i + 1];
        let weight;
        if (l <= Math.log(layer.rpm)) weight = below ? (l - Math.log(below.rpm)) / (Math.log(layer.rpm) - Math.log(below.rpm)) : 1;
        else weight = above ? (Math.log(above.rpm) - l) / (Math.log(above.rpm) - Math.log(layer.rpm)) : 1;
        weight = Math.min(1, Math.max(0, weight));
        // Fondu à puissance constante ; niveau qui monte avec le régime
        const gain = Math.sin(weight * Math.PI / 2) * 10 ** (layer.level / 20) * volume;
        const loop = loops[layer.name];
        loop.gain.gain.setTargetAtTime(gain, now, 0.08);
        loop.source.playbackRate.setTargetAtTime(Math.min(2.2, Math.max(0.3, rpm / layer.rpm)) * doppler, now, 0.08);
    }
}

// Régime d'un autre joueur, d'après ses gaz (les gaz sont la seule donnée transmise)
function rpmFromThrottle(throttle) {
    return IDLE_RPM + (FULL_RPM - 200 - IDLE_RPM) * throttle;
}

// Les boucles du moteur, branchées sur output ; départ au hasard dans la boucle (deux moteurs ne sonnent pas à l'unisson)
function createLoops(audio, buffers, output) {
    const loops = {};
    for (const { name } of LAYERS) {
        const buffer = buffers[name];
        const source = audio.createBufferSource();
        const gain = audio.createGain();
        source.buffer = buffer;
        source.loop = true;
        gain.gain.value = 0;
        source.connect(gain).connect(output);
        source.start(0, Math.random() * buffer.duration);
        loops[name] = { source, gain };
    }
    return loops;
}

async function loadBuffer(audio, url) {
    const response = await fetch(url);
    return audio.decodeAudioData(await response.arrayBuffer());
}

// Moteur d'un autre joueur
class RemoteEngine {
    constructor(audio, buffers, output, listener) {
        this._audio = audio;
        this._listener = listener;   // position des oreilles du joueur (tableau x, y, z)
        this._panner = new PannerNode(audio, {
            panningModel: 'equalpower', distanceModel: 'inverse',
            refDistance: 25, rolloffFactor: 1.3, maxDistance: 5000,
        });
        this._panner.connect(output);
        this._loops = createLoops(audio, buffers, this._panner);
        this._distance = null;
    }

    // position : Vector3 (monde) ; volume : 0 -> 1 ; delta : temps depuis la dernière image (s)
    update(position, throttle, volume, delta) {
        const now = this._audio.currentTime;
        const listener = this._listener;
        this._panner.positionX.setTargetAtTime(position.x, now, 0.05);
        this._panner.positionY.setTargetAtTime(position.y, now, 0.05);
        this._panner.positionZ.setTargetAtTime(position.z, now, 0.05);

        // Doppler : d'après la vitesse à laquelle la distance change
        const distance = Math.hypot(position.x - listener[0], position.y - listener[1], position.z - listener[2]);
        let doppler = 1;
        if (this._distance !== null && delta > 0) {
            const closing = (this._distance - distance) / delta;
            doppler = Math.min(1.3, Math.max(0.75, SOUND_SPEED / (SOUND_SPEED - Math.max(-150, Math.min(150, closing)))));
        }
        this._distance = distance;
        mixLayers(this._loops, rpmFromThrottle(throttle), volume, now, doppler);
    }

    dispose() {
        for (const { source } of Object.values(this._loops)) source.stop();
        this._panner.disconnect();
    }
}

class EngineSound {
    constructor({ volume = 0.5 } = {}) {
        this.volume = volume;
        this._audio = null;
        this._loops = null;
        this._buffers = null;
        this._listenerPosition = [0, 0, 0];
    }

    // Le navigateur n'autorise le son qu'après une action du joueur (touche, clic)
    async unlock() {
        if (this._audio) return;
        this._audio = new AudioContext();
        this._master = this._audio.createGain();
        this._master.gain.value = this.volume;
        this._master.connect(this._audio.destination);

        const urls = [...LAYERS.map(({ name, url }) => [name, url]), ...Object.entries(ONE_SHOTS)];
        const entries = await Promise.all(urls.map(async ([name, url]) => [name, await loadBuffer(this._audio, url)]));
        this._buffers = Object.fromEntries(entries);
        this._loops = createLoops(this._audio, this._buffers, this._master);
        // Démarreur : boucle à part, entendue seulement pendant que la clé est sur START
        this._crank = this._audio.createGain();
        this._crank.gain.value = 0;
        this._crank.connect(this._master);
        const crank = this._audio.createBufferSource();
        crank.buffer = this._buffers.crank;
        crank.loop = true;
        crank.connect(this._crank);
        crank.start();
    }

    // Moteur d'un autre joueur (null tant que le son n'est pas débloqué par une action du joueur)
    createRemote() {
        return this._buffers ? new RemoteEngine(this._audio, this._buffers, this._master, this._listenerPosition) : null;
    }

    // Oreilles du joueur : position et orientation de la caméra
    setListener(camera) {
        if (!this._audio) return;
        const listener = this._audio.listener;
        const now = this._audio.currentTime;
        const e = camera.matrixWorld.elements;
        this._listenerPosition.splice(0, 3, e[12], e[13], e[14]);
        if (!listener.positionX) {
            // Firefox : ancienne interface
            listener.setPosition(e[12], e[13], e[14]);
            listener.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
            return;
        }
        listener.positionX.setValueAtTime(e[12], now);
        listener.positionY.setValueAtTime(e[13], now);
        listener.positionZ.setValueAtTime(e[14], now);
        listener.forwardX.setValueAtTime(-e[8], now);
        listener.forwardY.setValueAtTime(-e[9], now);
        listener.forwardZ.setValueAtTime(-e[10], now);
        listener.upX.setValueAtTime(e[4], now);
        listener.upY.setValueAtTime(e[5], now);
        listener.upZ.setValueAtTime(e[6], now);
    }

    // Son ponctuel (mise en route, arrêt), au volume de la cabine ou de l'extérieur
    _play(name, volume) {
        if (!this._buffers || volume <= 0) return;
        const source = this._audio.createBufferSource();
        const gain = this._audio.createGain();
        source.buffer = this._buffers[name];
        gain.gain.value = volume;
        source.connect(gain).connect(this._master);
        source.start();
    }

    // Le moteur démarre / s'arrête (événements 'start' / 'stop' des systèmes)
    playStart(volume = 1) { this._play('start', volume); }
    playStop(volume = 1) { this._play('cut', 0.8 * volume); }

    // rpm : régime moteur (hélice) ; volume : 0 -> 1 (plus faible en cabine qu'à l'extérieur, par ex.) ;
    // running : moteur tournant (sinon : démarreur ou hélice entraînée par le vent) ; cranking : clé sur START
    update(rpm, volume = 1, { running = true, cranking = false } = {}) {
        if (!this._loops) return;
        const now = this._audio.currentTime;
        // Moteur arrêté : les boucles s'éteignent avec le régime (hélice qui ralentit), pas de son de combustion
        const combustion = running ? 1 : Math.min(1, Math.max(0, (rpm - 150) / 500)) * 0.35;
        mixLayers(this._loops, rpm, volume * combustion, now);
        this._crank.gain.setTargetAtTime(cranking && !running ? 0.9 * Math.min(1, volume * 1.4) : 0, now, 0.03);
    }
}

export { EngineSound };
