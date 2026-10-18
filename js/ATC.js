import { EventDispatcher } from 'three';

// Contrôle aérien de l'aérodrome : contrôleur automatique (à règles) sur trois fréquences — Sol (mise en route,
// roulage), Tour (piste, circuit, zone) et Approche (hors de la zone). Phraséologie officielle (DGAC en
// français, OACI en anglais). Le pilote choisit ses messages dans une liste qui dépend de la phase du vol et de la
// fréquence affichée ; chaque instruction doit être collationnée. Les messages sont lus à voix haute (RadioVoices.js :
// voix réalistes, toujours la même pour le pilote, une par fréquence pour les contrôleurs).

const FT = 0.3048;
const NM = 1852;
const ZONE_NM = 1;              // rayon de la zone de la tour ; au-delà : Approche
const LEAVE_AT_NM = ZONE_NM * 0.8;    // la sortie de zone s'annonce en arrivant à la limite
const HANDOFF_NM = ZONE_NM + 0.3;     // marge autour de la limite pour passer de la Tour à l'Approche (et retour)
const READBACK_TIMEOUT = 20;    // s sans collationnement : le contrôleur le réclame
const SQUAWK_GRACE = 30;        // s pour afficher le code transpondeur demandé avant le rappel
const PHONETIC = {
    A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
    J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
    S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};
// Chiffres épelés (pistes, QNH, transpondeur, fréquences, caps) : en radio française, 1 se dit « unité »
const DIGITS = {
    fr: ['zéro', 'unité', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'],
    en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'],
};
const CARDINALS = {
    fr: ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'],
    en: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
};
const STATIONS = {
    ground:   { fr: 'Sol', en: 'Ground' },
    tower:    { fr: 'Tour', en: 'Tower' },
    approach: { fr: 'Approche', en: 'Approach' },
    info:     { fr: 'Info', en: 'Information' },     // information de vol (SIV), sur toute la carte
};
// Vent et bulletin ATIS de chaque météo (variation : amplitude de la direction ; le QNH reste standard :
// l'altimètre de l'avion n'a pas de calage)
const METARS = {
    jour:       { wind: 360, knots: 7, variation: 60, vis: ['10 km ou plus', '10 kilometres or more'], clouds: ['peu nombreux à 3000 pieds', 'few clouds 3000 feet'], temp: 18, dew: 9 },
    nuageux:    { wind: 340, knots: 11, variation: 60, gust: 20, vis: ['8 km', '8 kilometres'], clouds: ['couvert à 1000 pieds', 'overcast 1000 feet'], temp: 12, dew: 9 },
    nuit:       { wind: 10, knots: 4, variation: 60, vis: ['10 km ou plus', '10 kilometres or more'], clouds: ['ciel clair', 'sky clear'], temp: 9, dew: 4 },
    brouillard: { wind: 360, knots: 2, variation: 0, vis: ['400 mètres, brouillard', '400 metres, fog'], clouds: ['ciel invisible', 'sky obscured'], temp: 7, dew: 7 },
    tempete:    { wind: 350, knots: 20, variation: 80, gust: 32, vis: ['3000 mètres, orage avec forte pluie', '3000 metres, heavy thunderstorm with rain'], clouds: ['fragmentés à 800 pieds, cumulonimbus', 'broken 800 feet, cumulonimbus'], temp: 14, dew: 12 },
};
const QNH = '1013';
const VFR_SQUAWK = '7000';
// Intitulés des cases (interface en français), quelle que soit la langue des messages
const LABELS = {
    startupFirst: 'Premier contact · mise en route', taxiFirst: 'Premier contact · roulage',
    readyFirst: 'Premier contact · prêt au départ', startup: 'Demande de mise en route', taxi: 'Demande de roulage',
    readyHold: "Point d'attente · prêt au départ", readyRunway: 'Aligné · prêt au départ', downwind: 'Vent arrière',
    finalFull: 'Finale · atterrissage complet', finalTouch: 'Finale · toucher', goAround: 'Remise de gaz',
    leaveCircuit: 'Quitter le circuit', leaveZone: 'Sortie de zone',
    inboundJoin: 'Intégration · vent arrière', inboundStraight: 'Intégration · finale directe',
    vacated: 'Piste dégagée', groundIn: 'Appel Sol · roulage vers le parking', parked: 'Au parking · fin de vol', parkedLeave: 'Au parking · quitter la fréquence',
    approachOut: 'Premier appel Approche · sortie de zone', approachIn: 'Premier appel Approche · retour au terrain',
    returnRequest: 'Demande de retour au terrain', report2nm: `À ${ZONE_NM} NM du terrain`, leaveFrequency: 'Quitter la fréquence',
    infoFirst: 'Premier contact · information de vol', infoWeather: 'Demande de météo', infoTraffic: 'Demande de trafic',
    infoPosition: 'Report de position',
    readback: 'Collationner', sayAgain: 'Répétez',
};
const STATUS = {
    idle: 'Pas de contact radio', startup: 'Mise en route approuvée', taxi: "Roulage vers le point d'attente",
    holding: "Maintien au point d'attente", lineup: 'Maintien sur la piste', takeoff: 'Autorisé au décollage : décollez, puis rappelez vent arrière',
    circuit: 'Tour de piste main gauche : rappeler vent arrière', inbound: 'Intégration : rappeler vent arrière',
    downwind: 'Rappeler en finale', continue: "Continuer l'approche", landing: "Autorisé à l'atterrissage",
    touchgo: 'Autorisé toucher', landed: 'Atterri', vacate: 'Dégager la piste, rappeler piste dégagée',
    toGround: 'Contacter le Sol', taxiIn: 'Roulage vers le parking', leaving: 'Rappeler sortie de zone',
    toApproach: "Contacter l'Approche", outbound: "Identifié par l'Approche", appIn: `Rappeler à ${ZONE_NM} NM du terrain`,
    toTower: 'Contacter la Tour',
};
const TOWER_STATES = ['holding', 'lineup', 'takeoff', 'circuit', 'inbound', 'downwind', 'continue', 'landing', 'touchgo', 'landed', 'vacate', 'leaving'];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const headingDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

// Morceau de message : texte affiché (d) et texte prononcé (s)
const tok = (d, s = d) => ({ d, s });
function msg(strings, ...values) {
    let text = '', speech = '';
    strings.forEach((str, i) => {
        text += str;
        speech += str;
        if (i >= values.length) return;
        const v = values[i];
        if (v && typeof v === 'object') {
            text += v.d;
            speech += v.s;
        } else {
            text += v;
            speech += v;
        }
    });
    return { text, speech, d: text, s: speech };   // utilisable aussi comme morceau d'un autre message
}

class ATC extends EventDispatcher {
    constructor({ airport, wind, voices, sounds = null, registration = 'F-HESM', aircraftType = 'Cessna 172' }) {
        super();
        this.voices = voices;
        this.airport = airport;
        this.wind = wind;
        this.sounds = sounds;
        this.registration = registration;
        this.aircraftType = aircraftType;
        this.lang = 'fr';
        this.voice = true;
        this.persons = 2;
        this.transponder = VFR_SQUAWK;
        this.radio = { powered: true, tuned: true, frequency: null };   // radio de bord (voir setRadio)
        this.log = [];
        this.busy = false;
        this.traffic = [];
        this.atisIndex = Math.floor(Date.now() / 3600e3) % 6;   // même lettre pour tous les joueurs (change chaque heure)
        this._stampAtis();
        this.metar = { ...METARS.jour, night: false };
        this.options = [];
        this.suggestion = null;
        this._optionsKey = '';
        this._chain = Promise.resolve();
        this._queued = 0;
        this._gen = 0;
        this.reset();
    }

    // Aérodrome dont on parle : celui du départ choisi (identité, fréquences, places)
    get aerodrome() {
        return this.airport.aerodrome;
    }

    get atisLetter() {
        return Object.keys(PHONETIC)[this.atisIndex % 26];
    }

    get stations() {
        return Object.keys(STATIONS).map((id) => ({ id, name: `${this.aerodrome.name} ${STATIONS[id].fr}`, frequency: this.aerodrome.frequencies[id] }));
    }

    get status() {
        if (!this.radio.powered) return "Radio éteinte : allumez l'avionique (AVIONICS BUS 1) et la NAV/COM 1";
        if (!this.radio.tuned) return `Aucune station sur ${this.radio.frequency} : affichez une fréquence de l'aérodrome sur la COM`;
        if (this.freq === 'info') return this.contacted.has('info') ? `Information de vol : ${this.aerodrome.name} Info (trafic, météo)` : `Pas de contact avec ${this.aerodrome.name} Info`;
        if (!this.contact) return STATUS.idle;
        if (this.state === 'taxiIn') return `Roulage vers le parking ${this.assignedStand}`;
        const handoff = { toGround: 'ground', toApproach: 'approach', toTower: 'tower' }[this.state];
        if (handoff) return `${STATUS[this.state]} (${this.aerodrome.frequencies[handoff]})`;
        // Sortie de zone : distance jusqu'à la limite (le message est proposé à partir de 1,5 NM du terrain)
        if (this.state === 'leaving' && this.s) {
            const d = this.s.distance.toFixed(1).replace('.', ',');
            return this.s.distance > LEAVE_AT_NM ? `Limite de zone atteinte (${d} NM) : annoncez la sortie de zone`
                : `Rappeler sortie de zone : limite à ${ZONE_NM} NM du terrain, vous êtes à ${d} NM`;
        }
        return STATUS[this.state] ?? '';
    }

    // Nouveau départ (ou touche R) : plus de contact ni d'autorisation ; au parking sur Sol, sur la piste sur Tour
    reset(spawn = null) {
        this._gen++;
        this.voices.stop();
        this._chain = Promise.resolve();
        this._queued = 0;
        this.busy = false;
        this.freq = spawn && !spawn.cold ? 'tower' : 'ground';
        this.standbyFreq = null;
        this._hold = null;
        this._endContact();
        this.lastAtc = null;
        this.pending = null;
        this.transponder = VFR_SQUAWK;
        this.assignedStand = spawn?.stand ?? this.aerodrome.stands.find((s) => s.free)?.name ?? 'N4';
        this._airborne = false;
        this._touched = false;
        this._prevZone = null;
        this._clearDelay = 0;
        this._changed();
    }

    _endContact() {
        this.contact = false;
        this.contacted = new Set();
        this.abbreviated = false;
        this.state = 'idle';
        this.squawk = null;
        this._squawkTime = 0;
        this._qnhGiven = false;
        this._handoffAtHolding = false;
        this.warned = {};
    }

    setLanguage(lang) {
        this.lang = lang === 'en' ? 'en' : 'fr';
        this.voices.setLanguage(this.lang);
        this._optionsKey = '';
        this._changed();
    }

    setVoice(on) {
        this.voice = on;
        if (!on) this.voices.stop();
    }

    setFrequency(id) {
        if (!STATIONS[id] || this.freq === id) return;
        this.standbyFreq = this.freq;
        this.freq = id;
        this._hold = null;   // on n'entend plus l'échange en cours sur l'autre fréquence
        this._optionsKey = '';
        this._changed();
    }

    // Radio de bord (tableau de bord) : alimentée, et réglée sur une fréquence de l'aérodrome. Sinon, on n'entend
    // ni ne parle à personne
    setRadio(powered, tuned, frequency) {
        if (powered === this.radio.powered && tuned === this.radio.tuned && frequency === this.radio.frequency) return;
        this.radio = { powered, tuned, frequency };
        this._optionsKey = '';
        this._changed();
    }

    get radioOk() {
        return this.radio.powered && this.radio.tuned;
    }

    setPersons(n) {
        this.persons = Math.max(1, Math.min(4, Math.round(n) || 1));
        this._optionsKey = '';
        this._changed();
    }

    setTransponder(code) {
        if (!/^[0-7]{4}$/.test(code)) return false;
        this.transponder = code;
        if (code === this.squawk) this.warned.squawk = false;
        this._changed();
        return true;
    }

    // Météo du panneau : vent (variable), visibilité, nuages ; une nouvelle lettre ATIS à chaque changement,
    // annoncée par le contrôleur en contact
    setWeather(name, weather) {
        const metar = METARS[name] ?? METARS.jour;
        const changed = this._weatherName && this._weatherName !== name;
        this._weatherName = name;
        this.metar = { ...metar, night: (weather?.night ?? 0) >= 0.5 };
        this.wind.set(metar);
        if (!changed) return;
        this.atisIndex++;
        this._stampAtis();
        if (this.contact && this.contacted.has(this.freq)) {
            const L = this._atisTok();
            this._say(this.freq, () => msg`${this._abbr()}, nouvelle ${L} en vigueur, ${this._qnh()}.`,
                () => msg`${this._abbr()}, ${L} now current, ${this._qnh()}.`,
                () => msg`${this._capital(L)}, ${this._qnh()}, ${this._abbr()}.`, () => msg`${this._capital(L)}, ${this._qnh()}, ${this._abbr()}.`);
        }
        this._changed();
    }

    // Quantité de nuages réglée par le joueur (météo Jour) : 0 = ciel clair -> 4 = très nuageux ; reprise dans l'ATIS
    setCloudCover(coverage) {
        const [fr, en] = coverage <= 0 ? ['ciel clair', 'sky clear']
            : coverage < 0.3 ? ['peu nombreux', 'few clouds']
            : coverage < 0.8 ? ['épars', 'scattered']
            : coverage < 2 ? ['fragmentés', 'broken'] : ['couvert', 'overcast'];
        this.metar.clouds = coverage <= 0 ? [fr, en] : [`${fr} à 3000 pieds`, `${en} 3000 feet`];
    }

    // --- Appelé à chaque image ---------------------------------------------------------------
    // input : { position, heading (°), onGround, agl (ft), speed (m/s), engine, active, traffic }
    update(delta, input) {
        this.traffic = input.traffic ?? [];
        const s = input.active ? this._situation(input) : null;
        this.s = s;
        if (s) this._automation(delta, s);
        this._refreshOptions(s);
    }

    choose(id) {
        const option = this.options.find((o) => o.id === id);
        if (!option || this.busy) return;
        this._send(option);
    }

    // Bouton "Quitter la fréquence" : possible sur toute fréquence où l'on est en contact, hors échange en cours
    get canLeaveFrequency() {
        return Boolean(this.s) && this.radioOk && !this.busy && !this.pending && !this._frequencyBusy() && this.contacted.has(this.freq);
    }

    leaveFrequency() {
        if (!this.canLeaveFrequency) return;
        const station = this.freq;
        const cs = this._pilotCs();
        this._send({
            id: 'leaveFrequency',
            message: this._t(() => msg`${cs}, quittons la fréquence.`, () => msg`${cs}, leaving the frequency.`),
            reply: () => this._leaveReply(station),
        });
    }

    // "Au revoir" ; dernier contact radio : transpondeur sur 7000. Quitter le Sol, la Tour ou l'Approche met fin à
    // l'autorisation en cours (il faudra rappeler)
    _leaveReply(station) {
        const last = this.contacted.size <= 1;
        const code = last && this.squawk && this.squawk !== VFR_SQUAWK ? this._code(VFR_SQUAWK) : null;
        const sq = code ? this._t(() => msg`affichez ${code}, `, () => msg`squawk ${code}, `) : '';
        const sqRb = code ? this._t(() => msg`${code}, `, () => msg`Squawk ${code}, `) : '';
        const abbr = this._abbr();
        return {
            message: this._t(() => msg`${abbr}, ${sq}au revoir.`, () => msg`${abbr}, ${sq}goodbye.`),
            readback: this._t(() => msg`${sqRb}${code ? 'au revoir' : 'Au revoir'}, ${abbr}.`, () => msg`${sqRb}${code ? 'goodbye' : 'Goodbye'}, ${abbr}.`),
            then: () => {
                this.contacted.delete(station);
                if (station !== 'info') {
                    this.state = 'idle';
                    this._handoffAtHolding = false;
                }
                if (!this.contacted.size) {
                    this._endContact();
                    this.squawk = VFR_SQUAWK;
                }
                this._optionsKey = '';
                this._changed();
            },
        };
    }

    _send(option) {
        const pilotClip = option.clip ?? this._prepare('pilot', option.message);
        option.action?.();
        const gen = this._gen;
        this._queue(async () => {
            await this._transmit('pilot', option.message, gen, pilotClip, Boolean(option.reply));
            if (!option.reply || gen !== this._gen) return;
            // Réponse décidée dès la fin du message, voix calculée pendant le temps de réaction du contrôleur
            const reply = option.reply();
            const clip = reply ? this._prepare(this.freq, reply.message) : null;
            await wait(900 + Math.random() * 1300);
            if (gen !== this._gen) return;
            if (reply) await this._controller(reply, gen, clip);
        });
    }

    playAtis() {
        if (this.busy) return;
        const gen = this._gen;
        const message = this._atisMessage();
        this._queue(() => this._transmit('atis', message, gen, this._prepare('atis', message)));
    }

    // --- Situation de l'avion ----------------------------------------------------------------
    _situation(input) {
        const p = input.position;
        const runways = this.airport.runways;
        const cx = (runways[0].threshold.x + runways[1].threshold.x) / 2;
        const cz = (runways[0].threshold.z + runways[1].threshold.z) / 2;
        const dx = p.x - cx, dz = p.z - cz;
        const zone = this.airport.zoneAt(p.x, p.z);
        const s = {
            position: p,
            heading: input.heading,
            onGround: input.onGround,
            airborne: !input.onGround && input.agl > 3,
            agl: input.agl,
            altitude: Math.max(100, Math.round(p.y / FT / 100) * 100),
            speed: input.speed,
            engine: input.engine,
            distance: Math.hypot(dx, dz) / NM,
            bearing: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360,
            zone,
            nearHolding: this.airport.nearHolding(p.x, p.z),
            stand: this.airport.standAt(p.x, p.z),
            active: this._activeRunway(),
            aligned: null,
            final: null,
            downwind: false,
        };
        Object.assign(s, this._geometry(p, s.heading, zone, input.onGround, s.airborne, s.agl));
        return s;
    }

    // Position par rapport aux pistes : aligné (au sol), en finale, en vent arrière main gauche, en montée initiale
    _geometry(p, heading, zone, onGround, airborne, agl) {
        const g = { aligned: null, final: null, finalDistance: 0, downwind: false, climbout: null };
        const active = this._activeRunway();
        const length = this.airport.runwayLength;
        for (const rw of this.airport.runways) {
            const along = (p.x - rw.threshold.x) * rw.direction.x + (p.z - rw.threshold.z) * rw.direction.z;
            const lateral = (p.x - rw.threshold.x) * rw.left.x + (p.z - rw.threshold.z) * rw.left.z;
            const hd = headingDiff(heading, rw.heading);
            if (zone === 'runway' && onGround && hd < 35) g.aligned = rw;
            if (airborne && along > -6000 && along < 200 && Math.abs(lateral) < 600 && hd < 40 && agl < 3000) {
                g.final = rw;
                g.finalDistance = -along;
            }
            if (airborne && along > length - 200 && along < length + 2500 && Math.abs(lateral) < 500 && hd < 40 && agl < 1500) g.climbout = rw;
            // Vent arrière main gauche : à gauche de la piste en service, cap opposé
            if (rw === active && airborne && lateral > 300 && lateral < 4000 && along > -3000 && along < 2500
                && headingDiff(heading, rw.heading + 180) < 60) g.downwind = true;
        }
        return g;
    }

    // --- Trafic : les autres joueurs (multijoueur) ------------------------------------------------
    // Où ils sont et ce qu'ils font, d'après leur position (indicatif : leur immatriculation)
    _others() {
        const runways = this.airport.runways;
        const cx = (runways[0].threshold.x + runways[1].threshold.x) / 2;
        const cz = (runways[0].threshold.z + runways[1].threshold.z) / 2;
        const list = [];
        for (const t of this.traffic) {
            if (t.offline || t.crashed || !t.callsign) continue;
            const p = t.position;
            const zone = this.airport.zoneAt(p.x, p.z);
            const onGround = t.altitude < 15;
            const o = {
                id: t.id, callsign: t.callsign, position: p, altitude: t.altitude, onGround, zone,
                stand: onGround ? this.airport.standAt(p.x, p.z) : null,
                nearHolding: this.airport.nearHolding(p.x, p.z),
                distance: Math.hypot(p.x - cx, p.z - cz) / NM,
                bearing: (Math.atan2(p.x - cx, -(p.z - cz)) * 180 / Math.PI + 360) % 360,
            };
            Object.assign(o, this._geometry(p, t.heading, zone, onGround, !onGround, t.altitude));
            list.push(o);
        }
        return list;
    }

    // Autres avions au sol sur les voies de circulation ou la piste (pas ceux garés), les plus proches d'abord
    _groundTraffic(s) {
        return this._others().filter((o) => o.onGround && ['taxiway', 'entry', 'runway'].includes(o.zone))
            .sort((a, b) => a.position.distanceTo(s.position) - b.position.distanceTo(s.position));
    }

    // Autres avions en vol dans la zone de la tour (ceux en finale exceptés si exclude)
    _circuitTraffic(exclude = null) {
        return this._others().filter((o) => !o.onGround && o.distance <= HANDOFF_NM && !(exclude === 'final' && o.final));
    }

    // Autres avions en vol à moins de 5 NM de nous (Approche)
    _nearbyTraffic(s) {
        return this._others().filter((o) => !o.onGround && o.position.distanceTo(s.position) < 5 * NM);
    }

    // "Cessna 172 F-GS"
    _otherTok(o) {
        return msg`${this.aircraftType} ${this._abbrOf(o.callsign)}`;
    }

    // Ce que fait l'autre avion : "au point d'attente A", "en vent arrière main gauche piste 36, 1000 pieds"…
    _whatTok(o, withAltitude = true) {
        const alt = Math.max(100, Math.round(o.altitude / 100) * 100);
        const ft = withAltitude ? this._t(() => `, ${alt} pieds`, () => `, ${alt} feet`) : '';
        if (o.onGround) {
            if (o.stand) return this._t(() => msg`au ${this._stand(o.stand)}`, () => msg`on ${this._stand(o.stand)}`);
            if (o.zone === 'apron') return this._t(() => tok('sur le parking'), () => tok('on the apron'));
            if (o.zone === 'taxiway') return o.nearHolding
                ? this._t(() => msg`au point d'attente ${this._twy()}`, () => msg`at holding point ${this._twy()}`)
                : this._t(() => msg`roulant sur ${this._twy()}`, () => msg`taxiing on ${this._twy()}`);
            const rw = o.aligned ?? this._activeRunway();
            if (o.zone === 'entry') return this._t(() => msg`entrant sur la ${this._rwy(rw)}`, () => msg`entering ${this._rwy(rw)}`);
            if (o.zone === 'runway') return this._t(() => msg`sur la ${this._rwy(rw)}`, () => msg`on ${this._rwy(rw)}`);
            return this._t(() => tok('au sol'), () => tok('on the ground'));
        }
        if (o.final) {
            const short = o.finalDistance < 1500;
            return this._t(() => msg`en ${short ? 'courte ' : ''}finale ${this._rwy(o.final)}${ft}`, () => msg`on ${short ? 'short ' : ''}final ${this._rwy(o.final)}${ft}`);
        }
        if (o.downwind) return this._t(() => msg`en vent arrière main gauche ${this._rwy(this._activeRunway())}${ft}`,
            () => msg`on left downwind ${this._rwy(this._activeRunway())}${ft}`);
        if (o.climbout) return this._t(() => msg`en montée initiale ${this._rwy(o.climbout)}${ft}`, () => msg`climbing out ${this._rwy(o.climbout)}${ft}`);
        return this._t(() => msg`à ${this._nm(o.distance)} ${this._au(o.bearing)} du terrain${ft}`,
            () => msg`${this._nm(o.distance)} ${CARDINALS.en[this._octant(o.bearing)]} of the field${ft}`);
    }

    // "trafic, Cessna 172 F-GS, au point d'attente A"
    _trafficTok(o) {
        return this._t(() => msg`trafic, ${this._otherTok(o)}, ${this._whatTok(o)}`, () => msg`traffic, ${this._otherTok(o)}, ${this._whatTok(o)}`);
    }

    // Information de trafic ajoutée à un message (2 avions au plus) ; le pilote doit dire s'il le voit :
    // collationnement "…, trafic en vue, F-SM" ou "…, recherchons le trafic, F-SM"
    _addTraffic(reply, others) {
        if (!others.length) return reply;
        const info = others.slice(0, 2).map((o) => this._trafficTok(o)).reduce((all, m) => all ? msg`${all}, ${m}` : m, null);
        const strip = (x) => x.replace(/\.\s*$/, '');
        reply.message = { text: `${strip(reply.message.text)}, ${info.text}.`, speech: `${strip(reply.message.speech)}, ${info.speech}.` };
        reply.message.d = reply.message.text;
        reply.message.s = reply.message.speech;
        const seen = this._t(() => tok('trafic en vue'), () => tok('traffic in sight'));
        const looking = this._t(() => tok('recherchons le trafic'), () => tok('looking out'));
        const cs = this._abbr();
        if (reply.readback) {
            reply.altReadback = this._insertAck(reply.readback, looking, cs);
            reply.readback = this._insertAck(reply.readback, seen, cs);
            reply.labels = ['Collationner · trafic en vue', 'Collationner · trafic pas en vue'];
        } else {
            reply.readback = msg`${this._capital(seen)}, ${cs}.`;
            reply.altReadback = msg`${this._capital(looking)}, ${cs}.`;
            reply.labels = ['Trafic en vue', 'Recherchons le trafic'];
        }
        return reply;
    }

    // "…, F-SM." -> "…, trafic en vue, F-SM."
    _insertAck(readback, ack, cs) {
        const cut = (x, c) => x.endsWith(`, ${c}.`) ? x.slice(0, -(c.length + 3)) : x.replace(/\.\s*$/, '');
        const text = `${cut(readback.text, cs.d)}, ${ack.d}, ${cs.d}.`;
        const speech = `${cut(readback.speech, cs.s)}, ${ack.s}, ${cs.s}.`;
        return { text, speech, d: text, s: speech };
    }

    // Alerte de trafic en vol : position "horaire" par rapport à notre cap, distance, écart d'altitude
    _trafficAlert(s, o, distance, dAlt) {
        const bearing = (Math.atan2(o.position.x - s.position.x, -(o.position.z - s.position.z)) * 180 / Math.PI + 360) % 360;
        const clock = Math.round(((bearing - s.heading + 360) % 360) / 30) % 12 || 12;
        const nm = this._nm(distance / NM);
        const diff = Math.round(Math.abs(dAlt) / 100) * 100;
        const level = Math.abs(dAlt) < 200
            ? this._t(() => tok('même altitude'), () => tok('same altitude'))
            : this._t(() => tok(`${diff} pieds ${dAlt > 0 ? 'au-dessus' : 'au-dessous'}`), () => tok(`${diff} feet ${dAlt > 0 ? 'above' : 'below'}`));
        const cs = this._abbr();
        const reply = {
            message: this._t(() => msg`${cs}, trafic à ${clock} heure${clock > 1 ? 's' : ''}, ${nm}, ${level}, ${this._otherTok(o)}, ${this._whatTok(o, false)}.`,
                () => msg`${cs}, traffic, ${clock} o'clock, ${nm}, ${level}, ${this._otherTok(o)}, ${this._whatTok(o, false)}.`),
        };
        reply.readback = this._t(() => msg`Trafic en vue, ${cs}.`, () => msg`Traffic in sight, ${cs}.`);
        reply.altReadback = this._t(() => msg`Recherchons le trafic, ${cs}.`, () => msg`Looking out, ${cs}.`);
        reply.labels = ['Trafic en vue', 'Recherchons le trafic'];
        return reply;
    }

    // Piste face au vent moyen (vent calme : la 36)
    _activeRunway() {
        const runways = this.airport.runways;
        if (this.wind.calm) return runways[0];
        return runways.reduce((best, rw) => headingDiff(rw.heading, this.wind.base) < headingDiff(best.heading, this.wind.base) ? rw : best);
    }

    // Fréquence qui gère l'avion là où il est
    _expectedStation(s) {
        const st = this.state;
        if (s.onGround) {
            if (st === 'vacate' || st === 'landed') return 'tower';
            if (st === 'toGround' || st === 'taxiIn') return 'ground';
            if (s.zone === 'runway' || s.zone === 'entry' || s.nearHolding) return 'tower';
            return 'ground';
        }
        if (st === 'toApproach' || st === 'outbound' || st === 'appIn') return 'approach';
        if (st === 'toTower' || st === 'leaving') return 'tower';
        if (s.distance > HANDOFF_NM && !TOWER_STATES.includes(st)) return 'approach';
        return 'tower';
    }

    // Autres joueurs : sur la piste, en finale (nombre devant nous)
    _trafficInfo() {
        let onRunway = false, onFinal = 0;
        for (const t of this.traffic) {
            if (t.offline || t.crashed) continue;
            const p = t.position;
            if (this.airport.zoneAt(p.x, p.z) === 'runway' && t.altitude < 40) onRunway = true;
            for (const rw of this.airport.runways) {
                const along = (p.x - rw.threshold.x) * rw.direction.x + (p.z - rw.threshold.z) * rw.direction.z;
                const lateral = (p.x - rw.threshold.x) * rw.left.x + (p.z - rw.threshold.z) * rw.left.z;
                if (t.altitude > 40 && t.altitude < 2000 && along > -5000 && along < 100 && Math.abs(lateral) < 600) {
                    onFinal++;
                    break;
                }
            }
        }
        return { onRunway, onFinal };
    }

    // --- Événements surveillés par les contrôleurs ----------------------------------------------
    _automation(delta, s) {
        const gen = this._gen;
        const traffic = this._trafficInfo();
        const cs = () => this._abbr();

        // Collationnement attendu
        if (this.pending && !this.busy) {
            this.pending.time += delta;
            if (this.pending.time > READBACK_TIMEOUT && this.pending.reminders < 2 && this.radioOk) {
                this.pending.time = 0;
                this.pending.reminders++;
                this._queue(() => this._controller({ message: this._t(
                    () => msg`${cs()}, collationnez.`, () => msg`${cs()}, read back.`), keepLast: true }, gen));
            }
        }

        // Roulage collationné "au point d'attente, contactez la Tour" : le pilote passe sur Tour en y arrivant
        if (this._handoffAtHolding && s.onGround && s.nearHolding && this.freq === 'ground') {
            this._handoffAtHolding = false;
            this.standbyFreq = this.freq;
            this.freq = 'tower';
            this._note(`Radio affichée sur ${this.aerodrome.name} ${STATIONS.tower.fr} ${this.aerodrome.frequencies.tower}`);
        }

        // Code transpondeur demandé mais pas affiché
        if (this.contact && this.squawk && this.squawk !== VFR_SQUAWK && this.transponder !== this.squawk && !this.pending && !this.busy) {
            this._squawkTime += delta;
            if (this._squawkTime > SQUAWK_GRACE && !this.warned.squawk && s.airborne) {
                this.warned.squawk = true;
                const code = this._code(this.squawk);
                this._say(this.freq, () => msg`${cs()}, vérifiez transpondeur, affichez ${code}.`,
                    () => msg`${cs()}, check transponder, squawk ${code}.`,
                    () => msg`Affiche ${code}, ${cs()}.`, () => msg`Squawk ${code}, ${cs()}.`);
            }
        }

        // Décollage / atterrissage
        if (!this._airborne && s.airborne && s.agl > 20) {
            this._airborne = true;
            if (this.state === 'touchgo' && this._touched) this.state = 'circuit';
            else if (this.contact && this.state !== 'takeoff' && this.state !== 'touchgo') {
                this.state = 'circuit';
                this._say('tower', () => msg`${cs()}, vous avez décollé sans autorisation, rappelez vent arrière main gauche ${this._rwy(s.active)}.`,
                    () => msg`${cs()}, you took off without clearance, report left downwind ${this._rwy(s.active)}.`,
                    () => msg`Rappellerons vent arrière, ${cs()}.`, () => msg`Wilco, ${cs()}.`);
            }
            this._changed();
        } else if (this._airborne && s.onGround) {
            this._airborne = false;
            if (s.zone === 'runway') {
                if (this.state === 'landing') this.state = 'landed';
                else if (this.state === 'touchgo') this._touched = true;
                else if (this.contact) {
                    this.state = 'vacate';
                    this._say('tower', () => msg`${cs()}, vous avez atterri sans autorisation. Dégagez par ${this._twy()}, rappelez piste dégagée.`,
                        () => msg`${cs()}, you landed without clearance. Vacate via ${this._twy()}, report runway vacated.`,
                        () => msg`Dégageons par ${this._twy()}, rappellerons piste dégagée, ${cs()}.`,
                        () => msg`Vacating via ${this._twy()}, wilco, ${cs()}.`);
                }
            }
            this._changed();
        }
        if (this.state === 'takeoff' && s.airborne && s.agl > 300) {
            this.state = 'circuit';
            this._changed();
        }

        // Après l'atterrissage, une fois ralenti : dégager la piste
        if (this.state === 'landed' && s.onGround && s.speed < 13) {
            this.state = 'vacate';
            this._say('tower', () => msg`${cs()}, dégagez par ${this._twy()}, rappelez piste dégagée.`,
                () => msg`${cs()}, vacate via ${this._twy()}, report runway vacated.`,
                () => msg`Dégageons par ${this._twy()}, rappellerons piste dégagée, ${cs()}.`,
                () => msg`Vacating via ${this._twy()}, wilco, ${cs()}.`);
        }

        // Attente au point d'attente / sur la piste : autorisation dès que la piste est libre
        if ((this.state === 'holding' || this.state === 'lineup') && !this.busy && !this.pending) {
            this._clearDelay += delta;
            if (this._clearDelay > 4 && !traffic.onRunway && traffic.onFinal === 0) {
                const rw = this._departureRunway ?? s.active;
                const lineUp = this.state === 'holding';
                this.state = 'takeoff';
                this._say('tower', ...this._takeoffClearance(rw, lineUp));
            }
        }

        // Approche : autorisation quand la piste se libère, sinon remise de gaz imposée en courte finale
        if (this.state === 'continue' && !this.busy && !this.pending) {
            const rw = this._landingRunway ?? s.active;
            if (!traffic.onRunway) {
                this.state = this._touchAndGo ? 'touchgo' : 'landing';
                this._say('tower', ...this._landingClearance(rw, this._touchAndGo));
            } else if (s.airborne && s.agl < 300) {
                this.state = 'circuit';
                this._say('tower', () => msg`${cs()}, remettez les gaz, trafic sur la piste, rappelez vent arrière.`,
                    () => msg`${cs()}, go around, traffic on the runway, report downwind.`,
                    () => msg`Remettons les gaz, rappellerons vent arrière, ${cs()}.`,
                    () => msg`Going around, wilco, ${cs()}.`);
            }
        }

        // Roulage sans autorisation
        if (this.contact && s.onGround && (s.zone === 'apron' || s.zone === 'taxiway') && s.speed > 3
            && ['idle', 'startup'].includes(this.state) && !this.warned.taxi) {
            this.warned.taxi = true;
            this._say(this.freq, () => msg`${cs()}, vous n'êtes pas autorisé à rouler, maintenez position et rappelez prêt à rouler.`,
                () => msg`${cs()}, you are not cleared to taxi, hold position and report ready to taxi.`,
                () => msg`Maintenons position, ${cs()}.`, () => msg`Holding position, ${cs()}.`);
        }

        // Point d'attente franchi sans autorisation (incursion sur piste)
        if (this.contact && s.onGround && this._prevZone === 'taxiway' && (s.zone === 'entry' || s.zone === 'runway')
            && this.state !== 'takeoff' && !this.warned.incursion) {
            this.warned.incursion = true;
            this._say(this.freq, () => msg`${cs()}, arrêtez immédiatement, vous n'êtes pas autorisé sur la piste.`,
                () => msg`${cs()}, stop immediately, you are not cleared onto the runway.`,
                () => msg`Arrêtons, ${cs()}.`, () => msg`Stopping, ${cs()}.`);
        }
        if (s.zone === 'taxiway' || s.zone === 'apron') this.warned.incursion = false;
        this._prevZone = s.zone;

        // Autre avion proche en vol (moins de 1,5 NM, moins de 1000 ft d'écart) : alerte de trafic, une fois par
        // avion toutes les 2 minutes
        if (s.airborne && this.contact && this.freq !== 'ground' && this.contacted.has(this.freq) && !this.busy && !this.pending
            && !this._frequencyBusy()) {
            const now = performance.now();
            this._alerts ??= new Map();
            for (const o of this._others()) {
                if (o.onGround) continue;
                const distance = Math.hypot(o.position.x - s.position.x, o.position.z - s.position.z);
                const dAlt = o.altitude - s.position.y / FT;
                if (distance < 1.5 * NM && Math.abs(dAlt) < 1000 && now - (this._alerts.get(o.id) ?? -1e9) > 120e3) {
                    this._alerts.set(o.id, now);
                    this._sayReply(this.freq, this._trafficAlert(s, o, distance, dAlt));
                    break;
                }
            }
        }
    }

    // --- Messages proposés au pilote -------------------------------------------------------------
    _refreshOptions(s) {
        const held = this._frequencyBusy();
        this.blockedBy = held ? this._hold.name : null;
        const options = s && !this.busy && !held && this.radioOk ? this._buildOptions(s) : [];
        const expected = s ? this._expectedStation(s) : null;
        const suggestion = s && !this.busy && this.radio.powered && expected !== this.freq && !options.some((o) => o.id !== 'sayAgain') ? expected : null;
        const key = options.map((o) => o.id + o.message.text).join('|') + this.busy + this.freq + suggestion + this.blockedBy + this.radioOk
            + (this.state === 'leaving' && s ? s.distance.toFixed(1) : '');   // distance affichée à jour
        if (key === this._optionsKey) return;
        this._optionsKey = key;
        this.options = options;
        this.suggestion = suggestion;
        this._changed();
    }

    _buildOptions(s) {
        const list = [];
        const add = (id, message, reply = null, action = null) => list.push({ id, label: LABELS[id] ?? id, message, reply, action });
        const sayAgain = () => add('sayAgain', this._t(() => msg`${this._pilotCs()}, répétez.`, () => msg`${this._pilotCs()}, say again.`), () => this._repeat());

        if (this.pending) {
            const pending = this.pending;
            const done = () => {
                this.pending = null;
                pending.then?.();
            };
            add('readback', pending.message, null, done);
            list[list.length - 1].clip = pending.clip;   // voix déjà calculée
            if (pending.labels) list[list.length - 1].label = pending.labels[0];
            if (pending.alt) {
                add('readbackAlt', pending.alt, null, done);
                list[list.length - 1].label = pending.labels?.[1] ?? LABELS.readback;
            }
            sayAgain();
            return list;
        }

        if (this.freq === 'ground') this._groundOptions(s, add);
        else if (this.freq === 'tower') this._towerOptions(s, add);
        else if (this.freq === 'info') this._infoOptions(s, add);
        else this._approachOptions(s, add);

        if (this.lastAtc && this.contact && this.lastAtc.station === this.freq) sayAgain();
        return list;
    }

    // Début d'un appel : premier contact du vol (indicatif complet, type, personnes à bord), premier appel sur
    // une nouvelle fréquence (station, indicatif abrégé, salutation) ou appel suivant (indicatif seul)
    _callup(station) {
        if (!this.contact) return msg`${this._station(station)}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, ${this._persons()}, `;
        if (!this.contacted.has(station)) return msg`${this._station(station)}, ${this._pilotCs()}, ${this._greet()}, `;
        return msg`${this._pilotCs()}, `;
    }

    // "avec l'information Bravo" : au premier contact du vol
    _withAtis() {
        if (this.contact) return '';
        return this._t(() => msg`avec l'${this._atisTok()}, `, () => msg`${this._atisTok()}, `);
    }

    _groundOptions(s, add) {
        if (!s.onGround) return;
        const rw = s.active;
        const where = () => s.stand ? this._t(() => msg`au ${this._stand(s.stand)}`, () => msg`at ${this._stand(s.stand)}`)
            : this._t(() => tok('au parking'), () => tok('on the apron'));

        if (this.state === 'toGround') {
            const call = this._callup('ground');
            add('groundIn', this._t(() => msg`${call}piste dégagée par ${this._twy()}, pour le parking.`,
                () => msg`${call}runway vacated via ${this._twy()}, request taxi to the apron.`), () => {
                const open = this._opening('ground');
                // Place libre : pas celle où un autre joueur est garé
                const occupied = new Set(this._others().map((o) => o.stand).filter(Boolean));
                if (occupied.has(this.assignedStand)) {
                    const free = this.aerodrome.stands.find((st) => st.free && !occupied.has(st.name));
                    if (free) this.assignedStand = free.name;
                }
                const stand = this._stand(this.assignedStand);
                this.state = 'taxiIn';
                return this._addTraffic({
                    message: this._t(() => msg`${this._abbr()}, ${open}roulez ${stand} via ${this._twy()}.`,
                        () => msg`${this._abbr()}, ${open}taxi to ${stand} via ${this._twy()}.`),
                    readback: this._t(() => msg`Roulons ${stand} via ${this._twy()}, ${this._abbr()}.`,
                        () => msg`Taxi to ${stand} via ${this._twy()}, ${this._abbr()}.`),
                }, this._groundTraffic(s));
            });
            return;
        }
        if (this.state === 'taxiIn') {
            if (s.speed < 0.5 && (s.stand || s.zone === 'apron')) add('parked', this._t(
                () => msg`${this._pilotCs()}, ${where()}, quittons la fréquence, au revoir.`,
                () => msg`${this._pilotCs()}, ${where()}, leaving the frequency, goodbye.`), () => {
                const message = this._t(() => msg`${this._abbr()}, au revoir.`, () => msg`${this._abbr()}, goodbye.`);
                this._endContact();
                return { message };
            });
            return;
        }
        if (s.zone !== 'apron' && !(s.zone === 'taxiway' && !s.nearHolding)) return;
        if (!['idle', 'startup'].includes(this.state)) return;

        const call = this._callup('ground');
        const first = !this.contact;
        if (!s.engine && this.state === 'idle') add(first ? 'startupFirst' : 'startup', this._t(
            () => msg`${call}${first ? msg`${where()}, ${this._withAtis()}pour un vol local, ` : ''}demandons la mise en route.`,
            () => msg`${call}${first ? msg`${where()}, ${this._withAtis()}local flight, ` : ''}request start-up.`),
        () => this._startupReply(rw));
        if (s.engine) add(first ? 'taxiFirst' : 'taxi', this._t(
            () => msg`${call}${first ? msg`${where()}, ${this._withAtis()}pour un vol local, ` : ''}prêt à rouler.`,
            () => msg`${call}${first ? msg`${where()}, ${this._withAtis()}local flight, ` : ''}request taxi.`),
        () => this._taxiReply(rw));
        if (this.contacted.has('ground') && s.zone === 'apron' && s.speed < 0.5) add('parkedLeave', this._t(
            () => msg`${this._pilotCs()}, ${where()}, quittons la fréquence.`,
            () => msg`${this._pilotCs()}, ${where()}, leaving the frequency.`), () => this._leaveReply('ground'));
    }

    _towerOptions(s, add) {
        const rw = s.active;
        if (s.onGround) {
            if (this.state === 'vacate' || this.state === 'landed') {
                if (s.zone === 'runway') return;
                add('vacated', this._t(() => msg`${this._pilotCs()}, piste dégagée.`, () => msg`${this._pilotCs()}, runway vacated.`), () => {
                    this.state = 'toGround';
                    const contact = this._contactTok('ground');
                    const freq = this._freqTok('ground');
                    return {
                        message: this._t(() => msg`${this._abbr()}, ${contact}, au revoir.`, () => msg`${this._abbr()}, ${contact}, goodbye.`),
                        readback: this._t(() => msg`${this._stationShort('ground')} ${freq}, au revoir, ${this._abbr()}.`,
                            () => msg`${this._stationShort('ground')} ${freq}, goodbye, ${this._abbr()}.`),
                        then: () => this.setFrequency('ground'),
                    };
                });
                return;
            }
            if (['holding', 'lineup', 'takeoff', 'landing', 'touchgo', 'toGround', 'taxiIn'].includes(this.state)) return;
            const first = !this.contact;
            if (s.nearHolding) {
                const call = this._callup('tower');
                add(first ? 'readyFirst' : 'readyHold', this._t(
                    () => msg`${call}point d'attente ${this._rwy(rw)}, ${first ? msg`${this._withAtis()}pour un vol local, ` : ''}prêt au départ.`,
                    () => msg`${call}holding point ${this._rwy(rw)}, ${first ? msg`${this._withAtis()}local flight, ` : ''}ready for departure.`),
                () => this._departureReply(rw, true));
            } else if (s.zone === 'runway' && s.aligned && s.speed < 3) {
                const here = s.aligned;
                const call = this._callup('tower');
                add(first ? 'readyFirst' : 'readyRunway', this._t(
                    () => msg`${call}aligné ${this._rwy(here)}, ${first ? msg`${this._withAtis()}pour un vol local, ` : ''}prêt au départ.`,
                    () => msg`${call}lined up ${this._rwy(here)}, ${first ? msg`${this._withAtis()}local flight, ` : ''}ready for departure.`),
                () => this._departureReply(here, false));
            }
            return;
        }
        if (!s.airborne) return;
        const cs = () => this._pilotCs();

        // Arrivée : premier appel à la Tour (venant de l'Approche, ou directement)
        if (!this.contacted.has('tower') || this.state === 'toTower' || this.state === 'idle') {
            const call = this._callup('tower');
            const position = this._position(s);
            add('inboundJoin', this._t(
                () => msg`${call}${position}, ${this._withAtis()}pour un atterrissage.`,
                () => msg`${call}${position}, ${this._withAtis()}for landing.`),
            () => this._joinReply(rw, false, s));
            add('inboundStraight', this._t(
                () => msg`${call}${position}, ${this._withAtis()}demandons une finale directe ${this._rwy(s.final ?? rw)}.`,
                () => msg`${call}${position}, ${this._withAtis()}request straight-in approach ${this._rwy(s.final ?? rw)}.`),
            () => this._joinReply(s.final ?? rw, true, s));
            return;
        }

        const leaveZone = () => add('leaveZone', this._t(
            () => msg`${cs()}, sortie de zone ${this._par(s.bearing)}, ${s.altitude} pieds.`,
            () => msg`${cs()}, leaving the zone ${this._par(s.bearing)}, ${s.altitude} feet.`), () => {
            this.state = 'toApproach';
            const contact = this._contactTok('approach');
            const freq = this._freqTok('approach');
            return {
                message: this._t(() => msg`${this._abbr()}, ${contact}, au revoir.`, () => msg`${this._abbr()}, ${contact}, goodbye.`),
                readback: this._t(() => msg`${this._stationShort('approach')} ${freq}, au revoir, ${this._abbr()}.`,
                    () => msg`${this._stationShort('approach')} ${freq}, goodbye, ${this._abbr()}.`),
                then: () => this.setFrequency('approach'),
            };
        });
        if (this.state === 'leaving') {
            if (s.distance > LEAVE_AT_NM) leaveZone();   // on l'annonce en arrivant à la limite de la zone
            return;
        }

        const approach = ['landing', 'touchgo', 'continue'].includes(this.state);
        const inCircuit = ['circuit', 'inbound', 'takeoff'].includes(this.state);
        let reported = false;
        if (!approach && this.state !== 'downwind' && (s.downwind || (inCircuit && !s.final))) {
            reported = true;
            add('downwind', this._t(() => msg`${cs()}, vent arrière main gauche ${this._rwy(rw)}.`,
                () => msg`${cs()}, left downwind ${this._rwy(rw)}.`), () => {
                this.state = 'downwind';
                const onFinal = this._others().filter((o) => o.final).sort((a, b) => b.finalDistance - a.finalDistance);
                const number = 1 + Math.max(this._trafficInfo().onFinal, onFinal.length);
                if (number > 1 && onFinal.length) {
                    // Numéro 2 : suivre le dernier avion en finale, nommé
                    const lead = onFinal[0];
                    const cs = this._abbr();
                    return {
                        message: this._t(() => msg`${cs}, numéro ${number}, suivez le ${this._otherTok(lead)}, ${this._whatTok(lead)}, rappelez en finale.`,
                            () => msg`${cs}, number ${number}, follow the ${this._otherTok(lead)}, ${this._whatTok(lead)}, report final.`),
                        readback: this._t(() => msg`Numéro ${number}, trafic en vue, rappellerons en finale, ${cs}.`,
                            () => msg`Number ${number}, traffic in sight, wilco, ${cs}.`),
                        altReadback: this._t(() => msg`Numéro ${number}, recherchons le trafic, rappellerons en finale, ${cs}.`,
                            () => msg`Number ${number}, looking out, wilco, ${cs}.`),
                        labels: ['Collationner · trafic en vue', 'Collationner · trafic pas en vue'],
                    };
                }
                return number > 1 ? {
                    message: this._t(() => msg`${this._abbr()}, numéro ${number}, suivez le trafic en finale, rappelez en finale.`,
                        () => msg`${this._abbr()}, number ${number}, follow the traffic on final, report final.`),
                    readback: this._t(() => msg`Numéro ${number}, trafic en vue, rappellerons en finale, ${this._abbr()}.`,
                        () => msg`Number ${number}, traffic in sight, wilco, ${this._abbr()}.`),
                } : this._addTraffic({
                    message: this._t(() => msg`${this._abbr()}, numéro 1, rappelez en finale.`, () => msg`${this._abbr()}, number 1, report final.`),
                    readback: this._t(() => msg`Numéro 1, rappellerons en finale, ${this._abbr()}.`, () => msg`Number 1, wilco, ${this._abbr()}.`),
                }, this._circuitTraffic('final'));
            });
        }
        if (!approach && (s.final || (this.state === 'downwind' && !reported))) {
            const frw = s.final ?? rw;
            for (const touch of [false, true]) add(touch ? 'finalTouch' : 'finalFull', this._t(
                () => msg`${cs()}, finale ${this._rwy(frw)}, ${touch ? 'pour un toucher' : 'pour un atterrissage complet'}.`,
                () => msg`${cs()}, final ${this._rwy(frw)}, ${touch ? 'touch and go' : 'full stop'}.`),
            () => this._finalReply(frw, touch));
        }
        if (approach && s.agl < 1500 && s.distance < 3) add('goAround', this._t(
            () => msg`${cs()}, remettons les gaz.`, () => msg`${cs()}, going around.`), () => {
            this.state = 'circuit';
            return {
                message: this._t(() => msg`${this._abbr()}, bien reçu, rappelez vent arrière.`, () => msg`${this._abbr()}, roger, report downwind.`),
                readback: this._t(() => msg`Rappellerons vent arrière, ${this._abbr()}.`, () => msg`Wilco, ${this._abbr()}.`),
            };
        });
        if (!approach && !s.final && s.distance <= ZONE_NM) add('leaveCircuit', this._t(
            () => msg`${cs()}, quittons le circuit ${this._par(s.heading)}, ${s.altitude} pieds.`,
            () => msg`${cs()}, leaving the circuit ${this._par(s.heading)}, ${s.altitude} feet.`), () => {
            this.state = 'leaving';
            return {
                message: this._t(() => msg`${this._abbr()}, rappelez sortie de zone.`, () => msg`${this._abbr()}, report leaving the zone.`),
                readback: this._t(() => msg`Rappellerons sortie de zone, ${this._abbr()}.`, () => msg`Wilco, ${this._abbr()}.`),
            };
        });
        if (!approach && s.distance > LEAVE_AT_NM) leaveZone();
    }

    _approachOptions(s, add) {
        if (!s.airborne) return;
        const cs = () => this._pilotCs();
        if (!this.contacted.has('approach')) {
            const call = this._callup('approach');
            if (this.state === 'toApproach' && !this._inboundViaApproach) {
                add('approachOut', this._t(
                    () => msg`${call}sortie de zone ${this._stationName()} ${this._par(s.bearing)}, ${this._position(s)}.`,
                    () => msg`${call}leaving ${this._stationName()} zone, ${this._position(s)}.`), () => {
                    const open = this._opening('approach');
                    this.state = 'outbound';
                    return this._addTraffic({
                        message: this._t(() => msg`${this._abbr()}, ${open}identifié, ${this._qnh()}, rappelez pour le retour.`,
                            () => msg`${this._abbr()}, ${open}identified, ${this._qnh()}, report for rejoining.`),
                        readback: this._t(() => msg`${this._qnh()}, rappellerons pour le retour, ${this._abbr()}.`,
                            () => msg`${this._qnh()}, wilco, ${this._abbr()}.`),
                    }, this._nearbyTraffic(s));
                });
            } else {
                add('approachIn', this._t(
                    () => msg`${call}${this._position(s)}, ${this._withAtis()}pour un atterrissage à ${this._stationName()}.`,
                    () => msg`${call}${this._position(s)}, ${this._withAtis()}for landing at ${this._stationName()}.`),
                () => this._approachInboundReply(s));
            }
            return;
        }
        if (this.state === 'outbound') {
            add('returnRequest', this._t(
                () => msg`${cs()}, ${this._position(s)}, demandons le retour vers ${this._stationName()} pour un atterrissage.`,
                () => msg`${cs()}, ${this._position(s)}, request rejoining ${this._stationName()} for landing.`),
            () => this._approachInboundReply(s));
        }
        if (this.state === 'appIn' && s.distance <= HANDOFF_NM) add('report2nm', this._t(
            () => msg`${cs()}, ${this._position(s)}.`, () => msg`${cs()}, ${this._position(s)}.`), () => this._handToTower());
    }

    // ESME Info (service d'information de vol) : partout sur la carte, en vol. Ne donne pas d'autorisation :
    // code transpondeur, QNH, trafic, météo ; ne change rien au déroulement avec le Sol, la Tour et l'Approche
    _infoOptions(s, add) {
        if (!s.airborne) return;
        const cs = () => this._pilotCs();
        if (!this.contacted.has('info')) {
            const call = this._callup('info');
            add('infoFirst', this._t(
                () => msg`${call}${this._position(s)}, vol local, demandons l'information de vol.`,
                () => msg`${call}${this._position(s)}, local flight, request flight information service.`), () => {
                const open = this._opening('info');
                const code = this._assignSquawk();
                const sq = code ? this._t(() => msg`affichez ${code}, `, () => msg`squawk ${code}, `) : '';
                const sqRb = code ? this._t(() => msg`${code}, `, () => msg`Squawk ${code}, `) : '';
                return this._addTraffic({
                    message: this._t(() => msg`${this._abbr()}, ${open}${sq}${this._qnh()}, rappelez avant de quitter la fréquence.`,
                        () => msg`${this._abbr()}, ${open}${sq}${this._qnh()}, report before leaving the frequency.`),
                    readback: this._t(() => msg`${sqRb}${this._qnh()}, ${this._abbr()}.`, () => msg`${sqRb}${this._qnh()}, wilco, ${this._abbr()}.`),
                }, this._nearbyTraffic(s));
            });
            return;
        }
        const m = this.metar;
        add('infoWeather', this._t(() => msg`${cs()}, demandons la météo d'${this._stationName()}.`,
            () => msg`${cs()}, request ${this._stationName()} weather.`), () => {
            const rw = this._activeRunway();
            return {
                message: this._t(
                    () => msg`${this._abbr()}, ${this._stationName()} : piste en service ${tok(rw.name, this._digits(rw.name))}, ${this._atisWind()}, visibilité ${m.vis[0]}, ${tok(m.clouds[0])}, température ${m.temp}, ${this._qnh()}.`,
                    () => msg`${this._abbr()}, ${this._stationName()}: runway in use ${tok(rw.name, this._digits(rw.name))}, ${this._atisWind()}, visibility ${m.vis[1]}, ${tok(m.clouds[1])}, temperature ${m.temp}, ${this._qnh()}.`),
                readback: this._t(() => msg`${this._qnh()}, ${this._abbr()}.`, () => msg`${this._qnh()}, ${this._abbr()}.`),
            };
        });
        add('infoTraffic', this._t(() => msg`${cs()}, demandons le trafic.`, () => msg`${cs()}, request traffic information.`), () => {
            const nearby = this._nearbyTraffic(s);
            if (!nearby.length) return {
                message: this._t(() => msg`${this._abbr()}, pas de trafic signalé à proximité.`, () => msg`${this._abbr()}, no reported traffic in your vicinity.`),
            };
            return this._addTraffic({ message: msg`${this._abbr()}.` }, nearby);
        });
        add('infoPosition', this._t(() => msg`${cs()}, ${this._position(s)}.`, () => msg`${cs()}, ${this._position(s)}.`), () => ({
            message: this._t(() => msg`${this._abbr()}, bien reçu, ${this._qnh()}.`, () => msg`${this._abbr()}, roger, ${this._qnh()}.`),
            readback: this._t(() => msg`${this._qnh()}, ${this._abbr()}.`, () => msg`${this._qnh()}, ${this._abbr()}.`),
        }));
    }

    // --- Réponses des contrôleurs ---------------------------------------------------------------
    // Premier contact sur une fréquence : le contrôleur s'annonce, et passe à l'indicatif abrégé
    _opening(station) {
        if (this.contacted.has(station)) return '';
        this.contacted.add(station);
        this.contact = true;
        this.abbreviated = true;
        return msg`${this._station(station)}, ${this._greet()}, `;
    }

    // QNH donné une fois (au premier contact), puis répété seulement si nécessaire
    _qnhOnce(prefix = ', ') {
        if (this._qnhGiven) return '';
        this._qnhGiven = true;
        return msg`${prefix}${this._qnh()}`;
    }

    // Nouveau code transpondeur (4 chiffres de 0 à 7, hors codes réservés)
    _assignSquawk() {
        if (this.squawk && this.squawk !== VFR_SQUAWK) return null;
        let code;
        do code = String(4 + Math.floor(Math.random() * 3)) + Array.from({ length: 3 }, () => Math.floor(Math.random() * 8)).join('');
        while (code === this.transponder);
        this.squawk = code;
        this._squawkTime = 0;
        this.warned.squawk = false;
        return this._code(code);
    }

    _startupReply(rw) {
        const open = this._opening('ground');
        const qnh = this._qnhOnce();
        this.state = 'startup';
        return {
            message: this._t(() => msg`${this._abbr()}, ${open}mise en route approuvée, ${this._rwy(rw)}${qnh}.`,
                () => msg`${this._abbr()}, ${open}start-up approved, ${this._rwy(rw)}${qnh}.`),
            readback: this._t(() => msg`Mise en route approuvée, ${this._rwy(rw)}${qnh}, ${this._abbr()}.`,
                () => msg`Start-up approved, ${this._rwy(rw)}${qnh}, ${this._abbr()}.`),
        };
    }

    _taxiReply(rw) {
        const open = this._opening('ground');
        const qnh = this._qnhOnce();
        this.state = 'taxi';
        this.warned.taxi = false;
        const contact = this._contactTok('tower');
        const tower = msg`${this._stationShort('tower')} ${this._freqTok('tower')}`;
        return this._addTraffic({
            message: this._t(() => msg`${this._abbr()}, ${open}roulez point d'attente ${this._rwy(rw)} via ${this._twy()}${qnh}, au point d'attente ${contact}.`,
                () => msg`${this._abbr()}, ${open}taxi to holding point ${this._rwy(rw)} via ${this._twy()}${qnh}, ${contact} at the holding point.`),
            readback: this._t(() => msg`Roulons point d'attente ${this._rwy(rw)} via ${this._twy()}${qnh}, au point d'attente ${tower}, ${this._abbr()}.`,
                () => msg`Taxi to holding point ${this._rwy(rw)} via ${this._twy()}${qnh}, ${tower} at the holding point, ${this._abbr()}.`),
            then: () => { this._handoffAtHolding = true; },
        }, this._groundTraffic(this.s));
    }

    // Prêt au départ : la Tour donne le code transpondeur, puis l'autorisation (ou l'attente s'il y a du trafic)
    _departureReply(rw, atHolding) {
        const open = this._opening('tower');
        const code = this._assignSquawk();
        const sq = code ? this._t(() => msg`affichez ${code}, `, () => msg`squawk ${code}, `) : '';
        const sqRb = code ? this._t(() => msg`${code}, `, () => msg`Squawk ${code}, `) : '';
        const first = (fr) => code ? fr.charAt(0).toLowerCase() + fr.slice(1) : fr;   // "4621, maintenons…" / "Maintenons…"
        const qnh = this._qnhOnce();
        const traffic = this._trafficInfo();
        this._departureRunway = rw;
        if (traffic.onRunway || traffic.onFinal > 0) {
            this.state = atHolding ? 'holding' : 'lineup';
            this._clearDelay = 0;
            // L'avion qui gêne, nommé (sur la piste ou en finale)
            const blocking = this._others().filter((o) => (o.onGround && o.zone === 'runway') || o.final);
            if (blocking.length) {
                return this._addTraffic(atHolding ? {
                    message: this._t(() => msg`${this._abbr()}, ${open}${sq}maintenez point d'attente ${this._rwy(rw)}${qnh}.`,
                        () => msg`${this._abbr()}, ${open}${sq}hold short of ${this._rwy(rw)}${qnh}.`),
                    readback: this._t(() => msg`${sqRb}${first('Maintenons')} point d'attente ${this._rwy(rw)}${qnh}, ${this._abbr()}.`,
                        () => msg`${sqRb}${first('Holding')} short ${this._rwy(rw)}${qnh}, ${this._abbr()}.`),
                } : {
                    message: this._t(() => msg`${this._abbr()}, ${open}${sq}maintenez position${qnh}.`,
                        () => msg`${this._abbr()}, ${open}${sq}hold position${qnh}.`),
                    readback: this._t(() => msg`${sqRb}${first('Maintenons')} position${qnh}, ${this._abbr()}.`,
                        () => msg`${sqRb}${first('Holding')} position${qnh}, ${this._abbr()}.`),
                }, blocking);
            }
            const what = traffic.onRunway ? this._t(() => tok('sur la piste'), () => tok('on the runway'))
                : this._t(() => tok('en finale'), () => tok('on final'));
            return atHolding ? {
                message: this._t(() => msg`${this._abbr()}, ${open}${sq}maintenez point d'attente ${this._rwy(rw)}, trafic ${what}${qnh}.`,
                    () => msg`${this._abbr()}, ${open}${sq}hold short of ${this._rwy(rw)}, traffic ${what}${qnh}.`),
                readback: this._t(() => msg`${sqRb}${first('Maintenons')} point d'attente ${this._rwy(rw)}${qnh}, ${this._abbr()}.`,
                    () => msg`${sqRb}${first('Holding')} short ${this._rwy(rw)}${qnh}, ${this._abbr()}.`),
            } : {
                message: this._t(() => msg`${this._abbr()}, ${open}${sq}maintenez position, trafic ${what}${qnh}.`,
                    () => msg`${this._abbr()}, ${open}${sq}hold position, traffic ${what}${qnh}.`),
                readback: this._t(() => msg`${sqRb}${first('Maintenons')} position${qnh}, ${this._abbr()}.`,
                    () => msg`${sqRb}${first('Holding')} position${qnh}, ${this._abbr()}.`),
            };
        }
        this.state = 'takeoff';
        const [fr, en, rbFr, rbEn] = this._takeoffClearance(rw, atHolding, { open, sq, sqRb, qnh, code });
        return this._addTraffic({ message: this._t(fr, en), readback: this._t(rbFr, rbEn) }, this._circuitTraffic('final'));
    }

    _takeoffClearance(rw, lineUp, { open = '', sq = '', sqRb = '', qnh = '', code = null } = {}) {
        const first = (word) => code ? word.charAt(0).toLowerCase() + word.slice(1) : word;   // "4621, alignons…" / "Alignons…"
        return lineUp ? [
            () => msg`${this._abbr()}, ${open}${sq}alignez-vous ${this._rwy(rw)}, autorisé décollage, ${this._wind()}${qnh}.`,
            () => msg`${this._abbr()}, ${open}${sq}line up ${this._rwy(rw)}, cleared for take-off, ${this._wind()}${qnh}.`,
            () => msg`${sqRb}${first('Alignons')} ${this._rwy(rw)}, autorisé décollage${qnh}, ${this._abbr()}.`,
            () => msg`${sqRb}${first('Lining')} up ${this._rwy(rw)}, cleared for take-off${qnh}, ${this._abbr()}.`,
        ] : [
            () => msg`${this._abbr()}, ${open}${sq}${this._rwy(rw)}, autorisé décollage, ${this._wind()}${qnh}.`,
            () => msg`${this._abbr()}, ${open}${sq}${this._rwy(rw)}, cleared for take-off, ${this._wind()}${qnh}.`,
            () => msg`${sqRb}${first('Autorisé')} décollage ${this._rwy(rw)}${qnh}, ${this._abbr()}.`,
            () => msg`${sqRb}${first('Cleared')} for take-off ${this._rwy(rw)}${qnh}, ${this._abbr()}.`,
        ];
    }

    _landingClearance(rw, touch) {
        return touch ? [
            () => msg`${this._abbr()}, autorisé toucher ${this._rwy(rw)}, ${this._wind()}.`,
            () => msg`${this._abbr()}, ${this._rwy(rw)}, cleared touch and go, ${this._wind()}.`,
            () => msg`Autorisé toucher ${this._rwy(rw)}, ${this._abbr()}.`,
            () => msg`Cleared touch and go ${this._rwy(rw)}, ${this._abbr()}.`,
        ] : [
            () => msg`${this._abbr()}, autorisé atterrissage ${this._rwy(rw)}, ${this._wind()}.`,
            () => msg`${this._abbr()}, ${this._rwy(rw)}, cleared to land, ${this._wind()}.`,
            () => msg`Autorisé atterrissage ${this._rwy(rw)}, ${this._abbr()}.`,
            () => msg`Cleared to land ${this._rwy(rw)}, ${this._abbr()}.`,
        ];
    }

    _finalReply(rw, touch) {
        this._landingRunway = rw;
        this._touchAndGo = touch;
        this._touched = false;
        if (this._trafficInfo().onRunway) {
            this.state = 'continue';
            const onRunway = this._others().filter((o) => o.onGround && o.zone === 'runway');
            if (onRunway.length) return this._addTraffic({
                message: this._t(() => msg`${this._abbr()}, continuez l'approche.`, () => msg`${this._abbr()}, continue approach.`),
                readback: this._t(() => msg`Continuons l'approche, ${this._abbr()}.`, () => msg`Continuing approach, ${this._abbr()}.`),
            }, onRunway);
            return {
                message: this._t(() => msg`${this._abbr()}, continuez l'approche, trafic sur la piste.`,
                    () => msg`${this._abbr()}, continue approach, traffic on the runway.`),
                readback: this._t(() => msg`Continuons l'approche, ${this._abbr()}.`, () => msg`Continuing approach, ${this._abbr()}.`),
            };
        }
        this.state = touch ? 'touchgo' : 'landing';
        const [fr, en, rbFr, rbEn] = this._landingClearance(rw, touch);
        return { message: this._t(fr, en), readback: this._t(rbFr, rbEn) };
    }

    // Arrivée à la Tour : trop loin, elle renvoie vers l'Approche ; sinon intégration (code transpondeur si besoin)
    _joinReply(rw, straightIn, s) {
        if (s.distance > HANDOFF_NM + 0.4 && !this.contacted.has('approach')) {
            const open = this._opening('tower');
            const contact = this._contactTok('approach');
            this.state = 'toApproach';
            this._inboundViaApproach = true;
            return {
                message: this._t(() => msg`${this._abbr()}, ${open}vous êtes hors zone, ${contact}.`,
                    () => msg`${this._abbr()}, ${open}you are outside the zone, ${contact}.`),
                readback: msg`${this._stationShort('approach')} ${this._freqTok('approach')}, ${this._abbr()}.`,
                then: () => this.setFrequency('approach'),
            };
        }
        const open = this._opening('tower');
        const code = this._assignSquawk();
        const sq = code ? this._t(() => msg`affichez ${code}, `, () => msg`squawk ${code}, `) : '';
        const sqRb = code ? this._t(() => msg`${code}, `, () => msg`Squawk ${code}, `) : '';
        const first = (word) => code ? word.charAt(0).toLowerCase() + word.slice(1) : word;
        const qnh = this._qnhOnce('');
        const qnhPart = qnh ? msg`${qnh}, ` : '';
        this.state = straightIn ? 'downwind' : 'inbound';
        return this._addTraffic(straightIn ? {
            message: this._t(() => msg`${this._abbr()}, ${open}${sq}rejoignez la longue finale ${this._rwy(rw)}, ${qnhPart}rappelez en finale.`,
                () => msg`${this._abbr()}, ${open}${sq}join long final ${this._rwy(rw)}, ${qnhPart}report final.`),
            readback: this._t(() => msg`${sqRb}${first('Rejoignons')} la longue finale ${this._rwy(rw)}, ${qnhPart}rappellerons en finale, ${this._abbr()}.`,
                () => msg`${sqRb}${first('Join')} long final ${this._rwy(rw)}, ${qnhPart}wilco, ${this._abbr()}.`),
        } : {
            message: this._t(() => msg`${this._abbr()}, ${open}${sq}rejoignez vent arrière main gauche ${this._rwy(rw)}, ${qnhPart}rappelez vent arrière.`,
                () => msg`${this._abbr()}, ${open}${sq}join left downwind ${this._rwy(rw)}, ${qnhPart}report downwind.`),
            readback: this._t(() => msg`${sqRb}${first('Rejoignons')} vent arrière main gauche ${this._rwy(rw)}, ${qnhPart}rappellerons vent arrière, ${this._abbr()}.`,
                () => msg`${sqRb}${first('Join')} left downwind ${this._rwy(rw)}, ${qnhPart}wilco, ${this._abbr()}.`),
        }, this._circuitTraffic());
    }

    // Approche, avion qui rentre : code transpondeur et QNH ; près du terrain, passage à la Tour
    _approachInboundReply(s) {
        const open = this._opening('approach');
        const code = this._assignSquawk();
        const sq = code ? this._t(() => msg`affichez ${code}, `, () => msg`squawk ${code}, `) : '';
        const sqRb = code ? this._t(() => msg`${code}, `, () => msg`Squawk ${code}, `) : '';
        const qnh = this._qnhOnce('');
        const qnhPart = qnh ? msg`${qnh}, ` : '';
        this._inboundViaApproach = false;
        const nearby = this._nearbyTraffic(s);
        if (s.distance <= HANDOFF_NM) {
            this.state = 'toTower';
            const contact = this._contactTok('tower');
            return this._addTraffic({
                message: this._t(() => msg`${this._abbr()}, ${open}${sq}${qnhPart}${contact}.`, () => msg`${this._abbr()}, ${open}${sq}${qnhPart}${contact}.`),
                readback: msg`${sqRb}${qnhPart}${this._stationShort('tower')} ${this._freqTok('tower')}, ${this._abbr()}.`,
                then: () => this.setFrequency('tower'),
            }, nearby);
        }
        this.state = 'appIn';
        return this._addTraffic({
            message: this._t(() => msg`${this._abbr()}, ${open}${sq}${qnhPart}rappelez à ${ZONE_NM} NM du terrain.`,
                () => msg`${this._abbr()}, ${open}${sq}${qnhPart}report ${ZONE_NM} mile${ZONE_NM > 1 ? 's' : ''} from the field.`),
            readback: this._t(() => msg`${sqRb}${qnhPart}rappellerons à ${ZONE_NM} NM, ${this._abbr()}.`,
                () => msg`${sqRb}${qnhPart}wilco, ${this._abbr()}.`),
        }, nearby);
    }

    _handToTower() {
        this.state = 'toTower';
        const contact = this._contactTok('tower');
        return {
            message: this._t(() => msg`${this._abbr()}, ${contact}.`, () => msg`${this._abbr()}, ${contact}.`),
            readback: msg`${this._stationShort('tower')} ${this._freqTok('tower')}, ${this._abbr()}.`,
            then: () => this.setFrequency('tower'),
        };
    }

    _repeat() {
        return this.lastAtc ? { ...this.lastAtc, repeat: true } : null;
    }

    _atisMessage() {
        const m = this.metar;
        const L = tok(PHONETIC[this.atisLetter]);
        const rw = this._activeRunway();
        const time = tok(this.atisTime, this._digits(this.atisTime));
        const rwy = tok(rw.name, this._digits(rw.name));
        return this._t(
            () => msg`${this._stationName()} information ${L}, enregistrée à ${time} UTC. Piste en service ${rwy}. ${this._capital(this._atisWind())}. Visibilité ${m.vis[0]}. ${this._capital(tok(m.clouds[0]))}. Température ${m.temp}, point de rosée ${m.dew}. ${this._qnh()}. Tour de piste main gauche. Sol ${this._freqTok('ground')}, Tour ${this._freqTok('tower')}. Au premier contact, confirmez avoir reçu l'information ${L}.`,
            () => msg`${this._stationName()} information ${L}, time ${time}. Runway in use ${rwy}. ${this._capital(this._atisWind())}. Visibility ${m.vis[1]}. ${this._capital(tok(m.clouds[1]))}. Temperature ${m.temp}, dew point ${m.dew}. ${this._qnh()}. Left-hand circuit. Ground ${this._freqTok('ground')}, Tower ${this._freqTok('tower')}. Acknowledge information ${L} on initial contact.`);
    }

    // --- Émission -------------------------------------------------------------------------------
    // Message d'un contrôleur sans demande du pilote : entendu seulement sur sa fréquence, après un premier contact
    _say(station, fr, en, rbFr = null, rbEn = null) {
        if (this.freq !== station || !this.contacted.has(station) || !this.radioOk) return;
        const gen = this._gen;
        const reply = { message: this._t(fr, en), readback: rbFr ? this._t(rbFr, rbEn) : null };
        this._queue(async () => {
            while (this._frequencyBusy() && gen === this._gen) await wait(500);   // pas pendant l'échange d'un autre
            const clip = this._prepare(station, reply.message);
            await wait(400);
            await this._controller(reply, gen, clip);
        });
    }

    // Message spontané complet (avec collationnement éventuel et choix "trafic en vue / recherchons")
    _sayReply(station, reply) {
        if (this.freq !== station || !this.contacted.has(station) || !this.radioOk) return;
        const gen = this._gen;
        this._queue(async () => {
            while (this._frequencyBusy() && gen === this._gen) await wait(500);
            const clip = this._prepare(station, reply.message);
            await wait(400);
            await this._controller(reply, gen, clip);
        });
    }

    async _controller(reply, gen, clip = null) {
        if (gen !== this._gen) return;
        if (!reply.keepLast) this.lastAtc = { message: reply.message, readback: reply.readback, altReadback: reply.altReadback,
            labels: reply.labels, then: reply.then, station: this.freq };
        await this._transmit('atc', reply.message, gen, clip, Boolean(reply.readback) || Boolean(reply.keepLast));
        if (gen !== this._gen || reply.keepLast) return;
        this.pending = reply.readback ? { message: reply.readback, alt: reply.altReadback ?? null, labels: reply.labels ?? null,
            then: reply.then, time: 0, reminders: 0, clip: this._prepare('pilot', reply.readback) } : null;
        if (!reply.readback) reply.then?.();
        this._optionsKey = '';
        this._changed();
    }

    _queue(task) {
        this._queued++;
        this._setBusy(true);
        const gen = this._gen;
        this._chain = this._chain.then(task).catch((error) => console.error(error)).finally(() => {
            if (gen !== this._gen) return;
            this._queued--;
            if (this._queued <= 0) this._setBusy(false);
        });
    }

    _setBusy(busy) {
        if (this.busy === busy) return;
        this.busy = busy;
        this._optionsKey = '';
        this._changed();
    }

    // Ligne d'information dans le journal (changement de fréquence…)
    _note(text) {
        this.log.push({ from: 'info', text });
        if (this.log.length > 40) this.log.shift();
        this._optionsKey = '';
        this._changed();
    }

    // --- Multijoueur : la radio est partagée ----------------------------------------------------
    // Message d'un autre joueur ou de son contrôleur, entendu seulement sur la même fréquence. La fréquence reste
    // occupée pendant tout l'échange (de son appel à son collationnement) : on ne peut pas transmettre
    receiveRemote({ id, name, freq, from, text, speech, lang, reply }) {
        if (freq !== this.freq || !this.radioOk) return;
        const gen = this._gen;
        this._hold = { id, name, until: performance.now() + 60000 };
        const clip = this.voice ? this.voices.prepare(speech, from === 'pilot' ? 'otherPilot' : freq, { lang, seed: id }) : null;
        clip?.catch(() => {});
        this._changed();
        this._queue(async () => {
            const voice = await clip?.catch(() => null);
            if (gen !== this._gen || freq !== this.freq) return;
            const label = from === 'pilot' ? name.toUpperCase().slice(0, 12) : STATIONS[freq].fr.toUpperCase();
            const kind = from === 'pilot' ? 'remote' : 'atc';
            this.log.push({ from: kind, text, station: label });
            if (this.log.length > 40) this.log.shift();
            this.dispatchEvent({ type: 'transmit', from: kind, text, station: freq, label, on: true });
            this._changed();
            this.sounds?.squelch(0.16, 0.08);
            if (voice && this.voice) await voice.play();
            else await wait((0.8 + text.length * 0.065) * 1000);
            this.sounds?.squelch(0.22, 0.14);
            this.dispatchEvent({ type: 'transmit', from: kind, text, station: freq, label, on: false });
            // Réponse attendue (du contrôleur ou le collationnement) : la fréquence reste tenue un moment
            if (this._hold?.id === id) this._hold.until = performance.now() + (reply ? (from === 'pilot' ? 10000 : 30000) : 1200);
        });
    }

    _frequencyBusy() {
        return Boolean(this._hold) && performance.now() < this._hold.until;
    }

    // Immatriculation (multijoueur : une par joueur)
    setRegistration(registration) {
        if (registration === this.registration) return;
        this.registration = registration;
        this._optionsKey = '';
        this._changed();
    }

    // Voix d'un message (calculée à l'avance) ; null si la lecture à voix haute est coupée
    _prepare(role, message) {
        if (!this.voice) return null;
        const clip = this.voices.prepare(message.speech, role);
        clip.catch(() => {});
        return clip;
    }

    async _transmit(from, message, gen, prepared = null, reply = false) {
        if (gen !== this._gen) return;
        const role = from === 'pilot' ? 'pilot' : from === 'atis' ? 'atis' : this.freq;
        const clip = await (prepared ?? this._prepare(role, message));
        if (gen !== this._gen) return;
        // Multijoueur : les autres joueurs sur la même fréquence entendent l'échange (pas l'ATIS, propre à chacun)
        if (from !== 'atis') this.dispatchEvent({ type: 'broadcast', message: { f: this.freq, w: from, t: message.text, s: message.speech, l: this.lang, r: reply } });
        this.log.push({ from, text: message.text, station: from === 'atc' ? STATIONS[this.freq].fr.toUpperCase() : null });
        if (this.log.length > 40) this.log.shift();
        this.dispatchEvent({ type: 'transmit', from, text: message.text, station: this.freq, on: true });
        this._changed();
        this.sounds?.squelch(0.16, 0.08);
        if (clip && this.voice) await clip.play();
        else await wait((0.8 + message.text.length * 0.065) * 1000);
        this.sounds?.squelch(0.22, 0.14);
        this.dispatchEvent({ type: 'transmit', from, text: message.text, station: this.freq, on: false });
    }

    _changed() {
        this.dispatchEvent({ type: 'change' });
    }

    _stampAtis() {
        const now = new Date();
        const minutes = now.getUTCMinutes() < 30 ? '00' : '30';
        this.atisTime = String(now.getUTCHours()).padStart(2, '0') + minutes;
    }

    // --- Mots du message (affichés / prononcés) -------------------------------------------------
    _t(fr, en) {
        return this.lang === 'fr' ? fr() : en();
    }

    _digits(text) {
        return String(text).split('').map((c) => DIGITS[this.lang][+c] ?? c).join(' ');
    }

    _spell(text) {
        return text.replace(/-/g, '').split('').map((c) => PHONETIC[c] ?? DIGITS[this.lang][+c] ?? c).join(' ');
    }

    _full() {
        return tok(this.registration, this._spell(this.registration));
    }

    // Indicatif abrégé : première lettre et deux dernières (F-HESM -> F-SM)
    _abbr() {
        return this._abbrOf(this.registration);
    }

    _abbrOf(registration) {
        const r = registration.replace(/-/g, '');
        const short = `${r[0]}-${r.slice(-2)}`;
        return tok(short, this._spell(short));
    }

    // Le pilote n'abrège son indicatif qu'après qu'un contrôleur l'a fait
    _pilotCs() {
        return this.abbreviated ? this._abbr() : this._full();
    }

    _persons() {
        const n = this.persons;
        return this._t(() => `${n} personne${n > 1 ? 's' : ''} à bord`, () => `${n} person${n > 1 ? 's' : ''} on board`);
    }

    // Nom de l'aérodrome tel qu'il est prononcé (synthèse vocale)
    _spoken() {
        const speech = this.aerodrome.speech;
        return speech?.[this.lang] ?? (this.lang === 'fr' ? 'Esmé' : 'Ezmay');
    }

    _stationName() {
        return tok(this.aerodrome.name, this._spoken());
    }

    // "ESME Sol", "ESME Tower"…
    _station(id = this.freq) {
        const word = STATIONS[id][this.lang];
        return tok(`${this.aerodrome.name} ${word}`, `${this._spoken()} ${word}`);
    }

    // Station sans le nom du terrain, dans les collationnements ("Tour 118.300")
    _stationShort(id) {
        return STATIONS[id][this.lang];
    }

    // 118.300 -> "un un huit décimale trois"
    _freqTok(id) {
        const f = this.aerodrome.frequencies[id];
        const [whole, decimals] = f.split('.');
        const spoken = `${this._digits(whole)} ${this.lang === 'fr' ? 'décimale' : 'decimal'} ${this._digits(decimals.replace(/0+$/, '') || '0')}`;
        return tok(f, spoken);
    }

    // "contactez ESME Tour 118.300"
    _contactTok(id) {
        return this._t(() => msg`contactez ${this._station(id)} ${this._freqTok(id)}`, () => msg`contact ${this._station(id)} ${this._freqTok(id)}`);
    }

    _code(code) {
        return tok(code, this._digits(code));
    }

    _greet() {
        return this._t(() => (this.metar.night ? 'bonsoir' : 'bonjour'), () => (this.metar.night ? 'good evening' : 'good day'));
    }

    _rwy(rw) {
        return this._t(() => tok(`piste ${rw.name}`, `piste ${this._digits(rw.name)}`), () => tok(`runway ${rw.name}`, `runway ${this._digits(rw.name)}`));
    }

    _qnh() {
        return tok(`QNH ${QNH}`, `Q N H ${this._digits(QNH)}`);
    }

    _twy() {
        const t = this.aerodrome.taxiway;
        return tok(t, PHONETIC[t] ?? t);
    }

    _stand(name) {
        const spoken = `${PHONETIC[name[0]] ?? name[0]} ${this._digits(name.slice(1))}`;
        return this._t(() => tok(`parking ${name}`, `parking ${spoken}`), () => tok(`stand ${name}`, `stand ${spoken}`));
    }

    _atisTok() {
        return tok(`information ${PHONETIC[this.atisLetter]}`);
    }

    // "à 3 NM au nord du terrain, 1500 pieds"
    _position(s) {
        return this._t(
            () => msg`à ${this._nm(s.distance)} ${this._au(s.bearing)} du terrain, ${s.altitude} pieds`,
            () => msg`${this._nm(s.distance)} ${CARDINALS.en[this._octant(s.bearing)]} of the field, ${s.altitude} feet`);
    }

    // Vent instantané (autorisations) : direction arrondie à 10°, force, rafales en cours
    _wind() {
        const w = this.wind;
        if (w.calm) return this._t(() => tok('vent calme'), () => tok('wind calm'));
        const dir = String((Math.round(w.direction / 10) * 10) % 360 || 360).padStart(3, '0');
        const knots = Math.max(1, Math.round(w.speed));
        const gust = w.gust && w.speed > w.knots + 5 ? Math.round(w.gust) : 0;
        return this._windTok(dir, knots, gust, null);
    }

    // Vent moyen de l'ATIS, avec ses extrêmes s'il est variable de 60° ou plus
    _atisWind() {
        const w = this.wind;
        if (w.calm) return this._t(() => tok('vent calme'), () => tok('wind calm'));
        const dir = String(w.base % 360 || 360).padStart(3, '0');
        const range = w.variation >= 60 ? w.range.map((d) => String(d).padStart(3, '0')) : null;
        return this._windTok(dir, w.knots, w.gust, range);
    }

    _windTok(dir, knots, gust, range) {
        const fr = (spell) => `vent ${spell(dir)} degrés, ${knots} nœuds${gust ? `, rafales ${gust} nœuds` : ''}${range ? `, variable entre ${spell(range[0])} et ${spell(range[1])} degrés` : ''}`;
        const en = (spell) => `wind ${spell(dir)} degrees, ${knots} knots${gust ? `, gusting ${gust} knots` : ''}${range ? `, variable between ${spell(range[0])} and ${spell(range[1])} degrees` : ''}`;
        const plain = (x) => x;
        const spoken = (x) => this._digits(x);
        return this._t(() => tok(fr(plain), fr(spoken)), () => tok(en(plain), en(spoken)));
    }

    _nm(distance) {
        const n = Math.max(1, Math.round(distance));
        return this._t(() => tok(`${n} NM`, `${n} nautique${n > 1 ? 's' : ''}`), () => tok(`${n} NM`, `${n} mile${n > 1 ? 's' : ''}`));
    }

    _octant(degrees) {
        return Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
    }

    _cardinal(degrees) {
        return CARDINALS.fr[this._octant(degrees)];
    }

    // "au nord", "à l'est"…
    _au(degrees) {
        const word = this._cardinal(degrees);
        return /^[eo]/.test(word) ? `à l'${word}` : `au ${word}`;
    }

    // "par le nord", "par l'ouest" / "to the north"
    _par(degrees) {
        const word = this._cardinal(degrees);
        return this._t(() => (/^[eo]/.test(word) ? `par l'${word}` : `par le ${word}`), () => `to the ${CARDINALS.en[this._octant(degrees)]}`);
    }

    _capital(t) {
        if (!t) return '';
        const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
        return tok(cap(t.d), cap(t.s));
    }
}

export { ATC, LABELS };
