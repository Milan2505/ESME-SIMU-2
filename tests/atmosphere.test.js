// Atmosphère type et vitesses air (js/Atmosphere.js) : valeurs de la table OACI (Doc 7488), conversions TAS / CAS / IAS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isa, isaTemperature, mach, tasToCas, casToTas, iasFromCas, casFromIas, RHO0 } from '../js/Atmosphere.js';

const FT = 0.3048, KT = 0.514444;
const near = (value, expected, tolerance, what) => assert.ok(Math.abs(value - expected) <= tolerance * Math.abs(expected),
    `${what} : ${value} au lieu de ${expected} (±${tolerance * 100} %)`);

test('ISA : niveau de la mer, 5 000 ft, 10 000 ft, tropopause (table OACI, ±0,1 %)', () => {
    const sea = isa(0);
    near(sea.temperature, 288.15, 1e-6, 'T0');
    near(sea.pressure, 101325, 1e-6, 'p0');
    near(sea.density, 1.225, 1e-4, 'rho0');
    near(sea.speedOfSound, 340.294, 1e-4, 'a0');
    const five = isa(5000 * FT);
    near(five.temperature, 278.244, 1e-3, 'T 5000 ft');
    near(five.pressure, 84307, 1e-3, 'p 5000 ft');
    near(five.density, 1.0556, 1e-3, 'rho 5000 ft');
    const ten = isa(10000 * FT);
    near(ten.pressure, 69682, 1e-3, 'p 10000 ft');
    near(ten.density, 0.9046, 1e-3, 'rho 10000 ft');
    near(ten.speedOfSound, 328.4, 1e-3, 'a 10000 ft');
    const tropopause = isa(11000);
    near(tropopause.temperature, 216.65, 1e-4, 'T 11 km');
    near(tropopause.pressure, 22632, 1e-3, 'p 11 km');
    near(isa(15000).pressure, 12045, 2e-3, 'p 15 km (stratosphère isotherme)');
    near(isa(1000).density / RHO0, isa(1000).sigma, 1e-12, 'sigma');
});

test('écart de température : +20 K au niveau de la mer baisse la masse volumique de ~6,5 % (altitude-densité), pression inchangée', () => {
    const hot = isa(0, 20), cold = isa(0, -20);
    near(hot.density, 1.225 * 288.15 / 308.15, 1e-6, 'rho à +20 K');
    assert.ok(hot.density < 0.94 * 1.225 && hot.density > 0.93 * 1.225);
    assert.ok(cold.density > 1.225);
    assert.equal(hot.pressure, isa(0).pressure);
    near(isaTemperature(1000), 288.15 - 6.5, 1e-9, 'T ISA à 1 000 m');
});

test('TAS, CAS et Mach : égales au niveau de la mer, CAS = TAS·√σ à basse vitesse, formule compressible en altitude, inverses exactes', () => {
    near(tasToCas(60, 0), 60, 1e-6, 'CAS = TAS au niveau de la mer');
    const h = 5000 * FT, tas = 40;   // 78 kt à 5 000 ft
    near(tasToCas(tas, h), tas * Math.sqrt(isa(h).sigma), 5e-3, 'CAS proche de TAS fois racine de sigma');
    near(casToTas(tasToCas(tas, h), h), tas, 1e-9, 'aller-retour');
    // F-15 : Mach 0,8 à 30 000 ft : ~304 KCAS (tables de pilotage : 300 à 305 kt), 471 KTAS
    const h30 = 30000 * FT, tas30 = 0.8 * isa(h30).speedOfSound;
    near(mach(tas30, h30), 0.8, 1e-9, 'Mach');
    near(tas30 / KT, 471.5, 3e-3, 'TAS à Mach 0,8 et 30 000 ft');
    near(tasToCas(tas30, h30) / KT, 304, 1e-2, 'CAS à Mach 0,8 et 30 000 ft');
    assert.ok(tasToCas(tas30, h30) > tas30 * Math.sqrt(isa(h30).sigma), 'la compressibilité fait lire plus que TAS fois racine de sigma');
    assert.ok(tasToCas(50, 1000, 25) < tasToCas(50, 1000, 0), 'air chaud : moins de pression dynamique, CAS plus faible');
});

test('erreur de position : interpolation de la table du manuel par cran de volets, prolongée aux bouts, inverse exacte', () => {
    const calibration = [
        { flaps: 0, kcas: [56, 62, 70, 79, 89, 98], kias: [50, 60, 70, 80, 90, 100] },
        { flaps: 1, kcas: [47, 53, 61, 70, 80], kias: [40, 50, 60, 70, 80] },
    ];
    near(iasFromCas(56 * KT, calibration, 0) / KT, 50, 1e-9, '56 KCAS -> 50 KIAS volets rentrés');
    near(iasFromCas(59 * KT, calibration, 0) / KT, 55, 1e-9, 'interpolation au milieu d un segment');
    near(iasFromCas(47 * KT, calibration, 1) / KT, 40, 1e-9, 'table volets sortis');
    near(iasFromCas(47 * KT, calibration, 0.8) / KT, 40, 1e-9, 'table la plus proche (0,8 -> volets sortis)');
    near(iasFromCas(107 * KT, calibration, 0) / KT, 110, 1e-9, 'prolongée au-delà du dernier point');
    assert.equal(iasFromCas(0, calibration, 0), 0, 'jamais négative');
    near(casFromIas(iasFromCas(65 * KT, calibration, 0), calibration, 0) / KT, 65, 1e-9, 'inverse');
    assert.equal(iasFromCas(33, null), 33, 'sans table : IAS = CAS');
});
