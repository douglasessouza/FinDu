import type { CategoryBudget, CurrencyCode, SpendingAnalysisResponse } from '../services/api'

function round(value: number, precision = 2): number {
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function spendingTotal(
  data: SpendingAnalysisResponse,
  month: string,
  currency: CurrencyCode,
): number {
  return round(Object.values(data[month] || {}).reduce((sum, summary) => {
    const values = summary.by_currency[currency]
    return sum + (values?.cards || 0) + (values?.debit || 0)
  }, 0))
}

export function budgetTotal(
  budgets: CategoryBudget[],
  month: string,
  currency: CurrencyCode,
): number {
  return round(budgets
    .filter(budget => budget.currency === currency && budget.is_active)
    .filter(budget => budget.start_month <= month)
    .filter(budget => !budget.valid_until || budget.valid_until.slice(0, 7) >= month)
    .reduce((sum, budget) => sum + budget.amount, 0))
}

export function budgetVariancePercent(budget: number, actual: number): number | null {
  if (budget <= 0) return null
  return round(((budget - actual) / budget) * 100, 1)
}

export function monthOverMonthImprovement(
  currentBudget: number,
  currentActual: number,
  previousBudget: number,
  previousActual: number,
): number | null {
  const current = budgetVariancePercent(currentBudget, currentActual)
  const previous = budgetVariancePercent(previousBudget, previousActual)
  if (current === null || previous === null) return null
  return round(current - previous, 1)
}

export function yearOverYearSpendingChange(currentActual: number, previousYearActual: number): number | null {
  if (previousYearActual <= 0) return null
  return round(((currentActual - previousYearActual) / previousYearActual) * 100, 1)
}
