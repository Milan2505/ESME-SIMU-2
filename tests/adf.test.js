// ADF KR 87 (js/Avionics.js) : relèvement relatif de la balise, portée, mode ANT, réglage des fréquences
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Avionics, adfBearing, tuneAdf } from '../js/Avionics.js';

// Balise à l'origine, portée 10 km ; nord = -z, est = +x
const ndb = { ident: 'EM', khz: 344, position: { x: 0, z: 0 }, range: 10000 };
const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) < tolerance;

test('relèvement relatif : balise devant, à droite, derrière, à gauche', () => {
    // Avion au sud de la balise, cap nord : balise droit devant
    assert.ok(close(adfBearing({ x: 0, z: 3000 }, 0, ndb), 0));
    // Même endroit, cap ouest (270°) : la balise (au nord) est à droite
    assert.ok(close(adfBearing({ x: 0, z: 3000 }, 270, ndb), 90));
    // Cap sud : derrière
    assert.ok(close(adfBearing({ x: 0, z: 3000 }, 180, ndb), 180));
    // Avion à l'ouest de la balise, cap nord : la balise (à l'est) est à droite ; cap sud : à gauche
    assert.ok(close(adfBearing({ x: -2000, z: 0 }, 0, ndb), 90));
    assert.ok(close(adfBearing({ x: -2000, z: 0 }, 180, ndb), 270));
    // Au nord-est de la balise, cap 045 : balise derrière (225 - 45 = 180)
    assert.ok(close(adfBearing({ x: 1000, z: -1000 }, 45, ndb), 180));
});

test('relèvement entre 0 et 360°, position en Vector3 ou { x, z }', () => {
    for (let heading = -720; heading <= 720; heading += 37) {
        const b = adfBearing({ x: 500, y: 300, z: 800 }, heading, ndb);
        assert.ok(b >= 0 && b < 360, `cap ${heading} : ${b}`);
    }
    // Balise donnée par sa seule position (sans portée) : toujours reçue
    assert.ok(close(adfBearing({ x: 0, z: 100000 }, 0, { x: 0, z: 0 }), 0));
});

test('hors de portée ou sans balise : pas de signal (null)', () => {
    assert.equal(adfBearing({ x: 0, z: 10001 }, 0, ndb), null);
    assert.notEqual(adfBearing({ x: 0, z: 9999 }, 0, ndb), null);
    assert.equal(adfBearing({ x: 0, z: 100 }, 0, null), null);
});

test('mode ANT : aiguille garée à 90°, même sans balise ou hors de portée', () => {
    assert.equal(adfBearing({ x: 0, z: 3000 }, 0, ndb, 'ANT'), 90);
    assert.equal(adfBearing({ x: 0, z: 50000 }, 0, ndb, 'ANT'), 90);
    assert.equal(adfBearing({ x: 0, z: 3000 }, 0, null, 'ANT'), 90);
});

test('KR 87 : réglage des centaines (bouton extérieur) et des unités (intérieur), en boucle, 200 à 1799 kHz', () => {
    assert.equal(tuneAdf(344, true, 1), 444);
    assert.equal(tuneAdf(1744, true, 1), 244);
    assert.equal(tuneAdf(244, true, -1), 1744);
    assert.equal(tuneAdf(344, false, 1), 345);
    assert.equal(tuneAdf(399, false, 1), 300);      // sans retenue sur les centaines
    assert.equal(tuneAdf(300, false, -1), 399);
    assert.equal(tuneAdf(1799, false, 1), 1700);
});

test('KR 87 : FRQ échange, ADF bascule ADF / ANT, fréquences de départ', () => {
    const av = new Avionics();
    assert.deepEqual(av.adf, { active: 344, standby: 413, mode: 'ADF' });
    assert.equal(av.use('kr87:frq', 1), true);
    assert.deepEqual([av.adf.active, av.adf.standby], [413, 344]);
    av.use('kr87:adf', 1);
    assert.equal(av.adf.mode, 'ANT');
    av.use('kr87:adf', 1);
    assert.equal(av.adf.mode, 'ADF');
    av.use('kr87:outer', -1);
    assert.equal(av.adf.standby, 244);
    av.use('kr87:inner', 1);
    assert.equal(av.adf.standby, 245);
    av.use('kr87:inner', 1, true);                 // Maj : 10 kHz
    assert.equal(av.adf.standby, 255);
    assert.equal(av.adf.active, 413);              // seule la fréquence en attente change
    // La rose mobile reste sur son bouton
    av.use('adf', 1);
    assert.equal(av.adfCard, 1);
    av.reset();
    assert.deepEqual(av.adf, { active: 344, standby: 413, mode: 'ADF' });
});

test('ADF alimenté : barre avionique 2, disjoncteur et bouton marche', () => {
    const av = new Avionics();
    const systems = { avionicsPowered: true, avionics2Powered: true, breakers: { navcom1: true, navcom2: true, xpdr: true, dme: true, adf: true } };
    assert.equal(av.powered(systems).adf, true);
    av.use('power:adf', 1);
    assert.equal(av.powered(systems).adf, false);
});
