-- Store camera movement observations only after a live QR verification.
-- These are screening alerts for manual review, not veterinary diagnoses.

create or replace function public.record_gate_movement_alert(
  p_session_id uuid,
  p_verification_id uuid,
  p_tracking_id text,
  p_species_detected text,
  p_observation text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_animal public.animals%rowtype;
  v_alert_id uuid;
  v_observation_label text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if p_tracking_id is null or p_tracking_id !~ '^T-[0-9]{3,}$'
     or p_species_detected not in ('goat', 'sheep')
     or p_observation not in ('repeated_stop_start', 'repeated_direction_change') then
    raise exception 'Invalid camera movement observation.' using errcode = '22023';
  end if;

  select * into v_session
  from public.gate_sessions s
  where s.id = p_session_id and s.user_id = v_user_id and s.status = 'monitoring';
  if not found then
    raise exception 'Active gate session not found.' using errcode = '42501';
  end if;
  if now() > v_session.started_at + make_interval(mins => v_session.reconciliation_window_minutes) then
    raise exception 'The camera monitoring window has ended.' using errcode = '22023';
  end if;

  select a.* into v_animal
  from public.gate_qr_verifications q
  join public.animals a
    on a.id = q.animal_id and a.user_id = q.user_id
  where q.id = p_verification_id
    and q.session_id = v_session.id
    and q.user_id = v_user_id
    and q.used_at is null
    and q.expires_at > now()
    and q.animal_id = any(v_session.expected_animal_ids)
    and coalesce(a.archived, false) = false
    and coalesce(a.is_sold, false) = false
    and lower(coalesce(a.status, '')) not in ('sold', 'deceased', 'transferred')
    and lower(a.species) = p_species_detected
  for update of q;
  if not found then
    raise exception 'QR verification expired or does not match the live animal.' using errcode = '22023';
  end if;

  v_observation_label := case p_observation
    when 'repeated_stop_start' then 'paulit-ulit na paghinto at muling paggalaw'
    else 'paulit-ulit na pagbabago ng direksyon'
  end;

  insert into public.gate_alerts (session_id, user_id, animal_id, alert_type, message)
  values (
    v_session.id,
    v_user_id,
    v_animal.id,
    'movement_observation',
    'Paunang camera screening para kay ' || v_animal.name || ' (' || v_animal.tag_id ||
      '): napansin ang ' || v_observation_label ||
      '. Suriin muna nang personal; hindi ito diagnosis.'
  )
  on conflict (session_id, animal_id, alert_type) do update
    set status = 'active',
        message = excluded.message,
        resolved_at = null,
        created_at = now()
  returning id into v_alert_id;

  return jsonb_build_object(
    'success', true,
    'alert_id', v_alert_id,
    'animal_id', v_animal.id,
    'observation', p_observation
  );
end;
$$;

revoke all on function public.record_gate_movement_alert(uuid, uuid, text, text, text) from public;
grant execute on function public.record_gate_movement_alert(uuid, uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
