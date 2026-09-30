export interface CashFlowProjectionInput {
  currentBalance: number
  remainingIncome: number
  remainingExpenses: number
  remainingSavings: number
}

export function calculateRemainingIncome(plannedIncome: number, receivedIncome: number, confirmedOtherIncome = 0): number {
  return Math.max(0, Math.round((plannedIncome - receivedIncome - confirmedOtherIncome + Number.EPSILON) * 100) / 100)
}

export function calculateProjectedBalance({
  currentBalance,
  remainingIncome,
  remainingExpenses,
  remainingSavings,
}: CashFlowProjectionInput): number {
  const projected = currentBalance + remainingIncome - remainingExpenses - remainingSavings
  return Math.round((projected + Number.EPSILON) * 100) / 100
}

interface IncomeOccurrence {
  amount: number
  payroll: boolean
  cancelled?: boolean
  received?: boolean
  matchedAmount?: number
  salaryMatch?: boolean
}

export function calculateOccurrenceIncome(items: IncomeOccurrence[], salaryReceived: number) {
  const active = items.filter(item => !item.cancelled)
  const pending = active.filter(item => !item.received && item.matchedAmount === undefined)
  // Attribute deposits first, so a manually confirmed/matched salary is not
  // subtracted again from a different pending salary or from other income.
  const attributedSalary = items.reduce((sum, item) => sum + (
    item.salaryMatch ? item.matchedAmount ?? 0
      : item.payroll && item.received && item.matchedAmount === undefined ? item.amount : 0
  ), 0)
  const pendingPayroll = pending.filter(item => item.payroll).reduce((sum, item) => sum + item.amount, 0)
  const pendingOther = pending.filter(item => !item.payroll).reduce((sum, item) => sum + item.amount, 0)
  return {
    planned: active.reduce((sum, item) => sum + item.amount, 0),
    remaining: calculateRemainingIncome(pendingPayroll, Math.max(0, salaryReceived - attributedSalary)) + pendingOther,
    receivedSalary: Math.max(salaryReceived, attributedSalary),
    manualOther: active.reduce((sum, item) => sum + (!item.payroll && item.received && item.matchedAmount === undefined ? item.amount : 0), 0),
  }
}
