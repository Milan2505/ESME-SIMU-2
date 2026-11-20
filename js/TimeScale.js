// Accélération du temps, en mode test seulement (index.html?test=1 : window.__sim.setTimeScale, voir simulator.js). En jeu,
// le facteur vaut toujours 1 et rien ne change.
// La boucle d'images fait avancer le modèle de vol, les systèmes, la radio et la leçon par pas de 0,1 s au plus (le plus
// grand pas du jeu) ; ici, les attentes en temps réel de la radio (délai de réponse du contrôleur, durée de lecture d'un
// message sans voix, consigne muette du moniteur) sont divisées par le même facteur.
export const timeScale = { value: 1 };

// Attente de `ms` millisecondes de temps de jeu
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms / timeScale.value));
