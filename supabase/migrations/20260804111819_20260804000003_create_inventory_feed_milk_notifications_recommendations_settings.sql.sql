/*
# Create inventory, feed_records, milk_records, notifications, recommendations, settings tables

1. inventory — feed, medicine, vaccines, supplies, equipment, other.
  - id, user_id, name, category, quantity (numeric), unit, minimum_stock (numeric)
  - purchase_date, expiry_date, supplier, cost (numeric), notes
  - created_at, updated_at
  - Status (low/out/expiring/expired/ok) computed in app.

2. feed_records — feed given to an animal.
  - id, user_id, animal_id (FK), record_date, feed_type, quantity_kg, cost, notes
  - created_at, updated_at

3. milk_records — daily milk yield for a doe.
  - id, user_id, animal_id (FK), record_date, yield_litres, notes
  - created_at, updated_at

4. notifications — generated alerts.
  - id, user_id, type (Health|Vaccination|Breeding|Weight|Inventory|System)
  - title, description, priority (Critical|Warning|Normal|Success), link (text nullable)
  - read (boolean default false), created_at

5. recommendations — smart farm assistant cards. Can be dynamically generated or stored.
  - id, user_id, category, title, description, priority, severity_color, link, dismissed (bool), created_at

6. settings — farm-level + threshold config (single row per user).
  - id, user_id (unique), farm_name, target_weight_kg, gestation_days (default 150)
  - temp_critical (default 40), heart_rate_high (default 90), expiry_warning_days (default 15)
  - vaccine_due_days (default 30), breeding_min_age_months (default 8), breeding_min_weight_kg (default 25)
  - created_at, updated_at

7. Security
- Enable RLS on all tables. Owner-scoped CRUD (TO authenticated, auth.uid() = user_id).
- feed_records, milk_records have animal_id FK to animals ON DELETE CASCADE.
*/

CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Feed',
  quantity numeric(10,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'kg',
  minimum_stock numeric(10,2) NOT NULL DEFAULT 0,
  purchase_date date,
  expiry_date date,
  supplier text,
  cost numeric(10,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_inventory" ON inventory;
CREATE POLICY "select_own_inventory" ON inventory FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_inventory" ON inventory;
CREATE POLICY "insert_own_inventory" ON inventory FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_inventory" ON inventory;
CREATE POLICY "update_own_inventory" ON inventory FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_inventory" ON inventory;
CREATE POLICY "delete_own_inventory" ON inventory FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory(expiry_date);

CREATE TABLE IF NOT EXISTS feed_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  record_date date NOT NULL DEFAULT CURRENT_DATE,
  feed_type text NOT NULL,
  quantity_kg numeric(7,2) NOT NULL DEFAULT 0,
  cost numeric(10,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feed_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_feed_records" ON feed_records;
CREATE POLICY "select_own_feed_records" ON feed_records FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_feed_records" ON feed_records;
CREATE POLICY "insert_own_feed_records" ON feed_records FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_feed_records" ON feed_records;
CREATE POLICY "update_own_feed_records" ON feed_records FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_feed_records" ON feed_records;
CREATE POLICY "delete_own_feed_records" ON feed_records FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_feed_records_user_id ON feed_records(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_records_animal_id ON feed_records(animal_id);

CREATE TABLE IF NOT EXISTS milk_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  record_date date NOT NULL DEFAULT CURRENT_DATE,
  yield_litres numeric(6,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE milk_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_milk_records" ON milk_records;
CREATE POLICY "select_own_milk_records" ON milk_records FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_milk_records" ON milk_records;
CREATE POLICY "insert_own_milk_records" ON milk_records FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_milk_records" ON milk_records;
CREATE POLICY "update_own_milk_records" ON milk_records FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_milk_records" ON milk_records;
CREATE POLICY "delete_own_milk_records" ON milk_records FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_milk_records_user_id ON milk_records(user_id);
CREATE INDEX IF NOT EXISTS idx_milk_records_animal_id ON milk_records(animal_id);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'System',
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'Normal',
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications" ON notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications" ON notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

CREATE TABLE IF NOT EXISTS recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'Normal',
  severity_color text NOT NULL DEFAULT 'green',
  link text,
  dismissed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_recommendations" ON recommendations;
CREATE POLICY "select_own_recommendations" ON recommendations FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_recommendations" ON recommendations;
CREATE POLICY "insert_own_recommendations" ON recommendations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_recommendations" ON recommendations;
CREATE POLICY "update_own_recommendations" ON recommendations FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_recommendations" ON recommendations;
CREATE POLICY "delete_own_recommendations" ON recommendations FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_recommendations_user_id ON recommendations(user_id);

CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  farm_name text NOT NULL DEFAULT 'AlpasFarm',
  target_weight_kg numeric(6,2) NOT NULL DEFAULT 40,
  gestation_days int NOT NULL DEFAULT 150,
  temp_critical numeric(4,1) NOT NULL DEFAULT 40,
  heart_rate_high int NOT NULL DEFAULT 90,
  expiry_warning_days int NOT NULL DEFAULT 15,
  vaccine_due_days int NOT NULL DEFAULT 30,
  breeding_min_age_months int NOT NULL DEFAULT 8,
  breeding_min_weight_kg numeric(6,2) NOT NULL DEFAULT 25,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_settings" ON settings;
CREATE POLICY "select_own_settings" ON settings FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_settings" ON settings;
CREATE POLICY "insert_own_settings" ON settings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_settings" ON settings;
CREATE POLICY "update_own_settings" ON settings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_settings" ON settings;
CREATE POLICY "delete_own_settings" ON settings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
