// Qualités de vol du modèle réaliste (js/RigidBodyModel.js), feuille de route lot 1 : modes propres comparés au modèle
// linéaire du Cessna 172 de l'UIUC au même point de vol (masse, vitesse vraie, altitude), spirale, lacet inverse, vrille.
// Le modèle simplifié (FlightModel.js) n'a pas de dynamique de tangage ni de lacet : ces tests ne le concernent pas.
//
// Tolérances (décision du 18/11/2026 : ζ ≥ 0,5 seul ne suffit pas). Le modèle réaliste n'est pas le modèle UIUC : il en
// reprend les dérivées de moment, mais a ses propres données, chacune sourcée (js/data/C172pAero.js, js/Cessna172.js) :
// - inerties du fichier JSBSim c172p plus le carburant et les occupants : roulis +27 %, tangage +2 %, lacet +10 % ;
// - polaire validée contre le POH 172P (pente de portance effective 4,9 au lieu de 5,14, CD0 0,032, k 0,06) ;
// - hélice à pas fixe (Propulsion.js) au lieu d'une traction constante ; souffle de l'hélice sur l'empennage.
// Ces écarts de données, passés dans le même modèle linéaire, déplacent les modes de 2 à 5 % (fréquences) et de 0,01
// (amortissements) ; le souffle sur l'empennage ajoute ~5 % à la fréquence de courte période. D'où : fréquences à ±15 %,
// amortissements à ±0,10 (courte période) et ±0,05 (roulis hollandais), période de phugoïde à ±10 %. L'amortissement de
// la phugoïde dépend de la loi de traction : entre « traction constante » (modèle UIUC) et « puissance constante »
// (hélice à pas fixe et régime à peu près constant : dérivée de la traction -T/V, amortissement × 1,5), avec 20 % de
// marge de chaque côté. L'identification (méthode de Prony) est vérifiée sur le modèle linéaire lui-même (≤ 1 %).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { makeAircraft, airborne, run, attitude, bankHold, KT, DT } from './helpers/flight.js';
import { linearModes, simulateLinear, identifyModes, oscillatoryNear, trimmedFlight, pulseResponse } from './helpers/modes.js';

const RAD = 180 / Math.PI;
const MASS = 1089;   // kg : 2 400 lb, masse maxi (celle du banc d'essai)
const realistic = () => makeAircraft({ model: 'realiste' });
const pct = (measured, reference) => `${measured.toFixed(3)} (UIUC ${reference.toFixed(3)}, ${((measured / reference - 1) * 100).toFixed(1)} %)`;

// Points de vol : approche-montée, croisière basse, croisière en altitude (vitesses tenues manche lâché par le trim)
const POINTS = [
    { label: '75 KTAS à 300 m', speed: 75 * KT, altitude: 300 },
    { label: '100 KTAS à 1 000 m', speed: 100 * KT, altitude: 1000 },
    { label: '110 KTAS à 2 500 m', speed: 110 * KT, altitude: 2500 },
];

test('identification des modes (Prony) : retrouve les valeurs propres du modèle linéaire UIUC à 1 % près', () => {
    const lin = linearModes({ mass: MASS, speed: 100 * KT, altitude: 1000 });
    const sp = oscillatoryNear(identifyModes(simulateLinear(lin.matrices.longitudinal, [0, 2, 0, 0], 3, 1), DT), lin.shortPeriod.wn);
    const ph = oscillatoryNear(identifyModes(simulateLinear(lin.matrices.longitudinal, [5, 0, 0, 0], 200, 0).filter((_, i) => i % 6 === 0), DT * 6), lin.phugoid.wn);
    const dr = oscillatoryNear(identifyModes(simulateLinear(lin.matrices.lateral, [0.05, 0, 0, 0], 10, 0), DT), lin.dutchRoll.wn);
    for (const [name, got, want] of [['courte période', sp, lin.shortPeriod], ['phugoïde', ph, lin.phugoid], ['roulis hollandais', dr, lin.dutchRoll]]) {
        assert.ok(Math.abs(got.wn / want.wn - 1) < 0.01, `${name} : ωn ${got.wn.toFixed(3)} au lieu de ${want.wn.toFixed(3)}`);
        assert.ok(Math.abs(got.zeta - want.zeta) < 0.01, `${name} : ζ ${got.zeta.toFixed(3)} au lieu de ${want.zeta.toFixed(3)}`);
    }
});

for (const point of POINTS) {
    test(`modes propres à ${point.label} : courte période, phugoïde et roulis hollandais comparés au modèle linéaire UIUC`, (t) => {
        const lin = linearModes({ mass: MASS, speed: point.speed, altitude: point.altitude });
        const flight = trimmedFlight(realistic, point);
        // Courte période : impulsion de profondeur de 0,2 s, incidence pendant 3 s
        const sp = pulseResponse(flight, { seconds: 3, pulse: 0.2, pilot: (f) => { f.model.controls.pitch = 0.3; }, read: (f) => f.model.alpha });
        const short = oscillatoryNear(identifyModes(sp.samples, DT), lin.shortPeriod.wn);
        // Phugoïde : impulsion de 1 s à piquer, vitesse pendant 200 s (échantillons toutes les 0,1 s)
        const ph = pulseResponse(flight, { seconds: 200, pulse: 1, pilot: (f) => { f.model.controls.pitch = -0.3; }, read: (f) => f.model.airspeed });
        const phugoid = oscillatoryNear(identifyModes(ph.samples.filter((_, i) => i % 6 === 0), DT * 6), lin.phugoid.wn);
        // Roulis hollandais : impulsion de direction de 0,3 s, dérapage pendant 10 s
        const dr = pulseResponse(flight, { seconds: 10, pulse: 0.3, pilot: (f) => { f.model.controls.yaw = 0.5; }, read: (f) => f.model.beta });
        const dutch = oscillatoryNear(identifyModes(dr.samples, DT), lin.dutchRoll.wn);
        assert.ok(!sp.crashed && !ph.crashed && !dr.crashed);
        assert.ok(short && phugoid && dutch, 'les trois modes sont oscillants');

        assert.ok(Math.abs(short.wn / lin.shortPeriod.wn - 1) <= 0.15, `courte période ωn ${pct(short.wn, lin.shortPeriod.wn)} rad/s : ±15 %`);
        assert.ok(Math.abs(short.zeta - lin.shortPeriod.zeta) <= 0.10, `courte période ζ ${pct(short.zeta, lin.shortPeriod.zeta)} : ±0,10`);
        assert.ok(Math.abs(phugoid.period / lin.phugoid.period - 1) <= 0.10, `phugoïde période ${pct(phugoid.period, lin.phugoid.period)} s : ±10 %`);
        const zetaLow = 0.8 * lin.phugoid.zeta, zetaHigh = 1.2 * 1.5 * lin.phugoid.zeta;
        assert.ok(phugoid.zeta >= zetaLow && phugoid.zeta <= zetaHigh, `phugoïde ζ ${pct(phugoid.zeta, lin.phugoid.zeta)} : entre ${zetaLow.toFixed(3)} et ${zetaHigh.toFixed(3)}`);
        assert.ok(Math.abs(dutch.wn / lin.dutchRoll.wn - 1) <= 0.15, `roulis hollandais ωn ${pct(dutch.wn, lin.dutchRoll.wn)} rad/s : ±15 %`);
        assert.ok(Math.abs(dutch.zeta - lin.dutchRoll.zeta) <= 0.05, `roulis hollandais ζ ${pct(dutch.zeta, lin.dutchRoll.zeta)} : ±0,05`);
        t.diagnostic(`courte période ωn ${pct(short.wn, lin.shortPeriod.wn)}, ζ ${pct(short.zeta, lin.shortPeriod.zeta)} ; phugoïde T ${pct(phugoid.period, lin.phugoid.period)}, ζ ${pct(phugoid.zeta, lin.phugoid.zeta)} ; roulis hollandais ωn ${pct(dutch.wn, lin.dutchRoll.wn)}, ζ ${pct(dutch.zeta, lin.dutchRoll.zeta)}`);
        // Feuille de route : courte période amortie en ~1 à 2 s ; phugoïde longue et peu amortie ; roulis hollandais amorti
        assert.ok(4 / (short.zeta * short.wn) <= 2.5, `courte période amortie à 2 % en ${(4 / (short.zeta * short.wn)).toFixed(2)} s`);
        assert.ok(phugoid.period >= 15 && phugoid.zeta <= 0.2, `phugoïde : ${phugoid.period.toFixed(1)} s, ζ ${phugoid.zeta.toFixed(3)}`);
        assert.ok(dutch.zeta >= 0.08, `roulis hollandais amorti : ζ ${dutch.zeta.toFixed(3)}`);
    });
}

// Spirale et roulis : 100 KTAS à 1 000 m, inclinaison prise aux ailerons puis ailerons lâchés (direction au neutre)
const cruise = { speed: 100 * KT, altitude: 1000 };
test('spirale : depuis 20° d\'inclinaison, manche lâché, pente de la spirale comparée au modèle linéaire UIUC (±0,01 /s)', (t) => {
    // Spirale : mode réel très lent, presque neutre (λ = -0,014 /s chez UIUC : l'inclinaison est divisée par 2 en ~50 s).
    // λ est une petite différence (Clβ·Cnr - Clr·Cnβ) : tolérance absolue de 0,01 /s, et moyenne des deux côtés (le couple
    // de l'hélice et le calage des ailes ajoutent un roulis qui n'existe pas dans le modèle linéaire). La feuille de route
    // demandait « neutre à légèrement instable, ne se redresse plus seule depuis 45° » : les données UIUC (Roskam) donnent
    // une spirale stable, à peine ; le modèle suit les données (voir docs/feuille-de-route.md, lot 1)
    const lin = linearModes({ mass: MASS, ...cruise });
    const flight = trimmedFlight(realistic, cruise);
    const lambdas = [];
    for (const side of [1, -1]) {
        const f = flight.make(), hold = bankHold(f, side * 20 / RAD);
        run(f, 8, { pilot: hold });
        const b0 = Math.abs(attitude(f).bank);
        run(f, 40, { pilot: () => { f.model.controls.roll = 0; } });
        const b1 = Math.abs(attitude(f).bank);
        assert.ok(!f.model.crashed && b1 < 2 * b0, `côté ${side > 0 ? 'gauche' : 'droit'} : ${(b0 * RAD).toFixed(1)}° -> ${(b1 * RAD).toFixed(1)}°`);
        lambdas.push(Math.log(b1 / b0) / 40);
    }
    const lambda = (lambdas[0] + lambdas[1]) / 2;
    t.diagnostic(`spirale λ ${lambda.toFixed(4)} /s (gauche ${lambdas[0].toFixed(4)}, droite ${lambdas[1].toFixed(4)}), UIUC ${lin.spiral.lambda.toFixed(4)}`);
    assert.ok(Math.abs(lambda - lin.spiral.lambda) <= 0.01, `spirale λ ${lambda.toFixed(4)} /s (gauche ${lambdas[0].toFixed(4)}, droite ${lambdas[1].toFixed(4)} ; UIUC ${lin.spiral.lambda.toFixed(4)})`);
});

test('roulis : constante de temps de la réponse aux ailerons comparée au modèle linéaire UIUC (±40 % : inertie de roulis +27 %)', (t) => {
    const lin = linearModes({ mass: MASS, ...cruise });
    const flight = trimmedFlight(realistic, cruise);
    const f = flight.make(), rates = [];
    run(f, 1.5, { pilot: () => { f.model.controls.roll = -0.3; rates.push(-f.model._angularVelocity.z); } });
    // Vitesse de roulis : premier ordre p(t) = p∞ (1 - e^(-t/τ)) ; τ = temps pour atteindre 63 % du maximum
    const peak = Math.max(...rates), i63 = rates.findIndex((p) => p >= 0.632 * peak);
    const tau = (i63 + 1) * DT;
    t.diagnostic(`τ roulis ${pct(tau, lin.roll.tau)} s`);
    assert.ok(Math.abs(tau / lin.roll.tau - 1) <= 0.4, `τ roulis ${pct(tau, lin.roll.tau)} s`);
});

test('lacet inverse : ailerons seuls à droite à 65 KIAS, le nez part d\'abord à gauche pendant que l\'avion s\'incline à droite', (t) => {
    const flight = trimmedFlight(realistic, { speed: 66 * KT, altitude: 300 });
    const f = flight.make();
    const h0 = attitude(f).heading;
    let minHeading = 0, bankRight = 0;
    run(f, 1.5, { pilot: () => {
        f.model.controls.roll = -1;
        f.model.controls.yaw = 0;
        const a = attitude(f);
        minHeading = Math.min(minHeading, ((a.heading - h0 + 540) % 360) - 180);
        bankRight = -a.bank * RAD;
    } });
    t.diagnostic(`inclinaison ${bankRight.toFixed(1)}° à droite en 1,5 s, nez jusqu'à ${minHeading.toFixed(2)}° à gauche`);
    assert.ok(bankRight > 10, `inclinaison à droite après 1,5 s : ${bankRight.toFixed(1)}°`);
    assert.ok(minHeading < -0.5, `le nez part à gauche (lacet inverse) : cap ${minHeading.toFixed(2)}° au plus à gauche`);
});

// --- Vrille (POH 172P sect. 4, « Spins », non relu : manche plein arrière et pied à fond au décrochage ; sortie : gaz
// réduits, ailerons au neutre, pied à fond opposé, manche franchement vers l'avant, puis ressource) ---------------------
const _omega = new Vector3();
function spin({ side, turnsBeforeRecovery = 1 }) {
    const f = airborne(realistic(), { altitude: 2000, speed: 65 * KT, throttle: 0 }), { model, object } = f;
    model.trim = 0;
    const r = { stallSpeed: null, entryTurns: 0, entryTime: null, recoveryTurns: null, recoveryTime: null, altitudeLost: null, maxSpeed: 0, crashed: false, level: false };
    let phase = 'slow', stick = 0, turns = 0, tStall = null, tPare = null, turnsAtPare = 0, y0 = object.position.y, yPare = null;
    run(f, 120, { pilot: (t) => {
        const c = model.controls, a = attitude(f);
        _omega.copy(model._angularVelocity).applyQuaternion(object.quaternion);
        turns += _omega.y * DT / (2 * Math.PI) * side;   // tours du côté du pied (+ : à gauche pour side = 1)
        if (phase === 'slow') {
            // Palier gaz réduits : l'assiette monte doucement (~1 kt/s), jusqu'au décrochage
            stick = Math.max(-1, Math.min(1, stick + DT * (0.08 * (y0 - object.position.y) - 0.15 * model.velocity.y)));
            Object.assign(c, { pitch: stick, roll: 0, yaw: 0 });
            if (model.stalled) { phase = 'spin'; tStall = t; turns = 0; r.stallSpeed = model.indicatedSpeed / KT; }
        } else if (phase === 'spin') {
            Object.assign(c, { pitch: 1, roll: 0, yaw: side });
            if (turns >= turnsBeforeRecovery) { phase = 'pare'; tPare = t; turnsAtPare = turns; yPare = object.position.y; r.entryTime = t - tStall; }
        } else if (phase === 'pare') {
            Object.assign(c, { pitch: -0.5, roll: 0, yaw: -side });
            if (Math.abs(_omega.y) < 0.1 && t - tPare > 0.3) { phase = 'pullout'; r.recoveryTime = t - tPare; r.recoveryTurns = turns - turnsAtPare; }
        } else if (phase === 'pullout') {
            Object.assign(c, { pitch: 0.3, yaw: 0, roll: Math.max(-1, Math.min(1, -2 * a.bank)) });
            if (a.pitch > 0) { phase = 'done'; r.level = true; r.altitudeLost = yPare - object.position.y; }
        }
        if (phase !== 'slow') r.maxSpeed = Math.max(r.maxSpeed, model.indicatedSpeed / KT);
    }, until: () => phase === 'done' });
    r.crashed = model.crashed;
    r.entryTurns = turnsAtPare;
    return r;
}
for (const [label, side] of [['à gauche', 1], ['à droite', -1]]) {
    test(`vrille ${label} : autorotation au décrochage avec le pied à fond, sortie par PARE en moins d'un tour, ressource sous la VNE`, (t) => {
        const r = spin({ side });
        t.diagnostic(`décrochage ${r.stallSpeed?.toFixed(0)} KIAS, 1 tour en ${r.entryTime?.toFixed(1)} s, arrêt ${r.recoveryTime?.toFixed(1)} s après PARE (${r.recoveryTurns?.toFixed(2)} tour), perte ${r.altitudeLost?.toFixed(0)} m, vitesse max ${r.maxSpeed.toFixed(0)} KIAS`);
        assert.ok(r.stallSpeed !== null && r.stallSpeed < 60, `décrochage gaz réduits à ${r.stallSpeed?.toFixed(0)} KIAS`);
        assert.ok(r.entryTime !== null && r.entryTime < 10, `un tour d'autorotation du côté du pied en ${r.entryTime?.toFixed(1)} s`);
        assert.ok(r.recoveryTurns !== null && r.recoveryTurns < 1, `rotation arrêtée ${r.recoveryTime?.toFixed(1)} s après PARE, ${r.recoveryTurns?.toFixed(2)} tour de plus`);
        assert.ok(r.level && !r.crashed, 'ressource jusqu\'à l\'assiette positive, sans crash');
        assert.ok(r.maxSpeed < 158, `vitesse max ${r.maxSpeed.toFixed(0)} KIAS < VNE 158 KIAS (POH 172P sect. 2, non relu)`);
    });
}
// Chantier identifié (feuille de route, lot 1, reste à faire) : la vrille ne s'établit pas. Après ~1 tour, le nez plonge
// (assiette -60 à -80°), l'incidence retombe vers 13° et la vitesse monte au-delà de 90 KIAS : un piqué en spirale, pas
// une vrille, où la vitesse reste basse et stable
test.todo('vrille établie : 3 tours avec une vitesse indiquée stable sous 70 KIAS et une incidence au-dessus de 20°');
