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

// --- Vrille, en catégorie utilitaire : seule configuration où le POH 172P autorise les vrilles -----------------------
// Sources (POH Cessna 172P, édition 1981, relu sur ManualsLib le 18/11/2026) :
// - sect. 2, p. 2-7 et 2-8 : catégorie utilitaire, 2 100 lb au plus, centrage de 35,0 in (1 950 lb) à 36,5 in (2 100 lb)
//   vers l'avant, 40,5 in vers l'arrière ; vrilles approuvées, places arrière et soute vides, volets rentrés ;
// - sect. 4, p. 4-18 et 4-19 : entrée depuis un décrochage gaz réduits, manche amené progressivement plein arrière, pied à
//   fond dans le sens de la vrille juste avant la rupture, ailerons au neutre ; « jusqu'à 2 tours, rotation assez rapide
//   et assiette prononcée » ; sortie (gaz réduits, ailerons au neutre, pied à fond opposé, manche franchement vers l'avant,
//   tenus jusqu'à l'arrêt de la rotation) « en moins d'un quart de tour » ; « au moins 1 000 ft pour une vrille d'un tour
//   et sa sortie, un peu plus du double pour 6 tours » ; « au-delà de deux à trois tours, la vrille tend à se changer en
//   spirale, surtout à droite, avec une augmentation de la vitesse et du facteur de charge ».
// Mesuré au centrage avant (36,5 in) : passage en spirale (aile qui ne porte plus décrochée) au 5e tour à gauche, au 6e
// à droite. Non reproduit : « surtout à droite ». Au centrage arrière (40,5 in), la vrille reste décrochée 6 tours.
// Non sourcé, donc non testé : vitesse et taux de rotation en vrille (le modèle accélère dès le 2e tour, ~1,5 s par tour).
const LB = 0.45359237, IN = 0.0254;
const UTILITY = { mass: 2100 * LB, cgForward: 36.5 * IN };
const _omega = new Vector3();
function spin({ side, turns: held, mass = UTILITY.mass, cg = UTILITY.cgForward }) {
    const f = airborne(realistic(), { altitude: 2500, speed: 65 * KT, throttle: 0 }), { model, object } = f;
    model.mass = mass;
    model.cgOffset = cg - 1.0;   // (cgOffset : écart au centrage de référence du modèle, 1,0 m, voir simulator.js)
    model.trim = 0;
    const r = { perTurn: [], recoveryTurns: null, altitudeLost: null, maxLoad: 0, crashed: false, level: false };
    let phase = 'slow', stick = 0, turns = 0, tPare = null, turnsAtPare = 0, yEntry = null, current = null;
    const y0 = object.position.y;
    run(f, 180, { pilot: (t) => {
        const c = model.controls, a = attitude(f);
        _omega.copy(model._angularVelocity).applyQuaternion(object.quaternion);
        turns += _omega.y * DT / (2 * Math.PI) * side;   // tours du côté du pied (+ : à gauche pour side = 1)
        if (phase === 'slow') {
            // Palier gaz réduits, assiette qui monte doucement ; juste avant la rupture : manche plein arrière, pied à fond
            stick = Math.max(-1, Math.min(1, stick + DT * (0.08 * (y0 - object.position.y) - 0.15 * model.velocity.y)));
            Object.assign(c, { pitch: stick, roll: 0, yaw: 0 });
            if (t > 1 && (model.alpha > model.stallAlpha() - 1 / RAD || model.stalled)) { phase = 'spin'; turns = 0; yEntry = object.position.y; }
        } else if (phase === 'spin') {
            Object.assign(c, { pitch: 1, roll: 0, yaw: side });
            const k = Math.max(0, Math.floor(turns));
            if (current?.k !== k) { current = { k, n: 0, stalled: 0, pitch: 0, maxKias: 0, maxLoad: 0 }; r.perTurn.push(current); }
            current.n++; current.stalled += model.stalled ? 1 : 0; current.pitch += a.pitch * RAD;
            current.maxKias = Math.max(current.maxKias, model.indicatedSpeed / KT); current.maxLoad = Math.max(current.maxLoad, model.loadFactor);
            if (turns >= held) { phase = 'pare'; tPare = t; turnsAtPare = turns; }
        } else if (phase === 'pare') {
            Object.assign(c, { pitch: -0.5, roll: 0, yaw: -side });
            if (Math.abs(_omega.y) < 0.1 && t - tPare > 0.3) { phase = 'pullout'; r.recoveryTurns = turns - turnsAtPare; }
        } else if (phase === 'pullout') {
            // Ressource : ailes à plat, manche tiré à 30 %
            Object.assign(c, { pitch: 0.3, yaw: 0, roll: Math.max(-1, Math.min(1, -2 * a.bank)) });
            if (a.pitch > 0) { phase = 'done'; r.level = true; r.altitudeLost = (yEntry - object.position.y) / 0.3048; }
        }
        if (phase !== 'slow') r.maxLoad = Math.max(r.maxLoad, model.loadFactor);
    }, until: () => phase === 'done' });
    r.crashed = model.crashed;
    r.perTurn = r.perTurn.map((p) => ({ turn: p.k + 1, stalled: p.stalled / p.n, pitch: p.pitch / p.n, maxKias: p.maxKias, maxLoad: p.maxLoad }));
    return r;
}
const describe = (r) => r.perTurn.map((p) => `tour ${p.turn} : ${(p.stalled * 100).toFixed(0)} % décroché, assiette ${p.pitch.toFixed(0)}°, ${p.maxKias.toFixed(0)} KIAS, ${p.maxLoad.toFixed(1)} g`).join(' ; ');
const oneTurn = {};
for (const [label, side] of [['à gauche', 1], ['à droite', -1]]) {
    test(`vrille ${label}, catégorie utilitaire (2 100 lb, centrage avant 36,5 in) : 1 tour, sortie PARE en moins d'1/4 de tour, ~1 000 ft perdus (POH 172P p. 4-18)`, (t) => {
        const r = oneTurn[side] = spin({ side, turns: 1 });
        t.diagnostic(`${describe(r)} ; sortie en ${r.recoveryTurns?.toFixed(2)} tour ; ${r.altitudeLost?.toFixed(0)} ft perdus de l'entrée à la ressource`);
        assert.ok(r.level && !r.crashed, 'ressource jusqu\'à l\'assiette positive, sans crash');
        assert.ok(r.perTurn[0].stalled >= 0.8, `autorotation aile décrochée du côté du pied : ${(r.perTurn[0].stalled * 100).toFixed(0)} % du 1er tour`);
        assert.ok(r.recoveryTurns !== null && r.recoveryTurns < 0.25, `rotation arrêtée en ${r.recoveryTurns?.toFixed(2)} tour (POH : moins d'1/4)`);
        // POH : « au moins 1 000 ft » à prévoir : valeur de planification arrondie ; ±25 %, la ressource du banc d'essai
        // (manche à 30 %) n'est pas celle d'un pilote d'essai
        assert.ok(r.altitudeLost >= 750 && r.altitudeLost <= 1250, `${r.altitudeLost.toFixed(0)} ft perdus (POH : ~1 000 ft ±25 %)`);
    });
    test(`vrille prolongée ${label}, catégorie utilitaire, centrage avant : rotation rapide et assiette prononcée 2 tours, puis passage en spirale (vitesse et facteur de charge qui montent), sortie PARE (POH 172P p. 4-18, 4-19)`, (t) => {
        const r = spin({ side, turns: 6 });
        t.diagnostic(`${describe(r)} ; sortie en ${r.recoveryTurns?.toFixed(2)} tour ; ${r.altitudeLost?.toFixed(0)} ft perdus`);
        assert.ok(r.level && !r.crashed, 'ressource sans crash');
        const [first, second] = r.perTurn;
        assert.ok(first.stalled >= 0.8 && second.stalled >= 0.8, 'aile décrochée les deux premiers tours');
        assert.ok(second.pitch <= -40, `assiette prononcée au 2e tour : ${second.pitch.toFixed(0)}°`);
        const later = r.perTurn.slice(2);
        assert.ok(later.some((p) => p.stalled < 0.5), 'après 2 tours, passage en spirale : un tour où l\'aile ne porte plus décrochée');
        assert.ok(Math.max(...later.map((p) => p.maxKias)) > second.maxKias && Math.max(...later.map((p) => p.maxLoad)) > second.maxLoad, 'vitesse et facteur de charge qui augmentent');
        assert.ok(r.maxLoad <= 4.4, `facteur de charge max ${r.maxLoad.toFixed(1)} g (catégorie utilitaire : +4,4 g, POH p. 2-8)`);
        assert.ok(r.recoveryTurns !== null && Math.abs(r.recoveryTurns) < 0.25, `rotation arrêtée en ${r.recoveryTurns?.toFixed(2)} tour`);
        // POH : 6 tours et la sortie demandent « un peu plus du double » d'1 tour et sa sortie
        const ratio = r.altitudeLost / oneTurn[side].altitudeLost;
        assert.ok(ratio >= 2 && ratio <= 3, `${r.altitudeLost.toFixed(0)} ft, ${ratio.toFixed(2)} fois la vrille d'un tour (POH : un peu plus du double)`);
    });
}
