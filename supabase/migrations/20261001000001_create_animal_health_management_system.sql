-- Migration: 20261001000001_create_animal_health_management_system.sql
-- Description: Comprehensive Animal Health Management tables with RLS for AlpasFarm

-- ── 1. HEALTH ASSESSMENTS TABLE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  assessment_date timestamptz NOT NULL DEFAULT now(),
  temperature numeric(5,2),
  heart_rate int,
  respiratory_rate int,
  appetite text NOT NULL DEFAULT 'Normal',
  activity_level text NOT NULL DEFAULT 'Normal',
  body_condition_score numeric(3,1) DEFAULT 3.0,
  cough boolean NOT NULL DEFAULT false,
  diarrhea boolean NOT NULL DEFAULT false,
  nasal_discharge boolean NOT NULL DEFAULT false,
  eye_condition text NOT NULL DEFAULT 'Normal',
  symptoms jsonb NOT NULL DEFAULT '[]'::jsonb,
  observation_notes text,
  photo_url text,
  photo_path text,
  ai_risk_category text NOT NULL DEFAULT 'Normal',
  ai_risk_score int DEFAULT 0,
  ai_confidence numeric(5,4),
  ai_model_version text DEFAULT 'health-risk-v1.0.0',
  ai_explanation text,
  ai_input_reference jsonb,
  is_rule_fallback boolean NOT NULL DEFAULT false,
  urgent_attention_flag boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  recorded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE health_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_health_assessments" ON health_assessments;
CREATE POLICY "select_own_health_assessments" ON health_assessments FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_health_assessments" ON health_assessments;
CREATE POLICY "insert_own_health_assessments" ON health_assessments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_health_assessments" ON health_assessments;
CREATE POLICY "update_own_health_assessments" ON health_assessments FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_health_assessments" ON health_assessments;
CREATE POLICY "delete_own_health_assessments" ON health_assessments FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_health_assessments_user_id ON health_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_health_assessments_animal_id ON health_assessments(animal_id);
CREATE INDEX IF NOT EXISTS idx_health_assessments_date ON health_assessments(assessment_date DESC);
CREATE INDEX IF NOT EXISTS idx_health_assessments_risk ON health_assessments(ai_risk_category);

-- ── 2. HEALTH CASES TABLE ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES health_assessments(id) ON DELETE SET NULL,
  case_number text NOT NULL,
  suspected_condition text NOT NULL,
  confirmed_diagnosis text,
  date_reported date NOT NULL DEFAULT CURRENT_DATE,
  severity text NOT NULL DEFAULT 'Moderate',
  attending_veterinarian text,
  clinical_notes text,
  case_status text NOT NULL DEFAULT 'Open',
  follow_up_date date,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE health_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_health_cases" ON health_cases;
CREATE POLICY "select_own_health_cases" ON health_cases FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_health_cases" ON health_cases;
CREATE POLICY "insert_own_health_cases" ON health_cases FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_health_cases" ON health_cases;
CREATE POLICY "update_own_health_cases" ON health_cases FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_health_cases" ON health_cases;
CREATE POLICY "delete_own_health_cases" ON health_cases FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_health_cases_user_id ON health_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_health_cases_animal_id ON health_cases(animal_id);
CREATE INDEX IF NOT EXISTS idx_health_cases_status ON health_cases(case_status);
CREATE INDEX IF NOT EXISTS idx_health_cases_date ON health_cases(date_reported DESC);

-- ── 3. TREATMENT RECORDS TABLE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  case_id uuid REFERENCES health_cases(id) ON DELETE SET NULL,
  inventory_id uuid REFERENCES inventory(id) ON DELETE SET NULL,
  medicine_name text NOT NULL,
  active_ingredient text,
  dosage text NOT NULL,
  unit text NOT NULL DEFAULT 'ml',
  route text NOT NULL DEFAULT 'Oral',
  frequency text NOT NULL DEFAULT 'Once daily',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  administering_person text,
  prescribing_veterinarian text,
  withdrawal_period_days int DEFAULT 0,
  withdrawal_end_date date,
  treatment_notes text,
  status text NOT NULL DEFAULT 'Ongoing',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE treatment_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_treatment_records" ON treatment_records;
CREATE POLICY "select_own_treatment_records" ON treatment_records FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_treatment_records" ON treatment_records;
CREATE POLICY "insert_own_treatment_records" ON treatment_records FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_treatment_records" ON treatment_records;
CREATE POLICY "update_own_treatment_records" ON treatment_records FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_treatment_records" ON treatment_records;
CREATE POLICY "delete_own_treatment_records" ON treatment_records FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_treatment_records_user_id ON treatment_records(user_id);
CREATE INDEX IF NOT EXISTS idx_treatment_records_animal_id ON treatment_records(animal_id);
CREATE INDEX IF NOT EXISTS idx_treatment_records_status ON treatment_records(status);
CREATE INDEX IF NOT EXISTS idx_treatment_records_date ON treatment_records(start_date DESC);

-- ── 4. DEWORMING RECORDS TABLE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deworming_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  date_administered date NOT NULL DEFAULT CURRENT_DATE,
  next_due_date date,
  provider text,
  batch_number text,
  dosage text,
  status text NOT NULL DEFAULT 'Completed',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deworming_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_deworming_records" ON deworming_records;
CREATE POLICY "select_own_deworming_records" ON deworming_records FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_deworming_records" ON deworming_records;
CREATE POLICY "insert_own_deworming_records" ON deworming_records FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_deworming_records" ON deworming_records;
CREATE POLICY "update_own_deworming_records" ON deworming_records FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_deworming_records" ON deworming_records;
CREATE POLICY "delete_own_deworming_records" ON deworming_records FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_deworming_records_user_id ON deworming_records(user_id);
CREATE INDEX IF NOT EXISTS idx_deworming_records_animal_id ON deworming_records(animal_id);
CREATE INDEX IF NOT EXISTS idx_deworming_records_due ON deworming_records(next_due_date);

-- ── 5. HEALTH ALERTS TABLE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  source_id text,
  is_read boolean NOT NULL DEFAULT false,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE health_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_health_alerts" ON health_alerts;
CREATE POLICY "select_own_health_alerts" ON health_alerts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_health_alerts" ON health_alerts;
CREATE POLICY "insert_own_health_alerts" ON health_alerts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_health_alerts" ON health_alerts;
CREATE POLICY "update_own_health_alerts" ON health_alerts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_health_alerts" ON health_alerts;
CREATE POLICY "delete_own_health_alerts" ON health_alerts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_health_alerts_user_id ON health_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_health_alerts_animal_id ON health_alerts(animal_id);
CREATE INDEX IF NOT EXISTS idx_health_alerts_status ON health_alerts(is_resolved, is_read);
CREATE INDEX IF NOT EXISTS idx_health_alerts_created_at ON health_alerts(created_at DESC);
