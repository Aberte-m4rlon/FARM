BEGIN;

CREATE INDEX IF NOT EXISTS gate_camera_crossings_user_created_idx
  ON public.gate_camera_crossings (user_id, created_at DESC);

-- Count every confirmed camera crossing, even when an eartag/QR identity is
-- unavailable. Keep the species totals in the authenticated DB summary so the
-- UI does not depend on a truncated local crossing list.
CREATE OR REPLACE FUNCTION public.get_gate_camera_metrics(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_crossings integer;
  v_identified integer;
  v_entry integer;
  v_entry_goats integer;
  v_entry_sheep integer;
  v_exit integer;
  v_verified_entry integer;
  v_verified_exit integer;
  v_live integer;
  v_live_goats integer;
  v_live_sheep integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;

  SELECT * INTO v_session
  FROM public.gate_sessions AS s
  WHERE s.id = p_session_id AND s.user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate session not found.' USING errcode = '42501';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE c.qr_verified OR c.eartag_verified),
         count(*) FILTER (WHERE c.direction = 'entry'),
         count(*) FILTER (WHERE c.direction = 'entry' AND c.species_detected = 'goat'),
         count(*) FILTER (WHERE c.direction = 'entry' AND c.species_detected = 'sheep'),
         count(*) FILTER (WHERE c.direction = 'exit')
  INTO v_crossings, v_identified, v_entry, v_entry_goats, v_entry_sheep, v_exit
  FROM public.gate_camera_crossings AS c
  WHERE c.session_id = v_session.id AND c.user_id = v_user_id;

  SELECT count(*) FILTER (WHERE e.direction = 'entry'),
         count(*) FILTER (WHERE e.direction = 'exit')
  INTO v_verified_entry, v_verified_exit
  FROM public.gate_events AS e
  WHERE e.session_id = v_session.id AND e.user_id = v_user_id
    AND (e.qr_verified OR e.eartag_verified);

  SELECT count(*),
         count(*) FILTER (WHERE live.species_detected = 'goat'),
         count(*) FILTER (WHERE live.species_detected = 'sheep')
  INTO v_live, v_live_goats, v_live_sheep
  FROM public.gate_live_tracks AS live
  WHERE live.session_id = v_session.id AND live.user_id = v_user_id
    AND live.last_seen_at >= now() - interval '10 seconds';

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'crossing_count', v_crossings,
    'identified_crossing_count', v_identified,
    'unidentified_crossing_count', v_crossings - v_identified,
    'camera_entry_count', v_entry,
    'entry_goat_count', v_entry_goats,
    'entry_sheep_count', v_entry_sheep,
    'camera_exit_count', v_exit,
    'verified_entry_count', v_verified_entry,
    'verified_exit_count', v_verified_exit,
    'live_track_count', v_live,
    'live_goat_count', v_live_goats,
    'live_sheep_count', v_live_sheep
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_gate_camera_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gate_camera_metrics(uuid) TO authenticated;

-- Provide accurate farm-day counts for the dashboard and AI Farm Assistant,
-- including unidentified animals. Date boundaries follow Philippine time.
CREATE OR REPLACE FUNCTION public.get_gate_camera_daily_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_goat_entries integer;
  v_sheep_entries integer;
  v_goat_exits integer;
  v_sheep_exits integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;

  SELECT count(*) FILTER (WHERE c.direction = 'entry' AND c.species_detected = 'goat'),
         count(*) FILTER (WHERE c.direction = 'entry' AND c.species_detected = 'sheep'),
         count(*) FILTER (WHERE c.direction = 'exit' AND c.species_detected = 'goat'),
         count(*) FILTER (WHERE c.direction = 'exit' AND c.species_detected = 'sheep')
  INTO v_goat_entries, v_sheep_entries, v_goat_exits, v_sheep_exits
  FROM public.gate_camera_crossings AS c
  WHERE c.user_id = v_user_id
    AND c.created_at >= (v_today::timestamp AT TIME ZONE 'Asia/Manila')
    AND c.created_at < ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Manila');

  RETURN jsonb_build_object(
    'day', v_today,
    'goat_entry_count', v_goat_entries,
    'sheep_entry_count', v_sheep_entries,
    'total_entry_count', v_goat_entries + v_sheep_entries,
    'goat_exit_count', v_goat_exits,
    'sheep_exit_count', v_sheep_exits,
    'total_exit_count', v_goat_exits + v_sheep_exits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_gate_camera_daily_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gate_camera_daily_metrics() TO authenticated;

-- Return exact successful-birth counts per mother without fetching a limited
-- page of events into the browser. Only the authenticated owner's farm data is
-- included; failed births and pregnancies are excluded.
CREATE OR REPLACE FUNCTION public.get_farm_birth_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_birth_counts jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'mother_id', counts.mother_id,
      'birth_count', counts.birth_count,
      'last_birth_date', counts.last_birth_date
    )),
    '[]'::jsonb
  )
  INTO v_birth_counts
  FROM (
    SELECT event.mother_id,
           count(*)::integer AS birth_count,
           max(event.actual_birth_date) AS last_birth_date
    FROM public.breeding_birth_events AS event
    WHERE event.user_id = v_user_id
      AND event.outcome = 'successful'
      AND event.actual_birth_date IS NOT NULL
    GROUP BY event.mother_id
  ) AS counts;

  RETURN v_birth_counts;
END;
$$;

REVOKE ALL ON FUNCTION public.get_farm_birth_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_farm_birth_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
