-- ============================================================
-- L2i CRM — function hardening (from Supabase's security advisor).
-- Run after 02_import_allocation.sql. Safe to re-run.
-- ============================================================

-- Pin the search path on the functions that didn't set one
alter function public.l2i_guard_dnc()        set search_path = public;
alter function public.l2i_norm_handle(text)  set search_path = public;
alter function public.l2i_norm_phone(text)   set search_path = public;

-- Nothing here is callable without signing in
revoke execute on function
  public.l2i_role(), public.l2i_has_role(text[]), public.l2i_can_manage_leads(),
  public.import_leads(uuid, jsonb, boolean), public.claim_daily_leads(uuid, uuid, int, int),
  public.mark_do_not_contact(uuid, text),
  public.l2i_handle_new_user(), public.l2i_seed_stages(), public.l2i_set_slate_number(),
  public.l2i_lead_stage_changed(), public.l2i_guard_dnc()
from public, anon;

-- Trigger functions are never called directly
revoke execute on function
  public.l2i_handle_new_user(), public.l2i_seed_stages(), public.l2i_set_slate_number(),
  public.l2i_lead_stage_changed(), public.l2i_guard_dnc()
from authenticated;

-- Signed-in users need the role helpers (used by the policies) and the three RPCs;
-- each one checks the caller's role itself.
grant execute on function
  public.l2i_role(), public.l2i_has_role(text[]), public.l2i_can_manage_leads(),
  public.import_leads(uuid, jsonb, boolean), public.claim_daily_leads(uuid, uuid, int, int),
  public.mark_do_not_contact(uuid, text)
to authenticated;
