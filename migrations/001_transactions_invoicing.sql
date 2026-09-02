-- Arrival — transactions invoicing and payment recording
-- ----------------------------------------------------------------------------
-- Backs docs/patches/01-transactions-wire-to-postgres.js, which replaces the
-- client-side "Send invoice" / "Mark paid" stubs with calls that write here.
--
-- Review the assumed column names against your real schema before running.
-- Safe to re-run: every statement is idempotent (if not exists / or replace).

-- Columns the app writes. Safe to re-run.
alter table public.transactions
  add column if not exists invoice_ref text,
  add column if not exists invoiced_at timestamptz,
  add column if not exists paid_at     timestamptz,
  add column if not exists due_on      date;

-- One invoice reference per transaction, allocated by the database so two
-- coordinators invoicing in the same minute can never mint the same number.
create sequence if not exists public.invoice_ref_seq start with 2050;

create or replace function public.issue_transaction_invoice(p_transaction uuid)
returns table (invoice_ref text, due_on date)
language plpgsql
security invoker           -- RLS still applies: the caller must be able to update the row
as $$
declare
  v_ref  text;
  v_due  date := (current_date + interval '30 days')::date;
begin
  v_ref := 'INV-' || nextval('public.invoice_ref_seq');

  update public.transactions t
     set status      = 'Invoiced',
         invoice_ref = coalesce(t.invoice_ref, v_ref),   -- never re-number an invoiced row
         invoiced_at = coalesce(t.invoiced_at, now()),
         due_on      = coalesce(t.due_on, v_due)
   where t.id = p_transaction
     and t.status = 'Pending'
  returning t.invoice_ref, t.due_on into invoice_ref, due_on;

  if not found then
    raise exception 'Transaction % is not pending', p_transaction
      using errcode = 'check_violation';
  end if;

  return next;
end;
$$;

-- Financials are owner-only, so the write policies are too. Adjust the role
-- predicate to match how profiles.role is checked elsewhere in your policies.
create policy transactions_owner_update on public.transactions
  for update to authenticated
  using      (exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role in ('owner','support') and p.is_active))
  with check (exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role in ('owner','support') and p.is_active));

-- Overdue is derived, not typed by hand: anything invoiced and past due.
create or replace function public.refresh_overdue_transactions()
returns void language sql as $$
  update public.transactions
     set status = 'Overdue'
   where status = 'Invoiced'
     and due_on is not null
     and due_on < current_date;
$$;

-- Schedule nightly with pg_cron if available:
-- select cron.schedule('overdue-transactions', '10 6 * * *', $$select public.refresh_overdue_transactions()$$);
