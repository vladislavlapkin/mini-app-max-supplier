// Показывает структуру архивов открытых данных: число файлов и первый документ каждого набора.
import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';

const dir = process.env.OPENDATA_DIR ?? '/opendata';
const only = process.argv[2];

for (const ds of fs.readdirSync(dir)) {
  if (only && ds !== only) continue;
  const files = fs.readdirSync(path.join(dir, ds)).filter((f) => f.endsWith('.zip'));
  for (const f of files) {
    const file = path.join(dir, ds, f);
    await new Promise((resolve, reject) => {
      yauzl.open(file, { lazyEntries: true }, (err, zip) => {
        if (err) return reject(err);
        let n = 0;
        let shown = false;
        zip.on('entry', (e) => {
          n++;
          if (shown) return zip.readEntry();
          shown = true;
          zip.openReadStream(e, (err2, s) => {
            if (err2) return reject(err2);
            let buf = Buffer.alloc(0);
            s.on('data', (c) => {
              if (buf.length < 6000) buf = Buffer.concat([buf, c]);
            });
            s.on('end', () => {
              const head = buf.subarray(0, 120).toString('latin1');
              const enc = /encoding="([^"]+)"/i.exec(head)?.[1] ?? 'utf-8';
              const text = new TextDecoder(enc.toLowerCase().includes('1251') ? 'windows-1251' : 'utf-8').decode(buf);
              const start = text.indexOf('<Документ');
              const end = text.indexOf('</Документ>', start);
              console.log(`\n== ${ds}/${f} entry=${e.fileName} size=${e.uncompressedSize} enc=${enc}`);
              console.log(text.slice(start, end > 0 ? end + 11 : start + 2500).slice(0, 2500));
              zip.readEntry();
            });
          });
        });
        zip.on('end', () => {
          console.log(`   files in archive: ${n}`);
          resolve();
        });
        zip.readEntry();
      });
    });
  }
}
