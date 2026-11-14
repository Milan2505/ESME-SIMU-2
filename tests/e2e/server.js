// Petit serveur de fichiers pour les tests de bout en bout (Playwright, voir playwright.config.js) : sert le dossier du
// projet tel quel, sauf index.html où les bibliothèques du CDN (three, mqtt : import map et préchargements) sont
// remplacées par leurs copies de node_modules, aux versions épinglées dans package.json. Les tests tournent donc sans
// réseau. Seuls node_modules/three et node_modules/mqtt sont servis. Lancement à la main : node tests/e2e/server.js
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT) || 8765;
const PACKAGES = ['three', 'mqtt'];   // (servis depuis node_modules, versions de package.json)
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mtl': 'text/plain', '.obj': 'text/plain',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
    '.bin': 'application/octet-stream', '.woff2': 'font/woff2',
};

// Adresses du CDN -> copies locales, d'après les versions de package.json (un écart ferait charger le CDN : voir le test
// tests/import-map.test.js)
const pkg = JSON.parse(await fs.readFile(join(ROOT, 'package.json'), 'utf8'));
const cdnToLocal = PACKAGES.map((name) => [`https://cdn.jsdelivr.net/npm/${name}@${pkg.devDependencies[name]}/`, `/node_modules/${name}/`]);
function localize(html) {
    return cdnToLocal.reduce((text, [cdn, local]) => text.split(cdn).join(local), html);
}

function allowed(relative) {
    const parts = relative.split('/');
    if (parts[0] === 'node_modules') return parts.length > 2 && PACKAGES.includes(parts[1]);
    return parts[0] !== '.git';
}

const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url, `http://localhost:${PORT}`);
        let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        if (relative === '' || relative.endsWith('/')) relative += 'index.html';
        const file = normalize(join(ROOT, relative));
        if (!file.startsWith(ROOT + sep) || !allowed(relative.split(sep).join('/'))) return deny(response, 403);
        const stat = await fs.stat(file).catch(() => null);
        if (!stat?.isFile()) return deny(response, 404);
        const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
        const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
        if (relative === 'index.html') {
            const body = localize(await fs.readFile(file, 'utf8'));
            response.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(body) });
            return response.end(body);
        }
        // Lecture partielle (sons, vidéos) : Chromium la demande pour les médias
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
        if (range && (range[1] || range[2])) {
            const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
            const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
            if (start > end || start >= stat.size) return deny(response, 416);
            response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
            return createReadStream(file, { start, end }).pipe(response);
        }
        response.writeHead(200, { ...headers, 'Content-Length': stat.size });
        if (request.method === 'HEAD') return response.end();
        createReadStream(file).pipe(response);
    } catch (error) {
        console.error(error);
        deny(response, 500);
    }
});
function deny(response, status) {
    response.writeHead(status, { 'Content-Type': 'text/plain' });
    response.end(String(status));
}

server.listen(PORT, '127.0.0.1', () => console.log(`Serveur de test : http://localhost:${PORT}/?test=1 (${ROOT})`));
