-- Read-only. Week in review: this week (Monday 00:00 London to now), this week's leads only. One row, passed to weekly-report.mjs.
with d as (select (date_trunc('week', now() at time zone 'Europe/London')) at time zone 'Europe/London' as t0, now() as t1, 'Week in review'::text as title),
l as (select l.*, p.full_name as rep from public.leads l left join public.profiles p on p.id = l.owner_id where not l.do_not_contact),
-- this period's leads: anyone messaged in the period, or whose call fell in the period or is booked in the next 7 days
a as (select l.* from l, d where l.last_contacted_at >= d.t0 or (l.call_date >= d.t0 and l.call_date < d.t1 + interval '7 days'))
select
  (select title from d) as title,
  (select to_char(t0 at time zone 'Europe/London', 'Dy DD Mon') from d) as period_from,
  (select to_char(t1 at time zone 'Europe/London', 'Dy DD Mon') from d) as period_to,
  (select count(*) from l, d where created_at >= d.t0) as leads_added,
  (select count(*) from a) as active,
  (select count(*) from a, d where last_contacted_at >= d.t0) as messaged,
  (select count(*) from a where stage not in ('new','dm_opened')) as replied,
  (select count(*) from a, d where call_date >= d.t0 and call_date < d.t1) as calls_held,
  (select count(*) from a, d where call_outcome in ('interested','needs_time') and call_date >= d.t0 and call_date < d.t1) as interested,
  (select count(*) from a, d where call_outcome = 'won' and call_date >= d.t0 and call_date < d.t1) as won,
  (select count(*) from a, d where call_outcome = 'no_show' and call_date >= d.t0 and call_date < d.t1) as no_shows,
  (select coalesce(json_agg(json_build_object('stage', stage, 'n', n)), '[]') from (select stage, count(*) n from a group by stage) s) as pipeline,
  (select coalesce(json_agg(json_build_object('name', name, 'when', to_char(call_date at time zone 'Europe/London', 'Dy DD Mon HH24:MI'), 'phone', contact_phone, 'rep', rep) order by call_date), '[]') from l, d where stage = 'call_booked' and call_date >= d.t1 and call_date < d.t1 + interval '7 days') as calls_next_week,
  (select coalesce(json_agg(json_build_object('name', name, 'was', to_char(call_date at time zone 'Europe/London', 'Dy DD Mon HH24:MI'), 'rep', rep) order by call_date), '[]') from l where stage = 'call_booked' and call_date < now() and call_outcome is null) as calls_to_log,
  (select count(*) from a where stage in ('replied','closed_interested') and (next_action_at is null or next_action_at <= (now() at time zone 'Europe/London')::date)) as replies_waiting,
  (select count(*) from a where stage = 'dm_opened' and next_action_at <= (now() at time zone 'Europe/London')::date) as follow_ups_due,
  (select count(*) from a where contact_handle is null and contact_phone is null) as missing_contact,
  (select coalesce(json_agg(r order by r.messaged desc), '[]') from (
     select p.full_name as rep,
       count(a.*) filter (where a.last_contacted_at >= d.t0) as messaged,
       count(a.*) filter (where a.stage not in ('new','dm_opened')) as replied,
       count(a.*) filter (where a.stage = 'call_booked' and a.call_date >= now()) as calls_ahead,
       count(a.*) filter (where a.call_outcome = 'won' and a.call_date >= d.t0 and a.call_date < d.t1) as won
     from public.profiles p cross join d left join a on a.owner_id = p.id
     where p.approved group by p.full_name) r) as reps;
