import fs from 'node:fs';
import path from 'node:path';
import { compileUnicodePattern, stem, tokenize } from './text';

export interface Unit {
  id: string;
  short: string;
  name: string;
  patterns: string[];
}

export interface Region {
  code: string;
  name: string;
  patterns: string[];
  neighbors: string[];
}

export interface RequiredDocument {
  title: string;
  hint: string;
}

export interface Product {
  id: string;
  name: string;
  normalized: string;
  okpd2: string;
  synonyms: string[];
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  okved: string[];
  industrial: boolean;
  defaultUnit: string;
  synonyms: string[];
  requiredDocuments: RequiredDocument[];
  products: Product[];
}

export interface SourceInfo {
  name: string;
  url: string;
}

export interface CatalogData {
  version: string;
  vertical: string;
  pilotRegions: string[];
  units: Unit[];
  regions: Region[];
  categories: Category[];
  sources: Record<string, SourceInfo>;
}

export interface SynonymEntry {
  text: string;
  stems: string[];
  categoryId: string;
  productId: string | null;
}

export class Catalog {
  readonly regionPatterns: { region: Region; re: RegExp[] }[];
  readonly unitPatterns: { unit: Unit; source: string }[];
  readonly synonyms: SynonymEntry[];
  private readonly regionsByCode = new Map<string, Region>();
  private readonly categoriesById = new Map<string, Category>();
  private readonly productsById = new Map<string, Product & { categoryId: string }>();

  constructor(readonly data: CatalogData) {
    for (const r of data.regions) this.regionsByCode.set(r.code, r);
    for (const c of data.categories) {
      this.categoriesById.set(c.id, c);
      for (const p of c.products) this.productsById.set(p.id, { ...p, categoryId: c.id });
    }
    this.regionPatterns = data.regions.map((region) => ({
      region,
      re: region.patterns.map((p) => compileUnicodePattern(p, 'iu')),
    }));
    this.unitPatterns = data.units
      .flatMap((unit) => unit.patterns.map((source) => ({ unit, source })))
      .sort((a, b) => b.source.length - a.source.length);

    const entries: SynonymEntry[] = [];
    const add = (text: string, categoryId: string, productId: string | null) => {
      const stems = tokenize(text).map(stem);
      if (stems.length) entries.push({ text, stems, categoryId, productId });
    };
    for (const c of data.categories) {
      add(c.name, c.id, null);
      for (const s of c.synonyms) add(s, c.id, null);
      for (const p of c.products) {
        add(p.name, c.id, p.id);
        for (const s of p.synonyms) add(s, c.id, p.id);
      }
    }
    this.synonyms = entries;
  }

  static load(dataDir: string): Catalog {
    const raw = fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8');
    return new Catalog(JSON.parse(raw) as CatalogData);
  }

  region(code: string | null | undefined): Region | undefined {
    return code ? this.regionsByCode.get(code) : undefined;
  }

  category(id: string | null | undefined): Category | undefined {
    return id ? this.categoriesById.get(id) : undefined;
  }

  product(id: string | null | undefined): (Product & { categoryId: string }) | undefined {
    return id ? this.productsById.get(id) : undefined;
  }

  unit(id: string | null | undefined): Unit | undefined {
    return this.data.units.find((u) => u.id === id);
  }

  neighbors(code: string): string[] {
    return this.regionsByCode.get(code)?.neighbors ?? [];
  }

  source(id: string): SourceInfo {
    return this.data.sources[id] ?? { name: id, url: '' };
  }

  /** Публичная часть справочника для mini-app. */
  toPublic() {
    return {
      version: this.data.version,
      vertical: this.data.vertical,
      pilotRegions: this.data.pilotRegions,
      units: this.data.units.map(({ id, short, name }) => ({ id, short, name })),
      regions: this.data.regions.map(({ code, name, neighbors }) => ({ code, name, neighbors })),
      categories: this.data.categories.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        industrial: c.industrial,
        defaultUnit: c.defaultUnit,
        products: c.products.map((p) => ({ id: p.id, name: p.name })),
      })),
    };
  }
}
