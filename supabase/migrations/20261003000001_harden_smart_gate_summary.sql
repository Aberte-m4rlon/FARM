-- Keep server-side session validation aligned with the supported livestock species.
create or replace function public.start_gate_session(
  p_gate_id uuid,
  p_expected_animal_ids uuid[],
  p_reconciliation_window_minutes integer default 60
)
returns public.gate_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_expected_ids uuid[];
  v_requested_count integer := coalesce(cardinality(p_expected_animal_ids), 0);
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if p_reconciliation_window_minutes < 10 or p_reconciliation_window_minutes > 1440 then
    raise exception 'Reconciliation window must be between 10 and 1440 minutes.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.gate_devices g
    where g.id = p_gate_id and g.user_id = v_user_id and g.is_active
  ) then
    raise exception 'Gate is not available to this farm.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct requested.animal_id order by requested.animal_id), '{}')
    into v_expected_ids
  from unnest(coalesce(p_expected_animal_ids, '{}')) as requested(animal_id)
  join public.animals a
    on a.id = requested.animal_id
   and a.user_id = v_user_id
   and coalesce(a.archived, false) = false
   and lower(a.species) in ('goat', 'sheep');

  if cardinality(v_expected_ids) <> v_requested_count then
    raise exception 'Expected list contains duplicates, archived animals, unsupported species, or animals outside this farm.'
      using errcode = '22023';
  end if;
  if cardinality(v_expected_ids) = 0 then
    raise exception 'Register at least one active goat or sheep before starting.'
      using errcode = '22023';
  end if;

  insert into public.gate_sessions (
    user_id, gate_id, expected_animal_ids, expected_count, reconciliation_window_minutes
  ) values (
    v_user_id, p_gate_id, v_expected_ids, cardinality(v_expected_ids), p_reconciliation_window_minutes
  ) returning * into v_session;
  return v_session;
end;
$$;

create or replace function public.get_gate_session_summary(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_expected_ids uuid[];
  v_confirmed_ids uuid[];
  v_inside_ids uuid[];
  v_unaccounted_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  select * into v_session from public.gate_sessions s
  where s.id = p_session_id and s.user_id = v_user_id;
  if not found then
    raise exception 'Gate session not found.' using errcode = '42501';
  end if;

  select coalesce(array_agg(a.id order by a.id), '{}') into v_expected_ids
  from public.animals a
  where a.user_id = v_user_id
    and a.id = any(v_session.expected_animal_ids)
    and coalesce(a.archived, false) = false
    and lower(a.species) in ('goat', 'sheep');

  select coalesce(array_agg(distinct e.animal_id order by e.animal_id), '{}') into v_confirmed_ids
  from public.gate_events e
  where e.session_id = v_session.id
    and e.user_id = v_user_id
    and e.qr_verified
    and e.animal_id = any(v_expected_ids);

  select coalesce(array_agg(latest.animal_id order by latest.animal_id), '{}') into v_inside_ids
  from (
    select distinct on (e.animal_id) e.animal_id, e.direction
    from public.gate_events e
    where e.session_id = v_session.id
      and e.user_id = v_user_id
      and e.qr_verified
      and e.animal_id = any(v_expected_ids)
    order by e.animal_id, e.created_at desc, e.id desc
  ) latest
  where latest.direction = 'entry';

  select coalesce(array_agg(expected.animal_id order by expected.animal_id), '{}') into v_unaccounted_ids
  from unnest(v_expected_ids) as expected(animal_id)
  where not (expected.animal_id = any(v_confirmed_ids));

  return jsonb_build_object(
    'session_id', v_session.id,
    'expected_animal_ids', to_jsonb(v_expected_ids),
    'confirmed_animal_ids', to_jsonb(v_confirmed_ids),
    'inside_animal_ids', to_jsonb(v_inside_ids),
    'unaccounted_animal_ids', to_jsonb(v_unaccounted_ids)
  );
end;
$$;

revoke all on function public.start_gate_session(uuid, uuid[], integer) from public;
revoke all on function public.get_gate_session_summary(uuid) from public;
grant execute on function public.start_gate_session(uuid, uuid[], integer) to authenticated;
grant execute on function public.get_gate_session_summary(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gate_sessions'
     ) then
    alter publication supabase_realtime add table public.gate_sessions;
  end if;
end;
$$;
