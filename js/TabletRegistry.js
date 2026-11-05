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
// Catégorie : { id, label, tiles: [...] } ; bouton principal : { id, label, categories: [...] }

const pct = (v) => `${Math.round(v * 100)} %`;

function tabletRegistry(sim) {
    const { systems, controls, vor, atc } = sim;
    const cockpit = (id, step = 1) => () => sim.useControl({ id }, step);
    const sw = (id, label) => ({ id: `switch-${id}`, label, type: 'toggle', action: cockpit(`switch:${id}`), value: () => systems.switches[id] });

    return [
        {
            id: 'sol', label: 'SOL', categories: [
                {
                    id: 'avion', label: 'AVION', tiles: [
                        { id: 'masse', label: 'MASSE ET CENTRAGE', type: 'button', action: () => sim.click('masse-bouton') },
                        { id: 'profil', label: 'LIVRÉE / IMMAT.', type: 'button', action: () => sim.openBarMenu('profil'), value: () => atc.registration },
                        { id: 'frein-parking', label: 'FREIN DE PARKING', type: 'toggle', action: cockpit('brake'), value: () => controls.parkingBrake, states: ['DESSERRÉ', 'SERRÉ'] },
                    ],
                },
                {
                    id: 'depart', label: 'DÉPART', tiles: [
                        { id: 'reset', label: 'RÉINITIALISER', type: 'button', action: () => sim.click('reset') },
                        { id: 'changer-depart', label: 'CHANGER DE DÉPART', type: 'button', action: () => sim.click('depart') },
                        { id: 'menu-principal', label: 'MENU PRINCIPAL', type: 'button', action: () => sim.click('menu-principal-bouton') },
                        { id: 'quitter', label: 'QUITTER LA PARTIE', type: 'button', action: () => sim.click('quitter-partie'), danger: true },
                    ],
                },
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
                        { id: 'eclairage-instruments', label: 'ÉCLAIRAGE INSTR.', type: 'value', value: () => pct(systems.panelLights), step: (s) => sim.useControl({ id: 'panelLights' }, s) },
                        { id: 'plafonnier', label: 'PLAFONNIER', type: 'value', value: () => pct(systems.domeLight), step: (s) => sim.useControl({ id: 'domeLight' }, s, true) },
                    ],
                },
                {
                    id: 'moteur', label: 'MOTEUR', tiles: [
                        { id: 'magnetos', label: 'MAGNÉTOS', type: 'value', value: () => sim.MAGNETOS[systems.magnetos], step: (s) => sim.useControl({ id: 'mags' }, s) },
                        { id: 'mixture', label: 'MIXTURE', type: 'value', value: () => pct(systems.mixture), step: (s) => sim.useControl({ id: 'mixture' }, s) },
                        sw('fuelPump', 'POMPE CARBURANT'),
                        { id: 'selecteur', label: 'SÉLECTEUR CARB.', type: 'value', value: () => sim.FUEL_SELECTOR[systems.fuelSelector], step: (s) => sim.useControl({ id: 'fuelSelector' }, s) },
                        { id: 'robinet', label: 'ROBINET CARB.', type: 'toggle', action: cockpit('fuelShutoff'), value: () => !systems.fuelShutoff, states: ['FERMÉ', 'OUVERT'] },
                        sw('pitotHeat', 'RÉCHAUF. PITOT'),
                    ],
                },
                {
                    id: 'commandes', label: 'COMMANDES', tiles: [
                        { id: 'volets', label: 'FLAPS', type: 'value', value: () => `${controls.getFlapSetting()}°`, step: (s) => sim.useControl({ id: 'flaps:lever' }, s) },
                        { id: 'trim', label: 'TRIM', type: 'value', value: () => `${sim.trimDegrees().toFixed(0)}°`, step: (s) => sim.useControl({ id: 'trimWheel' }, s) },   // + : à cabrer
                        { id: 'freins', label: 'FREINS', type: 'hold', press: () => sim.setBrakes(true), release: () => sim.setBrakes(false) },
                    ],
                },
                {
                    id: 'nav', label: 'NAV', tiles: [
                        { id: 'vor-ils', label: 'VOR / ILS', type: 'toggle', action: () => sim.toggleNavPanels(), value: () => sim.navPanelsShown(), states: ['MASQUÉS', 'AFFICHÉS'] },
                        { id: 'ils', label: 'ILS NAV 1', type: 'button', action: () => sim.toggleIls(), value: () => sim.ilsLabel() },
                        { id: 'crs1', label: 'CRS 1', type: 'value', value: () => `${String(vor.course).padStart(3, '0')}°`, step: (s) => sim.useControl({ id: 'obs' }, s) },
                        { id: 'vers-balise', label: 'VERS BALISE', type: 'button', action: () => vor.centerTo() },
                        { id: 'carte', label: 'CARTE', type: 'toggle', action: () => sim.toggleMap(), value: () => sim.mapOpen() },
                    ],
                },
                {
                    id: 'radio', label: 'RADIO', tiles: [
                        { id: 'tour', label: 'TOUR (RADIO)', type: 'toggle', action: () => sim.toggleAtc(), value: () => sim.atcOpen() },
                        { id: 'atis', label: "ÉCOUTER L'ATIS", type: 'button', action: () => sim.click('atc-atis'), value: () => `INFO ${atc.atisLetter}` },
                        { id: 'quitter-frequence', label: 'QUITTER LA FRÉQ.', type: 'button', action: () => sim.click('atc-quitter') },
                        { id: 'voix', label: 'VOIX', type: 'toggle', action: () => sim.setAtcVoice(!atc.voice), value: () => atc.voice },
                        { id: 'langue', label: 'LANGUE', type: 'value', value: () => atc.lang.toUpperCase(), action: () => sim.setAtcLanguage(atc.lang === 'fr' ? 'en' : 'fr') },
                        { id: 'multijoueur', label: 'MULTIJOUEUR', type: 'button', action: () => sim.click('online-multi') },
                        { id: 'micro', label: 'ACTIVER LE MICRO', type: 'button', action: () => sim.click('radio-activer') },
                        { id: 'parler', label: 'PARLER', type: 'hold', press: () => sim.setTalking(true), release: () => sim.setTalking(false) },
                    ],
                },
                {
                    id: 'interface', label: 'INTERFACE', tiles: [
                        { id: 'vue', label: 'VUE', type: 'button', action: () => sim.toggleView(), value: () => (sim.chaseView() ? 'EXTÉRIEURE' : 'CABINE') },
                        { id: 'recentrer', label: 'RECENTRER', type: 'button', action: () => sim.recenterCamera() },
                        { id: 'camera', label: 'CAMÉRA CABINE', type: 'value', value: () => String(sim.cabinView()), step: (s) => sim.stepCabinView(s) },
                        { id: 'photo', label: 'MODE PHOTO', type: 'toggle', action: () => sim.togglePhotoMode(), value: () => sim.photoMode() },
                        { id: 'plein-ecran', label: 'PLEIN ÉCRAN', type: 'toggle', action: () => sim.toggleFullscreen(), value: () => sim.fullscreen() },
                        { id: 'hud', label: 'INFOS DE VOL', type: 'toggle', action: () => sim.toggleSetting('hud'), value: () => sim.setting('hud') !== false },
                        { id: 'fluidite', label: 'FLUIDITÉ (I/S)', type: 'toggle', action: () => sim.toggleSetting('perf'), value: () => Boolean(sim.setting('perf')) },
                        { id: 'meteo', label: 'MÉTÉO', type: 'value', value: () => sim.weatherLabel(), step: (s) => sim.stepWeather(s) },
                        { id: 'parametres', label: 'PARAMÈTRES', type: 'button', action: () => sim.openSettings() },
                    ],
                },
            ],
        },
    ];
}

export { tabletRegistry };
