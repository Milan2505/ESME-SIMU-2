# ESME-SIMU-2 : feuille de route d'améliorations pour Claude Code

Version analysée : 0.428 (14/11/2026), 428 commits, environ 44 000 lignes (simulator.js 6 553, style.css 5 017, 78 modules dans js/).

## 1. Constat

### Ce qui est déjà solide

- Code propre : ESLint (règles d'erreur) ne trouve aucune variable indéfinie, aucun code mort bloquant ; seulement 22 imports ou variables inutilisés.
- Commentaires abondants et précis, chaque réglage est justifié.
- Multijoueur sans serveur (MQTT public, trois relais), messages entrants filtrés champ par champ, tchat affiché en `textContent` (pas d'injection HTML possible).
- Boucle d'images protégée (une erreur ne fige plus le jeu), pas de physique fixe à 1/120 s.
- Contenu riche : trois appareils (C172, F-15C, R44), ATC à règles bilingue, ILS, VOR, DME, masse et centrage, initiation guidée, météo, combat.

### Ce qui bloque un saut de qualité

| # | Constat | Preuve |
|---|---|---|
| 1 | Claude Code ne teste presque jamais ce qu'il livre | La majorité des messages de commit récents disent « pas testé dans le navigateur », « Chrome sans fenêtre refusé », « VS Code ne signale aucune erreur ». Aucun test, aucun package.json, aucune commande de vérification dans CLAUDE.md |
| 2 | Le Cessna monte beaucoup trop bien | Mesure hors navigateur (FlightModel.js seul, niveau de la mer, plein gaz, masse 1 100 kg) : 1 230 ft/min à 86 kt et 1 360 ft/min à 75 kt. Le manuel du C172 donne environ 700 à 730 ft/min au niveau de la mer à la masse maxi |
| 3 | L'altitude n'a aucun effet sur le Cessna | `Cessna172.js` n'a pas `densityAltitude` : densité fixe à 1,225 kg/m³, vitesse indiquée égale à la vitesse vraie, pas de plafond, puissance moteur indépendante de l'altitude |
| 4 | Le « virage engagé » annoncé dans les commentaires n'existe pas | Mesure : manche lâché depuis 76° d'inclinaison, l'avion revient seul à 2° en 50 s. Depuis 44°, à 1° en 60 s. Le vrai C172 est neutre à légèrement instable en spirale |
| 5 | Tangage et lacet ne sont pas de la dynamique | Dans `_updateFlight`, le manche fixe une incidence visée et la vitesse de tangage est calculée directement (taux commandé, pas de moment ni d'inertie). Seul le roulis passe par un moment et une inertie. Pas de vrille possible |
| 6 | Variante du Cessna incohérente | Modèle 3D, moteur 160 ch et sons : 172P. Masse et centrage, performances : manuel du 172S (180 ch, injection) |
| 7 | Aucun manche, palonnier ou yoke USB | Aucun appel à `navigator.getGamepads()` dans tout le projet |
| 8 | QNH figé à 1013 | `ATC.js` : « le QNH reste standard : l'altimètre de l'avion n'a pas de calage », alors que la fenêtre de calage existe dans `Avionics.js` |
| 9 | Pas de pilote automatique | Le disjoncteur AUTOPILOT existe dans `Systems.js`, rien derrière |
| 10 | Architecture : un module central énorme | simulator.js : 6 553 lignes, 106 `let` globaux, 247 accès au DOM, 57 branches `aircraftType === …` / `jet &&` / `heli &&` |
| 11 | Masse modifiée sur l'objet partagé | `updateLoad()` écrit `controls.model.aircraft.mass`, c'est-à-dire la constante exportée `CESSNA_172` |
| 12 | Site lourd | asset/ = 157 Mo, dont 44 Mo de sons en double (WAV 29 Mo + FLAC 16 Mo), 14 Mo de fichiers Blender (dont `cabin.blend1`, une sauvegarde automatique) publiés sur GitHub Pages. Dépôt .git = 148 Mo |
| 13 | Messages de commit inutilisables | Le message de commit est la réponse de Claude au chat (« Tu avais raison de garder les gaz… »). L'historique ne dit pas ce qui a changé |
| 14 | .gitignore hors sujet | Modèle Python (Django, Celery…) ; rien pour node_modules, rapports de test, `*.blend1` |

Mesures du point 2 à 4 : script Node qui charge `FlightModel.js` et `Cessna172.js` tels quels, sans le reste du jeu. Le décollage (250 m de roulement, 410 m au passage des 15 m) et le plané moteur réduit (finesse proche de 10) sont, eux, cohérents.

## 2. Comment lancer ces chantiers dans Claude Code

1. Un lot par session. Faire `/clear` entre deux lots.
2. Commencer chaque lot en mode plan (Maj+Tab), relire le plan, puis le laisser exécuter.
3. Lot 0 obligatoire en premier : tous les autres lots s'appuient sur ses tests.
4. Ordre conseillé : 0, 1, 2, 3, 4, puis le reste selon l'envie.
5. Après chaque lot, jouer soi-même 10 minutes avant de passer au suivant.

## 3. Les lots

---

### Lot 0. Banc de test et règles de travail (prérequis)

**Pourquoi** : sans moyen de lancer le jeu et de mesurer, chaque correction est une hypothèse. C'est la cause directe des « pas testé » de l'historique.

**Prompt à coller :**

```
Objectif : que tu puisses vérifier toi-même chaque modification du simulateur, sans moi.

1. Crée un package.json à la racine (devDependencies uniquement, le site reste 100 % statique sur GitHub Pages)
   avec : eslint, playwright (Chromium), three@0.174.0 et mqtt@5.14.1 en local pour les tests.
2. Tests unitaires Node (node --test, dossier tests/) sur FlightModel.js, HeliModel.js et les modules sans DOM
   (WeightBalance computeLoad, ILS, VOR, Wind avec graine fixe). Ajoute un mode déterministe : graine fixe pour
   tous les Math.random des modèles de vol (rafales, aile qui tombe au décrochage) via un générateur injectable.
3. Tests de performances du C172 contre le manuel de vol (tests/perf-c172.test.js) : roulement et passage des 50 ft,
   taux de montée à Vy au niveau de la mer et à 5 000 ft, vitesse maxi en palier, vitesses de décrochage lisse et
   volets 30°, finesse et vitesse de meilleur plané, rayon et taux de virage à 30° et 45°. Chaque valeur avec sa
   tolérance et sa source (page du manuel). Les tests qui échouent aujourd'hui doivent échouer : ne les assouplis pas.
4. Test de bout en bout Playwright (tests/e2e/) : sert le dossier avec un petit serveur Node, ouvre index.html dans
   Chromium sans fenêtre (WebGL logiciel SwiftShader si pas de GPU), réécrit l'import map pour charger three et mqtt
   depuis node_modules (pas de réseau requis), puis : menu principal sans erreur console, départ en vol libre C172,
   10 s de vol, capture d'écran, idem F-15 et R44, idem cartes Ville et Mer. Ajoute un paramètre d'URL ?test=1 qui
   coupe le multijoueur, les arbres EZ-Tree du CDN et la musique, et expose window.__sim (état du modèle de vol,
   commandes) pour piloter et lire l'état depuis le test.
5. Scripts npm : "lint", "test", "test:e2e", "check" (les trois).
6. Donne-toi les permissions dans .claude/settings.json pour lancer npm, npx playwright et node sans me demander.
7. Remplace .gitignore par un fichier adapté (node_modules, test-results, playwright-report, *.blend1, .DS_Store)
   et retire asset/blender/cabin.blend1 du dépôt.
8. Corrige les 22 imports et variables inutilisés signalés par ESLint.
9. Réécris CLAUDE.md : carte de l'architecture (rôle de chaque module), commandes de test, et ces règles :
   - ne jamais annoncer une tâche finie sans "npm run check" vert, et dire quels tests couvrent la modification ;
   - toute modification du modèle de vol doit garder les tests de performances verts (ou les faire passer au vert) ;
   - message de commit : une ligne au format "type(zone): résumé" (ex. "fix(carrier): brin d'arrêt tient plein gaz"),
     puis le détail ; jamais la réponse du chat ;
   - garder la règle existante sur tools/version.sh.
Livre : la liste des tests, ceux qui échouent aujourd'hui et pourquoi.
```

**Critères d'acceptation** : `npm run check` tourne sur ma machine Windows et chez toi ; au moins un test e2e par appareil et par carte ; tests de perfs C172 présents (en rouge pour la montée, c'est attendu).

---

### Lot 1. Modèle de vol 6 degrés de liberté (le plus gros gain de réalisme)

**Pourquoi** : points 2, 3, 4, 5 et 6 du constat. Aujourd'hui l'avion est très agréable mais « sur rails » en tangage et en lacet : pas de vraie dynamique de courte période, pas de vrille, spirale toujours stable, performances indépendantes de l'altitude.

**Prompt à coller :**

```
Refais le cœur de FlightModel.js en modèle 6 degrés de liberté par forces ET moments, en gardant exactement son
interface publique (commandes, événements liftoff / touchdown / crash, assists, damage, train, volets, trim, cgOffset,
wind, turbulence) pour que le reste du jeu ne change pas.

Contraintes physiques :
- Corps rigide : forces et moments dans le repère avion, tenseur d'inertie (Ixx, Iyy, Izz, Ixz) du C172, intégration
  à pas fixe (1/120 s ou plus fin), quaternion d'attitude.
- Coefficients aérodynamiques en dérivées de stabilité : CL(α, volets, effet de sol), CD, CY(β), Cl(β, p, r, δa, δr),
  Cm(α, q, α̇, δe, volets, effet de sol, centrage), Cn(β, p, r, δa, δr). Décrochage par tables CL(α) au-delà de αmax,
  avec hystérésis, aile qui tombe, et vrille possible (autorotation) sans aide « protection décrochage ».
- Profondeur, ailerons, direction et trim deviennent des braquages de gouvernes qui créent des moments ; plus aucune
  vitesse de rotation imposée. Les aides au pilotage existantes restent, mais réalisées comme de vraies aides (petite
  boucle de commande au-dessus du modèle), désactivées par défaut comme aujourd'hui.
- Atmosphère type ISA pour TOUS les appareils (densité, pression, température, vitesse du son), plus l'écart de
  température de la météo. Vitesse indiquée calculée depuis la pression dynamique (IAS, CAS, TAS distinctes).
- Hélice à pas fixe : traction et couple selon le paramètre d'avancement J et le régime ; moteur dont la puissance
  dépend de la densité, du régime et de la mixture (le reste de Systems.js lit la puissance comme avant).
- Effets moteur (souffle hélicoïdal, facteur P, couple, effet gyroscopique) en moments, pas en vitesses ajoutées.
- Train : trois jambes ressort-amortisseur avec frottement de roulement et adhérence latérale, freins différentiels,
  roulette de nez orientable par le palonnier. Le passage sol / vol ne doit plus être un changement de mode : les
  efforts des roues s'annulent simplement quand elles quittent le sol.
- Ne mute plus l'objet CESSNA_172 partagé (updateLoad dans simulator.js écrit aircraft.mass) : masse et centrage
  deviennent des propriétés de l'instance.

Variante : aligne tout le projet sur UNE variante du C172. Le modèle 3D, les sons et le moteur de 160 ch sont ceux
du 172P ; WeightBalance.js utilise le manuel du 172S. Propose-moi le choix avec ses conséquences avant de coder,
puis aligne masse et centrage, performances et moteur sur cette variante.

Données : cherche des sources publiques fiables pour les dérivées et inerties du C172 (littérature NASA / Roskam,
manuels de vol). Si tu reprends des valeurs du fichier JSBSim c172p de FlightGear, il est sous GPL-2.0 : mets-les dans
un fichier de données séparé avec l'en-tête de licence, comme les modèles 3D, et signale-le dans le README.

Validation (obligatoire, tests du lot 0) :
- tous les tests de performances C172 au vert (montée, vitesses, décrochage, plané, virages), au niveau de la mer
  et en altitude, plafond pratique dans la bonne fourchette ;
- tests de qualités de vol : courte période amortie en ~1 à 2 s, phugoïde longue et peu amortie, roulis hollandais
  amorti, spirale neutre à légèrement instable, lacet inverse visible aux ailerons seuls, vrille entrée et sortie
  par la procédure PARE ;
- tests de non-régression des comportements que j'ai fait régler (envol sans saut, arrondi, vent de travers,
  relâchement du manche sans à-coup) : écris-les d'abord sur le modèle actuel, puis fais-les passer sur le nouveau.
Garde l'ancien modèle derrière un réglage « Modèle de vol : simplifié / réaliste » le temps que je compare en vol.
Livre un tableau mesuré / manuel pour chaque valeur.
```

**Critères d'acceptation** : montée au niveau de la mer entre 650 et 800 ft/min ; montée plus faible à 5 000 ft ; décrochage lisse 50 à 55 kt ; spirale légèrement stable, conforme au modèle linéaire UIUC (décision du 18/11/2026 : on
garde les données sourcées) : pente λ mesurée en test depuis 20° d'inclinaison, manche lâché, à ±0,01 /s de celle du
modèle UIUC au même point de vol (-0,014 /s à 100 KTAS et 1 000 m, constante de temps ~70 s ; mesuré -0,013 /s, soit
~79 s : `tests/flying-qualities.test.js`) ; ancien modèle sélectionnable. (Critère d'origine abandonné : « spirale qui ne
se redresse plus seule depuis 45° », sans source ; le point 4 du constat, « neutre à légèrement instable », n'est pas
sourcé non plus.)

**État (18/11/2026)** : modèle réaliste livré (`js/RigidBodyModel.js`, données `js/data/C172pAero.js`), au choix dans
Paramètres > Pilotage > « Modèle de vol (Cessna) », simplifié par défaut. Performances du POH 172P vertes sur les deux
modèles ; qualités de vol comparées au modèle linéaire UIUC (`tests/flying-qualities.test.js`) ; joueur au clavier avec
montée progressive des commandes (`js/InputRamp.js`, `tests/keyboard-pilot.test.js`).

**Reste à faire du lot 1** :
- Carte Mer : le Cessna y garde le modèle simplifié. La catapulte et les brins d'arrêt (`simulator.js`) pilotent des
  champs internes du modèle simplifié (`_liftoffEase`, vitesse posée directement…) ; il faut les réécrire en efforts
  (crochet, câble) pour le modèle réaliste.
- Initiation (`npm run test:initiation`) : corrigée le 20/11/2026. Le tour de piste suit la géométrie d'un vrai circuit
  (virage vent traversier vers 700 ft, AIM 4-3-3 ; vent arrière à 1 300 m de l'axe, AFH p. 8-3 ; voir `CIRCUIT` dans
  `js/Initiation.js`) : l'étape « 900 pieds » se fait en vent traversier. « Dégager la piste » n'accepte plus que la
  bretelle. Au niveau 1, le moniteur collationne aussi entre deux étapes (la leçon pouvait rester bloquée).
  Reste, signalé par la recherche du 20/11/2026 : le 172P n'a pas de pompe électrique (alimentation par gravité et
  amorceur manuel, POH p. 7-20), alors que la cabine et la leçon en ont une ; et l'étape « 900 pieds » (volets rentrés,
  phare éteint) n'a pas de source (POH p. 4-14 : volets rentrés à 60 KIAS, obstacles franchis).
- Joueur naïf au clavier (tient la touche jusqu'à l'assiette visée, sans anticiper) : depuis le 20/11/2026, la montée de
  la profondeur est 4 fois plus lente sous 60 KIAS (normale à 90 KIAS, `js/InputRamp.js`) : rotation à 17°/s, arrondi
  dans les limites (tests). Reste le virage à 30° (93 KIAS) : 2,37 g, le joueur laisse descendre puis tire jusqu'à
  l'assiette visée ; seule une montée en 6 s à toutes les vitesses le fait passer (1,88 g). Décision en attente ; test en
  todo : `tests/keyboard-pilot.test.js`.
- Vrille : testée en catégorie utilitaire, seule configuration où le POH 172P l'autorise (2 100 lb, centrage avant
  36,5 in ; POH 1981 p. 2-7, 2-8, 4-18, 4-19), dans `tests/flying-qualities.test.js` : 2 tours décrochés à assiette
  prononcée, passage en spirale au 5e ou 6e tour avec vitesse et facteur de charge qui montent, sortie PARE en moins
  d'1/4 de tour, ~1 100 ft pour 1 tour et sa sortie, 2,3 à 2,7 fois plus pour 6 tours, comme au POH. Écarts restants,
  non sourcés en chiffres : la vitesse monte dès le 2e tour (67 -> 96 KIAS en 4 tours), ~1,5 s par tour ; « surtout à
  droite » non reproduit (spirale au 5e tour à gauche, au 6e à droite) ; au centrage arrière (40,5 in), la vrille reste
  décrochée 6 tours. À reprendre si une source chiffrée (essais en vol, NASA) donne vitesse et taux de rotation.

**Suite possible** : même travail pour le F-15 (`F15.js` : CL et CD en fonction du Mach, commandes électriques comme vraie loi de pilotage) et vérification du R44 contre son manuel (le header de `HeliModel.js` est déjà de bonne facture : théorie de l'élément de pale).

---

### Lot 2. Manche, palonnier et yoke USB

**Pourquoi** : point 7. Sur un simulateur de vol, c'est souvent le changement le plus spectaculaire pour le joueur.

**Prompt à coller :**

```
Ajoute la prise en charge des manches, yokes, palonniers et manettes des gaz par la Gamepad API, en plus du clavier,
de la souris et du tactile (PlaneControls.setTouchInput montre comment les entrées se combinent aujourd'hui).
- Détection à chaud (gamepadconnected / disconnected), plusieurs périphériques à la fois (yoke + palonnier + manette).
- Fenêtre « Commandes > Périphériques » : pour chaque fonction (profondeur, ailerons, direction, gaz, mixture,
  frein gauche, frein droit, trim, volets, collectif R44, poussée F-15, tir, vue), bouton « Assigner » qui écoute le
  prochain axe ou bouton bougé ; inversion, zone morte, courbe (exponentielle), sensibilité ; barre de test en direct.
- Profils enregistrés dans localStorage par identifiant de périphérique, avec export / import JSON.
- Freins différentiels si deux axes de freins, sinon un seul axe ou un bouton.
- Vue libre au chapeau chinois (hat switch).
- Préréglages pour les périphériques courants (Logitech / Saitek Pro Flight Yoke et Rudder, Thrustmaster T.16000M et
  TFRP, manette Xbox), à vérifier par leur identifiant.
- Test e2e : périphérique simulé (mock de navigator.getGamepads) qui fait décoller le C172.
Le menu Commandes doit toujours s'adapter à l'appareil choisi au hangar, comme aujourd'hui.
```

---

### Lot 3. Atmosphère, altimètre et météo réelle

**Pourquoi** : point 8. QNH figé, température sans effet, météos en préréglages fixes.

**Prompt à coller :**

```
1. QNH variable par météo (et par partie, tiré avec la graine du vent), annoncé par l'ATIS et la tour ; l'altimètre
   du C172 lit la pression statique et suit son calage (fenêtre de Kollsman d'Avionics.js) ; erreur d'altitude si
   le calage est faux ; altitude-pression et altitude-densité affichées dans Masse et centrage depuis la météo du jeu.
2. Température et point de rosée de la météo appliqués à l'atmosphère du lot 1 (performances au décollage qui
   changent entre « nuit » à 9 °C et une journée chaude que tu ajoutes, 35 °C).
3. Option « Météo réelle » : récupère le METAR d'un aéroport choisi (par défaut LFMA Aix-les-Milles) depuis une API
   publique accessible depuis un navigateur (vérifie le CORS ; sinon garde les préréglages et dis-le-moi), et
   convertis-le en vent, rafales, visibilité, couches nuageuses, QNH, température.
4. Si la variante choisie au lot 1 est carburée (172P) : givrage carburateur selon température et humidité, perte
   de régime, réchauffage carburateur (commande en cabine, chute de régime à l'application).
5. Turbulence : remplace les rafales aléatoires de _updateGusts par un modèle de Dryden (intensité selon la
   hauteur et la météo), plus le cisaillement près du sol et les thermiques au-dessus du relief au soleil.
Tests : altimètre juste à ±20 ft avec le bon calage, faux de 30 ft par hPa d'erreur ; distances de décollage plus
longues par temps chaud.
```

---

### Lot 4. Pilote automatique KAP 140 et instruments manquants

**Pourquoi** : point 9. Le disjoncteur existe, c'est un élément attendu du tableau.

**Prompt à coller :**

```
Ajoute le pilote automatique Bendix/King KAP 140 du C172 (deux axes, modes ROL, HDG, NAV, APR, REV, VS, ALT, avec
présélecteur d'altitude), modélisé dans le tableau 3D de Panel172.js comme les autres radios, alimenté par le
disjoncteur AUTOPILOT existant, déconnexion par le bouton rouge du manche (déjà modélisé dans Cockpit.js) avec son
avertisseur sonore. Il agit sur les gouvernes du lot 1 par de petites boucles de commande (pas de pose directe de
l'attitude), avec ses limites réelles (taux de virage standard, trim électrique).
Ajoute aussi, s'ils manquent : balises NDB pour l'ADF, marqueurs d'ILS (OM, MM) avec voyants et sons, indicateur
de dépression et voltmètre qui réagissent aux pannes.
Mets à jour le manuel (manuel.html) et l'initiation : une leçon « tenir un cap et une altitude au pilote automatique ».
Tests : capture du KAP 140 allumé ; tenue d'altitude à ±50 ft et de cap à ±3° pendant 3 min en air calme.
```

---

### Lot 5. Rejeu et débriefing de vol

**Pourquoi** : valeur pédagogique forte pour une école d'ingénieurs : revoir le vol effectué, chiffres à l'appui.

**Prompt à coller :**

```
Enregistre chaque vol (10 échantillons par seconde : position, attitude, vitesses, commandes, régime, volets, phase
de vol, messages ATC). À la fin du vol ou sur demande :
- rejeu 3D avec avance rapide, pause, caméras libres et cabine ;
- débriefing : trajectoire vue de dessus sur MapView, profil vertical, courbes vitesse / altitude / vario /
  inclinaison / incidence, et un relevé automatique des écarts (vitesse d'approche hors tolérance, inclinaison
  > 30° sous 500 ft, vitesse verticale au toucher, distance au point d'aboutissement, plan d'approche ILS) ;
- export CSV et import du fichier pour le rejouer plus tard.
Stockage local (IndexedDB), les 20 derniers vols. Aucun envoi réseau.
```

---

### Lot 6. Initiation : leçons supplémentaires

**Pourquoi** : `Initiation.js` (1 243 lignes) couvre un tour de piste complet. Le moteur des leçons est réutilisable.

**Prompt à coller :**

```
Sur le modèle d'Initiation.js (moniteur, étapes, clignotement des commandes, voix), ajoute des leçons :
1. Décrochages (lisse, volets sortis, en virage) et sortie ; 2. Virages à grande inclinaison (45°) ;
3. Panne moteur après décollage et en campagne (choix d'un champ, plané) ; 4. Navigation VOR (interception et
tenue d'un radial) ; 5. Approche ILS ; 6. Atterrissage par vent de travers ; 7. (si le lot 1 est fait) Vrille.
Chaque leçon : objectifs, critères chiffrés de réussite évalués automatiquement (avec le débriefing du lot 5 s'il
existe), note finale, et progression enregistrée. Écris d'abord le scénario de chaque leçon et soumets-le-moi.
```

---

### Lot 7. Carte réelle « Provence » autour de LFMA

**Pourquoi** : aujourd'hui le relief est procédural et les terrains (ESME, AIX) sont fictifs. Un vrai bout de Provence avec un vrai terrain change complètement l'expérience. Gros chantier : à faire une fois les lots 0 à 2 terminés.

**Prompt à coller :**

```
Ajoute une 4e carte « Provence » à côté de Campagne, Ville et Mer : relief réel autour d'Aix-les-Milles (LFMA),
environ 40 × 40 km, Montagne Sainte-Victoire comprise.
- Relief : MNT libre de droits avec attribution (Copernicus GLO-30 ou IGN RGE ALTI si la licence le permet),
  prétraité par un script dans tools/ en tuiles de hauteurs compressées (PNG 16 bits ou format équivalent),
  chargées par Terrain.js avec ses niveaux de détail actuels. Le reste du terrain procédural reste en dehors.
- Aérodrome LFMA : piste 15/33 réelle (position, orientation, longueur, altitude), taxiways et parkings
  simplifiés, fréquences et procédures VFR réelles (points d'entrée publiés) intégrées à ATC.js.
- Occupation du sol (forêts, cultures, villages, autoroutes) à partir de données ouvertes (OpenStreetMap, ODbL,
  avec attribution), avec les arbres et maisons déjà présents (Scenery.js, Nature.js).
- Taille du téléchargement maîtrisée : indique-moi le poids total avant de livrer.
Soumets-moi d'abord le plan, les sources de données et leurs licences.
```

---

### Lot 8. Poids du site et chargement

**Pourquoi** : point 12. Sur iPad et téléphone, chaque Mo compte ; GitHub Pages limite aussi la taille.

**Prompt à coller :**

```
Réduis le poids de ce qui est publié sans perte visible ni audible :
1. Sons : un seul format compressé lisible partout (Opus en .webm/.ogg plus AAC .m4a en repli pour Safari si
   nécessaire), généré par un script dans tools/ ; retire les WAV et FLAC publiés (AudioUnlock.js choisit déjà un
   format : adapte-le). Garde les originaux hors de la publication.
2. Modèles GLB : compression meshopt (ou Draco) et textures KTX2 / Basis, via gltf-transform dans un script tools/ ;
   charge les décodeurs depuis le même CDN versionné que three.
3. Ne publie plus asset/blender/ ni les sources .ac/.png de asset/airport/source (dossier source séparé ou
   exclusion de la publication).
4. Service worker : précache des fichiers du cœur du jeu pour un démarrage hors ligne après la première visite,
   sans casser le mécanisme actuel de mise à jour.
5. Mesure avant / après : poids total publié, poids téléchargé au premier lancement C172 sur la carte Campagne,
   temps jusqu'au menu (test e2e avec réseau limité).
6. Propose-moi (sans l'exécuter) une stratégie pour alléger l'historique git de 148 Mo (Git LFS ou réécriture).
```

---

### Lot 9. Architecture de simulator.js

**Pourquoi** : point 10. Chaque nouvelle fonction ajoute des branches `if (jet) … if (heli) …` dans un fichier de 6 500 lignes : c'est là que naissent les régressions. À faire seulement avec les tests du lot 0 en place.

**Prompt à coller :**

```
Découpe simulator.js sans changer le comportement, par petites étapes, chaque étape avec npm run check vert :
1. Une interface commune d'appareil (AircraftAdapter : chargement, modèle de vol, systèmes, son, cabine, HUD,
   feux, données multijoueur) et une classe par appareil (C172, F15, R44) : plus aucune branche aircraftType dans
   la boucle principale.
2. Une machine à états explicite du jeu (chargement, menu, hangar, choix de carte, choix du départ, vol, crash,
   photo) qui remplace les booléens inMenu, inHangar, choosingSpawn…
3. Modules séparés : caméra, menus et fenêtres (DOM), combat, porte-avions, boucle principale.
4. style.css découpé par zone (menus, HUD, tactile, fenêtres, manuel) avec les mêmes sélecteurs.
5. Les gros scripts en ligne d'index.html déplacés dans des fichiers.
Avant de commencer : écris les tests e2e manquants qui couvrent ce que tu vas déplacer. Après : tableau du nombre de
lignes par fichier, et liste de ce que tu n'as pas déplacé et pourquoi.
```

---

### Lot 10. Multijoueur et combat : fiabilité

**Pourquoi** : `Weapons.js` le dit lui-même : « le tireur décide des coups au but ». Sur des relais publics, n'importe qui peut envoyer des coups au but inventés. Pas de serveur possible sur GitHub Pages, mais nous pouvons rendre la triche plus difficile.

**Prompt à coller :**

```
1. Le joueur touché vérifie chaque coup reçu : le message porte l'instant, la position et la vitesse du tireur ;
   la victime vérifie que la géométrie est plausible avec sa propre trajectoire enregistrée (distance, angle, temps
   de vol de l'obus, cadence de tir, munitions restantes), sinon le coup est ignoré et compté comme suspect.
2. Limitation du débit par joueur pour tous les types de messages (hit, missile, chat, voice, atc).
3. Interpolation des autres avions : tampon de 100 à 200 ms avec horloge commune, extrapolation limitée, et test
   automatique avec latence et pertes simulées (deux pages Playwright reliées par un faux relais local).
4. Indicateur de qualité de liaison par joueur dans la liste « En ligne ».
```

---

## 4. Idées plus légères (une demande chacune)

- Mode « vol de nuit » avec éclairage de piste piloté par le pilote (PCL, clics radio sur la fréquence).
- Pannes programmables par le moniteur ou aléatoires (alternateur, dépression, magnéto, instruments bloqués, volets).
- Vue extérieure : caméras « tour de contrôle » et « spectateur au seuil ».
- Interface en anglais (l'ATC est déjà bilingue).
- Mode VR WebXR (lunettes autonomes type Quest dans le navigateur), une fois le lot 9 fait.
- Checklist interactive du C172 qui coche seule les éléments faits (le moteur de l'initiation sait déjà les détecter).

## 5. Ce que je n'ai pas pu vérifier

- Je n'ai pas pu lancer le jeu dans un navigateur ici (pas d'accès au CDN jsdelivr depuis mon environnement) : rien sur le rendu, les FPS ou le son.
- Les mesures du constat viennent de `FlightModel.js` seul dans Node, sans relief (sol à 0), sans vent ni turbulence. Elles portent sur la physique du Cessna, pas sur la sensation en jeu.
- Je n'ai pas audité en détail ATC.js, Weapons.js, City.js ni les cabines 3D (lus en survol).
