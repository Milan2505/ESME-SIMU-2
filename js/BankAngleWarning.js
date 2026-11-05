// Alarme d'inclinaison façon Airbus : au-delà de 45° d'inclinaison en vol, l'annonce « BANK ANGLE, BANK ANGLE »
// (haut-parleur du poste : voix synthétique, bande étroite), répétée toutes les quelques secondes tant que l'inclinaison
// reste excessive ; après la première, le pilote annonce « Bank angle, check! » (dans le casque). L'alarme se réarme
// une fois revenu sous 40°.
// Sons calculés avec les voix Piper (rhasspy/piper-voices) : Northern English Male (alarme), Alan (pilote), voir
// asset/sounds/LICENSE.txt

const SOUNDS = {
    voice: 'asset/sounds/bank_angle_voice.wav',
    check: 'asset/sounds/bank_angle_check.wav',
};
const LIMIT = 45;           // ° : déclenchement
const REARM = 40;           // ° : alarme réarmée en dessous
const MIN_HEIGHT = 30;      // ft au-dessus du sol : pas d'alarme au décollage ni à l'arrondi
const REPEAT = 3;           // s entre deux annonces tant que l'inclinaison reste excessive
const CHECK_DELAY = 0.4;    // s entre l'alarme et la réponse du pilote

class BankAngleWarning {
    constructor({ volume = 0.8 } = {}) {
        this.volume = volume;
        this.active = false;      // inclinaison excessive (bandeau à l'écran)
        this._audio = null;
        this._buffers = null;
        this._source = null;
        this._armed = true;
        this._checked = false;
        this._episode = 0;        // inclinaison excessive en cours (numéro) : la réponse du pilote ne sert qu'à elle
        this._nextAt = 0;
    }

    // Le navigateur n'autorise le son qu'après une action du joueur (touche, clic)
    async unlock() {
        if (this._audio) return;
        this._audio = new AudioContext();
        // Alarme : haut-parleur du poste (bande étroite, un peu saturé) ; pilote : casque (voix directe)
        this._speaker = this._chain([
            new BiquadFilterNode(this._audio, { type: 'highpass', frequency: 380, Q: 0.7 }),
            new BiquadFilterNode(this._audio, { type: 'lowpass', frequency: 3600, Q: 0.7 }),
            new WaveShaperNode(this._audio, { curve: saturation(1.8) }),
            new GainNode(this._audio, { gain: this.volume }),
        ]);
        this._headset = this._chain([
            new BiquadFilterNode(this._audio, { type: 'highpass', frequency: 220, Q: 0.7 }),
            new GainNode(this._audio, { gain: this.volume * 0.9 }),
        ]);
        const entries = await Promise.all(Object.entries(SOUNDS).map(async ([name, url]) => {
            const response = await fetch(url);
            return [name, await this._audio.decodeAudioData(await response.arrayBuffer())];
        }));
        this._buffers = Object.fromEntries(entries);
    }

    _chain(nodes) {
        nodes.reduce((a, b) => a.connect(b)).connect(this._audio.destination);
        return nodes[0];
    }

    // bank : inclinaison (°, signe sans importance) ; airborne, height (ft au-dessus du sol)
    update(bank, airborne, height) {
        const angle = Math.abs(bank);
        const flying = airborne && height > MIN_HEIGHT;
        if (!flying || angle < REARM) {
            if (!this._armed) this._episode++;
            this._armed = true;
            this._checked = false;
            this.active = false;
            return;
        }
        this.active = angle > LIMIT || (this.active && angle > REARM);
        if (!this.active || !this._buffers || this._source) return;
        const now = this._audio.currentTime;
        if (this._armed || now >= this._nextAt) {
            this._armed = false;
            const episode = this._episode;
            this._play('voice', this._speaker, () => {
                this._nextAt = this._audio.currentTime + REPEAT;
                // Réponse du pilote : une fois par épisode, et seulement s'il n'est pas déjà fini (avion remis à plat)
                if (this._checked || episode !== this._episode) return;
                this._checked = true;
                setTimeout(() => { if (episode === this._episode) this._play('check', this._headset); }, CHECK_DELAY * 1000);
            });
        }
    }

    _play(name, output, onEnded = null) {
        const source = this._audio.createBufferSource();
        source.buffer = this._buffers[name];
        source.connect(output);
        source.onended = () => {
            if (this._source === source) this._source = null;
            onEnded?.();
        };
        source.start();
        this._source = source;
    }
}

// Saturation douce (tanh) : timbre du haut-parleur d'alarme
function saturation(drive) {
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
}

export { BankAngleWarning };
