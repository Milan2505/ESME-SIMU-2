// Multijoueur par des relais MQTT publics (WebSocket sécurisé) : chaque joueur publie son état
// plusieurs fois par seconde sur le "sujet" de la partie et reçoit celui des autres joueurs.
// Aucun serveur à déployer : fonctionne depuis GitHub Pages ou n'importe quel hébergement statique.
// Attention : les relais sont publics, les positions et pseudos des joueurs ne sont pas confidentiels.
//
// Robustesse :
// - on se connecte à tous les relais à la fois et on publie sur chacun : deux joueurs se retrouvent
//   même si l'un d'eux n'arrive pas à joindre un relais (les messages reçus en double sont ignorés) ;
// - une "pulsation" envoie notre état chaque seconde même si l'onglet est en arrière-plan
//   (le navigateur y suspend l'animation, donc update()) ;
// - en rejoignant, on dit "bonjour" : les joueurs présents répondent aussitôt avec leur état.
//
// Radio : la voix passe par les mêmes relais, en petits paquets (voir Radio.js).
import mqtt from 'mqtt';
import { DEFAULT_LIVERY, isLivery } from './Liveries.js';

const BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
];
const TOPIC_PREFIX = 'esme-fs/v2';  // sujets : esme-fs/v2/<CODE>/<id joueur>

const MIN_INTERVAL = 150;       // au plus ~7 messages par seconde (ms)
const HEARTBEAT = 1000;         // état renvoyé au moins chaque seconde, même onglet en arrière-plan (ms)
const HELLO_REPEAT = 1500;      // en rejoignant, "bonjour" répété tant que personne n'a répondu (ms)
const JOIN_TIMEOUT = 8000;      // sans réponse d'aucun joueur, la partie n'existe pas (ms)
const STALE = 8000;             // un joueur silencieux depuis 8 s est retiré (ms)
const MAX_PLAYERS = 16;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-Z2-9]{6}$/;
const ID_PATTERN = /^[a-z0-9]{8,32}$/;
const MAX_VOICE = 4000;         // taille max d'un paquet de voix (caractères base64, ~0,3 s de son)

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
        livery: isLivery(state.c) ? state.c : DEFAULT_LIVERY,
        crashes: Math.max(0, Math.floor(Number(state.x) || 0)),   // nombre de crashs depuis l'arrivée du joueur
        crashed: state.k === 1,                                    // épave en cours (avion masqué)
    };
}

class Multiplayer extends EventTarget {
    constructor() {
        super();
        this.id = randomString('abcdefghijklmnopqrstuvwxyz0123456789', 16);
        this.name = 'Pilote';
        this.livery = DEFAULT_LIVERY;
        this.code = null;
        this.players = new Map();     // id -> { name, p, q, v, t, livery, crashes, crashed, receivedAt } (sans le joueur local)
        this.latency = 0.1;           // délai d'un message (s), ajouté à la prédiction des mouvements
        this._clients = [];           // connexions aux relais (connectées ou en cours de reconnexion)
        this._connecting = null;
        this._joined = false;
        this._joinTimer = 0;
        this._helloTimer = 0;
        this._counting = false;
        this._seq = 0;                // numéro de nos messages (pour ignorer les doublons chez les autres)
        this._lastSeq = new Map();    // id joueur -> dernier numéro de message reçu
        this._lastSend = 0;
        this._lastReply = 0;
        this._lastPosition = null;
        this._velocity = [0, 0, 0];
        this._state = null;           // dernier état local, renvoyé par la pulsation

        setInterval(() => this._heartbeat(), HEARTBEAT / 2);
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

        this._connect().then(() => {
            if (this.code !== code) return;
            for (const client of this._clients) client.subscribe(this._topic(code), { qos: 0 });
            if (create) return this._confirmJoin();
            // Rejoindre : on s'annonce ; la partie existe si un de ses joueurs répond
            const hello = () => {
                if (this.code !== code || this._joined) return;
                this._publish({ hello: true, name: this.name });
                this._helloTimer = setTimeout(hello, HELLO_REPEAT);
            };
            hello();
            this._joinTimer = setTimeout(() => {
                if (this.code === code && !this._joined) this._fail(`Aucune partie avec le code ${code} (vérifiez le code, et que le créateur est toujours en ligne)`);
            }, JOIN_TIMEOUT);
        }).catch(() => {
            if (this.code === code) this._fail('Serveur multijoueur injoignable (vérifiez la connexion internet)');
        });
    }

    leave() {
        if (!this.code) return;
        if (this._joined) this._publish({ leave: true });
        for (const client of this._clients) client.unsubscribe(this._topic(this.code));
        clearTimeout(this._joinTimer);
        clearTimeout(this._helloTimer);
        this._counting = false;
        this.code = null;
        this._joined = false;
        this.players.clear();
        this._lastSeq.clear();
        this._emitPlayers();
        this._status('Hors ligne');
    }

    // À appeler à chaque image avec l'objet piloté, la position des gaz et l'état de crash
    update(object, throttle, { crashed = false, crashes = 0 } = {}) {
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

        this._state = {
            name: this.name,
            p: object.position.toArray().map(round),
            q: object.quaternion.toArray().map(round),
            v: this._velocity.map(round),
            t: round(throttle),
            c: this.livery,
            x: crashes,
            k: crashed ? 1 : 0,
        };
        if (this._joined && now - this._lastSend >= MIN_INTERVAL) this._sendState();
    }

    // Paquet de voix de la radio (texte base64) ; part tout de suite, sans attendre l'état
    sendVoice(data, end = false) {
        if (this._joined) this._publish({ voice: data, end });
    }

    // private

    _topic(code) {
        return `${TOPIC_PREFIX}/${code}/+`;
    }

    // Connexion à tous les relais en parallèle ; prêt dès que l'un d'eux répond
    _connect() {
        if (this._clients.some((client) => client.connected)) return Promise.resolve();
        this._connecting ??= new Promise((resolve, reject) => {
            let failures = 0;
            for (const url of BROKERS) {
                const client = mqtt.connect(url, { connectTimeout: 6000, reconnectPeriod: 3000, clean: true });
                let everConnected = false;
                client.on('connect', () => {
                    everConnected = true;
                    // (Re)connexion : abonnement à la partie en cours
                    if (this.code) client.subscribe(this._topic(this.code), { qos: 0 });
                    resolve();
                });
                client.on('message', (topic, payload) => this._onMessage(topic, payload));
                client.on('error', () => {
                    // Relais injoignable dès le départ : on l'abandonne
                    if (everConnected) return;
                    client.end(true);
                    this._clients = this._clients.filter((c) => c !== client);
                    if (++failures === BROKERS.length) {
                        this._connecting = null;
                        reject(new Error('Aucun relais joignable'));
                    }
                });
                this._clients.push(client);
            }
        });
        return this._connecting;
    }

    _publish(message) {
        if (!this.code) return;
        const payload = JSON.stringify({ ...message, n: ++this._seq, sent: Math.round(performance.now()) });
        const topic = `${TOPIC_PREFIX}/${this.code}/${this.id}`;
        for (const client of this._clients) {
            if (client.connected) client.publish(topic, payload, { qos: 0 });
        }
    }

    _sendState() {
        if (!this._state) return;
        this._lastSend = performance.now();
        this._publish(this._state);
    }

    // Toutes les 0,5 s, même onglet en arrière-plan : renvoie l'état s'il n'est pas parti depuis 1 s,
    // et retire les joueurs partis sans prévenir
    _heartbeat() {
        if (!this.code) return;
        const now = performance.now();
        if (this._joined && now - this._lastSend >= HEARTBEAT) this._sendState();
        let changed = false;
        for (const [id, player] of this.players) {
            if (now - player.receivedAt > STALE) {
                this.players.delete(id);
                changed = true;
            }
        }
        if (changed) this._emitPlayers();
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

        // Le même message arrive par chaque relais : on ne le traite qu'une fois
        if (Number.isFinite(data.n)) {
            if (data.n <= (this._lastSeq.get(id) ?? 0)) return;
            this._lastSeq.set(id, data.n);
        }

        // Notre propre message, renvoyé par le relais : mesure du délai
        if (id === this.id) {
            if (Number.isFinite(data.sent)) this.latency += ((now - data.sent) / 2000 - this.latency) * 0.2;
            return;
        }
        if (data.leave) {
            this._lastSeq.delete(id);
            if (this.players.delete(id)) this._emitPlayers();
            return;
        }
        // Un joueur arrive : on lui répond tout de suite avec notre état (sans attendre la prochaine image)
        if (data.hello) {
            if (this._joined && now - this._lastReply > 300) {
                this._lastReply = now;
                this._sendState();
            }
            return;
        }
        // Radio : paquet de voix d'un joueur de la partie
        if (typeof data.voice === 'string') {
            if (this.players.has(id) && data.voice.length <= MAX_VOICE) {
                this.dispatchEvent(new CustomEvent('voice', { detail: { id, data: data.voice, end: data.end === true } }));
            }
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
            clearTimeout(this._helloTimer);
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
        clearTimeout(this._helloTimer);
        this._joined = true;
        this._counting = false;
        this._sendState();
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
