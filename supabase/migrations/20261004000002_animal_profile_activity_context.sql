-- Link operational audit rows to the permanent internal animal UUID.
-- Existing logs are backfilled where their source record is still available.
BEGIN;

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS animal_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activity_logs_animal_id_fkey'
      AND conrelid = 'public.activity_logs'::regclass
  ) THEN
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT activity_logs_animal_id_fkey
      FOREIGN KEY (animal_id) REFERENCES public.animals(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS activity_logs_animal_created_idx
  ON public.activity_logs (animal_id, created_at DESC)
  WHERE animal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_activity_log_animal_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  source_table text;
  source_record_id text;
  has_animal_id boolean;
  resolved_animal_id uuid;
BEGIN
  IF NEW.animal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  source_table := NEW.details->>'table';
  source_record_id := NEW.entity_id;

  IF source_table IN ('gate_events', 'gate_camera_crossings') THEN
    NEW.module := 'Camera';
  ELSIF source_table = 'gate_alerts' THEN
    NEW.module := 'Alerts';
  END IF;

  IF source_table = 'animals' THEN
    BEGIN
      NEW.animal_id := source_record_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      NEW.animal_id := NULL;
    END;
  ELSIF source_table = 'inventory_transactions' THEN
    SELECT animal.id
      INTO resolved_animal_id
    FROM public.inventory_transactions AS inventory_tx
    JOIN public.animals AS animal
      ON animal.id::text = inventory_tx.reference_id::text
     AND animal.user_id = inventory_tx.user_id
    WHERE inventory_tx.id::text = source_record_id
      AND inventory_tx.reference_type = 'animal'
      AND inventory_tx.user_id = NEW.farm_user_id
    LIMIT 1;
    NEW.animal_id := resolved_animal_id;
  ELSIF source_table = ANY (ARRAY[
    'health_records', 'health_assessments', 'health_cases', 'treatment_records',
    'deworming_records', 'health_alerts', 'weight_records', 'breeding_records',
    'vaccinations', 'inventory_usage', 'feed_records', 'milk_records',
    'animal_sales', 'gate_events', 'gate_camera_crossings', 'gate_alerts'
  ]) THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = source_table
        AND column_name = 'animal_id'
    ) INTO has_animal_id;

    IF has_animal_id THEN
      EXECUTE format(
        'SELECT source.animal_id FROM public.%I AS source WHERE source.id::text = $1 LIMIT 1',
        source_table
      ) INTO NEW.animal_id USING source_record_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_activity_log_animal_id() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS activity_logs_resolve_animal ON public.activity_logs;
CREATE TRIGGER activity_logs_resolve_animal
  BEFORE INSERT ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.resolve_activity_log_animal_id();

-- Backfill animal logs while the source rows are still present.
DO $$
DECLARE
  source_table text;
  has_animal_id boolean;
  source_tables text[] := ARRAY[
    'health_records', 'health_assessments', 'health_cases', 'treatment_records',
    'deworming_records', 'health_alerts', 'weight_records', 'breeding_records',
    'vaccinations', 'inventory_usage', 'feed_records', 'milk_records',
    'animal_sales', 'gate_events', 'gate_camera_crossings', 'gate_alerts'
  ];
BEGIN
  UPDATE public.activity_logs AS log
  SET animal_id = animal.id
  FROM public.animals AS animal
  WHERE log.animal_id IS NULL
    AND log.details->>'table' = 'animals'
    AND animal.id::text = log.entity_id;

  FOREACH source_table IN ARRAY source_tables LOOP
    IF to_regclass(format('public.%I', source_table)) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = source_table
        AND column_name = 'animal_id'
    ) INTO has_animal_id;

    IF has_animal_id THEN
      EXECUTE format(
        'UPDATE public.activity_logs AS log
         SET animal_id = source.animal_id
         FROM public.%I AS source
         WHERE log.animal_id IS NULL
           AND log.details->>''table'' = $1
           AND log.entity_id = source.id::text
           AND source.animal_id IS NOT NULL',
        source_table
      ) USING source_table;
    END IF;
  END LOOP;

  IF to_regclass('public.inventory_transactions') IS NOT NULL THEN
    UPDATE public.activity_logs AS log
    SET animal_id = animal.id
    FROM public.inventory_transactions AS inventory_tx
    JOIN public.animals AS animal
      ON animal.id::text = inventory_tx.reference_id::text
     AND animal.user_id = inventory_tx.user_id
    WHERE log.animal_id IS NULL
      AND log.details->>'table' = 'inventory_transactions'
      AND log.entity_id = inventory_tx.id::text
      AND inventory_tx.reference_type = 'animal'
      AND log.farm_user_id = inventory_tx.user_id;
  END IF;
END;
$$;

-- The earlier audit migration used a stale crossing table name and omitted
-- verified gate events and animal-specific gate alerts.
DO $$
DECLARE
  source_table text;
  source_tables text[] := ARRAY['gate_events', 'gate_camera_crossings', 'gate_alerts'];
BEGIN
  FOREACH source_table IN ARRAY source_tables LOOP
    IF to_regclass(format('public.%I', source_table)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS activity_audit ON public.%I', source_table);
      EXECUTE format(
        'CREATE TRIGGER activity_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.capture_activity_log()',
        source_table
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'activity_logs'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
