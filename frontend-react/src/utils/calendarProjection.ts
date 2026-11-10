import type { CurrencyCode, MonthlyDashboardResponse, MonthlyPayment } from '../services/api.ts'
import { calculateOccurrenceIncome, calculateProjectedBalance } from './cashFlowProjection.ts'
import { expandRecurringForMonth, recurringMatchItem } from './recurrence.ts'
import { forecastCardRecurringDue, splitExpenseRoutes } from './cardRecurringForecast.ts'
import { findRecurringMatches, isPayrollIncome } from './recurringMatching.ts'

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function projectionMonthKeys(currentMonth: string, selectedMonth: string): string[] {
  if (selectedMonth < currentMonth) return [selectedMonth]
  const keys: string[] = []
  let [year, month] = currentMonth.split('-').map(Number)
  for (let key = currentMonth; key <= selectedMonth; key = `${year}-${String(month).padStart(2, '0')}`) {
    keys.push(key)
    if (++month === 13) { month = 1; year++ }
  }
  return keys
}

/** The page owns selected and prior-month receipt actions. Overlay both months,
 * including deletions, while retaining earlier snapshots in longer projections. */
export function applyProjectionPayments(dashboards: MonthlyDashboardResponse[], payments: MonthlyPayment[], selectedMonth: string): MonthlyDashboardResponse[] {
  const [year, month] = selectedMonth.split('-').map(Number)
  const previousMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
  return dashboards.map(dashboard => dashboard.month === selectedMonth || dashboard.month === previousMonth
    ? { ...dashboard, payments: payments.filter(payment => payment.month === dashboard.month) }
    : dashboard)
}

export interface CalendarProjection {
  startingBalance: number
  closingBalance: number | null
  remainingIncome: number
  remainingExpenses: number
  remainingSavings: number
  totalIncome: number
  totalExpenses: number
  netCashFlow: number
}

/** Account balance is today's snapshot. Only movements not already reflected in it
 * advance the projection. Salary-cycle assignment never changes deposit dates. */
export function projectCalendarMonths(
  dashboards: MonthlyDashboardResponse[],
  currency: CurrencyCode,
  currentMonth: string,
  savingsForMonth: (month: string) => number,
): Record<string, CalendarProjection> {
  const sorted = [...dashboards].sort((a, b) => a.month.localeCompare(b.month))
  const result: Record<string, CalendarProjection> = {}
  let balance = (sorted[0]?.accounts ?? []).filter(a => a.currency === currency && a.account_type !== 'CREDIT_CARD').reduce((sum, a) => sum + a.balance, 0)
  for (const dashboard of sorted) {
    const month = dashboard.month
    const overrides = new Map(dashboard.overrides.map(row => [row.recurring_id, row.amount]))
    const items = expandRecurringForMonth(dashboard.recurring.filter(item => item.currency === currency
      && (!item.start_month || item.start_month <= month)
      && (!item.valid_until || item.valid_until.slice(0, 7) >= month))
      .map(item => ({ ...item, amount: overrides.get(item.id) ?? item.amount })), month)
    const transactions = dashboard.checking_transactions.filter(tx => tx.currency === currency && tx.date.slice(0, 7) === month)
    const matches = findRecurringMatches(items, transactions, month, dashboard.accounts, true)
    for (const saved of dashboard.matches) {
      // A late prior-month salary can be saved against this planning cycle;
      // it must never settle the current calendar month's salary occurrence.
      if (saved.transaction?.date.slice(0, 7) !== month || saved.transaction.currency !== currency) continue
      const item = recurringMatchItem(items, saved.recurring_id, saved.transaction.date)
      if (!item) continue
      if (saved.source === 'ignored') delete matches[item.id]
      else matches[item.id] = { transaction: saved.transaction, actualAmount: saved.actual_amount, variance: saved.variance, confidence: saved.confidence, score: saved.score }
    }
    for (const row of dashboard.payments) {
      if (row.month === month && row.item_type === 'recurring_ignored') delete matches[row.item_id]
    }
    const payment = (kind: string, id: number) => dashboard.payments.some(row => row.month === month && row.item_type === kind && row.item_id === id)
    const occurrences = items.filter(item => item.type === 'INCOME').map(item => {
      const match = matches[item.id]
      return { amount: item.amount, payroll: isPayrollIncome(item), cancelled: payment('income_cancelled', item.id), received: payment('income', item.id), matchedAmount: match?.actualAmount, salaryMatch: match?.transaction.category?.trim().toLowerCase() === 'salary' }
    })
    const salary = transactions.filter(tx => tx.amount > 0 && tx.category?.trim().toLowerCase() === 'salary').reduce((sum, tx) => sum + tx.amount, 0)
    const income = calculateOccurrenceIncome(occurrences, salary)
    // Every actual deposit already exists in the bank snapshot. Use it in the
    // month's result, replacing its planned occurrence rather than adding twice.
    const nonSalaryDeposits = transactions.filter(tx => tx.amount > 0 && tx.category?.trim().toLowerCase() !== 'salary'
      && (tx.category?.trim().toLowerCase() === 'other income' || Object.values(matches).some(match => match.transaction.id === tx.id)))
      .reduce((sum, tx) => sum + tx.amount, 0)
    const totalIncome = round(income.remaining + income.receivedSalary + nonSalaryDeposits + income.manualOther)
    const expenses = splitExpenseRoutes(items).debit
    const forecast = forecastCardRecurringDue(month, dashboard.recurring, dashboard.accounts, dashboard.card_transactions_due)
    const cards = dashboard.card_summaries_due.cards.filter(card => card.currency === currency)
      .map(card => ({ ...card, amount_due: card.amount_due + (forecast.get(card.account_id) ?? 0) }))
    for (const account of dashboard.accounts) {
      if (account.currency !== currency || account.account_type !== 'CREDIT_CARD' || cards.some(card => card.account_id === account.id)) continue
      cards.push({ account_id: account.id, account_name: account.name, currency, amount_due: forecast.get(account.id) ?? 0, charges: 0, credits: 0, payments: 0, count: 0 })
    }
    const remainingExpenses = round(expenses.reduce((sum, item) => sum + (matches[item.id] || payment('recurring', item.id) ? 0 : item.amount), 0)
      + cards.reduce((sum, card) => sum + (payment('card', card.account_id) ? 0 : card.amount_due), 0))
    const totalExpenses = round(expenses.reduce((sum, item) => sum + (matches[item.id]?.actualAmount ?? item.amount), 0) + cards.reduce((sum, card) => sum + card.amount_due, 0))
    const remainingSavings = savingsForMonth(month)
    const closingBalance = month < currentMonth ? null : calculateProjectedBalance({ currentBalance: balance, remainingIncome: income.remaining, remainingExpenses, remainingSavings })
    result[month] = { startingBalance: round(balance), closingBalance, remainingIncome: round(income.remaining), remainingExpenses, remainingSavings, totalIncome, totalExpenses, netCashFlow: round(totalIncome - totalExpenses) }
    if (closingBalance !== null) balance = closingBalance
  }
  return result
}
