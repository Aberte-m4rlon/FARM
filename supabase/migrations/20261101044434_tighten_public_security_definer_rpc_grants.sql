-- Keep farmer-facing SECURITY DEFINER RPCs behind a verified Supabase session.
-- The functions retain their own auth.uid()/ownership checks as defense in depth.
-- Public QR lookup remains intentionally callable by anon using its random token.
DO $migration$
DECLARE
  signature text;
  function_oid regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.cancel_gate_session(uuid)',
    'public.clear_gate_live_tracks(uuid)',
    'public.record_animal_sale(uuid,numeric,numeric,text,text,text,numeric,date,text,text)',
    'public.record_gate_movement(uuid,uuid,text,text,numeric,text,text)',
    'public.record_gate_movement_alert(uuid,uuid,text,text,text)',
    'public.set_gate_alert_status(uuid,text)',
    'public.start_gate_session(uuid,uuid[],integer,numeric,text)',
    'public.sync_gate_live_tracks(uuid,jsonb)',
    'public.verify_gate_qr(uuid,text,text)'
  ]
  LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', function_oid);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', function_oid);
    END IF;
  END LOOP;

  -- Retire the obsolete overload; the current client uses the authenticated
  -- movement_observation signature.
  function_oid := to_regprocedure('public.record_gate_movement(uuid,uuid,text,text,numeric,text)');
  IF function_oid IS NOT NULL THEN
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', function_oid);
  END IF;

  -- Trigger functions must only run from their table triggers.
  FOREACH signature IN ARRAY ARRAY[
    'public.clear_inactive_gate_live_tracks()',
    'public.handle_new_user()'
  ]
  LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', function_oid);
    END IF;
  END LOOP;
END
$migration$;
