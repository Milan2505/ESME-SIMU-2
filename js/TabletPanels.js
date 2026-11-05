// Interface tablette : affichage générique construit à partir du registre (TabletRegistry.js).
// - une colonne de boutons principaux sur le côté ;
// - un bouton principal ouvre un panneau listant ses catégories ;
// - une catégorie ouvre un panneau avec son titre et une grille de tuiles sur 3 colonnes (nom + état ou valeur) ;
// - les panneaux se déplacent au doigt (glisser leur barre de titre) ; leur position est gardée dans le navigateur,
//   en proportion de l'écran (elle reste valable après une rotation) et toujours ramenée dans l'écran.
// Ce fichier ne connaît aucune fonction du simulateur : tout vient du registre.

const STORAGE_KEY = 'esme-tablette-panneaux';
const REFRESH = 0.25;     // s entre deux mises à jour des valeurs affichées

function element(tag, className, text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

// Une action du registre qui échoue ne doit jamais bloquer l'interface
function run(fn, ...args) {
    try { return fn?.(...args); } catch (error) { console.error('Interface tablette :', error); return undefined; }
}

// Panneau déplaçable au doigt : barre de titre (on la glisse) avec un bouton de fermeture, puis le contenu
class DraggablePanel {
    // positions : objet partagé { clé: { x, y } } (fractions de la taille de root), onMove : à enregistrer
    constructor(root, positions, onMove) {
        this.root = root;
        this.positions = positions;
        this.onMove = onMove;
        this.key = null;
        this.node = element('section', 'tb-panneau');
        this.node.hidden = true;
        const header = element('header', 'tb-panneau-titre');
        this.title = element('h3', '');
        this.closeButton = element('button', 'tb-fermer', '×');
        this.closeButton.type = 'button';
        this.closeButton.title = 'Fermer';
        this.closeButton.addEventListener('click', () => this.hide());
        header.append(this.title, this.closeButton);
        this.body = element('div', 'tb-panneau-contenu');
        this.node.append(header, this.body);
        root.append(this.node);
        this._drag(header);
    }

    // key : position mémorisée propre à ce contenu ; place(width, height) : position par défaut (px dans root)
    show(key, title, content, place) {
        this.key = key;
        this.title.textContent = title;
        this.body.replaceChildren(content);
        this.node.hidden = false;
        const saved = this.positions[key];
        const { width, height } = this._area();
        if (saved) this._moveTo(saved.x * width, saved.y * height);
        else this._moveTo(...place(this.node.offsetWidth, this.node.offsetHeight, width, height));
    }

    hide() {
        this.node.hidden = true;
        this.key = null;
        this.onHide?.();
    }

    get open() {
        return !this.node.hidden;
    }

    // Ramené dans l'écran (rotation, redimensionnement)
    clamp() {
        if (!this.open) return;
        this._moveTo(this.node.offsetLeft, this.node.offsetTop);
    }

    _area() {
        return { width: this.root.clientWidth, height: this.root.clientHeight };
    }

    _moveTo(x, y) {
        const { width, height } = this._area();
        const left = Math.max(0, Math.min(width - this.node.offsetWidth, x));
        const top = Math.max(0, Math.min(height - this.node.offsetHeight, y));
        this.node.style.left = `${left}px`;
        this.node.style.top = `${top}px`;
        return { left, top, width, height };
    }

    _drag(handle) {
        let start = null;
        handle.addEventListener('pointerdown', (event) => {
            if (event.target === this.closeButton) return;
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            start = { x: event.clientX, y: event.clientY, left: this.node.offsetLeft, top: this.node.offsetTop };
            this.node.classList.add('tb-deplace');
        });
        handle.addEventListener('pointermove', (event) => {
            if (!start || !handle.hasPointerCapture(event.pointerId)) return;
            this._moveTo(start.left + event.clientX - start.x, start.top + event.clientY - start.y);
        });
        const end = () => {
            if (!start) return;
            start = null;
            this.node.classList.remove('tb-deplace');
            const { width, height } = this._area();
            if (this.key && width && height) {
                this.positions[this.key] = { x: this.node.offsetLeft / width, y: this.node.offsetTop / height };
                this.onMove();
            }
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    }
}

class TabletPanels {
    // root : calque posé sur l'écran de vol ; registry : voir TabletRegistry.js
    constructor(root, registry) {
        this.root = root;
        this.registry = registry;
        this._timer = 0;
        this._updaters = [];      // mises à jour des tuiles affichées
        this._shown = null;
        this._positions = {};
        try { this._positions = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { /* stockage indisponible */ }
        const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._positions)); } catch { /* idem */ } };

        // Colonne des boutons principaux
        this.column = element('nav', 'tb-colonne');
        this._mainButtons = new Map();
        for (const main of registry) {
            const button = element('button', 'tb-principal', main.label);
            button.type = 'button';
            button.addEventListener('click', () => {
                button.blur();
                if (this.list.open && this.list.key === `principal:${main.id}`) this.list.hide();
                else this.openMain(main);
            });
            this._mainButtons.set(main.id, button);
            this.column.append(button);
        }
        root.append(this.column);

        this.list = new DraggablePanel(root, this._positions, save);
        this.list.node.classList.add('tb-liste');
        this.list.onHide = () => this._markMain(null);
        this.detail = new DraggablePanel(root, this._positions, save);
        this.detail.node.classList.add('tb-detail');
        this.detail.onHide = () => { this._updaters = []; this._markCategory(null); };
        new ResizeObserver(() => { this.list.clamp(); this.detail.clamp(); }).observe(root);
    }

    // Panneau des catégories d'un bouton principal (à côté de la colonne)
    openMain(main) {
        const items = element('div', 'tb-categories');
        for (const category of main.categories) {
            const button = element('button', 'tb-categorie', category.label);
            button.type = 'button';
            button.dataset.categorie = category.id;
            button.addEventListener('click', () => {
                button.blur();
                this.openCategory(category);
            });
            items.append(button);
        }
        const column = this.column.getBoundingClientRect(), area = this.root.getBoundingClientRect();
        this.list.show(`principal:${main.id}`, main.label, items,
            (w, h, width) => [column.left - area.left - w - 10, column.top - area.top]);
        this._markMain(main.id);
        this._markCategory(this.detail.open ? this._category : null);
    }

    // Panneau d'une catégorie : titre et grille de tuiles (3 colonnes)
    openCategory(category) {
        this._category = category.id;
        const grid = element('div', 'tb-grille');
        this._updaters = category.tiles.map((tile) => {
            const { node, update } = this._tile(tile);
            grid.append(node);
            return update;
        });
        this.detail.show(`categorie:${category.id}`, category.label, grid, (w, h, width, height) => {
            const list = this.list.open ? this.list.node : null;
            const right = list ? list.offsetLeft - 10 : width - 140;
            return [Math.max(0, right - w), list ? list.offsetTop : 12];
        });
        this._markCategory(category.id);
        this._refresh();
    }

    _markMain(id) {
        for (const [mainId, button] of this._mainButtons) button.classList.toggle('actif', mainId === id);
    }

    _markCategory(id) {
        for (const button of this.list.body.querySelectorAll('[data-categorie]')) button.classList.toggle('actif', button.dataset.categorie === id);
    }

    // Tuile selon son type (voir TabletRegistry.js) : { node, update() }
    _tile(tile) {
        const node = element(tile.type === 'value' && tile.step && !tile.action ? 'div' : 'button', `tb-tuile tb-${tile.type}`);
        if (node.tagName === 'BUTTON') node.type = 'button';
        if (tile.danger) node.classList.add('tb-danger');
        const name = element('span', 'tb-nom', tile.label);
        const state = element('span', 'tb-etat');
        node.append(name, state);
        let update = () => {};

        if (tile.type === 'toggle') {
            const [off, on] = tile.states ?? ['OFF', 'ON'];
            node.addEventListener('click', () => { node.blur(); run(tile.action); this._refresh(); });
            update = () => {
                const value = Boolean(run(tile.value));
                state.textContent = value ? on : off;
                node.classList.toggle('tb-on', value);
            };
        } else if (tile.type === 'hold') {
            state.textContent = 'MAINTENIR';
            const release = () => {
                if (!node.classList.contains('tb-on')) return;
                node.classList.remove('tb-on');
                run(tile.release);
            };
            node.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                node.setPointerCapture(event.pointerId);
                node.classList.add('tb-on');
                run(tile.press);
            });
            node.addEventListener('pointerup', release);
            node.addEventListener('pointercancel', release);
            node.addEventListener('lostpointercapture', release);
        } else {
            if (tile.action) node.addEventListener('click', (event) => {
                if (event.target.closest('.tb-pas')) return;
                node.blur();
                run(tile.action);
                this._refresh();
            });
            if (tile.step) {
                const steps = element('span', 'tb-pas');
                for (const [label, direction] of [['−', -1], ['+', 1]]) {
                    const button = element('button', '', label);
                    button.type = 'button';
                    button.addEventListener('click', (event) => {
                        event.stopPropagation();
                        button.blur();
                        run(tile.step, direction);
                        this._refresh();
                    });
                    steps.append(button);
                }
                node.append(steps);
            }
            if (tile.value) update = () => { state.textContent = run(tile.value) ?? ''; };
        }
        update();
        return { node, update };
    }

    _refresh() {
        for (const update of this._updaters) update();
    }

    // À chaque image : visible (tablette, en vol) ; valeurs des tuiles affichées remises à jour REFRESH fois par seconde
    update(delta, visible) {
        if (visible !== this._shown) {
            this._shown = visible;
            this.root.hidden = !visible;
        }
        if (!visible || !this.detail.open) return;
        if ((this._timer -= delta) > 0) return;
        this._timer = REFRESH;
        this._refresh();
    }
}

export { TabletPanels };
