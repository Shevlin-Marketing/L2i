-- ============================================================
-- L2i CRM — remember a fingerprint of each stored screenshot, so the
-- same image isn't attached to a lead twice.
-- Run after 05_lead_screenshots.sql. Safe to re-run.
-- ============================================================
alter table public.lead_files add column if not exists hash text;
