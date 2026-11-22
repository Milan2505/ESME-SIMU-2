// Enregistrement des vols (lot 5, js/FlightRecorder.js, js/FlightStore.js) : 10 échantillons par seconde de temps de jeu,
// événements, interpolation pour le rejeu, export puis import CSV à l'identique, carnet des 20 derniers vols
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightRecorder, FIELDS, sampleAt, toCsv, fromCsv, RATE } from '../js/FlightRecorder.js';
import { FlightStore, MAX_FLIGHTS } from '../js/FlightStore.js';

function fakeFlight(seconds = 20, step = 1 / 60) {
    const r = new FlightRecorder();
    r.start({ aircraft: 'c172', airport: 'ESME', lesson: '' });
    for (let t = 0; t <= seconds + 1e-9; t += step) {
        const s = Object.fromEntries(FIELDS.map((k) => [k, 0]));
        Object.assign(s, { x: t * 50, y: 100 + t, z: -t * 10, qx: 0, qy: Math.sin(t / 20), qz: 0, qw: Math.cos(t / 20), ias: 90, hdg: (350 + t) % 360, phase: t < 5 ? 'roulage' : 'vol', ground: t < 5 ? 1 : 0, loc: null });
        r.record(t, s);
        if (Math.abs(t - 5) < step / 2) r.event(t, 'liftoff', 'Envol');
    }
    r.event(seconds, 'atc', 'F-GESM, bonjour, "test", à vous');
    return r.stop();
}

test('10 échantillons par seconde de temps de jeu, quel que soit le pas', () => {
    for (const step of [1 / 120, 1 / 60, 1 / 13, 0.1]) {
        const f = fakeFlight(20, step);
        const rate = (f.samples.length - 1) / f.meta.duration;
        assert.ok(Math.abs(rate - RATE) < 0.6, `pas ${step.toFixed(3)} : ${rate.toFixed(2)} échantillons/s`);
    }
});

test('vol trop court : pas de débriefing ; arrêt sans départ : rien', () => {
    const r = new FlightRecorder();
    assert.equal(r.stop(), null);
    r.start();
    r.record(0, { x: 0 });
    r.record(1, { x: 1 });
    assert.equal(r.stop(), null);
});

test('rejeu : interpolation entre deux échantillons (position, cap par le plus court, quaternion normé, champs discrets)', () => {
    const f = fakeFlight();
    const a = sampleAt(f, 9.95);
    assert.ok(Math.abs(a.x - 9.95 * 50) < 1e-6);
    assert.equal(a.phase, 'vol');
    assert.ok(Math.abs(Math.hypot(a.qx, a.qy, a.qz, a.qw) - 1) < 1e-9);
    const wrap = sampleAt({ samples: [{ ...f.samples[0], t: 0, hdg: 355 }, { ...f.samples[1], t: 1, hdg: 5 }] }, 0.5);
    assert.ok(Math.abs(wrap.hdg) < 1e-9 || Math.abs(wrap.hdg - 360) < 1e-9, `cap ${wrap.hdg}`);
    assert.equal(sampleAt(f, -5).t, 0);
    assert.equal(sampleAt(f, 1e6).t, f.samples[f.samples.length - 1].t);
});

test('CSV : export puis import à l\'identique (métadonnées, événements avec guillemets et virgules, valeurs vides)', () => {
    const f = fakeFlight();
    const back = fromCsv(toCsv(f));
    assert.equal(back.meta.aircraft, 'c172');
    assert.equal(back.samples.length, f.samples.length);
    assert.deepEqual(back.events.map((e) => [e.kind, e.text]), f.events.map((e) => [e.kind, e.text]));
    for (const key of ['x', 'y', 'ias', 'hdg', 'phase', 'loc']) {
        assert.equal(back.samples[37][key] === null ? null : back.samples[37][key], f.samples[37][key] === null ? null : (typeof f.samples[37][key] === 'number' ? Math.round(f.samples[37][key] * 1e4) / 1e4 : f.samples[37][key]), key);
    }
    assert.throws(() => fromCsv('a,b,c\n1,2,3'), /pas un vol/);
    assert.throws(() => fromCsv('# esme-vol,1\nt,x\n'), /vide ou illisible/);
});

test('carnet : les 20 derniers vols, du plus récent au plus ancien, résumés', async () => {
    const store = new FlightStore(null);
    const f = fakeFlight(10);
    const ids = [];
    for (let i = 0; i < MAX_FLIGHTS + 5; i++) ids.push(await store.save({ ...f, meta: { ...f.meta, started: `vol ${i}` } }));
    const list = await store.list();
    assert.equal(list.length, MAX_FLIGHTS);
    assert.equal(list[0].started, `vol ${MAX_FLIGHTS + 4}`);
    assert.equal(await store.load(ids[0]), null);
    assert.equal((await store.load(ids.at(-1))).samples.length, f.samples.length);
    assert.equal(list[0].aircraft, 'c172');
    assert.ok(list[0].duration >= 9.9);
});
