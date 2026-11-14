// ILS (js/ILS.js) : localizer et glide sur une piste de synthèse, sans le reste du jeu
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { ILS } from '../js/ILS.js';

const GLIDE = 3 * Math.PI / 180;
// Piste 36 : seuil à l'origine, axe vers le nord (-z), gauche = ouest (-x), point visé 300 m après le seuil
function runway36() {
    const threshold = new Vector3(0, 0, 0), direction = new Vector3(0, 0, -1);
    return { name: '36', heading: 360, length: 1000, threshold, direction, left: new Vector3(-1, 0, 0),
        aimPoint: threshold.clone().addScaledVector(direction, 300), ilsFrequency: '110.30' };
}
// Avion à before m avant le seuil, lateral m à gauche de l'axe, height m de haut
const position = (before, lateral = 0, height = 0) => new Vector3(-lateral, height, before);

test('dans l\'axe et sur la pente : aiguilles centrées, distance au seuil', () => {
    const ils = new ILS([runway36()], 1000);
    const state = ils.update(position(3000, 0, Math.tan(GLIDE) * 3300));
    assert.equal(state.available, true);
    assert.equal(state.runway, '36');
    assert.equal(state.frequency, '110.30');
    assert.ok(Math.abs(state.localizer) < 1e-6, `localizer ${state.localizer}`);
    assert.ok(Math.abs(state.glideslope) < 1e-3, `glide ${state.glideslope}`);
    assert.ok(Math.abs(state.distance - 3000) < 1e-6);
    assert.ok(Math.abs(state.glideHeight - Math.tan(GLIDE) * 3300) < 1e-6);
});

test('à gauche de l\'axe : l\'axe est à droite, aiguille à droite (+) ; en butée à 2,5°', () => {
    const ils = new ILS([runway36()], 1000);
    let state = ils.update(position(3000, 100, 170));
    assert.ok(state.localizer > 0.5 && state.localizer < 0.65, `localizer ${state.localizer}`);   // atan(100 / 4000) = 1,43° sur 2,5°
    state = ils.update(position(3000, 400, 170));
    assert.equal(state.localizer, 1);
    state = ils.update(position(3000, -100, 170));
    assert.ok(state.localizer < 0, 'à droite de l\'axe : aiguille à gauche');
});

test('sous la pente : la pente est au-dessus, aiguille en haut (+) ; au-dessus : aiguille en bas', () => {
    const ils = new ILS([runway36()], 1000);
    assert.ok(ils.update(position(3000, 0, 100)).glideslope > 0.5);
    assert.ok(ils.update(position(3000, 0, 300)).glideslope < -0.5);
    assert.equal(ils.update(position(3000, 0, 20)).glideslope, 1);
});

test('hors du faisceau : trop loin, trop haut, trop de côté, derrière le seuil (ILS éteint)', () => {
    const ils = new ILS([runway36()], 1000);
    assert.equal(ils.update(position(9000, 0, 450)).available, false);
    assert.equal(ils.update(position(3000, 0, 1600)).available, false);
    assert.equal(ils.update(position(1000, 3000, 100)).available, false);   // > 35° de l'axe
    assert.equal(ils.update(position(-200, 0, 10)).available, false);        // (pas encore actif : seulement en approche)
});

test('allumé en approche, l\'ILS reste disponible sur la piste (localizer seul) puis se coupe au-delà', () => {
    const ils = new ILS([runway36()], 1000);
    ils.update(position(3000, 0, 170));
    assert.equal(ils.toggle(), true);
    const onRunway = ils.update(position(-500, 0, 1));
    assert.equal(onRunway.available, true);
    assert.equal(onRunway.glideslope, 0);
    assert.equal(ils.update(position(-1500, 0, 1)).available, false);
    assert.equal(ils.active, false);
});

test('conseil en clair et filtre par fréquence', () => {
    const ils = new ILS([runway36(), { ...runway36(), name: '18', ilsFrequency: '109.90' }], 1000);
    ils.update(position(3000, 100, 100));
    assert.equal(ils.advice(), 'corrigez à droite · trop bas : remontez');
    ils.update(position(3000, 0, 170));
    assert.equal(ils.advice(), 'dans l\'axe · sur la pente');
    assert.equal(ils.update(position(3000, 0, 170), '109.90').runway, '18');
    assert.equal(ils.update(position(3000, 0, 170), '111.10').available, false);
    assert.equal(ils.advice(), '');
});
