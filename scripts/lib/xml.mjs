// Маленький XML-парсер для MusicXML: элементы, атрибуты и текст.
// Пространства имён, DTD и проверка по схеме не нужны — MusicXML их не использует для нот.
// Узел: { name, attrs, children, text }; text — склеенный текст непосредственно внутри элемента.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][\w.-]*);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

// Текст файла: UTF-8 или UTF-16 по метке порядка байтов
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2));
    for (let i = 0; i + 1 < le.length; i += 2) { const t = le[i]; le[i] = le[i + 1]; le[i + 1] = t; }
    return le.toString('utf16le');
  }
  const s = buf.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isNameEnd = (c) => isSpace(c) || c === '/' || c === '>' || c === '=';

export function parseXml(src) {
  const n = src.length;
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const doc = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [doc];
  const fail = (msg, at) => { throw new Error(`${msg} (строка ${src.slice(0, at).split('\n').length})`); };
  const addText = (el, raw) => { if (el !== doc) el.text += decodeEntities(raw); };
  while (i < n) {
    const cur = stack[stack.length - 1];
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(cur, src.slice(i)); break; }
    if (lt > i) addText(cur, src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      if (e < 0) fail('незакрытый комментарий', lt);
      i = e + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      if (e < 0) fail('незакрытый блок CDATA', lt);
      if (cur !== doc) cur.text += src.slice(lt + 9, e);
      i = e + 3;
    } else if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt + 2);
      if (e < 0) fail('незакрытая инструкция <?…?>', lt);
      i = e + 2;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE и другие объявления, в том числе с внутренним подмножеством […]
      let j = lt + 2, depth = 0, quote = '';
      for (; j < n; j++) {
        const c = src[j];
        if (quote) { if (c === quote) quote = ''; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= n) fail('незакрытое объявление <!…>', lt);
      i = j + 1;
    } else if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      if (e < 0) fail('незакрытый тег', lt);
      const name = src.slice(lt + 2, e).trim();
      if (cur === doc) fail(`лишний закрывающий тег </${name}>`, lt);
      if (cur.name !== name) fail(`ожидался </${cur.name}>, а встретился </${name}>`, lt);
      stack.pop();
      i = e + 1;
    } else {
      let j = lt + 1;
      while (j < n && !isNameEnd(src[j])) j++;
      const name = src.slice(lt + 1, j);
      if (!name) fail('пустое имя тега', lt);
      const attrs = {};
      let selfClose = false;
      for (;;) {
        while (j < n && isSpace(src[j])) j++;
        if (j >= n) fail(`незакрытый тег <${name}>`, lt);
        if (src[j] === '>') { j++; break; }
        if (src[j] === '/' && src[j + 1] === '>') { selfClose = true; j += 2; break; }
        let k = j;
        while (k < n && !isNameEnd(src[k])) k++;
        const an = src.slice(j, k);
        while (k < n && isSpace(src[k])) k++;
        if (!an || src[k] !== '=') fail(`неверный атрибут в теге <${name}>`, j);
        k++;
        while (k < n && isSpace(src[k])) k++;
        const q = src[k];
        if (q !== '"' && q !== "'") fail(`значение атрибута ${an} без кавычек`, k);
        const e = src.indexOf(q, k + 1);
        if (e < 0) fail(`незакрытое значение атрибута ${an}`, k);
        attrs[an] = decodeEntities(src.slice(k + 1, e));
        j = e + 1;
      }
      if (cur === doc && doc.children.length) fail('больше одного корневого элемента', lt);
      const el = { name, attrs, children: [], text: '' };
      cur.children.push(el);
      if (!selfClose) stack.push(el);
      i = j;
    }
  }
  if (stack.length > 1) fail(`не закрыт элемент <${stack[stack.length - 1].name}>`, n);
  if (!doc.children.length) fail('нет корневого элемента', n);
  return doc.children[0];
}

// Навигация по дереву
export const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
export const kid = (el, name) => (el ? el.children.find((c) => c.name === name) || null : null);
export const textOf = (el, name) => {
  const c = name ? kid(el, name) : el;
  return c ? c.text.trim() : null;
};
