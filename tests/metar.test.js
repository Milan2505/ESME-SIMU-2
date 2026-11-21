// Météo réelle (js/Metar.js) : lecture des METAR, passage au format du simulateur, choix de la station
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetar, metarToWeather, pickMetar, METAR_STATIONS, METAR_URL } from '../js/Metar.js';

// Préréglages de simulator.js (WEATHERS.jour et WEATHERS.nuageux, recopiés)
const JOUR = { label: 'Jour', sky: 0x5dade2, fogNear: 400, fogFar: 2400, hemi: 1.2, sun: 2.0, turbulence: 0,
    night: 0, wind: 0.35, atmosphere: { elevation: 40, azimuth: 150, turbidity: 1.8, rayleigh: 1, fog: 0x86acd8 },
    clouds: { coverage: 0.45, light: 0xffffff, dark: 0x8f9bb0 } };
const NUAGEUX = { label: 'Nuageux', sky: 0x9ba5ae, fogNear: 220, fogFar: 1500, hemi: 1.15, sun: 0.7, turbulence: 0.35,
    night: 0, wind: 0.55, clouds: { coverage: 1, light: 0xdfe3e7, dark: 0x5f6873, opacity: 1, brightness: 1.4 },
    overcast: { base: 320, top: 390, coverage: 0.86, scale: 900 } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('CAVOK : station, heure, vent variable faible, visibilité 10 km, pas de nuages, température, QNH', () => {
    const m = parseMetar('LFML 211100Z AUTO VRB02KT CAVOK 14/07 Q1020 NOSIG');
    assert.equal(m.station, 'LFML');
    assert.deepEqual(m.time, { day: 21, hour: 11, minute: 0 });
    assert.deepEqual(m.wind, { dir: null, knots: 2, gust: null, variable: null });
    assert.equal(m.visibility, 10000);
    assert.equal(m.cavok, true);
    assert.deepEqual(m.layers, []);
    assert.deepEqual(m.weather, []);
    assert.equal(m.temp, 14);
    assert.equal(m.dew, 7);
    assert.equal(m.qnh, 1020);
});

test('préfixe METAR / SPECI, COR, rafales et secteur de variation', () => {
    const m = parseMetar('METAR COR LFML 211130Z 27015G28KT 240V300 9999 FEW040 SCT100 16/04 Q1008=');
    assert.equal(m.station, 'LFML', 'COR avant la station');
    assert.equal(m.raw, 'METAR COR LFML 211130Z 27015G28KT 240V300 9999 FEW040 SCT100 16/04 Q1008=');
    const s = parseMetar('SPECI LFML 211130Z COR 27015G28KT 240V300 9999 FEW040 SCT100 16/04 Q1008=');
    assert.equal(s.station, 'LFML');
    assert.deepEqual(s.wind, { dir: 270, knots: 15, gust: 28, variable: [240, 300] });
    assert.equal(s.visibility, 10000);
    assert.deepEqual(s.layers, [{ cover: 'FEW', feet: 4000, cb: false }, { cover: 'SCT', feet: 10000, cb: false }]);
    assert.equal(s.qnh, 1008);
});

test('brume 2000 m, plafond bas BKN008 OVC015, températures négatives', () => {
    const m = parseMetar('LFML 210600Z 34004KT 2000 BR BKN008 OVC015 M02/M05 Q1031');
    assert.equal(m.visibility, 2000);
    assert.deepEqual(m.weather, ['BR']);
    assert.deepEqual(m.layers, [{ cover: 'BKN', feet: 800, cb: false }, { cover: 'OVC', feet: 1500, cb: false }]);
    assert.equal(m.temp, -2);
    assert.equal(m.dew, -5);
});

test('METAR américain : visibilité en milles, QNH en pouces de mercure (A2992 -> 1013,2 hPa)', () => {
    const m = parseMetar('KJFK 211151Z 31012KT 10SM FEW250 08/M03 A2992 RMK AO2 SLP132');
    assert.equal(m.visibility, 10000);
    assert.equal(m.qnh, 1013.2);
    assert.equal(m.dew, -3);
    const low = parseMetar('KBOS 211154Z 05008KT 1 1/2SM -RA BR OVC005 10/09 A3001');
    assert.equal(low.visibility, Math.round(1.5 * 1609.344));
    assert.deepEqual(low.weather, ['-RA', 'BR']);
    assert.equal(low.qnh, Math.round(30.01 * 33.8639 * 10) / 10);
});

test('orage : TSRA, FEW030CB ; la tendance TEMPO n\'est pas lue', () => {
    const m = parseMetar('LFML 211500Z 20012G25KT 160V230 6000 TSRA FEW030CB BKN045 22/18 Q1006 TEMPO 3000 +TSRA BKN010CB');
    assert.equal(m.visibility, 6000);
    assert.deepEqual(m.weather, ['TSRA']);
    assert.deepEqual(m.layers, [{ cover: 'FEW', feet: 3000, cb: true }, { cover: 'BKN', feet: 4500, cb: false }]);
    assert.equal(m.qnh, 1006);
});

test('jetons inconnus ignorés ; texte illisible -> null', () => {
    const m = parseMetar('LFML 211100Z 18010KT 9999 R31R/P2000 ZZZZ NSC 15/10 Q1015 BECMG 4000');
    assert.equal(m.visibility, 10000);
    assert.deepEqual(m.layers, []);
    assert.deepEqual(m.weather, []);
    assert.equal(m.qnh, 1015);
    assert.equal(parseMetar(''), null);
    assert.equal(parseMetar('bonjour'), null);
    assert.equal(parseMetar(null), null);
    assert.equal(parseMetar('LFML 211100Z NIL'), null);
});

test('metarToWeather, CAVOK : pas de nuages, brouillard de la base, bulletin « 10 km ou plus », vent variable', () => {
    const raw = 'LFML 211100Z AUTO VRB02KT CAVOK 14/07 Q1020 NOSIG';
    const { weather, metar } = metarToWeather(parseMetar(raw), JOUR);
    assert.equal(weather.label, 'Météo réelle (LFML)');
    assert.equal(weather.clouds.coverage, 0);
    assert.equal(weather.clouds.light, 0xffffff, 'reste du préréglage gardé');
    assert.equal('overcast' in weather, false);
    assert.equal(weather.fogFar, 2400);
    assert.equal(weather.fogNear, 400);
    assert.equal(weather.turbulence, 0);
    assert.ok(near(weather.wind, 2 / 30));
    assert.deepEqual(metar.vis, ['10 km ou plus', '10 kilometres or more']);
    assert.deepEqual(metar.clouds, ['pas de nuages significatifs, CAVOK', 'no significant cloud, CAVOK']);
    assert.equal(metar.wind, 0);
    assert.equal(metar.variation, 180);
    assert.equal('gust' in metar, false);
    assert.equal(metar.qnh, 1020);
    assert.equal(metar.real, true);
    assert.equal(metar.raw, raw);
    assert.equal(metar.station, 'LFML');
    assert.equal(JOUR.clouds.coverage, 0.45, 'le préréglage n\'est pas modifié');
});

test('metarToWeather, plafond bas et brume : overcast à 800 ft, brouillard resserré, couverture OVC', () => {
    const { weather, metar } = metarToWeather(parseMetar('LFML 210600Z 34004KT 2000 BR BKN008 OVC015 M02/M05 Q1031'), NUAGEUX);
    assert.equal(weather.clouds.coverage, 2.5);
    assert.ok(near(weather.overcast.base, 800 * 0.3048));
    assert.ok(near(weather.overcast.top, 800 * 0.3048 + 80));
    assert.equal(weather.overcast.coverage, 0.8);
    assert.equal(weather.overcast.scale, 900);
    assert.equal(weather.fogFar, 500);
    assert.ok(near(weather.fogNear, 500 / 6));
    assert.equal('rain' in weather, false);
    assert.deepEqual(metar.vis, ['2000 mètres, brume', '2000 metres, mist']);
    assert.deepEqual(metar.clouds, ['fragmentés à 800 pieds, couvert à 1500 pieds', 'broken 800 feet, overcast 1500 feet']);
    assert.equal(metar.temp, -2);
    assert.equal(metar.dew, -5);
    assert.equal(metar.variation, 10);
    // Très faible visibilité : brouillard borné à 150 m
    const fog = metarToWeather(parseMetar('LFML 210600Z 00000KT 0200 FG VV001 05/05 Q1025'), JOUR).weather;
    assert.equal(fog.fogFar, 150);
    // Couche haute (BKN080) : pas de plafond continu, même sur la base « nuageux »
    const high = metarToWeather(parseMetar('LFML 211200Z 18008KT 9999 BKN080 18/10 Q1018'), NUAGEUX).weather;
    assert.equal('overcast' in high, false);
    assert.equal(high.clouds.coverage, 1.2);
});

test('metarToWeather, rafales et orage : turbulence, pluie, éclairs, variation dddVddd, textes', () => {
    const gusty = metarToWeather(parseMetar('LFML 211130Z 27015G28KT 240V300 9999 FEW040 16/04 Q1008'), JOUR);
    assert.ok(near(gusty.weather.turbulence, 18 / 30));
    assert.equal(gusty.weather.wind, 0.5);
    assert.equal(gusty.metar.gust, 28);
    assert.equal(gusty.metar.wind, 270);
    assert.equal(gusty.metar.variation, 30);
    assert.deepEqual(gusty.metar.clouds, ['peu nombreux à 4000 pieds', 'few clouds 4000 feet']);
    assert.equal(gusty.weather.clouds.coverage, 0.25);

    const storm = metarToWeather(parseMetar('LFML 211500Z 20012G25KT 160V230 6000 +TSRA FEW030CB BKN045 22/18 Q1006'), JOUR);
    assert.equal(storm.weather.rain, 1);
    assert.equal(storm.weather.lightning, true);
    assert.equal(storm.weather.turbulence, 1, '15 kt au-dessus de 10 kt (0,5) plus l\'orage (0,6), borné à 1');
    assert.equal(storm.weather.fogFar, 1500);
    assert.ok(near(storm.weather.overcast.base, 4500 * 0.3048));
    assert.equal(storm.weather.overcast.scale, 1, 'base « jour » : pas d\'échelle de plafond, 1');
    assert.equal(storm.metar.variation, 35);
    assert.deepEqual(storm.metar.vis, ['6 km, orage avec forte pluie', '6 kilometres, heavy thunderstorm with rain']);
    assert.deepEqual(storm.metar.clouds, ['peu nombreux à 3000 pieds, cumulonimbus, fragmentés à 4500 pieds',
        'few clouds 3000 feet, cumulonimbus, broken 4500 feet']);

    // VRB avec secteur : direction moyenne du secteur (sens horaire, à travers le nord)
    const vrb = metarToWeather(parseMetar('LFML 211130Z VRB05KT 330V030 9999 SCT030 12/08 Q1012'), JOUR).metar;
    assert.equal(vrb.wind, 0);
    assert.equal(vrb.variation, 30);
    assert.throws(() => metarToWeather(parseMetar('LFML 211130Z 27005KT 9999 12/08 Q1012')));
});

test('pickMetar : LFMA d\'abord, LFML en repli, sinon null', () => {
    assert.deepEqual(METAR_STATIONS, ['LFMA', 'LFML']);
    assert.equal(METAR_URL, 'https://metar.vatsim.net/LFMA,LFML?format=json');
    const lfml = { id: 'LFML', metar: '211100Z AUTO VRB02KT CAVOK 14/07 Q1020 NOSIG' };
    assert.equal(pickMetar([lfml]), 'LFML 211100Z AUTO VRB02KT CAVOK 14/07 Q1020 NOSIG');
    assert.equal(pickMetar([lfml, { id: 'LFMA', metar: '211100Z 30005KT 9999 15/06 Q1019' }]),
        'LFMA 211100Z 30005KT 9999 15/06 Q1019');
    assert.equal(pickMetar([]), null);
    assert.equal(pickMetar(null), null);
    assert.equal(pickMetar([{ id: 'LFMN', metar: '211100Z 09005KT CAVOK 17/08 Q1021' }]), null);
    assert.equal(parseMetar(pickMetar([lfml])).station, 'LFML');
});
