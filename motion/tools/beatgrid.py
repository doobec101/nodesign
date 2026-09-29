#!/usr/bin/env python3
"""Beat grid, structure and equalizer data for the ds-promo loop, with numpy only.

    python3 motion/tools/beatgrid.py            # reads motion/audio/song.mp3, writes motion/data/beats.json

What it measures (Mixkit "Can't Get You Off My Mind", Michael Ramir C.):
- tempo: the onset envelope's autocorrelation gives 0.8 s / 0.4 s; a constant-grid fit over the whole
  track (period and phase searched at 0.02 ms / 1 ms steps) lands on 0.40000 s = 150.000 BPM, no drift
- downbeats: harmonic change (beat-synchronous chroma novelty) is lowest on the 4th beat and the drop
  hits at 25.6 s, so bars are 4 beats (1.6 s) starting at t = 0; kick and clap alternate every 0.8 s
  (half-time feel), hats on the 8ths
- structure: bars 1-8 filtered intro, 9-16 filter opens then a bass-less build, 17 the drop, then
  8-bar phrases with stops/fills at bars 20, 24, 28, 32
- loop: bars 9-32 (12.8 s - 51.2 s, 96 beats). It starts on a downbeat, the drop lands 32 beats in,
  and bar 32 is a fill that rolls into the next downbeat, so the seam falls on a phrase boundary

It also writes, for the loop window, per-beat accents and a 9-band equalizer (one band per tenor on
the chart: 3M ... 10Y) sampled at 120 Hz with meter ballistics, quantized to bytes.
"""
import base64, json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'audio', 'song.mp3')
OUT = os.path.join(ROOT, 'data', 'beats.json')
SR = 44100


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
    t = np.arange(n) * hop / SR + n_fft / 2 / SR          # frame centres
    return mag, t, np.fft.rfftfreq(n_fft, 1 / SR)


def log_bands(mag, freqs, lo=30.0, octaves=9.0, per_oct=4):
    edges = lo * 2 ** (np.arange(0, octaves + 1e-9, 1 / per_oct))
    return np.stack([mag[:, (freqs >= a) & (freqs < b)].sum(1) for a, b in zip(edges[:-1], edges[1:])], 1), edges


def onset_envelope(x):
    mag, t, freqs = stft_mag(x, 1024, 64)
    B, edges = log_bands(mag, freqs)
    flux = np.maximum(0, np.diff(np.log1p(1000 * B), axis=0, prepend=np.log1p(1000 * B[:1])))
    return t, flux.sum(1), flux, edges


def peak_near(t, env, s, w):
    fps = 1 / (t[1] - t[0])
    i0, i1 = int((s - w - t[0]) * fps), int((s + w - t[0]) * fps) + 1
    return float(env[max(0, i0):max(0, i1)].max()) if i1 > 0 else 0.0


def fit_grid(t, env):
    """Constant grid: best period near the autocorrelation peak, then the best phase."""
    o = env - env.mean()
    ac = np.correlate(o, o, 'full')[len(o) - 1:]
    fps = 1 / (t[1] - t[0])
    lags = np.arange(len(ac)) / fps
    ok = (lags > 60 / 200) & (lags < 60 / 60)
    lag = lags[ok][np.argmax(ac[ok])]
    base = lag / 2 if lag > 0.6 else lag                      # count the 150-level pulse, not the half-time one
    def score(per, ph):
        bs = np.arange(ph, t[-1] - 0.5, per)
        return np.mean([peak_near(t, env, b, 0.006) for b in bs[bs > 0.05]])
    best = max((score(per, ph), per, ph) for per in np.arange(base - 0.004, base + 0.004, 0.0002)
               for ph in np.arange(0, base / 2, 0.004))
    _, per, ph = best
    per = max((score(p2, ph), p2) for p2 in np.arange(per - 0.0004, per + 0.0004, 0.00002))[1]
    ph = max((score(per, p2), p2) for p2 in np.arange(ph - 0.006, ph + 0.006, 0.0005))[1]
    return per, ph % per


def chroma_novelty(x, beats, span):
    n_fft = 8192
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)
    ok = (freqs > 60) & (freqs < 4000)
    pc = np.round(12 * np.log2(freqs[ok] / 440.0)).astype(int) % 12
    win = np.hanning(n_fft)
    C = []
    for b in beats:
        seg = x[int(b * SR):int((b + span) * SR)]
        cs = [np.abs(np.fft.rfft(seg[s:s + n_fft] * win))[ok] ** 2 for s in range(0, max(1, len(seg) - n_fft), 2048)]
        c = np.array([np.mean(cs, 0)[pc == k].sum() for k in range(12)]) if cs else np.zeros(12)
        C.append(c / (np.linalg.norm(c) + 1e-9))
    C = np.array(C)
    return np.r_[0, 1 - (C[1:] * C[:-1]).sum(1)]


def rms_db(x, a, b):
    s = x[int(a * SR):int(b * SR)]
    return float(20 * np.log10(np.sqrt(np.mean(s ** 2)) + 1e-9))


def equalizer(x, w0, w1, rate=120, bands=9):
    """Meter-style band levels for the window: 9 log bands 45 Hz - 11 kHz, fast attack, slow release."""
    mag, t, freqs = stft_mag(x, 2048, SR // rate // 1)
    edges = np.geomspace(45, 11000, bands + 1)
    E = np.stack([(mag[:, (freqs >= a) & (freqs < b)] ** 2).sum(1) for a, b in zip(edges[:-1], edges[1:])], 1)
    db = 10 * np.log10(E + 1e-12)
    grid = np.arange(w0, w1, 1 / rate)
    lvl = np.stack([np.interp(grid, t, db[:, k]) for k in range(bands)], 1)
    # normalise each band over the whole window: 0 at its 5th percentile, 1 at its 99th
    lo, hi = np.percentile(lvl, 5, axis=0), np.percentile(lvl, 99, axis=0)
    lvl = np.clip((lvl - lo) / (hi - lo), 0, 1)
    # ballistics: attack ~12 ms, release ~180 ms (per-sample one-pole)
    a_up, a_dn = 1 - np.exp(-1 / (0.012 * rate)), 1 - np.exp(-1 / (0.18 * rate))
    out = np.zeros_like(lvl)
    # run twice so the loop's start already carries the level from its own end (periodic meter)
    y = lvl[-1].copy()
    for _ in range(2):
        for i in range(len(lvl)):
            k = np.where(lvl[i] > y, a_up, a_dn)
            y = y + k * (lvl[i] - y)
            out[i] = y
    return out, edges


def main():
    x = decode(SRC)
    dur = len(x) / SR
    t, env, flux, edges = onset_envelope(x)
    period, phase = fit_grid(t, env)
    # the grid starts on the first beat at or after 0
    beats = np.arange(phase, dur, period)
    # downbeat: the beat-in-bar with the least harmonic change is beat 4
    nov = chroma_novelty(x, beats, period)
    lowest = int(np.argmin([nov[k::4][beats[k::4] > 12].mean() for k in range(4)]))
    bar0 = (lowest + 1) % 4                                   # the beat after the "quiet" one opens the bar
    downbeats = beats[bar0::4]
    bar = 4 * period
    # sections by loudness jumps between bars (drop = largest rise)
    bars_db = [rms_db(x, d, d + bar) for d in downbeats if d + bar <= dur]
    rise = np.diff(bars_db)
    drop_bar = int(np.argmax(rise)) + 1                       # 0-based bar index of the drop
    drop_t = float(downbeats[drop_bar])
    # loop window: 8 bars of build before the drop, 16 bars after it
    w0 = float(downbeats[drop_bar - 8]); w1 = float(downbeats[drop_bar + 16])
    wb = beats[(beats >= w0 - 1e-6) & (beats < w1 - 1e-6)]
    song_bar = lambda s: int(round(s / bar)) + 1              # bar 1 starts at 0 s
    kick = flux[:, (edges[:-1] >= 30) & (edges[:-1] < 110)].sum(1)
    clap = flux[:, (edges[:-1] >= 150) & (edges[:-1] < 600)].sum(1)
    hat = flux[:, (edges[:-1] >= 6000)].sum(1)
    beat_rows = []
    for i, b in enumerate(wb):
        beat_rows.append({
            'i': i, 't': round(float(b - w0), 4), 'bar': i // 4 + 1, 'beat': i % 4 + 1,
            'onset': round(peak_near(t, env, b, 0.02), 2), 'kick': round(peak_near(t, kick, b, 0.02), 2),
            'clap': round(peak_near(t, clap, b, 0.02), 2), 'hat': round(peak_near(t, hat, b, 0.02), 2),
            'db': [round(rms_db(x, b, b + period / 2), 1), round(rms_db(x, b + period / 2, b + period), 1)],
        })
    eq, eq_edges = equalizer(x, w0, w1)
    q = np.round(eq * 255).astype(np.uint8)
    data = {
        'source': 'Mixkit — Can\'t Get You Off My Mind (Michael Ramir C.)',
        'bpm': round(60 / period, 3), 'period': round(float(period), 6), 'phase': round(float(phase), 4),
        'meter': '4/4, half-time feel (kick and clap alternate every 2 beats)',
        'bar': round(float(bar), 6), 'duration': round(dur, 3),
        'downbeat_offset': round(float((downbeats[0] + bar / 2) % bar - bar / 2), 4),
        'bars_db': [round(v, 1) for v in bars_db],
        'drop': round(drop_t, 4), 'drop_bar': song_bar(drop_t),
        'window': {'start': round(w0, 4), 'end': round(w1, 4), 'bars': [song_bar(w0), song_bar(w1) - 1],
                   'length': round(w1 - w0, 4), 'beats': len(wb), 'drop_at': round(drop_t - w0, 4)},
        'sections': [
            {'from': 0.0, 'to': round(4 * bar, 4), 'name': 'build A: filter opening, bass in'},
            {'from': round(4 * bar, 4), 'to': round(8 * bar, 4), 'name': 'build B: bright, bass out, riser'},
            {'from': round(8 * bar, 4), 'to': round(16 * bar, 4), 'name': 'drop phrase 1 (stops at the ends of song bars 20 and 24)'},
            {'from': round(16 * bar, 4), 'to': round(24 * bar, 4), 'name': 'drop phrase 2 (stop at the end of song bar 28, fill in bar 32)'},
        ],
        'beats': beat_rows,
        'eq': {'rate': 120, 'bands': len(eq_edges) - 1, 'edges_hz': [round(float(e)) for e in eq_edges],
               'frames': len(q), 'b64': base64.b64encode(q.tobytes()).decode()},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(data, f, indent=1)
    print(f'{data["bpm"]} BPM, bar {bar:.3f} s, drop at {drop_t:.2f} s (bar {song_bar(drop_t)}); '
          f'loop {w0:.2f}-{w1:.2f} s = {len(wb)} beats; eq {len(q)} frames x {eq.shape[1]} bands -> {OUT}')


if __name__ == '__main__':
    sys.exit(main())
