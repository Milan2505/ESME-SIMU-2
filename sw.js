// Service worker : garantit que le navigateur utilise toujours la dernière version publiée.
// GitHub Pages indique aux navigateurs de garder les fichiers 10 minutes en cache (Cache-Control: max-age=600) :
// sans ce fichier, après une mise à jour, on pouvait encore jouer avec l'ancien code pendant 10 minutes.
// Ici, chaque fichier du site est revérifié auprès du serveur (réponse "304 inchangé" très légère si rien n'a bougé).
// Sauf les fichiers lourds du dossier asset/ (modèles, textures, sons), qui changent rarement : servis tout de suite
// depuis le cache du navigateur, et remis à jour en arrière-plan pour la fois suivante. Sur un portable en Wi-Fi, le
// chargement n'attend plus un aller-retour avec le serveur pour chacun d'eux.
// Bibliothèques du CDN (three.js, générateur d'arbres ez-tree, mqtt) : leur adresse porte leur version (three@0.174.0),
// leur contenu ne change jamais. Gardées dans le cache du site après la première visite : la partie suivante ne les
// retélécharge pas (Safari, sur iPad, vide vite son cache ordinaire)
const ASSET_CACHE = 'esme-assets-v1';
const CDN_CACHE = 'esme-cdn-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET') return;
    if (url.hostname === 'cdn.jsdelivr.net' && /@\d/.test(url.pathname)) {
        event.respondWith(cdnCached(request));
        return;
    }
    if (url.origin !== self.location.origin) return;
    if (url.pathname.includes('/asset/') && !request.headers.has('range')) {
        event.respondWith(cachedThenRefreshed(event, request));
        return;
    }
    // Une requête de navigation (la page elle-même) ne peut pas être recopiée avec des options : on refait la requête par son adresse
    const fresh = request.mode === 'navigate'
        ? fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        : fetch(request, { cache: 'no-cache' });
    event.respondWith(fresh.catch(() => fetch(request)));
});

// Réponse du cache s'il y en a une (la version du serveur la remplace en arrière-plan), sinon celle du serveur
async function cachedThenRefreshed(event, request) {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    const refresh = fetch(request, { cache: 'no-cache' }).then(async (response) => {
        if (response.ok && response.status === 200) await cache.put(request, response.clone());
        return response;
    });
    if (cached) {
        event.waitUntil(refresh.catch(() => {}));
        return cached;
    }
    return refresh.catch(() => fetch(request));
}

// Bibliothèque versionnée du CDN : depuis le cache s'il l'a, sinon téléchargée et gardée
async function cdnCached(request) {
    const cache = await caches.open(CDN_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.status === 200) await cache.put(request, response.clone());
    return response;
}
