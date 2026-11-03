BEGIN;

-- A farm counting activity is distinct from Smart Gate reconciliation. The
-- active animal roster is snapshotted at start so history remains meaningful.
CREATE TABLE IF NOT EXISTS public.counting_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  camera_id text NOT NULL DEFAULT 'C320WS-01' CHECK (length(camera_id) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'ONGOING'
    CHECK (status IN ('ONGOING', 'COMPLETE', 'INCOMPLETE', 'CANCELLED')),
  required_goats integer NOT NULL CHECK (required_goats >= 0),
  required_sheep integer NOT NULL CHECK (required_sheep >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'ONGOING' AND ended_at IS NULL AND completed_at IS NULL)
    OR (status = 'COMPLETE' AND completed_at IS NOT NULL AND ended_at IS NOT NULL)
    OR (status IN ('INCOMPLETE', 'CANCELLED') AND ended_at IS NOT NULL AND completed_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS counting_sessions_one_ongoing_per_camera
  ON public.counting_sessions(user_id, camera_id) WHERE status = 'ONGOING';
CREATE INDEX IF NOT EXISTS counting_sessions_user_started_idx
  ON public.counting_sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.counting_session_animals (
  session_id uuid NOT NULL REFERENCES public.counting_sessions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES public.animals(id) ON DELETE RESTRICT,
  species text NOT NULL CHECK (species IN ('goat', 'sheep')),
  eartag_number integer,
  animal_tag_id text NOT NULL,
  animal_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, animal_id),
  UNIQUE (session_id, species, eartag_number)
);
CREATE INDEX IF NOT EXISTS counting_session_animals_lookup_idx
  ON public.counting_session_animals(user_id, session_id, species, eartag_number);

CREATE TABLE IF NOT EXISTS public.counting_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.counting_sessions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key uuid NOT NULL,
  tracking_id text NOT NULL CHECK (tracking_id ~ '^T-[0-9]{3,12}$'),
  species text NOT NULL CHECK (species IN ('goat', 'sheep')),
  direction text NOT NULL CHECK (direction IN ('entry', 'exit')),
  animal_id uuid REFERENCES public.animals(id) ON DELETE RESTRICT,
  animal_tag_id text,
  animal_name text,
  eartag_number integer,
  identity_status text NOT NULL CHECK (identity_status IN ('known', 'unknown')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  movement_observation text NOT NULL DEFAULT 'normal'
    CHECK (movement_observation IN ('normal', 'slow_approach', 'prolonged_stop')),
  config_revision bigint NOT NULL DEFAULT 0 CHECK (config_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key),
  CHECK ((identity_status = 'known' AND animal_id IS NOT NULL)
    OR (identity_status = 'unknown' AND animal_id IS NULL))
);
CREATE INDEX IF NOT EXISTS counting_session_events_session_time_idx
  ON public.counting_session_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS counting_session_events_animal_time_idx
  ON public.counting_session_events(session_id, animal_id, created_at DESC)
  WHERE animal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS counting_session_events_track_time_idx
  ON public.counting_session_events(session_id, tracking_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_event_key
  ON public.notifications(user_id, event_key) WHERE event_key IS NOT NULL;

ALTER TABLE public.counting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counting_session_animals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counting_session_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS counting_sessions_select_own ON public.counting_sessions;
CREATE POLICY counting_sessions_select_own ON public.counting_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS counting_session_animals_select_own ON public.counting_session_animals;
CREATE POLICY counting_session_animals_select_own ON public.counting_session_animals
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS counting_session_events_select_own ON public.counting_session_events;
CREATE POLICY counting_session_events_select_own ON public.counting_session_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.counting_sessions, public.counting_session_animals, public.counting_session_events
  FROM anon, authenticated;
GRANT SELECT ON public.counting_sessions, public.counting_session_animals, public.counting_session_events
  TO authenticated;

CREATE OR REPLACE FUNCTION public.start_camera_counting_session(
  p_user_id uuid,
  p_camera_id text DEFAULT 'C320WS-01'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.counting_sessions%rowtype;
  v_goats integer;
  v_sheep integer;
BEGIN
  IF p_user_id IS NULL OR p_camera_id IS NULL OR length(p_camera_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Invalid counting session request.' USING errcode = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_camera_id));
  SELECT * INTO v_session FROM public.counting_sessions
    WHERE user_id = p_user_id AND camera_id = p_camera_id AND status = 'ONGOING'
    ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'session_id', v_session.id);
  END IF;

  SELECT count(*) FILTER (WHERE lower(a.species) = 'goat'),
         count(*) FILTER (WHERE lower(a.species) = 'sheep')
    INTO v_goats, v_sheep
  FROM public.animals a
  WHERE a.user_id = p_user_id
    AND coalesce(a.archived, false) = false
    AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND lower(a.species) IN ('goat', 'sheep');

  IF coalesce(v_goats, 0) + coalesce(v_sheep, 0) = 0 THEN
    RAISE EXCEPTION 'No active goats or sheep are registered.' USING errcode = '22023';
  END IF;

  INSERT INTO public.counting_sessions(user_id, camera_id, required_goats, required_sheep)
    VALUES (p_user_id, p_camera_id, v_goats, v_sheep)
    RETURNING * INTO v_session;

  INSERT INTO public.counting_session_animals(
    session_id, user_id, animal_id, species, eartag_number, animal_tag_id, animal_name
  )
  SELECT v_session.id, a.user_id, a.id, lower(a.species), a.eartag_number, a.tag_id, a.name
  FROM public.animals a
  WHERE a.user_id = p_user_id
    AND coalesce(a.archived, false) = false
    AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND lower(a.species) IN ('goat', 'sheep');

  RETURN jsonb_build_object('created', true, 'session_id', v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_camera_counting_session_progress(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.counting_sessions%rowtype;
  v_goats integer := 0;
  v_sheep integer := 0;
  v_entry_events integer := 0;
  v_exit_events integer := 0;
  v_unknown_entries integer := 0;
  v_inside_known integer := 0;
  v_inside_unknown integer := 0;
BEGIN
  SELECT * INTO v_session FROM public.counting_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(DISTINCT e.animal_id) FILTER (WHERE r.species = 'goat'),
         count(DISTINCT e.animal_id) FILTER (WHERE r.species = 'sheep')
    INTO v_goats, v_sheep
  FROM public.counting_session_events e
  JOIN public.counting_session_animals r
    ON r.session_id = e.session_id AND r.animal_id = e.animal_id
  WHERE e.session_id = p_session_id AND e.direction = 'entry' AND e.animal_id IS NOT NULL;

  SELECT count(*) FILTER (WHERE direction = 'entry'),
         count(*) FILTER (WHERE direction = 'exit'),
         count(*) FILTER (WHERE direction = 'entry' AND animal_id IS NULL)
    INTO v_entry_events, v_exit_events, v_unknown_entries
  FROM public.counting_session_events WHERE session_id = p_session_id;

  SELECT count(*) FILTER (WHERE direction = 'entry')
    INTO v_inside_known
  FROM (
    SELECT DISTINCT ON (animal_id) animal_id, direction
    FROM public.counting_session_events
    WHERE session_id = p_session_id AND animal_id IS NOT NULL
    ORDER BY animal_id, created_at DESC, id DESC
  ) latest;

  SELECT count(*) FILTER (WHERE direction = 'entry')
    INTO v_inside_unknown
  FROM (
    SELECT DISTINCT ON (tracking_id) tracking_id, direction
    FROM public.counting_session_events
    WHERE session_id = p_session_id AND animal_id IS NULL
    ORDER BY tracking_id, created_at DESC, id DESC
  ) latest;

  RETURN jsonb_build_object(
    'id', v_session.id, 'user_id', v_session.user_id, 'camera_id', v_session.camera_id,
    'status', v_session.status, 'started_at', v_session.started_at,
    'completed_at', v_session.completed_at, 'ended_at', v_session.ended_at,
    'required_goats', v_session.required_goats, 'required_sheep', v_session.required_sheep,
    'entered_goats', coalesce(v_goats, 0), 'entered_sheep', coalesce(v_sheep, 0),
    'missing_goats', greatest(v_session.required_goats - coalesce(v_goats, 0), 0),
    'missing_sheep', greatest(v_session.required_sheep - coalesce(v_sheep, 0), 0),
    'entry_event_count', coalesce(v_entry_events, 0), 'exit_event_count', coalesce(v_exit_events, 0),
    'unknown_entry_count', coalesce(v_unknown_entries, 0),
    'current_inside_known_count', coalesce(v_inside_known, 0),
    'current_inside_unknown_count', coalesce(v_inside_unknown, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_camera_counting_event(
  p_user_id uuid,
  p_session_id uuid,
  p_event_key uuid,
  p_tracking_id text,
  p_species text,
  p_direction text,
  p_confidence numeric,
  p_movement_observation text,
  p_config_revision bigint,
  p_eartag_number integer DEFAULT NULL,
  p_eartag_confidence numeric DEFAULT NULL,
  p_camera_id text DEFAULT 'C320WS-01'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.counting_sessions%rowtype;
  v_animal public.counting_session_animals%rowtype;
  v_identity text := 'unknown';
  v_inserted_id uuid;
  v_progress jsonb;
  v_duplicate boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_event_key IS NULL OR p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,12}$'
     OR p_tracking_id IS NULL OR p_species IS NULL OR p_species NOT IN ('goat', 'sheep')
     OR p_direction IS NULL OR p_direction NOT IN ('entry', 'exit')
     OR p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1
     OR p_movement_observation IS NULL OR p_movement_observation NOT IN ('normal', 'slow_approach', 'prolonged_stop')
     OR p_config_revision IS NULL OR p_config_revision < 0
     OR p_camera_id IS NULL
     OR (p_eartag_number IS NOT NULL AND (p_eartag_number < 1 OR p_eartag_number > 999999))
     OR (p_eartag_confidence IS NOT NULL AND (p_eartag_confidence < 0 OR p_eartag_confidence > 1)) THEN
    RAISE EXCEPTION 'Invalid camera counting event.' USING errcode = '22023';
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('accepted', true, 'reason', 'no_session_config');
  END IF;
  SELECT * INTO v_session FROM public.counting_sessions
  WHERE id = p_session_id AND user_id = p_user_id AND camera_id = p_camera_id AND status = 'ONGOING'
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Acknowledge safely; events outside an active session must not be attached
    -- to a future session after they leave the gateway outbox.
    RETURN jsonb_build_object('accepted', true, 'reason', 'no_active_session');
  END IF;
  IF p_eartag_number IS NOT NULL AND coalesce(p_eartag_confidence, 0) >= 0.75 THEN
    SELECT * INTO v_animal FROM public.counting_session_animals
    WHERE session_id = v_session.id AND user_id = p_user_id
      AND species = p_species AND eartag_number = p_eartag_number;
    IF FOUND THEN v_identity := 'known'; END IF;
  END IF;

  INSERT INTO public.counting_session_events(
    session_id, user_id, event_key, tracking_id, species, direction,
    animal_id, animal_tag_id, animal_name, eartag_number, identity_status,
    confidence, movement_observation, config_revision, created_at
  ) VALUES (
    v_session.id, p_user_id, p_event_key, p_tracking_id, p_species, p_direction,
    CASE WHEN v_identity = 'known' THEN v_animal.animal_id ELSE NULL END,
    CASE WHEN v_identity = 'known' THEN v_animal.animal_tag_id ELSE NULL END,
    CASE WHEN v_identity = 'known' THEN v_animal.animal_name ELSE NULL END,
    CASE WHEN v_identity = 'known' THEN p_eartag_number ELSE NULL END,
    v_identity, p_confidence, p_movement_observation, p_config_revision, clock_timestamp()
  ) ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    v_duplicate := true;
    INSERT INTO public.notifications(user_id, type, title, description, priority, link, event_key)
    VALUES (p_user_id, 'Camera Counting', 'Duplicate crossing event ignored',
      'Nadoble ang parehong camera event key. Hindi ito muling ibinilang.',
      'Normal', '/livestock-monitoring', 'camera-count-duplicate:' || p_event_key::text)
    ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  ELSE
    IF p_direction = 'entry' AND v_identity = 'unknown' THEN
      INSERT INTO public.notifications(user_id, type, title, description, priority, link, event_key)
      VALUES (p_user_id, 'Camera Counting', 'May hayop na hindi pa nakikilala',
        'May kambing o tupa na tumawid, pero hindi malinaw ang eartag. Hindi ito ibinilang sa mga kilalang hayop.',
        'Warning', '/livestock-monitoring', 'camera-count-unknown:' || p_event_key::text)
      ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
    END IF;

    v_progress := public.get_camera_counting_session_progress(v_session.id);
    IF (v_progress->>'entered_goats')::integer >= v_session.required_goats
       AND (v_progress->>'entered_sheep')::integer >= v_session.required_sheep THEN
      UPDATE public.counting_sessions SET status = 'COMPLETE', completed_at = now(), ended_at = now(), updated_at = now()
        WHERE id = v_session.id AND status = 'ONGOING';
      IF FOUND THEN
        INSERT INTO public.notifications(user_id, type, title, description, priority, link, event_key)
        VALUES (p_user_id, 'Camera Counting', 'Kumpleto na ang bilang',
          format('Kumpleto na ang bilang: %s/%s kambing at %s/%s tupa.',
            v_progress->>'entered_goats', v_session.required_goats,
            v_progress->>'entered_sheep', v_session.required_sheep),
          'Normal', '/livestock-monitoring', 'camera-count-complete:' || v_session.id::text)
        ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'accepted', true, 'duplicate', v_duplicate, 'event_id', v_inserted_id,
    'session_id', v_session.id,
    'progress', public.get_camera_counting_session_progress(v_session.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_camera_counting_session(
  p_user_id uuid,
  p_session_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.counting_sessions%rowtype;
  v_progress jsonb;
  v_missing integer;
BEGIN
  IF p_status NOT IN ('INCOMPLETE', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid counting session end status.' USING errcode = '22023';
  END IF;
  SELECT * INTO v_session FROM public.counting_sessions
    WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Counting session not found.' USING errcode = 'P0002'; END IF;
  IF v_session.status <> 'ONGOING' THEN
    RETURN public.get_camera_counting_session_progress(p_session_id);
  END IF;

  v_progress := public.get_camera_counting_session_progress(p_session_id);
  IF (v_progress->>'entered_goats')::integer >= v_session.required_goats
     AND (v_progress->>'entered_sheep')::integer >= v_session.required_sheep THEN
    UPDATE public.counting_sessions SET status = 'COMPLETE', completed_at = now(), ended_at = now(), updated_at = now()
      WHERE id = p_session_id;
    INSERT INTO public.notifications(user_id, type, title, description, priority, link, event_key)
    VALUES (p_user_id, 'Camera Counting', 'Kumpleto na ang bilang',
      'Naabot ang kinakailangang bilang ng kambing at tupa.', 'Normal', '/livestock-monitoring',
      'camera-count-complete:' || p_session_id::text)
    ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  ELSE
    UPDATE public.counting_sessions SET status = p_status, ended_at = now(), updated_at = now()
      WHERE id = p_session_id;
    v_missing := (v_progress->>'missing_goats')::integer + (v_progress->>'missing_sheep')::integer;
    IF p_status = 'INCOMPLETE' THEN
      INSERT INTO public.notifications(user_id, type, title, description, priority, link, event_key)
      VALUES (p_user_id, 'Camera Counting', 'Hindi pa kumpleto ang bilang',
        format('May kulang pang %s hayop: %s kambing at %s tupa.', v_missing,
          v_progress->>'missing_goats', v_progress->>'missing_sheep'),
        'Warning', '/livestock-monitoring', 'camera-count-incomplete:' || p_session_id::text)
      ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  RETURN public.get_camera_counting_session_progress(p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_camera_counting_session_progress(
  p_user_id uuid,
  p_limit integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(jsonb_agg(public.get_camera_counting_session_progress(session.id)
                            ORDER BY session.started_at DESC), '[]'::jsonb)
  FROM (
    SELECT id, started_at FROM public.counting_sessions
    WHERE user_id = p_user_id
    ORDER BY started_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 30), 30))
  ) AS session;
$$;

CREATE OR REPLACE FUNCTION public.record_camera_counting_events(
  p_user_id uuid,
  p_events jsonb,
  p_camera_id text DEFAULT 'C320WS-01'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_count integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_events IS NULL OR jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 100 THEN
    RAISE EXCEPTION 'Invalid camera counting event batch.' USING errcode = '22023';
  END IF;
  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events)
  LOOP
    v_count := v_count + 1;
    v_result := public.record_camera_counting_event(
      p_user_id,
      CASE WHEN v_event->>'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN (v_event->>'session_id')::uuid ELSE NULL END,
      (v_event->>'event_key')::uuid,
      v_event->>'tracking_id',
      v_event->>'species_detected',
      v_event->>'direction',
      (v_event->>'confidence')::numeric,
      v_event->>'movement_observation',
      (v_event->>'config_revision')::bigint,
      CASE WHEN v_event->>'eartag_number' ~ '^[0-9]{1,6}$' THEN (v_event->>'eartag_number')::integer ELSE NULL END,
      CASE WHEN v_event->>'eartag_confidence' ~ '^(0(\.\d+)?|1(\.0+)?)$' THEN (v_event->>'eartag_confidence')::numeric ELSE NULL END,
      p_camera_id
    );
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'event_key', v_event->>'event_key', 'result', v_result
    ));
  END LOOP;
  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.start_camera_counting_session(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_camera_counting_session_progress(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_camera_counting_event(uuid, uuid, uuid, text, text, text, numeric, text, bigint, integer, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_camera_counting_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_camera_counting_events(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_camera_counting_session_progress(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_camera_counting_session(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_camera_counting_session_progress(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_camera_counting_event(uuid, uuid, uuid, text, text, text, numeric, text, bigint, integer, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_camera_counting_session(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_camera_counting_events(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_camera_counting_session_progress(uuid, integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'counting_sessions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.counting_sessions;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'counting_session_events') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.counting_session_events;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
