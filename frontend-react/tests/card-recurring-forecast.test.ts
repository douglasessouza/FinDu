import assert from 'node:assert/strict'
import test from 'node:test'
import { forecastCardRecurringDue, splitExpenseRoutes } from '../src/utils/cardRecurringForecast.ts'

const visa = { id: 7, name: 'Visa', currency: 'CAD', account_type: 'CREDIT_CARD', closing_day: 20, due_day: 10 }
const insurance = { id: 2, name: 'Insurance', amount: 418, currency: 'CAD', due_day: 12,
  type: 'EXPENSE', category: 'Insurance', payment_method: 'CREDIT_CARD', payment_account_id: 7,
  start_month: '2026-11' }

test('a credit-card fixed charge never enters debit outflow', () => {
  const routes = splitExpenseRoutes([insurance, { ...insurance, id: 3, payment_method: 'UNSET' }])
  assert.equal(routes.debit.length, 0)
  assert.equal(routes.card.length, 1)
  assert.equal(routes.unset.length, 1)
})

test('future insurance purchase lands in card bill due month and posted charge replaces estimate', () => {
  const estimate = forecastCardRecurringDue('2026-12', [insurance], [visa], [])
  assert.equal(estimate.get(7), 418)
  const posted = [{ id: 30, account_id: 7, date: '2026-11-12', amount: -420,
    currency: 'CAD', category: 'Insurance', description: 'Insurance', payment_due_date: '2026-12-10' }]
  assert.equal(forecastCardRecurringDue('2026-12', [insurance], [visa], posted).get(7), undefined)
  assert.equal(forecastCardRecurringDue('2026-11', [insurance], [visa], [] ).get(7), undefined)
})

test('card due day 31 is clamped in February', () => {
  const card = { ...visa, closing_day: 31, due_day: 31 }
  assert.equal(forecastCardRecurringDue('2027-02', [
    { ...insurance, due_day: 31, start_month: '2027-01' },
  ], [card], []).get(7), 418)
})
