// Repères du badin et vitesses limites du 172P (js/data/C172pSpeeds.js), partagés par les badins et le débriefing :
// POH 172P section 2 (fig. 2-1, 2-2) et supplément FAA Air Plains 1987 (trait rouge 158, arc jaune 127-158). Avant le
// 25/11/2026, le jeu affichait les repères des 172R/S (trait rouge 163, arc vert jusqu'à 129, plaque VA 105)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C172P_SPEEDS } from '../js/data/C172pSpeeds.js';
import { THRESHOLDS, vfeFor } from '../js/FlightReview.js';

test('repères du badin du 172P : arcs, VNE, VNO, VA, VFE', () => {
    assert.equal(C172P_SPEEDS.vne, 158);
    assert.equal(C172P_SPEEDS.vno, 127);
    assert.equal(C172P_SPEEDS.va, 99);
    assert.deepEqual([C172P_SPEEDS.vfe10, C172P_SPEEDS.vfe], [110, 85]);
    assert.deepEqual(C172P_SPEEDS.arcs.white, [33, 85]);
    assert.deepEqual(C172P_SPEEDS.arcs.green, [44, 127]);
    assert.deepEqual(C172P_SPEEDS.arcs.yellow, [127, 158]);
    // arcs cohérents avec les vitesses limites
    assert.equal(C172P_SPEEDS.arcs.green[1], C172P_SPEEDS.vno);
    assert.equal(C172P_SPEEDS.arcs.yellow[1], C172P_SPEEDS.vne);
    assert.equal(C172P_SPEEDS.arcs.white[1], C172P_SPEEDS.vfe);
});

test('débriefing : mêmes VNE et VFE que les badins', () => {
    assert.equal(THRESHOLDS.vne.ias, C172P_SPEEDS.vne);
    assert.equal(vfeFor(10), 110);
    assert.equal(vfeFor(20), 85);
    assert.equal(vfeFor(0), Infinity);
});
