// Masse et centrage (js/WeightBalance.js, computeLoad) : calcul pur, sans la fenêtre ; valeurs du POH 172P 1985 (fig. 6-5) et de la fiche TCDS 3A12 rév. 69
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLoad, checkLoad, WB_NORMAL, WB_UTILITY, WB_LIMITS, WB_GALLON, FUEL_DENSITY } from '../js/WeightBalance.js';

const IN = 0.0254, LB = 0.45359237;
const EMPTY = { mass: 1467 * LB, arm: 57300 / 1467 * IN };   // avion vide équipé (POH 172P fig. 6-5 p. 6-10)
const reference = { pilot: 80, copilot: 0, rear: 0, baggage: 10, fuelLeft: 75, fuelRight: 75 };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('chargement de référence : masse, moment, centrage (bras du manuel en pouces)', () => {
    const r = computeLoad(reference);
    const fuelKg = 150 * FUEL_DENSITY;
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

test('limites du 172P (TCDS 3A12 p. 13-14) converties en kg et en litres : 2 400 lb, utilitaire 2 100, bagages 120, 20 gal utilisables par aile', () => {
    close(WB_LIMITS.maxTakeoff, 2400 * LB);
    close(WB_LIMITS.maxUtility, 2100 * LB);
    close(WB_LIMITS.maxBaggage, 120 * LB);
    close(WB_LIMITS.tankLitres, 20 * WB_GALLON);
    assert.equal(WB_GALLON, 3.785);
    assert.equal(FUEL_DENSITY, 0.72);
});

test('quatre adultes, bagages et pleins : masse maximale dépassée ; pilote seul et pleins : dans la catégorie normale', () => {
    const heavy = computeLoad({ pilot: 90, copilot: 90, rear: 180, baggage: 50, fuelLeft: 75, fuelRight: 75 });
    assert.ok(heavy.mass > WB_LIMITS.maxTakeoff, `${heavy.mass.toFixed(0)} kg`);
    const light = computeLoad({ pilot: 75, copilot: 0, rear: 0, baggage: 0, fuelLeft: 40, fuelRight: 40 });
    assert.ok(light.mass < WB_LIMITS.maxUtility);
    const solo = computeLoad(reference);
    assert.ok(solo.mass < WB_LIMITS.maxTakeoff && solo.cg > 35 * IN && solo.cg < 47.3 * IN, `pilote seul, pleins : ${solo.mass.toFixed(0)} kg à ${(solo.cg / IN).toFixed(1)} in`);
});

test('domaine de centrage du 172P (TCDS 3A12 p. 13) : normale 35,0 in à 1 950 lb -> 39,5 in à 2 400 lb, arrière 47,3 ; utilitaire 35,0 -> 36,5 in à 2 100 lb, arrière 40,5', () => {
    const inches = (points) => points.map(([cg, kg]) => [Math.round(cg / IN * 10) / 10, Math.round(kg / LB)]);
    assert.deepEqual(inches(WB_NORMAL), [[35, 1500], [35, 1950], [39.5, 2400], [47.3, 2400], [47.3, 1500]]);
    assert.deepEqual(inches(WB_UTILITY), [[35, 1500], [35, 1950], [36.5, 2100], [40.5, 2100], [40.5, 1500]]);
    assert.equal(checkLoad({ ...reference, plan: { taxi: 0, trip: 0, procedures: 0, alternate: 0, finalReserve: 0, extra: 0, contingency: 0, burn: 30, taxiBurn: 10, tas: 100 } }).problems.length, 0, 'chargement de référence accepté');
});
