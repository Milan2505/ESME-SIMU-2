// Initiation complète sur le modèle réaliste (tests/e2e/initiation.spec.js, ~15 min) : npm run test:initiation. Même
// cadre que playwright.config.js, ce seul fichier de test.
import base from './playwright.config.js';

export default { ...base, testIgnore: [], testMatch: '**/initiation.spec.js' };
