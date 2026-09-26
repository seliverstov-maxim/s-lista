// Тесты музыкальной логики и нотного движка (src/music.js). Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { M } from './helpers/load-music.mjs';

const piecesDir = new URL('../pieces/', import.meta.url);
const samples = readdirSync(piecesDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => JSON.parse(readFileSync(new URL(f, piecesDir), 'utf8')));
const seeded = (seed = 7) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const n = (d, len = 4, extra = {}) => ({ d, acc: 0, len, ...extra });

test('FR-RND-02: диапазон по добавочным линейкам — как в таблице спецификации', () => {
  const name = (d) => M.shortName(d);
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
