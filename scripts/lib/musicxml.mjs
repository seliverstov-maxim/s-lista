// MusicXML → данные пьесы «С листа» (docs/spec-2.0.md: «Данные пьесы», FR-PC-02, FR-TOOL-02).
// Пьеса — одна мелодическая линия: одна партия, один стан, один голос, без аккордов.
// Всё, что приложение не умеет показать, отклоняется с понятной ошибкой;
// оформление, которое не меняет ноты (динамика, штрихи, текст, ключи…), пропускается молча.
import { parseXml, kids, kid, textOf } from './xml.mjs';

const STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const LETTERS = 'CDEFGAB';
const TYPE_LEN = { whole: 1, half: 2, quarter: 4, eighth: 8, '16th': 16 };
const TYPE_NAME = { 1: 'целая', 2: 'половинная', 4: 'четверть', 8: 'восьмая', 16: 'шестнадцатая' };
const TOO_SHORT = new Set(['32nd', '64th', '128th', '256th', '512th', '1024th']);
const TOO_LONG = new Set(['breve', 'long', 'maxima']);
const ACC_MARK = { sharp: 1, flat: -1, natural: 0 };
const BEAM_VALUES = new Set(['begin', 'continue', 'end', 'forward hook', 'backward hook']);
const SHARPS = 'FCGDAEB', FLATS = 'BEADGCF';
const JUMP = 'переход D.C., D.S., сеньо, кода или Fine. Такие переходы не поддерживаются: выпишите нужные такты подряд.';

export const CLEFS = ['treble', 'bass'];
export const CLEF_BOTTOM = { treble: 30, bass: 18 }; // нижняя линия стана — ступень d (ми¹ и соль большой)
export const MAX_LEDGER = 3; // у пьес всегда разрешено 3 добавочные линейки снизу и сверху

const near = (a, b) => Math.abs(a - b) < 1e-6;
// длительность в четвертях: len — вид (1 целая … 16 шестнадцатая), dots — точки
export const durQ = (len, dots = 0) => (4 / len) * (2 - 1 / 2 ** dots);
function fromQuarters(q) {
  for (const len of [1, 2, 4, 8, 16]) for (let dots = 0; dots <= 2; dots++) if (near(durQ(len, dots), q)) return { len, dots };
  return null;
}
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const fmtQ = (q) => (Number.isInteger(q) ? `${q} ${plural(q, 'четверть', 'четверти', 'четвертей')}` : `${String(Math.round(q * 1000) / 1000).replace('.', ',')} четверти`);
export const noteName = (d, acc = 0) => LETTERS[((d % 7) + 7) % 7] + (acc > 0 ? '♯' : acc < 0 ? '♭' : '') + Math.floor(d / 7);

// Сколько добавочных линеек нужно ноте, чтобы она не выходила за последнюю линию (FR-RND-02):
// при 0 — ноты только на стане, при N — крайняя нота стоит на N-й добавочной линейке.
export function ledgerLines(d, clef) {
  const b = CLEF_BOTTOM[clef];
  if (d < b) return Math.ceil((b - d) / 2);
  if (d > b + 8) return Math.ceil((d - b - 8) / 2);
  return 0;
}

// Сдвиг в октавах для версии в ключе clef (FR-PC-02): меньше всего линеек у самой крайней ноты,
// при равенстве — меньше нот за пределами стана, затем меньший сдвиг (при равных по модулю — вниз).
// null — версии нет: трёх линеек не хватает.
export function chooseShift(ds, clef) {
  let best = null;
  for (let k = -7; k <= 7; k++) {
    let max = 0, outside = 0;
    for (const d of ds) {
      const l = ledgerLines(d + 7 * k, clef);
      if (l > max) max = l;
      if (l > 0) outside++;
    }
    if (max > MAX_LEDGER) continue;
    const better = !best || max < best.max || (max === best.max && (outside < best.outside ||
      (outside === best.outside && (Math.abs(k) < Math.abs(best.k) || (Math.abs(k) === Math.abs(best.k) && k < best.k)))));
    if (better) best = { k, max, outside };
  }
  return best ? best.k : null;
}

// Длина группы для автоматической группировки, в четвертях
function beamGroupLength([beats, beatType]) {
  const bar = (beats * 4) / beatType;
  if (beatType === 4) return 1;
  if (beatType === 2) return 2;
  if (beatType === 8) return beats % 3 === 0 && beats > 3 ? 1.5 : bar;
  if (beatType === 16) return beats % 3 === 0 && beats > 3 ? 0.75 : bar;
  return Math.min(bar, 1);
}

// Группировка по долям: подряд идущие восьмые и шестнадцатые внутри одной доли; пауза разрывает группу
function autoBeam(items, time, pickupOffset) {
  const L = beamGroupLength(time);
  const bar = (time[0] * 4) / time[1];
  let pos = pickupOffset, cur = null;
  const groups = [];
  for (const it of items) {
    const len = it.measure ? bar : durQ(it.len, it.dots);
    const g = Math.floor(pos / L + 1e-9);
    const inside = Math.floor((pos + len) / L - 1e-9) === g; // нота не пересекает границу доли
    if (!it.rest && it.len >= 8 && inside) {
      if (cur && cur.g === g) cur.items.push(it);
      else { cur = { g, items: [it] }; groups.push(cur); }
    } else cur = null;
    pos += len;
  }
  for (const gr of groups) if (gr.items.length >= 2) applyBeam(gr.items);
}

function applyBeam(items) {
  items.forEach((it, i) => { it.beam = [i === 0 ? 'begin' : i === items.length - 1 ? 'end' : 'continue']; });
  for (let i = 0; i < items.length;) {
    if (items[i].len < 16) { i++; continue; }
    let j = i;
    while (j + 1 < items.length && items[j + 1].len >= 16) j++;
    if (j > i) for (let k = i; k <= j; k++) items[k].beam[1] = k === i ? 'begin' : k === j ? 'end' : 'continue';
    else items[i].beam[1] = i === 0 ? 'forward hook' : 'backward hook';
    i = j + 1;
  }
}

// Группировка из файла годится, если группы первого уровня — подряд идущие восьмые и короче без пауз
// (begin … continue … end), а второй уровень стоит только у шестнадцатых внутри групп
function beamsValid(items) {
  let group = null;
  const groups = [];
  for (const it of items) {
    const b = it.rest ? null : it.beam && it.beam[0];
    if (it.rest || !b) {
      if (group) return false;
      if (!it.rest && it.beam && it.beam[1]) return false;
      continue;
    }
    if (it.len < 8) return false;
    if (b === 'begin') { if (group) return false; group = [it]; }
    else if (b === 'continue') { if (!group) return false; group.push(it); }
    else if (b === 'end') { if (!group) return false; group.push(it); groups.push(group); group = null; }
    else return false;
  }
  if (group) return false;
  for (const g of groups) {
    let open = false;
    for (const it of g) {
      const b = it.beam[1];
      if (it.len < 16) { if (b || open) return false; continue; }
      if (!b) return false;
      if (b === 'begin') { if (open) return false; open = true; }
      else if (b === 'continue') { if (!open) return false; }
      else if (b === 'end') { if (!open) return false; open = false; }
      else if (open) return false; // крючок внутри открытой группы
    }
    if (open) return false;
  }
  return true;
}

// Знаки ключа для ступени (буквы) при числе знаков fifths
const keyAlter = (letter, fifths) => (fifths > 0 ? (SHARPS.slice(0, fifths).includes(letter) ? 1 : 0) : fifths < 0 ? (FLATS.slice(0, -fifths).includes(letter) ? -1 : 0) : 0);

// Главное: текст MusicXML и метаданные (title, composer, license — перекрывают файл) → { piece, errors, warnings, info }
export function convert(xmlText, meta = {}) {
  const errors = [], warnings = [];
  const err = (m) => { if (!errors.includes(m)) errors.push(m); };
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
  const done = () => ({ piece: null, errors, warnings, info: null });

  let root;
  try { root = parseXml(xmlText); }
  catch (e) { err('Файл не читается как XML: ' + e.message); return done(); }
  if (root.name === 'score-timewise') { err('Файл в варианте score-timewise. Экспортируйте из MuseScore обычный MusicXML (score-partwise).'); return done(); }
  if (root.name !== 'score-partwise') { err(`Это не MusicXML: корневой элемент <${root.name}>, а нужен <score-partwise>.`); return done(); }

  const title = (meta.title || textOf(kid(root, 'work'), 'work-title') || textOf(root, 'movement-title') || '').trim();
  const ident = kid(root, 'identification');
  const creator = kids(ident, 'creator').find((c) => c.attrs.type === 'composer');
  const composer = (meta.composer != null ? meta.composer : creator ? creator.text : '').trim();
  const license = (meta.license || kids(ident, 'rights').map((r) => r.text.trim()).filter(Boolean).join('; ')).trim();
  if (!title) err('Нет названия: в файле нет work-title и movement-title. Укажите его флагом --title "…".');
  if (!license) err('Не указана лицензия: в файле нет <rights>. Укажите её флагом --license "…", например --license "CC0 1.0".');

  const parts = kids(root, 'part');
  if (!parts.length) { err('В файле нет ни одной партии.'); return done(); }
  if (parts.length > 1) err(`В файле ${parts.length} ${plural(parts.length, 'партия', 'партии', 'партий')}. Нужна одна мелодия: оставьте в MuseScore одну партию и экспортируйте снова.`);

  const measureEls = kids(parts[0], 'measure');
  const measures = [];
  const notes = []; // { it, mi } — все ноты по порядку
  const stream = []; // все ноты и паузы по порядку: { it, mi }
  let divisions = null, time = null, key = 0;
  let voice = null, fileHasAccidentals = false, fileHasBeams = false;
  const once = new Set();
  const errOnce = (k, m) => { if (!once.has(k)) { once.add(k); err(m); } };
  const lens = []; // длительность каждого такта в четвертях
  const keys = []; // ключевые знаки в каждом такте
  const times = []; // размер в каждом такте

  measureEls.forEach((mEl, mi) => {
    const num = mEl.attrs.number || String(mi + 1);
    const at = (text) => `Такт ${num}: ${text}`;
    const items = [];
    let q = 0, started = false, broken = false;
    let timeOut = mi === 0, keyOut = mi === 0;
    // нота отклонена: такт дальше не проверяем на полноту — хватит основной ошибки
    const reject = (text) => { err(at(text)); broken = true; };
    const checkSound = (s) => {
      if (s && (s.attrs.dacapo === 'yes' || s.attrs.dalsegno || s.attrs.tocoda || s.attrs.fine || s.attrs.segno || s.attrs.coda)) err(at(JUMP));
    };

    for (const c of mEl.children) {
      if (c.name === 'attributes') {
        const dv = textOf(c, 'divisions');
        if (dv != null) {
          if (Number(dv) > 0) divisions = Number(dv);
          else err(at('неверное значение <divisions>.'));
        }
        const keyEls = kids(c, 'key'), timeEls = kids(c, 'time');
        if ((keyEls.length || timeEls.length) && started) err(at('смена размера или тональности посреди такта. Перенесите её в начало такта.'));
        if (keyEls.length) {
          const k0 = keyEls[0];
          if (kid(k0, 'key-step') || kid(k0, 'key-alter')) err(at('нестандартные ключевые знаки. Поддерживаются только обычные тональности.'));
          else {
            const f = Number(textOf(k0, 'fifths'));
            if (!Number.isInteger(f) || Math.abs(f) > 7) err(at('неверное число ключевых знаков.'));
            else if (f !== key) { key = f; keyOut = true; }
          }
        }
        if (timeEls.length) {
          const t0 = timeEls[0];
          if (kid(t0, 'senza-misura')) { err(at('размер без тактов (senza misura) не поддерживается.')); broken = true; }
          else {
            const b = kids(t0, 'beats').map((e) => e.text.trim()), bt = kids(t0, 'beat-type').map((e) => e.text.trim());
            if (timeEls.length > 1 || b.length !== 1 || bt.length !== 1 || !/^\d+$/.test(b[0]) || !/^\d+$/.test(bt[0]) || +b[0] < 1 || ![1, 2, 4, 8, 16, 32].includes(+bt[0])) {
              err(at(`составной или необычный размер (${b.join('+') || '?'}/${bt.join('+') || '?'}). Поддерживаются простые размеры вида 3/4 или 6/8.`));
              broken = true;
            } else if (!time || time[0] !== +b[0] || time[1] !== +bt[0]) {
              time = [+b[0], +bt[0]];
              timeOut = true;
            }
          }
        }
        const staves = textOf(c, 'staves');
        if (staves != null && Number(staves) > 1) errOnce('staves', `В партии ${staves} ${plural(+staves, 'стан', 'стана', 'станов')} (например, две руки фортепиано). Нужна одна рука: удалите лишний стан в MuseScore и экспортируйте снова.`);
        for (const tr of kids(c, 'transpose')) {
          const ch = Number(textOf(tr, 'chromatic') || 0);
          if (ch % 12 !== 0) errOnce('transpose', 'Партия записана для транспонирующего инструмента (<transpose>). Включите в MuseScore «Концертный строй» и экспортируйте снова.');
        }
      } else if (c.name === 'note') {
        started = true;
        if (kid(c, 'grace')) { err(at('форшлаг. Форшлаги пока не поддерживаются — удалите их в MuseScore.')); continue; }
        if (kid(c, 'cue')) { err(at('мелкие ноты-подсказки (cue). Удалите их в MuseScore.')); continue; }
        if (kid(c, 'chord')) { err(at('аккорд — несколько нот одновременно. Оставьте одну ноту и удалите остальные в MuseScore.')); continue; }
        const v = textOf(c, 'voice') || '1';
        if (voice == null) voice = v;
        else if (v !== voice) errOnce('voice', at('второй голос. Пьеса должна быть одноголосной: удалите второй голос в MuseScore.'));
        if (kid(c, 'unpitched')) { reject('нота без высоты (ударные). Нужна мелодия с обычными нотами.'); continue; }
        if (divisions == null) { reject('нет <divisions> — длительности не прочитать.'); continue; }
        const dur = Number(textOf(c, 'duration'));
        if (!(dur > 0)) { reject('у ноты нет длительности.'); continue; }
        const qLen = dur / divisions;
        q += qLen;
        const tuplet = kid(c, 'time-modification');
        if (tuplet) { reject('триоль или другое нестандартное деление. Пока не поддерживается: замените обычными длительностями.'); continue; }
        const restEl = kid(c, 'rest'), pitchEl = kid(c, 'pitch');
        const barQ = time ? (time[0] * 4) / time[1] : null;
        const typeText = textOf(c, 'type');
        const dots = kids(c, 'dot').length;
        // пауза на весь такт: явная (measure="yes") или без вида длительностью в такт
        if (restEl && (restEl.attrs.measure === 'yes' || (!typeText && barQ && near(qLen, barQ)) || (typeText === 'whole' && !dots && barQ && near(qLen, barQ)))) {
          const it = { rest: true, measure: true };
          items.push(it); stream.push({ it, mi });
          continue;
        }
        let len, nd;
        if (typeText) {
          if (TOO_SHORT.has(typeText)) { reject('тридцать вторые и более короткие длительности не поддерживаются.'); continue; }
          if (TOO_LONG.has(typeText)) { reject('длительность длиннее целой (бревис) не поддерживается.'); continue; }
          if (!TYPE_LEN[typeText]) { reject(`неизвестная длительность «${typeText}».`); continue; }
          if (dots > 2) { reject('больше двух точек у ноты не поддерживается.'); continue; }
          len = TYPE_LEN[typeText]; nd = dots;
          if (!near(durQ(len, nd), qLen)) { reject(`вид ноты (${TYPE_NAME[len]}${nd ? ' с точкой' : ''}) не совпадает с её длительностью в файле.`); continue; }
        } else {
          const f = fromQuarters(qLen);
          if (!f) { reject('длительность ноты не раскладывается на целую, половинную, четверть, восьмую или шестнадцатую с точками.'); continue; }
          len = f.len; nd = f.dots;
        }
        if (restEl) {
          const it = { rest: true, len };
          if (nd) it.dots = nd;
          items.push(it); stream.push({ it, mi });
          continue;
        }
        if (!pitchEl) { reject('нота без высоты.'); continue; }
        const step = textOf(pitchEl, 'step'), octave = Number(textOf(pitchEl, 'octave'));
        const alterText = textOf(pitchEl, 'alter');
        const alter = alterText == null || alterText === '' ? 0 : Number(alterText);
        if (!(step in STEP) || !Number.isInteger(octave)) { reject('нота с неверной высотой.'); continue; }
        if (!Number.isInteger(alter) || Math.abs(alter) > 1) {
          reject(Number.isInteger(alter) ? 'дубль-диез или дубль-бемоль. Пока не поддерживаются: перепишите ноту энгармонически в MuseScore.' : 'четвертитон или другой микрохроматический знак. Не поддерживается.');
          continue;
        }
        let fileMark;
        const accEl = kid(c, 'accidental');
        if (accEl) {
          fileHasAccidentals = true;
          const a = accEl.text.trim();
          if (!(a in ACC_MARK)) { reject(`знак «${a}» (дубль-диез, дубль-бемоль или особый знак) пока не поддерживается. Перепишите ноту энгармонически в MuseScore.`); continue; }
          fileMark = ACC_MARK[a];
        }
        const tieStart = kids(c, 'tie').some((t) => t.attrs.type === 'start') ||
          kids(kid(c, 'notations'), 'tied').some((t) => t.attrs.type === 'start');
        const beam = [];
        for (const b of kids(c, 'beam')) {
          fileHasBeams = true;
          const lvl = Number(b.attrs.number || 1), val = b.text.trim();
          if ((lvl === 1 || lvl === 2) && BEAM_VALUES.has(val)) beam[lvl - 1] = val; // уровни 3+ — только у тридцать вторых
        }
        const it = { d: octave * 7 + STEP[step], acc: alter, len };
        if (nd) it.dots = nd;
        const rec = { it, mi, num, fileMark, tieStart, beam };
        items.push(it); notes.push(rec); stream.push(rec);
      } else if (c.name === 'backup' || c.name === 'forward') {
        err(at('в такте есть второй голос или пропуск (<backup>/<forward>). Оставьте один голос и заполните такт нотами и паузами.'));
        broken = true;
      } else if (c.name === 'barline') {
        if (kid(c, 'repeat')) err(at('знак повтора. Повторы пока не поддерживаются: выпишите повтор нотами или удалите знак в MuseScore.'));
        if (kid(c, 'ending')) err(at('вольта. Вольты пока не поддерживаются: выпишите нужные такты подряд.'));
        if (kid(c, 'segno') || kid(c, 'coda')) err(at(JUMP));
        checkSound(kid(c, 'sound'));
      } else if (c.name === 'direction') {
        for (const dt of kids(c, 'direction-type')) if (kid(dt, 'segno') || kid(dt, 'coda')) err(at(JUMP));
        checkSound(kid(c, 'sound'));
      } else if (c.name === 'sound') {
        checkSound(c);
      }
      // print, harmony, figured-bass, bookmark и прочее оформление пропускаем
    }

    if (mi === 0 && !time) errOnce('notime', 'В начале пьесы нет размера. Задайте размер в MuseScore и экспортируйте снова.');
    const m = {};
    if (timeOut && time) m.time = [...time];
    if (keyOut) m.key = key;
    if (!items.length && !broken) err(at('пустой такт.'));
    else if (time && !broken) {
      const need = (time[0] * 4) / time[1];
      if (near(q, need)) { /* полный такт */ }
      else if (q < need && mi === 0 && measureEls.length > 1) m.pickup = true;
      else if (q < need && mi === measureEls.length - 1) { /* последний такт может быть неполным */ }
      else err(at(`сумма длительностей — ${fmtQ(q)}, а размер ${time[0]}/${time[1]} требует ${fmtQ(need)}. Заполните такт паузами или поправьте ноты.`));
    }
    m.items = items;
    measures.push(m);
    lens.push(q); keys.push(key); times.push(time);
  });

  if (!measureEls.length) err('В партии нет ни одного такта.');
  if (!notes.length && measureEls.length) err('В пьесе нет ни одной ноты.');

  // Если ноты уже отклонены, лиги и группировку не разбираем: выброшенные ноты рвут их,
  // и предупреждения о «нарушенной» группировке только сбивали бы с толку
  const walkFailed = errors.length > 0;
  // лиги: следующая за нотой запись обязана быть нотой той же высоты
  const contAcrossBar = new Set();
  for (let i = 0; i < stream.length && !walkFailed; i++) {
    const r = stream[i];
    if (!r.tieStart) continue;
    const next = stream[i + 1];
    if (next && !next.it.rest && next.it.d === r.it.d && next.it.acc === r.it.acc) {
      r.it.tie = true;
      if (next.mi !== r.mi) contAcrossBar.add(next.it);
    } else warn(`Такт ${r.num}: лига ведёт не к ноте той же высоты — лига не учтена.`);
  }

  // знаки альтерации: из файла, а если в файле их нет совсем — по тональности и правилу «до конца такта»
  if (fileHasAccidentals) {
    for (const r of notes) if (r.fileMark !== undefined) r.it.mark = r.fileMark;
  } else {
    measures.forEach((m, mi) => {
      const state = new Map();
      for (const it of m.items) {
        if (it.rest || contAcrossBar.has(it)) continue; // продолжение лиги через черту — без знака
        const cur = state.has(it.d) ? state.get(it.d) : keyAlter(LETTERS[it.d % 7], keys[mi]);
        if (it.acc !== cur) { it.mark = it.acc; state.set(it.d, it.acc); }
      }
    });
  }

  // группировка: из файла (с проверкой) или по долям
  const beamOf = new Map(notes.map((r) => [r.it, r.beam]));
  measures.forEach((m, mi) => {
    const t = times[mi];
    if (walkFailed) return;
    if (fileHasBeams) {
      for (const it of m.items) if (!it.rest && beamOf.get(it).length) it.beam = beamOf.get(it).slice();
      if (beamsValid(m.items)) return;
      for (const it of m.items) delete it.beam;
      warn(`Такт ${measureEls[mi].attrs.number || mi + 1}: группировка нот в файле нарушена — построена заново по долям.`);
    }
    if (t) autoBeam(m.items, t, m.pickup ? (t[0] * 4) / t[1] - lens[mi] : 0);
  });

  // версии для двух ключей
  const shift = {};
  const ds = notes.map((r) => r.it.d);
  if (ds.length) {
    for (const clef of CLEFS) {
      const k = chooseShift(ds, clef);
      if (k != null) shift[clef] = k;
    }
    if (!Object.keys(shift).length) {
      const lo = notes.reduce((a, r) => (r.it.d < a.it.d ? r : a)), hi = notes.reduce((a, r) => (r.it.d > a.it.d ? r : a));
      err(`Мелодия не помещается ни в скрипичный, ни в басовый ключ даже с тремя добавочными линейками: от ${noteName(lo.it.d, lo.it.acc)} до ${noteName(hi.it.d, hi.it.acc)}. Нужна мелодия поуже: в один ключ с тремя линейками помещается чуть меньше трёх октав, например от фа малой до ми третьей.`);
    }
  }

  if (errors.length) return done();

  // порядок полей — как в спецификации; поля по умолчанию не пишем
  const canon = (it) => {
    if (it.rest) return it.measure ? { rest: true, measure: true } : clean({ rest: true, len: it.len, dots: it.dots });
    return clean({ d: it.d, acc: it.acc, len: it.len, dots: it.dots, mark: it.mark, tie: it.tie, beam: it.beam && it.beam.length ? it.beam : undefined });
  };
  const piece = {
    title, composer, license,
    shift,
    measures: measures.map((m) => clean({ time: m.time, key: m.key, pickup: m.pickup, items: m.items.map(canon) })),
  };
  const lo = Math.min(...ds), hi = Math.max(...ds);
  return { piece, errors, warnings, info: { measures: measures.length, notes: notes.length, lo, hi } };
}

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== false && !(k === 'dots' && !v)) out[k] = v;
  return out;
}
