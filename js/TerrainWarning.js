// Alarmes de proximité du sol Airbus (EGPWS Honeywell MK VIII / TAWS), avec les vraies annonces :
// - mode 1, taux de descente excessif près du sol : « SINK RATE, SINK RATE » (attention, bandeau orange), puis
//   « PULL UP » répété si la descente devient dangereuse (alarme, bandeau rouge) ;
// - mode 2, sol qui se rapproche trop vite (relief qui monte sous l'avion) : « TERRAIN, TERRAIN », puis « PULL UP »
//   répété tant que le rapprochement continue ;
// - anticipation du relief (TAWS) : trajectoire qui rentre dans une colline dans les ~25 s : « TERRAIN, TERRAIN,
//   PULL UP » (l'Airbus dit « TERRAIN AHEAD, PULL UP » ; faute d'enregistrement de cette annonce, celle du mode 2).
// Rien au sol, à l'arrondi (sous 30 ft) ni en approche normale sur terrain plat. Les seuils suivent les enveloppes
// du MK VIII, simplifiées (droites).
// Sons : EGPWS MK VIII du projet FlightGear A310 (GPL-2.0). Voir asset/sounds/LICENSE.txt

import { sharedAudioContext, audioOutput, loadSound } from './AudioUnlock.js';

const SOUNDS = {
    terrain: 'asset/sounds/terrain.wav',      // « TERRAIN »
    pullUp: 'asset/sounds/pull-up.wav',       // « PULL UP »
    sinkRate: 'asset/sounds/sink-rate.wav',   // « SINK RATE »
};
const FT = 0.3048;
const MIN_HEIGHT = 30;          // ft : en dessous, plus d'alarme (arrondi, toucher)
const MODE1_MAX = 2450;         // ft : plafond du mode 1
const MODE2_MAX = 1650;         // ft : plafond du mode 2
// (réglages adoucis : avant, 25 s d'anticipation, 100 ft de marge et 150 ft de relief suffisaient, l'alarme sonnait
// trop souvent en volant dans les vallées)
const LOOK_AHEAD = 15;          // s de trajectoire examinés (TAWS)
const LOOK_STEP = 0.5;          // s entre deux points examinés
const CLEARANCE = 50;           // ft : marge sous la trajectoire prévue
const RISE = 300;               // ft : le relief devant doit monter d'autant (pas d'alarme en finale sur terrain plat)
const CLOSURE_SMOOTH = 1.5;     // s : lissage du taux de rapprochement du sol (bosses du relief)
const CONFIRM = 1.0;            // s : la situation doit durer pour déclencher l'alarme (pas sur une simple bosse)
const GAP = 0.08;               // s entre deux annonces enchaînées
const HOLD = 1.5;               // s : l'alarme continue un peu après la sortie de l'enveloppe (pas de hachage)

// Mode 1 (taux de descente, ft/min) : « SINK RATE » au-delà de sinkLimit, « PULL UP » au-delà de pullUpLimit
const sinkLimit = (h) => 960 + 1.65 * h;      // ≈ 1010 ft/min à 30 ft, 5000 à 2450 ft
const pullUpLimit = (h) => 1500 + 2.3 * h;    // ≈ 1570 ft/min à 30 ft, 7100 à 2450 ft
// Mode 2 (rapprochement du sol, ft/min) : alarme sous cette hauteur (2000 ft/min → 30 ft, 5700 → 1650 ft)
const mode2Ceiling = (closure) => Math.min(MODE2_MAX, 30 + (closure - 2000) * 0.44);

class TerrainWarning {
    constructor({ volume = 0.85 } = {}) {
        this.volume = volume;
        this.level = null;        // null, 'sink' (SINK RATE) ou 'pull' (PULL UP) : bandeau à l'écran
        this._audio = null;
        this._buffers = null;
        this._busy = false;
        this._queue = [];
        this._mode = null;        // alarme en cours : 'sink', 'pull' (mode 1) ou 'terrain' (mode 2 / TAWS)
        this._holdUntil = 0;
        this._lastHeight = null;
        this._closure = 0;        // ft/min, > 0 quand le sol se rapproche
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
        this._speaker = new GainNode(this._audio, { gain: this.volume });
        this._speaker.connect(audioOutput());
        const entries = await Promise.all(Object.entries(SOUNDS).map(async ([name, url]) => {
            return [name, await loadSound(this._audio, url)];
        }));
        this._buffers = Object.fromEntries(entries);
    }

    // dt (s) ; airborne ; position (m, repère monde) ; velocity (m/s, repère monde) ; height (ft au-dessus du sol) ;
    // ground(x, z) : hauteur du sol (m) ; offset : hauteur des roues sous l'origine de l'avion (m)
    update(dt, { airborne, position, velocity, height, ground, offset = 0 }) {
        const now = performance.now() / 1000;
        if (!airborne || height < MIN_HEIGHT) {
            this._lastHeight = null;
            this._closure = 0;
            this._set(null, now, true);
            return;
        }
        // Rapprochement du sol : baisse de la hauteur au-dessus du sol (descente + relief qui monte), lissée
        if (this._lastHeight !== null && dt > 0) {
            // (borné : une marche du relief entre deux images ne compte pas comme un rapprochement de 100 000 ft/min)
            const rate = Math.max(-12000, Math.min(12000, (this._lastHeight - height) / dt * 60));
            this._closure += (rate - this._closure) * Math.min(1, dt / CLOSURE_SMOOTH);
        }
        this._lastHeight = height;

        const sink = -velocity.y / FT * 60;    // ft/min
        let mode = null;
        if (height < MODE1_MAX && sink > sinkLimit(height)) mode = sink > pullUpLimit(height) ? 'pull' : 'sink';
        if (height < mode2Ceiling(this._closure) || this._ahead(position, velocity, ground, offset)) mode = 'terrain';
        // Confirmation : une alarme ne démarre (ou ne s'aggrave) que si la situation dure CONFIRM s
        if (mode && mode !== this._mode) {
            if (mode !== this._candidate) {
                this._candidate = mode;
                this._candidateSince = now;
            }
            if (now - this._candidateSince < CONFIRM) mode = this._mode;   // pas encore confirmée : on garde l'état actuel
        } else this._candidate = null;
        this._set(mode, now, false);
        this._play();
    }

    // TAWS : un point de la trajectoire des prochaines secondes passe sous le relief (marge comprise), et ce relief
    // est nettement plus haut que le sol sous l'avion (colline devant, pas la piste en finale)
    _ahead(position, velocity, ground, offset) {
        const below = ground(position.x, position.z);
        for (let t = LOOK_STEP; t <= LOOK_AHEAD; t += LOOK_STEP) {
            const x = position.x + velocity.x * t, z = position.z + velocity.z * t;
            const y = position.y - offset + velocity.y * t;   // trajectoire actuelle (une montée franche passe au-dessus)
            const h = ground(x, z);
            if (h - below > RISE * FT && y < h + CLEARANCE * FT) return true;
        }
        return false;
    }

    _set(mode, now, immediate) {
        const rank = { sink: 1, pull: 2, terrain: 2 };
        if (immediate) {
            this._mode = null;
            this._queue = [];
        } else if (mode) {
            // Plus grave : tout de suite ; aussi grave : on continue l'alarme en cours ; moins grave (PULL UP → SINK
            // RATE) : seulement après le maintien
            if (!this._mode || rank[mode] > rank[this._mode] || (rank[mode] < rank[this._mode] && now > this._holdUntil)) {
                this._start(mode);
            }
            if (rank[mode] >= rank[this._mode]) this._holdUntil = now + HOLD;
        } else if (now > this._holdUntil) {
            this._mode = null;
            this._queue = [];
        }
        this.level = this._mode === 'sink' ? 'sink' : this._mode ? 'pull' : null;
    }

    _start(mode) {
        // « TERRAIN, TERRAIN » une fois au début de l'alarme terrain, puis « PULL UP » (voir _play)
        this._queue = mode === 'terrain' ? ['terrain', 'terrain', 'pullUp'] : [];
        this._mode = mode;
    }

    _play() {
        if (!this._mode || !this._buffers || this._busy) return;
        const name = this._queue.shift() ?? (this._mode === 'sink' ? 'sinkRate' : 'pullUp');
        const source = this._audio.createBufferSource();
        source.buffer = this._buffers[name];
        source.connect(this._speaker);
        this._busy = true;
        source.onended = () => setTimeout(() => {
            this._busy = false;
            this._play();
        }, GAP * 1000);
        source.start();
    }
}

export { TerrainWarning };
