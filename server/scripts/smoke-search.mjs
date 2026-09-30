// Проверка поиска на реальных данных через API приложения (демо-пользователь).
const base = process.env.APP_URL ?? 'http://app:8080';
const headers = { 'Content-Type': 'application/json', 'X-Demo-User': 'probe-real-data-0001' };
const queries = [
  { text: 'строительная краска', productId: 'paint_construction', categoryId: 'paints', regionCode: '50', supplierType: 'ANY' },
  { text: 'саморезы', productId: 'screws', categoryId: 'fasteners', regionCode: '71', supplierType: 'MANUFACTURER_ONLY' },
  { text: 'минеральная вата', productId: 'mineral_wool', categoryId: 'insulation', regionCode: 'RU', supplierType: 'ANY', certificate: 'REQUIRED' },
];
for (const q of queries) {
  const t = Date.now();
  const r = await fetch(`${base}/api/search`, { method: 'POST', headers, body: JSON.stringify(q) }).then((x) => x.json());
  console.log(`\n=== ${q.text}, ${q.regionCode}, ${q.supplierType}${q.certificate ? ', docs' : ''} → total ${r.total}, shown ${r.results?.length}, ${Date.now() - t} ms, demo=${r.demo}`);
  for (const s of r.results ?? []) {
    console.log(`- ${s.name} | ИНН ${s.inn} | ${s.supplierTypeLabel} | ${s.city ?? ''}, ${s.region.name} | ${s.legalStatus.label} (${s.legalStatus.provenance?.sourceName}) | МСП: ${s.sme.label} | score ${s.score}`);
  }
  for (const w of r.warnings ?? []) console.log('  ! ' + w);
  if (r.results?.[0]) {
    const card = await fetch(`${base}/api/suppliers/${r.results[0].id}?ctx=${encodeURIComponent(JSON.stringify(r.query))}`, { headers }).then((x) => x.json());
    console.log('  card.transparency:', JSON.stringify({ emp: card.transparency?.employees?.value, tax: card.transparency?.taxRegime?.value, debt: card.transparency?.taxDebt?.value }));
    console.log('  card.sources:', card.sources.map((x) => `${x.name}: ${x.status}`).join(' | '));
    const fin = await fetch(`${base}/api/suppliers/${r.results[0].id}/financials`, { headers }).then((x) => x.json());
    console.log('  financials:', JSON.stringify(fin.periods?.map((p) => ({ y: p.year, rev: p.revenue, exp: p.expenses, unit: p.unit })) ?? fin.message));
    console.log('  reasons:', r.results[0].reasons.map((x) => x.text).join(' / '));
  }
}
