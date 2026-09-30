-- Реальные данные из официальных открытых наборов (ФНС, ФАС).

-- В реестре МСП есть ИНН, но нет ОГРН
ALTER TABLE suppliers ALTER COLUMN ogrn DROP NOT NULL;
ALTER TABLE suppliers DROP CONSTRAINT suppliers_ogrn_uq;
CREATE UNIQUE INDEX suppliers_ogrn_uq ON suppliers (ogrn) WHERE ogrn IS NOT NULL;

ALTER TABLE suppliers
  ADD COLUMN short_name text,
  ADD COLUMN registry_seen_at date,
  ADD COLUMN declared_products jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX suppliers_source_type_idx ON suppliers (source_type, region_code);

-- Происхождение записи о продукции: ГИСП, заявленная в реестре МСП продукция, основной ОКВЭД, тестовая база
ALTER TABLE product_records DROP CONSTRAINT product_records_origin_check;
ALTER TABLE product_records ADD CONSTRAINT product_records_origin_check
  CHECK (origin IN ('GISP', 'MANUAL_TEST_DATA', 'SME_DECLARED', 'OKVED'));

-- Доходы/расходы из открытых данных ФНС приходят в рублях, тестовая отчётность — в тысячах рублей
ALTER TABLE financial_reports
  ADD COLUMN expenses bigint,
  ADD COLUMN unit text NOT NULL DEFAULT 'THOUSAND_RUB' CHECK (unit IN ('RUB', 'THOUSAND_RUB'));

CREATE INDEX verification_records_source_idx ON verification_records (source, is_manual_test_data);

-- Журнал импорта наборов открытых данных
CREATE TABLE opendata_imports (
  dataset      text PRIMARY KEY,
  source       text NOT NULL,
  title        text NOT NULL,
  data_date    date NOT NULL,
  file_url     text NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  rows_total   bigint NOT NULL DEFAULT 0,
  rows_matched bigint NOT NULL DEFAULT 0,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb
);
