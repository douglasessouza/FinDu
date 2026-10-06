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

export interface PlanTransaction {
  id: number
  account_id: number
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

export function calculateMonthlyPlan(
  month: string,
  currency: string,
  recurring: PlanRecurring[],
  budgets: PlanBudget[],
  coverages: PlanCoverage[],
  transactions: PlanTransaction[],
  matches: PlanMatch[],
) {
  const fixed = recurring.filter(item => item.type === 'EXPENSE' && item.currency === currency
    && item.planning_kind !== 'VARIABLE' && active(item.start_month, item.valid_until, month))
  const fixedById = new Map(fixed.map(item => [item.id, item]))
  const currentBudgets = budgets.filter(budget => budget.currency === currency && budget.is_active !== false
    && active(budget.start_month, budget.valid_until, month))
  const coveredByItem = new Map<number, number>()
  for (const coverage of coverages) {
    if (!fixedById.has(coverage.recurring_id)) continue
    coveredByItem.set(coverage.budget_item_id,
      (coveredByItem.get(coverage.budget_item_id) || 0) + coverage.amount)
  }
  const fixedCategories = new Set(fixed.map(item => item.category).filter(Boolean))
  const unresolved = new Set<string>()
  let variableAllowance = 0
  for (const budget of currentBudgets) {
    const items = budget.items?.length ? budget.items : [{ name: budget.category, amount: budget.amount }]
    for (const item of items) {
      const covered = item.id ? coveredByItem.get(item.id) || 0 : 0
      variableAllowance += Math.max(0, item.amount - covered)
      if (fixedCategories.has(budget.category) && covered === 0) unresolved.add(budget.category)
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
  for (const tx of eligible) {
    if (matchedIds.has(tx.id)) continue
    if (fixedCategories.has(tx.category)) unclassifiedActual += -tx.amount
    else variableActual += -tx.amount
  }
  const fixedPlanned = money(fixed.reduce((sum, item) => sum + item.amount, 0))
  variableAllowance = money(variableAllowance)
  return {
    fixedPlanned,
    variableAllowance,
    totalPlanned: unresolved.size ? null : money(fixedPlanned + variableAllowance),
    fixedActual: money(fixedActual),
    variableActual: money(variableActual),
    unclassifiedActual: money(unclassifiedActual),
    unresolvedCategories: [...unresolved].sort(),
  }
}
