BEGIN;

-- Preserve the old identity-based camera rows as private legacy history. New
-- CCTV sessions use only species, direction, temporary tracker ID and time.
DO $$
BEGIN
  IF to_regclass('public.counting_session_events_legacy') IS NULL
     AND to_regclass('public.counting_session_events') IS NOT NULL THEN
    ALTER TABLE public.counting_session_events RENAME TO counting_session_events_legacy;
  END IF;
  IF to_regclass('public.counting_session_animals_legacy') IS NULL
     AND to_regclass('public.counting_session_animals') IS NOT NULL THEN
    ALTER TABLE public.counting_session_animals RENAME TO counting_session_animals_legacy;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.record_camera_counting_events(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.record_camera_counting_event(uuid, uuid, uuid, text, text, text, numeric, text, bigint, integer, numeric, text);

ALTER TABLE public.counting_sessions
  ADD COLUMN IF NOT EXISTS required_total integer GENERATED ALWAYS AS (required_goats + required_sheep) STORED,
  ADD COLUMN IF NOT EXISTS entered_goats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entered_sheep integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entered_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exit_event_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_goats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_sheep integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_total integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.counting_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.counting_sessions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key uuid NOT NULL,
  tracking_id text NOT NULL CHECK (tracking_id ~ '^T-[0-9]{3,12}$'),
  animal_type text NOT NULL CHECK (animal_type IN ('goat', 'sheep')),
  direction text NOT NULL CHECK (direction IN ('entry', 'exit')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  config_revision bigint NOT NULL DEFAULT 0 CHECK (config_revision >= 0),
  detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS counting_session_events_species_time_idx
  ON public.counting_session_events(session_id, animal_type, direction, detected_at DESC);
CREATE INDEX IF NOT EXISTS counting_session_events_track_time_v2_idx
  ON public.counting_session_events(session_id, tracking_id, detected_at DESC);

-- Copy sanitized event history forward without deleting the previous rows or
-- exposing their old identity fields through the active counting API.
DO $$
BEGIN
  IF to_regclass('public.counting_session_events_legacy') IS NOT NULL THEN
    INSERT INTO public.counting_session_events(
      id, session_id, user_id, event_key, tracking_id, animal_type, direction,
      confidence, config_revision, detected_at, created_at
    )
    SELECT id, session_id, user_id, event_key, tracking_id, species, direction,
      confidence, config_revision, created_at, created_at
    FROM public.counting_session_events_legacy
    WHERE species IN ('goat', 'sheep') AND direction IN ('entry', 'exit')
    ON CONFLICT (user_id, event_key) DO NOTHING;
  END IF;
END;
$$;

-- Counters are rebuilt from confirmed entry events; exits remain in history
-- but do not erase the fact that an animal crossed into the shelter.
WITH event_totals AS (
  SELECT session.id AS session_id,
    count(event.id) FILTER (WHERE event.direction = 'entry' AND event.animal_type = 'goat')::integer AS goats,
    count(event.id) FILTER (WHERE event.direction = 'entry' AND event.animal_type = 'sheep')::integer AS sheep,
    count(event.id) FILTER (WHERE event.direction = 'exit')::integer AS exits
  FROM public.counting_sessions AS session
  LEFT JOIN public.counting_session_events AS event ON event.session_id = session.id
  GROUP BY session.id
)
UPDATE public.counting_sessions AS session
SET entered_goats = event_totals.goats,
    entered_sheep = event_totals.sheep,
    entered_total = event_totals.goats + event_totals.sheep,
    exit_event_count = event_totals.exits,
    missing_goats = greatest(session.required_goats - event_totals.goats, 0),
    missing_sheep = greatest(session.required_sheep - event_totals.sheep, 0),
    missing_total = greatest(session.required_goats + session.required_sheep - event_totals.goats - event_totals.sheep, 0)
FROM event_totals
WHERE session.id = event_totals.session_id;

ALTER TABLE public.counting_session_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS counting_session_events_select_own ON public.counting_session_events;
CREATE POLICY counting_session_events_select_own ON public.counting_session_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.counting_session_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.counting_session_events TO authenticated;

-- Keep archived identity data intact but remove client access and all active
-- references to the old roster snapshot.
DO $$
BEGIN
  IF to_regclass('public.counting_session_events_legacy') IS NOT NULL THEN
    REVOKE ALL ON public.counting_session_events_legacy FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regclass('public.counting_session_animals_legacy') IS NOT NULL THEN
    REVOKE ALL ON public.counting_session_animals_legacy FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;

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

  INSERT INTO public.counting_sessions(user_id, camera_id, required_goats, required_sheep,
    entered_goats, entered_sheep, entered_total, missing_goats, missing_sheep, missing_total)
  VALUES (p_user_id, p_camera_id, v_goats, v_sheep, 0, 0, 0, v_goats, v_sheep, v_goats + v_sheep)
  RETURNING * INTO v_session;

  RETURN jsonb_build_object('created', true, 'session_id', v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_camera_counting_session_progress(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.counting_sessions%rowtype;
BEGIN
  SELECT * INTO v_session FROM public.counting_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'id', v_session.id, 'user_id', v_session.user_id, 'camera_id', v_session.camera_id,
    'status', v_session.status, 'started_at', v_session.started_at,
    'completed_at', v_session.completed_at, 'ended_at', v_session.ended_at,
    'required_goats', v_session.required_goats, 'required_sheep', v_session.required_sheep,
    'required_total', v_session.required_total,
    'entered_goats', v_session.entered_goats, 'entered_sheep', v_session.entered_sheep,
    'entered_total', v_session.entered_total,
    'missing_goats', v_session.missing_goats, 'missing_sheep', v_session.missing_sheep,
    'missing_total', v_session.missing_total,
    'entry_event_count', v_session.entered_total, 'exit_event_count', v_session.exit_event_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_camera_counting_event(
  p_user_id uuid,
  p_session_id uuid,
  p_event_key uuid,
  p_tracking_id text,
  p_animal_type text,
  p_direction text,
  p_confidence numeric,
  p_config_revision bigint,
  p_camera_id text DEFAULT 'C320WS-01'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.counting_sessions%rowtype;
  v_inserted_id uuid;
  v_detected_at timestamptz;
  v_progress jsonb;
BEGIN
  IF p_user_id IS NULL OR p_event_key IS NULL
     OR p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,12}$'
     OR p_animal_type IS NULL OR p_animal_type NOT IN ('goat', 'sheep')
     OR p_direction IS NULL OR p_direction NOT IN ('entry', 'exit')
     OR p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1
     OR p_config_revision IS NULL OR p_config_revision < 0
     OR p_camera_id IS NULL THEN
    RAISE EXCEPTION 'Invalid camera counting event.' USING errcode = '22023';
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('accepted', true, 'reason', 'no_session_config');
  END IF;
  SELECT * INTO v_session FROM public.counting_sessions
    WHERE id = p_session_id AND user_id = p_user_id
      AND camera_id = p_camera_id AND status = 'ONGOING'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', true, 'reason', 'no_active_session');
  END IF;

  v_detected_at := clock_timestamp();
  INSERT INTO public.counting_session_events(
    session_id, user_id, event_key, tracking_id, animal_type, direction,
    confidence, config_revision, detected_at, created_at
  ) VALUES (
    v_session.id, p_user_id, p_event_key, p_tracking_id, p_animal_type, p_direction,
    p_confidence, p_config_revision, v_detected_at, v_detected_at
  ) ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL AND p_direction = 'entry' THEN
    UPDATE public.counting_sessions AS session
    SET entered_goats = session.entered_goats + CASE WHEN p_animal_type = 'goat' THEN 1 ELSE 0 END,
        entered_sheep = session.entered_sheep + CASE WHEN p_animal_type = 'sheep' THEN 1 ELSE 0 END,
        entered_total = session.entered_total + 1,
        missing_goats = greatest(session.required_goats - session.entered_goats - CASE WHEN p_animal_type = 'goat' THEN 1 ELSE 0 END, 0),
        missing_sheep = greatest(session.required_sheep - session.entered_sheep - CASE WHEN p_animal_type = 'sheep' THEN 1 ELSE 0 END, 0),
        missing_total = greatest(session.required_total - session.entered_total - 1, 0),
        updated_at = v_detected_at
    WHERE session.id = v_session.id;

    SELECT * INTO v_session FROM public.counting_sessions WHERE id = v_session.id;
    IF v_session.entered_total >= v_session.required_total THEN
      UPDATE public.counting_sessions
      SET status = 'COMPLETE', completed_at = v_detected_at,
          ended_at = v_detected_at, updated_at = v_detected_at
      WHERE id = v_session.id AND status = 'ONGOING';
      IF FOUND THEN
        INSERT INTO public.notifications(user_id, type, title, description, priority, link, event_key)
        VALUES (p_user_id, 'Camera Counting', 'Kumpleto na ang bilang',
          format('Kumpleto na ang bilang: %s/%s kambing, %s/%s tupa, at %s/%s kabuuan.',
            v_session.entered_goats, v_session.required_goats,
            v_session.entered_sheep, v_session.required_sheep,
            v_session.entered_total, v_session.required_total),
          'Normal', '/livestock-monitoring', 'camera-count-complete:' || v_session.id::text)
        ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
      END IF;
    END IF;
  ELSIF v_inserted_id IS NOT NULL AND p_direction = 'exit' THEN
    UPDATE public.counting_sessions
    SET exit_event_count = exit_event_count + 1, updated_at = v_detected_at
    WHERE id = v_session.id;
  END IF;

  v_progress := public.get_camera_counting_session_progress(v_session.id);
  RETURN jsonb_build_object(
    'accepted', true,
    'duplicate', v_inserted_id IS NULL,
    'event_id', v_inserted_id,
    'session_id', v_session.id,
    'progress', v_progress
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
  v_now timestamptz := clock_timestamp();
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

  IF v_session.entered_total >= v_session.required_total THEN
    UPDATE public.counting_sessions SET status = 'COMPLETE', completed_at = v_now, ended_at = v_now, updated_at = v_now
      WHERE id = p_session_id;
    INSERT INTO public.notifications(user_id, type, title, description, priority, link, event_key)
    VALUES (p_user_id, 'Camera Counting', 'Kumpleto na ang bilang',
      format('Kumpleto ang kabuuang bilang: %s/%s kambing at tupa.', v_session.entered_total, v_session.required_total),
      'Normal', '/livestock-monitoring', 'camera-count-complete:' || p_session_id::text)
    ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  ELSE
    UPDATE public.counting_sessions SET status = p_status, ended_at = v_now, updated_at = v_now
      WHERE id = p_session_id;
    IF p_status = 'INCOMPLETE' THEN
      INSERT INTO public.notifications(user_id, type, title, description, priority, link, event_key)
      VALUES (p_user_id, 'Camera Counting', 'Hindi pa kumpleto ang bilang',
        format('May kulang pang %s hayop. Nabilang: %s kambing, %s tupa; %s sa %s ang kabuuan.',
          v_session.missing_total, v_session.entered_goats, v_session.entered_sheep,
          v_session.entered_total, v_session.required_total),
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
    LIMIT greatest(1, least(coalesce(p_limit, 30), 1000))
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
BEGIN
  IF p_user_id IS NULL OR p_events IS NULL OR jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 100 THEN
    RAISE EXCEPTION 'Invalid camera counting event batch.' USING errcode = '22023';
  END IF;
  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events)
  LOOP
    v_result := public.record_camera_counting_event(
      p_user_id,
      CASE WHEN v_event->>'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN (v_event->>'session_id')::uuid ELSE NULL END,
      (v_event->>'event_key')::uuid,
      v_event->>'tracking_id',
      v_event->>'animal_type',
      v_event->>'direction',
      (v_event->>'confidence')::numeric,
      (v_event->>'config_revision')::bigint,
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
REVOKE ALL ON FUNCTION public.record_camera_counting_event(uuid, uuid, uuid, text, text, text, numeric, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_camera_counting_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_camera_counting_events(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_camera_counting_session_progress(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_camera_counting_session(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_camera_counting_session_progress(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_camera_counting_event(uuid, uuid, uuid, text, text, text, numeric, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_camera_counting_session(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_camera_counting_events(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_camera_counting_session_progress(uuid, integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'counting_session_events_legacy') THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.counting_session_events_legacy;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'counting_session_events') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.counting_session_events;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
