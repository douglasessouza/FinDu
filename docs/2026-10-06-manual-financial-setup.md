# Manual setup after the fixed and variable update

This checklist is based on a read-only snapshot of the FinDu database on 2026-10-06, viewed for November 2026. The code change does not edit existing financial rows. Complete these steps in the app after the migration and application have been deployed. Confirm amounts and dates against the actual bills before saving.

## 1. Assign the payment route for existing fixed bills

The following seven CAD recurring expenses already exist. Open each row and select **Bank account** or **Credit card**, then choose the exact account. The app will show the cash projection as incomplete while any route remains unset.

| Existing bill | Planned amount | Due day | Route to confirm |
|---|---:|---:|---|
| Rent | CAD 2,600.00 | 1 | Choose the bank account actually debited |
| Affirm Canada | CAD 66.62 | 7 | Choose bank account or card |
| Car Bi-Weekly | CAD 362.78 | 8 | Choose bank account or card |
| Shark Vida | CAD 135.60 | 17 | Choose bank account or card |
| Affirm Canada - Mac | CAD 63.26 | 18 | Choose bank account or card |
| Provident Energy | CAD 150.00 | 19 | Choose bank account or card |
| Car Bi-Weekly | CAD 362.78 | 23 | Choose bank account or card |

Available CAD accounts in the snapshot were RBC checking, Amex, Amex Jaque, Doug's BMO, Doug's RBC, and RBC Jaque. Select from the app after confirming which one pays each bill; the account names alone do not establish the route.

## 2. Add missing fixed commitments

- **Car insurance:** add a fixed recurring expense. The existing Insurance budget contains an item named `Car` for CAD 418. Confirm that CAD 418 is the actual premium, its charge day, start/end dates, and **which credit card** is charged. Then link the `Car` budget item to this fixed bill for the amount it covers. This preserves the CAD 418 budget value while removing its fixed portion from flexible allowance.
- **Home insurance:** add a fixed recurring expense once you confirm the premium, billing frequency, charge day, start/end dates, and bank account or card. Add or link a budget item only if an existing item already covers it.
- **Cell phone / Rogers:** the Phone budget contains `Rogers` CAD 137, but the current fixed list contains only the two Affirm phone instalments. If Rogers is a required recurring phone bill, add it as fixed with its actual amount/date/payment route and link the `Rogers` budget item.

## 3. Review existing budget coverage

- Link **Rent CAD 2,600** budget item to the existing **Rent CAD 2,600** fixed bill. The app will then show fixed CAD 2,600 and flexible CAD 0 for that item, without rewriting the budget.
- Review Phone budget items `Affirm Mac` CAD 67 and `Affirm Iphone` CAD 67 against fixed bills CAD 63.26 and CAD 66.62. Confirm which item covers which bill; small remainders can remain flexible. Do not assume they match from their labels alone.
- Review Housing budget `Provident` CAD 210 and `Others` CAD 150 against the existing **Provident Energy CAD 150** fixed bill. Choose the item and covered amount that reflect your plan.
- Keep **Subscriptions** as variable spending. Its CAD 120 budget does not become a fixed commitment merely because the charges repeat.
- Review the two `Car Bi-Weekly` rows. They are scheduled for days 8 and 23 each month (24 payments per year), while a true biweekly schedule has 26 payments per year. Confirm which schedule matches the lender before relying on annual totals.

## 4. Historical match to review

One existing transaction (ID 351) is attached to two payroll matches, one for June 2026 (match ID 8) and one for July 2026 (match ID 10). The update prevents new matches from reusing a transaction, but it does not delete or rewrite this historical data. Review which payroll occurrence the transaction actually paid before changing either match.

## Data safety

Before deployment to the live database, take a verified backup/snapshot, record row counts and sums for `recurring_expenses`, `category_budgets`, `category_budget_items`, `transactions`, `monthly_payments`, and `recurring_matches`, then run the additive migration and compare those counts and sums. No automatic creation, deletion, or reclassification of individual bills or budget items is part of this rollout.
