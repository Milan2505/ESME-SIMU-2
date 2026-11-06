// Tchat de la partie multijoueur : les messages s'affichent directement sur l'écran de vol, chez tous les joueurs,
// sans fenêtre à ouvrir (fil en bas à gauche, au-dessus des jauges ; chaque message s'efface au bout de quelques
// secondes). Pour écrire : touche Entrée (ou le bouton « Écrire »), Entrée envoie, Échap annule.
// Les messages passent par les relais de la partie (Multiplayer.sendChat) : publics, comme les positions.

const MAX_LENGTH = 200;       // caractères par message (même limite à la réception, voir Multiplayer.js)
const VISIBLE = 15000;        // ms : durée d'affichage d'un message, puis il s'efface
const FADE = 1000;            // ms : effacement
const MAX_LINES = 6;          // messages affichés au plus (les plus anciens partent)
const MIN_INTERVAL = 700;     // ms entre deux envois (anti-rafale)

class Chat {
    constructor({ multiplayer, root, canType = () => true, onClose = () => {} }) {
        this.multiplayer = multiplayer;
        this.canType = canType;
        this.onClose = onClose;
        this._lastSend = 0;

        this.root = root;
        this.feed = root.querySelector('.tchat-fil');
        this.form = root.querySelector('form');
        this.input = root.querySelector('input');
        this.button = root.querySelector('.tchat-ecrire');
        this.input.maxLength = MAX_LENGTH;

        this.button.addEventListener('click', () => this.open());
        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this._send();
        });
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.close();
            }
        });
        // Entrée, hors champ de saisie et hors fenêtre : ouvre le champ
        window.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
            if (!this.multiplayer.code || this.isOpen || !this.canType(event)) return;
            event.preventDefault();
            this.open();
        });

        multiplayer.addEventListener('chat', ({ detail }) => this.add(detail.name, detail.text));
        // Arrivées et départs de joueurs, dans le fil
        this._known = new Map();
        this._quietUntil = 0;     // en arrivant dans une partie, les joueurs déjà là ne sont pas annoncés
        multiplayer.addEventListener('players', () => this._players());
        multiplayer.addEventListener('status', () => this._update());
        this._update();
    }

    get isOpen() {
        return !this.form.hidden;
    }

    open() {
        if (!this.multiplayer.code) return;
        this.form.hidden = false;
        this.button.hidden = true;
        this.root.classList.add('ouvert');
        this.input.focus();
    }

    close() {
        if (!this.isOpen) return;
        this.input.value = '';
        this.form.hidden = true;
        this.root.classList.remove('ouvert');
        this._update();
        this.input.blur();
        this.onClose();
    }

    // Ajoute une ligne au fil : name null pour un message de la partie (arrivée, départ)
    add(name, text) {
        const line = document.createElement('p');
        if (name !== null) {
            const author = document.createElement('b');
            author.textContent = `${name} : `;
            line.append(author);
        } else {
            line.className = 'tchat-info';
        }
        line.append(text);
        this.feed.append(line);
        while (this.feed.children.length > MAX_LINES) this.feed.firstElementChild.remove();
        setTimeout(() => line.classList.add('efface'), VISIBLE);
        setTimeout(() => line.remove(), VISIBLE + FADE);
    }

    _send() {
        const text = this.input.value.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
        const now = performance.now();
        if (text && now - this._lastSend >= MIN_INTERVAL && this.multiplayer.sendChat(text)) {
            this._lastSend = now;
            this.add(`${this.multiplayer.name} (vous)`, text);
        }
        this.close();
    }

    _players() {
        const current = new Map([...this.multiplayer.players].map(([id, p]) => [id, p.name]));
        if (this.multiplayer.code && performance.now() > this._quietUntil) {
            for (const [id, name] of current) if (!this._known.has(id)) this.add(null, `${name} a rejoint la partie`);
            for (const [id, name] of this._known) if (!current.has(id)) this.add(null, `${name} a quitté la partie`);
        }
        this._known = current;
    }

    // Hors partie : rien à l'écran (fil vidé, champ fermé)
    _update() {
        const online = Boolean(this.multiplayer.code);
        if (this.multiplayer.code !== this._code) {
            this._code = this.multiplayer.code;
            // (le créateur, seul au départ, annonce tout le monde)
            this._quietUntil = this.multiplayer.isHost ? 0 : performance.now() + 3000;
        }
        this.root.hidden = !online;
        if (!online) {
            this.feed.replaceChildren();
            this._known.clear();
            if (this.isOpen) this.close();
        }
        this.button.hidden = !online || this.isOpen;
    }
}

export { Chat };
