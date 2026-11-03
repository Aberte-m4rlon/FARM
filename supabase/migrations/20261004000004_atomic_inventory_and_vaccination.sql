-- Keep stock changes and their records in one transaction. Historical rows are untouched.

CREATE OR REPLACE FUNCTION public.record_inventory_transaction(
  p_user_id uuid,
  p_inventory_item_id uuid,
  p_type text,
  p_quantity numeric,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_cost_per_unit numeric DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.inventory%ROWTYPE;
  v_new_stock numeric;
  v_tx_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Kailangan ng naka-login na user.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Kailangan ang may-ari ng bukid.';
  END IF;
  IF auth.uid() <> p_user_id AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Walang pahintulot sa bukid na ito.';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('STOCK_IN', 'CONSUMPTION', 'REMOVAL', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN') THEN
    RAISE EXCEPTION 'Hindi wastong uri ng inventory transaction.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Maglagay ng wastong dami na mas mataas sa zero.';
  END IF;
  IF p_cost_per_unit IS NOT NULL AND p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Hindi maaaring negatibo ang halaga bawat yunit.';
  END IF;

  SELECT * INTO v_item
  FROM public.inventory
  WHERE id = p_inventory_item_id AND user_id = p_user_id AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang item sa imbentaryo o walang pahintulot.';
  END IF;
  IF p_type = 'CONSUMPTION' AND v_item.expiry_date IS NOT NULL AND v_item.expiry_date < current_date THEN
    RAISE EXCEPTION 'Expired na ang item noong %. Hindi ito maaaring gamitin.', v_item.expiry_date;
  END IF;
  IF lower(coalesce(p_reference_type, '')) = 'animal' AND NOT EXISTS (
    SELECT 1 FROM public.animals AS animal
    WHERE animal.id::text = p_reference_id AND animal.user_id = p_user_id
      AND animal.archived IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.animal_sales AS sale
        WHERE sale.animal_id = animal.id AND sale.user_id = p_user_id
      )
  ) THEN
    RAISE EXCEPTION 'Hindi nahanap ang alagang nakatala sa paggamit o walang pahintulot.';
  END IF;

  IF p_type IN ('STOCK_IN', 'ADJUSTMENT_IN', 'RETURN') THEN
    v_new_stock := v_item.quantity + p_quantity;
  ELSE
    v_new_stock := v_item.quantity - p_quantity;
  END IF;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Hindi sapat ang stock. Mayroon lamang % % sa imbentaryo.', v_item.quantity, v_item.unit;
  END IF;

  UPDATE public.inventory
  SET quantity = v_new_stock, updated_at = now()
  WHERE id = p_inventory_item_id AND user_id = p_user_id;

  INSERT INTO public.inventory_transactions (
    user_id, inventory_item_id, type, quantity, unit, reason, notes,
    previous_stock, new_stock, cost_per_unit, reference_type, reference_id, created_at
  ) VALUES (
    p_user_id, p_inventory_item_id, p_type, p_quantity, v_item.unit,
    p_reason, p_notes, v_item.quantity, v_new_stock,
    coalesce(p_cost_per_unit, v_item.cost), p_reference_type, p_reference_id, now()
  ) RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'previous_stock', v_item.quantity,
    'new_stock', v_new_stock
  );
END;
$$;

-- Create/edit inventory items together with their initial stock or adjustment ledger.
CREATE OR REPLACE FUNCTION public.save_inventory_item(
  p_user_id uuid,
  p_inventory_item_id uuid,
  p_name text,
  p_category text,
  p_quantity numeric,
  p_unit text,
  p_minimum_stock numeric,
  p_purchase_date date,
  p_expiry_date date,
  p_supplier text,
  p_cost numeric,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.inventory%ROWTYPE;
  v_item_id uuid;
  v_old_stock numeric := 0;
  v_delta numeric := 0;
  v_tx_id uuid;
  v_tx_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Kailangan ng naka-login na user.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Kailangan ang may-ari ng bukid.';
  END IF;
  IF auth.uid() <> p_user_id AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Walang pahintulot sa bukid na ito.';
  END IF;
  IF coalesce(trim(p_name), '') = '' OR coalesce(trim(p_category), '') = '' OR coalesce(trim(p_unit), '') = '' THEN
    RAISE EXCEPTION 'Kailangan ang pangalan, kategorya, at yunit ng item.';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 OR p_minimum_stock IS NULL OR p_minimum_stock < 0 THEN
    RAISE EXCEPTION 'Hindi maaaring negatibo ang stock o minimum stock.';
  END IF;
  IF p_cost IS NOT NULL AND p_cost < 0 THEN
    RAISE EXCEPTION 'Hindi maaaring negatibo ang halaga ng item.';
  END IF;

  IF p_inventory_item_id IS NULL THEN
    INSERT INTO public.inventory (
      user_id, name, category, quantity, unit, minimum_stock,
      purchase_date, expiry_date, supplier, cost, notes
    ) VALUES (
      p_user_id, trim(p_name), trim(p_category), p_quantity, trim(p_unit), p_minimum_stock,
      p_purchase_date, p_expiry_date, nullif(trim(coalesce(p_supplier, '')), ''), p_cost,
      nullif(trim(coalesce(p_notes, '')), '')
    ) RETURNING id INTO v_item_id;

    IF p_quantity > 0 THEN
      INSERT INTO public.inventory_transactions (
        user_id, inventory_item_id, type, quantity, unit, reason, previous_stock,
        new_stock, cost_per_unit, reference_type, reference_id, created_at
      ) VALUES (
        p_user_id, v_item_id, 'STOCK_IN', p_quantity, trim(p_unit), 'Initial stock entry',
        0, p_quantity, p_cost, NULL, NULL, now()
      ) RETURNING id INTO v_tx_id;
    END IF;
  ELSE
    SELECT * INTO v_item
    FROM public.inventory
    WHERE id = p_inventory_item_id AND user_id = p_user_id
      AND archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Hindi nahanap ang aktibong item sa imbentaryo o walang pahintulot.';
    END IF;

    v_old_stock := v_item.quantity;
    v_delta := p_quantity - v_old_stock;
    IF lower(trim(v_item.unit)) <> lower(trim(p_unit)) AND (v_old_stock > 0 OR p_quantity > 0) THEN
      RAISE EXCEPTION 'Hindi maaaring palitan ang yunit habang may stock. Gumawa ng bagong item para sa ibang yunit.';
    END IF;

    UPDATE public.inventory
    SET name = trim(p_name), category = trim(p_category), quantity = p_quantity,
        unit = trim(p_unit), minimum_stock = p_minimum_stock,
        purchase_date = p_purchase_date, expiry_date = p_expiry_date,
        supplier = nullif(trim(coalesce(p_supplier, '')), ''), cost = p_cost,
        notes = nullif(trim(coalesce(p_notes, '')), ''), updated_at = now()
    WHERE id = p_inventory_item_id AND user_id = p_user_id;
    v_item_id := p_inventory_item_id;

    IF v_delta <> 0 THEN
      v_tx_type := CASE WHEN v_delta > 0 THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END;
      INSERT INTO public.inventory_transactions (
        user_id, inventory_item_id, type, quantity, unit, reason, previous_stock,
        new_stock, cost_per_unit, reference_type, reference_id, created_at
      ) VALUES (
        p_user_id, v_item_id, v_tx_type, abs(v_delta),
        CASE WHEN v_old_stock = 0 THEN trim(p_unit) ELSE v_item.unit END,
        'Manual adjustment via edit', v_old_stock, p_quantity,
        coalesce(p_cost, v_item.cost), NULL, NULL, now()
      ) RETURNING id INTO v_tx_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inventory_item_id', v_item_id,
    'transaction_id', v_tx_id,
    'previous_stock', v_old_stock,
    'new_stock', p_quantity
  );
END;
$$;

-- Stock-in also updates supplier, purchase date, and unit cost atomically.
CREATE OR REPLACE FUNCTION public.record_inventory_stock_in(
  p_user_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_notes text,
  p_cost_per_unit numeric,
  p_supplier text,
  p_purchase_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.inventory%ROWTYPE;
  v_new_stock numeric;
  v_tx_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Kailangan ng naka-login na user.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Kailangan ang may-ari ng bukid.';
  END IF;
  IF auth.uid() <> p_user_id AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Walang pahintulot sa bukid na ito.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Maglagay ng wastong dami na mas mataas sa zero.';
  END IF;
  IF p_purchase_date IS NOT NULL AND p_purchase_date > current_date THEN
    RAISE EXCEPTION 'Hindi maaaring petsang panghinaharap ang petsa ng stock-in.';
  END IF;
  IF p_cost_per_unit IS NOT NULL AND p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Hindi maaaring negatibo ang halaga bawat yunit.';
  END IF;

  SELECT * INTO v_item
  FROM public.inventory
  WHERE id = p_inventory_item_id AND user_id = p_user_id AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang aktibong item sa imbentaryo o walang pahintulot.';
  END IF;

  v_new_stock := v_item.quantity + p_quantity;
  UPDATE public.inventory
  SET quantity = v_new_stock,
      supplier = coalesce(nullif(trim(coalesce(p_supplier, '')), ''), supplier),
      purchase_date = coalesce(p_purchase_date, purchase_date),
      cost = coalesce(p_cost_per_unit, cost),
      updated_at = now()
  WHERE id = p_inventory_item_id AND user_id = p_user_id;

  INSERT INTO public.inventory_transactions (
    user_id, inventory_item_id, type, quantity, unit, reason, notes,
    previous_stock, new_stock, cost_per_unit, reference_type, reference_id, created_at
  ) VALUES (
    p_user_id, p_inventory_item_id, 'STOCK_IN', p_quantity, v_item.unit,
    coalesce(nullif(trim(p_reason), ''), 'Stock replenishment'), p_notes,
    v_item.quantity, v_new_stock, coalesce(p_cost_per_unit, v_item.cost), NULL, NULL, now()
  ) RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'previous_stock', v_item.quantity,
    'new_stock', v_new_stock
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_vaccination_with_inventory(
  p_user_id uuid,
  p_animal_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_vaccine_name text,
  p_date_given date,
  p_next_due_date date DEFAULT NULL,
  p_veterinarian text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_animal public.animals%ROWTYPE;
  v_item public.inventory%ROWTYPE;
  v_due_days integer := 30;
  v_status text;
  v_new_stock numeric;
  v_vaccination_id uuid;
  v_tx_id uuid;
  v_usage_id uuid;
  v_latest_vaccine_date date;
  v_latest_next_due_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Kailangan ng naka-login na user.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Kailangan ang may-ari ng bukid.';
  END IF;
  IF auth.uid() <> p_user_id AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Walang pahintulot sa bukid na ito.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Maglagay ng wastong dami na mas mataas sa zero.';
  END IF;
  IF coalesce(trim(p_vaccine_name), '') = '' OR p_date_given IS NULL THEN
    RAISE EXCEPTION 'Kailangan ang pangalan ng bakuna at petsa ng pagbibigay.';
  END IF;
  IF p_date_given > current_date THEN
    RAISE EXCEPTION 'Hindi maaaring petsang panghinaharap ang petsa ng bakuna.';
  END IF;
  IF p_next_due_date IS NOT NULL AND p_next_due_date < p_date_given THEN
    RAISE EXCEPTION 'Hindi maaaring mas maaga sa petsa ng bakuna ang susunod na schedule.';
  END IF;

  SELECT * INTO v_animal
  FROM public.animals
  WHERE id = p_animal_id AND user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND OR v_animal.archived = true
     OR EXISTS (SELECT 1 FROM public.animal_sales WHERE animal_id = p_animal_id) THEN
    RAISE EXCEPTION 'Hindi nahanap ang aktibong kambing o tupa o walang pahintulot.';
  END IF;

  SELECT * INTO v_item
  FROM public.inventory
  WHERE id = p_inventory_item_id AND user_id = p_user_id AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang item sa imbentaryo o walang pahintulot.';
  END IF;
  IF lower(trim(coalesce(v_item.category, ''))) NOT IN ('vaccine', 'vaccines') THEN
    RAISE EXCEPTION 'Pumili ng item na nasa kategoryang Bakuna.';
  END IF;
  IF v_item.expiry_date IS NOT NULL AND v_item.expiry_date < p_date_given THEN
    RAISE EXCEPTION 'Expired na ang bakuna sa petsa ng paggamit.';
  END IF;
  IF v_item.quantity IS NULL OR v_item.quantity < p_quantity THEN
    RAISE EXCEPTION 'Hindi sapat ang stock. Mayroon lamang % % sa imbentaryo.', v_item.quantity, v_item.unit;
  END IF;

  v_new_stock := v_item.quantity - p_quantity;
  UPDATE public.inventory
  SET quantity = v_new_stock, updated_at = now()
  WHERE id = p_inventory_item_id AND user_id = p_user_id;

  INSERT INTO public.vaccinations (
    user_id, animal_id, vaccine_name, date_given, next_due_date, veterinarian, notes
  ) VALUES (
    p_user_id, p_animal_id, trim(p_vaccine_name), p_date_given, p_next_due_date,
    nullif(trim(coalesce(p_veterinarian, '')), ''), nullif(trim(coalesce(p_notes, '')), '')
  ) RETURNING id INTO v_vaccination_id;

  SELECT date_given, next_due_date
  INTO v_latest_vaccine_date, v_latest_next_due_date
  FROM public.vaccinations
  WHERE animal_id = p_animal_id AND user_id = p_user_id AND archived_at IS NULL
  ORDER BY date_given DESC, created_at DESC
  LIMIT 1;

  SELECT coalesce(s.vaccine_due_days, 30) INTO v_due_days
  FROM public.settings AS s WHERE s.user_id = p_user_id;
  v_due_days := coalesce(v_due_days, 30);
  IF v_latest_next_due_date IS NULL THEN
    v_status := 'None';
  ELSIF v_latest_next_due_date < current_date THEN
    v_status := 'Overdue';
  ELSIF v_latest_next_due_date <= current_date + v_due_days THEN
    v_status := 'Due Soon';
  ELSE
    v_status := 'Up to Date';
  END IF;

  UPDATE public.animals
  SET last_vaccine_date = v_latest_vaccine_date,
      next_vaccine_date = v_latest_next_due_date,
      vaccination_status = v_status,
      updated_at = now()
  WHERE id = p_animal_id AND user_id = p_user_id;

  INSERT INTO public.inventory_usage (
    user_id, inventory_id, animal_id, quantity_used, unit, usage_date,
    reason, treatment_status, notes
  ) VALUES (
    p_user_id, p_inventory_item_id, p_animal_id, p_quantity, v_item.unit,
    p_date_given::timestamp AT TIME ZONE 'UTC', 'Vaccination / Pagbabakuna', 'Naibigay', p_notes
  ) RETURNING id INTO v_usage_id;

  INSERT INTO public.inventory_transactions (
    user_id, inventory_item_id, type, quantity, unit, reason, notes,
    previous_stock, new_stock, cost_per_unit, reference_type, reference_id, created_at
  ) VALUES (
    p_user_id, p_inventory_item_id, 'CONSUMPTION', p_quantity, v_item.unit,
    'Vaccination / Pagbabakuna: ' || trim(p_vaccine_name),
    'Para kay: ' || v_animal.tag_id || ' | Bakuna: ' || trim(p_vaccine_name) || ' | ' || coalesce(p_notes, ''),
    v_item.quantity, v_new_stock, v_item.cost, 'animal', p_animal_id::text, now()
  ) RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'vaccination_id', v_vaccination_id,
    'usage_id', v_usage_id,
    'transaction_id', v_tx_id,
    'previous_stock', v_item.quantity,
    'new_stock', v_new_stock,
    'vaccination_status', v_status,
    'is_low_stock', v_new_stock <= coalesce(v_item.minimum_stock, 0),
    'minimum_stock', v_item.minimum_stock,
    'item_name', v_item.name,
    'unit', v_item.unit
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_vaccination_record(
  p_user_id uuid,
  p_vaccination_id uuid,
  p_vaccine_name text,
  p_date_given date,
  p_next_due_date date DEFAULT NULL,
  p_veterinarian text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vaccination public.vaccinations%ROWTYPE;
  v_due_days integer := 30;
  v_status text;
  v_latest_vaccine_date date;
  v_latest_next_due_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Kailangan ng naka-login na user.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Kailangan ang may-ari ng bukid.';
  END IF;
  IF auth.uid() <> p_user_id AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Walang pahintulot sa bukid na ito.';
  END IF;
  IF coalesce(trim(p_vaccine_name), '') = '' OR p_date_given IS NULL THEN
    RAISE EXCEPTION 'Kailangan ang pangalan ng bakuna at petsa ng pagbibigay.';
  END IF;
  IF p_date_given > current_date THEN
    RAISE EXCEPTION 'Hindi maaaring petsang panghinaharap ang petsa ng bakuna.';
  END IF;
  IF p_next_due_date IS NOT NULL AND p_next_due_date < p_date_given THEN
    RAISE EXCEPTION 'Hindi maaaring mas maaga sa petsa ng bakuna ang susunod na schedule.';
  END IF;

  SELECT * INTO v_vaccination
  FROM public.vaccinations
  WHERE id = p_vaccination_id AND user_id = p_user_id AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang record ng bakuna o walang pahintulot.';
  END IF;

  UPDATE public.vaccinations
  SET vaccine_name = trim(p_vaccine_name), date_given = p_date_given,
      next_due_date = p_next_due_date,
      veterinarian = nullif(trim(coalesce(p_veterinarian, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  WHERE id = p_vaccination_id AND user_id = p_user_id;

  SELECT date_given, next_due_date
  INTO v_latest_vaccine_date, v_latest_next_due_date
  FROM public.vaccinations
  WHERE animal_id = v_vaccination.animal_id AND user_id = p_user_id AND archived_at IS NULL
  ORDER BY date_given DESC, created_at DESC
  LIMIT 1;

  SELECT coalesce(s.vaccine_due_days, 30) INTO v_due_days
  FROM public.settings AS s WHERE s.user_id = p_user_id;
  v_due_days := coalesce(v_due_days, 30);
  IF v_latest_next_due_date IS NULL THEN
    v_status := 'None';
  ELSIF v_latest_next_due_date < current_date THEN
    v_status := 'Overdue';
  ELSIF v_latest_next_due_date <= current_date + v_due_days THEN
    v_status := 'Due Soon';
  ELSE
    v_status := 'Up to Date';
  END IF;

  UPDATE public.animals
  SET last_vaccine_date = v_latest_vaccine_date, next_vaccine_date = v_latest_next_due_date,
      vaccination_status = v_status, updated_at = now()
  WHERE id = v_vaccination.animal_id AND user_id = p_user_id;

  RETURN jsonb_build_object('success', true, 'vaccination_status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.record_inventory_transaction(uuid, uuid, text, numeric, text, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_transaction(uuid, uuid, text, numeric, text, text, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_inventory_item(uuid, uuid, text, text, numeric, text, numeric, date, date, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_item(uuid, uuid, text, text, numeric, text, numeric, date, date, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_inventory_stock_in(uuid, uuid, numeric, text, text, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_stock_in(uuid, uuid, numeric, text, text, numeric, text, date) TO authenticated;
REVOKE ALL ON FUNCTION public.record_vaccination_with_inventory(uuid, uuid, uuid, numeric, text, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_vaccination_with_inventory(uuid, uuid, uuid, numeric, text, date, date, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_vaccination_record(uuid, uuid, text, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_vaccination_record(uuid, uuid, text, date, date, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
