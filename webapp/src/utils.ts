export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' });
}

/** Суммы в ГИР БО хранятся в тысячах рублей. */
export function formatThousandRub(v: number | null): string {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млрд ₽`;
  if (abs >= 1_000) return `${(v / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₽`;
  return `${v.toLocaleString('ru-RU')} тыс. ₽`;
}

const VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';

/**
 * Мягкие переносы для длинных слов в узких плитках: браузер переносит по слогам, а не посреди буквосочетания.
 * Упрощённое правило: граница после гласной перед «согласная + гласная», минимум два символа по краям.
 */
export function softHyphens(text: string): string {
  return text.replace(/[А-Яа-яЁё]{9,}/g, (word) => {
    let out = '';
    for (let i = 0; i < word.length; i++) {
      out += word[i];
      const isBoundary =
        i >= 1 && i < word.length - 3 && VOWELS.includes(word[i]) && !VOWELS.includes(word[i + 1]) && VOWELS.includes(word[i + 2]) && !'йЙьъ'.includes(word[i + 1]);
      if (isBoundary) out += '­';
    }
    return out;
  });
}

export function suppliersWord(n: number): string {
  return plural(n, ['поставщик', 'поставщика', 'поставщиков']);
}
