// Carnet de vols (lot 5) : les 20 derniers vols enregistrés (FlightRecorder.js), dans IndexedDB du navigateur. Aucun envoi
// réseau. Deux magasins : 'resumes' (métadonnées, pour la liste) et 'vols' (le vol complet), même clé. Sans IndexedDB
// (navigation privée stricte, Node) : carnet en mémoire, perdu à la fermeture.

export const MAX_FLIGHTS = 20;
const DB_NAME = 'esme-vols';
const DB_VERSION = 1;

// Résumé d'un vol pour la liste : métadonnées et quelques chiffres
export function summary(id, flight) {
    const { meta, samples, events } = flight;
    const maxAlt = samples.reduce((m, s) => Math.max(m, s.alt ?? -Infinity), -Infinity);
    return {
        id, started: meta.started, aircraft: meta.aircraft ?? '', airport: meta.airport ?? '', lesson: meta.lesson ?? '',
        duration: meta.duration ?? samples[samples.length - 1]?.t ?? 0, maxAlt: Number.isFinite(maxAlt) ? maxAlt : 0,
        crashed: events.some((e) => e.kind === 'crash'), imported: Boolean(meta.imported),
    };
}

// Carnet en mémoire : même interface que le carnet IndexedDB
class MemoryBackend {
    constructor() { this.flights = new Map(); this.next = 1; }
    async put(flight) { const id = this.next++; this.flights.set(id, flight); return id; }
    async get(id) { return this.flights.get(id) ?? null; }
    async list() { return [...this.flights.entries()].map(([id, f]) => summary(id, f)); }
    async remove(id) { this.flights.delete(id); }
}

class IndexedDbBackend {
    constructor(indexedDB) {
        this._db = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('resumes')) db.createObjectStore('resumes', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('vols')) db.createObjectStore('vols');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async _tx(stores, mode, body) {
        const db = await this._db;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(stores, mode);
            let result;
            Promise.resolve(body(tx, (value) => { result = value; })).catch(reject);
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    async put(flight) {
        return this._tx([ 'resumes', 'vols' ], 'readwrite', (tx, done) => {
            const request = tx.objectStore('resumes').add({ started: flight.meta.started });
            request.onsuccess = () => {
                const id = request.result;
                tx.objectStore('resumes').put(summary(id, flight));
                tx.objectStore('vols').put(flight, id);
                done(id);
            };
        });
    }
    async get(id) {
        return this._tx([ 'vols' ], 'readonly', (tx, done) => {
            const request = tx.objectStore('vols').get(id);
            request.onsuccess = () => done(request.result ?? null);
        });
    }
    async list() {
        return this._tx([ 'resumes' ], 'readonly', (tx, done) => {
            const request = tx.objectStore('resumes').getAll();
            request.onsuccess = () => done(request.result ?? []);
        });
    }
    async remove(id) {
        return this._tx([ 'resumes', 'vols' ], 'readwrite', (tx) => {
            tx.objectStore('resumes').delete(id);
            tx.objectStore('vols').delete(id);
        });
    }
}

export class FlightStore {
    // indexedDB : celui du navigateur (globalThis.indexedDB) ; null : carnet en mémoire
    constructor(indexedDB = globalThis.indexedDB ?? null) {
        let backend;
        try { backend = indexedDB ? new IndexedDbBackend(indexedDB) : null; } catch { backend = null; }
        this.backend = backend ?? new MemoryBackend();
        this._fallback = !backend;
    }
    async _call(method, ...args) {
        try { return await this.backend[method](...args); }
        catch {
            // IndexedDB refusé (quota, navigation privée) : on bascule en mémoire pour la suite de la partie
            if (this._fallback) throw new Error('Carnet de vols indisponible');
            this.backend = new MemoryBackend();
            this._fallback = true;
            return this.backend[method](...args);
        }
    }
    // Enregistre un vol et ne garde que les 20 derniers ; rend son identifiant
    async save(flight) {
        const id = await this._call('put', flight);
        const all = (await this._call('list')).sort((a, b) => b.id - a.id);
        for (const old of all.slice(MAX_FLIGHTS)) await this._call('remove', old.id);
        return id;
    }
    async load(id) { return this._call('get', id); }
    // Vols du plus récent au plus ancien
    async list() { return (await this._call('list')).sort((a, b) => b.id - a.id); }
    async remove(id) { return this._call('remove', id); }
}
