// Commandes tactiles (tablettes) : par-dessus l'écran de vol, un manche sous le pouce gauche (tangage et roulis ; au
// sol, il oriente aussi la roulette de nez), une manette des gaz à droite, et des boutons : freins et trim (tenus),
// volets, vue, recentrage, barre de menus. Affichées d'office sur un écran tactile principal (tablette), ou dès que
// l'écran est touché (ordinateur à écran tactile) ; seulement en vol (pas au menu, au hangar, au choix du départ).
// Elles s'ajoutent au clavier (voir PlaneControls.setTouchInput).

const DEAD_ZONE = 0.06;    // part de la course du manche sans effet (le pouce ne reste jamais pile au centre)

// Course du manche -> commande : douce près du centre (corrections fines), entière en butée
const curve = (v) => {
    const a = Math.max(0, (Math.abs(v) - DEAD_ZONE) / (1 - DEAD_ZONE));
    return Math.sign(v) * a ** 1.6;
};

class TouchControls {
    // controls : PlaneControls ; actions : { view, recenter, menu, flaps(step) }
    constructor(root, controls, actions) {
        this.root = root;
        this.controls = controls;
        this.actions = actions;
        this.enabled = matchMedia('(pointer: coarse)').matches;
        this.stick = { x: 0, y: 0 };
        this._brake = 0;
        this._trim = 0;
        this._shown = null;
        this.inset = { left: 0, right: 0 };   // hauteur occupée en bas, à gauche et à droite (px) : jauges du HUD au-dessus
        this._insetAt = 0;
        if (!this.enabled) {
            // Ordinateur à écran tactile : commandes affichées au premier contact du doigt
            const first = (event) => {
                if (event.pointerType !== 'touch') return;
                window.removeEventListener('pointerdown', first, true);
                this.enabled = true;
            };
            window.addEventListener('pointerdown', first, true);
        }
        this._setupStick(root.querySelector('#tactile-manche'));
        this._setupThrottle(root.querySelector('#tactile-gaz'));
        for (const button of root.querySelectorAll('[data-tactile]')) this._setupButton(button);
    }

    // Manche : décalage du doigt depuis le centre (rayon = la course entière), retour au neutre au lâcher
    _setupStick(base) {
        const knob = base.querySelector('span');
        const move = (event) => {
            const r = base.getBoundingClientRect();
            const radius = r.width / 2;
            let x = (event.clientX - (r.left + radius)) / radius, y = (event.clientY - (r.top + radius)) / radius;
            const length = Math.hypot(x, y);
            if (length > 1) { x /= length; y /= length; }
            this.stick = { x, y };
            knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
        };
        const release = () => {
            this.stick = { x: 0, y: 0 };
            knob.style.transform = '';
            base.classList.remove('actif');
        };
        base.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            base.setPointerCapture(event.pointerId);
            base.classList.add('actif');
            move(event);
        });
        base.addEventListener('pointermove', (event) => { if (base.hasPointerCapture(event.pointerId)) move(event); });
        base.addEventListener('pointerup', release);
        base.addEventListener('pointercancel', release);
    }

    // Manette des gaz : le doigt place la manette (haut = plein gaz), elle reste où on la lâche
    _setupThrottle(track) {
        this._throttleFill = track.querySelector('span');
        this._throttleLabel = track.querySelector('em');
        const set = (event) => {
            const r = track.getBoundingClientRect();
            this.controls.throttle = Math.min(1, Math.max(0, 1 - (event.clientY - r.top) / r.height));
        };
        track.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            track.setPointerCapture(event.pointerId);
            set(event);
        });
        track.addEventListener('pointermove', (event) => { if (track.hasPointerCapture(event.pointerId)) set(event); });
    }

    // Boutons : freins et trim agissent tant qu'on appuie ; les autres d'une pression
    _setupButton(button) {
        const action = button.dataset.tactile;
        const hold = { frein: ['_brake', 1], 'trim-cabrer': ['_trim', 1], 'trim-piquer': ['_trim', -1] }[action];
        if (hold) {
            const [key, value] = hold;
            const press = (event) => {
                event.preventDefault();
                button.setPointerCapture(event.pointerId);
                this[key] = value;
                button.classList.add('actif');
            };
            const release = () => {
                this[key] = 0;
                button.classList.remove('actif');
            };
            button.addEventListener('pointerdown', press);
            button.addEventListener('pointerup', release);
            button.addEventListener('pointercancel', release);
            return;
        }
        button.addEventListener('click', () => {
            if (action === 'volets-moins') this.actions.flaps(-1);
            else if (action === 'volets-plus') this.actions.flaps(1);
            else this.actions[action]?.();
            button.blur();
        });
    }

    // À chaque image : commandes transmises à l'avion, affichage selon la phase (inFlight : en vol ou au sol, partie en
    // cours)
    update(inFlight) {
        const shown = this.enabled && inFlight;
        if (shown !== this._shown) {
            this._shown = shown;
            this.root.hidden = !shown;
            if (!shown) {
                this.stick = { x: 0, y: 0 };
                this._brake = this._trim = 0;
            }
        }
        const roll = -curve(this.stick.x), pitch = curve(this.stick.y);
        // Au sol, le manche oriente aussi la roulette de nez (palonnier) ; en vol, il ne commande que les ailerons
        this.controls.setTouchInput({ pitch, roll, yaw: this.controls.isOnGround() ? roll : 0, brake: this._brake, trim: this._trim });
        if (shown && performance.now() > this._insetAt) {
            this._insetAt = performance.now() + 500;
            const bottom = this.root.getBoundingClientRect().bottom;
            const height = (child) => Math.max(0, bottom - child.getBoundingClientRect().top + 8);
            this.inset = { left: height(this.root.children[0]), right: height(this.root.children[1]) };
        } else if (!shown) this.inset = { left: 0, right: 0 };
        if (shown) {
            const throttle = this.controls.getThrottle();
            this._throttleFill.style.height = `${throttle * 100}%`;
            this._throttleLabel.textContent = `Gaz ${Math.round(throttle * 100)} %`;
        }
    }
}

export { TouchControls };
