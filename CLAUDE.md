# Simulateur de vol ESME

Simulateur de vol dans le navigateur (three.js, modules ES, aucun outil de construction) : site 100 % statique publié
par GitHub Pages depuis la branche `main`. Trois appareils (Cessna 172P, F-15C Eagle, Robinson R44), trois cartes
(Campagne, Ville, Mer avec porte-avions), multijoueur sans serveur (relais MQTT publics). Code et commentaires en
français. Feuille de route des chantiers : `docs/feuille-de-route.md`.

## Vérifier son travail (obligatoire)

Outillage : Node.js LTS ; une fois : `npm install`, puis `npx playwright install chromium` pour les tests de bout en bout.
Le site reste statique : `package.json` ne sert qu'aux vérifications, rien de `node_modules` n'est publié.

| Commande | Contenu | Durée |
|---|---|---|
| `npm run lint` | ESLint, règles recommandées (`eslint.config.js`) sur tout le code | ~5 s |
| `npm test` | tests Node (`tests/*.test.js`) : modèles de vol, atmosphère, moteur et hélice, comportements réglés en jeu (non-régression), ILS, VOR, vent, masse et centrage, import map, performances C172P | ~3 s |
| `npm run check` | lint + tests Node : **à lancer après chaque modification** | ~5 s |
| `npm run test:e2e` | Playwright (`tests/e2e/`) : le vrai simulateur dans Chromium sans fenêtre, WebGL logiciel, sans réseau | ~2,5 min |
| `npm run check:full` | check + test:e2e | ~3 min |

Règles :
- Ne jamais annoncer une tâche finie sans `npm run check` vert, et dire quels tests couvrent la modification (tests
  existants qui l'exercent, ou tests ajoutés). Pas de test qui la couvre : le dire aussi.
- `npm run check:full` est obligatoire quand la modification touche au rendu (Graphics, shaders, modèles 3D, cabines),
  à l'interface (`index.html`, `style.css`, menus, fenêtres, tactile), au chargement (`Loading.js`, écran de chargement,
  assets, import map) ou à `simulator.js`, et toujours en fin de lot.
- Toute modification du modèle de vol (`FlightModel.js`, `RigidBodyModel.js`, `data/C172pAero.js`, `InputRamp.js`, `HeliModel.js`, `Cessna172.js`, `F15.js`, `PlaneControls.js`,
  `Atmosphere.js`, `Propulsion.js`)
  doit garder les tests de performances verts (`tests/perf-c172.test.js`) ou les faire passer au vert. Ne jamais
  assouplir une tolérance ni changer une source : elles viennent du manuel de vol du 172P (POH édition 1985,
  D1251-13, relu sur scan ; mêmes performances que 1981) et de la fiche FAA TCDS 3A12 (rév. 69, p. 13-14), chaque
  valeur avec sa figure et sa page. `tests/flight-regression.test.js` (envol sans saut, arrondi,
  vent de travers, relâchement du manche : bornes mesurées sur le modèle d'avant le lot 1) doit rester vert aussi.
- Variante de référence : Cessna 172P (1981, Lycoming O-320-D2J de 160 ch, 2 400 lb) partout : modèle 3D, sons, moteur,
  masse et centrage (`WeightBalance.js`), performances. Ce qui n'a pas été relu dans une source primaire est marqué
  « non relu » dans le code.
- Un seul test en `todo` : la vrille établie (`flying-qualities.test.js`, reste à faire du lot 1). Un todo
  ne se pose que pour un chantier identifié de la feuille de route, jamais pour faire passer une vérification.
- Un test qui échoue à cause du banc d'essai (automatisme de test, tolérance numérique de l'intégration) se corrige dans
  `tests/helpers/` ; un test qui échoue parce que le simulateur est faux reste rouge.

## Mode test du simulateur (`?test=1`)

`index.html?test=1` (voir `TEST_MODE` dans `simulator.js`) : multijoueur coupé (`Multiplayer.offline`), arbres EZ-Tree
du CDN non chargés (`Scenery` : `trees: false`), voix radio de l'ordinateur, musique du mode troll coupée, service worker
non enregistré, graines fixes (vent, rafales, aile qui tombe : `Random.js`), qualité « Bas » sans toucher aux réglages
enregistrés (`Settings.persist = false`). `window.__sim` : `phase` (chargement, menu, carte, aerodrome, hangar, depart,
vol, crash), `state` (vitesse, altitude, cap, moteur…), `controls`, `model`, `setThrottle`, `setInput`, `setFlapLevel`,
`errors`. `window.esmeDebug` existe aussi, en tout mode. Les tests e2e (`tests/e2e/vol.spec.js`) passent par les vrais
boutons du menu ; `tests/e2e/server.js` sert `index.html` avec three et mqtt pris dans `node_modules` (versions
épinglées dans `package.json`, vérifiées par `tests/import-map.test.js`) ; les captures sont dans `test-results/`.

## Git

- Message de commit : une ligne au format `type(zone): résumé` (ex. `fix(carrier): brin d'arrêt tient plein gaz`),
  puis une ligne vide et le détail (ce qui change, pourquoi, tests qui le couvrent). Types : `feat`, `fix`, `perf`,
  `refactor`, `test`, `docs`, `chore`. Zones : `flight`, `heli`, `f15`, `carrier`, `atc`, `ui`, `audio`, `multi`,
  `scenery`, `terrain`, `tests`, `tooling`… **Jamais la réponse du chat comme message de commit.**
- Ne pas committer `node_modules/`, `test-results/`, `playwright-report/`, `*.blend1` (voir `.gitignore`).

## Numéro de version (obligatoire après chaque modification)

Le numéro affiché au menu principal (« Version 0.N (date) ») vient de `js/Version.js`, généré par `tools/version.sh`
(N = nombre de commits, celui qu'on prépare compris).

À la fin de chaque tâche qui modifie le projet :
1. lancer `sh tools/version.sh` (après la dernière modification de fichier) ;
2. donner le numéro dans la réponse finale : « Version 0.N », N lu dans `js/Version.js`.

Ne jamais modifier `js/Version.js` à la main.

## Carte de l'architecture

Site statique : `index.html` (page, menus, fenêtres, scripts en ligne : relance après un démarrage raté, menu contextuel
coupé, import map three / mqtt depuis jsdelivr), `style.css`, `simulator.js` (cœur : ~6 500 lignes, voir plus bas), les
modules de `js/`, `sw.js` (service worker : dernière version servie malgré le cache de GitHub Pages, assets et CDN en
cache), `manuel.html` + `manuel.js` + `manuel.css` (manuel du joueur), `asset/` (modèles 3D, sons, textures, vidéos du
menu ; `asset/blender/` : scripts et sources Blender), `data/` (CSV du décor), `tools/` (version.sh, musique du mode troll).

`simulator.js` tient la scène three.js, la boucle d'images (`drawFrame`), les menus (principal, carte, aérodrome, hangar,
départ), les caméras, les fenêtres (paramètres, météo, carte, tour, en ligne, profil, masse et centrage), le mode test
(`TEST_MODE`, `window.__sim`), le branchement de tout ce qui suit, et les branches par appareil (`aircraftType`).

Appareils et physique (`js/`) :
- `FlightModel.js` : modèle de vol des avions (portance par demi-aile, traînée, poussée, effet de sol, décrochage,
  roulage, toucher, obstacles, dégâts) ; commandes et événements `liftoff` / `touchdown` / `crash`. `random` : tirage
  remplaçable (rafales, aile qui tombe). Propriétés de l'instance : `mass`, `cgOffset`, `mixture`, `temperatureOffset`
  (l'objet des caractéristiques n'est jamais modifié) ; vitesses `airspeed` (TAS), `calibratedSpeed` (CAS),
  `indicatedSpeed` (IAS), `mach`, régime `rpm`. `Cessna172.js`, `F15.js` : caractéristiques (le Cessna : blocs `engine`,
  `propeller`, `airspeedCalibration` du POH 172P). `Atmosphere.js` : atmosphère type OACI avec écart de température, et
  conversions TAS / CAS / IAS. `Propulsion.js` : moteur à pistons (puissance selon régime, densité, mixture) et hélice à
  pas fixe (Ct, Cp selon le paramètre d'avancement J), régime par équilibre des couples, moulinet moteur coupé.
  `RigidBodyModel.js` : modèle « réaliste » du Cessna (hérite de FlightModel, même interface) : corps rigide à 6 axes par
  forces et moments, train ressort-amortisseur, décrochage et vrille ; données sous GPL-2.0 dans `data/C172pAero.js` (UIUC,
  JSBSim c172p). Choisi par le réglage « Modèle de vol (Cessna) » (`flightModel`, simplifié par défaut), au départ
  (`syncPlaneModel` dans simulator.js), jamais sur la carte Mer. `InputRamp.js` : montée progressive des commandes
  clavier et tactiles du modèle réaliste (réglage `controlRamp`). `HeliModel.js` : hélicoptère R44
  (élément de pale, patins), même interface. `PlaneControls.js` : clavier et tactile -> commandes du modèle, valeurs
  des instruments. `Random.js` : tirage à graine (mulberry32).
- Systèmes : `Systems.js` (C172 : électricité, moteur, carburant, dépression, feux), `JetSystems.js` (F-15 : JFS,
  réacteurs, postcombustion), `R44Systems.js` (R44 : embrayage, régulateur). `Damage.js`, `Shield.js`, `Weapons.js`,
  `WeaponHud.js`, `F15Stores.js`, `F15Warnings.js` : combat (F-15, multijoueur).
- Modèles 3D et cabines : `C172Model.js`, `Cockpit.js`, `Panel172.js`, `InstrumentArt.js`, `PanelControls.js`,
  `Controls3D.js`, `ControlSurfaces.js`, `AircraftLights.js`, `LightFlare.js`, `Liveries.js` (Cessna) ; `F15Model.js`,
  `F15Cockpit.js`, `F15Displays.js` (F-15) ; `R44Model.js`, `FGAnimator.js` (R44, animations FlightGear).
  `Utils3d.js`, `MergeStatic.js`, `CanvasMemory.js` : chargement et optimisations.
- Sons : `AudioUnlock.js` (contexte audio unique), `EngineSound.js`, `JetSound.js`, `R44Sound.js`, `SoundEffects.js`,
  `StallWarning.js`, `BankAngleWarning.js`, `TerrainWarning.js`.
- Monde : `Terrain.js` (relief procédural, dalles, lacs), `Airport.js` (aérodromes ESME et AIX : pistes, parking,
  hangars, départs, VOR, ILS), `Carrier.js` (porte-avions, carte Mer), `City.js` (carte Ville), `Scenery.js` (forêts
  EZ-Tree depuis le CDN, villages), `Nature.js` (rochers, fleurs), `Clouds.js`, `CloudLayer.js`, `Storm.js`,
  `NightSky.js`, `Graphics.js` (rendu, résolution, post-traitement), `Billboards.js`, `CrashEffect.js`, `Wind.js`
  (vent à graine), `PlaneCollision.js`.
- Navigation et radio : `ILS.js`, `VOR.js`, `Avionics.js` (radios du tableau, calage altimétrique), `ATC.js`
  (contrôleur à règles, bilingue), `RadioVoices.js` + `VoiceWorker.js` (voix Piper dans un worker, modèles téléchargés),
  `Radio.js` (voix entre joueurs), `MapView.js` (carte vue de dessus), `FlightHud.js` (infos de vol en vue extérieure).
- Multijoueur : `Multiplayer.js` (relais MQTT publics, `offline` en mode test), `RemotePlayers.js`, `Chat.js`.
- Interface : `Settings.js` (qualité, aides au pilotage ; `persist`), `TouchControls.js`, `TabletRegistry.js`,
  `TabletPanels.js`, `Draggable.js`, `Device.js`, `Loading.js` (écran de chargement, suivi des chargements),
  `Initiation.js` (leçon guidée), `WeightBalance.js` (masse et centrage, `computeLoad` pur), `DataLoader.js`,
  `Version.js` (généré).

Tests (`tests/`) : `helpers/flight.js` (banc d'essai du modèle de vol : avion seul, automatismes de test, vitesses
tenues en indiqué), `flight-regression.test.js` (comportements réglés en jeu), `atmosphere.test.js`, `propulsion.test.js`,
`perf-c172.test.js` (performances contre le POH 172P), `*-realiste.test.js` (mêmes tests sur le modèle réaliste),
`flying-qualities.test.js` (modes propres comparés au modèle linéaire UIUC, spirale, lacet inverse, vrille),
`keyboard-pilot.test.js` (joueur au clavier sur le modèle réaliste), `helpers/modes.js` (modèle linéaire, identification),

`helpers/c172-perf.js` (procédures de mesure), `*.test.js` (node --test), `e2e/server.js` (serveur local, CDN remplacé
par node_modules), `e2e/vol.spec.js` (scénarios Playwright), `e2e/realiste.spec.js` (modèle réaliste : initiation, vol libre), `playwright.config.js`, `eslint.config.js`.
