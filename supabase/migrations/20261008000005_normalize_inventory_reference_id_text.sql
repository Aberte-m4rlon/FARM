-- inventory_transactions.reference_id is a generic reference across animals,
-- vaccinations, treatments, and other records, so it must accept text values.
-- Older production schemas created it as uuid; normalize it to the text type
-- already defined by 20261002000001_create_inventory_transactions.sql.
DO $$
DECLARE
  v_reference_id_type oid;
BEGIN
  SELECT attribute.atttypid
  INTO v_reference_id_type
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.inventory_transactions'::regclass
    AND attribute.attname = 'reference_id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF v_reference_id_type IS NULL THEN
    RAISE EXCEPTION 'public.inventory_transactions.reference_id column is missing';
  END IF;

  IF v_reference_id_type <> 'text'::regtype THEN
    ALTER TABLE public.inventory_transactions
      ALTER COLUMN reference_id TYPE text USING reference_id::text;
  END IF;
END;
$$;
