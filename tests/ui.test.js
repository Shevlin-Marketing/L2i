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
  const rows = await p.evaluate(() => IMPORT.rows.map(r => ({ n: r.name, h: r.contact_handle, p: r.contact_platform, o: r.organisation, m: r.mutual_name, callChk: r._callCheck, ph: r.contact_phone, em: r.contact_email, st: r.stage, perm: r.permission_status, call: r.call_date, sig: (r._signals || []).join('; '), s: r._status, chk: r._nameCheck, notes: r.notes, shots: r._shots.map(x => x.kind).join('+'), msg: r._shots.map(x => x.text || '').join(' ') })));
  const by = h => rows.find(r => r.h === h) || {};
  ok(rows.length === 11, 'fourteen screenshots (profiles, message threads, repeats) still become 11 leads (got ' + rows.length + ')');
  ok(await p.evaluate(() => IMPORT.repeats) === 3 && /3 repeated screenshots skipped/.test(await p.textContent('#impStatus')), 'the same screenshot uploaded again is recognised and skipped');
  ok(await p.evaluate(() => sameHandle('@jane.founder', 'jane.f0under') && sameHandle('marcus_hale.co', 'marcushale.co') && sameHandle('the.kitchen.co', 'the.kitchen.c0') && !sameHandle('amelia.brooks', 'amelia.banks') && !sameHandle('dev_patel88', 'dev_patel89x')), 'a handle misread by one character still matches; different handles do not');
  const jane = by('@jane.founder'), sofia = by('@sofia.marin'), hale = by('@hale_developments'), marcus = by('@marcus_hale.co');
  // profile + its message thread = one lead, at the stage the conversation has reached
  ok(marcus.shots === 'profile+messages' && hale.shots === 'profile+messages', 'a profile and its DM screenshot become one lead, even when the DM shows only a name or only a handle');
  const thu = await p.evaluate(() => { const d = new Date(); d.setMonth(10, 5); if (d > new Date()) d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7)); d.setHours(15, 0, 0, 0); return localDateTimeStr(d); });
  ok(marcus.st === 'call_booked' && marcus.call === thu && marcus.perm === 'granted' && marcus.callChk === false, '"Thursday at 3pm" sent on 5 Nov is read as the Thursday after that day, from the chat\'s own date, not from today (' + marcus.st + ' ' + marcus.call + ')');
  ok(marcus.ph === '07700 900321' && /gave their number/.test(marcus.sig), 'the number they sent is saved as their phone');
  ok(hale.st === 'dm_opened' && hale.ph === '07700 900456', 'our message with no reply yet → DM sent; our own text is not mistaken for theirs');
  ok(sofia.st === 'replied' && sofia.perm === 'granted' && jane.st === 'replied', 'a reply moves the lead to Replied, and a yes records permission');
  ok(by('@amelia.brooks').st === 'new' && rows.find(r => r.n === 'Daniel Brooks').st === 'new', 'leads with no messages stay new');
  { const got = await p.evaluate(() => { const ref = new Date(2026, 10, 10, 14, 0);   // Tue 10 Nov 2026, 14:00
      const w = (t) => { const r = parseWhen(t, ref); return r ? localDateTimeStr(r.date) + (r.hasDay ? '' : ' noday') + (r.hasTime ? '' : ' notime') : null; };
      const st = (t) => { const d = parseStamp(t, ref); return d ? localDateTimeStr(d) : null; };
      return [w('tomorrow at 10'), w('Friday 2:30pm'), w('call at 4'), w('12th Nov at 11am'), w('monday'), w('no time here'), w('Thursday the 19th at 3pm'), w('call me on 07700 900321'), w('speak at 14:30'), w('tues'), w('can we do the 2nd at 11am'), w('Nov 20 at 9am'), w('free in 2 days'),
              st('Today 10:15'), st('Yesterday 21:04'), st('Mon 09:10'), st('5 Nov 14:05'), st('Fri, 6 Nov at 2:05 PM'), st('14:32'), st('Hey how are you'), st('Seen')]; });
    const want = ['2026-11-11T10:00', '2026-11-13T14:30', '2026-11-10T16:00 noday', '2026-11-12T11:00', '2026-11-16T12:00 notime', null, '2026-11-19T15:00', null, '2026-11-10T14:30 noday', '2026-11-17T12:00 notime', '2026-12-02T11:00', '2026-11-20T09:00', null,
                  '2026-11-10T10:15', '2026-11-09T21:04', '2026-11-09T09:10', '2026-11-05T14:05', '2026-11-06T14:05', '2026-11-10T14:32', null, null];
    const bad = want.map((x, i) => x === got[i] ? null : i + ': ' + got[i] + ' (want ' + x + ')').filter(Boolean);
    ok(!bad.length, 'call days and times, and chat date markers, are read correctly ' + bad.join('; ')); }
  ok(await p.evaluate(() => { const T = (...x) => x.map(([side, text, at]) => ({ side, text, at: at || null }));
     const thu5 = new Date(2026, 10, 5, 14, 5);
     const a = inferConversation(T(['me', 'Are you free Tuesday at 2pm?', thu5], ['them', 'Can we do Wednesday at 4pm instead?', thu5], ['me', 'Perfect, Wednesday 4pm it is', thu5]));
     const b = inferConversation(T(['me', 'Free tomorrow at 11am?', thu5], ['them', 'Yes that works', thu5]));
     const c = inferConversation(T(['me', 'Free tomorrow at 11am?'], ['them', 'Yes that works']));
     const d = inferConversation(T(['me', 'Can I call you at 3?'], ['them', 'Sure']));
     const e = inferConversation(T(['me', 'Free for a call Thursday?', thu5], ['them', 'Yes', thu5]));
     return a.stage === 'call_booked' && localDateTimeStr(a.callDate) === '2026-11-11T16:00' && !a.callCheck
       && localDateTimeStr(b.callDate) === '2026-11-06T11:00' && !b.callCheck
       && c.stage === 'call_booked' && c.callCheck
       && d.stage === 'replied' && !d.callDate
       && e.stage === 'call_booked' && e.callCheck && localDateStr(e.callDate) === '2026-11-12'; }),
     'the last time agreed is used, read from the date of its message; anything worked out from today, or missing a day or time, must be confirmed; a time with no day and no message date is not booked');
  ok(await p.evaluate(() => { const T = (...x) => x.map(([side, text]) => ({ side, text }));
     const a = inferConversation(T(['me', 'Hi, can I send more info?'], ['them', 'Not interested thanks']));
     const b = inferConversation(T(['me', 'Free for a call Friday at 2pm?'], ['them', 'Who is this?']));
     const c = inferConversation(T(['them', 'Hey saw your page']));
     return a.declined && a.stage === 'replied' && b.stage === 'replied' && !b.callDate && c.stage === 'replied'; }), 'a no is flagged, and a call we proposed but they have not agreed is not marked as booked');
  ok(jane.n === 'Jane Okafor' && jane.s === 'duplicate' && jane.shots === 'profile+messages', 'profile and message thread grouped on one lead; existing lead flagged');
  ok(/following up/i.test(jane.msg) && /send me more/i.test(jane.msg), 'both sides of a dark-mode message thread are read');
  ok(jane.o === 'okafor.studio' && /Role: Founder/.test(jane.notes) && /Website: okafor\.studio/.test(jane.notes), 'role, business and website go to their own fields');
  ok(by('@marcus_hale.co').o === 'Hale Property Group' && !by('@marcus_hale.co').m && /Location: Hertfordshire/.test(by('@marcus_hale.co').notes), 'business and location read from bio; no mutual connection is recorded');
  ok(!(await p.$('[data-f="mutual_name"]')), 'the import card has no mutual connection field');
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
  { const sn = await p.evaluate(() => __db.leads.find(l => l.contact_handle === '@sofia.marin').notes);
    ok(/Conversation \(from screenshots/.test(sn) && /They replied/.test(sn) && /Next:/.test(sn) && !/Us: |Them: /.test(sn), 'the notes say how the conversation went, not a transcript'); }
  await p.click('[data-attach-existing="0"]');
  await p.waitForFunction(() => !IMPORT, null, { timeout: 30000 });
  ok(await p.evaluate(() => __db.lead_files.filter(f => f.lead_id === 'l0').length === 2 && /Conversation \(from screenshots/.test(__db.leads.find(l => l.id === 'l0').notes)), 'screenshots for someone already in the CRM are added to their existing lead');
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

  // handle next to a verified tick and icons; an @mention in the bio must not be taken as the handle; notes summarise the chat
  await p.click('#importBtn');
  await p.setInputFiles('#impFiles', ['ig_noname_light', 'ig_old_light', 'ig_verified_dark', 'dm_nadia'].map(k => path.join(__dirname, 'shots', k + '.png')));
  await p.waitForFunction(() => /ready|already/.test(document.getElementById('impStatus')?.textContent || '') && !IMPORT.busy, null, { timeout: 240000 });
  const hr = await p.evaluate(() => IMPORT.rows.map(r => ({ n: r.name, h: r.contact_handle, o: r.organisation, chk: r._handleCheck, st: r.stage, notes: importPayload([r])[0].notes })));
  const nadia = hr.find(r => r.n === 'Nadia Karim') || {};
  ok(nadia.h === '@nadia_k.builds' && nadia.o === '@karim.homes' && nadia.chk === false, 'handle read correctly beside a verified tick and icons; the bio @mention goes to business, not handle (got ' + nadia.h + ')');
  ok(/Call agreed after some questions for Thursday/.test(nadia.notes) && /Asked about what it involves and the cost/.test(nadia.notes) && /Gave their number: 07700 900222/.test(nadia.notes) && /Next: confirm the call/.test(nadia.notes), 'a booking with questions is written up as that');
  ok(hr.length === 3 && hr.some(r => r.h === '@hale_developments') && hr.some(r => r.h === '@marcus_hale.co'), 'two profiles with different handles are never merged because a name resembles a handle');
  ok(await p.evaluate(() => {
    const T = (...a) => a.map(([side, text]) => ({ side, text }));
    const s1 = summariseConversation(T(['me', 'Hi Sam, would you be open to me sending more information?']));
    const s2 = summariseConversation(T(['me', 'Hi Sam, would you be open to more information?'], ['them', 'Sure, send it over. What does it involve?']));
    const s3 = summariseConversation(T(['me', 'Hi Sam'], ['them', 'Not interested thanks']));
    const s4 = summariseConversation(T(['me', 'Hi Sam'], ['them', 'Bit busy right now, can you get back to me next month']));
    const s5 = summariseConversation(T(['me', 'Hi Sam, are you free for a quick call tomorrow at 10am?'], ['them', 'Yes perfect, speak then']));
    return /No reply yet/.test(s1) && /one follow-up/.test(s1)
      && /want more information/.test(s2) && /Asked about what it involves/.test(s2) && /reply is due, with the information/.test(s2)
      && /reads as a no/.test(s3) && /mark as declined/.test(s3)
      && /asked for more time/.test(s4)
      && /^Straightforward booking/.test(s5) && !/Asked about/.test(s5);
  }), 'no reply, wants information, a no, needs time and a straight booking each get their own write-up');
  ok(await p.evaluate(() => barHandle('< nadia_k.builds ® Q eee') === 'nadia_k.builds' && barHandle('jane.founder @ v') === 'jane.founder' && barHandle('< theo & eee') === null && barHandle('marcus_hale.co') === 'marcus_hale.co' && barHandle('Jane Okafor') === null), 'handle picked out of a noisy top bar; display names are not handles');
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
  ok(!(await p.$('.score-chip')) && !(await p.$('.chip-mutual')) && !/score/i.test(await p.textContent('#main')), 'no lead scores or mutual connections anywhere on the pipeline');
  const pick = () => p.evaluate(() => state.leads.find(l => l.owner_id === 'u1' && l.stage === 'new' && l.permission_status === 'not_asked').id);
  const get = id => p.evaluate(i => { const l = state.leads.find(x => x.id === i); return [l.stage, l.permission_status, !!l.do_not_contact, !!l.next_action_at]; }, id);
  const a = await pick();
  await p.click(`[data-qa="sent"][data-id="${a}"]`); await p.waitForTimeout(200);
  ok((await get(a)).join() === 'dm_opened,asked,false,true', '"Message sent" logs the ask and sets a follow-up');
  await p.click(`[data-qa="yes"][data-id="${a}"]`); await p.waitForTimeout(200);
  ok((await get(a)).slice(0, 2).join() === 'replied,granted', '"Said yes" records permission');
  const c = await pick();
  await p.click(`[data-qa="sent"][data-id="${c}"]`); await p.waitForTimeout(200);
  await p.click(`[data-qa="no"][data-id="${c}"]`); await p.waitForTimeout(300);
  ok((await get(c)).slice(0, 3).join() === 'lost,declined,true', '"Said no" blocks further contact');
  // copy & open, undo, follow-up cycle
  const d = await pick();
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
  const u = await pick();
  ok(!!(await p.$(`[data-qa-copy="opener"][data-id="${u}"]`)), 'every lead offers the message straight away, with no scoring step');
  await p.click(`[data-qa="sent"][data-id="${u}"]`); await p.waitForTimeout(300);
  ok((await get(u))[0] === 'dm_opened', '"Message sent" works without scoring the lead');
  // permission gate
  await p.evaluate(i => openLeadModal(i), u); await p.waitForSelector('#f_stage');
  ok(!(await p.$('[data-score]')) && !(await p.$('#f_mutual')) && !!(await p.$('#pitchText')), 'lead has no score checklist or mutual field, and the message is shown straight away');
  await p.selectOption('#f_stage', 'call_booked'); await p.fill('#f_calldate', '2026-12-01T10:00');
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
  // ---- calls: Do now, calendar, outcome, replies; passwords ----
  await p.evaluate(() => { state.pipeline = 'acquisition'; state.pipelineToday = false; state.pipelineDue = false; state.pipelineView = 'list'; const L = (id, name, stage, mins, extra) => Object.assign({ id, project_id: 'p1', name, contact_handle: '@' + id, contact_platform: 'instagram', stage, owner_id: 'u1', permission_status: 'granted', created_at: new Date().toISOString(), call_date: mins == null ? null : new Date(Date.now() + mins * 60000).toISOString() }, extra || {});
    const add = [L('cpast', 'Past Call', 'call_booked', -90, { contact_phone: '07700 900111', notes: 'Conversation (from screenshots, 1/1):\nStraightforward booking.' }), L('csoon', 'Later Today', 'call_booked', 1, { contact_phone: '07700 900222' }), L('rwait', 'Replied Rita', 'replied', null)];
    __db.leads.push(...add.map(x => ({ ...x }))); state.leads.push(...add); renderMain(); });
  const dn = await p.textContent('.do-now');
  ok(/Calls to log/.test(dn) && /Past Call/.test(dn) && /Replies waiting on you/.test(dn) && /Replied Rita/.test(dn), '"Do now" lists calls to log and replies waiting');
  ok(await p.evaluate(() => { const l = state.leads.find(x => x.id === 'csoon'); const t = new Date(l.call_date); const end = new Date(t); end.setHours(23, 59, 0, 0); return end > t; }) ? /Calls today/.test(dn) && /Later Today/.test(dn) : true, '"Do now" lists calls later today');
  const ics = await p.evaluate(() => callIcs(state.leads.find(x => x.id === 'csoon')));
  ok(/BEGIN:VEVENT/.test(ics) && /SUMMARY:Call: Later Today/.test(ics) && /TRIGGER:-PT15M/.test(ics) && /LOCATION:07700 900222/.test(ics) && /DTSTART:\d{8}T\d{6}Z/.test(ics) && ics.split('\r\n').every(x => x.length <= 75), 'calendar file has the call, phone, a 15-minute reminder, and valid line lengths');
  await p.evaluate(() => { window.__icsUrls = []; const o = URL.createObjectURL; URL.createObjectURL = b => { window.__icsUrls.push(b.type); return o(b); }; });
  await p.click('[data-ics="csoon"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.__icsUrls[0]) === 'text/calendar;charset=utf-8', '"Add to Calendar" produces a calendar file');
  await p.click('[data-reply="confirm"][data-id="csoon"]'); await p.waitForTimeout(200);
  ok(/that's booked for .+ at \d{2}:\d{2}\. I'll call you on 07700 900222/.test(await p.evaluate(() => navigator.clipboard.readText())), 'booking confirmation copies with the day, time and their number');
  ok(!!(await p.$('[data-outcome="no_show"][data-id="cpast"]')), 'a call whose time has passed asks how it went');
  ok(!(await p.$('[data-lead-advance="cpast"]')) && !(await p.$('[data-lead-advance="csoon"]')), 'booked calls have no separate advance button');
  await p.click('[data-outcome="no_show"][data-id="cpast"]'); await p.waitForTimeout(250);
  let cp = await p.evaluate(() => { const l = __db.leads.find(x => x.id === 'cpast'); return [l.stage, l.call_outcome, !!l.next_action_at, /: No-show\./.test(l.notes)]; });
  ok(cp.join() === 'replied,no_show,true,true', 'a no-show goes back to Replied with a follow-up today and a note');
  ok(!!(await p.$('[data-reply="reschedule"][data-id="cpast"]')), 'and a reschedule message is offered');
  ok(/missed the call/.test(await p.textContent('.do-now')), 'a no-show shows in Do now as a missed call');
  await p.click('[data-reply="reschedule"][data-id="cpast"]'); await p.waitForTimeout(200);
  ok(/sorry we missed each other on \w+day\. Would another time suit/.test(await p.evaluate(() => navigator.clipboard.readText())), 'reschedule message names the day of the missed call');
  await p.evaluate(() => { const l = state.leads.find(x => x.id === 'cpast'); Object.assign(l, { stage: 'call_booked', call_outcome: null }); renderMain(); });
  await p.click('[data-outcome="needs_time"][data-id="cpast"]'); await p.waitForTimeout(250);
  await p.click('#toastUndoBtn'); await p.waitForTimeout(300);
  cp = await p.evaluate(() => { const l = __db.leads.find(x => x.id === 'cpast'); return [l.stage, l.call_outcome]; });
  ok(cp.join() === 'call_booked,', 'a logged outcome can be undone');
  await p.click('[data-outcome="won"][data-id="cpast"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __db.leads.find(x => x.id === 'cpast').stage) === 'won', '"Won" marks the lead won');
  await p.evaluate(() => openLeadModal('csoon')); await p.waitForSelector('#mIcs');
  ok(await p.$$eval('[data-modal-reply]', e => e.length) === 4, 'the lead offers ready replies and Add to Calendar');
  ok(await p.evaluate(() => { const l = state.leads.find(x => x.id === 'csoon'); return document.getElementById('f_calldate').value === localDateTimeStr(new Date(l.call_date)); }), 'the lead shows the call in local time, not UTC');
  await p.evaluate(() => { document.getElementById('f_calldate').value = '2026-07-15T14:00'; }); await p.click('#mSave'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __db.leads.find(x => x.id === 'csoon').call_date) === new Date('2026-07-15T14:00').toISOString(), 'a call time typed in summer is saved as that local time');
  await p.evaluate(() => closeModal());
  await p.click('[data-pipeline="reports"]'); await p.waitForTimeout(250);
  ok(/Calls logged/.test(await p.textContent('#callReport')), 'Reports show call outcomes');
  // passwords
  await p.click('#appMenu summary'); await p.click('#passwordBtn'); await p.fill('#pwCur', 'wrongpass1'); await p.fill('#pwNew', 'brandnew99'); await p.fill('#pwNew2', 'brandnew99'); await p.click('#pwSave'); await p.waitForTimeout(200);
  ok(/current password is wrong/.test(await p.textContent('#pwErr')), 'a wrong current password is refused');
  await p.fill('#pwCur', 'oldpass123'); await p.fill('#pwNew2', 'different1'); await p.click('#pwSave'); await p.waitForTimeout(100);
  ok(/don't match/.test(await p.textContent('#pwErr')), 'mismatched new passwords are caught');
  await p.fill('#pwNew2', 'brandnew99'); await p.click('#pwSave'); await p.waitForTimeout(200);
  ok(/Password changed/.test(await p.textContent('#toast')), 'you can change your own password');
  await p.click('#appMenu summary'); await p.click('#teamBtn'); await p.waitForSelector('[data-reset-pw="u2"]');
  ok(/@rep\.a/.test(await p.textContent('.modal')) && !(await p.$('[data-reset-pw="u1"]')), 'Team shows usernames, with a reset for others but not yourself');
  await p.click('[data-reset-pw="u2"]'); await p.fill('#rpNew', 'tempPass123'); await p.click('#rpSave'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => JSON.stringify(__pw.at(-1))) === '["u2","tempPass123"]', 'the Owner can reset a rep\'s password');
  ok(await p.evaluate(() => document.querySelectorAll('.overlay').length) === 1, 'opening one window from another never stacks overlays');
  await p.evaluate(() => closeModal());
  await p.evaluate(() => closeModal());
  await p.click('#appMenu summary');
  ok(await p.evaluate(() => document.getElementById('appMenu').open), 'the menu opens');
  await p.click('[data-pipeline="acquisition"]').catch(() => {}); await p.mouse.click(5, 400);
  ok(await p.evaluate(() => !document.getElementById('appMenu') || !document.getElementById('appMenu').open), 'tapping outside closes the menu');
  ok(await p.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Archivo') && !document.body.innerHTML.includes('&rarr;')), 'new typeface applied; no arrows on buttons');
  ok(await p.evaluate(() => { renderMain(); const g = document.querySelector('.list-group[data-stage]'); return !!g && getComputedStyle(g).getPropertyValue('--stage').trim().length > 0; }), 'each stage group carries its colour');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close();
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); } else console.log('\nALL PASSED');
})();
