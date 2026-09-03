export interface PayPeriodItem {
  amount: number
  dueDay: number
}

export interface PayPeriodIncomeItem {
  id: string
  name: string
  dueLabel: string
  amount: number
  actualAmount?: number
  period: 'first' | 'second'
}

export interface PayPeriodIncome {
  id: string
  name: string
  dueLabel: string
  amount: number
  status: 'Planned' | 'Received'
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
  incomes: PayPeriodIncome[]
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
    .filter(item => item.currency === currency && item.type === 'INCOME' && item.dueDay >= 28)
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

function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function nearestDueDateDistance(transactionDate: string, dueDay: number): number {
  const [year, month, day] = transactionDate.slice(0, 10).split('-').map(Number)
  if (![year, month, day].every(Number.isInteger)) return 31
  const transactionTime = Date.UTC(year, month - 1, day)
  return Math.min(...[-1, 0, 1].map(offset => {
    const candidateMonth = new Date(Date.UTC(year, month - 1 + offset, 1))
    const lastDay = new Date(Date.UTC(candidateMonth.getUTCFullYear(), candidateMonth.getUTCMonth() + 1, 0)).getUTCDate()
    const candidateTime = Date.UTC(
      candidateMonth.getUTCFullYear(),
      candidateMonth.getUTCMonth(),
      Math.min(dueDay, lastDay),
    )
    return Math.abs(transactionTime - candidateTime) / 86_400_000
  }))
}

export function hasExpectedIncomeDate({
  transactionDate,
  dueDay,
  cashFlowMonth,
}: {
  transactionDate: string
  dueDay: number
  cashFlowMonth: string
}): boolean {
  const transactionMonth = transactionDate.slice(0, 7)
  const transactionDay = Number(transactionDate.slice(8, 10))
  if (!Number.isInteger(transactionDay)) return false
  const effectiveCashFlowMonth = transactionDay >= 28 ? addMonths(transactionMonth, 1) : transactionMonth
  return effectiveCashFlowMonth === cashFlowMonth
    && nearestDueDateDistance(transactionDate, dueDay) <= 7
}

function incomesForPeriod(items: PayPeriodIncomeItem[], period: 'first' | 'second'): PayPeriodIncome[] {
  return items
    .filter(item => item.period === period)
    .map(item => ({
      id: item.id,
      name: item.name,
      dueLabel: item.dueLabel,
      amount: roundCurrency(item.actualAmount ?? item.amount),
      status: item.actualAmount === undefined ? 'Planned' as const : 'Received' as const,
    }))
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
}: {
  incomes: PayPeriodIncomeItem[]
  expenses: PayPeriodExpenseItem[]
}): PayPeriodSummary {
  const firstPeriodIncomes = incomesForPeriod(incomes, 'first')
  const secondPeriodIncomes = incomesForPeriod(incomes, 'second')
  const firstPeriodIncome = roundCurrency(firstPeriodIncomes.reduce((sum, item) => sum + item.amount, 0))
  const firstPeriodExpenses = expensesForPeriod(expenses, true)
  const secondPeriodIncome = roundCurrency(secondPeriodIncomes.reduce((sum, item) => sum + item.amount, 0))
  const secondPeriodExpenses = expensesForPeriod(expenses, false)

  return {
    firstPeriod: {
      income: firstPeriodIncome,
      expenses: firstPeriodExpenses,
      balance: roundCurrency(firstPeriodIncome - firstPeriodExpenses),
      incomes: firstPeriodIncomes,
      bills: billsForPeriod(expenses, true),
    },
    secondPeriod: {
      income: secondPeriodIncome,
      expenses: secondPeriodExpenses,
      balance: roundCurrency(secondPeriodIncome - secondPeriodExpenses),
      incomes: secondPeriodIncomes,
      bills: billsForPeriod(expenses, false),
    },
  }
}
