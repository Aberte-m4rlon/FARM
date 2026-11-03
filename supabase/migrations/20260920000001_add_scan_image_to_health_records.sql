-- Migration: Add persistent scan image storage columns to health_records
-- Date: 2026-09-20
-- Description:
--   Links persistent health-scan images stored in Supabase Storage (bucket: 'animal-screenings')
--   directly to health_records rows for historical retention, auditability, and offline-safe display.

ALTER TABLE health_records
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS image_url text;

-- Create an index on image_path for fast query filtering and integrity audits
CREATE INDEX IF NOT EXISTS idx_health_records_image_path
  ON health_records(image_path);

COMMENT ON COLUMN health_records.image_path IS 'Supabase Storage path within animal-screenings bucket (e.g. screenings/{user_id}/{animal_id}/{filename}.jpg)';
COMMENT ON COLUMN health_records.image_url IS 'Pre-computed signed or public access URL for fast preview rendering';
