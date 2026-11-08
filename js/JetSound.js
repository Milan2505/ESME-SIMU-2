// Son des réacteurs du F-15, comme EngineSound.js pour le Cessna : boucles du projet FlightGear F-15 (Richard Harrison,
// GPL-2.0, voir asset/sounds/LICENSE.txt) mélangées selon l'état des réacteurs :
// - sifflement de la turbine (jet-whine) : hauteur et niveau suivent le régime N2 ;
// - entrée d'air (jet-intake-air) : avec le régime et la vitesse ;
// - souffle (engine-jet-exhaust) : avec la poussée, surtout entendu de l'extérieur ;
// - postcombustion (engine-jet-afterburner, et sa version entendue de la cabine) ;
// - JFS (turbine de démarrage) : mise en route, boucle, arrêt ; train, aérofrein, verrière ; tonalité d'incidence
//   (alarme du vrai F-15 à forte incidence, à la place de l'alarme Airbus « STALL » du Cessna).
// Fournit aussi les réacteurs des F-15 des autres joueurs, placés dans l'espace (distance, gauche/droite, Doppler).

import { sharedAudioContext, loadSound } from './AudioUnlock.js';

const DIR = 'asset/sounds/f15/';
const LOOPS = ['jet-whine', 'jet-intake-air', 'engine-jet-exhaust', 'engine-jet-afterburner', 'engine-jet-afterburner-inside', 'jfs-running', 'stall-600-chopped', 'gear-transit'];
const ONE_SHOTS = ['jfs-startup', 'jfs-shutdown', 'gear-door-close', 'air-brakes', 'canopy-trans', 'canopy-close2'];
const SOUND_SPEED = 343;
const CABIN_CUTOFF = 2600, OUTSIDE_CUTOFF = 20000;

// Gains des boucles (0 -> 1) pour un état : n2 (%), ab (0 -> 1), speed (m/s), cabin
function mix(n2, ab, speed, cabin) {
    const spin = Math.min(1, Math.max(0, (n2 - 4) / 40));
    const power = Math.max(0, (n2 - 60) / 40);
    return {
        whine: { gain: spin * (0.35 + 0.35 * power) * (cabin ? 0.8 : 1), rate: 0.45 + 0.75 * n2 / 100 },
        intake: { gain: spin * (0.15 + 0.25 * power) + Math.min(0.3, speed / 600), rate: 0.8 + 0.3 * n2 / 100 },
        exhaust: { gain: (cabin ? 0.35 : 1) * spin * (0.12 + 0.75 * power ** 1.5), rate: 0.85 + 0.25 * power },
        ab: { gain: ab * (cabin ? 0 : 1.1), rate: 0.95 + 0.1 * ab },
        abInside: { gain: ab * (cabin ? 0.9 : 0), rate: 1 },
    };
}

class Loop {
    constructor(audio, buffer, output) {
        this.source = audio.createBufferSource();
        this.gain = audio.createGain();
        this.source.buffer = buffer;
        this.source.loop = true;
        this.gain.gain.value = 0;
        this.source.connect(this.gain).connect(output);
        this.source.start(0, Math.random() * buffer.duration);
    }

    set(gain, rate, now) {
        this.gain.gain.setTargetAtTime(gain, now, 0.12);
        this.source.playbackRate.setTargetAtTime(rate, now, 0.12);
    }

    stop() {
        this.source.stop();
    }
}

// Réacteurs d'un autre joueur
class RemoteJet {
    constructor(audio, buffers, output, listener) {
        this._audio = audio;
        this._listener = listener;
        this._panner = new PannerNode(audio, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 40, rolloffFactor: 1.2, maxDistance: 8000 });
        this._panner.connect(output);
        this._loops = {
            whine: new Loop(audio, buffers['jet-whine'], this._panner),
            exhaust: new Loop(audio, buffers['engine-jet-exhaust'], this._panner),
            ab: new Loop(audio, buffers['engine-jet-afterburner'], this._panner),
        };
        this._distance = null;
    }

    // position : Vector3 ; throttle : 0 -> 1 ; rpm : N2 × 27 (voir JetSystems.rpm), ou null
    update(position, throttle, volume, delta, rpm = null) {
        const now = this._audio.currentTime;
        const l = this._listener;
        this._panner.positionX.setTargetAtTime(position.x, now, 0.05);
        this._panner.positionY.setTargetAtTime(position.y, now, 0.05);
        this._panner.positionZ.setTargetAtTime(position.z, now, 0.05);
        const distance = Math.hypot(position.x - l[0], position.y - l[1], position.z - l[2]);
        let doppler = 1;
        if (this._distance !== null && delta > 0) {
            const closing = (this._distance - distance) / delta;
            doppler = Math.min(1.6, Math.max(0.6, SOUND_SPEED / (SOUND_SPEED - Math.max(-250, Math.min(250, closing)))));
        }
        this._distance = distance;
        const n2 = rpm === null ? 65 + 35 * Math.min(1, throttle / 0.85) : rpm / 27;
        const ab = Math.max(0, (throttle - 0.85) / 0.15);
        const m = mix(n2, ab, 0, false);
        this._loops.whine.set(m.whine.gain * volume, m.whine.rate * doppler, now);
        this._loops.exhaust.set(m.exhaust.gain * volume, m.exhaust.rate * doppler, now);
        this._loops.ab.set(m.ab.gain * volume, m.ab.rate * doppler, now);
    }

    dispose() {
        for (const loop of Object.values(this._loops)) loop.stop();
        this._panner.disconnect();
    }
}

class JetSound {
    constructor({ volume = 1.1 } = {}) {
        this.volume = volume;
        this._audio = null;
        this._buffers = null;
        this._loops = null;
        this._listenerPosition = [0, 0, 0];
        this._cabin = false;
        this._jfs = false;
    }

    unlock() {
        if (this._buffers) return Promise.resolve();
        this._loading ??= this._load().catch((error) => {
            this._loading = null;
            throw error;
        });
        return this._loading;
    }

    async _load() {
        this._audio = sharedAudioContext();
        this._master = this._audio.createGain();
        this._master.gain.value = this.volume;
        this._muffle = new BiquadFilterNode(this._audio, { type: 'lowpass', frequency: this._cabin ? CABIN_CUTOFF : OUTSIDE_CUTOFF, Q: 0.5 });
        const limiter = new DynamicsCompressorNode(this._audio, { threshold: -10, knee: 6, ratio: 12, attack: 0.003, release: 0.15 });
        this._master.connect(this._muffle).connect(limiter).connect(this._audio.destination);
        // Alarmes de la cabine : pas étouffées
        this._alarm = this._audio.createGain();
        this._alarm.connect(this._audio.destination);
        const names = [...LOOPS, ...ONE_SHOTS];
        const entries = await Promise.all(names.map(async (name) => [name, await loadSound(this._audio, `${DIR}${name}.wav`)]));
        this._buffers = Object.fromEntries(entries);
        this._loops = {
            whine: new Loop(this._audio, this._buffers['jet-whine'], this._master),
            intake: new Loop(this._audio, this._buffers['jet-intake-air'], this._master),
            exhaust: new Loop(this._audio, this._buffers['engine-jet-exhaust'], this._master),
            ab: new Loop(this._audio, this._buffers['engine-jet-afterburner'], this._master),
            abInside: new Loop(this._audio, this._buffers['engine-jet-afterburner-inside'], this._master),
            jfs: new Loop(this._audio, this._buffers['jfs-running'], this._master),
            aoa: new Loop(this._audio, this._buffers['stall-600-chopped'], this._alarm),
            // Manœuvre du train : boucle de 0,8 s, entendue pendant toute la sortie ou la rentrée (5 s) ; avant, jouée
            // une seule fois au départ, elle laissait un silence jusqu'au claquement des trappes
            gear: new Loop(this._audio, this._buffers['gear-transit'], this._master),
        };
    }

    setCabin(inside) {
        if (inside === this._cabin) return;
        this._cabin = inside;
        if (this._muffle) this._muffle.frequency.setTargetAtTime(inside ? CABIN_CUTOFF : OUTSIDE_CUTOFF, this._audio.currentTime, 0.1);
    }

    createRemote() {
        return this._buffers ? new RemoteJet(this._audio, this._buffers, this._master, this._listenerPosition) : null;
    }

    // Oreilles : même contexte audio que EngineSound (qui place l'écouteur) ; ici, seulement la position pour le Doppler
    setListener(camera) {
        const e = camera.matrixWorld.elements;
        this._listenerPosition.splice(0, 3, e[12], e[13], e[14]);
    }

    play(name, volume = 1) {
        if (!this._buffers || volume <= 0) return;
        const source = this._audio.createBufferSource();
        const gain = this._audio.createGain();
        source.buffer = this._buffers[name];
        gain.gain.value = volume;
        source.connect(gain).connect(this._master);
        source.start();
    }

    // state : { engines: [{ n2, ab }], jfs (JFS en marche), jfsLevel (0 -> 1), speed (m/s), aoaWarning, gearMoving } ;
    // volume : 0 -> 1
    update(state, volume = 1) {
        if (!this._loops) return;
        const now = this._audio.currentTime;
        const n2 = state.engines.reduce((sum, e) => sum + e.n2, 0) / state.engines.length;
        const ab = state.engines.reduce((sum, e) => sum + e.ab, 0) / state.engines.length;
        const m = mix(n2, ab, state.speed, this._cabin);
        for (const name of ['whine', 'intake', 'exhaust', 'ab', 'abInside']) this._loops[name].set(m[name].gain * volume, m[name].rate, now);
        // JFS : bruit de mise en route au démarrage, boucle tant qu'il tourne, bruit d'arrêt
        if (state.jfs !== this._jfs) {
            this._jfs = state.jfs;
            if (volume > 0) this.play(state.jfs ? 'jfs-startup' : 'jfs-shutdown', 0.7 * volume);
        }
        this._loops.jfs.set(state.jfs ? 0.45 * state.jfsLevel * volume : 0, 0.7 + 0.3 * state.jfsLevel, now);
        this._loops.aoa.set(state.aoaWarning && volume > 0 ? 0.5 : 0, 1, now);
        this._loops.gear.set(state.gearMoving ? 0.85 * volume : 0, 1, now);
    }
}

export { JetSound };
