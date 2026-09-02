# Arrival — known issues in index.html

Found by reading the source. Line numbers refer to `site/index.html`.
Ordered by what a customer or an owner sees first.

---

## 1. Task overdue is compared against a hardcoded date — WRONG TODAY

**Line 2304**

    const overdue = !t.done && t.due < '2026-06-11';

Every task with a due date now renders red and reads "overdue", because the
comparison is against a literal string that the calendar has passed. Affects
`taskRow()`, used in the employer portal and the Command Center.

    const overdue = !t.done && t.due && t.due < new Date().toISOString().slice(0,10);

---

## 2. Transactions load without three fields the screens render

`Data.loadAll()` (line 911) maps transactions as:

    {id, relId, agentId, agent, kind, status, close, amount, fee, paid, invoice}

Three consumers read fields that are not in that object:

| Where | Line | Reads | Renders as |
| --- | --- | --- | --- |
| `ccTxTable()` | 4341 | `t.company` | the word "undefined" in the Company column |
| `ccTxTable()` | 4345 | `t.due` | "due —" on every overdue row |
| `drChannelReport()` | 5869 | `t.channel` | **every channel revenue figure reads $0** |

`txInvoice()` and `txPaid()` also interpolate `t.company` into their toasts.

Fix in the mapping, not at each call site — add the company name via the
relocation's `company_id`, and map `due_on` and the channel column.

---

## 3. Owner financials chart is always empty

**Lines 4382–4394**, `ccFin()`

All three series read `(S.monthlyRev||[])`. Nothing ever assigns
`S.monthlyRev` — `loadAll()` sets `S.monthly` (line 917, via
`Data.monthlyRollup`), which is a different shape: `{m, new, prog, closed, risk}`,
with no `referral`, `preferred` or `enterprise` keys.

So "Revenue by tier ($k / month)" renders with empty arrays on the one screen
the owner opens to see revenue. Either build a revenue rollup with those keys or
change the chart to plot what `monthlyRollup` actually produces.

---

## 4. Nothing ever sets status 'Overdue'

`TX_BADGE` (line 3574) defines four statuses. Three are written by the app;
`Overdue` is written by nobody. Consequences:

- `ccDash()` line 3931: the overdue invoice alert never fires
- `ccTx()` line 4358: the overdue count is always 0
- `ccTxTable()` line 4340: the red row background never applies

Derive it, don't type it. The migration in `patches/01` includes
`refresh_overdue_transactions()` and a pg_cron line to run it nightly.

---

## 5. Transaction amounts print unformatted

**Line 4343**

    <div class="tiny muted">${esc(t.amount)} · ${esc(t.close)}</div>

`amount` is numeric; the fee on the next line uses `fmtMoney`. A $940,000 sale
prints as `940000`. Use `fmtMoney(t.amount)`.

---

## 6. Prototype copy renders to customers

| Line | Screen | Text |
| --- | --- | --- |
| 5025 | Employee secure link | "Interactive prototype, fictional demonstration data. This mock secure link requires no account." |
| 5449 | Market report | "Interactive prototype, no real email was sent and no personal data leaves your browser." |

The employee journey link is sent to relocating employees. Sweep for
`class="proto-note"` and decide which are disclaimers worth keeping (several
are — the "illustrative timeline" and document-visibility notes read fine) and
which announce that the product is fake.

---

## 7. save() throws — roughly forty screens call it

**Line 692**

    function save(){ throw new NotPersisted(); }

This is deliberate and the comment above it explains why: save() used to be a
no-op, so screens mutated memory, reported success, and lost it on refresh. The
current behaviour is honest but it means those actions do not work.

Confirmed callers include `txInvoice`, `txPaid`, `ccSend`, `ccMoveStage`,
`ccConvertGo`, `ccAssign`, `ccAgentCreate`, `ccCompanyCreate`, `wizSubmit`'s
neighbours, and the thread reply paths in all three portals.

`patches/01-transactions-wire-to-postgres.js` does two of them as the worked
example: a `Data.*` method that writes first, an RLS policy, a migration, and a
handler that awaits the real result. Every remaining one follows that shape.

Suggested order: thread replies (used daily) → stage moves → the referral
wizard → agent and company creation → the rest.

---

## 8. Invoice numbers are minted in the browser

**Line 4365**

    t.invoice = 'INV-' + (1052 + Math.floor(Math.random()*0) + S.transactions.filter(x=>x.invoice).length);

Two coordinators invoicing in the same minute read the same count and mint the
same reference. (`Math.random()*0` is also dead — it is always 0.)

`patches/01` moves allocation to a Postgres sequence inside
`issue_transaction_invoice()`.

---

## 9. notWired() — twelve buttons that report honestly and do nothing

Lines 2583, 2703, 3179, 3237, 3326, 3386, 3520, 3526, 3527, 4773, 4925, 5163.

Document download, PDF generation, introduction requests, resending an
invitation, editing your profile, password reset, 2FA setup, coverage change
requests, sending a question (agent and employee).

Not bugs — `notWired()` tells the truth and points at a route that works. Listed
so the scope is visible when you plan the build.

---

## 10. Two assets are not in this package

- `vendor/supabase-js.min.js` — pinned @supabase/supabase-js 2.58.0, vendored
  because the CSP has no external origin to allow (see the comment at line 328)
- `img/logo.png`, `logo-light.png`, `mark.png`, `mark-light.png`

Copy both from your current deployment. Until then the page renders, the logo
breaks, and every portal falls through to the workspace-unavailable screen.
