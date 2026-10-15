// Voix de la radio (pilote et contrôleurs). Voix réalistes : modèles neuronaux Piper (enregistrés à partir de
// vraies voix, licences libres : https://huggingface.co/rhasspy/piper-voices), calculés dans le navigateur avec
// ONNX Runtime, dans un fil séparé (VoiceWorker.js : le simulateur ne se fige pas) ; téléchargés une seule fois
// (gardés dans le cache du navigateur). Le son passe par un filtre
// radio (bande étroite, saturation légère, souffle). Si les voix réalistes sont indisponibles : voix de
// l'ordinateur (synthèse vocale du navigateur). Chaque rôle garde toujours la même voix.

const VOICES_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/';
const MODELS = {
    'fr_FR-tom-medium': 'fr/fr_FR/tom/medium/fr_FR-tom-medium',
    'fr_FR-siwis-medium': 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium',
    'fr_FR-upmc-medium': 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium',
    'en_GB-alan-medium': 'en/en_GB/alan/medium/en_GB-alan-medium',
    'en_GB-jenny_dioco-medium': 'en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium',
    'en_GB-northern_english_male-medium': 'en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium',
    'en_GB-alba-medium': 'en/en_GB/alba/medium/en_GB-alba-medium',
};
// Distribution des voix : le pilote (toujours la même), un contrôleur différent par fréquence, l'ATIS lu plus lentement.
// lengthScale < 1 : débit plus rapide (phraséologie radio)
const CAST = {
    fr: {
        pilot:    { model: 'fr_FR-tom-medium', lengthScale: 0.9 },
        tower:    { model: 'fr_FR-siwis-medium', lengthScale: 0.85 },
        info:     { model: 'fr_FR-siwis-medium', lengthScale: 0.9, rate: 0.92 },    // Siwis, voix plus grave
        ground:   { model: 'fr_FR-upmc-medium', speaker: 1, lengthScale: 0.85 },     // Pierre
        approach: { model: 'fr_FR-upmc-medium', speaker: 0, lengthScale: 0.85 },     // Jessica
        atis:     { model: 'fr_FR-siwis-medium', lengthScale: 1 },
        instructor: { model: 'fr_FR-tom-medium', lengthScale: 1.02 },   // moniteur (mode Initiation), à côté de l'élève
    },
    en: {
        pilot:    { model: 'en_GB-alan-medium', lengthScale: 0.9 },
        tower:    { model: 'en_GB-jenny_dioco-medium', lengthScale: 0.85 },
        info:     { model: 'en_GB-alba-medium', lengthScale: 0.9, rate: 0.92 },
        ground:   { model: 'en_GB-northern_english_male-medium', lengthScale: 0.85 },
        approach: { model: 'en_GB-alba-medium', lengthScale: 0.85 },
        atis:     { model: 'en_GB-jenny_dioco-medium', lengthScale: 1 },
        instructor: { model: 'en_GB-alan-medium', lengthScale: 1.02 },
    },
};
const ROLE_ORDER = ['pilot', 'ground', 'tower', 'approach', 'atis'];
// Voix des pilotes : un même modèle, plus ou moins grave selon le joueur (voir _pilotRate)
const PILOT_RATES = [1, 0.93, 1.07, 0.89, 1.11];
// Alphabet OACI prononcé à la française (sinon "Mike" est lu "mik", "Juliett" "juliète"…)
const PHONETIC_FR = {
    Alpha: 'Alfa', Charlie: 'Tcharli', Echo: 'Écho', Foxtrot: 'Foxtrotte', Hotel: 'Hôtel', India: 'Indiya',
    Juliett: 'Djouliette', Mike: 'Maïk', November: 'Novèmbeur', Quebec: 'Kébèk', Romeo: 'Roméo', Sierra: 'Siéra',
    Uniform: 'Iouniforme', Whiskey: 'Ouiski', 'X-ray': 'Ixe-rè', Yankee: 'Yanki', Zulu: 'Zoulou',
};
const MALE_VOICE = /paul|henri|claude|thomas|david|mark|george|guy|daniel|ryan|male|homme/i;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RadioVoices extends EventTarget {
    constructor() {
        super();
        this.mode = 'neural';          // 'neural' (voix réalistes) ou 'system' (voix de l'ordinateur)
        this.lang = 'fr';
        this.status = { state: 'idle', progress: 0 };   // idle | loading | ready | error
        this._models = new Map();      // modèle -> Promise<{ session, config }>
        this._loaded = new Set();
        this._bytes = new Map();       // modèle -> { loaded, total } (progression du téléchargement)
        this._systemVoices = new Map();   // rôle -> voix de l'ordinateur choisie une fois pour toutes
        this._playing = new Set();        // lectures en cours (terminées d'un coup par stop())
    }

    setMode(mode) {
        this.mode = mode === 'system' ? 'system' : 'neural';
        if (this.mode === 'neural') this.preload();
        this._emit();
    }

    setLanguage(lang) {
        this.lang = lang === 'en' ? 'en' : 'fr';
        this._systemVoices.clear();
        if (this.status.state !== 'idle') this.preload();
    }

    // Télécharge et prépare toutes les voix de la langue (pilote d'abord)
    preload() {
        if (this.mode !== 'neural') return;
        const models = [...new Set(ROLE_ORDER.map((role) => CAST[this.lang][role].model))];
        if (models.every((m) => this._loaded.has(m))) {
            this.status = { state: 'ready', progress: 1 };
            this._emit();
            return;
        }
        this.status = { state: 'loading', progress: this._progress(models) };
        this._emit();
        (async () => {
            try {
                for (const model of models) await this._load(model);
                this.status = { state: 'ready', progress: 1 };
            } catch (error) {
                console.error('Voix réalistes indisponibles :', error);
                this.status = { state: 'error', progress: 0 };
            }
            this._emit();
        })();
    }

    // Joueur local (multijoueur : son identifiant) : sa voix de pilote, la même que celle que les autres entendent
    setPlayerId(id) {
        this.playerId = id || '';
    }

    // Voix attitrée d'un pilote : même modèle pour tous, voix plus grave ou plus aiguë selon l'identifiant du joueur
    // (calculée pareil chez tout le monde : un joueur s'entend comme les autres l'entendent). Solo : voix normale
    _pilotRate(seed) {
        if (!seed) return 1;
        const hash = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
        return PILOT_RATES[hash % PILOT_RATES.length];
    }

    // Prépare un message (calcul de la voix pendant que l'autre parle) ; renvoie un objet { play() }.
    // Autre joueur (multijoueur) : role 'otherPilot', seed = son identifiant, lang = la langue de son message.
    // Chaque rôle garde toujours la même voix : voix réaliste dans toutes les langues ; un calcul raté est refait
    // (pas de voix de l'ordinateur pour un seul message) ; la voix de l'ordinateur ne sert que si les voix réalistes
    // sont abandonnées pour toute la session, ou choisies dans les réglages
    async prepare(text, role, { lang = this.lang, seed = '' } = {}) {
        const language = CAST[lang] ? lang : this.lang;
        const spoken = language === 'fr' ? text.replace(/\b(Alpha|Charlie|Echo|Foxtrot|Hotel|India|Juliett|Mike|November|Quebec|Romeo|Sierra|Uniform|Whiskey|X-ray|Yankee|Zulu)\b/g, (w) => PHONETIC_FR[w]) : text;
        if (this.mode === 'neural' && this.status.state !== 'error') {
            const pilot = role === 'pilot' || role === 'otherPilot';
            const cast = pilot ? CAST[language].pilot : CAST[language][role] ?? CAST[language].tower;
            const rate = pilot ? this._pilotRate(role === 'pilot' ? this.playerId : seed) : cast.rate ?? 1;
            // Pilote : message découpé aux virgules, la suite se calcule pendant qu'il parle (il commence tout de
            // suite) ; ATIS : phrase par phrase ; contrôleurs : message entier (calculé pendant leur temps de réaction)
            const parts = pilot ? this._chunks(spoken) : role === 'atis' ? spoken.split(/(?<=[.])\s+/) : [spoken];
            const audios = parts.map((part) => this._synthesizeRetry(cast, part));
            audios.forEach((a) => a.catch(() => {}));
            try {
                await audios[0];
                return {
                    play: async () => {
                        for (const audio of audios) {
                            const data = await audio.catch(() => null);   // morceau perdu : on passe au suivant, même voix
                            if (data) await this._play(data, role, audio === audios[audios.length - 1], rate);
                        }
                    },
                };
            } catch (error) {
                this._failed(error);
                if (this.status.state !== 'error') return { play: () => wait(300) };   // message perdu, voix inchangée
            }
        }
        return { play: () => this._speakSystem(spoken, role === 'otherPilot' ? 'pilot' : role, language) };
    }

    // Calcul refait jusqu'à deux fois (le fil de calcul planté est recréé entre-temps)
    async _synthesizeRetry(cast, text, ids = null) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await this._synthesize(cast, text, ids);
            } catch (error) {
                if (attempt >= 2 || /annulé/.test(error.message)) throw error;
                await wait(300);
            }
        }
    }

    // --- Voix réalistes ---------------------------------------------------------------------------
    // Morceaux coupés après une virgule ou un point : le premier court (~30 caractères, prêt en ~1,5 s), puis chacun
    // deux fois plus long que le précédent (calculé pendant que le précédent est dit, le calcul va ~2,5 fois plus vite
    // que la parole) : peu de coupures, sans attente
    _chunks(text) {
        const pieces = text.split(/(?<=[,.])\s+/);
        const chunks = [];
        let current = '', target = 30;
        for (const piece of pieces) {
            current = current ? `${current} ${piece}` : piece;
            if (current.length >= target) {
                chunks.push(current);
                target = current.length * 2;
                current = '';
            }
        }
        if (current) {
            if (chunks.length && current.length < 20) chunks[chunks.length - 1] += ` ${current}`;
            else chunks.push(current);
        }
        return chunks;
    }

    _progress(models) {
        let loaded = 0, total = 0;
        for (const model of models) {
            const b = this._bytes.get(model);
            if (this._loaded.has(model)) { loaded += b?.total || 1; total += b?.total || 1; continue; }
            loaded += b?.loaded ?? 0;
            total += b?.total || 70e6;
        }
        return total ? loaded / total : 0;
    }

    // Fil de calcul des voix (créé à la première demande)
    _worker() {
        if (!this._voiceWorker) {
            this._voiceWorker = new Worker(new URL('./VoiceWorker.js', import.meta.url), { type: 'module' });
            this._requests = new Map();
            this._nextId = 1;
            this._voiceWorker.onmessage = ({ data }) => {
                if (data.type === 'progress') {
                    this._bytes.set(data.model, { loaded: data.loaded, total: data.total });
                    if (this.status.state === 'loading') {
                        this.status.progress = this._progress([...new Set(ROLE_ORDER.map((role) => CAST[this.lang][role].model))]);
                        this._emit();
                    }
                    return;
                }
                const request = this._requests.get(data.id);
                if (!request) return;
                this._requests.delete(data.id);
                if (data.type === 'error') request.reject(new Error(data.message));
                else request.resolve(data);
            };
            this._voiceWorker.onerror = (event) => {
                for (const request of this._requests.values()) request.reject(new Error(event.message || 'voix : erreur du fil de calcul'));
                this._requests.clear();
                // Fil planté : recréé à la prochaine demande (modèles relus depuis le cache du navigateur)
                this._voiceWorker.terminate();
                this._voiceWorker = null;
                this._models.clear();
            };
        }
        return this._voiceWorker;
    }

    _ask(message, ids = null) {
        const worker = this._worker();
        const id = this._nextId++;
        ids?.push(id);
        return new Promise((resolve, reject) => {
            this._requests.set(id, { resolve, reject });
            worker.postMessage({ ...message, id });
        });
    }

    _load(model) {
        if (!this._models.has(model)) {
            const promise = this._ask({ type: 'load', model, base: VOICES_URL + MODELS[model] }).then(() => this._loaded.add(model));
            promise.catch(() => this._models.delete(model));   // nouvel essai plus tard
            this._models.set(model, promise);
        }
        return this._models.get(model);
    }

    // Les calculs passent un par un dans le fil de calcul (dans l'ordre des demandes)
    // ids : liste où noter le numéro de la demande (pour l'annuler, voir stopInstructor)
    async _synthesize(cast, text, ids = null) {
        const { samples, sampleRate } = await this._ask({ type: 'synth', model: cast.model, base: VOICES_URL + MODELS[cast.model],
            text, speaker: cast.speaker ?? 0, lengthScale: cast.lengthScale ?? 1 }, ids);
        this._loaded.add(cast.model);
        this._failures = 0;
        this._worked = true;
        return { samples, sampleRate };
    }

    // Lecture par le filtre radio : contrôleurs en bande étroite (300-2800 Hz), saturés et avec du souffle ;
    // le pilote s'entend dans son casque (un peu moins filtré)
    _play({ samples, sampleRate }, role, last = true, rate = 1) {
        const ctx = this._context();
        const instructor = role === 'instructor';
        const radio = role !== 'pilot' && !instructor;
        // Entre deux morceaux d'un même message : pause courte (celle de fin de phrase est raccourcie)
        const length = last ? samples.length : Math.max(1, samples.length - Math.round(sampleRate * 0.1));
        const buffer = ctx.createBuffer(1, length, sampleRate);
        buffer.copyToChannel(samples.subarray(0, length), 0);
        const source = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate });
        const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: radio ? 320 : 220, Q: 0.7 });
        const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: radio ? 2800 : 4200, Q: 0.7 });
        const presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1700, Q: 1, gain: radio ? 5 : 2 });
        const shaper = new WaveShaperNode(ctx, { curve: this._clipCurve(radio ? 2.2 : 1.3) });
        const gain = new GainNode(ctx, { gain: radio ? 0.9 : 0.8 });
        // Moniteur : voix directe dans la cabine (pas de casque ni de radio), juste un peu adoucie
        if (instructor) source.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7000 })).connect(new GainNode(ctx, { gain: 0.95 })).connect(ctx.destination);
        else source.connect(highpass).connect(lowpass).connect(presence).connect(shaper).connect(gain).connect(ctx.destination);
        let hiss = null;
        if (radio) {
            hiss = new AudioBufferSourceNode(ctx, { buffer: this._noise(ctx), loop: true });
            const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2000, Q: 0.6 });
            hiss.connect(band).connect(new GainNode(ctx, { gain: 0.018 })).connect(ctx.destination);
            hiss.start();
        }
        return new Promise((resolve) => {
            const finish = () => {
                this._playing.delete(finish);
                try { hiss?.stop(); } catch { /* contexte déjà fermé */ }
                resolve();
            };
            finish.role = role;
            finish.source = source;
            this._playing.add(finish);
            source.onended = finish;
            source.start();
        });
    }

    // Échec d'un calcul (déjà refait deux fois) : la voix réaliste n'est abandonnée, pour toute la session et tous les
    // rôles à la fois, qu'après trois échecs de suite ; jamais de changement de voix message par message
    _failed(error) {
        console.error('Voix réaliste en échec (calcul refait, voix inchangée) :', error);
        this._failures = (this._failures ?? 0) + 1;
        // Une fois qu'une voix réaliste a parlé, on ne change plus jamais de voix en cours de session : un message raté
        // est perdu (ou sauté), jamais dit par la voix de l'ordinateur
        if (this._failures >= 3 && !this._worked) {
            this.status = { state: 'error', progress: 0 };
            this._emit();
        }
    }

    // --- Moniteur (mode Initiation) ---------------------------------------------------------------
    // Dit un texte avec la voix du moniteur ; renvoie une promesse résolue à la fin (ou à l'interruption). Toujours la
    // même voix : la voix réaliste (au premier lancement, il parle quand elle est téléchargée ; son texte est affiché)
    async speakInstructor(text) {
        this.stopInstructor();
        const token = this._instructorToken = {};
        const spoken = text.replace(/«|»/g, '');
        if (this.mode === 'neural' && this.status.state !== 'error') {
            try {
                const cast = CAST[this.lang].instructor;
                token.ids = [];
                const audios = this._chunks(spoken).map((part) => this._synthesizeRetry(cast, part, token.ids));
                audios.forEach((a) => a.catch(() => {}));
                let spokenAny = false;
                for (const audio of audios) {
                    const data = await audio.catch((error) => {
                        if (token === this._instructorToken) this._failed(error);
                        return null;
                    });
                    if (token !== this._instructorToken) return;
                    if (!data) continue;   // morceau perdu : sauté, même voix pour la suite
                    spokenAny = true;
                    await this._play(data, 'instructor', audio === audios[audios.length - 1]);
                    if (token !== this._instructorToken) return;
                }
                // Rien n'a pu être calculé et la voix réaliste n'a encore jamais marché : voix de l'ordinateur (sinon silence,
                // le texte reste affiché)
                if (spokenAny || this._worked || this.status.state !== 'error') return;
            } catch (error) {
                if (token !== this._instructorToken) return;   // interrompu : pas un échec
                this._failed(error);
                if (this._worked) return;
            }
        }
        if (token !== this._instructorToken) return;
        this._instructorUtterance = true;
        await this._speakSystem(spoken, 'instructor');
        this._instructorUtterance = false;
    }

    stopInstructor() {
        // Calculs de la phrase interrompue pas encore faits : annulés (sinon la radio attendait derrière eux)
        const ids = this._instructorToken?.ids;
        if (ids?.length && this._voiceWorker) this._voiceWorker.postMessage({ type: 'cancel', ids });
        this._instructorToken = null;
        for (const finish of [...this._playing]) {
            if (finish.role !== 'instructor') continue;
            try { finish.source.stop(); } catch { /* déjà arrêtée */ }
            finish();
        }
        if (this._instructorUtterance) {
            window.speechSynthesis?.cancel();
            this._instructorUtterance = false;
        }
    }

    _context() {
        this._ctx ??= new AudioContext();
        if (this._ctx.state === 'suspended') this._ctx.resume();
        return this._ctx;
    }

    _clipCurve(drive) {
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
        }
        return curve;
    }

    _noise(ctx) {
        if (!this._noiseBuffer) {
            this._noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = this._noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        return this._noiseBuffer;
    }

    // --- Voix de l'ordinateur (repli) -------------------------------------------------------------
    // Choisies une fois par rôle : voix "naturelles" en ligne d'abord (Edge : Denise, Henri… ; Chrome : Google),
    // une voix d'homme pour le pilote, une voix différente par fréquence
    _systemVoice(role, lang = this.lang) {
        const key = `${lang}:${role}`;
        if (this._systemVoices.has(key)) return this._systemVoices.get(key);
        const synth = window.speechSynthesis;
        const all = synth?.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang)) ?? [];
        if (!all.length) return null;
        const score = (v) => (/natural|neural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
        const voices = [...all].sort((a, b) => score(b) - score(a));
        const used = new Set(this._systemVoices.values());
        const pick = (list) => list.find((v) => !used.has(v)) ?? list[0];
        const voice = role === 'pilot' || role === 'otherPilot' || role === 'instructor'
            ? pick(voices.filter((v) => MALE_VOICE.test(v.name))) ?? pick(voices)
            : pick(voices.filter((v) => !MALE_VOICE.test(v.name) || role === 'ground')) ?? pick(voices);
        this._systemVoices.set(key, voice);
        return voice;
    }

    _speakSystem(text, role, lang = this.lang) {
        const synth = window.speechSynthesis;
        const estimate = 0.8 + text.length * 0.065;
        if (!synth) return wait(estimate * 1000);
        return new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            const voice = this._systemVoice(role, lang);
            if (voice) utterance.voice = voice;
            utterance.lang = lang === 'fr' ? 'fr-FR' : 'en-GB';
            utterance.rate = role === 'instructor' ? 1.02 : role === 'atis' ? 1.05 : role === 'pilot' ? 1.1 : 1.15;
            let done = false;
            const timer = setTimeout(() => finish(), estimate * 2000 + 3000);
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            };
            utterance.onend = utterance.onerror = finish;
            synth.speak(utterance);
        });
    }

    // Coupe la radio (nouveau départ, voix coupée) ; le moniteur continue de parler
    stop() {
        if (!this._instructorUtterance) window.speechSynthesis?.cancel();
        for (const finish of [...this._playing]) {
            if (finish.role === 'instructor') continue;
            try { finish.source.stop(); } catch { /* déjà arrêtée */ }
            finish();
        }
    }

    _emit() {
        this.dispatchEvent(new Event('status'));
    }
}

export { RadioVoices };
