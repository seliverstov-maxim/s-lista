// LilyPond (.ly) → MusicXML для одной мелодической линии. Нужен, чтобы брать ноты из открытых источников —
// Mutopia, партитур Википедии и Викисклада — как есть, а не набирать заново.
//
// Что берётся из файла:
//   • мелодия — первая партитура (\score или музыкальное выражение верхнего уровня), в которой есть ноты;
//     из << … >> — первый голос с нотами (у фортепиано — верхний стан, то есть правая рука).
//     \key, \time, \tempo из голосов перед ним тоже учитываются, голоса после него пропускаются;
//   • переменные «имя = …» подставляются там, где на них ссылаются (\имя);
//   • темп — \tempo в мелодии или на верхнем уровне файла, иначе из блока \midi;
//   • название и автор — из \header (title, composer).
// Поддерживается: \relative (с опорной нотой и без), \fixed, абсолютная запись; голландские, немецкие
// (\language "deutsch") и английские названия нот; \key, \time, \tempo, \partial, \clef; ноты и паузы
// с точками, лиги (~), многотактовые паузы (R1*4); \repeat volta/unfold/percent с \alternative —
// повторы разворачиваются; форшлаги (\grace и др.) пропускаются, но служат опорой для \relative.
// Слова песни, символы аккордов (\chords), \markup и оформление пропускаются. Отклоняется то, что проверка
// пьесы всё равно не пропустит или что нельзя перевести без потерь: аккорды, триоли и растянутые
// длительности, \transpose, \breve, тремоло, свободный ритм (\cadenzaOn).

const STEPS = 'cdefgab';
const TYPE = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th', 128: '128th' };
const DIV = 48; // долей MusicXML на четверть
const MAJOR = [0, 2, 4, -1, 1, 3, 5]; // квинты мажора от до, ре, ми, фа, соль, ля, си
const MODES = { '\\major': 0, '\\ionian': 0, '\\minor': -3, '\\aeolian': -3, '\\dorian': -2, '\\phrygian': -4, '\\lydian': 1, '\\mixolydian': -1, '\\locrian': -5 };
const LANGS = ['nederlands', 'deutsch', 'english'];
// токены: команды и \<-подобные знаки, строки, значения Scheme, скобки, дроби, числа, слова (ноты с октавами,
// длительностью и множителем), артикуляция. Длительности: «16» раньше «1», иначе «a16» прочитается как «a1».
const TOKEN = /\\[A-Za-z]+|\\.|"(?:[^"\\]|\\.)*"|#"(?:[^"\\]|\\.)*"|#'?\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|#[^\s{}]*|<<|>>|[{}<>~()[\]|]|\d+\/\d+|\d+\.*(?:\*\d+(?:\/\d+)?)*|[A-Za-z]+[',]*[!?]?(?:(?:128|16|32|64|1|2|4|8)\.*)?(?:\*\d+(?:\/\d+)?)*|[-^_][.\-+>^_!|]|=|\S/g;
const NOTE = /^([a-z]+)([',]*)[!?]?((?:128|16|32|64|1|2|4|8)\.*)?((?:\*\d+(?:\/\d+)?)*)$/;
const REST = /^([rsR])((?:128|16|32|64|1|2|4|8)\.*)?((?:\*\d+(?:\/\d+)?)*)$/;
// команды без музыки внутри, у которых аргумент — путь к свойству и значение: пропускаем до следующей ноты
const PROPERTY = new Set(['\\set', '\\unset', '\\override', '\\revert', '\\tweak', '\\once', '\\temporary', '\\undo', '\\omit', '\\hide', '\\single', '\\mark', '\\label', '\\footnote', '\\ottava', '\\shape', '\\tag', '\\keepWithTag', '\\removeWithTag', '\\change']);
// команды, чей аргумент — не мелодия: пропускаем выражение целиком
const NOT_MUSIC = new Set(['\\header', '\\layout', '\\midi', '\\paper', '\\with', '\\addlyrics', '\\lyricmode', '\\lyrics', '\\chords', '\\chordmode', '\\drums', '\\drummode', '\\figures', '\\figuremode', '\\markup', '\\markuplist']);
const GRACE = new Set(['\\grace', '\\acciaccatura', '\\appoggiatura', '\\slashedGrace']);
const REJECT = {
  '\\times': 'триоль или другое нестандартное деление', '\\tuplet': 'триоль или другое нестандартное деление',
  '\\scaleDurations': 'растянутые длительности', '\\transpose': 'транспонирование (\\transpose)',
  '\\breve': 'длительность \\breve', '\\longa': 'длительность \\longa', '\\cadenzaOn': 'свободный ритм без тактов (\\cadenzaOn)',
};

export class LyError extends Error {}

function tokenize(src) {
  return src.replace(/%\{[\s\S]*?%\}/g, ' ').replace(/%[^\n]*/g, ' ').match(TOKEN) || [];
}

// Высота по имени ноты. Голландские: cis, bes, es, as (а также ees, aes); немецкие — как голландские,
// но h — си, b — си-бемоль; английские: cs, bf, css, bff, cx.
function parseName(name, lang) {
  const step = STEPS.indexOf(name[0]);
  let suffix = name.slice(1);
  if (lang === 'english') {
    const alter = { '': 0, s: 1, ss: 2, x: 2, sharp: 1, sharpsharp: 2, f: -1, ff: -2, flat: -1, flatflat: -2 }[suffix];
    return step < 0 || alter === undefined ? null : { step, alter };
  }
  if (lang === 'deutsch') {
    if (name === 'b') return { step: 6, alter: -1 };
    if (name[0] === 'h') { const alter = { '': 0, is: 1, isis: 2, eses: -2 }[suffix]; return alter === undefined ? null : { step: 6, alter }; }
    if (name[0] === 'b') return null; // «bes», «bis» по-немецки неоднозначны
  }
  if (step < 0) return null;
  if ('ae'.includes(name[0]) && (suffix === 's' || suffix === 'ses')) suffix = 'e' + suffix; // as, es, ases, eses
  const alter = { '': 0, is: 1, isis: 2, es: -1, eses: -2 }[suffix];
  return alter === undefined ? null : { step, alter };
}

// Ступень (октава·7 + буква) в относительной записи: ближайшая к предыдущей ноте (не дальше кварты), затем ' и ,
function relativeD(prevD, step, marks) {
  let d = Math.floor(prevD / 7) * 7 + step;
  while (d - prevD > 3) d -= 7;
  while (prevD - d > 3) d += 7;
  for (const ch of marks) d += ch === "'" ? 7 : -7;
  return d;
}
// Абсолютная запись: c без меток — до малой октавы (C3)
const absoluteD = (step, marks) => 21 + step + [...marks].reduce((a, ch) => a + (ch === "'" ? 7 : -7), 0);
const durTicks = (len, dots) => Math.round(((4 * DIV) / len) * (2 - Math.pow(0.5, dots)));
const isSound = (e) => e.kind === 'note' || e.kind === 'rest';
const isNote = (e) => e.kind === 'note';

// Разбор: { header, events } — плоский список событий мелодии:
// note { d, alter, len, dots, tie }, rest { len, dots } или { full, ticks }, key { fifths }, time { beats, type },
// tempo { q } (четвертей в минуту), partial { ticks }, clef { clef, octave }
export function parseLy(src) {
  let toks = tokenize(src), i = 0;
  const vars = new Map(), header = {};
  let lang = 'nederlands', len = 4, dots = 0, rel = null, fixed = null, midiTempo = null, depth = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const fail = (msg) => { throw new LyError(msg); };
  const pitchWord = (t) => { const m = t && NOTE.exec(t); return m && !m[3] && !m[4] ? parseName(m[1], lang) && m : null; };
  const musicWord = (t) => { const m = t && NOTE.exec(t); return (m && parseName(m[1], lang)) || (t && REST.test(t)); };

  function skipBalanced(open, close) { // открывающая скобка уже прочитана
    for (let d = 1; i < toks.length && d > 0;) { const t = next(); if (t === open) d++; else if (t === close) d--; }
  }
  // \new Staff = "имя" \with { … } — голова контекста до его музыки
  function contextHead() {
    if (/^[A-Z][A-Za-z]*$/.test(peek() || '')) next();
    if (peek() === '=') { next(); next(); }
    while (peek() === '\\with') { next(); skipExpr(); }
  }
  // пропустить одно выражение, не разбирая
  function skipExpr() {
    const t = next();
    if (t === undefined) return;
    if (t === '{') return skipBalanced('{', '}');
    if (t === '<<') return skipBalanced('<<', '>>');
    if (t === '<') return skipBalanced('<', '>');
    if (t === '\\relative' || t === '\\fixed') { if (pitchWord(peek())) next(); return skipExpr(); }
    if (t === '\\transpose') { next(); next(); return skipExpr(); }
    if (t === '\\new' || t === '\\context') { contextHead(); return skipExpr(); }
    if (t === '\\repeat') { next(); next(); skipExpr(); if (peek() === '\\alternative') { next(); skipExpr(); } return; }
    if (t === '\\times' || t === '\\tuplet') { while (/^\d/.test(peek() || '')) next(); return skipExpr(); }
    if (t === '\\lyricsto') { next(); return skipExpr(); }
    if (t === '\\key') { next(); next(); return; }
    if (['\\time', '\\partial', '\\clef', '\\bar', '\\language', '\\version', '\\include'].includes(t)) { next(); return; }
    if (NOT_MUSIC.has(t) || GRACE.has(t) || t === '\\unfoldRepeats' || t === '\\score' || t === '\\absolute') return skipExpr();
  }
  function skipProperty() { // путь к свойству и значение: до следующей ноты, скобки или команды
    while (i < toks.length && !['{', '}', '<<', '>>', '<'].includes(peek()) && !peek().startsWith('\\') && !musicWord(peek())) next();
  }
  function skipMarkup() {
    if (peek() === '{') { next(); skipBalanced('{', '}'); } else if ((peek() || '').startsWith('\\')) { next(); skipMarkup(); } else next();
  }

  // подставить переменную: разбираем её токены на месте ссылки
  function expand(name, out) {
    if (++depth > 50) fail(`переменная \\${name} ссылается сама на себя`);
    const saved = [toks, i];
    toks = vars.get(name); i = 0;
    while (i < toks.length) expr(out);
    [toks, i] = saved;
    depth--;
  }

  function note(t, out) {
    const m = NOTE.exec(t), p = parseName(m[1], lang);
    if (!p) fail(`непонятная нота «${t}»`);
    if (m[4]) fail(`растянутая длительность «${t}» не поддерживается`);
    if (m[3]) { len = parseInt(m[3], 10); dots = m[3].length - String(len).length; }
    let d;
    if (rel) { d = relativeD(rel.d, p.step, m[2]); rel.d = d; } else d = absoluteD(p.step, m[2]) + (fixed || 0);
    out.push({ kind: 'note', d, alter: p.alter, len, dots, tie: false });
  }
  function rest(t, out) {
    const m = REST.exec(t);
    if (m[2]) { len = parseInt(m[2], 10); dots = m[2].length - String(len).length; }
    let mult = 1;
    for (const f of m[3].match(/\*\d+(?:\/\d+)?/g) || []) { const [a, b = 1] = f.slice(1).split('/').map(Number); mult *= a / b; }
    const ticks = durTicks(len, dots) * mult;
    if (m[1] === 'R') { out.push({ kind: 'rest', full: true, ticks }); return; } // многотактовая: такты посчитаем при раскладке
    if (!Number.isInteger(mult)) fail(`пауза «${t}» с дробным множителем не поддерживается`);
    for (let k = 0; k < mult; k++) out.push({ kind: 'rest', len, dots });
  }

  // одно музыкальное выражение
  function expr(out) {
    const t = next();
    if (t === undefined) return;
    if (t === '{') { seq(out); if (peek() === '}') next(); return; }
    if (t === '<<') return simultaneous(out);
    if (t === '<') fail('аккорд (несколько нот одновременно) в мелодии: оставьте в исходнике одну ноту');
    if (t === 'q') fail('повтор аккорда (q) в мелодии: оставьте в исходнике одну ноту');
    if (t.startsWith('\\')) return command(t, out);
    if (REST.test(t)) return rest(t, out);
    if (NOTE.test(t) && parseName(NOTE.exec(t)[1], lang)) return note(t, out);
    if (t === '~') { const last = out[out.length - 1]; if (last && last.kind === 'note') last.tie = true; return; }
    if (/^[A-Za-z]/.test(t)) fail(`непонятное слово «${t}» в мелодии`);
    // остальное — оформление: | ( ) [ ] артикуляция, аппликатура, строки, значения Scheme
  }
  function seq(out) { while (i < toks.length && peek() !== '}') expr(out); }
  // << голос голос … >>: мелодия — первый голос с нотами
  function simultaneous(out) {
    let found = false;
    const start = rel && rel.d;
    while (i < toks.length && peek() !== '>>') {
      if (peek() === '\\\\') { next(); continue; }
      if (found) { skipExpr(); continue; }
      const part = [];
      if (rel) rel.d = start; // каждый голос отсчитывается от ноты перед <<
      expr(part);
      if (part.some(isNote)) { out.push(...part); found = true; } else out.push(...attrsOnly(part));
    }
    next();
  }
  // голос без нот (например, \global с паузами-разделителями): берём \key, \time, \tempo, если они до первой паузы
  function attrsOnly(part) {
    const k = part.findIndex(isSound);
    if (k >= 0 && part.slice(k).some((e) => !isSound(e))) fail('в голосе без нот (например, \\global) \\key, \\time или \\tempo стоят не в начале: перенесите их в мелодию');
    return part.filter((e) => !isSound(e));
  }

  function command(t, out) {
    const name = t.slice(1);
    if (vars.has(name)) return expand(name, out);
    if (REJECT[t]) fail(`${REJECT[t]} не поддерживается`);
    if (PROPERTY.has(t)) return skipProperty();
    if (NOT_MUSIC.has(t)) {
      if (t === '\\midi') return midiBlock();
      return t === '\\markup' || t === '\\markuplist' ? skipMarkup() : skipExpr();
    }
    if (GRACE.has(t)) return expr([]); // форшлаг не звучит в мелодии, но двигает опору \relative и длительность
    switch (t) {
      case '\\relative': {
        const m = pitchWord(peek());
        if (m) next();
        const saved = [rel, fixed];
        // без опорной ноты первая нота записана абсолютно — это то же, что опора фа малой октавы
        rel = { d: m ? absoluteD(parseName(m[1], lang).step, m[2]) : absoluteD(3, '') };
        fixed = null;
        expr(out);
        [rel, fixed] = saved;
        return;
      }
      case '\\fixed': {
        const m = pitchWord(next());
        if (!m) fail('после \\fixed нужна нота');
        const saved = [rel, fixed];
        rel = null;
        fixed = Math.floor(absoluteD(0, m[2]) / 7) * 7 - 21;
        expr(out);
        [rel, fixed] = saved;
        return;
      }
      case '\\absolute': { const saved = [rel, fixed]; rel = fixed = null; expr(out); [rel, fixed] = saved; return; }
      case '\\key': {
        const m = pitchWord(next()), mode = next();
        const p = m && parseName(m[1], lang);
        if (!p || !(mode in MODES)) fail('тональность не читается: нужно, например, \\key g \\major');
        const fifths = MAJOR[p.step] + 7 * p.alter + MODES[mode];
        if (Math.abs(fifths) > 7) fail('тональность с больше чем семью знаками не поддерживается');
        out.push({ kind: 'key', fifths });
        return;
      }
      case '\\time': {
        const m = /^(\d+)\/(\d+)$/.exec(next() || '');
        if (!m) fail('размер не читается: нужно, например, \\time 3/4');
        out.push({ kind: 'time', beats: +m[1], type: +m[2] });
        return;
      }
      case '\\tempo': {
        if (peek() === '\\markup') { next(); skipMarkup(); } else if ((peek() || '').startsWith('"')) next();
        const m = /^(1|2|4|8|16)(\.*)$/.exec(peek() || '');
        if (!m) return; // темп только словами
        next();
        if (peek() === '=') next();
        const bpm = parseInt(next(), 10);
        if (!(bpm > 0)) fail('темп не читается: нужно, например, \\tempo 4 = 100');
        out.push({ kind: 'tempo', q: +(bpm * (4 / +m[1]) * (2 - Math.pow(0.5, m[2].length))).toFixed(3) });
        return;
      }
      case '\\partial': {
        const m = /^(128|16|32|64|1|2|4|8)(\.*)((?:\*\d+(?:\/\d+)?)*)$/.exec(next() || '');
        if (!m) fail('длина затакта не читается');
        let ticks = durTicks(+m[1], m[2].length);
        for (const f of m[3].match(/\*\d+(?:\/\d+)?/g) || []) { const [a, b = 1] = f.slice(1).split('/').map(Number); ticks = (ticks * a) / b; }
        out.push({ kind: 'partial', ticks });
        return;
      }
      case '\\clef': {
        const c = (next() || '').replace(/"/g, '');
        const m = /^([A-Za-z]+)(?:([_^])(8|15))?$/.exec(c);
        const kind = m && { treble: 'treble', violin: 'treble', G: 'treble', G2: 'treble', bass: 'bass', F: 'bass' }[m[1]];
        if (!kind) fail(`ключ «${c}» не поддерживается: только скрипичный и басовый`);
        out.push({ kind: 'clef', clef: kind, octave: m[2] ? (m[2] === '_' ? -1 : 1) * (m[3] === '8' ? 1 : 2) : 0 });
        return;
      }
      case '\\language': { setLang((next() || '').replace(/"/g, '')); return; }
      case '\\include': { const f = (next() || '').replace(/"/g, '').replace(/\.ly$/, ''); if (LANGS.includes(f)) lang = f; return; }
      case '\\version': case '\\bar': next(); return;
      case '\\repeat': {
        const kind = (next() || '').replace(/"/g, '');
        if (kind === 'tremolo') fail('тремоло не поддерживается');
        const n = parseInt(next(), 10) || 2;
        const body = [];
        expr(body);
        const alts = [];
        if (peek() === '\\alternative') {
          next();
          if (next() !== '{') fail('после \\alternative нужны { … }');
          while (peek() === '{') { const a = []; expr(a); alts.push(a); }
          if (peek() === '}') next();
        }
        // при нехватке концовок первые проходы получают первую (как в LilyPond);
        // затакт внутри повтора — только у первого прохода: дальше его восполняет концовка
        for (let k = 0; k < n; k++) {
          out.push(...body.filter((e) => k === 0 || e.kind !== 'partial').map((e) => ({ ...e })));
          if (alts.length) out.push(...alts[Math.max(0, k - (n - alts.length))].map((e) => ({ ...e })));
        }
        return;
      }
      case '\\new': case '\\context': contextHead(); return expr(out);
      case '\\unfoldRepeats': return expr(out);
      case '\\afterGrace': { expr(out); expr([]); return; }
      case '\\lyricsto': next(); return skipExpr();
      case '\\rest': { // нота с \rest — пауза на месте этой ноты
        const last = out[out.length - 1];
        if (last && last.kind === 'note') out[out.length - 1] = { kind: 'rest', len: last.len, dots: last.dots };
        return;
      }
      case '\\skip': {
        const d = next() || '';
        if (!REST.test('s' + d)) fail('длительность после \\skip не читается');
        return rest('s' + d, out);
      }
      default: // прочие команды без аргументов: \stemUp, \break, \fermata, \autoBeamOff, \voiceOne…
    }
  }
  function setLang(l) {
    if (!LANGS.includes(l)) fail(`названия нот «${l}» не поддерживаются: только nederlands, deutsch или english`);
    lang = l;
  }
  // \midi { \tempo 4 = 100 … } — темп проигрыша, если в самой мелодии его нет. Старая запись:
  // tempoWholesPerMinute = #(ly:make-moment 180 4) — 180/4 целых в минуту, то есть 180 четвертей
  function midiBlock() {
    if (peek() !== '{') return;
    next();
    for (let d = 1; i < toks.length && d > 0;) {
      const t = next();
      if (t === '{') d++;
      else if (t === '}') d--;
      else if (t === '\\tempo' && midiTempo == null) { const ev = []; command(t, ev); if (ev.length) midiTempo = ev[0].q; }
      else if (t === 'tempoWholesPerMinute' && midiTempo == null) {
        if (peek() === '=') next();
        const m = /^#\(ly:make-moment\s+(\d+)(?:\s+|\/)(\d+)\)$/.exec(next() || '');
        if (m) midiTempo = +((4 * +m[1]) / +m[2]).toFixed(3);
      }
    }
  }
  function headerBlock() {
    if (peek() !== '{') return;
    next();
    for (let d = 1; i < toks.length && d > 0;) {
      const t = next();
      if (t === '{') d++;
      else if (t === '}') d--;
      else if (d === 1 && peek() === '=' && /^[A-Za-z]+$/.test(t)) {
        next();
        const v = peek() || '';
        if (v.startsWith('"')) { next(); if (!(t in header)) header[t] = v.slice(1, -1).replace(/\\"/g, '"'); }
      }
    }
  }

  // Верхний уровень: \header, переменные, \score и музыкальные выражения. Мелодия — первая партитура с нотами.
  let melody = null;
  const before = []; // \key, \time, \tempo из выражений верхнего уровня до мелодии
  function scoreBody(close) {
    while (i < toks.length && peek() !== close) {
      const t = peek();
      if (t === '\\header') { next(); headerBlock(); continue; }
      if (t === '\\midi') { next(); midiBlock(); continue; }
      if (t === '\\layout' || t === '\\paper') { next(); skipExpr(); continue; }
      if (t === '\\score') { next(); if (next() === '{') scoreBody('}'); continue; } // внутри \book
      if (melody) { skipExpr(); continue; }
      const ev = [];
      expr(ev);
      if (ev.some(isNote)) melody = ev; else before.push(...attrsOnly(ev));
    }
    next();
  }
  while (i < toks.length) {
    const t = peek();
    if (/^[A-Za-z]+$/.test(t) && toks[i + 1] === '=') { // переменная
      next(); next();
      const a = i;
      skipExpr();
      vars.set(t, toks.slice(a, i));
      continue;
    }
    if (t === '\\header') { next(); headerBlock(); continue; }
    if (t === '\\score' || t === '\\book' || t === '\\bookpart') { next(); if (next() === '{') scoreBody('}'); continue; }
    if (t === '\\paper' || t === '\\layout') { next(); skipExpr(); continue; }
    if (t === '\\midi') { next(); midiBlock(); continue; }
    if (t === '\\version' || t === '\\include' || t === '\\language') { next(); command(t, []); continue; }
    if (t.startsWith('#')) { next(); continue; } // код Scheme
    if (melody) { skipExpr(); continue; }
    const ev = [];
    expr(ev);
    if (ev.some(isNote)) melody = ev; else before.push(...attrsOnly(ev));
  }
  if (!melody) fail('в исходнике нет нот');
  const events = [...before, ...melody];
  if (!events.some((e) => e.kind === 'tempo') && midiTempo != null) events.unshift({ kind: 'tempo', q: midiTempo });
  return { header, events };
}

// События → MusicXML (score-partwise, одна партия, один голос).
export function lyToMusicXml(src, meta = {}) {
  const { header, events } = parseLy(src);
  if (!events.some((e) => e.kind === 'tempo')) throw new LyError('нет темпа: добавьте в начало файла строку \\tempo 4 = 90 (темп — четвертей в минуту) с пометкой, что он добавлен');
  let time = null, clef = { clef: 'treble', octave: 0 }, partial = 0, first = true;
  const measures = [];
  let cur = null, pos = 0, limit = 0;
  const bar = () => (time.beats * 4 * DIV) / time.type;
  let pending = {};
  const midMeasure = () => cur && pos > 0 && pos < limit;
  const open = () => {
    cur = { attrs: {}, notes: [], tempo: null };
    measures.push(cur);
    pos = 0;
    limit = measures.length === 1 && partial ? partial : bar();
    if (pending.key != null) cur.attrs.key = pending.key;
    if (pending.time) cur.attrs.time = pending.time;
    if (pending.tempo) cur.tempo = pending.tempo;
    pending = {};
  };
  const place = (e, dur) => {
    if (!cur || pos >= limit) open();
    if (pos + dur > limit) throw new LyError(`нота или пауза пересекает тактовую черту в такте ${measures.length}`);
    cur.notes.push({ ...e, dur });
    pos += dur;
  };
  for (const e of events) {
    if (e.kind === 'key') { if (midMeasure()) throw new LyError(`смена тональности посреди такта ${measures.length}`); pending.key = e.fifths; continue; }
    if (e.kind === 'time') { if (midMeasure()) throw new LyError(`смена размера посреди такта ${measures.length}`); time = { beats: e.beats, type: e.type }; pending.time = time; continue; }
    if (e.kind === 'tempo') { if (midMeasure()) throw new LyError(`смена темпа посреди такта ${measures.length}`); pending.tempo = e.q; continue; }
    if (e.kind === 'clef') { if (first) clef = e; continue; }
    if (e.kind === 'partial') { if (!first) throw new LyError('затакт (\\partial) возможен только в начале'); partial = e.ticks; continue; }
    if (!time) { time = { beats: 4, type: 4 }; pending.time = time; } // по умолчанию в LilyPond — 4/4
    first = false;
    if (e.full) { // многотактовая пауза: целые такты
      if (cur && pos > 0 && pos < limit) throw new LyError(`многотактовая пауза посреди такта ${measures.length}`);
      const n = e.ticks / bar();
      if (!Number.isInteger(n) || n < 1) throw new LyError(`длина многотактовой паузы не равна целому числу тактов (такт ${measures.length + 1})`);
      for (let k = 0; k < n; k++) place({ kind: 'rest', full: true }, bar());
      continue;
    }
    place(e, durTicks(e.len, e.dots));
  }
  if (!measures.length) throw new LyError('в исходнике нет нот');
  const title = meta.title || header.title || '';
  const composer = meta.composer != null ? meta.composer : header.composer || '';
  const rights = meta.rights || header.license || header.copyright || '';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n';
  xml += `  <work><work-title>${esc(title)}</work-title></work>\n`;
  xml += `  <identification>${composer ? `<creator type="composer">${esc(composer)}</creator>` : ''}${rights ? `<rights>${esc(rights)}</rights>` : ''}<encoding><software>s-lista ly2musicxml</software></encoding></identification>\n`;
  xml += '  <part-list><score-part id="P1"><part-name>Мелодия</part-name></score-part></part-list>\n  <part id="P1">\n';
  const notes = measures.flatMap((m) => m.notes);
  measures.forEach((m, mi) => {
    xml += `    <measure number="${mi + 1}"${mi === 0 && partial ? ' implicit="yes"' : ''}>\n`;
    const a = [];
    if (mi === 0) a.push(`<divisions>${DIV}</divisions>`);
    if (mi === 0 || m.attrs.key != null) a.push(`<key><fifths>${m.attrs.key ?? 0}</fifths></key>`);
    if (m.attrs.time) a.push(`<time><beats>${m.attrs.time.beats}</beats><beat-type>${m.attrs.time.type}</beat-type></time>`);
    if (mi === 0) a.push(`<clef>${clef.clef === 'bass' ? '<sign>F</sign><line>4</line>' : '<sign>G</sign><line>2</line>'}${clef.octave ? `<clef-octave-change>${clef.octave}</clef-octave-change>` : ''}</clef>`);
    if (a.length) xml += `      <attributes>${a.join('')}</attributes>\n`;
    if (m.tempo) xml += `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${m.tempo}</per-minute></metronome></direction-type><sound tempo="${m.tempo}"/></direction>\n`;
    for (const n of m.notes) {
      if (n.kind === 'rest') {
        xml += n.full ? `      <note><rest measure="yes"/><duration>${n.dur}</duration><voice>1</voice></note>\n`
          : `      <note><rest/><duration>${n.dur}</duration><voice>1</voice><type>${TYPE[n.len]}</type>${'<dot/>'.repeat(n.dots)}</note>\n`;
        continue;
      }
      // лига: начало у этой ноты, конец — у следующей
      const k = notes.indexOf(n), prev = notes[k - 1];
      const stop = prev && prev.kind === 'note' && prev.tie;
      const ties = (stop ? '<tie type="stop"/>' : '') + (n.tie ? '<tie type="start"/>' : '');
      const tied = (stop ? '<tied type="stop"/>' : '') + (n.tie ? '<tied type="start"/>' : '');
      const step = STEPS[((n.d % 7) + 7) % 7].toUpperCase(), oct = Math.floor(n.d / 7);
      xml += `      <note><pitch><step>${step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${oct}</octave></pitch><duration>${n.dur}</duration>${ties}<voice>1</voice><type>${TYPE[n.len]}</type>${'<dot/>'.repeat(n.dots)}${tied ? `<notations>${tied}</notations>` : ''}</note>\n`;
    }
    xml += '    </measure>\n';
  });
  xml += '  </part>\n</score-partwise>\n';
  return xml;
}
