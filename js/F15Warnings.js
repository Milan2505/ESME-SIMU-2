import { sharedAudioContext } from './AudioUnlock.js';

// Alarmes du F-15 (seulement sur le F-15 : les alarmes du Cessna — DÉCROCHAGE, BANK ANGLE, SINK RATE / PULL UP de
// l'EGPWS Airbus — n'y sonnent plus). Comme sur le vrai avion :
// - voyants du panneau d'alarmes (CAUTION LIGHTS) et MASTER CAUTION, qui s'allume à chaque nouvelle panne (un clic
//   l'éteint, jusqu'à la suivante), avec son bip ;
// - boutons FIRE gauche / droit, AMAD FIRE, voyants BURN THRU ;
// - alarme du train : poignée qui clignote et bip tant que le train n'est pas sorti, sous 10 000 ft, sous 200 kt, en
//   descente de plus de 250 ft/min (bouton LDG WARN SILENCE : coupe le bip) ;
// - voix d'alarme (système vocal : voix de femme, en anglais) : « PULL UP » (anticollision avec le sol, GCWS : avec le
//   grand X sur le HUD), « ENGINE FIRE LEFT / RIGHT », « OVER G » (au-delà du facteur de charge permis, qui baisse
//   avec la masse : 9 g léger, 7,33 g lourd), « ALTITUDE » (sous la hauteur d'alerte de la sonde radar), « BINGO »,
//   « FUEL LOW », « LEFT / RIGHT ENGINE OUT », « HYDRAULIC », « FLIGHT CONTROLS » ;
// - avertisseur d'incidence (bip haché du vrai F-15, déjà dans JetSound.js : inchangé).
// La voix : voix neuronale de la radio (RadioVoices.synthesize), filtrée comme un casque ; en attendant qu'elle soit
// calculée, ou si elle est indisponible, voix de l'ordinateur.

const FT = 0.3048, KT = 1.944;
const BINGO_KG = 1360;          // 3 000 lb : réglage du BINGO
const FUEL_LOW_KG = 800;        // ~1 800 lb dans les nourrices
const ALT_LOW_FT = 250;         // hauteur d'alerte de la sonde radar
const ALT_REARM_FT = 400;       // l'alerte se réarme au-dessus
const HEAVY_MASS = 17000;       // kg : au-delà, facteur de charge permis 7,33 g (sinon 9 g)
const GEAR_SPEED_KT = 200, GEAR_ALT_FT = 10000, GEAR_SINK_FPM = 250;
const PULL_UP_HOLD = 1.2;       // s : « PULL UP » continue un peu après la sortie de l'enveloppe

// Phrases, priorité (0 : la plus urgente, coupe les autres) et répétition (s ; 0 : une fois par apparition)
const PHRASES = {
    pullUp:   { text: 'Pull up. Pull up.', priority: 0, repeat: 0.3 },
    missile:  { text: 'Missile. Missile.', priority: 1, repeat: 0 },     // missile air-air tiré sur nous
    fireL:    { text: 'Warning. Engine fire left. Engine fire left.', priority: 1, repeat: 5 },
    fireR:    { text: 'Warning. Engine fire right. Engine fire right.', priority: 1, repeat: 5 },
    overG:    { text: 'Over G. Over G.', priority: 2, repeat: 2.5 },
    lock:     { text: 'Lock. Lock.', priority: 2, repeat: 0 },           // autodirecteur de l'AIM-9 verrouillé : tirez
    altitude: { text: 'Altitude. Altitude.', priority: 2, repeat: 0 },
    engineL:  { text: 'Left engine out.', priority: 3, repeat: 0 },
    engineR:  { text: 'Right engine out.', priority: 3, repeat: 0 },
    hydraulic: { text: 'Warning. Hydraulic.', priority: 3, repeat: 0 },
    flightControls: { text: 'Warning. Flight controls.', priority: 3, repeat: 0 },
    fuelLow:  { text: 'Fuel low. Fuel low.', priority: 4, repeat: 60 },
    bingo:    { text: 'Bingo. Bingo.', priority: 5, repeat: 0 },
};
// Voyants qui allument MASTER CAUTION (panneau d'alarmes)
const CAUTIONS = ['genL', 'genR', 'oilPress', 'hydraulic', 'engContrL', 'engContrR', 'inletL', 'inletR', 'casPitch',
    'casRoll', 'casYaw', 'rollRatio', 'bingo', 'fuelLow', 'totTemp', 'bstPmp'];
// Libellés (panneau en vue extérieure, HUD) : alarmes rouges, puis voyants orange
const LABELS = {
    pullUp: 'PULL UP', fireL: 'L FIRE', fireR: 'R FIRE', amadFire: 'AMAD FIRE', overG: 'OVER G', altLow: 'ALT LOW',
    gearWarning: 'GEAR', masterCaution: 'MASTER CAUTION',
    genL: 'L GEN OUT', genR: 'R GEN OUT', oilPress: 'OIL PRESS', hydraulic: 'HYD', engContrL: 'L ENG CONTR',
    engContrR: 'R ENG CONTR', inletL: 'L INLET', inletR: 'R INLET', casPitch: 'CAS PITCH', casRoll: 'CAS ROLL',
    casYaw: 'CAS YAW', rollRatio: 'ROLL RATIO', bingo: 'BINGO FUEL', fuelLow: 'FUEL LOW', totTemp: 'TOT TEMP HI',
    bstPmp: 'BST PMP', spdBk: 'SPD BK OUT', canopy: 'CANOPY', jfsLow: 'JFS LOW',
};
const WARNINGS = ['pullUp', 'fireL', 'fireR', 'amadFire', 'overG', 'altLow', 'gearWarning'];

class F15Warnings {
    constructor({ voices = null } = {}) {
        this.voices = voices;
        this.alarms = {};                 // voyants allumés (lus par F15Cockpit, le HUD, le panneau extérieur)
        this._buffers = new Map();        // phrase -> AudioBuffer (voix neuronale)
        this._preparing = false;
        this._next = new Map();           // phrase -> moment (s) où elle peut être redite
        this._active = new Set();         // phrases dont la condition est vraie
        this._said = new Set();           // phrases « une fois » déjà dites pour cette apparition
        this._speaking = null;            // { key, priority, stop() }
        this._time = 0;
        this._acked = new Set();          // voyants vus (MASTER CAUTION éteint par un clic)
        this._masterCaution = false;
        this._previousCautions = new Set();
        this._gearSilenced = false;
        this._gearBeep = 0;
        this._altArmed = false;
        this._pullUpHold = 0;
        this._audio = null;
        this.volume = 1;
        this._announced = new Set();      // annonces ponctuelles demandées (lock, missile)
    }

    // Calcul des phrases à l'avance (une fois, voix neuronale)
    _prepare() {
        if (this._preparing || !this.voices) return;
        this._preparing = true;
        (async () => {
            for (const [key, phrase] of Object.entries(PHRASES)) {
                const audio = await this.voices.synthesize(phrase.text);
                if (!audio) {
                    this._preparing = false;   // réessayé dans 30 s (voix pas encore prêtes, ou indisponibles)
                    this._retryAt = this._time + 30;
                    return;
                }
                const ctx = this._context();
                if (!ctx) return;
                const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
                buffer.copyToChannel(audio.samples instanceof Float32Array ? audio.samples : Float32Array.from(audio.samples), 0);
                this._buffers.set(key, buffer);
            }
        })();
    }

    _context() {
        if (this._audio) return this._audio;
        try {
            this._audio = sharedAudioContext();
        } catch {
            return null;
        }
        const ctx = this._audio;
        this._out = ctx.createGain();
        this._out.gain.value = 0.9;
        this._out.connect(ctx.destination);
        // Casque : bande de l'interphone
        this._voiceIn = ctx.createBiquadFilter();
        this._voiceIn.type = 'highpass';
        this._voiceIn.frequency.value = 280;
        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.value = 4200;
        const gain = ctx.createGain();
        gain.gain.value = 1.4;
        this._voiceIn.connect(low).connect(gain).connect(this._out);
        return ctx;
    }

    // Bip (fréquence en Hz, durée en s, décalage en s)
    _beep(frequency, duration, offset = 0, volume = 0.18) {
        const ctx = this._context();
        if (!ctx || ctx.state !== 'running') return;
        const t = ctx.currentTime + offset;
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = frequency;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume * this.volume, t + 0.01);
        gain.gain.setValueAtTime(volume * this.volume, t + duration - 0.02);
        gain.gain.linearRampToValueAtTime(0, t + duration);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2500;
        osc.connect(filter).connect(gain).connect(this._out);
        osc.start(t);
        osc.stop(t + duration + 0.05);
    }

    // MASTER CAUTION : deux notes
    _cautionTone() {
        this._beep(1000, 0.16, 0);
        this._beep(750, 0.16, 0.2);
    }

    // Phrase de la voix d'alarme
    _say(key) {
        const phrase = PHRASES[key];
        const buffer = this._buffers.get(key);
        const ctx = this._context();
        if (buffer && ctx && ctx.state === 'running') {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = 1.08;
            const gain = ctx.createGain();
            gain.gain.value = this.volume;
            source.connect(gain).connect(this._voiceIn);
            source.start();
            const speaking = { key, priority: phrase.priority, done: false, stop: () => { try { source.stop(); } catch { /* déjà fini */ } } };
            source.onended = () => { speaking.done = true; };
            this._speaking = speaking;
            return;
        }
        // Voix de l'ordinateur en attendant
        const synth = window.speechSynthesis;
        if (!synth) return;
        const utterance = new SpeechSynthesisUtterance(phrase.text);
        utterance.lang = 'en-US';
        utterance.rate = 1.15;
        utterance.volume = this.volume;
        const speaking = { key, priority: phrase.priority, done: false, stop: () => synth.cancel() };
        utterance.onend = utterance.onerror = () => { speaking.done = true; };
        if (phrase.priority <= 1 && synth.speaking) synth.cancel();   // urgent : passe devant la radio
        synth.speak(utterance);
        this._speaking = speaking;
    }

    // Annonce ponctuelle de la voix (« Lock, lock », « Missile, missile »), dite une fois
    announce(key) {
        if (!PHRASES[key]) return;
        this._said.delete(key);
        this._next.delete(key);
        this._announced.add(key);
    }

    // Clic sur MASTER CAUTION : voyant éteint jusqu'à la prochaine panne
    acknowledge() {
        this._acked = new Set(CAUTIONS.filter((key) => this.alarms[key]));
        this._masterCaution = false;
    }

    // Bouton LDG WARN SILENCE : coupe le bip du train (jusqu'à ce que l'alarme cesse)
    silenceGear() {
        if (this.alarms.gearWarning) this._gearSilenced = true;
    }

    // À chaque image. s : null (pas en F-15 ou pas en vol libre) ou
    // { powered, airborne, crashed, position, velocity, ground(x, z), wheelHeight, speed (m/s), g, mass, mach, gear,
    //   speedbrake, canopy, fuelKg, engines [{ running, n2, ab }], systemWarnings (JetSystems.warnings), jfsLow,
    //   damage (Damage.js) }
    update(delta, s) {
        this._time += delta;
        if (!s) {
            this.alarms = {};
            this._active.clear();
            this._said.clear();
            this._announced.clear();
            this._previousCautions.clear();
            this._masterCaution = false;
            this._altArmed = false;
            if (this._speaking && !this._speaking.done) this._speaking.stop();
            this._speaking = null;
            return;
        }
        if (!this._buffers.size && this._time >= (this._retryAt ?? 0)) this._prepare();
        const a = {};
        const d = s.damage;
        const flying = s.airborne && !s.crashed;
        const height = (s.position.y - s.wheelHeight - s.ground(s.position.x, s.position.z)) / FT;   // ft sol
        const vsFpm = s.velocity.y / FT * 60;
        const speedKt = s.speed * KT;
        const gearDown = s.gear > 0.99;
        const powered = s.powered;

        // Feu des réacteurs (combat) ; AMAD (accessoires entre les réacteurs) : les deux brûlent
        a.fireL = d.fire[0] > 0;
        a.fireR = d.fire[1] > 0;
        a.amadFire = a.fireL && a.fireR;
        a.burnL = a.fireL;
        a.burnR = a.fireR;
        // Réacteurs : arrêtés ou détruits
        const out = [0, 1].map((i) => !s.engines[i].running || d.engines[i] <= 0);
        const sw = s.systemWarnings;
        a.genL = sw.genL || d.engines[0] <= 0;
        a.genR = sw.genR || d.engines[1] <= 0;
        a.oilPress = out[0] || out[1] || Math.min(d.engines[0], d.engines[1]) < 25;
        a.hydraulic = s.engines.some((e) => e.n2 < 40) || d.engines.some((h) => h <= 0) || d.tail > 0.35 || d.structure < 40;
        a.engContrL = d.engines[0] > 0 && d.engines[0] < 60;
        a.engContrR = d.engines[1] > 0 && d.engines[1] < 60;
        a.inletL = d.engines[0] < 40;
        a.inletR = d.engines[1] < 40;
        a.casPitch = d.tail > 0.25;
        a.casYaw = d.tail > 0.45;
        a.casRoll = Math.max(d.wings[0], d.wings[1]) > 0.35 || d.tail > 0.6;
        a.rollRatio = Math.max(d.wings[0], d.wings[1]) > 0.5;
        a.bingo = s.fuelKg < BINGO_KG;
        a.fuelLow = s.fuelKg < FUEL_LOW_KG;
        a.bstPmp = s.fuelKg <= 1;
        a.totTemp = s.mach > 1.15;
        a.spdBk = s.speedbrake > 0.05;
        a.canopy = s.canopy > 0.01;
        a.jfsLow = s.jfsLow;

        // Facteur de charge permis : 9 g léger, 7,33 g lourd (carburant)
        const allowed = s.mass > HEAVY_MASS ? 7.33 : 9;
        a.overG = flying && (s.g > allowed + 0.15 || s.g < -3.15);

        // Train : sorti ? (sous 10 000 ft sol, sous 200 kt, en descente)
        a.gearWarning = flying && !gearDown && speedKt < GEAR_SPEED_KT && height < GEAR_ALT_FT && vsFpm < -GEAR_SINK_FPM;
        if (!a.gearWarning) this._gearSilenced = false;

        // Sonde radar : passage sous la hauteur d'alerte (réarmée au-dessus de 400 ft ; pas train sorti : atterrissage)
        if (!flying || height > ALT_REARM_FT) this._altArmed = flying && height > ALT_REARM_FT;
        a.altLow = flying && !gearDown && height < ALT_LOW_FT && this._altArmed;
        if (a.altLow && vsFpm >= 0) this._altArmed = false;   // (on remonte : l'alerte s'arrête là)

        // Anticollision avec le sol (GCWS) : la trajectoire rentre dans le relief avant le temps d'une ressource
        let pullUp = false;
        if (flying && !gearDown && height > 30) {
            const v = s.velocity;
            const horizon = 2 + s.speed / 90;   // s : plus long en allant vite (ressource plus longue)
            for (let t = 0.5; t <= horizon; t += 0.5) {
                const x = s.position.x + v.x * t, z = s.position.z + v.z * t;
                const y = s.position.y + v.y * t - s.wheelHeight;
                if (y - s.ground(x, z) < 25) {
                    pullUp = true;
                    break;
                }
            }
        }
        this._pullUpHold = pullUp ? PULL_UP_HOLD : Math.max(0, this._pullUpHold - delta);
        a.pullUp = this._pullUpHold > 0;

        // Sans courant : ni voyants, ni voix
        if (!powered) {
            for (const key of Object.keys(a)) a[key] = false;
        }

        // MASTER CAUTION : nouveau voyant -> allumé, deux notes
        const cautions = new Set(CAUTIONS.filter((key) => a[key]));
        for (const key of cautions) {
            if (!this._previousCautions.has(key) && !this._acked.has(key)) {
                this._masterCaution = true;
                this._cautionTone();
                break;
            }
        }
        for (const key of [...this._acked]) if (!cautions.has(key)) this._acked.delete(key);
        this._previousCautions = cautions;
        a.masterCaution = this._masterCaution && cautions.size > 0;
        if (!cautions.size) this._masterCaution = false;
        a.gearSilenced = this._gearSilenced;
        this.alarms = a;

        // Bip du train : 0,25 s toutes les 0,5 s
        if (a.gearWarning && !this._gearSilenced) {
            this._gearBeep -= delta;
            if (this._gearBeep <= 0) {
                this._gearBeep = 0.5;
                this._beep(1250, 0.25, 0, 0.12);
            }
        } else this._gearBeep = 0;

        // Voix : phrases dont la condition est vraie
        const conditions = {
            pullUp: a.pullUp, fireL: a.fireL, fireR: a.fireR, overG: a.overG, altitude: a.altLow,
            engineL: flying && out[0], engineR: flying && out[1],
            hydraulic: flying && a.hydraulic && !out[0] && !out[1], flightControls: flying && (a.casPitch || a.casRoll),
            fuelLow: a.fuelLow && flying, bingo: a.bingo && flying,
        };
        for (const [key, on] of Object.entries(conditions)) {
            if (on) this._active.add(key);
            else {
                this._active.delete(key);
                this._said.delete(key);
                this._next.delete(key);
            }
        }
        for (const key of this._announced) this._active.add(key);
        // Phrase finie : répétée après son délai
        if (this._speaking?.done) {
            this._next.set(this._speaking.key, this._time + PHRASES[this._speaking.key].repeat);
            this._speaking = null;
        }
        // Phrase la plus urgente prête à être dite
        let best = null;
        for (const key of this._active) {
            const phrase = PHRASES[key];
            if (phrase.repeat === 0 && this._said.has(key)) continue;
            if ((this._next.get(key) ?? 0) > this._time) continue;
            if (!best || phrase.priority < PHRASES[best].priority) best = key;
        }
        if (!best) return;
        if (this._speaking) {
            // Une alarme plus urgente coupe la phrase en cours (PULL UP, FIRE)
            if (PHRASES[best].priority <= 1 && PHRASES[best].priority < this._speaking.priority) {
                this._speaking.stop();
                this._next.set(this._speaking.key, this._time + PHRASES[this._speaking.key].repeat);
            } else return;
        }
        this._say(best);
        this._said.add(best);
        if (this._announced.delete(best)) this._active.delete(best);
        // (redite à la fin de la phrase ; sans son possible : dans quelques secondes)
        this._next.set(best, this._speaking ? Infinity : this._time + PHRASES[best].repeat + 2);
    }

    // Libellés allumés, alarmes (rouges) d'abord : [{ key, label, warning }]
    list() {
        const result = [];
        for (const key of WARNINGS) if (this.alarms[key]) result.push({ key, label: LABELS[key], warning: true });
        for (const key of [...CAUTIONS, 'spdBk', 'canopy', 'jfsLow']) {
            if (this.alarms[key]) result.push({ key, label: LABELS[key], warning: false });
        }
        return result;
    }
}

export { F15Warnings };
