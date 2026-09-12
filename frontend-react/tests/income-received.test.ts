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
