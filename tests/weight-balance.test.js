// Masse et centrage (js/WeightBalance.js, computeLoad) : calcul pur, sans la fenêtre
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLoad, WB_LIMITS, WB_GALLON, FUEL_DENSITY } from '../js/WeightBalance.js';

const IN = 0.0254, LB = 0.45359237;
const EMPTY = { mass: 755, arm: 0.98 };   // avion vide équipé (valeurs du module)
const reference = { pilot: 80, copilot: 0, rear: 0, baggage: 10, fuelLeft: 76, fuelRight: 76 };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('chargement de référence : masse, moment, centrage (bras du manuel en pouces)', () => {
    const r = computeLoad(reference);
    const fuelKg = 152 * FUEL_DENSITY;
    close(r.fuelKg, fuelKg);
    close(r.mass, EMPTY.mass + 80 + 10 + fuelKg);
    const moment = EMPTY.mass * EMPTY.arm + 80 * 37 * IN + 10 * 95 * IN + fuelKg * 48 * IN;
    close(r.moment, moment);
    close(r.cg, moment / r.mass, 1e-12);
    assert.ok(r.cg > 35 * IN && r.cg < 47.3 * IN, 'centrage dans le domaine normal');
});

test('fuelFactor : part du carburant comptée (point « atterrissage »)', () => {
    const full = computeLoad(reference), half = computeLoad(reference, 0.5), empty = computeLoad(reference, 0);
    close(half.fuelKg, full.fuelKg / 2);
    close(empty.fuelKg, 0);
    close(full.mass - half.mass, full.fuelKg / 2);
    assert.ok(empty.cg < full.cg, 'les réservoirs (bras 48 po) sont en arrière du centrage : vides, le centrage avance');
});

test('les passagers arrière reculent le centrage, les bagages (soute A) encore plus par kilo', () => {
    const base = computeLoad(reference);
    const rear = computeLoad({ ...reference, rear: 80 });
    const baggage = computeLoad({ ...reference, baggage: 90 });
    assert.ok(rear.cg > base.cg);
    assert.ok(baggage.cg > rear.cg, 'même masse ajoutée (80 kg) plus en arrière');
    close(rear.mass - base.mass, 80);
});

test('limites du manuel du 172S converties en kg et en litres', () => {
    close(WB_LIMITS.maxTakeoff, 2550 * LB);
    close(WB_LIMITS.maxUtility, 2200 * LB);
    close(WB_LIMITS.maxBaggage, 120 * LB);
    close(WB_LIMITS.tankLitres, 26.5 * WB_GALLON);
    assert.equal(WB_GALLON, 3.785);
    assert.equal(FUEL_DENSITY, 0.72);
});

test('quatre adultes, bagages et pleins : masse maximale dépassée', () => {
    const heavy = computeLoad({ pilot: 90, copilot: 90, rear: 180, baggage: 50, fuelLeft: 100, fuelRight: 100 });
    assert.ok(heavy.mass > WB_LIMITS.maxTakeoff, `${heavy.mass.toFixed(0)} kg`);
    const light = computeLoad({ pilot: 75, copilot: 0, rear: 0, baggage: 0, fuelLeft: 40, fuelRight: 40 });
    assert.ok(light.mass < WB_LIMITS.maxUtility);
});
