-- «Проверенный поставщик»: базовая схема.
-- Все факты о поставщике хранят источник, тип источника и дату проверки (раздел 13 ТЗ).

CREATE TABLE suppliers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inn                      text NOT NULL,
  ogrn                     text NOT NULL,
  kpp                      text,
  name                     text NOT NULL,
  entity_type              text NOT NULL CHECK (entity_type IN ('LEGAL_ENTITY', 'IP')),
  legal_status             text NOT NULL CHECK (legal_status IN ('ACTIVE', 'INACTIVE', 'UNKNOWN')),
  registration_date        date,
  region_code              text NOT NULL,
  region_name              text NOT NULL,
  city                     text,
  address                  text,
  okved_main               jsonb,
  okved_additional         jsonb NOT NULL DEFAULT '[]'::jsonb,
  director                 text,
  sme_status               text NOT NULL DEFAULT 'UNKNOWN' CHECK (sme_status IN ('MICRO', 'SMALL', 'MEDIUM', 'NOT_FOUND', 'UNKNOWN')),
  supplier_type            text NOT NULL DEFAULT 'UNKNOWN' CHECK (supplier_type IN ('MANUFACTURER', 'DISTRIBUTOR', 'SUPPLIER', 'UNKNOWN')),
  supplier_type_confidence numeric(3, 2) NOT NULL DEFAULT 0,
  supplier_type_basis      text,
  website                  text,
  phone                    text,
  email                    text,
  source_type              text NOT NULL DEFAULT 'MANUAL_TEST_DATA' CHECK (source_type IN ('OFFICIAL', 'MANUAL_TEST_DATA')),
  is_manual_test_data      boolean NOT NULL DEFAULT true,
  checked_at               timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_inn_uq UNIQUE (inn),
  CONSTRAINT suppliers_ogrn_uq UNIQUE (ogrn)
);
CREATE INDEX suppliers_region_idx ON suppliers (region_code);

CREATE TABLE product_records (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id              uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  category_id              text NOT NULL,
  product_id               text,
  title                    text NOT NULL,
  normalized_category      text,
  brand                    text,
  model                    text,
  okpd2                    text,
  origin                   text NOT NULL CHECK (origin IN ('GISP', 'MANUAL_TEST_DATA')),
  gisp_record_number       text,
  pp719_record_number      text,
  russian_origin_confirmed boolean NOT NULL DEFAULT false,
  characteristics          jsonb NOT NULL DEFAULT '{}'::jsonb,
  source                   text NOT NULL,
  source_url               text,
  is_manual_test_data      boolean NOT NULL DEFAULT true,
  updated_at               timestamptz NOT NULL
);
CREATE INDEX product_records_supplier_idx ON product_records (supplier_id);
CREATE INDEX product_records_category_idx ON product_records (category_id);
CREATE INDEX product_records_product_idx ON product_records (product_id);

CREATE TABLE compliance_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  product_record_id   uuid REFERENCES product_records (id) ON DELETE SET NULL,
  product_id          text,
  document_type       text NOT NULL CHECK (document_type IN ('CERTIFICATE', 'DECLARATION')),
  number              text NOT NULL,
  status              text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED', 'ARCHIVED', 'UNKNOWN')),
  manufacturer_inn    text,
  manufacturer_name   text,
  applicant           text,
  product_name        text,
  tech_regulation     text,
  certification_body  text,
  valid_from          date,
  valid_to            date,
  source              text NOT NULL,
  source_url          text NOT NULL,
  is_manual_test_data boolean NOT NULL DEFAULT true,
  checked_at          timestamptz NOT NULL,
  CONSTRAINT compliance_documents_uq UNIQUE (supplier_id, number)
);
CREATE INDEX compliance_documents_supplier_idx ON compliance_documents (supplier_id);

CREATE TABLE verification_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  field               text NOT NULL,
  value               text NOT NULL,
  source              text NOT NULL,
  source_url          text,
  source_type         text NOT NULL CHECK (source_type IN ('OFFICIAL', 'MANUAL_TEST_DATA')),
  checked_at          timestamptz NOT NULL,
  fresh_until         timestamptz,
  confidence          numeric(3, 2) NOT NULL DEFAULT 0,
  is_official         boolean NOT NULL DEFAULT false,
  is_manual_test_data boolean NOT NULL DEFAULT true,
  notes               text
);
CREATE INDEX verification_records_supplier_idx ON verification_records (supplier_id, source);

CREATE TABLE risk_signals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('RNP', 'BANKRUPTCY', 'BANKRUPTCY_INTENT', 'UNRELIABLE_INFO')),
  title               text NOT NULL,
  details             text,
  record_number       text,
  published_at        date,
  source              text NOT NULL,
  source_url          text NOT NULL,
  is_manual_test_data boolean NOT NULL DEFAULT true,
  checked_at          timestamptz NOT NULL
);
CREATE INDEX risk_signals_supplier_idx ON risk_signals (supplier_id);

CREATE TABLE financial_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  period_year         integer NOT NULL,
  revenue             bigint,
  assets              bigint,
  profit              bigint,
  liabilities         bigint,
  capital             bigint,
  source              text NOT NULL,
  source_url          text NOT NULL,
  is_manual_test_data boolean NOT NULL DEFAULT true,
  checked_at          timestamptz NOT NULL,
  CONSTRAINT financial_reports_uq UNIQUE (supplier_id, period_year)
);

-- Пользовательские данные: только MAX ID, без профиля компании (раздел 12 ТЗ)
CREATE TABLE saved_selections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_user_id     text NOT NULL,
  title           text NOT NULL,
  query           jsonb NOT NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz
);
CREATE INDEX saved_selections_user_idx ON saved_selections (max_user_id, created_at DESC);

CREATE TABLE saved_selection_items (
  selection_id uuid NOT NULL REFERENCES saved_selections (id) ON DELETE CASCADE,
  supplier_id  uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  position     integer NOT NULL,
  note         text,
  PRIMARY KEY (selection_id, supplier_id)
);

CREATE TABLE saved_suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_user_id text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  note        text,
  query       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_suppliers_uq UNIQUE (max_user_id, supplier_id)
);

CREATE TABLE search_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_user_id   text NOT NULL,
  query         jsonb NOT NULL,
  results_count integer NOT NULL,
  origin        text NOT NULL DEFAULT 'miniapp',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_history_user_idx ON search_history (max_user_id, created_at DESC);

CREATE TABLE analytics_events (
  id         bigserial PRIMARY KEY,
  user_hash  text,
  search_id  text,
  name       text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_idx ON analytics_events (name, created_at);
CREATE INDEX analytics_events_search_idx ON analytics_events (search_id);

-- Audit trail: какие поля и из каких источников были показаны пользователю
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  request_id  text,
  user_hash   text,
  supplier_id uuid,
  context     text NOT NULL,
  fields      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at);

CREATE TABLE category_requests (
  id         bigserial PRIMARY KEY,
  user_hash  text,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
