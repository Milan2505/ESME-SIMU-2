// Script npm « prepare » (lancé par npm install) : branche les hooks versionnés de .githooks (core.hooksPath) et le
// modèle de message de commit .gitmessage (commit.template). Sans
// effet, et sans faire échouer npm install, hors d'un dépôt git (archive ZIP, conteneur) ou si git est absent.
// Attention : avec core.hooksPath, git ne lit plus les hooks de .git/hooks (voir CLAUDE.md, section Git).
import { execFileSync } from 'node:child_process';

try {
    execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
    // Modèle de message (.gitmessage) : VS Code et « git commit » sans -m pré-remplissent le message au bon format
    execFileSync('git', ['config', 'commit.template', '.gitmessage'], { stdio: 'ignore' });
    console.log('Hooks git : core.hooksPath = .githooks (format des messages de commit vérifié), modèle .gitmessage');
} catch {
    console.log('Hooks git non branchés : pas de dépôt git ici, ou git absent (sans effet sur les tests)');
}
