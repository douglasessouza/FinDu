export interface PayPeriodItem {
  amount: number
  dueDay: number
}

interface PayPeriodTotals {
  income: number
  expenses: number
  balance: number
}

export interface PayPeriodSummary {
  throughDay15: PayPeriodTotals
  afterDay15: PayPeriodTotals
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
    .filter(item => item.currency === currency && item.type === 'INCOME' && item.dueDay > 15)
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

function totalForPeriod(items: PayPeriodItem[], throughDay15: boolean): number {
  return roundCurrency(items
    .filter(item => throughDay15 ? item.dueDay <= 15 : item.dueDay > 15)
    .reduce((sum, item) => sum + item.amount, 0))
}

export function buildPayPeriodSummary({
  incomes,
  expenses,
  previousMonthLateIncome,
}: {
  incomes: PayPeriodItem[]
  expenses: PayPeriodItem[]
  previousMonthLateIncome: number
}): PayPeriodSummary {
  const throughDay15Income = roundCurrency(totalForPeriod(incomes, true) + previousMonthLateIncome)
  const throughDay15Expenses = totalForPeriod(expenses, true)
  const afterDay15Income = totalForPeriod(incomes, false)
  const afterDay15Expenses = totalForPeriod(expenses, false)

  return {
    throughDay15: {
      income: throughDay15Income,
      expenses: throughDay15Expenses,
      balance: roundCurrency(throughDay15Income - throughDay15Expenses),
    },
    afterDay15: {
      income: afterDay15Income,
      expenses: afterDay15Expenses,
      balance: roundCurrency(afterDay15Income - afterDay15Expenses),
    },
  }
}
