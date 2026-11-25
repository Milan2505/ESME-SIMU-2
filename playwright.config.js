// Tests de bout en bout (npm run test:e2e) : Chromium sans fenêtre, WebGL logiciel (SwiftShader : pas de carte graphique
// nécessaire), fichiers servis par tests/e2e/server.js sans aucun accès réseau. Lents (quelques minutes) : voir CLAUDE.md
import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';

const PORT = 8765;

export default defineConfig({
    testDir: 'tests/e2e',
    globalSetup: './tests/e2e/keep-awake.js',   // pas de mise en veille du poste pendant les tests (Windows)
    // Initiation complète (~15 min) : à part, npm run test:initiation (playwright.initiation.config.js)
    testIgnore: '**/initiation.spec.js',
    // Délais : les attentes des tests comptent en temps simulé (tests/e2e/sim-time.js, 25/11/2026) ; le délai par test
    // n'est qu'un filet contre un simulateur figé (sous charge, une image peut prendre plusieurs secondes)
    timeout: 60 * 60_000,
    expect: { timeout: 120_000 },     // interface (menus, fenêtres) : suit les images, lentes sous charge
    fullyParallel: true,
    // Un simulateur par cœur physique (décision du 20/11/2026 : e2e en parallèle ; availableParallelism compte les cœurs
    // logiques, deux par cœur physique). Un par cœur logique saturait le processeur depuis les leçons du lot 6 (19 tests) :
    // WebGL logiciel à plusieurs fils par page, images de plus de 8 s, tests hors délai
    workers: Math.max(1, Math.floor(availableParallelism() / 2)),
    retries: 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    outputDir: 'test-results',
    use: {
        baseURL: `http://localhost:${PORT}`,
        headless: true,
        viewport: { width: 1280, height: 720 },
        screenshot: 'off',
        video: 'off',
        trace: 'retain-on-failure',
        launchOptions: {
            args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
                '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
        },
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    webServer: { command: 'node tests/e2e/server.js', port: PORT, reuseExistingServer: true, timeout: 30_000 },
});
