// Givrage du carburateur du 172P et réchauffe (lot 3, js/CarbIcing.js, Systems.js, Propulsion.js) : abaque CAA SSL 14
// p. 5, risque maximal à puissance réduite, chute de régime réchauffe tirée (POH 172P p. 7-15 : 75 à 150 tr/min plein
// gaz ; SSL 14 p. 8 : 75 à 100 à l'essai), givrage lent puis arrêt si on laisse faire, chute puis remontée à la fonte
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icingZone, icingSeverity, CarbIce, carbHeatDensity, MELT_TIME } from '../js/CarbIcing.js';
import { PistonPropeller } from '../js/Propulsion.js';
import { CESSNA_172 } from '../js/Cessna172.js';
import { RHO0 } from '../js/Atmosphere.js';
import { Systems } from '../js/Systems.js';

test('abaque CAA SSL 14 : zones selon température et point de rosée', () => {
    assert.equal(icingZone(10, 8), 4);       // 0-16 °C, très humide : sérieux à toute puissance
    assert.equal(icingZone(18, 9), 3);       // météo « Jour » : modéré en croisière, sérieux en descente
    assert.equal(icingZone(30, 10), 1);      // chaud et assez sec : léger seulement (35 °C / 12 : idem)
    assert.equal(icingZone(28, 12), 2);
    assert.equal(icingZone(30, -15), 0);     // très sec : hors abaque
    assert.equal(icingZone(-20, -22), 0);    // très froid : hors abaque
    assert.equal(icingZone(10, 15), 4);      // point de rosée au-dessus de la température : saturé
});

test('risque maximal à puissance réduite (« greater risk of serious icing at descent power »)', () => {
    assert.equal(icingSeverity(18, 9, 1), 2);     // croisière : modéré
    assert.equal(icingSeverity(18, 9, 0.1), 3);   // descente, ralenti : sérieux
    assert.equal(icingSeverity(28, 12, 1), 1);
    assert.equal(icingSeverity(28, 12, 0.1), 3);
    assert.equal(icingSeverity(30, -15, 0.1), 0);
});

// Régime statique (avion arrêté) : manette, densité extérieure (temp °C, niveau de la mer), réchauffe tirée ou non
function staticRpm(throttle, temp, heat) {
    const p = new PistonPropeller(CESSNA_172), E = CESSNA_172.engine;
    const admission = E.idleAdmission + (1 - E.idleAdmission) * throttle ** E.throttleCurve;
    const rho = RHO0 * 288.15 / (temp + 273.15), k = heat ? carbHeatDensity(temp) : 1;
    return p._equilibriumRpm(admission, PistonPropeller.mixtureFactor(1, rho / RHO0 * k, E), rho, 0, 1, k);
}

test('réchauffe tirée sans glace : chute de ~100 tr/min à l\'essai moteur, 75 à 150 plein gaz (POH p. 7-15)', () => {
    for (const temp of [5, 15, 30]) {
        const runUp = staticRpm(0.55, temp, false) - staticRpm(0.55, temp, true);
        const full = staticRpm(1, temp, false) - staticRpm(1, temp, true);
        assert.ok(runUp >= 75 && runUp <= 125, `${temp} °C, essai moteur : chute ${runUp.toFixed(0)} tr/min`);
        assert.ok(full >= 75 && full <= 150, `${temp} °C, plein gaz : chute ${full.toFixed(0)} tr/min`);
    }
});

test('givrage lent puis arrêt si on laisse faire ; plus vite au ralenti qu\'en croisière', () => {
    const minutes = (throttle) => {
        const ice = new CarbIce();
        let t = 0;
        while (!ice.choked && t < 7200) { ice.update(1, { temp: 18, dew: 9, throttle, heat: false, running: true }); t++; }
        return t / 60;
    };
    const idle = minutes(0.1), cruise = minutes(0.75);
    assert.ok(idle >= 10 && idle <= 20, `ralenti : ${idle.toFixed(1)} min`);
    assert.ok(cruise > idle * 1.4, `croisière : ${cruise.toFixed(1)} min`);
    // Air sec : pas de glace
    const dry = new CarbIce();
    for (let i = 0; i < 3600; i++) dry.update(1, { temp: 30, dew: -15, throttle: 0.1, heat: false, running: true });
    assert.equal(dry.ice, 0);
});

test('perte de régime progressive puis toux : la puissance baisse avec la glace', () => {
    const ice = new CarbIce();
    const at = (level) => { ice.ice = level; ice.melting = false; return ice.power; };
    assert.equal(at(0), 1);
    assert.ok(at(0.3) < 1 && at(0.3) > 0.9);
    assert.ok(at(0.8) < 0.7);
    ice.ice = 0.3;
    assert.equal(ice.roughness, 0);   // peu de glace : le régime baisse, sans ratés
    ice.ice = 0.8;
    assert.ok(ice.roughness > 0.5);
});

test('réchauffe avec glace : fonte en ~15-20 s avec des ratés, puis plus de ratés', () => {
    const ice = new CarbIce();
    ice.ice = 0.6;
    let rough = 0, t = 0;
    while (ice.ice > 0 && t < 60) {
        ice.update(0.1, { temp: 18, dew: 9, throttle: 0.5, heat: true, running: true });
        rough = Math.max(rough, ice.roughness);
        t += 0.1;
    }
    assert.ok(rough > 0.5, 'ratés pendant la fonte');
    assert.ok(t >= 10 && t <= MELT_TIME, `fonte en ${t.toFixed(1)} s (CAA SSL 14 p. 8 : 15 s au moins pour une glace avancée)`);
    ice.update(0.1, { temp: 18, dew: 9, throttle: 0.5, heat: true, running: true });
    assert.equal(ice.roughness, 0);
    assert.equal(ice.power, 1);
});

test('systèmes : tirette, densité d\'admission, givrage jusqu\'à l\'arrêt, redémarrage refusé tant que la glace reste', () => {
    const sys = new Systems();
    sys.setWeather(10, 8);
    assert.equal(sys.intakeDensity, 1);
    sys.toggle('carbHeat');
    assert.ok(sys.intakeDensity < 0.95 && sys.intakeDensity > 0.9);
    sys.toggle('carbHeat');
    let stops = 0;
    sys.addEventListener('stop', () => stops++);
    for (let t = 0; t < 3600 && sys.running; t += 0.5) sys.update(0.5, 0.1, 0, null);
    assert.equal(sys.running, false);
    assert.equal(sys.stopReason, 'givrage');
    assert.equal(stops, 1);
    // Démarreur : carburateur encore givré, le moteur ne part pas
    let failure = null;
    sys.addEventListener('startfail', (e) => { failure = e.detail; });
    sys.turnMagnetos(1);
    for (let t = 0; t < 3; t += 0.1) sys.update(0.1, 0.1, 0, null);
    assert.equal(sys.running, false);
    assert.match(failure, /givré/);
    // Réchauffe tirée, moteur arrêté : la chaleur restante fond la glace (lentement), puis il repart
    sys.toggle('carbHeat');
    for (let t = 0; t < 150; t += 0.5) sys.update(0.5, 0.1, 0, null);
    // (sans amorçage, il faut ~4,5 s de démarreur : plusieurs appuis sur START)
    for (let i = 0; i < 4 && !sys.running; i++) {
        sys.turnMagnetos(1);
        for (let t = 0; t < 1.7; t += 0.1) sys.update(0.1, 0.1, 0, null);
    }
    assert.equal(sys.running, true);
});
