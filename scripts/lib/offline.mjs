// Список файлов для работы без интернета (FR-UI-05) и сборка sw.js из src/sw.js.
// Версия — хеш содержимого всех файлов: изменилась пьеса, звук или страница — у sw.js новая версия,
// браузер ставит его заново и сохраняет всё ещё раз.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function offlineFiles(root) {
  const ids = JSON.parse(readFileSync(join(root, 'pieces/index.json'), 'utf8')).pieces.map((p) => p.id);
  const sounds = readdirSync(join(root, 'sounds/piano')).filter((f) => f.endsWith('.mp3')).sort();
  return ['./', 'index.html', 'pieces/index.json', ...ids.map((id) => `pieces/${id}.json`), ...sounds.map((f) => `sounds/piano/${f}`)];
}

export function swSource(root) {
  const files = offlineFiles(root);
  const hash = createHash('sha256');
  for (const f of files.slice(1)) hash.update(f).update(readFileSync(join(root, f)));
  return readFileSync(join(root, 'src/sw.js'), 'utf8')
    .replace("'__VERSION__'", () => `'${hash.digest('hex').slice(0, 12)}'`)
    .replace('/*__FILES__*/[]', () => JSON.stringify(files));
}

// Пишет sw.js в корень; true — если файл изменился. Без шаблона (временный каталог в тестах) — ничего не делает.
export function writeServiceWorker(root) {
  if (!existsSync(join(root, 'src/sw.js')) || !existsSync(join(root, 'pieces/index.json'))) return false;
  const src = swSource(root), path = join(root, 'sw.js');
  if (existsSync(path) && readFileSync(path, 'utf8') === src) return false;
  writeFileSync(path, src);
  return true;
}
