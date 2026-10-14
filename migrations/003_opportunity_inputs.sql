-- Owner-controlled inputs for opportunity analysis
ALTER TABLE opportunities ADD COLUMN owner_price numeric(14,2) CHECK (owner_price IS NULL OR owner_price > 0);
ALTER TABLE opportunities ADD COLUMN test_quantity integer CHECK (test_quantity IS NULL OR test_quantity > 0);
ALTER TABLE opportunities ADD COLUMN economics_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE products ADD COLUMN fragile boolean NOT NULL DEFAULT false;
