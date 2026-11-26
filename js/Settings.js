// Réglages de qualité visuelle (menu Paramètres) : préréglages + réglages détaillés,
// mémorisés dans le navigateur (localStorage) d'une visite à l'autre.

const STORAGE_KEY = 'esme-fs-reglages';
const VERSION = 5;   // 2 : style du décor « Réaliste » / « Anciens assets » (plus de « Mixte ») ; 3 : modèle de vol réaliste par défaut ;
                     // 4 : douceur des commandes « Très vive » par défaut ; 5 : douceur « Vive » par défaut

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
    cloudLayer: { label: 'Couche nuageuse', hint: 'Plafond continu des météos Nuageux et Tempête',
                  choices: [[false, 'Désactivée'], [true, 'Activée']] },
    terrain:    { label: 'Détail du sol', hint: 'Finesse du relief (collines, montagnes)',
                  choices: [[128, 'Bas'], [256, 'Moyen'], [384, 'Haut'], [512, 'Très haut']] },
    visibility: { label: 'Distance de vue', hint: 'Jusqu’où porte le regard avant la brume (par beau temps). Le relief lointain reste simplifié : peu coûteux',
                  choices: [[3000, 'Proche (3 km)'], [4500, 'Moyenne (4,5 km)'], [6000, 'Lointaine (6 km)']] },
    decor:      { label: 'Arbres et décor', hint: 'Part des arbres, fleurs, rochers affichés',
                  choices: [[0.25, '25 %'], [0.5, '50 %'], [1, '100 %']] },
    decorStyle: { label: 'Style du décor', hint: "Réaliste : forêts, villages, rochers et fleurs ; Anciens assets : arbres, fleurs et rochers stylisés d'origine",
                  choices: [['realiste', 'Réaliste'], ['classique', 'Anciens assets']] },
    bloom:      { label: 'Halo lumineux', hint: 'Lueur autour des feux, éclairs, explosion',
                  choices: [[false, 'Désactivé'], [true, 'Activé']] },
    perf:       { label: 'Afficher la fluidité', hint: 'Images par seconde et résolution, en haut à gauche de l\'écran (touche P)',
                  choices: [[false, 'Non'], [true, 'Oui']] },
    // Modèle de vol du Cessna (feuille de route, lot 1) : réaliste par défaut depuis le 21/11/2026 (version 3), simplifié au choix
    flightModel:     { group: 'Pilotage', label: 'Modèle de vol (Cessna)', hint: "Réaliste (par défaut) : avion à 6 axes par forces et moments (oscillations amorties, lacet inverse aux ailerons, décrochage avec aile qui tombe). Simplifié : le modèle d'origine, très stable. Pris en compte au prochain départ ; la carte Mer garde le simplifié",
                       choices: [['realiste', 'Réaliste'], ['simplifie', 'Simplifié']] },
    controlRamp:     { group: 'Pilotage', label: 'Douceur des commandes (clavier, tactile)', hint: "Modèle réaliste : une touche braque la gouverne progressivement, comme une main qui tire de plus en plus sur le manche (profondeur quatre fois plus lentement à basse vitesse, sous 60 kt). Vive (par défaut) : profondeur et ailerons à fond en 1 s ; très vive : 0,5 s ; normale : 2 s ; douce : 3 s",
                       choices: [[0.25, 'Très vive'], [0.5, 'Vive'], [1, 'Normale'], [1.5, 'Douce']] },
    // Effets de l'atmosphère et du moteur ajoutés au lot 3 (turbulence de Dryden, thermiques, givrage du carburateur) :
    // doux par défaut (demande du 21/11/2026 : l'avion était trop secoué)
    atmosphere:      { group: 'Pilotage', label: "Effets de l'atmosphère", hint: "Vent, turbulence (selon la météo), thermiques par beau temps, givrage du carburateur. Doux : vent jamais plus fort que la météo annoncée, rafales et sautes de direction moitié moindres, vent à peine plus fort en altitude, moitié moins de turbulence et de thermiques, givrage trois fois plus lent ; réaliste : valeurs des normes et des abaques ; aucun : vent régulier, air calme, pas de givrage",
                       choices: [['doux', 'Doux'], ['realiste', 'Réaliste'], ['aucun', 'Aucun']] },
    // Aides au pilotage : désactivées par défaut (pilotage réaliste)
    rotationAuto:    { group: 'Pilotage', label: 'Rotation automatique', hint: 'Au sol, le trim lève le nez tout seul au décollage',
                       choices: [[false, 'Désactivée'], [true, 'Activée']] },
    stallProtection: { group: 'Pilotage', label: 'Protection décrochage', hint: 'Manche tiré à fond, l\'aile s\'arrête juste avant le décrochage',
                       choices: [[false, 'Désactivée'], [true, 'Activée']] },
    smoothLiftoff:   { group: 'Pilotage', label: 'Envol en douceur', hint: 'Après l\'envol, manche relâché, le nez se rend progressivement',
                       choices: [[false, 'Désactivé'], [true, 'Activé']] },
    // Palonnier automatique (25/11/2026) : au clavier, sans palonnier, le lacet inverse des ailerons faisait déraper l'avion
    // (15° pour une touche tenue 0,5 s) et osciller l'inclinaison (roulis hollandais) ; activé par défaut
    autoRudder:      { group: 'Pilotage', label: 'Palonnier automatique', hint: "Modèle réaliste : en vol, sans action sur le palonnier, la direction accompagne les ailerons comme les pieds d'un pilote (virages coordonnés, bille au milieu). Désactivé : lacet inverse et dérapage à corriger au palonnier. Coupé d'office quand un axe de direction est affecté à un périphérique (palonnier, torsion du manche, stick)",
                       choices: [[true, 'Activé'], [false, 'Désactivé']] },
    crosswind:       { group: 'Pilotage', label: 'Correction de dérive', hint: "Vent de travers : après l'envol, le nez se met tout seul face au vent et la trajectoire reste dans l'axe (sinon, au pilote de corriger la dérive)",
                       choices: [[false, 'Désactivée'], [true, 'Activée']] },
    heliStability:   { group: 'Pilotage', label: 'Hélicoptère : aide au stationnaire', hint: "R44 : le cyclique commande l'assiette (tenue manche lâché, glissade arrêtée près du stationnaire) et les palonniers la rotation (cap tenu). Désactivée : commandes directes, comme le vrai (très difficile au clavier)",
                       choices: [[true, 'Activée'], [false, 'Désactivée']] },
    hud:             { group: 'Pilotage', label: 'Infos de vol (vue extérieure)', hint: 'Vitesse, moteur, carburant, volets, trim, altitude, vario et cap sur l\'écran',
                       choices: [[true, 'Affichées'], [false, 'Masquées']] },
    // Multijoueur
    labels:          { group: 'Multijoueur', label: 'Étiquettes des joueurs', hint: 'Pseudo, distance et altitude au-dessus des autres avions',
                       choices: [[true, 'Affichées'], [false, 'Masquées']] },
    radioVolume:     { group: 'Multijoueur', label: 'Volume de la radio', hint: 'Voix des autres joueurs (parler : maintenir N)',
                       choices: [[0, 'Coupée'], [0.5, '50 %'], [1, '100 %'], [1.5, '150 %']] },
};
const FLIGHT_DEFAULTS = { flightModel: 'realiste', controlRamp: 0.5, atmosphere: 'doux', hud: true, rotationAuto: false, stallProtection: false, smoothLiftoff: false, autoRudder: true, crosswind: false, heliStability: true, labels: true, radioVolume: 1 };

const PRESETS = {
    // Très bas : pour les téléphones qui ferment la page (mémoire dépassée) : décor d'origine (pas de forêts ni de villages
    // générés, le plus gros poste de mémoire du décor), pas de nuages
    tresbas: { label: 'Très bas', fps: 30, resolution: 'auto', antialias: 0, shadows: 0, clouds: 0, cloudLayer: false, terrain: 128, visibility: 3000, decor: 0.25, decorStyle: 'classique', bloom: false },
    bas:   { label: 'Bas',   fps: 30, resolution: 'auto', antialias: 0, shadows: 0,    clouds: 0.5, cloudLayer: false, terrain: 128, visibility: 3000, decor: 0.25, decorStyle: 'realiste', bloom: false },
    moyen: { label: 'Moyen', fps: 60, resolution: 'auto', antialias: 2, shadows: 1024, clouds: 0.5, cloudLayer: true,  terrain: 256, visibility: 6000, decor: 0.5,  decorStyle: 'realiste', bloom: true },
    haut:  { label: 'Haut',  fps: 60, resolution: 'auto', antialias: 4, shadows: 2048, clouds: 1,   cloudLayer: true,  terrain: 384, visibility: 6000, decor: 1,    decorStyle: 'realiste', bloom: true },
    ultra: { label: 'Ultra', fps: 0,  resolution: 'auto', antialias: 4, shadows: 4096, clouds: 1,   cloudLayer: true,  terrain: 512, visibility: 6000, decor: 1,    decorStyle: 'realiste', bloom: true },
};
const DEFAULT_PRESET = 'haut';
const CUSTOM = 'perso';

// Valeurs d'un préréglage, sans son libellé
function presetValues(preset) {
    const values = { ...preset };
    delete values.label;
    return values;
}

class Settings extends EventTarget {
    // defaultPreset : préréglage tant que le joueur n'a rien choisi (tablette : « moyen »)
    constructor({ defaultPreset = DEFAULT_PRESET } = {}) {
        super();
        const preset = PRESETS[defaultPreset] ? defaultPreset : DEFAULT_PRESET;
        this.preset = preset;
        this.values = { ...PRESETS[preset], perf: false, ...FLIGHT_DEFAULTS };
        delete this.values.label;
        this._load();
        this._selects = {};
        this.persist = true;   // false : réglages jamais écrits dans localStorage (mode test, voir simulator.js)
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
        Object.assign(this.values, presetValues(PRESETS[name]));
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
        for (const [name, preset] of Object.entries(PRESETS)) {
            if (Object.entries(presetValues(preset)).every(([key, value]) => this.values[key] === value)) return name;
        }
        return CUSTOM;
    }

    _changed() {
        for (const [key, select] of Object.entries(this._selects)) select.value = JSON.stringify(this.values[key]);
        if (this._presetSelect) this._presetSelect.value = JSON.stringify(this.preset);
        if (this.persist) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, preset: this.preset, values: this.values }));
            } catch { /* stockage indisponible : réglages valables pour cette visite seulement */ }
        }
        this.dispatchEvent(new CustomEvent('change', { detail: this.values }));
    }

    _load() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        } catch { /* stockage indisponible ou illisible */ }
        if (!saved?.values) return;
        // Réglage absent de la sauvegarde (ajouté depuis) : celui du préréglage enregistré
        if (PRESETS[saved.preset]) {
            Object.assign(this.values, presetValues(PRESETS[saved.preset]));
        }
        // Ne reprend que des valeurs encore proposées (le menu peut évoluer)
        for (const [key, option] of Object.entries(OPTIONS)) {
            // Sauvegarde d'avant la version 2 : style du décor non repris (« Classique » était le défaut des préréglages
            // Bas et Moyen, « Mixte » n'existe plus) -> décor réaliste ; les anciens assets se choisissent exprès
            if (key === 'decorStyle' && (saved.version ?? 1) < 2) continue;
            // Sauvegarde d'avant la version 3 : le modèle simplifié était le défaut (enregistré avec les autres réglages, pas
            // forcément choisi) -> modèle réaliste ; le simplifié se choisit exprès
            if (key === 'flightModel' && (saved.version ?? 1) < 3) continue;
            // Sauvegarde d'avant la version 4 (22/11/2026) : douceur des commandes enregistrée avec les autres réglages
            // (« Normale » était le défaut) -> « Très vive », le nouveau défaut ; les autres se choisissent exprès
            // Sauvegarde d'avant la version 5 (25/11/2026) : « Très vive », défaut des versions 4, enregistré sans être forcément
            // choisi -> « Vive », le nouveau défaut (avec « Très vive », touche tenue 0,5 s à 100 kt : 2,9 g, inclinaison
            // dépassée de 10 à 20° au joueur ; mesures du 25/11/2026)
            if (key === 'controlRamp' && (saved.version ?? 1) < 5) continue;
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
