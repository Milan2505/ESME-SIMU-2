// Aide « compensation des effets moteur » du modèle réaliste (22/11/2026 : l'avion « partait à gauche » au clavier) :
// activée, couple, souffle hélicoïdal et facteur P sont annulés ; désactivée (défaut du modèle, et réglage du joueur),
// l'avion garde la tendance à gauche du vrai 172 (pied droit au décollage et en montée)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, run, attitude, KT } from './helpers/flight.js';

const wrap = (a) => ((a + 540) % 360) - 180;

function takeoffRoll(compensated) {
    const f = makeAircraft({ model: 'realiste' });
    f.model.assists.engineCompensation = compensated;
    f.model.throttle = 1;
    run(f, 15, { until: () => !f.model.onGround });
    return { x: f.object.position.x, heading: wrap(attitude(f).heading), kt: f.model.indicatedSpeed / KT };
}
function climb(compensated) {
    const f = airborne(makeAircraft({ model: 'realiste' }), { altitude: 600, speed: 38, throttle: 1 });
    f.model.assists.engineCompensation = compensated;
    f.model.trim = 20 * Math.PI / 180;
    let bank = 0;
    run(f, 60, { pilot: () => { bank = Math.max(bank, Math.abs(attitude(f).bank) * 180 / Math.PI); } });
    return { bank };
}

test('compensation activée : roulage plein gaz droit, montée sans s\'incliner', () => {
    const roll = takeoffRoll(true);
    assert.ok(Math.abs(roll.x) < 2 && Math.abs(roll.heading) < 2, `roulage : ${roll.x.toFixed(1)} m, ${roll.heading.toFixed(1)}°`);
    assert.ok(roll.kt > 40);
    assert.ok(climb(true).bank < 5, 'montée manche lâché');
});

test('compensation coupée : l\'avion part à gauche (effets de l\'hélice du vrai 172)', () => {
    const roll = takeoffRoll(false);
    assert.ok(roll.x < -10 && roll.heading < -5, `roulage : ${roll.x.toFixed(1)} m, ${roll.heading.toFixed(1)}°`);
    assert.ok(climb(false).bank > 15);
});
