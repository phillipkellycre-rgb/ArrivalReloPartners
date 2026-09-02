# Arrival Relocation Partners

Marketing site + owner/coordinator, employer, and agent portals for Arrival
Relocation Partners. Single-file SPA (`index.html`), backed by Supabase
(Postgres + Auth + RLS).

## Structure

    index.html         production site — the app, all portals, this is what deploys
    demo/index.html     the same app with a no-backend demo sign-in layer, for
                         walkthroughs and sales demos (see demo/ below)
    vendor/              vendored third-party JS
      supabase-js.min.js  @supabase/supabase-js 2.58.0 UMD build, pinned and
                          hash-verified (sha256 in the comment above the
                          <script> tag in index.html)
    img/                  drop the four brand assets here (not included):
                          logo.png, logo-light.png, mark.png, mark-light.png
    migrations/
      001_transactions_invoicing.sql   run once in the Supabase SQL editor
    docs/
      ISSUES.md           the original findings from the handoff, for reference
      patches/            the two patches from the handoff, for reference —
                          both are already applied to index.html and demo/index.html

## Running locally

    npm install
    npm start        # serves index.html at http://localhost:3000, SPA routing on
    npm run demo      # serves demo/index.html instead

The app needs `vendor/supabase-js.min.js` (included) and the four logo files
in `img/` (not included — copy them from the current deployment). Without the
logos every portal still works, just with a broken image where the lockup
belongs.

## Deploying

`vercel.json` rewrites every unmatched path to `index.html`, which the SPA's
own router then resolves — this is required because routes like
`/command-center/relocations/ARP-104821` have no matching file on disk. If you
deploy somewhere other than Vercel, replicate that catch-all rewrite; if you
skip it, sign-in silently stops working (see the comment above `function sb()`
in index.html for why that fails quietly instead of loudly).

## What was fixed in this build

Against `docs/ISSUES.md`, the findings from reading the handed-off source:

1. **Overdue task comparison used a hardcoded date.** Now compares against
   today's date.
2. **Transactions loaded without `company`, `due`, and `channel`.** The
   mapping in `Data.loadAll()` now derives all three from the relocation and
   company records, matching what `ccTxTable()`, `drChannelReport()`, and the
   invoice/payment toasts already expected.
3. **Owner financials chart was always empty.** Added `Data.monthlyRevRollup()`,
   which buckets paid transaction fees by month and company tier into the
   `referral` / `preferred` / `enterprise` keys the chart reads.
4. **Nothing ever set status `Overdue`.** Addressed at the database layer:
   `migrations/001_transactions_invoicing.sql` adds
   `refresh_overdue_transactions()`, meant to run nightly via `pg_cron`.
5. **Transaction amounts printed unformatted** (`940000` instead of
   `$940,000`). Now runs through `fmtMoney()`, in both the Command Center and
   agent-portal transaction tables.
6. **"Send invoice" / "Mark paid" wired to Postgres.** Applied
   `docs/patches/01-transactions-wire-to-postgres.js` verbatim:
   `Data.sendInvoice()` / `Data.markTransactionPaid()` write to the database
   first and only update the screen if Postgres accepts; invoice numbers are
   now allocated by a Postgres sequence (`issue_transaction_invoice()`),
   closing the double-invoice race from the old `'INV-' + count` scheme.
   Payment recording is idempotent — a double-click can't book a fee twice.
7. **Two customer-facing screens told real customers the product was fake.**
   The employee secure-link footer and the Direct Relocation confirmation page
   said "Interactive prototype, fictional demonstration data." Replaced with
   copy appropriate to a live product. The disclaimers ISSUES.md flagged as
   worth keeping (illustrative timeline, document-visibility notes, the
   agency-relationship disclaimer) are unchanged.
8. **Demo sign-in layer.** Applied `docs/patches/02-demo-logins.js` to
   `demo/index.html`: four one-click sign-ins (owner, coordinator, employer,
   agent) into a fictional workspace, no backend required. Kept as a separate
   build rather than gated behind a query string in production, since its
   purpose is sales walkthroughs, not a hidden production feature.
9. **`paid` was mapped as a boolean but rendered as a date** (`fmtDs(t.paid)`,
   used across transaction tables) — every occurrence silently printed "—".
   Now mapped as the actual `paid_at` date, matching what the demo fixture
   already assumed.

## What's still open

- **`save() throws by design`** (ISSUES.md #7). Roughly forty screens across
  all three portals still call it and will throw `NotPersisted` until wired
  the same way the two transaction methods above were. Wiring all of them
  needs schema visibility beyond what this handoff included (thread replies,
  relocation stage moves, the referral wizard, agent/company creation, and
  the Direct Relocation intake form's own `save()` call all need their own
  Postgres writes). Suggested order, per the original findings: thread
  replies → stage moves → referral wizard → agent/company creation → the
  rest.
- **`notWired()` buttons** (ISSUES.md #9) — twelve buttons that honestly
  report "not connected yet" rather than pretending to work. Left as-is;
  they point at real, known gaps rather than broken promises.
- **Brand assets.** `img/` needs `logo.png`, `logo-light.png`, `mark.png`,
  `mark-light.png` copied in from the current deployment.
- **RLS / schema verification.** `migrations/001_transactions_invoicing.sql`
  assumes column and policy names described in the original patch; review
  against your actual schema before running it against production.
