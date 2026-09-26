// Тесты распознавания на синтезированном звуке. Запуск: npm test
// Эти тесты — страховка при любых правках src/detector.js. Реальное пианино они не заменяют.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPiano, addNoise, melody, listen, noteName, reseed, rnd, gauss } from './helpers/synth.mjs';

const MELODY = [[60, 0.8, 0.5], [64, 1.4, 0.5], [64, 2.0, 0.45], [67, 2.6, 0.35], [65, 3.0, 0.5], [72, 3.7, 0.15],
  [48, 4.4, 0.5], [43, 5.1, 0.4], [43, 5.7, 0.4], [55, 6.3, 0.25], [52, 6.8, 0.4], [59, 7.3, 0.3]];
const names = (evs) => evs.map((e) => noteName(e.midi) + (e.via === 'legato' ? '~' : '')).join(' ');

for (const sr of [48000, 44100]) {
  test(`FR-IN-02: каждая клавиша до большой — до четвёртой (C2–C7) распознаётся с одного удара, ${sr} Гц`, () => {
    reseed();
    const bad = [], latencies = [];
    for (let m = 36; m <= 96; m++) {
      const sig = new Float32Array(Math.floor(sr * 1.7));
      addPiano(sig, sr, 0.8, m, 0.3, 0.8);
      addNoise(sig, sr, -72, -62);
      const ev = listen(sig, sr, 36, 96);
      const onsets = ev.filter((e) => e.via === 'onset');
      if (!ev.length || ev[0].midi !== m || onsets.length !== 1) bad.push(`${noteName(m)} → ${names(ev) || 'ничего'}`);
      else latencies.push(ev[0].t - 800);
    }
    assert.deepEqual(bad, [], 'неверно распознаны: ' + bad.join('; '));
    latencies.sort((a, b) => a - b);
    assert.ok(latencies.at(-1) <= 200, `задержка ${latencies.at(-1)} мс > 200 мс`); // NFR-PERF-01
  });
}

// Басовый ключ с тремя линейками снизу доходит до ля контроктавы (FR-RND-02). Диапазон детектора —
// как в приложении: ноты упражнения ±1 полутон (Ля₁…соль¹ → 32…68).
for (const sr of [48000, 44100]) {
  test(`FR-RND-02: басовый ключ, 3 линейки — каждая клавиша от Ля₁ до соль¹ (A1–G4) распознаётся с одного удара, ${sr} Гц`, () => {
    reseed();
    const bad = [];
    for (let m = 33; m <= 67; m++) {
      const sig = new Float32Array(Math.floor(sr * 1.7));
      addPiano(sig, sr, 0.8, m, 0.3, 0.8);
      addNoise(sig, sr, -72, -62);
      const ev = listen(sig, sr, 32, 68);
      const onsets = ev.filter((e) => e.via === 'onset');
      if (!ev.length || ev[0].midi !== m || onsets.length !== 1) bad.push(`${noteName(m)} → ${names(ev) || 'ничего'}`);
    }
    assert.deepEqual(bad, [], 'неверно распознаны: ' + bad.join('; '));
  });
}

test('FR-IN-03: мелодия без педали — все ноты по порядку, включая повторы и тихие', () => {
  reseed();
  const sr = 48000, sig = melody(sr, 8, MELODY);
  addNoise(sig, sr, -72, -62);
  const ev = listen(sig, sr, 41, 79);
  assert.deepEqual(ev.map((e) => e.midi), MELODY.map((n) => n[0]), 'услышано: ' + names(ev));
});

test('FR-CHK-03: с педалью не бывает ложных ошибок — все «удары» распознаны верно, неверное бывает только в легато', () => {
  reseed();
  const sr = 48000, sig = melody(sr, 8, MELODY, { pedal: true });
  addNoise(sig, sr, -72, -62);
  const ev = listen(sig, sr, 41, 79);
  const played = new Set(MELODY.map((n) => n[0]));
  const wrongOnsets = ev.filter((e) => e.via === 'onset' && !played.has(e.midi));
  assert.deepEqual(wrongOnsets, [], 'ложные удары: ' + names(wrongOnsets));
  assert.ok(ev.filter((e) => e.via === 'onset').length >= 6, 'распознано слишком мало нот: ' + names(ev));
});

test('NFR-REL-01: тишина с обычным шумом — ни одной ноты', () => {
  reseed();
  const sr = 48000, sig = new Float32Array(sr * 3);
  addNoise(sig, sr, -60, -55);
  assert.equal(listen(sig, sr, 36, 96).length, 0);
});

test('NFR-REL-01: щелчок (стук по корпусу) — не нота', () => {
  reseed();
  const sr = 48000, sig = new Float32Array(sr * 2);
  addNoise(sig, sr, -72, -62);
  for (let i = 0; i < 1500; i++) sig[24000 + i] += 0.3 * gauss() * Math.exp(-i / 300);
  assert.equal(listen(sig, sr, 41, 79).length, 0);
});

for (const nd of [-52, -46, -40]) {
  test(`NFR-REL-02: фон микрофона ${nd} дБ со всплесками до ${nd + 4} дБ при пороге −50 дБ — ни одной ноты`, () => {
    reseed();
    const sr = 48000, sig = new Float32Array(sr * 6);
    addNoise(sig, sr, nd, nd - 6);
    for (let k = 0; k < 12; k++) {
      const i0 = Math.floor(rnd() * sr * 5.5);
      for (let i = 0; i < 4000; i++) sig[i0 + i] += Math.pow(10, (nd + 4) / 20) * gauss() * Math.sin((Math.PI * i) / 4000);
    }
    const ev = listen(sig, sr, 41, 79, -50);
    assert.equal(ev.length, 0, 'ложные ноты: ' + names(ev));
  });
}

test('NFR-REL-02: мелодия поверх шума −46 дБ — распознано не меньше 6 из 7 нот, лишних нет', () => {
  reseed();
  const sr = 48000;
  const seq = [[60, 0.8, 0.5], [64, 1.4, 0.5], [67, 2.0, 0.35], [65, 2.5, 0.5], [72, 3.2, 0.2], [48, 3.9, 0.5], [55, 4.6, 0.3]];
  const sig = melody(sr, 6, seq);
  addNoise(sig, sr, -46, -52);
  const ev = listen(sig, sr, 41, 79, -50);
  const played = new Set(seq.map((n) => n[0]));
  assert.deepEqual(ev.filter((e) => !played.has(e.midi)), [], 'лишние ноты: ' + names(ev));
  assert.ok(ev.length >= 6, 'распознано слишком мало: ' + names(ev));
});
