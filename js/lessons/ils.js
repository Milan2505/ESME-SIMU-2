// Leçon 5 du lot 6 : approche ILS de la piste 18 d'ESME (ILS 110.30). Interception du localizer en palier, capture du
// glide par en dessous, descente stabilisée jusqu'aux minimums (hauteur de décision 200 ft), remise de gaz et palier.
// Format : voir js/lessons/index.js ; récepteur : js/ILS.js (aiguilles de -1 à 1 en pleine échelle : localizer 2,5°,
// glide 0,7° ; localizer > 0 : l'axe est à droite ; glide > 0 : la pente est au-dessus, avion trop bas ; portée 8 km).
//
// Tolérances (chacune citée dans criteria) : FAA-S-ACS-8C, Instrument Rating – Airplane ACS (pages imprimées) :
// IR.VI.B.S9 p. 16 (avant le segment final : altitude ±100 ft, cap ±10°, vitesse ±10 kt), IR.VI.B.S12 p. 16 (de la FAF
// à la DA : pas plus des ¾ de la pleine échelle au localizer et au glide, vitesse ±10 kt), IR.VI.C.S7 p. 17 (remise de
// gaz : vitesse ±10 kt, cap ±10°, altitude ±100 ft) ; Flight Safety Foundation, ALAR Tool Kit, Briefing Note 7.1
// (approche stabilisée à 1 000 ft en IMC : à moins d'un point du glide et du localizer, vario ≤ 1 000 ft/min).
//
// Choix de la leçon, sans source : vitesse d'approche 90 KIAS volets rentrés (pas de vitesse ILS publiée au POH 172P),
// hauteur de décision 200 ft (catégorie I, OACI annexe 6 : non relu ici), palier d'interception à 1 200 ft au-dessus du
// seuil (la portée du localizer du jeu, 8 km, et le relief au nord du terrain l'imposent), palier de remise de gaz à
// 1 500 ft, Vy 76 KIAS en montée (POH 172P sect. 4, non relu sur scan).
//
// Démonstration (step.demo, bouton Montrer) : js/InstructorPilot.js au cap (cap visé selon l'aiguille du localizer,
// gain réduit près du seuil) et au vario (descente de 3° à la vitesse sol, corrigée de l'écart de hauteur au glide).
// Gains : réglage du simulateur, non relus. Les consignes dépendent de l'état des aiguilles, pas de l'étape : si la
// consigne dure, le moniteur intercepte quand même au bon moment.

const RUNWAY = '18';
const SPEED = 90;            // KIAS en approche (choix de la leçon, non relu)
const VY = 76;               // KIAS, montée de remise de gaz (POH 172P sect. 4, non relu sur scan)
const DA = 200;              // ft au-dessus du seuil : hauteur de décision (catégorie I, non relu)
const GATE = 1000;           // ft : porte de stabilisation en IMC (FSF BN 7.1)
const MISSED = 1500;         // ft au-dessus du seuil : palier de remise de gaz (choix de la leçon)
const INTERCEPT = 30;        // ° : angle d'interception du localizer (choix de la leçon)
const GLIDE_TAN = Math.tan(3 * Math.PI / 180);
const FT = 0.3048;

const wrap = (a) => ((a % 360) + 540) % 360 - 180;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const say360 = (h) => String(Math.round(((h % 360) + 360) % 360) || 360).padStart(3, '0');

// ILS de la piste de la leçon reçu (fréquence affichée et portée)
const ilsOf = (c) => {
    const i = c.nav?.ils;
    return i?.available && i.runway === RUNWAY && c.nav?.nav1?.available ? i : null;
};
// Localizer « vivant » : l'aiguille a quitté la butée
const locAlive = (i) => i && Math.abs(i.localizer) < 0.95;

// Cap visé par le moniteur sur le localizer : 25° de cap par pleine échelle loin du seuil, moins près du seuil (l'aiguille
// y devient plus sensible), au plus limit de part et d'autre de l'axe
function locHeading(c, course, limit) {
    const i = ilsOf(c);
    if (!locAlive(i)) return course + INTERCEPT;
    const gain = 25 * clamp(i.distance / 5000, 0.35, 1);
    return course + clamp(gain * i.localizer, -limit, limit);
}
// Vario visé sur le glide : pente de 3° à la vitesse sol, plus 4 ft/min par pied d'écart de hauteur
function glideVs(c) {
    const i = ilsOf(c);
    if (!i) return -500;
    const nominal = -c.groundKt * 6076.12 / 60 * GLIDE_TAN;
    return clamp(nominal + 4 * (i.glideHeight - i.height) / FT, -1000, 0);
}

export default {
    id: 'ils',
    title: { fr: 'Approche ILS', en: 'ILS approach' },
    summary: {
        fr: "Intercepter le localizer de la piste 18, capter le glide, descendre stabilisé jusqu'aux minimums, puis remettre les gaz.",
        en: 'Intercept the runway 18 localizer, capture the glideslope, fly a stabilised descent to minimums, then go around.',
    },
    objectives: [
        { fr: 'Intercepter le localizer en palier : altitude ±100 ft, cap ±10°', en: 'Intercept the localizer level: altitude ±100 ft, heading ±10°' },
        { fr: 'Capter le glide par en dessous et descendre sur la pente', en: 'Capture the glideslope from below and descend on it' },
        { fr: "Aiguilles aux ¾ de l'échelle au plus, vitesse ±10 kt", en: 'Needles within ¾ scale, airspeed ±10 kt' },
        { fr: 'Stabilisé à 1 000 ft ; remise de gaz aux minimums', en: 'Stabilised at 1,000 ft; go around at minimums' },
    ],
    // En vol au nord du terrain, 8,6 km avant le seuil 18 et 700 m à l'est de l'axe, à 1 200 ft au-dessus du seuil, cap
    // d'interception 210 ; vent calme (la leçon porte sur les aiguilles)
    setup: {
        place: 'air', runway: RUNWAY, along: -8600, lateral: 700, altitudeFt: 1200, heading: 180 + INTERCEPT,
        speedKt: SPEED, flaps: 0, throttle: 0.6, trimDeg: 8, wind: 'calm',
        nav1: '110.30',
    },
    advice: ['stall'],
    // Écarts du débriefing comptés : décrochage, facteur de charge, VNE, vario en finale. Pas les écarts ILS de FlightReview
    // (ils-loc, ils-gs) : la leçon mesure elle-même les aiguilles de la FAF à la DA, et le débriefing, qui ne connaît pas
    // la hauteur de décision, compterait la remise de gaz (avion au-dessus du glide sous 1 000 ft) comme un écart sévère
    reviewKinds: ['stall', 'load', 'vne', 'approach-sink'],
    criteria: [
        { key: 'initAlt', label: { fr: 'Altitude en palier avant le glide (écart)', en: 'Level altitude before the glideslope (deviation)' },
            limit: 100, compare: 'max', unit: 'ft', source: 'FAA-S-ACS-8C, IR.VI.B.S9, p. 16 (altitude ±100 ft avant le segment final)' },
        { key: 'initHdg', label: { fr: "Cap d'interception (écart)", en: 'Intercept heading (deviation)' },
            limit: 10, compare: 'max', unit: '°', source: 'FAA-S-ACS-8C, IR.VI.B.S9, p. 16 (cap ±10° avant le segment final)' },
        { key: 'ias', label: { fr: "Vitesse d'approche (écart à 90 kt)", en: 'Approach airspeed (deviation from 90 kt)' },
            limit: 10, compare: 'max', unit: 'kt', source: 'FAA-S-ACS-8C, IR.VI.B.S9 et S12, p. 16 (vitesse ±10 kt)' },
        { key: 'loc', label: { fr: 'Localizer, de la FAF à la DA (part de la pleine échelle)', en: 'Localizer, FAF to DA (share of full scale)' },
            limit: 75, compare: 'max', unit: '%', weight: 2, source: 'FAA-S-ACS-8C, IR.VI.B.S12, p. 16 : « no more than ¾-scale deflection »' },
        { key: 'gs', label: { fr: 'Glide, de la FAF à la DA (part de la pleine échelle)', en: 'Glideslope, FAF to DA (share of full scale)' },
            limit: 75, compare: 'max', unit: '%', weight: 2, source: 'FAA-S-ACS-8C, IR.VI.B.S12, p. 16 : « no more than ¾-scale deflection »' },
        { key: 'stable', label: { fr: 'Stabilisé à 1 000 ft (un point, vario ≤ 1 000 ft/min)', en: 'Stabilised at 1,000 ft (one dot, sink ≤ 1,000 ft/min)' },
            limit: true, compare: 'bool', source: 'Flight Safety Foundation, ALAR Briefing Note 7.1 (un point = ½ échelle, affichage à 2 points par côté)' },
        { key: 'gaHdg', label: { fr: 'Remise de gaz : cap (écart)', en: 'Go-around: heading (deviation)' },
            limit: 10, compare: 'max', unit: '°', source: 'FAA-S-ACS-8C, IR.VI.C.S7, p. 17 (cap ±10°)' },
        { key: 'gaIas', label: { fr: 'Remise de gaz : vitesse (écart à 76 kt)', en: 'Go-around: airspeed (deviation from 76 kt)' },
            limit: 10, compare: 'max', unit: 'kt', source: 'FAA-S-ACS-8C, IR.VI.C.S7, p. 17 (vitesse ±10 kt) ; Vy 76 KIAS, POH 172P sect. 4 (non relu sur scan)' },
        { key: 'gaAlt', label: { fr: 'Remise de gaz : palier (écart)', en: 'Go-around: level-off (deviation)' },
            limit: 100, compare: 'max', unit: 'ft', source: 'FAA-S-ACS-8C, IR.VI.C.S7, p. 17 (altitude ±100 ft)' },
    ],
    build(lang, tools) {
        const { T, plan } = tools;
        const steps = [];
        let course = 180;
        // Avant le glide (palier) : altitude, vitesse
        const level = (c, m) => {
            m.measure('ias', Math.abs(c.speedKt - SPEED));
            const i = ilsOf(c);
            if (!i || i.glideslope > 0.3) m.measure('initAlt', Math.abs(c.altitudeFt - plan.alt));
        };
        // Approche finale (FAF -> DA) : aiguilles, vitesse, porte de stabilisation
        const final = (c, m) => {
            m.measure('ias', Math.abs(c.speedKt - SPEED));
            const i = ilsOf(c);
            if (!i) return;
            m.measure('loc', Math.abs(i.localizer) * 100);
            m.measure('gs', Math.abs(i.glideslope) * 100);
            if (!plan.gateDone && c.aal <= GATE) {
                plan.gateDone = true;
                m.set('stable', Math.abs(i.localizer) <= 0.5 && Math.abs(i.glideslope) <= 0.5 && c.vs >= -1000);
            }
        };
        // Consignes du moniteur selon les aiguilles : interception, palier puis glide
        const approach = (c) => {
            const i = ilsOf(c);
            const onGlide = plan.descending || (i && locAlive(i) && i.glideslope <= 0.05 && i.distance > 1000);
            if (onGlide) plan.descending = true;
            return { heading: locHeading(c, course, plan.descending ? 10 : INTERCEPT), maxBank: 20, throttleSpeed: SPEED,
                ...(onGlide ? { vs: glideVs(c) } : { altitude: plan.alt ??= Math.round(c.altitudeFt / 10) * 10 }) };
        };

        steps.push({
            title: T("L'ILS de la piste 18", 'The runway 18 ILS'), target: ['inst:vor1'],
            enter: (c) => {
                plan.alt = Math.round(c.altitudeFt / 10) * 10;
                plan.interceptHeading = Math.round(c.heading);
                course = c.runway?.heading ?? 180;
            },
            say: () => T(`ILS de la piste 18, fréquence 110.30, affiché sur la NAV 1. Deux aiguilles : la verticale, le localizer, montre l'axe de piste ; l'horizontale, le glide, une pente de 3 degrés. L'aiguille indique où est la trajectoire : à droite, l'axe est à droite ; en haut, la pente est au-dessus. Nous tenons ${plan.alt} pieds, cap ${say360(plan.interceptHeading)} et ${SPEED} nœuds jusqu'à ce que le localizer se réveille.`,
                `Runway 18 ILS, frequency 110.30, set on NAV 1. Two needles: the vertical one, the localizer, shows the runway centreline; the horizontal one, the glideslope, a 3 degree slope. The needle shows where the path is: right means the centreline is to the right; up means the slope is above. We hold ${plan.alt} feet, heading ${say360(plan.interceptHeading)} and ${SPEED} knots until the localizer comes alive.`),
            why: T("Le localizer est quatre fois plus sensible qu'un VOR : pleine échelle à 2,5 degrés. Petites corrections.", 'The localizer is four times as sensitive as a VOR: full scale at 2.5 degrees. Small corrections.'),
            measure: (c, m) => {
                level(c, m);
                if (!locAlive(ilsOf(c))) m.measure('initHdg', Math.abs(wrap(c.heading - plan.interceptHeading)));
            },
            demo: approach,
            done: (c) => locAlive(ilsOf(c)),
        });
        steps.push({
            title: T('Interception du localizer', 'Localizer intercept'), camera: 'none',
            say: () => T(`Le localizer se réveille : l'aiguille quitte la butée. Virez vers le ${say360(course)} en la suivant, sans la dépasser, et gardez ${plan.alt} pieds. Le glide est encore au-dessus : on l'attend en palier.`,
                `The localizer is alive: the needle leaves the stop. Turn towards ${say360(course)} as it moves, without overshooting, and keep ${plan.alt} feet. The glideslope is still above: we wait for it level.`),
            measure: level,
            demo: approach,
            done: (c, f, dt) => {
                const i = ilsOf(c);
                return (f.t = i && Math.abs(i.localizer) < 0.2 && Math.abs(c.trackToAxis) < 5 ? (f.t ?? 0) + dt : 0) > 3
                    || Boolean(i && i.glideslope < 0.3);
            },
        });
        steps.push({
            title: T('Capture du glide', 'Glideslope capture'), camera: 'none', target: ['throttle'],
            say: T("Sur l'axe, en palier. L'aiguille du glide descend du haut : quand elle arrive au centre, réduisez un peu les gaz et descendez d'environ 500 pieds par minute pour la garder centrée. La vitesse reste à 90 nœuds.",
                'On the centreline, level. The glideslope needle is coming down from the top: when it reaches the centre, reduce power a little and descend at about 500 feet per minute to keep it centred. Speed stays at 90 knots.'),
            measure: level,
            demo: approach,
            done: (c) => plan.descending || (ilsOf(c)?.glideslope ?? 1) <= 0.05,
        });
        steps.push({
            title: T('Descente sur le glide', 'Down the glideslope'), camera: 'none',
            say: T("Nous descendons sur le glide : c'est le point d'approche finale. Les deux aiguilles en croix au centre, aux trois quarts de l'échelle au plus. À 1 000 pieds, l'approche doit être stable : à moins d'un point, moins de 1 000 pieds par minute. Hauteur de décision : 200 pieds.",
                'We are descending on the glideslope: this is the final approach fix. Both needles crossed in the centre, within three quarters of the scale. At 1,000 feet the approach must be stable: within one dot, less than 1,000 feet per minute. Decision height: 200 feet.'),
            why: T("Le glide se tient au vario et à l'assiette, la vitesse aux gaz ; le localizer au cap, par petites touches de 2 à 5 degrés.", 'The glideslope is held with pitch and vertical speed, the airspeed with power; the localizer with heading, in small 2 to 5 degree touches.'),
            enter: () => { plan.descending = true; },
            measure: final,
            demo: approach,
            done: (c) => c.aal <= DA,
        });
        steps.push({
            title: T('Minimums : remise de gaz', 'Minimums: go around'), camera: 'none', target: ['throttle'], urgent: true,
            say: T("Minimums ! Piste en vue, on poursuivrait à vue ; sinon, remise de gaz immédiate. Aujourd'hui : remise de gaz. Plein gaz, assiette de montée, 76 nœuds, cap de l'axe.",
                'Minimums! Runway in sight, we would continue visually; if not, go around at once. Today: go around. Full power, climb attitude, 76 knots, runway heading.'),
            enter: () => tools.mark('ga'),
            measure: (c, m) => {
                if (tools.since('ga') < 10) return;   // le temps de mettre les gaz et de prendre l'assiette
                m.measure('gaHdg', Math.abs(wrap(c.heading - course)));
                m.measure('gaIas', Math.abs(c.speedKt - VY));
            },
            demo: () => ({ heading: course, maxBank: 10, throttle: 1, speed: VY }),
            done: (c) => c.aal >= GATE && c.vs > 200,
        });
        steps.push({
            title: T('Palier de remise de gaz', 'Missed approach level-off'), camera: 'none',
            enter: (c) => {
                plan.gaAlt = Math.round((c.altitudeFt + MISSED - c.aal) / 10) * 10;
                plan.levelled = false;
            },
            say: () => T(`Montée jusqu'à ${plan.gaAlt} pieds au cap ${say360(course)}, puis palier : assiette, gaz, trim. Tenez l'altitude à 100 pieds près.`,
                `Climb to ${plan.gaAlt} feet on heading ${say360(course)}, then level off: attitude, power, trim. Hold altitude within 100 feet.`),
            measure: (c, m) => {
                m.measure('gaHdg', Math.abs(wrap(c.heading - course)));
                if (!plan.levelled && Math.abs(c.altitudeFt - plan.gaAlt) < 50) { plan.levelled = true; tools.mark('level'); }
                if (plan.levelled) m.measure('gaAlt', Math.abs(c.altitudeFt - plan.gaAlt));
            },
            demo: () => ({ heading: course, maxBank: 10, altitude: plan.gaAlt, vsMax: 700, throttleSpeed: SPEED }),
            done: () => plan.levelled && tools.since('level') > 30,
        });
        return steps;
    },
};
