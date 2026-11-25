// Leçon 2 du lot 6 : virages à grande inclinaison (js/lessons/index.js, moteur : js/Initiation.js). Départ en vol à
// 3 000 ft au-dessus d'ESME, 90 kt en palier ; un 360° à 45° d'inclinaison à gauche, puis aussitôt un 360° à droite.
//
// Critères : FAA-S-ACS-6C (Private Pilot, Airplane, novembre 2023), tâche PA.V.A « Steep Turns », Skills S3 à S5, p. 36 :
// vitesse d'entrée du constructeur, sinon au plus VA ; virage coordonné de 360° à environ 45° d'inclinaison, puis dans
// l'autre sens ; altitude d'entrée ±100 ft, vitesse ±10 kt, inclinaison ±5°, sortie sur le cap d'entrée ±10°. L'EASA
// (AMC1 FCL.235 : ±150 ft, ±15 kt) est plus large : on garde l'ACS.
// Vitesse d'entrée : 90 kt, sous la VA du 172P à toutes les masses de la leçon (99 KIAS à 2 400 lb, 92 KIAS à 2 000 lb :
// POH 172P fig. 2-1, non relu sur scan).
// L'inclinaison est jugée une fois le virage établi (de 30° à 320° de virage) ; altitude et vitesse de la mise en virage
// à la sortie ; la sortie, ailes revenues à plat (moins de 5°) après au moins 330° de virage.

export const STEEP = {
    bank: 45,          // ° (ACS PA.V.A)
    bankTol: 5,        // °
    altTol: 100,       // ft
    speedTol: 10,      // kt
    rollTol: 10,       // ° sur le cap d'entrée
    speed: 90,         // KIAS : vitesse d'entrée (≤ VA, POH 172P fig. 2-1, non relu sur scan)
    from: 30, to: 320, // ° de virage où l'inclinaison est jugée (virage établi)
    rollout: 330,      // ° de virage au moins avant de juger la sortie
    rollLead: 35,      // ° avant le cap d'entrée où le moniteur commence la sortie (démonstration)
};

const SRC = 'FAA-S-ACS-6C, PA.V.A (Steep Turns), S3 à S5, p. 36';

// Démonstration d'un virage (side -1 : gauche, 1 : droite) : 45° jusqu'à rollLead degrés du cap d'entrée, puis sortie sur
// le cap d'entrée ; altitude et vitesse d'entrée tenues (pure : testée par tests/lessons-virages45.test.js)
export function steepTurnDemo(turned, side, entry) {
    const plan = { altitude: entry.altitude, throttleSpeed: entry.speed };
    if (Math.abs(turned) < 360 - STEEP.rollLead) return { ...plan, bank: STEEP.bank * side };
    return { ...plan, heading: entry.heading, maxBank: STEEP.bank };
}

// Mesures d'un virage (pures) : écarts d'inclinaison, d'altitude, de vitesse, et cap à la sortie ; rend vrai une fois
// la sortie jugée
export function steepTurnMeasure(c, tools, turned, side, entry, headingDiff) {
    const t = Math.abs(turned);
    tools.measure('altitude', Math.abs(c.altitudeFt - entry.altitude));
    tools.measure('vitesse', Math.abs(c.speedKt - entry.speed));
    if (t >= STEEP.from && t <= STEEP.to) tools.measure('inclinaison', Math.abs(c.bank - STEEP.bank * side));
    if (t >= STEEP.rollout && Math.abs(c.bank) < 5) {
        tools.measure('sortie', headingDiff(c.heading, entry.heading));
        return true;
    }
    return false;
}

export default {
    id: 'virages45',
    title: { fr: 'Virages à grande inclinaison', en: 'Steep turns' },
    summary: { fr: '360° à 45° d\'inclinaison, à gauche puis à droite, à altitude et vitesse constantes.',
        en: '360° turns at 45° of bank, left then right, at constant altitude and speed.' },
    objectives: [
        { fr: 'Tenir 45° d\'inclinaison à ±5°', en: 'Hold 45° of bank within ±5°' },
        { fr: 'Tenir l\'altitude d\'entrée à ±100 ft', en: 'Hold the entry altitude within ±100 ft' },
        { fr: 'Tenir la vitesse d\'entrée à ±10 kt', en: 'Hold the entry airspeed within ±10 kt' },
        { fr: 'Sortir sur le cap d\'entrée à ±10°', en: 'Roll out on the entry heading within ±10°' },
    ],
    setup: { place: 'air', runway: 'active', along: -6000, lateral: 3000, altitudeFt: 3000, heading: 'runway', speedKt: STEEP.speed,
        flaps: 0, throttle: 0.62, trimDeg: 10, wind: 'calm' },
    advice: ['stall'],
    reviewKinds: ['load', 'stall', 'vne'],
    criteria: [
        { key: 'inclinaison', label: { fr: 'Inclinaison (écart à 45°)', en: 'Bank (deviation from 45°)' }, limit: STEEP.bankTol, compare: 'max', unit: '°', source: SRC },
        { key: 'altitude', label: { fr: 'Altitude (écart à l\'entrée)', en: 'Altitude (deviation from entry)' }, limit: STEEP.altTol, compare: 'max', unit: 'ft', source: SRC },
        { key: 'vitesse', label: { fr: 'Vitesse (écart à l\'entrée)', en: 'Airspeed (deviation from entry)' }, limit: STEEP.speedTol, compare: 'max', unit: 'kt', source: SRC },
        { key: 'sortie', label: { fr: 'Sortie (écart au cap d\'entrée)', en: 'Roll-out (deviation from entry heading)' }, limit: STEEP.rollTol, compare: 'max', unit: '°', source: SRC },
    ],
    build(lang, tools) {
        const { T, headingDiff } = tools;
        const plan = tools.plan;
        // Palier de croisière : altitude et cap du départ, 90 kt
        const cruise = (c) => {
            plan.cruise ??= { altitude: Math.round(c.altitudeFt / 10) * 10, heading: Math.round(c.heading) };
            return { altitude: plan.cruise.altitude, heading: plan.cruise.heading, throttleSpeed: STEEP.speed };
        };
        // Entrée d'un virage : altitude et vitesse de référence fixées au premier virage (gardées pour le second), cap
        // d'entrée de chaque virage
        const enterTurn = (name) => (c) => {
            tools.track(name);
            plan.ref ??= { altitude: c.altitudeFt, speed: c.speedKt };
            plan[name] = { altitude: plan.ref.altitude, speed: plan.ref.speed, heading: c.heading, done: false };
        };
        const turn = (name, side) => ({
            camera: 'none', enter: enterTurn(name),
            measure: (c, m) => {
                const e = plan[name];
                if (e && !e.done) e.done = steepTurnMeasure(c, m, m.turned(name), side, e, headingDiff);
            },
            demo: (c) => (plan[name] ? steepTurnDemo(tools.turned(name), side, plan[name]) : cruise(c)),
            done: () => Boolean(plan[name]?.done),
        });
        const stable = (c) => Math.abs(c.vs) < 200 && Math.abs(c.bank) < 5 && Math.abs(c.speedKt - STEEP.speed) < 6;
        return [
            { title: T('Virages à 45°', 'Steep turns'), next: true, camera: 'pilot', demo: cruise,
                say: T('Nous sommes en palier à 3000 pieds, à 90 nœuds. Aujourd\'hui : virages à grande inclinaison, 45 degrés, un tour complet à gauche puis un à droite. Il faut tenir l\'altitude à 100 pieds près, la vitesse à 10 nœuds près, l\'inclinaison à 5 degrés près, et ressortir sur le cap d\'entrée à 10 degrés près.',
                    'We are level at 3000 feet, at 90 knots. Today: steep turns, 45 degrees of bank, a full turn to the left then one to the right. Hold altitude within 100 feet, airspeed within 10 knots, bank within 5 degrees, and roll out on the entry heading within 10 degrees.'),
                why: T('Ce sont les tolérances de l\'examen pratique FAA (ACS, tâche Steep Turns).', 'These are the FAA practical test tolerances (ACS, Steep Turns task).') },
            { title: T('Palier de référence', 'Reference level flight'), camera: 'none', demo: cruise,
                say: T('Stabilisez le palier à 90 nœuds, ailes à plat. Repérez votre cap et votre altitude : ce seront vos références. Regardez dehors, le trafic est dégagé.',
                    'Settle in level flight at 90 knots, wings level. Note your heading and altitude: they are your references. Look outside, the area is clear.'),
                done: (c, f, dt) => (f.t = stable(c) ? (f.t ?? 0) + dt : 0) > 5 },
            { title: T('360° à gauche', '360° to the left'), ...turn('g', -1),
                say: T('Inclinez à gauche jusqu\'à 45 degrés, en coordonnant au palonnier. Passé 30 degrés, tirez pour garder l\'altitude et ajoutez un peu de puissance pour garder la vitesse. Gardez l\'horizon fixe sur le capot. Commencez la sortie une vingtaine de degrés avant le cap d\'entrée.',
                    'Roll left to 45 degrees, coordinating with the rudder. Past 30 degrees, pull to hold altitude and add a little power to hold airspeed. Keep the horizon fixed on the cowling. Start rolling out about twenty degrees before the entry heading.'),
                why: T('À 45 degrés, le facteur de charge vaut 1,4 g : l\'aile doit porter 40 % de plus, et la vitesse de décrochage monte d\'environ 19 %.', 'At 45 degrees, the load factor is 1.4 g: the wing must lift 40 % more, and the stall speed rises by about 19 %.') },
            { title: T('360° à droite', '360° to the right'), ...turn('d', 1),
                say: T('Aussitôt, dans l\'autre sens : inclinez à droite jusqu\'à 45 degrés. Même altitude, même vitesse. À droite, le couple de l\'hélice demande un peu plus de pied droit.',
                    'Straight away, the other way: roll right to 45 degrees. Same altitude, same airspeed. To the right, the propeller torque needs a little more right rudder.') },
        ];
    },
};
