// Réglages de qualité visuelle (menu Paramètres) : préréglages + réglages détaillés,
// mémorisés dans le navigateur (localStorage) d'une visite à l'autre.

const STORAGE_KEY = 'esme-fs-reglages';

// Chaque réglage : libellé, explication courte et choix possibles [valeur, libellé]
const OPTIONS = {
    fps:        { label: 'Images par seconde (max)', hint: '30 : moins de chauffe, batterie économisée',
                  choices: [[30, '30'], [60, '60'], [0, 'Maximum de l\'écran']] },
    resolution: { label: 'Résolution', hint: 'Automatique : baisse toute seule si les i/s chutent',
                  choices: [['auto', 'Automatique'], [0.5, '50 %'], [0.75, '75 %'], [1, '100 %'], [1.5, '150 %'], [2, '200 % (écran HD)']] },
    antialias:  { label: 'Anticrénelage', hint: 'Lisse les bords en escalier',
                  choices: [[0, 'Désactivé'], [2, 'MSAA 2x'], [4, 'MSAA 4x']] },
    shadows:    { label: 'Ombres', hint: 'Finesse des ombres de l\'avion et du décor',
                  choices: [[0, 'Désactivées'], [1024, 'Basses'], [2048, 'Moyennes'], [4096, 'Hautes']] },
    clouds:     { label: 'Nuages', hint: 'Très coûteux en brouillard et en tempête',
                  choices: [[0, 'Désactivés'], [0.5, 'Légers'], [1, 'Complets']] },
    terrain:    { label: 'Détail du sol', hint: 'Finesse du relief (collines, montagnes)',
                  choices: [[128, 'Bas'], [256, 'Moyen'], [384, 'Haut'], [512, 'Très haut']] },
    decor:      { label: 'Arbres et décor', hint: 'Part des arbres, fleurs, rochers affichés',
                  choices: [[0.25, '25 %'], [0.5, '50 %'], [1, '100 %']] },
    bloom:      { label: 'Halo lumineux', hint: 'Lueur autour des feux, éclairs, explosion',
                  choices: [[false, 'Désactivé'], [true, 'Activé']] },
    perf:       { label: 'Afficher les performances', hint: 'Compteur d\'i/s à l\'écran (touche P)',
                  choices: [[false, 'Non'], [true, 'Oui']] },
    // Aides au pilotage : désactivées par défaut (pilotage réaliste)
    rotationAuto:    { group: 'Pilotage', label: 'Rotation automatique', hint: 'Au sol, le trim lève le nez tout seul au décollage',
                       choices: [[false, 'Désactivée'], [true, 'Activée']] },
    stallProtection: { group: 'Pilotage', label: 'Protection décrochage', hint: 'Manche tiré à fond, l\'aile s\'arrête juste avant le décrochage',
                       choices: [[false, 'Désactivée'], [true, 'Activée']] },
    smoothLiftoff:   { group: 'Pilotage', label: 'Envol en douceur', hint: 'Après l\'envol, manche relâché, le nez se rend progressivement',
                       choices: [[false, 'Désactivé'], [true, 'Activé']] },
};
const FLIGHT_DEFAULTS = { rotationAuto: false, stallProtection: false, smoothLiftoff: false };

const PRESETS = {
    bas:   { label: 'Bas',   fps: 30, resolution: 'auto', antialias: 0, shadows: 0,    clouds: 0.5, terrain: 128, decor: 0.25, bloom: false },
    moyen: { label: 'Moyen', fps: 60, resolution: 'auto', antialias: 2, shadows: 1024, clouds: 0.5, terrain: 256, decor: 0.5,  bloom: true },
    haut:  { label: 'Haut',  fps: 60, resolution: 'auto', antialias: 4, shadows: 2048, clouds: 1,   terrain: 384, decor: 1,    bloom: true },
    ultra: { label: 'Ultra', fps: 0,  resolution: 'auto', antialias: 4, shadows: 4096, clouds: 1,   terrain: 512, decor: 1,    bloom: true },
};
const DEFAULT_PRESET = 'haut';
const CUSTOM = 'perso';

class Settings extends EventTarget {
    constructor() {
        super();
        this.preset = DEFAULT_PRESET;
        this.values = { ...PRESETS[DEFAULT_PRESET], perf: false, ...FLIGHT_DEFAULTS };
        delete this.values.label;
        this._load();
        this._selects = {};
    }

    // Construit le formulaire dans container
    buildForm(container) {
        const presetChoices = [...Object.entries(PRESETS).map(([key, p]) => [key, p.label]), [CUSTOM, 'Personnalisé']];
        this._presetSelect = this._row(container, 'preset', { label: 'Qualité', hint: 'Préréglage : ajuste tous les réglages ci-dessous', choices: presetChoices },
            this.preset, (value) => this.applyPreset(value));
        this._presetSelect.parentElement.classList.add('reglage-principal');

        let group = null;
        for (const [key, option] of Object.entries(OPTIONS)) {
            if (option.group && option.group !== group) {
                group = option.group;
                const title = document.createElement('h4');
                title.className = 'reglages-groupe';
                title.textContent = group;
                container.append(title);
            }
            this._selects[key] = this._row(container, key, option, this.values[key], (value) => this.set(key, value));
        }
    }

    applyPreset(name) {
        if (!PRESETS[name]) return;
        this.preset = name;
        const { label, ...values } = PRESETS[name];
        Object.assign(this.values, values);
        this._changed();
    }

    set(key, value) {
        if (this.values[key] === value) return;
        this.values[key] = value;
        // Modifier un réglage de qualité passe en "Personnalisé" (les autres réglages n'y changent rien)
        this.preset = this._matchingPreset();
        this._changed();
    }

    _matchingPreset() {
        for (const [name, { label, ...values }] of Object.entries(PRESETS)) {
            if (Object.entries(values).every(([key, value]) => this.values[key] === value)) return name;
        }
        return CUSTOM;
    }

    _changed() {
        for (const [key, select] of Object.entries(this._selects)) select.value = JSON.stringify(this.values[key]);
        if (this._presetSelect) this._presetSelect.value = JSON.stringify(this.preset);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ preset: this.preset, values: this.values }));
        } catch { /* stockage indisponible : réglages valables pour cette visite seulement */ }
        this.dispatchEvent(new CustomEvent('change', { detail: this.values }));
    }

    _load() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        } catch { /* stockage indisponible ou illisible */ }
        if (!saved?.values) return;
        // Ne reprend que des valeurs encore proposées (le menu peut évoluer)
        for (const [key, option] of Object.entries(OPTIONS)) {
            const value = saved.values[key];
            if (option.choices.some(([choice]) => choice === value)) this.values[key] = value;
        }
        this.preset = this._matchingPreset();
    }

    _row(container, key, option, value, onChange) {
        const row = document.createElement('label');
        row.className = 'reglage';
        const text = document.createElement('span');
        text.className = 'reglage-nom';
        text.textContent = option.label;
        const hint = document.createElement('small');
        hint.textContent = option.hint;
        text.append(hint);

        const select = document.createElement('select');
        select.name = key;
        for (const [choice, label] of option.choices) {
            const item = document.createElement('option');
            item.value = JSON.stringify(choice);
            item.textContent = label;
            select.append(item);
        }
        select.value = JSON.stringify(value);
        select.addEventListener('change', () => onChange(JSON.parse(select.value)));
        row.append(text, select);
        container.append(row);
        return select;
    }
}

export { Settings };
