-- Read-only. Next Monday's call sheet, run on Friday evening. Same shape as morning-query.sql, plus for_date and recent_label.
-- "Today" in the sheet means next Monday; the activity tiles show today (the day it runs).
with dl as (select (now() at time zone 'Europe/London')::date as today),
m as (select today + (8 - extract(isodow from today))::int as monday, today from dl),
d as (select (monday::timestamp at time zone 'Europe/London') as t0, (today::timestamp at time zone 'Europe/London') as tf, monday, today from m),
l as (select l.*, p.full_name as rep from public.leads l left join public.profiles p on p.id = l.owner_id where not l.do_not_contact)
select
  (select to_char(monday, 'YYYY-MM-DD') from d) as for_date,
  (select 'Today, ' || trim(to_char(today, 'Day')) from d) as recent_label,
  (select coalesce(json_agg(json_build_object('name', name, 'time', to_char(call_date at time zone 'Europe/London', 'HH24:MI'), 'phone', contact_phone, 'rep', rep) order by call_date), '[]') from l, d where stage = 'call_booked' and call_date >= d.t0 and call_date < d.t0 + interval '1 day') as calls_today,
  (select coalesce(json_agg(json_build_object('name', name, 'was', to_char(call_date at time zone 'Europe/London', 'Dy DD Mon HH24:MI'), 'rep', rep) order by call_date), '[]') from l, d where stage = 'call_booked' and call_date < d.t0 and call_outcome is null) as calls_to_log,
  (select count(*) from l, d where stage in ('replied','closed_interested') and (next_action_at is null or next_action_at <= d.monday)) as replies_waiting,
  (select count(*) from l, d where stage = 'dm_opened' and next_action_at <= d.monday) as follow_ups_due,
  (select count(*) from l where stage = 'new' and owner_id is null) as pool,
  (select count(*) from public.profiles where approved and role in ('owner','team_leader','business_development','setter')) as reps,
  (select count(*) from public.profiles where not approved) as awaiting_approval,
  (select count(*) from l, d where last_contacted_at >= d.tf and stage <> 'new') as messages_sent_yesterday,
  (select count(*) from l, d where call_outcome_at >= d.tf) as calls_logged_yesterday,
  (select count(*) from l, d where call_outcome = 'won' and call_outcome_at >= d.tf) as won_yesterday;
