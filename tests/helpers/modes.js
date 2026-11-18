// Modes propres du Cessna 172 : modèle linéaire de référence (UIUC) et mesure sur le modèle de vol réaliste.
//
// Référence : modèle linéaire du Cessna 172 de l'université de l'Illinois (J. Scott, M. Selig, UIUC, 10/04/2000), distribué
// avec FlightGear (fgdata, Aircraft-uiuc/models/cessna172/linear.html, relu le 18/11/2026). La page ne donne ni point de
// vol ni valeurs propres : on calcule ici les modes de ce modèle (équations linéarisées classiques du vol en palier,
// axes de stabilité, Etkin / Nelson) au point de vol où l'on mesure le modèle réaliste (même masse, vitesse vraie,
// altitude). La propulsion du modèle UIUC est une traction constante (« simpleSingle », 350 lb) : pas de dérivée de la
// traction avec la vitesse.
//
// Mesure : réponse du modèle réaliste à une impulsion de gouverne, manche ensuite lâché (commandes fixes), moins un vol
// identique sans impulsion (ce qui reste du réglage initial s'annule), puis identification d'un mode du second ordre
// (méthode de Prony : modèle autorégressif d'ordre 2 aux moindres carrés, sur les différences secondes du signal, qui
// suppriment une dérive lente). La même identification appliquée au modèle linéaire simulé retrouve ses valeurs propres :
// son erreur est vérifiée dans tests/flying-qualities.test.js.
import { Vector3 } from 'three';
import { isa } from '../../js/Atmosphere.js';
import { run, DT } from './flight.js';

const FT = 0.3048, SLUGFT2 = 1.35582, LB = 0.45359237;
const G = 9.81;

// Modèle linéaire UIUC [linear.html, tables « Geometry », « Mass data », « Aerodynamic data »] : unités SI, par radian
export const UIUC_C172 = {
    b: 35.8 * FT, c: 4.9 * FT, S: 174 * FT * FT,
    weight: 2300 * LB,                                   // (GTOW, pour mémoire : on calcule à la masse du point de vol)
    Ixx: 948 * SLUGFT2, Iyy: 1346 * SLUGFT2, Izz: 1967 * SLUGFT2, Ixz: 0,
    CD0: 0.031, CDK: 0.054, CL0: 0.31, CLa: 5.143, CLadot: 1.7, CLq: 3.9,
    Cma: -0.89, Cmadot: -5.2, Cmq: -12.4,
    CYb: -0.31, CYp: -0.037, CYr: 0.21,
    Clb: -0.089, Clp: -0.47, Clr: 0.096,
    Cnb: 0.065, Cnp: -0.03, Cnr: -0.099,
};

// --- Algèbre : nombres complexes, polynôme caractéristique, racines ---
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];

// Coefficients du polynôme caractéristique det(sI - A) = s^n + c1 s^(n-1) + ... + cn (Faddeev-LeVerrier)
function characteristic(A) {
    const n = A.length;
    const coefficients = [1];
    let M = A.map((row) => row.map(() => 0));
    for (let k = 1; k <= n; k++) {
        // M = A M + c(k-1) I ; c(k) = -trace(A M) / k
        const prev = M.map((row) => row.slice());
        for (let i = 0; i < n; i++) prev[i][i] += coefficients[k - 1];
        M = A.map((row) => prev[0].map((_, j) => row.reduce((sum, a, l) => sum + a * prev[l][j], 0)));
        const trace = M.reduce((sum, row, i) => sum + row[i], 0);
        coefficients.push(-trace / k);
    }
    return coefficients;
}
// Racines complexes d'un polynôme unitaire (Durand-Kerner)
function roots(coefficients) {
    const n = coefficients.length - 1;
    const p = (z) => coefficients.reduce((acc, c) => [acc[0] * z[0] - acc[1] * z[1] + c, acc[0] * z[1] + acc[1] * z[0]], [0, 0]);
    let z = Array.from({ length: n }, (_, i) => { const a = 0.4 + 0.9 * i; return [Math.cos(a) * (1 + i * 0.3), Math.sin(a) * (1 + i * 0.3)]; });
    for (let iter = 0; iter < 2000; iter++) {
        let change = 0;
        z = z.map((zi, i) => {
            let denominator = [1, 0];
            z.forEach((zj, j) => { if (j !== i) denominator = cmul(denominator, csub(zi, zj)); });
            const next = csub(zi, cdiv(p(zi), denominator));
            change = Math.max(change, Math.hypot(next[0] - zi[0], next[1] - zi[1]));
            return next;
        });
        if (change < 1e-13) break;
    }
    return z;
}
export function eigenvalues(A) { return roots(characteristic(A)); }

// Mode d'une paire de valeurs propres complexes : pulsation propre (rad/s), amortissement, période (s)
function oscillatory(lambda) {
    const [re, im] = lambda;
    const wn = Math.hypot(re, im);
    return { wn, zeta: -re / wn, period: 2 * Math.PI / Math.abs(im) };
}

// Modes du modèle linéaire UIUC au point de vol : masse (kg), vitesse vraie (m/s), altitude (m)
export function linearModes({ mass, speed: U, altitude = 0, data = UIUC_C172 }) {
    const d = data, rho = isa(altitude).density;
    const qbar = 0.5 * rho * U * U, qS = qbar * d.S;
    const CL = mass * G / qS, CD = d.CD0 + d.CDK * CL * CL, CDa = 2 * d.CDK * CL * d.CLa;
    // Longitudinal : état [u, w, q, θ] (axes de stabilité, palier θ0 = 0)
    const Xu = -2 * CD * qS / (mass * U), Xw = -(CDa - CL) * qS / (mass * U);
    const Zu = -2 * CL * qS / (mass * U), Zw = -(d.CLa + CD) * qS / (mass * U);
    const Zwdot = -d.CLadot * d.c / (2 * U) * qS / (mass * U), Zq = -d.CLq * d.c / (2 * U) * qS / mass;
    const Mw = d.Cma * qS * d.c / (d.Iyy * U), Mwdot = d.Cmadot * d.c / (2 * U) * qS * d.c / (d.Iyy * U);
    const Mq = d.Cmq * d.c / (2 * U) * qS * d.c / d.Iyy;
    const k = 1 / (1 - Zwdot);
    const wdot = [Zu * k, Zw * k, (U + Zq) * k, 0];
    const longitudinal = [
        [Xu, Xw, 0, -G],
        wdot,
        [Mwdot * wdot[0], Mw + Mwdot * wdot[1], Mq + Mwdot * wdot[2], 0],
        [0, 0, 1, 0],
    ];
    // Latéral : état [β, p, r, φ]
    const Yb = d.CYb * qS / mass, Yp = d.CYp * d.b / (2 * U) * qS / mass, Yr = d.CYr * d.b / (2 * U) * qS / mass;
    const L = (C) => C * qS * d.b / d.Ixx, N = (C) => C * qS * d.b / d.Izz, h = d.b / (2 * U);
    const lateral = [
        [Yb / U, Yp / U, Yr / U - 1, G / U],
        [L(d.Clb), L(d.Clp) * h, L(d.Clr) * h, 0],
        [N(d.Cnb), N(d.Cnp) * h, N(d.Cnr) * h, 0],
        [0, 1, 0, 0],
    ];
    const lon = eigenvalues(longitudinal).sort((a, b) => Math.hypot(...b) - Math.hypot(...a));
    const lat = eigenvalues(lateral);
    const complexLat = lat.filter((l) => Math.abs(l[1]) > 1e-6);
    const realLat = lat.filter((l) => Math.abs(l[1]) <= 1e-6).sort((a, b) => a[0] - b[0]);
    return {
        matrices: { longitudinal, lateral },
        shortPeriod: oscillatory(lon[0]),
        phugoid: oscillatory(lon[3]),
        dutchRoll: oscillatory(complexLat[0]),
        roll: { tau: -1 / realLat[0][0] },                 // constante de temps du roulis (s)
        spiral: { lambda: realLat[1][0] },                 // > 0 : spirale instable
    };
}

// Simulation du modèle linéaire (Euler explicite à petit pas), état initial x0 ; rend la composante index échantillonnée à DT
export function simulateLinear(A, x0, seconds, index, step = 1 / 1200) {
    let x = x0.slice();
    const samples = [];
    const every = Math.round(DT / step);
    for (let i = 0; i * step < seconds; i++) {
        if (i % every === 0) samples.push(x[index]);
        const dx = A.map((row) => row.reduce((sum, a, j) => sum + a * x[j], 0));
        x = x.map((v, j) => v + dx[j] * step);
    }
    return samples;
}

// Identification des modes d'un signal échantillonné à dt (méthode de Prony) : modèle autorégressif d'ordre n aux moindres
// carrés, y[k] = a1 y[k-1] + ... + an y[k-n], dont les racines sont les pôles discrets z ; pôles continus s = ln(z) / dt.
// Rend les modes : { wn, zeta, period } pour une paire complexe, { tau } (s) pour un pôle réel stable
export function identifyModes(samples, dt, order = 4) {
    const n = order;
    const M = Array.from({ length: n }, () => new Array(n).fill(0)), r = new Array(n).fill(0);
    for (let k = n; k < samples.length; k++) {
        for (let i = 0; i < n; i++) {
            r[i] += samples[k - 1 - i] * samples[k];
            for (let j = 0; j < n; j++) M[i][j] += samples[k - 1 - i] * samples[k - 1 - j];
        }
    }
    const a = solve(M, r);
    const poles = roots([1, ...a.map((v) => -v)]);   // z^n - a1 z^(n-1) - ... - an = 0
    const modes = [];
    for (const [re, im] of poles) {
        const s = [Math.log(Math.hypot(re, im)) / dt, Math.atan2(im, re) / dt];
        if (Math.abs(im) > 1e-9 * Math.hypot(re, im)) { if (im > 0) modes.push(oscillatory(s)); } else if (re > 0) modes.push({ tau: -1 / s[0] });
    }
    return modes;
}
// Le mode oscillant le plus proche d'une pulsation attendue (rad/s)
export function oscillatoryNear(modes, wn) {
    return modes.filter((m) => m.wn).sort((x, y) => Math.abs(Math.log(x.wn / wn)) - Math.abs(Math.log(y.wn / wn)))[0] ?? null;
}
// Système linéaire M x = r (Gauss, pivot partiel)
function solve(M, r) {
    const n = r.length, A = M.map((row, i) => [...row, r[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
        [A[c], A[p]] = [A[p], A[c]];
        for (let i = c + 1; i < n; i++) {
            const f = A[i][c] / A[c][c];
            for (let j = c; j <= n; j++) A[i][j] -= f * A[c][j];
        }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let sum = A[i][n];
        for (let j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
        x[i] = sum / A[i][i];
    }
    return x;
}

// --- Vol stabilisé du modèle réaliste au point de vol ---
const _axis = new Vector3(1, 0, 0);
// Avion en palier à la vitesse vraie speed (m/s) et à l'altitude (m), trim réglé pour que le manche lâché tienne cette
// vitesse, assiette à l'incidence d'équilibre, gaz du palier (cherchés par dichotomie sur la vitesse verticale moyenne)
export function trimmedFlight(makeFixture, { speed, altitude }) {
    const setup = (throttle) => {
        const f = makeFixture(), { model, object } = f;
        object.position.set(0, altitude, 0);
        model.restart(false);
        // Trim : tab qui tient la vitesse voulue (dichotomie sur trimSpeed, décroissante avec le tab à cabrer)
        let low = model.aircraft.trimTabMin, high = model.aircraft.trimTabMax;
        for (let i = 0; i < 50; i++) {
            model.trim = (low + high) / 2;
            if (model.trimSpeed() > speed) low = model.trim; else high = model.trim;
        }
        const alpha = model.trimAlpha();
        object.quaternion.setFromAxisAngle(_axis, alpha);
        model.velocity.set(0, 0, -speed);
        model.airspeed = speed;
        model.throttle = throttle;
        model.controls.pitch = model.controls.roll = model.controls.yaw = 0;
        return f;
    };
    let low = 0.2, high = 1;
    for (let i = 0; i < 14; i++) {
        const throttle = (low + high) / 2, f = setup(throttle);
        const y0 = f.object.position.y;
        run(f, 20);
        if (f.object.position.y > y0) high = throttle; else low = throttle;
    }
    const throttle = (low + high) / 2;
    return { throttle, make: () => setup(throttle) };
}

// Vol du modèle réaliste au point de vol, avec une impulsion (pilot(t) pendant pulse secondes), moins le même vol sans
// impulsion : rend l'écart de read() échantillonné à DT, à partir de la fin de l'impulsion
export function pulseResponse(flight, { seconds, pulse, pilot, read, hold }) {
    const fly = (withPulse) => {
        const f = flight.make(), samples = [];
        run(f, pulse + seconds, { pilot: (t) => {
            f.model.controls.pitch = f.model.controls.roll = f.model.controls.yaw = 0;
            if (withPulse && t < pulse) pilot(f, t);
            hold?.(f, t);
            if (t >= pulse) samples.push(read(f));
        } });
        return { samples, crashed: f.model.crashed, model: f.model };
    };
    const a = fly(true), b = fly(false);
    return { samples: a.samples.map((v, i) => v - b.samples[i]), crashed: a.crashed || b.crashed };
}

