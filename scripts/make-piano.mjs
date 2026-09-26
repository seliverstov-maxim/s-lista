// Звук рояля (sounds/piano/): 25 записей C1–C7 через малую терцию из Salamander Grand Piano V3
// (Alexander Holm, CC BY 3.0, https://archive.org/details/SalamanderGrandPianoV3), слой громкости 10 из 16.
// Остальные ноты приложение играет теми же записями на полтона выше или ниже.
//
// Обработка каждой записи:
//   • один канал — правый микрофон пары AB для всех нот: сумма двух микрофонов глушит часть обертонов
//     (у ля первой октавы — даже основной тон), а смена микрофона между соседними записями меняла бы тембр;
//     у правого основной тон полный во всём диапазоне от C3, у левого местами проседает (C4 — на 13 дБ);
//   • начало — за 2 мс до удара, тишина перед ним срезана;
//   • длина по высоте: до A2 — 3 с, до A3 — 2,5 с, до A4 — 2 с, выше — 1,5 с (верх и у рояля гаснет быстро),
//     последние 40 % — затухание;
//   • громкость выровнена по первым 0,2 с после удара (−20 дБFS), пик не выше −1 дБFS;
//   • MP3 моно 64 кбит/с, 44,1 кГц.
//
//   curl -LO https://archive.org/download/SalamanderGrandPianoV3/SalamanderGrandPianoV3_OggVorbis.tar.bz2
//   tar -xjf SalamanderGrandPianoV3_OggVorbis.tar.bz2
//   node scripts/make-piano.mjs SalamanderGrandPianoV3_OggVorbis/ogg
//
// Нужен ffmpeg с кодеком libmp3lame.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'sounds', 'piano');
const SR = 44100;
const NAMES = ['C', 'D#', 'F#', 'A'];

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error('Укажите каталог с записями Salamander (…/SalamanderGrandPianoV3_OggVorbis/ogg) — см. начало скрипта.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const decode = (file) => {
  const b = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ar', String(SR), '-ac', '2', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};

let total = 0;
for (let midi = 24; midi <= 96; midi += 3) {
  const name = NAMES[((midi - 24) / 3) % 4], oct = Math.floor(midi / 12) - 1;
  const src = join(dir, `${name}${oct}v10.ogg`);
  const x = decode(src);
  const ch = 1; // правый канал
  const s = new Float32Array(x.length / 2);
  for (let i = 0; i < s.length; i++) s[i] = x[2 * i + ch];
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  let on = 0;
  while (on < s.length && Math.abs(s[on]) < peak * 0.05) on++;
  const start = Math.max(0, on - Math.round(0.002 * SR));
  let sum = 0;
  const n = Math.round(0.2 * SR);
  for (let i = on; i < on + n; i++) sum += s[i] ** 2;
  const gain = Math.min(0.1 / Math.sqrt(sum / n), 0.89 / peak);
  const len = midi <= 45 ? 3 : midi <= 57 ? 2.5 : midi <= 69 ? 2 : 1.5;
  const fade = len * 0.4;
  const out = join(OUT, `${name.replace('#', 's')}${oct}.mp3`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src,
    '-af', `pan=mono|c0=c${ch},atrim=start=${(start / SR).toFixed(5)},asetpts=PTS-STARTPTS,volume=${gain.toFixed(4)},afade=t=out:st=${(len - fade).toFixed(2)}:d=${fade.toFixed(2)}`,
    '-t', String(len), '-ar', String(SR), '-codec:a', 'libmp3lame', '-b:a', '64k', out]);
  const size = statSync(out).size;
  total += size;
  console.log(`${relative(root, out).padEnd(22)} ${(size / 1024).toFixed(1).padStart(5)} КБ  ${len} с  усиление ${(20 * Math.log10(gain)).toFixed(1)} дБ`);
}
console.log(`Итого ${(total / 1024).toFixed(0)} КБ.`);
