// Pilote automatique KAP 140 (lot 4, js/KAP140.js) sur le modèle réaliste, en air calme : tenue d'altitude à ±50 ft et de
// cap à ±3° pendant 3 min (feuille de route), virage au taux standard, capture de l'altitude présélectionnée (dépassement
// ~10 % de la VS au plus, Pilot's Guide p. 59), suivi d'une radiale, test au démarrage, déconnexions et alarme, alerteur
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autopilotBench, press } from './helpers/autopilot.js';
import { attitude, FT } from './helpers/flight.js';
import { KAP140 } from '../js/KAP140.js';

const wrap = (a) => ((a % 360) + 540) % 360 - 180;
const DEG = Math.PI / 180;

test('test au démarrage (PFT) : engagement refusé pendant le test, puis prêt', () => {
    const kap = new KAP140();
    const s = { powered: true, heading: 0, bug: 0, altitude: 3000, vs: 0, bank: 0, pitch: 0, ias: 50, tas: 50, onGround: false };
    let pft = 0;
    kap.addEventListener('pft', () => pft++);
    kap.update(0.5, s);
    assert.equal(kap.display().pft, 1);
    kap.press('ap', s);
    assert.equal(kap.engaged, false);
    for (let t = 0; t < 8; t += 0.1) kap.update(0.1, s);
    assert.equal(pft, 1);
    assert.equal(kap.ready, true);
    kap.press('ap', s);
    assert.equal(kap.engaged, true);
    assert.equal(kap.lateral, 'ROL');
    assert.equal(kap.vertical, 'VS');
});

test('tenue d\'altitude ±50 ft et de cap ±3° pendant 3 min, air calme (avion mal trimé au départ)', () => {
    const b = autopilotBench({ trim: 40 * DEG });   // (trim très à cabrer : le servo de trim doit le reprendre)
    b.bug = attitude(b.f).heading;
    press(b, 'ap');
    press(b, 'hdg');
    press(b, 'alt');
    const altitude = b.kap.altTarget, heading = b.bug;
    let maxAlt = 0, maxHdg = 0;
    b.run(180, (x) => {
        maxAlt = Math.max(maxAlt, Math.abs(x.state.altitude - altitude));
        maxHdg = Math.max(maxHdg, Math.abs(wrap(x.state.heading - heading)));
    });
    assert.equal(b.f.model.crashed, false);
    assert.ok(maxAlt <= 50, `altitude : ${maxAlt.toFixed(1)} ft`);
    assert.ok(maxHdg <= 3, `cap : ${maxHdg.toFixed(2)}°`);
    assert.ok(b.f.model.trim < 35 * DEG, `le servo de trim a repris l'effort (trim ${(b.f.model.trim / DEG).toFixed(1)}°)`);
    assert.ok(Math.abs(b.output.pitch) < 0.06, `servo de tangage déchargé (${b.output.pitch.toFixed(3)})`);
});

test('HDG : virage au taux standard (3°/s au plus), inclinaison limitée, cap tenu ensuite', () => {
    const b = autopilotBench();
    b.bug = attitude(b.f).heading;
    press(b, 'ap');
    press(b, 'hdg');
    press(b, 'alt');
    b.run(10);
    const start = b.state.heading;
    b.bug = (start + 90) % 360;
    let t = 0, bank = 0;
    while (t < 120 && Math.abs(wrap(b.state.heading - b.bug)) > 2) { b.step(); t += 1 / 60; bank = Math.max(bank, Math.abs(b.f.model.bankAngle) / DEG); }
    assert.ok(t > 28 && t < 45, `90° en ${t.toFixed(1)} s`);
    assert.ok(bank < 20, `inclinaison ${bank.toFixed(1)}°`);
    let maxHdg = 0;
    b.run(60, (x) => { maxHdg = Math.max(maxHdg, Math.abs(wrap(x.state.heading - b.bug))); });
    assert.ok(maxHdg < 3, `cap après le virage : ±${maxHdg.toFixed(2)}°`);
});

test('VS puis capture de l\'altitude présélectionnée (ALT ARM), dépassement ~10 % de la VS au plus', () => {
    const b = autopilotBench();
    press(b, 'ap');
    b.f.model.throttle = 1;   // (le KAP 140 ne touche pas aux gaz : le pilote met la puissance de montée)
    const target = Math.round(b.state.altitude / 100) * 100 + 1000;
    b.kap.turn('outer', 1);
    b.kap.selected = target;
    assert.equal(b.kap.altArm, true, 'boutons tournés AP engagé : ALT ARM');
    // UP : premier appui affiche la VS, les suivants la changent de 100 ft/min
    const vs0 = b.kap.vsTarget;
    press(b, 'up');
    assert.equal(b.kap.vsTarget, vs0);
    for (let i = 0; i < 5; i++) press(b, 'up');
    assert.equal(b.kap.vsTarget, vs0 + 500);
    let over = 0, captured = false;
    b.run(240, (x) => { if (x.kap.vertical === 'ALT') captured = true; if (captured) over = Math.max(over, x.state.altitude - target); });
    assert.ok(captured, 'capture de l\'altitude');
    assert.ok(over < 60, `dépassement ${over.toFixed(1)} ft`);
    assert.ok(Math.abs(b.state.altitude - target) < 30);
});

// Radiale au nord (balise à 40 km), conservateur = cap vrai ; offset : écart de départ à l'est (m)
function radialBench(offset) {
    const b = autopilotBench();
    b.f.object.position.x = offset;
    b.f.object.quaternion.identity();
    const station = { x: 0, z: b.f.object.position.z - 40000 };
    b.nav = () => {
        const p = b.f.object.position;
        const angle = Math.atan2(p.x - station.x, p.z - station.z) / DEG;   // + = à l'est de la radiale
        return { available: true, deviation: Math.max(-1, Math.min(1, -angle / 10)), isIls: false };
    };
    b.bug = 0;   // curseur calé sur la route (HDG clignote pour le rappeler, p. 15)
    press(b, 'ap');
    press(b, 'alt');
    press(b, 'nav');
    return b;
}

test('NAV : près de la route, capture tout de suite et suivi sans dépassement', () => {
    const b = radialBench(1500);
    let west = 0;
    b.run(360, (x) => { west = Math.min(west, x.f.object.position.x); });
    assert.equal(b.kap.lateral, 'NAV');
    assert.ok(west > -100, `dépassement ${west.toFixed(0)} m`);
    assert.ok(Math.abs(b.f.object.position.x) < 100, `écart final ${b.f.object.position.x.toFixed(0)} m`);
});

test('NAV armé loin de la route : interception à 45°, capture, puis suivi', () => {
    const b = radialBench(6000);
    assert.equal(b.kap.lateralArm, 'NAV');
    let minHeading = 0, captured = null;
    b.run(480, (x) => {
        // (cap d'interception, phase armée : à la capture, le lacet inverse de la mise en virage le dépasse un instant)
        if (x.kap.lateralArm) minHeading = Math.min(minHeading, wrap(x.state.heading));
        if (captured === null && x.kap.lateral === 'NAV') captured = x.t;
    });
    assert.ok(captured !== null, 'radiale capturée');
    assert.ok(minHeading > -48 && minHeading < -40, `interception au cap ${minHeading.toFixed(1)}°`);
    assert.ok(Math.abs(b.f.object.position.x) < 200, `écart final ${b.f.object.position.x.toFixed(0)} m`);
});

test('déconnexions : A/P DISC, bouton AP, trim manuel, alimentation ; alarme et AP qui clignote', () => {
    const b = autopilotBench();
    const reasons = [];
    b.kap.addEventListener('disconnect', (e) => reasons.push(e.detail));
    press(b, 'ap');
    b.run(1);
    b.kap.press('disc', b.state);
    assert.equal(b.kap.engaged, false);
    assert.equal(b.output, b.output);   // (sortie suivante nulle)
    b.step();
    assert.equal(b.output, null);
    assert.match(b.kap.display().ap, /flash|off/);
    press(b, 'ap');
    press(b, 'ap');
    press(b, 'ap');
    b.kap.update(1 / 60, { ...b.state, manualTrim: true });
    press(b, 'ap');
    b.kap.update(1 / 60, { ...b.state, powered: false });
    assert.deepEqual(reasons, ['A/P DISC', 'bouton AP', 'trim manuel', 'alimentation']);
    assert.equal(b.kap.ready, false, 'nouveau test au prochain allumage');
});

test('ALT : UP / DN déplacent l\'altitude tenue de 20 ft ; alerteur à 1 000 ft et en quittant ±200 ft', () => {
    const b = autopilotBench();
    press(b, 'ap');
    press(b, 'alt');
    const alt = b.kap.altTarget;
    press(b, 'up');
    press(b, 'up');
    assert.equal(b.kap.altTarget, alt + 40);
    const kap = new KAP140(), alerts = [];
    kap.addEventListener('alert', (e) => alerts.push(e.detail));
    kap.selected = 5000;
    const s = { powered: true, heading: 0, bug: 0, vs: 500, bank: 0, pitch: 0, ias: 50, tas: 50, onGround: false };
    for (const altitude of [3000, 3900, 4100, 4500, 4900, 5000, 4900, 4700]) kap.update(1, { ...s, altitude });
    assert.deepEqual(alerts, ['approche', 'quitte']);
    assert.equal(kap.display().alert, true);
    assert.ok(Number.isFinite(FT));
});
