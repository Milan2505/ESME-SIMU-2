// Sons de la radionavigation (js/NavAudio.js) : cadences des radiobornes (OACI Annexe 10 vol. I § 3.1.7) et indicatif
// morse des NDB (§ 3.4), fonctions pures ; la classe ne joue rien sous Node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavAudio, markerKeying, morseKeying, morseElements, morseUnit, MARKER_TONES, NDB_TONE } from '../js/NavAudio.js';

// Fronts montants (début de chaque signe) entre 0 et duration (s), échantillonnés finement
function onsets(keying, duration, step = 0.001) {
    const starts = [];
    let previous = keying(-step);
    for (let t = 0; t < duration; t += step) {
        const on = keying(t);
        if (on && !previous) starts.push(t);
        previous = on;
    }
    return starts;
}
// Durée de chaque signe (s)
function lengths(keying, duration, step = 0.001) {
    const out = [];
    let run = 0;
    for (let t = 0; t < duration; t += step) {
        if (keying(t)) run += step;
        else if (run > 0) { out.push(run); run = 0; }
    }
    return out;
}

test('tonalités OACI : OM 400 Hz, MM 1300 Hz, IM 3000 Hz, NDB 1020 Hz', () => {
    assert.deepEqual(MARKER_TONES, { OM: 400, MM: 1300, IM: 3000 });
    assert.equal(NDB_TONE, 1020);
});

test('OM : traits à 2 par seconde', () => {
    const starts = onsets((t) => markerKeying('OM', t), 10);
    assert.equal(starts.length, 20);
    for (const l of lengths((t) => markerKeying('OM', t), 10)) assert.ok(l > 0.25 && l < 0.5, `trait ${l}`);
});

test('IM : points à 6 par seconde', () => {
    assert.equal(onsets((t) => markerKeying('IM', t), 10).length, 60);
    for (const l of lengths((t) => markerKeying('IM', t), 10)) assert.ok(l < 1 / 6, `point ${l}`);
});

test('MM : traits (cadence 2/s) et points (cadence 6/s) alternés', () => {
    const signs = lengths((t) => markerKeying('MM', t), 8);
    // Alternance trait long / point court
    for (let i = 1; i < signs.length; i++) {
        const [a, b] = [signs[i - 1], signs[i]];
        assert.ok((a > 0.25) !== (b > 0.25), `signes ${a} puis ${b}`);
    }
    // Un trait et un point par cycle de 1/2 + 1/6 s
    assert.equal(onsets((t) => markerKeying('MM', t), 8).length, 2 * Math.round(8 / (1 / 2 + 1 / 6)));
});

test('pas de radioborne : jamais modulé', () => {
    for (let t = 0; t < 2; t += 0.01) assert.equal(markerKeying(null, t), false);
});

test('morse : signes et espacements (point 1, trait 3, 1 entre signes, 3 entre lettres)', () => {
    // A = .-  M = --  ->  .- / --
    const { elements, length } = morseElements('AM');
    assert.deepEqual(elements, [[0, 1], [2, 3], [8, 3], [12, 3]]);
    assert.equal(length, 15);
    assert.equal(morseElements('alm').elements.length, 2 + 4 + 2);
    assert.equal(morseUnit(7), 1.2 / 7);
});

test('indicatif NDB à 7 mots/min, répété au moins 3 fois par 30 s', () => {
    const unit = morseUnit(7);
    const keying = (t) => morseKeying('ALM', t, 7);
    // Premier signe : point de A (1 unité), puis trait (3 unités)
    assert.equal(keying(unit * 0.5), true);
    assert.equal(keying(unit * 1.5), false);
    assert.equal(keying(unit * 3), true);
    // Nombre de signes en 30 s : .- .-.. -- = 8 par indicatif, au moins 3 indicatifs
    const signs = onsets(keying, 30, 0.002).length;
    assert.ok(signs >= 24, `${signs} signes en 30 s`);
    // Durée d'un indicatif : 27 unités (4,6 s) à 7 mots/min
    const { length } = morseElements('ALM');
    assert.equal(length, 27);
    assert.ok(Math.abs(length * unit - 4.63) < 0.01);
    // Indicatif inconnu : rien
    assert.equal(morseKeying('', 1), false);
});

test('NavAudio sous Node : horloge et voyants, sans son', () => {
    const audio = new NavAudio();
    audio.update(0.1, { marker: 'OM', mkrOn: true, ndbIdent: 'ALM', adfOn: true, volume: 1 });
    assert.ok(Math.abs(audio.time - 0.1) < 1e-12);
    assert.equal(audio.lamp('OM'), markerKeying('OM', 0.1));
    assert.equal(audio.lamp(null), false);
    audio.disconnect();
    audio.altitudeAlert();
});
