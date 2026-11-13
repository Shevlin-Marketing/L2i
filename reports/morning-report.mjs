// L2i morning call sheet: turns the morning summary query result into a branded A4 PDF.
// Usage: node morning-report.mjs <data.json> <out.pdf> [--html out.html]
// data.json is the single row the morning query returns (an object, or an array holding it).
// Every figure in the PDF comes from that row; nothing is estimated.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DAILY_CAP = 100;

export function loadRow(raw) {
  let row = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (Array.isArray(row)) row = row[0] || {};
  const list = v => (typeof v === 'string' ? JSON.parse(v) : v) || [];
  const num = v => Number(v ?? 0) || 0;
  return {
    calls_today: list(row.calls_today),
    calls_to_log: list(row.calls_to_log),
    replies_waiting: num(row.replies_waiting),
    follow_ups_due: num(row.follow_ups_due),
    pool: num(row.pool),
    reps: num(row.reps),
    awaiting_approval: num(row.awaiting_approval),
    messages_sent_yesterday: num(row.messages_sent_yesterday),
    yeses_yesterday: num(row.yeses_yesterday),
    won_yesterday: num(row.won_yesterday),
    note: row.note || '',
    for_date: row.for_date || '',
    recent_label: row.recent_label || '',
  };
}

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = n => Number(n).toLocaleString('en-GB');
export const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

export function firstThing(d) {
  if (d.calls_to_log.length) return `Log how ${d.calls_to_log.length === 1 ? 'the last call' : `the ${d.calls_to_log.length} past calls`} went, so nobody is left waiting for a follow-up.`;
  if (d.calls_today.length) return `Get ready for ${d.calls_today[0].time ? `the ${d.calls_today[0].time} call` : 'today’s first call'} with ${d.calls_today[0].name || 'your lead'}.`;
  if (d.replies_waiting) return `Answer the ${plural(d.replies_waiting, 'reply', 'replies')} waiting before sending anything new.`;
  if (d.follow_ups_due) return `Send the ${plural(d.follow_ups_due, 'follow-up', 'follow-ups')} due today.`;
  if (d.awaiting_approval) return `Approve the ${plural(d.awaiting_approval, 'new account', 'new accounts')} so they can start.`;
  if (d.pool) return 'Claim today’s leads and open the first conversations.';
  return 'The pool is empty. Import a fresh batch of screenshots so reps have leads to claim.';
}

export function sheetCss(font) {
  return `${font ? `@font-face{font-family:Archivo;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;font-stretch:62% 125%;}` : ''}
@page{size:A4;margin:12mm 0 10mm}
@page :first{margin:0}
:root{--night:#0F1A33;--night-2:#16223F;--paper:#F2F4F8;--fog:#9BA8C7;--ink:#0F1A33;--ink-2:#4A5677;--line:#D5DAE6;
--rev-white:#FFFFFF;--rev-blue:#93BDF2;--rev-pink:#F2A9C4;--rev-yellow:#F3DC6E;--rev-green:#9ED8A8;--rev-buff:#E6CFA6;--rev-gold:#E9B649;--rev-grey:#7C88A6}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:210mm;font-family:Archivo,'Helvetica Neue',Arial,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{background:var(--paper);position:relative;min-height:296mm;display:flex;flex-direction:column}
.page-edge{position:fixed;left:0;top:0;bottom:0;width:7mm;display:flex;flex-direction:column;z-index:2}
.page-edge i{flex:1}
.cond{font-stretch:68%;font-weight:850;letter-spacing:-.01em}
header{background:var(--night);color:var(--paper);padding:11mm 16mm 9mm 22mm;display:grid;grid-template-columns:auto 1fr auto;gap:7mm;align-items:center;position:relative}
header img{width:24mm;height:24mm;border-radius:50%;display:block}
header h1{font-size:34pt;line-height:.9;white-space:nowrap}
header > div{min-width:0}
header .date b{white-space:nowrap}
header .sub{color:var(--fog);font-size:10.5pt;margin-top:2.5mm}
header .date{text-align:right}
header .date b{display:block;font-size:20pt;line-height:1}
header .date span{color:var(--fog);font-size:9.5pt}
main{display:block;padding:8mm 16mm 3mm 22mm}
.first{background:var(--night);color:var(--paper);border-radius:2.5mm;padding:4.5mm 6mm;margin-bottom:6mm;display:grid;grid-template-columns:auto 1fr;gap:5mm;align-items:center}
.first .cond{font-size:15pt;color:var(--rev-yellow);line-height:1}
.first p{font-size:12pt;line-height:1.35}
section{margin-bottom:5.5mm;break-inside:avoid}
.tab{display:inline-block;background:var(--rev);color:var(--ink);padding:1.6mm 4mm 1.4mm;border-radius:1.6mm 1.6mm 0 0;font-size:13pt;line-height:1}
.sheet{background:#fff;border:0.3mm solid var(--line);border-left:1mm solid var(--rev);border-radius:0 2mm 2mm 2mm;padding:3mm 5mm}
table{width:100%;border-collapse:collapse;font-size:10.5pt}
th{text-align:left;font-weight:600;color:var(--ink-2);font-size:9pt;padding:1.5mm 0 2mm;border-bottom:0.3mm solid var(--line)}
td{padding:2.4mm 3mm 2.4mm 0;border-bottom:0.3mm solid #EEF0F5;vertical-align:top}
tr:last-child td{border-bottom:0}
td.t{font-stretch:75%;font-weight:750;font-size:12pt;width:30mm;white-space:nowrap}
a{color:inherit;text-decoration:none;border-bottom:0.3mm solid var(--rev-blue)}
.muted{color:var(--ink-2)}
.empty{color:var(--ink-2);font-size:10.5pt;padding:1.5mm 0}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}
.tile{background:#fff;border:0.3mm solid var(--line);border-top:1.4mm solid var(--rev);border-radius:0 0 2mm 2mm;padding:3mm 4mm 3.5mm;min-width:0}
.tile b{display:block;font-stretch:68%;font-weight:850;font-size:30pt;line-height:1}
.tile span{display:block;font-size:9.5pt;color:var(--ink-2);margin-top:1mm}
.two{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
.two > *{min-width:0}
.pool b{font-stretch:68%;font-weight:850;font-size:22pt;line-height:1;display:block}
.pool p{font-size:10pt;color:var(--ink-2);margin-top:1.5mm;line-height:1.35}
footer{margin-top:4mm;display:flex;justify-content:space-between;font-size:8.5pt;color:var(--ink-2);border-top:0.3mm solid var(--line);padding-top:2.5mm}
`;
}

export function sheetEdge() {
  return `<div class="page-edge">${['white','blue','pink','yellow','green','buff','gold','grey'].map(c=>`<i style="background:var(--rev-${c})"></i>`).join('')}</div>`;
}

export function buildHtml(d, { now = new Date(), logo, font } = {}) {
  const sheetDay = /^\d{4}-\d{2}-\d{2}$/.test(d.for_date) ? new Date(d.for_date + 'T12:00:00Z') : now;
  const dateLong = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(sheetDay);
  const poolDays = d.reps ? d.pool / (d.reps * DAILY_CAP) : 0;
  const poolDaysTxt = !d.pool ? 'The pool is empty' : !d.reps ? 'No approved reps yet' : poolDays >= 10 ? `${Math.floor(poolDays)} days of leads` : `${poolDays.toFixed(1).replace(/\.0$/, '')} ${poolDays === 1 ? 'day' : 'days'} of leads`;

  const callRows = d.calls_today.map(c => `<tr><td class="t">${esc(c.time)}</td><td>${esc(c.name || 'No name')}</td><td>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '<span class="muted">No number</span>'}</td><td>${esc(c.rep || 'Unassigned')}</td></tr>`).join('');
  const logRows = d.calls_to_log.map(c => `<tr><td class="t">${esc(c.was)}</td><td>${esc(c.name || 'No name')}</td><td>${esc(c.rep || 'Unassigned')}</td></tr>`).join('');

  const tile = (rev, n, label) => `<div class="tile" style="--rev:var(--rev-${rev})"><b>${fmt(n)}</b><span>${label}</span></div>`;

  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><title>L2i morning call sheet, ${esc(dateLong)}</title>
<style>
${sheetCss(font)}</style></head><body>
${sheetEdge()}
<header>
  ${logo ? `<img src="data:image/png;base64,${logo}" alt="L2i Productions">` : '<div></div>'}
  <div><h1 class="cond">${d.for_date ? 'Call sheet' : 'Morning call sheet'}</h1><div class="sub">L2i Productions, Built Different outreach</div></div>
  <div class="date"><b class="cond">${esc(dateLong.replace(/ \d{4}$/, ''))}</b><span>${esc(dateLong.match(/\d{4}$/)?.[0] || '')}</span></div>
</header>
<main>
  <div class="first"><span class="cond">Do this first</span><p>${esc(d.note || firstThing(d))}</p></div>

  <section style="--rev:var(--rev-yellow)"><span class="tab cond">Calls today</span><div class="sheet">
    ${callRows ? `<table><tr><th>Time</th><th>Lead</th><th>Phone</th><th>Rep</th></tr>${callRows}</table>` : '<p class="empty">No calls booked for today.</p>'}
  </div></section>

  <section style="--rev:var(--rev-gold)"><span class="tab cond">Calls to log</span><div class="sheet">
    ${logRows ? `<table><tr><th>Was booked for</th><th>Lead</th><th>Rep</th></tr>${logRows}</table>` : '<p class="empty">Every past call has an outcome logged.</p>'}
  </div></section>

  <section style="--rev:var(--rev-pink)"><span class="tab cond">Waiting on you</span><div class="tiles">
    ${tile('pink', d.replies_waiting, 'Replies waiting for an answer')}
    ${tile('blue', d.follow_ups_due, 'Follow-ups due today')}
    ${tile('white', d.pool, 'Leads in the shared pool')}
  </div></section>

  <section style="--rev:var(--rev-green)"><span class="tab cond">${esc(d.recent_label || 'Yesterday')}</span><div class="tiles">
    ${tile('blue', d.messages_sent_yesterday, 'Messages sent')}
    ${tile('green', d.yeses_yesterday, d.yeses_yesterday === 1 ? 'Person said yes' : 'People said yes')}
    ${tile('gold', d.won_yesterday, 'Won')}
  </div></section>

  <section class="two">
    <div style="--rev:var(--rev-buff)"><span class="tab cond">Pool</span><div class="sheet pool"><b>${esc(poolDaysTxt)}</b><p>${plural(d.pool, 'lead', 'leads')} across ${plural(d.reps, 'rep', 'reps')} at ${DAILY_CAP} a day each.</p></div></div>
    <div style="--rev:var(--rev-grey)"><span class="tab cond">Team</span><div class="sheet pool"><b>${d.awaiting_approval ? plural(d.awaiting_approval, 'account', 'accounts') + ' to approve' : 'No one waiting'}</b><p>${d.awaiting_approval ? 'Approve them from the Team screen so they can claim leads.' : 'Every sign-up has been approved.'}</p></div></div>
  </section>

  <footer><span>L2i Productions, Live 2 Inspire</span><span>From the L2i CRM at ${esc(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'}).format(now))}</span></footer>
</main>
</body></html>`;
}

export function assets() {
  const html = readFileSync(resolve(here, '../index.html'), 'utf8');
  const logo = html.match(/const LOGO_B64\s*=\s*['"]([^'"]+)/)?.[1] || '';
  let font = '';
  try { font = readFileSync(require.resolve('@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')).toString('base64'); }
  catch { console.warn('Archivo font not installed (npm install in reports/); using a fallback font.'); }
  return { logo, font };
}

export async function renderPdf(htmlStr, outPath) {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(htmlStr, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  await page.pdf({ path: outPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await browser.close();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inPath, outPath = 'out/morning-report.pdf'] = process.argv.slice(2);
  if (!inPath) { console.error('Usage: node morning-report.mjs <data.json> <out.pdf> [--html out.html]'); process.exit(1); }
  const d = loadRow(readFileSync(inPath, 'utf8'));
  const html = buildHtml(d, assets());
  const hi = process.argv.indexOf('--html');
  if (hi > 0) writeFileSync(process.argv[hi + 1], html);
  await renderPdf(html, outPath);
  console.log('Wrote', outPath);
}
