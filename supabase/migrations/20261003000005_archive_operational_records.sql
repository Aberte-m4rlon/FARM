-- Add recoverable archive metadata to operational records with existing tables.
BEGIN;

DO $$
DECLARE
  table_name text;
  archive_tables text[] := ARRAY[
    'animals', 'health_records', 'health_assessments', 'health_cases',
    'treatment_records', 'deworming_records', 'health_alerts', 'weight_records',
    'breeding_records', 'vaccinations', 'inventory', 'feed_records', 'milk_records',
    'camera_health_screenings'
  ];
BEGIN
  FOREACH table_name IN ARRAY archive_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archived_at timestamptz', table_name);
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archived_by uuid', table_name);
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archive_reason text', table_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (user_id, archived_at) WHERE archived_at IS NOT NULL', 'idx_' || table_name || '_archived', table_name);
    END IF;
  END LOOP;
END;
$$;

-- Prevent routine authenticated clients from permanently deleting operational or financial history.
DO $$
DECLARE
  table_name text;
  protected_tables text[] := ARRAY[
    'animals', 'health_records', 'health_assessments', 'health_cases',
    'treatment_records', 'deworming_records', 'health_alerts', 'weight_records',
    'breeding_records', 'vaccinations', 'inventory', 'inventory_transactions',
    'inventory_usage', 'feed_records', 'milk_records', 'animal_sales',
    'camera_health_screenings'
  ];
  delete_policy record;
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      FOR delete_policy IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = table_name AND cmd = 'DELETE'
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', delete_policy.policyname, table_name);
      END LOOP;
      EXECUTE format('REVOKE DELETE ON TABLE public.%I FROM anon, authenticated, PUBLIC', table_name);
    END IF;
  END LOOP;
END;
$$;

-- Keep the existing boolean animal lifecycle compatible with older clients.
UPDATE public.animals
SET archived_at = COALESCE(archived_at, updated_at, created_at, now())
WHERE archived = true AND archived_at IS NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
