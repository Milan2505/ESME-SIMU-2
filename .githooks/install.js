// Script npm « prepare » (lancé par npm install) : branche les hooks versionnés de .githooks (core.hooksPath). Sans
// effet, et sans faire échouer npm install, hors d'un dépôt git (archive ZIP, conteneur) ou si git est absent.
// Attention : avec core.hooksPath, git ne lit plus les hooks de .git/hooks (voir CLAUDE.md, section Git).
import { execFileSync } from 'node:child_process';

try {
    execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
    console.log('Hooks git : core.hooksPath = .githooks (format des messages de commit vérifié)');
} catch {
    console.log('Hooks git non branchés : pas de dépôt git ici, ou git absent (sans effet sur les tests)');
}
