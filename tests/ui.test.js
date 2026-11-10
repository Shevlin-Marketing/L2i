// End-to-end check of the CRM at iPhone size, against an in-memory Supabase mock (3,000-lead pool).
// Needs Playwright with Chromium available (pre-installed in Claude's cloud workspace).
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path');
const NM = path.join(__dirname, 'node_modules'); const fails = [];
const ok = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) fails.push(label); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'] }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await ctx.route('**/*', async r => { const u = r.request().url();
    if (u.startsWith('https://l2i.test/')) return r.fulfill({ path: path.join(__dirname, '..', 'index.html'), contentType: 'text/html' });
    if (u.includes('@supabase/supabase-js')) return r.fulfill({ path: path.join(__dirname, 'mock-supabase.js'), contentType: 'text/javascript' });
    const m = u.match(/cdn\.jsdelivr\.net\/npm\/(@?[^@\/]+(?:\/[^@\/]+)?)@[^\/]+\/(.*)$/) || u.match(/cdn\.jsdelivr\.net\/npm\/(@tesseract\.js-data\/eng)\/(.*)$/);
    if (m) { const f = path.join(NM, m[1], m[2]); if (fs.existsSync(f)) return r.fulfill({ path: f }); }
    return r.abort(); });
  await p.goto('https://l2i.test/'); await p.waitForSelector('#importBtn');
  ok(await p.evaluate(() => state.leads.length) === 3001, 'loads every lead past the 1,000-row page limit');
  ok(await p.$$eval('.list-row', e => e.length) < 200, 'pool hidden by default, list stays light');

  // screenshot import
  await p.click('#importBtn');
  await p.setInputFiles('#impFiles', ['ig_new_dark', 'ig_old_light', 'ig_list_light', 'li_light'].map(k => path.join(__dirname, 'shots', k + '.png')));
  await p.waitForFunction(() => /ready/.test(document.getElementById('impStatus')?.textContent || ''), null, { timeout: 240000 });
  const rows = await p.evaluate(() => IMPORT.rows.map(r => ({ n: r.name, h: r.contact_handle, p: r.contact_platform, o: r.organisation, m: r.mutual_name, s: r._status })));
  const by = h => rows.find(r => r.h === h) || {};
  ok(rows.length === 9, 'OCR finds 9 people in 4 screenshots (got ' + rows.length + ')');
  ok(by('@jane.founder').n === 'Jane Okafor' && by('@jane.founder').s === 'duplicate', 'dark-mode profile read; existing lead flagged duplicate');
  ok(by('@marcus_hale.co').o === 'Hale Property Group' && /priya/.test(by('@marcus_hale.co').m), 'business and mutual read from bio');
  ok(rows.some(r => r.p === 'linkedin' && r.n === 'Daniel Brooks' && r.o === 'Brooks Logistics Ltd'), 'LinkedIn profile read');
  await p.click('#impSave'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => __db.leads.length) === 3009, 'only the 8 new people saved');
  await p.evaluate(() => { IMPORT = null; closeModal(); });

  // paste import
  await p.click('#importBtn'); await p.click('#impPasteToggle');
  await p.fill('#impPaste', 'name,handle,platform,company,mutual\n"Okafor, Jane",@jane.founder,instagram,Okafor Studio,Tom\nSam Reed,https://www.instagram.com/sam.reed/?hl=en,Instagram,"Reed & Co",\n@just_a_handle');
  await p.click('#impPasteGo'); await p.waitForTimeout(400);
  const pr = await p.evaluate(() => IMPORT.rows.map(r => r._status));
  ok(pr.join() === 'duplicate,ok,ok', 'pasted CSV parsed and de-duplicated');
  await p.evaluate(() => { IMPORT = null; closeModal(); });

  // daily allocation + one-tap outcomes
  await p.click('#todayBtn'); await p.click('#dailyClaim'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => todayCount()) === 100, 'claims exactly 100');
  ok(!!(await p.$('.list-row .chip-mutual')), 'mutual-connection leads handed out first');
  const pick = scored => p.evaluate(s => state.leads.find(l => l.owner_id === 'u1' && l.stage === 'new' && (l.score != null) === s).id, scored);
  const get = id => p.evaluate(i => { const l = state.leads.find(x => x.id === i); return [l.stage, l.permission_status, !!l.do_not_contact, !!l.next_action_at]; }, id);
  const a = await pick(true);
  await p.click(`[data-qa="sent"][data-id="${a}"]`); await p.waitForTimeout(200);
  ok((await get(a)).join() === 'dm_opened,asked,false,true', '"Message sent" logs the ask and sets a follow-up');
  await p.click(`[data-qa="yes"][data-id="${a}"]`); await p.waitForTimeout(200);
  ok((await get(a)).slice(0, 2).join() === 'replied,granted', '"Said yes" records permission');
  const c = await pick(true);
  await p.click(`[data-qa="sent"][data-id="${c}"]`); await p.waitForTimeout(200);
  await p.click(`[data-qa="no"][data-id="${c}"]`); await p.waitForTimeout(300);
  ok((await get(c)).slice(0, 3).join() === 'lost,declined,true', '"Said no" blocks further contact');
  const u = await pick(false);
  await p.click(`[data-qa="sent"][data-id="${u}"]`); await p.waitForTimeout(300);
  ok(!!(await p.$('#f_next')), 'unscored lead must be scored before a message is logged');
  // permission gate
  await p.check('[data-score="real_business"]'); await p.selectOption('#f_stage', 'call_booked'); await p.fill('#f_calldate', '2026-12-01T10:00');
  await p.click('#mSave'); await p.waitForTimeout(300);
  ok(/permission/i.test(await p.textContent('#toast')), 'call cannot be booked without recorded permission');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close();
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); } else console.log('\nALL PASSED');
})();
