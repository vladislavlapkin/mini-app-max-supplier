/** Нормализация: нижний регистр, ё→е, всё кроме букв/цифр → пробел. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Лёгкая нормализация для регулярных выражений (сохраняет пунктуацию и числа с запятой). */
export function soften(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function tokenize(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

const ENDINGS = [
  'иями', 'ями', 'ами', 'ией', 'иях', 'ях', 'ах', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
  'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю', 'ом', 'ем', 'ов', 'ев',
  'ам', 'ям', 'ия', 'ья', 'ье', 'ьи', 'ию', 'ью', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
];

/** Упрощённый стеммер для русского: отрезает одно окончание, оставляя основу не короче 3 символов. */
export function stem(word: string): string {
  if (!/[а-я]/.test(word)) return word;
  for (const end of ENDINGS) {
    if (word.length - end.length >= 3 && word.endsWith(end)) return word.slice(0, -end.length);
  }
  return word;
}

export function levenshtein(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

/**
 * Преобразует шаблон из справочника в Unicode-регулярку:
 * \b и \w в JS работают только с латиницей, поэтому заменяем их на классы \p{L}\p{N}.
 */
export function compileUnicodePattern(source: string, flags = 'u'): RegExp {
  const wordChar = '[\\p{L}\\p{N}_]';
  const boundary = `(?:(?<!${wordChar})(?=${wordChar})|(?<=${wordChar})(?!${wordChar}))`;
  const converted = source.replace(/\\b/g, boundary).replace(/\\w/g, wordChar);
  return new RegExp(converted, flags.includes('u') ? flags : flags + 'u');
}

const PLURAL_CACHE = new Map<string, string>();

/** Склонение: plural(5, ['поставщик', 'поставщика', 'поставщиков']). */
export function plural(n: number, forms: [string, string, string]): string {
  const key = `${n}:${forms[0]}`;
  const cached = PLURAL_CACHE.get(key);
  if (cached) return cached;
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  PLURAL_CACHE.set(key, form);
  return form;
}

export function formatDateRu(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' });
}
