// Relevé automatique des écarts d'un vol enregistré (lot 5 : rejeu et débriefing). Pur : ni DOM ni three, travaille
// sur le format de js/FlightRecorder.js ({ meta, samples, events }). review(flight, context) rend la liste des écarts
// triée par instant, chacun avec une phrase courte pour l'élève.
//
// Conventions des échantillons (js/FlightRecorder.js) : ias en kt, agl / aal en ft, vs en ft/min, bank en ° (+ à
// droite), loc et gsDev pleine échelle ±1 (null sans ILS ; loc > 0 : avion à gauche de l'axe, gsDev > 0 : avion trop
// bas, comme js/ILS.js), ground et stall à 0 ou 1. Événement touchdown : { x, z, impact (m/s, vers le bas), throttle }.

const FT = 0.3048;

// Seuils : chacun avec sa source ; « non relu » : aucune source primaire trouvée ou relue (dit à chaque fois).
// Sources (lot 6, relues en texte intégral) :
// - ACS : FAA-S-ACS-6C, Private Pilot for Airplane Category Airman Certification Standards, novembre 2023 (pages
//   imprimées) ;
// - ACS IR : FAA-S-ACS-8C, Instrument Rating – Airplane ACS (pages imprimées) ;
// - EASA : AMC1 FCL.235 « Flight test tolerance » (Part-FCL, appliqué par la DGAC), retenu seulement là où il est plus
//   strict que l'ACS (il est en général plus large : ±150 ft, ±10°, +15 / -5 kt) ;
// - FSF : Flight Safety Foundation, ALAR Tool Kit, Briefing Note 7.1, « Recommended Elements of a Stabilized Approach » ;
// - POH 172P : manuel de vol 1985 (D1251-13) ; « non relu sur scan » : valeur lue sur une copie remise en page.
export const THRESHOLDS = {
    approach: {
        // Vitesse visée : 65 kt volets ≥ 25°, 70 kt sinon (js/Initiation.js : « retrimez pour 65 nœuds » en finale
        // volets 30°) ; milieux des plages du POH 172P sect. 4 « Speeds for normal operation » : approche 65-75 KIAS
        // volets rentrés, 60-70 KIAS volets 30° (non relu sur scan)
        targetFullFlaps: 65, targetOther: 70, fullFlapsDeg: 25,
        // Tolérance +10 / -5 kt : ACS PA.IV.B.S7 p. 20 (« manufacturer's published approach airspeed … +10/-5 knots
        // with gust factor applied »)
        above: 10, below: 5,
        // Porte de stabilisation : 500 ft au-dessus de l'aérodrome en VMC (FSF BN 7.1) ; vitesse et vario relevés en
        // finale sous cette porte seulement
        gate: 500,
        // Vario en finale : pas plus de 1 000 ft/min (FSF BN 7.1, critère 5)
        maxSink: 1000,
        minDuration: 3,
    },
    // Finale repérée par la géométrie (finalSegments) : en descente (vario sous -100 ft/min), avant le seuil, à moins de
    // 5 NM (9 260 m) et sous 1 000 ft au-dessus du seuil (porte de stabilisation IMC, FSF BN 7.1) ; route sol à ±30°
    // de l'axe, mesurée sur 1 s (dérive de vent de travers comprise : le cap seul ne suffit pas) ; dans un cône de 10°
    // de demi-angle autour de l'axe (cap ±10° avant le segment final : ACS IR IR.VI.B.S9 p. 16) élargi de 100 m (le
    // couloir de la piste, aim.corridor). Les ±30°, -100 ft/min et 100 m sont des choix de détection (non relu : pas de
    // source)
    final: { maxHeight: 1000, maxDistance: 9260, track: 30, cone: 10, corridor: 100, minDescent: -100, trackWindow: 1,
        minMove: 5, minDuration: 3 },
    // Inclinaison au-delà de 30° sous 500 ft : feuille de route (docs/feuille-de-route.md, lot 5), non relu : ni l'ACS
    // ni l'EASA ne chiffrent l'inclinaison en tour de piste ; au-dessus de 30 ft seulement, comme l'alarme
    // d'inclinaison (js/BankAngleWarning.js MIN_HEIGHT)
    bankLow: { bank: 30, below: 500, above: 30, minDuration: 1 },
    // Vitesse verticale au toucher (ft/min). warn 300 : non relu (l'ACS PA.IV.B.S10 ne chiffre pas le toucher : « proper
    // pitch attitude ») ; severe 510 : vitesse de chute limite du train de l'ancien 14 CFR 23.473(d), 4,4 (W/S)^0,25
    // ft/s, soit 8,5 ft/s pour 2 400 lb / 174 ft² (non relu : le 172 est certifié CAR 3, équivalence non relue) ; le
    // modèle casse le train à 6 m/s (js/Cessna172.js crashSink), ~1 181 ft/min ; rebonds : contacts à moins de 2 s
    // comptés comme un seul toucher
    touchdown: { warn: 300, severe: 510, crashSink: 6, bounceWindow: 2 },
    // Point d'aboutissement : marques à 240 m du seuil (js/Airport.js AIMING_POINT). Fenêtre de l'ACS : « within 400 feet
    // beyond or on the specified point » (PA.IV.B.S10 p. 20) : rien avant le point (short 0), 122 m (400 ft) au-delà ;
    // 61 m (200 ft) en atterrissage court (PA.IV.F.S10 p. 25). Axe : 5 m (non relu : l'ACS dit seulement « aligned with
    // and over the runway centerline ») ; piste reconnue de 300 m avant le seuil au bout, à moins de 100 m de l'axe
    aim: { aimingPoint: 240, short: 0, beyondNormal: 122, beyondShort: 61, lateral: 5, before: 300, corridor: 100 },
    // ILS sous 1 000 ft (porte IMC, FSF BN 7.1), écart tenu 2 s. warn 0,5 pleine échelle : « within one dot of the
    // glideslope and localizer » (FSF BN 7.1), un point valant une demi-échelle sur l'affichage à 2 points par côté
    // (conversion). severe 0,75 : « no more than ¾-scale deflection of either the vertical or lateral guidance » de la
    // FAF à la DA (ACS IR IR.VI.B.S12 p. 16). Les messages comptent en points du CDI du jeu (5 par côté)
    ils: { below: 1000, warn: 0.5, severe: 0.75, minDuration: 2 },
    // VFE du 172P : 110 KIAS jusqu'à 10° de volets, 85 KIAS au-delà (POH 172P fig. 2-1, non relu sur scan ; haut de
    // l'arc blanc à 85 kt : js/FlightHud.js ARCS, js/InstrumentArt.js)
    vfe: { upTo10: 110, beyond10: 85, minDuration: 1 },
    // VNE 163 KIAS (trait rouge, js/FlightHud.js ARCS.vne), non relu : la copie remise en page du POH 172P (fig. 2-1,
    // 2-2) donne 158 KIAS, 163 étant la valeur des 172R/S ; à arbitrer avec le trait rouge du HUD sur la TCDS 3A12
    vne: { ias: 163, minDuration: 1 },
    // Décrochage : sévère sous 1 500 ft du sol (« completed no lower than 1,500 feet AGL » : ACS PA.VII.B.S2 et
    // PA.VII.C.S2 p. 43-44)
    stall: { severeBelow: 1500 },
    // Facteur de charge, catégorie normale : +3,8 g / -1,52 g volets rentrés (14 CFR 23.337(a)(1) et (b), avant
    // l'amendement 23-64 ; POH 172P p. 2-8), +3,0 g volets sortis (POH 172P p. 2-8, non relu sur scan)
    load: { max: 3.8, min: -1.52, maxFlaps: 3.0, minDuration: 0.3 },
    // Gaz au toucher : plus de 30 % de la manette (non relu : pas de source)
    throttleTouchdown: { max: 0.3 },
};

// Écarts relevés par appareil : le Cessna a tout ; F-15 et R44 seulement inclinaison basse, toucher, décrochage, crash
const CHECKS = {
    c172: new Set(['approach-speed', 'approach-sink', 'bank-low', 'touchdown-vs', 'touchdown-aim', 'ils', 'vfe', 'vne',
        'stall', 'load', 'throttle-touchdown', 'crash']),
    f15: new Set(['bank-low', 'touchdown-vs', 'stall', 'crash']),
    r44: new Set(['bank-low', 'touchdown-vs', 'stall', 'crash']),
};

const round = (v, step = 1) => Math.round(v / step) * step;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// Suites d'échantillons consécutifs où predicate(sample, index) est vrai, tenues au moins minDuration secondes.
// Durée d'une suite : du premier échantillon vrai au premier échantillon faux qui suit (au dernier échantillon si le
// vol s'arrête dedans). Rend [{ t0, t1, i0, i1 }] (i0, i1 : premier et dernier échantillons vrais).
export function episodes(samples, predicate, minDuration = 0) {
    const out = [];
    let i0 = -1;
    const close = (iEnd, tEnd) => {
        const t0 = samples[i0].t;
        if (tEnd - t0 >= minDuration) out.push({ t0, t1: tEnd, i0, i1: iEnd });
        i0 = -1;
    };
    for (let i = 0; i < samples.length; i++) {
        const ok = !!predicate(samples[i], i);
        if (ok && i0 < 0) i0 = i;
        else if (!ok && i0 >= 0) close(i - 1, samples[i].t);
    }
    if (i0 >= 0) close(samples.length - 1, samples[samples.length - 1].t);
    return out;
}

// Position par rapport au point d'aboutissement : along (m, + = au-delà, long), lateral (m, + = à gauche de l'axe)
export function aimOffset(point, runway) {
    const dx = point.x - runway.aimPoint.x;
    const dz = point.z - runway.aimPoint.z;
    return {
        along: dx * runway.direction.x + dz * runway.direction.z,
        lateral: dx * runway.left.x + dz * runway.left.z,
    };
}

// Piste où se trouve le point : celle dont le seuil est le plus proche, si le point est entre 300 m avant le seuil et
// le bout, à moins de 100 m de l'axe ; sinon null
export function runwayFor(point, runways = []) {
    let best = null;
    let bestDistance = Infinity;
    for (const runway of runways) {
        const d = Math.hypot(point.x - runway.threshold.x, point.z - runway.threshold.z);
        if (d < bestDistance) { best = runway; bestDistance = d; }
    }
    if (!best) return null;
    const dx = point.x - best.threshold.x;
    const dz = point.z - best.threshold.z;
    const along = dx * best.direction.x + dz * best.direction.z;
    const lateral = dx * best.left.x + dz * best.left.z;
    const { before, corridor } = THRESHOLDS.aim;
    if (along < -before || along > (best.length ?? Infinity) || Math.abs(lateral) >= corridor) return null;
    return best;
}

// Finale repérée par la géométrie (THRESHOLDS.final) : suites d'échantillons en vol, en descente, avant le seuil d'une
// piste, à moins de 5 NM et sous 1 000 ft au-dessus du seuil, dans le cône de l'axe, la route sol (sur 1 s) à ±30° du
// sens d'atterrissage, donc en rapprochement du seuil ; jusqu'au seuil. Rend [{ t0, t1, i0, i1, runway }], tenues au
// moins minDuration s. Sans pistes (carte Mer, vol d'une autre carte) : pas de finale.
export function finalSegments(samples = [], runways = [], minDuration = THRESHOLDS.final.minDuration) {
    if (!samples?.length || !runways?.length) return [];
    const F = THRESHOLDS.final;
    const cosTrack = Math.cos(F.track * Math.PI / 180);
    const tanCone = Math.tan(F.cone * Math.PI / 180);
    const onFinal = new Array(samples.length).fill(null);
    let j = 0;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        // Échantillon de référence de la route : le plus récent au moins trackWindow s avant (le premier sinon)
        while (j + 1 < i && s.t - samples[j + 1].t >= F.trackWindow) j++;
        if (j >= i || !airborne(s) || !num(s.x) || !num(s.z) || !num(s.aal) || !num(s.vs)) continue;
        if (s.aal > F.maxHeight || s.vs >= F.minDescent) continue;
        const p = samples[j];
        if (!num(p.x) || !num(p.z)) continue;
        const mx = s.x - p.x, mz = s.z - p.z;
        const moved = Math.hypot(mx, mz);
        if (moved < F.minMove) continue;
        for (const runway of runways) {
            const dx = s.x - runway.threshold.x, dz = s.z - runway.threshold.z;
            const along = dx * runway.direction.x + dz * runway.direction.z;   // < 0 : avant le seuil
            if (along > 0 || -along > F.maxDistance) continue;
            const lateral = dx * runway.left.x + dz * runway.left.z;
            if (Math.abs(lateral) > F.corridor - along * tanCone) continue;
            if ((mx * runway.direction.x + mz * runway.direction.z) / moved < cosTrack) continue;
            onFinal[i] = runway;
            break;
        }
    }
    return episodes(samples, (s, i) => onFinal[i] !== null, minDuration).map((ep) => ({ ...ep, runway: onFinal[ep.i1] }));
}

// VFE selon le braquage des volets (°) : 110 KIAS jusqu'à 10°, 85 au-delà ; volets rentrés : pas de VFE (Infinity)
export function vfeFor(flapsDeg) {
    if (!num(flapsDeg) || flapsDeg < 0.5) return Infinity;
    return flapsDeg <= 10 ? THRESHOLDS.vfe.upTo10 : THRESHOLDS.vfe.beyond10;
}

// Hauteur retenue près du sol : la plus petite de agl et aal (aal absent : agl)
const lowHeight = (s) => (num(s.aal) ? Math.min(s.agl, s.aal) : s.agl);
const airborne = (s) => !s.ground;
const approachTarget = (s) => (num(s.flaps) && s.flaps >= THRESHOLDS.approach.fullFlapsDeg
    ? THRESHOLDS.approach.targetFullFlaps : THRESHOLDS.approach.targetOther);

// Échantillon le plus proche de l'instant t (échantillons triés)
function sampleAt(samples, t) {
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].t < t) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(samples[lo - 1].t - t) <= Math.abs(samples[lo].t - t)) return samples[lo - 1];
    return samples[lo];
}

// Échantillon d'un épisode qui maximise score(sample)
function extreme(samples, ep, score) {
    let best = samples[ep.i0];
    for (let i = ep.i0 + 1; i <= ep.i1; i++) if (score(samples[i]) > score(best)) best = samples[i];
    return best;
}

function finding(kind, ep, severity, message, value, limit) {
    return { kind, t: ep.t0, t0: ep.t0, t1: ep.t1, severity, message, value, limit };
}

// Échantillons de finale (finalSegments) sous la porte de stabilisation : tableau de booléens par échantillon
function stabilizedFinal(samples, runways) {
    const A = THRESHOLDS.approach;
    const flags = new Array(samples.length).fill(false);
    for (const seg of finalSegments(samples, runways)) {
        for (let i = seg.i0; i <= seg.i1; i++) flags[i] = samples[i].aal <= A.gate;
    }
    return flags;
}

function approachSpeed(samples, inFinal, out) {
    const A = THRESHOLDS.approach;
    const dev = (s) => s.ias - approachTarget(s);
    for (const ep of episodes(samples, (s, i) => inFinal[i] && (dev(s) > A.above || dev(s) < -A.below), A.minDuration)) {
        const s = extreme(samples, ep, (x) => Math.abs(dev(x)));
        const target = approachTarget(s);
        const fast = dev(s) > 0;
        const ias = round(s.ias);
        out.push(finding('approach-speed', ep, 'warn', fast
            ? `Approche trop rapide : ${ias} kt pour ${target} kt visés.`
            : `Approche trop lente : ${ias} kt pour ${target} kt visés.`,
        ias, fast ? target + A.above : target - A.below));
    }
}

function approachSink(samples, inFinal, out) {
    const A = THRESHOLDS.approach;
    for (const ep of episodes(samples, (s, i) => inFinal[i] && num(s.vs) && -s.vs > A.maxSink, A.minDuration)) {
        const s = extreme(samples, ep, (x) => -x.vs);
        const fpm = round(-s.vs, 10);
        out.push(finding('approach-sink', ep, 'warn',
            `Descente trop rapide en finale : ${fpm} ft/min ; pas plus de ${A.maxSink} ft/min.`, fpm, A.maxSink));
    }
}

function bankLow(samples, out) {
    const B = THRESHOLDS.bankLow;
    const pred = (s) => airborne(s) && Math.abs(s.bank) > B.bank && lowHeight(s) < B.below && lowHeight(s) > B.above;
    for (const ep of episodes(samples, pred, B.minDuration)) {
        const s = extreme(samples, ep, (x) => Math.abs(x.bank));
        const bank = round(Math.abs(s.bank));
        out.push(finding('bank-low', ep, 'warn',
            `Inclinaison de ${bank}° à ${round(lowHeight(s), 10)} ft du sol : pas plus de ${B.bank}° sous ${B.below} ft.`,
            bank, B.bank));
    }
}

// Touchers regroupés par série de rebonds (contacts à moins de 2 s) : [{ first, strongest, count }]
function touchdownSeries(events) {
    const list = events.filter((e) => e.kind === 'touchdown').sort((a, b) => a.t - b.t);
    const series = [];
    for (const e of list) {
        const last = series[series.length - 1];
        if (last && e.t - last.lastT < THRESHOLDS.touchdown.bounceWindow) {
            last.count++;
            last.lastT = e.t;
            if ((e.impact ?? 0) > (last.strongest.impact ?? 0)) last.strongest = e;
        } else series.push({ first: e, strongest: e, count: 1, lastT: e.t });
    }
    return series;
}

// Impact d'un toucher (m/s vers le bas) : celui de l'événement, sinon la vitesse verticale enregistrée juste avant
function impactOf(event, samples) {
    if (num(event.impact)) return event.impact;
    let worst = 0;
    for (const s of samples) {
        if (s.t > event.t) break;
        if (s.t >= event.t - 1 && num(s.vs)) worst = Math.max(worst, -s.vs * FT / 60);
    }
    return worst;
}

function touchdowns(samples, events, context, checks, out) {
    const T = THRESHOLDS.touchdown;
    const M = THRESHOLDS.aim;
    const runways = context.runways ?? [];
    for (const serie of touchdownSeries(events)) {
        const first = serie.first;
        const ep = { t0: first.t, t1: serie.lastT };
        const bounce = serie.count > 1 ? ' (avec rebond)' : '';
        if (checks.has('touchdown-vs')) {
            const impact = impactOf(serie.strongest, samples);
            const fpm = round(impact / FT * 60, 10);
            if (fpm > T.warn) {
                const broken = impact >= T.crashSink ? ' : le train ne tient pas' : '';
                out.push(finding('touchdown-vs', ep, fpm > T.severe ? 'severe' : 'warn',
                    `Toucher dur${bounce} : ${fpm} ft/min${broken} ; visez moins de ${T.warn} ft/min.`,
                    fpm, fpm > T.severe ? T.severe : T.warn));
            }
        }
        if (checks.has('touchdown-aim') && runways.length) {
            const s = samples.length ? sampleAt(samples, first.t) : null;
            const point = num(first.x) && num(first.z) ? { x: first.x, z: first.z } : s && { x: s.x, z: s.z };
            if (!point) continue;
            const runway = runwayFor(point, runways);
            if (!runway) {
                out.push(finding('touchdown-aim', ep, 'info', 'Toucher hors piste.', null, null));
            } else {
                const { along, lateral } = aimOffset(point, runway);
                const name = runway.name ? ` ${runway.name}` : '';
                const d = round(Math.abs(along));
                if (along < -M.aimingPoint) {
                    out.push(finding('touchdown-aim', ep, 'severe',
                        `Toucher avant le seuil de la piste${name}, ${round(-along - M.aimingPoint)} m trop tôt.`,
                        round(along), -M.aimingPoint));
                } else if (along > M.beyondNormal) {
                    out.push(finding('touchdown-aim', ep, 'warn',
                        `Toucher long : ${d} m après le point d'aboutissement (${M.beyondNormal} m au plus).`,
                        round(along), M.beyondNormal));
                } else if (along < -M.short) {
                    out.push(finding('touchdown-aim', ep, 'warn',
                        `Toucher court : ${d} m avant le point d'aboutissement (sur le point ou au-delà).`,
                        round(along), M.short ? -M.short : 0));
                }
                if (Math.abs(lateral) > M.lateral) {
                    out.push(finding('touchdown-lateral', ep, 'warn',
                        `Toucher à ${round(Math.abs(lateral))} m ${lateral > 0 ? 'à gauche' : 'à droite'} de l'axe.`,
                        round(lateral, 0.1), M.lateral));
                }
            }
        }
        if (checks.has('throttle-touchdown') && num(first.throttle) && first.throttle > THRESHOLDS.throttleTouchdown.max) {
            out.push(finding('throttle-touchdown', ep, 'info',
                `Gaz encore à ${round(first.throttle * 100)} % au toucher : réduisez avant l'arrondi.`,
                first.throttle, THRESHOLDS.throttleTouchdown.max));
        }
    }
}

function ils(samples, out) {
    const I = THRESHOLDS.ils;
    // En descente seulement : une remise de gaz (aux minimums ou plus tôt) quitte le plan vers le haut et n'est pas un
    // écart d'alignement
    const low = (s) => airborne(s) && num(s.aal) && s.aal < I.below && !(num(s.vs) && s.vs >= 0);
    const axes = [
        { kind: 'ils-loc', key: 'loc',
            text: (v) => `Hors de l'axe du localizer : ${v > 0 ? 'à gauche' : 'à droite'}, ${round(Math.abs(v) * 5, 0.5)} points.` },
        { kind: 'ils-gs', key: 'gsDev',
            text: (v) => `Hors du plan de descente : ${v > 0 ? 'trop bas' : 'trop haut'}, ${round(Math.abs(v) * 5, 0.5)} points.` },
    ];
    for (const { kind, key, text } of axes) {
        const pred = (s) => low(s) && num(s[key]) && Math.abs(s[key]) > I.warn;
        for (const ep of episodes(samples, pred, I.minDuration)) {
            const v = extreme(samples, ep, (x) => Math.abs(x[key]))[key];
            const severe = Math.abs(v) > I.severe;
            out.push(finding(kind, ep, severe ? 'severe' : 'warn',
                text(v) + (severe ? ' Remise de gaz.' : ''), v, severe ? I.severe : I.warn));
        }
    }
}

function speeds(samples, out, checks = new Set([ 'vfe', 'vne' ])) {
    for (const ep of checks.has('vfe') ? episodes(samples, (s) => airborne(s) && s.ias > vfeFor(s.flaps), THRESHOLDS.vfe.minDuration) : []) {
        const s = extreme(samples, ep, (x) => x.ias - vfeFor(x.flaps));
        const vfe = vfeFor(s.flaps);
        out.push(finding('vfe', ep, 'warn',
            `Volets sortis à ${round(s.ias)} kt : VFE ${vfe} kt avec ${round(s.flaps)}° de volets.`, round(s.ias), vfe));
    }
    const V = THRESHOLDS.vne;
    for (const ep of checks.has('vne') ? episodes(samples, (s) => s.ias > V.ias, V.minDuration) : []) {
        const s = extreme(samples, ep, (x) => x.ias);
        out.push(finding('vne', ep, 'severe', `${round(s.ias)} kt : VNE (${V.ias} kt) dépassée.`, round(s.ias), V.ias));
    }
}

function stalls(samples, out) {
    for (const ep of episodes(samples, (s) => airborne(s) && !!s.stall, 0)) {
        const s = samples[ep.i0];
        const height = round(s.agl, 10);
        out.push(finding('stall', ep, s.agl < THRESHOLDS.stall.severeBelow ? 'severe' : 'warn',
            `Décrochage à ${height} ft du sol.`, height, null));
    }
}

function loads(samples, out) {
    const L = THRESHOLDS.load;
    // Limite positive : +3,0 g volets sortis, +3,8 g volets rentrés
    const maxFor = (s) => (num(s.flaps) && s.flaps >= 0.5 ? L.maxFlaps : L.max);
    for (const ep of episodes(samples, (s) => num(s.load) && (s.load > maxFor(s) || s.load < L.min), L.minDuration)) {
        const s = extreme(samples, ep, (x) => Math.max(x.load - maxFor(x), L.min - x.load));
        const positive = s.load > 0;
        const limit = positive ? maxFor(s) : L.min;
        const flaps = positive && limit === L.maxFlaps ? ' volets sortis' : '';
        out.push(finding('load', ep, 'severe',
            `Facteur de charge de ${round(s.load, 0.1).toFixed(1).replace('.', ',')} g : limite ${String(limit).replace('.', ',')} g${flaps}.`,
            s.load, limit));
    }
}

function crashes(events, out) {
    for (const e of events) {
        if (e.kind !== 'crash') continue;
        out.push(finding('crash', { t0: e.t, t1: e.t }, 'severe', e.text ? `Accident : ${e.text}` : 'Accident.', null, null));
    }
}

// Écarts d'un vol : [{ kind, t, t0, t1, severity, message, value, limit }] trié par t.
// context.runways : pistes { name, threshold, direction (unitaire, sens d'atterrissage), left, aimPoint, length } :
// point d'aboutissement et finale (finalSegments) ; sans pistes, ni l'un ni l'autre
export function review(flight, context = {}) {
    const samples = flight?.samples ?? [];
    const events = flight?.events ?? [];
    const checks = CHECKS[flight?.meta?.aircraft] ?? CHECKS.c172;
    const out = [];
    if (checks.has('approach-speed') || checks.has('approach-sink')) {
        const inFinal = stabilizedFinal(samples, context.runways ?? []);
        if (checks.has('approach-speed')) approachSpeed(samples, inFinal, out);
        if (checks.has('approach-sink')) approachSink(samples, inFinal, out);
    }
    if (checks.has('bank-low')) bankLow(samples, out);
    touchdowns(samples, events, context, checks, out);
    if (checks.has('ils')) ils(samples, out);
    if (checks.has('vfe') || checks.has('vne')) speeds(samples, out, checks);
    if (checks.has('stall')) stalls(samples, out);
    if (checks.has('load')) loads(samples, out);
    if (checks.has('crash')) crashes(events, out);
    return out.sort((a, b) => a.t - b.t);
}
