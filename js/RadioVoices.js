// Voix de la radio (pilote et contrôleurs). Voix réalistes : modèles neuronaux Piper (enregistrés à partir de
// vraies voix, licences libres : https://huggingface.co/rhasspy/piper-voices), calculés dans le navigateur avec
// ONNX Runtime ; téléchargés une seule fois (gardés dans le cache du navigateur). Le son passe par un filtre
// radio (bande étroite, saturation légère, souffle). Si les voix réalistes sont indisponibles : voix de
// l'ordinateur (synthèse vocale du navigateur). Chaque rôle garde toujours la même voix.

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js';
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
const PHONEMIZER_URL = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js';
const PHONEMIZER_FILES = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const VOICES_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/';
const CACHE_NAME = 'esme-voix-radio-v1';
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
        ground:   { model: 'fr_FR-upmc-medium', speaker: 1, lengthScale: 0.85 },     // Pierre
        approach: { model: 'fr_FR-upmc-medium', speaker: 0, lengthScale: 0.85 },     // Jessica
        atis:     { model: 'fr_FR-siwis-medium', lengthScale: 1 },
    },
    en: {
        pilot:    { model: 'en_GB-alan-medium', lengthScale: 0.9 },
        tower:    { model: 'en_GB-jenny_dioco-medium', lengthScale: 0.85 },
        ground:   { model: 'en_GB-northern_english_male-medium', lengthScale: 0.85 },
        approach: { model: 'en_GB-alba-medium', lengthScale: 0.85 },
        atis:     { model: 'en_GB-jenny_dioco-medium', lengthScale: 1 },
    },
};
const ROLE_ORDER = ['pilot', 'ground', 'tower', 'approach', 'atis'];
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

    // Prépare un message (calcul de la voix pendant que l'autre parle) ; renvoie un objet { play() }
    async prepare(text, role) {
        const spoken = this.lang === 'fr' ? text.replace(/\b(Alpha|Charlie|Echo|Foxtrot|Hotel|India|Juliett|Mike|November|Quebec|Romeo|Sierra|Uniform|Whiskey|X-ray|Yankee|Zulu)\b/g, (w) => PHONETIC_FR[w]) : text;
        if (this.mode === 'neural' && this.status.state !== 'error') {
            try {
                const cast = CAST[this.lang][role] ?? CAST[this.lang].tower;
                // Pilote : message découpé aux virgules, la suite se calcule pendant qu'il parle (il commence tout de
                // suite) ; ATIS : phrase par phrase ; contrôleurs : message entier (calculé pendant leur temps de réaction)
                const parts = role === 'pilot' ? this._chunks(spoken)
                    : role === 'atis' ? spoken.split(/(?<=[.])\s+/) : [spoken];   // ATIS : phrase par phrase
                const audios = parts.map((part) => this._synthesize(cast, part));
                audios.forEach((a) => a.catch(() => {}));
                await audios[0];
                return {
                    play: async () => {
                        for (const audio of audios) await this._play(await audio, role, audio === audios[audios.length - 1]);
                    },
                };
            } catch (error) {
                console.error('Voix réaliste en échec, voix de l\'ordinateur :', error);
                this.status = { state: 'error', progress: 0 };
                this._emit();
            }
        }
        return { play: () => this._speakSystem(spoken, role) };
    }

    // --- Voix réalistes ---------------------------------------------------------------------------
    // Morceaux coupés après une virgule ou un point : le premier court (~30 caractères, prêt en ~1 s), puis chacun
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

    _ort() {
        this._ortPromise ??= import(ORT_URL).then((ort) => {
            ort.env.wasm.wasmPaths = ORT_WASM;
            ort.env.wasm.numThreads = 1;
            return ort;
        });
        return this._ortPromise;
    }

    _load(model) {
        if (!this._models.has(model)) {
            const promise = (async () => {
                const base = VOICES_URL + MODELS[model];
                const config = JSON.parse(new TextDecoder().decode(await this._fetch(`${base}.onnx.json`)));
                const bytes = await this._fetch(`${base}.onnx`, (loaded, total) => {
                    this._bytes.set(model, { loaded, total });
                    if (this.status.state === 'loading') {
                        this.status.progress = this._progress([...new Set(ROLE_ORDER.map((role) => CAST[this.lang][role].model))]);
                        this._emit();
                    }
                });
                const ort = await this._ort();
                const session = await ort.InferenceSession.create(bytes);
                this._loaded.add(model);
                return { session, config, ort };
            })();
            promise.catch(() => this._models.delete(model));   // nouvel essai plus tard
            this._models.set(model, promise);
        }
        return this._models.get(model);
    }

    // Téléchargement gardé dans le cache du navigateur (une seule fois)
    async _fetch(url, onProgress = null) {
        let cache = null;
        try {
            cache = await caches.open(CACHE_NAME);
            const hit = await cache.match(url);
            if (hit) {
                const buffer = await hit.arrayBuffer();
                onProgress?.(buffer.byteLength, buffer.byteLength);
                return buffer;
            }
        } catch { /* cache indisponible (navigation privée…) */ }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} : ${response.status}`);
        const total = Number(response.headers.get('Content-Length')) || 0;
        const reader = response.body.getReader();
        const chunks = [];
        let loaded = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            onProgress?.(loaded, total || loaded);
        }
        const blob = new Blob(chunks);
        try { await cache?.put(url, new Response(blob)); } catch { /* quota dépassé : retéléchargé la prochaine fois */ }
        return blob.arrayBuffer();
    }

    // Texte -> phonèmes (espeak-ng, version WebAssembly de Piper) ; module chargé une fois, réutilisé
    async _phonemize(text, voice) {
        this._phonemizer ??= (async () => {
            const { createPiperPhonemize } = await import(PHONEMIZER_URL);
            const state = { ids: null };
            const module = await createPiperPhonemize({
                print: (line) => { state.ids = JSON.parse(line).phoneme_ids; },
                printErr: () => {},
                locateFile: (file) => file.endsWith('.wasm') ? `${PHONEMIZER_FILES}.wasm` : file.endsWith('.data') ? `${PHONEMIZER_FILES}.data` : file,
                noExitRuntime: true,
            });
            return { module, state };
        })();
        const { module, state } = await this._phonemizer;
        state.ids = null;
        module.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
        if (!state.ids) throw new Error('phonèmes introuvables');
        return state.ids;
    }

    // Un calcul à la fois (une session ONNX ne fait pas deux calculs en même temps)
    _synthesize(cast, text) {
        const run = (this._synthQueue ?? Promise.resolve()).then(() => this._synthesizeNow(cast, text));
        this._synthQueue = run.catch(() => {});
        return run;
    }

    async _synthesizeNow(cast, text) {
        const { session, config, ort } = await this._load(cast.model);
        // Phrase par phrase : le modèle garde un bon rythme et les pauses tombent aux points
        const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
        const parts = [];
        for (const sentence of sentences) {
            const ids = await this._phonemize(sentence.trim(), config.espeak.voice);
            const inputs = {
                input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
                input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
                scales: new ort.Tensor('float32', Float32Array.from([config.inference.noise_scale,
                    config.inference.length_scale * (cast.lengthScale ?? 1), config.inference.noise_w]), [3]),
            };
            if (config.num_speakers > 1) inputs.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(cast.speaker ?? 0)]), [1]);
            const { output } = await session.run(inputs);
            parts.push(this._trim(output.data, config.audio.sample_rate));
            parts.push(new Float32Array(Math.round(config.audio.sample_rate * 0.15)));   // pause entre les phrases
        }
        const length = parts.reduce((sum, p) => sum + p.length, 0);
        const samples = new Float32Array(length);
        let offset = 0;
        for (const part of parts) {
            samples.set(part, offset);
            offset += part.length;
        }
        // Même niveau pour toutes les voix (crête à 0,9)
        let peak = 0;
        for (const x of samples) peak = Math.max(peak, Math.abs(x));
        if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] *= 0.9 / peak;
        return { samples, sampleRate: config.audio.sample_rate };
    }

    // Silences du début et de la fin retirés (garde 40 ms)
    _trim(data, sampleRate) {
        let peak = 0;
        for (const x of data) peak = Math.max(peak, Math.abs(x));
        const threshold = peak * 0.02, margin = Math.round(sampleRate * 0.04);
        let start = 0, end = data.length;
        while (start < end && Math.abs(data[start]) < threshold) start++;
        while (end > start && Math.abs(data[end - 1]) < threshold) end--;
        return data.subarray(Math.max(0, start - margin), Math.min(data.length, end + margin));
    }

    // Lecture par le filtre radio : contrôleurs en bande étroite (300-2800 Hz), saturés et avec du souffle ;
    // le pilote s'entend dans son casque (un peu moins filtré)
    _play({ samples, sampleRate }, role, last = true) {
        const ctx = this._context();
        const radio = role !== 'pilot';
        // Entre deux morceaux d'un même message : pause courte (celle de fin de phrase est raccourcie)
        const length = last ? samples.length : Math.max(1, samples.length - Math.round(sampleRate * 0.1));
        const buffer = ctx.createBuffer(1, length, sampleRate);
        buffer.copyToChannel(samples.subarray(0, length), 0);
        const source = new AudioBufferSourceNode(ctx, { buffer });
        const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: radio ? 320 : 220, Q: 0.7 });
        const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: radio ? 2800 : 4200, Q: 0.7 });
        const presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1700, Q: 1, gain: radio ? 5 : 2 });
        const shaper = new WaveShaperNode(ctx, { curve: this._clipCurve(radio ? 2.2 : 1.3) });
        const gain = new GainNode(ctx, { gain: radio ? 0.9 : 0.8 });
        source.connect(highpass).connect(lowpass).connect(presence).connect(shaper).connect(gain).connect(ctx.destination);
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
            this._playing.add(finish);
            source.onended = finish;
            source.start();
        });
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
    _systemVoice(role) {
        if (this._systemVoices.has(role)) return this._systemVoices.get(role);
        const synth = window.speechSynthesis;
        const all = synth?.getVoices().filter((v) => v.lang.toLowerCase().startsWith(this.lang)) ?? [];
        if (!all.length) return null;
        const score = (v) => (/natural|neural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
        const voices = [...all].sort((a, b) => score(b) - score(a));
        const used = new Set(this._systemVoices.values());
        const pick = (list) => list.find((v) => !used.has(v)) ?? list[0];
        const voice = role === 'pilot'
            ? pick(voices.filter((v) => MALE_VOICE.test(v.name))) ?? pick(voices)
            : pick(voices.filter((v) => !MALE_VOICE.test(v.name) || role === 'ground')) ?? pick(voices);
        this._systemVoices.set(role, voice);
        return voice;
    }

    _speakSystem(text, role) {
        const synth = window.speechSynthesis;
        const estimate = 0.8 + text.length * 0.065;
        if (!synth) return wait(estimate * 1000);
        return new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            const voice = this._systemVoice(role);
            if (voice) utterance.voice = voice;
            utterance.lang = this.lang === 'fr' ? 'fr-FR' : 'en-GB';
            utterance.rate = role === 'atis' ? 1.05 : role === 'pilot' ? 1.1 : 1.15;
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

    stop() {
        window.speechSynthesis?.cancel();
        for (const finish of [...this._playing]) finish();
        if (this._ctx) {
            this._ctx.close();
            this._ctx = null;
        }
    }

    _emit() {
        this.dispatchEvent(new Event('status'));
    }
}

export { RadioVoices };
