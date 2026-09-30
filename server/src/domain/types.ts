import { z } from 'zod';

export const SUPPLIER_TYPE_PREFS = ['MANUFACTURER_ONLY', 'MANUFACTURER_OR_DISTRIBUTOR', 'ANY'] as const;
export const CERTIFICATE_REQUIREMENTS = ['REQUIRED', 'PREFERRED', 'NOT_REQUIRED'] as const;

export type SupplierTypePref = (typeof SUPPLIER_TYPE_PREFS)[number];
export type CertificateRequirement = (typeof CERTIFICATE_REQUIREMENTS)[number];
export type SupplierType = 'MANUFACTURER' | 'DISTRIBUTOR' | 'SUPPLIER' | 'UNKNOWN';
export type LegalStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
export type SmeStatus = 'MICRO' | 'SMALL' | 'MEDIUM' | 'NOT_FOUND' | 'UNKNOWN';
export type SourceType = 'OFFICIAL' | 'MANUAL_TEST_DATA';

export const volumeSchema = z.object({
  value: z.number().positive().max(1e9),
  unit: z.string().min(1).max(16),
  operator: z.enum(['lte', 'gte', 'eq']).default('lte'),
});
export type Volume = z.infer<typeof volumeSchema>;

/** Итоговый поисковый запрос — одинаковый для бота, search_token и mini-app. */
export const searchQuerySchema = z.object({
  text: z.string().trim().max(200).default(''),
  productId: z.string().max(64).nullable().default(null),
  categoryId: z.string().max(64).nullable().default(null),
  regionCode: z.string().max(8).nullable().default(null),
  strictRegion: z.boolean().default(false),
  supplierType: z.enum(SUPPLIER_TYPE_PREFS).default('ANY'),
  volume: volumeSchema.nullable().default(null),
  certificate: z.enum(CERTIFICATE_REQUIREMENTS).default('PREFERRED'),
  russianOnly: z.boolean().default(false),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Происхождение каждого показанного поля (раздел 13 ТЗ). */
export interface Provenance {
  source: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: SourceType;
  checkedAt: string | null;
  freshUntil: string | null;
  confidence: number;
  isOfficial: boolean;
  isManualTestData: boolean;
  stale: boolean;
}

export interface Fact<T> {
  value: T;
  provenance: Provenance | null;
}

export const SUPPLIER_TYPE_LABEL: Record<SupplierType, string> = {
  MANUFACTURER: 'Производитель',
  DISTRIBUTOR: 'Дистрибьютор',
  SUPPLIER: 'Поставщик',
  UNKNOWN: 'Тип не определён',
};

export const SUPPLIER_PREF_LABEL: Record<SupplierTypePref, string> = {
  MANUFACTURER_ONLY: 'только производитель',
  MANUFACTURER_OR_DISTRIBUTOR: 'производитель или дистрибьютор',
  ANY: 'любой поставщик',
};

export const CERTIFICATE_LABEL: Record<CertificateRequirement, string> = {
  REQUIRED: 'документы обязательны',
  PREFERRED: 'документы желательны',
  NOT_REQUIRED: 'документы не важны',
};

export const SME_LABEL: Record<SmeStatus, string> = {
  MICRO: 'Микропредприятие',
  SMALL: 'Малое предприятие',
  MEDIUM: 'Среднее предприятие',
  NOT_FOUND: 'Статус МСП не подтверждён',
  UNKNOWN: 'Нет данных',
};
