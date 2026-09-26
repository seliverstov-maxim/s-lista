// Тесты музыкальной логики и нотного движка (src/music.js). Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { M, GLYPH } from './helpers/load-music.mjs';

const piecesDir = new URL('../pieces/', import.meta.url);
const samples = readdirSync(piecesDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => JSON.parse(readFileSync(new URL(f, piecesDir), 'utf8')));
const seeded = (seed = 7) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const n = (d, len = 4, extra = {}) => ({ d, acc: 0, len, ...extra });

test('FR-RND-02: диапазон по добавочным линейкам — как в таблице спецификации', () => {
  const name = (d) => M.shortName(d, 0, 'solfege');
  const table = {
    treble: [['ми¹', 'фа²'], ['до¹', 'ля²'], ['ля', 'до³'], ['фа', 'ми³']],
    bass: [['Соль', 'ля'], ['Ми', 'до¹'], ['До', 'ми¹'], ['Ля₁', 'соль¹']],
  };
  for (const clef of ['treble', 'bass']) {
    for (let k = 0; k <= 3; k++) {
      const r = M.ledgerRange(clef, k, k);
      assert.deepEqual([name(r.lo), name(r.hi)], table[clef][k], `${clef}, ${k} линеек`);
    }
  }
});

test('FR-RND-02: 1000 нот, басовый, 3 и 3 — белые клавиши от Ля₁ до соль¹, двух одинаковых подряд нет', () => {
  const cands = M.candidates('bass', 3, 3), rnd = seeded();
  let prev = null;
  for (let i = 0; i < 1000; i++) {
    const c = M.pickNote(prev, cands, null, rnd);
    assert.ok(c.d >= 12 && c.d <= 32, `нота вне диапазона: ${M.shortName(c.d)}`);
    assert.equal(c.acc, 0);
    assert.ok(![1, 3, 6, 8, 10].includes(c.midi % 12), 'чёрная клавиша');
    assert.notEqual(c.midi, prev && prev.midi, 'одна клавиша дважды подряд');
    prev = c;
  }
});

test('FR-RND-02: скрипичный, 0 и 0 — на стане ни одной добавочной линейки', () => {
  const cands = M.candidates('treble', 0, 0), rnd = seeded(3);
  let prev = null;
  const list = [];
  for (let i = 0; i < 200; i++) { prev = M.pickNote(prev, cands, null, rnd); list.push(prev); }
  const score = M.randomScore(list, 'treble');
  const rows = M.layoutRows(score, 5000);
  const svg = M.renderRow(score, rows[0], { W: 5000, vb: M.scoreVBox(score) });
  assert.ok(!svg.includes(' lg"'), 'нарисована добавочная линейка');
  assert.ok(list.every((c) => c.d >= 30 && c.d <= 38));
});

test('Генератор: «Чаще давать трудные ноты» — вес ноты учитывается', () => {
  const cands = M.candidates('treble', 0, 0), rnd = seeded(11);
  const heavy = cands[3].midi;
  let hits = 0, prev = null;
  for (let i = 0; i < 2000; i++) { prev = M.pickNote(prev, cands, (c) => (c.midi === heavy ? 20 : 1), rnd); if (prev.midi === heavy) hits++; }
  assert.ok(hits > 600, `тяжёлая нота выпала ${hits} раз из 2000`);
});

test('FR-RND-04: перенос настроек версии 1', () => {
  const cases = [
    [{ clef: 'treble', lo: 28, hi: 35 }, { clef: 'treble', below: 1, above: 0 }],   // «Первая октава»
    [{ clef: 'treble', lo: 28, hi: 39 }, { clef: 'treble', below: 1, above: 1 }],   // «Скрипичный ключ»
    [{ clef: 'bass', lo: 17, hi: 28 }, { clef: 'bass', below: 1, above: 1 }],       // «Басовый ключ»
    [{ clef: 'grand', lo: 17, hi: 39 }, { clef: 'treble', below: 3, above: 1 }],    // «Оба ключа» → скрипичный
    [{ clef: 'grand', lo: 14, hi: 42 }, { clef: 'treble', below: 3, above: 2 }],    // «Добавочные линейки»
  ];
  for (const [old, want] of cases) {
    const got = M.migrateSettings({ ...old, acc: true, motion: 'step', perRow: 'one', naming: 'letters', gateDb: -44, calibrated: true });
    assert.deepEqual({ clef: got.clef, below: got.below, above: got.above }, want, JSON.stringify(old));
    assert.equal(got.naming, 'letters');
    assert.equal(got.gateDb, -44);
    assert.equal(got.calibrated, true);
    assert.deepEqual(got.last, { mode: 'random' });
    for (const k of ['acc', 'motion', 'perRow', 'lo', 'hi']) assert.ok(!(k in got), `осталось поле ${k}`);
  }
  assert.equal(M.migrateSettings({ sens: 16 }).gateDb, -46, 'старая шкала ползунка');
  assert.deepEqual(M.migrateSettings(null), {});
});

test('Длительности в тиках', () => {
  assert.equal(M.durOf(4), 48);
  assert.equal(M.durOf(4, 1), 72);
  assert.equal(M.durOf(1), 192);
  assert.equal(M.durOf(16, 2), 21);
  assert.equal(M.beatOf([6, 8]), 72);
  assert.equal(M.beatOf([3, 8]), 72);
  assert.equal(M.beatOf([2, 2]), 96);
  assert.equal(M.beatOf(null), 48);
});

test('Партитура пьесы: сдвиг версии, лиги, смена тональности и размера', () => {
  const piece = { shift: { treble: 1, bass: -1 }, measures: [
    { time: [3, 4], key: 2, items: [n(28), n(29, 2, { tie: true })] },
    { key: -1, items: [n(29, 4), n(30, 4), { rest: true, len: 4 }] },
    { time: [2, 4], items: [{ rest: true, measure: true }] },
  ] };
  const t = M.buildScore(piece, 'treble'), b = M.buildScore(piece, 'bass');
  assert.equal(t.notes[0].d, 35);
  assert.equal(b.notes[0].d, 21);
  assert.equal(t.notes.length, 3, 'продолжение лиги не играется отдельно');
  const cont = t.measures[1].items[0];
  assert.ok(cont.tieFrom && cont.head === t.notes[1] && t.notes[1].tieTo === cont);
  assert.deepEqual([t.measures[1].showKey, t.measures[1].prevKey, t.measures[1].key], [true, 2, -1]);
  assert.deepEqual([t.measures[2].showTime, t.measures[2].items[0].dur], [true, 96]);
});

const widths = [260, 312, 400, 579, 800];
test('FR-PC-05: раскладка — все знаки по одному разу и по порядку, строки не шире рисунка', () => {
  for (const p of samples) for (const clef of Object.keys(p.shift)) for (const W of widths) {
    const score = M.buildScore(p, clef);
    const rows = M.layoutRows(score, W);
    const seen = [];
    for (const r of rows) {
      for (const part of r.parts) seen.push(...score.measures[part.mi].items.slice(part.from, part.to));
      const f = M.rowFactor(r, W);
      assert.ok(r.fixed + r.spring * f <= W + 0.5, `${p.id}/${clef}/${W}: строка шире рисунка`);
    }
    assert.deepEqual(seen, M.allNotes(score).length ? score.measures.flatMap((m) => m.items) : [], `${p.id}/${clef}/${W}`);
    // каждая играемая нота — ровно в одной строке
    const byRow = rows.flatMap((r) => (r.noteFrom < 0 ? [] : Array.from({ length: r.noteTo - r.noteFrom }, (_, i) => r.noteFrom + i)));
    assert.deepEqual(byRow, score.notes.map((x) => x.idx), `${p.id}/${clef}/${W}: ноты по строкам`);
  }
});

test('FR-PC-05: такт 4/4 из восьми восьмых на телефоне — переносится по границе доли, группы не рвутся', () => {
  const piece = { shift: { treble: 0 }, measures: [
    { time: [4, 4], key: 3, items: [28, 29, 30, 31, 32, 33, 34, 35].map((d, i) => n(d, 8, { beam: [['begin', 'continue', 'continue', 'end'][i % 4]] })) },
  ] };
  const score = M.buildScore(piece, 'treble');
  const rows = M.layoutRows(score, 312); // 343 px: интервал 11 px
  assert.ok(rows.length > 1, 'такт должен занять больше одной строки');
  const cut = rows[0].parts[0].to;
  assert.equal(score.measures[0].items[cut].start % M.beatOf([4, 4]), 0, 'разрыв не на границе доли');
  assert.notEqual(score.measures[0].items[cut - 1].group, score.measures[0].items[cut].group, 'разорвана группа восьмых');
});

test('Отрисовка: во всех строках образцов нет NaN, у каждой играемой ноты есть data-i', () => {
  for (const p of samples) for (const clef of Object.keys(p.shift)) for (const W of [312, 579]) {
    const score = M.buildScore(p, clef);
    const rows = M.layoutRows(score, W), vb = M.scoreVBox(score);
    rows.forEach((r) => {
      const cur = score.notes[r.noteFrom];
      const svg = M.renderRow(score, r, { W, vb, cur, hint: true, ghost: { d: cur.d + 2, acc: 1 }, naming: 'solfege' });
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `${p.id}/${clef}: ${svg.match(/.{40}(NaN|undefined|Infinity).{20}/)}`);
      const ids = [...svg.matchAll(/data-i="(\d+)"/g)].map((m) => +m[1]);
      assert.deepEqual(ids, Array.from({ length: r.noteTo - r.noteFrom }, (_, i) => r.noteFrom + i));
    });
  }
  assert.ok(!/NaN|undefined/.test(M.staffSVG('bass', [{ d: 12, len: 1 }, { d: 32, len: 1 }])));
});

test('Добавочные линейки: три для крайних нот', () => {
  const svgFor = (clef, d) => {
    const score = M.randomScore([{ d }], clef);
    const rows = M.layoutRows(score, 400);
    return M.renderRow(score, rows[0], { W: 400, vb: M.scoreVBox(score) });
  };
  const count = (svg) => (svg.match(/ lg"/g) || []).length;
  assert.equal(count(svgFor('treble', 24)), 3); // фа малой
  assert.equal(count(svgFor('treble', 44)), 3); // ми третьей
  assert.equal(count(svgFor('bass', 12)), 3);   // ля контроктавы
  assert.equal(count(svgFor('bass', 32)), 3);   // соль первой
  assert.equal(count(svgFor('treble', 29)), 0); // ре первой — под станом, без линейки
});

test('FR-CHK-03, FR-PC-07: отголоски с микрофона', () => {
  const done = { midi: 60, t: 1000 };
  // повтор той же ноты как верный ответ
  assert.equal(M.isEcho(60, 'onset', true, done, 1100, true), true, 'через 100 мс — отголосок');
  assert.equal(M.isEcho(60, 'onset', false, done, 1400, true), true, 'неуверенный удар — отголосок');
  assert.equal(M.isEcho(60, 'legato', true, done, 1400, true), true, 'легато той же ноты — не новый удар');
  assert.equal(M.isEcho(60, 'onset', true, done, 1300, true), false, 'уверенный удар через 300 мс — настоящий повтор');
  assert.equal(M.isEcho(60, 'midi', true, done, 1010, true), false, 'MIDI правило не касается');
  assert.equal(M.isEcho(60, 'screen', true, done, 1010, true), false, 'экранную клавиатуру — тоже');
  // та же нота как ошибка
  assert.equal(M.isEcho(60, 'onset', true, done, 2400, false), true, 'ошибкой не считаем 1,5 с');
  assert.equal(M.isEcho(60, 'onset', true, done, 2600, false), false, 'после 1,5 с — ошибка');
  assert.equal(M.isEcho(62, 'onset', true, done, 1100, false), false, 'другая клавиша — не отголосок');
  assert.equal(M.isEcho(60, 'onset', true, null, 1100, true), false);
});

test('Правило линеек одинаковое в приложении и в инструменте загрузки пьес', async () => {
  const tool = await import('../scripts/lib/musicxml.mjs');
  for (const clef of ['treble', 'bass']) {
    for (let d = 0; d <= 56; d++) assert.equal(tool.ledgerLines(d, clef), M.linesNeeded(clef, d), `${clef}, ступень ${d}`);
    const r = M.ledgerRange(clef, tool.MAX_LEDGER, tool.MAX_LEDGER);
    for (let d = r.lo - 2; d <= r.hi + 2; d++) assert.equal(tool.ledgerLines(d, clef) <= tool.MAX_LEDGER, d >= r.lo && d <= r.hi, `${clef}, ступень ${d}`);
  }
});

// группы восьмых по строкам: сколько нот каждой группы попало в каждую строку
function groupSplits(score, rows) {
  const out = [];
  for (const r of rows) {
    const cnt = new Map();
    for (const p of r.parts) for (const it of score.measures[p.mi].items.slice(p.from, p.to)) if (it.group) cnt.set(it.group, (cnt.get(it.group) || 0) + 1);
    out.push([...cnt.values()]);
  }
  return out;
}

test('FR-PC-05: перенос внутри группы шестнадцатых не оставляет в строке одну ноту группы (6/8, три диеза, телефон)', () => {
  const six = (i) => ['begin', 'continue', 'continue', 'continue', 'continue', 'end'][i % 6];
  const piece = { shift: { treble: 0 }, measures: [
    { time: [6, 8], key: 3, items: [31, 32, 33, 34, 35, 36, 37, 36, 35, 34, 33, 32].map((d, i) => n(d, 16, { acc: [31, 35, 32].includes(d) ? 1 : 0, mark: i === 2 ? 1 : undefined, beam: [six(i), six(i)] })) },
  ] };
  for (const W of [247, 269, 297, 311]) {
    const score = M.buildScore(piece, 'treble');
    const rows = M.layoutRows(score, W);
    const lone = groupSplits(score, rows).flat().filter((c) => c === 1).length;
    assert.equal(lone, 0, `ширина ${W}: одиночная нота группы в строке`);
  }
});

test('Отрисовка: нота группы, оставшаяся в строке одна, — со штилем и флажком', () => {
  // одна группа из восьми шестнадцатых на очень узком рисунке — группу приходится рвать где угодно
  const piece = { shift: { treble: 0 }, measures: [
    { time: [2, 4], key: 0, items: [28, 30, 32, 34, 35, 34, 32, 30].map((d, i) => n(d, 16, { beam: [i === 0 ? 'begin' : i === 7 ? 'end' : 'continue', i === 0 ? 'begin' : i === 7 ? 'end' : 'continue'] })) },
  ] };
  const score = M.buildScore(piece, 'treble');
  const rows = M.layoutRows(score, 120);
  const vb = M.scoreVBox(score);
  const flags = [GLYPH.flag16thUp.d, GLYPH.flag16thDown.d];
  groupSplits(score, rows).forEach((counts, ri) => {
    const svg = M.renderRow(score, rows[ri], { W: 120, vb });
    if (counts.includes(1)) assert.ok(flags.some((f) => svg.includes(f)), `строка ${ri}: у одиночной ноты нет флажка`);
  });
});

test('«Призрак» неверной ноты: знак с учётом ключевых знаков и знаков раньше в такте', () => {
  const piece = { shift: { treble: 0 }, measures: [
    { time: [4, 4], key: 1, items: [n(31, 4, { acc: 1 }), n(32), n(33), n(34)] },   // соль мажор: фа-диез в ключе
    { key: 0, items: [n(31, 4, { acc: 1, mark: 1 }), n(32), n(33), n(34)] },       // до мажор, фа-диез со знаком
  ] };
  const score = M.buildScore(piece, 'treble');
  const g1 = score.notes[0], g2 = score.notes[5];
  assert.equal(M.shownAcc(score, g1, 31, 0), 0, 'соль мажор: сыграно фа — нужен бекар');
  assert.equal(M.shownAcc(score, g1, 31, 1), null, 'соль мажор: фа-диез — знак уже в ключе');
  assert.equal(M.shownAcc(score, g2, 31, 0), 0, 'после фа-диеза в такте: фа — бекар');
  assert.equal(M.shownAcc(score, g2, 31, 1), null, 'после фа-диеза в такте: фа-диез без знака');
  assert.equal(M.shownAcc(score, score.notes[4], 34, -1), -1, 'до мажор: си-бемоль — бемоль');
  assert.equal(M.keyAt(score, g1), 1);
});

test('FR-RND-04: перенос настроек — линейки только с той стороны, где граница за станом', () => {
  const pick = (o) => { const g = M.migrateSettings(o); return [g.clef, g.below, g.above].join(' '); };
  assert.equal(pick({ clef: 'treble', lo: 40, hi: 49 }), 'treble 0 3');
  assert.equal(pick({ clef: 'grand', lo: 14, hi: 26 }), 'treble 3 0');
  assert.equal(pick({ clef: 'bass', lo: 12, hi: 16 }), 'bass 3 0');
});

test('FR-PC-11: план проигрыша — время по темпу такта, лига тянет звук, паузы молчат', () => {
  const piece = { shift: { treble: 0 }, measures: [
    { time: [4, 4], key: 0, tempo: 120, items: [n(28), n(29, 8), n(30, 8), { rest: true, len: 4 }, n(31, 4, { tie: true })] },
    { tempo: 60, items: [n(31, 2), n(32, 2)] },
  ] };
  const score = M.buildScore(piece, 'treble');
  const plan = M.playbackPlan(score, score.notes[0]);
  const ev = plan.events.map((e) => [+(e.t.toFixed(3)), +(e.end.toFixed(3)), e.midi]);
  // 120 в минуту: четверть 0,5 с, восьмая 0,25 с; 60 в минуту: половинная 2 с
  assert.deepEqual(ev, [[0, 0.5, 60], [0.5, 0.75, 62], [0.75, 1, 64], [1, 1.5, null], [1.5, 2, 65], [2, 4, null], [4, 6, 67]]);
  assert.equal(+plan.events[4].soundEnd.toFixed(3), 4, 'фа под лигой звучит до конца продолжения');
  assert.equal(+plan.total.toFixed(3), 6);
  // проигрыш с середины: с продолжения лиги — оно звучит само
  const tail = M.playbackPlan(score, score.measures[1].items[0]);
  assert.deepEqual(tail.events.map((e) => e.midi), [65, 67]);
  // строка каждого знака
  const rows = M.layoutRows(score, 200), map = M.itemRowMap(score, rows);
  assert.equal(map.size, 7);
});

test('Откуда знак у нужной ноты: ключевые знаки, знак перед нотой, знак раньше в такте', () => {
  const piece = { shift: { treble: 0 }, measures: [
    { time: [4, 4], key: 2, items: [n(31, 4, { acc: 1 }), n(31, 4, { mark: 0 }), n(31), n(35, 4, { acc: 1 })] },
    { items: [n(32, 4, { acc: 1, mark: 1 }), n(32, 4, { acc: 1 }), n(33), n(34)] },
  ] };
  const score = M.buildScore(piece, 'treble');
  assert.deepEqual(score.notes.slice(0, 6).map((x) => M.accidentalSource(score, x)), ['key', 'mark', 'measure', 'key', 'mark', 'measure']);
  assert.equal(M.accidentalSource(score, score.notes[6]), null);
  assert.equal(M.keySigNames(2), 'фа-диез и до-диез');
  assert.equal(M.keySigNames(-3), 'си-бемоль, ми-бемоль и ля-бемоль');
  assert.equal(M.keySigNames(1, 'letters'), 'F♯');
});

test('Названия буквами: номер октавы маленькой цифрой (C₄), слоги — по-прежнему с русскими октавами', () => {
  assert.equal(M.shortName(28), 'C₄');
  assert.equal(M.shortName(31, 1, 'letters'), 'F♯₄');
  assert.equal(M.fullName(12, 0, 'letters'), 'A₁');
  assert.equal(M.shortName(28, 0, 'solfege'), 'до¹');
  assert.equal(M.fullName(31, 1, 'solfege'), 'фа-диез первой октавы');
});

test('Ошибка из-за ключевых знаков: вспыхивает знак своей буквы', () => {
  const piece = { shift: { treble: 0 }, measures: [{ time: [4, 4], key: 2, items: [n(31, 4, { acc: 1 }), n(32), n(33), n(34)] }] };
  const score = M.buildScore(piece, 'treble');
  const rows = M.layoutRows(score, 400), vb = M.scoreVBox(score);
  const svg = M.renderRow(score, rows[0], { W: 400, vb, cur: score.notes[0], ghost: { d: 31, acc: 0 }, keyFlash: 3 });
  assert.equal((svg.match(/key-flash/g) || []).length, 1, 'подсвечен один знак — фа-диез');
  assert.ok(!M.renderRow(score, rows[0], { W: 400, vb, cur: score.notes[0] }).includes('key-flash'));
});

/* ---------- Игра на оценку (FR-PC-12) ---------- */
const quarters = (ds, tempo = 120, time = [4, 4]) => ({ id: 't', title: 't', shift: { treble: 0 },
  measures: [{ time, key: 0, tempo, items: ds.slice(0, 4).map((d) => ({ d, acc: 0, len: 4 })) }, { items: ds.slice(4).map((d) => ({ d, acc: 0, len: 4 })) }] });

test('FR-PC-12: отклонение ритма — сумма расхождений промежутков к длине пьесы; пример: 8 нот через 0,25 с и заминка 1 с', () => {
  const exp = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75];
  const act = [10, 11, 11.25, 11.5, 11.75, 12, 12.25, 12.5]; // первая нота, думал 1 с, дальше ровно через 0,25 с
  const r = M.rhythmResult(exp, act);
  assert.ok(Math.abs(r.diff - 0.75) < 1e-9, String(r.diff));
  assert.deepEqual([r.total, r.n, r.dev], [1.75, 7, 43]); // 0,75 / 1,75 = 42,9 % — вверх до целого: ★ (★★ — до 0,7 с)
  assert.equal(M.rhythmResult(exp, exp.map((t) => t + 5)).dev, 0); // ровно в темпе, с любого момента
  assert.equal(M.rhythmResult(exp, exp.map((t, i) => t + (i % 2 ? 0.02 : -0.02))).dev, 16); // дрожание ±20 мс: 0,28 с из 1,75
  assert.equal(M.rhythmResult(exp, exp.map((t) => 2 * t)).dev, 100); // вдвое медленнее — каждый промежуток расходится на свою длину
  // та же заминка в длинной пьесе почти не заметна: 60 промежутков по 0,5 с
  const long = Array.from({ length: 61 }, (_, i) => i * 0.5);
  assert.equal(M.rhythmResult(long, long.map((t, i) => t + (i ? 1 : 0))).dev, 4);
  // несыгранная нота выпадает вместе с соседними промежутками
  assert.deepEqual(M.rhythmResult([0, 1, 2, 3], [0, null, 2, 3.5]), { diff: 0.5, total: 1, n: 1, dev: 50 });
});

test('FR-PC-12: звёзды — ★ за ноты без ошибок, ★★ — отклонение ритма до 40 %, ★★★ — до 20 %', () => {
  assert.deepEqual([[1, 0], [0, 0], [0, 20], [0, 21], [0, 40], [0, 41], [0, 100]].map(([e, d]) => M.pieceStars(e, d)), [0, 3, 3, 2, 2, 1, 1]);
});

test('FR-PC-12: эталон ритма — моменты нот пьесы в её темпе, лиги не звучат заново', () => {
  const piece = { id: 't', title: 't', shift: { treble: 0 }, measures: [{ time: [4, 4], key: 0, tempo: 120,
    items: [{ d: 30, acc: 0, len: 2, tie: true }, { d: 30, acc: 0, len: 4 }, { d: 32, acc: 0, len: 4 }] }, { tempo: 60, items: [{ d: 33, acc: 0, len: 1 }] }] };
  assert.deepEqual(M.noteTimes(M.buildScore(piece, 'treble')), [0, 1.5, 2]);
});

test('FR-PC-12: метроном — доли по размеру, счёт такт (или два, если такт короче 1,6 с), затакт на своих долях', () => {
  const beats = (piece) => M.metronomeBeats(M.buildScore(piece, 'treble')).map((b) => `${b.t.toFixed(2)}:${b.n}${b.count ? 'c' : ''}`);
  // 4/4, ♩ = 120: такт 2 с — счёт один такт
  assert.deepEqual(beats(quarters([28, 29, 30, 31, 32, 33, 34, 35])).slice(0, 6), ['-2.00:1c', '-1.50:2c', '-1.00:3c', '-0.50:4c', '0.00:1', '0.50:2']);
  // 3/4, ♩ = 100, затакт в четверть: счёт «1 2 3 | 1 2», затакт — на третьей доле
  const hb = { id: 'h', title: 'h', shift: { treble: 0 }, measures: [
    { time: [3, 4], key: 0, tempo: 100, pickup: true, items: [{ d: 32, acc: 0, len: 4 }] },
    { items: [{ d: 33, acc: 0, len: 4 }, { d: 32, acc: 0, len: 4 }, { d: 35, acc: 0, len: 4 }] }] };
  assert.deepEqual(beats(hb), ['-3.00:1c', '-2.40:2c', '-1.80:3c', '-1.20:1c', '-0.60:2c', '0.00:3', '0.60:1', '1.20:2', '1.80:3']);
  // 3/8 — доля четверть с точкой; ♩ = 72: такт 1,25 с — счёт два такта
  const e38 = { id: 'e', title: 'e', shift: { treble: 0 }, measures: [{ time: [3, 8], key: 0, tempo: 72, items: [{ d: 30, acc: 0, len: 8 }, { d: 31, acc: 0, len: 8 }, { d: 32, acc: 0, len: 8 }] }] };
  assert.deepEqual(beats(e38), ['-2.50:1c', '-1.25:1c', '0.00:1']);
});
