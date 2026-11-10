# L2i CRM

Single-file CRM for L2i Productions (Built Different docuseries outreach). Owner: Ayden, who works and tests almost entirely on an iPhone.

## Layout

- `index.html` — the whole app: CSS, HTML and JS in one file, no build step. Served by GitHub Pages from `main` (see `CNAME`), so **a push to `main` is a live deploy**.
- `supabase/*.sql` — database changes, run by hand in Supabase → SQL Editor. Every file must be safe to re-run.
- `tests/` — `npm install && npm test` runs the migration against PGlite, generates mock screenshots, then drives the app at iPhone 14 size against `mock-supabase.js`. Needs Playwright + Chromium.

Backend is Supabase (auth, Postgres, RLS). The key in `index.html` is the publishable key; nothing in this repo has service-level access, so the live data can't be read or migrated from here.

## Rules for changing it

1. **Database first.** If a change needs new columns or functions, ship the SQL and tell Ayden to run it before the new `index.html` goes live. New page + old schema = lead saves fail.
2. **Never push to `main` unasked.** Work on a branch and open a PR.
3. Patch `index.html` with a Python script of exact string replacements, each asserted to match exactly once. Don't hand-rewrite large regions.
4. After any change: extract the `<script>` blocks and `node --check` them, then `npm test` in `tests/`. Add an assertion for what you changed.
5. iPhone first: 16px+ inputs (stops Safari zoom), tap targets ≥ 36px, no horizontal scroll at 390px, `min-width:0` on grid children. Look at a screenshot before calling UI done.
6. Bump `BUILD_NUMBER` on every release.
7. British English in all copy.

## How the data model works

- Leads belong to a project. `stage` runs `new → dm_opened → replied → call_booked → …` (`LEAD_STAGES`). `new` with no `owner_id` is the shared **pool**.
- **De-duplication is enforced in the database**, across all projects: unique indexes on `(contact_platform, handle_norm)` and `phone_norm` (generated columns). `normHandle`/`normPhone` in JS must stay identical to `l2i_norm_handle`/`l2i_norm_phone` in SQL.
- **Imports** (screenshot OCR via Tesseract.js on-device, or pasted CSV/JSON) go through the `import_leads` RPC, which has a dry-run mode used for the review screen.
- **Daily allocation** is the `claim_daily_leads` RPC: up to `DAILY_CAP` (100) per rep per London day, `FOR UPDATE SKIP LOCKED` so two reps never get the same lead, mutual-connection leads first, untouched leads recycled after `RECYCLE_DAYS`.
- **Permission and opt-out**: `permission_status` must be `granted` before a lead can reach `call_booked`. Declines and "do not contact" go through `mark_do_not_contact`, which also writes the permanent `do_not_contact` table so the person can't be re-imported.
- **Outreach flow on each lead card** (`quickActions` / `quickOutcome`): *Copy message & open* → *Message sent* (sets `permission_status = asked` and a follow-up date) → *Said yes* / *Said no*. When a follow-up is due the rep gets exactly one follow-up (`follow_ups`), then *No reply — close*. Every one-tap outcome except a decline can be undone from the toast.
- Leads are fetched in pages of 1,000 (`fetchAllLeads`) and the list draws at most `RENDER_CAP` rows per stage.

## Things not to add

These were considered and deliberately left out. Don't reintroduce them without Ayden raising it:

- Scraping or automated collection from Instagram, LinkedIn or any other platform. Leads come from screenshots a person took, or lists they paste.
- Estimating or storing anyone's income or wealth.
- Outreach copy that isn't literally true for the recipient (e.g. "your name was put forward", "one of three shortlisted"), that hides that taking part is paid, or that promises a return or profit.
- Any way to contact, re-import or reassign someone on the do-not-contact list.

The in-app permission message (`PITCH_TEMPLATES`) and the matching training lesson are marked as drafts pending sign-off by Ayden's solicitor. Keep the two in step if either changes.
