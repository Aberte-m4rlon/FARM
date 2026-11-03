BEGIN;

CREATE TABLE IF NOT EXISTS public.mortality_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES public.animals(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  date_of_death date NOT NULL,
  estimated_time time,
  cause_of_death text NOT NULL CHECK (cause_of_death IN (
    'disease', 'accident', 'birthing_complication', 'unknown', 'other'
  )),
  cause_details text,
  symptoms_before_death text,
  previous_health_status text,
  previous_treatment text,
  notes text,
  previous_animal_status text NOT NULL DEFAULT 'Active',
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_by_name text NOT NULL DEFAULT 'Farm user',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  corrected_at timestamptz,
  corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  correction_reason text,
  CONSTRAINT mortality_records_other_details_check
    CHECK (cause_of_death <> 'other' OR NULLIF(btrim(cause_details), '') IS NOT NULL),
  CONSTRAINT mortality_records_correction_fields_check
    CHECK (
      (corrected_at IS NULL AND corrected_by IS NULL AND correction_reason IS NULL)
      OR
      (corrected_at IS NOT NULL AND corrected_by IS NOT NULL AND NULLIF(btrim(correction_reason), '') IS NOT NULL)
    )
);

ALTER TABLE public.mortality_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.mortality_records FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.mortality_records TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.mortality_records TO service_role;

DROP POLICY IF EXISTS mortality_records_select_own ON public.mortality_records;
CREATE POLICY mortality_records_select_own ON public.mortality_records
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.role IN ('system_admin', 'super_admin')
        AND COALESCE(profile.is_active, true)
    )
  );

CREATE INDEX IF NOT EXISTS mortality_records_farm_date_idx
  ON public.mortality_records (user_id, date_of_death DESC);
CREATE INDEX IF NOT EXISTS mortality_records_animal_idx
  ON public.mortality_records (animal_id, recorded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mortality_records_one_current_death_per_animal_idx
  ON public.mortality_records (animal_id)
  WHERE corrected_at IS NULL;

CREATE OR REPLACE FUNCTION public.record_animal_death(
  p_animal_id uuid,
  p_date_of_death date,
  p_estimated_time time,
  p_cause_of_death text,
  p_cause_details text,
  p_symptoms_before_death text,
  p_previous_health_status text,
  p_previous_treatment text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_animal public.animals%ROWTYPE;
  v_mortality_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Kailangan mag-sign in para maitala ang pagkamatay.' USING ERRCODE = '42501';
  END IF;
  IF p_date_of_death IS NULL OR p_date_of_death > (now() AT TIME ZONE 'Asia/Manila')::date THEN
    RAISE EXCEPTION 'Maglagay ng wastong petsa ng pagkamatay.' USING ERRCODE = '22023';
  END IF;
  IF p_cause_of_death IS NULL OR p_cause_of_death NOT IN ('disease', 'accident', 'birthing_complication', 'unknown', 'other') THEN
    RAISE EXCEPTION 'Pumili ng wastong dahilan o Hindi Alam.' USING ERRCODE = '22023';
  END IF;
  IF p_cause_of_death = 'other' AND NULLIF(btrim(p_cause_details), '') IS NULL THEN
    RAISE EXCEPTION 'Ilagay ang detalye ng ibang dahilan.' USING ERRCODE = '22023';
  END IF;

  SELECT animal.* INTO v_animal
  FROM public.animals AS animal
  WHERE animal.id = p_animal_id AND animal.user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang hayop sa bukid na ito o wala kang pahintulot.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_animal.archived, false)
    OR COALESCE(v_animal.is_sold, false)
    OR lower(COALESCE(v_animal.status, 'active')) IN ('sold', 'deceased', 'transferred', 'archived')
    OR EXISTS (
      SELECT 1 FROM public.animal_sales AS sale
      WHERE sale.animal_id = v_animal.id AND sale.user_id = v_actor
    ) THEN
    RAISE EXCEPTION 'Hindi maaaring itala bilang namatay ang naka-archive, naibenta, nailipat, o namatay nang hayop.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mortality_records AS record
    WHERE record.animal_id = v_animal.id AND record.corrected_at IS NULL
  ) THEN
    RAISE EXCEPTION 'May kasalukuyan nang tala ng pagkamatay para sa hayop na ito.' USING ERRCODE = '23505';
  END IF;

  SELECT NULLIF(btrim(profile.full_name), '') INTO v_actor_name
  FROM public.profiles AS profile
  WHERE profile.id = v_actor;
  v_actor_name := COALESCE(v_actor_name, 'Farm user');

  INSERT INTO public.mortality_records (
    user_id, animal_id, date_of_death, estimated_time, cause_of_death,
    cause_details, symptoms_before_death, previous_health_status,
    previous_treatment, notes, previous_animal_status, recorded_by,
    recorded_by_name, recorded_at
  ) VALUES (
    v_actor, v_animal.id, p_date_of_death, p_estimated_time, p_cause_of_death,
    NULLIF(btrim(p_cause_details), ''), NULLIF(btrim(p_symptoms_before_death), ''),
    NULLIF(btrim(p_previous_health_status), ''), NULLIF(btrim(p_previous_treatment), ''),
    NULLIF(btrim(p_notes), ''), COALESCE(v_animal.status, 'Active'), v_actor,
    v_actor_name, now()
  ) RETURNING id INTO v_mortality_id;

  PERFORM pg_catalog.set_config('alpasfarm.allow_mortality_status_update', 'true', true);
  UPDATE public.animals
  SET status = 'Deceased', updated_at = now()
  WHERE id = v_animal.id AND user_id = v_actor;
  PERFORM pg_catalog.set_config('alpasfarm.allow_mortality_status_update', 'false', true);

  INSERT INTO public.activity_logs (
    actor_id, actor_name, farm_user_id, module, action, entity_id,
    entity_name, status, details, animal_id
  ) VALUES (
    v_actor, v_actor_name, v_actor, 'Animals', 'recorded_deceased',
    v_animal.id::text, COALESCE(NULLIF(v_animal.name, '') || ' (' || NULLIF(v_animal.tag_id, '') || ')', v_animal.tag_id),
    'success', jsonb_build_object(
      'mortality_record_id', v_mortality_id,
      'previous_status', COALESCE(v_animal.status, 'Active'),
      'new_status', 'Deceased',
      'date_of_death', p_date_of_death
    ), v_animal.id
  );

  INSERT INTO public.notifications (user_id, type, title, description, priority, link, event_key)
  VALUES (
    v_actor, 'System', 'Na-update ang tala ng hayop',
    COALESCE(v_animal.name, v_animal.tag_id) || ' ay naitala bilang namatay.',
    'Normal', '/animals/' || v_animal.id::text, 'mortality_record:' || v_mortality_id::text
  ) ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;

  RETURN v_mortality_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_animal_death(uuid, date, time, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_animal_death(uuid, date, time, text, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_animal_death(
  p_mortality_record_id uuid,
  p_correction_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_record public.mortality_records%ROWTYPE;
  v_animal public.animals%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Kailangan mag-sign in para itama ang status.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_correction_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Kailangan ang paliwanag sa pagwawasto.' USING ERRCODE = '22023';
  END IF;

  SELECT record.* INTO v_record
  FROM public.mortality_records AS record
  WHERE record.id = p_mortality_record_id
    AND record.user_id = v_actor
    AND record.corrected_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi na makita ang aktibong mortality record o wala kang pahintulot.' USING ERRCODE = '42501';
  END IF;

  SELECT animal.* INTO v_animal
  FROM public.animals AS animal
  WHERE animal.id = v_record.animal_id AND animal.user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR lower(COALESCE(v_animal.status, '')) <> 'deceased' THEN
    RAISE EXCEPTION 'Nagbago na ang status ng hayop. I-refresh ang tala bago itama.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(v_animal.is_sold, false) OR EXISTS (
    SELECT 1 FROM public.animal_sales AS sale
    WHERE sale.animal_id = v_animal.id AND sale.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Hindi maibabalik sa aktibo ang hayop dahil may sale record ito.' USING ERRCODE = '23514';
  END IF;

  SELECT NULLIF(btrim(profile.full_name), '') INTO v_actor_name
  FROM public.profiles AS profile
  WHERE profile.id = v_actor;
  v_actor_name := COALESCE(v_actor_name, 'Farm user');

  PERFORM pg_catalog.set_config('alpasfarm.allow_mortality_status_update', 'true', true);
  UPDATE public.animals
  SET status = v_record.previous_animal_status, updated_at = now()
  WHERE id = v_animal.id AND user_id = v_actor;
  PERFORM pg_catalog.set_config('alpasfarm.allow_mortality_status_update', 'false', true);

  UPDATE public.mortality_records
  SET corrected_at = now(), corrected_by = v_actor,
      correction_reason = btrim(p_correction_reason)
  WHERE id = v_record.id AND user_id = v_actor AND corrected_at IS NULL;

  INSERT INTO public.activity_logs (
    actor_id, actor_name, farm_user_id, module, action, entity_id,
    entity_name, status, details, animal_id
  ) VALUES (
    v_actor, v_actor_name, v_actor, 'Animals', 'corrected_deceased_status',
    v_animal.id::text, COALESCE(NULLIF(v_animal.name, '') || ' (' || NULLIF(v_animal.tag_id, '') || ')', v_animal.tag_id),
    'success', jsonb_build_object(
      'mortality_record_id', v_record.id,
      'previous_status', 'Deceased',
      'new_status', v_record.previous_animal_status,
      'correction_reason', btrim(p_correction_reason)
    ), v_animal.id
  );

  INSERT INTO public.notifications (user_id, type, title, description, priority, link, event_key)
  VALUES (
    v_actor, 'System', 'Itinama ang status ng hayop',
    COALESCE(v_animal.name, v_animal.tag_id) || ' ay naibalik sa ' || v_record.previous_animal_status || '.',
    'Normal', '/animals/' || v_animal.id::text, 'mortality_correction:' || v_record.id::text
  ) ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_animal_death(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_animal_death(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_new_operation_for_inactive_animal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_user_id uuid;
  v_animal_id uuid;
  v_partner_id uuid;
  v_check_animal_id uuid;
  v_status text;
  v_archived boolean;
  v_is_sold boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    IF v_old->>'animal_id' IS NOT DISTINCT FROM v_row->>'animal_id'
      AND v_old->>'user_id' IS NOT DISTINCT FROM v_row->>'user_id'
      AND v_old->>'partner_id' IS NOT DISTINCT FROM v_row->>'partner_id' THEN
      RETURN NEW;
    END IF;
  END IF;

  v_user_id := NULLIF(v_row->>'user_id', '')::uuid;
  v_animal_id := NULLIF(v_row->>'animal_id', '')::uuid;
  IF v_animal_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_partner_id := CASE WHEN TG_TABLE_NAME = 'breeding_records'
    THEN NULLIF(v_row->>'partner_id', '')::uuid
    ELSE NULL
  END;

  FOREACH v_check_animal_id IN ARRAY array_remove(ARRAY[v_animal_id, v_partner_id], NULL::uuid) LOOP
    SELECT animal.status, animal.archived, animal.is_sold
      INTO v_status, v_archived, v_is_sold
    FROM public.animals AS animal
    WHERE animal.id = v_check_animal_id AND animal.user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Hindi makita ang hayop sa bukid na ito o wala kang pahintulot.' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(v_archived, false) OR COALESCE(v_is_sold, false)
      OR lower(COALESCE(v_status, 'active')) IN ('archived', 'sold', 'deceased', 'transferred')
      OR EXISTS (
        SELECT 1 FROM public.animal_sales AS sale
        WHERE sale.animal_id = v_check_animal_id AND sale.user_id = v_user_id
      ) THEN
      RAISE EXCEPTION 'Hindi maaaring pumili ng naka-archive, naibenta, nailipat, o namatay na hayop para sa bagong tala.' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_new_operation_for_inactive_animal() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_animal_mortality_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
    AND (lower(COALESCE(OLD.status, '')) = 'deceased' OR lower(COALESCE(NEW.status, '')) = 'deceased')
    AND current_setting('alpasfarm.allow_mortality_status_update', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Gamitin ang mortality workflow upang baguhin ang status na namatay.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_animal_mortality_status_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_animal_mortality_status_change ON public.animals;
CREATE TRIGGER guard_animal_mortality_status_change
  BEFORE UPDATE OF status ON public.animals
  FOR EACH ROW EXECUTE FUNCTION public.guard_animal_mortality_status_change();

DROP TRIGGER IF EXISTS mortality_guard_treatment_records ON public.treatment_records;
CREATE TRIGGER mortality_guard_treatment_records
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.treatment_records
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_vaccinations ON public.vaccinations;
CREATE TRIGGER mortality_guard_vaccinations
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.vaccinations
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_breeding_records ON public.breeding_records;
CREATE TRIGGER mortality_guard_breeding_records
  BEFORE INSERT OR UPDATE OF animal_id, partner_id, user_id ON public.breeding_records
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_inventory_usage ON public.inventory_usage;
CREATE TRIGGER mortality_guard_inventory_usage
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.inventory_usage
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_animal_sales ON public.animal_sales;
CREATE TRIGGER mortality_guard_animal_sales
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.animal_sales
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_health_assessments ON public.health_assessments;
CREATE TRIGGER mortality_guard_health_assessments
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.health_assessments
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_health_cases ON public.health_cases;
CREATE TRIGGER mortality_guard_health_cases
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.health_cases
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_health_records ON public.health_records;
CREATE TRIGGER mortality_guard_health_records
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.health_records
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_deworming_records ON public.deworming_records;
CREATE TRIGGER mortality_guard_deworming_records
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.deworming_records
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_camera_health_screenings ON public.camera_health_screenings;
CREATE TRIGGER mortality_guard_camera_health_screenings
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.camera_health_screenings
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

DROP TRIGGER IF EXISTS mortality_guard_gate_detection_sightings ON public.gate_detection_sightings;
CREATE TRIGGER mortality_guard_gate_detection_sightings
  BEFORE INSERT OR UPDATE OF animal_id, user_id ON public.gate_detection_sightings
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_operation_for_inactive_animal();

NOTIFY pgrst, 'reload schema';
COMMIT;
