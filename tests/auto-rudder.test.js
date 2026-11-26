// Palonnier automatique (aide du modèle réaliste, 26/11/2026) : coupé d'office quand un axe de direction est affecté à un
// périphérique branché (palonnier, torsion du manche, stick de manette), réglage « Activé » ou non ; gardé au clavier
// et avec un périphérique sans axe de direction (yoke seul). simulator.js l'applique à chaque image (updateAutoRudder)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GamepadProfiles, autoRudderEnabled, hasAxisBinding } from '../js/GamepadMapping.js';

const pad = (id, { connected = true } = {}) => ({ id, index: 0, mapping: '', connected, axes: new Array(10).fill(0), buttons: [] });
const memory = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };
const YOKE = 'Saitek Pro Flight Yoke (Vendor: 06a3 Product: 0bac)';
const PEDALS = 'Saitek Pro Flight Rudder Pedals (Vendor: 06a3 Product: 0763)';
const XBOX = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';
const UNKNOWN = 'Manche inconnu (Vendor: 1234 Product: 5678)';

test('palonnier automatique : gardé au clavier et avec un yoke seul, coupé dès qu\'un axe de direction est affecté', () => {
    const profiles = new GamepadProfiles(memory());
    const of = (p) => profiles.bindingsFor(p);
    assert.equal(autoRudderEnabled(true, [], of), true, 'clavier seul');
    assert.equal(autoRudderEnabled(true, [pad(YOKE)], of), true, 'yoke sans axe de direction');
    assert.equal(hasAxisBinding([pad(YOKE), pad(PEDALS)], of, 'yaw'), true);
    assert.equal(autoRudderEnabled(true, [pad(YOKE), pad(PEDALS)], of), false, 'palonnier (préréglage)');
    assert.equal(autoRudderEnabled(true, [pad(XBOX)], of), false, 'manette : stick droit sur la direction');
    assert.equal(autoRudderEnabled(true, [pad(PEDALS, { connected: false })], of), true, 'palonnier débranché');
    assert.equal(autoRudderEnabled(false, [], of), false, 'réglage désactivé');
});

test('palonnier automatique : suit les affectations du joueur (« Assigner », « Effacer »)', () => {
    const profiles = new GamepadProfiles(memory());
    const of = (p) => profiles.bindingsFor(p);
    const stick = pad(UNKNOWN);
    assert.equal(autoRudderEnabled(true, [stick], of), true, 'périphérique inconnu, rien d\'affecté');
    profiles.assign(stick, 'yaw', { axis: 5 });
    assert.equal(autoRudderEnabled(true, [stick], of), false, 'axe de direction assigné');
    profiles.clear(stick, 'yaw');
    assert.equal(autoRudderEnabled(true, [stick], of), true, 'affectation effacée');
    const pedals = pad(PEDALS);
    profiles.clear(pedals, 'yaw');
    assert.equal(autoRudderEnabled(true, [pedals], of), true, 'palonnier dont la direction a été retirée (freins seuls)');
});
