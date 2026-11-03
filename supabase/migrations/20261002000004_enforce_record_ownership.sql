-- Verify each related record belongs to the same authenticated farm owner.
CREATE OR REPLACE FUNCTION public.enforce_farm_record_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_user_id uuid := nullif(v_row ->> 'user_id', '')::uuid;
  v_auth_user_id uuid := auth.uid();
  v_reference record;
  v_parent_table text;
  v_parent_user_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Farm record must have an owner.';
  END IF;
  IF v_auth_user_id IS NOT NULL AND v_user_id <> v_auth_user_id THEN
    RAISE EXCEPTION 'Farm record owner must match the authenticated user.';
  END IF;

  FOR v_reference IN
    SELECT key, value
    FROM jsonb_each_text(v_row)
    WHERE key IN ('animal_id', 'partner_id', 'inventory_id', 'inventory_item_id', 'assessment_id', 'case_id', 'notification_id')
      AND value IS NOT NULL
  LOOP
    v_parent_table := CASE v_reference.key
      WHEN 'animal_id' THEN 'animals'
      WHEN 'partner_id' THEN 'animals'
      WHEN 'inventory_id' THEN 'inventory'
      WHEN 'inventory_item_id' THEN 'inventory'
      WHEN 'assessment_id' THEN 'health_assessments'
      WHEN 'case_id' THEN 'health_cases'
      WHEN 'notification_id' THEN 'notifications'
    END;

    EXECUTE format('SELECT parent.user_id FROM public.%I AS parent WHERE parent.id = $1', v_parent_table)
      INTO v_parent_user_id
      USING v_reference.value::uuid;

    IF NOT FOUND OR v_parent_user_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'Related farm record does not belong to this owner.';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'health_records', 'weight_records', 'breeding_records', 'vaccinations',
    'feed_records', 'milk_records', 'camera_health_screenings', 'animal_sales',
    'inventory_usage', 'health_assessments', 'health_cases', 'treatment_records',
    'deworming_records', 'health_alerts', 'inventory_transactions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_farm_record_ownership ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER enforce_farm_record_ownership BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_farm_record_ownership()',
      v_table
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_farm_record_ownership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_farm_record_ownership() TO authenticated, service_role;
