export interface PayPeriodItem {
  amount: number
  dueDay: number
}

export interface PayPeriodExpenseItem extends PayPeriodItem {
  id: string
  name: string
  kind: 'Recurring' | 'Credit card'
  dueLabel: string
  status?: 'Paid' | 'Matched'
}

export interface PayPeriodBill {
  id: string
  name: string
  kind: 'Recurring' | 'Credit card'
  dueLabel: string
  amount: number
  status?: 'Paid' | 'Matched'
}

interface PayPeriodTotals {
  income: number
  expenses: number
  balance: number
  bills: PayPeriodBill[]
}

export interface PayPeriodSummary {
  firstPeriod: PayPeriodTotals
  secondPeriod: PayPeriodTotals
}

interface PreviousMonthIncomeItem {
  id: number
  amount: number
  currency: string
  dueDay: number
  type: 'INCOME' | 'EXPENSE'
  startMonth?: string | null
  validUntil?: string | null
}

function previousMonthKey(selectedMonth: string): string {
  const [year, month] = selectedMonth.split('-').map(Number)
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`
}

export function calculatePreviousMonthLateIncome({
  selectedMonth,
  currency,
  items,
  overrides,
}: {
  selectedMonth: string
  currency: string
  items: PreviousMonthIncomeItem[]
  overrides: Record<number, number>
}): number {
  const previousMonth = previousMonthKey(selectedMonth)
  return roundCurrency(items
    .filter(item => item.currency === currency && item.type === 'INCOME' && item.dueDay >= 25)
    .filter(item => !item.startMonth || item.startMonth <= previousMonth)
    .filter(item => !item.validUntil || item.validUntil.slice(0, 7) >= previousMonth)
    .reduce((sum, item) => sum + (overrides[item.id] ?? item.amount), 0))
}

export function resolveCardDueDay(paymentDueDate?: string | null, accountDueDay?: number): number {
  if (paymentDueDate) {
    const dueDay = Number(paymentDueDate.slice(8, 10))
    if (Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31) return dueDay
  }
  return accountDueDay || 31
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function incomeForPeriod(items: PayPeriodItem[], firstPeriod: boolean): number {
  return roundCurrency(items
    .filter(item => firstPeriod
      ? item.dueDay <= 14
      : item.dueDay >= 15 && item.dueDay <= 25)
    .reduce((sum, item) => sum + item.amount, 0))
}

function expensesForPeriod(items: PayPeriodExpenseItem[], firstPeriod: boolean): number {
  return roundCurrency(items
    .filter(item => firstPeriod ? item.dueDay <= 14 : item.dueDay >= 15)
    .reduce((sum, item) => sum + item.amount, 0))
}

function billsForPeriod(items: PayPeriodExpenseItem[], firstPeriod: boolean): PayPeriodBill[] {
  return items
    .filter(item => firstPeriod ? item.dueDay <= 14 : item.dueDay >= 15)
    .sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name))
    .map(item => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      dueLabel: item.dueLabel,
      amount: item.amount,
      ...(item.status ? { status: item.status } : {}),
    }))
}

export function buildPayPeriodSummary({
  incomes,
  expenses,
  previousMonthLateIncome,
}: {
  incomes: PayPeriodItem[]
  expenses: PayPeriodExpenseItem[]
  previousMonthLateIncome: number
}): PayPeriodSummary {
  const firstPeriodIncome = roundCurrency(incomeForPeriod(incomes, true) + previousMonthLateIncome)
  const firstPeriodExpenses = expensesForPeriod(expenses, true)
  const secondPeriodIncome = incomeForPeriod(incomes, false)
  const secondPeriodExpenses = expensesForPeriod(expenses, false)

  return {
    firstPeriod: {
      income: firstPeriodIncome,
      expenses: firstPeriodExpenses,
      balance: roundCurrency(firstPeriodIncome - firstPeriodExpenses),
      bills: billsForPeriod(expenses, true),
    },
    secondPeriod: {
      income: secondPeriodIncome,
      expenses: secondPeriodExpenses,
      balance: roundCurrency(secondPeriodIncome - secondPeriodExpenses),
      bills: billsForPeriod(expenses, false),
    },
  }
}
