// Altimètre et calage (js/Atmosphere.js) : pression statique selon le QNH, lecture selon le calage, altitude-pression,
// altitude-densité. Règles pratiques du pilote : 30 ft par hPa d'erreur de calage (27,3 ft/hPa exactement au niveau de
// la mer, formule de l'atmosphère type), 120 ft d'altitude-densité par °C d'écart à l'ISA
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isa, staticPressure, pressureToAltitude, altimeterReading, pressureAltitude, densityAltitude, P_STD } from '../js/Atmosphere.js';

const FT = 0.3048;

test('pression statique : vaut le QNH au niveau de la mer, celle de l atmosphère type à 1013,25 hPa', () => {
    for (const qnh of [995, 1013.25, 1030]) assert.ok(Math.abs(staticPressure(0, qnh) - qnh * 100) < 1e-9, `QNH ${qnh}`);
    for (const h of [0, 1000, 3000, 8000]) {
        assert.ok(Math.abs(staticPressure(h) - isa(h).pressure) < 1e-6 * isa(h).pressure, `ISA à ${h} m`);
    }
    assert.equal(P_STD, 1013.25);
    assert.ok(staticPressure(1000, 1013.25, 20) > staticPressure(1000, 1013.25, 0), 'air chaud : pression plus forte en altitude');
});

test('altimètre calé au QNH : lit l altitude vraie à ±20 ft de 0 à 10 000 ft, QNH 995 à 1030 hPa, air standard', () => {
    for (let ft = 0; ft <= 10000; ft += 1000) {
        for (const qnh of [995, 1003, 1013.25, 1020, 1030]) {
            const reading = altimeterReading(ft * FT, qnh, qnh) / FT;
            assert.ok(Math.abs(reading - ft) <= 20, `${ft} ft, QNH ${qnh} : lit ${reading.toFixed(1)} ft`);
        }
    }
    assert.ok(Math.abs(pressureToAltitude(isa(3000).pressure) - 3000) < 1e-6, 'formule standard inverse de l ISA');
});

test('erreur de calage : ~30 ft par hPa (règle pratique ; 27,3 ft/hPa exactement au niveau de la mer), calage trop fort -> lit trop haut', () => {
    // au sol, la pente vaut 27,3 ft/hPa × 1013,25 / QNH environ : 27,8 à 995 hPa, 26,8 à 1030 hPa (hors de la règle)
    for (const qnh of [995, 1003, 1013.25]) {
        const delta = 5;
        const slope = (altimeterReading(0, qnh, qnh + delta) - altimeterReading(0, qnh, qnh)) / FT / delta;
        assert.ok(slope >= 27 && slope <= 30, `QNH ${qnh} : ${slope.toFixed(2)} ft/hPa au sol`);
    }
    const h = 3000 * FT;
    assert.ok(altimeterReading(h, 1005, 1015) > altimeterReading(h, 1005, 1005), 'calage trop fort : lit trop haut');
    assert.ok(altimeterReading(h, 1005, 995) < altimeterReading(h, 1005, 1005), 'calage trop faible : lit trop bas');
});

test('altitude-pression : 0 au niveau de la mer par QNH 1013,25 hPa, ~+273 ft par QNH 1003,25 hPa', () => {
    assert.ok(Math.abs(pressureAltitude(0, 1013.25)) < 1e-9);
    const pa = pressureAltitude(0, 1003.25) / FT;
    assert.ok(Math.abs(pa - 273) <= 10, `altitude-pression ${pa.toFixed(1)} ft`);
    assert.ok(pressureAltitude(0, 1025) < 0, 'haute pression : altitude-pression négative');
});

test('altitude-densité : 0 en atmosphère type, ~2 300 ft à 35 °C au niveau de la mer (règle de 120 ft/°C, ±15 %)', () => {
    assert.ok(Math.abs(densityAltitude(0, P_STD, 0)) < 1e-6);
    const da = densityAltitude(0, P_STD, 20) / FT;
    assert.ok(Math.abs(da - 2300) <= 0.15 * 2300, `altitude-densité ${da.toFixed(0)} ft à +20 °C`);
    const sigma = isa(da * FT).sigma;
    assert.ok(Math.abs(sigma - isa(0, 20).sigma) < 1e-9, 'même masse volumique que l air chaud au sol');
    assert.ok(densityAltitude(1000, P_STD, -15) < 1000, 'air froid : altitude-densité sous l altitude vraie');
});
