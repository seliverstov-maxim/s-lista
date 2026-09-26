// Тесты инструмента загрузки пьес: scripts/add-piece.mjs и scripts/lib/*. Запуск: npm test
// Требования — docs/spec-2.0.md: FR-PC-02 (версии для двух ключей), FR-TOOL-01…04, «Данные пьесы».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';
import { parseXml, kids, textOf, decodeText } from '../scripts/lib/xml.mjs';
import { readMxl } from '../scripts/lib/zip.mjs';
import { convert, ledgerLines, chooseShift } from '../scripts/lib/musicxml.mjs';

const TOOL = fileURLToPath(new URL('../scripts/add-piece.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

/* ---------- Сборка MusicXML для тестов ---------- */
// Нота: «C4:4» (до¹ четвертью), «F#4:8.» (с точкой), «Bb3:2~» (лига к следующей), «E4:4!» (знак в файле),
// «C5:16/begin,begin» — группировка по уровням (fh — forward hook, bh — backward hook),
// «r:4» — пауза, «R» — пауза на весь такт.
// Такт — строка нот или { notes, time: '3/4', key: -1, before: '<…>', after: '<…>', number }.
const DIV = 16;
const TYPES = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };
const HOOKS = { fh: 'forward hook', bh: 'backward hook' };
const ACC = { 1: 'sharp', '-1': 'flat', 0: 'natural' };
const pitchXml = (step, alter, octave) => `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;

function noteXml(tok, bar) {
  if (tok === 'R') return `<note><rest measure="yes"/><duration>${bar}</duration><voice>1</voice></note>`;
  const m = tok.match(/^(r|[A-G](?:#|b)?\d):(\d+)(\.{0,2})(~?)(!?)(?:\/(.+))?$/);
  if (!m) throw new Error('Не разобрать ноту ' + tok);
  const [, p, lenS, dotS, tie, acc, beams] = m;
  const len = +lenS, dots = dotS.length;
  let dur = (DIV * 4) / len;
  for (let k = 1, add = dur / 2; k <= dots; k++, add /= 2) dur += add;
  const alter = p.includes('#') ? 1 : p.length > 2 && p[1] === 'b' ? -1 : 0;
  let s = '<note>' + (p === 'r' ? '<rest/>' : pitchXml(p[0], alter, p.at(-1)));
  s += `<duration>${dur}</duration>` + (tie ? '<tie type="start"/>' : '') + `<voice>1</voice><type>${TYPES[len]}</type>` + '<dot/>'.repeat(dots);
  if (acc) s += `<accidental>${ACC[alter]}</accidental>`;
  if (beams) beams.split(',').forEach((b, i) => { if (b) s += `<beam number="${i + 1}">${HOOKS[b] || b}</beam>`; });
  if (tie) s += '<notations><tied type="start"/></notations>';
  return s + '</note>';
}

function score({ title = 'Тестовая пьеса', composer = 'Автор', rights = 'CC0 1.0', time = '4/4', key = 0, parts = 1, firstAttrs = '', measures } = {}) {
  const part = (id) => {
    let [b, bt] = time.split('/').map(Number);
    const body = measures.map((mm, i) => {
      const o = typeof mm === 'string' ? { notes: mm } : mm;
      let attrs = '';
      if (i === 0) attrs = `<divisions>${DIV}</divisions><key><fifths>${key}</fifths></key><time><beats>${b}</beats><beat-type>${bt}</beat-type></time><clef><sign>G</sign><line>2</line></clef>${firstAttrs}`;
      if (i > 0 && o.key != null) attrs += `<key><fifths>${o.key}</fifths></key>`;
      if (i > 0 && o.time) { [b, bt] = o.time.split('/').map(Number); attrs += `<time><beats>${b}</beats><beat-type>${bt}</beat-type></time>`; }
      const bar = (DIV * 4 * b) / bt;
      const toks = (o.notes || '').trim().split(/\s+/).filter(Boolean);
      return `<measure number="${o.number ?? i + 1}">${attrs ? `<attributes>${attrs}</attributes>` : ''}${o.before || ''}${toks.map((t) => noteXml(t, bar)).join('')}${o.after || ''}</measure>`;
    }).join('\n');
    return `<part id="${id}">\n${body}\n</part>`;
  };
  const ids = Array.from({ length: parts }, (_, i) => `P${i + 1}`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
${title ? `<work><work-title>${title}</work-title></work>` : ''}
<identification>${composer ? `<creator type="composer">${composer}</creator>` : ''}${rights ? `<rights>${rights}</rights>` : ''}</identification>
<part-list>${ids.map((id) => `<score-part id="${id}"><part-name>Piano</part-name></score-part>`).join('')}</part-list>
${ids.map(part).join('\n')}
</score-partwise>
`;
}

// Нота без знаков, группировки и лиг — для сравнения с результатом
const n = (d, len, extra = {}) => ({ d, acc: 0, len, ...extra });
const ok = (xml, meta) => {
  const r = convert(xml, meta);
  assert.deepEqual(r.errors, [], 'неожиданные ошибки');
  return r;
};
const rejects = (xml, re, meta) => {
  const r = convert(xml, meta);
  assert.equal(r.piece, null, 'пьеса должна быть отклонена');
  assert.ok(r.errors.some((e) => re.test(e)), `нет ошибки ${re}; есть: ${r.errors.join(' | ')}`);
  return r;
};

/* ---------- XML и zip ---------- */
test('XML: сущности, CDATA, комментарии, DOCTYPE с внутренним подмножеством, кавычки обоих видов', () => {
  const x = parseXml(`﻿<?xml version="1.0"?>
<!DOCTYPE a [ <!ENTITY x "y"> <!ELEMENT a ANY> ]>
<!-- комментарий <b> -->
<a k="1" m='два &amp; три'><b>&lt;&#x41;&#66;&gt; &quot;q&apos;</b><c/><d><![CDATA[<не тег>]]></d><?pi x?></a>`);
  assert.equal(x.name, 'a');
  assert.deepEqual(x.attrs, { k: '1', m: 'два & три' });
  assert.equal(textOf(x, 'b'), `<AB> "q'`);
  assert.equal(kids(x, 'c').length, 1);
  assert.equal(textOf(x, 'd'), '<не тег>');
});

test('XML: ошибки разметки называют строку', () => {
  assert.throws(() => parseXml('<a>\n<b></a>'), /ожидался <\/b>.*строка 2/);
  assert.throws(() => parseXml('<a><b></b>'), /не закрыт элемент <a>/);
  assert.throws(() => parseXml('просто текст'), /нет корневого элемента/);
  assert.throws(() => parseXml('<a x=1/>'), /без кавычек/);
});

test('XML: текст в UTF-16 с меткой порядка байтов', () => {
  const s = '<a>Ода</a>';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
  assert.equal(decodeText(le), s);
  const be = Buffer.from(le); // переставим байты
  for (let i = 0; i + 1 < be.length; i += 2) { const t = be[i]; be[i] = be[i + 1]; be[i + 1] = t; }
  assert.equal(decodeText(be), s);
});

// Минимальный zip-архив: stored для mimetype, deflate для остального — как у MuseScore
function makeZip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text, store] of files) {
    const raw = Buffer.from(text), data = store ? raw : deflateRawSync(raw), nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(store ? 0 : 8, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(store ? 0 : 8, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const CONTAINER = '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';
const SIMPLE = score({ measures: ['C4:4 D4:4 E4:4 F4:4', 'G4:1'] });
const mxlOf = (xml) => makeZip([['mimetype', 'application/vnd.recordare.musicxml', true], ['META-INF/container.xml', CONTAINER], ['score.musicxml', xml]]);

test('FR-TOOL-01: сжатый MusicXML (.mxl) читается через META-INF/container.xml', () => {
  assert.equal(readMxl(mxlOf(SIMPLE)), SIMPLE);
  const r = ok(readMxl(mxlOf(SIMPLE)));
  assert.equal(r.piece.measures.length, 2);
  assert.throws(() => readMxl(Buffer.from('не архив')), /не zip-архив/);
});

/* ---------- Правило линеек и версии для двух ключей ---------- */
test('FR-RND-02 для пьес: 3 линейки — скрипичный фа…ми³ (24…44), басовый Ля₁…соль¹ (12…32)', () => {
  const fits = (d, clef) => ledgerLines(d, clef) <= 3;
  assert.ok(fits(24, 'treble') && fits(44, 'treble') && !fits(23, 'treble') && !fits(45, 'treble'));
  assert.ok(fits(12, 'bass') && fits(32, 'bass') && !fits(11, 'bass') && !fits(33, 'bass'));
  // при 0 линеек — только ноты на стане: ми¹…фа² и Соль…ля
  assert.equal(ledgerLines(30, 'treble'), 0); assert.equal(ledgerLines(38, 'treble'), 0);
  assert.equal(ledgerLines(29, 'treble'), 1); assert.equal(ledgerLines(39, 'treble'), 1);
  assert.equal(ledgerLines(18, 'bass'), 0); assert.equal(ledgerLines(26, 'bass'), 0);
});

test('FR-PC-02: мелодия до¹–до² — скрипичная версия без сдвига, басовая на октаву ниже', () => {
  const r = ok(score({ measures: ['C4:4 D4:4 E4:4 F4:4', 'G4:4 A4:4 B4:4 C5:4'] }));
  assert.deepEqual(r.piece.shift, { treble: 0, bass: -1 });
});

test('FR-PC-02: ля малой – ля¹ (как «Ода к радости») — скрипичная на октаву выше, басовая на октаву ниже', () => {
  assert.equal(chooseShift([26, 33], 'treble'), 1);
  assert.equal(chooseShift([26, 33], 'bass'), -1);
});

test('FR-PC-02: самая широкая мелодия, фа малой – ми³ (без секунды три октавы), помещается только в скрипичный ключ', () => {
  // фа малой (24) … ми³ (44): в скрипичном ровно 3 линейки снизу и сверху, в басовом не хватает ни при каком сдвиге
  const r = ok(score({ measures: ['F3:4 C4:4 E6:4 C5:4'] }));
  assert.deepEqual(r.piece.shift, { treble: 0 });
});

test('FR-PC-02: мелодия шире — ни одной версии, пьеса отклоняется', () => {
  rejects(score({ measures: ['F3:4 C4:4 F6:4 C5:4'] }), /не помещается ни в скрипичный, ни в басовый/);
});

/* ---------- Преобразование ---------- */
test('«Данные пьесы»: затакт, лиги, паузы, точки, группировка из файла, ключевые знаки, смена размера, знаки из файла', () => {
  const xml = score({
    title: 'Проверка', composer: 'Композитор', rights: 'CC BY 4.0', key: 1, measures: [
      'D4:4',
      'G4:4. A4:8 B4:8/begin C5:8/end D5:4~',
      'D5:2 r:4 F4:8!/begin F#4:8!/end',
      { time: '3/4', notes: 'E4:16/begin,begin F#4:16/continue,end G4:8/end A4:2' },
      'R',
    ],
  });
  const r = ok(xml);
  assert.equal(r.piece.title, 'Проверка');
  assert.equal(r.piece.composer, 'Композитор');
  assert.equal(r.piece.license, 'CC BY 4.0');
  assert.deepEqual(r.piece.measures, [
    { time: [4, 4], key: 1, pickup: true, items: [n(29, 4)] },
    { items: [n(32, 4, { dots: 1 }), n(33, 8), n(34, 8, { beam: ['begin'] }), n(35, 8, { beam: ['end'] }), n(36, 4, { tie: true })] },
    { items: [n(36, 2), { rest: true, len: 4 }, n(31, 8, { mark: 0, beam: ['begin'] }), { d: 31, acc: 1, len: 8, mark: 1, beam: ['end'] }] },
    { time: [3, 4], items: [n(30, 16, { beam: ['begin', 'begin'] }), { d: 31, acc: 1, len: 16, beam: ['continue', 'end'] }, n(32, 8, { beam: ['end'] }), n(33, 2)] },
    { items: [{ rest: true, measure: true }] },
  ]);
  assert.deepEqual(r.piece.shift, { treble: 0, bass: -1 });
  assert.deepEqual(r.warnings, []);
});

test('Ключ, смена тональности и размера пишутся только там, где меняются', () => {
  const r = ok(score({ key: -2, measures: ['Bb4:2 Eb5:2', { key: -2, notes: 'D5:1' }, { key: 0, notes: 'C5:1' }, { time: '4/4', notes: 'C5:1' }] }));
  assert.deepEqual(r.piece.measures.map(({ items, ...m }) => m), [{ time: [4, 4], key: -2 }, {}, { key: 0 }, {}]);
});

test('Знаки альтерации вычисляются по тональности, если в файле их нет: действуют до конца такта, лига через черту — без знака', () => {
  const r = ok(score({ key: 1, measures: ['F#4:4 F4:4 F4:4 F#4:4', 'F4:4 r:4 Bb4:2~', 'Bb4:4 Bb4:4 G4:2'] }));
  const marks = r.piece.measures.map((m) => m.items.map((it) => (it.rest ? 'r' : it.mark === undefined ? '-' : it.mark)));
  assert.deepEqual(marks, [['-', 0, '-', 1], [0, 'r', -1], ['-', -1, '-']]);
  assert.equal(r.piece.measures[1].items[2].tie, true);
});

test('Знаки из файла: если в файле есть хоть один <accidental>, вычислять ничего не нужно', () => {
  const r = ok(score({ key: 0, measures: ['F#4:4! F#4:4 F4:4 C#5:4'] }));
  assert.deepEqual(r.piece.measures[0].items.map((it) => it.mark), [1, undefined, undefined, undefined]);
});

test('Лига к ноте другой высоты не учитывается и даёт предупреждение', () => {
  const r = ok(score({ measures: ['C4:2~ D4:2'] }));
  assert.equal(r.piece.measures[0].items[0].tie, undefined);
  assert.match(r.warnings.join(), /Такт 1: лига ведёт не к ноте той же высоты/);
});

test('Группировка по долям, если в файле её нет: 4/4 — по четвертям, паузы рвут группу, шестнадцатые — второй уровень', () => {
  const r = ok(score({ measures: ['C4:8 D4:8 E4:8 F4:8 G4:8 r:8 A4:8 B4:8', 'C4:16 D4:16 E4:8 F4:8. G4:16 A4:2'] }));
  const beams = (m) => r.piece.measures[m].items.map((it) => (it.beam ? it.beam.join('+') : '-'));
  assert.deepEqual(beams(0), ['begin', 'end', 'begin', 'end', '-', '-', 'begin', 'end']);
  assert.deepEqual(beams(1), ['begin+begin', 'continue+end', 'end', 'begin', 'end+backward hook', '-']);
});

test('Группировка по долям: 6/8 — по три восьмые, 3/8 — весь такт, 2/2 — по половинам, затакт считается от конца такта', () => {
  const six = ok(score({ time: '6/8', measures: ['C4:8 D4:8 E4:8 F4:8 G4:8 A4:8'] }));
  assert.deepEqual(six.piece.measures[0].items.map((it) => it.beam[0]), ['begin', 'continue', 'end', 'begin', 'continue', 'end']);
  const three = ok(score({ time: '3/8', measures: ['C4:8 D4:8 E4:8'] }));
  assert.deepEqual(three.piece.measures[0].items.map((it) => it.beam[0]), ['begin', 'continue', 'end']);
  const cut = ok(score({ time: '2/2', measures: ['C4:8 D4:8 E4:8 F4:8 G4:2'] }));
  assert.deepEqual(cut.piece.measures[0].items.map((it) => (it.beam ? it.beam[0] : '-')), ['begin', 'continue', 'continue', 'end', '-']);
  // затакт из трёх восьмых в 4/4: первая — одна в своей доле, две последние — вместе
  const pick = ok(score({ measures: ['C4:8 D4:8 E4:8', 'F4:1'] }));
  assert.equal(pick.piece.measures[0].pickup, true);
  assert.deepEqual(pick.piece.measures[0].items.map((it) => (it.beam ? it.beam[0] : '-')), ['-', 'begin', 'end']);
});

test('Нарушенная группировка в файле строится заново по долям', () => {
  const r = ok(score({ measures: ['C4:8/begin D4:8/begin E4:8/end F4:8 G4:2'] }));
  assert.deepEqual(r.piece.measures[0].items.map((it) => (it.beam ? it.beam[0] : '-')), ['begin', 'end', 'begin', 'end', '-']);
  assert.match(r.warnings.join(), /группировка нот в файле нарушена/);
});

test('Пауза на весь такт — measure: true, в том числе целая пауза в размере 3/4', () => {
  const r = ok(score({ time: '3/4', measures: ['C4:2.', '<note><rest/><duration>48</duration><voice>1</voice><type>whole</type></note>', 'R', 'E4:2.'].map((s) => (s.startsWith('<') ? { after: s } : s)) }));
  assert.deepEqual(r.piece.measures.slice(1, 3).map((m) => m.items), [[{ rest: true, measure: true }], [{ rest: true, measure: true }]]);
});

test('Нота без <type>: вид длительности выводится из <duration>', () => {
  const noType = (step, dur) => `<note>${pitchXml(step, 0, 4)}<duration>${dur}</duration><voice>1</voice></note>`;
  const r = ok(score({ measures: [{ after: noType('C', 24) + noType('D', 8) + noType('E', 32) }] }));
  assert.deepEqual(r.piece.measures[0].items, [n(28, 4, { dots: 1 }), n(29, 8), n(30, 2)]);
});

test('Метаданные из флагов перекрывают файл; игнорируется оформление без влияния на ноты', () => {
  const noise = '<direction><direction-type><dynamics><f/></dynamics></direction-type><sound tempo="96"/></direction><print new-system="yes"/><harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>';
  const lyricNote = `<note>${pitchXml('C', 0, 4)}<duration>64</duration><voice>1</voice><type>whole</type><stem>up</stem><notations><fermata/><slur type="start"/><articulations><staccato/></articulations><technical><fingering>1</fingering></technical></notations><lyric><text>ля</text></lyric></note>`;
  const r = ok(score({ title: 'В файле', composer: 'Из файла', measures: [{ before: noise, after: lyricNote }] }), { title: 'Из флага', composer: 'Флаг', license: 'CC0' });
  assert.equal(r.piece.title, 'Из флага');
  assert.equal(r.piece.composer, 'Флаг');
  assert.equal(r.piece.license, 'CC0');
  assert.deepEqual(r.piece.measures[0].items, [n(28, 1)]);
});

/* ---------- Отказы (FR-TOOL-02) ---------- */
const P = (step, oct, extra = '', dur = 16, type = 'quarter') => `<note>${pitchXml(step, 0, oct)}<duration>${dur}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
const REJECTS = [
  ['не MusicXML', '<html><body/></html>', /не MusicXML/],
  ['score-timewise', '<score-timewise/>', /score-timewise/],
  ['не XML вообще', 'просто текст', /не читается как XML/],
  ['две партии', score({ parts: 2, measures: ['C4:1'] }), /2 партии/],
  ['два стана', score({ firstAttrs: '<staves>2</staves>', measures: ['C4:1'] }), /2 стана/],
  ['второй голос', score({ measures: [{ notes: 'C4:4 D4:4 E4:4', after: '<note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><voice>2</voice><type>quarter</type></note>' }] }), /второй голос/],
  ['аккорд', score({ measures: [{ notes: 'C4:4 D4:4 E4:4 F4:4', after: `<note><chord/>${pitchXml('A', 0, 4)}<duration>16</duration><voice>1</voice><type>quarter</type></note>` }] }), /аккорд/],
  ['форшлаг', score({ measures: [{ before: `<note><grace/>${pitchXml('D', 0, 4)}<voice>1</voice><type>eighth</type></note>`, notes: 'C4:1' }] }), /форшлаг/],
  ['ноты-подсказки', score({ measures: [{ notes: 'C4:2', after: `<note><cue/>${pitchXml('D', 0, 4)}<duration>32</duration><voice>1</voice><type>half</type></note>` }] }), /cue/],
  ['триоль', score({ measures: [{ notes: 'C4:4 D4:4 E4:4', after: P('G', 4, '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>', 16 / 3, 'eighth').repeat(3) }] }), /триоль/],
  ['второй голос через backup', score({ measures: [{ notes: 'C4:1', after: '<backup><duration>64</duration></backup>' + P('E', 4, '', 64, 'whole') }] }), /backup/],
  ['ударные без высоты', score({ measures: [{ notes: 'C4:2.', after: '<note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>16</duration><voice>1</voice><type>quarter</type></note>' }] }), /ударные/],
  ['знак повтора', score({ measures: ['C4:1', { notes: 'D4:1', after: '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>' }] }), /знак повтора/],
  ['вольта', score({ measures: ['C4:1', { before: '<barline location="left"><ending number="1" type="start"/></barline>', notes: 'D4:1' }] }), /вольта/],
  ['D.C.', score({ measures: ['C4:1', { notes: 'D4:1', after: '<direction><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo="yes"/></direction>' }] }), /D\.C\./],
  ['сеньо', score({ measures: [{ before: '<direction><direction-type><segno/></direction-type></direction>', notes: 'C4:1' }] }), /сеньо/],
  ['дубль-диез', score({ measures: [{ notes: 'C4:2 D4:4', after: `<note>${pitchXml('F', 2, 4)}<duration>16</duration><voice>1</voice><type>quarter</type><accidental>double-sharp</accidental></note>` }] }), /дубль-диез/],
  ['особый знак', score({ measures: [{ notes: 'C4:2 D4:4', after: `<note>${pitchXml('F', 1, 4)}<duration>16</duration><voice>1</voice><type>quarter</type><accidental>sharp-sharp</accidental></note>` }] }), /sharp-sharp/],
  ['четвертитон', score({ measures: [{ notes: 'C4:2 D4:4', after: `<note>${pitchXml('F', 0.5, 4)}<duration>16</duration><voice>1</voice><type>quarter</type></note>` }] }), /четвертитон/],
  ['тридцать вторые', score({ measures: ['C4:32 D4:32 E4:16 F4:8 G4:4 A4:2'] }), /тридцать вторые/],
  ['бревис', score({ measures: [{ after: P('C', 4, '', 128, 'breve') }, 'C4:1'] }), /бревис/],
  ['длительность не раскладывается', score({ measures: [{ notes: 'C4:2 D4:4', after: `<note>${pitchXml('E', 0, 4)}<duration>5</duration><voice>1</voice></note>` + P('F', 4, '', 11, 'eighth').replace('<type>eighth</type>', '') }] }), /не раскладывается/],
  ['вид не совпадает с длительностью', score({ measures: [{ notes: 'C4:2 D4:4', after: P('E', 4, '', 8, 'quarter') }, 'C4:1'] }), /не совпадает с её длительностью/],
  ['неполный такт в середине', score({ measures: ['C4:1', 'C4:4 D4:4 E4:4', 'F4:1'] }), /Такт 2: сумма длительностей — 3 четверти, а размер 4\/4 требует 4 четверти/],
  ['переполненный такт', score({ measures: ['C4:1', 'C4:2 D4:2 E4:4', 'F4:1'] }), /сумма длительностей — 5 четвертей/],
  ['смена тональности посреди такта', score({ measures: [{ notes: 'C4:2', after: '<attributes><key><fifths>2</fifths></key></attributes>' + P('D', 4, '', 32, 'half') }] }), /посреди такта/],
  ['нестандартная тональность', score({ measures: ['C4:1', { before: '<attributes><key><key-step>F</key-step><key-alter>1</key-alter></key></attributes>', notes: 'C4:1' }] }), /нестандартные ключевые знаки/],
  ['составной размер', score({ measures: ['C4:1', { before: '<attributes><time><beats>3+2</beats><beat-type>8</beat-type></time></attributes>', notes: 'C4:2 D4:8' }] }), /составной/],
  ['senza misura', score({ measures: ['C4:1', { before: '<attributes><time><senza-misura/></time></attributes>', notes: 'C4:1' }] }), /senza misura/],
  ['нет размера', score({ measures: ['C4:1'] }).replace(/<time>.*?<\/time>/, ''), /нет размера/],
  ['транспонирующий инструмент', score({ firstAttrs: '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>', measures: ['C4:1'] }), /транспонирующего инструмента/],
  ['нет ни одной ноты', score({ measures: ['r:1', 'R'] }), /нет ни одной ноты/],
  ['нет лицензии', score({ rights: '', measures: ['C4:1'] }), /Не указана лицензия/],
  ['нет названия', score({ title: '', measures: ['C4:1'] }), /Нет названия/],
];
for (const [name, xml, re] of REJECTS) test(`FR-TOOL-02: отказ — ${name}`, () => { rejects(xml, re); });

test('FR-TOOL-02: собираются все ошибки, а не только первая, с номерами тактов', () => {
  const r = rejects(score({ measures: [{ notes: 'C4:4 D4:4 E4:4 F4:4', after: `<note><chord/>${pitchXml('A', 0, 4)}<duration>16</duration><voice>1</voice><type>quarter</type></note>` }, { before: `<note><grace/>${pitchXml('D', 0, 4)}<voice>1</voice><type>eighth</type></note>`, notes: 'C4:1' }, 'C4:32 D4:32 E4:16 F4:8 G4:4 A4:2'] }), /аккорд/);
  assert.ok(r.errors.some((e) => /^Такт 1: аккорд/.test(e)));
  assert.ok(r.errors.some((e) => /^Такт 2: форшлаг/.test(e)));
  assert.ok(r.errors.some((e) => /^Такт 3: тридцать вторые/.test(e)));
});

test('FR-TOOL-02: лицензия из флага принимается, если в файле её нет', () => {
  const r = ok(score({ rights: '', measures: ['C4:1'] }), { license: 'CC0 1.0' });
  assert.equal(r.piece.license, 'CC0 1.0');
});

/* ---------- Командная строка ---------- */
const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'slista-pieces-'));

test('FR-TOOL-03: add-piece пишет JSON, копию исходника и список; id — транслитерация названия', () => {
  const root = tmp(), file = join(root, 'input.musicxml');
  try {
    const xml = score({ title: 'Братец Яков', composer: 'Народная', rights: '', measures: ['C4:4 D4:4 E4:4 C4:4', 'C4:4 D4:4 E4:4 C4:4'] });
    writeFileSync(file, xml);
    const r = run([file, '--root', root, '--license', 'CC0 1.0', '--source', 'https://example.org/x']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const piece = JSON.parse(readFileSync(join(root, 'pieces/bratets-yakov.json'), 'utf8'));
    assert.deepEqual(Object.keys(piece), ['id', 'title', 'composer', 'license', 'source', 'shift', 'measures']);
    assert.equal(piece.id, 'bratets-yakov');
    assert.equal(piece.license, 'CC0 1.0');
    assert.equal(piece.source, 'https://example.org/x');
    assert.equal(readFileSync(join(root, 'pieces/src/bratets-yakov.musicxml'), 'utf8'), xml);
    const index = JSON.parse(readFileSync(join(root, 'pieces/index.json'), 'utf8'));
    assert.deepEqual(index, { pieces: [{ id: 'bratets-yakov', title: 'Братец Яков', composer: 'Народная', clefs: ['treble', 'bass'] }] });
    // формат: поля — по строке, каждый такт — одной строкой
    const lines = readFileSync(join(root, 'pieces/bratets-yakov.json'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1 + 6 + 1 + piece.measures.length + 2);
    assert.match(r.stdout, /Готово: «Братец Яков»/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('FR-TOOL-03: без --force существующая пьеса не перезаписывается; с --force заменяется', () => {
  const root = tmp(), file = join(root, 'a.musicxml');
  try {
    writeFileSync(file, score({ title: 'Пьеса', measures: ['C4:1'] }));
    assert.equal(run([file, '--root', root]).status, 0);
    const again = run([file, '--root', root]);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /уже есть.*--force/);
    writeFileSync(file, score({ title: 'Пьеса', measures: ['D4:1'] }));
    assert.equal(run([file, '--root', root, '--force']).status, 0);
    const piece = JSON.parse(readFileSync(join(root, 'pieces/pesa.json'), 'utf8'));
    assert.equal(piece.measures[0].items[0].d, 29);
    assert.equal(JSON.parse(readFileSync(join(root, 'pieces/index.json'), 'utf8')).pieces.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('FR-TOOL-01: --check только проверяет и ничего не пишет; ошибки — код 1 и список', () => {
  const root = tmp(), good = join(root, 'good.musicxml'), bad = join(root, 'bad.musicxml');
  try {
    writeFileSync(good, score({ title: 'Хорошая', measures: ['C4:4 D4:4 E4:4 F4:4'] }));
    const r = run([good, '--root', root, '--check']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Проверка пройдена/);
    assert.match(r.stdout, /Скрипичный ключ: сдвиг на октаву вверх, ноты от C5 до F5/);
    assert.match(r.stdout, /Басовый ключ: сдвиг на октаву вниз, ноты от C3 до F3/);
    assert.equal(existsSync(join(root, 'pieces')), false);
    writeFileSync(bad, score({ title: 'Плохая', measures: [{ notes: 'C4:4 D4:4 E4:4 F4:4', after: `<note><chord/>${pitchXml('A', 0, 4)}<duration>16</duration><voice>1</voice><type>quarter</type></note>` }] }));
    const e = run([bad, '--root', root]);
    assert.equal(e.status, 1);
    assert.match(e.stderr, /Пьеса не подходит:\n  • Такт 1: аккорд/);
    assert.equal(existsSync(join(root, 'pieces')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('FR-TOOL-01: .mxl добавляется, исходник копируется с расширением .mxl', () => {
  const root = tmp(), file = join(root, 'song.mxl');
  try {
    writeFileSync(file, mxlOf(score({ title: 'Zip Song', measures: ['E4:2 G4:2'] })));
    const r = run([file, '--root', root, '--id', 'zip-song']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(join(root, 'pieces/src')), ['zip-song.mxl']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('FR-TOOL-03: --rebuild пересобирает данные из исходников, метаданные берёт из JSON', () => {
  const root = tmp(), file = join(root, 'x.musicxml');
  try {
    writeFileSync(file, score({ title: 'Исходное', measures: ['C4:4 D4:4 E4:4 F4:4'] }));
    assert.equal(run([file, '--root', root, '--id', 'x']).status, 0);
    const path = join(root, 'pieces/x.json');
    const piece = JSON.parse(readFileSync(path, 'utf8'));
    const measures = piece.measures;
    writeFileSync(path, JSON.stringify({ ...piece, title: 'Переименовано', measures: [] }));
    const r = run(['--rebuild', '--root', root]);
    assert.equal(r.status, 0, r.stderr);
    const rebuilt = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(rebuilt.title, 'Переименовано');
    assert.deepEqual(rebuilt.measures, measures);
    assert.equal(JSON.parse(readFileSync(join(root, 'pieces/index.json'), 'utf8')).pieces[0].title, 'Переименовано');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Командная строка: неизвестный флаг и отсутствующий файл — понятное сообщение и код 1', () => {
  const a = run(['--bogus']);
  assert.equal(a.status, 1);
  assert.match(a.stderr, /Неизвестный флаг --bogus/);
  const b = run(['нет-такого.mxl']);
  assert.equal(b.status, 1);
  assert.match(b.stderr, /Файл не найден/);
});

/* ---------- Пьесы в репозитории ---------- */
test('pieces/: данные совпадают с тем, что инструмент собирает из исходников, список согласован', () => {
  const dir = join(REPO, 'pieces');
  if (!existsSync(join(dir, 'index.json'))) return;
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).pieces;
  const srcs = readdirSync(join(dir, 'src'));
  assert.equal(srcs.length, index.length, 'на каждую пьесу — один исходник');
  for (const entry of index) {
    const piece = JSON.parse(readFileSync(join(dir, `${entry.id}.json`), 'utf8'));
    const src = srcs.find((f) => basename(f, extname(f)) === entry.id);
    assert.ok(src, `нет исходника для ${entry.id}`);
    const buf = readFileSync(join(dir, 'src', src));
    const xml = extname(src) === '.mxl' ? readMxl(buf) : decodeText(buf);
    const r = convert(xml, { title: piece.title, composer: piece.composer, license: piece.license });
    assert.deepEqual(r.errors, [], entry.id);
    assert.deepEqual(r.piece.measures, piece.measures, `${entry.id}: данные устарели — запустите npm run add-piece -- --rebuild`);
    assert.deepEqual(r.piece.shift, piece.shift, entry.id);
    assert.deepEqual(entry, { id: piece.id, title: piece.title, composer: piece.composer, clefs: ['treble', 'bass'].filter((c) => c in piece.shift) });
  }
  const titles = index.map((e) => e.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, 'ru')), 'список отсортирован по названию');
});
