// L'avion va droit manche lâché (22/11/2026 : au clavier, sans palonnier, il « ne faisait que virer à gauche ») : les
// effets de l'hélice qui font tourner à gauche (couple, souffle hélicoïdal, facteur P, effet gyroscopique) sont supprimés
// du modèle réaliste. Roulage plein gaz, montée plein gaz et croisière, sans vent, commandes au neutre
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, run, attitude, KT, DT } from './helpers/flight.js';

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

// Saut au roulage (22/11/2026) : par vent arrière ou de trois quarts arrière, quand l'avion rattrape le vent après quelques
// mètres, l'air relatif passait de l'arrière à l'avant ; l'incidence sautait de ~180° et le nez avec elle (jusqu'à
// 27°/s par 12 kt). Mesuré corrigé : 0,06°/s au plus, tous vents de 4 à 12 kt
test('roulage par vent de toutes directions (4 à 12 kt), gaz réduits : pas de saut sur les 40 premiers mètres', () => {
    let worst = { rate: 0 };
    for (let dir = 0; dir < 360; dir += 30) for (const kt of [4, 8, 12]) {
        const f = makeAircraft({ model: 'realiste' }), { model, object } = f;
        const a = dir / RAD;
        model.wind.set(Math.sin(a) * kt * KT, 0, Math.cos(a) * kt * KT);
        const start = object.position.clone();
        let previous = null;
        run(f, 12, { pilot: (t) => {
            model.throttle = Math.min(0.2, t * 0.2);
            const pitch = attitude(f).pitch * RAD;
            if (previous !== null && object.position.distanceTo(start) < 40) {
                const rate = Math.abs(pitch - previous) / DT;
                if (rate > worst.rate) worst = { rate, dir, kt };
            }
            previous = pitch;
        } });
    }
    assert.ok(worst.rate < 2, `tangage ${worst.rate.toFixed(1)}°/s (vent ${worst.dir}°, ${worst.kt} kt)`);
});
