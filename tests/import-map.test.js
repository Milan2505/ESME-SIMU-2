// L'import map d'index.html (three, mqtt depuis le CDN) et les copies locales de package.json (tests sans réseau,
// voir tests/e2e/server.js) doivent viser exactement les mêmes versions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('import map : three et mqtt aux versions de package.json', () => {
    const json = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1];
    assert.ok(json, 'import map introuvable');
    const { imports } = JSON.parse(json);
    assert.equal(imports.three, `https://cdn.jsdelivr.net/npm/three@${pkg.devDependencies.three}/build/three.module.js`);
    assert.equal(imports['three/addons/'], `https://cdn.jsdelivr.net/npm/three@${pkg.devDependencies.three}/examples/jsm/`);
    assert.equal(imports.mqtt, `https://cdn.jsdelivr.net/npm/mqtt@${pkg.devDependencies.mqtt}/dist/mqtt.esm.js`);
});

test('préchargements (modulepreload) : mêmes versions que l\'import map', () => {
    const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]).filter((href) => href.startsWith('https://cdn.jsdelivr.net/'));
    assert.ok(preloads.length > 5);
    for (const href of preloads) {
        const [, name, version] = /npm\/([^@]+)@([^/]+)\//.exec(href) ?? [];
        assert.ok(name, `adresse sans version : ${href}`);
        assert.equal(version, pkg.devDependencies[name], href);
    }
});
