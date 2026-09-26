// Сборка: src/app.html + src/music.js + src/detector.js + src/glyphs.json + assets/icon-180.png → index.html
// index.html лежит в корне репозитория, его раздаёт GitHub Pages.
// Дополнительно пишет dist/artifact.html — фрагмент без <html>/<head> для публикации как артефакт Claude.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const glyphs = JSON.parse(read('src/glyphs.json'));
const used = Object.fromEntries(Object.entries(glyphs).map(([k, v]) => [k, { d: v.d, adv: v.adv }]));

let fragment = read('src/app.html')
  .replace('/*__GLYPHS__*/null', () => JSON.stringify(used))
  .replace('/*__MUSIC__*/', () => read('src/music.js'))
  .replace('/*__DETECTOR__*/', () => read('src/detector.js'));
if (fragment.includes('/*__')) throw new Error('В шаблоне остались незаполненные вставки /*__…__*/');
fragment = compactBlock(compactBlock(fragment, 'style', false), 'script', true);

const [head, body] = splitOnce(fragment, '<div class="app">');
const iconPath = join(root, 'assets/icon-180.png');
const icon = existsSync(iconPath) ? readFileSync(iconPath).toString('base64') : '';
const iconTag = icon ? `<link rel="apple-touch-icon" href="data:image/png;base64,${icon}">\n` : '';

const doc = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Тренажёр чтения нот с листа: показывает ноту и слушает пианино через микрофон.">
<meta name="theme-color" content="#E7E5E0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F0F11" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="С листа">
${iconTag}<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; }
img { max-width: 100%; }
</style>
${head.trim()}
</head>
<body>
<div class="app">${body}
</body>
</html>
`;

writeFileSync(join(root, 'index.html'), doc);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/artifact.html'), fragment);
const kb = Buffer.byteLength(doc) / 1024;
console.log(`index.html: ${kb.toFixed(1)} КБ`);
if (kb > 150) { console.error('Больше 150 КБ — нарушено требование NFR-SIZE-01'); process.exitCode = 1; }

// Сжатие без изменения смысла (NFR-SIZE-01): внутри <style> и <script> убираем отступы, пустые строки
// и строки, целиком состоящие из комментария. Переносы строк остаются, комментарии — только в исходниках.
function compactBlock(html, tag, js) {
  const open = `<${tag}>`, close = `</${tag}>`;
  const i = html.indexOf(open), j = html.indexOf(close);
  if (i < 0 || j < i) throw new Error(`Не найден блок ${open}`);
  const body = html.slice(i + open.length, j).split('\n').map((l) => l.trim())
    .filter((l) => l && !(js && l.startsWith('//')) && !/^\/\*.*\*\/$/.test(l)).join('\n');
  return html.slice(0, i + open.length) + '\n' + body + '\n' + html.slice(j);
}

function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  if (i < 0) throw new Error(`Не найден разделитель ${sep}`);
  return [s.slice(0, i), s.slice(i + sep.length)];
}
