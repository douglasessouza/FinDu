import assert from 'node:assert/strict'
import test from 'node:test'
import {
  budgetTotal,
  budgetVariancePercent,
  monthOverMonthImprovement,
  spendingTotal,
  yearOverYearSpendingChange,
} from '../src/utils/performanceMetrics.ts'
import type { CategoryBudget, SpendingAnalysisResponse } from '../src/services/api.ts'

test('budget performance is positive under budget and negative over budget', () => {
  assert.equal(budgetVariancePercent(1000, 900), 10)
  assert.equal(budgetVariancePercent(1000, 1125), -12.5)
  assert.equal(budgetVariancePercent(0, 100), null)
})

test('MoM improvement compares budget discipline in percentage points', () => {
  assert.equal(monthOverMonthImprovement(1000, 900, 1000, 1050), 15)
  assert.equal(monthOverMonthImprovement(1000, 1100, 1000, 900), -20)
})

test('YoY spending uses the conventional percentage change', () => {
  assert.equal(yearOverYearSpendingChange(900, 1000), -10)
  assert.equal(yearOverYearSpendingChange(1100, 1000), 10)
  assert.equal(yearOverYearSpendingChange(900, 0), null)
})

test('totals respect currency and monthly budget validity', () => {
  const spending: SpendingAnalysisResponse = {
    '2026-08': {
      Food: { cards: 0, debit: 0, currency: 'CAD', by_currency: { CAD: { cards: 70, debit: 30 } } },
      Travel: { cards: 0, debit: 0, currency: 'USD', by_currency: { USD: { cards: 50, debit: 0 } } },
    },
  }
  const budgets: CategoryBudget[] = [
    { id: 1, category: 'Food', amount: 200, currency: 'CAD', start_month: '2026-06', is_active: true },
    { id: 2, category: 'Expired', amount: 500, currency: 'CAD', start_month: '2026-01', valid_until: '2026-07-31T00:00:00', is_active: true },
    { id: 3, category: 'Travel', amount: 300, currency: 'USD', start_month: '2026-08', is_active: true },
  ]

  assert.equal(spendingTotal(spending, '2026-08', 'CAD'), 100)
  assert.equal(budgetTotal(budgets, '2026-08', 'CAD'), 200)
  assert.equal(budgetTotal(budgets, '2026-08', 'USD'), 300)
})
