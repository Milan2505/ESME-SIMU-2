// Multijoueur par le serveur Netlify (netlify/functions/room.mjs) : chaque joueur envoie son état
// en HTTP plusieurs fois par seconde et reçoit en réponse celui des autres joueurs de la partie.
// Pas de connexion directe entre joueurs : aucun problème de NAT / pare-feu.

// Vide = le serveur est sur le même site (site déployé sur Netlify).
// Si le site est servi ailleurs (GitHub Pages…), mettre l'adresse du site Netlify, ex. 'https://esme-fs.netlify.app'
const SERVER_URL = '';
const ENDPOINT = `${SERVER_URL}/api/room`;

const MIN_INTERVAL = 200;       // au plus 5 requêtes par seconde (ms)
const MAX_FAILURES = 5;         // erreurs réseau d'affilée avant d'abandonner
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-Z2-9]{6}$/;

function randomString(chars, length) {
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

class Multiplayer extends EventTarget {
    constructor() {
        super();
        this.id = randomString('abcdefghijklmnopqrstuvwxyz0123456789', 16);
        this.name = 'Pilote';
        this.code = null;
        this.players = new Map();     // id -> { name, p, q, v, t, age, receivedAt } (sans le joueur local)
        this._create = false;
        this._joined = false;
        this._busy = false;
        this._failures = 0;
        this._lastSend = 0;
        this._lastPosition = null;
        this._velocity = [0, 0, 0];
        this._localState = null;
        this.latency = 0.15;          // aller-retour réseau mesuré (s), ajouté à la prédiction des mouvements
    }

    // Lien direct vers la partie, à partager
    get link() {
        return this.code ? `${location.origin}${location.pathname}?partie=${this.code}` : '';
    }

    // Crée une partie privée et renvoie son code
    create(name) {
        this.join(randomString(CODE_CHARS, 6), name, true);
        return this.code;
    }

    join(code, name, create = false) {
        this.leave();
        code = String(code).trim().toUpperCase();
        if (!CODE_PATTERN.test(code)) return this._status('Code invalide (6 caractères)', true);

        this.name = name || this.name;
        this.code = code;
        this._create = create;
        this._joined = false;
        this._failures = 0;
        this._status(create ? 'Création de la partie…' : `Connexion à la partie ${code}…`);
    }

    leave() {
        if (!this.code) return;
        this._sendLeave(this.code);
        this.code = null;
        this.players.clear();
        this._emitPlayers();
        this._status('Hors ligne');
    }

    // À appeler à chaque image avec l'objet piloté et la position des gaz
    update(object, throttle) {
        if (!this.code) return;
        const now = performance.now();

        // Vitesse (m/s), utilisée par les autres joueurs pour prédire nos mouvements entre deux messages
        if (this._lastPosition) {
            const dt = (now - this._lastPosition.time) / 1000;
            if (dt > 0) {
                const p = object.position;
                const target = [p.x - this._lastPosition.x, p.y - this._lastPosition.y, p.z - this._lastPosition.z].map((d) => d / dt);
                const k = Math.min(1, dt * 5);
                this._velocity = this._velocity.map((v, i) => v + (target[i] - v) * k);
            }
        }
        this._lastPosition = { x: object.position.x, y: object.position.y, z: object.position.z, time: now };

        this._localState = {
            name: this.name,
            p: object.position.toArray().map(round),
            q: object.quaternion.toArray().map(round),
            v: this._velocity.map(round),
            t: round(throttle),
        };

        if (!this._busy && now - this._lastSend >= MIN_INTERVAL) this._sync();
    }

    // private

    // Prévient le serveur, même si la page est en train de se fermer
    _sendLeave(code) {
        const body = JSON.stringify({ room: code, id: this.id, leave: true });
        try { navigator.sendBeacon(ENDPOINT, body); } catch { /* le serveur nous retirera après 6 s */ }
    }

    async _sync() {
        this._busy = true;
        this._lastSend = performance.now();
        const code = this.code;
        try {
            const response = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room: code, id: this.id, create: this._create, state: this._localState }),
            });
            if (code !== this.code) {
                // Partie quittée pendant la requête : celle-ci nous a ré-inscrits, on se retire à nouveau
                if (response.ok) this._sendLeave(code);
                return;
            }
            const rtt = (performance.now() - this._lastSend) / 1000;
            this.latency += (rtt - this.latency) * 0.2;
            const data = await response.json().catch(() => null);

            if (!data) {
                // Réponse non JSON : pas de serveur multijoueur à cette adresse (ex. serveur Python local)
                this.code = null;
                return this._status('Serveur multijoueur indisponible : le site doit être déployé sur Netlify (voir README)', true);
            }
            if (!response.ok) {
                const messages = {
                    'not-found': `Aucune partie avec le code ${code}`,
                    'full': `La partie ${code} est complète`,
                };
                this.code = null;
                return this._status(messages[data.error] ?? `Erreur du serveur (${data.error ?? response.status})`, true);
            }

            this._failures = 0;
            if (!this._joined) {
                this._joined = true;
                this._create = false; // la partie existe maintenant
                this._status(`Partie privée ${code} : partagez le code ou le lien`);
            }
            this._setPlayers(data.players ?? []);
        } catch {
            if (code === this.code && ++this._failures >= MAX_FAILURES) {
                this.code = null;
                this.players.clear();
                this._emitPlayers();
                this._status('Serveur multijoueur injoignable', true);
            }
        } finally {
            this._busy = false;
        }
    }

    _setPlayers(list) {
        const receivedAt = performance.now();
        const ids = new Set(list.map((player) => player.id));
        let changed = list.some((player) => !this.players.has(player.id));

        for (const id of this.players.keys()) {
            if (!ids.has(id)) {
                this.players.delete(id);
                changed = true;
            }
        }
        for (const { id, name, p, q, v, t, age } of list) {
            this.players.set(id, { name, p, q, v, t, age, receivedAt });
        }
        if (changed) this._emitPlayers();
    }

    _emitPlayers() {
        this.dispatchEvent(new CustomEvent('players', { detail: [...this.players.keys()] }));
    }

    _status(text, error = false) {
        this.dispatchEvent(new CustomEvent('status', { detail: { text, error } }));
    }
}

export { Multiplayer };
