// Сквозные проверки в Chromium: npm run build && npm run test:e2e
// Нужен Playwright: npm install && npx playwright install chromium
// Микрофон подменяется WAV-файлом (флаги Chromium --use-file-for-fake-audio-capture), MIDI — заглушкой.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../scripts/serve.mjs';
import { addPiano, addNoise, reseed } from '../helpers/synth.mjs';

const outDir = fileURLToPath(new URL('./out/', import.meta.url));
const indexFile = fileURLToPath(new URL('../../index.html', import.meta.url));
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

// Новая вкладка: телефон 390×844 по умолчанию, ошибки JS собираются
async function open(url = base, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, colorScheme: opts.colorScheme || 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (opts.init) await page.addInitScript(opts.init.fn, opts.init.arg);
  if (opts.route) await opts.route(page);
  await page.goto(url);
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}
const visible = (page, sel) => page.isVisible(sel);
const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const noHScroll = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
// MIDI текущей ноты; пока строка сменяется (0,7 с) — ждём. Пьеса кончилась — null.
async function curMidi(page) {
  for (let i = 0; i < 25; i++) {
    const m = await page.evaluate(() => {
      const el = document.querySelector('#score .n.cur');
      return el ? +el.dataset.midi : document.getElementById('donePanel').hidden ? 0 : null;
    });
    if (m) return m;
    if (m === null) return null;
    await page.waitForTimeout(100);
  }
  return null;
}
async function press(page, midi) { await page.click(`#keys [data-midi="${midi}"]`); await page.waitForTimeout(40); }
// сыграть ноты с экранной клавиатуры, пока не откроется итог или не кончится limit
async function playAll(page, limit = 400, onRow) {
  let played = 0, lastFirst = null;
  for (let i = 0; i < limit; i++) {
    if (await visible(page, '#donePanel')) break;
    const first = await page.getAttribute('#score .n', 'data-i').catch(() => null);
    if (onRow && first !== lastFirst) { lastFirst = first; await onRow(); }
    const m = await curMidi(page);
    if (m == null) break;
    await press(page, m);
    played++;
  }
  await page.waitForTimeout(900);
  return played;
}

try {
  // 1. Первый запуск: главный экран, без «Продолжить»
  {
    const { ctx, page, errors } = await open();
    check('первый запуск — главный экран', await visible(page, '#homeScreen') && !(await visible(page, '#playScreen')));
    check('первый запуск — нет кнопки «Продолжить»', !(await visible(page, '#continueBtn')));
    await page.screenshot({ path: outDir + 'home.png' });

    // 2. Случайные ноты: настройка, образец диапазона, тренажёр
    await page.click('[data-go="random"]');
    check('экран «Случайные ноты»', await visible(page, '#randomScreen'));
    await page.click('input[name="clef"][value="bass"] + span');
    await page.click('input[name="below"][value="2"] + span');
    await page.click('input[name="above"][value="1"] + span');
    const range = await text(page, '#rangeText');
    check('образец диапазона: басовый, 2 снизу, 1 сверху — от C₂ до C₄', range.includes('от C₂ до C₄'), range);
    check('образец диапазона нарисован', (await page.locator('#rangeSvg svg path').count()) >= 3);
    await page.screenshot({ path: outDir + 'random-setup.png' });
    await page.click('#startRandom');
    check('тренажёр открыт', await visible(page, '#playScreen'));
    check('шапка тренажёра — ключ и диапазон', (await text(page, '#levelRange')).startsWith('басовый ключ · C₂–C₄'), await text(page, '#levelRange'));
    check('клавиши «до» подписаны буквой с маленьким номером октавы', (await page.$$eval('#keys .lbl', (els) => els.map((e) => e.textContent))).includes('C₃'));
    const paths = await page.locator('#score svg path').count(), rects = await page.locator('#score svg rect').count();
    check('нотный стан нарисован', paths >= 4 && rects >= 5, `${paths} знаков, ${rects} линий`);
    const m = await curMidi(page);
    const wrongKey = (await page.$(`#keys [data-midi="${m + 1}"]`)) ? m + 1 : m - 1;
    await press(page, wrongKey);
    check('неверная клавиша — «Сыграно …»', (await text(page, '#msg')).startsWith('Сыграно'), await text(page, '#msg'));
    check('неверная нота — «призрак» на стане', (await page.locator('#score .ghost').count()) === 1);
    await press(page, m);
    check('верная клавиша — «Верно»', (await text(page, '#msg')).startsWith('Верно'), await text(page, '#msg'));
    await page.screenshot({ path: outDir + 'random-play.png' });

    // 3. «Назад» по истории браузера и «Продолжить»
    await page.goBack();
    check('«Назад» из тренажёра — к настройке случайных нот', await visible(page, '#randomScreen'));
    await page.goBack();
    check('ещё «Назад» — главный экран', await visible(page, '#homeScreen'));
    check('«Продолжить» — случайные ноты с прошлыми настройками', (await visible(page, '#continueBtn')) && (await text(page, '#continueSub')).includes('Басовый ключ'), await text(page, '#continueSub'));
    await page.click('#continueBtn');
    check('«Продолжить» открывает тренажёр', await visible(page, '#playScreen') && (await text(page, '#levelRange')).startsWith('басовый ключ'));
    await page.click('#playScreen [data-back]');
    check('кнопка «Назад» тренажёра — к настройке', await visible(page, '#randomScreen'));
    check('страница без ошибок JS (случайные ноты)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 4. Диапазон 0 и 0: только ноты на стане, ни одной добавочной линейки
  {
    const { ctx, page, errors } = await open(base + '#random');
    await page.click('input[name="clef"][value="treble"] + span');
    await page.click('input[name="below"][value="0"] + span');
    await page.click('input[name="above"][value="0"] + span');
    await page.click('#startRandom');
    const ds = [];
    let ledgers = 0;
    for (let row = 0; row < 4; row++) {
      ds.push(...(await page.$$eval('#score .n', (els) => els.map((e) => +e.dataset.d))));
      ledgers += await page.locator('#score .lg').count();
      const n = await page.locator('#score .n').count();
      for (let i = 0; i < n; i++) await press(page, await curMidi(page));
      await page.waitForTimeout(800);
    }
    check('0 и 0: все ноты от ми¹ до фа²', ds.length >= 12 && ds.every((d) => d >= 30 && d <= 38), `${ds.length} нот, ступени ${Math.min(...ds)}…${Math.max(...ds)}`);
    check('0 и 0: ни одной добавочной линейки', ledgers === 0, `${ledgers}`);
    check('страница без ошибок JS (диапазон)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 5. Перенос настроек версии 1
  {
    const init = { fn: () => localStorage.setItem('slista.settings.v1', JSON.stringify({ clef: 'grand', lo: 14, hi: 42, acc: true, perRow: 'one', naming: 'letters', calibrated: true, gateDb: -44 })) };
    const { ctx, page, errors } = await open(base, { init });
    check('версия 1: есть «Продолжить»', await visible(page, '#continueBtn'));
    await page.click('[data-go="random"]');
    const state = await page.evaluate(() => ['clef', 'below', 'above'].map((n) => document.querySelector(`input[name="${n}"]:checked`).value).join(' '));
    check('версия 1: большой стан → скрипичный, 3 снизу, 2 сверху', state === 'treble 3 2', state);
    check('версия 1: названия нот — буквы с маленьким номером октавы', (await text(page, '#rangeText')).includes('от F₃ до C₆'), await text(page, '#rangeText'));
    check('страница без ошибок JS (перенос)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 6. Пьеса целиком: ошибка, итог, «Ещё раз», «К списку»
  {
    const { ctx, page, errors } = await open();
    await page.click('[data-go="pieces"]');
    await page.waitForSelector('#piecesList .piece');
    check('список пьес загружен', (await page.locator('#piecesList .piece').count()) >= 4);
    await page.screenshot({ path: outDir + 'pieces.png' });
    await page.click('[data-piece="oda-k-radosti"][data-clef="bass"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    check('пьеса: шапка — название и ход', (await text(page, '#levelName')) === 'Ода к радости' && (await text(page, '#levelRange')) === 'басовый ключ · нота 1 из 62', await text(page, '#levelRange'));
    await page.screenshot({ path: outDir + 'piece-play.png' });
    const m = await curMidi(page);
    await press(page, m + 2);
    check('пьеса: неверная нота — «Сыграно …»', (await text(page, '#msg')).startsWith('Сыграно'));
    await press(page, m - 1); // фа вместо фа-диеза из ключевых знаков
    const why = await text(page, '#msg');
    check('пьеса: фа вместо фа-диеза — объяснение про ключевые знаки', why.includes('нужно сыграть F♯₃') && why.includes('знаки в ключе (F♯ и C♯)'), why);
    check('пьеса: фа вместо фа-диеза — диез фа в ключе вспыхивает', (await page.locator('#score .key-flash').count()) === 1);
    let rows = 0;
    const played = await playAll(page, 400, async () => { rows++; if (rows <= 3) await page.screenshot({ path: outDir + `piece-row${rows}.png` }); });
    check('пьеса: сыграны все 62 ноты', played === 62, `${played}`);
    check('пьеса: итог открылся', await visible(page, '#donePanel'));
    const kv = await text(page, '#doneKv');
    check('итог: 61 из 62 с первого раза', kv.includes('Нот62') && kv.includes('61 (98%)'), kv);
    await page.screenshot({ path: outDir + 'piece-done.png' });
    await page.click('#doneAgain');
    await page.waitForTimeout(300);
    check('«Ещё раз» — пьеса сначала', !(await visible(page, '#donePanel')) && (await text(page, '#levelRange')).endsWith('нота 1 из 62'));
    await playAll(page);
    await page.click('#doneList');
    await page.waitForTimeout(300);
    check('«К списку» — экран пьес', await visible(page, '#piecesScreen') && (await page.evaluate(() => location.hash)) === '#pieces');
    await page.goBack();
    check('«Назад» из списка — главный экран', await visible(page, '#homeScreen'));
    check('«Продолжить» — пьеса', (await text(page, '#continueTitle')) === 'Ода к радости');
    // перезагрузка на тренажёре (например, телефон выгрузил вкладку) продолжает последнее упражнение
    await page.click('#continueBtn');
    await page.waitForSelector('#playScreen:not([hidden])');
    await page.reload();
    await page.waitForSelector('#playScreen:not([hidden])');
    await page.waitForTimeout(300);
    check('перезагрузка на #play — та же пьеса', (await text(page, '#levelName')) === 'Ода к радости');
    await page.goBack();
    check('после перезагрузки «Назад» — список пьес', await visible(page, '#piecesScreen'));
    check('страница без ошибок JS (пьеса)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 7. MIDI: ноты приходят с устройства, микрофон не нужен
  {
    const init = { fn: () => {
      window.__inp = { name: 'FP-30', state: 'connected', onmidimessage: null };
      navigator.requestMIDIAccess = async () => ({ inputs: new Map([['1', window.__inp]]), onstatechange: null });
    } };
    const { ctx, page, errors } = await open(base, { init });
    await page.click('#homeScreen [data-panel="settingsPanel"]');
    await page.click('#midiBtn');
    await page.waitForTimeout(200);
    check('MIDI подключается', (await text(page, '#midiNote')).includes('FP-30'));
    await page.click('#settingsPanel [data-close]');
    await page.waitForTimeout(200);
    check('панель закрылась через историю', !(await visible(page, '#settingsPanel')) && await visible(page, '#homeScreen'));
    await page.click('[data-go="pieces"]');
    await page.waitForSelector('#piecesList .piece');
    await page.click('[data-piece="twinkle-twinkle-little-star"][data-clef="treble"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    let ok = 0;
    for (let i = 0; i < 6; i++) {
      const m = await curMidi(page);
      await page.evaluate((n) => window.__inp.onmidimessage({ data: [0x90, n, 80] }), m);
      await page.waitForTimeout(60);
      if ((await text(page, '#msg')).startsWith('Верно') || (await text(page, '#msg')).startsWith('Строка')) ok++;
    }
    check('ноты по MIDI засчитываются в пьесе', ok === 6, `${ok} из 6`);
    await page.evaluate((n) => window.__inp.onmidimessage({ data: [0x90, n, 80] }), 20);
    check('неверная нота по MIDI — «Сыграно …»', (await text(page, '#msg')).startsWith('Сыграно'));
    check('страница без ошибок JS (MIDI)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 8. Калибровка микрофона: открывается сама при первом включении, ловит 5 нот и ставит порог
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(['microphone'], { origin: `http://localhost:${port}` });
    const page = await ctx.newPage();
    await page.goto(base + '#random');
    await page.click('#startRandom');
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
    await page.waitForTimeout(200);
    check('порог сохранён', (await page.textContent('#msg')).startsWith('Микрофон настроен'));
    check('после калибровки остаёмся в тренажёре', await visible(page, '#playScreen') && !(await visible(page, '#calibPanel')));
    await ctx.close();
  }

  // 9. Файл открыт с диска: пьесы недоступны, случайные ноты работают
  {
    const { ctx, page, errors } = await open('file://' + indexFile);
    await page.click('[data-go="pieces"]');
    await page.waitForTimeout(400);
    check('с диска: понятное сообщение вместо списка пьес', (await text(page, '#piecesMsg')).startsWith('Пьесы загружаются с сайта'), await text(page, '#piecesMsg'));
    await page.goBack();
    await page.click('[data-go="random"]');
    await page.click('#startRandom');
    check('с диска: случайные ноты работают', (await page.locator('#score .n').count()) >= 3);
    check('страница без ошибок JS (с диска)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 10. Раскладка: длинные такты, паузы, лиги, смена тональности и размера — на подставленных пьесах
  {
    const n = (d, len = 4, extra = {}) => ({ d, acc: 0, len, ...extra });
    const b4 = (i) => ['begin', 'continue', 'continue', 'end'][i % 4];
    const test = {
      id: 'e2e-layout', title: 'Проверка раскладки', composer: 'тест', license: 'CC0', shift: { treble: 0, bass: -2 },
      measures: [
        { time: [4, 4], key: -3, items: [28, 29, 30, 31, 32, 33, 34, 35].map((d, i) => n(d, 8, { acc: [30, 33, 34].includes(d) ? -1 : 0, beam: [b4(i)] })) },
        { items: [36, 35, 34, 33, 32, 31, 30, 29, 30, 31, 32, 33, 34, 35, 36, 37].map((d, i) => n(d, 16, { acc: [30, 33, 34, 37].includes(d) ? -1 : 0, beam: [b4(i), b4(i)] })) },
        { items: [{ rest: true, len: 4 }, n(30, 4, { acc: -1, dots: 1 }), n(31, 8), n(32, 4, { tie: true })] },
        { items: [n(32, 2), { rest: true, len: 2 }] },
        { time: [3, 4], key: 2, items: [n(31, 4, { acc: 1 }), n(32, 4, { acc: 0, mark: 0 }), n(32, 4, { acc: 1, mark: 1 })] },
        { items: [{ rest: true, measure: true }] },
        { items: [n(35, 2, { acc: 1, dots: 1 })] },
      ],
    };
    const route = async (page) => {
      await page.route('**/pieces/index.json', (r) => r.fulfill({ json: { pieces: [{ id: 'e2e-layout', title: test.title, composer: 'тест', clefs: ['treble', 'bass'] }] } }));
      await page.route('**/pieces/e2e-layout.json', (r) => r.fulfill({ json: test }));
    };
    const { ctx, page, errors } = await open(base + '#pieces', { viewport: { width: 360, height: 760 }, route });
    await page.waitForSelector('#piecesList .piece');
    await page.click('[data-piece="e2e-layout"][data-clef="treble"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    const firstRow = await page.locator('#score .n').count();
    check('раскладка: такт из восьми восьмых на 360 px переносится', firstRow > 0 && firstRow < 8, `${firstRow} нот в первой строке`);
    // третья нота — ми-бемоль из ключевых знаков; сыгранное ми рисуется с бекаром
    await press(page, await curMidi(page));
    await press(page, await curMidi(page));
    await press(page, (await curMidi(page)) + 1);
    check('«призрак» в тональности: ми с бекаром', (await page.locator('#score .ghost path').count()) === 2, `${await page.locator('#score .ghost path').count()} знака`);
    await page.click('#skipBtn');
    for (let i = 0; i < 3; i++) await press(page, await curMidi(page));
    await page.goto(base + '#pieces');
    await page.waitForSelector('#piecesList .piece');
    await page.click('[data-piece="e2e-layout"][data-clef="treble"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    for (let i = 0; i < firstRow - 1; i++) await press(page, await curMidi(page));
    await page.click('#skipBtn');
    const skipMsg = await text(page, '#msg');
    check('«Пропустить» на конце строки: названа пропущенная нота', skipMsg.startsWith('Пропущено. Это была нота') && skipMsg.includes('Строка пройдена'), skipMsg);
    // дальше — пьеса с начала
    await page.goto(base + '#pieces');
    await page.waitForSelector('#piecesList .piece');
    await page.click('[data-piece="e2e-layout"][data-clef="treble"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    const widths = new Set();
    let rows = 0;
    // первые 27 нот (восьмые, шестнадцатые, такт с лигой), затем строка без нот для игры должна появиться на экране
    for (let i = 0; i < 27; i++) await press(page, await curMidi(page));
    await page.waitForTimeout(900);
    const tieRow = await page.evaluate(() => {
      const ns = [...document.querySelectorAll('#score .n')];
      return ns.length > 0 && ns.every((e) => !e.dataset.i);
    });
    check('раскладка: строку без нот для игры (продолжение лиги и пауза) видно', tieRow);
    await page.screenshot({ path: outDir + 'layout-tie-row.png', clip: await page.locator('#sheet').boundingBox() });
    const played = 27 + await playAll(page, 100, async () => {
      rows++;
      widths.add(await page.getAttribute('#score svg', 'viewBox').then((v) => v.split(' ')[2]));
      await page.screenshot({ path: outDir + `layout-row${rows}.png`, clip: await page.locator('#sheet').boundingBox() });
    });
    check('раскладка: продолжение лиги не играется отдельно', played === 31, `${played} нот`); // 8 + 16 + 3 + 3 + 1: продолжение лиги и паузы не играются
    check('раскладка: масштаб одинаковый во всех строках', widths.size === 1, [...widths].join(', '));
    check('страница без ошибок JS (раскладка)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 10г. Проигрыш пьесы (FR-PC-11): «▶» → «■», звучащий знак подсвечен, ввод не засчитывается, после — та же нота
  {
    const q = (d) => ({ d, acc: 0, len: 4 });
    const fast = { id: 'e2e-play', title: 'Проигрыш', composer: 'тест', license: 'CC0', shift: { treble: 0 },
      measures: [{ time: [4, 4], key: 0, tempo: 240, items: [q(28), q(30), q(32), q(35)] }, { items: [q(33), q(31), q(29), q(28)] }] };
    const route = async (page) => {
      await page.route('**/pieces/index.json', (r) => r.fulfill({ json: { pieces: [{ id: 'e2e-play', title: 'Проигрыш', composer: 'тест', clefs: ['treble'] }] } }));
      await page.route('**/pieces/e2e-play.json', (r) => r.fulfill({ json: fast }));
    };
    const { ctx, page, errors } = await open(base + '#pieces', { route });
    await page.waitForSelector('#piecesList .piece');
    await page.click('[data-piece="e2e-play"][data-clef="treble"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    check('кнопка «▶» есть в пьесе', await visible(page, '#playBtn'));
    await press(page, await curMidi(page)); // одна нота сыграна — проигрыш не должен сдвинуть текущую
    await page.click('#playBtn');
    check('«▶» → «■»', (await page.getAttribute('#playBtn', 'aria-label')) === 'Остановить' && (await page.getAttribute('#playBtn', 'class')).includes('on'));
    const xs = new Set();
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(150); const x = await page.getAttribute('#score rect.band.play', 'x').catch(() => null); if (x) xs.add(x); }
    check('при проигрыше подсветка идёт по нотам', xs.size >= 3, `${xs.size} разных положений`);
    await page.click('#keys [data-midi="60"]', { force: true });
    check('при проигрыше клавиатура не засчитывается', (await text(page, '#stCount')) === '1');
    check('при проигрыше подсказка недоступна', await page.isDisabled('#hintBtn'));
    await page.waitForTimeout(2500);
    check('после конца проигрыша — снова «▶»', (await page.getAttribute('#playBtn', 'aria-label')) === 'Прослушать с этой строки');
    check('после проигрыша текущая нота та же', (await page.getAttribute('#score .n.cur', 'data-i')) === '1');
    await press(page, await curMidi(page));
    check('после проигрыша ввод снова засчитывается', (await text(page, '#stCount')) === '2' && (await text(page, '#msg')).startsWith('Верно'));
    // «■» посреди пьесы в обычном темпе
    await page.click('#playBtn');
    await page.waitForTimeout(300);
    await page.click('#playBtn');
    check('«■» останавливает, текущая нота та же', (await page.getAttribute('#playBtn', 'aria-label')) === 'Прослушать с этой строки' && (await page.getAttribute('#score .n.cur', 'data-i')) === '2');
    check('в случайных нотах кнопки «▶» нет', await (async () => { await page.goto(base + '#random'); await page.click('#startRandom'); return !(await visible(page, '#playBtn')); })());
    check('страница без ошибок JS (проигрыш)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 10а. Звук рояля: записи грузятся для клавиатуры на экране, клавиша и проигрыш звучат записями;
  // без записей — запасной синтез. Узлы Web Audio считаем подменой методов AudioContext.
  {
    const init = { fn: () => {
      window.__audio = { srcs: [], oscs: 0 };
      const AC = window.AudioContext, cbs = AC.prototype.createBufferSource, co = AC.prototype.createOscillator;
      AC.prototype.createBufferSource = function () { const n = cbs.call(this); window.__audio.srcs.push(n); return n; };
      AC.prototype.createOscillator = function () { window.__audio.oscs++; return co.call(this); };
    } };
    const q = (d) => ({ d, acc: 0, len: 4 });
    const fast = { id: 'e2e-play', title: 'Проигрыш', composer: 'тест', license: 'CC0', shift: { treble: 0 },
      measures: [{ time: [4, 4], key: 0, tempo: 240, items: [q(28), q(30), q(32), q(35)] }] };
    const sounds = [];
    const route = async (page) => {
      page.on('response', (r) => { if (r.url().includes('/sounds/piano/')) sounds.push(r.status()); });
      await page.route('**/pieces/index.json', (r) => r.fulfill({ json: { pieces: [{ id: 'e2e-play', title: 'Проигрыш', composer: 'тест', clefs: ['treble'] }] } }));
      await page.route('**/pieces/e2e-play.json', (r) => r.fulfill({ json: fast }));
    };
    const { ctx, page, errors } = await open(base + '#random', { init, route });
    await page.check('input[name="clef"][value="treble"]', { force: true });
    await page.check('input[name="above"][value="3"]', { force: true });
    await page.click('#startRandom');
    for (let i = 0; i < 30 && sounds.length < 13; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(300); // декодирование
    check('записи рояля грузятся для клавиатуры на экране', sounds.length === 13 && sounds.every((s) => s === 200), `${sounds.length} файлов`);
    const d6 = await page.evaluate(() => {
      const a = window.__audio, n = a.srcs.length, o = a.oscs;
      document.querySelector('#keys [data-midi="86"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const s = a.srcs[n];
      return { rate: s ? s.playbackRate.value : null, dur: s && s.buffer ? s.buffer.duration : 0, oscs: a.oscs - o };
    });
    check('клавиша ре³ (D6) звучит записью ре-диеза на полтона ниже', d6.rate != null && Math.abs(d6.rate - Math.pow(2, -1 / 12)) < 1e-4 && d6.dur > 1 && d6.oscs === 0, JSON.stringify(d6));
    await page.click('#playScreen [data-panel="settingsPanel"]');
    check('в настройках указан источник звука и лицензия', /Salamander Grand Piano V3.*Alexander Holm.*CC BY 3\.0/.test(await text(page, '#settingsPanel')));
    await page.goBack();
    await page.goto(base + '#pieces');
    await page.waitForSelector('#piecesList .piece');
    await page.click('[data-piece="e2e-play"][data-clef="treble"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => ({ s: window.__audio.srcs.length, o: window.__audio.oscs }));
    await page.click('#playBtn');
    await page.waitForTimeout(1600);
    const after = await page.evaluate(() => ({ s: window.__audio.srcs.length, o: window.__audio.oscs }));
    check('проигрыш пьесы звучит записями', after.s - before.s === 4 && after.o === before.o, `${after.s - before.s} записей, ${after.o - before.o} генераторов`);
    check('страница без ошибок JS (звук)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }
  {
    const init = { fn: () => {
      window.__audio = { srcs: 0, oscs: 0 };
      const AC = window.AudioContext, cbs = AC.prototype.createBufferSource, co = AC.prototype.createOscillator;
      AC.prototype.createBufferSource = function () { window.__audio.srcs++; return cbs.call(this); };
      AC.prototype.createOscillator = function () { window.__audio.oscs++; return co.call(this); };
    } };
    const route = (page) => page.route('**/sounds/**', (r) => r.abort());
    const { ctx, page, errors } = await open(base + '#random', { init, route });
    await page.click('#startRandom');
    await page.waitForTimeout(500);
    const m = await curMidi(page);
    await press(page, m);
    const a = await page.evaluate(() => window.__audio);
    check('записи недоступны — клавиша звучит синтезом', a.srcs === 0 && a.oscs === 4, JSON.stringify(a));
    check('записи недоступны — ответ засчитан', (await text(page, '#msg')).startsWith('Верно'));
    check('страница без ошибок JS (без записей)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 10б. Поворот экрана: посреди пьесы и в момент смены строки текущая нота остаётся на экране
  {
    const { ctx, page, errors } = await open(base + '#pieces');
    await page.waitForSelector('#piecesList .piece');
    await page.click('[data-piece="oda-k-radosti"][data-clef="treble"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    const firstRow = await page.locator('#score .n[data-i]').count();
    for (let i = 0; i < firstRow; i++) await press(page, await curMidi(page));
    await page.setViewportSize({ width: 844, height: 390 }); // сразу, пока идут 0,7 с смены строки
    await page.waitForTimeout(1000);
    const c1 = await page.getAttribute('#score .n.cur', 'data-i');
    check('поворот в момент смены строки: текущая нота на экране', c1 === String(firstRow), `${c1}, ожидалось ${firstRow}`);
    await press(page, await curMidi(page));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const c2 = await page.getAttribute('#score .n.cur', 'data-i');
    check('поворот посреди строки: текущая нота та же', c2 === String(firstRow + 1), `${c2}`);
    check('страница без ошибок JS (поворот)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 10в. История браузера: перезагрузка при открытой панели, «Вперёд» на запись панели
  {
    const { ctx, page, errors } = await open(base + '#random');
    await page.click('#startRandom');
    await page.click('#playScreen [data-panel="settingsPanel"]');
    await page.reload();
    await page.waitForSelector('#playScreen:not([hidden])');
    await page.waitForTimeout(400);
    check('перезагрузка с открытой панелью: тренажёр, панель закрыта', !(await visible(page, '#settingsPanel')));
    await page.goBack();
    await page.waitForTimeout(200);
    check('после перезагрузки одна «Назад» — к настройке', await visible(page, '#randomScreen'));
    await page.goForward();
    await page.waitForSelector('#playScreen:not([hidden])');
    await page.click('#playScreen [data-panel="progressPanel"]');
    await page.goBack();
    await page.waitForTimeout(200);
    await page.goForward();
    await page.waitForTimeout(200);
    check('«Вперёд» на запись панели — панель снова открыта', await visible(page, '#progressPanel'));
    await page.click('#progressPanel [data-close]');
    await page.waitForTimeout(200);
    check('и закрывается одним нажатием', !(await visible(page, '#progressPanel')) && await visible(page, '#playScreen'));
    check('страница без ошибок JS (история)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 11. Телефон 360 px: ни на одном экране нет горизонтальной прокрутки
  {
    const { ctx, page, errors } = await open(base, { viewport: { width: 360, height: 740 } });
    const bad = [];
    if (!(await noHScroll(page))) bad.push('главный');
    await page.click('[data-go="random"]');
    if (!(await noHScroll(page))) bad.push('настройка');
    await page.click('#startRandom');
    if (!(await noHScroll(page))) bad.push('тренажёр');
    await page.goto(base + '#pieces');
    await page.waitForSelector('#piecesList .piece');
    if (!(await noHScroll(page))) bad.push('пьесы');
    check('360 px: без горизонтальной прокрутки', bad.length === 0, bad.join(', '));
    check('страница без ошибок JS (360 px)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 12. Тёмная тема и альбомная ориентация — скриншоты для ручной проверки
  {
    const { ctx, page, errors } = await open(base, { colorScheme: 'dark' });
    await page.screenshot({ path: outDir + 'dark-home.png' });
    await page.click('[data-go="pieces"]');
    await page.waitForSelector('#piecesList .piece');
    await page.click('[data-piece="bratets-yakov"][data-clef="treble"]');
    await page.waitForSelector('#playScreen:not([hidden])');
    await press(page, (await curMidi(page)) + 1);
    await page.screenshot({ path: outDir + 'dark-piece.png' });
    check('тёмная тема без ошибок JS', errors.length === 0, errors.join('; '));
    await ctx.close();
    const land = await open(base + '#random', { viewport: { width: 844, height: 390 } });
    await land.page.click('#startRandom');
    await land.page.screenshot({ path: outDir + 'landscape.png' });
    check('альбомная ориентация: без горизонтальной прокрутки', await noHScroll(land.page));
    await land.ctx.close();
    const desk = await open(base + '#pieces', { viewport: { width: 1280, height: 860 } });
    await desk.page.waitForSelector('#piecesList .piece');
    await desk.page.click('[data-piece="row-row-row-your-boat"][data-clef="bass"]');
    await desk.page.waitForSelector('#playScreen:not([hidden])');
    await desk.page.screenshot({ path: outDir + 'desktop-piece.png' });
    await desk.ctx.close();
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
