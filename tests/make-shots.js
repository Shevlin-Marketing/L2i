const { chromium } = require('playwright');
const base = (bg,fg,sub,body)=>`<html><body style="margin:0;background:${bg};color:${fg};font-family:-apple-system,Helvetica,Arial,sans-serif;width:393px">
<div style="display:flex;justify-content:space-between;padding:14px 26px 6px;font-weight:600;font-size:16px"><span>9:41</span><span>5G 87%</span></div>${body}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;margin-top:14px">${Array.from({length:9},(_,i)=>`<div style="height:130px;background:hsl(${i*40},30%,${bg==='#000'?25:70}%)"></div>`).join('')}</div></body></html>`;
const avatar = c=>`<div style="width:86px;height:86px;border-radius:50%;background:${c};flex:none"></div>`;
const stat = (n,l)=>`<div style="text-align:center"><div style="font-weight:700;font-size:16px">${n}</div><div style="font-size:13px">${l}</div></div>`;
const btn = (t,bg)=>`<div style="flex:1;text-align:center;padding:7px;border-radius:8px;background:${bg};font-weight:600;font-size:14px">${t}</div>`;
const pages = {
 ig_new_dark: base('#000','#fff','#aaa',`
  <div style="padding:8px 16px;font-weight:700;font-size:20px">&lt; jane.founder ✓</div>
  <div style="display:flex;gap:18px;padding:10px 16px;align-items:center">${avatar('#8a6')}
   <div style="flex:1"><div style="font-weight:600;font-size:15px;margin-bottom:8px">Jane Okafor</div>
   <div style="display:flex;justify-content:space-between">${stat('248','posts')}${stat('12.4K','followers')}${stat('610','following')}</div></div></div>
  <div style="padding:4px 16px;font-size:14px;line-height:1.4"><div style="color:#aaa">Entrepreneur</div><div>Founder @okafor.studio | Building brands that last</div><div style="color:#9bf">okafor.studio</div>
  <div style="margin-top:6px">Followed by tom.reeves, sam_k and 14 others</div></div>
  <div style="display:flex;gap:8px;padding:12px 16px">${btn('Follow','#0af')}${btn('Message','#333')}</div>`),
 ig_old_light: base('#fff','#111','#666',`
  <div style="padding:8px 16px;font-weight:700;font-size:20px">marcus_hale.co</div>
  <div style="display:flex;gap:18px;padding:10px 16px;align-items:center">${avatar('#c96')}
   <div style="flex:1;display:flex;justify-content:space-around">${stat('91','posts')}${stat('3,204','followers')}${stat('455','following')}</div></div>
  <div style="padding:4px 16px;font-size:14px;line-height:1.4"><div style="font-weight:600">Marcus Hale</div><div>CEO of Hale Property Group</div><div>Hertfordshire · Developments &amp; lettings</div>
  <div style="margin-top:6px">Followed by priya.n and 3 others</div></div>
  <div style="display:flex;gap:8px;padding:12px 16px">${btn('Follow','#0af')}${btn('Message','#eee')}</div>`),
 ig_list_light: base('#fff','#111','#666',`
  <div style="padding:8px 16px;font-weight:700;font-size:18px;text-align:center">Followers</div>
  <div style="margin:6px 16px;padding:8px;background:#eee;border-radius:10px;color:#888">Search</div>
  ${[['amelia.brooks','Amelia Brooks'],['dev_patel88','Dev Patel'],['the.kitchen.co','Ruth Ellis'],['harrisonw','Harrison Webb'],['nadia_builds','Nadia Rahman'],['oscar.lane','Oscar Lane']].map(([h,n],i)=>`
   <div style="display:flex;align-items:center;gap:12px;padding:9px 16px"><div style="width:52px;height:52px;border-radius:50%;background:hsl(${i*50},40%,60%)"></div>
   <div style="flex:1"><div style="font-weight:600;font-size:14px">${h}</div><div style="color:#666;font-size:14px">${n}</div></div>
   <div style="padding:6px 18px;background:#0af;color:#fff;border-radius:8px;font-weight:600;font-size:14px">Follow</div></div>`).join('')}`),
 li_light: base('#fff','#111','#666',`
  <div style="height:90px;background:#9ab"></div><div style="padding:0 16px">${avatar('#567')}
  <div style="font-weight:700;font-size:22px;margin-top:8px">Daniel Brooks</div>
  <div style="font-size:15px">Managing Director at Brooks Logistics Ltd</div>
  <div style="color:#666;font-size:13px;margin-top:4px">London, England · Contact info</div>
  <div style="color:#06c;font-size:13px;font-weight:600">500+ connections</div>
  <div style="color:#666;font-size:13px;margin-top:6px">Emma Wright and 8 other mutual connections</div></div>
  <div style="display:flex;gap:8px;padding:12px 16px">${btn('Connect','#06c')}${btn('Message','#eee')}</div>`)
};
(async()=>{ require('fs').mkdirSync(__dirname+'/shots',{recursive:true}); const b = await chromium.launch(); const p = await b.newPage({viewport:{width:393,height:852},deviceScaleFactor:3});
 for(const [k,h] of Object.entries(pages)){ await p.setContent(h); await p.screenshot({path:`${__dirname}/shots/${k}.png`}); }
 await b.close(); console.log('done'); })();
