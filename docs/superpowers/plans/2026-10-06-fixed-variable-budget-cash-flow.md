# Fixed, Variable, and Payment Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate fixed commitments from variable budget allowances and route fixed card charges into card bills instead of immediate bank outflow, while preserving existing financial records.

**Architecture:** Add optional classification, account routing, and budget coverage links to existing records. Derive monthly fixed/variable totals and payment status from these records and imported transactions in shared calculation modules. Keep existing budgets, transactions, and history unchanged; unresolved legacy routing and overlap appear as review states.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, PostgreSQL/SQLite tests, React, TypeScript, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-fixed-variable-budget-cash-flow-design.md`

## Global Constraints

- Migration is additive; preserve every existing budget, item, transaction, payment, match, and monetary value.
- Subscriptions are variable; Affirm instalments remain fixed; car and home insurance require owner-supplied schedule and account.
- An imported transaction is the only source of verified actual amount. A manual paid marker is unverified.
- Card purchases count once as spending; their card bill counts once as a later bank outflow.
- Existing budget versions and historical months retain their values.

## Review Focus

- Existing `UNSET` payment routes must make bank projection incomplete rather than falsely precise (Task 4).
- A same-category budget item must remain untouched and unlinked until explicit user action (Tasks 1 and 5).
- A card charge near closing day, including February and day 31, must land in the right bill (Task 3).
- An existing match with a missing or ignored transaction must not count as verified paid (Task 2).
- Card repayment transfer must not inflate actual spending (Task 5).

---

### Task 1: Additive planning fields and budget links

**Files:** `app/models.py`, `app/main.py`, `alembic/versions/<generated_revision>.py`, `tests/test_planning_metadata.py`, `frontend-react/src/services/api.ts`.

**Interfaces:** `RecurringExpense.planning_kind`, `.payment_method`, `.payment_account_id`; coverage link `(budget_item_id, recurring_id, amount, start_month, valid_until)`; create/update and list endpoints expose these fields without changing existing response money values.

- [ ] Write failing API tests for legacy defaults, invalid account type/currency, creating/removing coverage links, over-allocation, and untouched budget amounts.
- [ ] Run targeted tests and confirm feature-absence failures.
- [ ] Add models, migration, validation, response types, and link endpoints. Preserve legacy rows; set existing expense planning kind to fixed and method to unset.
- [ ] Run targeted API tests and migration upgrade on a disposable SQLite/PostgreSQL test database; confirm prior amounts and IDs survive.
- [ ] Commit.

### Task 2: Verified settlement state

**Files:** `app/main.py`, `app/reporting.py`, `tests/test_recurring_match_validation.py`, `frontend-react/src/pages/MonthlyCashFlow.tsx`.

**Interfaces:** a settlement payload for `(recurring_id, month)` with `status: matched | manual | open`, `actual_amount?: number`, `transaction_id?: number` derived server-side; match validation rejects account/currency/sign/window mismatches and duplicate transaction use.

- [ ] Write failing tests for card-account matching, invalid amount supplied by client, duplicate transaction, ignored/missing match, and manual-paid state.
- [ ] Run targeted tests to confirm failure.
- [ ] Implement server-derived match amount and safe settlement status; update cash-flow labels without treating manual state as actual money.
- [ ] Run tests for existing debit matching and new card matching.
- [ ] Commit.

### Task 3: Card cycle forecast

**Files:** `app/reporting.py`, `app/main.py`, `frontend-react/src/utils/cardCycleForecast.ts`, `frontend-react/tests/card-cycle-forecast.test.ts`, `tests/test_card_cycle_dates.py`.

**Interfaces:** `billMonthForCharge(chargeDate, closingDay, dueDay)` and `forecastCardBill(cardId, month, actualCharges, unmatchedRecurringCharges)` produce one amount due per card/cycle; actual matched purchase replaces its estimate.

- [ ] Write failing tests for close-day boundary, short months, actual replacing estimate, and no duplicate bill amount.
- [ ] Run tests and confirm failures.
- [ ] Implement clamped date handling in backend and shared frontend forecast, using the existing statement-month convention.
- [ ] Run targeted tests and existing card-summary tests.
- [ ] Commit.

### Task 4: Cash Flow payment routes

**Files:** `frontend-react/src/pages/MonthlyCashFlow.tsx`, `frontend-react/src/utils/cashFlowProjection.ts`, `frontend-react/tests/cash-flow-payment-routes.test.ts`.

**Interfaces:** `projectCashFlow(accounts, recurrences, cardBills, settlements)` returns debit outflow, card bill outflow, unresolved items, and projected bank balance/incomplete state.

- [ ] Write failing tests for debit fixed, card fixed, mixed methods, manual paid, and unset route.
- [ ] Run targeted tests and confirm failures.
- [ ] Move calculation into helper; show separate bank bills, planned card purchases, and card bills due, with incomplete projection for unset routes.
- [ ] Run targeted tests and UI build.
- [ ] Commit.

### Task 5: Shared monthly plan and actual split

**Files:** `frontend-react/src/utils/monthlyPlan.ts`, `frontend-react/tests/monthly-plan.test.ts`, `frontend-react/src/pages/PlannedVsReal.tsx`, `frontend-react/src/pages/RecurringExpenses.tsx`.

**Interfaces:** `calculateMonthlyPlan(month, currency, recurring, budgets, coverageLinks, transactions, matches)` returns fixed planned/actual, variable allowance/actual, unresolved overlaps, total or incomplete state. Real uses unique eligible transaction IDs; card repayments classified Transfer are excluded.

- [ ] Write failing tests for Rent 2600 linked/unlinked, Insurance 418 linked, Phone partial coverage, card purchase actual, repayment transfer, subscription variable, and historical budget version.
- [ ] Run targeted tests and confirm failures.
- [ ] Implement shared calculation and replace contradictory totals on both planning pages.
- [ ] Run targeted tests and build.
- [ ] Commit.

### Task 6: Configuration and readable budget layout

**Files:** `frontend-react/src/pages/RecurringExpenses.tsx`, `frontend-react/src/pages/PlannedVsReal.tsx`, `frontend-react/src/components/CreditCardOptions.tsx`, `frontend-react/tests/planning-ui.test.tsx` (or existing UI test harness).

**Interfaces:** editing fixed/variable and account/card routing; explicit budget-item coverage linking; monthly equation, fixed bill list, variable budget list, and transaction detail; warning for unresolved data.

- [ ] Write failing UI tests for edit/save/reload of method and classification, explicit link creation, unchanged budget value, and mobile-visible status labels.
- [ ] Run targeted tests and confirm failures.
- [ ] Implement controls and responsive layouts using existing FinDu visual language; preserve card cycle and methodology features.
- [ ] Run frontend tests, typecheck/build, and desktop/mobile browser checks.
- [ ] Commit.

### Task 7: Manual update checklist and end-to-end verification

**Files:** `docs/<manual-checklist>.md`, integration tests as needed.

**Interfaces:** checklist names each existing fixed recurrence's payment route to confirm, insurance rows to create, budget items to link, subscriptions to keep variable, and biweekly cadence to review. It must be based on read-only current data at delivery time.

- [ ] Compare production data read-only against migrated schema and list unresolved fields; never alter live financial rows as part of checklist generation.
- [ ] Run full backend suite, frontend tests/build/lint, and migration checks on disposable database.
- [ ] Inspect changed UI on desktop/mobile and verify Rent/Insurance/card examples.
- [ ] Commit checklist and report outstanding manual actions and deployment status.
