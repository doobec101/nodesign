#!/usr/bin/env python3
"""UI sounds for ds-promo, synthesized with numpy, placed by their measured peaks, mixed over the loop.

    node motion/tools/render.mjs cues > motion/data/cues.json
    python3 motion/tools/sounds.py          # → motion/renders/ds-promo-audio.m4a (+ out/…wav)

- every sound is generated here (no samples to license): clicks, ticks, blinks, whooshes, chimes, and
  Karplus-Strong plucks for the promo's curves, tuned to the track's key (E minor: B4, G4, E4)
- each sound's peak is measured (1 ms RMS envelope, argmax) and the sound is shifted so that peak lands on
  its cue; morph whooshes peak on the shape's fastest moment, a few frames after the morph starts
- the music is bars 9–32 of the track (12.80 s + 38.4 s); anything that rings past the loop's end wraps to
  its start, and the seam crossfades into the audio that leads into bar 9, so the file loops without a click
"""
import json, os, subprocess, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SR = 44100
RNG = np.random.default_rng(7)


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return 'ffmpeg'


def load_song():
    raw = subprocess.run([ffmpeg(), '-v', 'error', '-i', os.path.join(ROOT, 'audio', 'song.mp3'), '-f', 'f32le',
                          '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


# ---------- building blocks ----------
def t_(dur): return np.arange(int(dur * SR)) / SR
def decay(dur, tau, attack=0.0008):
    t = t_(dur)
    return np.minimum(1, t / attack) * np.exp(-t / tau)
def tone(f, dur, tau, attack=0.0008, partials=((1, 1),)):
    t = t_(dur)
    x = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t / (tau / (1 + 0.6 * (k - 1)))) for k, a in partials)
    return x * np.minimum(1, t / attack)
def glide(f0, f1, dur):
    t = t_(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)
def bandpass(x, lo, hi):
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.clip((fr - lo * 0.7) / (lo * 0.3 + 1e-9), 0, 1) * np.clip((hi * 1.4 - fr) / (hi * 0.4), 0, 1)
    return np.fft.irfft(X * m, len(x))
def noise(dur): return RNG.standard_normal(int(dur * SR))
def norm(x): return x / (np.max(np.abs(x)) + 1e-12)


def two(f1, f2, gap):
    a = tone(f1, 0.5, 0.12, 0.002, ((1, 1), (2.76, .18)))
    b = 0.4 * tone(f2, 0.5, 0.14, 0.002, ((1, 1), (2.76, .15)))
    return norm(np.pad(a, (0, int(gap * SR))) + np.pad(b, (int(gap * SR), 0)))


def whoosh(size):
    """air moving: band-passed noise whose band rises, swelling to a peak ~40 % in"""
    dur = 0.22 + 0.12 * size
    n = int(dur * SR)
    out = np.zeros(n)
    bands = [(300, 700), (600, 1400), (1200, 2800), (2400, 5200)]
    t = np.arange(n) / n
    for i, (lo, hi) in enumerate(bands):
        centre = 0.25 + 0.15 * i
        env = np.exp(-((t - centre) / 0.22) ** 2)
        out += bandpass(noise(dur), lo, hi) * env
    shape = np.minimum(1, t / 0.35) ** 1.5 * np.exp(-np.maximum(0, t - 0.35) / 0.35)
    return norm(out * shape)


def karplus(f, dur=1.6, damp=0.9965, bright=0.55):
    """a plucked string: a noise burst circulating in a delay line with a gentle low-pass"""
    n, p = int(dur * SR), int(round(SR / f))
    buf = bandpass(noise(p / SR + 0.01)[:p], 200, 7000 * bright + 1000)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = damp * 0.5 * (buf[i % p] + buf[(i + 1) % p])
    return norm(out) * decay(dur, 0.55, 0.0015)


def click(kind='click'):
    body = {'click': 900, 'field': 820, 'item': 1050, 'check': 1250, 'primary': 760, 'unfilled': 980, 'grab': 700}[kind]
    x = 0.55 * tone(body * 2, 0.05, 0.006) + 0.45 * tone(body, 0.05, 0.014)
    x[:int(0.003 * SR)] += 0.35 * bandpass(noise(0.003), 2500, 7000)
    return norm(x)


SOUNDS = {
    'press':   lambda c: (click(c.get('ui', 'click')), -12),
    'release': lambda c: (norm(tone(2700, 0.03, 0.004) + 0.3 * tone(5400, 0.03, 0.002)), -22),
    'blink':   lambda c: (norm(tone(1480, 0.05, 0.012, 0.002) + 0.25 * tone(2960, 0.05, 0.006)), -24 if c.get('soft') else -21),
    'morph':   lambda c: (whoosh(c.get('size', 1)), -24 + 2.2 * c.get('size', 1)),
    'slide':   lambda c: (whoosh(0.4), -24),
    'tick':    lambda c: (norm(tone(2350, 0.03, 0.005) + 0.4 * tone(4700, 0.03, 0.003)), -18),
    'stretch': lambda c: (norm(glide(210, 640, 0.36) * np.sin(np.pi * t_(0.36) / 0.36) ** 1.5), -24),
    # two-note sounds: the first note is the loud one, so the measured peak is the first attack
    'error':   lambda c: (norm(np.r_[tone(196, 0.11, 0.035, 0.002, ((1, 1), (2, .35))), 0.7 * tone(185, 0.16, 0.04, 0.002, ((1, 1), (2, .35)))]), -18),
    'success': lambda c: (two(1318.5, 1975.5, 0.09), -21),
    'pluck':   lambda c: (karplus([493.88, 392.0, 329.63][c['string']]), -16),
    'open':    lambda c: (norm(glide(700, 1150, 0.045) * decay(0.045, 0.02, 0.002)), -20),
    'close':   lambda c: (norm(glide(1050, 640, 0.04) * decay(0.04, 0.018, 0.002)), -22),
    'chip':    lambda c: (norm(tone(3100, 0.03, 0.004)), -20),
    'row':     lambda c: (norm(tone(2100, 0.035, 0.006) + 0.3 * tone(4200, 0.035, 0.003)), -21),
    'rise':    lambda c: (norm(glide(520, 1560, 0.42) * np.sin(np.pi * t_(0.42) / 0.42) ** 2 + 0.15 * bandpass(noise(0.42), 2000, 6000) * np.sin(np.pi * t_(0.42) / 0.42)), -21),
    'modal':   lambda c: (whoosh(1.4), -24),
    'toast':   lambda c: (two(987.77, 1318.5, 0.07), -20),
    'fall':    lambda c: (norm(glide(1400, 320, 0.45) * np.sin(np.pi * t_(0.45) / 0.45) ** 1.5), -20),
}
PAN = {'pluck': lambda c: (-0.25, 0.0, 0.25)[c['string']]}
# where the cue sits relative to the visible event: morph whooshes peak when the spring moves fastest
PEAK_OFFSET = {'morph': 0.1, 'modal': 0.09, 'slide': 0.06}


def peak_time(x):
    e = np.sqrt(np.convolve(x ** 2, np.ones(int(0.001 * SR)) / int(0.001 * SR), 'same'))
    return int(np.argmax(e))


def main():
    cues = json.load(open(os.path.join(ROOT, 'data', 'cues.json')))
    beats = json.load(open(os.path.join(ROOT, 'data', 'beats.json')))
    L = cues['loop']
    n = int(round(L * SR))
    song = load_song()
    s0 = int(round(beats['window']['start'] * SR))
    mix = song[s0:s0 + n].copy()
    # the seam: the loop's last 12 ms crossfade into the 12 ms that lead into bar 9 in the song
    xf = int(0.012 * SR)
    w = np.sin(np.linspace(0, np.pi / 2, xf)) ** 2
    mix[-xf:] = mix[-xf:] * (1 - w)[:, None] + song[s0 - xf:s0] * w[:, None]
    ui = np.zeros((n, 2))
    report = []
    for c in cues['cues']:
        x, db = SOUNDS[c['kind']](c)
        pk = peak_time(x)
        at = c['t'] + PEAK_OFFSET.get(c['kind'], 0)
        start = int(round(at * SR)) - pk
        pan = PAN.get(c['kind'], lambda c: 0)(c)
        g = 10 ** (db / 20)
        lr = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
        idx = (start + np.arange(len(x))) % n                      # wrap around the loop
        np.add.at(ui, idx, (x * g)[:, None] * lr[None, :])
        report.append((c['t'], c['kind'], pk / SR * 1000))
    out = mix + ui
    peak = np.max(np.abs(out))
    if peak > 0.97:
        out *= 0.97 / peak
    os.makedirs(os.path.join(ROOT, 'out'), exist_ok=True)
    wav = os.path.join(ROOT, 'out', 'ds-promo-audio.wav')
    with wave.open(wav, 'wb') as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(out, -1, 1) * 32767).astype('<i2').tobytes())
    os.makedirs(os.path.join(ROOT, 'renders'), exist_ok=True)
    m4a = os.path.join(ROOT, 'renders', 'ds-promo-audio.m4a')
    subprocess.run([ffmpeg(), '-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '256k', m4a], check=True)
    kinds = {}
    for t, k, p in report:
        kinds.setdefault(k, p)
    print(f'{len(report)} cues over {L:.2f} s; mix peak {peak:.2f}{" → normalised" if peak > 0.97 else ""}')
    print('measured peaks (ms after each sound starts):', ', '.join(f'{k} {v:.1f}' for k, v in kinds.items()))
    print(wav); print(m4a)


if __name__ == '__main__':
    main()
