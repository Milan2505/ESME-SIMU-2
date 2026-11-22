// Hook git commit-msg (.githooks/commit-msg.js) : format « type(zone): résumé » de CLAUDE.md, section Git. Le validateur
// seul, la mise au format des messages qui n'y sont pas (depuis le 22/11/2026 : corrigés, plus refusés), puis le hook
// appelé par un vrai git commit dans un dépôt temporaire (core.hooksPath vers .githooks, comme le
// script npm « prepare »), et le script « prepare » hors d'un dépôt git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMessage, commentCharOf, fixMessage } from '../.githooks/commit-msg.js';

const HOOKS = fileURLToPath(new URL('../.githooks', import.meta.url));   // (indépendant du dossier courant)
const ok = (message, c) => assert.deepEqual(checkMessage(message, c), [], `refusé à tort : ${JSON.stringify(message)}`);
const refused = (message, c) => assert.ok(checkMessage(message, c).length > 0, `accepté à tort : ${JSON.stringify(message)}`);
// Environnement sans variables GIT_* héritées (si les tests tournent un jour depuis un hook git)
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

test('messages au format accepté : type(zone): résumé, ligne vide, détail ; commentaires de git ignorés', () => {
    ok('fix(carrier): brin d\'arrêt tient plein gaz');
    ok('feat(flight): modèle réaliste\n\nDétail sur\nplusieurs lignes.\n\nCo-Authored-By: Quelqu\'un <x@example.invalid>\n');
    ok('test(e2e-initiation): initiation complète\r\n\r\nDétail.\r\n');
    ok('docs(ui): manuel\n# Please enter the commit message for your changes.\n# On branch main\n');
    ok('chore(tooling): hook\n\nDétail\n# ------------------------ >8 ------------------------\ndiff --git a/x b/x\n');
    for (const type of ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'chore']) ok(`${type}(zone): résumé`);
});

test('messages écrits par git acceptés : fusion, annulation, réapplication ; fixup!/squash!/amend! d\'un message au format', () => {
    ok('Merge branch \'main\' of https://github.com/exemple/depot');
    ok('Merge remote-tracking branch \'origin/main\'');
    ok('Revert "fix(ui): bouton"\n\nThis reverts commit abc.');
    ok('Reapply "fix(ui): bouton"\n\nThis reverts commit def.');
    ok('fixup! fix(ui): bouton');
    ok('squash! feat(flight): modèle\n\nDétail.');
    ok('amend! fix(ui): bouton\n\nfix(ui): bouton corrigé');
    refused('fixup! save');                       // la cible doit être au format
    refused('Merge ce que je veux');              // pas un message de git
});

test('messages refusés : réponse du chat, type inconnu, zone absente ou en majuscules, deuxième ligne non vide, trop long, vide', () => {
    refused('Les cinq points sont faits. npm run check:full est vert : lint, 120 tests Node.');
    refused('save');
    refused('update(ui): bouton');
    refused('fix: bouton sans zone');
    refused('fix(UI): zone en majuscules');
    refused('fix(ui) : espace avant les deux-points');
    refused('fix(ui):sans espace');
    refused('fix(ui): ');
    refused('fix(ui): résumé\ndétail collé sans ligne vide');
    refused(`fix(ui): ${'x'.repeat(100)}`);
    refused('');
    refused('# seulement des commentaires\n');
});

test('caractère de commentaire réglable (core.commentChar, « auto ») : lignes de commentaire ignorées', () => {
    const raw = 'fix(ui): bouton\n; Please enter the commit message for your changes.\n; ------------------------ >8 ------------------------\nreste';
    assert.equal(commentCharOf(raw, ';'), ';');
    assert.equal(commentCharOf(raw, 'auto'), ';');
    assert.equal(commentCharOf('fix(ui): x', 'auto'), '#');
    ok(raw, ';');
    refused(raw, '#');
});

test("message hors format mis au format : type d'après les mots, zone d'après les fichiers, détail gardé ; au format : inchangé", () => {
    assert.equal(fixMessage('corrige le saut au roulage', ['js/RigidBodyModel.js']), 'fix(flight): corrige le saut au roulage\n');
    assert.equal(fixMessage('Ajoute la leçon VOR.', ['js/lessons/vor.js', 'js/Initiation.js']), 'feat(lecons): Ajoute la leçon VOR\n');
    assert.equal(fixMessage('save', ['index.html', 'simulator.js']), 'chore(divers): save\n');
    assert.equal(fixMessage('fix: bouton\nligne collée', ['style.css']), 'fix(ui): bouton\n\nligne collée\n');
    assert.equal(fixMessage('', ['tests/a.test.js', 'tests/b.test.js']), 'test(tests): mise à jour (2 fichiers)\n');
    const long = fixMessage('x'.repeat(130), ['docs/a.md']);
    assert.deepEqual(checkMessage(long), [], long);
    assert.ok(long.includes('x'.repeat(130)), 'message entier gardé dans le détail');
    assert.equal(fixMessage('fix(ui): déjà bon'), null);
    assert.equal(fixMessage("Merge branch 'main'"), null);
    for (const raw of ['Les cinq points sont faits.', '# commentaire\n', 'fix(UI): x', 'update(ui): y']) {
        assert.deepEqual(checkMessage(fixMessage(raw, ['js/a.js'])), [], raw);
    }
});

test('hook branché sur git (core.hooksPath = .githooks) : un vrai commit hors format est mis au format, au format il passe tel quel', () => {
    const repo = mkdtempSync(join(tmpdir(), 'esme-hook-'));
    try {
        const options = { cwd: repo, encoding: 'utf8', env: cleanEnv };
        const git = (...args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], options);
        execFileSync('git', ['init', '-q'], options);
        execFileSync('git', ['config', 'core.hooksPath', HOOKS], options);
        writeFileSync(join(repo, 'a.txt'), 'a');
        execFileSync('git', ['add', 'a.txt'], options);
        const bad = git('commit', '-q', '-m', 'Les cinq points sont faits.');
        assert.equal(bad.status, 0, `commit hors format accepté : ${bad.stderr}`);
        assert.match(bad.stderr, /mis au format/);
        assert.equal(git('log', '--format=%s').stdout.trim(), 'chore(divers): Les cinq points sont faits');
        writeFileSync(join(repo, 'a.txt'), 'b');
        execFileSync('git', ['add', 'a.txt'], options);
        const good = git('commit', '-q', '-m', 'chore(tooling): premier commit', '-m', 'Détail.');
        assert.equal(good.status, 0, `commit au format accepté : ${good.stderr}`);
        assert.equal(git('log', '-1', '--format=%s').stdout.trim(), 'chore(tooling): premier commit');
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test('script npm « prepare » (.githooks/install.js) : sans erreur hors d\'un dépôt git (npm install depuis une archive)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'esme-nogit-'));
    try {
        const run = spawnSync(process.execPath, [join(HOOKS, 'install.js')], { cwd: dir, encoding: 'utf8', env: { ...cleanEnv, GIT_CEILING_DIRECTORIES: tmpdir() } });
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /non branchés/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
