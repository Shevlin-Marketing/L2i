# L2i CRM

Single-file CRM for L2i Productions (Built Different docuseries outreach). Owner: Ayden, who works and tests almost entirely on an iPhone.

## Layout

- `index.html` — the whole app: CSS, HTML and JS in one file, no build step. Served by GitHub Pages from `main` (see `CNAME`), so **a push to `main` is a live deploy**.
- `supabase/01_base_schema.sql`, `02_import_allocation.sql`, `03_hardening.sql`, `04_username_signup.sql` — the whole database, in run order: tables, sign-up trigger (first user becomes the approved Owner), row-level security by role, stage triggers, then import/de-duplication/allocation/opt-out. Every file must be safe to re-run. New changes go in a new numbered file.
- `tests/` — `npm install && npm test` runs both schema files twice on an empty Postgres (PGlite) and checks sign-up, row-level security and the RPCs as real roles, generates mock screenshots, then drives the app at iPhone 14 size against `mock-supabase.js`. Needs Playwright + Chromium.

Backend is the Supabase project **L2i CRM** (ref `kbxpnmjxkxtordfzygjb`, London, in the "Shevlin coaching" organisation). The key in `index.html` is the publishable key. With the Supabase connector, apply schema changes with `apply_migration` and keep the matching file in `supabase/` identical; the connector auto-cancels statements it treats as destructive (`drop ... if exists`, some `revoke`s), so split those out and tell Ayden if one needs running by hand. To check behaviour on the live database without leaving data behind, run a `do $$ ... raise exception 'RESULT %', ...; end $$` block so everything rolls back.

**Sign-in is by username, with no email step.** Each account is stored in Supabase Auth as `<username>@l2i.local`, already confirmed. Sign-up goes through the `l2i_sign_up` RPC (callable signed-out), which creates the auth user directly; the app then signs in with `usernameToLogin()`. Don't switch back to `sb.auth.signUp`, which would try to send a confirmation email. The first account created is the Owner (`@admin`); never put a password in this repo, it is public.

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
