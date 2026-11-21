// Sons de la radionavigation et du pilote automatique, synthétisés (Web Audio) : radiobornes de l'ILS, indicatif morse
// des balises NDB, alarme de déconnexion du pilote automatique et alerteur d'altitude (KAP 140).
// Les fonctions de manipulation (markerKeying, morseKeying) sont pures : elles disent si la porteuse est modulée à
// l'instant t, pour le son comme pour les voyants MKR qui clignotent en rythme. Le module se charge aussi sous Node
// (tests) : le contexte audio (AudioUnlock.js) n'est importé qu'au premier son, dans le navigateur.
//
// Sources :
// - radiobornes, OACI Annexe 10 vol. I § 3.1.7 : OM 400 Hz, traits continus à 2 par seconde ; MM 1300 Hz, points et
//   traits alternés (traits à 2 par seconde, points à 6 par seconde) ; IM 3000 Hz, points à 6 par seconde. Durées d'un
//   trait (3/4 de sa période) et d'un point (1/2 de sa période) : non relues ;
// - NDB, OACI Annexe 10 vol. I § 3.4 : indicatif en morse à ~7 mots par minute, tonalité 1020 Hz, répété au moins
//   3 fois par 30 s (ici : toutes les 10 s) ;
// - KAP 140 Pilot's Guide 006-18034-0000 rév. 3 : déconnexion du pilote automatique, tonalité de 2 s (p. 10, 57, 85 ;
//   la tonalité n'est pas décrite : deux notes alternées, douces, non relu) ; alerteur d'altitude, cinq tonalités
//   courtes (p. 88-89 ; hauteur et durée non relues).

const MARKER_TONES = { OM: 400, MM: 1300, IM: 3000 };
const DASH = 1 / 2, DOT = 1 / 6;           // périodes d'un trait (2 par seconde) et d'un point (6 par seconde) (s)
const DASH_ON = 0.75, DOT_ON = 0.5;        // part de la période où la porteuse est modulée (non relu)
const NDB_TONE = 1020;
const NDB_WPM = 7;
const NDB_REPEAT = 10;                     // l'indicatif recommence toutes les 10 s (au moins 3 fois par 30 s)
const DISCONNECT = { duration: 2, notes: [880, 660], step: 0.25, volume: 0.1 };   // (non relu)
const ALERT = { count: 5, frequency: 1500, duration: 0.09, gap: 0.16, volume: 0.1 };   // (non relu)
const LEVELS = { marker: 0.08, ndb: 0.06 };
const KEY_TIME = 0.004;                    // constante de temps de la manipulation (s) : pas de claquement

const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-',
    L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-',
    W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
    5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
};

// Porteuse modulée à l'instant t (s) pour une radioborne ('OM', 'MM', 'IM' ; autre : jamais)
function markerKeying(type, t) {
    if (type === 'OM') return (t % DASH + DASH) % DASH < DASH * DASH_ON;
    if (type === 'IM') return (t % DOT + DOT) % DOT < DOT * DOT_ON;
    if (type === 'MM') {
        // Un trait puis un point, en boucle
        const cycle = DASH + DOT, u = (t % cycle + cycle) % cycle;
        return u < DASH ? u < DASH * DASH_ON : u - DASH < DOT * DOT_ON;
    }
    return false;
}

// Éléments d'un indicatif en morse, en unités (durée d'un point) : [[début, durée], ...] et longueur totale.
// Point 1 unité, trait 3, 1 unité entre les signes d'une lettre, 3 entre les lettres
function morseElements(ident) {
    const elements = [];
    let u = 0;
    const letters = [...String(ident).toUpperCase()].filter((c) => MORSE[c]);
    letters.forEach((letter, i) => {
        if (i > 0) u += 2;   // (3 unités entre lettres : 1 déjà comptée après le dernier signe)
        for (const sign of MORSE[letter]) {
            const length = sign === '-' ? 3 : 1;
            elements.push([u, length]);
            u += length + 1;
        }
    });
    return { elements, length: Math.max(0, u - 1) };
}

// Durée d'un point (s) à wpm mots par minute (mot de référence PARIS : 50 unités)
const morseUnit = (wpm) => 1.2 / wpm;

// Porteuse modulée à l'instant t (s) pour l'indicatif ident, recommencé toutes les repeat secondes (au moins la durée
// de l'indicatif suivie d'un espace entre mots, 7 unités) ; t = 0 : début de l'indicatif
function morseKeying(ident, t, wpm = NDB_WPM, repeat = NDB_REPEAT) {
    const { elements, length } = morseElements(ident);
    if (!elements.length) return false;
    const unit = morseUnit(wpm);
    const period = Math.max(repeat, (length + 7) * unit);
    const u = ((t % period) + period) % period / unit;
    return elements.some(([start, duration]) => u >= start && u < start + duration);
}

class NavAudio {
    constructor() {
        this.time = 0;            // horloge des manipulations (s)
        this._audio = null;       // module AudioUnlock.js, une fois importé
        this._loading = null;
        this._ctx = null;
        this._tones = null;       // { marker: { osc, gain }, ndb: { osc, gain } }
    }

    // Contexte audio en marche, ou null (Node, pas encore importé, pas encore débloqué par un geste)
    _context() {
        if (typeof window === 'undefined') return null;
        if (!this._audio) {
            this._loading ??= import('./AudioUnlock.js').then((module) => { this._audio = module; }).catch(() => { /* pas de son */ });
            return null;
        }
        if (!this._ctx) {
            try {
                this._ctx = this._audio.sharedAudioContext();
            } catch {
                return null;
            }
        }
        return this._ctx.state === 'running' ? this._ctx : null;
    }

    // Deux oscillateurs permanents (radioborne, NDB), muets tant que leur porteuse n'est pas modulée
    _ensureTones(ctx) {
        if (this._tones) return this._tones;
        const make = (frequency) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = frequency;
            const gain = ctx.createGain();
            gain.gain.value = 0;
            osc.connect(gain).connect(this._audio.audioOutput());
            osc.start();
            return { osc, gain, on: 0 };
        };
        this._tones = { marker: make(MARKER_TONES.OM), ndb: make(NDB_TONE) };
        return this._tones;
    }

    _key(tone, level, ctx) {
        if (Math.abs(tone.on - level) < 1e-6) return;
        tone.on = level;
        tone.gain.gain.setTargetAtTime(level, ctx.currentTime, KEY_TIME);
    }

    // Lampe d'une radioborne (voyants OM / MM / IM du tableau) : allumée au rythme de sa manipulation
    lamp(marker) {
        return Boolean(marker) && markerKeying(marker, this.time);
    }

    // dt (s) ; marker : radioborne reçue ('OM', 'MM', 'IM' ou null) ; mkrOn : écoute MKR de la boîte audio ;
    // ndbIdent : indicatif de la balise reçue par l'ADF (null : rien) ; adfOn : écoute ADF ; volume : 0 à 1
    update(dt, { marker = null, mkrOn = false, ndbIdent = null, adfOn = false, volume = 1 } = {}) {
        this.time += dt;
        const ctx = this._context();
        if (!ctx) return;
        const tones = this._ensureTones(ctx);
        const markerOn = Boolean(marker && mkrOn && MARKER_TONES[marker] && markerKeying(marker, this.time));
        if (marker && MARKER_TONES[marker] && tones.marker.osc.frequency.value !== MARKER_TONES[marker]) {
            tones.marker.osc.frequency.setValueAtTime(MARKER_TONES[marker], ctx.currentTime);
        }
        this._key(tones.marker, markerOn ? LEVELS.marker * volume : 0, ctx);
        const ndbOn = Boolean(ndbIdent && adfOn && morseKeying(ndbIdent, this.time));
        this._key(tones.ndb, ndbOn ? LEVELS.ndb * volume : 0, ctx);
    }

    // Note brève (s), décalée de offset (s)
    _beep(frequency, duration, offset, volume) {
        const ctx = this._context();
        if (!ctx) return;
        const t = ctx.currentTime + offset;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.01);
        gain.gain.setValueAtTime(volume, t + Math.max(0.01, duration - 0.02));
        gain.gain.linearRampToValueAtTime(0, t + duration);
        osc.connect(gain).connect(this._audio.audioOutput());
        osc.start(t);
        osc.stop(t + duration + 0.05);
    }

    // Déconnexion du pilote automatique : tonalité de 2 s
    disconnect() {
        const { duration, notes, step, volume } = DISCONNECT;
        for (let i = 0; i * step < duration; i++) this._beep(notes[i % notes.length], step, i * step, volume);
    }

    // Alerteur d'altitude : cinq tonalités courtes
    altitudeAlert() {
        const { count, frequency, duration, gap, volume } = ALERT;
        for (let i = 0; i < count; i++) this._beep(frequency, duration, i * gap, volume);
    }
}

export { NavAudio, markerKeying, morseKeying, morseElements, morseUnit, MARKER_TONES, NDB_TONE, NDB_WPM, NDB_REPEAT, MORSE };
