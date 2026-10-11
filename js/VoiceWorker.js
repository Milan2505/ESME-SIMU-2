// Calcul des voix réalistes (Piper) dans un fil séparé : sur le fil principal, chaque phrase figeait le
// simulateur (et retardait la suite du message) pendant 1 à 5 s. Reçoit { id, type: 'synth', model, base, text,
// speaker, lengthScale } et renvoie { id, type: 'audio', samples, sampleRate } ; { type: 'load' } prépare un modèle
// à l'avance ; { type: 'progress' } suit le téléchargement.

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js';
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
const PHONEMIZER_URL = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js';
const PHONEMIZER_FILES = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const CACHE_NAME = 'esme-voix-radio-v1';

const models = new Map();      // modèle -> Promise<{ session, config }>
let ortPromise = null;
let phonemizerPromise = null;
let chain = Promise.resolve(); // un calcul à la fois

self.onmessage = ({ data }) => {
    chain = chain.then(() => handle(data)).catch(() => {});
};

async function handle(data) {
    const { id, type } = data;
    try {
        if (type === 'load') {
            await load(data.model, data.base);
            self.postMessage({ id, type: 'loaded' });
        } else if (type === 'synth') {
            const { samples, sampleRate } = await synthesize(data);
            self.postMessage({ id, type: 'audio', samples, sampleRate }, [samples.buffer]);
        }
    } catch (error) {
        self.postMessage({ id, type: 'error', message: String(error?.message ?? error) });
    }
}

function ort() {
    ortPromise ??= import(ORT_URL).then((module) => {
        module.env.wasm.wasmPaths = ORT_WASM;
        module.env.wasm.numThreads = 1;
        return module;
    });
    return ortPromise;
}

function load(model, base) {
    if (!models.has(model)) {
        const promise = (async () => {
            const config = JSON.parse(new TextDecoder().decode(await fetchCached(`${base}.onnx.json`)));
            const bytes = await fetchCached(`${base}.onnx`, (loaded, total) => self.postMessage({ type: 'progress', model, loaded, total }));
            const runtime = await ort();
            const session = await runtime.InferenceSession.create(bytes);
            return { session, config, runtime };
        })();
        promise.catch(() => models.delete(model));   // nouvel essai plus tard
        models.set(model, promise);
    }
    return models.get(model);
}

// Téléchargement gardé dans le cache du navigateur (une seule fois)
async function fetchCached(url, onProgress = null) {
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
async function phonemize(text, voice) {
    phonemizerPromise ??= (async () => {
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
    const { module, state } = await phonemizerPromise;
    state.ids = null;
    module.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
    if (!state.ids) throw new Error('phonèmes introuvables');
    return state.ids;
}

// Phrase par phrase (bon rythme, pauses aux points), silences retirés, même niveau pour toutes les voix
async function synthesize({ model, base, text, speaker = 0, lengthScale = 1 }) {
    const { session, config, runtime } = await load(model, base);
    const sampleRate = config.audio.sample_rate;
    const parts = [];
    for (const sentence of text.split(/(?<=[.!?])\s+/).filter((s) => s.trim())) {
        const ids = await phonemize(sentence.trim(), config.espeak.voice);
        const inputs = {
            input: new runtime.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
            input_lengths: new runtime.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
            scales: new runtime.Tensor('float32', Float32Array.from([config.inference.noise_scale,
                config.inference.length_scale * lengthScale, config.inference.noise_w]), [3]),
        };
        if (config.num_speakers > 1) inputs.sid = new runtime.Tensor('int64', BigInt64Array.from([BigInt(speaker)]), [1]);
        const { output } = await session.run(inputs);
        parts.push(trim(output.data, sampleRate));
        parts.push(new Float32Array(Math.round(sampleRate * 0.15)));   // pause entre les phrases
    }
    const samples = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        samples.set(part, offset);
        offset += part.length;
    }
    let peak = 0;
    for (const x of samples) peak = Math.max(peak, Math.abs(x));
    if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] *= 0.9 / peak;
    return { samples, sampleRate };
}

// Silences du début et de la fin retirés (garde 40 ms)
function trim(data, sampleRate) {
    let peak = 0;
    for (const x of data) peak = Math.max(peak, Math.abs(x));
    const threshold = peak * 0.02, margin = Math.round(sampleRate * 0.04);
    let start = 0, end = data.length;
    while (start < end && Math.abs(data[start]) < threshold) start++;
    while (end > start && Math.abs(data[end - 1]) < threshold) end--;
    return data.slice(Math.max(0, start - margin), Math.min(data.length, end + margin));
}
