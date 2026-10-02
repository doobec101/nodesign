#!/usr/bin/env python3
"""UI sounds for the chat promo, synthesized with numpy, placed by their measured peaks, mixed over the music.

    node motion/chat/tools/render.mjs cues > motion/chat/data/cues.json
    python3 motion/chat/tools/sounds.py           # → motion/chat/renders/chat-promo-audio.m4a (+ out/chat/…wav)

- nothing is sampled: key ticks (letters, space and modifiers sound different, the way iOS does), a trackpad
  click, whooshes for the camera moves, the hinge (a long soft friction swell) and the magnet's clack when the
  Duo closes, a morph glide, a tap, the send swoosh and the receive chime in the track's key (A minor: A5 → E6)
- each sound's peak (1 ms RMS envelope, argmax) is shifted onto its cue, so a key tick lands on the frame the key
  goes down and the clack on the frame the halves meet
- the music is the first 24 bars of Mixkit #190 "Electro Dreams" (Arulo) from its first downbeat, 5 ms fade-in,
  fading out with the picture over the last beats
"""
import json, os, subprocess, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # motion/chat
MOTION = os.path.dirname(ROOT)
SR = 44100
RNG = np.random.default_rng(11)


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return 'ffmpeg'


def load_song():
    raw = subprocess.run([ffmpeg(), '-v', 'error', '-i', os.path.join(MOTION, 'audio', 'electro-dreams.mp3'), '-f', 'f32le',
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
def glide(f0, f1, dur, curve=1.0):
    t = t_(dur)
    f = f0 * (f1 / f0) ** ((t / dur) ** curve)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)
def bandpass(x, lo, hi):
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.clip((fr - lo * 0.7) / (lo * 0.3 + 1e-9), 0, 1) * np.clip((hi * 1.4 - fr) / (hi * 0.4), 0, 1)
    return np.fft.irfft(X * m, len(x))
def noise(dur): return RNG.standard_normal(int(dur * SR))
def norm(x): return x / (np.max(np.abs(x)) + 1e-12)


def key_tick(kind):
    """iOS-like key tick: a short woody click; space and modifiers are lower and softer"""
    body = {'char': 2350, 'space': 1500, 'mod': 1850}[kind]
    x = 0.6 * tone(body, 0.04, 0.0045, 0.0004, ((1, 1), (2.1, .3))) + 0.4 * tone(body * 0.52, 0.04, 0.008, 0.0006)
    x[:int(0.002 * SR)] += 0.5 * bandpass(noise(0.002), 3000, 9000)
    # tiny random variation so a run of keys doesn't machine-gun
    return norm(x * (0.9 + 0.2 * RNG.random()))


def trackpad_click():
    x = 0.6 * tone(1250, 0.05, 0.005) + 0.5 * tone(420, 0.05, 0.012)
    x[:int(0.003 * SR)] += 0.4 * bandpass(noise(0.003), 2500, 8000)
    return norm(x)


def whoosh(size, dur=None):
    """air moving: band-passed noise whose band rises, swelling to a peak ~40 % in"""
    dur = dur or (0.3 + 0.2 * size)
    n = int(dur * SR)
    out = np.zeros(n)
    t = np.arange(n) / n
    for i, (lo, hi) in enumerate([(250, 600), (500, 1300), (1100, 2600), (2200, 5200)]):
        env = np.exp(-((t - (0.25 + 0.15 * i)) / 0.24) ** 2)
        out += bandpass(noise(dur), lo, hi) * env
    shape = np.minimum(1, t / 0.4) ** 1.5 * np.exp(-np.maximum(0, t - 0.4) / 0.32)
    return norm(out * shape)


def hinge(dur, speed=None):
    """the fold: soft friction whose level follows the hinge's angular speed (sampled by the page at 100 Hz)"""
    n = int(dur * SR)
    t = np.arange(n) / n
    x = bandpass(noise(dur), 180, 1400) * 0.7 + bandpass(noise(dur), 1800, 4200) * 0.25
    # a slow ratchet texture: very fine, very quiet grain
    grain = (np.sin(2 * np.pi * 38 * t * dur) > 0.96).astype(float) * 0.25
    if speed:
        sp = np.interp(t * dur, (np.arange(len(speed)) + 0.5) / 100, speed)
        env = np.clip(sp, 0, 1) ** 0.7 * np.minimum(1, t * dur / 0.03) * np.minimum(1, (1 - t) * dur / 0.02)
    else:
        env = np.sin(np.pi * np.clip(t / 0.95, 0, 1)) ** 1.6 * (0.6 + 0.4 * t)
    return norm((x + bandpass(grain * noise(dur), 1500, 5000)) * env)


def clack():
    """the halves meeting: a magnet's low thump with a hard, short top"""
    x = 0.8 * tone(95, 0.35, 0.06, 0.001) + 0.5 * tone(190, 0.35, 0.03, 0.001)
    top = bandpass(noise(0.03), 1500, 7000) * decay(0.03, 0.004, 0.0003)
    x[:len(top)] += 0.9 * top
    return norm(x)


def morph():
    t = t_(0.55)
    w = np.sin(np.pi * t / 0.55) ** 2
    return norm(glide(330, 659.25, 0.55, 0.7) * w * 0.5 + whoosh(0.9, 0.55) * 0.8)


def send():
    """a short upward swoosh that resolves on A5"""
    t = t_(0.32)
    env = np.minimum(1, t / 0.02) * np.exp(-np.maximum(0, t - 0.1) / 0.08)
    return norm(glide(520, 880, 0.32, 0.5) * env * 0.6 + bandpass(noise(0.32), 1800, 6000) * env * 0.35)


def chime():
    """receive: two soft bell notes a sixteenth apart, A5 then E6, loud first so the peak is the first attack"""
    a = tone(880.0, 0.9, 0.22, 0.002, ((1, 1), (2.76, .12), (5.4, .04)))
    b = 0.55 * tone(1318.51, 0.9, 0.26, 0.002, ((1, 1), (2.76, .1)))
    gap = int(0.125 * SR)
    return norm(np.pad(a, (0, gap)) + np.pad(b, (gap, 0)))


def tap():
    return norm(tone(1900, 0.04, 0.006) + 0.35 * tone(3800, 0.04, 0.003))


def bell(second=False):
    """the bell: a small, bright hand bell on E6, a metallic partial set, the clapper's tick on top; the second ring
    a touch softer and a semitone-free fourth below (B5), like a double ding"""
    f = 987.77 if second else 1318.51
    x = tone(f, 1.1, 0.32, 0.0015, ((1, 1), (2.32, .45), (4.25, .22), (6.8, .08)))
    x += 0.35 * tone(f * 0.5, 1.1, 0.18, 0.003)
    tick = bandpass(noise(0.012), 3000, 9000) * decay(0.012, 0.002, 0.0002)
    x[:len(tick)] += 0.5 * tick
    return norm(x)


SOUNDS = {
    # keys sit lower over the sparse intro and come up over the drop (bar 9, 16 s), where the mix is 17 dB louder
    'key':     lambda c: (key_tick(c.get('k', 'char')), {'char': -25, 'space': -26, 'mod': -27}[c.get('k', 'char')] + (5 if c['t'] > 16.0 else 0)),
    'click':   lambda c: (trackpad_click(), -17),
    'whoosh':  lambda c: (whoosh(1.1, c.get('len')), -23),
    'hinge':   lambda c: (hinge(c.get('len', 3.5), c.get('env')), -29),
    'clack':   lambda c: (clack(), -15),
    'morph':   lambda c: (morph(), -22),
    'tap':     lambda c: (tap(), -22),
    'bell':    lambda c: (bell(c.get('second')), -19 if c.get('second') else -17),
    'send':    lambda c: (send(), -15),
    'receive': lambda c: (chime(), -16),
}
PAN = {'key': lambda c: RNG.uniform(-0.12, 0.12)}
# where a sound's peak sits relative to its cue: sustained sounds peak late on purpose
PEAK_OFFSET = {'hinge': None, 'whoosh': 0.22, 'morph': 0.2}


def peak_time(x):
    k = int(0.001 * SR)
    e = np.sqrt(np.convolve(x ** 2, np.ones(k) / k, 'same'))
    return int(np.argmax(e))


def main():
    cues = json.load(open(os.path.join(ROOT, 'data', 'cues.json')))
    L, start = cues['length'], cues['audioStart']
    n = int(round(L * SR))
    song = load_song()
    s0 = int(round(start * SR))
    track = song[s0:]
    # cuts in the music (film beats, e.g. [[36, 40]]: a bar taken out where the picture got shorter). Each is made 4 ms
    # before the downbeats, with a 4 ms crossfade; the latest first, so the earlier positions stay put
    X = int(0.004 * SR)
    for b0, b1 in sorted(cues.get('cuts', []), reverse=True):
        c1, c2 = int(round((b0 * cues['beat'] - 0.004) * SR)), int(round((b1 * cues['beat'] - 0.004) * SR))
        f = np.linspace(0, 1, X)[:, None]
        track = np.concatenate([track[:c1 - X], track[c1 - X:c1] * (1 - f) + track[c2 - X:c2] * f, track[c2:]])
    mix = track[:n].copy()
    fi = int(0.005 * SR)
    mix[:fi] *= np.linspace(0, 1, fi)[:, None]
    # fade out with the picture (the page fades from beat 93 over 2.5 beats), a touch longer so the tail breathes
    fo0, fo1 = int(cues['fadeOut'][0] * SR), min(n, int(cues['fadeOut'][1] * SR))
    ramp = np.ones(n)
    ramp[fo0:fo1] = np.cos(np.linspace(0, np.pi / 2, fo1 - fo0)) ** 2
    ramp[fo1:] = 0
    mix *= ramp[:, None]
    ui = np.zeros((n, 2))
    report = []
    for c in cues['cues']:
        x, db = SOUNDS[c['kind']](c)
        off = PEAK_OFFSET.get(c['kind'], 0)
        if off is None:                                   # sustained: starts on its cue
            st = int(round(c['t'] * SR)); pk = 0
        else:
            pk = peak_time(x)
            st = int(round((c['t'] + off) * SR)) - pk
        pan = PAN.get(c['kind'], lambda c: 0)(c)
        g = 10 ** (db / 20)
        lr = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
        a, b = max(0, st), min(n, st + len(x))
        if b > a:
            ui[a:b] += (x[a - st:b - st] * g)[:, None] * lr[None, :]
        report.append((c['t'], c['kind'], pk / SR * 1000))
    ui *= ramp[:, None]
    out = mix + ui
    peak = np.max(np.abs(out))
    if peak > 0.97:
        out *= 0.97 / peak
    outdir = os.path.join(MOTION, 'out', 'chat'); os.makedirs(outdir, exist_ok=True)
    wav = os.path.join(outdir, 'chat-promo-audio.wav')
    with wave.open(wav, 'wb') as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(out, -1, 1) * 32767).astype('<i2').tobytes())
    rdir = os.path.join(ROOT, 'renders'); os.makedirs(rdir, exist_ok=True)
    m4a = os.path.join(rdir, 'chat-promo-audio.m4a')
    subprocess.run([ffmpeg(), '-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '256k', m4a], check=True)
    kinds = {}
    for t, k, p in report:
        kinds[k] = kinds.get(k, 0) + 1
    print(f'{len(report)} cues over {L:.2f} s ({", ".join(f"{k} ×{v}" for k, v in kinds.items())}); mix peak {peak:.2f}')
    print(wav); print(m4a)


if __name__ == '__main__':
    main()
