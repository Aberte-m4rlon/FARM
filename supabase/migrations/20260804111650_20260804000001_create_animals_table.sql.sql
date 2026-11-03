/*
# Create animals table

1. New Tables
- `animals` — core farm animal records, one row per goat/sheep.
  - id (uuid PK)
  - user_id (uuid, owner = authenticated farmer, FK auth.users ON DELETE CASCADE, DEFAULT auth.uid())
  - tag_id (text, human-readable animal ID e.g. GOAT-001)
  - name (text)
  - species (text: Goat | Sheep)
  - breed (text, nullable)
  - sex (text: Male | Female)
  - date_of_birth (date, nullable)
  - color_markings (text, nullable)
  - photo_url (text, nullable)
  - weight_kg (numeric, current weight, nullable)
  - health_status (text: Healthy | Monitor | At Risk | Critical, default Healthy)
  - health_risk_score (int 0-100, default 0)
  - current_temperature (numeric, nullable, °C)
  - current_heart_rate (int, nullable, BPM)
  - breeding_status (text: Open | Pregnant | Nursing | Ready | Not Ready | Monitor, default Open)
  - last_mating_date (date, nullable)
  - expected_kidding_date (date, nullable)
  - last_vaccine_date (date, nullable)
  - next_vaccine_date (date, nullable)
  - vaccination_status (text: Up to Date | Due Soon | Overdue | None, default None)
  - archived (boolean, default false)
  - notes (text, nullable)
  - created_at, updated_at (timestamptz)

2. Security
- Enable RLS.
- Owner-scoped CRUD: TO authenticated, auth.uid() = user_id.
- user_id defaults to auth.uid() so client inserts omitting user_id succeed.
*/

CREATE TABLE IF NOT EXISTS animals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tag_id text NOT NULL,
  name text NOT NULL,
  species text NOT NULL DEFAULT 'Goat',
  breed text,
  sex text NOT NULL DEFAULT 'Female',
  date_of_birth date,
  color_markings text,
  photo_url text,
  weight_kg numeric(7,2),
  health_status text NOT NULL DEFAULT 'Healthy',
  health_risk_score int NOT NULL DEFAULT 0,
  current_temperature numeric(5,2),
  current_heart_rate int,
  breeding_status text NOT NULL DEFAULT 'Open',
  last_mating_date date,
  expected_kidding_date date,
  last_vaccine_date date,
  next_vaccine_date date,
  vaccination_status text NOT NULL DEFAULT 'None',
  archived boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE animals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_animals" ON animals;
CREATE POLICY "select_own_animals" ON animals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_animals" ON animals;
CREATE POLICY "insert_own_animals" ON animals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_animals" ON animals;
CREATE POLICY "update_own_animals" ON animals FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_animals" ON animals;
CREATE POLICY "delete_own_animals" ON animals FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_animals_user_id ON animals(user_id);
CREATE INDEX IF NOT EXISTS idx_animals_health_status ON animals(health_status);
CREATE INDEX IF NOT EXISTS idx_animals_archived ON animals(archived);
