/* ============================================================================
   Arrival — wiring "Send invoice" and "Mark paid" to Postgres
   ----------------------------------------------------------------------------
   Drop-in replacement for the two client-side stubs in index.html.

   Today both mutate memory and call save(), which throws NotPersisted by
   design, so execution stops before the success toast and nothing is written.
   These methods do it the way the comment above save() prescribes: the write
   goes to the database first, and the screen only changes if Postgres accepted.

   Two pieces:
     1. Data.sendInvoice / Data.markTransactionPaid  — add to the Data object,
        beside setRelocationStatus.
     2. txInvoice / txPaid                           — replace the existing
        functions (currently ~line 4363 of index.html).

   Assumes the transactions table carries: id (uuid pk), status (text, one of
   Pending | Invoiced | Paid | Overdue, stored as displayed — loadAll passes it
   through unmapped), invoice_ref (text), invoiced_at (timestamptz), paid_at
   (timestamptz), due_on (date), fee (numeric). If invoiced_at or due_on do not
   exist yet, the migration at the bottom of this file adds them.
   ========================================================================== */


/* ---------------------------------------------------------------------------
   1. Data methods — add inside the Data object
   ------------------------------------------------------------------------ */

  /* Invoice numbers are allocated by Postgres, not the browser. The old client
     -side 'INV-' + (1052 + count) races: two coordinators invoicing in the same
     minute both read the same count and mint the same reference. */
  async sendInvoice(id){
    const c = sb(); if(!c || !ME) return {ok:false};
    const t = (S.transactions||[]).find(x=>x.id===id);
    if(!t) return {ok:false, message:'That transaction is no longer on your list. Refresh and try again.'};
    if(t.status !== 'Pending'){
      return {ok:false, message:'Only a pending transaction can be invoiced. This one is '+t.status.toLowerCase()+'.'};
    }

    const { data, error } = await c.rpc('issue_transaction_invoice', { p_transaction: id });
    if(error){
      console.error('[data] sendInvoice', error);
      return {ok:false, error, message: error.code==='42501'
        ? 'Only an owner can issue invoices.'
        : 'We could not issue that invoice. Nothing was sent, please try again.'};
    }

    await Data.refresh();
    return {ok:true, invoice:data.invoice_ref, due:data.due_on};
  },

  /* Idempotent on purpose: paid_at is only set where it is currently null, so a
     double-click, a stale tab or a retry after a dropped response cannot record
     the same fee twice. The guarded update returns zero rows the second time,
     which we report as already-paid rather than as a failure. */
  async markTransactionPaid(id, paidOn){
    const c = sb(); if(!c || !ME) return {ok:false};
    const t = (S.transactions||[]).find(x=>x.id===id);
    if(!t) return {ok:false, message:'That transaction is no longer on your list. Refresh and try again.'};
    if(!['Invoiced','Overdue'].includes(t.status)){
      return {ok:false, message:'Only an invoiced or overdue transaction can be marked paid.'};
    }

    const when = paidOn ? new Date(paidOn).toISOString() : new Date().toISOString();
    const { data, error } = await c.from('transactions')
      .update({ status:'Paid', paid_at:when })
      .eq('id', id)
      .is('paid_at', null)
      .select('id, fee, invoice_ref, paid_at');

    if(error){
      console.error('[data] markTransactionPaid', error);
      return {ok:false, error, message: error.code==='42501'
        ? 'Only an owner can record payments.'
        : 'We could not record that payment. Nothing was changed, please try again.'};
    }
    if(!data || !data.length){
      await Data.refresh();
      return {ok:false, already:true, message:'That payment was already recorded.'};
    }

    /* The relocation's own history should show the fee cleared, so the record
       reads the same to whoever opens it next. Employer-invisible: Arrival's
       commercial position is not the customer's business. */
    if(t.relId){
      const r = relById(t.relId);
      if(r) await c.from('milestones').insert({
        relocation_id: r.uuid,
        label: 'Referral fee received',
        note: (data[0].invoice_ref || 'No invoice reference') + ' — ' + fmtMoney(data[0].fee),
        employer_visible: false,
        created_by: ME.id,
      });
    }

    await Data.refresh();
    return {ok:true, fee:data[0].fee, invoice:data[0].invoice_ref, paidAt:data[0].paid_at};
  },


/* ---------------------------------------------------------------------------
   2. Screen handlers — replace the existing txInvoice / txPaid
   ------------------------------------------------------------------------ */

async function txInvoice(id){
  const t = (S.transactions||[]).find(x=>x.id===id); if(!t) return;
  const btn = event && event.currentTarget;
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Sending…'; }

  const r = await Data.sendInvoice(id);

  if(!r.ok){
    if(btn){ btn.disabled = false; btn.textContent = 'Send invoice'; }
    toast('Not sent', r.message || 'The invoice was not issued.', 'err');
    return;
  }
  /* Data.refresh() has already re-rendered from the database, so the row on
     screen is what Postgres holds, not what the browser hoped for. */
  toast('Invoice issued', r.invoice + ', ' + fmtMoney(t.fee) + ' to ' + t.company +
        (r.due ? ', due ' + fmtDs(r.due) : ''), 'ok');
}

async function txPaid(id){
  const t = (S.transactions||[]).find(x=>x.id===id); if(!t) return;
  const btn = event && event.currentTarget;
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Recording…'; }

  const r = await Data.markTransactionPaid(id);

  if(!r.ok){
    if(btn){ btn.disabled = false; btn.textContent = 'Mark paid'; }
    toast(r.already ? 'Already recorded' : 'Not recorded',
          r.message || 'The payment was not recorded.', r.already ? 'ok' : 'err');
    return;
  }
  toast('Payment recorded', fmtMoney(r.fee) + ' from ' + t.company +
        ' (' + (r.invoice || 'no invoice') + ')', 'ok');
}


/* ============================================================================
   3. Migration — run once in the Supabase SQL editor
   ==========================================================================*/
/*

-- Columns the two methods write. Safe to re-run.
alter table public.transactions
  add column if not exists invoice_ref text,
  add column if not exists invoiced_at timestamptz,
  add column if not exists paid_at     timestamptz,
  add column if not exists due_on      date;

-- One invoice reference per transaction, allocated by the database.
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

*/


/* ============================================================================
   Notes
   ----------------------------------------------------------------------------
   • save() stays exactly as it is. These handlers never call it; they await a
     Data.* method and let Data.refresh() re-render from the database. Every
     other screen still calling save() remains honestly broken until wired the
     same way — this is the pattern for the rest of them.

   • fmtMoney and fmtDs are already defined in index.html; relById and toast too.

   • The optimistic-update alternative was deliberately not taken. Writing to
     memory first and reconciling later is what produced the original bug, where
     the UI showed a payment that no database had ever seen.
   ========================================================================== */
