import assert from 'node:assert/strict'
import test from 'node:test'
import { projectCalendarMonths, projectionMonthKeys } from '../src/utils/calendarProjection.ts'
import type { MonthlyDashboardResponse, RecurringExpense } from '../src/services/api.ts'

const income: RecurringExpense = { id: 1, name: 'Salary', amount: 1000, currency: 'CAD', due_day: 30, type: 'INCOME', category: 'Salary' }
const rent: RecurringExpense = { id: 2, name: 'Rent', amount: 200, currency: 'CAD', due_day: 1, type: 'EXPENSE', payment_method: 'DEBIT', payment_account_id: 1 }
function dashboard(month: string, changes: Partial<MonthlyDashboardResponse> = {}): MonthlyDashboardResponse {
  const cards = { month, cards: [], total_charges: 0, total_credits: 0, total_payments: 0, total_amount_due: 0, currency: null, totals_by_currency: {} }
  return { month, accounts: [{ id: 1, name: 'Checking', bank: 'BMO', account_type: 'CHECKING', balance: 500, currency: 'CAD' }], recurring: [income, rent], payments: [], matches: [], overrides: [], previous_month_overrides: [], checking_transactions: [], card_transactions_current: [], card_transactions_due: [], card_summaries: cards, card_summaries_due: cards, ...changes }
}

test('salary on the 30th is counted once and each future month starts at the preceding close', () => {
  const result = projectCalendarMonths([dashboard('2026-11'), dashboard('2026-12')], 'CAD', '2026-11', () => 0)
  assert.equal(result['2026-11'].closingBalance, 1300)
  assert.equal(result['2026-12'].startingBalance, 1300)
  assert.equal(result['2026-12'].closingBalance, 2100)
  assert.equal(result['2026-12'].netCashFlow, 800)
})

test('already received November salary is never added again in December', () => {
  const november = dashboard('2026-11', { checking_transactions: [{ id: 10, account_id: 1, date: '2026-11-30', description: 'Salary', amount: 1000, currency: 'CAD', category: 'Salary' }] })
  const result = projectCalendarMonths([november, dashboard('2026-12')], 'CAD', '2026-11', () => 0)
  assert.equal(result['2026-11'].remainingIncome, 0)
  assert.equal(result['2026-12'].startingBalance, 300)
  assert.equal(result['2026-12'].closingBalance, 1100)
})

test('overrides, cancellations, currency, validity, paid bills and savings affect the full chain', () => {
  const december = dashboard('2026-12', { recurring: [income, rent, { ...income, id: 3, currency: 'USD' }, { ...rent, id: 4, start_month: '2027-01' }, { ...rent, id: 5, valid_until: '2026-11-30' }], overrides: [{ id: 1, recurring_id: 1, month: '2026-12', amount: 1200 }], payments: [{ id: 1, month: '2026-12', item_type: 'recurring', item_id: 2 }] })
  const january = dashboard('2027-01', { payments: [{ id: 2, month: '2027-01', item_type: 'income_cancelled', item_id: 1 }] })
  const result = projectCalendarMonths([dashboard('2026-11'), december, january], 'CAD', '2026-11', () => 50)
  assert.equal(result['2026-12'].remainingIncome, 1200)
  assert.equal(result['2026-12'].remainingExpenses, 0)
  assert.equal(result['2027-01'].closingBalance, 2150)
})

test('matched bills and received non-payroll deposits are excluded from remaining movements', () => {
  const result = projectCalendarMonths([dashboard('2026-11', { recurring: [rent, { ...income, name: 'Rental income', category: 'Other Income' }], checking_transactions: [{ id: 1, account_id: 1, date: '2026-11-01', description: 'Rent', amount: -200, currency: 'CAD' }, { id: 2, account_id: 1, date: '2026-11-30', description: 'Rental income', amount: 1000, currency: 'CAD', category: 'Other Income' }] })], 'CAD', '2026-11', () => 0)
  assert.equal(result['2026-11'].remainingExpenses, 0)
  assert.equal(result['2026-11'].remainingIncome, 0)
  assert.equal(result['2026-11'].closingBalance, 500)
})

test('manual receipt and paid cards already reflected in the bank are not counted twice', () => {
  const month = dashboard('2026-11', { payments: [{ id: 1, month: '2026-11', item_type: 'income', item_id: 1 }, { id: 2, month: '2026-11', item_type: 'card', item_id: 9 }] })
  month.card_summaries_due.cards = [{ account_id: 9, account_name: 'Card', currency: 'CAD', amount_due: 300, charges: 300, credits: 0, payments: 0, count: 1 }]
  const result = projectCalendarMonths([month], 'CAD', '2026-11', () => 0)['2026-11']
  assert.equal(result.closingBalance, 300)
  assert.equal(result.netCashFlow, 500)
})

test('month keys cross years and past months have no fabricated closing bank balance', () => {
  assert.deepEqual(projectionMonthKeys('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02'])
  assert.deepEqual(projectionMonthKeys('2026-11', '2026-09'), ['2026-09'])
  const result = projectCalendarMonths([dashboard('2026-09')], 'CAD', '2026-11', () => 0)['2026-09']
  assert.equal(result.closingBalance, null)
  assert.equal(result.netCashFlow, 800)
})

test('cancelling and restoring a prior-month salary immediately updates the selected future balance', async () => {
  const { applyProjectionPayments } = await import('../src/utils/calendarProjection.ts')
  const dashboards = [dashboard('2026-11'), dashboard('2026-12'), dashboard('2027-01')]
  const cancellation = { id: 3, month: '2026-12', item_type: 'income_cancelled', item_id: 1, item_name: 'Salary', paid_at: '' }
  const updated = applyProjectionPayments(dashboards, [cancellation], '2027-01')
  const result = projectCalendarMonths(updated, 'CAD', '2026-11', () => 0)
  assert.equal(result['2027-01'].startingBalance, 1100)
  assert.equal(result['2027-01'].closingBalance, 1900)
  const restored = applyProjectionPayments(updated, [], '2027-01')
  assert.equal(projectCalendarMonths(restored, 'CAD', '2026-11', () => 0)['2027-01'].closingBalance, 2900)
})

test('card-paid recurring bills enter the cumulative balance only in the card due month', () => {
  const card = { id: 9, name: 'Amex', bank: 'Amex', account_type: 'CREDIT_CARD' as const, currency: 'CAD' as const, balance: 0, closing_day: 15, due_day: 4 }
  const insurance: RecurringExpense = { id: 8, name: 'Insurance', amount: 100, currency: 'CAD', due_day: 1, type: 'EXPENSE', payment_method: 'CREDIT_CARD', payment_account_id: 9, start_month: '2026-11' }
  const months = ['2026-11', '2026-12'].map(month => {
    const data = dashboard(month)
    data.accounts.push(card)
    data.recurring.push(insurance)
    return data
  })
  const estimated = projectCalendarMonths(months, 'CAD', '2026-11', () => 0)
  assert.equal(estimated['2026-11'].remainingExpenses, 200)
  assert.equal(estimated['2026-12'].remainingExpenses, 300)
  assert.equal(estimated['2026-12'].closingBalance, 2000)
  months[1].card_transactions_due = [{ id: 10, account_id: 9, date: '2026-11-01', amount: -100, currency: 'CAD', description: 'Insurance' }]
  months[1].card_summaries_due.cards = [{ account_id: 9, account_name: 'Amex', currency: 'CAD', amount_due: 100, charges: 100, credits: 0, payments: 0, count: 1 }]
  assert.equal(projectCalendarMonths(months, 'CAD', '2026-11', () => 0)['2026-12'].closingBalance, 2000)
})
