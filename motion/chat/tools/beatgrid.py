#!/usr/bin/env python3
"""Beat grid, structure and per-16th hits for the chat promo, with numpy only.

    python3 motion/chat/tools/beatgrid.py        # reads motion/audio/electro-dreams.mp3, writes motion/chat/data/beats.json

Mixkit #190 "Electro Dreams" (Arulo). What it measures:
- tempo: a constant grid fitted to the onset envelope (period searched at 0.01 ms, phase at 0.5 ms)
- bars: 4 beats; the drop is the bar with the largest loudness rise, and bars are counted so it opens a bar
- per 16th: kick (30-110 Hz), clap/snare (150-600 Hz + 2-5 kHz) and hat (> 6 kHz) onset strengths, normalised
  over the window, so the page can put key presses, sends and landings on real hits rather than on the bare grid
- a 3-band level envelope at 120 Hz (low / mid / high) for anything that should breathe with the mix
"""
import base64, json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), 'audio', 'electro-dreams.mp3')
OUT = os.path.join(ROOT, 'data', 'beats.json')
SR = 44100
BARS = 24                      # the video uses the first 24 bars: 8 of intro, the drop, two 8-bar phrases


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return 'ffmpeg'


def decode(path):
    raw = subprocess.run([ffmpeg(), '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def stft_mag(x, n_fft, hop):
    win = np.hanning(n_fft).astype(np.float32)
    n = 1 + (len(x) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    mag = np.abs(np.fft.rfft(x[idx] * win, axis=1)).astype(np.float32)
    t = np.arange(n) * hop / SR + n_fft / 2 / SR
    return mag, t, np.fft.rfftfreq(n_fft, 1 / SR)


def band_flux(mag, freqs, lo, hi):
    B = mag[:, (freqs >= lo) & (freqs < hi)].sum(1)
    L = np.log1p(1000 * B)
    return np.maximum(0, np.diff(L, prepend=L[:1]))


def peak_near(t, env, s, w):
    fps = 1 / (t[1] - t[0])
    i0, i1 = int((s - w - t[0]) * fps), int((s + w - t[0]) * fps) + 1
    return float(env[max(0, i0):max(1, i1)].max()) if i1 > 0 else 0.0


def fit_grid(t, env):
    o = env - env.mean()
    ac = np.correlate(o, o, 'full')[len(o) - 1:]
    fps = 1 / (t[1] - t[0])
    lags = np.arange(len(ac)) / fps
    ok = (lags > 60 / 180) & (lags < 60 / 90)
    base = lags[ok][np.argmax(ac[ok])]

    def score(per, ph):
        bs = np.arange(ph, t[-1] - 0.5, per)
        return np.mean([peak_near(t, env, b, 0.006) for b in bs[bs > 0.02]])
    _, per, ph = max((score(p, q), p, q) for p in np.arange(base - 0.004, base + 0.004, 0.0002)
                     for q in np.arange(0, base, 0.004))
    per = max((score(p2, ph), p2) for p2 in np.arange(per - 0.0004, per + 0.0004, 0.00001))[1]
    ph = max((score(per, p2), p2) for p2 in np.arange(ph - 0.006, ph + 0.006, 0.0005))[1]
    return per, ph % per


def rms_db(x, a, b):
    s = x[max(0, int(a * SR)):int(b * SR)]
    return float(20 * np.log10(np.sqrt(np.mean(s ** 2)) + 1e-9)) if len(s) else -120.0


def main():
    x = decode(SRC)
    dur = len(x) / SR
    mag, t, freqs = stft_mag(x, 1024, 64)
    kick, clap = band_flux(mag, freqs, 30, 110), band_flux(mag, freqs, 150, 600) + band_flux(mag, freqs, 2000, 5000)
    hat = band_flux(mag, freqs, 6000, 16000)
    env = kick + clap + hat
    period, phase = fit_grid(t, env)
    beats = np.arange(phase, dur, period)
    # the drop: the beat with the largest rise of bright (> 1 kHz) energy over the next beats vs the previous ones.
    # Loudness alone is ambiguous here: the bass enters one beat early (a pickup on beat 31), the hats, claps and
    # pads open exactly on beat 32, which is where the bar lines go
    bright = (mag[:, freqs > 1000] ** 2).sum(1)
    e = np.array([bright[(t >= b) & (t < b + period)].mean() for b in beats[:-1]])
    e = 10 * np.log10(e + 1e-12)
    # searched after the 8-bar intro could have happened (beat 32 on) and within the first phrase after it
    rise = np.array([e[i:i + 4].mean() - e[i - 4:i].mean() if 32 <= i < 48 else -99 for i in range(len(e) - 4)])
    drop_i = int(np.argmax(rise))
    drop_t = float(beats[drop_i])
    # bar 1 = the downbeat 8 bars (32 beats) before the drop: the track's own first bar
    start = float(beats[drop_i - 32])
    grid = start + period * np.arange(BARS * 4 * 4) / 4       # 16ths over the window
    n = lambda e: e / (np.percentile(e, 99.5) + 1e-9)
    K, C, H = n(kick), n(clap), n(hat)
    six = []
    for i, g in enumerate(grid):
        six.append([round(min(1.0, peak_near(t, K, g, 0.012)), 2), round(min(1.0, peak_near(t, C, g, 0.012)), 2),
                    round(min(1.0, peak_near(t, H, g, 0.012)), 2)])
    bars_db = [round(rms_db(x, start + 4 * period * i, start + 4 * period * (i + 1)), 1) for i in range(BARS + 8)]
    # 3-band levels at 120 Hz over the window (meter ballistics), bytes
    rate = 120
    m2, t2, f2 = stft_mag(x, 2048, SR // rate)
    lv = []
    for lo, hi in ((30, 160), (160, 2500), (2500, 16000)):
        e = 10 * np.log10((m2[:, (f2 >= lo) & (f2 < hi)] ** 2).sum(1) + 1e-12)
        g = np.arange(start, start + BARS * 4 * period, 1 / rate)
        v = np.interp(g, t2, e)
        a, b = np.percentile(v, 5), np.percentile(v, 99)
        v = np.clip((v - a) / (b - a), 0, 1)
        y, out, ku, kd = v[0], [], 1 - np.exp(-1 / (0.012 * rate)), 1 - np.exp(-1 / (0.2 * rate))
        for s in v:
            y += (ku if s > y else kd) * (s - y); out.append(y)
        lv.append(np.round(np.array(out) * 255).astype(np.uint8))
    data = {
        'source': 'Mixkit #190 — Electro Dreams (Arulo)',
        'bpm': round(60 / period, 4), 'period': round(float(period), 6), 'bar': round(float(4 * period), 6),
        'start': round(start, 4), 'bars': BARS, 'length': round(BARS * 4 * period, 4),
        'drop_at': round(drop_t - start, 4), 'duration': round(dur, 3),
        'bars_db': bars_db,
        'sixteenths': six,                                        # [kick, clap, hat] per 16th from the window start
        'levels': {'rate': rate, 'bands': ['low', 'mid', 'high'], 'frames': len(lv[0]),
                   'b64': base64.b64encode(np.stack(lv, 1).tobytes()).decode()},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'{data["bpm"]} BPM (beat {period:.5f} s), window starts {start:.3f} s, drop {drop_t:.3f} s '
          f'= {drop_t - start:.3f} s in; {BARS} bars = {BARS * 4 * period:.3f} s -> {OUT}')
    print('bar dB:', ' '.join(f'{v:.0f}' for v in bars_db))
    for bar in range(BARS):
        row = six[bar * 16:(bar + 1) * 16]
        s = ''.join('K' if k > .5 else ('C' if c > .5 else ('h' if h > .45 else '.')) for k, c, h in row)
        print(f'bar {bar + 1:2d}  {s[:4]} {s[4:8]} {s[8:12]} {s[12:]}')


if __name__ == '__main__':
    sys.exit(main())
