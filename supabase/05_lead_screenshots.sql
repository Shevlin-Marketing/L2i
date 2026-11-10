-- ============================================================
-- L2i CRM — screenshots kept on each lead (profile + messages),
-- and import_leads now returns lead ids and saves an email.
-- Run after 04_username_signup.sql. Safe to re-run.
-- ============================================================

-- ---------- 1. Files attached to a lead ----------
create table if not exists public.lead_files (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  path       text not null unique,
  kind       text not null default 'other' check (kind in ('profile','messages','other')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lead_files_lead_idx on public.lead_files (lead_id, created_at);
alter table public.lead_files enable row level security;
grant select, insert, delete on public.lead_files to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='lead_files' and policyname='lead_files_read') then
    create policy lead_files_read on public.lead_files for select to authenticated
      using (public.l2i_role() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='lead_files' and policyname='lead_files_insert') then
    create policy lead_files_insert on public.lead_files for insert to authenticated
      with check (public.l2i_has_role('owner','team_leader','business_development','setter','closer') and created_by = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='lead_files' and policyname='lead_files_delete') then
    create policy lead_files_delete on public.lead_files for delete to authenticated
      using (public.l2i_has_role('owner','team_leader','business_development','setter','closer'));
  end if;
end $$;

-- ---------- 2. Private storage bucket: images only, 3 MB each ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-shots', 'lead-shots', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='l2i_lead_shots_read') then
    create policy l2i_lead_shots_read on storage.objects for select to authenticated
      using (bucket_id = 'lead-shots' and public.l2i_role() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='l2i_lead_shots_insert') then
    create policy l2i_lead_shots_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'lead-shots' and public.l2i_has_role('owner','team_leader','business_development','setter','closer'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='l2i_lead_shots_delete') then
    create policy l2i_lead_shots_delete on storage.objects for delete to authenticated
      using (bucket_id = 'lead-shots' and public.l2i_has_role('owner','team_leader','business_development','setter','closer'));
  end if;
end $$;

-- ---------- 3. Import: return the new lead's id (or the existing one's), keep the email ----------
create or replace function public.import_leads(p_project uuid, p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0;
  v_h text; v_p text; v_plat text; v_name text;
  hit record; out_rows jsonb := '[]'::jsonb; v_status text; v_detail text;
  v_id uuid; v_existing uuid;
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
    v_status := 'ok'; v_detail := null; v_id := null; v_existing := null;

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
        select l.id, l.name, l.stage, l.do_not_contact, pr.name as project, pf.full_name as owner into hit
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
          if not hit.do_not_contact then v_existing := hit.id; end if;
        end if;
      end if;
    end if;

    if v_status = 'ok' then
      if v_h is not null then seen_h := seen_h || v_h; end if;
      if v_p is not null then seen_p := seen_p || v_p; end if;
      if not p_dry_run then
        begin
          insert into public.leads (project_id, name, organisation, contact_platform, contact_handle,
                                    contact_phone, contact_email, mutual_name, notes, source, source_detail,
                                    stage, owner_id, imported_by, permission_status, updated_at)
          values (p_project, coalesce(v_name, r->>'contact_handle'), nullif(trim(r->>'organisation'),''),
                  v_plat, nullif(trim(r->>'contact_handle'),''), nullif(trim(r->>'contact_phone'),''),
                  nullif(lower(trim(r->>'contact_email')),''),
                  nullif(trim(r->>'mutual_name'),''), nullif(trim(r->>'notes'),''),
                  'Screenshot import', nullif(r->>'source_detail',''),
                  'new', null, auth.uid(), 'not_asked', now())
          returning id into v_id;
          added := added + 1;
        exception when unique_violation then
          v_status := 'duplicate'; v_detail := 'Added by someone else a moment ago';
        end;
      end if;
    end if;

    out_rows := out_rows || jsonb_build_object('index', i, 'status', v_status, 'detail', v_detail,
                                               'id', v_id, 'existing_id', v_existing);
    i := i + 1;
  end loop;

  return jsonb_build_object('added', added, 'rows', out_rows);
end $$;
