(function(){
const now=()=>new Date().toISOString();
const db = window.__db = {
 profiles:[{id:'u1',full_name:'Ayden Shevlin',role:'owner',approved:true},{id:'u2',full_name:'Rep A',role:'setter',approved:true}],
 projects:[{id:'p1',name:'Built Different',archived:false,created_at:now()}],
 leads:[{id:'l0',project_id:'p1',name:'Existing Person',contact_handle:'@jane.founder',contact_platform:'instagram',stage:'dm_opened',owner_id:'u1',score:50,score_breakdown:{real_business:true,mutual_connection:true},permission_status:'asked',created_at:now()}],
 productions:[],activity_log:[],pipeline_stages:[],notifications:[],rep_progress:[],do_not_contact:[]};
for(let i=0;i<3000;i++) db.leads.push({id:'b'+i,project_id:'p1',name:'Pool Person '+i,contact_handle:'@pool_'+i,contact_platform:'instagram',stage:'new',owner_id:null,score:i%3?50:null,permission_status:'not_asked',mutual_name:i%10===0?'Tom':null,created_at:now()});
let seq=1; const nh=h=>{let s=String(h||'').trim().replace(/^(https?:\/\/)?(www\.)?(instagram\.com\/)?@?/i,'').replace(/([\/?#].*$)|\s/g,'').toLowerCase();return s||null};
class Q{constructor(t){this.t=t;this.f=[];this.op='select'}
 select(){return this} range(a,b){this.r=[a,b];return this} eq(c,v){this.f.push(r=>r[c]===v);return this} order(){return this} limit(){return this} or(){return this} single(){this.one=true;return this}
 insert(p){this.op='insert';this.p=p;return this} update(p){this.op='update';this.p=p;return this} delete(){this.op='delete';return this} upsert(p){this.op='insert';this.p=p;return this}
 then(res){ const T=db[this.t]||(db[this.t]=[]); let data=null;
  if(this.op==='insert'){ const rows=[].concat(this.p).map(r=>({id:'n'+(seq++),created_at:now(),...r})); T.push(...rows); data=this.one?rows[0]:rows; }
  else if(this.op==='update'){ T.filter(r=>this.f.every(f=>f(r))).forEach(r=>Object.assign(r,this.p)); }
  else if(this.op==='delete'){ db[this.t]=T.filter(r=>!this.f.every(f=>f(r))); }
  else { data=T.filter(r=>this.f.every(f=>f(r))); if(this.r) data=data.slice(this.r[0],this.r[1]+1); if(this.one) data=data[0]||null; }
  res({data:JSON.parse(JSON.stringify(data)),error:null}); }}
const rpc=async(name,a)=>{
 if(name==='import_leads'){ const out=[];let added=0;const seen=new Set();
  a.p_rows.forEach((r,i)=>{const h=nh(r.contact_handle);let st='ok',d=null;
   if(!r.name&&!h){st='invalid';d='Needs a name or handle'}
   else if(h&&seen.has(h)){st='duplicate';d='Appears twice in this import'}
   else if(h&&db.leads.some(l=>nh(l.contact_handle)===h)){st='duplicate';d='Already in Built Different (dm_opened, Ayden Shevlin)'}
   let nid=null, ex=null; const hit=h&&db.leads.find(l=>nh(l.contact_handle)===h); if(st==='duplicate'&&hit) ex=hit.id;
   if(st==='ok'){ if(h)seen.add(h); if(!a.p_dry_run){nid='n'+(seq++);db.leads.push({id:nid,project_id:a.p_project,...r,stage:'new',owner_id:null,permission_status:'not_asked',created_at:now()});added++;}}
   out.push({index:i,status:st,detail:d,id:nid,existing_id:ex});}); return {data:{added,rows:out},error:null}; }
 if(name==='claim_daily_leads'){ const pool=db.leads.filter(l=>l.stage==='new'&&!l.owner_id).sort((x,y)=>(!x.mutual_name)-(!y.mutual_name)); const take=pool.slice(0,a.p_cap); take.forEach(l=>{l.owner_id=a.p_user;l.assigned_at=now()}); return {data:{claimed:take.length,today:take.length,cap:a.p_cap,pool_left:pool.length-take.length,recycled:0},error:null}; }
 if(name==='l2i_sign_up'){ window.__auth.signups.push(a); return {data:{username:a.p_username},error:null}; }
 if(name==='mark_do_not_contact'){ const l=db.leads.find(x=>x.id===a.p_lead); l.do_not_contact=true; l.opted_out_at=now(); return {data:null,error:null}; }
};
window.__auth={signups:[],logins:[]};
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}}),signOut:async()=>({}),signInWithPassword:async(c)=>{window.__auth.logins.push(c.email);return c.password==='wrongpass1'?{data:{},error:{message:'Invalid login credentials'}}:{data:{user:{id:'u1'}},error:null}}},from:t=>new Q(t),rpc,storage:{from:b=>({upload:async(path,blob)=>{(window.__store=window.__store||{})[path]=blob.size;return {data:{path},error:null}},createSignedUrls:async(paths)=>({data:paths.map(p=>({path:p,signedUrl:'https://l2i.test/shot/'+p})),error:null}),remove:async(paths)=>{paths.forEach(p=>delete (window.__store||{})[p]);return {data:[],error:null}}})}})};
})();
