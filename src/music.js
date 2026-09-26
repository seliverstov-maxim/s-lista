/* ---------- Музыка: теория, случайные ноты, партитура, нотный движок ---------- */
// Чистые функции без DOM. При сборке встраиваются в страницу (вставка MUSIC в src/app.html),
// в тестах загружаются через tests/helpers/load-music.mjs.
// Нужен GLYPH — контуры знаков Bravura из src/glyphs.json: { имя: { d, adv } }, координаты в межстрочных интервалах.

/* ---- Теория ---- */
const STEP = [0, 2, 4, 5, 7, 9, 11];
const SOLF = ['до', 'ре', 'ми', 'фа', 'соль', 'ля', 'си'];
const LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const OCT_GEN = ['субконтроктавы', 'контроктавы', 'большой октавы', 'малой октавы', 'первой октавы', 'второй октавы', 'третьей октавы', 'четвёртой октавы', 'пятой октавы'];
const SUP = ['₂', '₁', '', '', '¹', '²', '³', '⁴', '⁵'];
const CLEFS = {
  treble: { bottomD: 30, name: 'Скрипичный', hand: 'правая рука' },
  bass: { bottomD: 18, name: 'Басовый', hand: 'левая рука' },
};
const midiOf = (d, acc = 0) => (Math.floor(d / 7) + 1) * 12 + STEP[d % 7] + acc;
const accMark = (acc) => (acc > 0 ? '♯' : acc < 0 ? '♭' : '');

function shortName(d, acc = 0, naming = 'solfege') {
  const oct = Math.floor(d / 7), li = d % 7;
  if (naming === 'letters') return LET[li] + accMark(acc) + oct;
  let n = SOLF[li];
  if (oct <= 2) n = n[0].toUpperCase() + n.slice(1);
  return n + accMark(acc) + (SUP[oct] || '');
}
function fullName(d, acc = 0, naming = 'solfege') {
  const oct = Math.floor(d / 7), li = d % 7;
  if (naming === 'letters') return LET[li] + accMark(acc) + oct;
  return SOLF[li] + (acc > 0 ? '-диез' : acc < 0 ? '-бемоль' : '') + ' ' + OCT_GEN[oct];
}
function spellMidi(midi, preferFlat) {
  const pc = ((midi % 12) + 12) % 12, oct = Math.floor(midi / 12) - 1;
  const WHITE = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
  if (pc in WHITE) return { d: oct * 7 + WHITE[pc], acc: 0 };
  if (preferFlat) return { d: oct * 7 + WHITE[pc + 1], acc: -1 };
  return { d: oct * 7 + WHITE[pc - 1], acc: 1 };
}

/* ---- Диапазон по добавочным линейкам (FR-RND-02) ---- */
// Крайняя нота стоит на последней разрешённой линии: при 0 — на крайней линии стана.
function ledgerRange(clef, below, above) {
  const b = CLEFS[clef].bottomD;
  return { lo: b - 2 * below, hi: b + 8 + 2 * above };
}
// сколько линеек нужно разрешить, чтобы нота d попала в диапазон
function linesNeeded(clef, d) {
  const b = CLEFS[clef].bottomD;
  if (d < b) return Math.ceil((b - d) / 2);
  if (d > b + 8) return Math.ceil((d - b - 8) / 2);
  return 0;
}

/* ---- Случайные ноты (FR-RND-03) ---- */
function candidates(clef, below, above) {
  const r = ledgerRange(clef, below, above), out = [];
  for (let d = r.lo; d <= r.hi; d++) out.push({ d, acc: 0, midi: midiOf(d), clef, w: 1 });
  return out;
}
// Одна клавиша не повторяется подряд: на этом держится защита от отголосков (ADR-04).
function pickNote(prev, cands, weight, rnd = Math.random) {
  let list = cands.filter((c) => !prev || c.midi !== prev.midi);
  if (!list.length) list = cands;
  const ws = list.map((c) => c.w * (weight ? weight(c) : 1));
  let r = rnd() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

/* ---- Отголоски с микрофона (FR-CHK-03, FR-PC-07) ---- */
// Звук с микрофона той же клавиши, что только что засчитана (lastDone), — возможно, отголосок или двойной удар молоточка.
// Как ошибку его не считаем 1,5 с. Как верный ответ (в пьесе нота может повторяться подряд) — только уверенный удар
// не раньше чем через 250 мс. MIDI и экранную клавиатуру это правило не касается.
const ECHO_MS = 1500, REPEAT_MS = 250;
function isEcho(midi, via, strong, lastDone, now, hit) {
  if ((via !== 'onset' && via !== 'legato') || !lastDone || lastDone.midi !== midi) return false;
  if (hit) return via !== 'onset' || !strong || now - lastDone.t < REPEAT_MS;
  return now - lastDone.t < ECHO_MS;
}

/* ---- Настройки (FR-RND-04) ---- */
const SETTINGS_DEFAULTS = {
  clef: 'treble', below: 1, above: 1, adaptive: true,
  naming: 'solfege', octave: true, gateDb: -50, calibrated: false, showKeys: true, keySound: true, last: null,
};
// Настройки версии 1 → поля версии 2. Большой стан становится скрипичным ключом,
// диапазон — наименьшим числом линеек, при котором старая граница попадает в диапазон (не больше 3).
function migrateSettings(old) {
  if (!old || typeof old !== 'object') return {};
  const out = {};
  for (const k of ['adaptive', 'naming', 'octave', 'gateDb', 'calibrated', 'showKeys', 'keySound']) if (old[k] != null) out[k] = old[k];
  if (out.gateDb == null && typeof old.sens === 'number') out.gateDb = -30 - old.sens; // шкала ползунка до калибровки
  out.clef = old.clef === 'bass' ? 'bass' : 'treble';
  if (typeof old.lo === 'number' && typeof old.hi === 'number') {
    const clamp = (v) => Math.max(0, Math.min(3, v));
    out.below = clamp(linesNeeded(out.clef, Math.min(old.lo, old.hi)));
    out.above = clamp(linesNeeded(out.clef, Math.max(old.lo, old.hi)));
  }
  out.last = { mode: 'random' };
  return out;
}

/* ---- Длительности и партитура ---- */
const TPQ = 48; // тиков на четверть: хватает для шестнадцатой с двумя точками
const durOf = (len, dots = 0) => Math.round(((4 * TPQ) / len) * (2 - Math.pow(0.5, dots || 0)));
const sameTime = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
// длина доли: по ней разрешено переносить такт и строится группировка
function beatOf(time) {
  if (!time) return TPQ;
  const [n, t] = time;
  if (t === 8 && n % 3 === 0 && n > 3) return 3 * durOf(8);
  if (t === 8) return n * durOf(8);
  return durOf(t);
}

function makeNote(f) {
  return Object.assign({
    type: 'note', acc: 0, len: 4, dots: 0, dur: TPQ, start: 0, mark: null, tie: false, tieFrom: false,
    head: null, tieTo: null, beam: null, stem: null, group: null, status: 'todo', errors: 0, hinted: false, startAt: 0, idx: -1,
  }, f);
}

// Пьеса (pieces/<id>.json) → партитура в выбранном ключе.
// Ноты-продолжения лиги (tieFrom) не играются отдельно: их цвет берётся у первой ноты лиги (head).
function buildScore(piece, clef) {
  const shift = 7 * ((piece.shift && piece.shift[clef]) || 0);
  let time = null, key = 0, open = null;
  const measures = [], notes = [];
  piece.measures.forEach((m, mi) => {
    const prevKey = key;
    const showTime = !!m.time && (mi === 0 || !sameTime(m.time, time));
    const showKey = m.key != null && mi > 0 && m.key !== key;
    if (m.time) time = m.time;
    if (m.key != null) key = m.key;
    const full = time ? time[0] * durOf(time[1]) : 4 * TPQ;
    let t = 0;
    const items = m.items.map((it) => {
      if (it.rest) {
        const dur = it.measure ? full : durOf(it.len, it.dots);
        const r = { type: 'rest', len: it.measure ? 1 : it.len, dots: it.measure ? 0 : it.dots || 0, dur, start: t, measure: !!it.measure };
        t += dur;
        open = null;
        return r;
      }
      const d = it.d + shift, acc = it.acc || 0;
      const n = makeNote({ d, acc, midi: midiOf(d, acc), clef, len: it.len, dots: it.dots || 0, dur: durOf(it.len, it.dots), start: t,
        mark: it.mark == null ? null : it.mark, tie: !!it.tie, beam: it.beam || null });
      if (open && open.midi === n.midi) { n.tieFrom = true; n.head = open.head || open; open.tieTo = n; }
      open = n.tie ? n : null;
      if (!n.tieFrom) { n.idx = notes.length; notes.push(n); }
      t += n.dur;
      return n;
    });
    measures.push({ time, key, prevKey, showTime, showKey, full, pickup: !!m.pickup, items });
  });
  const score = { clef, measures, notes, title: piece.title };
  prepareScore(score);
  return score;
}

// Случайные ноты → партитура одной строки: четверти, по 4 в такте, размер не пишется.
function randomScore(list, clef) {
  const notes = list.map((c, i) => makeNote({ d: c.d, acc: c.acc || 0, midi: midiOf(c.d, c.acc || 0), clef, idx: i }));
  const measures = [];
  for (let i = 0; i < notes.length; i += 4) {
    const items = notes.slice(i, i + 4);
    items.forEach((n, j) => { n.start = j * TPQ; });
    measures.push({ time: null, key: 0, prevKey: 0, showTime: false, showKey: false, full: 4 * TPQ, pickup: false, items });
  }
  const score = { clef, measures, notes, random: true };
  prepareScore(score);
  return score;
}
const allNotes = (score) => score.measures.flatMap((m) => m.items.filter((it) => it.type === 'note'));

/* ---- Штили и рёбра ---- */
const SP = 10;          // межстрочный интервал в единицах SVG
const STEM = 3.5 * SP;  // длина штиля
const BEAM_T = 0.5 * SP, BEAM_GAP = 0.75 * SP;
// y ноты относительно нижней линии стана (вниз — плюс)
const yRel = (score, d) => ((CLEFS[score.clef].bottomD - d) * SP) / 2;

// Направления и длины штилей, геометрия рёбер. Считается один раз на партитуру:
// высоты не зависят от ширины строки, поэтому высота рисунка одинакова во всех строках.
function prepareScore(score) {
  const yMid = -2 * SP;
  for (const m of score.measures) {
    let group = null;
    const close = () => { if (group && group.length > 1) beamGroup(score, group); else if (group) group.forEach((n) => { n.group = null; }); group = null; };
    for (const it of m.items) {
      if (it.type !== 'note') { close(); continue; }
      const st = it.beam && it.beam[0];
      if (it.len >= 8 && st === 'begin') { close(); group = [it]; }
      else if (it.len >= 8 && group && (st === 'continue' || st === 'end')) { group.push(it); if (st === 'end') close(); }
      else close();
    }
    close();
    for (const it of m.items) {
      if (it.type !== 'note' || it.group) continue;
      if (it.len <= 1) { it.stem = null; continue; }
      const y = yRel(score, it.d), up = it.d < CLEFS[score.clef].bottomD + 4;
      it.stem = { up, end: up ? Math.min(y - STEM, yMid) : Math.max(y + STEM, yMid), beamed: false };
    }
  }
}
function beamGroup(score, g) {
  const mid = CLEFS[score.clef].bottomD + 4, yMid = -2 * SP;
  // направление решает нота, дальше всех от средней линии; поровну — штили вниз
  let far = 0;
  for (const n of g) { const dist = n.d - mid; if (Math.abs(dist) > Math.abs(far) || (Math.abs(dist) === Math.abs(far) && dist > far)) far = dist; }
  const up = far < 0;
  const ys = g.map((n) => yRel(score, n.d));
  const xs = [0];
  for (let i = 1; i < g.length; i++) xs.push(xs[i - 1] + spaceFor(g[i - 1].dur));
  const span = xs[xs.length - 1] || 1;
  const levels = g.some((n) => n.len >= 16) ? 2 : 1;
  const minLen = STEM - 0.5 * SP + (levels - 1) * BEAM_GAP;
  // наклон — половина разницы крайних нот, не больше интервала; если внутренняя нота выступает — ребро ровное
  let rise = Math.max(-SP, Math.min(SP, (ys[ys.length - 1] - ys[0]) / 2));
  const inner = ys.slice(1, -1);
  if (inner.length && (up ? Math.min(...inner) < Math.min(ys[0], ys[ys.length - 1]) : Math.max(...inner) > Math.max(ys[0], ys[ys.length - 1]))) rise = 0;
  let c;
  if (up) {
    c = Math.min(...g.map((n, i) => ys[i] - minLen - (rise * xs[i]) / span));
    c = Math.min(c, yMid - Math.max(0, rise)); // ребро не ниже средней линии
  } else {
    c = Math.max(...g.map((n, i) => ys[i] + minLen - (rise * xs[i]) / span));
    c = Math.max(c, yMid - Math.min(0, rise)); // и не выше её
  }
  const G = { up, y0: c, y1: c + rise, notes: g, levels };
  g.forEach((n, i) => { n.group = G; n.stem = { up, end: c + (rise * xs[i]) / span, beamed: true }; });
}

/* ---- Раскладка по строкам (FR-PC-05) ---- */
const PAD_L = 1.6 * SP;   // от тактовой черты до первого знака такта
const HEAD_END = 0.6 * SP; // от ключа, ключевых знаков и размера до такта
const RIGHT = 0.8 * SP;    // поле справа: строка кончается тактовой чертой, а не краем рисунка
const ACC_GLYPH = { '-1': 'accidentalFlat', 0: 'accidentalNatural', 1: 'accidentalSharp' };
const HEAD_GLYPH = (len) => (len <= 1 ? 'noteheadWhole' : len === 2 ? 'noteheadHalf' : 'noteheadBlack');
const REST_GLYPH = (r) => (r.measure || r.len <= 1 ? 'restWhole' : r.len === 2 ? 'restHalf' : r.len === 4 ? 'restQuarter' : r.len === 8 ? 'rest8th' : 'rest16th');
// расстояние между центрами соседних нот: растёт медленнее длительности, как в печатных нотах
const spaceFor = (dur) => (2.3 + 2.1 * Math.pow(dur / TPQ, 0.6)) * SP;
const endSpring = (it) => Math.max(spaceFor(it.dur) - 1.4 * SP, 2 * SP);
const headW = (it) => GLYPH[it.type === 'note' ? HEAD_GLYPH(it.len) : REST_GLYPH(it)].adv * SP;
const leadOf = (it) => (it.type === 'note' && it.mark != null ? (GLYPH[ACC_GLYPH[it.mark]].adv + 0.45) * SP : 0);
const dotsW = (it) => (it.dots ? (0.35 + 0.6 * it.dots) * SP : 0);

const KEY_SHARPS = [38, 35, 39, 36, 33, 37, 34]; // скрипичный: фа² до² соль² ре² ля¹ ми² си¹
const KEY_FLATS = [34, 37, 33, 36, 32, 35, 31];  // си¹ ми² ля¹ ре² соль¹ до² фа¹; у басового всё на две октавы ниже
function keyPositions(clef, fifths) {
  const sh = clef === 'bass' ? -14 : 0;
  return (fifths > 0 ? KEY_SHARPS : KEY_FLATS).slice(0, Math.abs(fifths)).map((d) => d + sh);
}
// ключевые знаки, которые отменяются при смене тональности (рисуются бекарами)
function cancelledKey(clef, from, to) {
  if (!from) return [];
  if (to && Math.sign(to) === Math.sign(from) && Math.abs(to) >= Math.abs(from)) return [];
  const all = keyPositions(clef, from);
  return to && Math.sign(to) === Math.sign(from) ? all.slice(Math.abs(to)) : all;
}
const keyStep = (fifths) => (GLYPH[fifths > 0 ? 'accidentalSharp' : 'accidentalFlat'].adv + 0.12) * SP;
const keyWidth = (fifths) => (fifths ? Math.abs(fifths) * keyStep(fifths) : 0);
const digitsW = (v) => [...String(v)].reduce((a, ch) => a + GLYPH['timeSig' + ch].adv, 0) * SP;
const timeWidth = (time) => (time ? Math.max(digitsW(time[0]), digitsW(time[1])) : 0);
const clefW = (clef) => GLYPH[clef === 'bass' ? 'fClef' : 'gClef'].adv * SP;

function headerWidth(clef, key, time) {
  let x = 1.5 * SP + clefW(clef);
  if (key) x += 1.0 * SP + keyWidth(key);
  if (time) x += 1.0 * SP + timeWidth(time);
  return x + HEAD_END;
}
// смена тональности или размера в начале такта посреди строки
function changeWidth(clef, m) {
  let w = 0;
  if (m.showKey) {
    const nat = cancelledKey(clef, m.prevKey, m.key).length;
    if (nat) w += nat * (GLYPH.accidentalNatural.adv + 0.12) * SP + 0.3 * SP;
    w += keyWidth(m.key);
  }
  if (m.showTime) w += (w ? 0.8 * SP : 0) + timeWidth(m.time);
  return w ? w + 0.8 * SP : 0;
}
// Ширина части такта: fixed не растягивается, spring растягивается при выключке строки.
function partMetrics(clef, m, from, to, withChange) {
  let fixed = (withChange ? changeWidth(clef, m) : 0) + PAD_L + headW(m.items[from]) / 2, spring = 0;
  for (let i = from; i < to; i++) {
    const it = m.items[i];
    fixed += leadOf(it) + dotsW(it);
    spring += i < to - 1 ? spaceFor(it.dur) : endSpring(it);
  }
  return { fixed, spring };
}
// Где можно перенести такт на следующую строку: strict 2 — на границе доли вне группы восьмых,
// 1 — где угодно вне группы, 0 — где угодно.
function splitOk(m, k, strict) {
  const prev = m.items[k - 1], it = m.items[k];
  const inBeam = prev.type === 'note' && prev.group && it.type === 'note' && it.group === prev.group;
  if (inBeam) return strict === 0;
  return strict === 2 ? it.start % beatOf(m.time) === 0 : true;
}
// Точка переноса части такта, начатой с from: первая часть должна влезть (fitFirst).
// Если после переноса остаток влезает в одну строку (fitRest) — берём перенос, при котором строки заполнены ровнее,
// иначе — самую длинную первую часть. -1 — перенести нельзя.
function chooseSplit(m, from, fitFirst, fitRest, fill, minStrict = 0) {
  for (let strict = 2; strict >= minStrict; strict--) {
    const ok = [];
    for (let j = from + 1; j < m.items.length; j++) if (splitOk(m, j, strict) && fitFirst(j)) ok.push(j);
    if (!ok.length) continue;
    const two = ok.filter(fitRest).reverse(); // при равенстве — длиннее первая часть
    if (two.length) return two.reduce((best, j) => (fill(j) < fill(best) - 1e-6 ? j : best));
    return ok[ok.length - 1];
  }
  return -1;
}
const F_MIN = 0.85; // строку можно сжать до 85 %, чтобы не переносить такт, которому чуть не хватает места

// Раскладка партитуры по строкам ширины W: целые такты, если помещаются;
// такт шире строки переносится по границе доли. Строка начинается с ключа и ключевых знаков,
// размер — в первой строке и при смене.
function layoutRows(score, W0) {
  const W = W0 - RIGHT, rows = [];
  const fits = (w) => w.fixed + w.spring * F_MIN <= W + 0.01;
  const sum = (a, b) => ({ fixed: a.fixed + b.fixed, spring: a.spring + b.spring });
  const part = (m, from, to, ch) => partMetrics(score.clef, m, from, to, ch);
  const fillOf = (w) => (w.fixed + w.spring) / W;
  let row = null;
  const open = (m, time) => { row = { parts: [], key: m.key, time, fixed: headerWidth(score.clef, m.key, time), spring: 0 }; rows.push(row); };
  const add = (mi, from, to, w) => { row.parts.push({ mi, from, to }); row.fixed += w.fixed; row.spring += w.spring; };
  score.measures.forEach((m, mi) => {
    const n = m.items.length;
    if (!n) return;
    const ch = m.showKey || m.showTime;
    const cont = { fixed: headerWidth(score.clef, m.key, null), spring: 0 };
    const time = m.showTime || mi === 0 ? m.time : null;
    const fresh = { fixed: headerWidth(score.clef, m.key, time), spring: 0 };
    let from = 0;
    if (row && row.parts.length) {
      const whole = part(m, 0, n, ch);
      if (fits(sum(row, whole))) { add(mi, 0, n, whole); return; }
      // такт не влезет и в новую строку — начало такта дописываем в текущую
      if (!fits(sum(fresh, part(m, 0, n, false)))) {
        const k = chooseSplit(m, 0, (j) => fits(sum(row, part(m, 0, j, ch))), (j) => fits(sum(cont, part(m, j, n, false))),
          (j) => Math.max(fillOf(sum(row, part(m, 0, j, ch))), fillOf(sum(cont, part(m, j, n, false)))), 2);
        if (k > 0) { add(mi, 0, k, part(m, 0, k, ch)); from = k; open(m, null); }
      }
    }
    if (from === 0) open(m, time);
    for (;;) {
      const w = part(m, from, n, false);
      if (fits(sum(row, w)) || from === n - 1) { add(mi, from, n, w); break; }
      const base = { fixed: row.fixed, spring: row.spring };
      let k = chooseSplit(m, from, (j) => fits(sum(base, part(m, from, j, false))), (j) => fits(sum(cont, part(m, j, n, false))),
        (j) => Math.max(fillOf(sum(base, part(m, from, j, false))), fillOf(sum(cont, part(m, j, n, false)))));
      if (k < 0) k = from + 1; // даже одна доля не влезает — строка сожмётся (см. rowFactor)
      add(mi, from, k, part(m, from, k, false));
      from = k;
      open(m, null);
    }
  });
  rows.forEach((r, i) => {
    r.last = i === rows.length - 1 && !score.random; // строку случайных нот растягиваем всегда
    const ns = r.parts.flatMap((p) => score.measures[p.mi].items.slice(p.from, p.to)).filter((it) => it.type === 'note' && !it.tieFrom);
    r.noteFrom = ns.length ? ns[0].idx : -1;
    r.noteTo = ns.length ? ns[ns.length - 1].idx + 1 : -1;
  });
  return rows;
}
// Растяжение пружин, чтобы строка заняла всю ширину, — не больше чем в 1,35 раза: полупустая строка
// остаётся короче, и стан кончается тактовой чертой. Строки видны по одной, поэтому разная длина не заметна.
const F_MAX = 1.35;
function rowFactor(row, W0) {
  if (!row.spring) return 1;
  return Math.max(0.7, Math.min(F_MAX, (W0 - RIGHT - row.fixed) / row.spring));
}
const rowOfNote = (rows, idx) => Math.max(0, rows.findIndex((r) => r.noteFrom <= idx && idx < r.noteTo));

// Положение всех знаков строки при растяжении f.
function placeRow(score, row, f) {
  const x = new Map(), bars = [], changes = [];
  let cx = headerWidth(score.clef, row.key, row.time);
  row.parts.forEach((p, pi) => {
    const m = score.measures[p.mi];
    const withChange = pi > 0 && p.from === 0 && (m.showKey || m.showTime);
    if (withChange) { changes.push({ x: cx, m }); cx += changeWidth(score.clef, m); }
    const start = cx;
    cx += PAD_L;
    let c = 0;
    for (let i = p.from; i < p.to; i++) {
      const it = m.items[i];
      if (i === p.from) c = cx + leadOf(it) + headW(it) / 2;
      else { const prev = m.items[i - 1]; c += spaceFor(prev.dur) * f + dotsW(prev) + leadOf(it); }
      x.set(it, c);
    }
    const last = m.items[p.to - 1];
    cx = c + dotsW(last) + endSpring(last) * f;
    if (p.to - p.from === 1 && last.type === 'rest' && last.measure) x.set(last, (start + cx) / 2); // пауза на весь такт — посередине
    if (p.to === m.items.length) bars.push({ x: cx, final: p.mi === score.measures.length - 1 });
  });
  return { x, bars, changes, endX: cx };
}

/* ---- Высота рисунка ---- */
// Границы рисунка по всем нотам партитуры (плюс место для подсказки над нотой),
// чтобы стан не прыгал от строки к строке.
function scoreVBox(score, notes = allNotes(score)) {
  let top = -4 * SP, bottom = 0;
  for (const n of notes) {
    const y = yRel(score, n.d);
    let t = y - 0.7 * SP, b = y + 0.7 * SP;
    if (n.mark != null || n.acc) { t = Math.min(t, y - 1.9 * SP); b = Math.max(b, y + 1.5 * SP); }
    if (n.stem) { t = Math.min(t, n.stem.end - 0.3 * SP); b = Math.max(b, n.stem.end + 0.3 * SP); }
    if (n.tie || n.tieFrom) { t = Math.min(t, y - 1.8 * SP); b = Math.max(b, y + 1.8 * SP); }
    top = Math.min(top, t - 2.2 * SP); // подпись-подсказка над нотой
    bottom = Math.max(bottom, b);
  }
  return { top: Math.min(top, -6.4 * SP), bottom: Math.max(bottom + 0.6 * SP, 2 * SP) };
}

/* ---- Отрисовка ---- */
const f1 = (v) => Math.round(v * 10) / 10;
function glyph(name, x, y, cls, scale = SP) {
  return `<path class="${cls}" transform="translate(${f1(x)},${f1(y)}) scale(${scale})" d="${GLYPH[name].d}"/>`;
}
const rect = (x, y, w, h, cls) => `<rect class="${cls}" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}"/>`;
const statusOf = (n) => (n.tieFrom ? n.head.status : n.status);
const clsOf = (n) => { const s = statusOf(n); return s === 'ok' ? 'g-ok' : s === 'miss' ? 'g-miss' : 'g-ink'; };

// Головка, добавочные линейки, знак альтерации и точки. Штили — отдельно.
function noteHeadSVG(score, n, x, Y, cls) {
  const b = CLEFS[score.clef].bottomD, y = Y(n.d), hw = headW(n) / 2;
  const lw = hw * 2 + 0.8 * SP;
  let s = '';
  for (let p = b - 2; p >= n.d; p -= 2) s += rect(x - lw / 2, Y(p) - 0.8, lw, 1.6, cls + ' lg');
  for (let p = b + 10; p <= n.d; p += 2) s += rect(x - lw / 2, Y(p) - 0.8, lw, 1.6, cls + ' lg');
  if (n.mark != null) {
    const g = ACC_GLYPH[n.mark];
    s += glyph(g, x - hw - 0.32 * SP - GLYPH[g].adv * SP, y, cls);
  }
  s += glyph(HEAD_GLYPH(n.len), x - hw, y, cls);
  if (n.dots) {
    const dy = (n.d - b) % 2 === 0 ? -0.5 * SP : 0; // нота на линейке — точка в промежутке выше
    for (let k = 0; k < n.dots; k++) s += glyph('augmentationDot', x + hw + (0.35 + 0.6 * k) * SP, y + dy, cls);
  }
  return s;
}
// Штиль и флажок ноты без ребра.
function stemSVG(n, x, Y, baseY, cls) {
  if (!n.stem || n.stem.beamed) return '';
  const y = Y(n.d), hw = headW(n) / 2, end = baseY + n.stem.end;
  let s;
  if (n.stem.up) {
    const sx = x + hw - 1.2;
    s = rect(sx, end, 1.2, y - 0.17 * SP - end, cls);
    if (n.len >= 8) s += glyph(n.len >= 16 ? 'flag16thUp' : 'flag8thUp', sx, end - 0.4, cls);
  } else {
    const sx = x - hw;
    s = rect(sx, y + 0.17 * SP, 1.2, end - y - 0.17 * SP, cls);
    if (n.len >= 8) s += glyph(n.len >= 16 ? 'flag16thDown' : 'flag8thDown', sx, end + 1.3, cls);
  }
  return s;
}
// Группа восьмых или шестнадцатых: штили до ребра, основное ребро, второе ребро и «крючки».
function beamSVG(g, pos, Y, baseY) {
  const notes = g.notes.filter((n) => pos.x.has(n));
  if (notes.length < 2) return '';
  const stemX = (n) => (g.up ? pos.x.get(n) + headW(n) / 2 - 1.2 : pos.x.get(n) - headW(n) / 2);
  const xa = stemX(notes[0]), xb = stemX(notes[notes.length - 1]);
  const ya = baseY + g.y0, yb = baseY + g.y1;
  const beamY = (sx) => ya + ((yb - ya) * (sx - xa)) / (xb - xa || 1);
  const allOk = notes.every((n) => statusOf(n) === 'ok');
  const bcls = allOk ? 'g-ok' : 'g-ink';
  const t = g.up ? BEAM_T : -BEAM_T; // толщина ребра — к головкам нот
  const poly = (x1, y1, x2, y2) => `<path class="${bcls}" d="M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}L${f1(x2)} ${f1(y2 + t)}L${f1(x1)} ${f1(y1 + t)}Z"/>`;
  let s = '';
  for (const n of notes) {
    const sx = stemX(n), y = Y(n.d), e = beamY(sx + 0.6);
    s += g.up ? rect(sx, e, 1.2, y - 0.17 * SP - e, clsOf(n)) : rect(sx, y + 0.17 * SP, 1.2, e - y - 0.17 * SP, clsOf(n));
  }
  s += poly(xa, ya, xb + 1.2, beamY(xb + 1.2));
  if (g.levels > 1) {
    const off = g.up ? BEAM_GAP : -BEAM_GAP;
    const at = (sx) => beamY(sx) + off;
    const lv2 = (n) => n.len >= 16;
    const b2 = (n) => (n.beam && n.beam[1]) || null;
    notes.forEach((n, i) => {
      if (!lv2(n)) return;
      const next = notes[i + 1], prev = notes[i - 1];
      const st = b2(n);
      const joinNext = next && lv2(next) && (st ? st === 'begin' || st === 'continue' : true);
      if (joinNext) { const x1 = stemX(n), x2 = stemX(next) + 1.2; s += poly(x1, at(x1), x2, at(x2)); return; }
      const joinedPrev = prev && lv2(prev) && (b2(prev) ? b2(prev) === 'begin' || b2(prev) === 'continue' : true);
      if (joinedPrev) return;
      // одиночная шестнадцатая в группе — короткий «крючок» к соседу
      const fwd = st === 'forward hook' || (st !== 'backward hook' && i < notes.length - 1);
      const x1 = fwd ? stemX(n) : stemX(n) - 1.1 * SP + 1.2, x2 = fwd ? stemX(n) + 1.1 * SP : stemX(n) + 1.2;
      s += poly(x1, at(x1), x2, at(x2));
    });
  }
  return s;
}
function restSVG(r, x, baseY, cls) {
  const g = REST_GLYPH(r), w = GLYPH[g].adv * SP;
  let s = glyph(g, x - w / 2, baseY - (g === 'restWhole' ? 3 : 2) * SP, cls);
  for (let k = 0; k < (r.dots || 0); k++) s += glyph('augmentationDot', x + w / 2 + (0.3 + 0.6 * k) * SP, baseY - 2.5 * SP, cls);
  return s;
}
// Лига: серп от ноты к ноте, с противоположной штилю стороны.
function tieSVG(x1, x2, y, below, cls) {
  if (x2 - x1 < 0.6 * SP) return '';
  const s = below ? 1 : -1, y0 = y + s * 0.55 * SP, h = Math.min(1.1 * SP, 0.25 * SP + 0.12 * (x2 - x1));
  const dx = (x2 - x1) * 0.28;
  return `<path class="${cls}" d="M${f1(x1)} ${f1(y0)}C${f1(x1 + dx)} ${f1(y0 + s * h)} ${f1(x2 - dx)} ${f1(y0 + s * h)} ${f1(x2)} ${f1(y0)}` +
    `C${f1(x2 - dx)} ${f1(y0 + s * (h - 2.2))} ${f1(x1 + dx)} ${f1(y0 + s * (h - 2.2))} ${f1(x1)} ${f1(y0)}Z"/>`;
}
function keySigSVG(clef, fifths, x, Y, cls = 'g-ink') {
  let s = '';
  keyPositions(clef, fifths).forEach((d, i) => { s += glyph(fifths > 0 ? 'accidentalSharp' : 'accidentalFlat', x + i * keyStep(fifths), Y(d), cls); });
  return s;
}
function timeSigSVG(time, x, baseY) {
  const w = timeWidth(time);
  const num = (v, cy) => {
    let gx = x + (w - digitsW(v)) / 2, s = '';
    for (const ch of String(v)) { s += glyph('timeSig' + ch, gx, cy, 'g-ink'); gx += GLYPH['timeSig' + ch].adv * SP; }
    return s;
  };
  return num(time[0], baseY - 3 * SP) + num(time[1], baseY - SP);
}

// Одна строка партитуры в SVG.
// o: { W, vb, cur — текущая нота, anim: { type, note }, fresh, hint, ghost: { d, acc }, naming, bars: false — без тактовых черт }
function renderRow(score, row, o) {
  const b = CLEFS[score.clef].bottomD, baseY = -o.vb.top, H = o.vb.bottom - o.vb.top;
  const Y = (d) => baseY + ((b - d) * SP) / 2;
  const f = o.f != null ? o.f : rowFactor(row, o.W);
  const pos = placeRow(score, row, f);
  const left = 0.8 * SP;
  // строка кончается тактовой чертой — там же кончается стан; оборвана посреди такта — стан до края
  const endsBar = pos.bars.length > 0 && Math.abs(pos.bars[pos.bars.length - 1].x - pos.endX) < 0.5;
  const endX = endsBar ? pos.endX : Math.max(pos.endX, o.W - RIGHT);
  const width = Math.max(o.W, endX + RIGHT);
  const staffTop = baseY - 4 * SP;
  let s = `<svg viewBox="0 0 ${f1(width)} ${f1(H)}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
  const cur = o.cur && pos.x.has(o.cur) ? o.cur : null;
  // подсветка текущей ноты — под линиями стана
  if (cur) {
    const x = pos.x.get(cur), yN = Y(cur.d);
    const bw = Math.max(2.6 * SP, Math.min(4.2 * SP, spaceFor(cur.dur) * f * 0.8)) + leadOf(cur);
    const top = Math.min(staffTop - 1.6 * SP, yN - 1.3 * SP), bot = Math.max(baseY + 1.6 * SP, yN + 1.3 * SP);
    s += `<rect class="band" x="${f1(x - bw / 2 - leadOf(cur) / 2)}" y="${f1(top)}" width="${f1(bw)}" height="${f1(bot - top)}" rx="${0.9 * SP}"/>`;
  }
  // стан: линии, ключ, ключевые знаки, размер, тактовые черты
  for (let i = 0; i < 5; i++) s += rect(left, baseY - i * SP - 0.6, endX - left, 1.2, 'st');
  const clefX = 1.5 * SP;
  s += score.clef === 'bass' ? glyph('fClef', clefX, baseY - 3 * SP, 'g-ink') : glyph('gClef', clefX, baseY - SP, 'g-ink');
  let hx = clefX + clefW(score.clef);
  if (row.key) { hx += 1.0 * SP; s += keySigSVG(score.clef, row.key, hx, Y); hx += keyWidth(row.key); }
  if (row.time) { hx += 1.0 * SP; s += timeSigSVG(row.time, hx, baseY); }
  for (const c of pos.changes) {
    let cx = c.x;
    if (c.m.showKey) {
      const nat = cancelledKey(score.clef, c.m.prevKey, c.m.key);
      nat.forEach((d, i) => { s += glyph('accidentalNatural', cx + i * (GLYPH.accidentalNatural.adv + 0.12) * SP, Y(d), 'g-ink'); });
      if (nat.length) cx += nat.length * (GLYPH.accidentalNatural.adv + 0.12) * SP + 0.3 * SP;
      s += keySigSVG(score.clef, c.m.key, cx, Y); cx += keyWidth(c.m.key);
    }
    if (c.m.showTime) { if (cx > c.x) cx += 0.8 * SP; s += timeSigSVG(c.m.time, cx, baseY); }
  }
  if (o.bars !== false) {
    for (const bar of pos.bars) {
      if (bar.final || (score.random && bar === pos.bars[pos.bars.length - 1])) {
        s += rect(bar.x - 0.5 * SP, staffTop - 0.6, 0.5 * SP, 4 * SP + 1.2, 'st') + rect(bar.x - 0.9 * SP - 1.4, staffTop - 0.6, 1.4, 4 * SP + 1.2, 'st');
      } else s += rect(bar.x - (bar.x > endX - 1 ? 1.4 : 0.7), staffTop - 0.6, 1.4, 4 * SP + 1.2, 'st'); // в конце строки черта прижата к краю стана
    }
  }
  // ноты и паузы
  s += `<g class="${o.fresh ? 'row-in fx' : ''}">`;
  const groups = new Set();
  const content0 = headerWidth(score.clef, row.key, row.time) - HEAD_END;
  for (const p of row.parts) {
    const m = score.measures[p.mi];
    for (let i = p.from; i < p.to; i++) {
      const it = m.items[i], x = pos.x.get(it);
      if (it.type === 'rest') { s += restSVG(it, x, baseY, 'g-ink'); continue; }
      const cls = clsOf(it);
      const a = o.anim && (o.anim.note === it || (it.tieFrom && o.anim.note === it.head)) ? ` fx ${o.anim.type}` : '';
      const data = it.tieFrom ? '' : ` data-i="${it.idx}" data-midi="${it.midi}" data-d="${it.d}"`;
      s += `<g class="n${it === cur ? ' cur' : ''}${a}"${data}>${noteHeadSVG(score, it, x, Y, cls)}${stemSVG(it, x, Y, baseY, cls)}</g>`;
      if (it.group) groups.add(it.group);
      // лиги: к следующей ноте или, если она в другой строке, — до края
      const below = it.stem ? it.stem.up : it.d < b + 4;
      const hw = headW(it) / 2;
      if (it.tie && it.tieTo) {
        const x2 = pos.x.has(it.tieTo) ? pos.x.get(it.tieTo) - headW(it.tieTo) / 2 - 0.15 * SP : endX - 0.3 * SP;
        s += tieSVG(x + hw + 0.15 * SP + dotsW(it), x2, Y(it.d), below, cls);
      }
      if (it.tieFrom && !row.parts.some((q) => { const mm = score.measures[q.mi]; return mm.items.slice(q.from, q.to).some((z) => z.tieTo === it); })) {
        s += tieSVG(content0 + 0.2 * SP, x - hw - 0.15 * SP, Y(it.d), below, cls);
      }
    }
  }
  for (const g of groups) s += beamSVG(g, pos, Y, baseY);
  s += '</g>';
  // подсказка — название над текущей нотой
  if (cur && o.hint) {
    let y = Math.min(staffTop, Y(cur.d) - 1.4 * SP);
    if (cur.stem && cur.stem.up) y = Math.min(y, baseY + cur.stem.end - 0.4 * SP);
    s += `<text class="hint-t" x="${f1(pos.x.get(cur))}" y="${f1(y - 0.9 * SP)}" text-anchor="middle">${shortName(cur.d, cur.acc, o.naming)}</text>`;
  }
  // сыгранная неверная нота — «призрак» рядом с текущей
  if (cur && o.ghost) {
    const gn = makeNote({ d: o.ghost.d, acc: o.ghost.acc, mark: o.ghost.acc || null, len: 4 });
    const y = Y(gn.d);
    if (y > 4 && y < H - 4) {
      const up = gn.d < b + 4;
      gn.stem = { up, end: up ? Math.min(y - baseY - STEM, -2 * SP) : Math.max(y - baseY + STEM, -2 * SP), beamed: false };
      const x = pos.x.get(cur) + (gn.mark != null ? 2.7 : 1.9) * SP;
      s += `<g class="ghost">${noteHeadSVG(score, gn, x, Y, 'g-bad')}${stemSVG(gn, x, Y, baseY, 'g-bad')}</g>`;
    }
  }
  return s + '</svg>';
}

// Маленький стан с отдельными нотами без тактов: образец диапазона, «трудные ноты».
function staffSVG(clef, list) {
  const items = list.map((c) => makeNote({ d: c.d, acc: c.acc || 0, midi: midiOf(c.d, c.acc || 0), clef, len: c.len || 4, dur: durOf(c.len || 4), mark: c.acc ? c.acc : null }));
  const score = { clef, measures: [{ time: null, key: 0, prevKey: 0, showTime: false, showKey: false, full: 4 * TPQ, items }], notes: items, random: true };
  prepareScore(score);
  const row = { parts: [{ mi: 0, from: 0, to: items.length }], key: 0, time: null, last: true };
  const m = partMetrics(clef, score.measures[0], 0, items.length, false);
  const W = headerWidth(clef, 0, null) + m.fixed + m.spring;
  row.fixed = W - m.spring; row.spring = m.spring;
  const vb = scoreVBox(score, items);
  vb.top = Math.min(-4.8 * SP, vb.top + 1.8 * SP); // без места для подсказки
  return renderRow(score, row, { W, vb, f: 1, bars: false });
}
