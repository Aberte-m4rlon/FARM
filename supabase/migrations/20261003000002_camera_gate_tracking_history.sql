-- Additive camera-gate tracking, persistent gate setup, and animal camera history.
-- Existing animals, events, sessions, and QR records are preserved.

alter table public.gate_sessions
  add column if not exists gate_line_y numeric(4,3) not null default 0.550,
  add column if not exists max_visible_tracks integer not null default 0,
  add column if not exists entry_flow text not null default 'top-to-bottom';

alter table public.gate_sessions
  drop constraint if exists gate_sessions_gate_line_y_check,
  add constraint gate_sessions_gate_line_y_check check (gate_line_y between 0.250 and 0.750),
  drop constraint if exists gate_sessions_entry_flow_check,
  add constraint gate_sessions_entry_flow_check check (entry_flow in ('top-to-bottom', 'bottom-to-top')),
  drop constraint if exists gate_sessions_max_visible_tracks_check,
  add constraint gate_sessions_max_visible_tracks_check check (max_visible_tracks >= 0);

alter table public.gate_events
  add column if not exists movement_observation text not null default 'normal';

alter table public.gate_events
  drop constraint if exists gate_events_movement_observation_check,
  add constraint gate_events_movement_observation_check
    check (movement_observation in ('normal', 'slow_approach', 'prolonged_stop'));

alter table public.gate_alerts
  drop constraint if exists gate_alerts_alert_type_check,
  add constraint gate_alerts_alert_type_check
    check (alert_type in ('unaccounted', 'movement_observation'));

alter table public.animals
  add column if not exists camera_last_seen_at timestamptz,
  add column if not exists camera_last_qr_at timestamptz;

create index if not exists animals_user_camera_last_seen_idx
  on public.animals(user_id, camera_last_seen_at desc)
  where camera_last_seen_at is not null;

-- Persist anonymous camera events separately from QR-verified animal events.
-- A temporary tracker ID must never be treated as an animal primary key.
create table if not exists public.gate_camera_crossings (
  id uuid primary key default gen_random_uuid(),
  crossing_key uuid not null,
  session_id uuid not null references public.gate_sessions(id) on delete cascade,
  gate_id uuid not null references public.gate_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tracking_id text not null,
  species_detected text not null check (species_detected in ('goat', 'sheep')),
  direction text not null check (direction in ('entry', 'exit')),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  movement_observation text not null default 'normal'
    check (movement_observation in ('normal', 'slow_approach', 'prolonged_stop')),
  created_at timestamptz not null default now(),
  unique (session_id, crossing_key),
  check (tracking_id ~ '^T-[0-9]{3,}$')
);

create index if not exists gate_camera_crossings_user_session_created_idx
  on public.gate_camera_crossings(user_id, session_id, created_at desc);

alter table public.gate_camera_crossings
  add column if not exists animal_id uuid references public.animals(id) on delete set null,
  add column if not exists event_id uuid references public.gate_events(id) on delete set null,
  add column if not exists qr_verified boolean not null default false;

create unique index if not exists gate_camera_crossings_event_id_unique
  on public.gate_camera_crossings(event_id)
  where event_id is not null;

create table if not exists public.gate_live_tracks (
  session_id uuid not null references public.gate_sessions(id) on delete cascade,
  gate_id uuid not null references public.gate_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tracking_id text not null check (tracking_id ~ '^T-[0-9]{3,}$'),
  species_detected text not null check (species_detected in ('goat', 'sheep')),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  last_seen_at timestamptz not null default now(),
  primary key (session_id, tracking_id)
);

create index if not exists gate_live_tracks_user_recent_idx
  on public.gate_live_tracks(user_id, last_seen_at desc);

alter table public.gate_camera_crossings enable row level security;
alter table public.gate_live_tracks enable row level security;

drop policy if exists gate_camera_crossings_select_own on public.gate_camera_crossings;
create policy gate_camera_crossings_select_own on public.gate_camera_crossings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists gate_live_tracks_select_own on public.gate_live_tracks;
create policy gate_live_tracks_select_own on public.gate_live_tracks
  for select to authenticated using (user_id = auth.uid());

revoke all on public.gate_camera_crossings from anon, authenticated;
grant select on public.gate_camera_crossings to authenticated;
revoke all on public.gate_live_tracks from anon, authenticated;
grant select on public.gate_live_tracks to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gate_camera_crossings'
    ) then
      execute 'alter publication supabase_realtime add table public.gate_camera_crossings';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gate_live_tracks'
    ) then
      execute 'alter publication supabase_realtime add table public.gate_live_tracks';
    end if;
  end if;
end;
$$;

create or replace function public.record_gate_camera_crossing(
  p_session_id uuid,
  p_crossing_key uuid,
  p_tracking_id text,
  p_species_detected text,
  p_direction text,
  p_confidence numeric,
  p_movement_observation text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_crossing_id uuid;
  v_duplicate boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if p_tracking_id !~ '^T-[0-9]{3,}$'
     or p_species_detected not in ('goat', 'sheep')
     or p_direction not in ('entry', 'exit')
     or p_confidence is null or p_confidence < 0 or p_confidence > 1
     or p_movement_observation not in ('normal', 'slow_approach', 'prolonged_stop') then
    raise exception 'Invalid anonymous camera crossing.' using errcode = '22023';
  end if;

  select * into v_session from public.gate_sessions s
  where s.id = p_session_id and s.user_id = v_user_id and s.status = 'monitoring';
  if not found then
    raise exception 'Active gate session not found.' using errcode = '42501';
  end if;

  insert into public.gate_camera_crossings (
    crossing_key, session_id, gate_id, user_id, tracking_id,
    species_detected, direction, confidence, movement_observation
  ) values (
    p_crossing_key, v_session.id, v_session.gate_id, v_user_id, p_tracking_id,
    p_species_detected, p_direction, p_confidence, p_movement_observation
  ) on conflict (session_id, crossing_key) do nothing
  returning id into v_crossing_id;

  if v_crossing_id is null then
    v_duplicate := true;
    select id into v_crossing_id from public.gate_camera_crossings
    where session_id = v_session.id and crossing_key = p_crossing_key;
  end if;

  with matching as (
    select crossing.id as crossing_id, event.id as event_id, event.animal_id
    from public.gate_camera_crossings crossing
    join lateral (
      select candidate.id, candidate.animal_id
      from public.gate_events candidate
      where candidate.session_id = v_session.id and candidate.user_id = v_user_id
        and candidate.tracking_id = p_tracking_id and candidate.direction = p_direction and candidate.qr_verified
        and candidate.created_at between crossing.created_at and crossing.created_at + interval '20 seconds'
        and not exists (
          select 1 from public.gate_camera_crossings linked
          where linked.event_id = candidate.id and linked.id <> crossing.id
        )
      order by abs(extract(epoch from (candidate.created_at - crossing.created_at)))
      limit 1
    ) event on true
    where crossing.id = v_crossing_id and not crossing.qr_verified
  )
  update public.gate_camera_crossings crossing
  set animal_id = matching.animal_id, event_id = matching.event_id, qr_verified = true
  from matching
  where crossing.id = matching.crossing_id;

  return jsonb_build_object(
    'success', true,
    'duplicate', v_duplicate,
    'crossing_id', v_crossing_id
  );
end;
$$;

create or replace function public.get_gate_camera_metrics(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_crossings integer;
  v_identified integer;
  v_entry integer;
  v_exit integer;
  v_verified_entry integer;
  v_verified_exit integer;
  v_live integer;
  v_live_goats integer;
  v_live_sheep integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  select * into v_session from public.gate_sessions s
  where s.id = p_session_id and s.user_id = v_user_id;
  if not found then
    raise exception 'Gate session not found.' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where c.qr_verified),
         count(*) filter (where c.direction = 'entry'),
         count(*) filter (where c.direction = 'exit')
    into v_crossings, v_identified, v_entry, v_exit
  from public.gate_camera_crossings c
  where c.session_id = v_session.id and c.user_id = v_user_id;

  select count(*) filter (where e.direction = 'entry'),
         count(*) filter (where e.direction = 'exit')
    into v_verified_entry, v_verified_exit
  from public.gate_events e
  where e.session_id = v_session.id and e.user_id = v_user_id and e.qr_verified;

  select count(*), count(*) filter (where species_detected = 'goat'),
         count(*) filter (where species_detected = 'sheep')
    into v_live, v_live_goats, v_live_sheep
  from public.gate_live_tracks live
  where live.session_id = v_session.id and live.user_id = v_user_id
    and live.last_seen_at >= now() - interval '10 seconds';

  return jsonb_build_object(
    'session_id', v_session.id,
    'crossing_count', v_crossings,
    'identified_crossing_count', v_identified,
    'unidentified_crossing_count', v_crossings - v_identified,
    'camera_entry_count', v_entry,
    'camera_exit_count', v_exit,
    'verified_entry_count', v_verified_entry,
    'verified_exit_count', v_verified_exit,
    'live_track_count', v_live,
    'live_goat_count', v_live_goats,
    'live_sheep_count', v_live_sheep
  );
end;
$$;

create or replace function public.sync_gate_live_tracks(
  p_session_id uuid,
  p_tracks jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.gate_sessions%rowtype;
  v_tracks jsonb := coalesce(p_tracks, '[]'::jsonb);
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if jsonb_typeof(v_tracks) <> 'array' or jsonb_array_length(v_tracks) > 100 then
    raise exception 'Invalid live track list.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_tracks) track(value)
    where coalesce(track.value->>'trackingId', '') !~ '^T-[0-9]{3,}$'
       or track.value->>'species' not in ('goat', 'sheep')
       or coalesce((track.value->>'confidence')::numeric, -1) < 0
       or coalesce((track.value->>'confidence')::numeric, -1) > 1
  ) or (
    select count(*) <> count(distinct track.value->>'trackingId')
    from jsonb_array_elements(v_tracks) track(value)
  ) then
    raise exception 'Invalid or duplicate live track.' using errcode = '22023';
  end if;

  select * into v_session from public.gate_sessions s
  where s.id = p_session_id and s.user_id = v_user_id and s.status = 'monitoring';
  if not found then
    raise exception 'Active gate session not found.' using errcode = '42501';
  end if;

  insert into public.gate_live_tracks (
    session_id, gate_id, user_id, tracking_id, species_detected, confidence, last_seen_at
  )
  select v_session.id, v_session.gate_id, v_user_id,
         track.value->>'trackingId', track.value->>'species',
         (track.value->>'confidence')::numeric, now()
  from jsonb_array_elements(v_tracks) track(value)
  on conflict (session_id, tracking_id) do update
    set confidence = excluded.confidence, last_seen_at = excluded.last_seen_at;

  delete from public.gate_live_tracks live
  where live.session_id = v_session.id and live.user_id = v_user_id
    and not exists (
      select 1 from jsonb_array_elements(v_tracks) track(value)
      where track.value->>'trackingId' = live.tracking_id
    );

  select count(*) into v_count from public.gate_live_tracks live
  where live.session_id = v_session.id and live.user_id = v_user_id;
  update public.gate_sessions
  set max_visible_tracks = greatest(max_visible_tracks, v_count)
  where id = v_session.id and user_id = v_user_id;
  return jsonb_build_object('success', true, 'live_track_count', v_count);
end;
$$;

create or replace function public.clear_gate_live_tracks(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.gate_sessions s
    where s.id = p_session_id and s.user_id = auth.uid()
  ) then
    raise exception 'Gate session not found.' using errcode = '42501';
  end if;
  delete from public.gate_live_tracks
  where session_id = p_session_id and user_id = auth.uid();
end;
$$;

create or replace function public.clear_inactive_gate_live_tracks()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status <> 'monitoring' then
    delete from public.gate_live_tracks
    where session_id = new.id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists gate_sessions_clear_live_tracks on public.gate_sessions;
create trigger gate_sessions_clear_live_tracks
  after update of status on public.gate_sessions
  for each row execute function public.clear_inactive_gate_live_tracks();

drop function if exists public.start_gate_session(uuid, uuid[], integer);
create function public.start_gate_session(
  p_gate_id uuid,
  p_expected_animal_ids uuid[],
  p_reconciliation_window_minutes integer default 60,
  p_gate_line_y numeric default 0.550,
  p_entry_flow text default 'top-to-bottom'
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
  if p_gate_line_y < 0.250 or p_gate_line_y > 0.750 then
    raise exception 'Gate line must be between 25 and 75 percent of the camera view.' using errcode = '22023';
  end if;
  if p_entry_flow not in ('top-to-bottom', 'bottom-to-top') then
    raise exception 'Unsupported gate entry direction.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.gate_devices g
    where g.id = p_gate_id and g.user_id = v_user_id and g.is_active
  ) then
    raise exception 'Gate is not available to this farm.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.gate_sessions s
    where s.user_id = v_user_id and s.status = 'monitoring'
  ) then
    raise exception 'A gate monitoring session is already active for this farm.' using errcode = '55000';
  end if;

  select coalesce(array_agg(distinct requested.animal_id order by requested.animal_id), '{}')
    into v_expected_ids
  from unnest(coalesce(p_expected_animal_ids, '{}')) as requested(animal_id)
  join public.animals a
    on a.id = requested.animal_id
   and a.user_id = v_user_id
   and coalesce(a.archived, false) = false
   and coalesce(a.is_sold, false) = false
   and lower(coalesce(a.status, '')) not in ('sold', 'deceased', 'transferred')
   and lower(a.species) in ('goat', 'sheep');

  if cardinality(v_expected_ids) <> v_requested_count then
    raise exception 'Expected list contains duplicates, archived animals, unsupported species, or animals outside this farm.'
      using errcode = '22023';
  end if;
  if cardinality(v_expected_ids) = 0 then
    raise exception 'Register at least one active goat or sheep before starting.' using errcode = '22023';
  end if;

  insert into public.gate_sessions (
    user_id, gate_id, expected_animal_ids, expected_count, reconciliation_window_minutes,
    gate_line_y, entry_flow
  ) values (
    v_user_id, p_gate_id, v_expected_ids, cardinality(v_expected_ids),
    p_reconciliation_window_minutes, p_gate_line_y, p_entry_flow
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
    and coalesce(a.is_sold, false) = false
    and lower(coalesce(a.status, '')) not in ('sold', 'deceased', 'transferred')
    and lower(a.species) in ('goat', 'sheep');

  select coalesce(array_agg(distinct e.animal_id order by e.animal_id), '{}') into v_confirmed_ids
  from public.gate_events e
  where e.session_id = v_session.id and e.user_id = v_user_id
    and e.qr_verified and e.animal_id = any(v_expected_ids);

  select coalesce(array_agg(latest.animal_id order by latest.animal_id), '{}') into v_inside_ids
  from (
    select distinct on (e.animal_id) e.animal_id, e.direction
    from public.gate_events e
    where e.session_id = v_session.id and e.user_id = v_user_id
      and e.qr_verified and e.animal_id = any(v_expected_ids)
    order by e.animal_id, e.created_at desc, e.id desc
  ) latest
  where latest.direction = 'entry';

  select coalesce(array_agg(expected.animal_id order by expected.animal_id), '{}') into v_unaccounted_ids
  from unnest(v_expected_ids) as expected(animal_id)
  where not (expected.animal_id = any(v_inside_ids));

  return jsonb_build_object(
    'session_id', v_session.id,
    'expected_animal_ids', to_jsonb(v_expected_ids),
    'confirmed_animal_ids', to_jsonb(v_confirmed_ids),
    'inside_animal_ids', to_jsonb(v_inside_ids),
    'unaccounted_animal_ids', to_jsonb(v_unaccounted_ids)
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

  with latest_direction as (
    select distinct on (e.animal_id) e.animal_id, e.direction
    from public.gate_events e
    where e.session_id = v_session.id and e.user_id = v_user_id and e.qr_verified
    order by e.animal_id, e.created_at desc, e.id desc
  )
  select coalesce(array_agg(expected.animal_id order by expected.animal_id), '{}') into v_missing_ids
  from unnest(v_session.expected_animal_ids) as expected(animal_id)
  join public.animals a on a.id = expected.animal_id and a.user_id = v_user_id
  left join latest_direction latest on latest.animal_id = expected.animal_id
  where coalesce(a.archived, false) = false
    and coalesce(a.is_sold, false) = false
    and lower(coalesce(a.status, '')) not in ('sold', 'deceased', 'transferred')
    and latest.direction is distinct from 'entry';

  select count(*) filter (where direction = 'entry'), count(*) filter (where direction = 'exit')
    into v_entered, v_exited
  from public.gate_events where session_id = v_session.id and user_id = v_user_id and qr_verified;

  update public.gate_sessions
  set status = 'reconciled', ended_at = now(), entered_count = v_entered,
      exited_count = v_exited, missing_count = cardinality(v_missing_ids)
  where id = v_session.id;

  insert into public.gate_alerts (session_id, user_id, animal_id, alert_type, message)
  select v_session.id, v_user_id, a.id, 'unaccounted',
         'Needs verification: ' || a.name || ' (' || a.tag_id || ') was not confirmed inside at reconciliation.'
  from unnest(v_missing_ids) as missing(animal_id)
  join public.animals a on a.id = missing.animal_id and a.user_id = v_user_id
  on conflict (session_id, animal_id, alert_type) do update
    set status = 'active', message = excluded.message, resolved_at = null, created_at = now();

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'expected_count', v_session.expected_count,
    'entered_count', v_entered, 'exited_count', v_exited,
    'unaccounted_ids', to_jsonb(v_missing_ids),
    'unaccounted_count', cardinality(v_missing_ids)
  );
end;
$$;

-- Wrap the existing QR/session/species-validated movement RPC to persist the
-- camera observation and last-seen fields in the same database transaction.
create or replace function public.record_gate_movement(
  p_session_id uuid,
  p_verification_id uuid,
  p_direction text,
  p_species_detected text,
  p_confidence numeric,
  p_tracking_id text,
  p_movement_observation text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb;
  v_event public.gate_events%rowtype;
  v_animal public.animals%rowtype;
begin
  if p_movement_observation not in ('normal', 'slow_approach', 'prolonged_stop') then
    raise exception 'Unsupported camera movement observation.' using errcode = '22023';
  end if;
  if p_tracking_id !~ '^T-[0-9]{3,}$' then
    raise exception 'Camera tracking reference is invalid.' using errcode = '22023';
  end if;

  v_result := public.record_gate_movement(
    p_session_id, p_verification_id, p_direction, p_species_detected, p_confidence, p_tracking_id
  );
  if coalesce((v_result->>'success')::boolean, false)
     and not coalesce((v_result->>'duplicate')::boolean, false) then
    select * into v_event from public.gate_events e
    where e.id = (v_result->>'event_id')::uuid and e.user_id = auth.uid();
    if not found then
      raise exception 'Saved camera event could not be verified.' using errcode = '42501';
    end if;

    update public.gate_events
    set movement_observation = p_movement_observation
    where id = v_event.id and user_id = auth.uid();

    update public.gate_camera_crossings crossing
    set animal_id = v_event.animal_id, event_id = v_event.id, qr_verified = true
    where crossing.id = (
      select candidate.id
      from public.gate_camera_crossings candidate
      where candidate.session_id = v_event.session_id and candidate.user_id = auth.uid()
        and candidate.tracking_id = v_event.tracking_id and candidate.direction = v_event.direction
        and not candidate.qr_verified and candidate.created_at between v_event.created_at - interval '20 seconds' and v_event.created_at
      order by abs(extract(epoch from (v_event.created_at - candidate.created_at)))
      limit 1
    );

    update public.animals
    set camera_last_seen_at = v_event.created_at,
        camera_last_qr_at = v_event.created_at
    where id = v_event.animal_id and user_id = auth.uid()
    returning * into v_animal;
    if not found then
      raise exception 'Animal no longer belongs to this farm.' using errcode = '42501';
    end if;

    if v_event.direction = 'entry' then
      update public.gate_alerts
      set status = 'resolved', resolved_at = now()
      where animal_id = v_event.animal_id
        and user_id = auth.uid() and alert_type = 'unaccounted' and status <> 'resolved';

      if p_movement_observation in ('slow_approach', 'prolonged_stop') then
        insert into public.gate_alerts (session_id, user_id, animal_id, alert_type, message)
        values (
          v_event.session_id, auth.uid(), v_event.animal_id, 'movement_observation',
          'May napansing mabagal o matagal na paghinto habang pumapasok. Tingnan ang hayop pagkapasok nito.'
        )
        on conflict (session_id, animal_id, alert_type) do update
          set status = 'active', message = excluded.message, resolved_at = null, created_at = now();
      end if;
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.start_gate_session(uuid, uuid[], integer, numeric, text) from public;
grant execute on function public.start_gate_session(uuid, uuid[], integer, numeric, text) to authenticated;
revoke all on function public.get_gate_session_summary(uuid) from public;
grant execute on function public.get_gate_session_summary(uuid) to authenticated;
revoke all on function public.finish_gate_session(uuid) from public;
grant execute on function public.finish_gate_session(uuid) to authenticated;
revoke all on function public.record_gate_movement(uuid, uuid, text, text, numeric, text) from public, authenticated;
revoke all on function public.record_gate_movement(uuid, uuid, text, text, numeric, text, text) from public;
grant execute on function public.record_gate_movement(uuid, uuid, text, text, numeric, text, text) to authenticated;
revoke all on function public.record_gate_camera_crossing(uuid, uuid, text, text, text, numeric, text) from public;
grant execute on function public.record_gate_camera_crossing(uuid, uuid, text, text, text, numeric, text) to authenticated;
revoke all on function public.sync_gate_live_tracks(uuid, jsonb) from public;
grant execute on function public.sync_gate_live_tracks(uuid, jsonb) to authenticated;
revoke all on function public.clear_gate_live_tracks(uuid) from public;
grant execute on function public.clear_gate_live_tracks(uuid) to authenticated;
revoke all on function public.get_gate_camera_metrics(uuid) from public;
grant execute on function public.get_gate_camera_metrics(uuid) to authenticated;
