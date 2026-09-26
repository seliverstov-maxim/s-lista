// Тесты перевода LilyPond → MusicXML: scripts/lib/lilypond.mjs (FR-TOOL-01). Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLy, lyToMusicXml, LyError } from '../scripts/lib/lilypond.mjs';
import { convert } from '../scripts/lib/musicxml.mjs';

const TOOL = fileURLToPath(new URL('../scripts/add-piece.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const L = 'CDEFGAB';
const ACC = { 1: '#', 2: '##', '-1': 'b', '-2': 'bb' };
// события кратко: «C4/4», «F#5/8.», «Bb4/2~», «r/4», «R», «[key -1]», «[2/4]», «[♩=90]»
const brief = (events) => events.map((e) => {
  if (e.kind === 'note') return `${L[((e.d % 7) + 7) % 7]}${ACC[e.alter] || ''}${Math.floor(e.d / 7)}/${e.len}${'.'.repeat(e.dots)}${e.tie ? '~' : ''}`;
  if (e.kind === 'rest') return e.full ? 'R' : `r/${e.len}${'.'.repeat(e.dots)}`;
  if (e.kind === 'key') return `[key ${e.fifths}]`;
  if (e.kind === 'time') return `[${e.beats}/${e.type}]`;
  if (e.kind === 'tempo') return `[♩=${e.q}]`;
  if (e.kind === 'partial') return `[partial ${e.ticks}]`;
  return `[${e.kind}]`;
}).join(' ');
const ev = (src) => brief(parseLy(src).events);
const notes = (src) => brief(parseLy(src).events.filter((e) => e.kind === 'note'));
const rejects = (src, re) => assert.throws(() => lyToMusicXml(src), (e) => e instanceof LyError && re.test(e.message));

test('Длительности: «16» не читается как «1», точки, длительность переходит на следующие ноты', () => {
  assert.equal(notes('{ a16 b8. c\'4 d\' e\'2.. }'), 'A3/16 B3/8. C4/4 D4/4 E4/2..');
  assert.equal(notes('\\relative c\'\' { d8 g,8. a16 b4 }'), 'D5/8 G4/8. A4/16 B4/4'); // как в Jingle Bells
});

test('\\relative: ближайшая нота не дальше кварты, затем \' и ,; без опорной ноты первая нота абсолютна', () => {
  assert.equal(notes('\\relative c\'\' { d4 g,8 a b c | d4 g, g | e\' c8 d e fis | g4 g, g }'),
    'D5/4 G4/8 A4/8 B4/8 C5/8 D5/4 G4/4 G4/4 E5/4 C5/8 D5/8 E5/8 F#5/8 G5/4 G4/4 G4/4');
  assert.equal(notes('\\relative c\' { f g }'), 'F4/4 G4/4'); // фа — вверх на кварту, соль от фа — вверх
  assert.equal(notes('\\relative c\' { g }'), 'G3/4'); // соль вниз на кварту ближе, чем вверх на квинту
  assert.equal(notes('\\relative { c\'\' d b }'), 'C5/4 D5/4 B4/4');
  assert.equal(notes('\\relative a\' { e4. gis8 b4 }'), 'E4/4. G#4/8 B4/4');
});

test('\\fixed и абсолютная запись: c — до малой октавы', () => {
  assert.equal(notes('\\fixed c\' { c e g c\' }'), 'C4/4 E4/4 G4/4 C5/4');
  assert.equal(notes('{ c c\' c\'\' c, }'), 'C3/4 C4/4 C5/4 C2/4');
});

test('Названия нот: голландские, немецкие (h — си, b — си-бемоль) и английские', () => {
  assert.equal(notes('{ cis\' des\' es\' as\' bes\' eeses\' aes\' }'), 'C#4/4 Db4/4 Eb4/4 Ab4/4 Bb4/4 Ebb4/4 Ab4/4');
  assert.equal(notes('\\language "deutsch" { h\' b\' fis\' es\' as\' his\' }'), 'B4/4 Bb4/4 F#4/4 Eb4/4 Ab4/4 B#4/4');
  assert.equal(notes('\\language "english" { cs\' bf\' fss\' eff\' }'), 'C#4/4 Bb4/4 F##4/4 Ebb4/4');
  assert.equal(notes('\\include "deutsch.ly" { h\' }'), 'B4/4');
  rejects('\\language "italiano" { do }', /названия нот «italiano»/);
});

test('\\key: мажор, минор и лады; немецкое b — си-бемоль мажор', () => {
  const key = (src) => parseLy(src + ' { c\' }').events.find((e) => e.kind === 'key').fifths;
  assert.equal(key('\\key bes \\major'), -2);
  assert.equal(key('\\key fis \\minor'), 3);
  assert.equal(key('\\key d \\dorian'), 0);
  assert.equal(key('\\key e \\minor'), 1);
  assert.equal(key('\\language "deutsch" \\key b \\major'), -2);
  assert.equal(key('\\language "deutsch" \\key h \\minor'), 2);
  assert.equal(key('\\language "english" \\key bf \\major'), -2);
});

test('\\repeat с \\alternative разворачивается; \\relative считается по тексту, а не по развёрнутым нотам', () => {
  assert.equal(notes('\\relative c\'\' { \\repeat volta 2 { c4 d } \\alternative { { e2 } { f2 } } }'), 'C5/4 D5/4 E5/2 C5/4 D5/4 F5/2');
  // три прохода и две концовки: первая — у первых двух проходов
  assert.equal(notes('\\relative c\'\' { \\repeat volta 3 { c2 } \\alternative { { d2 } { e2 } } }'), 'C5/2 D5/2 C5/2 D5/2 C5/2 E5/2');
  // по развёрнутым нотам второе «до» было бы от соль¹ — до², а в LilyPond оно снова до¹
  assert.equal(notes('\\relative c\' { \\repeat unfold 2 { c4 g\' } }'), 'C4/4 G4/4 C4/4 G4/4');
  assert.equal(notes('{ \\repeat "unfold" 2 { c\'4 } \\repeat percent 2 { d\'4 } }'), 'C4/4 C4/4 D4/4 D4/4');
});

test('Форшлаг не звучит, но служит опорой для \\relative', () => {
  assert.equal(notes('\\relative c\' { c4 \\grace g\'\'8 f4 }'), 'C4/4 F5/4');
  assert.equal(notes('\\relative c\'\' { fis4 \\grace b8 a2. }'), 'F#5/4 A5/2.');
  assert.equal(notes('\\relative c\'\' { c4 \\acciaccatura { d16 e } f4 }'), 'C5/4 F5/4');
});

test('<< … >>: мелодия — первый голос с нотами; \\tempo и \\key из голосов перед ним учитываются; аккорды в других голосах не мешают', () => {
  assert.equal(ev('<< { c\'4 d\' } \\\\ { <e\' g\'>2 } >>'), 'C4/4 D4/4');
  assert.equal(ev('<< \\set Score.tempoHideNote = ##t \\tempo 4 = 90 \\relative c\'\' { c4 } \\relative c\' { <c e>4 } >>'), '[♩=90] C5/4');
  assert.equal(ev('\\new PianoStaff << \\new Staff = "up" \\with { \\remove "X" } { \\key g \\major g\'4 } \\new Staff { \\clef bass <g, b,>4 } >>'), '[key 1] G4/4');
  assert.equal(ev('<< \\chords { c1 g } \\relative c\' { e2 d } \\addlyrics { a b } >>'), 'E4/2 D4/2');
  // голос без нот с паузами-разделителями: знаки только в начале
  assert.equal(ev('global = { \\key f \\major \\time 2/4 s2*2 } << \\global \\relative c\'\' { c2 d } >>'), '[key -1] [2/4] C5/2 D5/2');
  rejects('global = { \\time 2/4 s2 \\key f \\major s2 } << \\global \\relative c\'\' { c2 d } >>', /перенесите их в мелодию/);
});

test('Переменные и несколько \\score: мелодия из первой партитуры, темп — из \\midi второй', () => {
  const src = `\\header { title = "Мост" composer = "Народная" tagline = ##f }
    \\layout { indent = 0 \\context { \\Score \\remove "Bar_number_engraver" } }
    global = { \\key f \\major \\numericTimeSignature \\time 2/4 \\autoBeamOff }
    melody = \\relative c'' { \\global \\set melismaBusyProperties = #'() \\set midiInstrument = "clarinet"
      \\repeat volta 2 { c8. (d16 c8 bes8 | a8 bes8 c4) | }
        \\alternative { { g8 (a8) bes4) | a8 (bes8 c4) | } { g4 (c4 |a8 f4.) } } \\bar "|."
    }
    verse = \\lyricmode { Lon -- don Bridge is fall -- ing down }
    \\score { << \\new Staff { \\melody } \\addlyrics { \\verse } >> \\layout { } }
    \\score { \\unfoldRepeats { << \\melody >> } \\midi { \\tempo 4=102 \\context { \\Score midiChannelMapping = #'instrument } } }`;
  const { header, events } = parseLy(src);
  assert.deepEqual(header, { title: 'Мост', composer: 'Народная' });
  assert.equal(brief(events), '[♩=102] [key -1] [2/4] C5/8. D5/16 C5/8 Bb4/8 A4/8 Bb4/8 C5/4 G4/8 A4/8 Bb4/4 A4/8 Bb4/8 C5/4 '
    + 'C5/8. D5/16 C5/8 Bb4/8 A4/8 Bb4/8 C5/4 G4/4 C5/4 A4/8 F4/4.');
  // \tempo в самой мелодии важнее \midi
  assert.equal(ev('m = { \\tempo 4 = 60 c\'4 } \\score { \\m \\midi { \\tempo 4 = 120 } }'), '[♩=60] C4/4');
});

test('Затакт внутри повтора — только у первого прохода: как во «К Элизе» (Mutopia)', () => {
  const src = '{ \\time 3/8 \\tempo 4 = 72 \\repeat volta 2 { \\partial 8 e\'\'16 dis\'\' e\'\' dis\'\' e\'\' b\' d\'\' c\'\' a\'8 r16 c\' e\' a\' } '
    + '\\alternative { { a\'4 } { a\'8 \\bar "" r16 b\' \\set Timing.measurePosition = #(ly:make-moment -1/8) c\'\'16 d\'\' } } e\'\'4. }';
  assert.equal(ev(src).split(' ').filter((t) => t.startsWith('[partial')).length, 1);
  const r = convert(lyToMusicXml(src), { title: 'Э', license: 'PD' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.piece.measures.map((m) => m.items.length), [2, 6, 5, 3, 6, 5, 5, 1]);
});

test('\\midi: темп из \\tempo и из старой записи tempoWholesPerMinute', () => {
  assert.equal(ev('\\score { { c\'4 } \\midi { \\context { \\Score tempoWholesPerMinute = #(ly:make-moment 180 4) } } }'), '[♩=180] C4/4');
  assert.equal(ev('<< { d\'4 } >> \\midi { \\context { \\Score tempoWholesPerMinute = #(ly:make-moment 30 2) } }'), '[♩=60] D4/4');
});

test('\\tempo: единица — любая длительность, пересчёт в четверти; темп словами без числа не съедает ноту', () => {
  assert.equal(ev('{ \\tempo 4. = 60 c\'4 }'), '[♩=90] C4/4');
  assert.equal(ev('{ \\tempo 2 = 60 c\'4 }'), '[♩=120] C4/4');
  assert.equal(ev('{ \\tempo "Allegro" 4 = 132 c\'4 }'), '[♩=132] C4/4');
  assert.equal(ev('{ \\tempo "Andante" c\'4 d\' }'), 'C4/4 D4/4');
  assert.equal(ev('\\tempo 4 = 100 % добавлено\n\\relative c\' { c4 }'), '[♩=100] C4/4');
});

test('Отклоняется: аккорд в мелодии, триоль, \\transpose, \\breve, тремоло, неизвестный ключ и слово', () => {
  rejects('\\relative c\' { c4 <c e g>4 }', /аккорд/);
  rejects('{ \\tuplet 3/2 { c\'8 d\' e\' } }', /триоль/);
  rejects('{ \\times 2/3 { c\'8 d\' e\' } }', /триоль/);
  rejects('\\transpose c d { c\'4 }', /транспонирование/);
  rejects('{ c\'\\breve }', /\\breve/);
  rejects('{ \\repeat tremolo 4 { c\'16 d\' } }', /тремоло/);
  rejects('{ \\clef alto c\'4 }', /ключ «alto»/);
  rejects('\\relative c\' { c4 foo d }', /непонятное слово «foo»/);
  rejects('{ c\'4*2 }', /растянутая длительность/);
  rejects('\\header { title = "x" }', /нет нот/);
});

test('В MusicXML: 4/4 по умолчанию, затакт, лиги с началом и концом, многотактовые паузы, ключ с восьмёркой', () => {
  const r = convert(lyToMusicXml('\\tempo 4 = 100 \\relative c\' { c8 d e f g4 g | a8 a a a g2 }'), { title: 'Утята', license: 'CC0' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.piece.measures[0].time, [4, 4]);
  const up = convert(lyToMusicXml('{ \\time 3/4 \\tempo 4 = 90 \\partial 4 g\'4 | c\'\'2.~ | c\'\'2 r4 | R2.*2 | e\'\'2. }'), { title: 'З', license: 'CC0' });
  assert.deepEqual(up.errors, []);
  assert.equal(up.piece.measures.length, 6);
  assert.equal(up.piece.measures[0].pickup, true);
  assert.equal(up.piece.measures[1].items[0].tie, true);
  assert.deepEqual(up.piece.measures[3].items, [{ rest: true, measure: true }]);
  assert.deepEqual(up.piece.measures[4].items, [{ rest: true, measure: true }]);
  const xml = lyToMusicXml('{ \\tempo 4 = 60 \\clef "treble_8" c\'2~ c\'2 }');
  assert.match(xml, /<tie type="start"\/><voice>/);
  assert.match(xml, /<tie type="stop"\/><voice>/);
  assert.match(xml, /<clef-octave-change>-1<\/clef-octave-change>/);
  rejects('{ c\'1 }', /нет темпа: добавьте в начало файла строку \\tempo 4 = 90/);
  rejects('{ \\tempo 4 = 60 c\'2. d\'2 }', /пересекает тактовую черту в такте 1/);
  rejects('{ \\tempo 4 = 60 \\time 4/4 c\'2 \\time 3/4 c\'4 }', /смена размера посреди такта 1/);
  rejects('{ c\'2 \\tempo 4 = 80 c\'2 }', /смена темпа посреди такта 1/);
  rejects('{ \\tempo 4 = 60 \\time 3/4 R4*2 c\'2. }', /целому числу тактов/);
});

test('Название, автор и лицензия — из \\header; флаги важнее', () => {
  const src = '\\header { title = "Menuet in G" composer = "J. S. Bach" license = "Public Domain" copyright = \\markup { \\bold "x" } }\n{ \\tempo 4 = 100 g\'4 }';
  const r = convert(lyToMusicXml(src), {});
  assert.deepEqual(r.errors, []);
  assert.equal(r.piece.title, 'Menuet in G');
  assert.equal(r.piece.composer, 'J. S. Bach');
  assert.equal(r.piece.license, 'Public Domain');
  const r2 = convert(lyToMusicXml(src), { title: 'Менуэт', composer: 'К. Петцольд' });
  assert.equal(r2.piece.title, 'Менуэт');
  assert.equal(r2.piece.composer, 'К. Петцольд');
});

test('FR-TOOL-01: add-piece принимает .ly — исходник копируется как .ly, --rebuild пересобирает из него', () => {
  const root = mkdtempSync(join(tmpdir(), 'slista-ly-'));
  try {
    const file = join(root, 'song.ly');
    writeFileSync(file, '\\header { title = "Песня" }\n\\tempo 4 = 100\n\\relative c\' { \\time 2/4 c4 d | e2 }\n');
    const run = (args) => spawnSync(process.execPath, [TOOL, ...args, '--root', root], { encoding: 'utf8' });
    const r = run([file, '--id', 'song', '--license', 'CC0 1.0', '--source', 'https://example.org/song']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(readdirSync(join(root, 'pieces/src')), ['song.ly']);
    const piece = JSON.parse(readFileSync(join(root, 'pieces/song.json'), 'utf8'));
    assert.equal(piece.title, 'Песня');
    assert.equal(piece.measures.length, 2);
    assert.equal(piece.source, 'https://example.org/song');
    const re = run(['--rebuild']);
    assert.equal(re.status, 0, re.stderr + re.stdout);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'pieces/song.json'), 'utf8')), piece);
    const bad = join(root, 'bad.ly');
    writeFileSync(bad, '{ \\tuplet 3/2 { c\'8 d\' e\' } }');
    const b = run([bad, '--license', 'CC0']);
    assert.equal(b.status, 1);
    assert.match(b.stderr, /триоль или другое нестандартное деление не поддерживается/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Пьесы из открытых источников в pieces/src/*.ly читаются так, как записаны в источнике', () => {
  const src = (id) => readFileSync(join(REPO, 'pieces/src', id + '.ly'), 'utf8');
  if (!existsSync(join(REPO, 'pieces/src/menuet-sol-mazhor.ly'))) return;
  const minuet = parseLy(src('menuet-sol-mazhor')).events;
  // начало части A и части B (Mutopia, BWV Anh. 114), темп — из \midi файла
  assert.equal(brief(minuet.slice(0, 20)), '[♩=140] [clef] [3/4] [key 1] D5/4 G4/8 A4/8 B4/8 C5/8 D5/4 G4/4 G4/4 E5/4 C5/8 D5/8 E5/8 F#5/8 G5/4 G4/4 G4/4');
  const b = minuet.findIndex((e, k) => k > 60 && e.kind === 'note' && e.d === 41); // B5 — первая нота части B
  assert.equal(brief(minuet.slice(b, b + 5)), 'B5/4 G5/8 A5/8 B5/8 G5/8');
  assert.equal(minuet.filter((e) => e.kind === 'note').length, 252); // обе части с повторами
  assert.equal(notes(src('jingle-bells')).split(' ').slice(0, 11).join(' '), 'B4/8 B4/8 B4/4 B4/8 B4/8 B4/4 B4/8 D5/8 G4/8. A4/16 B4/4');
  assert.equal(notes(src('fuchs-du-hast-die-gans-gestohlen')).split(' ').slice(8, 13).join(' '), 'B4/4 G4/4 D5/4 B4/4 A4/1');
});
