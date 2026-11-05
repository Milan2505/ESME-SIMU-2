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
    const { systems, controls } = sim;
    const cockpit = (id, step = 1) => () => sim.useControl({ id }, step);
    const sw = (id, label) => ({ id: `switch-${id}`, label, type: 'toggle', action: cockpit(`switch:${id}`), value: () => systems.switches[id] });

    // Un seul emplacement par fonction sur iPad : ne figure ici que ce qui n'est ni dans la barre de menus (Météo, Carte,
    // Tour et sa fenêtre radio, En ligne, Profil, Paramètre, Masse et centrage, Mode photo, Plein écran, Quitter), ni sur
    // les commandes tactiles (Menus, Vue, Centrer, Volets, Trim, Freins), ni dans les panneaux de l'écran de vol (VOR :
    // OBS et « Vers balise » ; bouton « ILS disponible »). Le menu Commandes de la barre est masqué sur iPad : ses
    // fonctions sans autre place (Réinitialiser, Changer de départ, VOR / ILS) sont ici
    return [
        {
            id: 'sol', label: 'SOL', categories: [
                {
                    id: 'depart', label: 'DÉPART', tiles: [
                        { id: 'reset', label: 'RÉINITIALISER', type: 'button', action: () => sim.click('reset') },
                        { id: 'changer-depart', label: 'CHANGER DE DÉPART', type: 'button', action: () => sim.click('depart') },
                        { id: 'frein-parking', label: 'FREIN DE PARKING', type: 'toggle', action: cockpit('brake'), value: () => controls.parkingBrake, states: ['DESSERRÉ', 'SERRÉ'] },
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
                    id: 'nav', label: 'NAV ET VUE', tiles: [
                        { id: 'vor-ils', label: 'VOR / ILS', type: 'toggle', action: () => sim.toggleNavPanels(), value: () => sim.navPanelsShown(), states: ['MASQUÉS', 'AFFICHÉS'] },
                        { id: 'camera', label: 'CAMÉRA CABINE', type: 'value', value: () => String(sim.cabinView()), step: (s) => sim.stepCabinView(s) },
                        { id: 'parler', label: 'PARLER (RADIO)', type: 'hold', press: () => sim.setTalking(true), release: () => sim.setTalking(false) },
                    ],
                },
            ],
        },
    ];
}

export { tabletRegistry };
