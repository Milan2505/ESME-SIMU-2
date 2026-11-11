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
import { isF15Livery } from './F15Model.js';

const BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
];
const TOPIC_PREFIX = 'esme-fs/v2';  // sujets : esme-fs/v2/<CODE>/<id joueur>
// Salon : chaque partie s'y annonce (créateur, nombre et pseudos des joueurs), sans son code. La fenêtre Multijoueur
// affiche ces annonces (« Parties en cours ») ; pour rejoindre, il faut toujours taper le code
const LOBBY_PREFIX = `${TOPIC_PREFIX}/salon`;   // sujets : esme-fs/v2/salon/<id du créateur>
const LOBBY_EVERY = 2000;       // annonce renvoyée toutes les 2 s (ms)
const LOBBY_STALE = 7000;       // partie retirée de la liste sans annonce depuis 7 s (ms)

const MIN_INTERVAL = 150;       // au plus ~7 messages par seconde (ms)
const HEARTBEAT = 1000;         // état renvoyé au moins chaque seconde, même onglet en arrière-plan (ms)
const HELLO_REPEAT = 1500;      // en rejoignant, "bonjour" répété tant que personne n'a répondu (ms)
const JOIN_TIMEOUT = 15000;     // sans réponse d'aucun joueur, la partie n'existe pas (ms) ; avant 8 s : un créateur sur son
                                // écran de chargement (page occupée plusieurs secondes) ne répondait pas à temps
const STALE = 8000;             // un joueur silencieux depuis 8 s est retiré (ms)
const MAX_PLAYERS = 16;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-Z2-9]{6}$/;
const ID_PATTERN = /^[a-z0-9]{8,32}$/;
const MAX_VOICE = 4000;         // taille max d'un paquet de voix (caractères base64, ~0,3 s de son)
const MAX_CHAT = 200;           // taille max d'un message du tchat (caractères)
const MESSAGE_KINDS = ['hello', 'leave', 'close', 'voice', 'chat', 'hit', 'missile', 'aam', 'flr', 'kill', 'atc'];
const SLOW_MESSAGE = 30;        // ms : message lent à traiter, noté (voir slowMessages)

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
function lightsFromBits(bits) {
    return { land: (bits & 1) !== 0, nav: (bits & 2) !== 0, beacon: (bits & 4) !== 0, strobe: (bits & 8) !== 0 };
}

// Immatriculation choisie par un joueur : lettres, chiffres et tirets, 4 à 8 caractères (F-GABC, N172SP…) ; '' si invalide
function cleanRegistration(text) {
    const r = String(text ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8);
    return /^[A-Z0-9][A-Z0-9-]{2,6}[A-Z0-9]$/.test(r) ? r : '';
}

function jetState(j) {
    const v = numbers(j, 5)?.map((x) => Math.min(1, Math.max(0, x))) ?? [1, 0, 0, 0, 0];
    return { gear: v[0], speedbrake: v[1], flaps: v[2], ab: v[3], canopy: v[4] };
}

function cleanState(state) {
    const p = numbers(state?.p, 3), q = numbers(state?.q, 4), v = numbers(state?.v, 3);
    if (!p || !q || !v) return null;
    return {
        name: String(state.name ?? 'Pilote').slice(0, 20),
        p, q, v,
        t: Math.min(1, Math.max(0, Number(state.t) || 0)),
        // Régime du moteur (tr/min) ; absent (ancienne version du jeu) : null, déduit des gaz
        rpm: Number.isFinite(state.r) ? Math.min(3000, Math.max(0, state.r)) : null,
        weather: typeof state.w === 'string' ? state.w.slice(0, 20) : null,
        // Avion : Cessna 172 (absent : ancienne version du jeu) ou F-15 ; F-15 : train, aérofrein, volets,
        // postcombustion, verrière (0 -> 1)
        aircraft: state.a === 'f15' ? 'f15' : 'c172',
        jet: state.a === 'f15' ? jetState(state.j) : null,
        livery: isLivery(state.c) || (state.a === 'f15' && isF15Livery(state.c)) ? state.c : DEFAULT_LIVERY,
        registration: cleanRegistration(state.g),                  // '' : celle tirée de son identifiant
        crashes: Math.max(0, Math.floor(Number(state.x) || 0)),   // nombre de crashs depuis l'arrivée du joueur
        crashed: state.k === 1,                                    // épave en cours (avion masqué)
        // Nombre d'apparitions (départ choisi, touche R, retour après un crash) ; absent (ancienne version) : null
        spawns: Number.isFinite(state.s) ? Math.max(0, Math.floor(state.s)) : null,
        away: state.h === 1,                                       // page du simulateur cachée (hors ligne)
        owner: state.o === 1,                                      // créateur de la partie (lui seul peut la fermer)
        // Feux allumés (bits : 1 phare, 2 navigation, 4 anticollision, 8 strobes) ; absent : tous sauf le phare
        lights: lightsFromBits(Number.isInteger(state.l) ? state.l : 14),
        // Combat (F-15) : canon qui tire, dégâts (0 -> 100 %), feu à bord
        firing: state.f === 1,
        damage: Math.min(100, Math.max(0, Number(state.d) || 0)),
        burning: state.fi === 1,
        // Autodirecteur : joueur que celui-ci accroche (lk), verrouillé (lkd) — alerte radar chez la cible
        lockOn: typeof state.lk === 'string' && ID_PATTERN.test(state.lk) ? state.lk : null,
        lockOnLocked: state.lkd === 1,
        // Score de la partie (compté par le joueur lui-même, voir Multiplayer.score) : avions abattus, fois abattu
        score: scoreFrom(state.sc),
        // Mode de la partie (celui du créateur fait foi), équipe (Wardog), capture des terrains (arbitre seulement)
        mode: state.m === 'w' ? 'wardog' : 'libre',
        team: teamFrom(state.tm),
        capture: captureFrom(state.cp),
    };
}

// Mode Wardog : deux équipes (bleue, rouge), TEAM_MAX joueurs chacune. Équipe envoyée par chaque joueur ('b' / 'r') ;
// état de la capture des terrains publié par un seul joueur, l'arbitre (voir Multiplayer.referee)
const TEAMS = { b: 'bleu', r: 'rouge' };
const TEAM_MAX = 6;
const teamFrom = (code) => TEAMS[code] ?? null;
const teamCode = (team) => (team === 'bleu' ? 'b' : team === 'rouge' ? 'r' : undefined);
// Capture : { fields: [{ owner, progress (0 -> 1), attacker }], points: { bleu, rouge }, winner, round } ; null si invalide
function captureFrom(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.f) || value.f.length > 4) return null;
    const fields = value.f.map((f) => (Array.isArray(f) ? { owner: teamFrom(f[0]), progress: Math.min(1, Math.max(0, Number(f[1]) || 0)),
        attacker: teamFrom(f[2]) } : null));
    if (fields.some((f) => !f)) return null;
    const points = numbers(value.s, 2) ?? [0, 0];
    return { fields, points: { bleu: Math.max(0, Math.floor(points[0])), rouge: Math.max(0, Math.floor(points[1])) },
        winner: teamFrom(value.w), round: Math.max(1, Math.floor(Number(value.n) || 1)) };
}

function scoreFrom(value) {
    const v = numbers(value, 2);
    return { kills: v ? Math.min(9999, Math.max(0, Math.floor(v[0]))) : 0, deaths: v ? Math.min(9999, Math.max(0, Math.floor(v[1]))) : 0 };
}

// Coups au but envoyés par un tireur (codes des parties touchées, voir Damage.js)
const HIT_ZONES = new Set(['f', 'c', 'eL', 'eR', 'wL', 'wR', 't']);
const MAX_HITS = 30;

class Multiplayer extends EventTarget {
    constructor() {
        super();
        this.id = randomString('abcdefghijklmnopqrstuvwxyz0123456789', 16);
        this.name = 'Pilote';
        this.livery = DEFAULT_LIVERY;
        this.aircraft = 'c172';       // avion piloté : 'c172' ou 'f15'
        this.registration = '';       // immatriculation choisie ('' : celle tirée de l'identifiant)
        this.code = null;
        this.isHost = false;            // créateur de la partie en cours
        this.players = new Map();     // id -> { name, p, q, v, t, livery, crashes, crashed, spawns, receivedAt } (sans le joueur local)
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
        this._wasFiring = false;
        this.slowMessages = [];       // messages lents à traiter (40 derniers) : { at (s), ms, type }
        // Score de la partie en cours : avions abattus et fois abattu. Chacun compte le sien (un abattu annonce son tireur,
        // voir sendKill : le tireur s'ajoute la victoire) et l'envoie avec son état : tous les joueurs voient le même
        // tableau, même ceux arrivés en cours de partie. Remis à zéro en quittant la partie
        this.score = { kills: 0, deaths: 0 };
        this.mode = 'libre';          // 'libre' (vol libre à plusieurs) ou 'wardog' (équipes, capture des terrains)
        this.team = null;             // Wardog : 'bleu' ou 'rouge' (null : pas encore choisie)
        this.capture = null;          // Wardog, arbitre : état de la capture à publier (voir captureFrom), fourni par simulator.js
        this.lobby = new Map();       // parties annoncées au salon : id du créateur -> { host, players, names, seenAt }
        this._lobbySeq = new Map();   // id du créateur -> numéro de sa dernière annonce reçue (copies en retard ignorées)
        this.listed = true;           // notre partie (créée par nous) s'annonce au salon
        this._watchingLobby = false;
        this._lastAnnounce = 0;

        setInterval(() => this._heartbeat(), HEARTBEAT / 2);
        // Le joueur quitte la page du simulateur (autre onglet, fenêtre réduite) ou y revient : les autres le savent tout de suite
        document.addEventListener('visibilitychange', () => {
            if (this._joined) this._sendState();
        });
    }

    // Lien direct vers la partie, à partager
    get link() {
        return this.code ? `${location.origin}${location.pathname}?partie=${this.code}` : '';
    }

    // Crée une partie privée et renvoie son code
    // mode : 'libre' ou 'wardog' ; Wardog : le créateur commence dans l'équipe bleue (il peut en changer)
    create(name, mode = 'libre') {
        this.join(randomString(CODE_CHARS, 6), name, true);
        this.mode = mode === 'wardog' ? 'wardog' : 'libre';
        this.team = this.mode === 'wardog' ? 'bleu' : null;
        return this.code;
    }

    // Wardog : joueurs par équipe (nous compris)
    teamCounts() {
        const counts = { bleu: 0, rouge: 0 };
        if (this.team) counts[this.team]++;
        for (const p of this.players.values()) if (p.team) counts[p.team]++;
        return counts;
    }

    // Wardog : places restantes dans une équipe (sans nous compter si nous y sommes déjà)
    teamRoom(team) {
        return TEAM_MAX - this.teamCounts()[team] + (this.team === team ? 1 : 0);
    }

    // Wardog : rejoindre une équipe ; false si elle est complète
    setTeam(team) {
        if (this.mode !== 'wardog' || !['bleu', 'rouge'].includes(team) || this.teamRoom(team) <= 0) return false;
        this.team = team;
        this._lastSend = 0;   // (envoyé à la prochaine image)
        this.dispatchEvent(new CustomEvent('team', { detail: { team } }));
        return true;
    }

    // Arbitre de la capture (Wardog) : le créateur s'il est là, sinon le joueur au plus petit identifiant
    get referee() {
        const owner = this.isHost ? this.id : [...this.players].find(([, p]) => p.owner)?.[0];
        return owner ?? [this.id, ...this.players.keys()].sort()[0];
    }

    // État de la capture en vigueur (celui de l'arbitre)
    get captureState() {
        const referee = this.referee;
        return referee === this.id ? this.capture : this.players.get(referee)?.capture ?? null;
    }

    join(code, name, create = false) {
        this.leave();
        this.isHost = create;   // créateur : lui seul peut fermer la partie pour tous (voir close)
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

    // Ferme la partie pour tous les joueurs (créateur seulement), puis la quitte
    close() {
        if (!this.code || !this.isHost) return;
        if (this._joined) this._publish({ close: true });
        this.leave();
    }

    leave() {
        if (!this.code) return;
        if (this._joined && this.isHost) this._unlist();
        if (this._joined) this._publish({ leave: true });
        for (const client of this._clients) client.unsubscribe(this._topic(this.code));
        clearTimeout(this._joinTimer);
        clearTimeout(this._helloTimer);
        this._counting = false;
        this.code = null;
        this._joined = false;
        this.players.clear();
        this._lastSeq.clear();
        this.score = { kills: 0, deaths: 0 };
        this.mode = 'libre';
        this.team = null;
        this.capture = null;
        this._emitPlayers();
        this._status('Hors ligne');
    }

    // À appeler à chaque image avec l'objet piloté, la position des gaz et l'état de crash
    // jet (F-15) : { gear, speedbrake, flaps, ab, canopy } (0 -> 1)
    // combat : { firing, damage (0 -> 100), burning }
    update(object, throttle, { crashed = false, crashes = 0, spawns = 0, lights = null, rpm = null, weather = null, jet = null, combat = null } = {}) {
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
            r: rpm === null ? undefined : Math.round(rpm / 10) * 10,
            w: weather ?? undefined,   // météo choisie (celle du créateur donne le vent de la partie)
            c: this.livery,
            g: this.registration || undefined,
            x: crashes,
            k: crashed ? 1 : 0,
            s: spawns,   // apparitions : les autres ne nous percutent pas si l'on apparaît sur eux (voir simulator.js)
            l: lights ? (lights.land || lights.taxi ? 1 : 0) | (lights.nav ? 2 : 0) | (lights.beacon ? 4 : 0) | (lights.strobe ? 8 : 0) : 14,
            o: this.isHost ? 1 : undefined,
            a: this.aircraft === 'f15' ? 'f15' : undefined,
            j: this.aircraft === 'f15' && jet ? [jet.gear, jet.speedbrake, jet.flaps, jet.ab, jet.canopy].map((v) => Math.round(v * 100) / 100) : undefined,
            f: combat?.firing ? 1 : undefined,
            d: combat?.damage ? Math.round(combat.damage) : undefined,
            fi: combat?.burning ? 1 : undefined,
            lk: combat?.lock ?? undefined,
            lkd: combat?.lock && combat.locked ? 1 : undefined,
            sc: this.score.kills || this.score.deaths ? [this.score.kills, this.score.deaths] : undefined,
            m: this.mode === 'wardog' ? 'w' : undefined,
            tm: this.mode === 'wardog' ? teamCode(this.team) : undefined,
            cp: this.mode === 'wardog' && this.capture && this.referee === this.id ? {
                f: this.capture.fields.map((f) => [teamCode(f.owner) ?? '', Math.round(f.progress * 100) / 100, teamCode(f.attacker) ?? '']),
                s: [this.capture.points.bleu, this.capture.points.rouge], w: teamCode(this.capture.winner) ?? '', n: this.capture.round,
            } : undefined,
        };
        // Début et fin d'une rafale : envoyés tout de suite (les traceurs chez les autres suivent la détente)
        const firingChanged = (this._state.f === 1) !== this._wasFiring;
        this._wasFiring = this._state.f === 1;
        if (this._joined && (now - this._lastSend >= MIN_INTERVAL || (firingChanged && now - this._lastSend >= 50))) this._sendState();
    }

    // Message de la radio de l'aérodrome (contrôle aérien) : entendu par les joueurs sur la même fréquence
    sendAtc(message) {
        if (this._joined) this._publish({ atc: message });
    }

    // Message du tchat, affiché chez tous les joueurs de la partie ; false si on n'est pas (encore) dans une partie
    sendChat(text) {
        if (!this._joined) return false;
        this._publish({ chat: String(text).slice(0, MAX_CHAT) });
        return true;
    }

    // Combat : coups au but de notre canon sur un joueur (zones touchées)
    sendHit(to, zones) {
        if (this._joined && ID_PATTERN.test(to)) this._publish({ hit: { to, z: zones.slice(0, MAX_HITS) } });
    }

    // Combat : missile tiré (départ, vitesse de l'avion, croix visée) ; les autres refont la même trajectoire
    sendMissile({ from, velocity, target }) {
        if (this._joined) this._publish({ missile: { p: from.toArray().map(round), v: velocity.toArray().map(round), t: target.toArray().map(round) } });
    }

    // Combat : missile air-air tiré sur un joueur (départ, vitesse de l'avion, identifiant de la cible)
    sendAAMissile({ from, velocity, targetId, missileId }) {
        if (this._joined && ID_PATTERN.test(targetId)) {
            this._publish({ aam: { p: from.toArray().map(round), v: velocity.toArray().map(round), t: targetId, i: missileId } });
        }
    }

    // Combat : salve de leurres (position, vitesse) et missiles qu'elle a leurrés (identifiants)
    sendFlares({ position, velocity, decoyed }) {
        if (this._joined) this._publish({ flr: { p: position.toArray().map(round), v: velocity.toArray().map(round), d: decoyed.slice(0, 8) } });
    }

    // Combat : nous venons d'être abattus (by : identifiant du tireur, ou null)
    sendKill(by, reason) {
        if (this._joined) this._publish({ kill: { by: by ?? '', r: String(reason).slice(0, 80) } });
    }

    // Paquet de voix de la radio (texte base64) ; part tout de suite, sans attendre l'état
    sendVoice(data, end = false) {
        if (this._joined) this._publish({ voice: data, end });
    }

    // Salon : écoute des parties annoncées (fenêtre Multijoueur ouverte) ; événement 'lobby' à chaque changement
    watchLobby(on) {
        if (on === this._watchingLobby) return;
        this._watchingLobby = on;
        if (!on) {
            for (const client of this._clients) client.unsubscribe(`${LOBBY_PREFIX}/+`);
            this.lobby.clear();
            return;
        }
        this._connect().then(() => {
            if (this._watchingLobby) for (const client of this._clients) client.subscribe(`${LOBBY_PREFIX}/+`, { qos: 0 });
        }).catch(() => {});
    }

    // Connexion aux relais d'avance (survol du bouton Multijoueur) : la liste des parties arrive plus vite
    preconnect() {
        this._connect().catch(() => {});
    }

    // Notre partie visible ou non au salon (créateur seulement)
    setListed(listed) {
        this.listed = listed;
        if (!listed && this._joined && this.isHost) this._unlist();
        this._lastAnnounce = 0;
    }

    // private

    _publishTo(topic, message) {
        const payload = JSON.stringify(message);
        for (const client of this._clients) {
            if (client.connected) client.publish(topic, payload, { qos: 0 });
        }
    }

    _announce() {
        this._lastAnnounce = performance.now();
        const names = [this.name, ...[...this.players.values()].map((p) => p.name)].slice(0, 8);
        const teams = this.teamCounts();
        this._publishTo(`${LOBBY_PREFIX}/${this.id}`, { host: this.name, n: this.players.size + 1, names, s: ++this._seq,
            m: this.mode === 'wardog' ? 'w' : undefined, b: this.mode === 'wardog' ? teams.bleu : undefined,
            r: this.mode === 'wardog' ? teams.rouge : undefined });
    }

    _unlist() {
        this._publishTo(`${LOBBY_PREFIX}/${this.id}`, { gone: true, s: ++this._seq });
    }

    _onLobby(id, payload) {
        if (!ID_PATTERN.test(id ?? '') || id === this.id) return;
        let data;
        try {
            data = JSON.parse(payload.toString());
        } catch {
            return;
        }
        this._kind = 'salon';
        // Chaque annonce arrive par chaque relais : une copie en retard (relais plus lent) ne doit pas remettre dans la
        // liste une partie qui vient d'être retirée
        if (Number.isFinite(data.s)) {
            if (data.s <= (this._lobbySeq.get(id) ?? 0)) return;
            this._lobbySeq.set(id, data.s);
        }
        if (data.gone) {
            if (this.lobby.delete(id)) this._emitLobby();
            return;
        }
        const text = (v) => String(v ?? '').replace(/[ -]/g, ' ').trim().slice(0, 20);
        const entry = {
            host: text(data.host) || 'Pilote',
            players: Math.min(MAX_PLAYERS, Math.max(1, Math.floor(Number(data.n) || 1))),
            names: Array.isArray(data.names) ? data.names.slice(0, 8).map(text).filter(Boolean) : [],
            mode: data.m === 'w' ? 'wardog' : 'libre',
            teams: { bleu: Math.min(TEAM_MAX, Math.max(0, Math.floor(Number(data.b) || 0))),
                rouge: Math.min(TEAM_MAX, Math.max(0, Math.floor(Number(data.r) || 0))) },
            seenAt: performance.now(),
        };
        const before = this.lobby.get(id);
        this.lobby.set(id, entry);
        if (!before || JSON.stringify({ ...before, seenAt: 0 }) !== JSON.stringify({ ...entry, seenAt: 0 })) this._emitLobby();
    }

    _emitLobby() {
        this.dispatchEvent(new CustomEvent('lobby', { detail: [...this.lobby.entries()].map(([id, e]) => ({ id, ...e })) }));
    }

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
                    if (this._watchingLobby) client.subscribe(`${LOBBY_PREFIX}/+`, { qos: 0 });
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
        // Page cachée : le navigateur suspend l'animation, l'avion ne bouge plus ; la pulsation continue d'envoyer cet état
        this._publish({ ...this._state, h: document.hidden ? 1 : 0 });
    }

    // Toutes les 0,5 s, même onglet en arrière-plan : renvoie l'état s'il n'est pas parti depuis 1 s,
    // et retire les joueurs partis sans prévenir
    _heartbeat() {
        const now = performance.now();
        if (this._watchingLobby) {
            let changed = false;
            for (const [id, entry] of this.lobby) {
                if (now - entry.seenAt > LOBBY_STALE) {
                    this.lobby.delete(id);
                    changed = true;
                }
            }
            if (changed) this._emitLobby();
        }
        if (!this.code) return;
        if (this._joined && this.isHost && this.listed && now - this._lastAnnounce >= LOBBY_EVERY) this._announce();
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

    // Message reçu : traité, et noté s'il a pris plus de SLOW_MESSAGE ms (ce qu'il a déclenché compris : arrivée d'un
    // avion, missile, explosion…), pour l'enregistreur d'à-coups (voir esmeFreezes dans simulator.js)
    _onMessage(topic, payload) {
        const start = performance.now();
        this._kind = null;
        this._handleMessage(topic, payload);
        const kind = this._kind;
        const ms = performance.now() - start;
        if (ms >= SLOW_MESSAGE) {
            this.slowMessages.push({ at: Math.round(start / 1000), ms: Math.round(ms), type: kind ?? '?' });
            if (this.slowMessages.length > 40) this.slowMessages.shift();
        }
    }

    _handleMessage(topic, payload) {
        const [, , code, id] = topic.split('/');
        if (code === 'salon') return this._onLobby(id, payload);
        if (code !== this.code || !ID_PATTERN.test(id)) return;
        let data;
        try {
            data = JSON.parse(payload.toString());
        } catch {
            return;
        }
        this._kind = MESSAGE_KINDS.find((k) => k in data) ?? 'état';
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
        // Le créateur ferme la partie : tout le monde la quitte
        if (data.close) {
            if (!this.players.get(id)?.owner) return;
            const closed = this.code;
            this.leave();
            this._status(`La partie ${closed} a été fermée par son créateur`, true);
            this.dispatchEvent(new CustomEvent('closed', { detail: { code: closed } }));
            return;
        }
        if (data.leave) {
            // (son dernier numéro est gardé : une copie en retard d'un de ses messages, reçue par un autre relais, ne le
            // fait pas réapparaître ; s'il revient, ses numéros continuent de croître)
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
        // Tchat : message écrit d'un joueur de la partie (texte seul : affiché tel quel, jamais comme du HTML)
        if (typeof data.chat === 'string') {
            const player = this.players.get(id);
            const text = data.chat.replace(/[ -]/g, ' ').trim().slice(0, MAX_CHAT);
            if (player && text) this.dispatchEvent(new CustomEvent('chat', { detail: { id, name: player.name, text } }));
            return;
        }
        // Combat : un joueur nous a touchés avec son canon
        if (data.hit && typeof data.hit === 'object') {
            const player = this.players.get(id);
            if (player && data.hit.to === this.id && Array.isArray(data.hit.z)) {
                const zones = data.hit.z.filter((z) => HIT_ZONES.has(z)).slice(0, MAX_HITS);
                if (zones.length) this.dispatchEvent(new CustomEvent('hit', { detail: { id, name: player.name, zones } }));
            }
            return;
        }
        // Combat : missile air-sol tiré par un joueur
        if (data.missile && typeof data.missile === 'object') {
            const player = this.players.get(id);
            const from = numbers(data.missile.p, 3), velocity = numbers(data.missile.v, 3), target = numbers(data.missile.t, 3);
            if (player && from && velocity && target) {
                this.dispatchEvent(new CustomEvent('missile', { detail: { id, name: player.name, from, velocity, target } }));
            }
            return;
        }
        // Combat : missile air-air tiré par un joueur (cible : un joueur, peut-être nous)
        if (data.aam && typeof data.aam === 'object') {
            const player = this.players.get(id);
            const from = numbers(data.aam.p, 3), velocity = numbers(data.aam.v, 3);
            const targetId = typeof data.aam.t === 'string' && ID_PATTERN.test(data.aam.t) ? data.aam.t : null;
            const missileId = typeof data.aam.i === 'string' && data.aam.i.length <= 48 ? data.aam.i : null;
            if (player && from && velocity && targetId) {
                this.dispatchEvent(new CustomEvent('aamissile', { detail: { id, name: player.name, from, velocity, targetId, missileId, atMe: targetId === this.id } }));
            }
            return;
        }
        // Combat : leurres d'un joueur
        if (data.flr && typeof data.flr === 'object') {
            const position = numbers(data.flr.p, 3), velocity = numbers(data.flr.v, 3);
            const decoyed = Array.isArray(data.flr.d) ? data.flr.d.filter((x) => typeof x === 'string' && x.length <= 48).slice(0, 8) : [];
            if (this.players.has(id) && position && velocity) this.dispatchEvent(new CustomEvent('flares', { detail: { id, position, velocity, decoyed } }));
            return;
        }
        // Combat : un joueur a été abattu
        if (data.kill && typeof data.kill === 'object') {
            const victim = this.players.get(id);
            if (victim) {
                const by = typeof data.kill.by === 'string' ? data.kill.by : '';
                const killer = by === this.id ? this.name : this.players.get(by)?.name ?? null;
                this.dispatchEvent(new CustomEvent('kill', { detail: { id, name: victim.name, by, byName: killer, mine: by === this.id,
                    reason: typeof data.kill.r === 'string' ? data.kill.r.slice(0, 80) : '' } }));
            }
            return;
        }
        // Contrôle aérien : message d'un joueur ou de son contrôleur
        if (data.atc && typeof data.atc === 'object') {
            const a = data.atc;
            const text = (v, max) => typeof v === 'string' && v.length <= max;
            if (this.players.has(id) && ['ground', 'tower', 'approach', 'info'].includes(a.f) && ['pilot', 'atc'].includes(a.w)
                && text(a.t, 400) && text(a.s, 600) && (a.l === 'fr' || a.l === 'en')) {
                this.dispatchEvent(new CustomEvent('atc', { detail: { id, freq: a.f, from: a.w, text: a.t, speech: a.s, lang: a.l, reply: a.r === true } }));
            }
            return;
        }
        const state = cleanState(data);
        if (!state) return;

        const previous = this.players.get(id);
        this.players.set(id, { ...state, age: 0, receivedAt: now });
        // Mode de la partie : celui du créateur (les joueurs arrivés en cours de partie l'apprennent ainsi)
        if (state.owner && !this.isHost && state.mode !== this.mode) {
            this.mode = state.mode;
            if (this.mode !== 'wardog') this.team = null;
            this.dispatchEvent(new CustomEvent('mode', { detail: { mode: this.mode } }));
        }
        // Équipe changée : listes refaites (couleurs, places restantes)
        if (previous && previous.team !== state.team) this._emitPlayers();
        // Nouveau joueur, pseudo changé en cours de partie (menu Profil) ou autre avion (Cessna <-> F-15, choisi au hangar
        // après avoir rejoint la partie) : listes des joueurs et avions refaits. Avant, le changement d'avion n'était pas
        // signalé : les autres continuaient de voir un Cessna à la place d'un F-15
        if (!previous || previous.name !== state.name || previous.aircraft !== state.aircraft) this._emitPlayers();

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
        this._status(this.isHost ? `Partie privée ${this.code} : partagez le code ou le lien` : `Partie ${this.code} rejointe`);
        this.dispatchEvent(new CustomEvent('joined', { detail: { code: this.code, host: this.isHost } }));
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

export { Multiplayer, cleanRegistration, TEAM_MAX };
