// Alarme d'inclinaison Airbus : au-delà de 45° d'inclinaison en vol, l'annonce « BANK ANGLE, BANK ANGLE » de l'EGPWS,
// répétée toutes les quelques secondes tant que l'inclinaison reste excessive ; après la première, le pilote annonce
// « Bank angle, check! » (dans le casque). L'alarme se réarme une fois revenu sous 40°.
// Sons : EGPWS MK VIII du projet FlightGear A310 (GPL-2.0) ; pilote : voix Piper Alan. Voir asset/sounds/LICENSE.txt

import { sharedAudioContext, audioOutput, loadSound } from './AudioUnlock.js';

const SOUNDS = {
    voice: 'asset/sounds/bank-angle.wav',        // « BANK ANGLE » (dit deux fois de suite)
    check: 'asset/sounds/bank_angle_check.wav',
};
const VOICE_GAP = 0.15;     // s entre les deux « BANK ANGLE »
const LIMIT = 45;           // ° : déclenchement
const REARM = 40;           // ° : alarme réarmée en dessous
const MIN_HEIGHT = 30;      // ft au-dessus du sol : pas d'alarme au décollage ni à l'arrondi
const REPEAT = 3;           // s entre deux annonces tant que l'inclinaison reste excessive
const CHECK_DELAY = 0.4;    // s entre l'alarme et la réponse du pilote
const STEEP_PITCH = 60;     // ° : au-delà (nez très haut ou très bas), l'angle de roulis n'a plus de sens

// Inclinaison qui compte pour l'alarme : le roulis seul, jamais le tangage.
// Le roulis (angle autour de l'axe de l'avion, mesuré par rapport à l'horizon) n'est défini que si le nez n'est pas
// trop près de la verticale : en piqué ou en montée quasi verticale, il se calcule avec deux quantités presque nulles
// et saute au hasard (60°, 110°, 180°…) alors que les ailes restent à plat (l'alarme sonnait en piquant du nez).
// Nez très haut ou très bas : on prend la pente des ailes elle-même (hauteur du bout d'aile droit, nulle tant que les
// ailes sont à l'horizontale, quel que soit le tangage).
// roll, pitch : angles (°) ; wingTilt : pente des ailes (°, asin de la composante verticale de l'axe des ailes)
function alarmBank(roll, pitch, wingTilt) {
    return Math.abs(pitch) < STEEP_PITCH ? Math.abs(roll) : Math.abs(wingTilt);
}

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

    // Le navigateur n'autorise le son qu'après une action du joueur (touche, clic). Appelé à chaque geste : si le
    // chargement des sons a échoué (réseau), il est refait au geste suivant (avant : muet pour toute la session)
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
        // Alarme : haut-parleur du poste (le son de l'EGPWS tel quel) ; pilote : casque
        this._speaker = this._chain([new GainNode(this._audio, { gain: this.volume })]);
        this._headset = this._chain([
            new BiquadFilterNode(this._audio, { type: 'highpass', frequency: 220, Q: 0.7 }),
            new GainNode(this._audio, { gain: this.volume * 0.9 }),
        ]);
        const entries = await Promise.all(Object.entries(SOUNDS).map(async ([name, url]) => {
            return [name, await loadSound(this._audio, url)];
        }));
        this._buffers = Object.fromEntries(entries);
    }

    _chain(nodes) {
        nodes.reduce((a, b) => a.connect(b)).connect(audioOutput());
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
        if (!this.active || !this._buffers || this._source || this._busy) return;
        const now = this._audio.currentTime;
        if (this._armed || now >= this._nextAt) {
            this._armed = false;
            this._busy = true;   // « BANK ANGLE, BANK ANGLE » en cours (pause entre les deux comprise)
            const episode = this._episode;
            this._play('voice', this._speaker, () => setTimeout(() => this._play('voice', this._speaker, () => {
                this._busy = false;
                this._nextAt = this._audio.currentTime + REPEAT;
                // Réponse du pilote : une fois par épisode, et seulement s'il n'est pas déjà fini (avion remis à plat)
                if (this._checked || episode !== this._episode) return;
                this._checked = true;
                setTimeout(() => { if (episode === this._episode) this._play('check', this._headset); }, CHECK_DELAY * 1000);
            }), VOICE_GAP * 1000));
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

export { BankAngleWarning, alarmBank };
