-- 09: "Seen" on a lead. Safe to re-run.
-- The dm_opened stage is shown as "Message sent" (our first message has gone out).
-- seen_at is set only when a screenshot shows "Seen", or when they reply (a reply means they read it).
-- Permission is no longer tracked in the app (it is agreed through mutuals and recorded elsewhere);
-- permission_status stays in the table for the pool recycling rule and older rows.
alter table public.leads add column if not exists seen_at timestamptz;

-- Anyone who has replied or got further has, by definition, seen the message.
update public.leads
   set seen_at = coalesce(last_contacted_at, updated_at, now())
 where seen_at is null
   and stage in ('replied','call_booked','closed_interested','closed_not_interested','proposal_sent','won');
