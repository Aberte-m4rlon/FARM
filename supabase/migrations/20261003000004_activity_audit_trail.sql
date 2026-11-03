-- Store append-only operational events and capture successful database writes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text,
  farm_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  module text NOT NULL,
  action text NOT NULL,
  entity_id text,
  entity_name text,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failure')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.activity_logs FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.activity_logs TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.activity_logs TO service_role;

DROP POLICY IF EXISTS activity_logs_read_authorized ON public.activity_logs;
CREATE POLICY activity_logs_read_authorized ON public.activity_logs
  FOR SELECT TO authenticated
  USING (
    farm_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role IN ('system_admin', 'super_admin')
        AND COALESCE(p.is_active, true)
    )
  );

CREATE INDEX IF NOT EXISTS activity_logs_farm_created_idx
  ON public.activity_logs (farm_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_actor_created_idx
  ON public.activity_logs (actor_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_auth_session_event_unique
  ON public.activity_logs (session_id, action)
  WHERE module = 'Authentication' AND session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_activity_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  before_row jsonb;
  after_row jsonb;
  event_row jsonb;
  actor uuid;
  farm_owner uuid;
  event_action text;
  record_id text;
  record_name text;
  linked_animal_name text;
  event_module text;
  actor_display_name text;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
  event_row := COALESCE(after_row, before_row);

  actor := auth.uid();
  farm_owner := NULLIF(event_row->>'user_id', '')::uuid;
  IF TG_TABLE_NAME = 'profiles' THEN
    farm_owner := NULLIF(event_row->>'id', '')::uuid;
  END IF;
  IF farm_owner IS NULL THEN farm_owner := actor; END IF;

  IF actor IS NOT NULL THEN
    SELECT p.full_name INTO actor_display_name
    FROM public.profiles AS p
    WHERE p.id = actor;
  END IF;

  record_id := event_row->>'id';
  record_name := COALESCE(
    event_row->>'name', event_row->>'farm_name', event_row->>'vaccine_name',
    event_row->>'feed_type', event_row->>'title', event_row->>'tag_id',
    event_row->>'category', TG_TABLE_NAME
  );
  IF event_row ? 'animal_id' AND event_row->>'animal_id' IS NOT NULL THEN
    SELECT COALESCE(NULLIF(a.name, '') || ' (' || NULLIF(a.tag_id, '') || ')', NULLIF(a.name, ''), NULLIF(a.tag_id, ''))
      INTO linked_animal_name
    FROM public.animals AS a
    WHERE a.id::text = event_row->>'animal_id';
    record_name := COALESCE(linked_animal_name, record_name);
  END IF;

  event_module := CASE TG_TABLE_NAME
    WHEN 'animals' THEN 'Animals'
    WHEN 'health_records' THEN 'Health'
    WHEN 'health_assessments' THEN 'Health'
    WHEN 'health_cases' THEN 'Health'
    WHEN 'treatment_records' THEN 'Treatment'
    WHEN 'deworming_records' THEN 'Treatment'
    WHEN 'health_alerts' THEN 'Alerts'
    WHEN 'weight_records' THEN 'Weight'
    WHEN 'breeding_records' THEN 'Breeding'
    WHEN 'vaccinations' THEN 'Vaccination'
    WHEN 'inventory' THEN 'Inventory'
    WHEN 'inventory_transactions' THEN 'Inventory'
    WHEN 'inventory_usage' THEN 'Inventory'
    WHEN 'feed_records' THEN 'Feed'
    WHEN 'milk_records' THEN 'Milk'
    WHEN 'animal_sales' THEN 'Sales'
    WHEN 'notifications' THEN 'Alerts'
    WHEN 'profiles' THEN 'Users'
    WHEN 'settings' THEN 'Settings'
    WHEN 'camera_gate_crossings' THEN 'Camera'
    WHEN 'gate_live_tracks' THEN 'Camera'
    ELSE TG_TABLE_NAME
  END;

  IF TG_OP = 'INSERT' THEN
    event_action := 'created';
  ELSIF TG_OP = 'DELETE' THEN
    event_action := 'deleted';
  ELSIF TG_TABLE_NAME = 'animals'
    AND COALESCE(NULLIF(after_row->>'archived', '')::boolean, false)
    AND NOT COALESCE(NULLIF(before_row->>'archived', '')::boolean, false) THEN
    event_action := 'archived';
  ELSIF TG_TABLE_NAME = 'animals'
    AND NOT COALESCE(NULLIF(after_row->>'archived', '')::boolean, false)
    AND COALESCE(NULLIF(before_row->>'archived', '')::boolean, false) THEN
    event_action := 'restored';
  ELSIF after_row ? 'archived_at'
    AND after_row->>'archived_at' IS NOT NULL
    AND before_row->>'archived_at' IS NULL THEN
    event_action := 'archived';
  ELSIF after_row ? 'archived_at'
    AND after_row->>'archived_at' IS NULL
    AND before_row->>'archived_at' IS NOT NULL THEN
    event_action := 'restored';
  ELSE
    event_action := 'updated';
  END IF;

  INSERT INTO public.activity_logs (
    actor_id, actor_name, farm_user_id, module, action, entity_id, entity_name, details
  ) VALUES (
    actor, COALESCE(actor_display_name, 'System / User'), farm_owner, event_module, event_action, record_id, record_name,
    jsonb_build_object('table', TG_TABLE_NAME, 'operation', TG_OP)
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_activity_log() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name text;
  audited_tables text[] := ARRAY[
    'animals', 'health_records', 'health_assessments', 'health_cases',
    'treatment_records', 'deworming_records', 'health_alerts', 'weight_records',
    'breeding_records', 'vaccinations', 'inventory', 'inventory_transactions',
    'inventory_usage', 'feed_records', 'milk_records', 'animal_sales',
    'notifications', 'profiles', 'settings', 'camera_gate_crossings'
  ];
BEGIN
  FOREACH table_name IN ARRAY audited_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS activity_audit ON public.%I', table_name);
      EXECUTE format(
        'CREATE TRIGGER activity_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.capture_activity_log()',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
