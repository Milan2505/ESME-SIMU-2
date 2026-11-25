// Notation des leçons (lot 6, js/LessonGrade.js) : critères tenus ou non, pondération, malus des écarts du débriefing,
// mentions, critères démontrés par le moniteur, progression enregistrée (stockage simulé, écriture coupée en mode test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, within, loadProgress, saveProgress, recordAttempt, PROGRESS_KEY, PENALTY } from '../js/LessonGrade.js';

const CRITERIA = [
    { key: 'bank', label: { fr: 'Inclinaison', en: 'Bank' }, limit: 5, compare: 'abs', unit: '°', source: 'FAA-S-ACS-6C, PA.V.A.S3, p. 36' },
    { key: 'alt', label: 'Altitude', limit: 100, compare: 'max', unit: 'ft', weight: 2, source: 'FAA-S-ACS-6C, PA.V.A.S4, p. 36' },
    { key: 'agl', label: 'Hauteur', limit: 1500, compare: 'min', unit: 'ft', source: 'FAA-S-ACS-6C, PA.VII.B.S2, p. 43' },
];

class MemoryStorage {
    constructor() { this.data = new Map(); }
    getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
    setItem(k, v) { this.data.set(k, String(v)); }
}

test('comparaisons : max, min, abs, bool ; pas de mesure -> null', () => {
    assert.equal(within('max', 100, 100), true);
    assert.equal(within('max', 101, 100), false);
    assert.equal(within('min', 1499, 1500), false);
    assert.equal(within('abs', -4.9, 5), true);
    assert.equal(within('abs', -5.1, 5), false);
    assert.equal(within('bool', true, true), true);
    assert.equal(within('bool', false, undefined), false);
    assert.equal(within('max', null, 1), null);
    assert.equal(within('max', NaN, 1), null);
});

test('tous les critères tenus, sans écart : 100, Excellent, réussi', () => {
    const r = grade({ criteria: CRITERIA, results: { bank: -3, alt: 60, agl: 2500 } });
    assert.equal(r.score, 100);
    assert.equal(r.passed, true);
    assert.equal(r.mention, 'Excellent');
    assert.deepEqual(r.details.map((d) => d.ok), [true, true, true]);
    assert.equal(r.details[0].source, 'FAA-S-ACS-6C, PA.V.A.S3, p. 36');
    assert.equal(r.details[0].label, 'Inclinaison');
    assert.equal(grade({ criteria: CRITERIA, results: { bank: 0, alt: 0, agl: 2000 }, lang: 'en' }).details[0].label, 'Bank');
});

test('pondération : critère de poids 2 manqué -> 50, non réussi, À revoir', () => {
    const r = grade({ criteria: CRITERIA, results: { bank: 2, alt: 150, agl: 1800 } });
    assert.equal(r.score, 50);
    assert.equal(r.passed, false);
    assert.equal(r.mention, 'À revoir');
});

test('critère non mesuré : compté manqué', () => {
    const r = grade({ criteria: CRITERIA, results: { bank: 2, alt: 50 } });
    assert.equal(r.details[2].ok, false);
    assert.equal(r.details[2].measured, false);
    assert.equal(r.score, 75);
    assert.equal(r.passed, false);
});

test('écarts du débriefing : malus par sévérité ; un écart sévère fait échouer ; accident : Non réussi', () => {
    const results = { bank: 2, alt: 50, agl: 2000 };
    const warn = grade({ criteria: CRITERIA, results, deviations: [{ kind: 'vfe', severity: 'warn', message: 'VFE', t: 3 }, { kind: 'x', severity: 'info', t: 4 }] });
    assert.equal(warn.score, 100 - PENALTY.warn);
    assert.equal(warn.passed, true);
    assert.equal(warn.mention, 'Excellent');
    assert.equal(warn.penalties.length, 1);
    const severe = grade({ criteria: CRITERIA, results, deviations: [{ kind: 'load', severity: 'severe', t: 3 }] });
    assert.equal(severe.score, 100 - PENALTY.severe);
    assert.equal(severe.passed, false);
    assert.equal(severe.mention, 'À revoir');
    const crash = grade({ criteria: CRITERIA, results, deviations: [{ kind: 'crash', severity: 'severe', t: 9 }] });
    assert.equal(crash.mention, 'Non réussi');
    const many = grade({ criteria: CRITERIA, results, deviations: Array.from({ length: 20 }, () => ({ kind: 'x', severity: 'severe' })) });
    assert.equal(many.score, 0);
});

test('étape montrée par le moniteur : critère « démontré », hors note', () => {
    const r = grade({ criteria: CRITERIA, results: { bank: { value: 20, demonstrated: true }, alt: 50, agl: 2000 } });
    assert.equal(r.details[0].demonstrated, true);
    assert.equal(r.details[0].ok, null);
    assert.equal(r.demonstrated, 1);
    assert.equal(r.score, 100);
    assert.equal(r.passed, true);
    // Tout démontré : rien à noter, pas « réussi »
    const all = grade({ criteria: CRITERIA.slice(0, 1), results: { bank: { value: 0, demonstrated: true } } });
    assert.equal(all.passed, false);
});

test('progression : essais, meilleure note, dernière, réussite gardée ; écriture coupée (mode test)', () => {
    const storage = new MemoryStorage();
    const date = new Date('2026-11-22T10:00:00Z');
    let p = saveProgress('virages45', { score: 80, passed: true, mentionKey: 'passed' }, { storage, date });
    assert.deepEqual(p.virages45, { attempts: 1, best: 80, last: 80, mention: 'passed', passed: true, date: '2026-11-22T10:00:00.000Z' });
    p = saveProgress('virages45', { score: 40, passed: false, mentionKey: 'failed' }, { storage, date });
    assert.equal(p.virages45.attempts, 2);
    assert.equal(p.virages45.best, 80);
    assert.equal(p.virages45.last, 40);
    assert.equal(p.virages45.passed, true);
    assert.deepEqual(loadProgress(storage), p);
    // Mode test : rien n'est écrit
    const before = storage.getItem(PROGRESS_KEY);
    const memory = saveProgress('vrille', { score: 90, passed: true }, { storage, persist: false, date });
    assert.equal(memory.vrille.best, 90);
    assert.equal(storage.getItem(PROGRESS_KEY), before);
    // Stockage illisible ou absent : progression vide, sans erreur
    storage.setItem(PROGRESS_KEY, '{oups');
    assert.deepEqual(loadProgress(storage), {});
    assert.deepEqual(loadProgress(null), {});
    const fresh = recordAttempt({}, 'vor', { score: 55 }, date);
    assert.equal(fresh.vor.attempts, 1);
});
