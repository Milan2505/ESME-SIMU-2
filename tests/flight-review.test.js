// Relevé automatique des écarts (lot 5, js/FlightReview.js) : vols synthétiques au format de js/FlightRecorder.js,
// sans modèle de vol ; piste synthétique : seuil à l'origine, atterrissage vers -z, gauche vers -x, point
// d'aboutissement à 240 m
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { review, episodes, runwayFor, aimOffset, vfeFor, finalSegments, THRESHOLDS } from '../js/FlightReview.js';
import { approachGuide } from '../js/Debriefing.js';

const RUNWAY = {
    name: '36', threshold: { x: 0, z: 0 }, direction: { x: 0, z: -1 }, left: { x: -1, z: 0 },
    aimPoint: { x: 0, z: -240 }, length: 1000,
};
const CONTEXT = { runways: [RUNWAY] };

// Échantillon de base : en vol, stable, 1 000 ft, 100 kt, ailes à plat
const BASE = {
    x: 0, y: 300, z: 2000, qx: 0, qy: 0, qz: 0, qw: 1, ias: 100, tas: 100, gs: 100, alt: 1000, agl: 1000, aal: 1000,
    vs: 0, hdg: 360, bank: 0, pitch: 0, alpha: 3, load: 1, pitchIn: 0, rollIn: 0, yawIn: 0, brake: 0, throttle: 0.7,
    rpm: 2300, flaps: 0, trim: 0, gear: 1, ground: 0, stall: 0, loc: null, gsDev: null, speedbrake: 0, rotor: 0,
    phase: 'vol',
};

// Vol de durée seconds à 10 échantillons/s ; at(t) rend les champs qui changent
function flight(seconds, at = () => ({}), events = [], aircraft = 'c172') {
    const samples = [];
    for (let i = 0; i <= seconds * 10; i++) {
        const t = i / 10;
        samples.push({ ...BASE, t, ...at(t) });
    }
    return { meta: { aircraft, map: 'campagne', airport: 'ESME', started: 0, duration: seconds }, samples, events };
}

// Finale stabilisée : dans l'axe, de 1 000 m à 10 m avant le seuil (33 m/s), de 520 ft à 70 ft en 30 s, 65 kt volets 30°
const final = (t) => ({ x: 0, z: 1000 - 33 * t, aal: 520 - 15 * t, agl: 520 - 15 * t, vs: -900, ias: 65, flaps: 30,
    throttle: 0.2 });
const kinds = (list) => list.map((f) => f.kind);

test('vol sans écart : rien à relever', () => {
    assert.deepEqual(review(flight(60), CONTEXT), []);
    assert.deepEqual(review(flight(30, final), CONTEXT), []);
    assert.deepEqual(review({}), []);
});

test('episodes : suites tenues assez longtemps, durée jusqu\'au premier échantillon faux', () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({ t: i / 10, v: (i >= 10 && i < 25) || i >= 45 ? 1 : 0 }));
    assert.deepEqual(episodes(samples, (s) => s.v, 1), [{ t0: 1, t1: 2.5, i0: 10, i1: 24 }]);
    const all = episodes(samples, (s) => s.v, 0);
    assert.equal(all.length, 2);
    assert.equal(all[1].t0, 4.5);
    assert.equal(all[1].i1, 49);
    assert.deepEqual(episodes([], () => true, 0), []);
});

test('runwayFor et aimOffset : piste du point, long et à gauche positifs', () => {
    assert.deepEqual(aimOffset({ x: -3, z: -300 }, RUNWAY), { along: 60, lateral: 3 });
    assert.equal(runwayFor({ x: 0, z: -400 }, [RUNWAY]), RUNWAY);
    assert.equal(runwayFor({ x: 0, z: 250 }, [RUNWAY]), RUNWAY);            // 250 m avant le seuil : encore la piste
    assert.equal(runwayFor({ x: 0, z: 350 }, [RUNWAY]), null);              // trop loin avant le seuil
    assert.equal(runwayFor({ x: 150, z: -400 }, [RUNWAY]), null);           // à côté
    assert.equal(runwayFor({ x: 0, z: -1100 }, [RUNWAY]), null);            // au-delà du bout
    assert.equal(runwayFor({ x: 0, z: 0 }, []), null);
    const other = { ...RUNWAY, name: '18', threshold: { x: 0, z: -1000 }, direction: { x: 0, z: 1 }, left: { x: 1, z: 0 },
        aimPoint: { x: 0, z: -760 } };
    assert.equal(runwayFor({ x: 0, z: -800 }, [RUNWAY, other]), other);     // seuil le plus proche
});

test('vfeFor : 110 kt jusqu\'à 10°, 85 kt au-delà, rien volets rentrés', () => {
    assert.equal(vfeFor(0), Infinity);
    assert.equal(vfeFor(10), 110);
    assert.equal(vfeFor(20), 85);
    assert.equal(vfeFor(30), 85);
});

test('chaque seuil a sa valeur documentée', () => {
    assert.equal(THRESHOLDS.bankLow.bank, 30);
    assert.equal(THRESHOLDS.aim.aimingPoint, 240);
    assert.equal(THRESHOLDS.touchdown.crashSink, 6);
    assert.equal(THRESHOLDS.vne.ias, 158);   // POH 172P (163 : 172R/S)
    // Sourcés (lot 6) : ACS FAA-S-ACS-6C, ACS IR FAA-S-ACS-8C, FSF BN 7.1, 14 CFR 23
    assert.deepEqual([THRESHOLDS.approach.above, THRESHOLDS.approach.below], [10, 5]);    // ACS PA.IV.B.S7
    assert.equal(THRESHOLDS.approach.gate, 500);                                           // FSF, VMC
    assert.equal(THRESHOLDS.approach.maxSink, 1000);                                       // FSF, critère 5
    assert.equal(THRESHOLDS.final.maxHeight, 1000);                                        // FSF, IMC
    assert.equal(THRESHOLDS.aim.beyondNormal, 122);                                        // 400 ft, ACS PA.IV.B.S10
    assert.equal(THRESHOLDS.aim.beyondShort, 61);                                          // 200 ft, ACS PA.IV.F.S10
    assert.equal(THRESHOLDS.aim.short, 0);                                                 // « on or beyond »
    assert.deepEqual([THRESHOLDS.ils.warn, THRESHOLDS.ils.severe], [0.5, 0.75]);           // FSF un point, IR.VI.B.S12 ¾
    assert.equal(THRESHOLDS.stall.severeBelow, 1500);                                      // ACS PA.VII.B.S2 / C.S2
    assert.deepEqual([THRESHOLDS.load.max, THRESHOLDS.load.min, THRESHOLDS.load.maxFlaps], [3.8, -1.52, 3.0]);
    assert.equal(THRESHOLDS.touchdown.severe, 510);                                        // 23.473(d), non relu
});

test('finale repérée par la géométrie : alignée et en descente vers le seuil', () => {
    const OTHER = { ...RUNWAY, name: '18', threshold: { x: 0, z: -1000 }, direction: { x: 0, z: 1 }, left: { x: 1, z: 0 },
        aimPoint: { x: 0, z: -760 } };
    const both = [RUNWAY, OTHER];
    // Vraie finale alignée : un segment, piste 36, jusqu'au seuil
    const segs = finalSegments(flight(30, final).samples, both);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].runway, RUNWAY);
    assert.ok(segs[0].t0 <= 0.2 && segs[0].t1 >= 29.9, `${segs[0].t0} -> ${segs[0].t1}`);
    // Dérive de vent de travers : cap décalé de 15°, route dans l'axe : finale quand même
    assert.equal(finalSegments(flight(30, (t) => ({ ...final(t), hdg: 15 })).samples, both).length, 1);
    // Ondulation en montée sous 500 ft : montée initiale après la 36, au-delà du bout de piste, une descente de
    // 300 ft/min à 400 ft, 85 kt : ni finale ni écart de vitesse d'approche (l'ancien critère « sous 500 ft en descente »
    // la comptait)
    const climb = flight(30, (t) => ({ x: 0, z: -1100 - 38 * t, aal: 300 + 6 * t, agl: 300 + 6 * t, ias: 85, flaps: 0,
        vs: t > 10 && t < 20 ? -300 : 400 }));
    assert.deepEqual(finalSegments(climb.samples, both), []);
    assert.deepEqual(review(climb, { runways: both }), []);
    // Décalée de l'axe : 1 000 m à droite de l'axe à 1 à 2 km du seuil (hors du cône de 10° + 100 m)
    assert.deepEqual(finalSegments(flight(30, (t) => ({ ...final(t), x: 1000, z: 2000 - 33 * t })).samples, both), []);
    // Au bord du cône : 100 m + 1 500 m × tan 10° ≈ 364 m ; 350 m passe, 380 m non
    const offset = (x) => finalSegments(flight(10, (t) => ({ ...final(t), x, z: 1550 - 10 * t })).samples, [RUNWAY]).length;
    assert.equal(offset(350), 1);
    assert.equal(offset(380), 0);
    // S'éloignant du seuil (en descente) : pas de finale ; en travers de l'axe (route à 90°) non plus
    assert.deepEqual(finalSegments(flight(30, (t) => ({ ...final(t), z: 10 + 33 * t })).samples, both), []);
    assert.deepEqual(finalSegments(flight(10, (t) => ({ ...final(t), x: -150 + 30 * t, z: 1500 })).samples, both), []);
    // Route à 25° de l'axe : finale ; à 35° : non (±30°)
    const track = (deg) => finalSegments(flight(10, (t) => ({ ...final(t), x: -33 * t * Math.sin(deg * Math.PI / 180),
        z: 1500 - 33 * t * Math.cos(deg * Math.PI / 180) })).samples, [RUNWAY]).length;
    assert.equal(track(25), 1);
    assert.equal(track(35), 0);
    // Au-dessus de 1 000 ft, au-delà de 5 NM, en palier, au sol : pas de finale
    assert.deepEqual(finalSegments(flight(10, (t) => ({ ...final(t), aal: 1100 })).samples, both), []);
    assert.deepEqual(finalSegments(flight(10, (t) => ({ ...final(t), z: 9700 - 33 * t })).samples, both), []);
    assert.deepEqual(finalSegments(flight(10, (t) => ({ ...final(t), vs: 0 })).samples, both), []);
    assert.deepEqual(finalSegments(flight(10, (t) => ({ ...final(t), ground: 1 })).samples, both), []);
    // Sans pistes (carte Mer, vol d'une autre carte) : pas de finale, pas de vitesse d'approche
    assert.deepEqual(finalSegments(flight(30, final).samples, []), []);
    assert.deepEqual(review(flight(30, (t) => ({ ...final(t), ias: 84 })), { runways: [] }), []);
    // Moins de 3 s : pas de finale
    assert.deepEqual(finalSegments(flight(30, (t) => ({ ...final(t), vs: t > 10 && t < 12 ? -500 : 0 })).samples, both), []);
});

test('Debriefing.approachGuide : bande « Finale » sur les finales géométriques seulement', () => {
    const guide = approachGuide(flight(30, final), [RUNWAY]);
    assert.equal(guide.bands.length, 1);
    assert.equal(guide.bands[0].label, 'Finale');
    assert.deepEqual(guide.limits.map((l) => l.value), [65, 75, 60]);
    assert.deepEqual(approachGuide(flight(30, final)), { bands: [], limits: [] });             // sans pistes
    const climb = flight(30, (t) => ({ x: 0, z: -1100 - 38 * t, aal: 300 + 6 * t, vs: -300 }));
    assert.deepEqual(approachGuide(climb, [RUNWAY]), { bands: [], limits: [] });
    assert.deepEqual(approachGuide(flight(30, final, [], 'f15'), [RUNWAY]), { bands: [], limits: [] });
});

test('vitesse d\'approche : trop rapide et trop lente en finale, un écart par épisode', () => {
    const fast = review(flight(30, (t) => ({ ...final(t), ias: t > 5 && t < 12 ? 80 + (t > 8 ? 2 : 0) : 65 })), CONTEXT);
    assert.deepEqual(kinds(fast), ['approach-speed']);
    assert.equal(fast[0].value, 82);
    assert.equal(fast[0].limit, 75);
    assert.match(fast[0].message, /trop rapide/);
    assert.ok(Math.abs(fast[0].t - 5.1) < 0.01);
    const slow = review(flight(30, (t) => ({ ...final(t), ias: t > 10 && t < 15 ? 58 : 65 })), CONTEXT);
    assert.deepEqual(kinds(slow), ['approach-speed']);
    assert.equal(slow[0].limit, 60);
    // Volets 10° : cible 70 kt, 74 kt passe
    assert.deepEqual(review(flight(30, (t) => ({ ...final(t), flaps: 10, ias: 74 })), CONTEXT), []);
    // Moins de 3 s : rien ; au-dessus de 500 ft ou en palier : rien
    assert.deepEqual(review(flight(30, (t) => ({ ...final(t), ias: t > 5 && t < 7 ? 85 : 65 })), CONTEXT), []);
    assert.deepEqual(review(flight(30, () => ({ aal: 800, agl: 800, vs: -500, ias: 90 })), CONTEXT), []);
    assert.deepEqual(review(flight(30, (t) => ({ ...final(t), vs: 0, ias: 80 })), CONTEXT), []);
    // F-15 : pas de vitesse d'approche
    assert.deepEqual(review(flight(30, (t) => ({ ...final(t), ias: 140 }), [], 'f15'), CONTEXT), []);
    // Limites +10 / -5 kt (ACS PA.IV.B.S7 p. 20) : 75 et 60 kt passent, 76 et 59 kt non
    const at = (ias) => kinds(review(flight(30, (t) => ({ ...final(t), ias })), CONTEXT));
    assert.deepEqual(at(75), []);
    assert.deepEqual(at(76), ['approach-speed']);
    assert.deepEqual(at(60), []);
    assert.deepEqual(at(59), ['approach-speed']);
    // Au-dessus de la porte de 500 ft (FSF BN 7.1, VMC), en finale : vitesse libre
    assert.deepEqual(review(flight(20, (t) => ({ ...final(t), aal: 900 - 15 * t, ias: 84 })), CONTEXT), []);
});

test('vario en finale : pas plus de 1 000 ft/min sous la porte de 500 ft (FSF BN 7.1)', () => {
    assert.deepEqual(review(flight(30, (t) => ({ ...final(t), vs: -1000 })), CONTEXT), []);
    const sink = review(flight(30, (t) => ({ ...final(t), vs: t > 10 && t < 15 ? -1100 : -900 })), CONTEXT);
    assert.deepEqual(kinds(sink), ['approach-sink']);
    assert.equal(sink[0].value, 1100);
    assert.equal(sink[0].limit, 1000);
    // Au-dessus de la porte ou sans pistes : rien
    assert.deepEqual(review(flight(20, (t) => ({ ...final(t), aal: 990 - 20 * t, vs: -1200 })), CONTEXT), []);
    assert.deepEqual(review(flight(30, (t) => ({ ...final(t), vs: -1500 }))), []);
});

test('inclinaison au-delà de 30° sous 500 ft, au-dessus de 30 ft, tenue 1 s', () => {
    const steep = review(flight(10, (t) => ({ agl: 400, aal: 400, bank: t > 2 && t < 5 ? -40 : 0 })), CONTEXT);
    assert.deepEqual(kinds(steep), ['bank-low']);
    assert.equal(steep[0].value, 40);
    assert.equal(steep[0].severity, 'warn');
    // Hauteur retenue : la plus petite de agl et aal
    assert.equal(review(flight(10, () => ({ agl: 900, aal: 300, bank: 35 })), CONTEXT).length, 1);
    assert.deepEqual(review(flight(10, () => ({ agl: 600, aal: 600, bank: 45 })), CONTEXT), []);
    assert.deepEqual(review(flight(10, () => ({ agl: 20, aal: 20, bank: 45 })), CONTEXT), []);
    assert.deepEqual(review(flight(10, (t) => ({ agl: 300, aal: 300, bank: t < 0.5 ? 45 : 0 })), CONTEXT), []);
    // R44 aussi
    assert.deepEqual(kinds(review(flight(10, () => ({ agl: 200, aal: 200, bank: 35 }), [], 'r44'))), ['bank-low']);
});

// Toucher au point d'aboutissement, dans l'axe, gaz réduits
const touch = (t, extra = {}) => ({ t, kind: 'touchdown', text: 'Toucher', x: 0, z: -240, impact: 0.5, throttle: 0.05, ...extra });

test('toucher : vitesse verticale, rebonds regroupés (le plus fort compte)', () => {
    assert.deepEqual(review(flight(10, () => ({}), [touch(5)]), CONTEXT), []);                  // ~100 ft/min
    const firm = review(flight(10, () => ({}), [touch(5, { impact: 2 })]), CONTEXT);            // ~390 ft/min
    assert.deepEqual(kinds(firm), ['touchdown-vs']);
    assert.equal(firm[0].severity, 'warn');
    assert.equal(firm[0].value, 390);
    const bounced = review(flight(10, () => ({}), [touch(5, { impact: 1 }), touch(6.2, { impact: 4 })]), CONTEXT);
    assert.deepEqual(kinds(bounced), ['touchdown-vs']);
    assert.equal(bounced[0].t, 5);
    assert.equal(bounced[0].severity, 'severe');
    assert.match(bounced[0].message, /rebond/);
    const broken = review(flight(10, () => ({}), [touch(5, { impact: 7 })]), CONTEXT);
    assert.match(broken[0].message, /train ne tient pas/);
    // Deux atterrissages séparés : deux relevés
    assert.equal(review(flight(60, () => ({}), [touch(5, { impact: 2 }), touch(50, { impact: 2 })]), CONTEXT).length, 2);
    // R44 et F-15 : vitesse verticale seulement
    assert.deepEqual(kinds(review(flight(10, () => ({}), [touch(5, { impact: 2, z: 500, throttle: 1 })], 'r44'), CONTEXT)),
        ['touchdown-vs']);
    // Sans impact dans l'événement : vitesse verticale enregistrée juste avant
    const noImpact = review(flight(10, (t) => ({ vs: t > 4 && t <= 5 ? -700 : 0 }), [touch(5, { impact: undefined })]), CONTEXT);
    assert.equal(noImpact[0].severity, 'severe');
    // Limites : 300 ft/min (non relu), 510 ft/min (ancien 14 CFR 23.473(d), non relu)
    const atFpm = (fpm) => review(flight(10, () => ({}), [touch(5, { impact: fpm * 0.3048 / 60 })]), CONTEXT);
    assert.deepEqual(atFpm(300), []);
    assert.equal(atFpm(310)[0].severity, 'warn');
    assert.equal(atFpm(510)[0].severity, 'warn');
    assert.equal(atFpm(520)[0].severity, 'severe');
    assert.equal(atFpm(520)[0].limit, 510);
});

test('toucher : point d\'aboutissement, axe, hors piste, gaz', () => {
    const long = review(flight(10, () => ({}), [touch(5, { z: -400 })]), CONTEXT);
    assert.deepEqual(kinds(long), ['touchdown-aim']);
    assert.equal(long[0].value, 160);
    assert.match(long[0].message, /long/);
    const short = review(flight(10, () => ({}), [touch(5, { z: -100 })]), CONTEXT);
    assert.equal(short[0].severity, 'warn');
    assert.match(short[0].message, /court/);
    const before = review(flight(10, () => ({}), [touch(5, { z: 50 })]), CONTEXT);
    assert.equal(before[0].severity, 'severe');
    assert.match(before[0].message, /avant le seuil/);
    assert.deepEqual(review(flight(10, () => ({}), [touch(5, { z: -290 })]), CONTEXT), []);     // 50 m long : bon
    // Fenêtre de l'ACS (PA.IV.B.S10 p. 20) : sur le point ou jusqu'à 400 ft (122 m) au-delà
    assert.deepEqual(review(flight(10, () => ({}), [touch(5, { z: -362 })]), CONTEXT), []);     // 122 m long : bon
    const justLong = review(flight(10, () => ({}), [touch(5, { z: -365 })]), CONTEXT);
    assert.deepEqual(kinds(justLong), ['touchdown-aim']);
    assert.equal(justLong[0].limit, 122);
    const justShort = review(flight(10, () => ({}), [touch(5, { z: -235 })]), CONTEXT);         // 5 m avant le point
    assert.deepEqual(kinds(justShort), ['touchdown-aim']);
    assert.match(justShort[0].message, /court/);
    assert.equal(justShort[0].limit, 0);
    const lateral = review(flight(10, () => ({}), [touch(5, { x: 8 })]), CONTEXT);
    assert.deepEqual(kinds(lateral), ['touchdown-lateral']);
    assert.match(lateral[0].message, /à droite/);
    const off = review(flight(10, () => ({}), [touch(5, { x: 300 })]), CONTEXT);
    assert.deepEqual(kinds(off), ['touchdown-aim']);
    assert.equal(off[0].severity, 'info');
    assert.match(off[0].message, /hors piste/);
    // Sans pistes (porte-avions) : pas de point d'aboutissement
    assert.deepEqual(review(flight(10, () => ({}), [touch(5, { x: 300 })])), []);
    const power = review(flight(10, () => ({}), [touch(5, { throttle: 0.6 })]), CONTEXT);
    assert.deepEqual(kinds(power), ['throttle-touchdown']);
    assert.equal(power[0].severity, 'info');
});

test('ILS sous 1 000 ft : demi-échelle (un point FSF) tenue 2 s, remise de gaz au-delà de ¾ d\'échelle (IR.VI.B.S12)', () => {
    const ils = (loc, gsDev) => (t) => ({ ...final(t), loc: t > 5 && t < 9 ? loc : 0, gsDev: t > 5 && t < 9 ? gsDev : 0 });
    assert.deepEqual(review(flight(30, ils(0.1, -0.15)), CONTEXT), []);
    assert.deepEqual(review(flight(30, ils(0.5, -0.5)), CONTEXT), []);                         // à la limite : bon
    const warn = review(flight(30, ils(0.55, 0)), CONTEXT);
    assert.deepEqual(kinds(warn), ['ils-loc']);
    assert.equal(warn[0].severity, 'warn');
    assert.match(warn[0].message, /à gauche/);
    assert.equal(review(flight(30, ils(0, 0.75)), CONTEXT)[0].severity, 'warn');
    const severe = review(flight(30, ils(0, 0.8)), CONTEXT);
    assert.deepEqual(kinds(severe), ['ils-gs']);
    assert.equal(severe[0].severity, 'severe');
    assert.match(severe[0].message, /trop bas/);
    // Au-dessus de 1 000 ft ou sans ILS (null) : rien
    assert.deepEqual(review(flight(10, () => ({ aal: 1500, loc: 0.8, gsDev: 0.8 })), CONTEXT), []);
    // Remise de gaz (aux minimums) : en montée, l'avion quitte le plan par le haut, ce n'est pas un écart ILS
    const goAround = (t) => (t < 5 ? { ...final(t), loc: 0, gsDev: 0 } : { ...final(5), aal: 445 + 10 * (t - 5), vs: 600, ias: 76, loc: 0.1, gsDev: -0.9 });
    assert.deepEqual(review(flight(20, goAround), CONTEXT).filter((f) => f.kind.startsWith('ils')), []);
    assert.deepEqual(review(flight(30, final), CONTEXT), []);
    // Moins de 2 s : rien
    assert.deepEqual(review(flight(30, (t) => ({ ...final(t), loc: t > 5 && t < 6 ? 0.8 : 0, gsDev: 0 })), CONTEXT), []);
});

test('VFE, VNE, facteur de charge', () => {
    const vfe = review(flight(10, (t) => ({ flaps: 20, ias: t > 2 && t < 5 ? 95 : 80 })), CONTEXT);
    assert.deepEqual(kinds(vfe), ['vfe']);
    assert.equal(vfe[0].limit, 85);
    assert.deepEqual(review(flight(10, () => ({ flaps: 10, ias: 100 })), CONTEXT), []);
    assert.deepEqual(review(flight(10, () => ({ flaps: 0, ias: 150 })), CONTEXT), []);
    const vne = review(flight(10, (t) => ({ ias: t > 2 && t < 4 ? 170 : 120 })), CONTEXT);
    assert.deepEqual(kinds(vne), ['vne']);
    assert.equal(vne[0].severity, 'severe');
    const load = review(flight(10, (t) => ({ load: t > 3 && t < 3.6 ? 4.2 : 1 })), CONTEXT);
    assert.deepEqual(kinds(load), ['load']);
    assert.match(load[0].message, /4,2 g/);
    assert.equal(review(flight(10, (t) => ({ load: t > 3 && t < 3.6 ? -2 : 1 })), CONTEXT)[0].limit, -1.52);
    assert.deepEqual(review(flight(10, (t) => ({ load: t > 3 && t < 3.15 ? 4.2 : 1 })), CONTEXT), []);
    // Limites : +3,8 g volets rentrés, +3,0 g volets sortis (POH 172P p. 2-8)
    const loadAt = (load, flaps) => review(flight(10, (t) => ({ flaps, ias: 80, load: t > 3 && t < 4 ? load : 1 })), CONTEXT);
    assert.deepEqual(loadAt(3.8, 0), []);
    assert.equal(loadAt(3.9, 0)[0].limit, 3.8);
    assert.deepEqual(loadAt(3.0, 10), []);
    assert.equal(loadAt(3.2, 10)[0].limit, 3.0);
    assert.match(loadAt(3.2, 10)[0].message, /volets sortis/);
    assert.deepEqual(loadAt(-1.5, 0), []);
    // F-15 : ni VNE ni facteur de charge du Cessna
    assert.deepEqual(review(flight(10, () => ({ ias: 500, load: 7 }), [], 'f15'), CONTEXT), []);
});

test('décrochage (un par épisode, avec la hauteur) et crash', () => {
    const stall = review(flight(20, (t) => ({ agl: 3000, stall: (t > 2 && t < 4) || (t > 10 && t < 11) ? 1 : 0 })), CONTEXT);
    assert.deepEqual(kinds(stall), ['stall', 'stall']);
    assert.equal(stall[0].severity, 'warn');
    assert.match(stall[0].message, /3000 ft/);
    assert.equal(review(flight(5, () => ({ agl: 200, stall: 1 })), CONTEXT)[0].severity, 'severe');
    // Limite : 1 500 ft du sol (ACS PA.VII.B.S2 et C.S2 p. 43-44)
    assert.equal(review(flight(5, () => ({ agl: 1500, stall: 1 })), CONTEXT)[0].severity, 'warn');
    assert.equal(review(flight(5, () => ({ agl: 1490, stall: 1 })), CONTEXT)[0].severity, 'severe');
    assert.deepEqual(review(flight(5, () => ({ ground: 1, stall: 1 })), CONTEXT), []);           // au sol : rien
    const crash = review(flight(5, () => ({}), [{ t: 4, kind: 'crash', text: 'Impact trop violent' }], 'f15'), CONTEXT);
    assert.deepEqual(kinds(crash), ['crash']);
    assert.equal(crash[0].severity, 'severe');
    assert.match(crash[0].message, /Impact trop violent/);
});

test('écarts triés par instant, champs complets', () => {
    const list = review(flight(30, (t) => ({ ...final(t), bank: t > 20 && t < 23 ? 40 : 0, ias: t > 2 && t < 8 ? 85 : 65 }),
        [{ t: 29, kind: 'crash', text: 'Sortie de piste' }, touch(28, { impact: 3 })]), CONTEXT);
    assert.deepEqual(kinds(list), ['approach-speed', 'bank-low', 'touchdown-vs', 'crash']);
    for (const f of list) {
        for (const key of ['kind', 't', 't0', 't1', 'severity', 'message', 'value', 'limit']) assert.ok(key in f, key);
        assert.ok(['info', 'warn', 'severe'].includes(f.severity));
        assert.ok(f.t1 >= f.t0);
    }
});
