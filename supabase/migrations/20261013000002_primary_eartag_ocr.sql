BEGIN;

-- Eartag values are visible identifiers scoped to each farm. Existing animal
-- UUIDs, internal tag IDs, and legacy QR verification rows remain unchanged.
ALTER TABLE public.animals
  ADD COLUMN IF NOT EXISTS camera_last_eartag_at timestamptz;

DROP INDEX IF EXISTS public.idx_animals_user_eartag_number_unique_active;
CREATE UNIQUE INDEX idx_animals_user_eartag_number_unique_active
  ON public.animals (user_id, eartag_number)
  WHERE coalesce(archived, false) = false
    AND coalesce(is_sold, false) = false
    AND lower(coalesce(status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND eartag_number IS NOT NULL;

ALTER TABLE public.gate_events
  DROP CONSTRAINT IF EXISTS gate_events_qr_verified_check,
  ALTER COLUMN qr_verified SET DEFAULT false,
  ADD COLUMN IF NOT EXISTS eartag_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eartag_number text;
ALTER TABLE public.gate_events
  ADD CONSTRAINT gate_events_eartag_number_check
    CHECK (eartag_number IS NULL OR eartag_number ~ '^[0-9]{1,6}$'),
  ADD CONSTRAINT gate_events_eartag_verified_check
    CHECK (NOT eartag_verified OR (animal_id IS NOT NULL AND eartag_number IS NOT NULL));

ALTER TABLE public.gate_camera_crossings
  ADD COLUMN IF NOT EXISTS eartag_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eartag_number text;
ALTER TABLE public.gate_camera_crossings
  ADD CONSTRAINT gate_camera_crossings_eartag_number_check
    CHECK (eartag_number IS NULL OR eartag_number ~ '^[0-9]{1,6}$'),
  ADD CONSTRAINT gate_camera_crossings_eartag_verified_check
    CHECK (NOT eartag_verified OR (animal_id IS NOT NULL AND eartag_number IS NOT NULL));

CREATE INDEX IF NOT EXISTS animals_user_camera_last_eartag_idx
  ON public.animals (user_id, camera_last_eartag_at DESC)
  WHERE camera_last_eartag_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.link_gate_detection_sighting_eartag(
  p_session_id uuid,
  p_tracking_id text,
  p_species_detected text,
  p_confidence numeric,
  p_eartag_number text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_animal public.animals%rowtype;
  v_previous public.gate_detection_sightings%rowtype;
  v_sighting public.gate_detection_sightings%rowtype;
  v_number text;
  v_actor_name text;
  v_animal_found boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;
  IF p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,}$'
     OR p_species_detected IS NULL OR p_species_detected NOT IN ('goat', 'sheep')
     OR p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1
     OR p_eartag_number IS NULL OR p_eartag_number !~ '^[0-9]{1,6}$'
     OR p_eartag_number::integer <= 0 THEN
    RAISE EXCEPTION 'Invalid eartag detection.' USING errcode = '22023';
  END IF;
  v_number := p_eartag_number::integer::text;

  SELECT * INTO v_session FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id AND s.status = 'monitoring';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501';
  END IF;

  SELECT * INTO v_animal FROM public.animals a
  WHERE a.user_id = v_user_id
    AND a.eartag_number = v_number::integer
    AND coalesce(a.archived, false) = false
    AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND lower(a.species) = p_species_detected
  LIMIT 1;
  v_animal_found := FOUND;

  SELECT * INTO v_previous FROM public.gate_detection_sightings s
  WHERE s.session_id = v_session.id AND s.tracking_id = p_tracking_id
  FOR UPDATE;

  INSERT INTO public.gate_detection_sightings (
    session_id, user_id, gate_id, tracking_id, species_detected, confidence,
    animal_id, eartag_verified, eartag_number
  ) VALUES (
    v_session.id, v_user_id, v_session.gate_id, p_tracking_id, p_species_detected, p_confidence,
    CASE WHEN v_animal_found THEN v_animal.id ELSE NULL END,
    v_animal_found,
    v_number
  )
  ON CONFLICT (session_id, tracking_id) DO UPDATE
    SET animal_id = coalesce(public.gate_detection_sightings.animal_id, EXCLUDED.animal_id),
        eartag_verified = public.gate_detection_sightings.eartag_verified OR EXCLUDED.eartag_verified,
        eartag_number = coalesce(public.gate_detection_sightings.eartag_number, EXCLUDED.eartag_number),
        confidence = EXCLUDED.confidence,
        last_seen_at = greatest(public.gate_detection_sightings.last_seen_at, now())
    WHERE public.gate_detection_sightings.species_detected = EXCLUDED.species_detected
      AND (public.gate_detection_sightings.animal_id IS NULL OR EXCLUDED.animal_id IS NULL
           OR public.gate_detection_sightings.animal_id = EXCLUDED.animal_id)
      AND (public.gate_detection_sightings.eartag_number IS NULL
           OR public.gate_detection_sightings.eartag_number = EXCLUDED.eartag_number)
  RETURNING * INTO v_sighting;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Camera track already has a different verified number or animal.' USING errcode = '22023';
  END IF;

  IF v_sighting.eartag_verified AND v_sighting.animal_id IS NOT NULL THEN
    UPDATE public.animals
    SET camera_last_seen_at = greatest(coalesce(camera_last_seen_at, now()), now()),
        camera_last_eartag_at = greatest(coalesce(camera_last_eartag_at, now()), now())
    WHERE id = v_sighting.animal_id AND user_id = v_user_id;
  END IF;

  IF v_previous.id IS NULL OR (NOT v_previous.eartag_verified AND v_sighting.eartag_verified) THEN
    SELECT p.full_name INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
    INSERT INTO public.activity_logs (
      actor_id, actor_name, farm_user_id, module, action, entity_id, entity_name,
      animal_id, details
    ) VALUES (
      v_user_id, coalesce(v_actor_name, 'System / User'), v_user_id, 'Camera',
      CASE WHEN v_sighting.eartag_verified THEN 'eartag_ocr_verified' ELSE 'unknown_eartag_detected' END,
      v_sighting.id::text,
      CASE WHEN v_sighting.eartag_verified THEN v_number || ' — ' || v_animal.name
        ELSE 'Unknown eartag ' || v_number END,
      v_sighting.animal_id,
      jsonb_build_object('eartag_number', v_number, 'tracking_id', p_tracking_id,
        'species', p_species_detected, 'identification_method', 'number_ocr')
    );
  END IF;

  RETURN to_jsonb(v_sighting);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_gate_movement_eartag(
  p_session_id uuid,
  p_tracking_id text,
  p_direction text,
  p_species_detected text,
  p_confidence numeric,
  p_eartag_number text,
  p_movement_observation text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_sighting public.gate_detection_sightings%rowtype;
  v_animal public.animals%rowtype;
  v_event public.gate_events%rowtype;
  v_number text;
  v_actor_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;
  IF p_direction NOT IN ('entry', 'exit')
     OR p_species_detected NOT IN ('goat', 'sheep')
     OR p_confidence IS NULL OR p_confidence < 0.4 OR p_confidence > 1
     OR p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,}$'
     OR p_eartag_number IS NULL OR p_eartag_number !~ '^[0-9]{1,6}$'
     OR p_eartag_number::integer <= 0
     OR p_movement_observation NOT IN ('normal', 'slow_approach', 'prolonged_stop') THEN
    RAISE EXCEPTION 'Invalid verified camera movement.' USING errcode = '22023';
  END IF;
  v_number := p_eartag_number::integer::text;

  SELECT * INTO v_session FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id AND s.status = 'monitoring'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501';
  END IF;
  IF now() > v_session.started_at + make_interval(mins => v_session.reconciliation_window_minutes) THEN
    RAISE EXCEPTION 'Reconciliation window has ended.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_sighting FROM public.gate_detection_sightings s
  WHERE s.session_id = v_session.id AND s.user_id = v_user_id AND s.tracking_id = p_tracking_id
    AND s.species_detected = p_species_detected AND s.eartag_verified
    AND s.eartag_number = v_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The camera track has no matching multi-frame verified eartag.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_animal FROM public.animals a
  WHERE a.id = v_sighting.animal_id AND a.user_id = v_user_id
    AND a.eartag_number = v_number::integer
    AND coalesce(a.archived, false) = false AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND lower(a.species) = p_species_detected;
  IF NOT FOUND OR NOT (v_animal.id = ANY(v_session.expected_animal_ids)) THEN
    RAISE EXCEPTION 'The eartag animal is not active in this farm session.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_event FROM public.gate_events e
  WHERE e.session_id = v_session.id AND e.user_id = v_user_id
    AND e.animal_id = v_animal.id AND e.direction = p_direction
    AND e.created_at >= now() - interval '20 seconds'
  ORDER BY e.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'event_id', v_event.id);
  END IF;

  INSERT INTO public.gate_events (
    session_id, user_id, gate_id, animal_id, direction, species_detected,
    qr_verified, eartag_verified, eartag_number, confidence, tracking_id, movement_observation
  ) VALUES (
    v_session.id, v_user_id, v_session.gate_id, v_animal.id, p_direction, p_species_detected,
    false, true, v_number, p_confidence, p_tracking_id, p_movement_observation
  ) RETURNING * INTO v_event;

  UPDATE public.gate_camera_crossings c
  SET animal_id = v_animal.id, event_id = v_event.id,
      eartag_verified = true, eartag_number = v_number
  WHERE c.id = (
    SELECT candidate.id FROM public.gate_camera_crossings candidate
    WHERE candidate.session_id = v_session.id AND candidate.user_id = v_user_id
      AND candidate.tracking_id = p_tracking_id AND candidate.direction = p_direction
      AND NOT candidate.qr_verified AND NOT candidate.eartag_verified
      AND candidate.created_at BETWEEN v_event.created_at - interval '20 seconds' AND v_event.created_at
    ORDER BY abs(extract(epoch FROM (v_event.created_at - candidate.created_at)))
    LIMIT 1
  );

  UPDATE public.animals
  SET camera_last_seen_at = greatest(coalesce(camera_last_seen_at, v_event.created_at), v_event.created_at),
      camera_last_eartag_at = greatest(coalesce(camera_last_eartag_at, v_event.created_at), v_event.created_at)
  WHERE id = v_animal.id AND user_id = v_user_id;

  UPDATE public.gate_sessions s
  SET entered_count = (SELECT count(*) FROM public.gate_events e WHERE e.session_id = s.id AND e.direction = 'entry'),
      exited_count = (SELECT count(*) FROM public.gate_events e WHERE e.session_id = s.id AND e.direction = 'exit')
  WHERE s.id = v_session.id;

  SELECT p.full_name INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
  INSERT INTO public.activity_logs (
    actor_id, actor_name, farm_user_id, module, action, entity_id, entity_name,
    animal_id, details
  ) VALUES (
    v_user_id, coalesce(v_actor_name, 'System / User'), v_user_id, 'Camera',
    CASE WHEN p_direction = 'entry' THEN 'camera_eartag_entry' ELSE 'camera_eartag_exit' END,
    v_event.id::text, v_number || ' — ' || v_animal.name, v_animal.id,
    jsonb_build_object('eartag_number', v_number, 'direction', p_direction,
      'tracking_id', p_tracking_id, 'identification_method', 'number_ocr')
  );

  IF p_direction = 'entry' THEN
    UPDATE public.gate_alerts
    SET status = 'resolved', resolved_at = now()
    WHERE animal_id = v_animal.id AND user_id = v_user_id
      AND alert_type = 'unaccounted' AND status <> 'resolved';

    IF p_movement_observation IN ('slow_approach', 'prolonged_stop') THEN
      INSERT INTO public.gate_alerts (session_id, user_id, animal_id, alert_type, message)
      VALUES (v_session.id, v_user_id, v_animal.id, 'movement_observation',
        'May napansing mabagal o matagal na paghinto habang pumapasok. Tingnan ang hayop pagkapasok nito.')
      ON CONFLICT (session_id, animal_id, alert_type) DO UPDATE
        SET status = 'active', message = excluded.message, resolved_at = NULL, created_at = now();
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'duplicate', false, 'event_id', v_event.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_gate_camera_crossing(
  p_session_id uuid,
  p_crossing_key uuid,
  p_tracking_id text,
  p_species_detected text,
  p_direction text,
  p_confidence numeric,
  p_movement_observation text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_crossing_id uuid;
  v_duplicate boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING errcode = '28000'; END IF;
  IF p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,}$'
     OR p_species_detected NOT IN ('goat', 'sheep') OR p_direction NOT IN ('entry', 'exit')
     OR p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1
     OR p_movement_observation NOT IN ('normal', 'slow_approach', 'prolonged_stop') THEN
    RAISE EXCEPTION 'Invalid camera crossing.' USING errcode = '22023';
  END IF;
  SELECT * INTO v_session FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id AND s.status = 'monitoring';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501'; END IF;

  INSERT INTO public.gate_camera_crossings (
    crossing_key, session_id, gate_id, user_id, tracking_id, species_detected,
    direction, confidence, movement_observation
  ) VALUES (
    p_crossing_key, v_session.id, v_session.gate_id, v_user_id, p_tracking_id,
    p_species_detected, p_direction, p_confidence, p_movement_observation
  ) ON CONFLICT (session_id, crossing_key) DO NOTHING RETURNING id INTO v_crossing_id;
  IF v_crossing_id IS NULL THEN
    v_duplicate := true;
    SELECT id INTO v_crossing_id FROM public.gate_camera_crossings
    WHERE session_id = v_session.id AND crossing_key = p_crossing_key;
  END IF;

  WITH matching AS (
    SELECT crossing.id AS crossing_id, event.id AS event_id, event.animal_id,
      event.qr_verified, event.eartag_verified, event.eartag_number
    FROM public.gate_camera_crossings crossing
    JOIN LATERAL (
      SELECT candidate.id, candidate.animal_id, candidate.qr_verified,
        candidate.eartag_verified, candidate.eartag_number
      FROM public.gate_events candidate
      WHERE candidate.session_id = v_session.id AND candidate.user_id = v_user_id
        AND candidate.tracking_id = p_tracking_id AND candidate.direction = p_direction
        AND (candidate.qr_verified OR candidate.eartag_verified)
        AND candidate.created_at BETWEEN crossing.created_at - interval '20 seconds'
          AND crossing.created_at + interval '20 seconds'
        AND NOT EXISTS (
          SELECT 1 FROM public.gate_camera_crossings linked
          WHERE linked.event_id = candidate.id AND linked.id <> crossing.id
        )
      ORDER BY abs(extract(epoch FROM (candidate.created_at - crossing.created_at)))
      LIMIT 1
    ) event ON true
    WHERE crossing.id = v_crossing_id AND NOT crossing.qr_verified AND NOT crossing.eartag_verified
  )
  UPDATE public.gate_camera_crossings crossing
  SET animal_id = matching.animal_id, event_id = matching.event_id,
      qr_verified = matching.qr_verified, eartag_verified = matching.eartag_verified,
      eartag_number = matching.eartag_number
  FROM matching WHERE crossing.id = matching.crossing_id;

  RETURN jsonb_build_object('success', true, 'duplicate', v_duplicate, 'crossing_id', v_crossing_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_gate_camera_metrics(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_crossings integer;
  v_identified integer;
  v_entry integer;
  v_exit integer;
  v_verified_entry integer;
  v_verified_exit integer;
  v_live integer;
  v_live_goats integer;
  v_live_sheep integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING errcode = '28000'; END IF;
  SELECT * INTO v_session FROM public.gate_sessions s WHERE s.id = p_session_id AND s.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gate session not found.' USING errcode = '42501'; END IF;

  SELECT count(*), count(*) FILTER (WHERE c.qr_verified OR c.eartag_verified),
         count(*) FILTER (WHERE c.direction = 'entry'), count(*) FILTER (WHERE c.direction = 'exit')
  INTO v_crossings, v_identified, v_entry, v_exit
  FROM public.gate_camera_crossings c WHERE c.session_id = v_session.id AND c.user_id = v_user_id;
  SELECT count(*) FILTER (WHERE e.direction = 'entry'), count(*) FILTER (WHERE e.direction = 'exit')
  INTO v_verified_entry, v_verified_exit
  FROM public.gate_events e WHERE e.session_id = v_session.id AND e.user_id = v_user_id
    AND (e.qr_verified OR e.eartag_verified);
  SELECT count(*), count(*) FILTER (WHERE species_detected = 'goat'), count(*) FILTER (WHERE species_detected = 'sheep')
  INTO v_live, v_live_goats, v_live_sheep
  FROM public.gate_live_tracks live WHERE live.session_id = v_session.id AND live.user_id = v_user_id
    AND live.last_seen_at >= now() - interval '10 seconds';
  RETURN jsonb_build_object(
    'session_id', v_session.id, 'crossing_count', v_crossings,
    'identified_crossing_count', v_identified, 'unidentified_crossing_count', v_crossings - v_identified,
    'camera_entry_count', v_entry, 'camera_exit_count', v_exit,
    'verified_entry_count', v_verified_entry, 'verified_exit_count', v_verified_exit,
    'live_track_count', v_live, 'live_goat_count', v_live_goats, 'live_sheep_count', v_live_sheep
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_gate_session_summary(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_expected_ids uuid[];
  v_confirmed_ids uuid[];
  v_inside_ids uuid[];
  v_unaccounted_ids uuid[];
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING errcode = '28000'; END IF;
  SELECT * INTO v_session FROM public.gate_sessions s WHERE s.id = p_session_id AND s.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gate session not found.' USING errcode = '42501'; END IF;
  SELECT coalesce(array_agg(a.id ORDER BY a.id), '{}') INTO v_expected_ids
  FROM public.animals a WHERE a.user_id = v_user_id AND a.id = ANY(v_session.expected_animal_ids)
    AND coalesce(a.archived, false) = false AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND lower(a.species) IN ('goat', 'sheep');
  SELECT coalesce(array_agg(DISTINCT e.animal_id ORDER BY e.animal_id), '{}') INTO v_confirmed_ids
  FROM public.gate_events e WHERE e.session_id = v_session.id AND e.user_id = v_user_id
    AND (e.qr_verified OR e.eartag_verified) AND e.animal_id = ANY(v_expected_ids);
  SELECT coalesce(array_agg(latest.animal_id ORDER BY latest.animal_id), '{}') INTO v_inside_ids
  FROM (
    SELECT DISTINCT ON (e.animal_id) e.animal_id, e.direction FROM public.gate_events e
    WHERE e.session_id = v_session.id AND e.user_id = v_user_id
      AND (e.qr_verified OR e.eartag_verified) AND e.animal_id = ANY(v_expected_ids)
    ORDER BY e.animal_id, e.created_at DESC, e.id DESC
  ) latest WHERE latest.direction = 'entry';
  SELECT coalesce(array_agg(expected.animal_id ORDER BY expected.animal_id), '{}') INTO v_unaccounted_ids
  FROM unnest(v_expected_ids) AS expected(animal_id)
  WHERE NOT (expected.animal_id = ANY(v_inside_ids));
  RETURN jsonb_build_object('session_id', v_session.id,
    'expected_animal_ids', to_jsonb(v_expected_ids), 'confirmed_animal_ids', to_jsonb(v_confirmed_ids),
    'inside_animal_ids', to_jsonb(v_inside_ids), 'unaccounted_animal_ids', to_jsonb(v_unaccounted_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_gate_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_missing_ids uuid[];
  v_entered integer;
  v_exited integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING errcode = '28000'; END IF;
  SELECT * INTO v_session FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'monitoring' THEN
    RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501';
  END IF;
  IF now() < v_session.started_at + make_interval(mins => v_session.reconciliation_window_minutes) THEN
    RAISE EXCEPTION 'The reconciliation window is still open.' USING errcode = '22023';
  END IF;
  WITH latest_direction AS (
    SELECT DISTINCT ON (e.animal_id) e.animal_id, e.direction FROM public.gate_events e
    WHERE e.session_id = v_session.id AND e.user_id = v_user_id
      AND (e.qr_verified OR e.eartag_verified)
    ORDER BY e.animal_id, e.created_at DESC, e.id DESC
  )
  SELECT coalesce(array_agg(expected.animal_id ORDER BY expected.animal_id), '{}') INTO v_missing_ids
  FROM unnest(v_session.expected_animal_ids) AS expected(animal_id)
  JOIN public.animals a ON a.id = expected.animal_id AND a.user_id = v_user_id
  LEFT JOIN latest_direction latest ON latest.animal_id = expected.animal_id
  WHERE coalesce(a.archived, false) = false AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND latest.direction IS DISTINCT FROM 'entry';
  SELECT count(*) FILTER (WHERE direction = 'entry'), count(*) FILTER (WHERE direction = 'exit')
  INTO v_entered, v_exited FROM public.gate_events
  WHERE session_id = v_session.id AND user_id = v_user_id AND (qr_verified OR eartag_verified);
  UPDATE public.gate_sessions SET status = 'reconciled', ended_at = now(), entered_count = v_entered,
    exited_count = v_exited, missing_count = cardinality(v_missing_ids) WHERE id = v_session.id;
  INSERT INTO public.gate_alerts (session_id, user_id, animal_id, alert_type, message)
  SELECT v_session.id, v_user_id, a.id, 'unaccounted',
    'Needs verification: ' || a.name || ' (' || a.tag_id || ') was not confirmed inside at reconciliation.'
  FROM unnest(v_missing_ids) AS missing(animal_id)
  JOIN public.animals a ON a.id = missing.animal_id AND a.user_id = v_user_id
  ON CONFLICT (session_id, animal_id, alert_type) DO UPDATE
    SET status = 'active', message = excluded.message, resolved_at = null, created_at = now();
  RETURN jsonb_build_object('success', true, 'session_id', v_session.id,
    'expected_count', v_session.expected_count, 'entered_count', v_entered, 'exited_count', v_exited,
    'unaccounted_ids', to_jsonb(v_missing_ids), 'unaccounted_count', cardinality(v_missing_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.log_animal_eartag_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), NEW.user_id);
  v_actor_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.eartag_number IS NOT DISTINCT FROM NEW.eartag_number THEN RETURN NEW; END IF;
  IF NEW.eartag_number IS NULL THEN RETURN NEW; END IF;
  SELECT p.full_name INTO v_actor_name FROM public.profiles p WHERE p.id = v_actor;
  INSERT INTO public.activity_logs (
    actor_id, actor_name, farm_user_id, module, action, entity_id, entity_name, animal_id, details
  ) VALUES (
    v_actor, coalesce(v_actor_name, 'System / User'), NEW.user_id, 'Animals',
    CASE WHEN TG_OP = 'INSERT' OR OLD.eartag_number IS NULL THEN 'eartag_assigned' ELSE 'eartag_changed' END,
    NEW.id::text, NEW.name || ' (' || NEW.tag_id || ')', NEW.id,
    jsonb_build_object('old_eartag_number', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.eartag_number END,
      'new_eartag_number', NEW.eartag_number, 'identification_method', 'number_ocr')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS animal_eartag_change_activity ON public.animals;
CREATE TRIGGER animal_eartag_change_activity
  AFTER INSERT OR UPDATE OF eartag_number ON public.animals
  FOR EACH ROW EXECUTE FUNCTION public.log_animal_eartag_change();

REVOKE ALL ON FUNCTION public.link_gate_detection_sighting_eartag(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_gate_detection_sighting_eartag(uuid, text, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_gate_movement_eartag(uuid, text, text, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_gate_movement_eartag(uuid, text, text, text, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_gate_camera_crossing(uuid, uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_gate_camera_crossing(uuid, uuid, text, text, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_gate_camera_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gate_camera_metrics(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_gate_session_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gate_session_summary(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.finish_gate_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_gate_session(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.log_animal_eartag_change() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
