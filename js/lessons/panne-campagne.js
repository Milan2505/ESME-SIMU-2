// Leçon 3 du lot 6, seconde partie : panne moteur en campagne (js/lessons/index.js, moteur : js/Initiation.js ; première
// partie, la panne au décollage : js/lessons/panne-decollage.js). Départ en croisière à 2 000 ft au-dessus d'ESME, 95 kt,
// à 4 km au nord du seuil de la piste 18 et 2 km à l'est de son axe, cap à l'ouest, air calme ; panne totale après le
// briefing. L'élève prend la vitesse de meilleure finesse, choisit son champ (le meilleur à portée : la piste d'ESME et la
// bande plate qui la prolonge), tente la remise en route (check-list), sécurise l'avion, gère son plané par un point clé
// en finale, sort les volets selon le besoin, coupe le master et se pose dans le champ.
//
// Sources :
// - FAA-S-ACS-6C, PA.IX.B « Emergency Approach and Landing (Simulated) », p. 52 : S1 « establish and maintain the
//   recommended best glide airspeed, ±10 knots » ; S2 configuration selon le POH ; S3 « select a suitable landing area
//   considering altitude, wind, terrain, obstructions, and available glide distance » ; S4 « plan and follow a flightpath
//   to the selected landing area » ; S6 « complete the appropriate checklist(s) » ;
// - EASA AMC1 FCL.235, épreuve PPL(A), section 5 b « Simulated forced landing (Single-Engine only) » (formulaire
//   DAC-LIC 111-13A, p. 5), sans tolérance plus stricte que l'ACS ;
// - POH 172P section 3 (copie remise en page, non relu sur scan) : « Engine Failure During Flight (Restart Procedures) »
//   65 KIAS, réchauffe carburateur ON, sélecteur BOTH, mixture RICH, contact BOTH (START si l'hélice est arrêtée),
//   primer verrouillé ; « Emergency Landing Without Engine Power » : 65 KIAS volets rentrés (60 volets sortis), mixture
//   IDLE CUT-OFF, carburant coupé (le 172P du jeu : robinet d'essence), contact OFF, volets à la demande (30°
//   recommandés), master OFF, toucher légèrement queue basse ;
// - finesse : environ 9 à 65 KIAS, soit 1,5 NM par 1 000 ft (POH 172P fig. 3-1 p. 3-11, relue : tests/perf-c172.test.js) ;
// - toucher : pas plus de THRESHOLDS.touchdown.severe (510 ft/min), seuil du débriefing (js/FlightReview.js, non relu).
// Le champ est reconnu par la géométrie : de 300 m avant le seuil de la 18 à 1 800 m après (piste de 1 000 m puis bande
// plate relevée sur le relief de la carte Campagne), à moins de 150 m de l'axe (relevé du relief, pas une source).
//
// Démonstration du moniteur (fieldPlan, pure, réglée au banc de tests/lessons-panne.test.js : gains et marges non relus,
// ce n'est pas une source) : point clé dans l'axe, à une distance du seuil choisie pour un plané de 8 (plus court que la
// finesse de 9 : marge pour les virages) ; en finale, volets d'un cran toutes les 4 s quand l'avion est trop haut (moins
// de 7,5 m parcourus par mètre de hauteur), 60 kt volets sortis ; arrondi de js/lessons/panne-decollage.js.
import { THRESHOLDS } from '../FlightReview.js';
import { FAILURE, glideFlare, groundRoll } from './panne-decollage.js';

const FT = 0.3048;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const wrap = (a) => ((a % 360) + 540) % 360 - 180;

export const FIELD = {
    from: -300, to: 1800, half: 150,   // m : champ par rapport au seuil de la 18 (avant / après le seuil, de part et d'autre de l'axe)
    aim: 300,                          // m après le seuil : point visé
    ratio: 8,                          // m parcourus par mètre de hauteur, pour placer le point clé (finesse ~9, POH fig. 3-1)
    steep: 7.5,                        // en finale, plus raide que cela : trop haut, volets
    minFinal: 1000, maxFinal: 4000,    // m : longueur de finale (point clé)
    glideFlaps: 60,                    // KIAS volets sortis (POH 172P sect. 3, non relu sur scan)
};

export const inField = (c) => c.along >= FIELD.from && c.along <= FIELD.to && Math.abs(c.left) <= FIELD.half;

// Point clé : distance de finale (m avant le seuil) qui fait parcourir FIELD.ratio m par mètre de hauteur jusqu'au point
// visé ; route vers ce point (° par rapport à l'axe, + = à droite)
export function keyPoint(c) {
    const h = Math.max(1, c.aal * FT);
    let final = FIELD.minFinal;
    for (; final < FIELD.maxFinal; final += 50) {
        if (Math.hypot(c.along + final, c.left) + final + FIELD.aim >= FIELD.ratio * h) break;
    }
    const bearing = Math.atan2(c.left, -final - c.along) * 180 / Math.PI;
    return { final, bearing, distance: Math.hypot(c.along + final, c.left) };
}

// Aligné en finale : près de l'axe, cap dans l'axe, avant le bout du champ
export const onFinal = (c) => Math.abs(c.left) < FIELD.half && Math.abs(c.headingToAxis) < 20 && c.along > -FIELD.maxFinal - 500 && c.along < FIELD.to;

// Démonstration : plané vers le point clé, finale, volets, arrondi. state : mémoire (phase, volets, arrondi)
export function fieldPlan(c, state) {
    const rw = c.runway.heading;
    if (c.onGround) return groundRoll(c, rw);
    const axis = rw + clamp(c.left * 0.06, -30, 30);
    const flare = glideFlare(c, state);
    if (flare) return { ...flare, heading: rw + clamp(c.left * 0.06, -10, 10), maxBank: 5 };
    const speed = c.flaps > 0 ? FIELD.glideFlaps : FAILURE.glide;
    state.phase ??= 'key';
    if (state.phase === 'key') {
        const key = keyPoint(c);
        if (key.distance < 350 || c.along > -key.final) state.phase = 'final';
        return { speed, heading: rw + key.bearing, maxBank: 30 };
    }
    // Finale : trop haut -> un cran de volets de plus (toutes les 4 s, sous 1 000 ft), tant que le master est sur ON
    const steep = (FIELD.aim - c.along) / Math.max(1, c.aal * FT);
    if (c.aal < 1000 && steep < FIELD.steep && c.flaps < 3 && c.time - (state.flapAt ?? -99) > 4 && c.sys?.switches.masterBat) {
        state.flapAt = c.time;
        c.controls.setFlapLevel(c.flaps + 1);
    }
    return { speed, heading: axis, maxBank: 20 };
}

const secured = (c) => c.sys.mixture < 0.05 && c.sys.fuelShutoff && c.sys.magnetos === 0;
const restartDone = (c) => c.sys.switches.carbHeat && c.sys.fuelSelector === 1 && c.sys.mixture >= 0.95 && c.sys.magnetos === 3;

// Heure (1 à 12) d'un relèvement relatif (° par rapport au nez)
const clock = (relative) => ((Math.round(wrap(relative) / 30) + 12) % 12) || 12;

export default {
    id: 'panne-campagne',
    title: { fr: 'Panne moteur en campagne', en: 'Engine failure en route' },
    summary: { fr: 'Panne à 2 000 ft : meilleure finesse, choix d\'un champ, check-lists, plané jusqu\'au champ.',
        en: 'Failure at 2,000 ft: best glide, choosing a field, checklists, gliding to the field.' },
    objectives: [
        { fr: 'Tenir la vitesse de meilleure finesse : 65 kt ±10', en: 'Hold best glide speed: 65 kt ±10' },
        { fr: 'Choisir un champ à portée de plané et s\'y rendre', en: 'Choose a field within gliding range and fly to it' },
        { fr: 'Check-list de remise en route, puis de sécurisation', en: 'Restart checklist, then securing checklist' },
        { fr: 'Se poser dans le champ, sans casse', en: 'Land in the field, without damage' },
    ],
    setup: {
        place: 'air', runway: '18', along: -4000, lateral: 2000, altitudeFt: 2000, heading: 270,
        speedKt: 95, flaps: 0, throttle: 0.68, wind: 'calm',
    },
    advice: ['stall'],
    reviewKinds: ['stall', 'load'],
    criteria: [
        { key: 'plane', label: { fr: 'Vitesse de plané (écart à 65 kt)', en: 'Glide speed (deviation from 65 kt)' }, limit: FAILURE.glideTol,
          compare: 'abs', unit: 'kt', source: 'FAA-S-ACS-6C, PA.IX.B.S1, p. 52 ; 65 KIAS : POH 172P sect. 3 (non relu sur scan)' },
        { key: 'redemarrage', label: { fr: 'Check-list de remise en route', en: 'Restart checklist' }, compare: 'bool', limit: true,
          source: 'POH 172P sect. 3, Engine Failure During Flight (non relu sur scan) ; FAA-S-ACS-6C, PA.IX.B.S6, p. 52' },
        { key: 'securite', label: { fr: 'Mixture, essence, contact et master coupés avant le toucher', en: 'Mixture, fuel, ignition and master off before touchdown' },
          compare: 'bool', limit: true, source: 'POH 172P sect. 3, Emergency Landing Without Engine Power (non relu sur scan) ; FAA-S-ACS-6C, PA.IX.B.S6, p. 52' },
        { key: 'champ', label: { fr: 'Posé dans le champ choisi', en: 'Landed in the chosen field' }, compare: 'bool', limit: true, weight: 2, eliminatory: true,
          source: 'FAA-S-ACS-6C, PA.IX.B.S3 et S4, p. 52 (champ à portée, trajectoire jusqu\'au champ)' },
        { key: 'toucher', label: { fr: 'Vitesse verticale au toucher', en: 'Touchdown sink rate' }, limit: THRESHOLDS.touchdown.severe,
          compare: 'max', unit: 'ft/min', source: 'js/FlightReview.js THRESHOLDS.touchdown.severe : ancien 14 CFR 23.473(d), non relu' },
    ],
    build(lang, tools) {
        const { T, EN } = tools;
        const plan = tools.plan;
        const state = {};
        const cruise = (c) => {
            plan.cruise ??= { altitude: Math.round(c.altitudeFt / 10) * 10, heading: c.heading };
            return { altitude: plan.cruise.altitude, heading: plan.cruise.heading, maxBank: 10, throttleSpeed: 95 };
        };
        const glide = (c) => {
            if (!c.engineFailed) return cruise(c);
            const flare = glideFlare(c, state);
            if (flare) return { ...flare, heading: plan.cruise?.heading ?? c.heading, maxBank: 5 };
            return { speed: FAILURE.glide, heading: plan.cruise?.heading ?? c.heading, maxBank: 10 };
        };
        const toField = (c) => (c.engineFailed ? fieldPlan(c, state) : cruise(c));
        // Mesures après la panne : vitesse de plané volets rentrés (au-dessus de 300 ft, une fois la vitesse de croisière
        // échangée contre de la hauteur), puis au toucher : vario, avion sécurisé, dans le champ
        const measure = (c) => {
            if (!c.engineFailed || tools.since('panne') === Infinity) return;
            if (c.airborne) {
                if (c.flaps === 0 && c.agl > 300 && tools.since('panne') > 8) tools.measure('plane', c.speedKt - FAILURE.glide);
                plan.lastVs = c.vs;
            } else if (c.onGround && !plan.touched) {
                plan.touched = true;
                tools.measure('toucher', Math.max(0, -(plan.lastVs ?? c.vs)));
                tools.set('securite', secured(c) && !c.sys.switches.masterBat);
                tools.set('champ', inField(c));
            }
        };
        // Où est le champ : heure (relèvement relatif) et distance (NM) du seuil
        const where = (c) => {
            const bearing = wrap(c.runway.heading + Math.atan2(c.left, -c.along) * 180 / Math.PI - c.heading);
            const nm = Math.hypot(c.along, c.left) / 1852;
            return { hour: clock(bearing), nm: (Math.round(nm * 10) / 10).toLocaleString(EN ? 'en' : 'fr') };
        };
        const reach = (c) => (Math.round(c.aal / 1000 * 1.5 * 10) / 10).toLocaleString(EN ? 'en' : 'fr');
        return [
            { title: T('Croisière', 'Cruise'), next: true, flight: true, camera: 'pilot', demo: cruise,
              say: T("Nous sommes en croisière à 2000 pieds au-dessus du terrain. Dans un instant, je simule une panne moteur. Vitesse de meilleure finesse, choix d'un champ, check-lists, puis plané jusqu'au champ.",
                  "We are cruising at 2000 feet above the airfield. In a moment I will simulate an engine failure. Best glide speed, choosing a field, checklists, then glide to the field."),
              why: T("Avec 2000 pieds et une finesse de 9, l'avion plane environ 3 milles nautiques : 1,5 mille par tranche de 1000 pieds.",
                  'With 2000 feet and a glide ratio of 9, the aeroplane glides about 3 nautical miles: 1.5 miles per 1000 feet.') },
            { title: T('Panne moteur !', 'Engine failure!'), flight: true, camera: 'none', urgent: true, target: 'inst:asi', demo: glide, measure,
              enter: () => {
                  tools.failEngine();
                  tools.mark('panne');
              },
              say: T('Panne moteur ! Tirez doucement : la vitesse retombe vers 65 nœuds, puis tenez-la. Trimez.',
                  'Engine failure! Ease back: let the speed come back to 65 knots, then hold it. Trim.'),
              why: T("65 nœuds, c'est la vitesse de meilleure finesse : le plus de distance pour la hauteur perdue. Plus vite ou plus lent, on va moins loin.",
                  '65 knots is the best glide speed: the most distance for the height lost. Faster or slower, you go less far.'),
              done: (c) => c.engineFailed && tools.since('panne') > 5 && Math.abs(c.speedKt - FAILURE.glide) < 8 },
            { title: T('Choix d\'un champ', 'Choosing a field'), flight: true, camera: 'none', demo: toField, measure,
              done: (c, f, dt) => (f.t = Math.abs(wrap(c.runway.heading + keyPoint(c).bearing - c.heading)) < 20 ? (f.t ?? 0) + dt : 0) > 3,
              say: (c) => {
                  const w = where(c);
                  return T(`Choisissez un champ à portée : avec ${Math.round(c.aal / 100) * 100} pieds, environ ${reach(c)} milles. Le meilleur champ, c'est une piste : l'aérodrome est à ${w.hour} heures, ${w.nm} mille. Prenez la piste 18 et la bande d'herbe qui la prolonge. Virez vers un point à 1 ou 2 kilomètres dans l'axe, avant le seuil.`,
                      `Choose a field within reach: with ${Math.round(c.aal / 100) * 100} feet, about ${reach(c)} miles. The best field is a runway: the airfield is at ${w.hour} o'clock, ${w.nm} miles. Take runway 18 and the grass strip beyond it. Turn towards a point 1 or 2 kilometres out on the extended centreline.`);
              },
              why: T("Un bon champ : assez long, plat, sans obstacle à l'approche, face au vent, et à portée de plané avec de la marge. On s'y rend d'abord, on règle la hauteur ensuite, au-dessus.",
                  'A good field: long enough, flat, no obstacles on the approach, into wind, and within gliding range with a margin. Get there first, sort out the height afterwards, overhead.') },
            { title: T('Remise en route', 'Restart checklist'), flight: true, camera: 'none', demo: toField,
              target: ['switch:carbHeat', 'fuelSelector', 'mixture', 'mags'],
              act: (c) => {
                  if (!c.sys.switches.carbHeat) c.sys.toggle('carbHeat');
                  if (c.sys.fuelSelector !== 1) c.sys.turnFuelSelector(1 - c.sys.fuelSelector);
                  if (c.sys.mixture < 1) c.sys.setMixture(1);
                  if (c.sys.magnetos !== 3) c.sys.turnMagnetos(3 - c.sys.magnetos);
              },
              measure: (c) => {
                  measure(c);
                  if (restartDone(c)) tools.set('redemarrage', true);
              },
              done: (c) => restartDone(c),
              say: T('En route vers le champ, la check-list de remise en route : réchauffe carburateur tirée, sélecteur sur les deux réservoirs, mixture plein riche, magnétos sur BOTH.',
                  'On the way to the field, the restart checklist: carburettor heat on, fuel selector on both tanks, mixture rich, magnetos on BOTH.'),
              why: T('Givrage du carburateur ou réservoir vide : ces gestes font souvent repartir le moteur. Aujourd\'hui, il ne repartira pas.',
                  'Carburettor ice or an empty tank: these actions often bring the engine back. Today it will not restart.') },
            { title: T('Sécuriser l\'avion', 'Secure the aeroplane'), flight: true, camera: 'none', demo: toField, measure,
              target: ['mixture', 'fuelShutoff', 'mags'],
              act: (c) => {
                  if (c.sys.mixture > 0) c.sys.setMixture(0);
                  if (!c.sys.fuelShutoff) c.sys.toggleFuelShutoff();
                  if (c.sys.magnetos !== 0) c.sys.turnMagnetos(-c.sys.magnetos);
              },
              done: (c) => secured(c),
              say: T("Le moteur ne repart pas : on se pose. Sécurisez : mixture tirée, robinet d'essence fermé, magnétos sur OFF. Le master reste sur ON pour les volets.",
                  'The engine will not restart: we land. Secure the aeroplane: mixture to cut-off, fuel valve closed, magnetos OFF. Leave the master ON for the flaps.') },
            { title: T('Point clé et finale', 'Key point and final'), flight: true, camera: 'none', demo: toField, measure,
              done: (c) => onFinal(c),
              say: T("Gérez votre hauteur : rejoignez l'axe de la piste assez loin, et alignez-vous. Trop haut en finale, sortez les volets : la pente s'accentue, 60 nœuds volets sortis. Trop bas, rentrez moins de volets, jamais moins de vitesse.",
                  'Manage your height: join the runway centreline far enough out, and line up. Too high on final, lower the flaps: the glide steepens, 60 knots with flaps. Too low, use less flap, never less speed.') },
            { title: T('Champ assuré : master OFF', 'Field made: master OFF'), flight: true, camera: 'none', demo: toField, measure,
              target: 'switch:masterBat', wait: (c) => c.aal < 500 || c.onGround,
              act: (c) => {
                  if (c.aal >= 500 && !c.onGround) return;   // (pas avant le moment de l'étape : les volets ont besoin du master)
                  if (c.sys.switches.masterBat) c.sys.toggle('masterBat');
                  if (c.sys.switches.masterAlt) c.sys.toggle('masterAlt');
              },
              done: (c) => !c.sys.switches.masterBat,
              say: T('Le champ est assuré : volets réglés, master sur OFF.', 'The field is made: flaps set, master OFF.') },
            { title: T('Atterrissage dans le champ', 'Landing in the field'), flight: true, camera: 'none', demo: toField, measure,
              done: (c) => c.onGround && c.groundKt < 3,
              say: T("Vers 40 pieds, arrondissez doucement, ailes à plat, queue un peu basse. Restez dans l'axe et freinez fort, touche B, jusqu'à l'arrêt.",
                  'At about 40 feet, flare gently, wings level, tail slightly low. Keep straight and brake hard, B key, until it stops.') },
        ];
    },
};
