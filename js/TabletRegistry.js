// Interface tablette (à la manière d'Infinite Flight) : REGISTRE UNIQUE de ce qu'elle propose.
// Boutons principaux (colonne sur le côté) -> catégories -> tuiles (grille de 3 colonnes dans un panneau déplaçable).
// L'affichage (TabletPanels.js) est construit entièrement à partir de ce registre : ajouter une catégorie ou une tuile
// = ajouter une entrée ici, sans toucher au code d'affichage.
//
// Seules des fonctions qui existent déjà dans le simulateur sont branchées ici (barre de menus et ses menus, menu
// Commandes, commandes de la cabine, raccourcis clavier) : elles arrivent par l'objet sim (voir simulator.js,
// tabletApi). Pas d'autopilote dans le simulateur : pas de bouton AP.
//
// Tuile : { id, label, type, ... }
//   type 'button' : action()                      appui = action ; value() facultatif (texte affiché sous le nom)
//   type 'toggle' : action(), value() -> booléen  appui = bascule ; affiche ON / OFF (ou states: [texte off, texte on])
//   type 'value'  : value() -> texte              step(sens) facultatif : boutons − / + ; action() facultatif : appui
//   type 'hold'   : press(), release()            agit tant que le doigt reste posé (parler à la radio, freins)
// Catégorie : { id, label, tiles: [...] }, ou { id, label, element() } : contenu existant du simulateur affiché tel quel
// (menus Météo, Profil, En ligne : leurs réglages ne sont écrits qu'une fois) ; bouton principal : { id, label, categories }

const pct = (v) => `${Math.round(v * 100)} %`;

function tabletRegistry(sim) {
    const { controls } = sim;
    const cockpit = (id, step = 1) => () => sim.useControl({ id }, step);
    const sw = (id, label) => ({ id: `switch-${id}`, label, type: 'toggle', action: cockpit(`switch:${id}`), value: () => sim.systems.switches[id] });

    // Interface iPad : pas de barre de menus en haut (elle faisait doublon avec ces panneaux). Tout ce qu'elle proposait
    // est ici, une seule fois ; le reste est sur les commandes tactiles (Vue, Centrer, Volets, Trim, Freins) ou dans les
    // panneaux de l'écran de vol (VOR : OBS et « Vers balise » ; bouton « ILS disponible »)
    return [
        {
            id: 'sol', label: 'SOL', categories: [
                {
                    id: 'depart', label: 'DÉPART', tiles: [
                        { id: 'reset', label: 'RÉINITIALISER', type: 'button', action: () => sim.click('reset') },
                        { id: 'changer-depart', label: 'CHANGER DE DÉPART', type: 'button', action: () => sim.click('depart') },
                        { id: 'hangar', label: 'HANGAR (CHANGER D’AVION)', type: 'button', action: () => sim.click('retour-hangar') },
                        { id: 'aerodrome', label: 'CHANGER D’AÉRODROME', type: 'button', action: () => sim.click('retour-aerodrome') },
                        { id: 'multijoueur', label: 'MULTIJOUEUR (ÉQUIPE)', type: 'button', action: () => sim.click('online-multi') },
                        { id: 'frein-parking', label: 'FREIN DE PARKING', type: 'toggle', action: cockpit('brake'), value: () => controls.parkingBrake, states: ['DESSERRÉ', 'SERRÉ'] },
                        { id: 'quitter', label: 'QUITTER LA PARTIE', type: 'button', action: () => sim.click('quitter-partie'), danger: true },
                    ],
                },
                {
                    id: 'avion', label: 'AVION', tiles: [
                        { id: 'masse', label: 'MASSE ET CENTRAGE', type: 'button', action: () => sim.click('masse-bouton') },
                    ],
                },
                { id: 'profil', label: 'LIVRÉE ET IMMAT.', element: () => sim.menuContent('profil') },
            ],
        },
        {
            id: 'systemes', label: 'SYSTÈMES', categories: [
                {
                    id: 'electrique', label: 'ÉLECTRIQUE', tiles: [
                        sw('masterBat', 'MASTER BAT'),
                        sw('masterAlt', 'MASTER ALT'),
                        sw('avionics', 'AVIONIQUE 1'),
                        sw('avionics2', 'AVIONIQUE 2'),
                    ],
                },
                {
                    id: 'feux', label: 'FEUX', tiles: [
                        sw('beacon', 'BCN'),
                        sw('land', 'LAND'),
                        sw('taxi', 'TAXI'),
                        sw('nav', 'NAV'),
                        sw('strobe', 'STROBE'),
                        { id: 'eclairage-instruments', label: 'ÉCLAIRAGE INSTR.', type: 'value', value: () => pct(sim.systems.panelLights), step: (s) => sim.useControl({ id: 'panelLights' }, s) },
                        { id: 'plafonnier', label: 'PLAFONNIER', type: 'value', value: () => pct(sim.systems.domeLight), step: (s) => sim.useControl({ id: 'domeLight' }, s, true) },
                    ],
                },
                {
                    id: 'moteur', label: 'MOTEUR', tiles: [
                        { id: 'magnetos', label: 'MAGNÉTOS', type: 'value', value: () => sim.MAGNETOS[sim.systems.magnetos], step: (s) => sim.useControl({ id: 'mags' }, s) },
                        { id: 'mixture', label: 'MIXTURE', type: 'value', value: () => pct(sim.systems.mixture), step: (s) => sim.useControl({ id: 'mixture' }, s) },
                        sw('fuelPump', 'POMPE CARBURANT'),
                        { id: 'selecteur', label: 'SÉLECTEUR CARB.', type: 'value', value: () => sim.FUEL_SELECTOR[sim.systems.fuelSelector], step: (s) => sim.useControl({ id: 'fuelSelector' }, s) },
                        { id: 'robinet', label: 'ROBINET CARB.', type: 'toggle', action: cockpit('fuelShutoff'), value: () => !sim.systems.fuelShutoff, states: ['FERMÉ', 'OUVERT'] },
                        sw('pitotHeat', 'RÉCHAUF. PITOT'),
                    ],
                },
                {
                    // F-15 : mise en route (BATT, JFS, ENG MASTER, lancement), train, aérofrein, verrière, phares
                    id: 'f15', label: 'F-15', tiles: [
                        ...[['battery', 'BATT'], ['masterL', 'ENG MASTER G'], ['masterR', 'ENG MASTER D'], ['genL', 'GÉNÉ. G'], ['genR', 'GÉNÉ. D']].map(([id, label]) => (
                            { id: `jet-${id}`, label, type: 'toggle', action: () => sim.jetCommand(id), value: () => sim.jetSystems.switches[id] })),
                        { id: 'jet-jfs', label: 'JFS', type: 'toggle', action: () => sim.jetCommand('jfs'), value: () => sim.jetSystems.jfsRunning, states: ['ARRÊTÉ', 'EN MARCHE'] },
                        { id: 'jet-crank-l', label: 'LANCER RÉAC. G', type: 'button', action: () => sim.jetCommand('crankL'), value: () => `${Math.round(sim.jetSystems.engines[0].n2)} %` },
                        { id: 'jet-crank-r', label: 'LANCER RÉAC. D', type: 'button', action: () => sim.jetCommand('crankR'), value: () => `${Math.round(sim.jetSystems.engines[1].n2)} %` },
                        { id: 'jet-gear', label: 'TRAIN', type: 'toggle', action: () => sim.jetCommand('gear'), value: () => sim.jetGear(), states: ['RENTRÉ', 'SORTI'] },
                        { id: 'jet-speedbrake', label: 'AÉROFREIN', type: 'toggle', action: () => sim.jetCommand('speedbrake'), value: () => sim.jetSpeedbrake(), states: ['RENTRÉ', 'SORTI'] },
                        { id: 'jet-canopy', label: 'VERRIÈRE', type: 'toggle', action: () => sim.jetCommand('canopy'), value: () => sim.jetSystems.switches.canopy, states: ['FERMÉE', 'OUVERTE'] },
                        { id: 'jet-lights', label: 'PHARES', type: 'button', action: () => sim.jetCommand('lights'), value: () => (sim.jetSystems.switches.land ? 'ATTERR.' : sim.jetSystems.switches.taxi ? 'ROULAGE' : 'ÉTEINTS') },
                    ],
                },
                {
                    // R44 : mise en route (MASTER BATT, mixture, clé, embrayage, poignée des gaz, régulateur), feux ;
                    // régimes moteur et rotor (le collectif est la manette des gaz tactile)
                    id: 'r44', label: 'R44', tiles: [
                        ...[['masterBat', 'MASTER BATT'], ['clutch', 'CLUTCH'], ['governor', 'GOVERNOR'], ['alternator', 'ALT']].map(([id, label]) => (
                            { id: `r44-${id}`, label, type: 'toggle', action: () => sim.heliCommand(id), value: () => sim.heliSystems.switches[id] })),
                        { id: 'r44-key', label: 'CLÉ (+ : START)', type: 'value', value: () => ['OFF', 'R', 'L', 'BOTH', 'START'][sim.heliSystems.key], step: (s) => sim.heliCommand('key', s) },
                        { id: 'r44-mixture', label: 'MIXTURE', type: 'toggle', action: () => sim.heliCommand('mixture'), value: () => sim.heliSystems.mixture > 0.5, states: ['COUPÉE', 'RICHE'] },
                        { id: 'r44-grip', label: 'POIGNÉE DES GAZ', type: 'value', value: () => pct(sim.heliSystems.grip), step: (s) => sim.heliSystems.setGrip(sim.heliSystems.grip + 0.05 * s) },
                        { id: 'r44-rpm', label: 'MOTEUR / ROTOR', type: 'button', action: () => {},
                            value: () => `${Math.round(sim.heliSystems.enginePercent)} / ${Math.round(sim.heliModel.rotorPercent)} %` },
                        ...[['nav', 'NAV'], ['strobe', 'ANTICOLL.'], ['land', 'PHARES']].map(([id, label]) => (
                            { id: `r44-${id}`, label, type: 'toggle', action: () => sim.heliCommand(id), value: () => sim.heliSystems.switches[id] })),
                    ],
                },
                {
                    id: 'nav', label: 'NAV ET VUE', tiles: [
                        { id: 'vor-ils', label: 'VOR / ILS', type: 'toggle', action: () => sim.toggleNavPanels(), value: () => sim.navPanelsShown(), states: ['MASQUÉS', 'AFFICHÉS'] },
                        { id: 'camera', label: 'CAMÉRA CABINE', type: 'value', value: () => String(sim.cabinView()), step: (s) => sim.stepCabinView(s) },
                    ],
                },
            ],
        },
        {
            id: 'radio', label: 'RADIO', categories: [
                {
                    id: 'tour', label: 'TOUR', tiles: [
                        { id: 'fenetre-radio', label: 'FENÊTRE RADIO', type: 'toggle', action: () => sim.toggleAtc(), value: () => sim.atcOpen(), states: ['FERMÉE', 'OUVERTE'] },
                        { id: 'frequence', label: 'FRÉQUENCE', type: 'value', value: () => sim.atcStation() },
                        { id: 'parler', label: 'PARLER (JOUEURS)', type: 'hold', press: () => sim.setTalking(true), release: () => sim.setTalking(false) },
                    ],
                },
                { id: 'en-ligne', label: 'EN LIGNE', element: () => sim.menuContent('online') },
            ],
        },
        {
            id: 'affichage', label: 'AFFICHAGE', categories: [
                { id: 'meteo', label: 'MÉTÉO', element: () => sim.menuContent('météo') },
                {
                    id: 'ecran', label: 'ÉCRAN', tiles: [
                        { id: 'carte', label: 'CARTE', type: 'toggle', action: () => sim.toggleMap(), value: () => sim.mapOpen(), states: ['FERMÉE', 'OUVERTE'] },
                        { id: 'photo', label: 'MODE PHOTO', type: 'button', action: () => sim.togglePhotoMode() },
                        { id: 'parametres', label: 'PARAMÈTRES', type: 'button', action: () => sim.openSettings() },
                    ],
                },
            ],
        },
    ];
}

export { tabletRegistry };
