BEGIN;

ALTER TABLE public.camera_gate_settings
  ADD COLUMN IF NOT EXISTS gateway_service_seen_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_camera_service_heartbeat(p_user_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Camera gateway owner is required.' USING errcode = '22023';
  END IF;

  INSERT INTO public.camera_gate_settings(user_id, gateway_service_seen_at)
  VALUES (p_user_id, v_now)
  ON CONFLICT (user_id) DO UPDATE
    SET gateway_service_seen_at = EXCLUDED.gateway_service_seen_at;

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.record_camera_service_heartbeat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_camera_service_heartbeat(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
