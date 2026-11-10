// Runs the real schema files against Postgres (PGlite) on an empty database, twice,
// then checks sign-up, row-level security, import, de-duplication, allocation and opt-out.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite(); const fails = [];
const q = async s => (await db.exec(s)).at(-1)?.rows;
const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails.push(l); };
const denied = async (s) => { try { const r = await q(s); return r; } catch (e) { return 'ERR:' + e.message; } };
const U = n => `00000000-0000-0000-0000-00000000000${n}`; const P = '10000000-0000-0000-0000-000000000001';
const as = async n => { await q(`reset role; set app.uid='${n ? U(n) : ''}'; ${n ? 'set role authenticated;' : ''}`); };

// minimal stand-in for Supabase's auth schema
await q(`
create role authenticated; create role anon;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, instance_id uuid, aud text, role text,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text);
create table auth.identities(id uuid primary key, user_id uuid, provider_id text, provider text, identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon; grant select, insert, delete on storage.objects to authenticated, anon;
create schema extensions;
create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
create function extensions.crypt(text, text) returns text language sql as $$ select md5($1 || $2) $$;
grant usage on schema extensions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true),'')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
const files = ['01_base_schema.sql', '02_import_allocation.sql', '03_hardening.sql', '04_username_signup.sql', '05_lead_screenshots.sql', '06_screenshot_hash.sql', '07_import_stage.sql'].map(f => fs.readFileSync('../supabase/' + f, 'utf8').replace("notify pgrst, 'reload schema';", ''));
for (const f of [...files, ...files]) await q(f);
console.log('migration ok x2');

// sign-up
await q(`insert into auth.users(id,email,raw_user_meta_data) values ('${U(1)}','ayden@example.com','{"full_name":"Ayden"}'),('${U(2)}','a@example.com','{"full_name":"Rep A"}'),('${U(3)}','b@example.com','{"full_name":"Rep B"}'),('${U(4)}','c@example.com','{}')`);
const prof = await q(`select full_name, role, approved from profiles order by created_at, id`);
ok(prof[0].role === 'owner' && prof[0].approved && prof[1].role === 'setter' && !prof[1].approved, 'first sign-up is the approved Owner; later ones wait as setters');

// RLS
await as(2);
ok((await q(`select count(*)::int c from profiles`))[0].c === 1, 'pending user sees only their own profile');
ok(String(await denied(`insert into projects(name) values ('x') returning id`)).startsWith('ERR'), 'pending user cannot create a project');
ok(String(await denied(`update profiles set approved=true, role='owner' where id='${U(2)}' returning id`)) !== 'ERR' && (await q(`select approved from profiles where id='${U(2)}'`))[0].approved === false, 'pending user cannot approve themselves');
await as(1);
await q(`update profiles set approved=true where id in ('${U(2)}','${U(3)}'); update profiles set approved=true, role='coach' where id='${U(4)}'; insert into projects(id,name,slug) values ('${P}','Built Different','built-different')`);
ok((await q(`select count(*)::int c from pipeline_stages where project_id='${P}'`))[0].c === 5, 'new project gets default production stages');
await q(`insert into leads(project_id,name,contact_handle,owner_id,stage) values ('${P}','Existing Person','https://www.instagram.com/Existing.Person?igsh=abc','${U(1)}','dm_opened')`);
await as(4);
ok(String(await denied(`insert into leads(project_id,name) values ('${P}','Nope') returning id`)).startsWith('ERR'), 'coach cannot add leads');
ok(String(await denied(`select import_leads('${P}','[{"name":"Nope","contact_handle":"@nope"}]'::jsonb)`)).startsWith('ERR'), 'coach cannot import');

// import + de-duplication (as a setter)
await as(2);
const n = (await q(`select l2i_norm_handle('@Existing.Person') a, l2i_norm_handle('instagram.com/existing.person/') b, l2i_norm_phone('+44 7700 900123') c, l2i_norm_phone('0044 7700 900123') d`))[0];
ok(n.a === 'existing.person' && n.b === 'existing.person' && n.c === '07700900123' && n.d === '07700900123', 'handles and phone numbers normalise to one key');
const rows = [{ name: 'Existing dup', contact_handle: '@existing.person' }, { name: 'Jane Founder', contact_handle: '@jane.founder', organisation: 'Acme', mutual_name: 'Tom' },
  { name: 'Jane again', contact_handle: 'jane.founder' }, { name: 'Phone Guy', contact_phone: '+44 7700 900123' }, { name: '', contact_handle: '' }];
for (let i = 0; i < 150; i++) rows.push({ name: 'Bulk ' + i, contact_handle: 'bulk_' + i });
const J = r => JSON.stringify(r).replace(/'/g, "''");
const dry = (await q(`select import_leads('${P}','${J(rows)}'::jsonb,true) r`))[0].r;
ok(dry.added === 0 && dry.rows.slice(0, 5).map(r => r.status).join() === 'duplicate,ok,duplicate,ok,invalid', 'dry run flags duplicates and incomplete rows without saving');
ok((await q(`select import_leads('${P}','${J(rows)}'::jsonb) r`))[0].r.added === 152, 'import saves only new people');
ok((await q(`select import_leads('${P}','${J(rows.slice(0, 5))}'::jsonb) r`))[0].r.added === 0, 're-importing adds nothing');
ok(String(await denied(`update leads set contact_handle='@JANE.FOUNDER' where name='Bulk 1' returning id`)).includes('leads_handle_unique'), 'database refuses a duplicate handle on edit');

// allocation
const c1 = (await q(`select claim_daily_leads('${P}') r`))[0].r;
ok(c1.claimed === 100 && c1.pool_left === 52, 'rep gets exactly 100');
ok((await q(`select claim_daily_leads('${P}') r`))[0].r.claimed === 0, 'same rep cannot take more that day');
ok(!!(await q(`select 1 from leads where owner_id='${U(2)}' and mutual_name is not null`)).length, 'mutual-connection lead is in the first batch');
ok(String(await denied(`select claim_daily_leads('${P}','${U(3)}')`)).startsWith('ERR'), 'a setter cannot allocate to someone else');
await as(3);
ok((await q(`select claim_daily_leads('${P}') r`))[0].r.claimed === 52, 'second rep gets the rest, no overlap');

// opt-out
const pid = (await q(`select id from leads where name='Phone Guy'`))[0].id;
await q(`select mark_do_not_contact('${pid}','asked to stop')`);
ok(String(await denied(`update leads set do_not_contact=false where id='${pid}' returning id`)).startsWith('ERR'), 'do-not-contact cannot be lifted from the app');
await as(1); await q(`delete from leads where id='${pid}'`); await as(3);
ok((await q(`select import_leads('${P}','[{"name":"Phone Guy","contact_phone":"07700 900123"}]'::jsonb) r`))[0].r.rows[0].status === 'blocked', 'opted-out person cannot be re-imported, even after deletion');

// recycle
await as(0); await q(`update leads set assigned_at = now() - interval '5 days' where owner_id='${U(3)}'`); await as(1);
const c3 = (await q(`select claim_daily_leads('${P}') r`))[0].r;
ok(c3.recycled > 0 && c3.claimed > 0, 'untouched leads return to the pool and are re-allocated');

// stage triggers
const lid = (await q(`select id from leads where owner_id='${U(1)}' limit 1`))[0].id;
await q(`update leads set stage='call_booked', call_date=now() where id='${lid}'; update leads set stage='won', value_estimate=30000 where id='${lid}'`);
ok((await q(`select count(*)::int c from notifications`))[0].c === 2, 'booking and win appear in the report');
const pr = (await q(`select slate_number, production_stage, title from productions`))[0];
ok(pr && pr.slate_number === 1 && pr.production_stage === 'pre_production', 'winning a lead creates production slate 1');
await as(2);
ok(String(await denied(`insert into notifications(project_id,message) values ('${P}','fake') returning id`)).startsWith('ERR'), 'report entries cannot be faked from the app');

await q(`reset role; set app.uid=''; set role anon;`);
ok(String(await denied(`select import_leads('${P}','[]'::jsonb)`)).includes('permission denied'), 'signed-out callers cannot run the import function');
ok(String(await denied(`select l2i_role()`)).includes('permission denied'), 'signed-out callers cannot run the role helper');
await as(2);
ok(String(await denied(`select l2i_seed_stages()`)).startsWith('ERR'), 'trigger functions cannot be called directly');
await as(0);
// screenshots on a lead
await as(2);
const imp = (await q(`select import_leads('${P}','[{"name":"Shot Person","contact_handle":"@shot.person","contact_email":"Shot@Example.com"},{"name":"Jane Dup","contact_handle":"@jane.founder"}]'::jsonb) r`))[0].r.rows;
ok(!!imp[0].id && imp[1].status === 'duplicate' && !!imp[1].existing_id, 'import returns the new lead id, and the existing id for a duplicate');
ok((await q(`select contact_email from leads where id='${imp[0].id}'`))[0].contact_email === 'shot@example.com', 'email is saved on import');
await q(`insert into storage.objects(bucket_id,name) values ('lead-shots','${imp[0].id}/a.jpg'); insert into lead_files(lead_id,path,kind,created_by) values ('${imp[0].id}','${imp[0].id}/a.jpg','profile','${U(2)}')`);
ok(String(await denied(`insert into storage.objects(bucket_id,name) values ('other-bucket','x.jpg') returning id`)).startsWith('ERR'), 'uploads are limited to the lead screenshots bucket');
await as(4);
ok(String(await denied(`insert into lead_files(lead_id,path,kind,created_by) values ('${imp[0].id}','c.jpg','other','${U(4)}') returning id`)).startsWith('ERR') && (await q(`select count(*)::int c from lead_files`))[0].c === 1, 'a coach can view screenshots but not add them');
await q(`reset role; set app.uid=''; set role anon;`);
ok((await q(`select count(*)::int c from storage.objects`))[0].c === 0, 'signed-out visitors cannot see screenshots');
await as(1); await q(`delete from leads where id='${imp[0].id}'`);
ok((await q(`select count(*)::int c from lead_files`))[0].c === 0, 'deleting a lead removes its screenshot records');

// imports land at the stage the conversation has reached
await as(2);
const st = (await q(`select import_leads('${P}','[{"name":"Booked Person","contact_handle":"@booked.person","stage":"call_booked","call_date":"2026-12-01T15:00:00Z","contact_phone":"07700 900555"},{"name":"Replied Person","contact_handle":"@replied.person","stage":"replied","permission_status":"granted"},{"name":"Sent Person","contact_handle":"@sent.person","stage":"dm_opened"},{"name":"No Date","contact_handle":"@no.date","stage":"call_booked"},{"name":"Cheeky","contact_handle":"@cheeky.one","stage":"won"}]'::jsonb) r`))[0].r;
const sl = async h => (await q(`select stage, owner_id, permission_status, call_date is not null has_call, next_action_at is not null has_follow, last_contacted_at is not null contacted from leads where contact_handle='${h}'`))[0];
const bp = await sl('@booked.person'), rp = await sl('@replied.person'), sp = await sl('@sent.person'), nd = await sl('@no.date'), ch = await sl('@cheeky.one');
ok(st.added === 5 && bp.stage === 'call_booked' && bp.owner_id === U(2) && bp.permission_status === 'granted' && bp.has_call, 'a booked call imports as Call booked, owned by the importer, with permission recorded');
ok(rp.stage === 'replied' && rp.permission_status === 'granted' && rp.has_follow && sp.stage === 'dm_opened' && sp.permission_status === 'asked' && sp.contacted, 'replied and DM-sent leads import at their stage with a follow-up');
ok(nd.stage === 'replied' && ch.stage === 'new' && ch.owner_id === null, 'a call with no date falls back to Replied; an import cannot set a stage like Won');
ok((await q(`select count(*)::int c from notifications where message like 'Call booked — Booked Person%'`))[0].c === 1, 'an imported booked call appears in the report');

// username sign-up, called signed-out
await q(`reset role; set app.uid=''; set role anon;`);
ok((await q(`select l2i_sign_up('@New.Rep','longenough1','New Rep') r`))[0].r.username === 'new.rep', 'signed-out visitor can create an account by username');
ok(String(await denied(`select l2i_sign_up('new.rep','longenough1','Copy')`)).includes('taken'), 'usernames are unique');
ok(String(await denied(`select l2i_sign_up('a b','longenough1','X')`)).startsWith('ERR') && String(await denied(`select l2i_sign_up('okname','short','X')`)).startsWith('ERR'), 'bad usernames and short passwords are refused');
await as(0);
const nu = (await q(`select p.role, p.approved, p.full_name, u.email, u.email_confirmed_at is not null conf, u.encrypted_password <> 'longenough1' hashed, (select count(*)::int from auth.identities i where i.user_id=u.id) ids from auth.users u join profiles p on p.id=u.id where u.email='new.rep@l2i.local'`))[0];
ok(nu && nu.role === 'setter' && !nu.approved && nu.conf && nu.hashed && nu.ids === 1 && nu.full_name === 'New Rep', 'new account is confirmed, hashed, and waits for approval as a setter');
if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); } else console.log('\nDATABASE CHECKS PASSED');
