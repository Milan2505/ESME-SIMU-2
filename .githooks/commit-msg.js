// Hook git commit-msg (activé par « npm install » : script « prepare », core.hooksPath = .githooks) : refuse tout message
// de commit hors du format de CLAUDE.md, section Git :
//   type(zone): résumé        <- première ligne, 100 caractères au plus
//                             <- ligne vide (s'il y a un détail)
//   détail…
// Types : feat, fix, perf, refactor, test, docs, chore. Zone : minuscules, chiffres, tirets (flight, heli, ui…).
// Seules exceptions : les messages que git écrit lui-même : fusion (« Merge branch … », git pull), annulation
// (« Revert "…" », « Reapply "…" ») ; et les commits de correction pour rebase --autosquash (« fixup! », « squash! »,
// « amend! » suivis d'un message au format).
// Utilisable seul : node .githooks/commit-msg.js <fichier du message> (code de sortie 1 et explication si refusé).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TYPES = ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'chore'];
export const MAX_SUMMARY = 100;
const FIRST_LINE = new RegExp(`^(${TYPES.join('|')})\\(([a-z0-9][a-z0-9-]*)\\): (\\S.*)$`);
const GIT_WRITTEN = /^(Merge (branch|branches|remote-tracking branch|tag|commit|pull request) |Revert "|Reapply ")/;
const AUTOSQUASH = /^(fixup|squash|amend)! /;
const escape = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Caractère des lignes de commentaire de git (core.commentChar, « # » par défaut ; « auto » : celui qu'emploie le modèle
// de message que git a écrit dans le fichier)
export function commentCharOf(raw, setting = '#') {
    if (setting && setting !== 'auto') return setting;
    const template = /^(.) (Please enter the commit message|Veuillez saisir le message|-+ >8 -+$)/m.exec(raw);
    return template ? template[1] : '#';
}

// Message tel que git le garde : sans les lignes de commentaire, ni ce qui suit la ligne des ciseaux (commit -v), sans
// espaces en fin de ligne ni lignes vides au début et à la fin
export function cleanMessage(raw, commentChar = '#') {
    const scissors = new RegExp(`^${escape(commentChar)} -+ >8 -+$`);
    const lines = [];
    for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
        if (scissors.test(line)) break;
        if (line.startsWith(commentChar)) continue;
        lines.push(line.replace(/\s+$/, ''));
    }
    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines.at(-1) === '') lines.pop();
    return lines;
}

// Rend la liste des problèmes (vide : message accepté)
export function checkMessage(raw, commentChar = '#') {
    const lines = cleanMessage(raw, commentChar);
    if (!lines.length) return ['message vide'];
    if (GIT_WRITTEN.test(lines[0])) return [];
    if (AUTOSQUASH.test(lines[0])) {   // fixup! <message au format> : on vérifie le message visé
        const rest = [lines[0].replace(AUTOSQUASH, ''), ...lines.slice(1)];
        while (AUTOSQUASH.test(rest[0])) rest[0] = rest[0].replace(AUTOSQUASH, '');
        return checkMessage(rest.join('\n'), commentChar);
    }
    const [first, second] = lines;
    const problems = [];
    if (!FIRST_LINE.test(first)) {
        problems.push(`première ligne hors format : « ${first.length > 80 ? `${first.slice(0, 80)}…` : first} »`);
        const type = /^([a-z]+)\(/.exec(first)?.[1];
        if (!type) problems.push(`elle doit commencer par type(zone): avec un type parmi ${TYPES.join(', ')}`);
        else if (!TYPES.includes(type)) problems.push(`type inconnu « ${type} » (${TYPES.join(', ')})`);
        else problems.push('zone en minuscules, chiffres ou tirets entre parenthèses, puis « : » et le résumé');
    } else if (first.length > MAX_SUMMARY) {
        problems.push(`première ligne trop longue : ${first.length} caractères (${MAX_SUMMARY} au plus ; le détail va après une ligne vide)`);
    }
    if (lines.length > 1 && second !== '') problems.push('la deuxième ligne doit être vide (puis le détail)');
    return problems;
}

// Appel par git : node commit-msg.js <fichier>
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const raw = readFileSync(process.argv[2], 'utf8');
    let setting = '#';
    try { setting = execFileSync('git', ['config', '--get', 'core.commentChar'], { encoding: 'utf8' }).trim() || '#'; } catch { /* non réglé */ }
    const problems = checkMessage(raw, commentCharOf(raw, setting));
    if (problems.length) {
        console.error('Commit refusé : message hors du format de CLAUDE.md (section Git).');
        for (const problem of problems) console.error(`  - ${problem}`);
        console.error('Format : type(zone): résumé, une ligne vide, puis le détail. Exemple :');
        console.error('  fix(carrier): brin d\'arrêt tient plein gaz');
        process.exit(1);
    }
}
