-- Inventory stock ledger used by inventory, feeding, treatment, and dashboard flows.
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'STOCK_IN', 'CONSUMPTION', 'REMOVAL', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN'
  )),
  quantity numeric(10,2) NOT NULL CHECK (quantity >= 0),
  unit text NOT NULL,
  reason text,
  notes text,
  previous_stock numeric(10,2) NOT NULL CHECK (previous_stock >= 0),
  new_stock numeric(10,2) NOT NULL CHECK (new_stock >= 0),
  cost_per_unit numeric(10,2),
  reference_type text,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "select_own_inventory_transactions" ON public.inventory_transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "insert_own_inventory_transactions" ON public.inventory_transactions
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.inventory AS item
      WHERE item.id = inventory_item_id AND item.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_own_inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "update_own_inventory_transactions" ON public.inventory_transactions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.inventory AS item
      WHERE item.id = inventory_item_id AND item.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_own_inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "delete_own_inventory_transactions" ON public.inventory_transactions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_user_date
  ON public.inventory_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item_date
  ON public.inventory_transactions(inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_reference
  ON public.inventory_transactions(reference_type, reference_id);
