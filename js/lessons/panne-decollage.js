// Leçon 3 du lot 6, première partie : panne moteur après le décollage (js/lessons/index.js, moteur : js/Initiation.js).
// Départ en montée initiale au-dessus du seuil de la piste 18 d'ESME, 150 ft, plein gaz, air calme ; panne totale à
// 300 ft au-dessus du terrain (moteur arrêté, démarreur sans effet : setEngineFailure de simulator.js). L'élève rend la
// main tout de suite (vitesse de plané), ne fait pas demi-tour, sécurise l'avion et se pose droit devant, dans la bande
// plate qui prolonge la piste (relief de la carte Campagne relevé : plat jusqu'à 1 800 m après le seuil de la 18).
// La seconde partie, panne en campagne et choix d'un champ, est la leçon js/lessons/panne-campagne.js.
//
// Sources :
// - EASA AMC1 FCL.235, épreuve PPL(A), section 5 a « Simulated engine failure after take-off (Single-Engine only) »
//   (formulaire DAC-LIC 111-13A, p. 5) : l'exercice est au programme de l'épreuve, sans tolérance chiffrée propre ;
// - FAA-S-ACS-6C : PA.IV.A.R3b (« potential engine failure in takeoff/climb phase of flight », p. 18) et PA.IX.B
//   (« Emergency Approach and Landing (Simulated) », p. 51-52) : S1 « establish and maintain the recommended best glide
//   airspeed, ±10 knots », S6 « complete the appropriate checklist(s) » ;
// - POH 172P section 3, « Engine Failure Immediately After Takeoff » : 65 KIAS volets rentrés (60 volets sortis),
//   mixture IDLE CUT-OFF, carburant coupé, contact OFF, volets à la demande, master OFF ; « Amplified Procedures » :
//   atterrissage prévu droit devant, avec de petits changements de direction seulement, la hauteur et la vitesse
//   suffisant rarement à un demi-tour en plané (copie remise en page du POH, non relu sur scan). Le 172P du jeu coupe
//   le carburant par le robinet d'essence (fuelShutoff), son sélecteur n'ayant pas de position OFF.
// - Écart de cap toléré pendant la panne : ±30° autour de l'axe (« petits changements de direction » : valeur non relue,
//   choix pédagogique) ; hauteur de la panne (300 ft) : choix de la leçon, sous toute hauteur de demi-tour possible.
// - Toucher : pas plus de THRESHOLDS.touchdown.severe (510 ft/min) de vitesse verticale, seuil du débriefing
//   (js/FlightReview.js : ancien 14 CFR 23.473(d), non relu).
//
// Démonstration du moniteur (forcedLandingDemo / glideFlare, pures, réglées sur le modèle réaliste au banc de
// tests/lessons-panne.test.js : gains non relus, ce n'est pas une source) : montée à Vy, nez bas 2 s à la panne puis
// 65 kt tenus à l'assiette, arrondi sous 40 ft (vario visé proportionnel à la hauteur), roulage ailes à plat.
import { THRESHOLDS } from '../FlightReview.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const wrap = (a) => ((a % 360) + 540) % 360 - 180;

export const FAILURE = {
    glide: 65,          // KIAS, volets rentrés (POH 172P sect. 3, non relu sur scan)
    glideTol: 10,       // kt (ACS PA.IX.B.S1 p. 52)
    vy: 74,             // KIAS, montée initiale (POH 172P sect. 4, Vy au niveau de la mer, non relu sur scan)
    failAt: 300,        // ft au-dessus du terrain : panne de la leçon (choix pédagogique)
    heading: 30,        // ° : droit devant, petits changements de direction seulement (non relu)
    flare: 40,          // ft : début de l'arrondi de la démonstration
    measureFrom: 50,    // ft : vitesse de plané relevée au-dessus (arrondi exclu)
    settle: 5,          // s après la panne : plané établi (la vitesse de montée retombe vers 65 kt)
};

// Arrondi de la démonstration (vario visé proportionnel à la hauteur, assiette ajustée) ; null : pas encore. state :
// mémoire de la démonstration (arrondi commencé)
export function glideFlare(c, state) {
    const h = c.agl;
    if (h > FAILURE.flare && !state.flare) return null;
    state.flare = true;
    const vsTarget = -Math.max(120, h * 20);
    return { pitch: clamp(c.pitch + 0.015 * (vsTarget - c.vs), -2, 10) };
}

// Au sol : ailes à plat, freins serrés sous 40 kt (POH 172P sect. 3 : « Brakes -- APPLY HEAVILY » ; InstructorPilot ne
// freine pas : frein de parking, comme js/lessons/vent-travers.js)
export function groundRoll(c, heading) {
    if (c.controls) c.controls.parkingBrake = c.groundKt < 40;
    return { pitch: 2, heading, maxBank: 0 };
}

// Démonstration : montée, panne, plané droit devant, arrondi, roulage. heading : cap de la piste (°)
export function forcedLandingDemo(c, state, heading) {
    if (c.onGround) return groundRoll(c, heading);
    if (!c.engineFailed) return { speed: FAILURE.vy, throttle: 1, heading, maxBank: 10 };
    state.failedAt ??= c.time;
    const flare = glideFlare(c, state);
    if (flare) return { ...flare, heading, maxBank: 5 };
    if (c.time - state.failedAt < 2) return { pitch: 0, heading, maxBank: 10 };   // rendre la main tout de suite
    return { speed: FAILURE.glide, heading, maxBank: 10 };
}

// Avion sécurisé avant le toucher (POH 172P sect. 3) : mixture IDLE CUT-OFF, robinet d'essence fermé, contact OFF,
// master OFF
export const secured = (c) => c.sys.mixture < 0.05 && c.sys.fuelShutoff && c.sys.magnetos === 0 && !c.sys.switches.masterBat;

// Mesures après la panne, communes aux étapes : vitesse (réaction et plané), cap, toucher (vario, avion sécurisé)
export function measureFailure(c, tools, heading) {
    const p = tools.plan;
    if (!c.engineFailed || tools.since('panne') === Infinity) return;
    if (c.airborne) {
        if (c.agl > FAILURE.measureFrom) {
            tools.measure('vmin', c.speedKt);
            if (tools.since('panne') > FAILURE.settle) tools.measure('plane', c.speedKt - FAILURE.glide);
        }
        tools.measure('cap', Math.abs(wrap(c.heading - heading)));
        p.lastVs = c.vs;
    } else if (c.onGround && !p.touched) {
        p.touched = true;
        tools.measure('toucher', Math.max(0, -(p.lastVs ?? c.vs)));
        tools.set('securite', secured(c));
        tools.measure('cap', Math.abs(wrap(c.heading - heading)));
    }
}

export default {
    id: 'panne-decollage',
    title: { fr: 'Panne moteur au décollage', en: 'Engine failure after take-off' },
    summary: { fr: 'Panne totale à 300 ft en montée initiale : plané, pas de demi-tour, atterrissage droit devant.',
        en: 'Total failure at 300 ft in the initial climb: glide, no turning back, landing straight ahead.' },
    objectives: [
        { fr: 'Rendre la main tout de suite : jamais sous 55 kt', en: 'Lower the nose at once: never below 55 kt' },
        { fr: 'Planer à 65 kt ±10', en: 'Glide at 65 kt ±10' },
        { fr: 'Pas de demi-tour : droit devant à ±30°', en: 'No turning back: straight ahead within ±30°' },
        { fr: 'Sécuriser l\'avion avant le toucher', en: 'Secure the aeroplane before touchdown' },
        { fr: 'Se poser sans casse', en: 'Land without damage' },
    ],
    setup: {
        place: 'air', runway: '18', along: 0, lateral: 0, altitudeFt: 150, heading: 'runway',
        speedKt: 70, flaps: 0, throttle: 1, trimDeg: 8, wind: 'calm',
    },
    advice: ['stall'],
    reviewKinds: ['stall', 'load'],
    criteria: [
        { key: 'vmin', label: { fr: 'Vitesse la plus basse après la panne', en: 'Lowest speed after the failure' }, limit: FAILURE.glide - FAILURE.glideTol,
          compare: 'min', unit: 'kt', source: 'FAA-S-ACS-6C, PA.IX.B.S1, p. 52 (65 KIAS ±10 : POH 172P sect. 3, non relu sur scan)' },
        { key: 'plane', label: { fr: 'Vitesse de plané (écart à 65 kt)', en: 'Glide speed (deviation from 65 kt)' }, limit: FAILURE.glideTol,
          compare: 'abs', unit: 'kt', source: 'FAA-S-ACS-6C, PA.IX.B.S1, p. 52 ; POH 172P sect. 3, Engine Failure Immediately After Takeoff (non relu sur scan)' },
        { key: 'cap', label: { fr: 'Écart à l\'axe (pas de demi-tour)', en: 'Deviation from the runway heading (no turning back)' }, limit: FAILURE.heading,
          compare: 'max', unit: '°', eliminatory: true, weight: 2,
          source: 'POH 172P sect. 3, Amplified Procedures : droit devant, petits changements de direction (non relu sur scan) ; ±30° : choix pédagogique, non relu' },
        { key: 'securite', label: { fr: 'Mixture, essence, contact et master coupés avant le toucher', en: 'Mixture, fuel, ignition and master off before touchdown' },
          compare: 'bool', limit: true, source: 'POH 172P sect. 3, Engine Failure Immediately After Takeoff (non relu sur scan) ; FAA-S-ACS-6C, PA.IX.B.S6, p. 52' },
        { key: 'toucher', label: { fr: 'Vitesse verticale au toucher', en: 'Touchdown sink rate' }, limit: THRESHOLDS.touchdown.severe,
          compare: 'max', unit: 'ft/min', source: 'js/FlightReview.js THRESHOLDS.touchdown.severe : ancien 14 CFR 23.473(d), non relu' },
    ],
    build(lang, tools) {
        const { T } = tools;
        const plan = tools.plan;
        const demoState = {};
        const heading = () => plan.heading ?? 180;
        const demo = (c) => {
            plan.heading ??= c.runway?.heading ?? c.heading;
            return forcedLandingDemo(c, demoState, heading());
        };
        const measure = (c, t) => measureFailure(c, t, heading());
        return [
            { title: T('Montée initiale', 'Initial climb'), next: true, flight: true, camera: 'pilot', demo,
              say: T('Nous venons de décoller de la piste 18 : plein gaz, montée à 74 nœuds. Vers 300 pieds, je coupe le moteur. Vous rendez la main aussitôt, et vous restez droit devant.',
                  'We have just taken off from runway 18: full power, climbing at 74 knots. At about 300 feet I will cut the engine. Lower the nose at once, and stay straight ahead.'),
              why: T("Sous la hauteur de sécurité, le demi-tour vers la piste tue : en virage serré, sans moteur, l'avion décroche et part en vrille près du sol. On se pose devant soi, à peine à gauche ou à droite.",
                  'Below a safe height, turning back to the runway kills: in a steep gliding turn without power the aeroplane stalls and spins close to the ground. Land ahead, only slightly left or right.') },
            { title: T('Panne moteur !', 'Engine failure!'), flight: true, camera: 'none', urgent: true, target: 'inst:asi', demo, measure,
              wait: (c) => c.aal >= FAILURE.failAt,
              enter: () => {
                  tools.failEngine();
                  tools.mark('panne');
              },
              say: T('Panne moteur ! Rendez la main : nez en bas, 65 nœuds. Droit devant.', 'Engine failure! Lower the nose: 65 knots. Straight ahead.'),
              why: T("En montée, l'avion n'a plus que quelques secondes de vitesse : sans le nez en bas tout de suite, il décroche.",
                  'In the climb the aeroplane has only a few seconds of speed left: without the nose down at once, it stalls.'),
              // (panne faite : sinon l'étape, encore en attente de ses 300 ft, passerait pour déjà accomplie)
              done: (c) => c.engineFailed && tools.since('panne') > 4 && Math.abs(c.speedKt - FAILURE.glide) < 8 && c.pitch < 6 },
            { title: T('Sécuriser l\'avion', 'Secure the aeroplane'), flight: true, camera: 'none', demo, measure,
              target: ['mixture', 'fuelShutoff', 'mags', 'switch:masterBat'],
              act: (c) => {
                  if (c.sys.mixture > 0) c.sys.setMixture(0);
                  if (!c.sys.fuelShutoff) c.sys.toggleFuelShutoff();
                  if (c.sys.magnetos !== 0) c.sys.turnMagnetos(-c.sys.magnetos);
                  if (c.sys.switches.masterBat) c.sys.toggle('masterBat');
                  if (c.sys.switches.masterAlt) c.sys.toggle('masterAlt');
              },
              done: (c) => secured(c),
              say: T("Droit devant, choisissez où vous poser. Sécurisez : mixture tirée, robinet d'essence fermé, magnétos sur OFF, master coupé.",
                  'Straight ahead, pick your landing spot. Secure the aeroplane: mixture to cut-off, fuel valve closed, magnetos OFF, master off.'),
              why: T("Carburant et contact coupés : moins de risque d'incendie au toucher. Gardez les yeux dehors, la vitesse d'abord.",
                  'Fuel and ignition off: less risk of fire on touchdown. Keep your eyes outside, airspeed first.') },
            { title: T('Atterrissage droit devant', 'Landing straight ahead'), flight: true, camera: 'none', demo, measure,
              done: (c) => c.onGround && c.groundKt < 3,
              say: T("Gardez 65 nœuds jusqu'au sol. Vers 40 pieds, arrondissez doucement, ailes à plat, et laissez l'avion se poser. Restez dans l'axe et freinez fort, touche B, jusqu'à l'arrêt.",
                  'Keep 65 knots down to the ground. At about 40 feet, flare gently, wings level, and let the aeroplane settle. Keep straight and brake hard, B key, until it stops.') },
        ];
    },
};
