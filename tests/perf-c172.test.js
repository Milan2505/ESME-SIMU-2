// Performances du Cessna 172P (modèle de vol seul, hors navigateur) contre le manuel de vol : POH Cessna 172P, édition
// 1985 (D1251-13, relue sur un scan complet ; mêmes chiffres de performances que l'édition 1981), Lycoming O-320-D2J de
// 160 ch, 2 400 lb. Conditions des figures : atmosphère type, sans vent, masse maxi
// (CESSNA_172.mass = 1 089 kg = 2 400 lb). Les vitesses du manuel sont des vitesses indiquées (KIAS) sauf mention ;
// le banc d'essai (helpers/c172-perf.js) tient des vitesses indiquées et dit dans quelle vitesse chaque résultat est lu.
// Les tolérances ne se desserrent pas : un test rouge dit que le modèle est faux (voir CLAUDE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeoff, climbRate, maxLevelSpeed, stallSpeed, bestGlide, turn } from './helpers/c172-perf.js';

const G = 9.81, KT = 0.514444;
const within = (value, low, high, what) => assert.ok(value >= low && value <= high, `${what} : ${value.toFixed(1)} hors de [${low} ; ${high}]`);

// --- Décollage court (volets 10°, plein gaz, rotation 51 KIAS, 56 KIAS aux 50 ft) : POH 172P fig. 5-5 p. 5-14,
// 2 400 lb, niveau de la mer, 15 °C (moyenne des colonnes 10 et 20 °C : 860 / 925 ft et 1 570 / 1 685 ft) : roulement
// ~890 ft (271 m), passage des 50 ft ~1 625 ft (495 m) ; mêmes chiffres p. ii (« performance - specifications »). Tolérance ±20 % -------------------------
test('décollage : roulement 271 m ± 20 % (POH 172P fig. 5-5 p. 5-14, 2 400 lb, rotation 51 KIAS)', () => {
    const t = takeoff();
    assert.ok(t.reached, 'les 50 ft doivent être passés sans crash');
    within(t.groundRoll, 217, 325, 'roulement (m)');
});
test('décollage : passage des 50 ft à 495 m ± 20 % (POH 172P fig. 5-5 p. 5-14, 56 KIAS aux 50 ft)', () => {
    within(takeoff().toFifty, 396, 594, 'distance aux 50 ft (m)');
});

// --- Montée plein gaz, volets rentrés : POH 172P fig. 5-6 p. 5-16 « Maximum rate of climb », 2 400 lb : Vy 76 KIAS
// au niveau de la mer (74 à 4 000 ft) ; 745 ft/min à 0 °C et 685 à 20 °C, soit ~700 à 15 °C ; à 5 000 ft en atmosphère
// type (5 °C) : ~470 ft/min (535/480 à 4 000 ft, 430/375 à 6 000 ft, à 0 et 20 °C), mixture appauvrie au-dessus de 3 000 ft
test('montée à Vy (76 KIAS) au niveau de la mer : 700 ft/min, tolérance 650 à 800 (POH 172P fig. 5-6 p. 5-16)', () => {
    const c = climbRate({ altitude: 0, speedKt: 76 });
    assert.ok(!c.crashed);
    within(c.speedKt, 73, 79, 'vitesse tenue (KIAS)');
    within(c.fpm, 650, 800, 'taux de montée (ft/min)');
});
test('montée à Vy (74 KIAS) à 5 000 ft : ~470 ft/min, tolérance 400 à 600, et au moins 20 % sous celle du niveau de la mer (POH 172P fig. 5-6 p. 5-16)', () => {
    const sea = climbRate({ altitude: 0, speedKt: 76 }), high = climbRate({ altitude: 5000 * 0.3048, speedKt: 74 });
    assert.ok(!high.crashed);
    within(high.fpm, 400, 600, 'taux de montée à 5 000 ft (ft/min)');
    assert.ok(high.fpm <= 0.8 * sea.fpm, `l'altitude doit réduire la montée : ${high.fpm.toFixed(0)} contre ${sea.fpm.toFixed(0)} ft/min`);
});

// --- Vitesse maxi en palier, plein gaz, niveau de la mer : POH 172P p. ii « Speed, maximum at sea level : 123 knots »
// (vitesse vraie, avec les carénages de roues optionnels : ~2 kt de moins sans). Tolérance 118 à 130 kt ; régime à la ligne rouge (2 700 tr/min, sect. 2 p. 2-6) --------------------------
test('vitesse maxi en palier : 123 KTAS, tolérance 118 à 130 (POH 172P p. ii)', () => {
    const v = maxLevelSpeed({ altitude: 300 });
    assert.ok(!v.crashed);
    assert.ok(Math.abs(v.altitudeError) < 15, `altitude tenue à ${v.altitudeError.toFixed(1)} m`);
    within(v.kt, 118, 130, 'vitesse maxi (KTAS)');
});

// --- Décrochage moteur réduit, ailes à plat, 2 400 lb, centrage arrière : POH 172P fig. 5-3 p. 5-12 : lisse 51 KCAS
// (44 KIAS), volets 30° 46 KCAS (33 KIAS) ; mêmes KCAS p. ii. Lu en KCAS (tolérance 50 à 55 et 44 à 50) ; le badin, qui
// sous-lit fortement à forte incidence, est vérifié aussi : ±3 kt autour des KIAS « approximatifs » du manuel --------------------------------------------------------------
test('décrochage lisse : 51 KCAS (tolérance 50 à 55), 44 KIAS au badin (41 à 47) (POH 172P fig. 5-3 p. 5-12)', () => {
    const s = stallSpeed({ flapLevel: 0 });
    assert.ok(s.stalled, 'l\'avion doit finir par décrocher moteur réduit');
    within(s.kt, 50, 55, 'vitesse de décrochage lisse (KCAS)');
    within(s.iasKt, 41, 47, 'vitesse de décrochage lisse au badin (KIAS)');
});
test('décrochage volets 30° : 46 KCAS (tolérance 44 à 50), 33 KIAS au badin (30 à 36) (POH 172P fig. 5-3 p. 5-12)', () => {
    const s = stallSpeed({ flapLevel: 3 });
    assert.ok(s.stalled);
    within(s.kt, 44, 50, 'vitesse de décrochage volets 30° (KCAS)');
    within(s.iasKt, 30, 36, 'vitesse de décrochage volets 30° au badin (KIAS)');
});

// --- Plané moteur coupé, hélice en moulinet, volets rentrés : POH 172P fig. 3-1 p. 3-11 « Maximum glide » : 65 KIAS,
// hélice en moulinet, volets rentrés, sans vent : ~18 NM depuis 12 000 ft, soit une finesse ~9,1. Tolérance finesse 8,5 à 10,5, meilleure vitesse entre 62 et 72 KIAS ------
test('meilleur plané : finesse 9,1 à 65 KIAS, tolérance 8,5 à 10,5 entre 62 et 72 KIAS (POH 172P fig. 3-1 p. 3-11)', () => {
    const best = bestGlide();
    within(best.ratio, 8.5, 10.5, 'finesse maxi');
    within(best.kt, 62, 72, 'vitesse de meilleur plané (KIAS)');
});

// --- Virages stabilisés à 100 kt : mécanique du vol (pas le manuel) : taux ω = g·tan(φ)/V, rayon R = V²/(g·tan(φ)),
// soit à 100 kt (51,4 m/s) : 30° -> 6,3 °/s et 466 m ; 45° -> 10,9 °/s et 269 m. Tolérance ±10 % sur la vitesse mesurée
for (const bank of [30, 45]) {
    test(`virage à ${bank}° : taux et rayon de la mécanique du vol ± 10 % (g·tan φ / V)`, () => {
        const t = turn(bank);
        assert.ok(!t.crashed);
        within(t.bankDeg, bank - 2, bank + 2, 'inclinaison tenue (°)');
        const v = t.speedKt * KT;
        const rate = G * Math.tan(bank * Math.PI / 180) / v * 180 / Math.PI, radius = v * v / (G * Math.tan(bank * Math.PI / 180));
        within(t.rateDegPerS, rate * 0.9, rate * 1.1, `taux de virage (°/s, attendu ${rate.toFixed(1)})`);
        within(t.radius, radius * 0.9, radius * 1.1, `rayon (m, attendu ${radius.toFixed(0)})`);
    });
}
