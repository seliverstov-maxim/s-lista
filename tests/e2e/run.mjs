// Сквозные проверки в Chromium: npm run build && npm run test:e2e
// Нужен Playwright: npm install && npx playwright install chromium
// Микрофон подменяется WAV-файлом (флаги Chromium --use-file-for-fake-audio-capture), MIDI — заглушкой.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../scripts/serve.mjs';
import { addPiano, addNoise, reseed } from '../helpers/synth.mjs';

const outDir = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(outDir, { recursive: true });

// Запись для «микрофона»: 4 с шума, затем 5 нот (четвёртая тихая), затем шум. Chromium проигрывает её по кругу.
reseed();
const sr = 48000, sig = new Float32Array(sr * 16);
addNoise(sig, sr, -56, -62);
[[60, 4.5], [64, 6.0], [67, 7.5], [62, 9.0], [69, 10.5]].forEach(([m, t], i) => addPiano(sig, sr, t, m, i === 3 ? 0.12 : 0.3, 1.1));
const wavPath = outDir + 'fake-mic.wav';
writeFileSync(wavPath, toWav(sig, sr));

const port = 8799;
const server = await startServer(port);
const base = `http://localhost:${port}/index.html`;
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`],
});
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };

try {
  // 1. Страница открывается без ошибок, стан нарисован, экранная клавиатура засчитывает ноты
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.waitForTimeout(500);
    check('страница без ошибок JS', errors.length === 0, errors.join('; '));
    // ключ и головки нот — path, линии стана и штили — rect; в строке минимум 3 ноты
    const paths = await page.locator('#score svg path').count(), rects = await page.locator('#score svg rect').count();
    check('нотный стан нарисован', paths >= 4 && rects >= 5, `${paths} знаков, ${rects} линий`);
    let wrong = false, right = false;
    for (const key of await page.locator('#keys [data-midi]').all()) {
      await key.click();
      await page.waitForTimeout(40);
      const msg = await page.textContent('#msg');
      if (msg.startsWith('Сыграно')) wrong = true;
      if (msg.startsWith('Верно')) { right = true; break; }
    }
    check('неверная клавиша — сообщение «Сыграно …»', wrong);
    check('верная клавиша — «Верно»', right);
    await page.screenshot({ path: outDir + 'keys.png' });
    // большой нотный стан: два стана по 5 линий и фигурная скобка
    await page.click('#settingsBtn');
    await page.click('[data-preset="grand"]');
    await page.click('#settingsPanel [data-close]');
    await page.waitForTimeout(400);
    const staffLines = await page.locator('#score svg rect.st').count();
    check('большой нотный стан: два стана и скобка', staffLines >= 11, `${staffLines} линий и черт`);
    await page.screenshot({ path: outDir + 'grand.png' });
    await ctx.close();
  }

  // 2. MIDI: ноты приходят с устройства, микрофон не нужен
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__inp = { name: 'FP-30', state: 'connected', onmidimessage: null };
      navigator.requestMIDIAccess = async () => ({ inputs: new Map([['1', window.__inp]]), onstatechange: null });
    });
    await page.goto(base);
    await page.click('#settingsBtn');
    await page.click('#midiBtn');
    await page.waitForTimeout(200);
    check('MIDI подключается', (await page.textContent('#midiNote')).includes('FP-30'));
    await page.click('#settingsPanel [data-close]');
    let right = false;
    for (let m = 36; m <= 96 && !right; m++) {
      await page.evaluate((n) => window.__inp.onmidimessage({ data: [0x90, n, 80] }), m);
      await page.waitForTimeout(25);
      right = (await page.textContent('#msg')).startsWith('Верно');
    }
    check('нота по MIDI засчитывается', right);
    await ctx.close();
  }

  // 3. Калибровка микрофона: открывается сама при первом включении, ловит 5 нот и ставит порог
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(['microphone'], { origin: `http://localhost:${port}` });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.click('#micBtn');
    await page.waitForTimeout(700);
    check('калибровка открывается при первом включении микрофона', await page.isVisible('#calibPanel'));
    check('микрофон включён: индикатор уровня и кнопка «Выключить»',
      (await page.isVisible('#meter')) && (await page.textContent('#micLabel')) === 'Выключить');
    await page.click('[data-cal="start"]');
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      if (await page.$('[data-cal="save"]')) break;
    }
    const msg = await page.textContent('#calMsg');
    check('калибровка поймала 5 нот', (await page.textContent('#calCount')) === '5 из 5', await page.textContent('#calCount'));
    const m = msg.match(/Шум около −(\d+).*самая тихая нота −(\d+).*Порог: −(\d+)/);
    check('порог между шумом и самой тихой нотой', !!m && +m[1] > +m[3] && +m[3] > +m[2], msg);
    await page.screenshot({ path: outDir + 'calibration.png' });
    if (await page.$('[data-cal="save"]')) await page.click('[data-cal="save"]');
    check('порог сохранён', (await page.textContent('#msg')).startsWith('Микрофон настроен'));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} из ${results.length} проверок прошли. Скриншоты: tests/e2e/out/`);
process.exit(failed ? 1 : 0);

function toWav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
