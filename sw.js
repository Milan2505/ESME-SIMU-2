// Service worker : garantit que le navigateur utilise toujours la dernière version publiée.
// GitHub Pages indique aux navigateurs de garder les fichiers 10 minutes en cache (Cache-Control: max-age=600) :
// sans ce fichier, après une mise à jour, on pouvait encore jouer avec l'ancien code pendant 10 minutes.
// Ici, chaque fichier du site est revérifié auprès du serveur (réponse "304 inchangé" très légère si rien n'a bougé).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    // Une requête de navigation (la page elle-même) ne peut pas être recopiée avec des options : on refait la requête par son adresse
    const fresh = request.mode === 'navigate'
        ? fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        : fetch(request, { cache: 'no-cache' });
    event.respondWith(fresh.catch(() => fetch(request)));
});
