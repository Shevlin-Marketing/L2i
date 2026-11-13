// L2i week in review: turns the weekly query result into a branded A4 PDF.
// Usage: node weekly-report.mjs <data.json> <out.pdf> [--html out.html]
// Every figure comes from the query row; nothing is estimated.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assets, renderPdf, sheetCss, sheetEdge, esc, fmt, plural } from './morning-report.mjs';

const STAGES = [
  ['new', 'New', 'white'], ['dm_opened', 'DM opened', 'blue'], ['replied', 'Replied', 'pink'],
  ['call_booked', 'Call booked', 'yellow'], ['closed_interested', 'Interested', 'green'],
  ['proposal_sent', 'Proposal sent', 'buff'], ['won', 'Won', 'gold'],
  ['closed_not_interested', 'Not interested', 'grey'], ['lost', 'Lost', 'grey'],
];

export function loadWeek(raw) {
  let row = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (Array.isArray(row)) row = row[0] || {};
  const list = v => (typeof v === 'string' ? JSON.parse(v) : v) || [];
  const num = v => Number(v ?? 0) || 0;
  const out = { period_from: row.period_from || '', period_to: row.period_to || '', note: row.note || '' };
  for (const k of ['leads_added', 'messaged', 'said_yes', 'said_no', 'calls_due_this_week', 'calls_logged', 'won', 'no_shows', 'replies_waiting', 'follow_ups_due', 'missing_contact']) out[k] = num(row[k]);
  for (const k of ['pipeline', 'calls_next_week', 'calls_to_log', 'reps']) out[k] = list(row[k]);
  return out;
}

export function weekFocus(d) {
  if (d.calls_to_log.length) return `Log the ${plural(d.calls_to_log.length, 'call', 'calls')} still waiting for an outcome before Monday, so every follow-up goes out on time.`;
  if (d.calls_next_week.length) return `${plural(d.calls_next_week.length, 'call is', 'calls are')} booked for next week. Send each a confirmation the day before.`;
  if (d.replies_waiting || d.follow_ups_due) return `Clear the ${plural(d.replies_waiting + d.follow_ups_due, 'reply and follow-up', 'replies and follow-ups')} waiting before starting new conversations.`;
  if (!d.messaged) return 'No messages went out this week. Claim leads and open conversations on Monday.';
  return 'Keep the pace: claim leads each morning and answer replies the same day.';
}

export function buildWeekHtml(d, { now = new Date(), logo, font } = {}) {
  const tidy = s => String(s).replace(/ 0(\d) /, ' $1 ');
  const period = d.period_from ? `${tidy(d.period_from)} to ${tidy(d.period_to)}` : '';
  const year = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric' }).format(now);
  const counts = Object.fromEntries(d.pipeline.map(p => [p.stage, Number(p.n) || 0]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = STAGES.filter(([k]) => counts[k]);
  const bar = total ? shown.map(([k, , c]) => `<i style="flex:${counts[k]};background:var(--rev-${c})"></i>`).join('') : '<i style="flex:1;background:#E3E7EF"></i>';
  const legend = shown.length ? shown.map(([k, label, c]) => `<span class="key"><i style="background:var(--rev-${c})"></i>${esc(label)} <b>${fmt(counts[k])}</b></span>`).join('') : '<span class="key">No leads yet</span>';
  const yesRate = d.messaged ? `${fmt(d.said_yes)} of ${fmt(d.messaged)} messaged said yes` : 'Nobody messaged yet';
  const tile = (rev, n, label) => `<div class="tile" style="--rev:var(--rev-${rev})"><b>${fmt(n)}</b><span>${label}</span></div>`;
  const next = d.calls_next_week.map(c => `<tr><td class="t">${esc(tidy(c.when))}</td><td>${esc(c.name || 'No name')}</td><td>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '<span class="muted">No number</span>'}</td><td>${esc(c.rep || 'Unassigned')}</td></tr>`).join('');
  const toLog = d.calls_to_log.map(c => `<tr><td class="t">${esc(tidy(c.was))}</td><td>${esc(c.name || 'No name')}</td><td>${esc(c.rep || 'Unassigned')}</td></tr>`).join('');
  const reps = d.reps.map(r => `<tr><td>${esc(r.rep || 'No name')}</td><td class="n">${fmt(r.messaged)}</td><td class="n">${fmt(r.said_yes)}</td><td class="n">${fmt(r.calls_ahead)}</td><td class="n">${fmt(r.won)}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><title>L2i week in review, ${esc(period)}</title>
<style>${sheetCss(font)}
.bar{display:flex;height:9mm;border-radius:1.6mm;overflow:hidden;border:0.3mm solid var(--line);margin:1mm 0 3mm}
.bar i{display:block;min-width:2mm}
.legend{display:flex;flex-wrap:wrap;gap:2mm 5mm;font-size:9.5pt;color:var(--ink-2)}
.key{display:inline-flex;align-items:center;gap:1.6mm}
.key i{width:3.2mm;height:3.2mm;border-radius:0.8mm;border:0.3mm solid var(--line)}
.key b{color:var(--ink);font-weight:700}
.rate{font-stretch:68%;font-weight:850;font-size:15pt;line-height:1;margin-bottom:2.5mm}
td.n,th.n{text-align:right;padding-right:0;width:22mm}
.tiles.six{grid-template-columns:repeat(3,1fr)}
section{margin-bottom:3.5mm}
.tab{font-size:12pt}
.tiles.six .tile b{font-size:21pt}
.tiles.six{gap:2.5mm}
.rate{font-size:13pt;margin-bottom:1.5mm}
.bar{height:7mm;margin:0 0 2.5mm}
.first{margin-bottom:4mm;padding:3.5mm 6mm}
.tile b{font-size:24pt}
.tile{padding:2.4mm 4mm 2.8mm}
td{padding:1.8mm 3mm 1.8mm 0}
.sheet{padding:2.5mm 5mm}
header{padding:9mm 16mm 7mm 22mm}
header img{width:21mm;height:21mm}
main{padding-top:7mm}
</style></head><body>
${sheetEdge()}
<header>
  ${logo ? `<img src="data:image/png;base64,${logo}" alt="L2i Productions">` : '<div></div>'}
  <div><h1 class="cond">Week in review</h1><div class="sub">L2i Productions, Built Different outreach</div></div>
  <div class="date"><b class="cond">${esc(period)}</b><span>${esc(year)}</span></div>
</header>
<main>
  <div class="first"><span class="cond">Before Monday</span><p>${esc(d.note || weekFocus(d))}</p></div>

  <section style="--rev:var(--rev-blue)"><span class="tab cond">The week</span><div class="tiles six">
    ${tile('white', d.leads_added, 'Leads added')}
    ${tile('blue', d.messaged, 'People messaged')}
    ${tile('green', d.said_yes, d.said_yes === 1 ? 'Person said yes' : 'People said yes')}
    ${tile('yellow', d.calls_due_this_week, 'Calls that were due')}
    ${tile('buff', d.calls_logged, 'Call outcomes logged')}
    ${tile('gold', d.won, 'Won')}
  </div></section>

  <section style="--rev:var(--rev-pink)"><span class="tab cond">Pipeline now</span><div class="sheet">
    <div class="rate">${esc(yesRate)}</div>
    <div class="bar">${bar}</div>
    <div class="legend">${legend}</div>
  </div></section>

  <section style="--rev:var(--rev-yellow)"><span class="tab cond">Calls next week</span><div class="sheet">
    ${next ? `<table><tr><th>When</th><th>Lead</th><th>Phone</th><th>Rep</th></tr>${next}</table>` : '<p class="empty">No calls booked for the next seven days.</p>'}
  </div></section>

  <section style="--rev:var(--rev-gold)"><span class="tab cond">Calls to log</span><div class="sheet">
    ${toLog ? `<table><tr><th>Was booked for</th><th>Lead</th><th>Rep</th></tr>${toLog}</table>` : '<p class="empty">Every past call has an outcome logged.</p>'}
  </div></section>

  <section class="two">
    <div style="--rev:var(--rev-pink)"><span class="tab cond">Waiting on you</span><div class="sheet pool"><b>${plural(d.replies_waiting + d.follow_ups_due, 'conversation', 'conversations')}</b><p>${plural(d.replies_waiting, 'reply', 'replies')} to answer and ${plural(d.follow_ups_due, 'follow-up', 'follow-ups')} due.</p></div></div>
    <div style="--rev:var(--rev-grey)"><span class="tab cond">Details to add</span><div class="sheet pool"><b>${d.missing_contact ? plural(d.missing_contact, 'lead', 'leads') : 'All complete'}</b><p>${d.missing_contact ? 'Being worked with no handle or phone, so duplicates can’t be caught. Add the @handle.' : 'Every lead being worked has a handle or phone.'}</p></div></div>
  </section>

  ${d.reps.length > 1 ? `<section style="--rev:var(--rev-green)"><span class="tab cond">By rep</span><div class="sheet">
    ${reps ? `<table><tr><th>Rep</th><th class="n">Messaged</th><th class="n">Said yes</th><th class="n">Calls ahead</th><th class="n">Won</th></tr>${reps}</table>` : '<p class="empty">No approved reps yet.</p>'}
  </div></section>` : ''}

  <footer><span>L2i Productions, Live 2 Inspire</span><span>From the L2i CRM at ${esc(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(now))}</span></footer>
</main>
</body></html>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inPath, outPath = 'out/weekly-report.pdf'] = process.argv.slice(2);
  if (!inPath) { console.error('Usage: node weekly-report.mjs <data.json> <out.pdf> [--html out.html]'); process.exit(1); }
  const html = buildWeekHtml(loadWeek(readFileSync(inPath, 'utf8')), assets());
  const hi = process.argv.indexOf('--html');
  if (hi > 0) writeFileSync(process.argv[hi + 1], html);
  await renderPdf(html, outPath);
  console.log('Wrote', outPath);
}
