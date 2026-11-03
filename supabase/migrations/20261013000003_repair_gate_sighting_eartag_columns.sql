BEGIN;

-- Keep the production schema compatible with the primary eartag OCR RPCs.
-- Some installations already have gate_detection_sightings from an earlier
-- migration that did not include these columns, so make this repair additive.
ALTER TABLE public.gate_detection_sightings
  ADD COLUMN IF NOT EXISTS eartag_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eartag_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.gate_detection_sightings'::regclass
      AND conname = 'gate_detection_sightings_eartag_number_check'
  ) THEN
    ALTER TABLE public.gate_detection_sightings
      ADD CONSTRAINT gate_detection_sightings_eartag_number_check
      CHECK (eartag_number IS NULL OR eartag_number ~ '^[0-9]{1,6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.gate_detection_sightings'::regclass
      AND conname = 'gate_detection_sightings_eartag_verified_check'
  ) THEN
    ALTER TABLE public.gate_detection_sightings
      ADD CONSTRAINT gate_detection_sightings_eartag_verified_check
      CHECK (NOT eartag_verified OR animal_id IS NOT NULL);
  END IF;
END
$$;

COMMIT;
