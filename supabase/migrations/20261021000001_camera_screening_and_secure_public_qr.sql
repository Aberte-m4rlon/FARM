BEGIN;

-- Private phone-camera screening results are stored beside the existing health
-- records. The photo is not stored in the ALPASFARM database.
ALTER TABLE public.camera_health_screenings
  ADD COLUMN IF NOT EXISTS detected_species text,
  ADD COLUMN IF NOT EXISTS visible_status text,
  ADD COLUMN IF NOT EXISTS observed_concern text,
  ADD COLUMN IF NOT EXISTS affected_area text,
  ADD COLUMN IF NOT EXISTS screening_source text NOT NULL DEFAULT 'phone_camera';

ALTER TABLE public.camera_health_screenings
  DROP CONSTRAINT IF EXISTS camera_health_screenings_visible_status_check;
ALTER TABLE public.camera_health_screenings
  ADD CONSTRAINT camera_health_screenings_visible_status_check
  CHECK (visible_status IS NULL OR visible_status IN ('healthy', 'watch', 'attention'));

DROP POLICY IF EXISTS "select_own_screenings" ON public.camera_health_screenings;
CREATE POLICY "select_own_screenings" ON public.camera_health_screenings
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.animals a
      WHERE a.id = camera_health_screenings.animal_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_screenings" ON public.camera_health_screenings;
CREATE POLICY "insert_own_screenings" ON public.camera_health_screenings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.animals a
      WHERE a.id = camera_health_screenings.animal_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_own_screenings" ON public.camera_health_screenings;
CREATE POLICY "update_own_screenings" ON public.camera_health_screenings
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.animals a
      WHERE a.id = camera_health_screenings.animal_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.animals a
      WHERE a.id = camera_health_screenings.animal_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_own_screenings" ON public.camera_health_screenings;
CREATE POLICY "delete_own_screenings" ON public.camera_health_screenings
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.animals a
      WHERE a.id = camera_health_screenings.animal_id
        AND a.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_camera_screenings_animal_created
  ON public.camera_health_screenings (animal_id, created_at DESC);

-- QR links use a random token, never an internal animal UUID or the visible tag.
ALTER TABLE public.animals
  ADD COLUMN IF NOT EXISTS public_qr_token uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS public_profile_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_show_birth_date boolean NOT NULL DEFAULT false;

UPDATE public.animals
SET public_qr_token = gen_random_uuid()
WHERE public_qr_token IS NULL;

ALTER TABLE public.animals
  ALTER COLUMN public_qr_token SET DEFAULT gen_random_uuid(),
  ALTER COLUMN public_qr_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_animals_public_qr_token
  ON public.animals (public_qr_token);

-- Do not allow broad reads from the old view: it contains every farm's public
-- animal rows and is not safe as a general anonymous directory.
REVOKE ALL PRIVILEGES ON TABLE public.public_animal_profiles FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.get_public_animal_profile(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_animal public.animals%ROWTYPE;
  v_birth_count integer := 0;
BEGIN
  SELECT a.* INTO v_animal
  FROM public.animals AS a
  WHERE a.public_qr_token = p_token
    AND COALESCE(a.archived, false) = false;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT COALESCE(v_animal.public_profile_enabled, true) THEN
    RETURN jsonb_build_object('status', 'disabled');
  END IF;

  IF lower(COALESCE(v_animal.sex, '')) IN ('female', 'inahin', 'babae') THEN
    SELECT count(*)::integer INTO v_birth_count
    FROM public.breeding_birth_events AS event
    WHERE event.user_id = v_animal.user_id
      AND event.mother_id = v_animal.id
      AND event.outcome = 'successful'
      AND event.actual_birth_date IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', 'available',
    'tag_id', v_animal.tag_id,
    'name', v_animal.name,
    'species', v_animal.species,
    'breed', v_animal.breed,
    'sex', v_animal.sex,
    'date_of_birth', CASE WHEN v_animal.public_show_birth_date THEN v_animal.date_of_birth END,
    'color_markings', v_animal.color_markings,
    'photo_url', v_animal.photo_url,
    'current_status', COALESCE(v_animal.status, 'Active'),
    'birth_count', v_birth_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_animal_profile(uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_public_animal_profile(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
