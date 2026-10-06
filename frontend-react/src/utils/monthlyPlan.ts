export interface PlanRecurring {
  id: number
  name: string
  amount: number
  currency: string
  type: string
  category?: string
  planning_kind?: string
  due_day?: number
  payment_account_id?: number | null
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

const words = (value: string): string[] => value.toLowerCase().match(/[a-z0-9]{3,}/g) || []

function fixedChargeScore(tx: PlanTransaction, bill: PlanRecurring): number | null {
  if (bill.payment_account_id && bill.payment_account_id !== tx.account_id) return null
  const tolerance = Math.max(5, bill.amount * 0.15)
  const amountDifference = Math.abs(bill.amount + tx.amount)
  if (amountDifference > tolerance) return null
  const dueDay = bill.due_day || Number(tx.date.slice(8, 10))
  const actualDay = Number(tx.date.slice(8, 10))
  const dayDifference = Math.abs(actualDay - Math.min(dueDay,
    new Date(Number(tx.date.slice(0, 4)), Number(tx.date.slice(5, 7)), 0).getDate()))
  if (dayDifference > 7) return null
  const billWords = words(bill.name)
  const chargeWords = words(tx.description || '')
  const sharedWords = billWords.filter(word => chargeWords.includes(word)).length
  if (!bill.payment_account_id && !(billWords.length && sharedWords === billWords.length
    && amountDifference <= 1 && dayDifference <= 2)) return null
  if (!sharedWords && !(bill.category === tx.category && amountDifference <= 1 && dayDifference <= 2)) return null
  return sharedWords * 40 + (1 - amountDifference / tolerance) * 30 + (7 - dayDifference) * 2
}

function budgetBillScore(itemName: string, category: string, amount: number, bill: PlanRecurring): number | null {
  if (bill.category !== category) return null
  const itemWords = words(itemName)
  const billWords = words(bill.name)
  const sharedWords = itemWords.filter(word => billWords.includes(word)).length
  if (!sharedWords) return null
  const amountSimilarity = 1 - Math.min(1, Math.abs(amount - bill.amount) / Math.max(amount, bill.amount))
  return sharedWords * 100 + amountSimilarity * 30
}

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
  const budgetItems = currentBudgets.flatMap(budget =>
    (budget.items?.length ? budget.items : [{ name: budget.category, amount: budget.amount }])
      .map((item, index) => ({ item, category: budget.category, key: `${budget.id}:${index}` })))
  const budgetEdges = budgetItems.flatMap(row => {
    if (row.item.id && (treatmentByItem.has(row.item.id) || coveredByItem.has(row.item.id))) return []
    return fixed.flatMap(bill => {
      const score = budgetBillScore(row.item.name, row.category, row.item.amount, bill)
      return score === null ? [] : [{ key: row.key, billId: bill.id, score }]
    })
  }).sort((a, b) => b.score - a.score)
  const autoCoveredKeys = new Set<string>()
  const budgetMatchedBills = new Set<number>()
  for (const edge of budgetEdges) {
    if (autoCoveredKeys.has(edge.key) || budgetMatchedBills.has(edge.billId)) continue
    autoCoveredKeys.add(edge.key)
    budgetMatchedBills.add(edge.billId)
  }
  let variableAllowance = 0
  const variableBudgetByCategory: Record<string, number> = {}
  const variableBudgetItems: { category: string; name: string; amount: number }[] = []
  for (const row of budgetItems) {
    const treatment = row.item.id ? treatmentByItem.get(row.item.id) : undefined
    const covered = row.item.id ? coveredByItem.get(row.item.id) || 0 : 0
    const amount = treatment === 'EXCLUDED' || autoCoveredKeys.has(row.key) ? 0
      : treatment === 'VARIABLE' ? row.item.amount : Math.max(0, row.item.amount - covered)
    variableAllowance += amount
    variableBudgetByCategory[row.category] = money((variableBudgetByCategory[row.category] || 0) + amount)
    if (amount > 0) variableBudgetItems.push({ category: row.category, name: row.item.name, amount: money(amount) })
  }

  const eligible = transactions.filter(tx => tx.currency === currency && tx.amount < 0
    && (tx.category || '').toLowerCase() !== 'transfer'
    && (tx.statement_month || tx.date.slice(0, 7)) === month)
  const eligibleById = new Map(eligible.map(tx => [tx.id, tx]))
  const ignoredPairs = new Set(matches.filter(match => match.source === 'ignored')
    .map(match => `${match.recurring_id}:${match.transaction_id}`))
  const matchedIds = new Set<number>()
  const matchedBillIds = new Set<number>()
  const fixedActualByRecurringId: Record<number, number> = {}
  let fixedActual = 0
  for (const match of matches) {
    if (match.source === 'ignored' || !fixedById.has(match.recurring_id)) continue
    const tx = eligibleById.get(match.transaction_id)
    if (!tx || matchedIds.has(tx.id) || matchedBillIds.has(match.recurring_id)) continue
    matchedIds.add(tx.id)
    matchedBillIds.add(match.recurring_id)
    fixedActualByRecurringId[match.recurring_id] = -tx.amount
    fixedActual += -tx.amount
  }
  const chargeEdges = eligible.filter(tx => !matchedIds.has(tx.id)).flatMap(tx =>
    fixed.filter(bill => !matchedBillIds.has(bill.id) && !ignoredPairs.has(`${bill.id}:${tx.id}`)).flatMap(bill => {
      const score = fixedChargeScore(tx, bill)
      return score === null ? [] : [{ tx, bill, score }]
    })).sort((a, b) => b.score - a.score)
  for (const edge of chargeEdges) {
    if (matchedIds.has(edge.tx.id) || matchedBillIds.has(edge.bill.id)) continue
    matchedIds.add(edge.tx.id)
    matchedBillIds.add(edge.bill.id)
    fixedActualByRecurringId[edge.bill.id] = -edge.tx.amount
    fixedActual += -edge.tx.amount
  }
  const variableActual = eligible.filter(tx => !matchedIds.has(tx.id)).reduce((sum, tx) => sum - tx.amount, 0)
  const fixedPlanned = money(fixed.reduce((sum, item) => sum + item.amount, 0))
  variableAllowance = money(variableAllowance)
  return {
    fixedPlanned,
    grossBudget,
    variableAllowance,
    variableBudgetByCategory,
    variableBudgetItems,
    totalPlanned: money(fixedPlanned + variableAllowance),
    fixedActual: money(fixedActual),
    variableActual: money(variableActual),
    fixedTransactionIds: [...matchedIds],
    fixedActualByRecurringId,
    missingFixedCategories,
  }
}
