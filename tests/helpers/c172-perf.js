// Procédures de mesure des performances du Cessna 172 (voir tests/perf-c172.test.js) : chacune fait voler le modèle
// seul, avec les automatismes de tests/helpers/flight.js, et rend des valeurs stabilisées. Résultats mémorisés : chaque
// mesure n'est faite qu'une fois par exécution des tests.
import { makeAircraft, airborne, run, attitude, average, speedHold, altitudeHold, speedWithThrottle, bankHold, coordinate, combine, KT, FT, FPM, DT } from './flight.js';

const memo = new Map();
const once = (key, compute) => { if (!memo.has(key)) memo.set(key, compute()); return memo.get(key); };

// Décollage court du manuel : volets 10°, plein gaz, rotation à Vr, 50 ft passés à la vitesse de meilleur angle (kt)
export function takeoff({ rotateKt = 51, climbKt = 56 } = {}) {
    return once(`takeoff-${rotateKt}-${climbKt}`, () => {
        const f = makeAircraft(), { model, object } = f;
        const startY = object.position.y;
        model.setFlapLevel(1);
        model.flaps = 1 / 3;
        model.throttle = 1;
        run(f, 90, { pilot: () => { model.controls.pitch = model.indicatedSpeed >= rotateKt * KT ? 0.6 : 0; }, until: () => !model.onGround });
        const groundRoll = Math.hypot(object.position.x, object.position.z);
        const liftoffKt = model.airspeed / KT;
        const hold = speedHold(f, climbKt * KT);
        const t = run(f, 60, { pilot: hold, until: () => object.position.y - startY >= 50 * FT });
        const toFifty = Math.hypot(object.position.x, object.position.z);
        return { groundRoll, toFifty, liftoffKt, reached: t < 60 && !model.crashed };
    });
}

// Taux de montée (ft/min) plein gaz à vitesse tenue, à une altitude donnée (m), après établissement
export function climbRate({ altitude = 0, speedKt = 75 } = {}) {
    return once(`climb-${altitude}-${speedKt}`, () => {
        const f = airborne(makeAircraft(), { altitude: altitude + 50, speed: speedKt * KT, throttle: 1 });
        const hold = speedHold(f, speedKt * KT);
        run(f, 60, { pilot: hold });
        const vs = average(f, 30, () => f.model.velocity.y, hold);
        const speed = average(f, 1, () => f.model.indicatedSpeed, hold) / KT;
        return { fpm: vs / FPM, speedKt: speed, crashed: f.model.crashed };
    });
}

// Vitesse maxi en palier (kt), plein gaz, altitude tenue au manche
export function maxLevelSpeed({ altitude = 300 } = {}) {
    return once(`vmax-${altitude}`, () => {
        const f = airborne(makeAircraft(), { altitude, speed: 55, throttle: 1 });
        const hold = altitudeHold(f, altitude);
        run(f, 150, { pilot: hold });
        const speed = average(f, 20, () => f.model.indicatedSpeed, hold) / KT;
        const drift = average(f, 1, () => f.object.position.y - altitude, hold);
        return { kt: speed, altitudeError: drift, crashed: f.model.crashed };
    });
}

// Vitesse de décrochage (kt indiqués), moteur réduit, altitude tenue : l'avion ralentit jusqu'au décrochage
export function stallSpeed({ flapLevel = 0 } = {}) {
    return once(`stall-${flapLevel}`, () => {
        const f = airborne(makeAircraft(), { altitude: 1000, speed: 70 * KT, throttle: 0 }), { model } = f;
        model.setFlapLevel(flapLevel);
        model.flaps = model.aircraft.flapLevels[flapLevel] / model.aircraft.flapLevels.at(-1);
        const hold = altitudeHold(f, 1000, { gain: 0.03, damping: 0.1 });
        let lastSpeed = model.indicatedSpeed;
        const t = run(f, 180, { pilot: () => { hold(); if (!model.stalled) lastSpeed = model.indicatedSpeed; }, until: () => model.stalled });
        return { kt: lastSpeed / KT, stalled: model.stalled, seconds: t, computedKt: model.stallSpeed() / KT };
    });
}

// Plané moteur réduit (hélice au ralenti) : finesse (distance / hauteur perdue) à une vitesse tenue
export function glideRatio(speedKt) {
    return once(`glide-${speedKt}`, () => {
        const f = airborne(makeAircraft(), { altitude: 2000, speed: speedKt * KT, throttle: 0 }), { object } = f;
        const hold = speedHold(f, speedKt * KT);
        run(f, 40, { pilot: hold });
        const start = object.position.clone();
        run(f, 40, { pilot: hold });
        const horizontal = Math.hypot(object.position.x - start.x, object.position.z - start.z);
        return horizontal / (start.y - object.position.y);
    });
}
export function bestGlide(speedsKt = [55, 60, 65, 70, 75, 80]) {
    return once('best-glide', () => {
        const results = speedsKt.map((kt) => ({ kt, ratio: glideRatio(kt) }));
        return results.reduce((best, r) => (r.ratio > best.ratio ? r : best));
    });
}

// Virage stabilisé et coordonné (bille au milieu, au palonnier) : inclinaison tenue aux ailerons, altitude tenue au
// manche, vitesse tenue aux gaz ; taux (°/s) et rayon (m)
export function turn(bankDeg, { speedKt = 100, altitude = 300 } = {}) {
    return once(`turn-${bankDeg}`, () => {
        const f = airborne(makeAircraft(), { altitude, speed: speedKt * KT, throttle: 0.75 });
        const pilot = combine(altitudeHold(f, altitude), speedWithThrottle(f, speedKt * KT), bankHold(f, bankDeg * Math.PI / 180), coordinate(f));
        run(f, 45, { pilot });
        let turned = 0, previous = attitude(f).heading, speedSum = 0, bankSum = 0, n = 0;
        run(f, 30, { pilot: (t) => {
            pilot(t);
            const { heading, bank } = attitude(f);
            turned += ((heading - previous + 540) % 360) - 180;
            previous = heading;
            speedSum += f.model.airspeed;
            bankSum += bank;
            n++;
        } });
        const rate = Math.abs(turned) / (n * DT);           // °/s
        const speed = speedSum / n;                          // m/s
        return { rateDegPerS: rate, radius: speed / (rate * Math.PI / 180), speedKt: speed / KT, bankDeg: bankSum / n * 180 / Math.PI, crashed: f.model.crashed };
    });
}
