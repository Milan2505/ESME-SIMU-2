"""Musique du mode Wardog troll : composition originale, synthétisée ici (aucun son téléchargé).

Dance / eurodance façon années 90, 124 BPM, ré mineur, 16 mesures qui bouclent sans clic (les fins de notes qui
dépassent la boucle sont rabattues sur son début). Mélodie, basse et accords inventés pour ce jeu.

Sortie : asset/troll/what-is-love.wav (44,1 kHz, 16 bits, stéréo, crête à -1 dBFS)
Lancer depuis la racine du projet : python tools/generate-troll-music.py
"""
import os
import wave

import numpy as np

RATE = 44100
BPM = 124
BEAT = 60 / BPM
BARS = 16
LENGTH = int(round(BARS * 4 * BEAT * RATE))   # échantillons de la boucle
OUT = os.path.join(os.path.dirname(__file__), '..', 'asset', 'troll', 'what-is-love.wav')
rng = np.random.default_rng(124)


def freq(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def at(beat):
    return int(round(beat * BEAT * RATE))


def place(buf, sig, start):
    """Ajoute sig (mono ou stéréo) à buf à partir de start, en rabattant ce qui dépasse sur le début (boucle)."""
    start %= LENGTH
    n = len(sig)
    idx = (start + np.arange(n)) % LENGTH
    np.add.at(buf, idx, sig)


def env(n, attack, release, sustain_len=None):
    """Enveloppe : montée, maintien, descente (en secondes) sur n échantillons."""
    t = np.arange(n) / RATE
    e = np.minimum(1.0, t / max(attack, 1e-4))
    hold = (sustain_len if sustain_len is not None else n / RATE - release)
    e *= np.where(t < hold, 1.0, np.clip(1 - (t - hold) / release, 0, 1))
    return e


def saw(f, n, harmonics, phase=0.0):
    """Dent de scie à bande limitée (additive) : le nombre d'harmoniques fait office de filtre."""
    t = np.arange(n) / RATE
    out = np.zeros(n)
    for k in range(1, harmonics + 1):
        if k * f > RATE / 2.2:
            break
        out += np.sin(2 * np.pi * k * f * t + phase * k) / k
    return out * 0.6


def square(f, n, harmonics, vibrato=0.0):
    t = np.arange(n) / RATE
    ph = 2 * np.pi * f * t + vibrato * np.sin(2 * np.pi * 5.5 * t) * np.clip(t - 0.15, 0, None) * 4
    out = np.zeros(n)
    for k in range(1, 2 * harmonics, 2):
        if k * f > RATE / 2.2:
            break
        out += np.sin(k * ph) / k
    return out * 0.8


# --- Batterie -------------------------------------------------------------------------------------------------------
def kick():
    n = int(0.35 * RATE)
    t = np.arange(n) / RATE
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / RATE
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = rng.standard_normal(n) * np.exp(-t * 400) * 0.25
    return body + click


def hat(open_=False):
    n = int((0.12 if open_ else 0.045) * RATE)
    t = np.arange(n) / RATE
    noise = np.diff(rng.standard_normal(n + 1))   # (dérivée : bruit aigu)
    return noise * np.exp(-t * (28 if open_ else 90)) * 0.18


def clap():
    n = int(0.22 * RATE)
    t = np.arange(n) / RATE
    noise = np.diff(rng.standard_normal(n + 1)) * 0.5 + rng.standard_normal(n) * 0.5
    bursts = sum(np.exp(-np.clip(t - d, 0, None) * 60) * (t >= d) for d in (0, 0.011, 0.022))
    return noise * (bursts * 0.5 + np.exp(-t * 18) * 0.6) * 0.22


# --- Harmonie (inventée) : ré mineur, deux mesures par accord ---------------------------------------------------------
# Dm - Gm - Bb - A, puis Dm - C - Gm - A (fin qui relance la boucle)
CHORDS = [
    (50, [62, 65, 69]),   # Dm
    (55, [62, 67, 70]),   # Gm
    (46, [62, 65, 70]),   # Bb
    (45, [61, 64, 69]),   # A
    (50, [62, 65, 69]),   # Dm
    (48, [60, 64, 67]),   # C
    (55, [62, 67, 70]),   # Gm
    (45, [61, 64, 69]),   # A
]

# Lead (inventé), mesures 9 à 16 : (temps depuis le début de la phrase, durée en temps, note midi)
LEAD = [
    (0, 0.5, 74), (0.5, 0.5, 77), (1, 1, 81), (2.5, 0.5, 79), (3, 1, 77),
    (4, 0.5, 76), (4.5, 0.5, 77), (5, 1.5, 74), (6.5, 1.5, 72),
    (8, 0.5, 74), (8.5, 0.5, 79), (9, 1, 82), (10.5, 0.5, 81), (11, 1, 79),
    (12, 1, 77), (13, 0.5, 79), (13.5, 2.5, 76),
    (16, 0.5, 81), (16.5, 0.5, 79), (17, 1, 77), (18.5, 0.5, 76), (19, 1, 74),
    (20, 0.5, 72), (20.5, 0.5, 74), (21, 1.5, 76), (22.5, 1.5, 77),
    (24, 0.5, 79), (24.5, 0.5, 77), (25, 1, 76), (26.5, 0.5, 74), (27, 1, 73),
    (28, 1.5, 76), (29.5, 2.5, 74),
]


def main():
    drums = np.zeros((LENGTH, 2))
    bass = np.zeros((LENGTH, 2))
    pad = np.zeros((LENGTH, 2))
    lead = np.zeros((LENGTH, 2))

    k, ch, hc, ho = kick(), clap(), hat(), hat(True)
    for bar in range(BARS):
        for beat in range(4):
            b = bar * 4 + beat
            place(drums, np.column_stack([k, k]) * 0.9, at(b))
            hh = ho if beat == 3 and bar % 2 == 1 else hc
            place(drums, np.column_stack([hh * 0.8, hh]), at(b + 0.5))   # charleston sur le contretemps
            if bar >= 4:
                place(drums, np.column_stack([hc * 0.5, hc * 0.35]), at(b + 0.25))
                place(drums, np.column_stack([hc * 0.35, hc * 0.5]), at(b + 0.75))
            if beat in (1, 3):
                place(drums, np.column_stack([ch * 0.9, ch]), at(b))

    # Pompage : basse, nappe et lead s'effacent sous chaque coup de grosse caisse (sidechain)
    t_beat = (np.arange(LENGTH) % at(1)) / RATE
    pump = 1 - 0.65 * np.exp(-t_beat * 9)

    for bar in range(BARS):
        root, notes = CHORDS[(bar // 2) % len(CHORDS)]
        # Basse : croches en octave, le contretemps plus fort (basse « qui saute » des années 90)
        for eighth in range(8):
            n = at(0.5) - 60
            note = root - 12 + (12 if eighth % 2 else 0)
            sig = saw(freq(note), n, 14) * env(n, 0.004, 0.03)
            sig *= 0.32 if eighth % 2 else 0.22
            place(bass, np.column_stack([sig, sig]), at(bar * 4 + eighth * 0.5))
        # Nappe : une fois par accord (deux mesures), saws désaccordées gauche / droite
        if bar % 2 == 0:
            n = at(8) + int(0.4 * RATE)
            e = env(n, 0.25, 0.4, sustain_len=at(8) / RATE)
            left = sum(saw(freq(m) * 0.997, n, 8, 0.3) for m in notes)
            right = sum(saw(freq(m) * 1.003, n, 8, 1.1) for m in notes)
            place(pad, np.column_stack([left, right]) * e[:, None] * 0.07, at(bar * 4))
            # Stabs d'accords sur les contretemps, à partir de la mesure 5
            if bar >= 4:
                for b in range(8):
                    if b % 2 == 1 or b == 6:
                        sn = int(0.16 * RATE)
                        stab = sum(square(freq(m + 12), sn, 6) for m in notes) * env(sn, 0.002, 0.1)
                        place(pad, np.column_stack([stab * 0.05, stab * 0.04]), at(bar * 4 + b + 0.5))

    # Lead : mesures 9 à 16 (les 8 premières mesures en sont dépourvues)
    for start, dur, note in LEAD:
        n = at(dur) + int(0.12 * RATE)
        sig = (square(freq(note), n, 10, vibrato=0.25) * 0.6 + saw(freq(note) * 1.004, n, 12) * 0.4)
        sig *= env(n, 0.006, 0.12, sustain_len=at(dur) * 0.92 / RATE) * 0.17
        pos = at(32 + start)
        place(lead, np.column_stack([sig * 0.85, sig]), pos)
        # Écho (croche pointée) à droite, plus doux
        place(lead, np.column_stack([sig * 0.12, sig * 0.3]), pos + at(0.75))

    mix = drums + (bass + pad + lead) * pump[:, None]
    # Retire la composante continue, puis crête à -1 dBFS (sans saturation)
    mix -= mix.mean(axis=0)
    mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))
    pcm = np.round(mix * 32767).astype('<i2')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with wave.open(OUT, 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm.tobytes())
    print(f'{os.path.normpath(OUT)} : {LENGTH / RATE:.2f} s, {os.path.getsize(OUT) / 1e6:.2f} Mo')


if __name__ == '__main__':
    main()
