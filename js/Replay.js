// Lecture d'un vol enregistré (lot 5) : temps de rejeu, pause, vitesses ×1, ×2, ×4, ×8, saut à un instant ; rend
// l'échantillon interpolé (FlightRecorder.sampleAt). Module pur (testé par tests/replay.test.js) ; simulator.js pose
// l'échantillon sur l'avion, la physique étant figée.
import { sampleAt } from './FlightRecorder.js';

export const SPEEDS = [ 1, 2, 4, 8 ];

export class Replay {
    constructor(flight, t = 0) {
        this.flight = flight;
        this.speed = 1;
        this.paused = false;
        this.t = 0;
        this.seek(t);
    }

    get duration() { return this.flight.samples[this.flight.samples.length - 1]?.t ?? 0; }
    get ended() { return this.t >= this.duration; }

    seek(t) {
        this.t = Math.min(this.duration, Math.max(0, Number(t) || 0));
        this._last = this.t;
    }
    setSpeed(speed) { if (SPEEDS.includes(speed)) this.speed = speed; }
    play() { if (this.ended) this.seek(0); this.paused = false; }
    pause() { this.paused = true; }
    toggle() { if (this.paused || this.ended) this.play(); else this.pause(); }

    // Avance de dt (s de temps réel) ; rend l'échantillon du moment. À la fin : pause sur le dernier échantillon
    advance(dt) {
        this._last = this.t;
        if (!this.paused) this.t = Math.min(this.duration, this.t + Math.max(0, dt) * this.speed);
        if (this.ended) this.paused = true;
        return sampleAt(this.flight, this.t);
    }

    // Événements franchis depuis l'appel précédent (messages ATC, toucher…), dans l'ordre
    passedEvents() {
        const from = Math.min(this._last, this.t), to = Math.max(this._last, this.t);
        return this.flight.events.filter((e) => e.t > from && e.t <= to);
    }
}
