// Sons du Robinson R44, comme JetSound.js pour le F-15 : enregistrements du projet FlightGear R44 (BaBoOn, GPL-2.0,
// voir asset/sounds/LICENSE.txt), boucles mélangées selon l'état de l'appareil :
// - moteur (Lycoming à pistons) : hauteur selon le régime, plus fort sous charge ; version entendue de la cabine ;
// - rotor : battement des pales (« wop-wop »), hauteur selon le régime du rotor, plus marqué sous forte traction et en
//   descente (claquement des pales dans leur propre sillage) ; version de la cabine ;
// - démarreur (boucle, cabine ou extérieur), vent sur la verrière, klaxon de bas régime rotor (alarme, non étouffé) ;
// - bruits ponctuels : déclic des interrupteurs, portes.
// Fournit aussi les R44 des autres joueurs, placés dans l'espace (distance, gauche/droite, Doppler).

import { sharedAudioContext, audioOutput, loadSound } from './AudioUnlock.js';

const DIR = 'asset/sounds/r44/';
const NAMES = ['engine', 'engine-internal', 'rotor', 'rotor-internal', 'starter-inside', 'starter-outside', 'low-rpm-horn',
    'wind', 'click', 'starter', 'door-open', 'door-close'];
const SOUND_SPEED = 343;
const CABIN_CUTOFF = 3200, OUTSIDE_CUTOFF = 20000;
const ENGINE_REF = 2665;              // régime (tr/min) de l'enregistrement du moteur
const ROTOR_REF = 400;                // … du rotor

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

    set(gain, rate, now, time = 0.1) {
        this.gain.gain.setTargetAtTime(gain, now, time);
        this.source.playbackRate.setTargetAtTime(Math.max(0.05, rate), now, time);
    }

    stop() {
        this.source.stop();
    }
}

// Mélange : gains et vitesses de lecture des boucles
function mix({ engineRpm = 0, running = false, rotorRpm = 0, load = 0.4, slap = 0, cabin = false }) {
    const engine = Math.min(1, engineRpm / ENGINE_REF);
    const rotor = Math.min(1.2, rotorRpm / ROTOR_REF);
    const engineGain = (running ? 0.35 + 0.55 * engine * (0.6 + 0.4 * load) : 0.12 * engine);
    const rotorGain = Math.min(1, rotor * rotor * 1.1) * (0.55 + 0.35 * load + 0.5 * slap);
    return {
        engine: { gain: cabin ? 0 : engineGain * 0.8, rate: 0.35 + 0.7 * engine },
        engineInside: { gain: cabin ? engineGain * 0.7 : 0, rate: 0.35 + 0.7 * engine },
        rotor: { gain: cabin ? 0 : rotorGain, rate: 0.2 + 0.85 * rotor },
        rotorInside: { gain: cabin ? rotorGain * 0.75 : 0, rate: 0.2 + 0.85 * rotor },
    };
}

// R44 d'un autre joueur
class RemoteR44 {
    constructor(audio, buffers, output, listener) {
        this._audio = audio;
        this._listener = listener;
        this._panner = new PannerNode(audio, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 25, rolloffFactor: 1.1, maxDistance: 6000 });
        this._panner.connect(output);
        this._loops = { engine: new Loop(audio, buffers.engine, this._panner), rotor: new Loop(audio, buffers.rotor, this._panner) };
        this._distance = null;
    }

    // position : Vector3 ; throttle : collectif (0 -> 1) ; rpm : régime moteur (tr/min), ou null
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
            doppler = Math.min(1.5, Math.max(0.7, SOUND_SPEED / (SOUND_SPEED - Math.max(-150, Math.min(150, closing)))));
        }
        this._distance = distance;
        const engineRpm = rpm ?? (throttle > 0 ? ENGINE_REF : 0);
        const m = mix({ engineRpm, running: engineRpm > 500, rotorRpm: engineRpm / 6.6625, load: throttle });
        this._loops.engine.set(m.engine.gain * volume, m.engine.rate * doppler, now);
        this._loops.rotor.set(m.rotor.gain * volume * 1.2, m.rotor.rate * doppler, now);
    }

    dispose() {
        for (const loop of Object.values(this._loops)) loop.stop();
        this._panner.disconnect();
    }
}

class R44Sound {
    constructor({ volume = 1 } = {}) {
        this.volume = volume;
        this._audio = null;
        this._buffers = null;
        this._loops = null;
        this._listenerPosition = [0, 0, 0];
        this._cabin = false;
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
        this._master.connect(this._muffle).connect(limiter).connect(audioOutput());
        this._alarm = this._audio.createGain();          // klaxon : pas étouffé
        this._alarm.connect(audioOutput());
        const entries = await Promise.all(NAMES.map(async (name) => [name, await loadSound(this._audio, `${DIR}${name}.wav`)]));
        this._buffers = Object.fromEntries(entries);
        const b = this._buffers;
        this._loops = {
            engine: new Loop(this._audio, b.engine, this._master),
            engineInside: new Loop(this._audio, b['engine-internal'], this._master),
            rotor: new Loop(this._audio, b.rotor, this._master),
            rotorInside: new Loop(this._audio, b['rotor-internal'], this._master),
            starterInside: new Loop(this._audio, b['starter-inside'], this._master),
            starterOutside: new Loop(this._audio, b['starter-outside'], this._master),
            wind: new Loop(this._audio, b.wind, this._master),
            horn: new Loop(this._audio, b['low-rpm-horn'], this._alarm),
        };
    }

    setCabin(inside) {
        if (inside === this._cabin) return;
        this._cabin = inside;
        if (this._muffle) this._muffle.frequency.setTargetAtTime(inside ? CABIN_CUTOFF : OUTSIDE_CUTOFF, this._audio.currentTime, 0.1);
    }

    createRemote() {
        return this._buffers ? new RemoteR44(this._audio, this._buffers, this._master, this._listenerPosition) : null;
    }

    setListener(camera) {
        const e = camera.matrixWorld.elements;
        this._listenerPosition.splice(0, 3, e[12], e[13], e[14]);
    }

    play(name, volume = 1) {
        if (!this._buffers?.[name] || volume <= 0) return;
        const source = this._audio.createBufferSource();
        const gain = this._audio.createGain();
        source.buffer = this._buffers[name];
        gain.gain.value = volume;
        source.connect(gain).connect(this._master);
        source.start();
    }

    // state : { engineRpm, running, cranking, rotorRpm, load (0 -> 1), slap (0 -> 1), speed (m/s), horn } ; volume 0 -> 1
    update(state, volume = 1) {
        if (!this._loops) return;
        const now = this._audio.currentTime;
        const m = mix({ ...state, cabin: this._cabin });
        for (const name of ['engine', 'engineInside', 'rotor', 'rotorInside']) this._loops[name].set(m[name].gain * volume, m[name].rate, now);
        const crank = state.cranking && !state.running ? volume : 0;
        this._loops.starterInside.set(this._cabin ? crank * 0.6 : 0, 1, now, 0.05);
        this._loops.starterOutside.set(this._cabin ? 0 : crank * 0.7, 1, now, 0.05);
        this._loops.wind.set(Math.min(0.5, (state.speed ?? 0) / 120) * volume * (this._cabin ? 0.7 : 0.4), 0.8 + (state.speed ?? 0) / 150, now, 0.3);
        // Klaxon de bas régime : son continu tant que l'alarme dure (cabine ou dehors : on l'entend)
        this._loops.horn.set(state.horn && volume > 0 ? 0.55 : 0, 1, now, 0.02);
    }
}

export { R44Sound };
