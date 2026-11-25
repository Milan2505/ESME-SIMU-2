// Leçon 6 du lot 6 : atterrissage par vent de travers (js/lessons/index.js, moteur : js/Initiation.js). Départ en finale à
// 2,5 NM sur le plan de 3°, volets 30°, vent de 10 kt plein travers venant de la droite (vent forcé, sans rafale) ; finale
// en crabe, décrabage et aile basse dans le vent pour toucher sans dérive, puis roulage manche dans le vent.
//
// Critères (FAA-S-ACS-6C : dans la révision 6C, l'atterrissage par vent de travers est la tâche « Normal Approach and
// Landing », PA.IV.B, il n'y a plus de tâche séparée) :
// - vitesse d'approche +10 / -5 kt (PA.IV.B.S7 p. 20, « manufacturer's published approach airspeed … +10/-5 knots with
//   gust factor applied ») autour de 65 KIAS volets 30° (milieu de la plage 60-70 KIAS du POH 172P, section 4, « Speeds
//   for normal operation », non relu sur scan ; js/FlightReview.js THRESHOLDS.approach.targetFullFlaps) ;
// - route dans l'axe à ±10° en finale : l'ACS demande la correction de vent tout au long de l'approche (PA.IV.B.S8) sans
//   la chiffrer ; on retient la tolérance de suivi d'une radiobalise de l'EASA, « heading or tracking of radio aids
//   ±10° » (AMC1 FCL.235 (d)(2)), et la même valeur de l'ACS IR (cap ±10° avant le segment final, IR.VI.B.S9 p. 16) ;
// - vario en finale : pas plus de 1 000 ft/min sous 500 ft (FSF ALAR, Briefing Note 7.1, critère 5) ;
// - toucher « within 400 feet beyond or on the specified point, with no side drift, and with the airplane's longitudinal
//   axis aligned with and over the runway centerline » (PA.IV.B.S10 p. 20) : point visé à 240 m du seuil (js/Airport.js
//   AIMING_POINT), rien avant, 122 m (400 ft) au-delà ; les chiffres de l'axe (5 m), de la dérive (1 m/s) et de
//   l'alignement (5°) n'ont pas de source (l'ACS ne les chiffre pas) : non relus, comme THRESHOLDS.aim.lateral.
// Vent de travers de la leçon : 10 kt, sous le vent de travers maximal démontré de 15 kt (POH 172P section 4, « Maximum
// Demonstrated Crosswind Velocity », non relu sur scan).
//
// Démonstration du moniteur (crosswindDemo, pure, réglée sur le modèle réaliste par tests/lessons-vent-travers.test.js) :
// plan de 3° tenu au vario, vitesse aux gaz, crabe (route dans l'axe) ; sous 60 ft, aile basse : palonnier pour aligner
// le nez sur l'axe, inclinaison dans le vent pour tenir l'axe ; arrondi sous 18 ft, gaz réduits ; au sol, ailerons dans
// le vent et freins. Gains non relus (ce n'est pas une source).

const FT = 0.3048, KT = 0.514444, DEG = Math.PI / 180;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const FLARE_TO = 35;   // m après le point visé : toucher visé par la démonstration (fenêtre de 0 à 122 m ; l'avion flotte un peu plus loin)

export const CROSSWIND = {
    target: 65,            // KIAS, volets 30° (POH 172P sect. 4, non relu sur scan)
    above: 10, below: 5,   // ACS PA.IV.B.S7 p. 20
    track: 10,             // ° (EASA AMC1 FCL.235 (d)(2) ; ACS IR IR.VI.B.S9 p. 16)
    gate: 500,             // ft au-dessus du seuil : porte de stabilisation VMC (FSF BN 7.1)
    maxSink: 1000,         // ft/min (FSF BN 7.1)
    aimingPoint: 240,      // m après le seuil (js/Airport.js AIMING_POINT)
    beyond: 122,           // m : 400 ft au-delà du point (ACS PA.IV.B.S10 p. 20)
    lateral: 5,            // m de l'axe (non relu)
    drift: 1,              // m/s de dérive latérale (non relu)
    align: 5,              // ° entre le nez et l'axe (non relu)
    measureFrom: 50,       // ft : la finale se mesure de la porte jusqu'à 50 ft (passage du seuil, arrondi exclu)
    wind: { fromRunway: 90, knots: 10, gust: 0 },
};

// Démonstration : consignes du moniteur (InstructorPilot) d'après la situation c (Initiation._context) ; state : mémoire
// de la démonstration (intégrateurs), remise à zéro par l'appelant au début
export function crosswindDemo(c, state = {}) {
    const dt = state.t === undefined ? 0 : clamp(c.time - state.t, 0, 0.2);
    state.t = c.time;
    const gs = Math.max(c.groundKt * KT, 1);
    // Vitesse latérale vers la gauche de l'axe (m/s) ; vitesse voulue : retour vers l'axe sans à-coup
    const leftVel = -gs * Math.sin(c.trackToAxis * DEG);
    const wantedLeftVel = clamp(-0.12 * c.left, -2.5, 2.5);
    // Au sol : manche dans le vent (+ = à gauche), d'autant plus que le vent de travers est fort et la vitesse faible
    const crosswind = c.crosswind ?? 0;   // kt, + = venant de la droite
    const aileronIntoWind = -Math.sign(crosswind) * 0.6 * clamp(Math.abs(crosswind) / 15, 0, 1) * clamp(1.2 - c.groundKt / 60, 0.2, 1);

    if (c.onGround) {
        state.landed = true;
        // Nez sur l'axe au palonnier (+ = pied à gauche), un peu de rappel vers l'axe ; freins sous 50 kt
        const yaw = clamp(0.12 * (c.headingToAxis - clamp(0.3 * c.left, -6, 6)) - 0.05 * (c.yawRate ?? 0), -1, 1);
        return { elevator: c.groundKt > 40 ? 0 : 0.4, aileron: aileronIntoWind, yaw, throttle: 0, trim: false,
            brake: c.groundKt < 50 && c.groundKt > 2 };
    }
    // Plan de 3° vers le point visé (hauteur au-dessus du seuil, ft) et vario du plan
    // (plan visé au point)
    const pathFt = Math.tan(3 * DEG) * (CROSSWIND.aimingPoint - c.along) / FT;
    const vsPath = -gs * Math.tan(3 * DEG) / FT * 60;
    const height = c.aal;
    if (height > 100 && !state.decrab) {
        // Crabe : la route sur l'axe (cap corrigé de la dérive)
        const wantedTrack = clamp(0.06 * c.left, -12, 12);
        return { heading: c.heading + (wantedTrack - c.trackToAxis), maxBank: 15,
            vs: clamp(vsPath + 3 * (pathFt - height), -900, 0), throttleSpeed: CROSSWIND.target };
    }
    // Aile basse : nez sur l'axe au palonnier, axe tenu par l'inclinaison (+ = à droite, dans le vent venant de la droite)
    state.decrab = true;
    state.yawI = clamp((state.yawI ?? 0) + 0.04 * c.headingToAxis * dt, -0.8, 0.8);
    const yaw = clamp(0.06 * c.headingToAxis + state.yawI - 0.05 * (c.yawRate ?? 0), -1, 1);
    state.bankI = clamp((state.bankI ?? 0) + 2 * (leftVel - wantedLeftVel) * dt, -12, 12);
    const bank = clamp(7 * (leftVel - wantedLeftVel) + state.bankI, -15, 15);
    if (height > 15) return { bank, yaw, vs: clamp(vsPath + 5 * (pathFt - height), -700, 0), throttleSpeed: CROSSWIND.target };
    // Arrondi : gaz réduits, assiette relevée en descendant ; taux de chute visé pour toucher vers FLARE_TO m après le
    // point visé (plus loin que prévu : on laisse l'avion s'enfoncer un peu plus, jusqu'à 350 ft/min)
    state.flarePitch ??= c.pitch ?? 0;
    const sink = -c.vs;
    const left = CROSSWIND.aimingPoint + FLARE_TO - c.along;   // m restant jusqu'au toucher visé
    const wanted = left > 5 ? clamp(height * 60 * gs / left, 120, 300) : 300;
    const pitch = clamp(state.flarePitch + 0.5 * (15 - height) + 0.012 * (sink - wanted), state.flarePitch, 10);
    return { bank, yaw, pitch, throttle: 0 };
}

// Mesures de la leçon (pures : tools.measure / set / get) : finale de la porte de 500 ft jusqu'à 50 ft, puis le toucher
// (premier contact) ; prev : mémoire de l'image précédente (en vol ou non, vario)
export function crosswindMeasure(c, tools, prev) {
    const C = CROSSWIND;
    // (premières images de la leçon : la hauteur du contrôleur, c.agl, est encore celle d'avant la mise en place)
    prev.t0 ??= c.time;
    if (c.time - prev.t0 < 2) return;
    if (!c.onGround && c.aal <= C.gate && c.aal >= C.measureFrom && c.along < 0) {
        tools.measure('vitesseHaute', c.speedKt - C.target);
        tools.measure('vitesseBasse', C.target - c.speedKt);
        tools.measure('route', Math.abs(c.trackToAxis));
        tools.measure('vario', Math.max(0, -c.vs));
    }
    if (c.onGround && prev.airborne && tools.get('aimLong') === undefined) {
        const beyond = c.along - C.aimingPoint;
        const gs = c.groundKt * KT;
        tools.set('aimShort', Math.max(0, -beyond));
        tools.set('aimLong', beyond);
        tools.set('axe', Math.abs(c.left));
        tools.set('derive', Math.abs(gs * Math.sin(c.trackToAxis * DEG)));
        tools.set('alignement', Math.abs(c.headingToAxis));
        tools.set('varioToucher', Math.max(0, -(prev.vs ?? c.vs)));
    }
    prev.airborne = !c.onGround;
    if (!c.onGround) prev.vs = c.vs;
}

const SRC = {
    speed: 'FAA-S-ACS-6C, PA.IV.B.S7, p. 20 (+10/-5 kt) ; 65 KIAS volets 30° : POH 172P sect. 4 (non relu sur scan)',
    track: 'EASA AMC1 FCL.235 (d)(2), suivi ±10° ; FAA-S-ACS-8C, IR.VI.B.S9, p. 16',
    sink: 'Flight Safety Foundation, ALAR Briefing Note 7.1 (approche stabilisée, critère 5)',
    aim: 'FAA-S-ACS-6C, PA.IV.B.S10, p. 20 (« within 400 feet beyond or on the specified point »)',
    axis: 'FAA-S-ACS-6C, PA.IV.B.S10, p. 20 (« no side drift … aligned with and over the runway centerline ») ; valeur non relue',
};

export default {
    id: 'ventTravers',
    title: { fr: 'Atterrissage par vent de travers', en: 'Crosswind landing' },
    summary: { fr: 'Finale en crabe, décrabage et aile basse, toucher dans l\'axe sans dérive, vent de 10 kt plein travers.',
        en: 'Crabbed final, de-crab and wing-low, touch down on the centreline without drift, 10 kt direct crosswind.' },
    objectives: [
        { fr: 'Corriger la dérive en finale : route dans l\'axe à ±10°', en: 'Correct for drift on final: track the centreline within ±10°' },
        { fr: 'Tenir 65 kt +10/-5 kt en finale stabilisée', en: 'Hold 65 kt +10/-5 kt on a stabilised final' },
        { fr: 'Décraber et tenir l\'axe aile basse', en: 'De-crab and hold the centreline wing-low' },
        { fr: 'Toucher dans les 400 ft après le point visé, sans dérive, aligné sur l\'axe', en: 'Touch down within 400 ft beyond the aiming point, without drift, aligned with the centreline' },
    ],
    setup: { place: 'air', runway: 'active', at: 'final', distanceNm: 2.5, speedKt: 65, flaps: 3, throttle: 0.4, trimDeg: 25,
        wind: CROSSWIND.wind },
    advice: ['stall'],
    reviewKinds: ['touchdown-vs', 'bank-low', 'vfe', 'stall', 'load'],
    criteria: [
        { key: 'vitesseHaute', label: { fr: 'Finale : vitesse au-dessus de 65 kt', en: 'Final: speed above 65 kt' }, limit: CROSSWIND.above, compare: 'max', unit: 'kt', source: SRC.speed },
        { key: 'vitesseBasse', label: { fr: 'Finale : vitesse sous 65 kt', en: 'Final: speed below 65 kt' }, limit: CROSSWIND.below, compare: 'max', unit: 'kt', source: SRC.speed },
        { key: 'route', label: { fr: 'Finale : route par rapport à l\'axe', en: 'Final: track from centreline' }, limit: CROSSWIND.track, compare: 'max', unit: '°', source: SRC.track },
        { key: 'vario', label: { fr: 'Finale : taux de descente', en: 'Final: sink rate' }, limit: CROSSWIND.maxSink, compare: 'max', unit: 'ft/min', source: SRC.sink },
        { key: 'aimShort', label: { fr: 'Toucher avant le point visé', en: 'Touchdown short of the aiming point' }, limit: 0, compare: 'max', unit: 'm', source: SRC.aim, eliminatory: true },
        { key: 'aimLong', label: { fr: 'Toucher après le point visé', en: 'Touchdown beyond the aiming point' }, limit: CROSSWIND.beyond, compare: 'max', unit: 'm', source: SRC.aim },
        { key: 'axe', label: { fr: 'Toucher : écart à l\'axe', en: 'Touchdown: offset from centreline' }, limit: CROSSWIND.lateral, compare: 'max', unit: 'm', source: SRC.axis },
        { key: 'derive', label: { fr: 'Toucher : dérive latérale', en: 'Touchdown: side drift' }, limit: CROSSWIND.drift, compare: 'max', unit: 'm/s', source: SRC.axis },
        { key: 'alignement', label: { fr: 'Toucher : nez par rapport à l\'axe', en: 'Touchdown: nose from centreline' }, limit: CROSSWIND.align, compare: 'max', unit: '°', source: SRC.axis },
    ],
    build(lang, tools) {
        const { T } = tools;
        const prev = {};
        const demoState = {};
        // Vent de travers de la leçon (kt, + = venant de la droite)
        const crosswind = CROSSWIND.wind.knots * Math.sin(CROSSWIND.wind.fromRunway * DEG);
        const measure = (c, m) => crosswindMeasure(c, m, prev);
        const demo = (c) => {
            // (démonstration reprise après une pause : intégrateurs remis à zéro)
            if (demoState.t !== undefined && c.time - demoState.t > 0.5) for (const k of Object.keys(demoState)) delete demoState[k];
            const p = crosswindDemo({ ...c, crosswind }, demoState);
            // Freins : le moniteur freine au sol (frein de parc tenu pendant sa démonstration)
            // (InstructorPilot ignore la clé brake)
            if (c.controls && 'brake' in p) c.controls.parkingBrake = Boolean(p.brake);
            return p;
        };
        return [
            { title: T('Vent de travers', 'Crosswind'), next: true, camera: 'pilot', measure, demo,
                say: T('Nous sommes en finale à deux milles et demi, volets trente degrés, à 65 nœuds. Le vent souffle à 10 nœuds, plein travers, de la droite : il nous pousse vers la gauche de l\'axe. Le but : toucher sur l\'axe, sans dérive, le nez aligné sur la piste.',
                    'We are on final at two and a half miles, flaps thirty, at 65 knots. The wind is 10 knots, straight across from the right: it pushes us to the left of the centreline. The goal: touch down on the centreline, without drift, the nose aligned with the runway.'),
                why: T('Le vent de travers maximal démontré du Cessna 172 est de 15 nœuds.', 'The Cessna 172 maximum demonstrated crosswind is 15 knots.') },
            { title: T('Finale en crabe', 'Crabbed final'), camera: 'none', measure, demo,
                say: T('Tournez le nez vers la droite, dans le vent, jusqu\'à ce que la piste ne glisse plus dans le pare-brise : c\'est le crabe. La route reste sur l\'axe, à dix degrés près. Tenez 65 nœuds aux gaz et le plan au manche.',
                    'Turn the nose right, into the wind, until the runway stops sliding across the windscreen: that is the crab. The track stays on the centreline, within ten degrees. Hold 65 knots with power and the glide path with the yoke.'),
                why: T('En crabe, l\'avion vole droit dans la masse d\'air, la bille au milieu : le cap diffère de la route de l\'angle de dérive.', 'In a crab the aeroplane flies straight through the air mass, ball centred: heading differs from track by the drift angle.'),
                done: (c) => c.aal < CROSSWIND.gate },
            { title: T('Finale stabilisée', 'Stabilised final'), camera: 'none', measure, demo,
                say: T('Cinq cents pieds : l\'approche doit être stabilisée. Vitesse entre 60 et 75 nœuds, descente sous 1000 pieds par minute, dans l\'axe. Sinon : remise de gaz.',
                    'Five hundred feet: the approach must be stabilised. Speed between 60 and 75 knots, sink below 1000 feet per minute, on the centreline. Otherwise: go around.'),
                done: (c) => c.aal < 80 },
            { title: T('Décrabage, aile basse', 'De-crab, wing low'), camera: 'none', measure, demo,
                say: T('Pied gauche pour aligner le nez sur l\'axe, et en même temps inclinez à droite, dans le vent, juste assez pour ne plus dériver. Gardez l\'aile droite basse jusqu\'au toucher, sur la roue droite d\'abord.',
                    'Left rudder to line the nose up with the centreline, and at the same time bank right, into the wind, just enough to stop drifting. Keep the right wing low until touchdown, on the right wheel first.'),
                why: T('Toucher en crabe pousse le train de côté : l\'avion part en lacet vers le bord de piste.', 'Touching down in a crab loads the gear sideways: the aeroplane swerves toward the runway edge.'),
                done: (c) => c.onGround },
            { title: T('Roulage à l\'atterrissage', 'Landing roll'), camera: 'none', measure, demo,
                say: T('Posé. Manche à droite, dans le vent, de plus en plus en ralentissant ; l\'axe aux palonniers ; freinez, touche B.',
                    'Down. Yoke to the right, into the wind, more and more as you slow down; centreline with the rudder; brake, B key.'),
                done: (c) => c.onGround && c.groundKt < 12 },
        ];
    },
};
