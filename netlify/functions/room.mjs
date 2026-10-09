// Serveur multijoueur (Netlify Function) : relais HTTP des positions des joueurs.
// Chaque joueur envoie régulièrement son état et reçoit celui des autres joueurs de la partie.
// Les états sont stockés dans Netlify Blobs, une entrée par joueur : rooms/<CODE>/<id>.
import { getStore } from '@netlify/blobs';

const STALE = 6000;                       // un joueur silencieux depuis 6 s est retiré (ms)
const ROOM_PATTERN = /^[A-Z2-9]{6}$/;
const ID_PATTERN = /^[a-z0-9]{8,32}$/;
const MAX_PLAYERS = 16;

const HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    // Permet d'appeler le serveur depuis une autre adresse (ex. le site GitHub Pages)
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function reply(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function numbers(value, length) {
    return Array.isArray(value) && value.length === length && value.every(Number.isFinite) ? value : null;
}

// N'enregistre que des champs attendus, avec des valeurs valides
function cleanState(state) {
    const p = numbers(state?.p, 3), q = numbers(state?.q, 4), v = numbers(state?.v, 3);
    if (!p || !q || !v) return null;
    return {
        name: String(state.name ?? 'Pilote').slice(0, 20),
        p, q, v,
        t: Math.min(1, Math.max(0, Number(state.t) || 0)),
    };
}

export default async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== 'POST') return reply({ error: 'method-not-allowed' }, 405);

    let body;
    try {
        body = await request.json();
    } catch {
        return reply({ error: 'bad-request' }, 400);
    }
    const { room, id, create = false, leave = false } = body ?? {};
    if (!ROOM_PATTERN.test(room) || !ID_PATTERN.test(id)) return reply({ error: 'bad-request' }, 400);

    const store = getStore({ name: 'rooms', consistency: 'strong' });
    const prefix = `${room}/`;
    const now = Date.now();

    if (leave) {
        await store.delete(prefix + id);
        return reply({ ok: true });
    }

    const state = cleanState(body.state);
    if (!state) return reply({ error: 'bad-request' }, 400);

    const { blobs } = await store.list({ prefix });
    const others = blobs.filter((blob) => blob.key !== prefix + id);
    // On ne peut rejoindre qu'une partie existante (créée par un autre joueur avec "Créer une partie")
    if (!create && blobs.length === 0) return reply({ error: 'not-found' }, 404);
    if (others.length >= MAX_PLAYERS) return reply({ error: 'full' }, 403);

    const [, ...entries] = await Promise.all([
        store.setJSON(prefix + id, { ...state, at: now }),
        ...others.map((blob) => store.get(blob.key, { type: 'json' }).then((value) => [blob.key, value])),
    ]);

    const players = [];
    for (const [key, value] of entries) {
        if (!value || now - value.at > STALE) {
            await store.delete(key); // joueur parti sans prévenir
            continue;
        }
        players.push({ id: key.slice(prefix.length), ...value, age: now - value.at });
    }
    return reply({ players });
};

export const config = { path: '/api/room' };
