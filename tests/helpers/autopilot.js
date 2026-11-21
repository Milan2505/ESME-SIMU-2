// Banc d'essai du pilote automatique KAP 140 (js/KAP140.js) sur le modèle réaliste, hors navigateur : capteurs lus sur le
// modèle (cap, altitude, vitesse verticale, inclinaison), servos appliqués aux commandes et au trim comme le fait
// PlaneControls (setAutopilotOutput), alimentation et test au démarrage faits avant l'essai
import { makeAircraft, airborne, attitude, KT, FT } from './flight.js';
import { KAP140 } from '../../js/KAP140.js';

const TRIM_RATE = 8 * Math.PI / 180 * 0.25;   // servo de trim (rad de tab par seconde), comme PlaneControls (_AP_TRIM)

// Avion en palier (altitude en ft, vitesse en kt), KAP 140 allumé et prêt ; nav(t) : récepteur NAV simulé (optionnel)
export function autopilotBench({ altitudeFt = 3000, speedKt = 100, throttle = 0.68, trim = null, seed = 1 } = {}) {
    const f = airborne(makeAircraft({ model: 'realiste', seed }), { altitude: altitudeFt * FT, speed: speedKt * KT, throttle });
    if (trim !== null) f.model.trim = trim;
    const kap = new KAP140();
    const bench = { f, kap, bug: 0, nav: null, t: 0, output: null };
    let lastY = f.object.position.y;
    bench.sense = (dt) => {
        const a = attitude(f), y = f.object.position.y;
        const vs = (y - lastY) / Math.max(dt, 1e-6) / FT * 60;
        lastY = y;
        return {
            powered: true, heading: a.heading, bug: bench.bug, altitude: y / FT, vs, bank: f.model.bankAngle,
            pitch: f.model.pitchAttitude, ias: f.model.indicatedSpeed, tas: f.model.airspeed, onGround: f.model.onGround,
            nav: bench.nav ? bench.nav(bench) : null, baro: 1013,
            trimFree: true, manualTrim: false,
        };
    };
    // Un pas de 1/60 s : capteurs -> KAP 140 -> servos -> modèle
    bench.step = (dt = 1 / 60) => {
        const s = bench.sense(dt);
        bench.state = s;
        const out = kap.update(dt, s);
        bench.output = out;
        const c = f.model.controls;
        c.pitch = out ? Math.max(-1, Math.min(1, out.pitch)) : 0;
        c.roll = out ? Math.max(-1, Math.min(1, out.roll)) : 0;
        c.yaw = 0;
        if (out?.trim) {
            const A = f.model.aircraft;
            f.model.trim = Math.max(A.trimTabMin, Math.min(A.trimTabMax, f.model.trim + out.trim * TRIM_RATE * dt));
        }
        f.model.step(dt);
        bench.t += dt;
    };
    bench.run = (seconds, each) => { for (let t = 0; t < seconds && !f.model.crashed; t += 1 / 60) { bench.step(); each?.(bench); } };
    // Mise sous tension et test au démarrage (PFT), avion figé (sinon il volerait 8 s sans commandes avant l'essai)
    const idle = { powered: true, heading: 0, bug: 0, altitude: altitudeFt, vs: 0, bank: 0, pitch: 0, ias: speedKt * KT, tas: speedKt * KT, onGround: false };
    for (let t = 0; t < 8; t += 1 / 60) kap.update(1 / 60, idle);
    bench.step(1 / 60);
    return bench;
}
export const press = (bench, button) => bench.kap.press(button, bench.state);
