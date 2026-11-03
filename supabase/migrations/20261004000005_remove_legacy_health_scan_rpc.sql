-- Stop new legacy AI health-scan writes while preserving historical health_records.
-- Drop both signatures because installations may not have applied the timestamp migration.
DROP FUNCTION IF EXISTS public.save_ai_health_scan(
  uuid, uuid, date, integer, text, text, text, text, text, text, text
);

DROP FUNCTION IF EXISTS public.save_ai_health_scan(
  uuid, uuid, date, timestamptz, integer, text, text, text, text, text, text, text
);

NOTIFY pgrst, 'reload schema';
