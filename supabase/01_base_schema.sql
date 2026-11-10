-- ============================================================
-- L2i CRM — base schema for a new Supabase project.
--
-- Run order on an empty project:
--   1. this file
--   2. 02_import_allocation.sql
-- Both are safe to re-run.
--
-- The first person to sign up becomes the approved Owner.
-- Everyone after that waits for the Owner to approve them (Team).
-- ============================================================

-- ---------- 1. Tables ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  role       text not null default 'setter'
             check (role in ('owner','business_development','team_leader','coach','closer','setter')),
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Production stages, per project (the lead pipeline's stages live in the app)
create table if not exists public.pipeline_stages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  key        text not null,
  label      text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, key)
);

create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  name            text not null,
  organisation    text,
  contact_handle  text,
  contact_email   text,
  source          text,
  value_estimate  numeric,
  score           int,
  score_breakdown jsonb,
  stage           text not null default 'new',
  call_date       timestamptz,
  owner_id        uuid references public.profiles(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists leads_project_idx on public.leads (project_id, created_at desc);
create index if not exists leads_owner_idx   on public.leads (owner_id);

create table if not exists public.productions (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  lead_id              uuid references public.leads(id) on delete set null,
  slate_number         int,
  title                text not null,
  client_name          text,
  budget               numeric,
  production_stage     text,
  stage_entered_at     date not null default current_date,
  target_delivery_date date,
  closer_id            uuid references public.profiles(id) on delete set null,
  setter_id            uuid references public.profiles(id) on delete set null,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists productions_project_idx on public.productions (project_id, slate_number desc);
create unique index if not exists productions_lead_unique on public.productions (lead_id) where lead_id is not null;

create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  entity_type text,
  entity_id   text,
  user_id     uuid references public.profiles(id) on delete set null,
  action      text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists activity_project_idx on public.activity_log (project_id, created_at desc);

-- Bookings and wins, shown in the Report
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  lead_id    uuid references public.leads(id) on delete set null,
  type       text,
  message    text not null,
  created_at timestamptz not null default now()
);
create index if not exists notifications_project_idx on public.notifications (project_id, created_at desc);

-- Training progress
create table if not exists public.rep_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  module_key   text not null,
  quiz_score   int,
  passed       boolean not null default false,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, module_key)
);

-- ---------- 2. Role helpers (security definer so policies can read profiles) ----------
create or replace function public.l2i_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and approved;
$$;

create or replace function public.l2i_has_role(variadic roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.l2i_role() = any(roles), false);
$$;

-- ---------- 3. Sign-up: create the profile; first user is the Owner ----------
create or replace function public.l2i_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  select not exists (select 1 from public.profiles) into v_first;
  insert into public.profiles (id, full_name, email, role, approved)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
          new.email,
          case when v_first then 'owner' else 'setter' end,
          v_first)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists l2i_on_auth_user_created on auth.users;
create trigger l2i_on_auth_user_created after insert on auth.users
  for each row execute function public.l2i_handle_new_user();

-- ---------- 4. New project gets a default set of production stages ----------
create or replace function public.l2i_seed_stages()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pipeline_stages (project_id, key, label, sort_order) values
    (new.id, 'pre_production', 'Pre-production', 1),
    (new.id, 'filming',        'Filming',        2),
    (new.id, 'editing',        'Editing',        3),
    (new.id, 'review',         'Client review',  4),
    (new.id, 'delivered',      'Delivered',      5)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists l2i_project_seed_stages on public.projects;
create trigger l2i_project_seed_stages after insert on public.projects
  for each row execute function public.l2i_seed_stages();

-- ---------- 5. Slate numbers count up per project ----------
create or replace function public.l2i_set_slate_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.slate_number is null then
    perform pg_advisory_xact_lock(hashtext(new.project_id::text));
    select coalesce(max(slate_number), 0) + 1 into new.slate_number
      from public.productions where project_id = new.project_id;
  end if;
  return new;
end $$;

drop trigger if exists l2i_production_slate on public.productions;
create trigger l2i_production_slate before insert on public.productions
  for each row execute function public.l2i_set_slate_number();

-- ---------- 6. Lead stage changes: report entries, and a production when won ----------
create or replace function public.l2i_lead_stage_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner text; v_stage text;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then return new; end if;
  select full_name into v_owner from public.profiles where id = new.owner_id;

  if new.stage = 'call_booked' then
    insert into public.notifications (project_id, lead_id, type, message)
    values (new.project_id, new.id, 'call_booked',
            format('Call booked — %s%s%s%s', new.name,
                   case when new.organisation is not null then ' (' || new.organisation || ')' else '' end,
                   case when new.call_date is not null
                        then ', ' || to_char(new.call_date at time zone 'Europe/London', 'Dy DD Mon HH24:MI') else '' end,
                   case when v_owner is not null then ' · set by ' || v_owner else '' end));
  elsif new.stage = 'won' then
    insert into public.notifications (project_id, lead_id, type, message)
    values (new.project_id, new.id, 'won',
            format('Won — %s%s%s', new.name,
                   case when new.organisation is not null then ' (' || new.organisation || ')' else '' end,
                   case when v_owner is not null then ' · ' || v_owner else '' end));
    select key into v_stage from public.pipeline_stages
     where project_id = new.project_id order by sort_order limit 1;
    insert into public.productions (project_id, lead_id, title, client_name, budget, production_stage, setter_id)
    values (new.project_id, new.id, new.name, coalesce(new.organisation, new.name), new.value_estimate, v_stage, new.owner_id)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists l2i_lead_stage on public.leads;
create trigger l2i_lead_stage after insert or update of stage on public.leads
  for each row execute function public.l2i_lead_stage_changed();

-- ---------- 7. Row-level security ----------
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads           enable row level security;
alter table public.productions     enable row level security;
alter table public.activity_log    enable row level security;
alter table public.notifications   enable row level security;
alter table public.rep_progress    enable row level security;

-- profiles: you can always read your own row; approved users read everyone; only the Owner edits
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.l2i_role() is not null);
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated
  using (public.l2i_has_role('owner')) with check (public.l2i_has_role('owner'));

-- projects
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated
  using (public.l2i_role() is not null);
drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all to authenticated
  using (public.l2i_has_role('owner','business_development'))
  with check (public.l2i_has_role('owner','business_development'));

-- production stages
drop policy if exists stages_read on public.pipeline_stages;
create policy stages_read on public.pipeline_stages for select to authenticated
  using (public.l2i_role() is not null);
drop policy if exists stages_write on public.pipeline_stages;
create policy stages_write on public.pipeline_stages for all to authenticated
  using (public.l2i_has_role('owner','team_leader','business_development'))
  with check (public.l2i_has_role('owner','team_leader','business_development'));

-- leads
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select to authenticated
  using (public.l2i_role() is not null);
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated
  with check (public.l2i_has_role('owner','team_leader','business_development','setter'));
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (public.l2i_has_role('owner','team_leader','business_development','setter','closer'))
  with check (public.l2i_has_role('owner','team_leader','business_development','setter','closer'));
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (public.l2i_has_role('owner','team_leader','business_development','setter'));

-- productions: managers edit everything; the assigned closer or setter can update theirs
drop policy if exists productions_read on public.productions;
create policy productions_read on public.productions for select to authenticated
  using (public.l2i_role() is not null);
drop policy if exists productions_insert on public.productions;
create policy productions_insert on public.productions for insert to authenticated
  with check (public.l2i_has_role('owner','team_leader','business_development'));
drop policy if exists productions_update on public.productions;
create policy productions_update on public.productions for update to authenticated
  using (public.l2i_has_role('owner','team_leader','business_development')
         or (public.l2i_role() is not null and auth.uid() in (closer_id, setter_id)))
  with check (public.l2i_has_role('owner','team_leader','business_development')
         or (public.l2i_role() is not null and auth.uid() in (closer_id, setter_id)));
drop policy if exists productions_delete on public.productions;
create policy productions_delete on public.productions for delete to authenticated
  using (public.l2i_has_role('owner','team_leader','business_development'));

-- activity log: approved users read; you can only log as yourself
drop policy if exists activity_read on public.activity_log;
create policy activity_read on public.activity_log for select to authenticated
  using (public.l2i_role() is not null);
drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert to authenticated
  with check (public.l2i_role() is not null and user_id = auth.uid());

-- notifications: written only by the stage trigger
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (public.l2i_role() is not null);

-- training progress: your own, plus managers and coaches can see the team's
drop policy if exists progress_read on public.rep_progress;
create policy progress_read on public.rep_progress for select to authenticated
  using (user_id = auth.uid() or public.l2i_has_role('owner','team_leader','business_development','coach'));
drop policy if exists progress_insert on public.rep_progress;
create policy progress_insert on public.rep_progress for insert to authenticated
  with check (user_id = auth.uid() and public.l2i_role() is not null);
drop policy if exists progress_update on public.rep_progress;
create policy progress_update on public.rep_progress for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 8. Grants ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.l2i_role(), public.l2i_has_role(text[]) to authenticated;
