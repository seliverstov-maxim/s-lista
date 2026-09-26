// Добавляет пьесу в pieces/ (docs/spec-2.0.md, FR-TOOL): проверяет MusicXML, пишет данные для приложения,
// копию исходника и общий список pieces/index.json. Коммит и публикация — отдельный шаг (git push).
//
//   npm run add-piece -- файл.mxl [--id …] [--title …] [--composer …] [--license …] [--source …] [--force] [--check]
//   npm run add-piece -- --rebuild        пересобрать все пьесы из pieces/src/ (метаданные — из pieces/<id>.json)
//
// --root <каталог> — где лежит pieces/ (по умолчанию корень репозитория; нужно тестам).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert, noteName, plural, CLEFS } from './lib/musicxml.mjs';
import { readMxl } from './lib/zip.mjs';
import { decodeText } from './lib/xml.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTS = ['.mxl', '.musicxml', '.xml'];
const CLEF_NAME = { treble: 'Скрипичный ключ', bass: 'Басовый ключ' };
const USAGE = `Как запустить:
  npm run add-piece -- файл.mxl [--id …] [--title "…"] [--composer "…"] [--license "…"] [--source "…"] [--force] [--check]
  npm run add-piece -- --rebuild
Файл — сжатый (.mxl) или обычный (.musicxml, .xml) MusicXML с одной мелодией.
  --id        имя файлов пьесы (по умолчанию — транслитерация названия)
  --title     название, если его нет в файле или нужно другое
  --composer  автор
  --license   лицензия, если в файле нет <rights> (например, "CC0 1.0")
  --source    откуда взят файл (ссылка)
  --force     заменить пьесу с тем же id
  --check     только проверить, ничего не записывать
  --rebuild   пересобрать все пьесы из pieces/src/`;

class UsageError extends Error {}

function parseArgs(argv) {
  const a = { force: false, check: false, rebuild: false, help: false };
  const withValue = new Set(['--id', '--title', '--composer', '--license', '--source', '--root']);
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (withValue.has(s)) {
      if (i + 1 >= argv.length) throw new UsageError(`После ${s} нужно значение.`);
      a[s.slice(2)] = argv[++i];
    } else if (s === '--force') a.force = true;
    else if (s === '--check') a.check = true;
    else if (s === '--rebuild') a.rebuild = true;
    else if (s === '--help' || s === '-h') a.help = true;
    else if (s.startsWith('--')) throw new UsageError(`Неизвестный флаг ${s}.`);
    else if (a.file) throw new UsageError('Можно добавить только один файл за раз.');
    else a.file = s;
  }
  return a;
}

// Текст MusicXML из файла: .mxl распаковываем, остальное читаем как текст (UTF-8 или UTF-16)
function readSource(path) {
  const buf = readFileSync(path);
  if (extname(path).toLowerCase() === '.mxl' || (buf[0] === 0x50 && buf[1] === 0x4b)) return readMxl(buf);
  return decodeText(buf);
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export function slugify(title) {
  return [...title.toLowerCase().normalize('NFC')]
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

// Пьеса: поля верхнего уровня — по строке, каждый такт — одной строкой
function formatPiece(p) {
  const top = Object.entries(p).filter(([k]) => k !== 'measures').map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const ms = p.measures.map((m) => '  ' + JSON.stringify(m)).join(',\n');
  return `{\n${top.join(',\n')},\n "measures": [\n${ms}\n ]\n}\n`;
}
function formatIndex(list) {
  if (!list.length) return '{ "pieces": [] }\n';
  return `{ "pieces": [\n${list.map((e) => '  ' + JSON.stringify(e)).join(',\n')}\n] }\n`;
}

function paths(root) {
  const dir = join(root, 'pieces');
  return { dir, src: join(dir, 'src'), index: join(dir, 'index.json'), json: (id) => join(dir, `${id}.json`) };
}
function loadIndex(P) {
  if (!existsSync(P.index)) return [];
  const data = JSON.parse(readFileSync(P.index, 'utf8'));
  return Array.isArray(data.pieces) ? data.pieces : [];
}
function saveIndex(P, list) {
  list.sort((a, b) => a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id));
  writeFileSync(P.index, formatIndex(list));
}
const indexEntry = (p) => ({ id: p.id, title: p.title, composer: p.composer, clefs: CLEFS.filter((c) => c in p.shift) });

// Итоговый объект пьесы: порядок полей — как в спецификации
function assemble(id, piece, source) {
  const out = { id, title: piece.title, composer: piece.composer, license: piece.license };
  if (source) out.source = source;
  out.shift = piece.shift;
  out.measures = piece.measures;
  return out;
}

const shiftText = (k) => (k === 0 ? 'без сдвига' : `сдвиг на ${Math.abs(k) === 1 ? 'октаву' : `${Math.abs(k)} октавы`} ${k > 0 ? 'вверх' : 'вниз'}`);
function summary(piece, info) {
  const first = piece.measures[0];
  const k = Math.abs(first.key);
  const keyText = k === 0 ? 'без знаков' : `${k} ${first.key > 0 ? plural(k, 'диез', 'диеза', 'диезов') : plural(k, 'бемоль', 'бемоля', 'бемолей')}`;
  const lines = [`  Тактов: ${info.measures}, нот: ${info.notes}, размер ${first.time.join('/')}, ключевые знаки: ${keyText}, темп ♩ = ${String(first.tempo).replace('.', ',')}${first.pickup ? ', затакт' : ''}`];
  for (const clef of CLEFS) {
    if (!(clef in piece.shift)) { lines.push(`  ${CLEF_NAME[clef]}: не помещается в три добавочные линейки — версии не будет`); continue; }
    const k = piece.shift[clef];
    lines.push(`  ${CLEF_NAME[clef]}: ${shiftText(k)}, ноты от ${noteName(info.lo + 7 * k)} до ${noteName(info.hi + 7 * k)}`);
  }
  return lines;
}
const bullet = (list) => list.map((m) => `  • ${m}`).join('\n');
function printProblems(result) {
  if (result.warnings.length) console.log(`Предупреждения:\n${bullet(result.warnings)}`);
  if (result.errors.length) {
    const shown = result.errors.slice(0, 20);
    const more = result.errors.length - shown.length;
    console.error(`Пьеса не подходит:\n${bullet(shown)}${more > 0 ? `\n  …и ещё ${more}` : ''}`);
  }
}

function addPiece(a, root) {
  if (!a.file) throw new UsageError('Укажите файл MusicXML.');
  const file = resolve(a.file);
  if (!existsSync(file)) throw new UsageError(`Файл не найден: ${a.file}`);
  const ext = extname(file).toLowerCase();
  if (!EXTS.includes(ext)) throw new UsageError(`Нужен файл .mxl, .musicxml или .xml, а не «${ext || 'без расширения'}».`);
  let xml;
  try { xml = readSource(file); }
  catch (e) { console.error(`Не удалось прочитать ${a.file}: ${e.message}`); return 1; }
  const result = convert(xml, { title: a.title, composer: a.composer, license: a.license });
  printProblems(result);
  if (result.errors.length) return 1;
  const id = a.id || slugify(result.piece.title);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    console.error(id ? `Недопустимый id «${id}»: только латинские буквы, цифры и дефис.` : 'Из названия не получился id — задайте его флагом --id.');
    return 1;
  }
  const piece = assemble(id, result.piece, a.source);
  const P = paths(root);
  if (a.check) {
    console.log(`Проверка пройдена: «${piece.title}»${piece.composer ? ` (${piece.composer})` : ''}, id ${id}`);
    console.log(summary(piece, result.info).join('\n'));
    console.log('Файлы не записаны (--check).');
    return 0;
  }
  if (existsSync(P.json(id)) && !a.force) {
    console.error(`Пьеса с id «${id}» уже есть: ${relative(root, P.json(id))}. Чтобы заменить её, добавьте --force, или задайте другой --id.`);
    return 1;
  }
  mkdirSync(P.src, { recursive: true });
  // исходник читаем в память до удаления старых копий: входной файл может оказаться самим pieces/src/<id>.*
  const source = readFileSync(file);
  // старый исходник с тем же id мог быть с другим расширением
  for (const f of existsSync(P.src) ? readdirSync(P.src) : []) {
    if (EXTS.includes(extname(f).toLowerCase()) && basename(f, extname(f)) === id) rmSync(join(P.src, f));
  }
  const srcCopy = join(P.src, id + ext);
  writeFileSync(srcCopy, source);
  writeFileSync(P.json(id), formatPiece(piece));
  const list = loadIndex(P).filter((e) => e.id !== id);
  list.push(indexEntry(piece));
  saveIndex(P, list);
  console.log(`Готово: «${piece.title}» → ${relative(root, P.json(id))}`);
  console.log(summary(piece, result.info).join('\n'));
  console.log(`  Исходник: ${relative(root, srcCopy)}`);
  console.log(`  Список: ${relative(root, P.index)} (${list.length} ${plural(list.length, 'пьеса', 'пьесы', 'пьес')})`);
  console.log('Сайт обновится после git commit и git push.');
  return 0;
}

// Пересобрать все пьесы из исходников: например, после изменения формата данных
function rebuild(root) {
  const P = paths(root);
  if (!existsSync(P.src)) { console.error(`Нет каталога ${relative(root, P.src) || P.src} — пересобирать нечего.`); return 1; }
  const files = readdirSync(P.src).filter((f) => EXTS.includes(extname(f).toLowerCase())).sort();
  let failed = 0;
  let list = loadIndex(P);
  for (const f of files) {
    const id = basename(f, extname(f));
    if (!existsSync(P.json(id))) { console.error(`${f}: нет ${relative(root, P.json(id))} — метаданные взять неоткуда, пропускаю.`); failed++; continue; }
    const old = JSON.parse(readFileSync(P.json(id), 'utf8'));
    let result;
    try { result = convert(readSource(join(P.src, f)), { title: old.title, composer: old.composer ?? '', license: old.license }); }
    catch (e) { console.error(`${f}: не удалось прочитать — ${e.message}`); failed++; continue; }
    if (result.errors.length) { console.error(`${f}:`); printProblems(result); failed++; continue; }
    if (result.warnings.length) { console.log(`${f}:`); printProblems(result); }
    const piece = assemble(id, result.piece, old.source);
    writeFileSync(P.json(id), formatPiece(piece));
    list = list.filter((e) => e.id !== id);
    list.push(indexEntry(piece));
    console.log(`Пересобрано: «${piece.title}» (${id})`);
  }
  saveIndex(P, list);
  console.log(failed ? `Не удалось пересобрать: ${failed} из ${files.length}.` : `Готово: пересобрано ${files.length} ${plural(files.length, 'пьеса', 'пьесы', 'пьес')}.`);
  return failed ? 1 : 0;
}

function main(argv) {
  try {
    const a = parseArgs(argv);
    if (a.help) { console.log(USAGE); return 0; }
    const root = a.root ? resolve(a.root) : repoRoot;
    return a.rebuild ? rebuild(root) : addPiece(a, root);
  } catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n\n${USAGE}`); return 1; }
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
