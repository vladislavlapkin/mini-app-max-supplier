/**
 * Импорт официальных открытых данных.
 *   download [ids...]  — скачать свежие версии наборов ФНС в OPENDATA_DIR
 *   import             — разобрать архивы и загрузить реальных поставщиков в PostgreSQL
 *   all                — download + import
 *   rnp                — импорт РНП ФАС (нужен доступ к fas.gov.ru с российского IP)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config';
import { createDb, runMigrations } from '../infra/db';
import { createLogger } from '../logger';
import { FNS_DATASETS } from './datasets';
import { downloadFile, latestFromPassport } from './download';

export function cachePath(dir: string, id: string, url: string): string {
  return path.join(dir, id, path.basename(new URL(url).pathname));
}

export async function downloadAll(dir: string, ids: string[], log: ReturnType<typeof createLogger>) {
  const out: Record<string, { file: string; dataDate: string; url: string }> = {};
  for (const ds of FNS_DATASETS.filter((d) => !ids.length || ids.includes(d.id))) {
    const latest = await latestFromPassport(ds.passport);
    const file = cachePath(dir, ds.id, latest.url);
    log.info({ dataset: ds.id, url: latest.url, dataDate: latest.dataDate }, 'dataset version');
    await downloadFile(latest.url, file, log);
    out[ds.id] = { file, dataDate: latest.dataDate, url: latest.url };
    fs.writeFileSync(path.join(dir, ds.id, 'latest.json'), JSON.stringify(out[ds.id], null, 2));
  }
  return out;
}

async function main() {
  const [cmd = 'all', ...args] = process.argv.slice(2);
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  const dir = config.OPENDATA_DIR;
  fs.mkdirSync(dir, { recursive: true });

  if (cmd === 'download' || cmd === 'all') await downloadAll(dir, cmd === 'download' ? args : [], log);

  if (cmd === 'import' || cmd === 'all' || cmd === 'rnp') {
    const db = createDb(config.DATABASE_URL);
    try {
      await runMigrations(db, config.migrationsDir, log);
      const { importFns, importFasRnp } = await import('./importer');
      if (cmd === 'rnp') await importFasRnp(db, dir, log);
      // import enrich — только наборы численности/режимов/задолженности/доходов без повторного разбора реестра МСП
      else await importFns(db, dir, log, { regions: config.OPENDATA_REGIONS, only: cmd === 'import' && args.length ? args : undefined });
    } finally {
      await db.end();
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
