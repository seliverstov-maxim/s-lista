// Чтение zip-архива для сжатого MusicXML (.mxl): центральный каталог, методы stored и deflate.
// Формат .mxl: META-INF/container.xml указывает на основной файл (rootfile full-path).
import { inflateRawSync } from 'node:zlib';
import { parseXml, kids, kid, decodeText } from './xml.mjs';

export function readZip(buf) {
  // конец центрального каталога: сигнатура 0x06054b50, ищем с конца (после неё может быть комментарий до 64 КБ)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('это не zip-архив');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff || count === 0xffff) throw new Error('архивы ZIP64 не поддерживаются');
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('повреждён центральный каталог zip-архива');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    entries.set(name, { flags, method, csize, local });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`в архиве нет файла ${name}`);
      if (e.flags & 1) throw new Error('зашифрованные архивы не поддерживаются');
      if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error('повреждён zip-архив');
      // размеры берём из центрального каталога: в локальном заголовке их может не быть (флаг 3)
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return inflateRawSync(data);
      throw new Error(`метод сжатия ${e.method} не поддерживается`);
    },
  };
}

// Текст основного файла MusicXML из архива .mxl
export function readMxl(buf) {
  const zip = readZip(buf);
  let path = null;
  if (zip.has('META-INF/container.xml')) {
    const container = parseXml(decodeText(zip.read('META-INF/container.xml')));
    const files = kids(kid(container, 'rootfiles'), 'rootfile');
    const main = files.find((f) => !f.attrs['media-type'] || /musicxml/.test(f.attrs['media-type'])) || files[0];
    if (main) path = main.attrs['full-path'];
  }
  if (!path) path = zip.names.find((n) => !n.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(n));
  if (!path || !zip.has(path)) throw new Error('в архиве .mxl не найден файл MusicXML');
  return decodeText(zip.read(path));
}
