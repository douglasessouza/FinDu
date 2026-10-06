import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMonthlyPlan } from '../src/utils/monthlyPlan.ts'

const rent = { id: 1, name: 'Rent', amount: 2600, currency: 'CAD', due_day: 1,
  type: 'EXPENSE', category: 'Rent', planning_kind: 'FIXED' }
const budget = { id: 4, category: 'Rent', currency: 'CAD', amount: 2600,
  start_month: '2026-11', is_active: true, items: [{ id: 5, name: 'Rent', amount: 2600 }] }

test('linked rent counts once without changing the saved budget', () => {
  const result = calculateMonthlyPlan('2026-11', 'CAD', [rent], [budget],
    [{ id: 8, budget_item_id: 5, recurring_id: 1, amount: 2600 }], [], [])
  assert.equal(result.fixedPlanned, 2600)
  assert.equal(result.variableAllowance, 0)
  assert.equal(result.grossBudget, 2600)
  assert.equal(result.totalPlanned, 2600)
  assert.equal(budget.amount, 2600)
})

test('unlinked overlap cannot masquerade as a reliable total', () => {
  const result = calculateMonthlyPlan('2026-11', 'CAD', [rent], [budget], [], [], [])
  assert.equal(result.fixedPlanned, 2600)
  assert.equal(result.variableAllowance, 2600)
  assert.equal(result.grossBudget, 2600)
  assert.equal(result.totalPlanned, null)
  assert.deepEqual(result.unresolvedCategories, ['Rent'])
})

test('excluded insurance budget stays saved but does not count as flexible before its fixed bill exists', () => {
  const insuranceBudget = { ...budget, id: 9, category: 'Insurance', amount: 446,
    items: [{ id: 10, name: 'Car insurance', amount: 446 }] }
  const result = calculateMonthlyPlan('2026-11', 'CAD', [rent], [insuranceBudget], [], [], [],
    [{ budget_item_id: 10, effective_month: '2026-10', treatment: 'EXCLUDED' }])
  assert.equal(result.grossBudget, 446)
  assert.equal(result.variableAllowance, 0)
  assert.equal(result.totalPlanned, null)
  assert.deepEqual(result.missingFixedCategories, ['Insurance'])
})

test('a card purchase matched to insurance is fixed actual; card repayment is excluded', () => {
  const insurance = { ...rent, id: 2, name: 'Insurance', category: 'Insurance', amount: 418,
    payment_method: 'CREDIT_CARD', payment_account_id: 7 }
  const flexibleBudget = { ...budget, id: 6, category: 'Amazon', amount: 200,
    items: [{ id: 9, name: 'Amazon', amount: 200 }] }
  const transactions = [
    { id: 10, account_id: 7, amount: -420, currency: 'CAD', category: 'Insurance', date: '2026-11-12', statement_month: '2026-11' },
    { id: 11, account_id: 7, amount: -30, currency: 'CAD', category: 'Amazon', date: '2026-11-13', statement_month: '2026-11' },
    { id: 12, account_id: 3, amount: -450, currency: 'CAD', category: 'Transfer', date: '2026-11-18' },
  ]
  const result = calculateMonthlyPlan('2026-11', 'CAD', [insurance], [flexibleBudget], [], transactions,
    [{ recurring_id: 2, transaction_id: 10, source: 'auto' }])
  assert.equal(result.fixedActual, 420)
  assert.equal(result.variableActual, 30)
  assert.equal(result.totalPlanned, 618)
})

test('unclassified amount exposes the exact transactions needing review', () => {
  const insuranceBudget = { ...budget, id: 9, category: 'Insurance', start_month: '2026-10', amount: 446,
    items: [{ id: 10, name: 'Car insurance', amount: 446 }] }
  const result = calculateMonthlyPlan('2026-10', 'CAD', [rent], [insuranceBudget], [], [
    { id: 21, account_id: 7, description: 'Insurance charge', amount: -238.90, currency: 'CAD', category: 'Insurance', date: '2026-10-12', statement_month: '2026-10' },
    { id: 22, account_id: 2, description: 'Rent payment', amount: -2600, currency: 'CAD', category: 'Rent', date: '2026-10-01' },
    { id: 23, account_id: 7, description: 'Amazon', amount: -20, currency: 'CAD', category: 'Amazon', date: '2026-10-13' },
  ], [{ recurring_id: 1, transaction_id: 22, source: 'manual' }],
  [{ budget_item_id: 10, effective_month: '2026-10', treatment: 'EXCLUDED' }])
  assert.equal(result.unclassifiedActual, 238.90)
  assert.deepEqual(result.needsReviewTransactions.map(row => row.id), [21])
})
