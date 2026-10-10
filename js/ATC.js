import { EventDispatcher } from 'three';

// Tour de contrôle de l'aérodrome : contrôleur automatique (à règles) qui suit le vol pas à pas, avec la
// phraséologie officielle (DGAC en français, OACI en anglais). Le pilote choisit ses messages dans une liste qui
// dépend de la phase du vol ; chaque instruction de la tour doit être collationnée. Les messages sont lus par la
// synthèse vocale du navigateur (une voix pour le pilote, une autre pour le contrôleur).

const FT = 0.3048;
const NM = 1852;
const READBACK_TIMEOUT = 20;    // s sans collationnement : la tour le réclame
const PHONETIC = {
    A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
    J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
    S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};
const DIGITS = {
    fr: ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'],
    en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'],
};
const CARDINALS = {
    fr: ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'],
    en: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
};
// Bulletin ATIS de chaque météo (le QNH reste standard : l'altimètre de l'avion n'a pas de calage)
const METARS = {
    jour:       { wind: 360, vis: ['10 km ou plus', '10 kilometres or more'], clouds: ['peu nombreux à 3000 pieds', 'few clouds 3000 feet'], temp: 18, dew: 9 },
    nuageux:    { wind: 340, vis: ['8 km', '8 kilometres'], clouds: ['couvert à 1000 pieds', 'overcast 1000 feet'], temp: 12, dew: 9 },
    nuit:       { wind: 10, vis: ['10 km ou plus', '10 kilometres or more'], clouds: ['ciel clair', 'sky clear'], temp: 9, dew: 4 },
    brouillard: { wind: 360, vis: ['400 mètres, brouillard', '400 metres, fog'], clouds: ['ciel invisible', 'sky obscured'], temp: 7, dew: 7 },
    tempete:    { wind: 350, gust: 32, vis: ['3000 mètres, orage avec forte pluie', '3000 metres, heavy thunderstorm with rain'], clouds: ['fragmentés à 800 pieds, cumulonimbus', 'broken 800 feet, cumulonimbus'], temp: 14, dew: 12 },
};
const QNH = '1013';
const MALE_VOICE = /paul|david|mark|george|guy|thomas|daniel|claude|henri|male|homme/i;
// Intitulés des cases (interface en français), quelle que soit la langue des messages
const LABELS = {
    startupFirst: 'Premier contact · mise en route', taxiFirst: 'Premier contact · roulage',
    readyFirst: 'Premier contact · prêt au départ', startup: 'Demande de mise en route', taxi: 'Demande de roulage',
    readyHold: "Point d'attente · prêt au départ", readyRunway: 'Aligné · prêt au départ', downwind: 'Vent arrière',
    finalFull: 'Finale · atterrissage complet', finalTouch: 'Finale · toucher', goAround: 'Remise de gaz',
    leaveCircuit: 'Quitter le circuit', leaveZone: 'Sortie de zone · quitter la fréquence',
    inboundJoin: 'Premier contact · intégration vent arrière', inboundStraight: 'Premier contact · finale directe',
    request: "Demande d'intégration", vacated: 'Piste dégagée', parked: 'Au parking · fin de vol',
    readback: 'Collationner', sayAgain: 'Répétez',
};
const STATUS = {
    idle: 'Pas de contact radio', startup: 'Mise en route approuvée', taxi: "Roulage vers le point d'attente",
    holding: "Maintien au point d'attente", lineup: 'Maintien sur la piste', takeoff: 'Autorisé au décollage',
    circuit: 'Tour de piste : rappeler vent arrière', inbound: 'Intégration : rappeler vent arrière',
    downwind: 'Rappeler en finale', continue: "Continuer l'approche", landing: "Autorisé à l'atterrissage",
    touchgo: 'Autorisé toucher', landed: 'Atterri', vacate: 'Dégager la piste, rappeler piste dégagée',
    taxiIn: 'Roulage vers le parking', leaving: 'Rappeler sortie de zone',
};

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
    constructor({ airport, sounds = null, registration = 'F-HESM', aircraftType = 'Cessna 172' }) {
        super();
        this.airport = airport;
        this.aerodrome = airport.aerodrome;
        this.sounds = sounds;
        this.registration = registration;
        this.aircraftType = aircraftType;
        this.lang = 'fr';
        this.voice = true;
        this.log = [];
        this.busy = false;
        this.traffic = [];
        this.atisIndex = Math.floor(Math.random() * 6);
        this.atisHeard = -1;
        this._stampAtis();
        this.metar = { ...METARS.jour, night: false };
        this.options = [];
        this._optionsKey = '';
        this._chain = Promise.resolve();
        this._queued = 0;
        this._gen = 0;
        this.reset();
    }

    get atisLetter() {
        return Object.keys(PHONETIC)[this.atisIndex % 26];
    }

    get status() {
        if (!this.contact) return STATUS.idle;
        if (this.state === 'taxiIn') return `Roulage vers le parking ${this.assignedStand}`;
        return STATUS[this.state] ?? '';
    }

    // Nouveau départ (ou touche R) : plus de contact ni d'autorisation
    reset(spawn = null) {
        this._gen++;
        window.speechSynthesis?.cancel();
        this._chain = Promise.resolve();
        this._queued = 0;
        this.busy = false;
        this.contact = false;
        this.abbreviated = false;
        this.state = 'idle';
        this.pending = null;
        this.lastAtc = null;
        this.warned = {};
        this.assignedStand = spawn?.stand ?? this.aerodrome.stands.find((s) => s.free)?.name ?? 'N4';
        this._airborne = false;
        this._touched = false;
        this._prevZone = null;
        this._clearDelay = 0;
        this._changed();
    }

    setLanguage(lang) {
        this.lang = lang === 'en' ? 'en' : 'fr';
        this._optionsKey = '';
        this._changed();
    }

    setVoice(on) {
        this.voice = on;
        if (!on) window.speechSynthesis?.cancel();
    }

    // Météo du panneau : vent, visibilité, nuages ; une nouvelle lettre ATIS à chaque changement
    setWeather(name, weather) {
        const metar = METARS[name] ?? METARS.jour;
        const knots = Math.round((weather?.wind ?? 0.3) * 20);
        const changed = this._weatherName && this._weatherName !== name;
        this._weatherName = name;
        this.metar = { ...metar, knots, night: (weather?.night ?? 0) >= 0.5 };
        if (changed) {
            this.atisIndex++;
            this._stampAtis();
            this._changed();
        }
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
        option.action?.();
        const gen = this._gen;
        this._queue(async () => {
            await this._transmit('pilot', option.message, gen);
            if (!option.reply || gen !== this._gen) return;
            await wait(900 + Math.random() * 1300);
            if (gen !== this._gen) return;
            const reply = option.reply();
            if (reply) await this._controller(reply, gen);
        });
    }

    playAtis() {
        if (this.busy) return;
        const gen = this._gen;
        this.atisHeard = this.atisIndex;
        this._queue(() => this._transmit('atis', this._atisMessage(), gen));
    }

    // --- Situation de l'avion ----------------------------------------------------------------
    _situation(input) {
        const p = input.position;
        const runways = this.airport.runways;
        const cx = (runways[0].threshold.x + runways[1].threshold.x) / 2;
        const cz = (runways[0].threshold.z + runways[1].threshold.z) / 2;
        const dx = p.x - cx, dz = p.z - cz;
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
            zone: this.airport.zoneAt(p.x, p.z),
            stand: this.airport.standAt(p.x, p.z),
            active: this._activeRunway(),
            aligned: null,
            final: null,
            downwind: false,
        };
        for (const rw of runways) {
            const along = (p.x - rw.threshold.x) * rw.direction.x + (p.z - rw.threshold.z) * rw.direction.z;
            const lateral = (p.x - rw.threshold.x) * rw.left.x + (p.z - rw.threshold.z) * rw.left.z;
            const hd = headingDiff(s.heading, rw.heading);
            if (s.zone === 'runway' && input.onGround && hd < 35) s.aligned = rw;
            if (s.airborne && along > -6000 && along < 200 && Math.abs(lateral) < 600 && hd < 40 && s.agl < 3000) s.final = rw;
            // Vent arrière main gauche : à gauche de la piste en service, cap opposé
            if (rw === s.active && s.airborne && lateral > 300 && lateral < 4000 && along > -3000 && along < 2500
                && headingDiff(s.heading, rw.heading + 180) < 60) s.downwind = true;
        }
        return s;
    }

    // Piste face au vent (vent calme : la 36)
    _activeRunway() {
        const runways = this.airport.runways;
        if (!this.metar.knots || this.metar.knots < 3) return runways[0];
        return runways.reduce((best, rw) => headingDiff(rw.heading, this.metar.wind) < headingDiff(best.heading, this.metar.wind) ? rw : best);
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

    // --- Événements surveillés par la tour ------------------------------------------------------
    _automation(delta, s) {
        const gen = this._gen;
        const traffic = this._trafficInfo();

        // Collationnement attendu
        if (this.pending && !this.busy) {
            this.pending.time += delta;
            if (this.pending.time > READBACK_TIMEOUT && this.pending.reminders < 2) {
                this.pending.time = 0;
                this.pending.reminders++;
                this._queue(() => this._controller({ message: this._t(
                    () => msg`${this._abbr()}, collationnez.`,
                    () => msg`${this._abbr()}, read back.`), keepLast: true }, gen));
            }
        }

        // Décollage / atterrissage
        if (!this._airborne && s.airborne && s.agl > 20) {
            this._airborne = true;
            if (this.state === 'touchgo' && this._touched) this.state = 'circuit';
            else if (this.contact && this.state !== 'takeoff' && this.state !== 'touchgo') {
                this.state = 'circuit';
                this._say(() => msg`${this._abbr()}, vous avez décollé sans autorisation, rappelez vent arrière main gauche ${this._rwy(s.active)}.`,
                    () => msg`${this._abbr()}, you took off without clearance, report left downwind ${this._rwy(s.active)}.`,
                    () => msg`Rappellerons vent arrière, ${this._abbr()}.`, () => msg`Wilco, ${this._abbr()}.`);
            }
            this._changed();
        } else if (this._airborne && s.onGround) {
            this._airborne = false;
            if (s.zone === 'runway') {
                if (this.state === 'landing') this.state = 'landed';
                else if (this.state === 'touchgo') this._touched = true;
                else if (this.contact) {
                    this.state = 'vacate';
                    this._say(() => msg`${this._abbr()}, vous avez atterri sans autorisation. Dégagez par ${this._twy()}, rappelez piste dégagée.`,
                        () => msg`${this._abbr()}, you landed without clearance. Vacate via ${this._twy()}, report runway vacated.`,
                        () => msg`Dégageons par ${this._twy()}, rappellerons piste dégagée, ${this._abbr()}.`,
                        () => msg`Vacating via ${this._twy()}, wilco, ${this._abbr()}.`);
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
            this._say(() => msg`${this._abbr()}, dégagez par ${this._twy()}, rappelez piste dégagée.`,
                () => msg`${this._abbr()}, vacate via ${this._twy()}, report runway vacated.`,
                () => msg`Dégageons par ${this._twy()}, rappellerons piste dégagée, ${this._abbr()}.`,
                () => msg`Vacating via ${this._twy()}, wilco, ${this._abbr()}.`);
        }

        // Attente au point d'attente / sur la piste : autorisation dès que la piste est libre
        if ((this.state === 'holding' || this.state === 'lineup') && !this.busy && !this.pending) {
            this._clearDelay += delta;
            if (this._clearDelay > 4 && !traffic.onRunway && traffic.onFinal === 0) {
                const rw = this._departureRunway ?? s.active;
                const lineUp = this.state === 'holding';
                this.state = 'takeoff';
                this._say(...this._takeoffClearance(rw, lineUp));
            }
        }

        // Approche : autorisation quand la piste se libère, sinon remise de gaz imposée en courte finale
        if (this.state === 'continue' && !this.busy && !this.pending) {
            const rw = this._landingRunway ?? s.active;
            if (!traffic.onRunway) {
                this.state = this._touchAndGo ? 'touchgo' : 'landing';
                this._say(...this._landingClearance(rw, this._touchAndGo));
            } else if (s.airborne && s.agl < 300) {
                this.state = 'circuit';
                this._say(() => msg`${this._abbr()}, remettez les gaz, trafic sur la piste, rappelez vent arrière.`,
                    () => msg`${this._abbr()}, go around, traffic on the runway, report downwind.`,
                    () => msg`Remettons les gaz, rappellerons vent arrière, ${this._abbr()}.`,
                    () => msg`Going around, wilco, ${this._abbr()}.`);
            }
        }

        // Roulage sans autorisation
        if (this.contact && s.onGround && (s.zone === 'apron' || s.zone === 'taxiway') && s.speed > 3
            && ['idle', 'startup'].includes(this.state) && !this.warned.taxi) {
            this.warned.taxi = true;
            this._say(() => msg`${this._abbr()}, vous n'êtes pas autorisé à rouler, maintenez position et rappelez prêt à rouler.`,
                () => msg`${this._abbr()}, you are not cleared to taxi, hold position and report ready to taxi.`,
                () => msg`Maintenons position, ${this._abbr()}.`, () => msg`Holding position, ${this._abbr()}.`);
        }

        // Point d'attente franchi sans autorisation (incursion sur piste)
        if (this.contact && s.onGround && this._prevZone === 'taxiway' && (s.zone === 'entry' || s.zone === 'runway')
            && this.state !== 'takeoff' && !this.warned.incursion) {
            this.warned.incursion = true;
            this._say(() => msg`${this._abbr()}, arrêtez immédiatement, vous n'êtes pas autorisé sur la piste.`,
                () => msg`${this._abbr()}, stop immediately, you are not cleared onto the runway.`,
                () => msg`Arrêtons, ${this._abbr()}.`, () => msg`Stopping, ${this._abbr()}.`);
        }
        if (s.zone === 'taxiway' || s.zone === 'apron') this.warned.incursion = false;
        this._prevZone = s.zone;
    }

    // --- Messages proposés au pilote -------------------------------------------------------------
    _refreshOptions(s) {
        const options = s && !this.busy ? this._buildOptions(s) : [];
        const key = options.map((o) => o.id + o.message.text).join('|') + this.busy;
        if (key === this._optionsKey) return;
        this._optionsKey = key;
        this.options = options;
        this._changed();
    }

    _buildOptions(s) {
        const list = [];
        const add = (id, message, reply = null, action = null) => list.push({ id, label: LABELS[id] ?? id, message, reply, action });
        const cs = () => this._pilotCs();

        if (this.pending) {
            const pending = this.pending;
            add('readback', pending.message, null, () => { this.pending = null; });
            add('sayAgain', this._t(() => msg`${cs()}, répétez.`, () => msg`${cs()}, say again.`), () => this._repeat());
            return list;
        }

        if (s.onGround) this._groundOptions(s, add);
        else if (s.airborne) this._airOptions(s, add);

        if (this.lastAtc && this.contact) add('sayAgain', this._t(() => msg`${cs()}, répétez.`, () => msg`${cs()}, say again.`), () => this._repeat());
        return list;
    }

    _groundOptions(s, add) {
        const cs = () => this._pilotCs();
        const rw = s.active;
        const standTok = () => s.stand ? this._stand(s.stand) : this._t(() => tok('au parking'), () => tok('on the apron'));
        const atis = () => this.atisHeard === this.atisIndex ? this._t(() => msg`avec l'${this._atisTok()}, `, () => msg`${this._atisTok()}, `) : '';

        if (s.zone === 'apron') {
            if (this.state === 'taxiIn' || this.state === 'vacate') {
                if (s.speed < 0.5 && s.stand) add('parked', this._t(
                    () => msg`${cs()}, au ${this._stand(s.stand)}, quittons la fréquence, au revoir.`,
                    () => msg`${cs()}, on ${this._stand(s.stand)}, leaving the frequency, goodbye.`),
                () => {
                    this.contact = false;
                    this.abbreviated = false;
                    this.state = 'idle';
                    return { message: this._t(() => msg`${this._abbr()}, au revoir.`, () => msg`${this._abbr()}, goodbye.`) };
                });
                return;
            }
            if (!this.contact) {
                if (!s.engine) add('startupFirst', this._t(
                    () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType} ${this._t(() => tok(s.stand ? 'au ' : ''), () => tok(s.stand ? 'at ' : ''))}${standTok()}, ${atis()}pour un vol local, demandons la mise en route.`,
                    () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType} ${this._t(() => tok(''), () => tok(s.stand ? 'at ' : ''))}${standTok()}, ${atis()}local flight, request start-up.`),
                () => this._startupReply(rw, true));
                else add('taxiFirst', this._taxiRequest(s, true), () => this._taxiReply(rw, true));
                return;
            }
            if (!s.engine && this.state === 'idle') add('startup', this._t(
                () => msg`${cs()}, demandons la mise en route.`, () => msg`${cs()}, request start-up.`),
            () => this._startupReply(rw, false));
            if (s.engine && (this.state === 'idle' || this.state === 'startup')) add('taxi', this._taxiRequest(s, false), () => this._taxiReply(rw, false));
            return;
        }

        if (s.zone === 'taxiway' || s.zone === 'entry') {
            if (this.state === 'vacate' || this.state === 'landed') {
                add('vacated', this._t(() => msg`${cs()}, piste dégagée.`, () => msg`${cs()}, runway vacated.`), () => {
                    this.state = 'taxiIn';
                    const stand = this._stand(this.assignedStand);
                    return {
                        message: this._t(() => msg`${this._abbr()}, roulez ${stand} via ${this._twy()}.`,
                            () => msg`${this._abbr()}, taxi to ${stand} via ${this._twy()}.`),
                        readback: this._t(() => msg`Roulons ${stand} via ${this._twy()}, ${this._abbr()}.`,
                            () => msg`Taxi to ${stand} via ${this._twy()}, ${this._abbr()}.`),
                    };
                });
                return;
            }
            if (this.state === 'taxiIn' || this.state === 'holding' || this.state === 'takeoff') return;
            const nearHolding = s.position.x < this.aerodrome.holdingX + 20;
            if (!this.contact) {
                if (nearHolding) add('readyFirst', this._t(
                    () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, point d'attente ${this._rwy(rw)}, ${atis()}pour un vol local, prêt au départ.`,
                    () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, holding point ${this._rwy(rw)}, ${atis()}local flight, ready for departure.`),
                () => this._departureReply(rw, true, true));
                else add('taxiFirst', this._taxiRequest(s, true), () => this._taxiReply(rw, true));
                return;
            }
            if (nearHolding && s.speed < 3) add('readyHold', this._t(
                () => msg`${cs()}, point d'attente ${this._rwy(rw)}, prêt au départ.`,
                () => msg`${cs()}, holding point ${this._rwy(rw)}, ready for departure.`),
            () => this._departureReply(rw, true, false));
            else if (this.state !== 'taxi') add('taxi', this._taxiRequest(s, false), () => this._taxiReply(rw, false));
            return;
        }

        if (s.zone === 'runway' && s.aligned && s.speed < 3
            && !['landed', 'vacate', 'landing', 'touchgo', 'takeoff', 'lineup'].includes(this.state)) {
            const here = s.aligned;
            if (!this.contact) add('readyFirst', this._t(
                () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, aligné ${this._rwy(here)}, ${atis()}pour un vol local, prêt au départ.`,
                () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, lined up ${this._rwy(here)}, ${atis()}local flight, ready for departure.`),
            () => this._departureReply(here, false, true));
            else add('readyRunway', this._t(
                () => msg`${cs()}, aligné ${this._rwy(here)}, prêt au départ.`,
                () => msg`${cs()}, lined up ${this._rwy(here)}, ready for departure.`),
            () => this._departureReply(here, false, false));
        }
    }

    _airOptions(s, add) {
        const cs = () => this._pilotCs();
        const rw = s.active;
        const atis = () => this.atisHeard === this.atisIndex ? this._t(() => msg`avec l'${this._atisTok()}, `, () => msg`${this._atisTok()}, `) : '';
        const position = () => this._t(
            () => msg`à ${this._nm(s.distance)} ${this._au(s.bearing)} du terrain, ${s.altitude} pieds`,
            () => msg`${this._nm(s.distance)} ${CARDINALS.en[this._octant(s.bearing)]} of the field, ${s.altitude} feet`);

        if (!this.contact) {
            add('inboundJoin', this._t(
                () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, ${position()}, ${atis()}pour un atterrissage.`,
                () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, ${position()}, ${atis()}for landing.`),
            () => this._joinReply(rw, false));
            add('inboundStraight', this._t(
                () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, ${position()}, ${atis()}demandons une finale directe ${this._rwy(s.final ?? rw)}.`,
                () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType}, ${position()}, ${atis()}request straight-in approach ${this._rwy(s.final ?? rw)}.`),
            () => this._joinReply(s.final ?? rw, true));
            return;
        }

        if (this.state === 'leaving') {
            if (s.distance > 2.5) add('leaveZone', this._leaveZoneRequest(), () => this._leaveZoneReply());
            return;
        }

        const approach = ['landing', 'touchgo', 'continue'].includes(this.state);
        const inCircuit = ['circuit', 'inbound', 'downwind', 'takeoff'].includes(this.state);
        let reported = false;
        if ((s.downwind || (inCircuit && !s.final && this.state !== 'downwind')) && !approach && this.state !== 'downwind') {
            reported = true;
            add('downwind', this._t(() => msg`${cs()}, vent arrière main gauche ${this._rwy(rw)}.`,
                () => msg`${cs()}, left downwind ${this._rwy(rw)}.`), () => {
                this.state = 'downwind';
                const number = 1 + this._trafficInfo().onFinal;
                return number > 1 ? {
                    message: this._t(() => msg`${this._abbr()}, numéro ${number}, suivez le trafic en finale, rappelez en finale.`,
                        () => msg`${this._abbr()}, number ${number}, follow the traffic on final, report final.`),
                    readback: this._t(() => msg`Numéro ${number}, trafic en vue, rappellerons en finale, ${this._abbr()}.`,
                        () => msg`Number ${number}, traffic in sight, wilco, ${this._abbr()}.`),
                } : {
                    message: this._t(() => msg`${this._abbr()}, numéro 1, rappelez en finale.`, () => msg`${this._abbr()}, number 1, report final.`),
                    readback: this._t(() => msg`Numéro 1, rappellerons en finale, ${this._abbr()}.`, () => msg`Number 1, wilco, ${this._abbr()}.`),
                };
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
        if (!approach && !s.final && s.distance < 4) add('leaveCircuit', this._t(
            () => this._leaveCircuitFr(cs(), s),
            () => msg`${cs()}, leaving the circuit to the ${CARDINALS.en[this._octant(s.heading)]}, ${s.altitude} feet.`), () => {
            this.state = 'leaving';
            return {
                message: this._t(() => msg`${this._abbr()}, rappelez sortie de zone.`, () => msg`${this._abbr()}, report leaving the zone.`),
                readback: this._t(() => msg`Rappellerons sortie de zone, ${this._abbr()}.`, () => msg`Wilco, ${this._abbr()}.`),
            };
        });
        if (!approach && s.distance >= 4) add('leaveZone', this._leaveZoneRequest(), () => this._leaveZoneReply());
    }

    _leaveCircuitFr(cs, s) {
        const word = this._cardinal(s.heading);
        const article = /^[eo]/.test(word) ? "l'" : 'le ';
        return msg`${cs}, quittons le circuit vers ${article}${word}, ${s.altitude} pieds.`;
    }

    _leaveZoneRequest() {
        const cs = this._pilotCs();
        return this._t(() => msg`${cs}, sortie de zone, quittons la fréquence.`,
            () => msg`${cs}, leaving the zone, request frequency change.`);
    }

    _leaveZoneReply() {
        this.contact = false;
        this.abbreviated = false;
        this.state = 'idle';
        return {
            message: this._t(() => msg`${this._abbr()}, changement de fréquence approuvé, au revoir.`,
                () => msg`${this._abbr()}, frequency change approved, goodbye.`),
            readback: this._t(() => msg`Au revoir, ${this._abbr()}.`, () => msg`Goodbye, ${this._abbr()}.`),
        };
    }

    _taxiRequest(s, first) {
        const cs = this._pilotCs();
        const standTok = s.stand ? this._stand(s.stand) : this._t(() => tok('parking'), () => tok('apron'));
        const atis = this.atisHeard === this.atisIndex ? this._t(() => msg`avec l'${this._atisTok()}, `, () => msg`${this._atisTok()}, `) : '';
        if (!first) return this._t(() => msg`${cs}, prêt à rouler.`, () => msg`${cs}, request taxi.`);
        return this._t(
            () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType} au ${standTok}, ${atis}pour un vol local, prêt à rouler.`,
            () => msg`${this._station()}, ${this._full()}, ${this._greet()}, ${this.aircraftType} at ${standTok}, ${atis}local flight, request taxi.`);
    }

    // --- Réponses de la tour --------------------------------------------------------------------
    // Premier contact : la tour s'annonce et passe à l'indicatif abrégé ; sans l'ATIS, elle donne le vent
    _opening(first) {
        if (!first) return { fr: '', en: '' };
        this.contact = true;
        this.abbreviated = true;
        return { fr: msg`${this._station()}, ${this._greet()}, `, en: msg`${this._station()}, ${this._greet()}, ` };
    }

    _infoIfNeeded() {
        return this.atisHeard === this.atisIndex ? '' : this._t(() => msg`${this._wind()}, `, () => msg`${this._wind()}, `);
    }

    _startupReply(rw, first) {
        const open = this._opening(first);
        const info = this._infoIfNeeded();
        this.state = 'startup';
        return {
            message: this._t(() => msg`${this._abbr()}, ${open.fr}mise en route approuvée, ${this._rwy(rw)}, ${info}${this._qnh()}.`,
                () => msg`${this._abbr()}, ${open.en}start-up approved, ${this._rwy(rw)}, ${info}${this._qnh()}.`),
            readback: this._t(() => msg`Mise en route approuvée, ${this._rwy(rw)}, ${this._qnh()}, ${this._abbr()}.`,
                () => msg`Start-up approved, ${this._rwy(rw)}, ${this._qnh()}, ${this._abbr()}.`),
        };
    }

    _taxiReply(rw, first) {
        const open = this._opening(first);
        const info = this._infoIfNeeded();
        const withQnh = first || this.state !== 'startup';
        this.state = 'taxi';
        this.warned.taxi = false;
        const qnh = withQnh ? this._t(() => msg`, ${info}${this._qnh()}`, () => msg`, ${info}${this._qnh()}`) : '';
        return {
            message: this._t(() => msg`${this._abbr()}, ${open.fr}roulez point d'attente ${this._rwy(rw)} via ${this._twy()}${qnh}.`,
                () => msg`${this._abbr()}, ${open.en}taxi to holding point ${this._rwy(rw)} via ${this._twy()}${qnh}.`),
            readback: this._t(() => msg`Roulons point d'attente ${this._rwy(rw)} via ${this._twy()}${withQnh ? msg`, ${this._qnh()}` : ''}, ${this._abbr()}.`,
                () => msg`Taxi to holding point ${this._rwy(rw)} via ${this._twy()}${withQnh ? msg`, ${this._qnh()}` : ''}, ${this._abbr()}.`),
        };
    }

    _departureReply(rw, atHolding, first) {
        const open = this._opening(first);
        const traffic = this._trafficInfo();
        this._departureRunway = rw;
        if (traffic.onRunway || traffic.onFinal > 0) {
            this.state = atHolding ? 'holding' : 'lineup';
            this._clearDelay = 0;
            const what = traffic.onRunway ? this._t(() => tok('sur la piste'), () => tok('on the runway'))
                : this._t(() => tok('en finale'), () => tok('on final'));
            return atHolding ? {
                message: this._t(() => msg`${this._abbr()}, ${open.fr}maintenez point d'attente ${this._rwy(rw)}, trafic ${what}.`,
                    () => msg`${this._abbr()}, ${open.en}hold short of ${this._rwy(rw)}, traffic ${what}.`),
                readback: this._t(() => msg`Maintenons point d'attente ${this._rwy(rw)}, ${this._abbr()}.`,
                    () => msg`Holding short ${this._rwy(rw)}, ${this._abbr()}.`),
            } : {
                message: this._t(() => msg`${this._abbr()}, ${open.fr}maintenez position, trafic ${what}.`,
                    () => msg`${this._abbr()}, ${open.en}hold position, traffic ${what}.`),
                readback: this._t(() => msg`Maintenons position, ${this._abbr()}.`, () => msg`Holding position, ${this._abbr()}.`),
            };
        }
        this.state = 'takeoff';
        const [fr, en, rbFr, rbEn] = this._takeoffClearance(rw, atHolding, open);
        return { message: this._t(fr, en), readback: this._t(rbFr, rbEn) };
    }

    _takeoffClearance(rw, lineUp, open = { fr: '', en: '' }) {
        return lineUp ? [
            () => msg`${this._abbr()}, ${open.fr}alignez-vous ${this._rwy(rw)}, autorisé décollage, ${this._wind()}.`,
            () => msg`${this._abbr()}, ${open.en}line up ${this._rwy(rw)}, cleared for take-off, ${this._wind()}.`,
            () => msg`Alignons ${this._rwy(rw)}, autorisé décollage, ${this._abbr()}.`,
            () => msg`Lining up ${this._rwy(rw)}, cleared for take-off, ${this._abbr()}.`,
        ] : [
            () => msg`${this._abbr()}, ${open.fr}${this._rwy(rw)}, autorisé décollage, ${this._wind()}.`,
            () => msg`${this._abbr()}, ${open.en}${this._rwy(rw)}, cleared for take-off, ${this._wind()}.`,
            () => msg`Autorisé décollage ${this._rwy(rw)}, ${this._abbr()}.`,
            () => msg`Cleared for take-off ${this._rwy(rw)}, ${this._abbr()}.`,
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

    _joinReply(rw, straightIn) {
        const open = this._opening(true);
        const info = this._infoIfNeeded();
        this.state = straightIn ? 'downwind' : 'inbound';
        return straightIn ? {
            message: this._t(() => msg`${this._abbr()}, ${open.fr}rejoignez la longue finale ${this._rwy(rw)}, ${info}${this._qnh()}, rappelez en finale.`,
                () => msg`${this._abbr()}, ${open.en}join long final ${this._rwy(rw)}, ${info}${this._qnh()}, report final.`),
            readback: this._t(() => msg`Rejoignons la longue finale ${this._rwy(rw)}, ${this._qnh()}, rappellerons en finale, ${this._abbr()}.`,
                () => msg`Join long final ${this._rwy(rw)}, ${this._qnh()}, wilco, ${this._abbr()}.`),
        } : {
            message: this._t(() => msg`${this._abbr()}, ${open.fr}rejoignez vent arrière main gauche ${this._rwy(rw)}, ${info}${this._qnh()}, rappelez vent arrière.`,
                () => msg`${this._abbr()}, ${open.en}join left downwind ${this._rwy(rw)}, ${info}${this._qnh()}, report downwind.`),
            readback: this._t(() => msg`Rejoignons vent arrière main gauche ${this._rwy(rw)}, ${this._qnh()}, rappellerons vent arrière, ${this._abbr()}.`,
                () => msg`Join left downwind ${this._rwy(rw)}, ${this._qnh()}, wilco, ${this._abbr()}.`),
        };
    }

    _repeat() {
        return this.lastAtc ? { ...this.lastAtc, repeat: true } : null;
    }

    _atisMessage() {
        const m = this.metar;
        const L = this.atisLetter;
        const rw = this._activeRunway();
        const time = tok(this.atisTime, this.atisTime.split('').map((c) => DIGITS[this.lang][+c]).join(' '));
        return this._t(
            () => msg`${this._stationName()} information ${tok(PHONETIC[L])}, enregistrée à ${time} UTC. Piste en service ${rw.name.length ? tok(rw.name, this._digits(rw.name)) : ''}. ${this._capital(this._wind())}. Visibilité ${m.vis[0]}. ${this._capital(tok(m.clouds[0]))}. Température ${m.temp}, point de rosée ${m.dew}. ${this._qnh()}. Tour de piste main gauche. Au premier contact, confirmez avoir reçu l'information ${tok(PHONETIC[L])}.`,
            () => msg`${this._stationName()} information ${tok(PHONETIC[L])}, time ${time}. Runway in use ${tok(rw.name, this._digits(rw.name))}. ${this._capital(this._wind())}. Visibility ${m.vis[1]}. ${this._capital(tok(m.clouds[1]))}. Temperature ${m.temp}, dew point ${m.dew}. ${this._qnh()}. Left-hand circuit. Acknowledge information ${tok(PHONETIC[L])} on initial contact.`);
    }

    // --- Émission -------------------------------------------------------------------------------
    _say(fr, en, rbFr = null, rbEn = null) {
        const gen = this._gen;
        const reply = { message: this._t(fr, en), readback: rbFr ? this._t(rbFr, rbEn) : null };
        this._queue(async () => {
            await wait(400);
            await this._controller(reply, gen);
        });
    }

    async _controller(reply, gen) {
        if (gen !== this._gen) return;
        if (!reply.keepLast) this.lastAtc = { message: reply.message, readback: reply.readback };
        await this._transmit('atc', reply.message, gen);
        if (gen !== this._gen || reply.keepLast) return;
        this.pending = reply.readback ? { message: reply.readback, time: 0, reminders: 0 } : null;
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

    async _transmit(from, message, gen) {
        if (gen !== this._gen) return;
        this.log.push({ from, text: message.text });
        if (this.log.length > 40) this.log.shift();
        this.dispatchEvent({ type: 'transmit', from, text: message.text, on: true });
        this._changed();
        this.sounds?.squelch(0.16, 0.08);
        await this._speak(message.speech, from);
        this.sounds?.squelch(0.22, 0.14);
        this.dispatchEvent({ type: 'transmit', from, text: message.text, on: false });
    }

    // Synthèse vocale : la tour et l'ATIS d'une voix, le pilote d'une autre (ou plus aiguë s'il n'y en a qu'une)
    _speak(text, from) {
        const estimate = 0.8 + text.length * 0.065;
        const synth = window.speechSynthesis;
        if (!this.voice || !synth) return wait(estimate * 1000);
        return new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(this.lang))
                .sort((a, b) => (b.localService ? 1 : 0) - (a.localService ? 1 : 0));
            // Voix d'homme pour le pilote si le système en a une (Paul, David, "Male"…), une autre pour la tour
            const male = voices.find((v) => MALE_VOICE.test(v.name));
            const pilotVoice = male ?? voices[1] ?? voices[0];
            const towerVoice = voices.find((v) => v !== pilotVoice && !MALE_VOICE.test(v.name)) ?? voices.find((v) => v !== pilotVoice) ?? voices[0];
            const tower = from !== 'pilot';
            const voice = tower ? towerVoice : pilotVoice;
            if (voice) utterance.voice = voice;
            utterance.lang = this.lang === 'fr' ? 'fr-FR' : 'en-GB';
            utterance.rate = tower ? (from === 'atis' ? 1.05 : 1.15) : 1.1;
            utterance.pitch = towerVoice === pilotVoice ? (tower ? 0.8 : 1.25) : 1;
            let done = false;
            const timer = setTimeout(() => finish(), estimate * 2000 + 3000);
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            };
            utterance.onend = utterance.onerror = finish;
            synth.speak(utterance);
        });
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
        const r = this.registration.replace(/-/g, '');
        const short = `${r[0]}-${r.slice(-2)}`;
        return tok(short, this._spell(short));
    }

    // Le pilote n'abrège son indicatif qu'après que la tour l'a fait
    _pilotCs() {
        return this.abbreviated ? this._abbr() : this._full();
    }

    _stationName() {
        return tok(this.aerodrome.name, this.lang === 'fr' ? 'Esmé' : 'Ezmay');
    }

    _station() {
        return this._t(() => tok(`${this.aerodrome.name} Tour`, 'Esmé Tour'), () => tok(`${this.aerodrome.name} Tower`, 'Ezmay Tower'));
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
        const word = PHONETIC[this.atisLetter];
        return tok(`information ${word}`);
    }

    _wind() {
        const m = this.metar;
        if (!m.knots || m.knots < 3) return this._t(() => tok('vent calme'), () => tok('wind calm'));
        const dir = String(m.wind === 0 ? 360 : m.wind).padStart(3, '0');
        return this._t(
            () => tok(`vent ${dir} degrés, ${m.knots} nœuds${m.gust ? `, rafales ${m.gust} nœuds` : ''}`,
                `vent ${this._digits(dir)} degrés, ${m.knots} nœuds${m.gust ? `, rafales ${m.gust} nœuds` : ''}`),
            () => tok(`wind ${dir} degrees, ${m.knots} knots${m.gust ? `, gusting ${m.gust} knots` : ''}`,
                `wind ${this._digits(dir)} degrees, ${m.knots} knots${m.gust ? `, gusting ${m.gust} knots` : ''}`));
    }

    _nm(distance) {
        const n = distance < 10 ? Math.max(1, Math.round(distance)) : Math.round(distance);
        return this._t(() => tok(`${n} NM`, `${n} nautiques`), () => tok(`${n} NM`, `${n} miles`));
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

    _capital(t) {
        const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
        return tok(cap(t.d), cap(t.s));
    }
}

export { ATC, LABELS };
