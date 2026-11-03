-- Add the fields used by the AI scan record and atomically persist scan outcomes.
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS gait text NOT NULL DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS scan_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_records_user_scan_key
  ON public.health_records(user_id, scan_key)
  WHERE scan_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_ai_health_scan(
  p_scan_key uuid,
  p_animal_id uuid,
  p_record_date date,
  p_risk_score integer,
  p_risk_level text,
  p_reasons text,
  p_recommendation text,
  p_gait text,
  p_activity_level text,
  p_image_path text,
  p_image_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_animal public.animals%ROWTYPE;
  v_record public.health_records%ROWTYPE;
  v_health_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Kailangan mag-login upang mag-save ng health scan.';
  END IF;
  IF p_scan_key IS NULL OR p_animal_id IS NULL THEN
    RAISE EXCEPTION 'Kulang ang scan o animal record reference.';
  END IF;
  IF p_risk_score IS NULL OR p_risk_score < 0 OR p_risk_score > 100 THEN
    RAISE EXCEPTION 'Hindi wastong health risk score.';
  END IF;
  IF p_risk_level IS NULL OR p_risk_level NOT IN ('Low', 'Moderate', 'High', 'Critical') THEN
    RAISE EXCEPTION 'Hindi wastong health risk level.';
  END IF;

  SELECT * INTO v_animal
  FROM public.animals
  WHERE id = p_animal_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hindi nahanap ang alaga o wala kang pahintulot.';
  END IF;
  IF v_animal.archived THEN
    RAISE EXCEPTION 'Hindi maaaring mag-save ng bagong scan para sa naka-archive o naibentang alaga.';
  END IF;

  SELECT * INTO v_record
  FROM public.health_records
  WHERE user_id = v_user_id AND scan_key = p_scan_key;
  IF FOUND THEN
    IF v_record.animal_id <> p_animal_id THEN
      RAISE EXCEPTION 'Ginamit na ang scan reference para sa ibang alaga.';
    END IF;
    RETURN to_jsonb(v_record);
  END IF;

  v_health_status := CASE
    WHEN p_risk_score >= 65 THEN 'Critical'
    WHEN p_risk_score >= 45 THEN 'At Risk'
    WHEN p_risk_score >= 25 THEN 'Monitor'
    ELSE 'Healthy'
  END;

  INSERT INTO public.health_records (
    user_id, animal_id, record_date, risk_score, risk_level, reasons,
    recommendation, gait, activity_level, image_path, image_url, scan_key
  ) VALUES (
    v_user_id, p_animal_id, coalesce(p_record_date, CURRENT_DATE), p_risk_score,
    p_risk_level, p_reasons, p_recommendation, coalesce(p_gait, 'Normal'),
    coalesce(p_activity_level, 'Normal'), p_image_path, p_image_url, p_scan_key
  ) RETURNING * INTO v_record;

  UPDATE public.animals
  SET health_status = v_health_status,
      health_risk_score = p_risk_score,
      updated_at = now()
  WHERE id = p_animal_id AND user_id = v_user_id;

  IF p_risk_score >= 55 AND NOT EXISTS (
    SELECT 1 FROM public.health_alerts
    WHERE user_id = v_user_id AND source_id = v_record.id::text
  ) THEN
    INSERT INTO public.health_alerts (
      user_id, animal_id, alert_type, severity, message, source_id
    ) VALUES (
      v_user_id, p_animal_id, 'high_risk_assessment',
      CASE WHEN p_risk_score >= 75 THEN 'critical' ELSE 'warning' END,
      coalesce(p_reasons, 'Kailangan ng follow-up sa resulta ng health scan.'),
      v_record.id::text
    );
  END IF;

  RETURN to_jsonb(v_record);
END;
$$;

REVOKE ALL ON FUNCTION public.save_ai_health_scan(uuid, uuid, date, integer, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_ai_health_scan(uuid, uuid, date, integer, text, text, text, text, text, text, text) TO authenticated;
