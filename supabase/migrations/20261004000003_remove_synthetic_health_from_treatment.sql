-- Keep treatment records factual: medicine administration must not create
-- clinical risk scores or overwrite an animal's health status.
-- Stock deduction and its inventory ledgers remain one database transaction.

CREATE OR REPLACE FUNCTION public.administer_medication_treatment(
  p_user_id uuid,
  p_animal_id uuid,
  p_inventory_id uuid,
  p_quantity numeric,
  p_unit text,
  p_usage_type text,
  p_status text,
  p_dosage text,
  p_frequency text,
  p_start_date date,
  p_end_date date,
  p_reason text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_animal public.animals%ROWTYPE;
  v_item public.inventory%ROWTYPE;
  v_new_stock numeric;
  v_usage_id uuid;
  v_tx_id uuid;
  v_is_low_stock boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: User ID mismatch';
  END IF;

  SELECT * INTO v_animal
  FROM public.animals
  WHERE id = p_animal_id AND user_id = p_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang hayop o walang pahintulot.';
  END IF;

  IF v_animal.archived = true
     OR EXISTS (SELECT 1 FROM public.animal_sales WHERE animal_id = p_animal_id) THEN
    RAISE EXCEPTION 'Hindi maaaring bigyan ng gamot ang hayop na naibenta na o naka-archive.';
  END IF;

  SELECT * INTO v_item
  FROM public.inventory
  WHERE id = p_inventory_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang item sa imbentaryo o walang pahintulot.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Maglagay ng wastong dami (dapat mas mataas sa 0).';
  END IF;

  IF v_item.quantity IS NULL OR v_item.quantity < p_quantity THEN
    RAISE EXCEPTION 'Hindi sapat ang stock. Mayroon lamang % % sa imbentaryo.', v_item.quantity, v_item.unit;
  END IF;

  v_new_stock := v_item.quantity - p_quantity;

  UPDATE public.inventory
  SET quantity = v_new_stock, updated_at = now()
  WHERE id = p_inventory_id AND user_id = p_user_id;

  INSERT INTO public.inventory_usage (
    user_id, inventory_id, animal_id, quantity_used, unit,
    usage_date, reason, treatment_status, dosage, frequency, next_due_date, notes
  ) VALUES (
    p_user_id, p_inventory_id, p_animal_id, p_quantity, coalesce(p_unit, v_item.unit),
    now(), coalesce(p_reason, 'Treatment'), p_status, p_dosage, p_frequency, p_end_date, p_notes
  ) RETURNING id INTO v_usage_id;

  INSERT INTO public.inventory_transactions (
    user_id, inventory_item_id, type, quantity, unit,
    reason, notes, previous_stock, new_stock, cost_per_unit,
    reference_type, reference_id, created_at
  ) VALUES (
    p_user_id, p_inventory_id, 'CONSUMPTION', p_quantity, v_item.unit,
    coalesce(p_usage_type, 'Medication') || ' — ' || coalesce(p_status, 'Naibigay') || ': ' || coalesce(p_reason, v_item.name),
    'Para kay: ' || v_animal.tag_id || ' | Gamot: ' || v_item.name
      || ' | Dosis: ' || coalesce(p_dosage, p_quantity::text || ' ' || v_item.unit)
      || ' | ' || coalesce(p_notes, ''),
    v_item.quantity, v_new_stock, v_item.cost,
    'animal', p_animal_id, now()
  ) RETURNING id INTO v_tx_id;

  v_is_low_stock := v_new_stock <= coalesce(v_item.minimum_stock, 0);

  RETURN jsonb_build_object(
    'success', true,
    'usage_id', v_usage_id,
    'health_record_id', NULL,
    'transaction_id', v_tx_id,
    'previous_stock', v_item.quantity,
    'new_stock', v_new_stock,
    'is_low_stock', v_is_low_stock,
    'minimum_stock', v_item.minimum_stock,
    'item_name', v_item.name,
    'unit', v_item.unit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.administer_medication_treatment(uuid, uuid, uuid, numeric, text, text, text, text, text, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.administer_medication_treatment(uuid, uuid, uuid, numeric, text, text, text, text, text, date, date, text, text) TO authenticated;
