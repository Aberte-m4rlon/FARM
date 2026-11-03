BEGIN;

-- Gate, treatment, and animal workflows reference this column even though
-- older production schemas only recorded sales in animal_sales/archived.
ALTER TABLE public.animals
  ADD COLUMN IF NOT EXISTS is_sold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active';

UPDATE public.animals AS animal
SET is_sold = true
WHERE animal.is_sold = false
  AND EXISTS (
    SELECT 1
    FROM public.animal_sales AS sale
    WHERE sale.animal_id = animal.id
  );

UPDATE public.animals AS animal
SET status = 'Sold'
WHERE EXISTS (
  SELECT 1
  FROM public.animal_sales AS sale
  WHERE sale.animal_id = animal.id
)
AND animal.status = 'Active';

UPDATE public.animals
SET status = 'Archived'
WHERE archived = true
  AND status = 'Active'
  AND is_sold = false;

NOTIFY pgrst, 'reload schema';
COMMIT;
