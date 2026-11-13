// Checks the morning call sheet: figures come straight from the query row, and it prints as one A4 page.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadRow, buildHtml, firstThing, assets, renderPdf } from './morning-report.mjs';

const d = loadRow(readFileSync(new URL('./sample.json', import.meta.url), 'utf8'));
const html = buildHtml(d, { ...assets(), now: new Date('2026-11-13T07:43:00Z') });
assert.match(html, /Friday 13 November|Friday, 13 November/);
assert.match(html, /Sample Lead One/); assert.match(html, /tel:07700 900123/);
assert.match(html, /2,350/); assert.match(html, /7\.8 days of leads/);
assert.match(html, /data:image\/png;base64,iVBOR/, 'logo embedded');
assert.match(html, /Log how the last call went/);
assert.doesNotMatch(html, /→| · /);
assert.equal(firstThing(loadRow({ calls_today: [], calls_to_log: [], pool: 0 })), 'The pool is empty. Import a fresh batch of screenshots so reps have leads to claim.');
assert.match(buildHtml(loadRow({ pool: 0, reps: 1 }), {}), /The pool is empty/);
assert.match(buildHtml(loadRow({ calls_to_log: '[{"name":"<b>x</b>","was":"Wed","rep":"A"}]' }), {}), /&lt;b&gt;x/, 'escapes names');

const out = new URL('./out/test.pdf', import.meta.url).pathname;
await renderPdf(html, out);
assert.ok(statSync(out).size > 20000);
const pages = Number(execFileSync('pdfinfo', [out]).toString().match(/Pages:\s+(\d+)/)[1]);
assert.equal(pages, 1, 'sample fits on one page');
console.log('morning report: ok');

// Weekly report
const { loadWeek, buildWeekHtml, weekFocus } = await import('./weekly-report.mjs');
const w = loadWeek(readFileSync(new URL('./sample-week.json', import.meta.url), 'utf8'));
const wh = buildWeekHtml(w, { ...assets(), now: new Date('2026-11-13T17:23:00Z') });
assert.match(wh, /Sat 7 Nov to Fri 13 Nov/);
assert.match(wh, /6 of 20 messaged said yes/);
assert.match(wh, /Owen Suth/); assert.match(wh, /Jonathan Low/);
assert.match(wh, /By rep/, 'rep table shown for a team');
assert.doesNotMatch(buildWeekHtml(loadWeek({ reps: [{ rep: 'A' }] }), {}), /By rep/, 'no rep table for one person');
assert.match(weekFocus(loadWeek({})), /No messages went out/);
assert.doesNotMatch(wh, /→| · /);
const solo = { ...w, reps: w.reps.slice(0, 1) };
const wout = new URL('./out/week-test.pdf', import.meta.url).pathname;
await renderPdf(buildWeekHtml(solo, assets()), wout);
assert.equal(Number(execFileSync('pdfinfo', [wout]).toString().match(/Pages:\s+(\d+)/)[1]), 1, 'solo week fits on one page');
console.log('weekly report: ok');
