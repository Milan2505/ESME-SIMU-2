// Radiobornes de l'ILS (js/ILS.js, markerAt) : OM à 7200 m et MM à 1050 m du seuil (OACI Annexe 10 vol. I § 3.1.7),
// reçues dans un cône qui s'élargit avec la hauteur, indépendamment de la fréquence NAV
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { ILS, MARKERS, markerAt } from '../js/ILS.js';

const GLIDE = Math.tan(3 * Math.PI / 180);
// Piste 36 : seuil à l'origine, axe vers le nord (-z), gauche = ouest (-x), point visé 240 m après le seuil
function runway36() {
    const threshold = new Vector3(0, 0, 0), direction = new Vector3(0, 0, -1);
    return { name: '36', heading: 360, length: 1000, threshold, direction, left: new Vector3(-1, 0, 0),
        aimPoint: threshold.clone().addScaledVector(direction, 240), ilsFrequency: '110.30' };
}
// Avion à before m avant le seuil, lateral m à gauche de l'axe, height m de haut
const position = (before, lateral = 0, height = 0) => new Vector3(-lateral, height, before);
const onGlide = (before) => GLIDE * (before + 240);

test('distances OACI : OM 7200 m, MM 1050 m', () => {
    assert.equal(MARKERS.OM.distance, 7200);
    assert.equal(MARKERS.MM.distance, 1050);
});

test('sur la pente : OM puis MM, rien entre les deux ni après', () => {
    const rw = runway36();
    assert.equal(markerAt(position(9000, 0, onGlide(9000)), rw), null);
    assert.equal(markerAt(position(7200, 0, onGlide(7200)), rw), 'OM');
    assert.equal(markerAt(position(4000, 0, onGlide(4000)), rw), null);
    assert.equal(markerAt(position(1050, 0, onGlide(1050)), rw), 'MM');
    assert.equal(markerAt(position(300, 0, onGlide(300)), rw), null);
    assert.equal(markerAt(position(-500, 0, 20), rw), null);
});

test('longueur reçue sur la pente : OM ~600 m (OACI 600 ± 200), MM ~300 m (300 ± 100)', () => {
    const rw = runway36();
    const covered = (center) => {
        let n = 0;
        for (let d = center - 1500; d <= center + 1500; d += 5) if (markerAt(position(d, 0, onGlide(d)), rw)) n++;
        return n * 5;
    };
    const om = covered(7200), mm = covered(1050);
    assert.ok(om >= 400 && om <= 800, `OM ${om} m`);
    assert.ok(mm >= 200 && mm <= 400, `MM ${mm} m`);
});

test('cône : plus haut, reçu plus loin de la balise ; trop haut, plus rien', () => {
    const rw = runway36();
    // 500 m après l'OM : pas reçu à 390 m de haut, reçu à 1000 m (demi-largeur ≈ 1000 × tan 40° = 839 m)
    assert.equal(markerAt(position(6700, 0, 390), rw), null);
    assert.equal(markerAt(position(6700, 0, 1000), rw), 'OM');
    assert.equal(markerAt(position(7200, 0, 3500), rw), null);
    // Au sol, juste au-dessus de la balise : reçu
    assert.equal(markerAt(position(1050, 0, 0), rw), 'MM');
});

test('en travers de l\'axe : éventail plus large que le long de l\'axe, borné', () => {
    const rw = runway36();
    assert.equal(markerAt(position(7200, 600, 400), rw), 'OM');
    assert.equal(markerAt(position(7200, -600, 400), rw), 'OM');
    assert.equal(markerAt(position(7200, 3000, 400), rw), null);
});

test('indépendant de la fréquence NAV et de la portée du localizer ; liste de pistes', () => {
    const rw = runway36();
    const other = { ...runway36(), name: '18', threshold: new Vector3(0, 0, -1000), direction: new Vector3(0, 0, 1),
        left: new Vector3(1, 0, 0) };
    const ils = new ILS([rw, other], 1000);
    ils.update(position(7200, 0, onGlide(7200)), '999.99');   // aucune piste sur cette fréquence
    assert.equal(ils.state.available, false);
    assert.equal(ils.marker(position(7200, 0, onGlide(7200))), 'OM');
    // MM de la piste 18 : 1050 m au nord de son seuil (z = -2050)
    assert.equal(markerAt(new Vector3(0, 30, -2050), [rw, other]), 'MM');
});
