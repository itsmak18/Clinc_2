# ADR-013 — Encounter basket is tactical; immutable charges are the strategic direction

**Status:** Accepted — 2026-07-12
**Context owner:** Mike
**Related:** ADR-011 (financial clearance gate, esp. §9/§11 concurrency), workflow audit 2026-07-04, external audit 2026-07-12. (ADR-012 — client trusts server validation — lands with PR #3; the number is reserved there.)

## Context

The 2026-07-12 external audit confirmed two locking holes in the basket implementation (fixed under ADR-011 §11) and prompted the architecture question: is the shared **mutable** basket invoice the right model at all? Three options were weighed:

- **A — one invoice per order.** No shared mutable state, trivial transactions; but the cashier collects N payments and prints N receipts per visit — operationally unacceptable for a walk-in clinic.
- **B — encounter basket (current, ADR-011).** One stop, one payment, one receipt; costs: shared mutable invoice, advisory-lock discipline, the §11 class of cancellation/payment races.
- **C — immutable charges + checkout aggregation.** Every order owns an immutable charge record; the "basket" is a logical view; the invoice is materialized once at checkout and settlement distributes payment across charges. Keeps B's UX while removing most shared mutable state.

## Decision

**Keep the encounter basket (Option B) as the tactical implementation; treat Option C as the recorded strategic direction, not a rewrite to start now.**

- The clinic-operational argument for encounter-level billing (one cashier stop) is the reason ADR-011 chose baskets; nothing in the audit changes it.
- The known race classes are now closed by a small, uniform serialization rule (ADR-011 §11: plain read → basket advisory lock → invoice row `FOR UPDATE`), each regression pinned by a concurrency test that was observed red on pre-fix code.
- A rewrite to C now would churn the entire billing/clearance surface (auto-charge, settle-on-pay, expiry, overrides, reconciliation) for risk reduction we have just obtained more cheaply.

Evaluation criterion recorded for future proposals (owner decision): **"it's only N lines" is not an engineering argument.** Locking/billing changes are judged on architectural simplicity, hidden coupling, maintenance cost, and operational risk — never on diff size.

## The architecture questions, answered from the code as-built

1. **Is the basket a real business entity or a technical optimization?** A checkout aggregation with real front-desk value — not a clinical entity. It is keyed (clinic, patient, open); it has no appointment/visit linkage.
2. **Can services be added after a partial payment?** Yes — `appendOrderCharge` only requires the basket to be `pending`; the total grows and settlement then requires the ledger to cover the *new* total.
3. **Can multiple doctors order concurrently in one encounter?** Yes — serialized by the per-(clinic, patient) advisory lock; the parallel-create test proves exactly one open basket survives.
4. **Can an encounter span multiple visits/days?** The basket lives until paid/cancelled; pending orders expire after `CLEARANCE_TTL_HOURS` (48h), so in practice the TTL — not any visit boundary — bounds it.
5. **Are partial payments supported?** Yes, via the append-only `payments` ledger (`recordPayment`); invoice-level only, and deliberately invisible to departments (ADR-011 §10).
6. **Are refunds per service or per visit?** Per-invoice negative `adjustment` only. There is no per-line refund. **This is the loudest revisit trigger for Option C** — distributing refunds across immutable per-order charges is exactly what C is good at.
7. **What do accounting/finance require on the receipt?** Today: invoice header + per-line `invoice_items` (with `serviceId` populated on gate-created lines) + the immutable ledger (migration 0040).
8. **Are there legal/regulatory invoice-granularity requirements in the deployment region?** **Open — not answerable from code.** Must be resolved with local accounting/regulatory input before the flag-ON rollout hardens invoice formats.

## Revisit triggers (any of these reopens Option C)

- Per-service refunds or disputes (question 6).
- Insurance / split-billing / deposits (roadmap Phase E) — multiple payers per encounter is charge-level, not invoice-level, math.
- Encounters spanning multiple visits as a real business requirement.
- A third locking defect in the basket writers despite §11 — evidence the shared-mutable-state cost is structural, not incidental.

## Consequences

- No schema or code change from this ADR; it records direction and decision criteria.
- Option C, if/when triggered, arrives as: immutable `charges` records per order → basket becomes a view → invoice materialized at checkout → settlement distributes. The clearance gate's public semantics (`clearance_status`, 3020 guard, §10 visibility) are designed to survive that migration unchanged.
