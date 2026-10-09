# ESME-SIMU-2

Simulateur de vol (Cessna 172) dans le navigateur, en Three.js. Site 100 % statique : aucun serveur à installer.

**Jouer en ligne : https://milan2505.github.io/ESME-SIMU-2/**

## Mise en ligne (GitHub Pages)

Le site est publié par GitHub Pages directement depuis la branche `main` (réglage du dépôt :
**Settings → Pages → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`).
Chaque `push` sur `main` met le site à jour en une à deux minutes (onglet **Actions** : « pages build and deployment »).

Le fichier vide `.nojekyll` demande à GitHub de publier les fichiers tels quels, sans les transformer.

## Lancer en local

Les modules JavaScript ne se chargent pas en `file://` : il faut un petit serveur.

```
python -m http.server 8080
```

puis ouvrir http://localhost:8080 (ou F5 dans VS Code : tâche « Serveur local »).

## Multijoueur

Les joueurs échangent leurs positions par un relais MQTT public (WebSocket sécurisé, `broker.hivemq.com`, avec deux relais de secours), voir `js/Multiplayer.js`. Cela fonctionne depuis GitHub Pages comme en local, sans serveur à déployer. Le relais étant public, les positions et pseudos ne sont pas confidentiels.

## Crédits

- Cessna 172 low poly : Vojtěch Balák (Poly Pizza, CC-BY 3.0)
- Textures du terrain et ciel de nuit : Poly Haven (CC0)
- Sons : projets FlightGear c172p et A320-family (GPL-2.0), voir `asset/sounds/LICENSE.txt`
