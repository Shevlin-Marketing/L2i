-- Read-only. The weekly report's figures for the seven London days up to now; one row, passed to weekly-report.mjs.
with d as (select (date_trunc('day', now() at time zone 'Europe/London') - interval '6 days') at time zone 'Europe/London' as t0, now() as t1),
l as (select l.*, p.full_name as rep from public.leads l left join public.profiles p on p.id = l.owner_id where not l.do_not_contact)
select
  (select to_char(t0 at time zone 'Europe/London', 'Dy DD Mon') from d) as period_from,
  (select to_char(t1 at time zone 'Europe/London', 'Dy DD Mon') from d) as period_to,
  (select count(*) from l, d where created_at >= d.t0) as leads_added,
  (select count(*) from l, d where last_contacted_at >= d.t0 and stage <> 'new') as messaged,
  (select count(*) from l, d where permission_at >= d.t0 and permission_status = 'granted') as said_yes,
  (select count(*) from public.leads, d where do_not_contact and opted_out_at >= d.t0) as said_no,
  (select count(*) from l, d where call_date >= d.t0 and call_date < d.t1) as calls_due_this_week,
  (select count(*) from l, d where call_outcome_at >= d.t0) as calls_logged,
  (select count(*) from l, d where call_outcome = 'won' and call_outcome_at >= d.t0) as won,
  (select count(*) from l, d where call_outcome = 'no_show' and call_outcome_at >= d.t0) as no_shows,
  (select coalesce(json_agg(json_build_object('stage', stage, 'n', n)), '[]') from (select stage, count(*) n from l group by stage) s) as pipeline,
  (select coalesce(json_agg(json_build_object('name', name, 'when', to_char(call_date at time zone 'Europe/London', 'Dy DD Mon HH24:MI'), 'phone', contact_phone, 'rep', rep) order by call_date), '[]') from l, d where stage = 'call_booked' and call_date >= d.t1 and call_date < d.t1 + interval '7 days') as calls_next_week,
  (select coalesce(json_agg(json_build_object('name', name, 'was', to_char(call_date at time zone 'Europe/London', 'Dy DD Mon HH24:MI'), 'rep', rep) order by call_date), '[]') from l where stage = 'call_booked' and call_date < now() and call_outcome is null) as calls_to_log,
  (select count(*) from l where stage in ('replied','closed_interested') and (next_action_at is null or next_action_at <= (now() at time zone 'Europe/London')::date)) as replies_waiting,
  (select count(*) from l where stage = 'dm_opened' and next_action_at <= (now() at time zone 'Europe/London')::date) as follow_ups_due,
  (select count(*) from l where stage not in ('new','closed_not_interested','lost') and contact_handle is null and contact_phone is null) as missing_contact,
  (select coalesce(json_agg(r order by r.messaged desc), '[]') from (
     select p.full_name as rep,
       count(l.*) filter (where l.last_contacted_at >= d.t0 and l.stage <> 'new') as messaged,
       count(l.*) filter (where l.permission_at >= d.t0 and l.permission_status = 'granted') as said_yes,
       count(l.*) filter (where l.stage = 'call_booked' and l.call_date >= now()) as calls_ahead,
       count(l.*) filter (where l.call_outcome = 'won' and l.call_outcome_at >= d.t0) as won
     from public.profiles p cross join d left join l on l.owner_id = p.id
     where p.approved group by p.full_name) r) as reps;
