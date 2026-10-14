-- SAFQA core schema
-- Conventions:
--   * money is numeric(14,2) in EGP
--   * every externally collected record keeps source_id, collected/observed time and collection_method
--   * timestamps are timestamptz (UTC stored; displayed in Africa/Cairo)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- utilities
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- users & settings
CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','operator','viewer')),
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by bigint REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- ---------------------------------------------------------------- sources & ingestion
CREATE TABLE data_sources (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  platform            text NOT NULL,          -- tiktok, facebook, instagram, google_trends, amazon_eg, noon, jumia, telegram, manual, csv, ...
  kind                text NOT NULL CHECK (kind IN ('api','manual','csv','telegram','webhook','third_party')),
  access_status       text NOT NULL DEFAULT 'disabled'
                      CHECK (access_status IN ('enabled','disabled','pending_credentials','not_available','error')),
  is_demo             boolean NOT NULL DEFAULT false,
  daily_request_limit integer NOT NULL DEFAULT 100 CHECK (daily_request_limit >= 0),
  requests_today      integer NOT NULL DEFAULT 0,
  requests_day        date,
  notes               text,
  config              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER data_sources_updated BEFORE UPDATE ON data_sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ingestion_runs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id       bigint REFERENCES data_sources(id),
  job_type        text NOT NULL,
  idempotency_key text UNIQUE,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','partial','failed')),
  triggered_by    text NOT NULL DEFAULT 'system',
  items_received  integer NOT NULL DEFAULT 0,
  items_created   integer NOT NULL DEFAULT 0,
  items_duplicate integer NOT NULL DEFAULT 0,
  items_failed    integer NOT NULL DEFAULT 0,
  error_message   text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX ingestion_runs_started_idx ON ingestion_runs (started_at DESC);

CREATE TABLE raw_observations (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id         bigint NOT NULL REFERENCES data_sources(id),
  ingestion_run_id  bigint REFERENCES ingestion_runs(id),
  observation_type  text NOT NULL CHECK (observation_type IN ('trend','retail_offer','supplier_post','other')),
  external_id       text,
  source_url        text,
  content_hash      text NOT NULL,
  payload           jsonb NOT NULL,
  collected_at      timestamptz NOT NULL,
  collection_method text NOT NULL
                    CHECK (collection_method IN ('api','manual_entry','csv_import','telegram_bot','owner_screenshot','webhook','third_party')),
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending','processed','ignored','failed')),
  processing_error  text,
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, content_hash)
);
CREATE INDEX raw_observations_pending_idx ON raw_observations (processing_status, created_at) WHERE processing_status = 'pending';

-- ---------------------------------------------------------------- catalog
CREATE TABLE products (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_ar        text NOT NULL,
  name_en        text,
  normalized_key text NOT NULL,
  category       text NOT NULL DEFAULT 'general',
  description    text,
  image_url      text,
  image_rights   text NOT NULL DEFAULT 'none' CHECK (image_rights IN ('owned','authorized','reference_only','none')),
  risk_category  text NOT NULL DEFAULT 'general'
                 CHECK (risk_category IN ('general','cosmetics','medical','electronics','food','children','regulated','prohibited')),
  status         text NOT NULL DEFAULT 'candidate'
                 CHECK (status IN ('candidate','researching','testing','active','paused','stopped','rejected')),
  created_by     bigint REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_normalized_trgm ON products USING gin (normalized_key gin_trgm_ops);
CREATE TRIGGER products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_variants (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku           text NOT NULL UNIQUE,
  variant_key   text NOT NULL,                -- deterministic key from distinguishing attributes
  label         text NOT NULL,
  brand         text,
  model_number  text,
  color         text,
  size_label    text,
  dimensions    text,
  capacity      text,
  material      text,
  quality_grade text,
  weight_grams  integer CHECK (weight_grams IS NULL OR weight_grams > 0),
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified      boolean NOT NULL DEFAULT false,  -- owner confirmed the exact physical variant
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, variant_key)
);
CREATE TRIGGER product_variants_updated BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE trend_signals (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id         bigint REFERENCES products(id) ON DELETE SET NULL,
  source_id          bigint NOT NULL REFERENCES data_sources(id),
  raw_observation_id bigint REFERENCES raw_observations(id),
  title_raw          text NOT NULL,
  platform           text NOT NULL,
  source_url         text,
  image_url          text,
  region             text NOT NULL DEFAULT 'EG',     -- ISO country or GLOBAL
  metric_type        text,                           -- views, likes, search_interest, ad_count, ...
  metric_value       numeric(18,2),
  previous_value     numeric(18,2),
  measured_growth_pct numeric(10,2),
  evidence_type      text NOT NULL CHECK (evidence_type IN ('measured','owner_reported','ai_hypothesis')),
  confidence         numeric(3,2) NOT NULL DEFAULT 0.30 CHECK (confidence BETWEEN 0 AND 1),
  collection_method  text NOT NULL,
  discovered_at      timestamptz NOT NULL,
  last_verified_at   timestamptz,
  status             text NOT NULL DEFAULT 'new' CHECK (status IN ('new','saved','researching','rejected','linked')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- an AI hypothesis can never carry "measured" growth numbers
  CONSTRAINT hypothesis_has_no_measured_growth CHECK (evidence_type <> 'ai_hypothesis' OR measured_growth_pct IS NULL)
);
CREATE INDEX trend_signals_discovered_idx ON trend_signals (discovered_at DESC);
CREATE INDEX trend_signals_product_idx ON trend_signals (product_id);

CREATE TABLE retail_offers (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id         bigint NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  source_id          bigint NOT NULL REFERENCES data_sources(id),
  raw_observation_id bigint REFERENCES raw_observations(id),
  retailer           text NOT NULL,          -- amazon_eg, noon, jumia, facebook_page, other
  seller_name        text,
  url                text NOT NULL,
  title_raw          text,
  listed_price       numeric(14,2) NOT NULL CHECK (listed_price > 0),
  original_price     numeric(14,2) CHECK (original_price IS NULL OR original_price > 0),
  shipping_cost      numeric(14,2) CHECK (shipping_cost IS NULL OR shipping_cost >= 0),
  price_type         text NOT NULL DEFAULT 'listed' CHECK (price_type IN ('listed','promotional','historical','observed_transaction')),
  availability       text NOT NULL DEFAULT 'unknown' CHECK (availability IN ('in_stock','out_of_stock','unknown')),
  match_status       text NOT NULL DEFAULT 'unreviewed' CHECK (match_status IN ('exact','probable','mismatch','unreviewed')),
  match_confidence   numeric(3,2) NOT NULL DEFAULT 0 CHECK (match_confidence BETWEEN 0 AND 1),
  is_outlier         boolean NOT NULL DEFAULT false,
  collection_method  text NOT NULL,
  observed_at        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, url, observed_at)
);
CREATE INDEX retail_offers_variant_idx ON retail_offers (variant_id, observed_at DESC);

CREATE TABLE price_snapshots (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id  bigint NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('retail_min','retail_median','retail_max','wholesale_best','recommended_price')),
  value       numeric(14,2) NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_snapshots_variant_idx ON price_snapshots (variant_id, kind, computed_at DESC);

-- ---------------------------------------------------------------- suppliers
CREATE TABLE suppliers (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               text NOT NULL,
  shop_name          text,
  market_area        text NOT NULL DEFAULT 'other_cairo'
                     CHECK (market_area IN ('mosky','ataba','other_cairo','other_egypt','online')),
  address            text,
  phone              text,
  whatsapp           text,
  telegram_handle    text,
  telegram_chat_id   text UNIQUE,
  return_policy      text,
  pickup_options     text,
  delivery_options   text,
  reliability_rating numeric(2,1) CHECK (reliability_rating IS NULL OR reliability_rating BETWEEN 0 AND 5),
  reliability_notes  text,
  is_active          boolean NOT NULL DEFAULT true,
  last_contact_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER suppliers_updated BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE supplier_offers (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id        bigint NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  variant_id         bigint REFERENCES product_variants(id) ON DELETE SET NULL,
  source_id          bigint REFERENCES data_sources(id),
  raw_observation_id bigint REFERENCES raw_observations(id),
  title_raw          text NOT NULL,
  quoted_price       numeric(14,2) CHECK (quoted_price IS NULL OR quoted_price > 0),
  price_uncertain    boolean NOT NULL DEFAULT false,
  min_order_qty      integer NOT NULL DEFAULT 1 CHECK (min_order_qty >= 1),
  source_url         text,
  source_post_id     text,
  evidence_note      text,
  quoted_at          timestamptz NOT NULL,
  stale_after_days   integer NOT NULL DEFAULT 7 CHECK (stale_after_days > 0),
  status             text NOT NULL DEFAULT 'unverified'
                     CHECK (status IN ('unverified','verified','stale','unavailable','rejected')),
  match_status       text NOT NULL DEFAULT 'unmatched'
                     CHECK (match_status IN ('unmatched','probable','confirmed','mismatch')),
  match_confidence   numeric(3,2) NOT NULL DEFAULT 0 CHECK (match_confidence BETWEEN 0 AND 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX supplier_offers_post_uq ON supplier_offers (supplier_id, source_post_id) WHERE source_post_id IS NOT NULL;
CREATE INDEX supplier_offers_variant_idx ON supplier_offers (variant_id);
CREATE TRIGGER supplier_offers_updated BEFORE UPDATE ON supplier_offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A human-recorded confirmation of stock/price. AI may never insert here (verified_by is required).
CREATE TABLE availability_verifications (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_offer_id  bigint NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
  verified_by        bigint NOT NULL REFERENCES users(id),
  method             text NOT NULL CHECK (method IN ('phone','whatsapp','in_person','telegram','other')),
  result             text NOT NULL CHECK (result IN ('available','unavailable','partial','price_changed')),
  confirmed_price    numeric(14,2) CHECK (confirmed_price IS NULL OR confirmed_price > 0),
  confirmed_quantity integer CHECK (confirmed_quantity IS NULL OR confirmed_quantity >= 0),
  confirmed_moq      integer CHECK (confirmed_moq IS NULL OR confirmed_moq >= 1),
  notes              text,
  evidence_url       text,
  verified_at        timestamptz NOT NULL DEFAULT now(),
  valid_until        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > verified_at)
);
CREATE INDEX availability_verifications_offer_idx ON availability_verifications (supplier_offer_id, verified_at DESC);

-- ---------------------------------------------------------------- scoring & decisions
CREATE TABLE product_scores (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id        bigint NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  total_score       numeric(5,2) NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  demand_score      numeric(5,2) NOT NULL,
  profit_score      numeric(5,2) NOT NULL,
  supplier_score    numeric(5,2) NOT NULL,
  risk_score        numeric(5,2) NOT NULL,
  competition_score numeric(5,2) NOT NULL,
  weights           jsonb NOT NULL,
  confidence        text NOT NULL CHECK (confidence IN ('low','medium','high')),
  band              text NOT NULL CHECK (band IN ('high_priority','manual_review','reject')),
  explanation       jsonb NOT NULL,
  inputs            jsonb NOT NULL,
  model_version     text NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_scores_variant_idx ON product_scores (variant_id, computed_at DESC);

CREATE TABLE opportunities (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id             bigint NOT NULL UNIQUE REFERENCES product_variants(id) ON DELETE CASCADE,
  latest_score_id        bigint REFERENCES product_scores(id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'new'
                         CHECK (status IN ('new','saved','researching','awaiting_approval','approved','rejected','archived')),
  recommended_price      numeric(14,2),
  best_supplier_offer_id bigint REFERENCES supplier_offers(id) ON DELETE SET NULL,
  estimated_unit_profit  numeric(14,2),
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER opportunities_updated BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_decisions (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  opportunity_id      bigint REFERENCES opportunities(id),
  variant_id          bigint NOT NULL REFERENCES product_variants(id),
  supplier_offer_id   bigint NOT NULL REFERENCES supplier_offers(id),
  verification_id     bigint REFERENCES availability_verifications(id),
  quantity            integer NOT NULL CHECK (quantity > 0),
  unit_cost           numeric(14,2) NOT NULL CHECK (unit_cost > 0),
  pickup_cost         numeric(14,2) NOT NULL DEFAULT 0 CHECK (pickup_cost >= 0),
  planned_total_cost  numeric(14,2) NOT NULL CHECK (planned_total_cost > 0),
  planned_sell_price  numeric(14,2) NOT NULL CHECK (planned_sell_price > 0),
  compliance_ack      boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  gate_results        jsonb NOT NULL DEFAULT '[]'::jsonb,
  economics           jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by        bigint REFERENCES users(id),
  decided_by          bigint REFERENCES users(id),
  decided_at          timestamptz,
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'pending' OR decided_by IS NOT NULL)
);

-- ---------------------------------------------------------------- purchasing & inventory
CREATE TABLE purchase_orders (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_number         text NOT NULL UNIQUE,
  decision_id       bigint NOT NULL UNIQUE REFERENCES purchase_decisions(id),
  supplier_id       bigint NOT NULL REFERENCES suppliers(id),
  variant_id        bigint NOT NULL REFERENCES product_variants(id),
  quantity_ordered  integer NOT NULL CHECK (quantity_ordered > 0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_cost         numeric(14,2) NOT NULL CHECK (unit_cost > 0),
  pickup_cost       numeric(14,2) NOT NULL DEFAULT 0,
  total_cost        numeric(14,2) NOT NULL,
  paid_amount       numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status            text NOT NULL DEFAULT 'ordered'
                    CHECK (status IN ('ordered','partially_received','received','cancelled')),
  ordered_at        timestamptz NOT NULL DEFAULT now(),
  received_at       timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity_received <= quantity_ordered),
  CHECK (paid_amount <= total_cost)
);
CREATE TRIGGER purchase_orders_updated BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE inventory_batches (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id        bigint NOT NULL REFERENCES product_variants(id),
  purchase_order_id bigint REFERENCES purchase_orders(id),
  quantity_received integer NOT NULL CHECK (quantity_received > 0),
  unit_cost         numeric(14,2) NOT NULL CHECK (unit_cost >= 0),   -- landed cost per unit
  received_by       bigint REFERENCES users(id),
  received_at       timestamptz NOT NULL DEFAULT now(),
  notes             text
);

-- Current stock per variant. CHECK constraints make overselling impossible at the DB level.
CREATE TABLE inventory_levels (
  variant_id        bigint PRIMARY KEY REFERENCES product_variants(id),
  on_hand           integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved          integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  in_transit        integer NOT NULL DEFAULT 0 CHECK (in_transit >= 0),
  sold              integer NOT NULL DEFAULT 0 CHECK (sold >= 0),
  returned          integer NOT NULL DEFAULT 0 CHECK (returned >= 0),
  defective         integer NOT NULL DEFAULT 0 CHECK (defective >= 0),
  total_received    integer NOT NULL DEFAULT 0 CHECK (total_received >= 0),
  avg_unit_cost     numeric(14,2) NOT NULL DEFAULT 0 CHECK (avg_unit_cost >= 0),
  reorder_threshold integer NOT NULL DEFAULT 3 CHECK (reorder_threshold >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved <= on_hand)
);

CREATE TABLE stock_movements (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id       bigint NOT NULL REFERENCES product_variants(id),
  batch_id         bigint REFERENCES inventory_batches(id),
  movement_type    text NOT NULL CHECK (movement_type IN
                   ('receive','reserve','unreserve','ship','deliver','return_restock','return_defective','adjust','damage')),
  on_hand_delta    integer NOT NULL DEFAULT 0,
  reserved_delta   integer NOT NULL DEFAULT 0,
  in_transit_delta integer NOT NULL DEFAULT 0,
  sold_delta       integer NOT NULL DEFAULT 0,
  defective_delta  integer NOT NULL DEFAULT 0,
  reference_type   text,
  reference_id     bigint,
  note             text,
  created_by       bigint REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_variant_idx ON stock_movements (variant_id, created_at DESC);

-- ---------------------------------------------------------------- sales
CREATE TABLE customers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  phone      text NOT NULL,
  city       text,
  address    text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_phone_uq ON customers (phone);

CREATE TABLE campaign_results (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id         bigint REFERENCES product_variants(id),
  name               text NOT NULL,
  platform           text NOT NULL CHECK (platform IN ('facebook','instagram','whatsapp','tiktok','other')),
  campaign_type      text NOT NULL CHECK (campaign_type IN ('organic','paid')),
  start_date         date NOT NULL,
  end_date           date,
  spend              numeric(14,2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  impressions        integer,
  clicks             integer,
  messages           integer,
  notes              text,
  data_source        text NOT NULL DEFAULT 'manual_entry',
  recorded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_orders (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number         text NOT NULL UNIQUE,
  customer_id          bigint NOT NULL REFERENCES customers(id),
  channel              text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('facebook','instagram','whatsapp','tiktok','other')),
  campaign_id          bigint REFERENCES campaign_results(id),
  status               text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','confirmed','packed','shipped','delivered','returned','failed_delivery','cancelled')),
  payment_method       text NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod','instapay','vodafone_cash','bank','cash','other')),
  subtotal             numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  shipping_fee_charged numeric(14,2) NOT NULL DEFAULT 0 CHECK (shipping_fee_charged >= 0),
  total_due            numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_due >= 0),
  delivery_address     text,
  city                 text,
  notes                text,
  reconciled_at        timestamptz,
  confirmed_at         timestamptz,
  packed_at            timestamptz,
  shipped_at           timestamptz,
  delivered_at         timestamptz,
  returned_at          timestamptz,
  cancelled_at         timestamptz,
  created_by           bigint REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_orders_status_idx ON sales_orders (status, created_at DESC);
CREATE TRIGGER sales_orders_updated BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           bigint NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  variant_id         bigint NOT NULL REFERENCES product_variants(id),
  quantity           integer NOT NULL CHECK (quantity > 0),
  unit_price         numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost_snapshot numeric(14,2),           -- average landed cost captured when shipped (COGS)
  returned_quantity  integer NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  CHECK (returned_quantity <= quantity),
  UNIQUE (order_id, variant_id)
);

CREATE TABLE shipments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         bigint NOT NULL UNIQUE REFERENCES sales_orders(id) ON DELETE CASCADE,
  carrier          text NOT NULL,
  tracking_number  text,
  status           text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','delivered','failed','returned')),
  carrier_cost     numeric(14,2) NOT NULL DEFAULT 0 CHECK (carrier_cost >= 0),
  return_cost      numeric(14,2) NOT NULL DEFAULT 0 CHECK (return_cost >= 0),
  attempts         integer NOT NULL DEFAULT 1,
  shipped_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);

CREATE TABLE payments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES sales_orders(id),
  direction    text NOT NULL CHECK (direction IN ('in','refund')),
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  fee_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  method       text NOT NULL,
  collected_by text NOT NULL DEFAULT 'carrier' CHECK (collected_by IN ('carrier','self','gateway')),
  status       text NOT NULL DEFAULT 'collected' CHECK (status IN ('pending','collected','failed')),
  reference    text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_by   bigint REFERENCES users(id)
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE returns (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id             bigint NOT NULL REFERENCES sales_orders(id),
  order_item_id        bigint NOT NULL REFERENCES order_items(id),
  kind                 text NOT NULL CHECK (kind IN ('failed_delivery','customer_return')),
  quantity             integer NOT NULL CHECK (quantity > 0),
  condition            text NOT NULL CHECK (condition IN ('resellable','defective')),
  refund_amount        numeric(14,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  return_shipping_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (return_shipping_cost >= 0),
  reason               text,
  created_by           bigint REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- money
CREATE TABLE expenses (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category    text NOT NULL CHECK (category IN
              ('advertising','packaging','transport','shipping','payment_fees','returns','tools','software','other')),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  variant_id  bigint REFERENCES product_variants(id),
  campaign_id bigint REFERENCES campaign_results(id),
  order_id    bigint REFERENCES sales_orders(id),
  receipt_url text,
  incurred_at timestamptz NOT NULL DEFAULT now(),
  created_by  bigint REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_incurred_idx ON expenses (incurred_at DESC);

-- Single source of truth for cash. Positive = cash in, negative = cash out.
CREATE TABLE cash_ledger (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_type     text NOT NULL CHECK (entry_type IN
                 ('capital_in','capital_out','purchase_payment','expense','customer_collection','collection_fee',
                  'refund','carrier_cost','adjustment')),
  amount         numeric(14,2) NOT NULL CHECK (amount <> 0),
  reference_type text,
  reference_id   bigint,
  description    text NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_by     bigint REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (entry_type IN ('capital_in','customer_collection') AND amount > 0) OR
    (entry_type IN ('capital_out','purchase_payment','expense','collection_fee','refund','carrier_cost') AND amount < 0) OR
    entry_type = 'adjustment'
  )
);
CREATE INDEX cash_ledger_occurred_idx ON cash_ledger (occurred_at DESC);

-- ---------------------------------------------------------------- marketing
CREATE TABLE marketing_assets (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id   bigint NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  asset_type   text NOT NULL CHECK (asset_type IN ('caption','description','selling_points','post_concept','image')),
  content      text,
  image_url    text,
  image_rights text CHECK (image_rights IS NULL OR image_rights IN ('owned','authorized')),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','archived')),
  generated_by text NOT NULL CHECK (generated_by IN ('ai','owner','template')),
  ai_model     text,
  approved_by  bigint REFERENCES users(id),
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (asset_type <> 'image' OR image_rights IS NOT NULL)
);

CREATE TABLE scheduled_posts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id       bigint NOT NULL REFERENCES product_variants(id),
  caption_asset_id bigint REFERENCES marketing_assets(id),
  platform         text NOT NULL CHECK (platform IN ('facebook','instagram')),
  caption          text NOT NULL,
  image_url        text,
  scheduled_for    timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'awaiting_approval'
                   CHECK (status IN ('awaiting_approval','approved','publishing','published','failed','cancelled')),
  external_post_id text,
  error_message    text,
  attempts         integer NOT NULL DEFAULT 0,
  approved_by      bigint REFERENCES users(id),
  approved_at      timestamptz,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR external_post_id IS NOT NULL)
);
CREATE TRIGGER scheduled_posts_updated BEFORE UPDATE ON scheduled_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- ops
CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel    text NOT NULL CHECK (channel IN ('telegram','dashboard')),
  kind       text NOT NULL,
  severity   text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title      text NOT NULL,
  body       text NOT NULL,
  dedupe_key text UNIQUE,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped','read')),
  error      text,
  sent_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_created_idx ON notifications (created_at DESC);

CREATE TABLE integration_status (
  code            text PRIMARY KEY,
  name            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('connected','disabled','pending_credentials','error','not_available')),
  last_check_at   timestamptz,
  last_success_at timestamptz,
  last_error      text,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_type        text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text UNIQUE,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 3,
  run_after       timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  last_error      text,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs (status, run_after) WHERE status = 'queued';

CREATE TABLE ai_usage (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider      text NOT NULL,
  model         text NOT NULL,
  purpose       text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  est_cost_usd  numeric(10,4) NOT NULL DEFAULT 0,
  success       boolean NOT NULL DEFAULT true,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_created_idx ON ai_usage (created_at DESC);

CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    bigint REFERENCES users(id),
  actor_label text NOT NULL DEFAULT 'user',
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   bigint,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- Audit rows are append-only.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
CREATE TRIGGER cash_ledger_no_update BEFORE UPDATE OR DELETE ON cash_ledger FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
