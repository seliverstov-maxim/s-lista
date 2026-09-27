// Работа без интернета (FR-UI-05): sw.js собран из текущих файлов. Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { offlineFiles, swSource } from '../scripts/lib/offline.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

test('FR-UI-05: в списке для работы без интернета — страница, все пьесы и все звуки, и все эти файлы есть', () => {
  const files = offlineFiles(REPO);
  const ids = JSON.parse(readFileSync(join(REPO, 'pieces/index.json'), 'utf8')).pieces.map((p) => p.id);
  for (const id of ids) assert.ok(files.includes(`pieces/${id}.json`), id);
  for (const f of readdirSync(join(REPO, 'sounds/piano')).filter((x) => x.endsWith('.mp3'))) assert.ok(files.includes(`sounds/piano/${f}`), f);
  assert.ok(files.includes('./') && files.includes('index.html') && files.includes('pieces/index.json'));
  for (const f of files.slice(1)) assert.ok(existsSync(join(REPO, f)), `нет файла ${f}`);
});

test('FR-UI-05: sw.js не устарел — иначе без интернета не будет новых пьес или новой страницы', () => {
  assert.equal(readFileSync(join(REPO, 'sw.js'), 'utf8'), swSource(REPO), 'sw.js устарел — запустите npm run build');
});

test('FR-UI-05: версия sw.js меняется вместе с содержимым файлов', () => {
  const src = swSource(REPO), v = /const VERSION = '([0-9a-f]{12})'/.exec(src);
  assert.ok(v, 'версия подставлена');
  assert.ok(!src.includes('__VERSION__') && !src.includes('/*__FILES__*/'), 'все вставки заполнены');
});
