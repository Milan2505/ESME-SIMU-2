// Alarme de décrochage Airbus : annonce vocale "STALL" puis "cricket", en boucle.
// Sons issus du projet FlightGear A320-family (GPL-2.0), voir asset/sounds/

const SOUNDS = {
    voice:   'asset/sounds/stall_voice.wav',
    cricket: 'asset/sounds/cricket.wav',
};

class StallWarning {
    constructor({ volume = 0.6 } = {}) {
        this.volume = volume;
        this._audio = null;
        this._buffers = null;
        this._source = null;
        this._active = false;
        this._step = 0;
    }

    // Le navigateur n'autorise le son qu'après une action du joueur (touche, clic)
    async unlock() {
        if (this._audio) return;
        this._audio = new AudioContext();
        this._gain = this._audio.createGain();
        this._gain.gain.value = this.volume;
        this._gain.connect(this._audio.destination);

        const entries = await Promise.all(Object.entries(SOUNDS).map(async ([name, url]) => {
            const response = await fetch(url);
            return [name, await this._audio.decodeAudioData(await response.arrayBuffer())];
        }));
        this._buffers = Object.fromEntries(entries);
    }

    update(active) {
        if (active && !this._active) this._step = 0;
        if (!active && this._source) {
            this._source.stop();
            this._source = null;
        }
        this._active = active;
        if (active) this._playNext(); // démarre aussi si les sons ont fini de charger entre-temps
    }

    _playNext() {
        if (!this._active || !this._buffers || this._source) return;
        // Séquence Airbus : "STALL" (voix) puis cricket, répétés
        const buffer = this._step++ % 2 === 0 ? this._buffers.voice : this._buffers.cricket;
        const source = this._audio.createBufferSource();
        source.buffer = buffer;
        source.connect(this._gain);
        source.onended = () => {
            if (this._source === source) this._source = null;
            this._playNext();
        };
        source.start();
        this._source = source;
    }
}

export { StallWarning };
