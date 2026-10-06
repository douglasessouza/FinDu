export interface PlanRecurring {
  id: number
  name: string
  amount: number
  currency: string
  type: string
  category?: string
  planning_kind?: string
  start_month?: string | null
  valid_until?: string | null
}

export interface PlanBudget {
  id: number
  category: string
  amount: number
  currency: string
  start_month: string
  valid_until?: string | null
  is_active?: boolean
  items?: { id?: number; name: string; amount: number }[]
}

export interface PlanCoverage {
  id: number
  budget_item_id: number
  recurring_id: number
  amount: number
}

export interface PlanTreatment {
  budget_item_id: number
  effective_month: string
  treatment: 'VARIABLE' | 'EXCLUDED'
}

export interface PlanTransaction {
  id: number
  account_id: number
  description?: string
  amount: number
  currency: string
  category?: string
  date: string
  statement_month?: string | null
}

export interface PlanMatch {
  recurring_id: number
  transaction_id: number
  source: string
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const active = (start: string | null | undefined, end: string | null | undefined, month: string) =>
  (!start || start.slice(0, 7) <= month) && (!end || end.slice(0, 7) >= month)

export function treatmentsForMonth(rows: PlanTreatment[], month: string): Map<number, PlanTreatment['treatment']> {
  const current = new Map<number, PlanTreatment['treatment']>()
  for (const row of [...rows].sort((a, b) => a.effective_month.localeCompare(b.effective_month))) {
    if (row.effective_month <= month) current.set(row.budget_item_id, row.treatment)
  }
  return current
}

export function excludedOnlyBudgetCategories(month: string, currency: string, budgets: PlanBudget[], treatments: PlanTreatment[]): Set<string> {
  const choices = treatmentsForMonth(treatments, month)
  const categories = new Map<string, { variable: boolean; excluded: boolean }>()
  for (const budget of budgets.filter(row => row.currency === currency && row.is_active !== false && active(row.start_month, row.valid_until, month))) {
    const state = categories.get(budget.category) || { variable: false, excluded: false }
    for (const item of budget.items?.length ? budget.items : [{ name: budget.category, amount: budget.amount }]) {
      if (item.id && choices.get(item.id) === 'EXCLUDED') state.excluded = true
      else state.variable = true
    }
    categories.set(budget.category, state)
  }
  return new Set([...categories].filter(([, state]) => state.excluded && !state.variable).map(([category]) => category))
}

export function calculateMonthlyPlan(
  month: string,
  currency: string,
  recurring: PlanRecurring[],
  budgets: PlanBudget[],
  coverages: PlanCoverage[],
  transactions: PlanTransaction[],
  matches: PlanMatch[],
  treatments: PlanTreatment[] = [],
) {
  const fixed = recurring.filter(item => item.type === 'EXPENSE' && item.currency === currency
    && item.planning_kind !== 'VARIABLE' && active(item.start_month, item.valid_until, month))
  const fixedById = new Map(fixed.map(item => [item.id, item]))
  const currentBudgets = budgets.filter(budget => budget.currency === currency && budget.is_active !== false
    && active(budget.start_month, budget.valid_until, month))
  const grossBudget = money(currentBudgets.reduce((sum, budget) => sum + budget.amount, 0))
  const coveredByItem = new Map<number, number>()
  const treatmentByItem = treatmentsForMonth(treatments, month)
  for (const coverage of coverages) {
    if (!fixedById.has(coverage.recurring_id)) continue
    coveredByItem.set(coverage.budget_item_id,
      (coveredByItem.get(coverage.budget_item_id) || 0) + coverage.amount)
  }
  const fixedCategories = new Set(fixed.map(item => item.category).filter(Boolean))
  const excludedOnlyCategories = excludedOnlyBudgetCategories(month, currency, currentBudgets, treatments)
  const missingFixedCategories = [...excludedOnlyCategories].filter(category => !fixedCategories.has(category)).sort()
  const unresolved = new Set<string>()
  let variableAllowance = 0
  for (const budget of currentBudgets) {
    const items = budget.items?.length ? budget.items : [{ name: budget.category, amount: budget.amount }]
    for (const item of items) {
      const treatment = item.id ? treatmentByItem.get(item.id) : undefined
      const covered = item.id ? coveredByItem.get(item.id) || 0 : 0
      if (treatment !== 'EXCLUDED') variableAllowance += treatment === 'VARIABLE'
        ? item.amount : Math.max(0, item.amount - covered)
      if (fixedCategories.has(budget.category) && !treatment && covered === 0) unresolved.add(budget.category)
    }
  }

  const eligible = transactions.filter(tx => tx.currency === currency && tx.amount < 0
    && (tx.category || '').toLowerCase() !== 'transfer'
    && (tx.statement_month || tx.date.slice(0, 7)) === month)
  const eligibleById = new Map(eligible.map(tx => [tx.id, tx]))
  const matchedIds = new Set<number>()
  let fixedActual = 0
  for (const match of matches) {
    if (match.source === 'ignored' || !fixedById.has(match.recurring_id)) continue
    const tx = eligibleById.get(match.transaction_id)
    if (!tx || matchedIds.has(tx.id)) continue
    matchedIds.add(tx.id)
    fixedActual += -tx.amount
  }
  let variableActual = 0
  let unclassifiedActual = 0
  const needsReviewTransactions: PlanTransaction[] = []
  for (const tx of eligible) {
    if (matchedIds.has(tx.id)) continue
    if (fixedCategories.has(tx.category) || excludedOnlyCategories.has(tx.category || '')) {
      unclassifiedActual += -tx.amount
      needsReviewTransactions.push(tx)
    } else variableActual += -tx.amount
  }
  const fixedPlanned = money(fixed.reduce((sum, item) => sum + item.amount, 0))
  variableAllowance = money(variableAllowance)
  return {
    fixedPlanned,
    grossBudget,
    variableAllowance,
    totalPlanned: unresolved.size || missingFixedCategories.length ? null : money(fixedPlanned + variableAllowance),
    fixedActual: money(fixedActual),
    variableActual: money(variableActual),
    unclassifiedActual: money(unclassifiedActual),
    needsReviewTransactions: needsReviewTransactions.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    unresolvedCategories: [...unresolved].sort(),
    missingFixedCategories,
  }
}
