/*
# Create health_records, weight_records, breeding_records, vaccinations tables

1. health_records — manual health check entries. After insert, the app computes a risk score and updates the parent animal's health_status/health_risk_score.
  - id, user_id (DEFAULT auth.uid()), animal_id (FK animals ON DELETE CASCADE)
  - record_date (date)
  - temperature (numeric °C, nullable)
  - heart_rate (int BPM, nullable)
  - appetite (text: Normal | Reduced | None, default Normal)
  - activity_level (text: Normal | Low | Lethargic, default Normal)
  - cough (boolean, default false)
  - diarrhea (boolean, default false)
  - nasal_discharge (boolean, default false)
  - eye_condition (text: Normal | Discharge | Cloudy, default Normal)
  - body_condition (text: Good | Fair | Poor, default Good)
  - risk_score (int 0-100, default 0) — computed
  - risk_level (text: Low | Moderate | High | Critical, default Low) — computed
  - reasons (text, nullable) — computed explanation
  - recommendation (text, nullable) — computed suggestion
  - notes (text, nullable)
  - created_at, updated_at

2. weight_records — weigh-ins. App computes daily gain + growth trend.
  - id, user_id, animal_id (FK)
  - record_date (date)
  - weight_kg (numeric)
  - previous_weight_kg (numeric, nullable) — computed
  - weight_change_kg (numeric, nullable) — computed
  - daily_gain_kg (numeric, nullable) — computed
  - notes (text, nullable)
  - created_at, updated_at

3. breeding_records — mating/pregnancy entries. App computes expected kidding date (mating + 150 days).
  - id, user_id, animal_id (FK, the female)
  - partner_id (uuid, nullable, FK animals — the sire)
  - mating_date (date)
  - expected_kidding_date (date, nullable) — computed (mating + 150)
  - actual_kidding_date (date, nullable)
  - offspring_count (int, nullable)
  - status (text: Planned | Pregnant | Kidded | Failed | Monitor, default Pregnant)
  - notes (text, nullable)
  - created_at, updated_at

4. vaccinations — vaccine records. App computes next due date + status.
  - id, user_id, animal_id (FK)
  - vaccine_name (text)
  - date_given (date)
  - next_due_date (date, nullable) — computed/applicable
  - veterinarian (text, nullable)
  - notes (text, nullable)
  - created_at, updated_at

5. Security
- Enable RLS on all four tables.
- Owner-scoped CRUD scoped through the parent animal's user_id.
*/

CREATE TABLE IF NOT EXISTS health_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  record_date date NOT NULL DEFAULT CURRENT_DATE,
  temperature numeric(5,2),
  heart_rate int,
  appetite text NOT NULL DEFAULT 'Normal',
  activity_level text NOT NULL DEFAULT 'Normal',
  cough boolean NOT NULL DEFAULT false,
  diarrhea boolean NOT NULL DEFAULT false,
  nasal_discharge boolean NOT NULL DEFAULT false,
  eye_condition text NOT NULL DEFAULT 'Normal',
  body_condition text NOT NULL DEFAULT 'Good',
  risk_score int NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'Low',
  reasons text,
  recommendation text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE health_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_health_records" ON health_records;
CREATE POLICY "select_own_health_records" ON health_records FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_health_records" ON health_records;
CREATE POLICY "insert_own_health_records" ON health_records FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_health_records" ON health_records;
CREATE POLICY "update_own_health_records" ON health_records FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_health_records" ON health_records;
CREATE POLICY "delete_own_health_records" ON health_records FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_health_records_user_id ON health_records(user_id);
CREATE INDEX IF NOT EXISTS idx_health_records_animal_id ON health_records(animal_id);
CREATE INDEX IF NOT EXISTS idx_health_records_date ON health_records(record_date);

CREATE TABLE IF NOT EXISTS weight_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  record_date date NOT NULL DEFAULT CURRENT_DATE,
  weight_kg numeric(7,2) NOT NULL,
  previous_weight_kg numeric(7,2),
  weight_change_kg numeric(7,2),
  daily_gain_kg numeric(8,4),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE weight_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_weight_records" ON weight_records;
CREATE POLICY "select_own_weight_records" ON weight_records FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_weight_records" ON weight_records;
CREATE POLICY "insert_own_weight_records" ON weight_records FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_weight_records" ON weight_records;
CREATE POLICY "update_own_weight_records" ON weight_records FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_weight_records" ON weight_records;
CREATE POLICY "delete_own_weight_records" ON weight_records FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_weight_records_user_id ON weight_records(user_id);
CREATE INDEX IF NOT EXISTS idx_weight_records_animal_id ON weight_records(animal_id);
CREATE INDEX IF NOT EXISTS idx_weight_records_date ON weight_records(record_date);

CREATE TABLE IF NOT EXISTS breeding_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES animals(id) ON DELETE SET NULL,
  mating_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_kidding_date date,
  actual_kidding_date date,
  offspring_count int,
  status text NOT NULL DEFAULT 'Pregnant',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE breeding_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_breeding_records" ON breeding_records;
CREATE POLICY "select_own_breeding_records" ON breeding_records FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_breeding_records" ON breeding_records;
CREATE POLICY "insert_own_breeding_records" ON breeding_records FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_breeding_records" ON breeding_records;
CREATE POLICY "update_own_breeding_records" ON breeding_records FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_breeding_records" ON breeding_records;
CREATE POLICY "delete_own_breeding_records" ON breeding_records FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_breeding_records_user_id ON breeding_records(user_id);
CREATE INDEX IF NOT EXISTS idx_breeding_records_animal_id ON breeding_records(animal_id);
CREATE INDEX IF NOT EXISTS idx_breeding_records_expected ON breeding_records(expected_kidding_date);

CREATE TABLE IF NOT EXISTS vaccinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  vaccine_name text NOT NULL,
  date_given date NOT NULL DEFAULT CURRENT_DATE,
  next_due_date date,
  veterinarian text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vaccinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_vaccinations" ON vaccinations;
CREATE POLICY "select_own_vaccinations" ON vaccinations FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_vaccinations" ON vaccinations;
CREATE POLICY "insert_own_vaccinations" ON vaccinations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_vaccinations" ON vaccinations;
CREATE POLICY "update_own_vaccinations" ON vaccinations FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_vaccinations" ON vaccinations;
CREATE POLICY "delete_own_vaccinations" ON vaccinations FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_vaccinations_user_id ON vaccinations(user_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_animal_id ON vaccinations(animal_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_next_due ON vaccinations(next_due_date);
