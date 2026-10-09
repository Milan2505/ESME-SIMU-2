// Son du moteur de Cessna 172 (Lycoming) : boucle "ralenti" et boucle "plein régime"
// mélangées selon les gaz. Sons du projet FlightGear c172p (GPL-2.0), voir asset/sounds/

const SOUNDS = {
    idle: 'asset/sounds/cessna_engine-idle.wav',
    full: 'asset/sounds/cessna_engine.wav',
};

class EngineSound {
    constructor({ volume = 0.5 } = {}) {
        this.volume = volume;
        this._audio = null;
        this._loops = null;
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
            const buffer = await this._audio.decodeAudioData(await response.arrayBuffer());
            const source = this._audio.createBufferSource();
            const gain = this._audio.createGain();
            source.buffer = buffer;
            source.loop = true;
            gain.gain.value = 0;
            source.connect(gain).connect(this._master);
            source.start();
            return [name, { source, gain }];
        }));
        this._loops = Object.fromEntries(entries);
    }

    // throttle : 0 -> 1 ; volume : 0 -> 1 (plus faible en cabine qu'à l'extérieur, par ex.)
    update(throttle, volume = 1) {
        if (!this._loops) return;
        const now = this._audio.currentTime;
        const { idle, full } = this._loops;
        const mix = Math.min(1, Math.max(0, (throttle - 0.1) / 0.6)); // fondu ralenti -> plein régime

        idle.gain.gain.setTargetAtTime((1 - mix) * volume, now, 0.1);
        full.gain.gain.setTargetAtTime(mix * volume, now, 0.1);
        // Le régime monte avec les gaz
        idle.source.playbackRate.setTargetAtTime(0.9 + 0.3 * throttle, now, 0.2);
        full.source.playbackRate.setTargetAtTime(0.8 + 0.3 * throttle, now, 0.2);
    }
}

export { EngineSound };
