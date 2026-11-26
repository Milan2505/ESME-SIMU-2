// Modèle réaliste au clavier avec les réglages par défaut du jeu (décision du 25/11/2026, demande « le Cessna oscille dans
// tous les sens, les commandes ne sont presque pas ludiques ») : douceur « Vive » (InputRamp, échelle 0,5), palonnier
// automatique activé. Comparé au modèle simplifié (l'« ancienne physique »), avec son lissage des touches en jeu
// (PlaneControls : rattrapage exponentiel en 0,5 / 3 s). Avion compensé à 100 KTAS, 600 m, air calme.
// Mesures du 25/11/2026 (avant : profondeur à piquer sans commande en effort, « Très vive », sans palonnier automatique) :
// - touche à piquer tenue 0,5 s : simplifié 23°/s et -0,18 g ; avant 64°/s et -2,2 g ; maintenant 15°/s et +0,27 g ;
// - touche d'ailerons tenue 0,5 s : ondulation de l'inclinaison après le relâchement (roulis hollandais excité par le
//   lacet inverse) : simplifié 1,4° ; avant 14° (15° de dérapage) ; maintenant 0,7° (1° de dérapage) ;
// - joueur qui tient la touche jusqu'à 30° d'inclinaison, voit avec 0,25 s de retard : dépassement simplifié 6,7°, avant
//   38° (3,5 g ; perte de contrôle avec 0,35 s de retard) ; maintenant 8°.
// Bornes : valeurs du modèle simplifié avec une marge, jamais celles d'avant (réglage du jeu, pas une donnée du manuel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, attitude, KT, DT } from './helpers/flight.js';
import { trimmedFlight } from './helpers/modes.js';
import { InputRamp } from '../js/InputRamp.js';

const RAD = 180 / Math.PI;
const GAME_RAMP = 0.5;          // réglage « Douceur des commandes » par défaut (js/Settings.js)
const SMOOTHING = 0.5;          // modèle simplifié : lissage des touches (PlaneControls, _CONTROL_SMOOTHING)
const flights = {};
function trimmed(model) {
    flights[model] ??= trimmedFlight(() => {
        const f = makeAircraft({ model });
        f.model.assists.autoRudder = true;
        return f;
    }, { speed: 100 * KT, altitude: 600 });
    return flights[model].make();
}
// Main du joueur : touches -> gouvernes, comme PlaneControls (montée progressive au réaliste, lissage au simplifié)
function hand(f) {
    const ramp = new InputRamp(), smooth = { pitch: 0, roll: 0, yaw: 0 };
    ramp.setScale(GAME_RAMP);
    return (keys) => {
        if (f.model.realistic) return ramp.update(keys, DT, f.model.indicatedSpeed / KT);
        const k = 1 - Math.exp(-DT / SMOOTHING * 3);
        for (const axis in smooth) smooth[axis] += ((keys[axis] ?? 0) - smooth[axis]) * k;
        return smooth;
    };
}

// Touche tenue `hold` s puis relâchée ; rend vitesse de rotation max, facteurs de charge extrêmes, dérapage max et
// ondulation (crête à crête autour de la tendance) de l'axe entre 0,3 et 3 s après le relâchement
function keyPulse(model, axis, sign, hold) {
    const f = trimmed(model), m = f.model, apply = hand(f);
    const a0 = attitude(f);
    let previous = a0, t = 0;
    const out = { rate: 0, maxLoad: 1, minLoad: 1, beta: 0 }, after = [];
    while (t < hold + 3) {
        Object.assign(m.controls, apply({ [axis]: t < hold ? sign : 0 }));
        m.step(DT);
        t += DT;
        const a = attitude(f);
        const angle = axis === 'pitch' ? a.pitch - a0.pitch : a.bank - a0.bank;
        out.rate = Math.max(out.rate, Math.abs((axis === 'pitch' ? a.pitch - previous.pitch : a.bank - previous.bank) / DT * RAD));
        out.maxLoad = Math.max(out.maxLoad, m.loadFactor);
        out.minLoad = Math.min(out.minLoad, m.loadFactor);
        out.beta = Math.max(out.beta, Math.abs(m.beta ?? 0) * RAD);
        if (t > hold + 0.3) after.push(angle * RAD);
        previous = a;
    }
    const n = after.length, xm = (n - 1) / 2, ym = after.reduce((s, y) => s + y, 0) / n;
    let sxy = 0, sxx = 0;
    after.forEach((y, i) => { sxy += (i - xm) * (y - ym); sxx += (i - xm) ** 2; });
    const residual = after.map((y, i) => y - ym - sxy / sxx * (i - xm));
    out.wobble = Math.max(...residual) - Math.min(...residual);
    return out;
}

// Joueur qui voit avec `delay` s de retard, décide toutes les 0,1 s, tient la touche d'ailerons jusqu'à l'inclinaison
// visée (prévue 0,5 s plus tard, zone morte 2°) et l'assiette de palier à la profondeur : 30° à droite pendant 20 s,
// puis ailes à plat. Rend le dépassement de l'inclinaison et son écart type une fois établie
function bankCapture(model, delay) {
    const f = trimmed(model), m = f.model, apply = hand(f);
    const keys = { pitch: 0, roll: 0, yaw: 0 }, seen = [];
    const level = attitude(f).pitch * RAD;
    let previous = attitude(f), rate = { pitch: 0, bank: 0 }, t = 0, next = 0;
    const out = { overshoot: 0, settled: [], maxLoad: 1 };
    while (t < 40 && !m.crashed) {
        seen.push({ a: attitude(f), rate, vy: m.velocity.y, y: f.object.position.y });
        const s = seen[Math.max(0, seen.length - 1 - Math.round(delay / DT))];
        const target = t < 20 ? -30 : 0;
        if (t >= next) {
            next = t + 0.1;
            const bankError = target - s.a.bank * RAD - s.rate.bank * 0.5;
            keys.roll = bankError > 2 ? 1 : bankError < -2 ? -1 : 0;
            const pitchTarget = level + Math.max(-3, Math.min(6, (600 - s.y) * 0.1 - s.vy * 0.8));
            const pitchError = pitchTarget - s.a.pitch * RAD - s.rate.pitch * 0.6;
            keys.pitch = pitchError > 0.7 ? 1 : pitchError < -0.7 ? -1 : 0;
        }
        Object.assign(m.controls, apply(keys));
        m.step(DT);
        t += DT;
        const a = attitude(f);
        rate = { pitch: (a.pitch - previous.pitch) / DT * RAD, bank: (a.bank - previous.bank) / DT * RAD };
        previous = a;
        const bank = -a.bank * RAD;
        out.overshoot = Math.max(out.overshoot, t < 20 ? bank - 30 : -bank);
        if ((t > 6 && t < 20) || t > 26) out.settled.push(bank - (t < 20 ? 30 : 0));
        out.maxLoad = Math.max(out.maxLoad, m.loadFactor);
    }
    out.crashed = m.crashed;
    out.spread = Math.sqrt(out.settled.reduce((s, x) => s + x * x, 0) / out.settled.length);
    return out;
}

test('[realiste] réglages du jeu : touche à piquer tenue 0,5 s à 100 kt, nez ≤ 25°/s et facteur de charge ≥ 0 g (simplifié : 23°/s, -0,18 g)', (t) => {
    const simple = keyPulse('simplifie', 'pitch', -1, 0.5), real = keyPulse('realiste', 'pitch', -1, 0.5);
    t.diagnostic(`simplifié ${simple.rate.toFixed(0)}°/s, ${simple.minLoad.toFixed(2)} g ; réaliste ${real.rate.toFixed(0)}°/s, ${real.minLoad.toFixed(2)} g`);
    assert.ok(real.rate <= 25, `nez à ${real.rate.toFixed(0)}°/s`);
    assert.ok(real.minLoad >= 0, `facteur de charge ${real.minLoad.toFixed(2)} g`);
});

test('[realiste] réglages du jeu : touche à cabrer tenue 0,5 s à 100 kt, nez ≤ 25°/s et facteur de charge ≤ 2,3 g (simplifié : 26°/s, 2,3 g)', (t) => {
    const simple = keyPulse('simplifie', 'pitch', 1, 0.5), real = keyPulse('realiste', 'pitch', 1, 0.5);
    t.diagnostic(`simplifié ${simple.rate.toFixed(0)}°/s, ${simple.maxLoad.toFixed(2)} g ; réaliste ${real.rate.toFixed(0)}°/s, ${real.maxLoad.toFixed(2)} g`);
    assert.ok(real.rate <= 25, `nez à ${real.rate.toFixed(0)}°/s`);
    assert.ok(real.maxLoad <= 2.3, `facteur de charge ${real.maxLoad.toFixed(2)} g`);
});

test('[realiste] réglages du jeu : touche d\'ailerons tenue 0,5 s puis lâchée à 100 kt, dérapage ≤ 5°, inclinaison qui n\'ondule pas (≤ 2,5° crête à crête, simplifié : 1,4°)', (t) => {
    for (const hold of [0.5, 1]) {
        const simple = keyPulse('simplifie', 'roll', 1, hold), real = keyPulse('realiste', 'roll', 1, hold);
        t.diagnostic(`${hold} s : simplifié ${simple.rate.toFixed(0)}°/s, ondulation ${simple.wobble.toFixed(1)}° ; réaliste ${real.rate.toFixed(0)}°/s, dérapage ${real.beta.toFixed(1)}°, ondulation ${real.wobble.toFixed(1)}°`);
        assert.ok(real.beta <= 5, `dérapage ${real.beta.toFixed(1)}°`);
        assert.ok(real.wobble <= 2.5, `ondulation ${real.wobble.toFixed(1)}°`);
    }
});

test('[realiste] réglages du jeu : sans palonnier automatique, le lacet inverse reste (touche d\'ailerons tenue 1 s : dérapage > 10°)', () => {
    const f = trimmed('realiste');
    f.model.assists.autoRudder = false;
    const apply = hand(f);
    let beta = 0;
    for (let t = 0; t < 3; t += DT) {
        Object.assign(f.model.controls, apply({ roll: t < 1 ? 1 : 0 }));
        f.model.step(DT);
        beta = Math.max(beta, Math.abs(f.model.beta) * RAD);
    }
    assert.ok(beta > 10, `dérapage ${beta.toFixed(1)}°`);
});

test('[realiste] réglages du jeu : joueur qui tient la touche jusqu\'à 30° d\'inclinaison puis jusqu\'aux ailes à plat, 0,25 s de réaction : dépassement ≤ 10° (simplifié : 6,7°), inclinaison tenue à ±5° ; 0,35 s : jamais de perte de contrôle', (t) => {
    const simple = bankCapture('simplifie', 0.25), real = bankCapture('realiste', 0.25);
    t.diagnostic(`0,25 s : simplifié dépassement ${simple.overshoot.toFixed(1)}°, écart ${simple.spread.toFixed(1)}° ; réaliste ${real.overshoot.toFixed(1)}°, écart ${real.spread.toFixed(1)}°, ${real.maxLoad.toFixed(2)} g`);
    assert.ok(!real.crashed);
    assert.ok(real.overshoot <= 10, `dépassement ${real.overshoot.toFixed(1)}°`);
    assert.ok(real.spread <= 5, `écart type de l'inclinaison établie ${real.spread.toFixed(1)}°`);
    const slow = bankCapture('realiste', 0.35);
    t.diagnostic(`0,35 s : réaliste dépassement ${slow.overshoot.toFixed(1)}°, ${slow.maxLoad.toFixed(2)} g`);
    assert.ok(!slow.crashed && slow.overshoot <= 20, `0,35 s : dépassement ${slow.overshoot.toFixed(1)}°`);
    assert.ok(slow.maxLoad <= 3, `0,35 s : ${slow.maxLoad.toFixed(2)} g`);
});
