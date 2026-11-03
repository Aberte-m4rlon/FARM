BEGIN;

CREATE TABLE IF NOT EXISTS public.gate_detection_sightings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.gate_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gate_id uuid NOT NULL REFERENCES public.gate_devices(id) ON DELETE RESTRICT,
  tracking_id text NOT NULL CHECK (tracking_id ~ '^T-[0-9]{3,}$'),
  species_detected text NOT NULL CHECK (species_detected IN ('goat', 'sheep')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  animal_id uuid REFERENCES public.animals(id) ON DELETE SET NULL,
  qr_verified boolean NOT NULL DEFAULT false,
  eartag_verified boolean NOT NULL DEFAULT false,
  eartag_number text CHECK (eartag_number IS NULL OR eartag_number ~ '^[0-9]{1,6}$'),
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, tracking_id),
  FOREIGN KEY (session_id, user_id)
    REFERENCES public.gate_sessions(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (gate_id, user_id)
    REFERENCES public.gate_devices(id, user_id) ON DELETE RESTRICT,
  CHECK (NOT qr_verified OR animal_id IS NOT NULL),
  CHECK (NOT eartag_verified OR animal_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS gate_detection_sightings_session_detected_idx
  ON public.gate_detection_sightings(session_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS gate_detection_sightings_user_detected_idx
  ON public.gate_detection_sightings(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS gate_detection_sightings_animal_idx
  ON public.gate_detection_sightings(animal_id, detected_at DESC)
  WHERE animal_id IS NOT NULL;

ALTER TABLE public.gate_detection_sightings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gate_detection_sightings_select_own ON public.gate_detection_sightings;
CREATE POLICY gate_detection_sightings_select_own
  ON public.gate_detection_sightings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.gate_detection_sightings FROM anon, authenticated;
GRANT SELECT ON public.gate_detection_sightings TO authenticated;

CREATE OR REPLACE FUNCTION public.record_gate_detection_sighting(
  p_session_id uuid,
  p_tracking_id text,
  p_species_detected text,
  p_confidence numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_sighting public.gate_detection_sightings%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;
  IF p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,}$'
     OR p_species_detected IS NULL OR p_species_detected NOT IN ('goat', 'sheep')
     OR p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1 THEN
    RAISE EXCEPTION 'Invalid camera detection.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id AND s.status = 'monitoring';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501';
  END IF;

  INSERT INTO public.gate_detection_sightings (
    session_id, user_id, gate_id, tracking_id, species_detected, confidence
  ) VALUES (
    v_session.id, v_user_id, v_session.gate_id, p_tracking_id, p_species_detected, p_confidence
  )
  ON CONFLICT (session_id, tracking_id) DO UPDATE
    SET confidence = EXCLUDED.confidence,
        last_seen_at = greatest(public.gate_detection_sightings.last_seen_at, now())
    WHERE public.gate_detection_sightings.species_detected = EXCLUDED.species_detected
  RETURNING * INTO v_sighting;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Camera track species changed during the monitoring session.' USING errcode = '22023';
  END IF;

  IF v_sighting.animal_id IS NOT NULL THEN
    UPDATE public.animals
    SET camera_last_seen_at = greatest(coalesce(camera_last_seen_at, v_sighting.last_seen_at), v_sighting.last_seen_at)
    WHERE id = v_sighting.animal_id AND user_id = v_user_id;
  END IF;

  RETURN to_jsonb(v_sighting);
END;
$$;

CREATE OR REPLACE FUNCTION public.link_gate_detection_sighting_qr(
  p_session_id uuid,
  p_tracking_id text,
  p_species_detected text,
  p_confidence numeric,
  p_verification_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_verification public.gate_qr_verifications%rowtype;
  v_animal public.animals%rowtype;
  v_sighting public.gate_detection_sightings%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;
  IF p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,}$'
     OR p_species_detected IS NULL OR p_species_detected NOT IN ('goat', 'sheep')
     OR p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1 THEN
    RAISE EXCEPTION 'Invalid camera detection identity.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_session FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id AND s.status = 'monitoring';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501';
  END IF;

  SELECT * INTO v_verification FROM public.gate_qr_verifications q
  WHERE q.id = p_verification_id AND q.session_id = v_session.id
    AND q.user_id = v_user_id AND q.animal_id IS NOT NULL
    AND q.tracking_id = p_tracking_id
    AND (
      (q.used_at IS NULL AND q.expires_at > now())
      OR EXISTS (
        SELECT 1 FROM public.gate_events e
        WHERE e.session_id = q.session_id AND e.user_id = v_user_id
          AND e.animal_id = q.animal_id AND e.tracking_id = p_tracking_id
          AND e.created_at >= q.qr_verified_at
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR proof is expired, used by another track, or invalid.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_animal FROM public.animals a
  WHERE a.id = v_verification.animal_id AND a.user_id = v_user_id
    AND lower(a.species) = p_species_detected;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified QR animal does not match the detected species.' USING errcode = '22023';
  END IF;

  INSERT INTO public.gate_detection_sightings (
    session_id, user_id, gate_id, tracking_id, species_detected, confidence,
    animal_id, qr_verified
  ) VALUES (
    v_session.id, v_user_id, v_session.gate_id, p_tracking_id, p_species_detected, p_confidence,
    v_animal.id, true
  )
  ON CONFLICT (session_id, tracking_id) DO UPDATE
    SET animal_id = EXCLUDED.animal_id,
        qr_verified = true,
        confidence = EXCLUDED.confidence,
        last_seen_at = greatest(public.gate_detection_sightings.last_seen_at, now())
    WHERE public.gate_detection_sightings.species_detected = EXCLUDED.species_detected
      AND (
        public.gate_detection_sightings.animal_id IS NULL
        OR public.gate_detection_sightings.animal_id = EXCLUDED.animal_id
      )
  RETURNING * INTO v_sighting;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Camera track is already linked to a different animal.' USING errcode = '22023';
  END IF;

  UPDATE public.animals
  SET camera_last_seen_at = greatest(coalesce(camera_last_seen_at, v_sighting.last_seen_at), v_sighting.last_seen_at)
  WHERE id = v_animal.id AND user_id = v_user_id;

  RETURN to_jsonb(v_sighting);
END;
$$;

CREATE OR REPLACE FUNCTION public.link_gate_detection_sighting_eartag(
  p_session_id uuid,
  p_tracking_id text,
  p_species_detected text,
  p_confidence numeric,
  p_eartag_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_animal public.animals%rowtype;
  v_sighting public.gate_detection_sightings%rowtype;
  v_normalized_number text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '28000';
  END IF;
  IF p_tracking_id IS NULL OR p_tracking_id !~ '^T-[0-9]{3,}$'
     OR p_species_detected IS NULL OR p_species_detected NOT IN ('goat', 'sheep')
     OR p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1 THEN
    RAISE EXCEPTION 'Invalid camera detection identity.' USING errcode = '22023';
  END IF;
  IF p_eartag_number IS NULL OR btrim(p_eartag_number) = '' OR p_eartag_number !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'Eartag number must be a numeric value between 1 and 999999.' USING errcode = '22023';
  END IF;

  v_normalized_number := ltrim(p_eartag_number, '0');
  IF v_normalized_number = '' THEN
    v_normalized_number := '0';
  END IF;

  SELECT * INTO v_session FROM public.gate_sessions s
  WHERE s.id = p_session_id AND s.user_id = v_user_id AND s.status = 'monitoring';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active gate session not found.' USING errcode = '42501';
  END IF;

  SELECT * INTO v_animal
  FROM public.animals a
  WHERE a.user_id = v_user_id
    AND coalesce(a.archived, false) = false
    AND coalesce(a.is_sold, false) = false
    AND lower(coalesce(a.status, '')) NOT IN ('sold', 'deceased', 'transferred')
    AND lower(a.species) = p_species_detected
    AND regexp_replace(lower(a.tag_id), '[^0-9]', '', 'g') = v_normalized_number
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Eartag number does not match an active animal in this farm.' USING errcode = '22023';
  END IF;

  INSERT INTO public.gate_detection_sightings (
    session_id, user_id, gate_id, tracking_id, species_detected, confidence,
    animal_id, eartag_verified, eartag_number
  ) VALUES (
    v_session.id, v_user_id, v_session.gate_id, p_tracking_id, p_species_detected, p_confidence,
    v_animal.id, true, p_eartag_number
  )
  ON CONFLICT (session_id, tracking_id) DO UPDATE
    SET animal_id = EXCLUDED.animal_id,
        eartag_verified = true,
        eartag_number = EXCLUDED.eartag_number,
        confidence = EXCLUDED.confidence,
        last_seen_at = greatest(public.gate_detection_sightings.last_seen_at, now())
    WHERE public.gate_detection_sightings.species_detected = EXCLUDED.species_detected
      AND (
        public.gate_detection_sightings.animal_id IS NULL
        OR public.gate_detection_sightings.animal_id = EXCLUDED.animal_id
      )
  RETURNING * INTO v_sighting;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Camera track is already linked to a different animal.' USING errcode = '22023';
  END IF;

  UPDATE public.animals
  SET camera_last_seen_at = greatest(coalesce(camera_last_seen_at, v_sighting.last_seen_at), v_sighting.last_seen_at)
  WHERE id = v_animal.id AND user_id = v_user_id;

  RETURN to_jsonb(v_sighting);
END;
$$;

REVOKE ALL ON FUNCTION public.record_gate_detection_sighting(uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_gate_detection_sighting(uuid, text, text, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.link_gate_detection_sighting_qr(uuid, text, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_gate_detection_sighting_qr(uuid, text, text, numeric, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.link_gate_detection_sighting_eartag(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_gate_detection_sighting_eartag(uuid, text, text, numeric, text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'gate_detection_sightings'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gate_detection_sightings;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
