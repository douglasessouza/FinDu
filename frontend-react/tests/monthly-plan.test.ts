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

test('sharing a broad category with a fixed bill does not put ordinary card purchases in review', () => {
  const energy = { ...rent, id: 2, name: 'Provident Energy', amount: 150, due_day: 19,
    category: 'Housing', payment_method: 'CREDIT_CARD', payment_account_id: 7 }
  const otherBill = { ...rent, id: 3, name: 'Shark Vida', amount: 135.60, due_day: 17,
    category: 'Other', payment_method: 'CREDIT_CARD', payment_account_id: 7 }
  const result = calculateMonthlyPlan('2026-10', 'CAD', [energy, otherBill], [], [], [
    { id: 31, account_id: 7, description: 'Winners', amount: -157.70, currency: 'CAD', category: 'Housing', date: '2026-10-03' },
    { id: 32, account_id: 7, description: 'Amazon', amount: -51.97, currency: 'CAD', category: 'Other', date: '2026-10-01' },
  ], [])
  assert.equal(result.variableActual, 209.67)
  assert.equal(result.unclassifiedActual, 0)
  assert.deepEqual(result.needsReviewTransactions, [])
})

test('insurance on its configured card is reviewed until matched, then counted once as fixed', () => {
  const insurance = { ...rent, id: 2, name: 'Car insurance', amount: 238.90, due_day: 12,
    category: 'Insurance', payment_method: 'CREDIT_CARD', payment_account_id: 7 }
  const insuranceBudget = { ...budget, id: 9, category: 'Insurance', start_month: '2026-10', amount: 238.90,
    items: [{ id: 10, name: 'Car insurance', amount: 238.90 }] }
  const tx = { id: 21, account_id: 7, description: 'Insurer premium', amount: -238.90,
    currency: 'CAD', category: 'Insurance', date: '2026-10-12', statement_month: '2026-10' }
  const treatments = [{ budget_item_id: 10, effective_month: '2026-10', treatment: 'EXCLUDED' as const }]
  const awaiting = calculateMonthlyPlan('2026-10', 'CAD', [insurance], [insuranceBudget], [], [tx], [], treatments)
  assert.equal(awaiting.totalPlanned, 238.90)
  assert.equal(awaiting.fixedActual, 0)
  assert.equal(awaiting.unclassifiedActual, 238.90)
  assert.deepEqual(awaiting.needsReviewTransactions.map(row => row.id), [21])
  assert.equal(awaiting.needsReviewTransactions[0].possibleFixedBill, 'Car insurance')

  const matched = calculateMonthlyPlan('2026-10', 'CAD', [insurance], [insuranceBudget], [], [tx],
    [{ recurring_id: 2, transaction_id: 21, source: 'auto' }], treatments)
  assert.equal(matched.totalPlanned, 238.90)
  assert.equal(matched.fixedActual, 238.90)
  assert.equal(matched.variableActual, 0)
  assert.equal(matched.unclassifiedActual, 0)
  assert.deepEqual(matched.needsReviewTransactions, [])
})

test('excluded insurance without a fixed bill is not mislabeled as a possible bill match', () => {
  const insuranceBudget = { ...budget, id: 9, category: 'Insurance', start_month: '2026-10', amount: 238.90,
    items: [{ id: 10, name: 'Car insurance', amount: 238.90 }] }
  const result = calculateMonthlyPlan('2026-10', 'CAD', [], [insuranceBudget], [], [
    { id: 21, account_id: 7, description: 'Insurer premium', amount: -238.90,
      currency: 'CAD', category: 'Insurance', date: '2026-10-12', statement_month: '2026-10' },
  ], [], [{ budget_item_id: 10, effective_month: '2026-10', treatment: 'EXCLUDED' }])
  assert.equal(result.variableActual, 238.90)
  assert.equal(result.unclassifiedActual, 0)
  assert.deepEqual(result.missingFixedCategories, ['Insurance'])
})

test('a rejected bill match is not proposed again for the same transaction', () => {
  const insurance = { ...rent, id: 2, name: 'Car insurance', amount: 238.90, due_day: 12,
    category: 'Insurance', payment_method: 'CREDIT_CARD', payment_account_id: 7 }
  const result = calculateMonthlyPlan('2026-10', 'CAD', [insurance], [], [], [
    { id: 21, account_id: 7, description: 'Insurer premium', amount: -238.90,
      currency: 'CAD', category: 'Insurance', date: '2026-10-12' },
  ], [{ recurring_id: 2, transaction_id: 21, source: 'ignored' }])
  assert.equal(result.variableActual, 238.90)
  assert.equal(result.unclassifiedActual, 0)
})

test('a similar charge on another account is not suggested as payment of a card bill', () => {
  const insurance = { ...rent, id: 2, name: 'Car insurance', amount: 238.90, due_day: 12,
    category: 'Insurance', payment_method: 'CREDIT_CARD', payment_account_id: 7 }
  const result = calculateMonthlyPlan('2026-10', 'CAD', [insurance], [], [], [
    { id: 21, account_id: 8, description: 'Car insurance premium', amount: -238.90,
      currency: 'CAD', category: 'Insurance', date: '2026-10-12' },
  ], [])
  assert.equal(result.variableActual, 238.90)
  assert.equal(result.unclassifiedActual, 0)
})
