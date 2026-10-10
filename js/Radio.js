// Radio entre joueurs : on parle en maintenant une touche (alternat, comme une vraie radio d'avion).
// La voix passe par les relais du multijoueur (Multiplayer.sendVoice) : micro capté, réduit en qualité téléphone
// (8 000 échantillons par seconde, codage G.711 µ-law, ~8 ko/s), envoyé en paquets de 125 ms.
// À l'écoute : filtre de bande "radio", légère saturation et souffle discret, petit "pschht" en fin de message.

const RATE = 8000;              // échantillons par seconde envoyés
const CHUNK = 1000;             // échantillons par paquet (125 ms)
const RELEASE_TAIL = 0.15;      // on capte encore 0,15 s après avoir lâché la touche (fin de mot non coupée)
const JITTER = 0.3;             // attente avant de jouer le premier paquet : absorbe les irrégularités du réseau (s)
const SILENCE_TIMEOUT = 1500;   // sans paquet depuis 1,5 s, l'émission d'un joueur est terminée (ms)

// Capture du micro (module AudioWorklet chargé depuis un Blob : pas de fichier en plus)
const CAPTURE_WORKLET = `
class RadioCapture extends AudioWorkletProcessor {
    process(inputs) {
        const channel = inputs[0][0];
        if (channel) this.port.postMessage(channel.slice(0));
        return true;
    }
}
registerProcessor('radio-capture', RadioCapture);
`;

// G.711 µ-law : 1 octet par échantillon, la qualité des téléphones (et le son "radio")
const BIAS = 0x84, CLIP = 32635;
function encodeMuLaw(sample) {
    let s = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
    const sign = s < 0 ? 0x80 : 0;
    if (sign) s = -s;
    s = Math.min(s, CLIP) + BIAS;
    let exponent = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
    const mantissa = (s >> (exponent + 3)) & 0x0f;
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
function decodeMuLaw(byte) {
    const u = ~byte & 0xff;
    const exponent = (u >> 4) & 7;
    const s = ((((u & 0x0f) << 3) + BIAS) << exponent) - BIAS;
    return (u & 0x80 ? -s : s) / 32768;
}

function toBase64(bytes) {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
}
function fromBase64(text) {
    try {
        return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    } catch {
        return null;
    }
}

// Courbe de saturation douce (grésillement léger du haut-parleur)
function softClipCurve(amount) {
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
    }
    return curve;
}

// Événements :
// - 'state' { ready, text } : radio prête (micro autorisé) ou non, avec un message pour le joueur
// - 'talk' { id, on } : un joueur commence / arrête de parler (id = null : nous)
class Radio extends EventTarget {
    constructor(multiplayer) {
        super();
        this.multiplayer = multiplayer;
        this.ready = false;            // micro autorisé
        this.talking = false;          // touche maintenue
        this.volume = 1;
        this._audio = null;
        this._stream = null;
        this._capturing = false;       // capte (touche maintenue, ou juste après l'avoir lâchée)
        this._releaseTimer = 0;
        this._pending = [];            // échantillons à 8 kHz pas encore envoyés
        this._phase = 0;               // rééchantillonnage : position dans l'intervalle courant
        this._sum = 0;
        this._count = 0;
        this._talkers = new Map();     // id -> { nextTime, timer } : joueurs en train de parler

        multiplayer.addEventListener('voice', ({ detail }) => this._receive(detail));
        multiplayer.addEventListener('players', () => {
            // Joueur parti en pleine émission
            for (const id of this._talkers.keys()) if (!multiplayer.players.has(id)) this._endTalker(id);
        });
    }

    // Son de l'écoute : le navigateur ne l'autorise qu'après une action du joueur
    unlock() {
        if (this._audio) return;
        const audio = this._audio = new AudioContext();
        // Chaîne "radio" : bande 350-3000 Hz, saturation douce, volume
        this._input = new GainNode(audio, { gain: 1.6 });
        const highpass = new BiquadFilterNode(audio, { type: 'highpass', frequency: 350, Q: 0.7 });
        const lowpass = new BiquadFilterNode(audio, { type: 'lowpass', frequency: 3000, Q: 0.7 });
        const shaper = new WaveShaperNode(audio, { curve: softClipCurve(1.8), oversample: '2x' });
        this._output = new GainNode(audio, { gain: this.volume * 0.9 });
        this._input.connect(highpass).connect(lowpass).connect(shaper).connect(this._output).connect(audio.destination);

        // Souffle : bruit blanc filtré, très bas pendant une réception, coupé sinon
        const noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this._noiseBuffer = noise;
        const hiss = new AudioBufferSourceNode(audio, { buffer: noise, loop: true });
        this._hiss = new GainNode(audio, { gain: 0 });
        hiss.connect(new BiquadFilterNode(audio, { type: 'bandpass', frequency: 1800, Q: 0.6 })).connect(this._hiss).connect(audio.destination);
        hiss.start();
    }

    // Demande l'accès au micro (fenêtre d'autorisation du navigateur)
    async enable() {
        if (this.ready || this._enabling) return this._enabling;
        this._enabling = (async () => {
            this.unlock();
            if (!navigator.mediaDevices?.getUserMedia) {
                this._state(false, 'Micro indisponible : la radio demande une page en https (ou localhost)');
                return;
            }
            try {
                this._stream = await navigator.mediaDevices.getUserMedia({
                    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                });
                const audio = this._audio;
                const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
                await audio.audioWorklet.addModule(url);
                URL.revokeObjectURL(url);
                const capture = new AudioWorkletNode(audio, 'radio-capture');
                capture.port.onmessage = ({ data }) => this._capture(data);
                // Branché sur un volume nul : le navigateur ne traite que les nœuds reliés à la sortie
                audio.createMediaStreamSource(this._stream).connect(capture).connect(new GainNode(audio, { gain: 0 })).connect(audio.destination);
                this.ready = true;
                this._state(true, 'Radio prête : maintenez N pour parler');
            } catch (error) {
                console.warn(error);
                this._state(false, error?.name === 'NotAllowedError'
                    ? 'Micro refusé : autorisez-le dans la barre d\'adresse du navigateur'
                    : 'Aucun micro utilisable');
            } finally {
                this._enabling = null;
            }
        })();
        return this._enabling;
    }

    setVolume(volume) {
        this.volume = volume;
        if (this._output) this._output.gain.value = volume * 0.9;
    }

    // Touche de la radio maintenue / relâchée
    async setTalking(on) {
        if (on === this.talking) return;
        this.talking = on;
        if (on) {
            if (!this.multiplayer.code) {
                this.talking = false;
                this._state(this.ready, 'Rejoignez une partie multijoueur pour utiliser la radio');
                return;
            }
            if (!this.ready) await this.enable();
            if (!this.ready || !this.talking) return;
            this._audio.resume();
            clearTimeout(this._releaseTimer);
            this._capturing = true;
            this._emit(null, true);
        } else if (this._capturing) {
            this._emit(null, false);
            clearTimeout(this._releaseTimer);
            this._releaseTimer = setTimeout(() => this._finish(), RELEASE_TAIL * 1000);
        }
    }

    // private

    _state(ready, text) {
        this.dispatchEvent(new CustomEvent('state', { detail: { ready, text } }));
    }

    _emit(id, on) {
        this.dispatchEvent(new CustomEvent('talk', { detail: { id, on } }));
    }

    // Échantillons du micro : moyenne par intervalles de 1/8000 s (filtre anti-repliement simple)
    _capture(samples) {
        if (!this._capturing) return;
        const step = this._audio.sampleRate / RATE;
        for (const sample of samples) {
            this._sum += sample;
            this._count++;
            if (++this._phase >= step) {
                this._phase -= step;
                this._pending.push(encodeMuLaw(this._sum / this._count));
                this._sum = this._count = 0;
            }
        }
        while (this._pending.length >= CHUNK) this.multiplayer.sendVoice(toBase64(this._pending.splice(0, CHUNK)));
    }

    // Fin d'émission : envoie le reste et prévient les autres
    _finish() {
        this._capturing = false;
        this.multiplayer.sendVoice(toBase64(this._pending.splice(0)), true);
        this._phase = this._sum = this._count = 0;
    }

    _receive({ id, data, end }) {
        if (!this._audio) return;   // son pas encore débloqué
        const audio = this._audio;
        const bytes = fromBase64(data);
        let talker = this._talkers.get(id);
        if (!talker) {
            if (!bytes?.length) return;
            talker = { nextTime: audio.currentTime + JITTER, timer: 0 };
            this._talkers.set(id, talker);
            this._squelch(talker.nextTime - 0.05, 0.05);
            this._updateHiss();
            this._emit(id, true);
        }
        if (bytes?.length) {
            const buffer = audio.createBuffer(1, bytes.length, RATE);
            const channel = buffer.getChannelData(0);
            for (let i = 0; i < bytes.length; i++) channel[i] = decodeMuLaw(bytes[i]);
            const source = new AudioBufferSourceNode(audio, { buffer });
            source.connect(this._input);
            // Paquet en retard (réseau) : on reprend un peu plus tard plutôt que de couper
            const start = Math.max(talker.nextTime, audio.currentTime + 0.05);
            source.start(start);
            talker.nextTime = start + buffer.duration;
        }
        clearTimeout(talker.timer);
        const remaining = Math.max(0, talker.nextTime - audio.currentTime) * 1000;
        talker.timer = setTimeout(() => this._endTalker(id), end ? remaining : remaining + SILENCE_TIMEOUT);
    }

    _endTalker(id) {
        const talker = this._talkers.get(id);
        if (!talker) return;
        clearTimeout(talker.timer);
        this._talkers.delete(id);
        this._squelch(this._audio.currentTime, 0.12);
        this._updateHiss();
        this._emit(id, false);
    }

    // Souffle discret tant que quelqu'un parle
    _updateHiss() {
        this._hiss.gain.setTargetAtTime(this._talkers.size ? 0.012 * this.volume : 0, this._audio.currentTime, 0.03);
    }

    // "Pschht" de l'ouverture / fermeture du squelch
    _squelch(time, duration) {
        const audio = this._audio;
        const source = new AudioBufferSourceNode(audio, { buffer: this._noiseBuffer });
        const gain = new GainNode(audio, { gain: 0 });
        source.connect(new BiquadFilterNode(audio, { type: 'bandpass', frequency: 2200, Q: 0.8 })).connect(gain).connect(audio.destination);
        const start = Math.max(time, audio.currentTime);
        gain.gain.setValueAtTime(0.05 * this.volume, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        source.start(start, Math.random(), duration + 0.02);
    }
}

export { Radio };
