import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Logger } from '../logger';

const UA = 'proveren-postavshik/1.0 (+open data import)';

export interface DatasetFile {
  url: string;
  dataDate: string; // YYYY-MM-DD
  structure: string | null;
}

/**
 * Паспорт набора открытых данных (стандарт opendata.gosmonitor.ru 3.0): meta.csv со ссылками на версии.
 * Берём самую свежую ссылку вида data-YYYYMMDD[-structure-YYYYMMDD].zip|csv|xml.
 */
export async function latestFromPassport(passportUrl: string): Promise<DatasetFile> {
  const base = passportUrl.replace(/\/?$/, '/');
  // meta.csv бывает неполным или отстаёт от страницы паспорта, поэтому берём ссылки из обоих мест
  const texts: string[] = [];
  for (const url of [`${base}meta.csv`, base]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) texts.push(await res.text());
    } catch {
      /* пробуем следующий */
    }
  }
  if (!texts.length) throw new Error(`Паспорт набора недоступен: ${base}`);
  const urls = texts.flatMap((t) => [...t.matchAll(/https?:\/\/[^\s",<>']+?data-(\d{8})(?:-structure-(\d{8}))?\.(?:zip|csv|xml|gz)/gi)]);
  if (!urls.length) throw new Error(`В паспорте ${base} нет ссылок на данные`);
  const parse = (d: string) => (/^(19|20)\d{6}$/.test(d) ? d : `${d.slice(4)}${d.slice(2, 4)}${d.slice(0, 2)}`); // YYYYMMDD или DDMMYYYY
  const best = urls
    .map((m) => ({ url: m[0], date: parse(m[1]), structure: m[2] ?? null }))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return { url: best.url, dataDate: `${best.date.slice(0, 4)}-${best.date.slice(4, 6)}-${best.date.slice(6, 8)}`, structure: best.structure };
}

/** Потоковая загрузка с докачкой (Range) и логом прогресса. Повторно не скачивает готовый файл. */
export async function downloadFile(url: string, dest: string, log: Logger, attempts = 5): Promise<string> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
  const total = Number(head.headers.get('content-length') ?? 0);
  if (fs.existsSync(dest) && total && fs.statSync(dest).size === total) {
    log.info({ file: path.basename(dest), mb: Math.round(total / 1048576) }, 'already downloaded');
    return dest;
  }
  const part = `${dest}.part`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...(have ? { Range: `bytes=${have}-` } : {}) },
        signal: AbortSignal.timeout(4 * 3600_000),
      });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const append = res.status === 206 && have > 0;
      let done = append ? have : 0;
      let nextLog = 0;
      const body = Readable.fromWeb(res.body as never);
      body.on('data', (chunk: Buffer) => {
        done += chunk.length;
        const pct = total ? Math.floor((done / total) * 100) : 0;
        if (pct >= nextLog) {
          log.info({ file: path.basename(dest), pct, mb: Math.round(done / 1048576) }, 'downloading');
          nextLog = pct + 5;
        }
      });
      await pipeline(body, fs.createWriteStream(part, { flags: append ? 'a' : 'w' }));
      if (total && fs.statSync(part).size !== total) throw new Error('размер файла не совпал');
      fs.renameSync(part, dest);
      log.info({ file: path.basename(dest) }, 'download complete');
      return dest;
    } catch (err) {
      log.warn({ file: path.basename(dest), attempt, err: (err as Error).message }, 'download failed, retrying');
      await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt)));
    }
  }
  throw new Error(`Не удалось скачать ${url}`);
}
