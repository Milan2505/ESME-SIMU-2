// Leçon 1 du lot 6 : décrochages (lisse moteur réduit, volets sortis en descente, en virage avec puissance) et sortie.
// Moteur : js/Initiation.js (format : js/lessons/index.js) ; démonstrations : js/InstructorPilot.js ; notation :
// js/LessonGrade.js. Pur (aucun DOM ni three.js) : joué aussi hors navigateur par tests/lessons-decrochages.test.js.
//
// Sources des critères (textes relus) :
// - FAA-S-ACS-6C (Private Pilot Airplane ACS, novembre 2023), Area VII :
//   Task B, Power-Off Stalls (p. 43) : S1 « Clear the area » ; S2 « no lower than 1,500 feet AGL » ; S3 configuration
//   d'approche ou d'atterrissage ; S4 « Establish a stabilized descent » ; S6 « Maintain a specified heading ±10° if in
//   straight flight; maintain a specified angle of bank not to exceed 20°, ±10° if in turning flight, while inducing the
//   stall » ; S7 « recover promptly after a full stall occurs » ; S8 sortie selon le POH ; S9 « accelerate to VX or VY » ;
//   S10 retour à l'altitude, au cap et à la vitesse donnés ; Task C, Power-On Stalls (p. 44) : S2, S4 « no less than
//   65 percent power », S6 ; R5 (p. 43-44) : décrochages secondaires.
//   Appendice 3 (p. 78) : la perte d'altitude n'est pas notée (« should not mandate a predetermined value for altitude
//   loss ») ; puissance réduite au besoin « to prevent pitch attitudes greater than 30° nose up ».
// - POH Cessna 172P : facteur de charge +3,8 g volets rentrés, +3,0 g volets sortis (p. 2-8 ; 14 CFR 23.337(a)(1)) ;
//   VFE 110 KIAS jusqu'à 10°, 85 KIAS au-delà (fig. 2-1) ; Vx 60, Vy 76 KIAS (sect. 4, p. 4-3) ; remise de gaz : plein
//   gaz, réchauffe repoussée, volets 20°, 55 KIAS, volets rentrés à 60 KIAS (p. 4-10). Copie remise en page du POH :
//   non relu sur scan, sauf p. 2-8 (déjà citée par tests/flying-qualities.test.js).
// Non noté faute de source chiffrée : la promptitude de la sortie (S7 ne donne pas de durée), l'altitude perdue
// (appendice 3), la vitesse de montée après la sortie (S9, S10 sans tolérance).

const VY = 76;                                 // KIAS, Vy (POH 172P sect. 4, p. 4-3, non relu sur scan)
const BALKED = 55, FLAPS_UP = 60;              // KIAS : remise de gaz, volets 20° puis rentrés (POH p. 4-10, non relu sur scan)
const VFE_FULL = 85;                           // KIAS : volets au-delà de 10° (POH fig. 2-1, non relu sur scan)
const TURN_BANK = 20;                          // ° : décrochage en virage (ACS PA.VII.B.S6 / C.S6 : au plus 20°)
const RAMP = 0.12;                             // démonstration : manche tiré de 12 %/s jusqu'au décrochage (choix)
const PITCH_DEMO = 24;                         // ° : assiette au plus de la démonstration avec puissance (choix, sous les 30° de l'ACS)

// Puissance délivrée, en part des 160 ch nominaux (Propulsion.js ; TCDS 3A12 p. 13)
export function powerFraction(c) {
    const m = c.controls?.model;
    const rated = m?.aircraft?.engine?.ratedPower;
    return m?.propulsion && rated ? Math.max(0, m.propulsion.power) / rated : 0;
}

const SRC = {
    agl: 'FAA-S-ACS-6C, PA.VII.B.S2 et PA.VII.C.S2, p. 43-44',
    heading: 'FAA-S-ACS-6C, PA.VII.B.S6, p. 43',
    bank: 'FAA-S-ACS-6C, PA.VII.C.S6, p. 44',
    power: 'FAA-S-ACS-6C, PA.VII.C.S4, p. 44',
    pitch: 'FAA-S-ACS-6C, appendice 3, Task C, p. 78',
    full: 'FAA-S-ACS-6C, PA.VII.B.S7 et PA.VII.C.S7, p. 43-44',
    secondary: 'FAA-S-ACS-6C, PA.VII.B.R5, PA.VII.B.S8, p. 43',
    loadClean: 'POH 172P p. 2-8 ; 14 CFR 23.337(a)(1)',
    loadFlaps: 'POH 172P p. 2-8 (non relu sur scan)',
};

export default {
    id: 'decrochages',
    title: { fr: 'Décrochages et sortie', en: 'Stalls and recovery' },
    summary: { fr: 'Trois décrochages francs : lisse moteur réduit, volets sortis en descente, en virage avec puissance ; sortie et remontée à Vy.',
        en: 'Three full stalls: clean power off, flaps down in a descent, turning with power; recovery and climb at Vy.' },
    objectives: [
        { fr: 'Tout finir à plus de 1 500 ft du sol', en: 'Complete everything above 1,500 ft AGL' },
        { fr: 'Tenir le cap à ±10° jusqu\'au décrochage', en: 'Hold heading ±10° up to the stall' },
        { fr: 'En virage : 20° d\'inclinaison ±10°, au moins 65 % de puissance', en: 'Turning: 20° of bank ±10°, at least 65% power' },
        { fr: 'Sortir aussitôt, sans décrochage secondaire, et remonter à Vy', en: 'Recover at once, no secondary stall, climb at Vy' },
    ],
    setup: { place: 'air', runway: 'active', along: -9000, lateral: 4000, altitudeFt: 4500, heading: 'runway+180', speedKt: 95,
        throttle: 0.68, flaps: 0, wind: 'calm' },
    advice: ['carbHeatFull'],
    reviewKinds: ['load', 'vne', 'vfe'],   // (pas 'stall' : ici, le décrochage est voulu)
    criteria: [
        { key: 'minAgl', label: { fr: 'Hauteur minimale', en: 'Minimum height' }, limit: 1500, compare: 'min', unit: 'ft', weight: 2,
            eliminatory: true, source: SRC.agl },
        { key: 'stalls', label: { fr: 'Décrochages francs obtenus', en: 'Full stalls reached' }, limit: 3, compare: 'min', unit: '', source: SRC.full },
        { key: 'heading', label: { fr: 'Écart de cap jusqu\'au décrochage', en: 'Heading deviation up to the stall' }, limit: 10, compare: 'max', unit: '°',
            source: SRC.heading },
        { key: 'turnBank', label: { fr: 'Inclinaison en virage (écart à 20°)', en: 'Bank in the turn (deviation from 20°)' }, limit: 10, compare: 'max',
            unit: '°', source: SRC.bank },
        { key: 'power', label: { fr: 'Puissance au décrochage avec moteur', en: 'Power in the power-on stall' }, limit: 65, compare: 'min', unit: '%',
            source: SRC.power },
        { key: 'pitch', label: { fr: 'Assiette à cabrer au plus', en: 'Highest nose-up pitch' }, limit: 30, compare: 'max', unit: '°', source: SRC.pitch },
        { key: 'noSecondary', label: { fr: 'Pas de décrochage secondaire', en: 'No secondary stall' }, limit: true, compare: 'bool', source: SRC.secondary },
        { key: 'loadClean', label: { fr: 'Facteur de charge, volets rentrés', en: 'Load factor, flaps up' }, limit: 3.8, compare: 'max', unit: 'g',
            source: SRC.loadClean },
        { key: 'loadFlaps', label: { fr: 'Facteur de charge, volets sortis', en: 'Load factor, flaps down' }, limit: 3.0, compare: 'max', unit: 'g',
            source: SRC.loadFlaps },
    ],

    build(lang, tools) {
        const { T, plan, headingDiff } = tools;
        const steps = [];
        const add = (step) => steps.push({ camera: 'none', urgent: true, ...step });
        const carb = (c) => Boolean(c.sys?.switches?.carbHeat);
        const setCarb = (c, on) => { if (carb(c) !== on) c.sys.toggle('carbHeat'); };
        const capOf = (c) => Math.round(c.heading) % 360;
        // Mesures de toute la leçon : hauteur, facteur de charge, décrochage secondaire après une sortie
        const common = (c, m) => {
            if (c.s && Number.isFinite(c.agl) && !c.onGround) m.measure('minAgl', c.agl);
            m.measure(c.flaps > 0 ? 'loadFlaps' : 'loadClean', c.load);
            const st = plan.stall;
            if (st?.recovered && c.stalled && !st.secondary) {
                st.secondary = true;
                m.measure('noSecondary', false);
            }
        };
        // Palier (cap et altitude de la leçon) ; remontée à Vy d'abord quand l'avion est bas
        const level = (c) => {
            plan.altitude ??= Math.round(c.altitudeFt / 10) * 10;
            plan.heading ??= capOf(c);
            if (plan.altitude - c.altitudeFt > 150) return { heading: plan.heading, speed: VY, throttle: 1, trim: false };
            // (près du cap : ailes à plat ; la tenue de cap du moniteur fait rouler l'avion pleins gaz à basse vitesse)
            const steer = Math.abs(headingDiff(c.heading, plan.heading)) > 5 ? { heading: plan.heading, maxBank: 15 } : { bank: 0 };
            return { ...steer, altitude: plan.altitude, vsMax: 500, throttleSpeed: 95 };
        };

        // Un décrochage : avant (manche tiré progressivement, cap ou inclinaison tenus), puis sortie (incidence réduite,
        // ailes à plat, plein gaz). n : 1, 2, 3 ; turn : décrochage en virage ; pullBelow : la démonstration tient le palier
        // jusqu'à cette vitesse, puis tire le manche ; throttle : gaz pendant l'approche du décrochage
        const stallStep = ({ n, turn = false, pullBelow = 999, throttle = 0, title, say, why }) => add({
            title, say, why,
            enter: () => {
                plan.stall = { n, seen: false, recovered: false, secondary: false, pull: null, unstalledAt: null, heading: plan.heading, side: plan.turnSide ?? -1 };
            },
            measure: (c, m) => {
                common(c, m);
                const st = plan.stall;
                if (!st.seen) {
                    if (turn) {
                        m.measure('turnBank', Math.abs(Math.abs(c.bank) - TURN_BANK));
                        m.measure('pitch', c.pitch);
                        m.measure('power', 100 * powerFraction(c));
                    } else m.measure('heading', Math.abs(headingDiff(c.heading, st.heading)));
                    if (c.stalled) {
                        st.seen = true;
                        plan.stalls = (plan.stalls ?? 0) + 1;
                        m.set('stalls', plan.stalls);
                    }
                } else if (!st.recovered && !c.stalled) {
                    st.unstalledAt ??= c.time;
                    if (c.time - st.unstalledAt > 1) {
                        st.recovered = true;
                        if (tools.get('noSecondary') === undefined) m.measure('noSecondary', true);
                    }
                } else if (!st.recovered) st.unstalledAt = null;
            },
            demo: (c) => {
                const st = plan.stall;
                if (st?.seen) return { pitch: 0, bank: 0, throttle: 1, trim: false };
                const lateral = turn ? { bank: TURN_BANK * (st?.side ?? plan.turnSide ?? -1) } : { heading: st?.heading ?? plan.heading, maxBank: 10 };
                // (consigne pas encore dite : configuration de l'étape précédente tenue)
                if (!st || (!st.pull && c.speedKt > pullBelow)) return { ...lateral, altitude: plan.altitude, throttle, trim: false };
                // Avec puissance : assiette montée de 2°/s jusqu'à PITCH_DEMO et tenue, la vitesse tombe jusqu'au décrochage
                // (appendice 3 de l'ACS : pas plus de 30° à cabrer) ; sans décrochage après 12 s, manche tiré comme sans
                // puissance. Sans puissance : manche tiré de RAMP par seconde
                st.pull ??= { t: c.time, start: c.time, elevator: Math.max(0, c.controls?.model?.controls?.pitch ?? 0), pitch: c.pitch };
                const dt = Math.max(0, Math.min(0.1, c.time - st.pull.t));
                st.pull.t = c.time;
                if (turn && c.time - st.pull.start < (PITCH_DEMO - st.pull.pitch) / 2 + 12) {
                    st.pull.elevator = Math.max(0, c.controls?.model?.controls?.pitch ?? 0);
                    return { ...lateral, pitch: Math.min(PITCH_DEMO, st.pull.pitch + 2 * (c.time - st.pull.start)), throttle, trim: false };
                }
                st.pull.elevator = Math.min(1, st.pull.elevator + RAMP * dt);
                return { ...lateral, elevator: st.pull.elevator, throttle };
            },
            done: (c) => plan.stall?.recovered && c.speedKt > 50,
        });
        // Remontée à Vy après la sortie : plein gaz, réchauffe repoussée
        const climbStep = () => add({
            title: T('Remontée à Vy', 'Climb at Vy'), parts: [['switch:carbHeat', (c) => !carb(c)], ['throttle', (c) => c.throttle > 0.9], ['inst:asi', (c) => Math.abs(c.speedKt - VY) < 8]],
            say: T(`Plein gaz, réchauffe repoussée : elle prend de la puissance. Assiette de montée, prenez ${VY} nœuds, la meilleure vitesse ascensionnelle, Vy.`,
                `Full power, carb heat in: it costs power. Climb attitude, ${VY} knots, the best rate of climb speed, Vy.`),
            why: T('Après la sortie, on remet l\'avion en montée à Vx ou Vy (ACS PA.VII.B.S9) : on regagne la hauteur perdue sans risquer un second décrochage.',
                'After the recovery the aircraft goes back to a climb at Vx or Vy (ACS PA.VII.B.S9): height comes back without risking a second stall.'),
            act: (c) => { setCarb(c, false); c.controls.throttle = 1; },
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, speed: VY, throttle: 1, trim: false }),
            done: (c) => !carb(c) && c.throttle > 0.9 && c.vs > 200 && Math.abs(c.speedKt - VY) < 8 && c.flaps === 0,
        });
        // Retour au palier, cap et altitude de départ (ACS S10), puissance de croisière
        const levelStep = (title) => add({
            title, target: ['inst:alt', 'throttle'],
            say: () => T(`Revenez à ${plan.altitude} pieds, en palier, cap ${tools.capSay(plan.heading)}. Puissance de croisière, 95 nœuds.`,
                `Back to ${plan.altitude} feet, level, heading ${tools.capSay(plan.heading)}. Cruise power, 95 knots.`),
            why: T('L\'exercice se termine au cap, à l\'altitude et à la vitesse de départ (ACS PA.VII.B.S10).',
                'The exercise ends at the entry heading, altitude and speed (ACS PA.VII.B.S10).'),
            enter: () => { plan.stall = null; },
            measure: (c, m) => common(c, m),
            demo: level,
            done: (c) => Math.abs(c.altitudeFt - plan.altitude) < 100 && Math.abs(c.vs) < 300 && c.speedKt > 85 && Math.abs(headingDiff(c.heading, plan.heading)) < 10,
        });

        // --- Présentation ---
        add({ title: T('Les décrochages', 'Stalls'), next: true, camera: 'pilot',
            enter: (c) => {
                plan.altitude = Math.round(c.altitudeFt / 10) * 10;
                plan.heading = capOf(c);
                // Aide « protection décrochage » (réglages) : coupée pendant la leçon, rendue à la fin
                const assists = c.controls?.model?.assists;
                if (assists && plan.protection === undefined) {
                    plan.protection = Boolean(assists.stallProtection);
                    assists.stallProtection = false;
                }
            },
            demo: level,
            measure: (c, m) => common(c, m),
            say: T("Aujourd'hui, les décrochages. L'aile décroche quand son incidence dépasse l'angle critique, environ 16 degrés, à n'importe quelle vitesse. Nous en ferons trois : lisse moteur réduit, volets sortis en descente, puis en virage avec de la puissance. Chaque fois : vous reconnaissez l'approche du décrochage, vous allez jusqu'au décrochage franc, et vous sortez aussitôt : rendre la main, ailes à plat, plein gaz.",
                "Today, stalls. The wing stalls when its angle of attack exceeds the critical angle, about 16 degrees, at any speed. We will do three: clean with power off, flaps down in a descent, then turning with power. Each time: you recognise the approaching stall, you go to the full stall, and you recover at once: release back pressure, wings level, full power."),
            why: T('Règle de l\'examen : tout l\'exercice au-dessus de 1 500 pieds du sol (ACS PA.VII.B.S2). Nous sommes à 4 500 pieds : de la marge.',
                'Test rule: the whole exercise above 1,500 feet above the ground (ACS PA.VII.B.S2). We are at 4,500 feet: plenty of margin.') });

        // --- Dégagement ---
        add({ title: T('Virage de dégagement', 'Clearing turn'), target: 'inst:dg',
            enter: (c) => { plan.heading = (capOf(c) + 270) % 360; },
            say: () => T(`D'abord, on regarde si le ciel est libre, surtout dessous. Virage à gauche de 90 degrés, au cap ${tools.capSay(plan.heading)}, 30 degrés d'inclinaison, altitude tenue.`,
                `First, check the sky is clear, especially below. Turn left 90 degrees, heading ${tools.capSay(plan.heading)}, 30 degrees of bank, hold altitude.`),
            why: T('« Clear the area » (ACS PA.VII.B.S1) : un avion qui décroche perd de la hauteur, personne ne doit être dessous.',
                '"Clear the area" (ACS PA.VII.B.S1): a stalling aircraft loses height, nobody must be below.'),
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, maxBank: 30, altitude: plan.altitude, throttleSpeed: 95 }),
            done: (c) => Math.abs(headingDiff(c.heading, plan.heading)) < 5 && Math.abs(c.bank) < 5 });

        // --- 1. Lisse, moteur réduit ---
        add({ title: T('Réduire : réchauffe, ralenti', 'Power off: carb heat, idle'), parts: [['switch:carbHeat', carb], ['throttle', (c) => c.throttle < 0.05]],
            say: T('Premier décrochage, lisse : volets rentrés. Tirez la réchauffe carburateur, puis gaz tout réduits. Gardez le palier : le nez va monter peu à peu.',
                'First stall, clean: flaps up. Pull the carb heat, then close the throttle. Hold level flight: the nose will rise little by little.'),
            why: T('La réchauffe avant toute réduction importante : au ralenti, le carburateur givre facilement (POH 172P p. 4-9).',
                'Carb heat before any large power reduction: at idle the carburettor ices easily (POH 172P p. 4-9).'),
            act: (c) => { setCarb(c, true); c.controls.throttle = 0; },
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, altitude: plan.altitude, throttle: 0, trim: false }),
            done: (c) => carb(c) && c.throttle < 0.05 });
        stallStep({ n: 1, pullBelow: 55,
            title: T('Décrochage lisse', 'Clean stall'),
            say: T("Tenez l'altitude en tirant de plus en plus, cap tenu au palonnier et aux ailerons. L'avertisseur siffle : c'est l'approche. Continuez jusqu'au décrochage franc : le nez tombe. Aussitôt : rendez la main, ailes à plat, plein gaz.",
                'Hold altitude with more and more back pressure, heading held with rudder and ailerons. The horn sounds: the stall is near. Carry on to the full stall: the nose drops. At once: release, wings level, full power.'),
            why: T('Cap à ±10° jusqu\'au décrochage (ACS PA.VII.B.S6). Sortie « promptly after a full stall » (S7) : diminuer l\'incidence d\'abord, c\'est elle qui fait décrocher, pas la vitesse.',
                'Heading ±10° up to the stall (ACS PA.VII.B.S6). Recovery "promptly after a full stall" (S7): reduce the angle of attack first, it causes the stall, not the speed.') });
        climbStep();
        levelStep(T('Retour au palier', 'Back to level flight'));

        // --- 2. Volets sortis, en descente ---
        add({ title: T('Configuration d\'atterrissage', 'Landing configuration'),
            parts: [['switch:carbHeat', carb], ['throttle', (c) => c.throttle < 0.05], ['flaps:lever', (c) => c.flaps >= 3]],
            say: T(`Deuxième décrochage, en configuration d'atterrissage. Réchauffe, gaz réduits, et sortez les volets à 30 degrés, sous ${VFE_FULL} nœuds : au-delà de 10 degrés, pas plus vite.`,
                `Second stall, in landing configuration. Carb heat, power off, and lower the flaps to 30 degrees, below ${VFE_FULL} knots: beyond 10 degrees, no faster.`),
            why: T(`VFE : 110 nœuds jusqu'à 10° de volets, ${VFE_FULL} au-delà (POH 172P fig. 2-1). L'ACS fait décrocher en configuration d'approche ou d'atterrissage (PA.VII.B.S3).`,
                `VFE: 110 knots up to 10° of flaps, ${VFE_FULL} beyond (POH 172P fig. 2-1). The ACS stalls in approach or landing configuration (PA.VII.B.S3).`),
            act: (c) => {
                setCarb(c, true);
                c.controls.throttle = 0;
                c.controls.setFlapLevel(c.speedKt < VFE_FULL - 3 ? 3 : Math.max(c.flaps, 1));
            },
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, altitude: plan.altitude, throttle: 0, trim: false }),
            done: (c) => carb(c) && c.throttle < 0.05 && c.flaps >= 3 });
        add({ title: T('Descente stabilisée', 'Stabilised descent'), target: 'inst:asi',
            say: T('Descente stabilisée à 60 nœuds, gaz réduits, cap tenu : comme en finale.',
                'Stabilised descent at 60 knots, power off, heading held: as on final.'),
            why: T('« Establish a stabilized descent » (ACS PA.VII.B.S4) : le décrochage en finale, quand on tire pour allonger le plané.',
                '"Establish a stabilized descent" (ACS PA.VII.B.S4): the stall on final, when pulling to stretch the glide.'),
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, speed: 60, throttle: 0, trim: false }),
            done: (c, f, dt) => {
                f.t = Math.abs(c.speedKt - 60) < 5 && c.vs < -200 ? (f.t ?? 0) + dt : 0;
                return f.t > 3;
            } });
        stallStep({ n: 2,
            title: T('Décrochage volets sortis', 'Flaps-down stall'),
            say: T("Amenez doucement l'assiette de l'arrondi, puis tirez encore jusqu'au décrochage franc. Cap tenu. Puis sortie : rendez la main, ailes à plat, plein gaz.",
                'Bring the nose up smoothly to the flare attitude, then keep pulling to the full stall. Heading held. Then recover: release, wings level, full power.'),
            why: T('Volets sortis, l\'avion décroche plus lentement, vers 33 nœuds au lieu de 44 (POH 172P fig. 5-3) ; près du sol, c\'est le décrochage le plus dangereux.',
                'With flaps down the aircraft stalls slower, about 33 knots instead of 44 (POH 172P fig. 5-3); close to the ground, it is the most dangerous stall.') });
        add({ title: T('Plein gaz, volets 20°', 'Full power, flaps 20°'),
            parts: [['throttle', (c) => c.throttle > 0.9], ['switch:carbHeat', (c) => !carb(c)], ['flaps:lever', (c) => c.flaps <= 2]],
            say: T(`Comme une remise de gaz : plein gaz, réchauffe repoussée, volets à 20 degrés tout de suite, ${BALKED} nœuds.`,
                `As in a go-around: full power, carb heat in, flaps to 20 degrees at once, ${BALKED} knots.`),
            why: T('Remise de gaz du POH 172P (p. 4-10) : les volets pleins traînent trop pour monter, on les rentre par étapes.',
                'Balked landing in the POH 172P (p. 4-10): full flaps drag too much to climb, they come up in steps.'),
            act: (c) => { setCarb(c, false); c.controls.throttle = 1; if (c.flaps > 2) c.controls.setFlapLevel(2); },
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, speed: BALKED, throttle: 1, trim: false }),
            done: (c) => c.throttle > 0.9 && !carb(c) && c.flaps <= 2 && c.vs > 100 });
        add({ title: T('Volets rentrés, Vy', 'Flaps up, Vy'), parts: [['flaps:lever', (c) => c.flaps === 0], ['inst:asi', (c) => Math.abs(c.speedKt - VY) < 8]],
            say: T(`À ${FLAPS_UP} nœuds, rentrez les volets, puis montée à ${VY} nœuds.`, `At ${FLAPS_UP} knots, raise the flaps, then climb at ${VY} knots.`),
            why: T(`Volets rentrés à ${FLAPS_UP} nœuds au moins (POH 172P p. 4-10) : plus lent, l'aile lisse serait près de son décrochage.`,
                `Flaps up at ${FLAPS_UP} knots or more (POH 172P p. 4-10): slower, the clean wing would be close to its stall.`),
            act: (c) => { if (c.speedKt >= FLAPS_UP) c.controls.setFlapLevel(0); },
            measure: (c, m) => common(c, m),
            demo: (c) => ({ heading: plan.heading, speed: c.flaps > 0 ? FLAPS_UP + 3 : VY, throttle: 1, trim: false }),
            done: (c) => c.flaps === 0 && c.vs > 200 && Math.abs(c.speedKt - VY) < 8 });
        levelStep(T('Retour au palier', 'Back to level flight'));

        // --- 3. En virage, avec puissance ---
        add({ title: T('Montée en virage, puissance', 'Climbing turn with power'),
            parts: [['throttle', (c) => c.throttle > 0.9], ['inst:ai', (c) => Math.abs(Math.abs(c.bank) - TURN_BANK) < 5]],
            enter: () => { plan.turnSide = -1; },
            say: T(`Troisième décrochage, en virage, avec de la puissance : comme au décollage. Plein gaz, montée en virage à gauche à ${TURN_BANK} degrés d'inclinaison, vers 65 nœuds.`,
                `Third stall, turning with power: as after take-off. Full power, climbing left turn at ${TURN_BANK} degrees of bank, about 65 knots.`),
            why: T('Au moins 65 % de puissance (ACS PA.VII.C.S4), inclinaison de 20° au plus, ±10° (S6). Le décrochage en montée après le décollage, en virage : celui qui part en vrille.',
                'At least 65% power (ACS PA.VII.C.S4), bank 20° at most, ±10° (S6). The stall in a climbing turn after take-off: the one that turns into a spin.'),
            act: (c) => { setCarb(c, false); c.controls.throttle = 1; },
            measure: (c, m) => common(c, m),
            demo: () => ({ bank: TURN_BANK * (plan.turnSide ?? -1), speed: 65, throttle: 1, trim: false }),
            done: (c, f, dt) => {
                f.t = c.throttle > 0.9 && Math.abs(Math.abs(c.bank) - TURN_BANK) < 5 && c.speedKt < 75 ? (f.t ?? 0) + dt : 0;
                return f.t > 2;
            } });
        stallStep({ n: 3, turn: true, throttle: 1,
            title: T('Décrochage en virage', 'Turning stall'),
            say: T("Gardez l'inclinaison et la bille au milieu, tirez progressivement jusqu'au décrochage franc, sans dépasser 30 degrés d'assiette. Puis sortie : rendez la main, ailes à plat, gaz tenus.",
                'Keep the bank and the ball centred, pull progressively to the full stall, no more than 30 degrees of pitch. Then recover: release, wings level, power on.'),
            why: T("Bille au milieu : un décrochage dérapé fait tomber une aile et peut partir en vrille. L'ACS ne veut pas plus de 30° d'assiette (appendice 3).",
                'Ball centred: a skidding stall drops a wing and can turn into a spin. The ACS wants no more than 30° of pitch (appendix 3).') });
        climbStep();
        levelStep(T('Retour au palier', 'Back to level flight'));

        add({ title: T('Fin des décrochages', 'End of the stalls'), next: true, camera: 'pilot',
            enter: (c) => {
                const assists = c.controls?.model?.assists;
                if (assists && plan.protection !== undefined) assists.stallProtection = plan.protection;
            },
            measure: (c, m) => common(c, m),
            demo: level,
            say: T("Trois décrochages, trois sorties. Retenez : c'est l'incidence qui fait décrocher. Rendre la main d'abord, ailes à plat, puissance. Voyons la note.",
                "Three stalls, three recoveries. Remember: the angle of attack makes the wing stall. Release first, wings level, power. Let's see the grade.") });
        return steps;
    },
};
