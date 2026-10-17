// Bruitages : pluie, tonnerre, crash, pneus. Sons des projets FlightGear A320-family et c172p
// (GPL-2.0), voir asset/sounds/

const LOOPS = {
    rain:          'asset/sounds/rain.wav',
    rainCockpit:   'asset/sounds/rain-windshield.wav',
    rollAsphalt:   'asset/sounds/tires-rolling-asphalt.wav',
    rollGrass:     'asset/sounds/tires-rolling-grass.wav',
    flapMotor:     'asset/sounds/flaps-motor.wav',
    fuelPump:      'asset/sounds/fuel-pump.wav',
};
const SHOTS = {
    thunder1: 'asset/sounds/thunder1.wav',
    thunder2: 'asset/sounds/thunder2.wav',
    thunder3: 'asset/sounds/thunder3.wav',
    crash:    'asset/sounds/crash.wav',
    screech:  'asset/sounds/tires-screech.wav',
    flapsStop: 'asset/sounds/flaps-click.wav',
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
    click(volume = 0.5) {
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
        filter.frequency.value = 2400 + Math.random() * 600;
        gain.gain.value = volume;
        source.connect(filter).connect(gain).connect(this._master);
        source.start();
    }

    // Sifflement des gyroscopes électriques (indicateur de virage) : synthétisé. Sous tension, la toupie monte en
    // régime en quelques secondes (le son monte dans l'aigu) ; coupée, elle ralentit lentement en roue libre
    setGyro(powered, volume = 0.05) {
        if (!this._audio) return;
        const audio = this._audio;
        if (!this._gyro) {
            const output = audio.createGain();
            output.gain.value = 0;
            output.connect(this._master);
            // Sifflement : fondamentale + harmonique, battement léger entre deux toupies
            const whine = audio.createOscillator(), whine2 = audio.createOscillator(), harmonic = audio.createOscillator();
            whine.type = whine2.type = 'sine';
            harmonic.type = 'triangle';
            whine2.detune.value = 9;
            harmonic.detune.value = 1200;
            const harmonicGain = audio.createGain();
            harmonicGain.gain.value = 0.25;
            const speed = audio.createConstantSource();   // régime de la toupie, en Hz du sifflement
            speed.offset.value = 0;
            speed.connect(whine.frequency);
            speed.connect(whine2.frequency);
            speed.connect(harmonic.frequency);
            whine.frequency.value = whine2.frequency.value = harmonic.frequency.value = 0;
            whine.connect(output);
            whine2.connect(output);
            harmonic.connect(harmonicGain).connect(output);
            // Souffle des roulements
            if (!this._noiseBuffer) {
                const length = Math.round(audio.sampleRate * 0.4);
                this._noiseBuffer = audio.createBuffer(1, length, audio.sampleRate);
                const data = this._noiseBuffer.getChannelData(0);
                for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
            }
            const noise = audio.createBufferSource();
            noise.buffer = this._noiseBuffer;
            noise.loop = true;
            const filter = audio.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 3500;
            filter.Q.value = 1.5;
            const noiseGain = audio.createGain();
            noiseGain.gain.value = 0.15;
            noise.connect(filter).connect(noiseGain).connect(output);
            for (const node of [whine, whine2, harmonic, speed, noise]) node.start();
            this._gyro = { output, speed, powered: false };
        }
        const gyro = this._gyro;
        const target = powered ? volume : 0;
        if (powered === gyro.powered && target === gyro.volume) return;
        const now = audio.currentTime;
        // Montée en régime ~3 s, ralentissement en roue libre ~15 s
        const tau = powered ? 1.2 : 6;
        gyro.speed.offset.cancelScheduledValues(now);
        gyro.speed.offset.setTargetAtTime(powered ? 520 : 0, now, tau);
        gyro.output.gain.cancelScheduledValues(now);
        gyro.output.gain.setTargetAtTime(target, now, powered ? 0.8 : tau * 0.7);
        gyro.powered = powered;
        gyro.volume = target;
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
    play(name, { volume = 1, delay = 0, rate = 1 } = {}) {
        if (!this._buffers) return;
        const source = this._audio.createBufferSource();
        const gain = this._audio.createGain();
        source.buffer = this._buffers[name];
        source.playbackRate.value = rate;
        gain.gain.value = volume;
        source.connect(gain).connect(this._master);
        source.start(this._audio.currentTime + delay);
    }
}

export { SoundEffects };
