-- ============================================================
-- L2i CRM — call outcomes, and password changes without email.
-- Run after 07_import_stage.sql. Safe to re-run.
-- ============================================================

-- ---------- 1. How a booked call went ----------
alter table public.leads
  add column if not exists call_outcome    text,
  add column if not exists call_outcome_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_call_outcome_chk') then
    alter table public.leads add constraint leads_call_outcome_chk
      check (call_outcome is null or call_outcome in ('no_show','interested','needs_time','not_for_them','won'));
  end if;
end $$;

create index if not exists leads_call_idx on public.leads (owner_id, call_date) where stage = 'call_booked';

-- ---------- 2. Change your own password (checks the current one) ----------
-- Accounts have no real email, so Supabase's email-based password change can't be used.
create or replace function public.l2i_change_password(p_current text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash is null or v_hash <> crypt(coalesce(p_current, ''), v_hash) then
    raise exception 'Your current password is wrong';
  end if;
  if length(coalesce(p_new, '')) < 8 then raise exception 'New password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = crypt(p_new, gen_salt('bf')), updated_at = now() where id = auth.uid();
end $$;

-- ---------- 3. The Owner resets someone else's password ----------
create or replace function public.l2i_admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.l2i_has_role('owner') then raise exception 'Only the Owner can reset passwords'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'That account was not found'; end if;
end $$;

revoke execute on function public.l2i_change_password(text, text), public.l2i_admin_set_password(uuid, text) from public, anon;
grant execute on function public.l2i_change_password(text, text), public.l2i_admin_set_password(uuid, text) to authenticated;
