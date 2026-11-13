-- Read-only. The morning call sheet's figures; run as one statement, pass the single row to morning-report.mjs.
with l as (select l.*, p.full_name as rep from public.leads l left join public.profiles p on p.id = l.owner_id where not l.do_not_contact),
d as (select (date_trunc('day', now() at time zone 'Europe/London')) at time zone 'Europe/London' as t0)
select
  (select coalesce(json_agg(json_build_object('name', name, 'time', to_char(call_date at time zone 'Europe/London', 'HH24:MI'), 'phone', contact_phone, 'rep', rep) order by call_date), '[]') from l, d where stage = 'call_booked' and call_date >= d.t0 and call_date < d.t0 + interval '1 day') as calls_today,
  (select coalesce(json_agg(json_build_object('name', name, 'was', to_char(call_date at time zone 'Europe/London', 'Dy DD Mon HH24:MI'), 'rep', rep) order by call_date), '[]') from l, d where stage = 'call_booked' and call_date < now() and call_outcome is null) as calls_to_log,
  (select count(*) from l where stage in ('replied','closed_interested') and (next_action_at is null or next_action_at <= (now() at time zone 'Europe/London')::date)) as replies_waiting,
  (select count(*) from l where stage = 'dm_opened' and next_action_at <= (now() at time zone 'Europe/London')::date) as follow_ups_due,
  (select count(*) from l where stage = 'new' and owner_id is null) as pool,
  (select count(*) from public.profiles where approved and role in ('owner','team_leader','business_development','setter')) as reps,
  (select count(*) from public.profiles where not approved) as awaiting_approval,
  (select count(*) from l, d where last_contacted_at >= d.t0 - interval '1 day' and last_contacted_at < d.t0) as messages_sent_yesterday,
  (select count(*) from l, d where call_outcome_at >= d.t0 - interval '1 day' and call_outcome_at < d.t0) as calls_logged_yesterday,
  (select count(*) from l, d where call_outcome = 'won' and call_outcome_at >= d.t0 - interval '1 day' and call_outcome_at < d.t0) as won_yesterday;
