import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const q = async (s)=>{ try{ const r = await db.exec(s); return r.at(-1)?.rows; }catch(e){ console.log('ERR', e.message); throw e; } };
await q(`
create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true),'')::uuid $$;
create table public.profiles(id uuid primary key, full_name text, role text, approved boolean);
create table public.projects(id uuid primary key default gen_random_uuid(), name text);
create table public.leads(id uuid primary key default gen_random_uuid(), project_id uuid, name text, organisation text,
  contact_handle text, contact_email text, source text, value_estimate numeric, score int, score_breakdown jsonb,
  stage text not null default 'dm_opened' check (stage in ('dm_opened','replied','won','lost')),
  call_date timestamptz, owner_id uuid not null, notes text, created_at timestamptz default now(), updated_at timestamptz);
insert into profiles values ('00000000-0000-0000-0000-000000000001','Ayden','owner',true),('00000000-0000-0000-0000-000000000002','Rep A','setter',true),('00000000-0000-0000-0000-000000000003','Rep B','setter',true);
insert into projects(id,name) values ('10000000-0000-0000-0000-000000000001','Built Different');
insert into leads(project_id,name,contact_handle,owner_id) values ('10000000-0000-0000-0000-000000000001','Existing Person','https://www.instagram.com/Existing.Person?igsh=abc','00000000-0000-0000-0000-000000000001');
`);
const sql = fs.readFileSync('../supabase/2026-11-09_import_allocation.sql','utf8').replace("notify pgrst, 'reload schema';","");
await q(sql);
await q(sql); // re-run idempotent
console.log('migration ok x2');
console.log(await q(`select l2i_norm_handle('@Existing.Person') a, l2i_norm_handle('instagram.com/existing.person/') b, l2i_norm_phone('+44 7700 900123') c, l2i_norm_phone('07700900123') d, l2i_norm_phone('0044 7700 900123') e`));
await q(`set app.uid='00000000-0000-0000-0000-000000000002'`);
const rows = [{name:'Existing dup',contact_handle:'@existing.person'},{name:'Jane Founder',contact_handle:'@jane.founder',organisation:'Acme',mutual_name:'Tom'},
 {name:'Jane again',contact_handle:'jane.founder'},{name:'Phone Guy',contact_phone:'+44 7700 900123'},{name:'',contact_handle:''}];
for(let i=0;i<150;i++) rows.push({name:'Bulk '+i, contact_handle:'bulk_'+i});
console.log(JSON.stringify((await q(`select import_leads('10000000-0000-0000-0000-000000000001','${JSON.stringify(rows)}'::jsonb,true) r`))[0].r).slice(0,400));
const res = (await q(`select import_leads('10000000-0000-0000-0000-000000000001','${JSON.stringify(rows)}'::jsonb) r`))[0].r;
console.log('added', res.added, res.rows.slice(0,5));
console.log('reimport added', (await q(`select import_leads('10000000-0000-0000-0000-000000000001','${JSON.stringify(rows.slice(0,5))}'::jsonb) r`))[0].r.added);
console.log(await q(`select claim_daily_leads('10000000-0000-0000-0000-000000000001') r`));
console.log(await q(`select claim_daily_leads('10000000-0000-0000-0000-000000000001') r`));
console.log('first claimed has mutual:', await q(`select name, mutual_name from leads where owner_id='00000000-0000-0000-0000-000000000002' order by assigned_at, (mutual_name is null) limit 1`));
await q(`set app.uid='00000000-0000-0000-0000-000000000003'`);
console.log(await q(`select claim_daily_leads('10000000-0000-0000-0000-000000000001') r`));
console.log('overlap:', await q(`select count(*) from leads where owner_id is not null group by id having count(*)>1`));
try{ await q(`select claim_daily_leads('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')`);}catch(e){}
const pid = (await q(`select id from leads where name='Phone Guy'`))[0].id;
await q(`select mark_do_not_contact('${pid}','asked to stop')`);
await q(`delete from leads where id='${pid}'`);
console.log('dnc reimport:', JSON.stringify((await q(`select import_leads('10000000-0000-0000-0000-000000000001','[{"name":"Phone Guy","contact_phone":"07700 900123"}]'::jsonb) r`))[0].r));
// recycle
await q(`update leads set assigned_at = now() - interval '5 days' where owner_id='00000000-0000-0000-0000-000000000003'`);
await q(`set app.uid='00000000-0000-0000-0000-000000000001'`);
console.log(await q(`select claim_daily_leads('10000000-0000-0000-0000-000000000001') r`));
try{ await q(`update leads set contact_handle='@JANE.FOUNDER' where name='Bulk 1'`);}catch(e){}
