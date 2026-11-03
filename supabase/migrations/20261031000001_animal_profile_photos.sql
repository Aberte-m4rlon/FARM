BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'animal-profile-photos',
  'animal-profile-photos',
  true,
  10485760,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Owners can upload animal profile photos" ON storage.objects;
CREATE POLICY "Owners can upload animal profile photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'animal-profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.animals AS animal
      WHERE animal.id::text = (storage.foldername(name))[2]
        AND animal.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can delete animal profile photos" ON storage.objects;
CREATE POLICY "Owners can delete animal profile photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'animal-profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.animals AS animal
      WHERE animal.id::text = (storage.foldername(name))[2]
        AND animal.user_id = auth.uid()
    )
  );

COMMIT;
