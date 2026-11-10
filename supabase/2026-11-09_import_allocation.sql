-- ============================================================
-- L2i CRM upgrade — screenshot import, de-duplication,
-- daily 100-lead allocation, permission and opt-out tracking.
--
-- Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every step checks before it changes anything.
-- Run this BEFORE deploying the new index.html.
-- ============================================================

-- ---------- 1. Normalisation helpers ----------
-- One handle / number = one key, however it was typed.
create or replace function public.l2i_norm_handle(h text)
returns text language sql immutable as $$
  select nullif(
    lower(regexp_replace(
      regexp_replace(coalesce(h,''),
        '^\s*(https?://)?(www\.|m\.)?(instagram\.com/|tiktok\.com/@?|linkedin\.com/in/|x\.com/|twitter\.com/|facebook\.com/)?@?', '', 'i'),
      '([/?#].*$)|\s', '', 'g')),
  '');
$$;

create or replace function public.l2i_norm_phone(p text)
returns text language sql immutable as $$
  select case
    when d is null or length(d) < 9 then null
    when d like '0044%' then '0' || substr(d, 5)
    when d like '44%' and length(d) >= 12 then '0' || substr(d, 3)
    else d end
  from (select nullif(regexp_replace(coalesce(p,''), '\D', '', 'g'), '') as d) x;
$$;

-- ---------- 2. New lead columns ----------
alter table public.leads alter column owner_id drop not null;

alter table public.leads
  add column if not exists contact_platform  text default 'instagram',
  add column if not exists contact_phone     text,
  add column if not exists mutual_name       text,
  add column if not exists permission_status text not null default 'not_asked',
  add column if not exists permission_at     timestamptz,
  add column if not exists do_not_contact    boolean not null default false,
  add column if not exists opted_out_at      timestamptz,
  add column if not exists assigned_at       timestamptz,
  add column if not exists source_detail     text,
  add column if not exists imported_by       uuid,
  add column if not exists next_action_at    date,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists follow_ups        int not null default 0;

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='leads' and column_name='handle_norm') then
    alter table public.leads
      add column handle_norm text generated always as (public.l2i_norm_handle(contact_handle)) stored;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='leads' and column_name='phone_norm') then
    alter table public.leads
      add column phone_norm text generated always as (public.l2i_norm_phone(contact_phone)) stored;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='leads_permission_status_chk') then
    alter table public.leads add constraint leads_permission_status_chk
      check (permission_status in ('not_asked','asked','granted','declined'));
  end if;
end $$;

-- ---------- 3. Allow the new "new" (unworked pool) stage ----------
-- Drops any old CHECK constraint on stage; adds the value if stage is an enum.
do $$
declare r record; t text;
begin
  for r in select conname from pg_constraint
           where conrelid='public.leads'::regclass and contype='c'
             and pg_get_constraintdef(oid) ilike '%stage%' loop
    execute format('alter table public.leads drop constraint %I', r.conname);
  end loop;
  select udt_name into t from information_schema.columns
   where table_schema='public' and table_name='leads' and column_name='stage' and data_type='USER-DEFINED';
  if t is not null then
    execute format('alter type public.%I add value if not exists %L', t, 'new');
  end if;
end $$;

-- ---------- 4. Hard de-duplication across every project ----------
do $$ begin
  begin
    create unique index if not exists leads_handle_unique
      on public.leads (coalesce(contact_platform,'instagram'), handle_norm) where handle_norm is not null;
  exception when unique_violation then
    raise notice 'Existing duplicate handles found — unique index skipped. Run the duplicates query at the bottom, merge them, then re-run this file.';
    create index if not exists leads_handle_idx on public.leads (handle_norm);
  end;
  begin
    create unique index if not exists leads_phone_unique
      on public.leads (phone_norm) where phone_norm is not null;
  exception when unique_violation then
    raise notice 'Existing duplicate phone numbers found — unique index skipped. Merge them, then re-run this file.';
    create index if not exists leads_phone_idx on public.leads (phone_norm);
  end;
end $$;

create index if not exists leads_pool_idx on public.leads (project_id, stage, owner_id) where owner_id is null;
create index if not exists leads_assigned_idx on public.leads (owner_id, assigned_at);
create index if not exists leads_due_idx on public.leads (owner_id, next_action_at) where next_action_at is not null;

-- ---------- 5. Permanent do-not-contact list ----------
-- Survives lead deletion, so an opted-out person can never be re-imported.
create table if not exists public.do_not_contact (
  id          uuid primary key default gen_random_uuid(),
  platform    text,
  handle_norm text,
  phone_norm  text,
  name        text,
  reason      text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create unique index if not exists dnc_handle_unique on public.do_not_contact (handle_norm) where handle_norm is not null;
create unique index if not exists dnc_phone_unique  on public.do_not_contact (phone_norm)  where phone_norm  is not null;
alter table public.do_not_contact enable row level security;
drop policy if exists dnc_read on public.do_not_contact;
create policy dnc_read on public.do_not_contact for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved));

-- ---------- 6. Shared permission check ----------
create or replace function public.l2i_can_manage_leads()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.approved
                   and p.role in ('owner','team_leader','business_development','setter'));
$$;

-- ---------- 7. Import (with dry run) ----------
-- p_rows: [{name, organisation, contact_platform, contact_handle, contact_phone,
--           mutual_name, notes, source_detail}]
create or replace function public.import_leads(p_project uuid, p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0;
  v_h text; v_p text; v_plat text; v_name text;
  hit record; out_rows jsonb := '[]'::jsonb; v_status text; v_detail text;
  seen_h text[] := '{}'; seen_p text[] := '{}';
  added int := 0;
begin
  if not public.l2i_can_manage_leads() then
    raise exception 'Not allowed to import leads';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(trim(r->>'name'), '');
    v_plat := coalesce(nullif(r->>'contact_platform',''), 'instagram');
    v_h := public.l2i_norm_handle(r->>'contact_handle');
    v_p := public.l2i_norm_phone(r->>'contact_phone');
    v_status := 'ok'; v_detail := null;

    if v_name is null and v_h is null then
      v_status := 'invalid'; v_detail := 'Needs a name or handle';
    elsif (v_h is not null and v_h = any(seen_h)) or (v_p is not null and v_p = any(seen_p)) then
      v_status := 'duplicate'; v_detail := 'Appears twice in this import';
    else
      select d.name, d.reason into hit from public.do_not_contact d
       where (v_h is not null and d.handle_norm = v_h) or (v_p is not null and d.phone_norm = v_p) limit 1;
      if found then
        v_status := 'blocked'; v_detail := 'On the do-not-contact list';
      else
        select l.name, l.stage, pr.name as project, pf.full_name as owner into hit
          from public.leads l
          left join public.projects pr on pr.id = l.project_id
          left join public.profiles pf on pf.id = l.owner_id
         where (v_h is not null and l.handle_norm = v_h and coalesce(l.contact_platform,'instagram') = v_plat)
            or (v_p is not null and l.phone_norm = v_p)
            or (v_h is null and v_p is null and lower(l.name) = lower(v_name)
                and lower(coalesce(l.organisation,'')) = lower(coalesce(r->>'organisation','')))
         limit 1;
        if found then
          v_status := 'duplicate';
          v_detail := format('Already in %s (%s, %s)', coalesce(hit.project,'another project'),
                             hit.stage, coalesce(hit.owner,'unassigned'));
        end if;
      end if;
    end if;

    if v_status = 'ok' then
      if v_h is not null then seen_h := seen_h || v_h; end if;
      if v_p is not null then seen_p := seen_p || v_p; end if;
      if not p_dry_run then
        begin
          insert into public.leads (project_id, name, organisation, contact_platform, contact_handle,
                                    contact_phone, mutual_name, notes, source, source_detail,
                                    stage, owner_id, imported_by, permission_status, updated_at)
          values (p_project, coalesce(v_name, r->>'contact_handle'), nullif(trim(r->>'organisation'),''),
                  v_plat, nullif(trim(r->>'contact_handle'),''), nullif(trim(r->>'contact_phone'),''),
                  nullif(trim(r->>'mutual_name'),''), nullif(trim(r->>'notes'),''),
                  'Screenshot import', nullif(r->>'source_detail',''),
                  'new', null, auth.uid(), 'not_asked', now());
          added := added + 1;
        exception when unique_violation then
          v_status := 'duplicate'; v_detail := 'Added by someone else a moment ago';
        end;
      end if;
    end if;

    out_rows := out_rows || jsonb_build_object('index', i, 'status', v_status, 'detail', v_detail);
    i := i + 1;
  end loop;

  return jsonb_build_object('added', added, 'rows', out_rows);
end $$;

-- ---------- 8. Daily allocation ----------
-- Gives a rep up to p_cap fresh leads per day (Europe/London), never shared.
-- Unworked leads (still "new", permission never asked) return to the pool after p_recycle_days.
-- Leads with a mutual connection are handed out first.
create or replace function public.claim_daily_leads(p_project uuid, p_user uuid default null,
                                                    p_cap int default 100, p_recycle_days int default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_target uuid := coalesce(p_user, auth.uid());
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'Europe/London')) at time zone 'Europe/London';
  v_have int; v_need int; v_got int; v_recycled int; v_pool int;
begin
  if not public.l2i_can_manage_leads() then raise exception 'Not allowed'; end if;
  if v_target <> auth.uid() and not exists (
       select 1 from public.profiles where id = auth.uid() and role in ('owner','team_leader','business_development')) then
    raise exception 'Only owners and team leaders can allocate to someone else';
  end if;
  if not exists (select 1 from public.profiles where id = v_target and approved) then
    raise exception 'That rep is not approved';
  end if;

  update public.leads set owner_id = null, assigned_at = null, updated_at = now()
   where stage = 'new' and permission_status = 'not_asked' and owner_id is not null
     and assigned_at < now() - make_interval(days => p_recycle_days);
  get diagnostics v_recycled = row_count;

  select count(*) into v_have from public.leads where owner_id = v_target and assigned_at >= v_day_start;
  v_need := greatest(p_cap - v_have, 0);

  with picked as (
    select id from public.leads
     where project_id = p_project and stage = 'new' and owner_id is null and not do_not_contact
     order by (mutual_name is null), score desc nulls last, created_at
     for update skip locked
     limit v_need)
  update public.leads l set owner_id = v_target, assigned_at = now(), updated_at = now()
    from picked where l.id = picked.id;
  get diagnostics v_got = row_count;

  select count(*) into v_pool from public.leads
   where project_id = p_project and stage = 'new' and owner_id is null and not do_not_contact;

  return jsonb_build_object('claimed', v_got, 'today', v_have + v_got, 'cap', p_cap,
                            'pool_left', v_pool, 'recycled', v_recycled);
end $$;

-- ---------- 9. Opt-out ----------
create or replace function public.mark_do_not_contact(p_lead uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if not public.l2i_can_manage_leads() then raise exception 'Not allowed'; end if;
  select * into l from public.leads where id = p_lead;
  if not found then raise exception 'Lead not found'; end if;
  update public.leads set do_not_contact = true, opted_out_at = now(),
         permission_status = case when permission_status = 'granted' then permission_status else 'declined' end,
         updated_at = now()
   where id = p_lead;
  if l.handle_norm is not null or l.phone_norm is not null then
    insert into public.do_not_contact (platform, handle_norm, phone_norm, name, reason, created_by)
    values (l.contact_platform, l.handle_norm, l.phone_norm, l.name, p_reason, auth.uid())
    on conflict do nothing;
  end if;
end $$;

grant execute on function public.l2i_norm_handle(text), public.l2i_norm_phone(text) to authenticated;
grant execute on function public.import_leads(uuid, jsonb, boolean)              to authenticated;
grant execute on function public.claim_daily_leads(uuid, uuid, int, int)        to authenticated;
grant execute on function public.mark_do_not_contact(uuid, text)                to authenticated;
revoke execute on function public.import_leads(uuid, jsonb, boolean), public.claim_daily_leads(uuid, uuid, int, int),
                           public.mark_do_not_contact(uuid, text) from anon;

notify pgrst, 'reload schema';

-- ---------- Duplicates report (run separately if a notice appeared) ----------
-- select coalesce(contact_platform,'instagram') platform, handle_norm, count(*), array_agg(name)
--   from public.leads where handle_norm is not null group by 1,2 having count(*) > 1;
-- select phone_norm, count(*), array_agg(name)
--   from public.leads where phone_norm is not null group by 1 having count(*) > 1;
