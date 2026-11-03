-- Expose only the fields used by the public QR passport and prevent users
-- from promoting their own account through the profiles self-update policy.
BEGIN;

CREATE OR REPLACE VIEW public.public_animal_profiles
WITH (security_barrier = true)
AS
SELECT
  id,
  tag_id,
  name,
  species,
  breed,
  sex,
  date_of_birth,
  color_markings,
  photo_url,
  created_at
FROM public.animals
WHERE COALESCE(archived, false) = false;

REVOKE ALL PRIVILEGES ON TABLE public.animals FROM anon, PUBLIC;
DO $$
DECLARE
  column_name text;
BEGIN
  FOR column_name IN
    SELECT c.column_name
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'animals'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%I) ON TABLE public.animals FROM anon, PUBLIC',
      column_name
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS public_read_animal_by_id ON public.animals;
DROP POLICY IF EXISTS "public_read_animal_by_id" ON public.animals;

REVOKE ALL PRIVILEGES ON TABLE public.public_animal_profiles FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.public_animal_profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_profile_role_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the trusted server may change account roles.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_profile_role_self_change() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS prevent_profile_role_self_change ON public.profiles;
    CREATE TRIGGER prevent_profile_role_self_change
      BEFORE UPDATE OF role ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_profile_role_self_change();
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
