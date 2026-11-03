/*
  Camera Health Screenings Table
  ──────────────────────────────
  Stores results from the camera-based ML health screening feature.
  The actual image is stored in Supabase Storage (bucket: animal-screenings).
  Only a storage path reference (image_path) is stored here, not the binary data.

  Fields:
  - id              : UUID primary key
  - user_id         : Owner (authenticated farmer), FK auth.users
  - animal_id       : The animal that was screened, FK animals ON DELETE CASCADE
  - image_path      : Supabase Storage path (e.g. screenings/{user_id}/{uuid}.jpg)
  - image_url       : Public or signed URL — nullable, populated after upload
  - prediction      : 'normal_appearance' | 'possible_health_concern' | 'low_confidence'
  - confidence      : 0.0 – 1.0 (raw probability from the ML model)
  - model_version   : e.g. 'goat-health-v1' — preserved forever, never updated
  - quality_score   : Image quality score 0–100 as assessed before inference
  - quality_issues  : JSON array of detected quality issues (blurry, dark, etc.)
  - notes           : Optional farm manager note
  - created_at      : Timestamp

  Security:
  - RLS enabled, owner-scoped CRUD (auth.uid() = user_id)
  - Images in Storage: bucket policy restricts access to owning user
*/

CREATE TABLE IF NOT EXISTS camera_health_screenings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL DEFAULT auth.uid()
                    REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id       uuid NOT NULL
                    REFERENCES animals(id) ON DELETE CASCADE,
  image_path      text,
  image_url       text,
  prediction      text NOT NULL DEFAULT 'low_confidence',
  confidence      numeric(5,4) NOT NULL DEFAULT 0,
  model_version   text NOT NULL DEFAULT 'goat-health-v1',
  quality_score   int NOT NULL DEFAULT 0,
  quality_issues  jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE camera_health_screenings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_screenings" ON camera_health_screenings;
CREATE POLICY "select_own_screenings" ON camera_health_screenings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_screenings" ON camera_health_screenings;
CREATE POLICY "insert_own_screenings" ON camera_health_screenings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_screenings" ON camera_health_screenings;
CREATE POLICY "update_own_screenings" ON camera_health_screenings
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_screenings" ON camera_health_screenings;
CREATE POLICY "delete_own_screenings" ON camera_health_screenings
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_camera_screenings_user_id
  ON camera_health_screenings(user_id);

CREATE INDEX IF NOT EXISTS idx_camera_screenings_animal_id
  ON camera_health_screenings(animal_id);

CREATE INDEX IF NOT EXISTS idx_camera_screenings_created_at
  ON camera_health_screenings(created_at DESC);
