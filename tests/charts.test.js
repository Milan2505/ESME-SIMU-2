// Courbes et trajectoire du débriefing (js/Charts.js, js/MapView.js) : fonctions pures, sans canvas
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, formatTime, decimate, extent, valueAt, TimeChart } from '../js/Charts.js';
import { MapView, altitudeColor, trackPoints, trackPoseAt } from '../js/MapView.js';

test('niceTicks : pas de 1, 2 ou 5 × 10^n, valeurs dans l\'intervalle', () => {
    assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(niceTicks(0, 10, 10), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(niceTicks(-3, 7, 4), [-2, 0, 2, 4, 6]);
    assert.deepEqual(niceTicks(0.1, 0.5, 4), [0.1, 0.2, 0.3, 0.4, 0.5]);   // pas de 0.30000000000000004
    assert.deepEqual(niceTicks(1013, 4870, 4), [2000, 3000, 4000]);
    assert.deepEqual(niceTicks(-1000, 1000, 4), [-1000, -500, 0, 500, 1000]);
    assert.ok(!Object.is(niceTicks(-1, 1, 2)[1], -0));
    for (const [min, max, count] of [[0, 1, 5], [12.3, 98.7, 6], [-45, 45, 6], [0, 5500, 5], [0.002, 0.009, 3]]) {
        const ticks = niceTicks(min, max, count);
        assert.ok(ticks.length >= 2, `${min}..${max}`);
        const step = ticks[1] - ticks[0];
        const mantissa = step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9));
        assert.ok([1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-6), `pas ${step}`);
        for (const v of ticks) assert.ok(v >= min - 1e-9 && v <= max + 1e-9);
    }
    // Bornes inversées, égales, non finies
    assert.deepEqual(niceTicks(100, 0, 5), [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(niceTicks(3, 3, 5), [3]);
    assert.deepEqual(niceTicks(NaN, 3, 5), []);
});

test('formatTime : mm:ss, puis h:mm:ss', () => {
    assert.equal(formatTime(0), '00:00');
    assert.equal(formatTime(65.9), '01:05');
    assert.equal(formatTime(599), '09:59');
    assert.equal(formatTime(3599), '59:59');
    assert.equal(formatTime(3600), '1:00:00');
    assert.equal(formatTime(3725), '1:02:05');
    assert.equal(formatTime(-4), '00:00');
    assert.equal(formatTime(undefined), '00:00');
});

test('extent : valeurs finies seulement', () => {
    assert.deepEqual(extent([3, -2, null, NaN, 7, Infinity, undefined]), [-2, 7]);
    assert.deepEqual(extent([5]), [5, 5]);
    assert.equal(extent([]), null);
    assert.equal(extent([null, NaN]), null);
});

test('decimate : minimum et maximum de chaque colonne, dans l\'ordre du temps', () => {
    // 10 000 points (1 000 s à 10 échantillons par seconde) ramenés à 100 colonnes
    const xs = [], ys = [];
    for (let i = 0; i < 10000; i++) { xs.push(i / 10); ys.push(Math.sin(i / 37) * 100 + (i === 5003 ? 500 : 0)); }
    const d = decimate(xs, ys, 0, 999.9, 100);
    assert.ok(d.xs.length <= 2 * 100 + 2, `${d.xs.length} points`);
    assert.equal(d.xs.length, d.ys.length);
    for (let i = 1; i < d.xs.length; i++) assert.ok(d.xs[i] > d.xs[i - 1], 'abscisses croissantes');
    // Pointe isolée gardée, extrêmes conservés
    assert.ok(d.ys.includes(ys[5003]));
    assert.deepEqual(extent(d.ys), extent(ys));
    // Moins de points que de colonnes : tous gardés
    const few = decimate([0, 1, 2], [5, 6, 4], 0, 2, 100);
    assert.deepEqual(few, { xs: [0, 1, 2], ys: [5, 6, 4] });
});

test('decimate : fenêtre partielle (un point de chaque côté) et trous', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const ys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const d = decimate(xs, ys, 3.5, 6.5, 50);
    assert.deepEqual(d.xs, [3, 4, 5, 6, 7]);
    // Trou : un point null entre les deux morceaux, jamais deux de suite
    const g = decimate([0, 1, 2, 3, 4, 5], [1, null, NaN, 3, 4, null], 0, 5, 50);
    assert.deepEqual(g.ys, [1, null, 3, 4, null]);
    assert.deepEqual(g.xs, [0, 1, 3, 4, 5]);
});

test('valueAt : interpolation linéaire, null hors du vol', () => {
    const ts = [0, 0.1, 0.2, 0.3], ys = [10, 20, null, 40];
    assert.equal(valueAt(ts, ys, 0.05), 15);
    assert.equal(valueAt(ts, ys, -1), null);
    assert.equal(valueAt(ts, ys, 0.4), null);
    assert.equal(valueAt(ts, ys, 0.12), 20);    // bord du trou, plus près du point valide
    assert.equal(valueAt(ts, ys, 0.18), null);  // plus près du trou
});

test('TimeChart : se construit et lit un vol sans DOM (canvas de taille nulle)', () => {
    const canvas = { clientWidth: 0, clientHeight: 0 };
    const chart = new TimeChart(canvas, {
        title: 'Profil vertical',
        series: [
            { key: 'alt', label: 'Altitude', unit: 'ft', color: '#8fd3ff' },
            { key: 'ground', label: 'Sol', unit: 'ft', color: '#7a6a4f', fill: true, value: (s) => s.alt - s.agl },
        ],
        limits: [{ value: 500, label: '500 ft' }],
    });
    chart.setFlight({ samples: [{ t: 0, alt: 1000, agl: 10 }, { t: 0.1, alt: 1010, agl: 15 }] });
    assert.deepEqual(chart._ys, [[1000, 1010], [990, 995]]);
    chart.setCursor(0.05);
    chart.destroy();
});

test('MapView : couleur, points de trajectoire, position interpolée', () => {
    assert.equal(altitudeColor(0), 'hsl(210, 85%, 55%)');
    assert.equal(altitudeColor(1), 'hsl(0, 85%, 55%)');
    assert.equal(altitudeColor(2), altitudeColor(1));
    const samples = [];
    for (let i = 0; i <= 105; i++) samples.push({ t: i / 10, x: i, z: -i, hdg: 350 + i / 10 * 4, alt: i });
    const points = trackPoints(samples, 1);
    assert.equal(points.length, 12);   // 0 à 10 s, plus le dernier (10,5 s)
    assert.equal(points[points.length - 1], samples[105]);
    const pose = trackPoseAt([{ t: 0, x: 0, z: 0, hdg: 350 }, { t: 1, x: 10, z: 20, hdg: 10 }], 0.5);
    assert.deepEqual(pose, { x: 5, z: 10, hdg: 0 });
    assert.equal(trackPoseAt([], 1), null);
    assert.equal(trackPoseAt(samples, 99).x, 105);
});

test('MapView : cadrage par fit, comportement sans fit inchangé', () => {
    const map = new MapView(null, { heightAt: () => 0, worldSize: 16000 });
    const own = { position: { x: 7900, z: -100 } };
    // Sans fit : zoom 1 (6 000 m), centre ramené dans le terrain
    assert.deepEqual(map.viewWindow(600, 400, own), { cx: 5000, cz: -100, span: 6000 });
    map.fitTrack([{ x: -1000, z: 0 }, { x: 1000, z: 500 }], 0.1);
    assert.deepEqual(map.viewWindow(600, 400, own), { cx: 0, cz: 250, span: 2400 });
    // Rectangle haut et étroit : la hauteur commande la largeur montrée
    map.fit(0, 100, 0, 3000, 0);
    assert.equal(map.viewWindow(600, 400, own).span, 4500);
    // Trajectoire immobile : 1 km au moins
    map.fitTrack([{ x: 0, z: 0 }]);
    assert.equal(map.viewWindow(600, 400, own).span, 1000);
    map.clearFit();
    assert.equal(map.viewWindow(600, 400, own).span, 6000);
    // Relief partagé
    const other = new MapView(null, { heightAt: () => 0, worldSize: 16000 });
    assert.equal(map.shareRelief(other)._reliefSource, other);
});
