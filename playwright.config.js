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
    timeout: 300_000,            // par test : écran de chargement compris (shaders compilés par le processeur)
    expect: { timeout: 30_000 },
    fullyParallel: true,
    workers: availableParallelism(),   // un simulateur par cœur (décision du 20/11/2026 : e2e en parallèle)
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
