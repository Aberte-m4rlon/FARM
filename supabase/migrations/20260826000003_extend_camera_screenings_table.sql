/*
  Extend camera_health_screenings with full AI Health Scanner fields.
  Run this in Supabase SQL Editor AFTER the initial table creation.
  All new columns are nullable for backward compatibility with old records.
*/

-- Extended result fields
ALTER TABLE camera_health_screenings
  ADD COLUMN IF NOT EXISTS risk_score       int,
  ADD COLUMN IF NOT EXISTS risk_level       text,        -- LOW | MODERATE | HIGH | CRITICAL
  ADD COLUMN IF NOT EXISTS indicators       jsonb,       -- array of detected indicator labels
  ADD COLUMN IF NOT EXISTS combined_risk_score int,      -- risk score combined with farm vitals
  ADD COLUMN IF NOT EXISTS combined_factors jsonb,       -- array of farm data factors used
  ADD COLUMN IF NOT EXISTS recommendation  text,
  ADD COLUMN IF NOT EXISTS goat_detected   boolean,
  ADD COLUMN IF NOT EXISTS scan_type       text DEFAULT 'image'; -- image | video

-- Index for risk-based queries
CREATE INDEX IF NOT EXISTS idx_camera_screenings_risk_level
  ON camera_health_screenings(risk_level);

CREATE INDEX IF NOT EXISTS idx_camera_screenings_risk_score
  ON camera_health_screenings(risk_score DESC);
