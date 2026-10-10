// Son du moteur de Cessna 172 (Lycoming) : boucle "ralenti" et boucle "plein régime"
// mélangées selon les gaz. Sons du projet FlightGear c172p (GPL-2.0), voir asset/sounds/
// Fournit aussi le moteur des avions des autres joueurs, placé dans l'espace (distance, gauche/droite).

const SOUNDS = {
    idle: 'asset/sounds/cessna_engine-idle.wav',
    full: 'asset/sounds/cessna_engine.wav',
};
const SOUND_SPEED = 343;   // m/s : effet Doppler (le son monte quand l'avion approche, descend quand il s'éloigne)

// Fondu ralenti -> plein régime et régime du moteur selon les gaz
function mixLoops({ idle, full }, throttle, volume, now) {
    const mix = Math.min(1, Math.max(0, (throttle - 0.1) / 0.6));
    idle.gain.gain.setTargetAtTime((1 - mix) * volume, now, 0.1);
    full.gain.gain.setTargetAtTime(mix * volume, now, 0.1);
    return mix;
}

// Les deux boucles du moteur, branchées sur output ; départ au hasard dans la boucle (deux moteurs ne sonnent pas à l'unisson)
function createLoops(audio, buffers, output) {
    const loops = {};
    for (const [name, buffer] of Object.entries(buffers)) {
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
        mixLoops(this._loops, throttle, volume, now);

        // Doppler : d'après la vitesse à laquelle la distance change
        const distance = Math.hypot(position.x - listener[0], position.y - listener[1], position.z - listener[2]);
        let doppler = 1;
        if (this._distance !== null && delta > 0) {
            const closing = (this._distance - distance) / delta;
            doppler = Math.min(1.3, Math.max(0.75, SOUND_SPEED / (SOUND_SPEED - Math.max(-150, Math.min(150, closing)))));
        }
        this._distance = distance;
        const { idle, full } = this._loops;
        idle.source.playbackRate.setTargetAtTime((0.9 + 0.3 * throttle) * doppler, now, 0.2);
        full.source.playbackRate.setTargetAtTime((0.8 + 0.3 * throttle) * doppler, now, 0.2);
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

        const entries = await Promise.all(Object.entries(SOUNDS).map(async ([name, url]) => {
            const response = await fetch(url);
            return [name, await this._audio.decodeAudioData(await response.arrayBuffer())];
        }));
        this._buffers = Object.fromEntries(entries);
        this._loops = createLoops(this._audio, this._buffers, this._master);
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

    // throttle : 0 -> 1 ; volume : 0 -> 1 (plus faible en cabine qu'à l'extérieur, par ex.)
    update(throttle, volume = 1) {
        if (!this._loops) return;
        const now = this._audio.currentTime;
        const { idle, full } = this._loops;
        mixLoops(this._loops, throttle, volume, now);
        // Le régime monte avec les gaz
        idle.source.playbackRate.setTargetAtTime(0.9 + 0.3 * throttle, now, 0.2);
        full.source.playbackRate.setTargetAtTime(0.8 + 0.3 * throttle, now, 0.2);
    }
}

export { EngineSound };
