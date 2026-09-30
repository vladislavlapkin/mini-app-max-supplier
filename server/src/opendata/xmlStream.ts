import type { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import yauzl from 'yauzl';

const ENTITIES: Record<string, string> = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'" };

function decodeEntities(v: string): string {
  return v.includes('&') ? v.replace(/&(quot|amp|lt|gt|apos);|&#(\d+);/g, (m, _n, code) => (code ? String.fromCharCode(Number(code)) : ENTITIES[m] ?? m)) : v;
}

export function parseAttrs(tagBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagBody))) out[m[1]] = decodeEntities(m[2]);
  return out;
}

const tagCache = new Map<string, RegExp>();
function tagRe(name: string): RegExp {
  let re = tagCache.get(name);
  if (!re) {
    re = new RegExp(`<${name}(?=[\\s/>])([^>]*)>`, 'g');
    tagCache.set(name, re);
  }
  re.lastIndex = 0;
  return re;
}

/** Атрибуты первого тега с точным именем (например, СвОКВЭДОсн, а не СвОКВЭД). */
export function tagAttrs(xml: string, name: string): Record<string, string> | null {
  const m = tagRe(name).exec(xml);
  return m ? parseAttrs(m[1]) : null;
}

export function allTagAttrs(xml: string, name: string): Record<string, string>[] {
  const re = tagRe(name);
  const out: Record<string, string>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(parseAttrs(m[1]));
  return out;
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => (err || !zip ? reject(err) : resolve(zip))));
}

/** Обходит все XML-файлы архива по очереди, не распаковывая его на диск. */
export async function forEachZipEntry(file: string, onEntry: (name: string, stream: Readable) => Promise<void>): Promise<number> {
  const zip = await openZip(file);
  let count = 0;
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: yauzl.Entry) => {
      if (/\/$/.test(entry.fileName) || !/\.xml$/i.test(entry.fileName)) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err);
        onEntry(entry.fileName, stream)
          .then(() => {
            count += 1;
            zip.readEntry();
          })
          .catch(reject);
      });
    });
    zip.readEntry();
  });
  return count;
}

/**
 * Потоковый разбор XML ФНС: вызывает onDoc для каждого элемента <tag>...</tag>.
 * Кодировка берётся из пролога XML (обычно windows-1251 или UTF-8).
 */
export async function streamElements(stream: Readable, tag: string, onDoc: (xml: string) => void | Promise<void>): Promise<number> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let decoder: TextDecoder | null = null;
  let buf = '';
  let n = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    if (!decoder) {
      const head = chunk.subarray(0, 200).toString('latin1');
      const enc = /encoding="([^"]+)"/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
      decoder = new TextDecoder(enc === 'windows-1251' || enc === 'cp1251' ? 'windows-1251' : enc);
    }
    buf += decoder.decode(chunk, { stream: true });
    let pos = 0;
    for (;;) {
      const start = buf.indexOf(open, pos);
      if (start < 0) {
        pos = buf.length;
        break;
      }
      const end = buf.indexOf(close, start);
      if (end < 0) {
        pos = start;
        break;
      }
      const stop = end + close.length;
      await onDoc(buf.slice(start, stop));
      n += 1;
      pos = stop;
    }
    buf = buf.slice(pos);
  }
  if (decoder) buf += decoder.decode();
  return n;
}
