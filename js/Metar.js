// Météo réelle : lecture d'un METAR (message d'observation d'aérodrome, OACI annexe 3 / OMM n° 306 FM 15) et passage
// au format du simulateur. Module pur, sans DOM (testé par tests/metar.test.js) :
// - parseMetar(texte) : METAR brut -> objet (vent, visibilité, nuages, temps présent, température, QNH), null si illisible ;
// - metarToWeather(lu, base) : -> { weather (ambiance, format de WEATHERS dans simulator.js), metar (bulletin, format
//   de METARS dans ATC.js, plus qnh, real, raw, station) } ;
// - METAR_URL, METAR_STATIONS, pickMetar(json) : source des METAR (VATSIM, en-tête CORS « * », vérifié le 21/11/2026).
//   LFMA (Aix-les-Milles) n'émet pas de METAR : LFML (Marseille-Provence, ~25 km) sert de repli.

const METAR_STATIONS = ['LFMA', 'LFML'];
const METAR_URL = 'https://metar.vatsim.net/LFMA,LFML?format=json';

const MPS_TO_KT = 1 / 0.514444;
const KMH_TO_KT = 1 / 1.852;
const SM = 1609.344;            // m par mille terrestre (visibilités américaines)
const INHG = 33.8639;           // hPa par pouce de mercure
const FT = 0.3048;              // m par pied
const MAX_VIS = 10000;          // m : « 10 km ou plus » (9999, CAVOK)

// Début de la tendance ou des remarques : la suite ne décrit plus l'observation
const TREND = /^(TEMPO|BECMG|NOSIG|RMK|PROB\d{2}|FM\d{4,6}|TL\d{4}|AT\d{4})$/;
const WIND = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/;
const WIND_VARIATION = /^(\d{3})V(\d{3})$/;
const CLOUD = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/{3})(CB|TCU|\/{3})?$/;
const WEATHER = /^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)?$/;
const TEMPERATURE = /^(M?\d{1,2})\/(M?\d{1,2})?$/;
const VIS_SM = /^(?:(\d+)|(\d+)\/(\d+)|(P)(\d+))SM$/;

const num = (s) => (s.startsWith('M') ? -Number(s.slice(1)) : Number(s));

// METAR brut -> objet lu ; null si ce n'est pas un METAR (pas d'indicatif de station, ou rien d'utile)
function parseMetar(text) {
    if (typeof text !== 'string') return null;
    const tokens = text.toUpperCase().replace(/=+\s*$/, '').trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (['METAR', 'SPECI', 'COR'].includes(tokens[i])) i++;
    if (!/^[A-Z][A-Z0-9]{3}$/.test(tokens[i] ?? '')) return null;
    const out = {
        station: tokens[i++], time: null, wind: null, visibility: null, cavok: false,
        layers: [], weather: [], temp: null, dew: null, qnh: null, raw: text.trim().replace(/\s+/g, ' '),
    };
    for (; i < tokens.length; i++) {
        const t = tokens[i];
        if (TREND.test(t)) break;
        if (t === 'NIL') return null;
        if (t === 'AUTO' || t === 'COR') continue;
        let m;
        if (!out.time && (m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(t))) {
            out.time = { day: +m[1], hour: +m[2], minute: +m[3] };
        } else if (!out.wind && (m = WIND.exec(t))) {
            const factor = m[4] === 'MPS' ? MPS_TO_KT : m[4] === 'KMH' ? KMH_TO_KT : 1;
            const speed = (v) => Math.round(Number(v) * factor);
            out.wind = { dir: m[1] === 'VRB' ? null : Number(m[1]), knots: speed(m[2]), gust: m[3] ? speed(m[3]) : null, variable: null };
        } else if (out.wind && !out.wind.variable && (m = WIND_VARIATION.exec(t))) {
            out.wind.variable = [Number(m[1]), Number(m[2])];
        } else if (t === 'CAVOK') {
            out.cavok = true;
            out.visibility = MAX_VIS;
        } else if (/^\d{4}(NDV|N|NE|E|SE|S|SW|W|NW)?$/.test(t)) {
            // Visibilité dominante (la première) ; une deuxième avec direction : visibilité minimale, ignorée
            if (out.visibility === null) out.visibility = t.startsWith('9999') ? MAX_VIS : Number(t.slice(0, 4));
        } else if ((m = VIS_SM.exec(t))) {
            let miles = m[4] ? Number(m[5]) : m[1] ? Number(m[1]) : Number(m[2]) / Number(m[3]);
            // « 1 1/2SM » : la partie entière est le jeton précédent
            if (m[2] && /^\d$/.test(tokens[i - 1])) miles += Number(tokens[i - 1]);
            if (out.visibility === null || m[2]) out.visibility = m[4] ? MAX_VIS : Math.min(MAX_VIS, Math.round(miles * SM));
        } else if ((m = CLOUD.exec(t))) {
            out.layers.push({ cover: m[1], feet: m[2] === '///' ? null : Number(m[2]) * 100, cb: m[3] === 'CB' });
        } else if ((m = TEMPERATURE.exec(t))) {
            out.temp = num(m[1]);
            out.dew = m[2] !== undefined ? num(m[2]) : null;
        } else if ((m = /^Q(\d{4})$/.exec(t))) {
            out.qnh = Number(m[1]);
        } else if ((m = /^A(\d{4})$/.exec(t))) {
            out.qnh = Math.round(Number(m[1]) / 100 * INHG * 10) / 10;
        } else if (t !== '' && (m = WEATHER.exec(t)) && (m[2] || m[3])) {
            out.weather.push(t);
        }
        // Autres jetons (portée visuelle de piste R.., NSC, NCD, SKC, CLR, état de piste, //////) : ignorés
    }
    if (!out.wind && out.visibility === null && out.temp === null && out.qnh === null) return null;
    return out;
}

// --- Textes du bulletin (style des METARS de ATC.js) ---

const PHENOMENA = {
    RA: ['pluie', 'rain'], DZ: ['bruine', 'drizzle'], SN: ['neige', 'snow'], SG: ['neige en grains', 'snow grains'],
    IC: ['cristaux de glace', 'ice crystals'], PL: ['granules de glace', 'ice pellets'], GR: ['grêle', 'hail'],
    GS: ['grésil', 'small hail'], UP: ['précipitations inconnues', 'unknown precipitation'], BR: ['brume', 'mist'],
    FG: ['brouillard', 'fog'], FU: ['fumée', 'smoke'], VA: ['cendres volcaniques', 'volcanic ash'],
    DU: ['poussière', 'dust'], SA: ['sable', 'sand'], HZ: ['brume sèche', 'haze'], PY: ['embruns', 'spray'],
    PO: ['tourbillons de poussière', 'dust whirls'], SQ: ['grains', 'squalls'], FC: ['trombe', 'funnel cloud'],
    SS: ['tempête de sable', 'sandstorm'], DS: ['tempête de poussière', 'duststorm'],
};
const DESCRIPTORS = {
    MI: ['mince', 'shallow'], BC: ['en bancs', 'patches'], PR: ['partiel', 'partial'],
    DR: ['chasse basse', 'low drifting'], BL: ['chasse haute', 'blowing'],
};

// Code de temps présent (ex. '+TSRA') -> [français, anglais]
function weatherText(code) {
    const m = WEATHER.exec(code);
    if (!m) return [code, code];
    const [, intensity, descriptor, group = ''] = m;
    const names = (group.match(/../g) ?? []).map((p) => PHENOMENA[p] ?? [p, p]);
    let fr = names.map((n) => n[0]).join(' et ');
    let en = names.map((n) => n[1]).join(' and ');
    if (descriptor === 'TS') {
        fr = fr ? `orage avec ${intensity === '+' ? 'forte ' : intensity === '-' ? 'faible ' : ''}${fr}` : 'orage';
        en = `${intensity === '+' ? 'heavy ' : intensity === '-' ? 'light ' : ''}thunderstorm${en ? ` with ${en}` : ''}`;
    } else {
        if (descriptor === 'SH') { fr = `averses${fr ? ` de ${fr}` : ''}`; en = `${en ? `${en} ` : ''}showers`; }
        else if (descriptor === 'FZ') { fr = `${fr} ${group === 'FG' ? 'givrant' : 'verglaçante'}`; en = `freezing ${en}`; }
        else if (descriptor) { fr = `${fr} ${DESCRIPTORS[descriptor][0]}`; en = `${DESCRIPTORS[descriptor][1]} ${en}`; }
        if (intensity === '+') { fr = `forte ${fr}`; en = `heavy ${en}`; }
        else if (intensity === '-') { fr = `${fr} faible`; en = `light ${en}`; }
    }
    if (intensity === 'VC') { fr = `${fr} au voisinage`; en = `${en} in the vicinity`; }
    return [fr, en];
}

// Visibilité (m) et temps présent -> [français, anglais]
function visibilityText(visibility, weather) {
    let fr, en;
    if (visibility === null) { fr = 'non disponible'; en = 'not available'; }
    else if (visibility >= MAX_VIS) { fr = '10 km ou plus'; en = '10 kilometres or more'; }
    else if (visibility >= 5000) { const km = Math.round(visibility / 1000); fr = `${km} km`; en = `${km} kilometres`; }
    else { fr = `${visibility} mètres`; en = `${visibility} metres`; }
    for (const code of weather) {
        const [wf, we] = weatherText(code);
        fr += `, ${wf}`;
        en += `, ${we}`;
    }
    return [fr, en];
}

const COVERS = {
    FEW: ['peu nombreux', 'few clouds'], SCT: ['épars', 'scattered'], BKN: ['fragmentés', 'broken'],
    OVC: ['couvert', 'overcast'], VV: ['ciel invisible, visibilité verticale', 'sky obscured, vertical visibility'],
};

// Couches nuageuses -> [français, anglais]
function cloudsText(parsed) {
    if (!parsed.layers.length) {
        return parsed.cavok ? ['pas de nuages significatifs, CAVOK', 'no significant cloud, CAVOK'] : ['ciel clair', 'sky clear'];
    }
    const fr = [], en = [];
    for (const layer of parsed.layers) {
        const [cf, ce] = COVERS[layer.cover];
        const height = layer.feet === null ? null : String(layer.feet);
        fr.push(`${cf}${height ? ` à ${height} pieds` : ''}${layer.cb ? ', cumulonimbus' : ''}`);
        en.push(`${ce}${height ? ` ${height} feet` : ''}${layer.cb ? ', cumulonimbus' : ''}`);
    }
    return [fr.join(', '), en.join(', ')];
}

// --- Passage au simulateur ---

const COVERAGE = { FEW: 0.25, SCT: 0.5, BKN: 1.2, OVC: 2.5, VV: 2.5 };
const OVERCAST = { BKN: 0.8, OVC: 0.95, VV: 0.95 };
const OVERCAST_CEILING = 6000;      // ft : une couche BKN / OVC plus haute ne fait pas de plafond continu
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

// Direction moyenne et demi-amplitude d'une variation « dddVddd » (sens horaire de from à to)
function variationOf([from, to]) {
    const span = ((to - from) % 360 + 360) % 360;
    return { mean: (from + span / 2) % 360, half: span / 2 };
}

// Objet lu (parseMetar) -> { weather, metar }. base : préréglage de WEATHERS (simulator.js) servant de départ (copié,
// jamais modifié), en général WEATHERS.jour ou WEATHERS.nuageux. options.overcastScale : échelle du plafond continu
// (celle du préréglage 'nuageux' ; à défaut celle de la base, sinon 1)
function metarToWeather(parsed, base, options = {}) {
    if (!parsed || !base) throw new Error('metarToWeather : METAR lu et préréglage de base obligatoires');
    const wind = parsed.wind ?? { dir: 0, knots: 0, gust: null, variable: null };
    const variable = wind.variable ? variationOf(wind.variable) : null;
    const direction = wind.dir ?? (variable ? variable.mean : 0);
    const variation = variable ? variable.half : wind.dir === null ? 180 : 10;
    const metar = {
        wind: direction, knots: wind.knots, variation,
        vis: visibilityText(parsed.visibility, parsed.weather),
        clouds: cloudsText(parsed),
        temp: parsed.temp, dew: parsed.dew,
        qnh: parsed.qnh, real: true, raw: parsed.raw ?? null, station: parsed.station,
    };
    if (wind.gust !== null) metar.gust = wind.gust;

    const weather = structuredClone(base);
    weather.label = `Météo réelle (${parsed.station})`;
    // Nuages : la couche la plus couvrante donne la couverture
    let densest = null;
    for (const layer of parsed.layers) if (!densest || COVERAGE[layer.cover] > COVERAGE[densest.cover]) densest = layer;
    weather.clouds = { ...(weather.clouds ?? {}), coverage: densest ? COVERAGE[densest.cover] : 0 };
    // Plafond continu : la plus basse couche BKN / OVC / VV sous 6 000 ft
    const ceiling = parsed.layers
        .filter((l) => OVERCAST[l.cover] && l.feet !== null && l.feet < OVERCAST_CEILING)
        .sort((a, b) => a.feet - b.feet)[0];
    if (ceiling) {
        const altitude = ceiling.feet * FT;
        weather.overcast = { base: altitude, top: altitude + 80, coverage: OVERCAST[ceiling.cover],
            scale: options.overcastScale ?? base.overcast?.scale ?? 1 };
    } else {
        delete weather.overcast;
    }
    // Visibilité : brouillard de la scène resserré sous 8 km
    if (parsed.visibility !== null && parsed.visibility < 8000) {
        weather.fogFar = Math.min(base.fogFar, Math.max(150, parsed.visibility * 0.25));
        weather.fogNear = weather.fogFar / 6;
    }
    // Temps présent
    const has = (re) => parsed.weather.some((code) => re.test(code));
    const storm = has(/TS/);
    if (has(/RA|DZ|SH/)) weather.rain = 1; else delete weather.rain;
    if (storm) weather.lightning = true; else delete weather.lightning;
    weather.turbulence = clamp(Math.max(0, (wind.gust ?? wind.knots) - 10) / 30 + (storm ? 0.6 : 0));
    weather.wind = clamp(wind.knots / 30);
    return { weather, metar };
}

// Réponse de METAR_URL ([{ id, metar }], metar sans l'indicatif) -> texte « STATION ... » : LFMA, sinon LFML, sinon null
function pickMetar(json) {
    if (!Array.isArray(json)) return null;
    for (const station of METAR_STATIONS) {
        const entry = json.find((e) => e && e.id === station && typeof e.metar === 'string' && e.metar.trim());
        if (entry) {
            const text = entry.metar.trim();
            return text.startsWith(`${station} `) ? text : `${station} ${text}`;
        }
    }
    return null;
}

export { parseMetar, metarToWeather, pickMetar, weatherText, METAR_STATIONS, METAR_URL };
