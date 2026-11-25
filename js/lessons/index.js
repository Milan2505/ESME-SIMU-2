// Registre des leçons d'initiation du lot 6 (moteur : js/Initiation.js ; notation : js/LessonGrade.js ; démonstrations du
// moniteur : js/InstructorPilot.js ; départ : startLesson dans simulator.js). Les leçons historiques (tour de piste,
// niveaux 1 et 2, et pilote automatique 'ap') restent dans Initiation.js.
//
// Une leçon = un module js/lessons/<id>.js qui exporte par défaut :
//
// export default {
//     id: 'virages45',                                     // identifiant (progression, carnet de vols : meta.lesson)
//     title: { fr: 'Virages à grande inclinaison', en: 'Steep turns' },
//     summary: { fr: '360° à 45° d'inclinaison, à gauche puis à droite.', en: '…' },
//     objectives: [{ fr: 'Tenir 45° ±5° d'inclinaison', en: 'Hold 45° ±5° of bank' }, …],
//     // Départ (startLesson, simulator.js) ; toutes les clés sont facultatives
//     setup: {
//         place: 'air',               // 'air' (en vol), 'runway' (aligné au seuil, moteur en marche), 'stand' (parking, éteint)
//         runway: 'active',           // 'active' (piste en service) ou nom de piste ('36', '18')
//         along: -15000, lateral: 0,  // m par rapport au seuil (along > 0 : vers le bout de piste ; lateral > 0 : à gauche)
//         // ou at: 'final' (+ distanceNm, sur le plan de 3°), 'downwind' (vent arrière, travers du seuil)
//         altitudeFt: 3000,           // au-dessus du seuil (sinon : sur le plan de 3° en finale)
//         heading: 'runway',          // 'runway', 'runway+180', ou cap en degrés
//         speedKt: 95, flaps: 0, throttle: 0.68, trimDeg: 8,
//         wind: 'calm',               // 'calm', { fromRunway: 90, knots: 12, gust: 0 } (° par rapport à l'axe, + = de la droite),
//                                     // ou absent (vent tiré, comme le tour de piste)
//         load: 'utility',            // masse en catégorie utilitaire (moniteur + élève, banquette et soute vides)
//         nav1: '113.50', obs: 270,   // NAV 1 (fréquence active) et OBS
//         engine: true,               // moteur en marche (place 'air' et 'runway')
//     },
//     advice: ['stall', 'carbHeatIdle'], // conseils automatiques du moniteur gardés (Initiation._adviseFlight ; aucun par défaut)
//     reviewKinds: ['load', 'vne'],  // écarts du débriefing (FlightReview.review) qui pénalisent la note ('crash' toujours)
//     criteria: [                    // critères notés (LessonGrade.grade), chacun avec sa source
//         { key: 'bank', label: { fr: 'Inclinaison (écart à 45°)', en: 'Bank (deviation from 45°)' }, limit: 5, compare: 'max',
//           unit: '°', source: 'FAA-S-ACS-6C, PA.V.A.S3, p. 36' },
//     ],
//     // Étapes, au format de buildSteps (Initiation.js), plus :
//     //   measure(c, tools, dt) : appelé à chaque image pendant l'étape (consigne dite), pour mesurer les critères
//     //     (tools.measure(key, valeur) garde la pire valeur selon le critère) ;
//     //   demo(c) : consignes du moniteur quand il montre (bouton Montrer, et _autoDo des tests) : voir InstructorPilot.js
//     //     ({ bank, heading, pitch, altitude, vs, speed, throttle, throttleSpeed, yaw, elevator, aileron, trim }) ;
//     //   enter(c, initiation) : par exemple tools.failEngine() pour la panne.
//     // Le bilan (note dite et affichée) est ajouté à la fin par Initiation.js.
//     build(lang, tools) {
//         const { T } = tools;
//         return [
//             { title: T('Virage à gauche', 'Left turn'), say: T('…', '…'), camera: 'none',
//               measure: (c, m) => { if (m.turned('g') > 30) m.measure('bank', Math.abs(c.bank + 45)); },
//               demo: (c) => ({ bank: -45, altitude: tools.plan.altitude, throttleSpeed: 95 }),
//               done: (c, f) => tools.turned('g') >= 360 },
//         ];
//     },
// };
//
// Outils (tools) passés à build : T(fr, en), lang, wrap(a) (-180..180), headingDiff(a, b), capSay(h), KT ;
// measure(key, valeur) / set(key, valeur) / get(key) (this.results) ; mark(nom) / since(nom) (horloge de la leçon, s) ;
// track(nom, cap) / turned(nom) (degrés tournés depuis track, signés : + = à droite) ; failEngine() / restoreEngine() ;
// plan (objet libre, partagé entre les étapes) ; lesson (la définition).
//
// Leçons du lot 6, dans l'ordre du dialogue d'initiation : décrochages, virages à 45°, panne moteur, VOR, ILS, vent de
// travers, vrille. Chaque leçon s'ajoute ici par son import :
import decrochages from './decrochages.js';
import virages45 from './virages45.js';
// (panne moteur : deux leçons, au décollage puis en campagne, chacune avec son départ, sa note et sa progression)
import panneDecollage from './panne-decollage.js';
import panneCampagne from './panne-campagne.js';
import vor from './vor.js';
import ils from './ils.js';
import ventTravers from './vent-travers.js';
import vrille from './vrille.js';

export const LESSONS = [
    // decrochages, virages45, panne, vor, ils, ventTravers, vrille,
    decrochages,
    virages45,
    panneDecollage,
    panneCampagne,
    vor,
    ils,
    ventTravers,
    vrille,
];

export function lessonById(id) {
    return LESSONS.find((lesson) => lesson.id === id) ?? null;
}
