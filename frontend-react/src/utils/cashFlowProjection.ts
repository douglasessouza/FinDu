export interface CashFlowProjectionInput {
  currentBalance: number
  remainingIncome: number
  remainingExpenses: number
  remainingSavings: number
}

export function calculateRemainingIncome(plannedIncome: number, receivedIncome: number): number {
  return Math.max(0, Math.round((plannedIncome - receivedIncome + Number.EPSILON) * 100) / 100)
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
