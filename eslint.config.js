// ESLint : règles recommandées seulement (erreurs : variables indéfinies, code inutilisé, etc.), pas de style.
// « npm run lint » ; voir CLAUDE.md
import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/', 'test-results/', 'playwright-report/', 'asset/', 'docs/', '.vscode/', 'tools/'] },
    js.configs.recommended,
    {
        // Le jeu : modules ES chargés par le navigateur
        files: ['simulator.js', 'manuel.js', 'js/**/*.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
    },
    {
        // Fil de calcul des voix radio (module worker)
        files: ['js/VoiceWorker.js'],
        languageOptions: { globals: { ...globals.worker } },
    },
    {
        // Service worker (script classique)
        files: ['sw.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.serviceworker } },
    },
    {
        // Tests Node et configuration ; les tests de bout en bout pilotent aussi le navigateur (page.evaluate)
        files: ['tests/**/*.js', 'eslint.config.js', 'playwright.config.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    },
];
