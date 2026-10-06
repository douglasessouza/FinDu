# Fixed, Variable, and Payment Flow Design

## Goal and agreed rules

FinDu should answer three different questions for each month: what is committed, what spending is discretionary, and when money will leave a bank account. A recurring charge can be a fixed commitment even when it is charged to a credit card. A category can contain both fixed and variable costs. A manually marked payment and an imported transaction are different kinds of evidence.

The owner's current decisions are:

- Rent, car instalments, phone instalments (including Affirm), and the car and home insurance belong among fixed commitments. Existing Affirm rows remain fixed.
- Subscriptions belong with variable spending because the owner can cancel them; recurrence alone does not make a charge fixed.
- Car insurance is paid by credit card. Its card and the home insurance's actual payment method must be selected by the owner.
- Existing category budget amounts and history must not be overwritten to classify spending.
- After delivery, provide a concrete checklist of records the owner must add, link, or assign to a debit account or card.

Success means the monthly view separates fixed commitments, available variable budget, and actual spending; the cash projection counts a credit-card purchase only when the card bill is payable; and no transaction, budget allowance, or bill is counted twice.

## Chosen approach

Keep `RecurringExpense` as the schedule for recurring income and expenses, `CategoryBudget` and its items as the existing allowance, and `Transaction` as the source of actual spending. Add explicit classification, payment routing, and optional links from budget items to recurring expenses. The link says that an existing budget item already covers some or all of a fixed commitment. It never changes the original budget amount. Unlinked overlaps are flagged for review, not inferred from a matching name or category.

Category-only classification was rejected because `Car`, `Housing`, and `Phone` can contain both fixed and variable costs. Automatically subtracting same-named items was rejected because labels do not prove two records represent the same bill. Rebuilding all budgets was rejected because it would alter prior planning and require avoidable data entry.

## Data and migration

- Add `planning_kind` to expense recurrences, with `FIXED` or `VARIABLE`. Existing expense recurrences display as `FIXED` initially; income is unaffected. It remains editable for subscriptions or other cancelable recurring charges.
- Add `payment_method` to expense recurrences: `DEBIT`, `CREDIT_CARD`, or `UNSET`, plus a nullable `payment_account_id`. Credit requires an active credit-card account in the same currency; debit requires a non-card account in that currency. `UNSET` requires review and must not silently enter the debit cash projection. Preserve prior records and their payment markers.
- Add explicit budget-item-to-recurring coverage links with an allocated amount and effective period. An item may cover several bills, but the sum of its links cannot exceed its amount; a recurrence cannot be covered for more than its planned amount in the selected month. The item keeps its name and amount. Linking requires the same currency and overlapping periods. Links can be removed without deleting either record. If the item and recurrence amounts differ, show the difference; do not silently edit either value.
- Keep budget versioning by month. If a budget adjustment creates new item IDs, carry forward approved links only where the new item is demonstrably the same item; otherwise request review. Historical monthly results use the link valid for that month.
- Existing budgets, transactions, monthly payment markers, and recurring matches retain their IDs and monetary values. Migration is additive. No insurance recurring row is created automatically because its date, amount, end date, and payment account need owner confirmation.

## Monthly planning arithmetic

For a selected month and currency, show:

1. **Fixed commitments:** sum of active `FIXED` expense recurrences, using that month's override when present.
2. **Variable allowance:** sum of active category budget items minus their approved fixed coverage amounts, floored at zero for each item. Variable recurring expenses can consume a variable allowance but do not add another fixed commitment.
3. **Total planned outflow:** fixed commitments plus variable allowance once relevant same-category overlaps have been reviewed. Unlinked budget items remain in the variable allowance and are visibly flagged when their category also has a fixed commitment. While such overlaps remain, show the two subtotals but label the combined figure `Needs review` rather than presenting it as a reliable total.

Example: `Rent` recurring CAD 2,600 and a `Rent` budget item CAD 2,600 become fixed CAD 2,600 and variable CAD 0 after the owner links them. Until linked, both remain visible with a review warning rather than an apparently definitive combined total. The existing `Insurance` budget item CAD 418 can likewise cover a newly entered car-insurance recurrence after explicit linking. `Phone` and `Housing` need item-level review because their existing items and fixed amounts do not align exactly.

The selected-month budget screen continues to show card spending in its existing statement-month convention; cash flow follows payment-due month. Label both periods so the same purchase is understandable across pages. Sum real spending from eligible transactions once. A matched transaction assigns that spending to a fixed occurrence; the remaining eligible transactions feed variable actuals. Card-bill transfers are not new spending. Show any unclassified or unmatched spending separately instead of forcing it into a fixed/variable subtotal.

## Payment and reconciliation rules

- A debit fixed expense is a prospective bank outflow on its due date until a matching bank transaction or manual paid marker removes the remaining projection.
- A card fixed expense appears as a commitment in the month of purchase. It does not directly reduce checking balance. It contributes to the forecast for the selected card's statement cycle; the bank outflow is the bill due date. Once the real card transaction exists, that transaction replaces the forecast amount for the occurrence. An actual closed statement amount takes precedence over estimated purchases.
- A manual “paid” marker says the owner confirmed payment, but it has no verified actual amount. Display `Marked paid · amount unverified`; a valid match displays `Matched · CAD x` and uses the transaction's signed amount and currency. An ignored match does not prove payment.
- Match candidates are restricted to the selected payment account, currency, appropriate occurrence window and card cycle, and expense sign. The API validates these rules, obtains the actual amount from the transaction, and prevents one transaction from satisfying two expense occurrences. Existing legacy matches remain readable and are audited before applying stricter constraints.
- The card statement is counted once in Cash Flow, including actual charges and only unmatched forecasts for that cycle. Marking a card bill paid removes the remaining bank outflow, without erasing the underlying purchase from actual spending. A bank transfer paying a card is not counted again as a purchase.
- Monthly or twice-monthly schedules keep their current semantics. `Car Bi-Weekly` currently uses two monthly dates; genuine every-two-weeks scheduling (26 payments per year) requires a separate cadence decision and must not be silently inferred from its name.

## Interface

### Plan configuration

Keep the existing visual language. In the recurring expense form and edit panel, expose a plain-language choice `Fixed commitment` or `Flexible recurring expense`, followed by `Paid from bank account`, `Charged to credit card`, or `Choose later`. Show account/card only when relevant. The list displays a compact account/card label and a visible `Payment method needed` state. Do not classify a subscription as fixed solely because it repeats monthly.

In each budget item, provide `Covers a fixed bill` linking to one active recurring expense, or `Flexible allowance`. Show the remaining variable portion beside the original budget amount. Mark same-category unlinked overlaps for review. Preserve the budget's name, value, and period controls.

### Budget and card cycles

Lead with one compact monthly equation: fixed commitments + variable allowance = total plan, followed by actual fixed, actual variable, and remaining room. When budget coverage remains unresolved, show the subtotals and `Needs review` in place of a definitive total. Below it, show fixed bills in due-date order with status and payment route, then variable categories ordered by overspend or unplanned spending. Retain transaction drill-down, card cycle, and methodology features. A category detail can show fixed commitments and variable budget items side by side without treating all category transactions as variable.

Use the current typography and green/red language; reserve a distinct label and icon for `Fixed` versus `Flexible`. Colour alone does not carry status. On narrow screens, stack the equation and lists while keeping amount, status, and action readable. Empty and failed-load states explain which totals are unavailable.

### Cash Flow

Separate `Bank bills`, `Card purchases planned`, and `Card bills due`. The projected checking balance includes bank bills and card bills due, not card purchases as an immediate bank deduction. Card-purchase detail names its card and projected bill month. Rows already imported or manually marked paid have distinct status labels. Legacy rows with unset method appear in a review block and do not silently reduce a debit account; until those rows are assigned, label the cash projection incomplete instead of showing a confident balance.

## Delivery sequence and verification

1. Add model/API fields, migration, account validation, and explicit budget links without rewriting budgets.
2. Make reconciliation safe for debit and credit, including one-transaction-per-occurrence validation and short-month card-date handling.
3. Update Cash Flow forecasting and payment status based on method and statement cycle.
4. Update plan configuration and Budget & Card Cycles layouts using the same monthly calculation service so pages agree.
5. Provide the owner's manual-review checklist from the then-current records, including payment routes, insurance setup, budget links, subscription classification, and any ambiguous or stale matches.

Acceptance scenarios include: Rent CAD 2,600 linked to its existing item totals CAD 2,600; an unlinked overlap is visibly unresolved; a CAD 418 card insurance purchase is fixed but leaves checking only with its card bill; a real imported purchase replaces its forecast; a card payment transfer does not increase spending; manual paid does not invent actual spending; subscriptions remain variable; prior budget months and values are unchanged; a transaction cannot settle two bills; all rules respect currency, month, and card cycle. Verify with backend tests, frontend calculation tests, UI checks at desktop/mobile widths, and migration round-trip checks before deployment.
