// Rejeu (lot 5, js/Replay.js) : avance au temps réel × vitesse (×1, ×2, ×4, ×8), pause, saut, arrêt en fin de vol,
// événements franchis (messages ATC, toucher) annoncés une seule fois
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Replay, SPEEDS } from '../js/Replay.js';

const flight = {
    meta: {},
    samples: Array.from({ length: 101 }, (_, i) => ({ t: i / 10, x: i, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, hdg: 0, phase: 'vol' })),
    events: [{ t: 2, kind: 'atc', text: 'Tour : bonjour' }, { t: 7.5, kind: 'touchdown', text: 'Toucher', impact: 1 }],
};

test('vitesses ×1 à ×8 et pause', () => {
    assert.deepEqual(SPEEDS, [1, 2, 4, 8]);
    const r = new Replay(flight);
    r.advance(1);
    assert.equal(r.t, 1);
    r.setSpeed(4);
    assert.ok(Math.abs(r.advance(0.5).x - 30) < 1e-9);
    r.setSpeed(3);
    assert.equal(r.speed, 4, 'vitesse hors liste refusée');
    r.pause();
    r.advance(1);
    assert.equal(r.t, 3);
    r.toggle();
    assert.equal(r.paused, false);
});

test('fin du vol : pause sur le dernier échantillon ; relancer repart du début', () => {
    const r = new Replay(flight, 9);
    r.setSpeed(8);
    r.advance(1);
    assert.equal(r.t, 10);
    assert.equal(r.ended, true);
    assert.equal(r.paused, true);
    r.play();
    assert.equal(r.t, 0);
});

test('saut et événements franchis une seule fois', () => {
    const r = new Replay(flight);
    r.seek(1.5);
    r.advance(1);
    assert.deepEqual(r.passedEvents().map((e) => e.kind), ['atc']);
    r.advance(1);
    assert.deepEqual(r.passedEvents(), []);
    r.seek(-5);
    assert.equal(r.t, 0);
    r.seek(1e6);
    assert.equal(r.t, 10);
});
