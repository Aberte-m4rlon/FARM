/*
  Animal Sales Table Migration
  ────────────────────────────
  Integrates animal selling and pre-sale weight tracking into ALPASFARM.
  When an animal is sold:
  - Weight before sale is mandatory.
  - Final selling price and price per kg are recorded.
  - Buyer info and payment status (Bayad na, May Kulang, Pending) are tracked.
  - Animal is archived from active herd counts while preserving historical records.
*/

CREATE TABLE IF NOT EXISTS animal_sales (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL DEFAULT auth.uid()
                        REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id           uuid NOT NULL
                        REFERENCES animals(id) ON DELETE CASCADE,
  animal_tag_id       text NOT NULL,
  animal_name         text NOT NULL,
  species             text NOT NULL,
  sold_weight         numeric(6,2) NOT NULL,
  selling_price       numeric(10,2) NOT NULL,
  price_per_kg        numeric(10,2),
  buyer_name          text,
  buyer_contact       text,
  payment_status      text NOT NULL DEFAULT 'Bayad na', -- 'Bayad na' | 'May Kulang' | 'Pending'
  amount_received     numeric(10,2) NOT NULL DEFAULT 0,
  remaining_balance   numeric(10,2) NOT NULL DEFAULT 0,
  sale_date           date NOT NULL DEFAULT CURRENT_DATE,
  notes               text,
  sold_by             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE animal_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sales" ON animal_sales;
CREATE POLICY "select_own_sales" ON animal_sales
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_sales" ON animal_sales;
CREATE POLICY "insert_own_sales" ON animal_sales
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_sales" ON animal_sales;
CREATE POLICY "update_own_sales" ON animal_sales
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_sales" ON animal_sales;
CREATE POLICY "delete_own_sales" ON animal_sales
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_animal_sales_user_id ON animal_sales(user_id);
CREATE INDEX IF NOT EXISTS idx_animal_sales_animal_id ON animal_sales(animal_id);
CREATE INDEX IF NOT EXISTS idx_animal_sales_sale_date ON animal_sales(sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_animal_sales_payment_status ON animal_sales(payment_status);
