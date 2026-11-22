// Hook git commit-msg (activé par « npm install » : script « prepare », core.hooksPath = .githooks) : met au format de
// CLAUDE.md, section Git, tout message qui n'y est pas (22/11/2026 : les commits faits depuis VS Code étaient refusés ;
// le message est désormais corrigé, jamais refusé) :
//   type(zone): résumé        <- première ligne, 100 caractères au plus
//                             <- ligne vide (s'il y a un détail)
//   détail…
// Types : feat, fix, perf, refactor, test, docs, chore. Zone : minuscules, chiffres, tirets (flight, heli, ui…).
// Seules exceptions : les messages que git écrit lui-même : fusion (« Merge branch … », git pull), annulation
// (« Revert "…" », « Reapply "…" ») ; et les commits de correction pour rebase --autosquash (« fixup! », « squash! »,
// « amend! » suivis d'un message au format).
// Message hors format : type deviné d'après les mots du message (corrige -> fix, ajoute -> feat…), zone d'après les
// fichiers du commit (tests, docs, flight, ui…), le message d'origine en résumé (et en détail s'il est long).
// Utilisable seul : node .githooks/commit-msg.js <fichier du message> (message corrigé dans le fichier).
import { readFileSync, writeFileSync } from 'node:fs';
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

// Zone d'après les fichiers du commit : la même pour tous, sinon « divers »
const ZONES = [
    [/^tests\//, 'tests'], [/^(docs\/|.*\.md$|manuel\.)/, 'docs'],
    [/^(\.githooks|tools|\.vscode)\/|^(package(-lock)?\.json|eslint\.config\.js|playwright\.config\.js|\.git\w*)$/, 'tooling'],
    [/^js\/(lessons\/|Initiation|InstructorPilot|LessonGrade)/, 'lecons'], [/^js\/(HeliModel|R44)/, 'heli'], [/^js\/(F15|Jet|Weapon|Damage|Shield)/, 'f15'],
    [/^js\/(RigidBodyModel|FlightModel|Cessna172|InputRamp|PlaneControls|Propulsion|Atmosphere|data\/)/, 'flight'],
    [/^js\/(Terrain|Scenery|Nature|City|Clouds|CloudLayer|Airport)/, 'scenery'], [/^js\/(.*Sound|AudioUnlock|NavAudio|StallWarning)/, 'audio'],
    [/^(index\.html|style\.css|js\/(Settings|TouchControls|Tablet|Draggable|Debriefing|Charts|MapView|DevicesWindow))/, 'ui'],
];
export function zoneOf(files) {
    const zones = new Set(files.map((f) => ZONES.find(([re]) => re.test(f))?.[1] ?? 'divers'));
    return zones.size === 1 ? [...zones][0] : 'divers';
}
// Type d'après les mots du message, ou les fichiers (tous des tests, toute de la documentation)
export function typeOf(text, files) {
    if (/(corrig|répar|repar|bug|fix|erreur|problème|probleme|plantag|crash)/i.test(text)) return 'fix';
    if (files.length && files.every((f) => /^tests\//.test(f))) return 'test';
    if (files.length && files.every((f) => /^docs\/|\.md$|^manuel\./.test(f))) return 'docs';
    if (/(ajout|ajoute|nouve|feat|lot \d|leçon|lecon)/i.test(text)) return 'feat';
    return 'chore';
}
// Message corrigé (null : déjà au format, ou écrit par git) ; files : fichiers du commit
export function fixMessage(raw, files = [], commentChar = '#') {
    if (!checkMessage(raw, commentChar).length) return null;
    const lines = cleanMessage(raw, commentChar);
    const text = lines.join(' ').replace(/\s+/g, ' ').trim();
    // Début déjà « type(zone): » ou « type: » mal écrit : repris sans ce préfixe
    const first = (lines[0] ?? '').replace(/^[a-zA-Z]+(\([^)]*\))?\s*:\s*/, '').replace(/[.\s]+$/, '').trim();
    const prefix = `${typeOf(text, files)}(${zoneOf(files)}): `;
    let summary = first || `mise à jour (${files.length} fichier${files.length > 1 ? 's' : ''})`;
    const long = summary.length > MAX_SUMMARY - prefix.length;
    if (long) summary = `${summary.slice(0, MAX_SUMMARY - prefix.length - 1).trimEnd()}…`;
    const body = lines.slice(1);
    if (long) body.unshift(lines[0]);   // résumé coupé : le message entier dans le détail
    while (body[0] === '') body.shift();
    const message = [prefix + summary, ...(body.length ? ['', ...body] : [])].join('\n') + '\n';
    return checkMessage(message).length ? 'chore(divers): mise à jour\n' : message;
}

// Appel par git : node commit-msg.js <fichier>
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const raw = readFileSync(process.argv[2], 'utf8');
    let setting = '#';
    try { setting = execFileSync('git', ['config', '--get', 'core.commentChar'], { encoding: 'utf8' }).trim() || '#'; } catch { /* non réglé */ }
    let files = [];
    try { files = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* hors dépôt */ }
    const fixed = fixMessage(raw, files, commentCharOf(raw, setting));
    if (fixed) {
        writeFileSync(process.argv[2], fixed);
        console.error(`Message de commit mis au format de CLAUDE.md (section Git) : « ${fixed.split('\n')[0]} »`);
    }
}
