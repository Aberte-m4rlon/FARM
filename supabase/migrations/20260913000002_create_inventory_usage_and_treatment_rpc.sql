-- Migration: 20260913000002_create_inventory_usage_and_treatment_rpc.sql
-- Description: Create inventory_usage table with RLS and atomic treatment administration RPC

CREATE TABLE IF NOT EXISTS inventory_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_id uuid NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  animal_id uuid REFERENCES animals(id) ON DELETE SET NULL,
  quantity_used numeric(10,2) NOT NULL,
  unit text NOT NULL,
  usage_date timestamptz NOT NULL DEFAULT now(),
  reason text,
  treatment_status text,
  dosage text,
  frequency text,
  next_due_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_inventory_usage" ON inventory_usage;
CREATE POLICY "select_own_inventory_usage" ON inventory_usage FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_inventory_usage" ON inventory_usage;
CREATE POLICY "insert_own_inventory_usage" ON inventory_usage FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_inventory_usage" ON inventory_usage;
CREATE POLICY "update_own_inventory_usage" ON inventory_usage FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_inventory_usage" ON inventory_usage;
CREATE POLICY "delete_own_inventory_usage" ON inventory_usage FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_inventory_usage_user_id ON inventory_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_usage_inventory_id ON inventory_usage(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_usage_animal_id ON inventory_usage(animal_id);
CREATE INDEX IF NOT EXISTS idx_inventory_usage_date ON inventory_usage(usage_date);

-- Atomic administration stored procedure
CREATE OR REPLACE FUNCTION administer_medication_treatment(
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
AS $$
DECLARE
  v_animal record;
  v_item record;
  v_new_stock numeric;
  v_usage_id uuid;
  v_health_record_id uuid;
  v_tx_id uuid;
  v_is_low_stock boolean := false;
BEGIN
  -- 1. Check user context if authenticated
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: User ID mismatch';
  END IF;

  -- 2. Verify animal exists, belongs to user, and is active (not sold or archived)
  SELECT * INTO v_animal FROM animals WHERE id = p_animal_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang hayop o walang pahintulot.';
  END IF;
  IF v_animal.archived = true OR EXISTS (SELECT 1 FROM animal_sales WHERE animal_id = p_animal_id) THEN
    RAISE EXCEPTION 'Hindi maaaring bigyan ng gamot ang hayop na naibenta na o naka-archive.';
  END IF;

  -- 3. Verify inventory item exists, belongs to user, and lock row for update
  SELECT * INTO v_item FROM inventory WHERE id = p_inventory_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang item sa imbentaryo o walang pahintulot.';
  END IF;

  -- 4. Verify quantity and stock sufficiency
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Maglagay ng wastong dami (dapat mas mataas sa 0).';
  END IF;
  IF v_item.quantity < p_quantity THEN
    RAISE EXCEPTION 'Hindi sapat ang stock. Mayroon lamang % % sa imbentaryo.', v_item.quantity, v_item.unit;
  END IF;

  -- 5. Deduct inventory stock
  v_new_stock := v_item.quantity - p_quantity;
  UPDATE inventory
  SET quantity = v_new_stock, updated_at = now()
  WHERE id = p_inventory_id;

  -- 6. Insert record into inventory_usage
  INSERT INTO inventory_usage (
    user_id, inventory_id, animal_id, quantity_used, unit,
    usage_date, reason, treatment_status, dosage, frequency, next_due_date, notes
  ) VALUES (
    p_user_id, p_inventory_id, p_animal_id, p_quantity, coalesce(p_unit, v_item.unit),
    now(), coalesce(p_reason, 'Treatment'), p_status, p_dosage, p_frequency, p_end_date, p_notes
  ) RETURNING id INTO v_usage_id;

  -- 7. Insert record into inventory_transactions ledger
  INSERT INTO inventory_transactions (
    user_id, inventory_item_id, type, quantity, unit,
    reason, notes, previous_stock, new_stock, cost_per_unit,
    reference_type, reference_id, created_at
  ) VALUES (
    p_user_id, p_inventory_id, 'CONSUMPTION', p_quantity, v_item.unit,
    p_usage_type || ' — ' || p_status || ': ' || coalesce(p_reason, v_item.name),
    'Para kay: ' || v_animal.tag_id || ' | Gamot: ' || v_item.name || ' | Dosis: ' || coalesce(p_dosage, p_quantity || ' ' || v_item.unit) || ' | ' || coalesce(p_notes, ''),
    v_item.quantity, v_new_stock, v_item.cost,
    'animal', p_animal_id, now()
  ) RETURNING id INTO v_tx_id;

  -- 8. Insert clinical health record
  INSERT INTO health_records (
    user_id, animal_id, record_date,
    reasons, recommendation, notes,
    risk_level, risk_score
  ) VALUES (
    p_user_id, p_animal_id, coalesce(p_start_date, CURRENT_DATE),
    'Gamot / Lunas: ' || v_item.name || ' (' || p_status || ')',
    'Katayuan ng Gamot: ' || p_status || '. Dalas: ' || coalesce(p_frequency, 'Once daily'),
    'Uri: ' || p_usage_type || ' | Gamot: ' || v_item.name || ' | Dami: ' || p_quantity || ' ' || v_item.unit || ' | Dosis: ' || coalesce(p_dosage, '') || ' | Dalas: ' || coalesce(p_frequency, '') || ' | Katayuan: ' || p_status || ' | Simula: ' || coalesce(p_start_date::text, CURRENT_DATE::text) || coalesce(' | Hanggang: ' || p_end_date::text, '') || ' | Dahilan: ' || coalesce(p_reason, '') || ' | Tala: ' || coalesce(p_notes, ''),
    CASE WHEN p_status = 'Tapos na ang Gamot' THEN 'Low'
         WHEN p_status IN ('Kailangan ng Gamot', 'Kasalukuyang Ginagamot') THEN 'Moderate'
         ELSE 'Low' END,
    CASE WHEN p_status = 'Tapos na ang Gamot' THEN 5
         WHEN p_status IN ('Kailangan ng Gamot', 'Kasalukuyang Ginagamot') THEN 60
         ELSE 20 END
  ) RETURNING id INTO v_health_record_id;

  -- 9. Update animal health status
  IF p_status = 'Tapos na ang Gamot' THEN
    UPDATE animals SET health_status = 'Healthy' WHERE id = p_animal_id;
  ELSIF p_status IN ('Kailangan ng Gamot', 'Kasalukuyang Ginagamot') THEN
    UPDATE animals SET health_status = 'Critical' WHERE id = p_animal_id;
  END IF;

  IF v_new_stock <= coalesce(v_item.minimum_stock, 0) THEN
    v_is_low_stock := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'usage_id', v_usage_id,
    'health_record_id', v_health_record_id,
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
