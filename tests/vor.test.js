// Récepteur VOR / DME (js/VOR.js) : balise à l'origine, caps en degrés (0 = nord = -z, 90 = est = +x)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOR } from '../js/VOR.js';

const station = { x: 0, y: 0, z: 0, ident: 'ESM', frequency: '112.40' };
const NM = 1852;

test('radial, relèvement, distance DME', () => {
    const vor = new VOR(station);
    const state = vor.update({ x: 10000, y: 300, z: 0 });   // 10 km à l\'est
    assert.equal(state.available, true);
    assert.ok(Math.abs(state.radial - 90) < 1e-9);
    assert.equal(state.bearingTo, 270);
    assert.ok(Math.abs(state.distance - Math.hypot(10000, 300)) < 1e-9);
    assert.ok(Math.abs(state.dmeNM - Math.hypot(10000, 300) / NM) < 1e-9);
    assert.equal(state.ident, 'ESM');
    assert.equal(vor.update({ x: 0, y: 300, z: 10000 }).radial, 180);   // au sud
});

test('OBS : TO vers la balise, FROM en s\'en éloignant, aiguille centrée sur le radial', () => {
    const vor = new VOR(station);
    vor.setCourse(270);
    let state = vor.update({ x: 10000, y: 300, z: 0 });
    assert.equal(state.to, true);
    assert.ok(Math.abs(state.deviation) < 1e-9);
    vor.setCourse(90);
    state = vor.update({ x: 10000, y: 300, z: 0 });
    assert.equal(state.to, false);
    assert.ok(Math.abs(state.deviation) < 1e-9);
});

test('écart : 10° = butée ; la route à gauche de l\'avion donne une aiguille à gauche (-)', () => {
    const vor = new VOR(station);
    vor.setCourse(280);   // vers la balise depuis l'est, avion 10° au nord de cette route
    let state = vor.update({ x: 10000, y: 300, z: 0 });
    assert.equal(state.to, true);
    assert.equal(state.deviation, -1);
    vor.setCourse(275);
    state = vor.update({ x: 10000, y: 300, z: 0 });
    assert.ok(Math.abs(state.deviation + 0.5) < 1e-9, `déviation ${state.deviation}`);
    vor.setCourse(265);
    assert.ok(vor.update({ x: 10000, y: 300, z: 0 }).deviation > 0);
});

test('OBS : normalisation, pas, centrage automatique', () => {
    const vor = new VOR(station);
    vor.setCourse(-10);
    assert.equal(vor.course, 350);
    vor.turnCourse(20);
    assert.equal(vor.course, 10);
    vor.setCourse(359.6);
    assert.equal(vor.course, 0);
    vor.update({ x: 5000, y: 300, z: -5000 });   // au nord-est : radial 45
    vor.centerTo();
    assert.equal(vor.course, 225);
    const state = vor.update({ x: 5000, y: 300, z: -5000 });
    assert.equal(state.to, true);
    assert.ok(Math.abs(state.deviation) < 1e-9);
});

test('cône de silence au-dessus de la balise, portée de 40 km', () => {
    const vor = new VOR(station);
    assert.equal(vor.update({ x: 100, y: 1000, z: 0 }).overhead, true);
    assert.equal(vor.update({ x: 2000, y: 1000, z: 0 }).overhead, false);
    assert.equal(vor.update({ x: 39000, y: 1000, z: 0 }).available, true);
    assert.equal(vor.update({ x: 41000, y: 1000, z: 0 }).available, false);
});
