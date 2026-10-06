interface RoutedExpense {
  id: number
  name: string
  amount: number
  currency: string
  due_day: number
  type: string
  category?: string
  start_month?: string | null
  valid_until?: string | null
  payment_method?: string
  payment_account_id?: number | null
}

interface CardAccount {
  id: number
  currency: string
  account_type: string
  closing_day?: number
  due_day?: number
}

interface CardTransaction {
  id: number
  account_id: number
  date: string
  amount: number
  currency: string
  category?: string
  description: string
  payment_due_date?: string | null
}

const monthKey = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 7)

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  return monthKey(year, monthNumber - 1 + delta)
}

function lastDay(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
}

function dueMonthForPurchase(purchaseMonth: string, purchaseDay: number, card: CardAccount) {
  if (!card.closing_day || !card.due_day) return null
  const closing = Math.min(card.closing_day, lastDay(purchaseMonth))
  const statementMonth = purchaseDay > closing ? shiftMonth(purchaseMonth, 1) : purchaseMonth
  return shiftMonth(statementMonth, 1)
}

export function splitExpenseRoutes<T extends RoutedExpense>(items: T[]) {
  const expenses = items.filter(item => item.type === 'EXPENSE')
  return {
    debit: expenses.filter(item => item.payment_method === 'DEBIT' && item.payment_account_id),
    card: expenses.filter(item => item.payment_method === 'CREDIT_CARD' && item.payment_account_id),
    unset: expenses.filter(item => !item.payment_method || item.payment_method === 'UNSET' || !item.payment_account_id),
  }
}

export function forecastCardRecurringDue(
  billMonth: string,
  recurring: RoutedExpense[],
  accounts: CardAccount[],
  actualCharges: CardTransaction[],
): Map<number, number> {
  const cards = new Map(accounts.filter(account => account.account_type === 'CREDIT_CARD').map(account => [account.id, account]))
  const result = new Map<number, number>()
  const used = new Set<number>()
  for (const item of recurring) {
    if (item.type !== 'EXPENSE' || item.payment_method !== 'CREDIT_CARD' || !item.payment_account_id) continue
    const card = cards.get(item.payment_account_id)
    if (!card || card.currency !== item.currency) continue
    for (const purchaseMonth of [shiftMonth(billMonth, -2), shiftMonth(billMonth, -1)]) {
      if (item.start_month && item.start_month > purchaseMonth) continue
      if (item.valid_until && item.valid_until.slice(0, 7) < purchaseMonth) continue
      const purchaseDay = Math.min(item.due_day, lastDay(purchaseMonth))
      if (dueMonthForPurchase(purchaseMonth, purchaseDay, card) !== billMonth) continue
      const matched = actualCharges.find(tx => !used.has(tx.id) && tx.account_id === card.id
        && tx.currency === item.currency && tx.amount < 0 && tx.date.slice(0, 7) === purchaseMonth
        && Math.abs(Number(tx.date.slice(8, 10)) - purchaseDay) <= 7
        && Math.abs(Math.abs(tx.amount) - item.amount) <= Math.max(5, item.amount * 0.15)
        && (tx.description.toLowerCase().includes(item.name.toLowerCase())
          || (item.category && tx.category?.toLowerCase() === item.category.toLowerCase())))
      if (matched) used.add(matched.id)
      else result.set(card.id, Math.round(((result.get(card.id) || 0) + item.amount) * 100) / 100)
    }
  }
  return result
}
