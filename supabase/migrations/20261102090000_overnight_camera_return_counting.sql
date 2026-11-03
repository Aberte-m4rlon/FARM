BEGIN;

-- Keep all previous CCTV counts intact. Only sessions created by the new
-- overnight workflow use the revised lifecycle.
ALTER TABLE public.counting_sessions
  ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS period_hours smallint,
  ADD COLUMN IF NOT EXISTS period_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS camera_incomplete boolean NOT NULL DEFAULT false;

ALTER TABLE public.counting_sessions
  DROP CONSTRAINT IF EXISTS counting_sessions_status_check,
  DROP CONSTRAINT IF EXISTS counting_sessions_check,
  DROP CONSTRAINT IF EXISTS counting_sessions_session_type_check,
  DROP CONSTRAINT IF EXISTS counting_sessions_period_hours_check;

ALTER TABLE public.counting_sessions
  ADD CONSTRAINT counting_sessions_status_check
    CHECK (status IN ('ONGOING', 'COMPLETE', 'MISSING', 'CANCELLED', 'INCOMPLETE')),
  ADD CONSTRAINT counting_sessions_check CHECK (
    (status = 'ONGOING' AND ended_at IS NULL AND completed_at IS NULL)
    OR (status = 'COMPLETE' AND completed_at IS NOT NULL AND ended_at IS NOT NULL)
    OR (status IN ('MISSING', 'INCOMPLETE', 'CANCELLED') AND ended_at IS NOT NULL AND completed_at IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT counting_sessions_session_type_check
    CHECK (session_type IN ('LEGACY', 'OVERNIGHT_RETURN')),
  ADD CONSTRAINT counting_sessions_period_hours_check
    CHECK (period_hours IS NULL OR period_hours BETWEEN 1 AND 24);

DROP INDEX IF EXISTS public.counting_sessions_one_ongoing_per_camera;
CREATE UNIQUE INDEX counting_sessions_one_ongoing_per_camera
  ON public.counting_sessions(user_id, camera_id)
  WHERE status = 'ONGOING' AND session_type = 'OVERNIGHT_RETURN';

CREATE TABLE IF NOT EXISTS public.counting_session_camera_outages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.counting_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS counting_session_camera_outages_session_time_idx
  ON public.counting_session_camera_outages(session_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS counting_session_camera_outages_one_open_idx
  ON public.counting_session_camera_outages(session_id) WHERE ended_at IS NULL;

ALTER TABLE public.counting_session_camera_outages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS counting_session_camera_outages_select_own ON public.counting_session_camera_outages;
CREATE POLICY counting_session_camera_outages_select_own
  ON public.counting_session_camera_outages
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.counting_session_camera_outages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.counting_session_camera_outages TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.start_camera_counting_session(uuid, text);
CREATE FUNCTION public.start_camera_counting_session(
  p_user_id uuid,
  p_camera_id text DEFAULT 'C320WS-01',
  p_period_hours integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.counting_sessions%rowtype;
  v_goats integer;
  v_sheep integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR p_camera_id IS NULL OR length(p_camera_id) NOT BETWEEN 1 AND 128
     OR p_period_hours IS NULL OR p_period_hours NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'Invalid overnight counting request.' USING errcode = '22023';
  END IF;

  PERFORM public.finalize_overdue_camera_counting_sessions(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_camera_id));
  SELECT * INTO v_session FROM public.counting_sessions
    WHERE user_id = p_user_id AND camera_id = p_camera_id
      AND session_type = 'OVERNIGHT_RETURN' AND status = 'ONGOING'
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
    AND lower(coalesce(a.status, '')) NOT IN ('archived', 'sold', 'deceased', 'transferred')
    AND lower(a.species) IN ('goat', 'sheep');

  IF coalesce(v_goats, 0) + coalesce(v_sheep, 0) = 0 THEN
    RAISE EXCEPTION 'No active goats or sheep are registered.' USING errcode = '22023';
  END IF;

  INSERT INTO public.counting_sessions(
    user_id, camera_id, session_type, period_hours, period_ends_at,
    required_goats, required_sheep, entered_goats, entered_sheep,
    entered_total, missing_goats, missing_sheep, missing_total, started_at
  ) VALUES (
    p_user_id, p_camera_id, 'OVERNIGHT_RETURN', p_period_hours,
    v_now + make_interval(hours => p_period_hours),
    v_goats, v_sheep, 0, 0, 0, v_goats, v_sheep, v_goats + v_sheep, v_now
  ) RETURNING * INTO v_session;

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
    'session_type', v_session.session_type, 'status', v_session.status,
    'started_at', v_session.started_at, 'period_hours', v_session.period_hours,
    'period_ends_at', v_session.period_ends_at,
    'completed_at', v_session.completed_at, 'ended_at', v_session.ended_at,
    'required_goats', v_session.required_goats, 'required_sheep', v_session.required_sheep,
    'required_total', v_session.required_total,
    'entered_goats', v_session.entered_goats, 'entered_sheep', v_session.entered_sheep,
    'entered_total', v_session.entered_total,
    'missing_goats', v_session.missing_goats, 'missing_sheep', v_session.missing_sheep,
    'missing_total', v_session.missing_total,
    'entry_event_count', v_session.entered_total, 'exit_event_count', v_session.exit_event_count,
    'camera_incomplete', v_session.camera_incomplete
  );
END;
$$;

DROP FUNCTION IF EXISTS public.finalize_overdue_camera_counting_sessions();
CREATE FUNCTION public.finalize_overdue_camera_counting_sessions(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.counting_sessions%rowtype;
  v_status text;
  v_count integer := 0;
  v_outage_text text;
  v_has_outage boolean;
BEGIN
  FOR v_session IN
    SELECT * FROM public.counting_sessions
    WHERE session_type = 'OVERNIGHT_RETURN' AND status = 'ONGOING'
      AND period_ends_at IS NOT NULL AND period_ends_at <= clock_timestamp()
      AND (p_user_id IS NULL OR user_id = p_user_id)
    ORDER BY period_ends_at
    FOR UPDATE
  LOOP
    UPDATE public.counting_session_camera_outages
    SET ended_at = v_session.period_ends_at
    WHERE session_id = v_session.id AND ended_at IS NULL;

    SELECT EXISTS (
      SELECT 1 FROM public.counting_session_camera_outages outage
      WHERE outage.session_id = v_session.id
        AND outage.started_at < v_session.period_ends_at
        AND coalesce(outage.ended_at, v_session.period_ends_at) > outage.started_at
    ) INTO v_has_outage;

    v_status := CASE WHEN v_session.missing_total = 0 THEN 'COMPLETE' ELSE 'MISSING' END;
    UPDATE public.counting_sessions
    SET status = v_status,
        camera_incomplete = v_has_outage,
        ended_at = v_session.period_ends_at,
        completed_at = CASE WHEN v_status = 'COMPLETE' THEN v_session.period_ends_at ELSE NULL END,
        updated_at = clock_timestamp()
    WHERE id = v_session.id AND status = 'ONGOING';

    IF FOUND THEN
      IF v_status = 'MISSING' THEN
        v_outage_text := CASE WHEN v_has_outage
          THEN ' May camera interruption kaya maaaring hindi kumpleto ang bilang; beripikahin muna ang mga hayop sa kulungan.'
          ELSE '' END;
        INSERT INTO public.notifications(
          user_id, type, title, description, message, priority, severity,
          link, related_type, related_id, event_key, read, is_read
        ) VALUES (
          v_session.user_id, 'Camera Counting',
          CASE WHEN v_has_outage THEN 'Bilang na kailangang beripikahin' ELSE 'May kulang sa bilang ngayong gabi' END,
          format('May %s kambing at %s tupa na hindi naitala na nakabalik sa kulungan ngayong gabi.%s',
            v_session.missing_goats, v_session.missing_sheep, v_outage_text),
          format('Expected: %s. Naitala ang pagbalik ng %s kambing at %s tupa.%s',
            v_session.required_total, v_session.entered_goats, v_session.entered_sheep, v_outage_text),
          'Warning', 'warning', '/livestock-monitoring', 'camera_counting',
          v_session.id::text, 'camera-count-missing:' || v_session.id::text, false, false
        ) ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
      ELSE
        INSERT INTO public.notifications(
          user_id, type, title, description, message, priority, severity,
          link, related_type, related_id, event_key, read, is_read
        ) VALUES (
          v_session.user_id, 'Camera Counting',
          CASE WHEN v_has_outage THEN 'Bilang natapos; may camera interruption' ELSE 'Kumpleto ang bilang ngayong gabi' END,
          CASE WHEN v_has_outage
            THEN 'Naabot ang expected count, pero may camera interruption. Maaaring hindi kumpleto ang tala.'
            ELSE 'Kumpleto ang bilang ng mga kambing at tupa na naitala na nakabalik sa kulungan.' END,
          format('Expected: %s. Naitala ang pagbalik ng %s kambing at %s tupa.',
            v_session.required_total, v_session.entered_goats, v_session.entered_sheep),
          CASE WHEN v_has_outage THEN 'Warning' ELSE 'Normal' END,
          CASE WHEN v_has_outage THEN 'warning' ELSE 'normal' END,
          '/livestock-monitoring', 'camera_counting', v_session.id::text,
          'camera-count-complete:' || v_session.id::text, false, false
        ) ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
      END IF;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_camera_gateway_offline(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session record;
  v_seen_at timestamptz;
  v_started_at timestamptz;
  v_count integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  FOR v_session IN
    SELECT session.id, session.user_id, session.started_at, session.period_ends_at
    FROM public.counting_sessions session
    WHERE session.session_type = 'OVERNIGHT_RETURN' AND session.status = 'ONGOING'
      AND (p_user_id IS NULL OR session.user_id = p_user_id)
  LOOP
    SELECT settings.gateway_seen_at INTO v_seen_at
    FROM public.camera_gate_settings settings WHERE settings.user_id = v_session.user_id;

    IF v_now - coalesce(v_seen_at, v_session.started_at) < interval '60 seconds' THEN
      CONTINUE;
    END IF;

    v_started_at := greatest(
      v_session.started_at,
      coalesce(v_seen_at + interval '60 seconds', v_session.started_at)
    );
    IF v_session.period_ends_at IS NOT NULL THEN
      v_started_at := least(v_started_at, v_session.period_ends_at);
    END IF;

    INSERT INTO public.counting_session_camera_outages(session_id, user_id, started_at)
    VALUES (v_session.id, v_session.user_id, v_started_at)
    ON CONFLICT (session_id) WHERE ended_at IS NULL DO NOTHING;
    IF FOUND THEN
      UPDATE public.counting_sessions SET camera_incomplete = true, updated_at = v_now
      WHERE id = v_session.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_camera_gateway_heartbeat(p_user_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous timestamptz;
  v_now timestamptz := clock_timestamp();
  v_session record;
  v_open_outage uuid;
  v_outage_started timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Camera owner is required.' USING errcode = '22023';
  END IF;
  SELECT gateway_seen_at INTO v_previous
  FROM public.camera_gate_settings WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.camera_gate_settings(user_id, gateway_seen_at)
    VALUES (p_user_id, v_now)
    ON CONFLICT (user_id) DO UPDATE SET gateway_seen_at = EXCLUDED.gateway_seen_at;
  ELSE
    UPDATE public.camera_gate_settings SET gateway_seen_at = v_now WHERE user_id = p_user_id;
  END IF;

  SELECT id, started_at, period_ends_at INTO v_session
  FROM public.counting_sessions
  WHERE user_id = p_user_id AND camera_id = 'C320WS-01'
    AND session_type = 'OVERNIGHT_RETURN' AND status = 'ONGOING'
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    SELECT id INTO v_open_outage FROM public.counting_session_camera_outages
    WHERE session_id = v_session.id AND ended_at IS NULL
    ORDER BY started_at DESC LIMIT 1 FOR UPDATE;

    IF v_open_outage IS NOT NULL THEN
      UPDATE public.counting_session_camera_outages
      SET ended_at = least(v_now, coalesce(v_session.period_ends_at, v_now))
      WHERE id = v_open_outage;
      UPDATE public.counting_sessions SET camera_incomplete = true, updated_at = v_now
      WHERE id = v_session.id;
    ELSIF v_previous IS NOT NULL AND v_now - v_previous >= interval '60 seconds' THEN
      v_outage_started := greatest(v_session.started_at, v_previous + interval '60 seconds');
      IF v_session.period_ends_at IS NULL OR v_outage_started < v_session.period_ends_at THEN
        INSERT INTO public.counting_session_camera_outages(session_id, user_id, started_at, ended_at)
        VALUES (
          v_session.id, p_user_id, v_outage_started,
          least(v_now, coalesce(v_session.period_ends_at, v_now))
        );
        UPDATE public.counting_sessions SET camera_incomplete = true, updated_at = v_now
        WHERE id = v_session.id;
      END IF;
    END IF;
  END IF;
  RETURN v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_overnight_camera_counting_sessions()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_outages integer;
  v_finalized integer;
BEGIN
  v_outages := public.mark_camera_gateway_offline(NULL);
  v_finalized := public.finalize_overdue_camera_counting_sessions(NULL);
  RETURN jsonb_build_object('outages_opened', v_outages, 'sessions_finalized', v_finalized);
END;
$$;

DROP FUNCTION IF EXISTS public.record_camera_counting_events(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.record_camera_counting_event(uuid, uuid, uuid, text, text, text, numeric, bigint, text);
CREATE FUNCTION public.record_camera_counting_event(
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

  PERFORM public.finalize_overdue_camera_counting_sessions(p_user_id);
  SELECT * INTO v_session FROM public.counting_sessions
  WHERE id = p_session_id AND user_id = p_user_id AND camera_id = p_camera_id
    AND session_type = 'OVERNIGHT_RETURN' AND status = 'ONGOING'
  FOR UPDATE;
  IF NOT FOUND OR v_session.period_ends_at IS NULL THEN
    RETURN jsonb_build_object('accepted', true, 'reason', 'no_active_session');
  END IF;

  v_detected_at := clock_timestamp();
  IF v_detected_at >= v_session.period_ends_at THEN
    RETURN jsonb_build_object('accepted', true, 'reason', 'counting_period_ended');
  END IF;

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
  ELSIF v_inserted_id IS NOT NULL AND p_direction = 'exit' THEN
    UPDATE public.counting_sessions
    SET exit_event_count = exit_event_count + 1, updated_at = v_detected_at
    WHERE id = v_session.id;
  END IF;

  RETURN jsonb_build_object(
    'accepted', true, 'duplicate', v_inserted_id IS NULL, 'event_id', v_inserted_id,
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
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'An overnight count can only be cancelled before its end time.' USING errcode = '22023';
  END IF;
  PERFORM public.finalize_overdue_camera_counting_sessions(p_user_id);
  SELECT * INTO v_session FROM public.counting_sessions
  WHERE id = p_session_id AND user_id = p_user_id
    AND session_type = 'OVERNIGHT_RETURN'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Counting session not found.' USING errcode = 'P0002'; END IF;
  IF v_session.status = 'ONGOING' THEN
    UPDATE public.counting_session_camera_outages
    SET ended_at = v_now WHERE session_id = p_session_id AND ended_at IS NULL;
    UPDATE public.counting_sessions
    SET status = 'CANCELLED', ended_at = v_now, completed_at = NULL, updated_at = v_now
    WHERE id = p_session_id AND status = 'ONGOING';
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
    WHERE user_id = p_user_id AND session_type = 'OVERNIGHT_RETURN'
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

REVOKE ALL ON FUNCTION public.start_camera_counting_session(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_overdue_camera_counting_sessions(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_camera_gateway_offline(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_camera_gateway_heartbeat(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_overnight_camera_counting_sessions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_camera_counting_session_progress(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_camera_counting_event(uuid, uuid, uuid, text, text, text, numeric, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_camera_counting_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_camera_counting_events(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_camera_counting_session_progress(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_camera_counting_session(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_overdue_camera_counting_sessions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_camera_gateway_offline(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_camera_gateway_heartbeat(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_overnight_camera_counting_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_camera_counting_session_progress(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_camera_counting_event(uuid, uuid, uuid, text, text, text, numeric, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_camera_counting_session(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_camera_counting_events(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_camera_counting_session_progress(uuid, integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename = 'counting_session_camera_outages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.counting_session_camera_outages;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
