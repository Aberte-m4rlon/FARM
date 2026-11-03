BEGIN;

-- The deployed project may still use the original notifications table shape.
-- Add the fields consumed by the breeding alert RPCs before defining them.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS related_type text,
  ADD COLUMN IF NOT EXISTS related_id text,
  ADD COLUMN IF NOT EXISTS severity text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS animal_id uuid REFERENCES public.animals(id) ON DELETE SET NULL;

UPDATE public.notifications
SET message = COALESCE(message, description),
    is_read = COALESCE(read, is_read, false),
    updated_at = COALESCE(updated_at, created_at, now())
WHERE message IS NULL
   OR is_read IS DISTINCT FROM read
   OR updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_event_key
  ON public.notifications (user_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_related
  ON public.notifications (related_type, related_id);

-- Keep birth events and newborns attached to the existing breeding and animal records.
CREATE TABLE IF NOT EXISTS public.breeding_birth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  breeding_id uuid NOT NULL REFERENCES public.breeding_records(id) ON DELETE RESTRICT,
  mother_id uuid NOT NULL REFERENCES public.animals(id) ON DELETE RESTRICT,
  father_id uuid REFERENCES public.animals(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('successful', 'failed')),
  result_label text,
  event_date date NOT NULL,
  actual_birth_date date,
  birth_time time,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT breeding_birth_events_one_per_record UNIQUE (breeding_id),
  CONSTRAINT breeding_birth_events_outcome_date CHECK (
    (outcome = 'successful' AND actual_birth_date IS NOT NULL)
    OR (outcome = 'failed' AND actual_birth_date IS NULL)
  )
);

ALTER TABLE public.animals
  ADD COLUMN IF NOT EXISTS mother_animal_id uuid REFERENCES public.animals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS father_animal_id uuid REFERENCES public.animals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS birth_event_id uuid REFERENCES public.breeding_birth_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS animals_mother_animal_idx
  ON public.animals (user_id, mother_animal_id) WHERE mother_animal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS animals_birth_event_idx
  ON public.animals (birth_event_id) WHERE birth_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS breeding_birth_events_mother_idx
  ON public.breeding_birth_events (user_id, mother_id, event_date DESC);

ALTER TABLE public.breeding_birth_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.breeding_birth_events FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.breeding_birth_events TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.breeding_birth_events TO service_role;
DROP POLICY IF EXISTS breeding_birth_events_read_own ON public.breeding_birth_events;
CREATE POLICY breeding_birth_events_read_own ON public.breeding_birth_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.breeding_due_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  breeding_id uuid NOT NULL UNIQUE REFERENCES public.breeding_records(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES public.animals(id) ON DELETE CASCADE,
  expected_due_date date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS breeding_due_alerts_active_due_idx
  ON public.breeding_due_alerts (user_id, expected_due_date, acknowledged_at)
  WHERE active;

ALTER TABLE public.breeding_due_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.breeding_due_alerts FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.breeding_due_alerts TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.breeding_due_alerts TO service_role;
DROP POLICY IF EXISTS breeding_due_alerts_read_own ON public.breeding_due_alerts;
CREATE POLICY breeding_due_alerts_read_own ON public.breeding_due_alerts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.record_breeding_activity(
  p_user_id uuid,
  p_breeding_id uuid,
  p_animal_id uuid,
  p_action text,
  p_entity_name text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor;
  END IF;
  INSERT INTO public.activity_logs (
    actor_id, actor_name, farm_user_id, module, action, entity_id,
    entity_name, status, details, animal_id
  ) VALUES (
    v_actor,
    COALESCE(v_actor_name, CASE WHEN v_actor IS NULL THEN 'Sistema' ELSE 'Magsasaka' END),
    p_user_id, 'Breeding', p_action, p_breeding_id::text,
    p_entity_name, 'success', COALESCE(p_details, '{}'::jsonb), p_animal_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_breeding_activity(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Called by authenticated clients on open and by the persistent Hostinger API worker.
-- This function only opens an alert; it never assumes that a birth occurred.
CREATE OR REPLACE FUNCTION public.sync_breeding_due_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record record;
  v_created integer := 0;
  v_was_active_same_date boolean;
  v_event_key text;
  v_count integer;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Kailangan ng naka-login na user.';
  END IF;

  FOR v_record IN
    SELECT br.id AS breeding_id, br.user_id, br.animal_id, br.expected_kidding_date,
      a.name AS animal_name, a.tag_id, a.species
    FROM public.breeding_records AS br
    JOIN public.animals AS a ON a.id = br.animal_id AND a.user_id = br.user_id
    WHERE br.status = 'Pregnant'
      AND br.expected_kidding_date IS NOT NULL
      AND br.expected_kidding_date <= v_today
      AND br.actual_kidding_date IS NULL
      AND br.archived_at IS NULL
      AND a.archived IS NOT TRUE
      AND a.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.breeding_birth_events AS be
        WHERE be.breeding_id = br.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.animal_sales AS sale
        WHERE sale.user_id = br.user_id AND sale.animal_id = br.animal_id
      )
      AND (auth.uid() IS NULL OR br.user_id = auth.uid())
    ORDER BY br.expected_kidding_date, a.name, br.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      v_record.breeding_id::text || ':' || v_record.expected_kidding_date::text,
      1
    ));
    SELECT EXISTS (
      SELECT 1 FROM public.breeding_due_alerts AS existing
      WHERE existing.breeding_id = v_record.breeding_id
        AND existing.active
        AND existing.expected_due_date = v_record.expected_kidding_date
    ) INTO v_was_active_same_date;

    INSERT INTO public.breeding_due_alerts (
      user_id, breeding_id, animal_id, expected_due_date, active,
      acknowledged_at, resolved_at, updated_at
    ) VALUES (
      v_record.user_id, v_record.breeding_id, v_record.animal_id,
      v_record.expected_kidding_date, true, NULL, NULL, now()
    )
    ON CONFLICT (breeding_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      animal_id = EXCLUDED.animal_id,
      acknowledged_at = CASE
        WHEN public.breeding_due_alerts.expected_due_date IS DISTINCT FROM EXCLUDED.expected_due_date
          OR public.breeding_due_alerts.active IS NOT TRUE THEN NULL
        ELSE public.breeding_due_alerts.acknowledged_at
      END,
      expected_due_date = EXCLUDED.expected_due_date,
      active = true,
      resolved_at = NULL,
      updated_at = now();

    v_event_key := 'breeding_due:' || v_record.breeding_id::text || ':' || v_record.expected_kidding_date::text;
    INSERT INTO public.notifications (
      user_id, type, title, description, message, priority, severity,
      link, related_type, related_id, animal_id, event_key, read, is_read, updated_at
    ) VALUES (
      v_record.user_id, 'Breeding',
      'Oras na ng Panganganak',
      format('Due na manganak si %s (%s). Pakitingnan ang kulungan at i-record ang resulta.', v_record.animal_name, v_record.tag_id),
      format('Posibleng manganak na si %s. Pakitingnan ang kulungan at i-record ang resulta ng panganganak.', v_record.animal_name),
      'Warning', 'warning',
      '/breeding?breedingId=' || v_record.breeding_id::text,
      'breeding', v_record.breeding_id::text, v_record.animal_id,
      v_event_key, false, false, now()
    ) ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;

    IF NOT v_was_active_same_date THEN
      v_created := v_created + 1;
      PERFORM public.record_breeding_activity(
        v_record.user_id, v_record.breeding_id, v_record.animal_id,
        'due_alert_generated',
        COALESCE(NULLIF(v_record.animal_name, ''), v_record.tag_id),
        jsonb_build_object('expected_due_date', v_record.expected_kidding_date, 'animal_tag', v_record.tag_id)
      );
    END IF;
  END LOOP;

  UPDATE public.breeding_due_alerts AS due
  SET active = false, resolved_at = COALESCE(due.resolved_at, now()), updated_at = now()
  WHERE due.active
    AND (auth.uid() IS NULL OR due.user_id = auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.breeding_records AS br
      JOIN public.animals AS a ON a.id = br.animal_id AND a.user_id = br.user_id
      WHERE br.id = due.breeding_id
        AND br.user_id = due.user_id
        AND br.status = 'Pregnant'
        AND br.expected_kidding_date <= v_today
        AND br.actual_kidding_date IS NULL
        AND br.archived_at IS NULL
        AND a.archived IS NOT TRUE
        AND a.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.breeding_birth_events AS be WHERE be.breeding_id = br.id)
    );

  UPDATE public.notifications AS n
  SET read = true, is_read = true, updated_at = now()
  WHERE n.type = 'Breeding'
    AND n.related_type = 'breeding'
    AND n.event_key LIKE 'breeding_due:%'
    AND (auth.uid() IS NULL OR n.user_id = auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.breeding_due_alerts AS due
      WHERE due.user_id = n.user_id
        AND due.breeding_id::text = n.related_id
        AND due.active
    );

  SELECT count(*) INTO v_count FROM public.breeding_due_alerts AS due
  WHERE due.active AND due.expected_due_date <= v_today
    AND (auth.uid() IS NULL OR due.user_id = auth.uid());
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_breeding_due_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_breeding_due_alerts() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acknowledge_breeding_due_alert(p_breeding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_due public.breeding_due_alerts%ROWTYPE;
  v_animal_name text;
  v_was_acknowledged boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Kailangan ng naka-login na user.'; END IF;
  SELECT due.* INTO v_due
  FROM public.breeding_due_alerts AS due
  WHERE due.breeding_id = p_breeding_id AND due.user_id = auth.uid() AND due.active
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hindi na makita ang paalala ng panganganak.'; END IF;
  IF v_due.expected_due_date > v_today THEN RAISE EXCEPTION 'Hindi pa due ang panganganak.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.breeding_records AS br
    JOIN public.animals AS mother ON mother.id = br.animal_id AND mother.user_id = br.user_id
    WHERE br.id = p_breeding_id AND br.user_id = auth.uid()
      AND br.status = 'Pregnant' AND br.expected_kidding_date <= v_today
      AND br.actual_kidding_date IS NULL AND br.archived_at IS NULL
      AND mother.archived IS NOT TRUE AND mother.archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.breeding_birth_events AS be WHERE be.breeding_id = br.id)
  ) THEN
    RAISE EXCEPTION 'Hindi na aktibo ang paalala. I-refresh ang pahina.';
  END IF;

  v_was_acknowledged := v_due.acknowledged_at IS NOT NULL;
  UPDATE public.breeding_due_alerts
  SET acknowledged_at = COALESCE(acknowledged_at, now()), updated_at = now()
  WHERE id = v_due.id;
  SELECT name INTO v_animal_name FROM public.animals WHERE id = v_due.animal_id AND user_id = auth.uid();
  UPDATE public.notifications
  SET read = true, is_read = true, updated_at = now()
  WHERE user_id = auth.uid()
    AND (
      (related_type = 'breeding' AND related_id = p_breeding_id::text AND event_key LIKE 'breeding_due:%')
      OR left(COALESCE(event_key, ''), length('breeding_kidding_' || v_due.animal_id::text || '_'))
        = 'breeding_kidding_' || v_due.animal_id::text || '_'
    );

  IF NOT v_was_acknowledged THEN
    PERFORM public.record_breeding_activity(
      auth.uid(), p_breeding_id, v_due.animal_id, 'due_alert_acknowledged',
      COALESCE(v_animal_name, 'Alaga'),
      jsonb_build_object('expected_due_date', v_due.expected_due_date)
    );
  END IF;
  RETURN jsonb_build_object('success', true, 'active', true, 'acknowledged', true);
END;
$$;
REVOKE ALL ON FUNCTION public.acknowledge_breeding_due_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_breeding_due_alert(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reschedule_breeding_due_date(
  p_breeding_id uuid,
  p_due_date date,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record public.breeding_records%ROWTYPE;
  v_animal_name text;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Kailangan ng naka-login na user.'; END IF;
  IF p_due_date IS NULL OR p_due_date <= v_today THEN
    RAISE EXCEPTION 'Pumili ng petsa bukas o sa susunod.';
  END IF;
  SELECT br.* INTO v_record
  FROM public.breeding_records AS br
  WHERE br.id = p_breeding_id AND br.user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_record.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Hindi nahanap ang tala ng breeding.'; END IF;
  IF v_record.status <> 'Pregnant' OR v_record.actual_kidding_date IS NOT NULL THEN
    RAISE EXCEPTION 'Hindi na aktibo ang pagbubuntis na ito.';
  END IF;
  SELECT name INTO v_animal_name FROM public.animals
  WHERE id = v_record.animal_id AND user_id = auth.uid() AND archived IS NOT TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hindi nahanap ang inahin sa bukid na ito.'; END IF;

  UPDATE public.breeding_records
  SET expected_kidding_date = p_due_date, updated_at = now()
  WHERE id = p_breeding_id AND user_id = auth.uid();
  UPDATE public.animals
  SET expected_kidding_date = p_due_date, breeding_status = 'Pregnant', updated_at = now()
  WHERE id = v_record.animal_id AND user_id = auth.uid();
  UPDATE public.breeding_due_alerts
  SET active = false, acknowledged_at = NULL, resolved_at = now(), updated_at = now()
  WHERE breeding_id = p_breeding_id AND user_id = auth.uid();
  UPDATE public.notifications
  SET read = true, is_read = true, updated_at = now()
  WHERE user_id = auth.uid()
    AND (
      (related_type = 'breeding' AND related_id = p_breeding_id::text AND event_key LIKE 'breeding_due:%')
      OR left(COALESCE(event_key, ''), length('breeding_kidding_' || v_record.animal_id::text || '_'))
        = 'breeding_kidding_' || v_record.animal_id::text || '_'
    );

  PERFORM public.record_breeding_activity(
    auth.uid(), p_breeding_id, v_record.animal_id, 'due_date_changed',
    COALESCE(v_animal_name, 'Alaga'),
    jsonb_build_object(
      'old_due_date', v_record.expected_kidding_date,
      'new_due_date', p_due_date,
      'reason', NULLIF(trim(COALESCE(p_reason, '')), '')
    )
  );
  RETURN jsonb_build_object('success', true, 'expected_due_date', p_due_date);
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_breeding_due_date(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_breeding_due_date(uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_breeding_birth(
  p_breeding_id uuid,
  p_outcome text,
  p_event_date date,
  p_birth_time time,
  p_result_label text,
  p_notes text,
  p_newborns jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record public.breeding_records%ROWTYPE;
  v_mother public.animals%ROWTYPE;
  v_father public.animals%ROWTYPE;
  v_event_id uuid;
  v_existing public.breeding_birth_events%ROWTYPE;
  v_newborn jsonb;
  v_newborn_count integer := 0;
  v_number bigint;
  v_prefix text;
  v_tag text;
  v_name text;
  v_sex text;
  v_weight numeric;
  v_child_id uuid;
  v_children jsonb := '[]'::jsonb;
  v_result_label text;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Kailangan ng naka-login na user.'; END IF;
  IF p_event_date IS NULL OR p_event_date > v_today THEN RAISE EXCEPTION 'Hindi wastong petsa ng panganganak o pag-check.'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('successful', 'failed') THEN RAISE EXCEPTION 'Piliin kung successful o failed ang resulta.'; END IF;
  IF p_breeding_id IS NULL THEN RAISE EXCEPTION 'Hindi nahanap ang tala ng breeding.'; END IF;

  SELECT * INTO v_record FROM public.breeding_records
  WHERE id = p_breeding_id AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_record.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Hindi nahanap ang tala ng breeding.'; END IF;

  SELECT * INTO v_existing FROM public.breeding_birth_events WHERE breeding_id = p_breeding_id;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'tag_id', a.tag_id, 'name', a.name) ORDER BY a.created_at), '[]'::jsonb)
      INTO v_children
    FROM public.animals AS a WHERE a.birth_event_id = v_existing.id AND a.user_id = auth.uid();
    RETURN jsonb_build_object(
      'success', true, 'already_recorded', true, 'outcome', v_existing.outcome,
      'event_id', v_existing.id, 'newborns', v_children
    );
  END IF;
  IF v_record.status NOT IN ('Pregnant', 'Kidded') THEN
    RAISE EXCEPTION 'Hindi na aktibo ang tala ng breeding na ito.';
  END IF;

  SELECT * INTO v_mother FROM public.animals
  WHERE id = v_record.animal_id AND user_id = auth.uid() AND archived IS NOT TRUE
  FOR UPDATE;
  IF NOT FOUND OR v_mother.sex <> 'Female' OR v_mother.species NOT IN ('Goat', 'Sheep') THEN
    RAISE EXCEPTION 'Hindi valid ang inahing nakatala sa breeding.';
  END IF;
  IF v_record.partner_id IS NOT NULL THEN
    SELECT * INTO v_father FROM public.animals
    WHERE id = v_record.partner_id AND user_id = auth.uid();
    IF NOT FOUND OR v_father.sex <> 'Male' OR v_father.species <> v_mother.species THEN
      RAISE EXCEPTION 'Hindi valid ang barakong nakatala sa breeding.';
    END IF;
  END IF;

  IF p_outcome = 'successful' THEN
    IF p_newborns IS NULL OR jsonb_typeof(p_newborns) <> 'array' THEN
      RAISE EXCEPTION 'Magdagdag ng isa hanggang labindalawang bagong silang.';
    END IF;
    IF jsonb_array_length(p_newborns) < 1 OR jsonb_array_length(p_newborns) > 12 THEN
      RAISE EXCEPTION 'Magdagdag ng isa hanggang labindalawang bagong silang.';
    END IF;
    v_result_label := 'Matagumpay na Panganganak';
  ELSE
    IF p_newborns IS NULL OR jsonb_typeof(p_newborns) <> 'array' THEN
      RAISE EXCEPTION 'Hindi dapat gumawa ng bagong hayop para sa failed na resulta.';
    END IF;
    IF jsonb_array_length(p_newborns) <> 0 THEN
      RAISE EXCEPTION 'Hindi dapat gumawa ng bagong hayop para sa failed na resulta.';
    END IF;
    IF p_result_label IS NULL OR p_result_label NOT IN ('Failed', 'Pregnancy Loss', 'Animal Did Not Give Birth', 'Other') THEN
      RAISE EXCEPTION 'Pumili ng valid na resulta.';
    END IF;
    v_result_label := CASE p_result_label
      WHEN 'Pregnancy Loss' THEN 'Nawala ang pagbubuntis'
      WHEN 'Animal Did Not Give Birth' THEN 'Hindi pa nanganak'
      WHEN 'Other' THEN 'Iba pa'
      ELSE 'Failed'
    END;
  END IF;

  INSERT INTO public.breeding_birth_events (
    user_id, breeding_id, mother_id, father_id, outcome, result_label,
    event_date, actual_birth_date, birth_time, notes, created_by
  ) VALUES (
    auth.uid(), p_breeding_id, v_mother.id, v_record.partner_id, p_outcome,
    v_result_label, p_event_date,
    CASE WHEN p_outcome = 'successful' THEN p_event_date ELSE NULL END,
    CASE WHEN p_outcome = 'successful' THEN p_birth_time ELSE NULL END,
    NULLIF(trim(COALESCE(p_notes, '')), ''), auth.uid()
  ) RETURNING id INTO v_event_id;

  IF p_outcome = 'successful' THEN
    v_prefix := CASE WHEN v_mother.species = 'Sheep' THEN 'SHEEP' ELSE 'GOAT' END;
    PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || v_prefix, 0));

    FOR v_newborn IN SELECT value FROM jsonb_array_elements(p_newborns)
    LOOP
      v_name := NULLIF(trim(COALESCE(v_newborn->>'name', '')), '');
      v_sex := COALESCE(v_newborn->>'sex', '');
      IF v_name IS NULL THEN RAISE EXCEPTION 'Ilagay ang pangalan ng bawat bagong silang.'; END IF;
      IF v_sex NOT IN ('Female', 'Male') THEN RAISE EXCEPTION 'Pumili ng kasarian para sa bawat bagong silang.'; END IF;
      IF v_newborn ? 'weight_kg' AND NULLIF(v_newborn->>'weight_kg', '') IS NOT NULL THEN
        BEGIN
          v_weight := (v_newborn->>'weight_kg')::numeric;
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'Hindi wastong timbang ng bagong silang.';
        END;
        IF v_weight <= 0 OR v_weight > 100 THEN RAISE EXCEPTION 'Ilagay ang timbang na higit sa zero at hindi lalampas sa 100 kg.'; END IF;
      ELSE
        v_weight := NULL;
      END IF;

      v_number := 1;
      LOOP
        v_tag := v_prefix || '-' || lpad(v_number::text, 3, '0');
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.animals AS active_animal
          CROSS JOIN LATERAL regexp_match(active_animal.tag_id, '^' || v_prefix || '[-_ ]?0*([0-9]+)$', 'i') AS parsed(parts)
          WHERE active_animal.user_id = auth.uid()
            AND active_animal.archived IS NOT TRUE
            AND ltrim(parsed.parts[1], '0') = v_number::text
        );
        v_number := v_number + 1;
      END LOOP;

      INSERT INTO public.animals (
        user_id, tag_id, name, species, breed, sex, date_of_birth,
        color_markings, weight_kg, breeding_status, notes,
        mother_animal_id, father_animal_id, birth_event_id
      ) VALUES (
        auth.uid(), v_tag, v_name, v_mother.species, v_mother.breed, v_sex,
        p_event_date, NULLIF(trim(COALESCE(v_newborn->>'color_markings', '')), ''),
        v_weight, 'Open', NULLIF(trim(COALESCE(v_newborn->>'notes', '')), ''),
        v_mother.id, v_record.partner_id, v_event_id
      ) RETURNING id INTO v_child_id;

      IF v_weight IS NOT NULL THEN
        INSERT INTO public.weight_records (
          user_id, animal_id, record_date, weight_kg, previous_weight_kg,
          weight_change_kg, daily_gain_kg, notes
        ) VALUES (
          auth.uid(), v_child_id, p_event_date, v_weight, NULL,
          NULL, NULL, 'Timbang sa kapanganakan'
        );
      END IF;

      v_children := v_children || jsonb_build_array(jsonb_build_object(
        'id', v_child_id, 'tag_id', v_tag, 'name', v_name
      ));
      v_newborn_count := v_newborn_count + 1;
    END LOOP;

    UPDATE public.breeding_records
    SET status = 'Kidded', actual_kidding_date = p_event_date,
      offspring_count = v_newborn_count, updated_at = now()
    WHERE id = p_breeding_id AND user_id = auth.uid();
    UPDATE public.animals
    SET breeding_status = 'Nursing', expected_kidding_date = NULL, updated_at = now()
    WHERE id = v_mother.id AND user_id = auth.uid();
    PERFORM public.record_breeding_activity(
      auth.uid(), p_breeding_id, v_mother.id, 'birth_successful',
      COALESCE(v_mother.name, v_mother.tag_id),
      jsonb_build_object('event_date', p_event_date, 'newborn_count', v_newborn_count, 'newborns', v_children)
    );
    PERFORM public.record_breeding_activity(
      auth.uid(), p_breeding_id, v_mother.id,
      CASE WHEN v_newborn_count > 1 THEN 'multiple_newborns_registered' ELSE 'newborn_registered' END,
      COALESCE(v_mother.name, v_mother.tag_id),
      jsonb_build_object('newborn_count', v_newborn_count, 'newborns', v_children)
    );
  ELSE
    UPDATE public.breeding_records
    SET status = 'Failed', actual_kidding_date = NULL,
      offspring_count = 0, updated_at = now()
    WHERE id = p_breeding_id AND user_id = auth.uid();
    UPDATE public.animals
    SET breeding_status = 'Open', expected_kidding_date = NULL, updated_at = now()
    WHERE id = v_mother.id AND user_id = auth.uid();
    PERFORM public.record_breeding_activity(
      auth.uid(), p_breeding_id, v_mother.id, 'birth_failed',
      COALESCE(v_mother.name, v_mother.tag_id),
      jsonb_build_object('result', v_result_label, 'event_date', p_event_date, 'notes', NULLIF(trim(COALESCE(p_notes, '')), ''))
    );
  END IF;

  PERFORM public.record_breeding_activity(
    auth.uid(), p_breeding_id, v_mother.id, 'birth_confirmed',
    COALESCE(v_mother.name, v_mother.tag_id),
    jsonb_build_object('outcome', p_outcome, 'event_date', p_event_date)
  );

  UPDATE public.breeding_due_alerts
  SET active = false, resolved_at = now(), updated_at = now()
  WHERE breeding_id = p_breeding_id AND user_id = auth.uid();
  UPDATE public.notifications
  SET read = true, is_read = true, updated_at = now()
  WHERE user_id = auth.uid()
    AND (
      (related_type = 'breeding' AND related_id = p_breeding_id::text AND event_key LIKE 'breeding_due:%')
      OR left(COALESCE(event_key, ''), length('breeding_kidding_' || v_mother.id::text || '_'))
        = 'breeding_kidding_' || v_mother.id::text || '_'
    );
  INSERT INTO public.notifications (
    user_id, type, title, description, message, priority, severity,
    link, related_type, related_id, animal_id, event_key, read, is_read, updated_at
  ) VALUES (
    auth.uid(), 'Breeding',
    CASE WHEN p_outcome = 'successful' THEN 'Naitala ang panganganak' ELSE 'Naitala ang resulta ng panganganak' END,
    format('%s — %s.', v_mother.name, v_result_label),
    format('%s — %s.', v_mother.name, v_result_label),
    CASE WHEN p_outcome = 'successful' THEN 'Success' ELSE 'Warning' END,
    CASE WHEN p_outcome = 'successful' THEN 'normal' ELSE 'warning' END,
    '/animals/' || v_mother.id::text,
    'breeding', p_breeding_id::text, v_mother.id,
    'breeding_result:' || p_breeding_id::text, false, false, now()
  ) ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object(
    'success', true, 'already_recorded', false, 'outcome', p_outcome,
    'event_id', v_event_id, 'newborns', v_children, 'newborn_count', v_newborn_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_breeding_birth(uuid, text, date, time, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_breeding_birth(uuid, text, date, time, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
