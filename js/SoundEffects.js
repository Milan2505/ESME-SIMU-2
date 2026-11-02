// Bruitages : pluie, tonnerre, crash, pneus, ambiance extérieure. Sons des projets FlightGear A320-family, c172p et
// c182s (GPL-2.0) et ambiances de parc de Thimras (CC0), voir asset/sounds/

const LOOPS = {
    rain:          'asset/sounds/rain.wav',
    rainCockpit:   'asset/sounds/rain-windshield.wav',
    rollAsphalt:   'asset/sounds/tires-rolling-asphalt.wav',
    rollGrass:     'asset/sounds/tires-rolling-grass.wav',
    flapMotor:     'asset/sounds/flaps-motor.wav',
    fuelPump:      'asset/sounds/fuel-pump.wav',
    gyro:          'asset/sounds/gyro.wav',
    birds:         'asset/sounds/ambience-birds.wav',
    breeze:        'asset/sounds/ambience-wind.wav',
};
const SHOTS = {
    thunder1: 'asset/sounds/thunder1.wav',
    thunder2: 'asset/sounds/thunder2.wav',
    thunder3: 'asset/sounds/thunder3.wav',
    crash:    'asset/sounds/crash.wav',
    screech:  'asset/sounds/tires-screech.wav',
    flapsStop: 'asset/sounds/flaps-click.wav',
    fuelPumpStop: 'asset/sounds/fuel-pump-end.wav',
};

class SoundEffects {
    constructor({ volume = 0.7 } = {}) {
        this.volume = volume;
        this._audio = null;
        this._buffers = null;
        this._loops = {};
        this._levels = {};   // volume demandé pour chaque boucle (gardé si les sons ne sont pas encore chargés)
    }

    // Le navigateur n'autorise le son qu'après une action du joueur (touche, clic)
    async unlock() {
        if (this._audio) return;
        this._audio = new AudioContext();
        this._master = this._audio.createGain();
        this._master.gain.value = this.volume;
        this._master.connect(this._audio.destination);

        const all = { ...LOOPS, ...SHOTS };
        const entries = await Promise.all(Object.entries(all).map(async ([name, url]) => {
            const response = await fetch(url);
            return [name, await this._audio.decodeAudioData(await response.arrayBuffer())];
        }));
        this._buffers = Object.fromEntries(entries);

        for (const name of Object.keys(LOOPS)) {
            const source = this._audio.createBufferSource();
            const gain = this._audio.createGain();
            source.buffer = this._buffers[name];
            source.loop = true;
            gain.gain.value = 0;
            source.connect(gain).connect(this._master);
            source.start(0, Math.random() * source.buffer.duration);
            this._loops[name] = { source, gain };
        }
        for (const [name, level] of Object.entries(this._levels)) this.setLoop(name, level);
    }

    // Volume d'une boucle (0 = coupée) ; rate : vitesse de lecture
    setLoop(name, level, rate = 1) {
        this._levels[name] = level;
        const loop = this._loops[name];
        if (!loop) return;
        const now = this._audio.currentTime;
        loop.gain.gain.setTargetAtTime(level, now, 0.15);
        loop.source.playbackRate.setTargetAtTime(rate, now, 0.2);
    }

    // Clic d'un interrupteur ou d'un bouton de la cabine (bruit court et sec, synthétisé)
    // frequency : hauteur du clic (plus bas = plus sourd)
    click(volume = 0.5, frequency = 2400 + Math.random() * 600) {
        if (!this._audio) return;
        const audio = this._audio;
        if (!this._clickBuffer) {
            const length = Math.round(audio.sampleRate * 0.03);
            this._clickBuffer = audio.createBuffer(1, length, audio.sampleRate);
            const data = this._clickBuffer.getChannelData(0);
            for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.12));
        }
        const source = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const gain = audio.createGain();
        source.buffer = this._clickBuffer;
        filter.type = 'bandpass';
        filter.frequency.value = frequency;
        gain.gain.value = volume;
        source.connect(filter).connect(gain).connect(this._master);
        source.start();
    }

    // "Pschht" de radio : ouverture / fermeture du squelch (tour de contrôle)
    squelch(volume = 0.25, duration = 0.12) {
        if (!this._audio) return;
        const audio = this._audio;
        if (!this._noiseBuffer) {
            const length = Math.round(audio.sampleRate * 0.4);
            this._noiseBuffer = audio.createBuffer(1, length, audio.sampleRate);
            const data = this._noiseBuffer.getChannelData(0);
            for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        }
        const source = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const gain = audio.createGain();
        source.buffer = this._noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.value = 2200;
        filter.Q.value = 0.8;
        const now = audio.currentTime;
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        source.connect(filter).connect(gain).connect(this._master);
        source.start(now, 0, duration + 0.02);
    }

    // Son ponctuel, éventuellement retardé (tonnerre : le son arrive après l'éclair)
    // offset / duration (s) : n'en jouer qu'un extrait, attaque brève et fondu de sortie
    play(name, { volume = 1, delay = 0, rate = 1, offset = 0, duration = null } = {}) {
        if (!this._buffers) return;
        const source = this._audio.createBufferSource();
        const gain = this._audio.createGain();
        source.buffer = this._buffers[name];
        source.playbackRate.value = rate;
        source.connect(gain).connect(this._master);
        const start = this._audio.currentTime + delay;
        if (duration === null) {
            gain.gain.value = volume;
            source.start(start, offset);
            return;
        }
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume, start + 0.02);
        gain.gain.setTargetAtTime(0, start + duration * 0.4, duration * 0.25);
        source.start(start, offset, duration * 1.6 * rate);
    }
}

export { SoundEffects };
