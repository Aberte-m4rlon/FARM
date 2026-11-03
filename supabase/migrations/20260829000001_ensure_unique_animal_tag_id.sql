-- Migration: 20260829000001_ensure_unique_animal_tag_id.sql
-- Description: Enforce unique constraint/index on animals.tag_id per user (and global index)

DO $$
BEGIN
    -- Create unique index on user_id and tag_id if not exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'idx_animals_user_tag_id_unique' AND n.nspname = 'public'
    ) THEN
        CREATE UNIQUE INDEX idx_animals_user_tag_id_unique ON public.animals (user_id, LOWER(TRIM(tag_id))) WHERE (archived = false);
    END IF;
END $$;
