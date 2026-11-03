-- Bind each gate QR proof to its own live camera track so multiple animals can
-- be identified and recorded concurrently without cross-linking their events.
BEGIN;

ALTER TABLE public.gate_qr_verifications
  ADD COLUMN IF NOT EXISTS tracking_id text,
  ADD COLUMN IF NOT EXISTS gate_id uuid REFERENCES public.gate_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qr_verified_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.animals
  ADD COLUMN IF NOT EXISTS camera_last_seen_gate_id uuid REFERENCES public.gate_devices(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gate_qr_verifications_one_open_proof_per_track_idx
  ON public.gate_qr_verifications(session_id, tracking_id)
  WHERE tracking_id IS NOT NULL AND used_at IS NULL;

CREATE INDEX IF NOT EXISTS gate_qr_verifications_session_track_idx
  ON public.gate_qr_verifications(session_id, tracking_id, created_at DESC)
  WHERE tracking_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.verify_gate_qr(
  p_session_id uuid,
  p_qr_payload text,
  p_tracking_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_payload jsonb;
  v_reference text;
  v_animal public.animals%rowtype;
  v_verification public.gate_qr_verifications%rowtype;
  v_tracking_id text := nullif(trim(p_tracking_id), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;
  IF p_qr_payload IS NULL OR length(trim(p_qr_payload)) = 0 OR length(p_qr_payload) > 2048 THEN
    RETURN jsonb_build_object('verified', false, 'message', 'QR content is empty or invalid.');
  END IF;
  IF v_tracking_id IS NOT NULL AND (length(v_tracking_id) > 128 OR v_tracking_id !~ '^T-[0-9]{3,}$') THEN
    RETURN jsonb_build_object('verified', false, 'message', 'Camera track reference is invalid.');
  END IF;

  SELECT * INTO v_session FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id AND s.status = 'monitoring';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501';
  END IF;
  IF now() > v_session.started_at + make_interval(mins => v_session.reconciliation_window_minutes) THEN
    RAISE EXCEPTION 'Reconciliation window has ended. Start a new session for another gate check.'
      USING errcode = '22023';
  END IF;

  -- Concurrent decodes of the same tag/track must reuse one open proof.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_session.id::text || ':' || coalesce(v_tracking_id, ''), 0));

  IF left(trim(p_qr_payload), 1) = '{' THEN
    BEGIN
      v_payload := trim(p_qr_payload)::jsonb;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('verified', false, 'message', 'QR content is not valid AlpasFarm data.');
    END;
    IF coalesce(v_payload->>'type', '') <> 'alpasfarm_animal'
       OR coalesce(v_payload->>'farmId', '') <> v_user_id::text
       OR coalesce(v_payload->>'animalId', '') = '' THEN
      RETURN jsonb_build_object('verified', false, 'message', 'QR does not belong to this farm.');
    END IF;
    v_reference := v_payload->>'animalId';
  ELSE
    SELECT (regexp_match(trim(p_qr_payload), '/(animals|public)/([^/?#]+)', 'i'))[2]
      INTO v_reference;
    IF v_reference IS NULL OR v_reference = '' THEN
      v_reference := trim(p_qr_payload);
    END IF;
  END IF;

  SELECT a.* INTO v_animal FROM public.animals a
  WHERE a.user_id = v_user_id
    AND coalesce(a.archived, false) = false
    AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND a.id = ANY(v_session.expected_animal_ids)
    AND (a.id::text = v_reference OR lower(a.tag_id) = lower(v_reference))
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('verified', false, 'message', 'Animal is not an active registered member of this session.');
  END IF;

  IF v_tracking_id IS NOT NULL THEN
    DELETE FROM public.gate_qr_verifications q
    WHERE q.session_id = v_session.id AND q.user_id = v_user_id
      AND q.tracking_id = v_tracking_id AND q.used_at IS NULL AND q.expires_at <= now();

    SELECT * INTO v_verification FROM public.gate_qr_verifications q
    WHERE q.session_id = v_session.id AND q.user_id = v_user_id
      AND q.tracking_id = v_tracking_id AND q.used_at IS NULL AND q.expires_at > now()
    FOR UPDATE;
    IF FOUND THEN
      IF v_verification.animal_id <> v_animal.id THEN
        RETURN jsonb_build_object('verified', false, 'message', 'May ibang nakabukas na QR proof para sa camera track na ito.');
      END IF;
      UPDATE public.gate_qr_verifications q
      SET expires_at = now() + interval '2 minutes', qr_verified_at = now(), gate_id = v_session.gate_id
      WHERE q.id = v_verification.id;
      UPDATE public.animals a
      SET camera_last_seen_at = now(), camera_last_qr_at = now(), camera_last_seen_gate_id = v_session.gate_id
      WHERE a.id = v_animal.id AND a.user_id = v_user_id;
      RETURN jsonb_build_object(
        'verified', true, 'verification_id', v_verification.id,
        'animal_id', v_animal.id, 'farm_id', v_animal.user_id,
        'name', v_animal.name, 'tag_id', v_animal.tag_id,
        'species', lower(v_animal.species), 'breed', v_animal.breed,
        'photo_url', v_animal.photo_url, 'tracking_id', v_tracking_id
      );
    END IF;
  END IF;

  INSERT INTO public.gate_qr_verifications (
    user_id, session_id, animal_id, tracking_id, gate_id, qr_verified_at
  ) VALUES (
    v_user_id, v_session.id, v_animal.id, v_tracking_id, v_session.gate_id, now()
  ) RETURNING * INTO v_verification;

  UPDATE public.animals a
  SET camera_last_seen_at = v_verification.qr_verified_at,
      camera_last_qr_at = v_verification.qr_verified_at,
      camera_last_seen_gate_id = v_session.gate_id
  WHERE a.id = v_animal.id AND a.user_id = v_user_id;

  RETURN jsonb_build_object(
    'verified', true, 'verification_id', v_verification.id,
    'animal_id', v_animal.id, 'farm_id', v_animal.user_id,
    'name', v_animal.name, 'tag_id', v_animal.tag_id,
    'species', lower(v_animal.species), 'breed', v_animal.breed,
    'photo_url', v_animal.photo_url, 'tracking_id', v_tracking_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_gate_movement(
  p_session_id uuid,
  p_verification_id uuid,
  p_direction text,
  p_species_detected text,
  p_confidence numeric,
  p_tracking_id text,
  p_movement_observation text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_event public.gate_events%rowtype;
  v_animal public.animals%rowtype;
  v_verification_tracking_id text;
BEGIN
  IF p_movement_observation NOT IN ('normal', 'slow_approach', 'prolonged_stop') THEN
    RAISE EXCEPTION 'Unsupported camera movement observation.' USING errcode = '22023';
  END IF;
  IF p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,}$' THEN
    RAISE EXCEPTION 'Camera tracking reference is invalid.' USING errcode = '22023';
  END IF;

  SELECT q.tracking_id INTO v_verification_tracking_id
  FROM public.gate_qr_verifications q
  WHERE q.id = p_verification_id AND q.session_id = p_session_id AND q.user_id = auth.uid()
    AND q.used_at IS NULL AND q.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR verification expired or already used. Scan the QR again.' USING errcode = '22023';
  END IF;
  IF v_verification_tracking_id IS NOT NULL AND v_verification_tracking_id <> p_tracking_id THEN
    RAISE EXCEPTION 'QR proof is bound to a different camera track.' USING errcode = '22023';
  END IF;

  v_result := public.record_gate_movement(
    p_session_id, p_verification_id, p_direction, p_species_detected, p_confidence, p_tracking_id
  );
  IF coalesce((v_result->>'success')::boolean, false)
     AND NOT coalesce((v_result->>'duplicate')::boolean, false) THEN
    SELECT * INTO v_event FROM public.gate_events e
    WHERE e.id = (v_result->>'event_id')::uuid AND e.user_id = auth.uid();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Saved camera event could not be verified.' USING errcode = '42501';
    END IF;

    UPDATE public.gate_events SET movement_observation = p_movement_observation WHERE id = v_event.id AND user_id = auth.uid();
    UPDATE public.gate_camera_crossings crossing
    SET animal_id = v_event.animal_id, event_id = v_event.id, qr_verified = true
    WHERE crossing.id = (
      SELECT candidate.id FROM public.gate_camera_crossings candidate
      WHERE candidate.session_id = v_event.session_id AND candidate.user_id = auth.uid()
        AND candidate.tracking_id = v_event.tracking_id AND candidate.direction = v_event.direction
        AND NOT candidate.qr_verified
        AND candidate.created_at BETWEEN v_event.created_at - interval '20 seconds' AND v_event.created_at
      ORDER BY abs(extract(epoch FROM (v_event.created_at - candidate.created_at)))
      LIMIT 1
    );

    UPDATE public.animals
    SET camera_last_seen_at = v_event.created_at,
        camera_last_qr_at = v_event.created_at,
        camera_last_seen_gate_id = v_event.gate_id
    WHERE id = v_event.animal_id AND user_id = auth.uid()
    RETURNING * INTO v_animal;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Animal no longer belongs to this farm.' USING errcode = '42501';
    END IF;

    IF v_event.direction = 'entry' THEN
      UPDATE public.gate_alerts
      SET status = 'resolved', resolved_at = now()
      WHERE animal_id = v_event.animal_id AND user_id = auth.uid()
        AND alert_type = 'unaccounted' AND status <> 'resolved';

      IF p_movement_observation IN ('slow_approach', 'prolonged_stop') THEN
        INSERT INTO public.gate_alerts (session_id, user_id, animal_id, alert_type, message)
        VALUES (
          v_event.session_id, auth.uid(), v_event.animal_id, 'movement_observation',
          'May napansing mabagal o matagal na paghinto habang pumapasok. Tingnan ang hayop pagkapasok nito.'
        )
        ON CONFLICT (session_id, animal_id, alert_type) DO UPDATE
          SET status = 'active', message = excluded.message, resolved_at = NULL, created_at = now();
      END IF;
    END IF;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_gate_movement_alert(
  p_session_id uuid,
  p_verification_id uuid,
  p_tracking_id text,
  p_species_detected text,
  p_observation text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_animal public.animals%rowtype;
  v_alert_id uuid;
  v_verification_tracking_id text;
  v_observation_label text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;
  IF p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,}$'
     OR p_species_detected NOT IN ('goat', 'sheep')
     OR p_observation NOT IN ('repeated_stop_start', 'repeated_direction_change') THEN
    RAISE EXCEPTION 'Invalid camera movement observation.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_session FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id AND s.status = 'monitoring';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501';
  END IF;
  IF now() > v_session.started_at + make_interval(mins => v_session.reconciliation_window_minutes) THEN
    RAISE EXCEPTION 'The camera monitoring window has ended.' USING errcode = '22023';
  END IF;

  SELECT q.tracking_id INTO v_verification_tracking_id
  FROM public.gate_qr_verifications q
  WHERE q.id = p_verification_id AND q.session_id = v_session.id AND q.user_id = v_user_id
    AND q.used_at IS NULL AND q.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR verification expired or does not match the live animal.' USING errcode = '22023';
  END IF;
  SELECT a.* INTO v_animal
  FROM public.gate_qr_verifications q
  JOIN public.animals a ON a.id = q.animal_id AND a.user_id = q.user_id
  WHERE q.id = p_verification_id AND q.session_id = v_session.id AND q.user_id = v_user_id
    AND q.used_at IS NULL AND q.expires_at > now()
    AND q.animal_id = ANY(v_session.expected_animal_ids)
    AND coalesce(a.archived, false) = false AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND lower(a.species) = p_species_detected
  FOR UPDATE OF q;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR verification expired or does not match the live animal.' USING errcode = '22023';
  END IF;
  IF v_verification_tracking_id IS NOT NULL AND v_verification_tracking_id <> p_tracking_id THEN
    RAISE EXCEPTION 'QR proof is bound to a different camera track.' USING errcode = '22023';
  END IF;

  v_observation_label := CASE p_observation
    WHEN 'repeated_stop_start' THEN 'paulit-ulit na paghinto at muling paggalaw'
    ELSE 'paulit-ulit na pagbabago ng direksyon'
  END;
  INSERT INTO public.gate_alerts (session_id, user_id, animal_id, alert_type, message)
  VALUES (
    v_session.id, v_user_id, v_animal.id, 'movement_observation',
    'Paunang camera screening para kay ' || v_animal.name || ' (' || v_animal.tag_id ||
      '): napansin ang ' || v_observation_label || '. Suriin muna nang personal; hindi ito diagnosis.'
  )
  ON CONFLICT (session_id, animal_id, alert_type) DO UPDATE
    SET status = 'active', message = excluded.message, resolved_at = NULL, created_at = now()
  RETURNING id INTO v_alert_id;

  RETURN jsonb_build_object('success', true, 'alert_id', v_alert_id, 'animal_id', v_animal.id, 'observation', p_observation);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_gate_qr(uuid, text) FROM public;
DROP FUNCTION IF EXISTS public.verify_gate_qr(uuid, text);
REVOKE ALL ON FUNCTION public.verify_gate_qr(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_gate_qr(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_gate_movement(uuid, uuid, text, text, numeric, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_gate_movement(uuid, uuid, text, text, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_gate_movement_alert(uuid, uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_gate_movement_alert(uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_gate_qr_verification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_name text;
  v_animal_name text;
BEGIN
  SELECT p.full_name INTO v_actor_name FROM public.profiles p WHERE p.id = auth.uid();
  SELECT coalesce(nullif(a.name, '') || ' (' || nullif(a.tag_id, '') || ')', a.tag_id, a.name)
    INTO v_animal_name FROM public.animals a
    WHERE a.id = NEW.animal_id AND a.user_id = NEW.user_id;
  INSERT INTO public.activity_logs (
    actor_id, actor_name, farm_user_id, session_id, module, action,
    entity_id, entity_name, status, details, animal_id
  ) VALUES (
    auth.uid(), coalesce(v_actor_name, 'System / User'), NEW.user_id, NEW.session_id::text,
    'Camera', 'QR eartag verified', NEW.id::text, v_animal_name, 'success',
    jsonb_build_object('table', 'gate_qr_verifications', 'operation', 'verified',
      'gate_id', NEW.gate_id, 'tracking_id', NEW.tracking_id),
    NEW.animal_id
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_gate_qr_verification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS gate_qr_verification_activity ON public.gate_qr_verifications;
CREATE TRIGGER gate_qr_verification_activity
  AFTER INSERT ON public.gate_qr_verifications
  FOR EACH ROW EXECUTE FUNCTION public.log_gate_qr_verification();

NOTIFY pgrst, 'reload schema';
COMMIT;
