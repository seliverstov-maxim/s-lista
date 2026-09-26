// Синтетический «фортепианный» звук и шум для тестов распознавания.
// Модель: негармоничные обертоны (растяжка B), слабая основная частота у басов,
// экспоненциальное затухание (верхние обертоны быстрее), шумовой удар молоточка 20 мс.
import { PitchListener } from './load-detector.mjs';

let seed = 7;
export const reseed = (s = 7) => { seed = s; };
export const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
export const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

export function addPiano(out, sr, t0, midi, amp, dur) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const B = 0.0003 * Math.pow(2, (midi - 60) / 20);
  const a1 = midi < 45 ? 0.2 : midi < 55 ? 0.45 : midi < 64 ? 0.8 : 1;
  const tauBase = midi < 60 ? 2.5 : 2.5 * Math.pow(2, -(midi - 60) / 14);
  const parts = [];
  for (let k = 1; k <= 24; k++) {
    const f = k * f0 * Math.sqrt(1 + B * k * k);
    if (f > 9000) break;
    parts.push({ f, a: (k === 1 ? a1 : 1 / Math.pow(k, 0.9)) * (0.8 + 0.4 * rnd()), tau: tauBase / (1 + 0.35 * (k - 1)), ph: rnd() * 6.28 });
  }
  const i0 = Math.floor(t0 * sr), N = Math.floor(dur * sr);
  for (let i = 0; i < N && i0 + i < out.length; i++) {
    const t = i / sr;
    const att = Math.min(1, t / 0.003);
    let v = 0;
    for (const p of parts) v += p.a * Math.exp(-t / p.tau) * Math.sin(2 * Math.PI * p.f * t + p.ph);
    if (t < 0.02) v += 0.6 * gauss() * (1 - t / 0.02);
    const rel = t > dur - 0.08 ? Math.max(0, (dur - t) / 0.08) : 1;
    out[i0 + i] += amp * att * rel * v * 0.3;
  }
}

// белый шум уровня db (дБFS) и сетевой фон 50 Гц уровня humDb
export function addNoise(out, sr, db, humDb) {
  const a = Math.pow(10, db / 20), h = Math.pow(10, humDb / 20);
  for (let i = 0; i < out.length; i++) out[i] += a * gauss() + h * Math.sin((2 * Math.PI * 50 * i) / sr);
}

// мелодия: [[midi, начало в секундах, громкость], …]; pedal — ноты звучат 1,6 с, иначе гасятся через 60 мс после следующей
export function melody(sr, seconds, seq, { pedal = false } = {}) {
  const sig = new Float32Array(Math.floor(sr * seconds));
  seq.forEach(([m, t, a], i) => {
    const next = seq[i + 1] ? seq[i + 1][1] : t + 0.9;
    addPiano(sig, sr, t, m, a, pedal ? 1.6 : next - t + 0.06);
  });
  return sig;
}

// Прогоняет сигнал через детектор кадрами по ~16,7 мс (как requestAnimationFrame), окно 4096 отсчётов.
export function listen(sig, sr, lowMidi, highMidi, gateDb = -50) {
  const events = [];
  let now = 0;
  const L = new PitchListener(sr, 4096, (type, d) => { if (type === 'note') events.push({ t: now, ...d }); });
  L.gateDb = gateDb;
  L.setRange(lowMidi, highMidi);
  const buf = new Float32Array(4096), step = Math.round(sr / 60);
  for (let end = 4096; end <= sig.length; end += step) {
    buf.set(sig.subarray(end - 4096, end));
    now = (end / sr) * 1000;
    L.process(buf, now);
  }
  return events;
}
