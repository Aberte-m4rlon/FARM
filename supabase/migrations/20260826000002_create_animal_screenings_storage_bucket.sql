/*
  Supabase Storage Bucket — animal-screenings
  ────────────────────────────────────────────
  Run this in Supabase SQL Editor (Dashboard → SQL Editor).

  Creates a PRIVATE storage bucket for camera screening images.
  Only authenticated users can upload/read their own screening images.

  NOTE: Storage bucket policies use the Supabase Storage RLS syntax.
  If your Supabase version does not support storage.create_bucket(),
  create the bucket manually in Dashboard → Storage → New Bucket:
    Name:   animal-screenings
    Public: NO (keep private)
*/

-- Create the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'animal-screenings',
  'animal-screenings',
  false,           -- PRIVATE bucket — images are NOT publicly accessible
  10485760,        -- 10MB per file limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS policies ──────────────────────────────────────────────────────

-- Allow authenticated users to upload to their own folder
DROP POLICY IF EXISTS "Users can upload their own screening images" ON storage.objects;
CREATE POLICY "Users can upload their own screening images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'animal-screenings' AND
    (storage.foldername(name))[1] = 'screenings' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Allow authenticated users to read their own images
DROP POLICY IF EXISTS "Users can read their own screening images" ON storage.objects;
CREATE POLICY "Users can read their own screening images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'animal-screenings' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Allow authenticated users to delete their own images
DROP POLICY IF EXISTS "Users can delete their own screening images" ON storage.objects;
CREATE POLICY "Users can delete their own screening images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'animal-screenings' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
