// Leçon 7 du lot 6 : la vrille, en catégorie utilitaire, et sa sortie (procédure du POH 172P, « PARE »).
// Moteur : js/Initiation.js (format : js/lessons/index.js) ; démonstrations : js/InstructorPilot.js ; notation :
// js/LessonGrade.js. Pur (aucun DOM ni three.js) : joué aussi hors navigateur par tests/lessons-vrille.test.js.
//
// L'ACS ne note pas la vrille : FAA-S-ACS-6C PA.VII.D « Spin Awareness » (p. 45) est une tâche de connaissances
// (« Skills: [Intentionally left blank] ») ; l'EASA (AMC1 FCL.235) n'a pas d'épreuve de vrille. Les critères viennent
// donc du POH Cessna 172P (copie remise en page relue le 18/11/2026 ; pages déjà citées par
// tests/flying-qualities.test.js) :
// - p. 2-7 et 2-8 : vrilles approuvées en catégorie utilitaire seulement, 2 100 lb au plus, places arrière et soute
//   vides ; vrille volets sortis interdite ; facteur de charge utilitaire +4,4 g volets rentrés ;
// - p. 4-18 et 4-19 : entrée depuis un décrochage gaz réduits, manche amené plein arrière, pied à fond dans le sens de la
//   vrille juste avant la rupture, ailerons au neutre ; sortie : gaz réduits, ailerons au neutre, pied à fond opposé,
//   manche franchement vers l'avant, tenus jusqu'à l'arrêt de la rotation, qui s'arrête « en moins d'un quart de tour » ;
//   « au moins 1 000 ft pour une vrille d'un tour et sa sortie ».
// Hauteur : la vrille commence par un décrochage ; la règle des décrochages de l'ACS, « no lower than 1,500 feet AGL »
// (PA.VII.B.S2, p. 43), lui est appliquée par analogie (rien de plus précis dans l'ACS ni dans l'EASA).
// Non noté : la perte d'altitude (au moins 1 000 ft : valeur de préparation du POH, pas une tolérance), la vitesse et le
// taux de rotation en vrille (non sourcés).

const LB = 0.45359237;
const VY = 76;                    // KIAS (POH 172P sect. 4, p. 4-3, non relu sur scan)
const STOPPED = 0.1;              // rad/s : rotation arrêtée (comme le banc de tests/flying-qualities.test.js)
const PULLOUT = 0.3;              // démonstration : ressource manche tiré à 30 % (banc de flying-qualities ; choix)

// Vitesse de rotation autour de la verticale (rad/s, + = vers la gauche) : vitesse angulaire du modèle (repère avion)
// tournée dans le repère du monde par l'orientation de l'avion (quaternion), sans three.js
export function yawRateWorld(c) {
    const m = c.controls?.model, q = c.controls?.object?.quaternion, w = m?._angularVelocity;
    if (!w || !q) return 0;
    // v' = v + 2 q×(q×v + w v) (q = (x, y, z), w : partie réelle) ; seule la composante verticale sert
    const tx = 2 * (q.y * w.z - q.z * w.y), ty = 2 * (q.z * w.x - q.x * w.z), tz = 2 * (q.x * w.y - q.y * w.x);
    return w.y + q.w * ty + (q.z * tx - q.x * tz);
}

const SRC = {
    mass: 'POH 172P p. 2-7 et 2-8 (catégorie utilitaire)',
    flaps: 'POH 172P p. 2-8 (vrille volets sortis interdite)',
    idle: 'POH 172P p. 4-18 (gaz réduits)',
    recovery: 'POH 172P p. 4-18 (rotation arrêtée en moins d\'un quart de tour)',
    load: 'POH 172P p. 2-8 (+4,4 g, catégorie utilitaire)',
    agl: 'FAA-S-ACS-6C, PA.VII.B.S2, p. 43 (appliqué par analogie)',
};

export default {
    id: 'vrille',
    title: { fr: 'La vrille', en: 'Spins' },
    summary: { fr: 'Une vrille d\'un tour en catégorie utilitaire, et la sortie du POH : gaz réduits, ailerons au neutre, pied opposé, manche en avant.',
        en: 'A one-turn spin in the utility category, and the POH recovery: power off, ailerons neutral, opposite rudder, stick forward.' },
    objectives: [
        { fr: 'Vriller seulement en catégorie utilitaire, volets rentrés', en: 'Spin only in the utility category, flaps up' },
        { fr: 'Entrer en vrille gaz réduits, sortir en moins d\'un quart de tour', en: 'Enter with power off, recover within a quarter turn' },
        { fr: 'Ressource sous 4,4 g, au-dessus de 1 500 ft du sol', en: 'Pull out below 4.4 g, above 1,500 ft AGL' },
    ],
    setup: { place: 'air', runway: 'active', along: -9000, lateral: -4000, altitudeFt: 5500, heading: 'runway+180', speedKt: 90,
        throttle: 0.65, flaps: 0, wind: 'calm', load: 'utility' },
    advice: [],
    reviewKinds: ['vne'],   // (pas 'load' : limite de la catégorie normale, 3,8 g ; ici utilitaire, critère 'load')
    criteria: [
        { key: 'mass', label: { fr: 'Masse (catégorie utilitaire)', en: 'Weight (utility category)' }, limit: 2100, compare: 'max', unit: 'lb',
            eliminatory: true, source: SRC.mass },
        { key: 'flapsUp', label: { fr: 'Volets rentrés en vrille', en: 'Flaps up in the spin' }, limit: true, compare: 'bool', source: SRC.flaps },
        { key: 'idle', label: { fr: 'Gaz réduits en vrille', en: 'Power off in the spin' }, limit: true, compare: 'bool', source: SRC.idle },
        { key: 'recoveryTurns', label: { fr: 'Rotation après le pied opposé', en: 'Rotation after opposite rudder' }, limit: 0.25, compare: 'max',
            unit: 'tour', weight: 2, source: SRC.recovery },
        { key: 'load', label: { fr: 'Facteur de charge en ressource', en: 'Load factor in the pull-out' }, limit: 4.4, compare: 'max', unit: 'g',
            source: SRC.load },
        { key: 'minAgl', label: { fr: 'Hauteur minimale', en: 'Minimum height' }, limit: 1500, compare: 'min', unit: 'ft', weight: 2,
            eliminatory: true, source: SRC.agl },
    ],

    build(lang, tools) {
        const { T, plan, headingDiff } = tools;
        const steps = [];
        const add = (step) => steps.push({ camera: 'none', urgent: true, ...step });
        const carb = (c) => Boolean(c.sys?.switches?.carbHeat);
        const setCarb = (c, on) => { if (carb(c) !== on) c.sys.toggle('carbHeat'); };
        const capOf = (c) => Math.round(c.heading) % 360;
        const common = (c, m) => {
            if (c.s && Number.isFinite(c.agl) && !c.onGround) m.measure('minAgl', c.agl);
            // (masse relevée à chaque étape : une étape « Continuer » peut être passée avant sa première mesure)
            const mass = c.controls?.model?.mass;
            if (mass) m.measure('mass', mass / LB);
        };
        const level = (c) => {
            plan.altitude ??= Math.round(c.altitudeFt / 10) * 10;
            plan.heading ??= capOf(c);
            return { heading: plan.heading, altitude: plan.altitude, vsMax: 500, throttleSpeed: 90 };
        };
        // Vrille en cours : sens (gauche, comme la démonstration ; sinon celui de la rotation), tours, pied opposé
        const spin = () => (plan.spin ??= { left: true, pareAt: null, stoppedFor: 0, stopped: false });
        const rotation = (c, m, dt) => {
            const s = spin();
            const rate = yawRateWorld(c);
            const turns = Math.abs(m.turned('spin')) / 360;
            if (Math.abs(rate) > 0.5 && s.pareAt === null) s.left = rate > 0;
            // Pied opposé : palonnier braqué à plus de la moitié contre la rotation (+ = pied à gauche)
            const yaw = c.controls?.model?.controls?.yaw ?? 0;
            if (s.pareAt === null && (s.left ? yaw < -0.5 : yaw > 0.5)) s.pareAt = turns;
            // Rotation arrêtée : vitesse de rotation dans le sens de la vrille sous STOPPED (elle passe vite par zéro, puis
            // repart de l'autre côté si le pied opposé reste braqué) ; 0,3 s après le pied opposé, comme le banc de
            // flying-qualities ; sans pied opposé (rotation éteinte d'elle-même), après 1 s : sortie non mesurée
            const along = s.left ? rate : -rate;
            if (s.pareAt !== null) s.sincePare = (s.sincePare ?? 0) + dt;
            s.stoppedFor = along < STOPPED ? s.stoppedFor + dt : 0;
            if (!s.stopped && (s.pareAt !== null ? s.sincePare > 0.3 && along < STOPPED : s.stoppedFor > 1 && turns > 0.5)) {
                s.stopped = true;
                if (s.pareAt !== null) m.measure('recoveryTurns', Math.max(0, turns - s.pareAt));
            }
            if (!s.stopped) {
                m.measure('flapsUp', c.flaps === 0);
                m.measure('idle', c.throttle < 0.05);
            }
        };

        add({ title: T('La vrille', 'Spins'), next: true, camera: 'pilot',
            enter: (c) => {
                plan.altitude = Math.round(c.altitudeFt / 10) * 10;
                plan.heading = capOf(c);
                const assists = c.controls?.model?.assists;
                if (assists && plan.protection === undefined) {
                    plan.protection = Boolean(assists.stallProtection);
                    assists.stallProtection = false;
                }
            },
            measure: (c, m) => common(c, m),
            demo: level,
            say: T("Aujourd'hui, la vrille : une aile décrochée plus que l'autre, l'avion tourne en descendant, nez bas. Le Cessna 172 ne vrille qu'en catégorie utilitaire : 2 100 livres au plus, personne à l'arrière, rien en soute. Nous sommes deux à l'avant, avec peu d'essence : c'est le cas. Volets rentrés, toujours.",
                'Today, the spin: one wing more stalled than the other, the aircraft rotates as it descends, nose low. The Cessna 172 may only spin in the utility category: 2,100 pounds at most, nobody in the back, nothing in the baggage area. We are two in front with little fuel: that is the case. Flaps up, always.'),
            why: T('POH 172P p. 2-7 et 2-8 : vrilles approuvées en catégorie utilitaire seulement, volets rentrés. En catégorie normale, elles sont interdites.',
                'POH 172P p. 2-7 and 2-8: spins approved in the utility category only, flaps up. In the normal category they are prohibited.') });
        add({ title: T('La sortie : PARE', 'The recovery: PARE'), next: true,
            measure: (c, m) => common(c, m),
            demo: level,
            say: T("La sortie, à connaître par cœur : gaz réduits, ailerons au neutre, pied à fond du côté opposé à la rotation, puis manche franchement vers l'avant. On tient tout jusqu'à l'arrêt de la rotation, pied au neutre, et ressource en douceur. Les Anglais disent PARE : Power, Ailerons, Rudder, Elevator.",
                'The recovery, to know by heart: power off, ailerons neutral, full rudder against the rotation, then stick briskly forward. Hold it all until the rotation stops, rudder neutral, and a smooth pull-out. P A R E: Power, Ailerons, Rudder, Elevator.'),
            why: T("POH 172P p. 4-18 : la rotation s'arrête en moins d'un quart de tour. Prévoir au moins 1 000 pieds pour un tour et la sortie : nous sommes à 5 500 pieds.",
                'POH 172P p. 4-18: the rotation stops within a quarter of a turn. Allow at least 1,000 feet for one turn and the recovery: we are at 5,500 feet.') });
        add({ title: T('Virage de dégagement', 'Clearing turn'), target: 'inst:dg',
            enter: (c) => { plan.heading = (capOf(c) + 90) % 360; },
            say: () => T(`On regarde dessous et autour : virage à droite de 90 degrés, au cap ${tools.capSay(plan.heading)}.`,
                `Look below and around: turn right 90 degrees, heading ${tools.capSay(plan.heading)}.`),
            why: T('Une vrille d\'un tour fait perdre 1 000 pieds en quelques secondes : personne ne doit être dessous.',
                'A one-turn spin loses 1,000 feet in a few seconds: nobody must be below.'),
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, maxBank: 30, altitude: plan.altitude, throttleSpeed: 90 }),
            done: (c) => Math.abs(headingDiff(c.heading, plan.heading)) < 5 && Math.abs(c.bank) < 5 });
        add({ title: T('Réduire : réchauffe, ralenti', 'Power off: carb heat, idle'), parts: [['switch:carbHeat', carb], ['throttle', (c) => c.throttle < 0.05]],
            say: T('Réchauffe carburateur tirée, gaz tout réduits. Tenez le palier : la vitesse diminue, le nez monte.',
                'Carb heat on, throttle closed. Hold level flight: the speed drops, the nose rises.'),
            why: T('L\'entrée du POH se fait depuis un décrochage gaz réduits, en décélérant lentement (p. 4-18).',
                'The POH entry starts from a power-off stall, decelerating slowly (p. 4-18).'),
            act: (c) => { setCarb(c, true); c.controls.throttle = 0; },
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, altitude: plan.altitude, throttle: 0, trim: false }),
            done: (c) => carb(c) && c.throttle < 0.05 });
        add({ title: T('Vers le décrochage', 'Towards the stall'), target: 'inst:asi',
            say: T("Tirez peu à peu pour tenir l'altitude, ailes à plat. L'avertisseur va siffler : on approche du décrochage.",
                'Pull gradually to hold altitude, wings level. The horn will sound: the stall is near.'),
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, altitude: plan.altitude, throttle: 0, trim: false }),
            done: (c) => c.controls?.isNearStall?.() || c.speedKt < 50 });
        add({ title: T('Entrée en vrille, à gauche', 'Spin entry, to the left'), target: 'inst:tc',
            enter: () => { tools.track('spin'); plan.spin = null; spin(); },
            say: T("Manche plein arrière, pied à fond à gauche, ailerons au neutre. Laissez faire un tour.",
                'Stick fully back, full left rudder, ailerons neutral. Let it go round once.'),
            why: T("L'aile gauche, plus décrochée, porte moins et traîne plus : l'avion s'enroule autour d'elle. Ailerons au neutre : les braquer contre la rotation l'aggrave.",
                'The left wing, more stalled, lifts less and drags more: the aircraft winds round it. Ailerons neutral: using them against the rotation makes it worse.'),
            measure: (c, m, dt) => { common(c, m); rotation(c, m, dt); },
            demo: () => ({ elevator: 1, aileron: 0, yaw: 1, throttle: 0 }),
            done: () => Math.abs(tools.turned('spin')) >= 330 || plan.spin?.stopped });
        add({ title: T('Sortie : PARE', 'Recovery: PARE'), target: 'inst:tc',
            say: T("Sortie ! Gaz réduits, ailerons au neutre, pied à fond à droite, manche en avant. Tenez jusqu'à l'arrêt de la rotation.",
                'Recover! Power off, ailerons neutral, full right rudder, stick forward. Hold until the rotation stops.'),
            why: T("Le pied opposé arrête la rotation, le manche en avant fait raccrocher l'aile : dans cet ordre (POH 172P p. 4-18).",
                'Opposite rudder stops the rotation, stick forward unstalls the wing: in that order (POH 172P p. 4-18).'),
            measure: (c, m, dt) => { common(c, m); rotation(c, m, dt); m.measure('load', c.load); },
            demo: () => {
                const s = spin();
                return s.stopped ? { elevator: -0.2, aileron: 0, yaw: 0, throttle: 0 } : { elevator: -0.5, aileron: 0, yaw: s.left ? -1 : 1, throttle: 0 };
            },
            done: () => Boolean(plan.spin?.stopped) });
        add({ title: T('Ressource', 'Pull-out'), target: 'inst:ai',
            say: T('Pied au neutre, ailes à plat, et ressource en douceur jusqu\'à l\'horizon. Pas plus de 4,4 g.',
                'Rudder neutral, wings level, and a smooth pull-out to the horizon. No more than 4.4 g.'),
            why: T('Nez bas, la vitesse monte vite ; une ressource trop brutale dépasse le facteur de charge de la catégorie utilitaire, +4,4 g (POH 172P p. 2-8).',
                'Nose low, the speed builds fast; too sharp a pull-out exceeds the utility category load factor, +4.4 g (POH 172P p. 2-8).'),
            measure: (c, m) => { common(c, m); m.measure('load', c.load); },
            demo: () => ({ elevator: PULLOUT, bank: 0, throttle: 0 }),
            done: (c) => c.pitch > 0 && Math.abs(c.bank) < 15 });
        add({ title: T('Remontée à Vy', 'Climb at Vy'), parts: [['switch:carbHeat', (c) => !carb(c)], ['throttle', (c) => c.throttle > 0.9], ['inst:asi', (c) => Math.abs(c.speedKt - VY) < 8]],
            enter: (c) => { plan.heading = capOf(c); },
            say: T(`Plein gaz, réchauffe repoussée, montée à ${VY} nœuds.`, `Full power, carb heat in, climb at ${VY} knots.`),
            measure: (c, m) => { common(c, m); m.measure('load', c.load); },
            act: (c) => { setCarb(c, false); c.controls.throttle = 1; },
            demo: () => ({ heading: plan.heading, speed: VY, throttle: 1 }),
            done: (c) => !carb(c) && c.throttle > 0.9 && c.vs > 200 && Math.abs(c.speedKt - VY) < 8 });
        add({ title: T('Fin de la vrille', 'End of the spin'), next: true, camera: 'pilot',
            enter: (c) => {
                const assists = c.controls?.model?.assists;
                if (assists && plan.protection !== undefined) assists.stallProtection = plan.protection;
            },
            measure: (c, m) => common(c, m),
            demo: () => ({ heading: plan.heading, speed: VY, throttle: 1 }),
            say: T("Un tour, et la sortie. Retenez l'ordre : gaz réduits, ailerons au neutre, pied opposé, manche en avant. Voyons la note.",
                "One turn, and the recovery. Remember the order: power off, ailerons neutral, opposite rudder, stick forward. Let's see the grade.") });
        return steps;
    },
};
