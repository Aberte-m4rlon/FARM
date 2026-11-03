-- Additive gate monitoring schema. Existing farm, animal, auth, and health data stays intact.
create table if not exists public.gate_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id),
  check (length(trim(name)) > 0)
);

create table if not exists public.gate_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gate_id uuid not null references public.gate_devices(id) on delete restrict,
  status text not null default 'monitoring'
    check (status in ('monitoring', 'reconciled', 'cancelled')),
  expected_animal_ids uuid[] not null default '{}',
  expected_count integer not null default 0 check (expected_count >= 0),
  entered_count integer not null default 0 check (entered_count >= 0),
  exited_count integer not null default 0 check (exited_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  reconciliation_window_minutes integer not null default 60
    check (reconciliation_window_minutes between 10 and 1440),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (gate_id, user_id)
    references public.gate_devices(id, user_id) on delete restrict
);

create unique index if not exists gate_sessions_one_monitoring_session_per_user
  on public.gate_sessions(user_id) where status = 'monitoring';
create index if not exists gate_sessions_user_started_idx
  on public.gate_sessions(user_id, started_at desc);

create table if not exists public.gate_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.gate_sessions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  gate_id uuid not null references public.gate_devices(id) on delete restrict,
  animal_id uuid not null references public.animals(id) on delete restrict,
  direction text not null check (direction in ('entry', 'exit')),
  species_detected text not null check (species_detected in ('goat', 'sheep')),
  qr_verified boolean not null default true check (qr_verified),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  tracking_id text,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id)
    references public.gate_sessions(id, user_id) on delete restrict,
  foreign key (gate_id, user_id)
    references public.gate_devices(id, user_id) on delete restrict
);

create index if not exists gate_events_session_created_idx
  on public.gate_events(session_id, created_at desc);
create index if not exists gate_events_session_animal_direction_idx
  on public.gate_events(session_id, animal_id, direction, created_at desc);
create index if not exists gate_events_user_created_idx
  on public.gate_events(user_id, created_at desc);

create table if not exists public.gate_qr_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.gate_sessions(id) on delete cascade,
  animal_id uuid not null references public.animals(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  used_at timestamptz,
  foreign key (session_id, user_id)
    references public.gate_sessions(id, user_id) on delete cascade
);
create index if not exists gate_qr_verifications_expiry_idx
  on public.gate_qr_verifications(expires_at);

create table if not exists public.gate_alerts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.gate_sessions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  animal_id uuid not null references public.animals(id) on delete restrict,
  alert_type text not null default 'unaccounted' check (alert_type = 'unaccounted'),
  message text not null,
  status text not null default 'active'
    check (status in ('active', 'acknowledged', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (session_id, user_id)
    references public.gate_sessions(id, user_id) on delete restrict,
  unique (session_id, animal_id, alert_type)
);
create index if not exists gate_alerts_user_status_created_idx
  on public.gate_alerts(user_id, status, created_at desc);

alter table public.gate_devices enable row level security;
alter table public.gate_sessions enable row level security;
alter table public.gate_events enable row level security;
alter table public.gate_alerts enable row level security;
alter table public.gate_qr_verifications enable row level security;

drop policy if exists gate_devices_select_own on public.gate_devices;
create policy gate_devices_select_own on public.gate_devices
  for select to authenticated using (user_id = auth.uid());
drop policy if exists gate_devices_insert_own on public.gate_devices;
create policy gate_devices_insert_own on public.gate_devices
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists gate_devices_update_own on public.gate_devices;
create policy gate_devices_update_own on public.gate_devices
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists gate_sessions_select_own on public.gate_sessions;
create policy gate_sessions_select_own on public.gate_sessions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists gate_events_select_own on public.gate_events;
create policy gate_events_select_own on public.gate_events
  for select to authenticated using (user_id = auth.uid());
drop policy if exists gate_alerts_select_own on public.gate_alerts;
create policy gate_alerts_select_own on public.gate_alerts
  for select to authenticated using (user_id = auth.uid());

revoke all on public.gate_devices, public.gate_sessions, public.gate_events, public.gate_alerts from anon, authenticated;
grant select, insert, update on public.gate_devices to authenticated;
grant select on public.gate_sessions, public.gate_events, public.gate_alerts to authenticated;
revoke all on public.gate_qr_verifications from anon, authenticated;

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
   and coalesce(a.archived, false) = false;

  if cardinality(v_expected_ids) <> v_requested_count then
    raise exception 'Expected list contains duplicates, archived animals, or animals outside this farm.'
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

create or replace function public.record_gate_movement(
  p_session_id uuid,
  p_verification_id uuid,
  p_direction text,
  p_species_detected text,
  p_confidence numeric,
  p_tracking_id text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_verification public.gate_qr_verifications%rowtype;
  v_species text;
  v_event public.gate_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if p_direction is null or p_direction not in ('entry', 'exit') then
    raise exception 'Direction must be entry or exit.' using errcode = '22023';
  end if;
  if p_species_detected is null or p_species_detected not in ('goat', 'sheep')
     or p_confidence is null or p_confidence < 0.4 or p_confidence > 1 then
    raise exception 'Invalid detector result.' using errcode = '22023';
  end if;

  select * into v_session from public.gate_sessions s
  where s.id = p_session_id and s.user_id = v_user_id for update;
  if not found or v_session.status <> 'monitoring' then
    raise exception 'Active gate session not found.' using errcode = '42501';
  end if;
  if now() > v_session.started_at + make_interval(mins => v_session.reconciliation_window_minutes) then
    raise exception 'Reconciliation window has ended. Finish this session before recording more movement.'
      using errcode = '22023';
  end if;

  select * into v_verification
  from public.gate_qr_verifications q
  where q.id = p_verification_id and q.session_id = v_session.id
    and q.user_id = v_user_id and q.used_at is null and q.expires_at > now()
  for update;
  if not found then
    raise exception 'QR verification expired or already used. Scan the QR again.' using errcode = '22023';
  end if;
  if not (v_verification.animal_id = any(v_session.expected_animal_ids)) then
    raise exception 'Animal is not in this session expected herd.' using errcode = '22023';
  end if;

  select lower(a.species) into v_species from public.animals a
  where a.id = v_verification.animal_id and a.user_id = v_user_id and coalesce(a.archived, false) = false;
  if not found then
    raise exception 'Animal is no longer active in this farm.' using errcode = '22023';
  end if;
  if v_species <> p_species_detected then
    raise exception 'QR species does not match the live detector.' using errcode = '22023';
  end if;

  select * into v_event from public.gate_events e
  where e.session_id = p_session_id and e.animal_id = v_verification.animal_id
    and e.direction = p_direction and e.created_at >= now() - interval '20 seconds'
  order by e.created_at desc limit 1;
  if found then
    update public.gate_qr_verifications set used_at = now() where id = v_verification.id;
    return jsonb_build_object('success', true, 'duplicate', true, 'event_id', v_event.id);
  end if;

  insert into public.gate_events (
    session_id, user_id, gate_id, animal_id, direction, species_detected,
    qr_verified, confidence, tracking_id
  ) values (
    v_session.id, v_user_id, v_session.gate_id, v_verification.animal_id, p_direction,
    p_species_detected, true, p_confidence, left(coalesce(p_tracking_id, ''), 128)
  ) returning * into v_event;
  update public.gate_qr_verifications set used_at = now() where id = v_verification.id;

  update public.gate_sessions s
  set entered_count = (select count(*) from public.gate_events e where e.session_id = s.id and e.direction = 'entry'),
      exited_count = (select count(*) from public.gate_events e where e.session_id = s.id and e.direction = 'exit')
  where s.id = v_session.id;

  return jsonb_build_object('success', true, 'duplicate', false, 'event_id', v_event.id);
end;
$$;

create or replace function public.verify_gate_qr(p_session_id uuid, p_qr_payload text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_payload jsonb;
  v_reference text;
  v_match text[];
  v_animal public.animals%rowtype;
  v_verification_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if p_qr_payload is null or length(trim(p_qr_payload)) = 0 or length(p_qr_payload) > 2048 then
    return jsonb_build_object('verified', false, 'message', 'QR content is empty or invalid.');
  end if;
  select * into v_session from public.gate_sessions s
  where s.id = p_session_id and s.user_id = v_user_id and s.status = 'monitoring';
  if not found then
    raise exception 'Active gate session not found.' using errcode = '42501';
  end if;
  if now() > v_session.started_at + make_interval(mins => v_session.reconciliation_window_minutes) then
    raise exception 'Reconciliation window has ended. Start a new session for another gate check.'
      using errcode = '22023';
  end if;

  if left(trim(p_qr_payload), 1) = '{' then
    begin
      v_payload := trim(p_qr_payload)::jsonb;
    exception when others then
      return jsonb_build_object('verified', false, 'message', 'QR content is not valid AlpasFarm data.');
    end;
    if coalesce(v_payload->>'type', '') <> 'alpasfarm_animal'
       or coalesce(v_payload->>'farmId', '') <> v_user_id::text
       or coalesce(v_payload->>'animalId', '') = '' then
      return jsonb_build_object('verified', false, 'message', 'QR does not belong to this farm.');
    end if;
    v_reference := v_payload->>'animalId';
  else
    select (regexp_match(trim(p_qr_payload), '/(animals|public)/([^/?#]+)', 'i'))[2]
      into v_reference;
    if v_reference is null or v_reference = '' then
      v_reference := trim(p_qr_payload);
    end if;
  end if;

  select a.* into v_animal from public.animals a
  where a.user_id = v_user_id
    and coalesce(a.archived, false) = false
    and a.id = any(v_session.expected_animal_ids)
    and (a.id::text = v_reference or lower(a.tag_id) = lower(v_reference))
  limit 1;
  if not found then
    return jsonb_build_object('verified', false, 'message', 'Animal is not an active registered member of this session.');
  end if;

  insert into public.gate_qr_verifications (user_id, session_id, animal_id)
  values (v_user_id, v_session.id, v_animal.id)
  returning id into v_verification_id;

  return jsonb_build_object(
    'verified', true,
    'verification_id', v_verification_id,
    'animal_id', v_animal.id,
    'farm_id', v_animal.user_id,
    'name', v_animal.name,
    'tag_id', v_animal.tag_id,
    'species', lower(v_animal.species),
    'breed', v_animal.breed,
    'photo_url', v_animal.photo_url
  );
end;
$$;

create or replace function public.finish_gate_session(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_missing_ids uuid[];
  v_entered integer;
  v_exited integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  select * into v_session from public.gate_sessions s
  where s.id = p_session_id and s.user_id = v_user_id for update;
  if not found or v_session.status <> 'monitoring' then
    raise exception 'Active gate session not found.' using errcode = '42501';
  end if;
  if now() < v_session.started_at + make_interval(mins => v_session.reconciliation_window_minutes) then
    raise exception 'The reconciliation window is still open.' using errcode = '22023';
  end if;

  select coalesce(array_agg(expected.animal_id order by expected.animal_id), '{}')
    into v_missing_ids
  from unnest(v_session.expected_animal_ids) as expected(animal_id)
  join public.animals a on a.id = expected.animal_id and a.user_id = v_user_id
  where coalesce(a.archived, false) = false
    and not exists (
      select 1 from public.gate_events e
      where e.session_id = v_session.id and e.animal_id = expected.animal_id and e.qr_verified
    );

  select count(*) filter (where direction = 'entry'), count(*) filter (where direction = 'exit')
    into v_entered, v_exited
  from public.gate_events where session_id = v_session.id;

  update public.gate_sessions
  set status = 'reconciled', ended_at = now(), entered_count = v_entered,
      exited_count = v_exited, missing_count = cardinality(v_missing_ids)
  where id = v_session.id;

  insert into public.gate_alerts (session_id, user_id, animal_id, alert_type, message)
  select v_session.id, v_user_id, a.id, 'unaccounted',
         'Needs verification: ' || a.name || ' (' || a.tag_id || ') was not verified in this session.'
  from unnest(v_missing_ids) as missing(animal_id)
  join public.animals a on a.id = missing.animal_id and a.user_id = v_user_id
  on conflict (session_id, animal_id, alert_type) do nothing;

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'expected_count', v_session.expected_count,
    'entered_count', v_entered, 'exited_count', v_exited,
    'unaccounted_ids', to_jsonb(v_missing_ids),
    'unaccounted_count', cardinality(v_missing_ids)
  );
end;
$$;

create or replace function public.set_gate_alert_status(p_alert_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if p_status not in ('acknowledged', 'resolved') then
    raise exception 'Unsupported alert status.' using errcode = '22023';
  end if;
  update public.gate_alerts
  set status = p_status, resolved_at = case when p_status = 'resolved' then now() else null end
  where id = p_alert_id and user_id = auth.uid() and status <> 'resolved';
  if not found then
    raise exception 'Alert not found or already resolved.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.cancel_gate_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  update public.gate_sessions set status = 'cancelled', ended_at = now()
  where id = p_session_id and user_id = auth.uid() and status = 'monitoring';
  if not found then
    raise exception 'Active gate session not found.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.start_gate_session(uuid, uuid[], integer) from public;
revoke all on function public.record_gate_movement(uuid, uuid, text, text, numeric, text) from public;
revoke all on function public.verify_gate_qr(uuid, text) from public;
revoke all on function public.finish_gate_session(uuid) from public;
revoke all on function public.set_gate_alert_status(uuid, text) from public;
revoke all on function public.cancel_gate_session(uuid) from public;
grant execute on function public.start_gate_session(uuid, uuid[], integer) to authenticated;
grant execute on function public.record_gate_movement(uuid, uuid, text, text, numeric, text) to authenticated;
grant execute on function public.verify_gate_qr(uuid, text) to authenticated;
grant execute on function public.finish_gate_session(uuid) to authenticated;
grant execute on function public.set_gate_alert_status(uuid, text) to authenticated;
grant execute on function public.cancel_gate_session(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gate_events') then
      alter publication supabase_realtime add table public.gate_events;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gate_alerts') then
      alter publication supabase_realtime add table public.gate_alerts;
    end if;
  end if;
end;
$$;
