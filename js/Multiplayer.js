// Multijoueur par un relais MQTT public (WebSocket sécurisé) : chaque joueur publie son état
// plusieurs fois par seconde sur le "sujet" de la partie et reçoit celui des autres joueurs.
// Aucun serveur à déployer : fonctionne depuis GitHub Pages ou n'importe quel hébergement statique.
// Attention : le relais est public, les positions et pseudos des joueurs ne sont pas confidentiels.
import mqtt from 'mqtt';

// Relais essayés dans l'ordre (le suivant si le précédent ne répond pas)
const BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
];
const TOPIC_PREFIX = 'esme-fs/v1';  // sujets : esme-fs/v1/<CODE>/<id joueur>

const MIN_INTERVAL = 150;       // au plus ~7 messages par seconde (ms)
const JOIN_TIMEOUT = 6000;      // sans nouvelles d'un joueur, la partie n'existe pas (ms)
const STALE = 6000;             // un joueur silencieux depuis 6 s est retiré (ms)
const MAX_PLAYERS = 16;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-Z2-9]{6}$/;
const ID_PATTERN = /^[a-z0-9]{8,32}$/;

function randomString(chars, length) {
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

function numbers(value, length) {
    return Array.isArray(value) && value.length === length && value.every(Number.isFinite) ? value : null;
}

// N'accepte que des champs attendus, avec des valeurs valides (les messages viennent d'un relais public)
function cleanState(state) {
    const p = numbers(state?.p, 3), q = numbers(state?.q, 4), v = numbers(state?.v, 3);
    if (!p || !q || !v) return null;
    return {
        name: String(state.name ?? 'Pilote').slice(0, 20),
        p, q, v,
        t: Math.min(1, Math.max(0, Number(state.t) || 0)),
    };
}

// Connexion à un relais ; échoue s'il ne répond pas
function connectTo(url) {
    return new Promise((resolve, reject) => {
        const client = mqtt.connect(url, { connectTimeout: 5000, reconnectPeriod: 0, clean: true });
        const fail = () => {
            client.end(true);
            reject(new Error(`Relais injoignable : ${url}`));
        };
        client.once('error', fail);
        client.once('close', fail);
        client.once('connect', () => {
            client.removeListener('error', fail);
            client.removeListener('close', fail);
            client.options.reconnectPeriod = 2000; // reconnexion automatique une fois connecté
            resolve(client);
        });
    });
}

class Multiplayer extends EventTarget {
    constructor() {
        super();
        this.id = randomString('abcdefghijklmnopqrstuvwxyz0123456789', 16);
        this.name = 'Pilote';
        this.code = null;
        this.players = new Map();     // id -> { name, p, q, v, t, age, receivedAt } (sans le joueur local)
        this.latency = 0.1;           // délai d'un message (s), ajouté à la prédiction des mouvements
        this._client = null;
        this._connecting = null;
        this._joined = false;
        this._joinTimer = 0;
        this._counting = false;
        this._lastSend = 0;
        this._lastPurge = 0;
        this._lastPosition = null;
        this._velocity = [0, 0, 0];
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
        this._joined = false;
        this._status(create ? 'Création de la partie…' : `Connexion à la partie ${code}…`);

        this._ensureClient().then((client) => {
            if (this.code !== code) return;
            client.subscribe(`${TOPIC_PREFIX}/${code}/+`, { qos: 0 }, (error) => {
                if (this.code !== code) return;
                if (error) return this._fail('Serveur multijoueur injoignable');
                if (create) return this._confirmJoin();
                // Rejoindre : la partie existe si l'on reçoit des nouvelles d'un de ses joueurs
                this._joinTimer = setTimeout(() => {
                    if (this.code === code && !this._joined) this._fail(`Aucune partie avec le code ${code}`);
                }, JOIN_TIMEOUT);
            });
        }).catch(() => {
            if (this.code === code) this._fail('Serveur multijoueur injoignable (vérifiez la connexion internet)');
        });
    }

    leave() {
        if (!this.code) return;
        const code = this.code;
        if (this._joined) this._publish(code, { leave: true });
        this._client?.unsubscribe(`${TOPIC_PREFIX}/${code}/+`);
        clearTimeout(this._joinTimer);
        this._counting = false;
        this.code = null;
        this._joined = false;
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

        if (this._joined && now - this._lastSend >= MIN_INTERVAL) {
            this._lastSend = now;
            this._publish(this.code, {
                name: this.name,
                p: object.position.toArray().map(round),
                q: object.quaternion.toArray().map(round),
                v: this._velocity.map(round),
                t: round(throttle),
                sent: Math.round(now),
            });
        }

        // Joueurs partis sans prévenir
        if (now - this._lastPurge > 1000) {
            this._lastPurge = now;
            let changed = false;
            for (const [id, player] of this.players) {
                if (now - player.receivedAt > STALE) {
                    this.players.delete(id);
                    changed = true;
                }
            }
            if (changed) this._emitPlayers();
        }
    }

    // private

    _ensureClient() {
        if (this._client) return Promise.resolve(this._client);
        this._connecting ??= (async () => {
            for (const url of BROKERS) {
                try {
                    const client = await connectTo(url);
                    client.on('message', (topic, payload) => this._onMessage(topic, payload));
                    client.on('offline', () => { if (this.code) this._status('Connexion perdue, reconnexion…', true); });
                    client.on('connect', () => {
                        // Reconnexion : on se réabonne à la partie en cours
                        if (!this.code) return;
                        client.subscribe(`${TOPIC_PREFIX}/${this.code}/+`, { qos: 0 });
                        if (this._joined) this._status(`Partie privée ${this.code} : partagez le code ou le lien`);
                    });
                    this._client = client;
                    return client;
                } catch { /* relais suivant */ }
            }
            this._connecting = null;
            throw new Error('Aucun relais joignable');
        })();
        return this._connecting;
    }

    _publish(code, message) {
        if (this._client?.connected) this._client.publish(`${TOPIC_PREFIX}/${code}/${this.id}`, JSON.stringify(message), { qos: 0 });
    }

    _onMessage(topic, payload) {
        const [, , code, id] = topic.split('/');
        if (code !== this.code || !ID_PATTERN.test(id)) return;
        let data;
        try {
            data = JSON.parse(payload.toString());
        } catch {
            return;
        }
        const now = performance.now();

        // Notre propre message, renvoyé par le relais : mesure du délai
        if (id === this.id) {
            if (Number.isFinite(data.sent)) this.latency += ((now - data.sent) / 2000 - this.latency) * 0.2;
            return;
        }
        if (data.leave) {
            if (this.players.delete(id)) this._emitPlayers();
            return;
        }
        const state = cleanState(data);
        if (!state) return;

        const isNew = !this.players.has(id);
        this.players.set(id, { ...state, age: 0, receivedAt: now });
        if (isNew) this._emitPlayers();

        // Rejoindre : la partie existe ; on laisse arriver les autres joueurs avant de vérifier qu'il reste de la place
        if (!this._joined && !this._counting) {
            this._counting = true;
            clearTimeout(this._joinTimer);
            this._joinTimer = setTimeout(() => {
                this._counting = false;
                if (this.code !== code) return;
                if (this.players.size >= MAX_PLAYERS) this._fail(`La partie ${code} est complète`);
                else this._confirmJoin();
            }, 800);
        }
    }

    _confirmJoin() {
        clearTimeout(this._joinTimer);
        this._joined = true;
        this._status(`Partie privée ${this.code} : partagez le code ou le lien`);
    }

    _fail(text) {
        this.leave();
        this._status(text, true);
    }

    _emitPlayers() {
        this.dispatchEvent(new CustomEvent('players', { detail: [...this.players.keys()] }));
    }

    _status(text, error = false) {
        this.dispatchEvent(new CustomEvent('status', { detail: { text, error } }));
    }
}

export { Multiplayer };
