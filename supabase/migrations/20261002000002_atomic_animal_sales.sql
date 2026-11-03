-- Record a sale, preserve the final weight, archive the animal, and notify on balance atomically.
CREATE OR REPLACE FUNCTION public.record_animal_sale(
  p_animal_id uuid,
  p_sold_weight numeric,
  p_selling_price numeric,
  p_buyer_name text DEFAULT NULL,
  p_buyer_contact text DEFAULT NULL,
  p_payment_status text DEFAULT 'Bayad na',
  p_amount_received numeric DEFAULT 0,
  p_sale_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL,
  p_sold_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_animal public.animals%ROWTYPE;
  v_sale public.animal_sales%ROWTYPE;
  v_amount_received numeric(10,2);
  v_payment_status text;
  v_remaining_balance numeric(10,2);
  v_sale_date date := coalesce(p_sale_date, CURRENT_DATE);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Kailangan mag-login upang magtala ng benta.';
  END IF;
  IF p_sold_weight IS NULL OR p_sold_weight <= 0 THEN
    RAISE EXCEPTION 'Kailangang maglagay ng wastong timbang bago ibenta.';
  END IF;
  IF p_selling_price IS NULL OR p_selling_price <= 0 THEN
    RAISE EXCEPTION 'Kailangang maglagay ng wastong presyo ng benta.';
  END IF;
  IF p_payment_status NOT IN ('Bayad na', 'May Kulang', 'Pending') THEN
    RAISE EXCEPTION 'Hindi wastong katayuan ng bayad.';
  END IF;

  SELECT * INTO v_animal
  FROM public.animals
  WHERE id = p_animal_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_animal.archived THEN
    RAISE EXCEPTION 'Hindi nahanap ang aktibong alaga o wala kang pahintulot.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.animal_sales WHERE animal_id = p_animal_id) THEN
    RAISE EXCEPTION 'May naitalang benta na para sa alagang ito.';
  END IF;

  v_amount_received := CASE
    WHEN p_payment_status = 'Bayad na' THEN p_selling_price
    ELSE coalesce(p_amount_received, 0)
  END;
  IF v_amount_received < 0 OR v_amount_received > p_selling_price THEN
    RAISE EXCEPTION 'Hindi wastong halagang natanggap.';
  END IF;
  v_payment_status := CASE
    WHEN v_amount_received >= p_selling_price THEN 'Bayad na'
    WHEN v_amount_received > 0 THEN 'May Kulang'
    ELSE 'Pending'
  END;
  v_remaining_balance := p_selling_price - v_amount_received;

  INSERT INTO public.animal_sales (
    user_id, animal_id, animal_tag_id, animal_name, species, sold_weight,
    selling_price, price_per_kg, buyer_name, buyer_contact, payment_status,
    amount_received, remaining_balance, sale_date, notes, sold_by
  ) VALUES (
    v_user_id, v_animal.id, v_animal.tag_id, coalesce(nullif(v_animal.name, ''), v_animal.tag_id),
    v_animal.species, p_sold_weight, p_selling_price,
    round(p_selling_price / p_sold_weight, 2), nullif(trim(p_buyer_name), ''),
    nullif(trim(p_buyer_contact), ''), v_payment_status, v_amount_received,
    v_remaining_balance, v_sale_date, nullif(trim(p_notes), ''), nullif(trim(p_sold_by), '')
  ) RETURNING * INTO v_sale;

  INSERT INTO public.weight_records (
    user_id, animal_id, record_date, weight_kg, previous_weight_kg,
    weight_change_kg, notes
  ) VALUES (
    v_user_id, v_animal.id, v_sale_date, p_sold_weight, v_animal.weight_kg,
    CASE WHEN v_animal.weight_kg IS NULL THEN NULL
      ELSE round(p_sold_weight - v_animal.weight_kg, 2) END,
    'Timbang bago ibenta'
  );

  UPDATE public.animals
  SET archived = true,
      weight_kg = p_sold_weight,
      notes = concat_ws(E'\n', nullif(trim(v_animal.notes), ''),
        '[NABENTA NOONG ' || v_sale_date::text || '] Timbang: ' || p_sold_weight || 'kg | Presyo: ' || p_selling_price),
      updated_at = now()
  WHERE id = v_animal.id AND user_id = v_user_id;

  IF v_remaining_balance > 0 THEN
    INSERT INTO public.notifications (
      user_id, type, title, description, priority, link, read, event_key
    ) VALUES (
      v_user_id, 'Sales', 'May natitirang bayarin sa benta',
      'May natitirang balanse na' || v_remaining_balance::text || ' para sa ' || v_sale.animal_tag_id || '.',
      'Warning', '/sales', false, 'sale_balance:' || v_sale.id::text
    ) ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN to_jsonb(v_sale);
END;
$$;

REVOKE INSERT ON public.animal_sales FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.record_animal_sale(uuid, numeric, numeric, text, text, text, numeric, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_animal_sale(uuid, numeric, numeric, text, text, text, numeric, date, text, text) TO authenticated;
