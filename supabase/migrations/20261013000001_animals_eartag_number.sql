ALTER TABLE public.animals
  ADD COLUMN IF NOT EXISTS eartag_number integer;

ALTER TABLE public.animals
  DROP CONSTRAINT IF EXISTS animals_eartag_number_positive_check;

ALTER TABLE public.animals
  ADD CONSTRAINT animals_eartag_number_positive_check
  CHECK (eartag_number IS NULL OR eartag_number > 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_animals_user_eartag_number_unique_active
  ON public.animals (user_id, eartag_number)
  WHERE archived = false AND eartag_number IS NOT NULL;
