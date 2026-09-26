// Перерисовывает assets/icon-180.png из assets/icon.svg (иконка для экрана «Домой» на iPhone).
// Нужен Playwright: npm install && npx playwright install chromium
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.screenshot({ path: join(root, 'assets/icon-180.png'), clip: { x: 0, y: 0, width: 180, height: 180 } });
await browser.close();
console.log('assets/icon-180.png обновлён');
