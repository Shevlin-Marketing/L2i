// End-to-end check of the CRM at iPhone size, against an in-memory Supabase mock (3,000-lead pool).
// Needs Playwright with Chromium available (pre-installed in Claude's cloud workspace).
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path');
const NM = path.join(__dirname, 'node_modules'); const fails = [];
const ok = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) fails.push(label); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await ctx.route('**/*', async r => { const u = r.request().url();
    if (u.startsWith('https://l2i.test/shot/')) return r.fulfill({ body: Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64'), contentType: 'image/gif' });
    if (u.startsWith('https://l2i.test/')) return r.fulfill({ path: path.join(__dirname, '..', 'index.html'), contentType: 'text/html' });
    if (u.includes('@supabase/supabase-js')) return r.fulfill({ path: path.join(__dirname, 'mock-supabase.js'), contentType: 'text/javascript' });
    const m = u.match(/cdn\.jsdelivr\.net\/npm\/(@?[^@\/]+(?:\/[^@\/]+)?)@[^\/]+\/(.*)$/) || u.match(/cdn\.jsdelivr\.net\/npm\/(@tesseract\.js-data\/eng)\/(.*)$/);
    if (m) { const f = path.join(NM, m[1], m[2]); if (fs.existsSync(f)) return r.fulfill({ path: f }); }
    return r.abort(); });
  await p.goto('https://l2i.test/'); await p.waitForSelector('#importBtn');
  ok(await p.evaluate(() => state.leads.length) === 3001, 'loads every lead past the 1,000-row page limit');
  ok(await p.$$eval('.list-row', e => e.length) < 200, 'pool hidden by default, list stays light');

  // screenshot import: profiles + message threads, several people at once
  await p.click('#importBtn');
  await p.setInputFiles('#impFiles', ['ig_new_dark', 'dm_jane', 'ig_old_light', 'dm_marcus', 'ig_list_light', 'li_light', 'dm_sofia', 'ig_tricky_light', 'ig_noname_light', 'dm_hale', 'ig_old_light', 'dm_jane', 'ig_tricky_scrolled', 'ig_list_light'].map(k => path.join(__dirname, 'shots', k + '.png')));
  await p.waitForFunction(() => /ready/.test(document.getElementById('impStatus')?.textContent || ''), null, { timeout: 240000 });
  const rows = await p.evaluate(() => IMPORT.rows.map(r => ({ n: r.name, h: r.contact_handle, p: r.contact_platform, o: r.organisation, m: r.mutual_name, ph: r.contact_phone, em: r.contact_email, st: r.stage, perm: r.permission_status, call: r.call_date, sig: (r._signals || []).join('; '), s: r._status, chk: r._nameCheck, notes: r.notes, shots: r._shots.map(x => x.kind).join('+'), msg: r._shots.map(x => x.text || '').join(' ') })));
  const by = h => rows.find(r => r.h === h) || {};
  ok(rows.length === 11, 'fourteen screenshots (profiles, message threads, repeats) still become 11 leads (got ' + rows.length + ')');
  ok(await p.evaluate(() => IMPORT.repeats) === 3 && /3 repeated screenshots skipped/.test(await p.textContent('#impStatus')), 'the same screenshot uploaded again is recognised and skipped');
  ok(await p.evaluate(() => sameHandle('@jane.founder', 'jane.f0under') && sameHandle('marcus_hale.co', 'marcushale.co') && sameHandle('the.kitchen.co', 'the.kitchen.c0') && !sameHandle('amelia.brooks', 'amelia.banks') && !sameHandle('dev_patel88', 'dev_patel89x')), 'a handle misread by one character still matches; different handles do not');
  const jane = by('@jane.founder'), sofia = by('@sofia.marin'), hale = by('@hale_developments'), marcus = by('@marcus_hale.co');
  // profile + its message thread = one lead, at the stage the conversation has reached
  ok(marcus.shots === 'profile+messages' && hale.shots === 'profile+messages', 'a profile and its DM screenshot become one lead, even when the DM shows only a name or only a handle');
  const thu = await p.evaluate(() => { const d = new Date(); let add = (4 - d.getDay() + 7) % 7; if (add === 0) add = 7; d.setDate(d.getDate() + add); d.setHours(15, 0, 0, 0); return localDateTimeStr(d); });
  ok(marcus.st === 'call_booked' && marcus.call === thu && marcus.perm === 'granted', 'a booked call is read from the messages with its day and time (' + marcus.st + ' ' + marcus.call + ')');
  ok(marcus.ph === '07700 900321' && /gave their number/.test(marcus.sig), 'the number they sent is saved as their phone');
  ok(hale.st === 'dm_opened' && hale.ph === '07700 900456', 'our message with no reply yet → DM sent; our own text is not mistaken for theirs');
  ok(sofia.st === 'replied' && sofia.perm === 'granted' && jane.st === 'replied', 'a reply moves the lead to Replied, and a yes records permission');
  ok(by('@amelia.brooks').st === 'new' && rows.find(r => r.n === 'Daniel Brooks').st === 'new', 'leads with no messages stay new');
  ok(await p.evaluate(() => { const w = (t) => { const r = parseWhen(t, new Date(2026, 10, 10, 14, 0)); return r ? localDateTimeStr(r.date) + (r.exact ? '' : '?') : null; };
     return w('tomorrow at 10') === '2026-11-11T10:00' && w('Friday 2:30pm') === '2026-11-13T14:30' && w('call at 4') === '2026-11-10T16:00?' && w('12th Nov at 11am') === '2026-11-12T11:00' && w('monday') === '2026-11-16T09:00?' && w('no time here') === null; }), 'call days and times are worked out correctly');
  ok(await p.evaluate(() => { const T = (...x) => x.map(([side, text]) => ({ side, text }));
     const a = inferConversation(T(['me', 'Hi, can I send more info?'], ['them', 'Not interested thanks']));
     const b = inferConversation(T(['me', 'Free for a call Friday at 2pm?'], ['them', 'Who is this?']));
     const c = inferConversation(T(['them', 'Hey saw your page']));
     return a.declined && a.stage === 'replied' && b.stage === 'replied' && !b.callDate && c.stage === 'replied'; }), 'a no is flagged, and a call we proposed but they have not agreed is not marked as booked');
  ok(jane.n === 'Jane Okafor' && jane.s === 'duplicate' && jane.shots === 'profile+messages', 'profile and message thread grouped on one lead; existing lead flagged');
  ok(/following up/i.test(jane.msg) && /send me more/i.test(jane.msg), 'both sides of a dark-mode message thread are read');
  ok(jane.o === 'okafor.studio' && /Role: Founder/.test(jane.notes) && /Website: okafor\.studio/.test(jane.notes), 'role, business and website go to their own fields');
  ok(by('@marcus_hale.co').o === 'Hale Property Group' && /priya/.test(by('@marcus_hale.co').m) && /Location: Hertfordshire/.test(by('@marcus_hale.co').notes), 'business, mutual and location read from bio');
  ok(rows.some(r => r.p === 'linkedin' && r.n === 'Daniel Brooks' && r.o === 'Brooks Logistics Ltd'), 'LinkedIn profile read');
  ok(sofia.n === 'Sofia Marin' && sofia.em === 'hello@sofiamarin.co.uk' && sofia.shots === 'messages+profile+profile', 'name split from its tagline; email found; messages uploaded before the profile still grouped');
  ok(sofia.ph === '07700 900789' && sofia.o === 'Brand Coach' && /Bookings open/.test(sofia.notes) && (sofia.notes.match(/Location: London/g) || []).length === 1, 'a second screenshot of the same profile adds its new details to the same lead, without repeats');
  ok(!/Dream Big|Helping/.test(sofia.n) && /Bio: Helping Founders Scale/.test(sofia.notes), 'bio lines stay in the bio');
  ok(hale.n === '' && hale.chk === true && hale.o === 'Northfield Homes' && hale.ph === '07700 900456' && /Property Investor/.test(hale.notes), 'no display name → name left blank and flagged, not filled from the bio');
  ok(await p.evaluate(() => ['Property Investor', 'Building Homes That Last', 'Dream Big', 'Entrepreneur', 'Helping Founders Scale', 'Brand Coach', 'Public Figure', 'London'].every(x => nameCandidate(x).score === 0)
     && ["Jane Okafor", "Marcus Hale", "Siobhan O'Brien", "Jean-Luc van der Berg", "J. Smith", "MARCUS HALE"].every(x => nameCandidate(x).score > 0)), 'name check rejects bio lines and accepts real names');
  // move a screenshot to a new lead and back out again
  const si = rows.indexOf(sofia);
  await p.click(`[data-shot-row="${si}"][data-shot="0"]`); await p.selectOption(`[data-shot-move="${si}"]`, 'new');
  ok(await p.evaluate(i => IMPORT.rows[i]._shots.length === 2 && IMPORT.rows.at(-1)._shots.length === 1, si), 'a screenshot can be moved to another lead');
  await p.evaluate(i => { const last = IMPORT.rows.pop(); IMPORT.rows[i]._shots.unshift(last._shots[0]); renderImportRows(); }, si);
  await p.click('#impSave');
  await p.waitForFunction(() => IMPORT && IMPORT.rows.length === 1 && !IMPORT.busy, null, { timeout: 30000 });
  ok(await p.evaluate(() => __db.leads.length) === 3011, 'the 10 new people saved');
  ok(await p.evaluate(() => (__db.lead_files || []).length === 8 && Object.keys(__store).length === 8 && __db.lead_files.every(f => !!f.hash)), 'their 8 screenshots uploaded and recorded with a fingerprint');
  ok(await p.evaluate(() => { const g = h => __db.leads.find(l => l.contact_handle === h); return g('@marcus_hale.co').stage === 'call_booked' && g('@marcus_hale.co').owner_id === 'u1' && !!g('@marcus_hale.co').call_date && g('@hale_developments').stage === 'dm_opened' && g('@sofia.marin').stage === 'replied' && g('@amelia.brooks').stage === 'new' && !g('@amelia.brooks').owner_id; }), 'worked leads are saved at their stage and owned by the importer; untouched ones go to the pool');
  ok(/Messages \(screenshot/.test(await p.evaluate(() => __db.leads.find(l => l.contact_handle === '@sofia.marin').notes)), 'message text saved into the lead notes');
  await p.click('[data-attach-existing="0"]');
  await p.waitForFunction(() => !IMPORT, null, { timeout: 30000 });
  ok(await p.evaluate(() => __db.lead_files.filter(f => f.lead_id === 'l0').length === 2 && /Messages/.test(__db.leads.find(l => l.id === 'l0').notes)), 'screenshots for someone already in the CRM are added to their existing lead');
  ok(await p.evaluate(() => __db.leads.find(l => l.id === 'l0').stage) === 'replied', 'and that lead moves forward to the stage its new messages show');
  // the same image can't be stored on a lead twice
  await p.evaluate(() => openLeadModal('l0')); await p.waitForSelector('#leadShotKind');
  await p.selectOption('#leadShotKind', 'profile');
  await p.setInputFiles('#leadShotFiles', [path.join(__dirname, 'shots', 'ig_new_dark.png')]);
  await p.waitForFunction(() => /already on this lead/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  ok(await p.evaluate(() => __db.lead_files.filter(f => f.lead_id === 'l0').length) === 2, 'a screenshot already on the lead is not stored again');
  await p.evaluate(() => closeModal());
  await p.evaluate(() => openLeadModal('l0')); await p.waitForSelector('.shot img');
  ok(await p.$$eval('.shot', e => e.length) === 2 && !!(await p.$('#leadShotFiles')), 'lead shows its screenshots and lets you add more');
  await p.evaluate(() => closeModal());

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
  // copy & open, undo, follow-up cycle
  const d = await pick(true);
  await p.click(`[data-qa-copy="opener"][data-id="${d}"]`); await p.waitForTimeout(300);
  await p.bringToFront();
  ok(/Built Different/.test(await p.evaluate(() => navigator.clipboard.readText())) && /paid commercial arrangement/.test(await p.evaluate(() => navigator.clipboard.readText())), '"Copy message & open" copies the permission message');
  await p.click(`[data-qa="sent"][data-id="${d}"]`); await p.waitForTimeout(200);
  await p.click('#toastUndoBtn'); await p.waitForTimeout(300);
  ok((await get(d)).join() === 'new,not_asked,false,false', 'Undo restores the lead');
  await p.click(`[data-qa="sent"][data-id="${d}"]`); await p.waitForTimeout(200);
  await p.evaluate(i => { state.leads.find(x => x.id === i).next_action_at = '2026-01-01'; renderMain(); }, d);
  ok(!!(await p.$(`[data-qa-copy="followup"][data-id="${d}"]`)), 'due lead offers the follow-up message');
  await p.click(`[data-qa="followed"][data-id="${d}"]`); await p.waitForTimeout(200);
  await p.evaluate(i => { state.leads.find(x => x.id === i).next_action_at = '2026-01-01'; renderMain(); }, d);
  ok(!(await p.$(`[data-qa="followed"][data-id="${d}"]`)) && !!(await p.$(`[data-qa="noreply"][data-id="${d}"]`)), 'only one follow-up, then close');
  await p.click(`[data-qa="noreply"][data-id="${d}"]`); await p.waitForTimeout(200);
  ok((await get(d))[0] === 'lost', '"No reply — close" closes the lead');
  ok(/sent today/.test(await p.textContent('#repStrip')), 'rep progress strip shows');
  const u = await pick(false);
  await p.click(`[data-qa="sent"][data-id="${u}"]`); await p.waitForTimeout(300);
  ok(!!(await p.$('#f_next')), 'unscored lead must be scored before a message is logged');
  // permission gate
  await p.check('[data-score="real_business"]'); await p.selectOption('#f_stage', 'call_booked'); await p.fill('#f_calldate', '2026-12-01T10:00');
  await p.click('#mSave'); await p.waitForTimeout(300);
  ok(/permission/i.test(await p.textContent('#toast')), 'call cannot be booked without recorded permission');
  await p.evaluate(() => closeModal());
  await p.click('[data-pipeline="reports"]'); await p.waitForTimeout(300);
  ok(!!(await p.$('#outreachReport')) && /Ayden/.test(await p.textContent('#outreachReport')), 'outreach report lists rep activity');
  ok((await p.$$('meta[name="apple-mobile-web-app-capable"]')).length === 1 && !!(await p.$('link[rel="apple-touch-icon"]')), 'home-screen app tags and icon present');
  // username sign-in and sign-up, no email step
  await p.evaluate(() => renderLogin('signin'));
  ok(await p.$eval('#authEmail', e => e.type) === 'text' && !/email/i.test(await p.textContent('#authForm')), 'login asks for a username, not an email');
  await p.fill('#authEmail', '@Admin'); await p.fill('#authPassword', 'wrongpass1'); await p.click('#authForm button[type=submit]'); await p.waitForTimeout(200);
  ok(/Wrong username or password/.test(await p.textContent('#authError')), 'wrong password gives a plain message');
  await p.evaluate(() => renderLogin('signup'));
  await p.fill('#authName', 'New Rep'); await p.fill('#authEmail', '@New.Rep'); await p.fill('#authPassword', 'longenough1'); await p.click('#authForm button[type=submit]');
  await p.waitForSelector('[data-pipeline="reports"]');
  const au = await p.evaluate(() => __auth);
  ok(au.signups.length === 1 && au.signups[0].p_username === 'new.rep' && au.logins.at(-1) === 'new.rep@l2i.local', 'sign-up creates the account and signs straight in');
  ok(await p.evaluate(() => {
    const W = 1000, H = 2000, L = (text, x0, x1, y0) => ({ text, x0, x1, y0, y1: y0 + 40 });
    const chat = [L('Priya Nair', 150, 420, 120), L('Hi Priya, Sam suggested I get in touch', 300, 950, 500), L('about the documentary series', 300, 900, 550), L('Sure, call me on 07700 900111', 60, 640, 760), L('Thursday at 3 works', 60, 480, 810)];
    const profile = [L('priya.nair', 60, 300, 120), L('412 posts 2,104 followers 380 following', 300, 950, 400), L('Priya Nair', 60, 280, 560), L('Founder at Nair Studio', 60, 500, 610)];
    const list = [L('amelia.brooks', 150, 400, 400), L('Amelia Brooks', 150, 420, 450), L('dev_patel88', 150, 380, 600), L('harrisonw', 150, 360, 800), L('Follow', 800, 950, 420)];
    return classifyShot(chat.map(o => o.text), chat, W, H) === 'messages' && classifyShot(profile.map(o => o.text), profile, W, H) === 'profile' && classifyShot(list.map(o => o.text), list, W, H) === 'profile';
  }), 'a chat with no "Seen" or typing bar is still recognised as messages by its layout; profiles and lists are not');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close();
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); } else console.log('\nALL PASSED');
})();
