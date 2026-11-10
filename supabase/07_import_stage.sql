-- ============================================================
-- L2i CRM — imports can land at the stage the conversation has reached.
-- A lead whose messages show we've written, they've replied, or a call is
-- booked is saved at that stage and owned by the person importing it,
-- instead of going into the unworked pool.
-- Run after 06_screenshot_hash.sql. Safe to re-run.
-- ============================================================
create or replace function public.import_leads(p_project uuid, p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0;
  v_h text; v_p text; v_plat text; v_name text;
  hit record; out_rows jsonb := '[]'::jsonb; v_status text; v_detail text;
  v_id uuid; v_existing uuid;
  v_stage text; v_perm text; v_call timestamptz; v_worked boolean;
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

    -- stage the conversation has reached (only these four can be set by an import)
    v_stage := coalesce(nullif(r->>'stage',''), 'new');
    if v_stage not in ('new','dm_opened','replied','call_booked') then v_stage := 'new'; end if;
    begin v_call := nullif(r->>'call_date','')::timestamptz; exception when others then v_call := null; end;
    if v_stage = 'call_booked' and v_call is null then v_stage := 'replied'; end if;
    if v_stage <> 'call_booked' then v_call := null; end if;
    v_perm := coalesce(nullif(r->>'permission_status',''), 'not_asked');
    if v_perm not in ('not_asked','asked','granted') then v_perm := 'not_asked'; end if;
    if v_stage = 'call_booked' then v_perm := 'granted';
    elsif v_stage in ('dm_opened','replied') and v_perm = 'not_asked' then v_perm := 'asked';
    elsif v_stage = 'new' then v_perm := 'not_asked'; end if;
    v_worked := v_stage <> 'new';

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
                                    stage, owner_id, imported_by, permission_status, permission_at,
                                    call_date, last_contacted_at, next_action_at, updated_at)
          values (p_project, coalesce(v_name, r->>'contact_handle'), nullif(trim(r->>'organisation'),''),
                  v_plat, nullif(trim(r->>'contact_handle'),''), nullif(trim(r->>'contact_phone'),''),
                  nullif(lower(trim(r->>'contact_email')),''),
                  nullif(trim(r->>'mutual_name'),''), nullif(trim(r->>'notes'),''),
                  'Screenshot import', nullif(r->>'source_detail',''),
                  v_stage,
                  case when v_worked then auth.uid() end,          -- already being worked → theirs, not the pool
                  auth.uid(), v_perm,
                  case when v_perm = 'granted' then now() end,
                  v_call,
                  case when v_worked then now() end,
                  case v_stage when 'dm_opened' then current_date + 3 when 'replied' then current_date end,
                  now())
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
