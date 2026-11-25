// Pilote du moniteur (lot 6, js/InstructorPilot.js) sur le modèle réaliste, en air calme : sorties appliquées aux
// gouvernes, au trim et aux gaz comme le fait PlaneControls (canal setAutopilotOutput, lacet compris). Il doit savoir
// montrer ce que les leçons demandent : palier, virage à 45° tenu à l'altitude, vitesse tenue, virage vers un cap
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, airborne, attitude, KT, FT } from './helpers/flight.js';
import { InstructorPilot } from '../js/InstructorPilot.js';

const DEG = Math.PI / 180;
const TRIM_RATE = 8 * DEG * 0.25;   // servo de trim, comme PlaneControls (_TRIM_RATE × _AP_TRIM)
const wrap = (a) => ((a % 360) + 540) % 360 - 180;

// Avion en palier à 3 000 ft, pilote du moniteur branché ; step(plan) : un pas de 1/60 s
function bench({ altitudeFt = 3000, speedKt = 95, throttle = 0.68, seed = 1 } = {}) {
    const f = airborne(makeAircraft({ model: 'realiste', seed }), { altitude: altitudeFt * FT, speed: speedKt * KT, throttle });
    const pilot = new InstructorPilot();
    let lastY = f.object.position.y;
    const b = { f, pilot, t: 0 };
    b.sense = (dt) => {
        const y = f.object.position.y, vs = (y - lastY) / dt / FT * 60;
        lastY = y;
        return { heading: attitude(f).heading, altitude: y / FT, vs, bank: f.model.bankAngle, pitch: f.model.pitchAttitude,
            ias: f.model.indicatedSpeed, tas: f.model.airspeed, side: f.model.sideAcceleration, onGround: f.model.onGround, throttle: f.model.throttle };
    };
    b.step = (plan, dt = 1 / 60) => {
        const s = b.sense(dt);
        b.state = s;
        const out = pilot.update(dt, s, plan);
        const c = f.model.controls;
        c.pitch = Math.max(-1, Math.min(1, out.pitch));
        c.roll = Math.max(-1, Math.min(1, out.roll));
        c.yaw = Math.max(-1, Math.min(1, out.yaw));
        if (out.trim) {
            const A = f.model.aircraft;
            f.model.trim = Math.max(A.trimTabMin, Math.min(A.trimTabMax, f.model.trim + out.trim * TRIM_RATE * dt));
        }
        if (out.throttle !== null) f.model.throttle = out.throttle;
        f.model.step(dt);
        b.t += dt;
    };
    b.run = (seconds, plan, each) => { for (let t = 0; t < seconds && !f.model.crashed; t += 1 / 60) { b.step(typeof plan === 'function' ? plan(b) : plan); each?.(b); } };
    return b;
}

test('palier : altitude tenue à ±50 ft et ailes à plat pendant 2 min', () => {
    const b = bench();
    const plan = { altitude: 3000, throttleSpeed: 95 };
    b.run(20, plan);
    let maxAlt = 0, maxBank = 0;
    b.run(120, plan, (x) => {
        maxAlt = Math.max(maxAlt, Math.abs(x.state.altitude - 3000));
        maxBank = Math.max(maxBank, Math.abs(x.state.bank) / DEG);
    });
    assert.equal(b.f.model.crashed, false);
    assert.ok(maxAlt <= 50, `altitude : ${maxAlt.toFixed(0)} ft`);
    assert.ok(maxBank <= 3, `inclinaison : ${maxBank.toFixed(1)}°`);
    assert.ok(Math.abs(b.state.ias / KT - 95) < 5, `vitesse : ${(b.state.ias / KT).toFixed(1)} kt`);
});

test('virage à 45° : inclinaison ±5°, altitude ±100 ft, vitesse ±10 kt (tolérances de l\'ACS PA.V.A), 360° à gauche puis à droite', () => {
    for (const side of [-1, 1]) {
        const b = bench();
        const level = { altitude: 3000, throttleSpeed: 95 };
        b.run(20, level);
        const altitude = b.state.altitude, speed = b.state.ias / KT, heading = b.state.heading;
        let turned = 0, last = heading, maxBankErr = 0, maxAlt = 0, maxSpeed = 0;
        // Entrée : 5 s pour s'incliner, puis mesure jusqu'à 360°
        const plan = { bank: 45 * side, altitude, throttleSpeed: speed };
        b.run(5, plan, (x) => { turned += wrap(x.state.heading - last); last = x.state.heading; });
        while (Math.abs(turned) < 330 && b.t < 200) {
            b.step(plan);
            turned += wrap(b.state.heading - last);
            last = b.state.heading;
            maxBankErr = Math.max(maxBankErr, Math.abs(-b.state.bank / DEG - 45 * side));
            maxAlt = Math.max(maxAlt, Math.abs(b.state.altitude - altitude));
            maxSpeed = Math.max(maxSpeed, Math.abs(b.state.ias / KT - speed));
        }
        assert.equal(b.f.model.crashed, false);
        assert.ok(Math.abs(turned) >= 330, `virage de ${turned.toFixed(0)}° en ${b.t.toFixed(0)} s`);
        assert.ok(Math.sign(turned) === side, 'sens du virage');
        assert.ok(maxBankErr <= 5, `inclinaison : écart ${maxBankErr.toFixed(1)}° (${side < 0 ? 'gauche' : 'droite'})`);
        assert.ok(maxAlt <= 100, `altitude : écart ${maxAlt.toFixed(0)} ft (${side < 0 ? 'gauche' : 'droite'})`);
        assert.ok(maxSpeed <= 10, `vitesse : écart ${maxSpeed.toFixed(1)} kt (${side < 0 ? 'gauche' : 'droite'})`);
    }
});

test('vitesse tenue par l\'assiette, réduit (plané à 65 kt ±5 kt) ; bille au milieu', () => {
    const b = bench();
    const plan = { speed: 65, throttle: 0 };
    b.run(40, plan);
    let maxSpeed = 0, maxSide = 0;
    b.run(40, plan, (x) => {
        maxSpeed = Math.max(maxSpeed, Math.abs(x.state.ias / KT - 65));
        maxSide = Math.max(maxSide, Math.abs(x.state.side));
    });
    assert.equal(b.f.model.crashed, false);
    assert.ok(maxSpeed <= 5, `vitesse : écart ${maxSpeed.toFixed(1)} kt`);
    assert.ok(b.state.vs < -300, `en descente (${b.state.vs.toFixed(0)} ft/min)`);
    assert.ok(maxSide < 0.5, `accélération latérale ${maxSide.toFixed(2)} m/s²`);
});

test('virage vers un cap (90° à droite) : cap atteint à ±5° sans dépasser l\'inclinaison maxi', () => {
    const b = bench();
    b.run(10, { altitude: 3000, throttleSpeed: 95 });
    const target = (b.state.heading + 90) % 360;
    let maxBank = 0;
    b.run(60, { heading: target, maxBank: 25, altitude: 3000, throttleSpeed: 95 }, (x) => { maxBank = Math.max(maxBank, Math.abs(x.state.bank) / DEG); });
    assert.ok(Math.abs(wrap(b.state.heading - target)) <= 5, `cap ${b.state.heading.toFixed(0)}° pour ${target.toFixed(0)}°`);
    assert.ok(maxBank <= 28, `inclinaison ${maxBank.toFixed(1)}°`);
});

test('commandes imposées (vrille, décrochage) : braquages rendus tels quels, gaz imposés', () => {
    const pilot = new InstructorPilot();
    const s = { heading: 0, altitude: 3000, vs: 0, bank: 0, pitch: 0, ias: 30, tas: 30, side: 0 };
    const out = pilot.update(1 / 60, s, { elevator: 1, aileron: 0, yaw: -1, throttle: 0 });
    assert.deepEqual([out.pitch, out.roll, out.yaw, out.throttle, out.trim], [1, 0, -1, 0, 0]);
    assert.equal(pilot.update(1 / 60, s, null), null);
});
