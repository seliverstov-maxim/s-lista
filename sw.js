// Работа без интернета (FR-UI-05). Этот файл — шаблон: scripts/build.mjs подставляет версию и список файлов
// и пишет sw.js в корень сайта. При первом открытии сайта всё скачивается в кеш: страница, пьесы, звуки рояля.
// Дальше:
//   • страница и пьесы — из сети, а без сети (или если сеть молчит 3 с) — из кеша: новые версии видны сразу;
//   • звуки рояля — из кеша, чего нет — из сети;
//   • шрифты Google — из кеша, в фоне обновляются.
// Новая версия (другие файлы или их содержимое) — новый кеш, старый удаляется.
const VERSION = 'ae80a05ff0d9';
const CACHE = 'slista-' + VERSION, FONTS = 'slista-fonts';
const FILES = ["./","index.html","pieces/index.json","pieces/bratets-yakov.json","pieces/k-elize-nachalo.json","pieces/korobeyniki.json","pieces/menuet-sol-mazhor.json","pieces/oda-k-radosti.json","pieces/abc-song.json","pieces/alle-meine-entchen.json","pieces/au-clair-de-la-lune.json","pieces/fuchs-du-hast-die-gans-gestohlen.json","pieces/happy-birthday-to-you.json","pieces/jingle-bells.json","pieces/london-bridge-is-falling-down.json","pieces/mary-had-a-little-lamb.json","pieces/old-macdonald-had-a-farm.json","pieces/row-row-row-your-boat.json","pieces/twinkle-twinkle-little-star.json","sounds/piano/A1.mp3","sounds/piano/A2.mp3","sounds/piano/A3.mp3","sounds/piano/A4.mp3","sounds/piano/A5.mp3","sounds/piano/A6.mp3","sounds/piano/C1.mp3","sounds/piano/C2.mp3","sounds/piano/C3.mp3","sounds/piano/C4.mp3","sounds/piano/C5.mp3","sounds/piano/C6.mp3","sounds/piano/C7.mp3","sounds/piano/Ds1.mp3","sounds/piano/Ds2.mp3","sounds/piano/Ds3.mp3","sounds/piano/Ds4.mp3","sounds/piano/Ds5.mp3","sounds/piano/Ds6.mp3","sounds/piano/Fs1.mp3","sounds/piano/Fs2.mp3","sounds/piano/Fs3.mp3","sounds/piano/Fs4.mp3","sounds/piano/Fs5.mp3","sounds/piano/Fs6.mp3"];
const TIMEOUT = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('slista-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ключ кеша — адрес без ?… (например, ?nocache=…)
const keyOf = (req) => { const u = new URL(req.url); return u.origin + u.pathname; };

// из сети с тайм-аутом; удачный ответ обновляет кеш; нет сети или она молчит — из кеша
function networkFirst(req) {
  return caches.open(CACHE).then((c) => new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    const fromCache = () => c.match(keyOf(req)).then((hit) => { finish(hit); return hit; });
    const timer = setTimeout(fromCache, TIMEOUT);
    fetch(req).then((r) => {
      clearTimeout(timer);
      if (r.ok && !r.redirected) c.put(keyOf(req), r.clone());
      finish(r);
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then((hit) => finish(hit || Response.error()));
    });
  }));
}

function cacheFirst(req) {
  return caches.open(CACHE).then((c) => c.match(keyOf(req)).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) c.put(keyOf(req), r.clone());
    return r;
  })));
}

// шрифты: сразу из кеша, в фоне — свежая копия
function cacheThenRefresh(req) {
  return caches.open(FONTS).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((r) => {
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    }).catch(() => hit || Response.error());
    return hit || net;
  }));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(url.pathname.includes('/sounds/') ? cacheFirst(req) : networkFirst(req));
  else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(cacheThenRefresh(req));
});

// страница спрашивает, всё ли сохранено: сколько файлов, сколько ещё нет, сколько пьес
self.addEventListener('message', (e) => {
  if (e.data !== 'status' || !e.source) return;
  e.waitUntil(caches.open(CACHE).then((c) => c.keys()).then((keys) => {
    const have = new Set(keys.map((k) => new URL(k.url).pathname));
    const missing = FILES.filter((f) => !have.has(new URL(f, self.registration.scope).pathname)).length;
    const pieces = FILES.filter((f) => f.startsWith('pieces/') && f !== 'pieces/index.json').length;
    e.source.postMessage({ type: 'offline', total: FILES.length, missing, pieces, version: VERSION });
  }));
});
