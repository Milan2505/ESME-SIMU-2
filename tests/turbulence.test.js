// Turbulence de Dryden, cisaillement et thermiques (js/Turbulence.js) : écarts types contre MIL-F-8785C §3.7.2,
// reproductibilité par la graine, indépendance au pas de temps
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Turbulence, shearFactor, thermalAt, drydenScales } from '../js/Turbulence.js';

const FT = 0.3048;
const KT_FTS = 1.6878099;

// Écarts types mesurés (m/s) sur une série de `duration` s au pas dt
function measure({ seed = 1, dt = 1 / 60, duration = 3000, height, airspeed = 50, severity = 2 / 3 }) {
    const turb = new Turbulence(seed);
    const sum = { u: 0, v: 0, w: 0 }, sq = { u: 0, v: 0, w: 0 };
    const n = Math.round(duration / dt);
    for (let i = 0; i < n; i++) {
        turb.step(dt, { height, airspeed, severity, span: 11 });
        for (const k of ['u', 'v', 'w']) { sum[k] += turb[k]; sq[k] += turb[k] ** 2; }
    }
    const sigma = {};
    for (const k of ['u', 'v', 'w']) sigma[k] = Math.sqrt(sq[k] / n - (sum[k] / n) ** 2);
    return sigma;
}

// σ théoriques (m/s) de la norme
function theory(height, severity) {
    const s = drydenScales(height / FT, 45 * severity * KT_FTS);
    return { u: s.sigmaU * FT, v: s.sigmaV * FT, w: s.sigmaW * FT };
}

function near(measured, expected, label) {
    for (const k of ['u', 'v', 'w']) {
        const r = measured[k] / expected[k];
        assert.ok(Math.abs(r - 1) <= 0.15, `${label} : σ${k} ${measured[k].toFixed(3)} m/s pour ${expected[k].toFixed(3)} (rapport ${r.toFixed(3)})`);
    }
}

test('échelles et σ de la norme : basse altitude, 1 000 ft, au-dessus de 2 000 ft', () => {
    const w20 = 30 * KT_FTS;
    const low = drydenScales(100, w20);
    assert.equal(low.Lw, 100);
    assert.ok(Math.abs(low.Lu - 100 / (0.177 + 0.0823) ** 1.2) < 1e-9);
    assert.ok(Math.abs(low.sigmaW - 0.1 * w20) < 1e-12);
    assert.ok(low.sigmaU > low.sigmaW, 'σu > σw près du sol');
    const mid = drydenScales(1000, w20);
    assert.ok(Math.abs(mid.Lu - 1000) < 1e-9 && Math.abs(mid.sigmaU - mid.sigmaW) < 1e-12);
    const high = drydenScales(3000, w20);
    assert.equal(high.Lu, 1750);
    assert.equal(high.Lw, 1750);
    assert.ok(Math.abs(high.sigmaU - 0.1 * w20) < 1e-12);
    assert.equal(drydenScales(2, w20).Lw, 10, 'hauteur plancher 10 ft');
});

test('σ de u, v, w mesurés à 100 ft et 3 000 ft à ±15 % des σ théoriques', () => {
    near(measure({ height: 30.48 }), theory(30.48, 2 / 3), '100 ft');
    near(measure({ height: 914.4, airspeed: 55 }), theory(914.4, 2 / 3), '3 000 ft');
});

test('indépendance au pas : dt 1/120 s et 0,1 s donnent les mêmes σ à ±15 %', () => {
    for (const height of [30.48, 914.4]) {
        const fine = measure({ height, dt: 1 / 120, seed: 3 });
        const coarse = measure({ height, dt: 0.1, seed: 4 });
        near(coarse, fine, `${height} m, 0,1 s contre 1/120 s`);
        near(coarse, theory(height, 2 / 3), `${height} m, dt 0,1 s`);
    }
});

test('même graine, même suite ; graines différentes, suites différentes ; setSeed repart du début', () => {
    const run = (turb) => {
        const out = [];
        for (let i = 0; i < 200; i++) {
            turb.step(1 / 60, { height: 50, airspeed: 45, severity: 0.5, span: 11 });
            out.push(turb.u, turb.v, turb.w, turb.p);
        }
        return out;
    };
    const a = run(new Turbulence(42));
    assert.deepEqual(run(new Turbulence(42)), a);
    assert.notDeepEqual(run(new Turbulence(43)), a);
    const t = new Turbulence(7);
    run(t);
    t.setSeed(42);
    assert.deepEqual(run(t), a);
    assert.ok(a.every(Number.isFinite));
    assert.ok(a.some((x, i) => i % 4 === 3 && x !== 0), 'roulis p non nul');
});

test('sévérité nulle : tout à zéro, état remis à zéro, aucun tirage', () => {
    const t = new Turbulence(9);
    for (let i = 0; i < 50; i++) t.step(1 / 60, { height: 100, airspeed: 50, severity: 0.4 });
    assert.ok(t.u !== 0 && t.w !== 0);
    t.step(1 / 60, { height: 100, airspeed: 50, severity: 0 });
    assert.deepEqual([t.u, t.v, t.w, t.p], [0, 0, 0, 0]);
    // Aucun tirage : après des pas à sévérité nulle, la suite reprend comme une turbulence neuve de même graine
    const a = new Turbulence(5), b = new Turbulence(5);
    for (let i = 0; i < 100; i++) a.step(1 / 60, { height: 100, airspeed: 50, severity: 0 });
    for (let i = 0; i < 10; i++) {
        a.step(1 / 60, { height: 100, airspeed: 50, severity: 0.5 });
        b.step(1 / 60, { height: 100, airspeed: 50, severity: 0.5 });
        assert.deepEqual([a.u, a.v, a.w, a.p], [b.u, b.v, b.w, b.p]);
    }
});

test('cisaillement : 1 jusqu\'à 10 m (anémomètre du METAR), croissant, plafonné', () => {
    assert.equal(shearFactor(0), 1);
    assert.equal(shearFactor(5), 1);
    assert.equal(shearFactor(10), 1);
    assert.equal(shearFactor(-3), 1);
    let prev = 1;
    for (const h of [20, 50, 100, 300]) {
        const f = shearFactor(h);
        assert.ok(f > prev, `croissant à ${h} m`);
        prev = f;
    }
    assert.ok(Math.abs(shearFactor(100) - 10 ** (1 / 7)) < 1e-12);
    assert.equal(shearFactor(1e5), 1.5);
    assert.equal(shearFactor(1e5, { cap: 2 }), 2);
});

test('thermiques : nulles au sol et au sommet, nulles sans force, bornées, présentes dans 5 km', () => {
    let max = 0, min = 0;
    for (let x = -2500; x <= 2500; x += 50) {
        for (let z = -2500; z <= 2500; z += 50) {
            assert.equal(thermalAt(x, z, 0, 100), 0);
            assert.equal(thermalAt(x, z, 1200, 100), 0);
            assert.equal(thermalAt(x, z, 480, 100, { strength: 0 }), 0);
            const w = thermalAt(x, z, 480, 100);
            assert.ok(Number.isFinite(w));
            max = Math.max(max, w); min = Math.min(min, w);
        }
    }
    assert.ok(max > 0.5, `ascendance maximale ${max.toFixed(2)} m/s`);
    assert.ok(max <= 5 && min >= -2, `bornes ${min.toFixed(2)} à ${max.toFixed(2)} m/s`);
    assert.ok(min < 0, 'descendance autour des thermiques');
    // Même graine, même champ ; continu dans le temps (fondu)
    assert.equal(thermalAt(123, 456, 400, 60, { seed: 3 }), thermalAt(123, 456, 400, 60, { seed: 3 }));
    let jump = 0;
    for (let t = 0; t < 900; t += 0.5) jump = Math.max(jump, Math.abs(thermalAt(0, 0, 480, t + 0.5) - thermalAt(0, 0, 480, t)));
    assert.ok(jump < 0.1, `variation en 0,5 s ${jump.toFixed(3)} m/s`);
});
