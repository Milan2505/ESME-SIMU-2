// Pilote de test de l'initiation complète (tests/e2e/initiation.spec.js), exécuté dans la page (page.evaluate) : il fait ce
// que ferait l'élève, étape par étape, et note pour chaque étape si sa condition était remplie quand la leçon est passée à
// la suivante. Rien n'est téléporté ni forcé dans la leçon :
// - commandes de la cabine (interrupteurs, frein, mixture, clé, volets, trim au sol, transpondeur, fenêtre radio) :
//   Initiation._autoDo, l'action que fait le bouton « Passer » (la commande mise dans la bonne position), puis c'est la
//   condition de l'étape qui la valide ; sauf l'essai des magnétos (clé tournée cran par cran, chutes mesurées) et les
//   roulages (pas de téléportation : voir taxi) ;
// - explications sans action (étapes « next ») : bouton Passer, comme un élève qui a lu ; la voix du moniteur est coupée
//   dès qu'il commence à parler (rien n'attend la fin d'une phrase) ;
// - roulages : palonnier (roulette de nez), gaz et freins, en suivant les balises de l'étape ;
// - vol : manche, palonnier, gaz et trim, à chaque pas de 1/60 s (sans carte graphique, une image dure ~0,1 s), par la
//   montée progressive des commandes (InputRamp, réglage normal), position du manche recopiée dans PlaneControls (les
//   étapes « manche lâché » lisent le manche réellement appliqué).
// Fonction autonome : sérialisée par Playwright, elle ne peut rien utiliser d'extérieur.
export async function installInitiationDriver({ fastUntil = -1 } = {}) {
    const sim = window.__sim, init = sim.initiation, controls = sim.controls, model = sim.model, sys = () => sim.systems;
    const { InputRamp } = await import('/js/InputRamp.js');
    const { CIRCUIT, TURN_AT } = await import('/js/Initiation.js');   // géométrie du tour de piste de la leçon
    const KT = 0.514444, FT = 0.3048, RAD = 180 / Math.PI;
    const ramp = new InputRamp();
    const wrap = (a) => ((a + 540) % 360) - 180;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const D = window.__driver = { log: [], notes: [], mode: 'hold', leg: null, fp: null, cmd: { pitch: 0, roll: 0, yaw: 0, brake: 0 }, max: { kias: 0, load: 0, minLoad: Infinity } };
    const note = (text) => { D.notes.push(`${init._time.toFixed(0)} s : ${text}`); console.log(`[pilote] ${text}`); };

    // --- Journal des étapes : condition remplie ou non au moment du passage à la suivante -------------------------------
    const nextOriginal = init._next.bind(init);
    let expected = init.index;
    init._next = () => {
        const c = init._context();
        for (let i = expected; i < init.index; i++) D.log.push({ index: i, title: init.steps[i].title, how: 'sautée', ok: false });
        const step = init.step;
        if (step) {
            let done, radio;
            try { done = step.done ? Boolean(step.done(c, init._state.flags, 0)) : null; } catch { done = false; }
            try { radio = step.radio ? Boolean(step.radio.until(c)) : null; } catch { radio = false; }
            const auto = step.auto && init._state.spoken && init._time - init._state.spokenAt > step.auto;
            const how = step.next ? 'explication' : step.end ? 'fin' : (done ?? radio) ? 'condition'
                : !init._state.spoken ? 'dépassée avant de commencer' : auto ? 'délai écoulé' : 'dépassée';
            const where = step.flight ? ` (${Math.round(c.aal ?? c.agl)} ft au-dessus du terrain, ${Math.round(c.along ?? 0)} m le long de l'axe, ${Math.round(c.lateral ?? 0)} m à côté, ${Math.round(c.speedKt)} kt)` : '';
            D.log.push({ index: init.index, title: step.title, how: how + where, ok: ['explication', 'fin', 'condition'].includes(how), t: init._time });
            console.log(`[étape] ${init.index} ${step.title} : ${how}${where}`);
        }
        nextOriginal();
        expected = init.index;
        D.stepStart = init._time;
        D.acted = false;
        D.points = null;
        if (D.mode === 'taxi') D.mode = 'hold';   // roulage fini : attente (freins) jusqu'à l'action de l'étape suivante
    };

    // --- Géométrie : repère de la piste de la leçon (le long de l'axe, à côté, côté du tour de piste) -------------------
    const runway = () => init._runway ?? sim.atc.s?.active ?? null;
    const toWorld = (rw, along, lateral) => [rw.threshold.x + rw.direction.x * along + rw.circuitSide.x * lateral,
        rw.threshold.z + rw.direction.z * along + rw.circuitSide.z * lateral];
    const headingOf = (dx, dz) => (Math.atan2(dx, -dz) * RAD + 360) % 360;
    const p = () => sim.model.object.position;

    // --- Pilotage, à chaque pas de calcul ---------------------------------------------------------------------------
    let previousPitch = null, previousBank = null, previousSpeed = null, speedI = null, altI = null, throttleI = null, coordI = 0, pathI = 0;
    const att = () => ({ pitch: model.pitchAttitude * RAD, bank: controls.getRoll() * RAD, heading: controls.getHeading() });
    const height = () => p().y - model.groundHeight(p().x, p().z) - model.minAltitude;   // m, roues, au-dessus du sol
    // Hauteur au-dessus de l'aérodrome (m, roues) : celle de l'altimètre calé au terrain, pour le tour de piste
    const aal = () => { const rw = runway(); return rw ? p().y - model.groundHeight(rw.threshold.x, rw.threshold.z) - model.minAltitude : height(); };
    // Assiette visée -> manche (gain de la commande en effort compensé : à grande vitesse, il faut tirer plus)
    function pitchTo(target, dt) {
        const a = att(), rate = previousPitch === null ? 0 : (a.pitch - previousPitch) / dt;
        previousPitch = a.pitch;
        const qbar = 0.5 * 1.225 * model.calibratedSpeed ** 2, gain = Math.min(1, 15 * 47.88 / Math.max(1, qbar));
        D.cmd.pitch = clamp((0.06 * (target - a.pitch) - 0.05 * rate) / gain, -1, 1);
    }
    function bankTo(target, dt) {   // degrés, + = à gauche
        const a = att(), rate = previousBank === null ? 0 : (a.bank - previousBank) / dt;
        previousBank = a.bank;
        D.cmd.roll = clamp(0.06 * (target - a.bank) - 0.03 * rate, -1, 1);
    }
    // Route visée (degrés) : inclinaison proportionnelle à l'écart entre cette route et la route suivie (vecteur vitesse :
    // le vent de travers est corrigé, comme un pilote qui garde le point visé fixe) ; virage à droite : inclinaison < 0
    function headingTo(target, maxBank, dt) {
        const v = model.velocity, track = Math.hypot(v.x, v.z) > 5 ? headingOf(v.x, v.z) : att().heading;
        bankTo(-clamp(1.5 * wrap(target - track), -maxBank, maxBank), dt);
    }
    // Au sol : roulette de nez vers un point de l'axe de piste à 150 m devant
    function steerCentreline(rw, along) {
        const [tx, tz] = toWorld(rw, along + 150, 0);
        return clamp(-wrap(headingOf(tx - p().x, tz - p().z) - att().heading) / 6, -1, 1);
    }
    function coordinate(dt) {   // bille au milieu au palonnier
        const side = model.sideAcceleration ?? 0;
        coordI = clamp(coordI + side * 0.3 * dt, -1, 1);
        D.cmd.yaw = clamp(0.3 * side + coordI, -1, 1);
    }
    function speedByPitch(kias, dt) {   // vitesse tenue à l'assiette
        const v = model.indicatedSpeed / KT, accel = previousSpeed === null ? 0 : (v - previousSpeed) / dt;
        previousSpeed = v;
        speedI = clamp((speedI ?? att().pitch) + (v - kias) * 0.15 * dt, -12, 16);
        return clamp(speedI + 0.4 * (v - kias) + 2 * accel, -12, 18);
    }
    function altitudeByPitch(ft, dt) {
        const err = ft - aal() / FT, vs = model.velocity.y / FT * 60;
        altI = clamp((altI ?? att().pitch) + err * 0.002 * dt, -6, 10);
        return clamp(altI + 0.012 * err - 0.004 * vs, -6, 12);
    }
    function throttleTo(value, dt) {   // manette déplacée à vitesse limitée (barre Espace / Ctrl : 1 par seconde)
        controls.throttle = controls.throttle + clamp(value - controls.throttle, -dt, dt);
    }
    function rpmByThrottle(rpm, dt) {
        throttleI = clamp((throttleI ?? controls.throttle) + (rpm - model.rpm) * 0.00008 * dt * 60, 0.05, 1);
        throttleTo(throttleI, dt);
    }
    // Trim comme un pilote : il soulage le manche (8°/s au plus, comme les touches W / X)
    function autoTrim(dt) {
        const A = model.aircraft;
        const rate = clamp(D.cmd.pitch * 0.25, -8 / RAD, 8 / RAD);
        if (Math.abs(D.cmd.pitch) > 0.02) controls.trim = clamp(controls.trim + rate * dt, A.trimTabMin, A.trimTabMax);
    }
    // Suivi d'une droite (point, direction) par poursuite d'un point à `ahead` m devant
    function track(rw, along, lateral, dAlong, dLateral, ahead, maxBank, dt) {
        const [px, pz] = toWorld(rw, along, lateral);
        const dx = rw.direction.x * dAlong + rw.circuitSide.x * dLateral, dz = rw.direction.z * dAlong + rw.circuitSide.z * dLateral;
        const s = (p().x - px) * dx + (p().z - pz) * dz;
        const tx = px + dx * (s + ahead), tz = pz + dz * (s + ahead);
        headingTo(headingOf(tx - p().x, tz - p().z), maxBank, dt);
    }

    // Roulage : poursuite des balises, vitesse tenue aux gaz et aux freins, arrêt au dernier point
    function taxi(points, dt, { speedKt = 8, stopAt = 3 } = {}) {
        if (!D.points?.length) return;
        const pos = p();
        // Balise atteinte à 12 m (le jeu : 14 m), ou laissée derrière à moins de 25 m (rayon de virage de la roulette de nez)
        const behind = (q) => Math.abs(wrap(headingOf(q[0] - pos.x, q[1] - pos.z) - att().heading)) > 100;
        while (D.points.length > 1 && (Math.hypot(D.points[0][0] - pos.x, D.points[0][1] - pos.z) < 12
            || (behind(D.points[0]) && Math.hypot(D.points[0][0] - pos.x, D.points[0][1] - pos.z) < 25))) D.points.shift();
        const [tx, tz] = D.points[0], last = points.at(-1);
        const toLast = Math.hypot(last[0] - pos.x, last[1] - pos.z);
        const err = wrap(headingOf(tx - pos.x, tz - pos.z) - att().heading);
        D.cmd.yaw = clamp(-err / 12, -1, 1);
        D.cmd.roll = 0;
        D.cmd.pitch = 0;
        const v = model.airspeed / KT;
        const remaining = D.points.length === 1 ? toLast : toLast + 20;
        let target = Math.min(speedKt, Math.sqrt(2 * 0.4 * Math.max(0, remaining - stopAt)) / KT);
        if (Math.abs(err) > 30) target = Math.min(target, 4);
        // Virage de plus de 45° à la balise suivante : ralentir avant (4 kt au virage, freinage de 1 m/s²)
        if (D.points.length > 1) {
            const [ax, az] = D.points[0], [bx, bz] = D.points[1];
            const turn = Math.abs(wrap(headingOf(bx - ax, bz - az) - headingOf(ax - pos.x, az - pos.z)));
            const d = Math.hypot(ax - pos.x, az - pos.z);
            if (turn > 45) target = Math.min(target, 4 + Math.sqrt(2 * 1 * Math.max(0, d - 12)) / KT);
        }
        if (D.points.length === 1 && toLast < stopAt + 1) target = 0;
        throttleI = clamp((throttleI ?? 0.1) + (target - v) * 0.02 * dt, 0, 0.45);
        controls.throttle = target === 0 ? 0 : clamp(throttleI + 0.05 * (target - v), 0, 0.5);
        D.cmd.brake = target === 0 ? 1 : clamp((v - target - 0.5) / 3, 0, 1);
    }

    // Vol : tour de piste dans le repère de la piste (CIRCUIT de Initiation.js)
    function fly(dt) {
        const rw = runway(), c = init._context(), a = att();
        if (!rw) return;
        const along = c.along, lateral = c.lateral, v = model.indicatedSpeed / KT;
        D.max.kias = Math.max(D.max.kias, v);
        if (!model.onGround) { D.max.load = Math.max(D.max.load, model.loadFactor); D.max.minLoad = Math.min(D.max.minLoad, model.loadFactor); }
        // Branches : montée dans l'axe, vent traversier, vent arrière, base, finale
        const leg = D.leg ?? 'upwind';
        if (leg === 'upwind' && along > TURN_AT.crosswind && aal() / FT > 650) D.leg = 'crosswind';
        // (la leçon annonce le virage vent arrière une fois l'étape « 900 pieds » finie)
        else if (leg === 'crosswind' && lateral > TURN_AT.downwind && init.index > init.steps.findIndex((st) => st.title.startsWith('900 pieds'))) D.leg = 'downwind';
        else if (leg === 'downwind' && along < TURN_AT.base) D.leg = 'base';
        else if (leg === 'base' && lateral < TURN_AT.final) D.leg = 'final';
        D.leg ??= 'upwind';
        const fp = D.fp ?? 'roll';
        if (fp === 'roll') {
            throttleTo(1, dt);
            D.cmd.brake = 0;
            D.cmd.roll = 0;
            D.cmd.yaw = clamp(steerCentreline(rw, along) + 0.3 * (model.sideAcceleration ?? 0), -1, 1);
            if (v > 55) pitchTo(8, dt); else D.cmd.pitch = 0;
            if (!model.onGround && height() > 3) { D.fp = 'climb'; note(`envol à ${v.toFixed(0)} KIAS`); }
            return;
        }
        if (fp === 'climb' || fp === 'level' || fp === 'descent') {
            const maxBank = 20;
            if (D.leg === 'upwind') track(rw, 0, 0, 1, 0, 400, maxBank, dt);
            else if (D.leg === 'crosswind') track(rw, CIRCUIT[1][0], 0, 0, 1, 400, maxBank, dt);
            else if (D.leg === 'downwind') track(rw, 0, CIRCUIT[2][1], -1, 0, 400, maxBank, dt);
            else if (D.leg === 'base') track(rw, CIRCUIT[4][0], 0, 0, -1, 400, maxBank, dt);
            else track(rw, 0, 0, 1, 0, 300, maxBank, dt);
            coordinate(dt);
        }
        if (fp === 'climb') {
            throttleTo(1, dt);
            pitchTo(speedByPitch(75, dt), dt);
            autoTrim(dt);
            if (aal() / FT > 950) { D.fp = 'level'; altI = null; note('palier à 1000 ft'); }
        } else if (fp === 'level') {
            rpmByThrottle(2100, dt);
            pitchTo(altitudeByPitch(1000, dt), dt);
            autoTrim(dt);
            if (D.leg === 'downwind' && along < 50) { D.fp = 'descent'; speedI = null; throttleI = null; note('travers du seuil : descente'); }
        } else if (fp === 'descent') {
            rpmByThrottle(1500, dt);
            pitchTo(speedByPitch(70, dt), dt);
            autoTrim(dt);
            if (D.leg === 'final' && Math.abs(lateral) < 150 && Math.abs(wrap(rw.heading - a.heading)) < 20) { D.fp = 'final'; throttleI = null; speedI = null; note('finale'); }
        } else if (fp === 'final') {
            // Pente de 3,5° vers un point à 150 m après le seuil ; vitesse 65 KIAS à l'assiette, pente aux gaz
            track(rw, 0, 0, 1, 0, 250, 15, dt);
            coordinate(dt);
            const target = Math.max(0, (150 - along) * Math.tan(3.5 / RAD));
            const err = target - height(), vs = model.velocity.y;
            throttleI = clamp((throttleI ?? 0.3) + err * 0.004 * dt, 0, 0.8);
            throttleTo(clamp(throttleI + 0.03 * err - 0.05 * (vs + 2), 0, 0.9), dt);
            pitchTo(speedByPitch(65, dt), dt);
            autoTrim(dt);
            if (height() < 6) { D.fp = 'flare'; pathI = att().pitch; note(`arrondi à ${v.toFixed(0)} KIAS, ${(-vs).toFixed(1)} m/s de descente`); }
        } else if (fp === 'flare') {
            throttleTo(0, dt);
            const h = height(), wanted = -(0.3 + 0.25 * h);
            pathI = clamp(pathI + (wanted - model.velocity.y) * 4 * dt, -5, 12);
            pitchTo(pathI, dt);
            bankTo(0, dt);
            D.cmd.yaw = clamp(-wrap(rw.heading - a.heading) / 6 + 0.3 * (model.sideAcceleration ?? 0), -1, 1);
            if (model.onGround) { D.fp = 'rollout'; note('posé'); }
        } else if (fp === 'rollout') {
            throttleTo(0, dt);
            D.cmd.pitch = 0;
            D.cmd.roll = 0;
            D.cmd.yaw = steerCentreline(rw, along);
            D.cmd.brake = v > 3 ? 1 : 0;
        }
    }

    // --- À chaque image : actions de l'élève selon l'étape en cours ----------------------------------------------------
    // Étape qui n'avance plus : relevé de l'état (toutes les 20 s)
    let watchIndex = -1, watchSince = 0;
    function watch() {
        if (init.index !== watchIndex) { watchIndex = init.index; watchSince = init._time; return; }
        if (init._time - watchSince < 20) return;
        watchSince = init._time;
        const atc = sim.atc, s = atc.s ?? {}, step = init.step, c = init._context();
        let wait; try { wait = step?.wait(c); } catch (e) { wait = e.message; }
        note('étape bloquée ' + JSON.stringify({ index: init.index, title: step?.title, spoken: init._state.spoken, speaking: init._state.speaking, wait, busy: atc.busy, pending: atc.pending?.message ?? null, blockedBy: atc.blockedBy ?? null, state: atc.state, freq: atc.freq, zone: s.zone, nearHolding: s.nearHolding, groundKt: c.groundKt?.toFixed(1), brake: controls.parkingBrake, mode: D.mode, x: p().x.toFixed(0), z: p().z.toFixed(0), heading: att().heading.toFixed(0), next: D.points?.[0]?.map((v) => v.toFixed(0)), left: D.points?.length, options: atc.options?.map((o) => o.id) }));
    }
    function act() {
        watch();
        const step = init.step;
        if (!init.active || !step) { D.mode = 'hold'; return; }
        // Débogage seulement (INITIATION_JUSQUA) : étapes passées au bouton Passer jusqu'à l'indice donné
        if (init.index < fastUntil) { if (!step.flight) init.skipSpeech(); return; }
        if (!init._state.spoken) return;
        if (init._state.speaking) init.voices.stopInstructor();
        if (step.next) { init.skipSpeech(); return; }
        if (step.flight) {
            D.mode = 'flight';
            // Commandes de la cabine en vol (interrupteurs, volets) : comme les touches
            const cabin = step.parts || step.target === 'flaps:lever';
            if (cabin && !D.acted) { D.acted = true; init._autoDo(step); }
            return;
        }
        if (step.guide) {
            if (!D.points) {
                const c = init._context();
                let points = step.guide(c).map(([x, z]) => [x, z]);
                if (step.title === 'Dégager la piste') {
                    // Point de l'axe de piste en face de la bretelle, puis la bretelle (balises de l'étape)
                    const rw = runway(), s = (250 - rw.threshold.x) * rw.direction.x + (0 - rw.threshold.z) * rw.direction.z;
                    points = [[rw.threshold.x + rw.direction.x * s, rw.threshold.z + rw.direction.z * s], ...points];
                }
                if (step.title === 'Frein desserré, alignement') {
                    // Alignement : un point de plus dans l'axe, au-delà du dernier anneau, pour finir face au cap de la piste
                    const rw = c.atc.departureRunway;
                    points.push([rw.threshold.x + rw.direction.x * 110, rw.threshold.z + rw.direction.z * 110]);
                }
                D.points = points.slice();
                D.guide = points;
                if (controls.parkingBrake) init.setBrake(false);
            }
            D.mode = 'taxi';
            return;
        }
        D.mode = 'hold';
        // Essai de la réchauffe : tirette tirée de 0,3 à 5,5 s (la leçon mesure la chute de régime), puis repoussée
        if (step.title === 'Essai de la réchauffe') {
            const t = init._time - D.stepStart, on = sys().switches.carbHeat;
            if (t > 0.3 && t < 5.5 && !on) sys().toggle('carbHeat');
            else if (t > 5.5 && on) sys().toggle('carbHeat');
            return;
        }
        if (step.title === 'Essai des magnétos') {
            // Clé tournée cran par cran : L (1,5 s), R (1,5 s), BOTH ; la leçon mesure les chutes
            const t = init._time - D.stepStart, m = sys().magnetos;
            if (t > 0.3 && t < 1.5 && m === 3) sys().turnMagnetos(-1);
            else if (t > 1.8 && t < 3 && m === 2) sys().turnMagnetos(-1);
            else if (t > 3.3 && m === 1) sys().turnMagnetos(2);
            return;
        }
        if (step.radio || step.title === "Autorisés à s'aligner" || step.atis) return;   // le moniteur fait la radio
        // Une fois ; de nouveau après 5 s si la condition n'est toujours pas remplie (sauf la mixture : un seul geste)
        const again = step.target !== 'mixture' && init._time - D.stepStart > 5 && init._time - (D.lastAct ?? 0) > 5;
        if (!D.acted || again) { D.acted = true; D.lastAct = init._time; init._autoDo(step); }
    }

    // Pas de calcul : commandes de l'élève -> montée progressive -> modèle (et manche recopié dans PlaneControls)
    const stepOriginal = model.step.bind(model);
    model.step = (delta) => {
        const n = Math.max(1, Math.round(delta * 60));
        for (let i = 0; i < n; i++) {
            const dt = delta / n;
            if (D.mode === 'flight') fly(dt);
            else if (D.mode === 'taxi' && D.guide) taxi(D.guide, dt);
            else { D.cmd.pitch = D.cmd.roll = D.cmd.yaw = 0; D.cmd.brake = 1; }   // attente au sol : freins tenus
            const v = ramp.update(D.cmd, dt, model.indicatedSpeed / KT);
            Object.assign(model.controls, { pitch: v.pitch, roll: v.roll, yaw: v.yaw, brake: Math.max(D.cmd.brake ?? 0, controls.parkingBrake ? 1 : 0) });
            controls._controls.set(v.pitch, v.yaw, v.roll);
            stepOriginal(dt);
        }
    };
    const updateOriginal = controls.update.bind(controls);
    controls.update = (delta) => {
        try { act(); } catch (error) { note(`erreur du pilote : ${error.message}`); }
        updateOriginal(delta);
    };
    note('pilote de test installé');
    return true;
}
