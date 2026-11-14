// Performances du Cessna 172 (modèle de vol seul, hors navigateur) contre le manuel de vol (POH).
// Sources : POH Cessna 172P (1981, 160 ch, 2 400 lb) et POH Cessna 172S (2007, 180 ch, 2 550 lb), section 5
// « Performance ». Le jeu mélange les deux variantes (docs/feuille-de-route.md, constat 6) : chaque tolérance couvre
// les deux manuels. Conditions : atmosphère type, sans vent, masse du jeu (CESSNA_172.mass = 1 100 kg ≈ 2 425 lb).
// Les tests marqués { todo } échouent aujourd'hui et doivent passer au vert au lot 1 (modèle de vol) : ne pas assouplir
// les tolérances, retirer les todo quand le modèle est refait (voir CLAUDE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeoff, climbRate, maxLevelSpeed, stallSpeed, bestGlide, turn } from './helpers/c172-perf.js';

const TODO_LOT1 = 'lot 1 : modèle de vol';
const G = 9.81, KT = 0.514444;
const within = (value, low, high, what) => assert.ok(value >= low && value <= high, `${what} : ${value.toFixed(1)} hors de [${low} ; ${high}]`);

// --- Décollage court (volets 10°, plein gaz) : POH 172P sect. 5 fig. 5-4 ; POH 172S sect. 5 fig. 5-4 ---------------------
// 172P, 2 400 lb, niveau de la mer, 15 °C : roulement ~890 ft (271 m), passage des 50 ft ~1 625 ft (495 m)
// 172S, 2 550 lb : 960 ft (293 m) et 1 630 ft (497 m). Tolérance ±20 % autour du 172P (masse du jeu ≈ 2 425 lb)
// (aujourd'hui ~180 m : l'avion accélère trop fort au roulage, poussée statique trop forte)
test('décollage : roulement 271 m ± 20 % (POH 172P fig. 5-4, rotation 51 kt)', { todo: TODO_LOT1 }, () => {
    const t = takeoff();
    assert.ok(t.reached, 'les 50 ft doivent être passés sans crash');
    within(t.groundRoll, 217, 325, 'roulement (m)');
});
// (aujourd'hui ~340 m, même cause)
test('décollage : passage des 50 ft à 495 m ± 20 % (POH 172P fig. 5-4, 56 kt aux 50 ft)', { todo: TODO_LOT1 }, () => {
    within(takeoff().toFifty, 396, 594, 'distance aux 50 ft (m)');
});

// --- Montée à Vy, plein gaz : POH 172P fig. 5-6 (Vy 76 kt, 700 ft/min au niveau de la mer à 15 °C) ; POH 172S fig. 5-5
// (Vy 74 kt, 730 ft/min). À 5 000 ft, atmosphère type : ~470 ft/min (172P) à ~520 ft/min (172S) -------------------------
// (aujourd'hui ~1 360 ft/min : près du double du manuel)
test('montée à Vy (75 kt) au niveau de la mer : 700 à 730 ft/min, tolérance 650 à 800 (POH 172P fig. 5-6, 172S fig. 5-5)', { todo: TODO_LOT1 }, () => {
    const c = climbRate({ altitude: 0, speedKt: 75 });
    assert.ok(!c.crashed);
    within(c.speedKt, 72, 78, 'vitesse tenue (kt)');
    within(c.fpm, 650, 800, 'taux de montée (ft/min)');
});
// (aujourd'hui ~1 350 ft/min, comme au niveau de la mer : Cessna172.js n'a pas densityAltitude, l'altitude n'a aucun effet)
test('montée à Vy à 5 000 ft : 470 à 520 ft/min, tolérance 400 à 600, et au moins 20 % sous celle du niveau de la mer (mêmes figures)', { todo: TODO_LOT1 }, () => {
    const sea = climbRate({ altitude: 0, speedKt: 75 }), high = climbRate({ altitude: 5000 * 0.3048, speedKt: 75 });
    assert.ok(!high.crashed);
    within(high.fpm, 400, 600, 'taux de montée à 5 000 ft (ft/min)');
    assert.ok(high.fpm <= 0.8 * sea.fpm, `l'altitude doit réduire la montée : ${high.fpm.toFixed(0)} contre ${sea.fpm.toFixed(0)} ft/min`);
});

// --- Vitesse maxi en palier, plein gaz, niveau de la mer : POH 172P sect. 1 « Maximum at sea level : 123 knots » ;
// POH 172S sect. 1 : 126 knots. Tolérance 118 à 130 kt ----------------------------------------------------------------------
// (aujourd'hui ~132 kt : un peu trop rapide)
test('vitesse maxi en palier : 123 à 126 kt, tolérance 118 à 130 (POH 172P et 172S, section 1)', { todo: TODO_LOT1 }, () => {
    const v = maxLevelSpeed({ altitude: 300 });
    assert.ok(!v.crashed);
    assert.ok(Math.abs(v.altitudeError) < 15, `altitude tenue à ${v.altitudeError.toFixed(1)} m`);
    within(v.kt, 118, 130, 'vitesse maxi (kt)');
});

// --- Décrochage moteur réduit, ailes à plat : POH 172P sect. 5 fig. 5-3 (lisse 51 KCAS, volets 30° 46 KCAS, 2 400 lb) ;
// POH 172S fig. 5-3 (lisse 53 KCAS, volets 30° 48 KCAS, 2 550 lb). L'anémomètre du jeu lit une vitesse corrigée (KCAS)
test('décrochage lisse : 51 à 53 kt, tolérance 50 à 55 (POH 172P et 172S fig. 5-3)', () => {
    const s = stallSpeed({ flapLevel: 0 });
    assert.ok(s.stalled, 'l\'avion doit finir par décrocher moteur réduit');
    within(s.kt, 50, 55, 'vitesse de décrochage lisse (kt)');
});
test('décrochage volets 30° : 46 à 48 kt, tolérance 44 à 50 (POH 172P et 172S fig. 5-3)', () => {
    const s = stallSpeed({ flapLevel: 3 });
    assert.ok(s.stalled);
    within(s.kt, 44, 50, 'vitesse de décrochage volets 30° (kt)');
});

// --- Plané moteur réduit, hélice en moulinet : POH 172P sect. 3 fig. 3-1 « Maximum glide » (65 KIAS, ~1,5 NM par
// 1 000 ft, soit une finesse ~9,1) ; POH 172S fig. 3-1 (68 KIAS, même pente). Tolérance finesse 8,5 à 10,5, à 62 à 72 kt
test('meilleur plané : finesse 9,1 à 65 à 68 kt, tolérance 8,5 à 10,5 entre 62 et 72 kt (POH sect. 3 fig. 3-1)', () => {
    const best = bestGlide();
    within(best.ratio, 8.5, 10.5, 'finesse maxi');
    within(best.kt, 62, 72, 'vitesse de meilleur plané (kt)');
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
