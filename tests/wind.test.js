// Vent de l'aérodrome (js/Wind.js) : tirage à graine, horloge simulée (le vent dérive avec Date.now)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wind } from '../js/Wind.js';

const KT = 0.514444;
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const seeded = (seed, metar) => { const wind = new Wind(); wind.setSeed(seed); wind.set(metar); return wind; };

test('même graine, même vent (direction, force, vecteur) ; graines différentes, vents différents', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const metar = { wind: 270, knots: 12, variation: 40, gust: 20 };
    const a = seeded(42, metar), b = seeded(42, metar), c = seeded(43, metar);
    assert.equal(a.direction, b.direction);
    assert.equal(a.speed, b.speed);
    assert.deepEqual(a.vector.toArray(), b.vector.toArray());
    assert.notEqual(a.seedDirection, c.seedDirection);
    assert.ok(a.knots >= 6 && a.knots <= 19, `force ${a.knots} kt (0,5 à 1,6 fois 12 kt)`);
});

test('la force suit la météo (plafonds 25 et 35 kt) et le vecteur souffle à l\'opposé de la direction', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const wind = seeded(7, { wind: 90, knots: 10, variation: 0, gust: 0 });
    assert.ok(wind.knots >= 5 && wind.knots <= 16, `force ${wind.knots} kt`);
    assert.equal(wind.gust, 0);
    const rad = wind.direction * Math.PI / 180;
    assert.ok(Math.abs(wind.vector.x - (-Math.sin(rad) * wind.speed * KT)) < 1e-9);
    assert.ok(Math.abs(wind.vector.z - Math.cos(rad) * wind.speed * KT) < 1e-9);
    assert.equal(wind.vector.y, 0);
    wind.set({ wind: 90, knots: 100, variation: 0, gust: 150 });
    assert.equal(wind.knots, 25, 'plafond 25 kt');
    assert.equal(wind.gust, 35, 'rafales plafonnées à 35 kt');
});

test('calme, étendue de la variation, météo partagée prioritaire sur la météo locale', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const wind = seeded(1, { wind: 360, knots: 0 });
    assert.equal(wind.calm, true);
    assert.equal(wind.speed, 0);
    wind.set({ wind: 360, knots: 15, variation: 60 });
    assert.equal(wind.calm, false);
    const [from, to] = wind.range;
    assert.ok(from % 10 === 0 && to % 10 === 0 && from >= 10 && from <= 360 && to >= 10 && to <= 360, `${from} à ${to}`);
    wind.setShared({ wind: 180, knots: 0 });
    assert.equal(wind.metarBase, 180);
    assert.equal(wind.calm, true);
    wind.setShared(null);
    assert.equal(wind.metarBase, 360);
});

test('la direction moyenne dérive lentement avec le temps, sauf pendant une suspension (setHold)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const wind = seeded(5, { wind: 360, knots: 10, variation: 0 });
    const before = wind.base;
    t.mock.timers.tick(10 * 60 * 1000);   // 10 min
    wind.update();
    assert.notEqual(wind.base, before, 'la direction moyenne a tourné');
    wind.setHold(true);
    const held = wind.base;
    t.mock.timers.tick(10 * 60 * 1000);
    wind.update();
    assert.ok(Math.abs(wind.base - held) < 1e-9, 'suspendue : la direction moyenne ne bouge plus');
    wind.setHold(false);
    t.mock.timers.tick(10 * 60 * 1000);
    wind.update();
    assert.ok(Math.abs(wind.base - held) > 1e-6, 'reprise : elle tourne de nouveau');
});

test('horloge remplaçable (mode test : temps de vol) : même vent quelle que soit l\'heure réelle, et il suit cette horloge', (t) => {
    const metar = { wind: 46, knots: 4, variation: 27, gust: 0 };
    const at = (realTime, flightSeconds) => {
        t.mock.timers.enable({ apis: ['Date'], now: realTime });
        const wind = new Wind();
        wind.now = () => 1.8e9 + flightSeconds;
        wind.setSeed(1);
        wind.set(metar);
        wind.update();
        const v = wind.vector.clone();
        t.mock.timers.reset();
        return v;
    };
    const morning = at(Date.UTC(2026, 0, 1, 8), 0), evening = at(Date.UTC(2026, 5, 1, 20), 0);
    assert.ok(morning.distanceTo(evening) < 1e-9, 'même vent à deux heures réelles différentes');
    assert.ok(at(NOW, 0).distanceTo(at(NOW, 120)) > 1e-6, 'le vent varie avec l\'horloge remplacée');
});
