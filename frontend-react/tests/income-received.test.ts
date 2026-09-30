import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateRemainingIncome, calculateProjectedBalance } from '../src/utils/cashFlowProjection.ts'

test('income already included in a deposit reduces pending income without changing bank balance', () => {
  const pending = calculateRemainingIncome(7561.02, 5053.21, 450)
  assert.equal(pending, 2057.81)
  assert.equal(calculateProjectedBalance({ currentBalance: 12578.86, remainingIncome: pending, remainingExpenses: 846.12, remainingSavings: 400 }), 13390.55)
})

test('undoing receipt restores pending income and confirmations cannot make it negative', () => {
  assert.equal(calculateRemainingIncome(7561.02, 5053.21, 0), 2507.81)
  assert.equal(calculateRemainingIncome(450, 0, 450), 0)
  assert.equal(calculateRemainingIncome(450, 500, 450), 0)
})

test('cancelled income stays visible but contributes nothing to either pay period', async () => {
  const { buildPayPeriodSummary } = await import('../src/utils/payPeriodSummary.ts')
  const summary = buildPayPeriodSummary({ incomes: [
    { id: 'salary', name: 'Salary', dueLabel: 'Sep 28', amount: 3000, period: 'first', cancelled: true },
    { id: 'rent', name: 'Rent', dueLabel: 'Oct 9', amount: 450, period: 'first' },
    { id: 'payroll', name: 'Payroll', dueLabel: 'Oct 15', amount: 2060, actualAmount: 2060, period: 'second', cancelled: true },
  ], expenses: [] })
  assert.equal(summary.firstPeriod.income, 450)
  assert.equal(summary.firstPeriod.incomes[0].status, 'Cancelled')
  assert.equal(summary.firstPeriod.incomes[0].amount, 3000)
  assert.equal(summary.secondPeriod.income, 0)
})

test('manual and cancelled payroll occurrences change the projection without double counting deposits', async () => {
  const { calculateOccurrenceIncome } = await import('../src/utils/cashFlowProjection.ts')
  const items = [
    { amount: 3000, payroll: true, cancelled: true },
    { amount: 2060, payroll: true, received: true },
    { amount: 450, payroll: false },
  ]
  assert.equal(calculateOccurrenceIncome(items, 2060).remaining, 450)
  assert.equal(calculateOccurrenceIncome(items, 0).remaining, 450)
  assert.equal(calculateOccurrenceIncome(items, 2060).planned, 2510)
  assert.equal(calculateOccurrenceIncome([{ amount: 3000, payroll: true }], 0).remaining, 3000)
  assert.equal(calculateOccurrenceIncome([{ amount: 2060, payroll: true, matchedAmount: 2060, salaryMatch: true }, { amount: 450, payroll: false }], 2060).remaining, 450)
})

test('salary aggregation uses the same 28-to-27 cycle as income occurrences', async () => {
  const { isIncomeInCashFlowMonth } = await import('../src/utils/payPeriodSummary.ts')
  assert.equal(isIncomeInCashFlowMonth('2026-09-28', '2026-10'), true)
  assert.equal(isIncomeInCashFlowMonth('2026-10-27', '2026-10'), true)
  assert.equal(isIncomeInCashFlowMonth('2026-10-28', '2026-10'), false)
  assert.equal(isIncomeInCashFlowMonth('2026-09-27', '2026-10'), false)
  assert.equal(isIncomeInCashFlowMonth('2026-12-31', '2027-01'), true)
})
