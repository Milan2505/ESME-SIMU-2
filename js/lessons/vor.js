// Leçon 4 du lot 6 : navigation VOR. Orientation (OBS, TO / FROM), interception d'une route vers la balise, tenue de
// la route, passage de la balise et tenue du radial en éloignement. Format : voir js/lessons/index.js ; récepteur :
// js/VOR.js (pleine échelle 10°, aiguille de -1 à 1 : négatif = route à gauche) ; balise ESM 113.50, au nord-est du
// seuil 36 d'ESME (js/Airport.js VOR_STATION).
//
// Tolérances (chacune citée dans criteria) : EASA AMC1 FCL.235 (Part-FCL, appliqué par la DGAC), « Flight test
// tolerance », relu dans sa reproduction officielle (formulaire DAC-LIC 111-13A, v3.1, juillet 2024, p. 3-4), retenu
// parce qu'il est plus strict que l'ACS privé (FAA-S-ACS-6C, PA.VI.B.S7 p. 39 : ±200 ft, cap ±15°) ; aiguille au plus
// aux ¾ de la pleine échelle : FAA-S-ACS-8C (qualification IFR), IR.V.A.S9 p. 12.
//
// Démonstration (step.demo, bouton Montrer) : le moniteur vole au cap avec js/InstructorPilot.js ; le cap visé suit
// l'aiguille (interception à 30° au plus, puis corrections de 6° au plus autour du cap corrigé de la dérive, trouvé peu
// à peu). Gains : choix de réglage du simulateur, non relus.
//
// OBS : le socle ne donne pas d'accès direct au bouton OBS ; le geste du moniteur (step.act) passe par les touches du
// clavier de l'élève (J / K, Maj : 10°, H : aiguille centrée « TO »), écoutées par simulator.js.

const COURSE = 360;         // route du jour : vers la balise au 360, puis radial 360 en éloignement
const SPEED = 95;           // KIAS de croisière de la leçon (choix de la leçon, plage de croisière du 172P)
const INTERCEPT = 30;       // ° : angle d'interception (choix pédagogique courant, non relu)
const NEAR_STATION = 2000;  // m : près de la balise, l'aiguille devient trop sensible et le cône de silence est proche
const FULL_SCALE = 10;      // ° : aiguille en butée (js/VOR.js)

const wrap = (a) => ((a % 360) + 540) % 360 - 180;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const say360 = (h) => String(Math.round(((h % 360) + 360) % 360) || 360).padStart(3, '0');

// Touches du clavier de l'élève (OBS) : écoutées par simulator.js sur window
function press(code, shiftKey = false) {
    if (typeof window === 'undefined') return;
    const key = code.slice(-1).toLowerCase();
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, shiftKey }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key, shiftKey }));
}
// OBS tourné jusqu'à la route voulue (par dizaines, puis degré par degré)
function turnObs(from, to) {
    let diff = Math.round(wrap(to - from));
    while (Math.abs(diff) >= 10) {
        press(diff > 0 ? 'KeyK' : 'KeyJ', true);
        diff -= Math.sign(diff) * 10;
    }
    while (diff !== 0) {
        press(diff > 0 ? 'KeyK' : 'KeyJ');
        diff -= Math.sign(diff);
    }
}

// Cap visé par le moniteur pour rejoindre ou tenir la route de l'OBS : 3° de cap par degré d'écart (aiguille), au plus
// limit de part et d'autre de la route ; en tenue de route (wind vrai), plus la correction de dérive trouvée peu à peu
// (plan.wca : l'écart qui dure fait tourner le cap de base, comme le pilote qui cherche le cap qui garde l'aiguille immobile)
const headingFor = (c, limit, plan, wind = false) => {
    const v = c.nav?.vor;
    if (!v?.available) return COURSE + (plan?.wca ?? 0);
    if (plan && wind) {
        const dt = Number.isFinite(c.time) && Number.isFinite(plan.wcaTime) ? clamp(c.time - plan.wcaTime, 0, 0.5) : 0;
        plan.wcaTime = c.time;
        if (!v.overhead && v.distance > NEAR_STATION) plan.wca = clamp((plan.wca ?? 0) + v.deviation * FULL_SCALE * dt / 15, -15, 15);
    }
    return COURSE + (plan?.wca ?? 0) + clamp(3 * v.deviation * FULL_SCALE, -limit, limit);
};

export default {
    id: 'vor',
    title: { fr: 'Navigation VOR', en: 'VOR navigation' },
    summary: {
        fr: 'Se situer sur un radial, intercepter une route vers la balise, la tenir, passer la balise et suivre le radial en éloignement.',
        en: 'Find your radial, intercept a course to the station, track it, pass the station and track the radial outbound.',
    },
    objectives: [
        { fr: "Lire l'indicateur : OBS, aiguille, TO / FROM", en: 'Read the indicator: OBS, needle, TO / FROM' },
        { fr: 'Intercepter la route 360 vers la balise ESM', en: 'Intercept course 360 to the ESM station' },
        { fr: "Tenir la route : aiguille aux ¾ de l'échelle au plus, route ±10°", en: 'Track the course: needle within ¾ scale, track ±10°' },
        { fr: 'Altitude ±150 ft, vitesse ±15 kt', en: 'Altitude ±150 ft, airspeed ±15 kt' },
    ],
    // En vol à 3 000 ft au-dessus d'ESME, ~8 NM au sud de la balise et 2,5 km à l'est de la route ; cap 360 ; vent de 8 kt
    // de l'est (de la droite de la piste 36) : il faut corriger la dérive pour tenir la route
    setup: {
        place: 'air', runway: '36', along: -14085, lateral: -2610, altitudeFt: 3000, heading: 0,
        speedKt: SPEED, flaps: 0, throttle: 0.68, trimDeg: 8,
        wind: { fromRunway: 90, knots: 8, gust: 0 },
        nav1: '113.50', obs: 300,
    },
    advice: ['stall'],
    reviewKinds: ['stall', 'load', 'vne'],
    criteria: [
        { key: 'cdi', label: { fr: 'Aiguille du VOR (part de la pleine échelle)', en: 'VOR needle (share of full scale)' },
            limit: 75, compare: 'max', unit: '%', weight: 2,
            source: 'FAA-S-ACS-8C, IR.V.A.S9, p. 12 : « no more than ¾-scale deflection of the CDI »' },
        { key: 'track', label: { fr: 'Route tenue (écart à la route)', en: 'Track held (deviation from course)' },
            limit: 10, compare: 'max', unit: '°',
            source: 'EASA AMC1 FCL.235 (d)(2), « tracking of radio aids ±10° » (DAC-LIC 111-13A, p. 3)' },
        { key: 'alt', label: { fr: 'Altitude (écart)', en: 'Altitude (deviation)' }, limit: 150, compare: 'max', unit: 'ft',
            source: 'EASA AMC1 FCL.235 (d)(1), « height ±150 ft » (DAC-LIC 111-13A, p. 3) ; ACS PA.VI.B.S7 p. 39 : ±200 ft' },
        { key: 'ias', label: { fr: 'Vitesse (écart)', en: 'Airspeed (deviation)' }, limit: 15, compare: 'max', unit: 'kt',
            source: 'EASA AMC1 FCL.235 (d)(3)(ii), « all other flight ±15 kt » (DAC-LIC 111-13A, p. 3)' },
    ],
    build(lang, tools) {
        const { T, plan } = tools;
        plan.alt ??= 3000;
        const steps = [];
        // Tenue de l'altitude et de la vitesse (critères), à chaque étape de vol
        const holdAlt = (c, m) => {
            m.measure('alt', Math.abs(c.altitudeFt - plan.alt));
            m.measure('ias', Math.abs(c.speedKt - SPEED));
        };
        // Tenue de la route (critères) : loin de la balise seulement (cône de silence, aiguille trop sensible)
        const tracking = (c, m) => {
            holdAlt(c, m);
            const v = c.nav?.vor;
            if (!v?.available || v.overhead || v.distance < NEAR_STATION) return;
            m.measure('cdi', Math.abs(v.deviation) * 100);
            m.measure('track', Math.abs(wrap(c.track - COURSE)));
        };
        const cruise = (heading, maxBank = 20) => ({ heading, maxBank, altitude: plan.alt, throttleSpeed: SPEED });
        const obsCentered = (c) => c.nav?.vor?.available && c.nav.vor.to && Math.abs(c.nav.vor.deviation) < 0.1;

        steps.push({
            title: T('Le VOR', 'The VOR'), target: ['inst:vor1', 'obs'],
            enter: (c) => { plan.alt = Math.round(c.altitudeFt / 100) * 100; plan.startHeading ??= Math.round(c.heading); },
            say: () => T(`Nous sommes à ${plan.alt} pieds, au sud de la balise VOR ESM, fréquence 113.50, déjà affichée sur la NAV 1. Le VOR émet 360 radiaux, comme les rayons d'une roue : le radial 090 part de la balise vers l'est. Sur l'indicateur, le bouton OBS choisit une route ; l'aiguille dit de quel côté elle est ; TO ou FROM dit si cette route vous mène vers la balise ou vous en éloigne. Pour savoir où nous sommes, tournez l'OBS jusqu'à centrer l'aiguille avec TO : touches J et K, ou H pour la centrer d'un coup.`,
                `We are at ${plan.alt} feet, south of the ESM VOR, frequency 113.50, already set on NAV 1. The VOR sends out 360 radials, like the spokes of a wheel: radial 090 leaves the station to the east. On the indicator, the OBS knob selects a course; the needle tells you on which side it lies; TO or FROM tells you whether that course takes you to the station or away from it. To find where we are, turn the OBS until the needle centres with TO: J and K keys, or H to centre it at once.`),
            why: T("Toujours vérifier l'indicatif morse avant de se fier à une balise : ici, ESM.", 'Always check the Morse identifier before trusting a station: here, ESM.'),
            measure: holdAlt,
            demo: (c) => cruise(plan.startHeading ??= Math.round(c.heading)),
            act: () => press('KeyH'),
            done: (c, f, dt) => (f.t = obsCentered(c) ? (f.t ?? 0) + dt : 0) > 1,
        });
        steps.push({
            title: T('Où sommes-nous ?', 'Where are we?'), next: true, camera: 'pilot',
            say: (c) => {
                const v = c.nav?.vor;
                const to = v ? v.bearingTo : 0, radial = v ? v.radial : 180;
                return T(`L'aiguille est centrée avec TO sur ${say360(to)} : en volant au ${say360(to)}, on rejoint la balise. Nous sommes donc sur le radial opposé, le ${say360(radial)}, qui part de la balise vers nous. Retenez : TO, la route affichée mène à la balise ; FROM, elle s'en éloigne.`,
                    `The needle is centred with TO on ${say360(to)}: flying ${say360(to)} takes us to the station. So we are on the opposite radial, ${say360(radial)}, which runs from the station to us. Remember: TO, the course shown leads to the station; FROM, it leads away from it.`);
            },
            measure: holdAlt,
            demo: (c) => cruise(plan.startHeading ??= Math.round(c.heading)),
        });
        steps.push({
            title: T('Afficher la route 360', 'Set course 360'), target: ['obs', 'inst:vor1'],
            say: T("Notre route : rejoindre la balise au 360, plein nord, puis continuer sur le radial 360. Affichez 360 à l'OBS. L'aiguille part en butée à gauche : la route est à gauche, à l'ouest. TO reste affiché : cette route mène à la balise.",
                'Our course: join the station on 360, due north, then carry on along radial 360. Set 360 on the OBS. The needle swings full left: the course is to the left, to the west. TO stays up: this course leads to the station.'),
            measure: holdAlt,
            demo: (c) => cruise(plan.startHeading ??= Math.round(c.heading)),
            act: (c) => turnObs(c.nav?.obs ?? 0, COURSE),
            done: (c) => Math.abs(wrap((c.nav?.obs ?? 0) - COURSE)) < 1 && c.nav?.vor?.to,
        });
        steps.push({
            title: T("Cap d'interception", 'Intercept heading'), camera: 'none',
            say: () => T(`Pour rejoindre la route, on la coupe à ${INTERCEPT} degrés : virez à gauche au cap ${say360(COURSE - INTERCEPT)}, à ${plan.alt} pieds et ${SPEED} nœuds. Surveillez l'aiguille : elle quitte la butée quand on approche de la route.`,
                `To join the course, cut it at ${INTERCEPT} degrees: turn left to heading ${say360(COURSE - INTERCEPT)}, at ${plan.alt} feet and ${SPEED} knots. Watch the needle: it leaves the stop as we get close to the course.`),
            why: T("Plus on est loin de la balise, plus l'aiguille est lente : un degré d'écart représente une distance plus grande.", 'The further from the station, the slower the needle: one degree of deviation is a greater distance.'),
            measure: holdAlt,
            demo: () => cruise(COURSE - INTERCEPT),
            done: (c) => c.nav?.vor?.available && Math.abs(c.nav.vor.deviation) < 0.6,
        });
        steps.push({
            title: T('Rejoindre la route', 'Joining the course'), camera: 'none',
            say: T("L'aiguille revient vers le centre : virez doucement vers le 360 en la suivant. Si elle ralentit avant le centre, gardez un peu d'angle ; si elle file, reprenez le 360 plus tôt.",
                'The needle is coming back to the centre: turn gently towards 360 as it moves. If it slows down before the centre, keep some angle; if it races, roll out on 360 earlier.'),
            measure: holdAlt,
            demo: (c) => cruise(headingFor(c, INTERCEPT)),
            done: (c, f, dt) => (f.t = c.nav?.vor?.available && Math.abs(c.nav.vor.deviation) < 0.15 && Math.abs(wrap(c.track - COURSE)) < 5
                ? (f.t ?? 0) + dt : 0) > 5,
        });
        steps.push({
            title: T('Tenir la route vers la balise', 'Tracking to the station'), camera: 'none',
            say: T("Nous sommes sur la route. Le vent d'est nous pousse vers l'ouest : si l'aiguille part à droite, prenez 5 degrés à droite, et gardez ce cap corrigé une fois l'aiguille revenue. Aiguille aux trois quarts de l'échelle au plus, route à 10 degrés près.",
                'We are on the course. The easterly wind pushes us west: if the needle moves right, take 5 degrees right, and keep that corrected heading once it is back. Needle within three quarters of the scale, track within 10 degrees.'),
            why: T("Corriger la dérive, c'est trouver le cap qui garde l'aiguille immobile, pas courir après elle.", 'Correcting for drift means finding the heading that keeps the needle still, not chasing it.'),
            measure: tracking,
            demo: (c) => cruise(headingFor(c, 6, plan, true)),
            done: (c) => c.nav?.vor?.available === true && c.nav.vor.to === false,
        });
        steps.push({
            title: T('Passage de la balise', 'Station passage'), camera: 'none',
            say: T("TO vient de passer à FROM : nous sommes au-dessus de la balise. Juste au-dessus, l'aiguille est folle : c'est le cône de silence. Gardez le cap, sans courir après l'aiguille. Nous suivons maintenant le radial 360 en nous éloignant.",
                'TO has just flipped to FROM: we are over the station. Right above it, the needle wanders: that is the cone of silence. Keep the heading, do not chase the needle. We are now following radial 360 outbound.'),
            measure: holdAlt,
            demo: () => cruise(COURSE + (plan.wca ?? 0)),
            done: (c) => c.nav?.vor?.available && !c.nav.vor.overhead && c.nav.vor.to === false && c.nav.vor.distance > NEAR_STATION * 1.25,
        });
        steps.push({
            title: T('Tenir le radial 360', 'Tracking radial 360'), camera: 'none',
            say: T("Tenez le radial 360 en éloignement pendant une minute, même méthode : l'OBS reste sur 360, FROM affiché, l'aiguille indique toujours de quel côté est la route.",
                'Track radial 360 outbound for one minute, same method: the OBS stays on 360, FROM shown, the needle still shows which side the course is.'),
            enter: () => tools.mark('outbound'),
            measure: tracking,
            demo: (c) => cruise(headingFor(c, 6, plan, true)),
            done: () => tools.since('outbound') > 60,
        });
        return steps;
    },
};
