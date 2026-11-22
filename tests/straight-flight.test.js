// L'avion va droit manche lâché (22/11/2026 : au clavier, sans palonnier, il « ne faisait que virer à gauche ») : les
// effets de l'hélice qui font tourner à gauche (couple, souffle hélicoïdal, facteur P, effet gyroscopique) sont supprimés
// du modèle réaliste. Roulage plein gaz, montée plein gaz et croisière, sans vent, commandes au neutre
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, run, attitude, KT } from './helpers/flight.js';

const RAD = 180 / Math.PI;
const wrap = (a) => ((a + 540) % 360) - 180;

test('roulage plein gaz manche lâché : droit sur l\'axe', () => {
    const f = makeAircraft({ model: 'realiste' });
    f.model.throttle = 1;
    run(f, 15, { until: () => !f.model.onGround });
    const x = f.object.position.x, heading = wrap(attitude(f).heading);
    assert.ok(Math.abs(x) < 1 && Math.abs(heading) < 1, `roulage : ${x.toFixed(2)} m, ${heading.toFixed(2)}°`);
    assert.ok(f.model.indicatedSpeed / KT > 40);
});

for (const [label, speed, throttle, trim] of [['montée plein gaz', 38, 1, 20], ['croisière', 55, 0.75, 0]]) {
    test(`${label} manche lâché, 60 s : ni inclinaison ni virage`, () => {
        const f = airborne(makeAircraft({ model: 'realiste' }), { altitude: 600, speed, throttle });
        f.model.trim = trim * Math.PI / 180;
        const heading0 = attitude(f).heading;
        let bank = 0, turn = 0;
        run(f, 60, { pilot: () => {
            bank = Math.max(bank, Math.abs(attitude(f).bank) * RAD);
            turn = Math.max(turn, Math.abs(wrap(attitude(f).heading - heading0)));
        } });
        assert.ok(bank < 2 && turn < 3, `inclinaison max ${bank.toFixed(2)}°, cap ${turn.toFixed(2)}°`);
    });
}
