// Météo du jeu (lot 3, décisions du 21/11/2026) : QNH tiré avec la graine du vent entre 995 et 1030 hPa (Wind.js), annoncé
// par l'ATC (ATC.qnh), METAR réel repris tel quel (vent, rafales, QNH) ; décollages plus longs par temps chaud
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wind, QNH_RANGE } from '../js/Wind.js';
import { ATC, METARS } from '../js/ATC.js';
import { parseMetar, metarToWeather } from '../js/Metar.js';
import { takeoff } from './helpers/c172-perf.js';

test('QNH : même graine, même QNH ; entre 995 et 1030 hPa, dans la plage de chaque météo', () => {
    const wind = new Wind();
    for (const [name, metar] of Object.entries(METARS)) {
        const seen = new Set();
        for (let seed = 1; seed <= 300; seed++) {
            wind.setSeed(seed);
            wind.set(metar);
            const q = wind.qnh;
            assert.ok(Number.isInteger(q) && q >= QNH_RANGE[0] && q <= QNH_RANGE[1], `${name}, graine ${seed} : ${q}`);
            assert.ok(q >= metar.qnhRange[0] && q <= metar.qnhRange[1], `${name} : ${q} hors de ${metar.qnhRange}`);
            seen.add(q);
        }
        assert.ok(seen.size > 5, `${name} : le QNH varie d'une partie à l'autre`);
    }
    const a = new Wind(), b = new Wind();
    a.setSeed(42); a.set(METARS.jour);
    b.setSeed(42); b.set(METARS.jour);
    assert.equal(a.qnh, b.qnh);
});

test('le QNH ne change pas le vent d\'une graine (4e tirage, après ceux du vent)', () => {
    const wind = new Wind();
    wind.now = () => 1000;
    wind.setSeed(7);
    wind.set(METARS.nuageux);
    // (valeurs de Wind.js avant le lot 3, version 0.440, même graine et même horloge)
    assert.deepEqual([wind.knots, wind.gust, Math.round(wind.base), Number(wind.direction.toFixed(3)), Number(wind.speed.toFixed(3))], [6, 11, 64, 57.327, 6.042]);
});

test('METAR réel : vent, rafales et QNH tels quels (sans le tirage de la partie)', () => {
    const parsed = parseMetar('LFML 211100Z 31018G29KT 9999 FEW030 16/04 Q1007');
    const { metar } = metarToWeather(parsed, { label: 'Jour', clouds: { coverage: 0.4 }, fogNear: 400, fogFar: 2400, turbulence: 0 });
    const wind = new Wind();
    wind.setSeed(3);
    wind.set(metar);
    assert.equal(wind.qnh, 1007);
    assert.equal(wind.knots, 18);
    assert.equal(wind.gust, 29);
});

test('ATC : QNH annoncé = celui de la partie', () => {
    const qnh = Object.getOwnPropertyDescriptor(ATC.prototype, 'qnh').get;
    assert.equal(qnh.call({ wind: { qnh: 1021 } }), 1021);
    assert.equal(qnh.call({ wind: {} }), 1013);
});

// POH 172P sect. 5 (tableaux de décollage) : la distance croît avec la température, ~0,75 % par °C (pente reprise dans
// WeightBalance.js) ; ici 35 °C au niveau de la mer (ISA + 20) contre 15 °C
for (const model of ['simplifie', 'realiste']) {
    test(`${model} : décollage plus long par temps chaud (35 °C contre 15 °C)`, () => {
        const cool = takeoff({ model }), hot = takeoff({ model, deltaT: 20 });
        assert.ok(hot.reached && cool.reached);
        const roll = hot.groundRoll / cool.groundRoll, fifty = hot.toFifty / cool.toFifty;
        assert.ok(roll > 1.1 && roll < 1.3, `roulement ×${roll.toFixed(3)}`);
        assert.ok(fifty > 1.1 && fifty < 1.35, `aux 50 ft ×${fifty.toFixed(3)}`);
    });
}

// Turbulence de Dryden branchée dans le modèle de vol (Turbulence.js) : rafales en vol, rien au sol, et jamais de tirage
// dans model.random (l'aile qui tombe au décrochage garde sa suite de tirages, réglée sur les vrilles)
test('turbulence : rafales en vol, calme au sol, tirage à part', async () => {
    const { makeAircraft, airborne, run } = await import('./helpers/flight.js');
    for (const kind of ['simplifie', 'realiste']) {
        const f = makeAircraft({ model: kind });
        let draws = 0;
        const random = f.model.random;
        f.model.random = () => { draws++; return random(); };
        f.model.turbulence = 1;
        run(f, 2);
        assert.equal(f.model._wind.length(), 0, `${kind} : calme au sol`);
        airborne(f, { altitude: 300, speed: 50 });
        let peak = 0;
        run(f, 20, { pilot: () => { peak = Math.max(peak, f.model._wind.length()); } });
        assert.ok(peak > 1, `${kind} : rafales en vol (${peak.toFixed(2)} m/s)`);
        assert.equal(draws, 0, `${kind} : aucun tirage dans model.random`);
    }
});
