BEGIN;

-- Keep the configured camera direction fixed. Existing counting sessions and
-- their event history are intentionally untouched by this settings migration.
UPDATE public.camera_gate_settings
SET entry_flow = 'top-to-bottom',
    inside_side = 'bottom'
WHERE entry_flow IS DISTINCT FROM 'top-to-bottom'
   OR inside_side IS DISTINCT FROM 'bottom';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.camera_gate_settings'::regclass
      AND conname = 'camera_gate_settings_entry_flow_fixed_check'
  ) THEN
    ALTER TABLE public.camera_gate_settings
      ADD CONSTRAINT camera_gate_settings_entry_flow_fixed_check
      CHECK (entry_flow = 'top-to-bottom') NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.camera_gate_settings
  VALIDATE CONSTRAINT camera_gate_settings_entry_flow_fixed_check;

NOTIFY pgrst, 'reload schema';
COMMIT;
