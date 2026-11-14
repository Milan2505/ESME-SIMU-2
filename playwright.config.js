// Tests de bout en bout (npm run test:e2e) : Chromium sans fenêtre, WebGL logiciel (SwiftShader : pas de carte graphique
// nécessaire), fichiers servis par tests/e2e/server.js sans aucun accès réseau. Lents (quelques minutes) : voir CLAUDE.md
import { defineConfig } from '@playwright/test';

const PORT = 8765;

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 300_000,            // par test : écran de chargement compris (shaders compilés par le processeur)
    expect: { timeout: 30_000 },
    fullyParallel: false,
    workers: 1,                  // (un seul simulateur à la fois : chaque page utilise tout le processeur)
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
