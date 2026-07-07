export type InvestmentFrequency = 'weekly' | 'monthly'
export type InvestmentStatus = 'open' | 'archived'

export interface InvestmentEntry {
  periodId: string
  amount: number
  saved: boolean
}

export interface InvestmentPlan {
  id: string
  name: string
  currency: 'CAD' | 'USD'
  initialBalance: number
  contribution: number
  frequency: InvestmentFrequency
  annualReturnPct: number
  targetAmount: number
  startDate: string
  endDate: string
  status: InvestmentStatus
  entries: Record<string, InvestmentEntry>
  createdAt: string
}

export interface InvestmentPeriod {
  id: string
  label: string
  shortLabel: string
  startDate: Date
  endDate: Date
  month: string
  plannedAmount: number
  savedAmount: number
  saved: boolean
  isPastOrCurrent: boolean
}

export interface InvestmentPlanProgress {
  periods: InvestmentPeriod[]
  savedTotal: number
  scheduledTotal: number
  futurePlannedTotal: number
  projectedFinal: number
  expectedByNow: number
  targetGap: number
  targetProgress: number
  completedPeriods: number
  totalPeriods: number
  status: 'on_track' | 'watch' | 'risk' | 'complete'
}

export interface MonthlyInvestmentSummary {
  plannedDue: number
  savedActual: number
  remainingDue: number
  openPlans: number
}

export const INVESTMENT_PLANS_STORAGE_KEY = 'findu_investment_plans'
const LEGACY_PLAN_STORAGE_KEY = 'findu_investment_plan'

function todayInput(): string {
  const today = new Date()
  return toInputDate(today)
}

function yearEndInput(): string {
  const today = new Date()
  return `${today.getFullYear()}-12-31`
}

export function toInputDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseInputDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function isoWeek(date: Date): number {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = current.getUTCDay() || 7
  current.setUTCDate(current.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1))
  return Math.ceil((((current.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function monthLabel(date: Date): string {
  return date.toLocaleString('en', { month: 'short', year: 'numeric' })
}

function periodLabel(start: Date, frequency: InvestmentFrequency): { label: string; shortLabel: string } {
  if (frequency === 'monthly') {
    return {
      label: monthLabel(start),
      shortLabel: start.toLocaleString('en', { month: 'short' }),
    }
  }

  const week = isoWeek(start)
  return {
    label: `Week ${week}`,
    shortLabel: `W${week}`,
  }
}

function newPlanId(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function createDefaultInvestmentPlan(): InvestmentPlan {
  return {
    id: newPlanId(),
    name: 'Year-end savings goal',
    currency: 'CAD',
    initialBalance: 700,
    contribution: 100,
    frequency: 'weekly',
    annualReturnPct: 0,
    targetAmount: 3000,
    startDate: todayInput(),
    endDate: yearEndInput(),
    status: 'open',
    entries: {},
    createdAt: new Date().toISOString(),
  }
}

function migrateLegacyPlan(): InvestmentPlan[] {
  try {
    const raw = localStorage.getItem(LEGACY_PLAN_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<InvestmentPlan>
    if (!parsed || typeof parsed !== 'object') return []
    const migrated = {
      ...createDefaultInvestmentPlan(),
      ...parsed,
      id: newPlanId(),
      name: 'Year-end savings goal',
      currency: 'CAD' as const,
      status: 'open' as const,
      entries: {},
      createdAt: new Date().toISOString(),
    }
    localStorage.removeItem(LEGACY_PLAN_STORAGE_KEY)
    return [migrated]
  } catch {
    return []
  }
}

export function loadInvestmentPlans(): InvestmentPlan[] {
  try {
    const raw = localStorage.getItem(INVESTMENT_PLANS_STORAGE_KEY)
    if (!raw) {
      const migrated = migrateLegacyPlan()
      if (migrated.length > 0) saveInvestmentPlans(migrated)
      return migrated
    }

    const plans = JSON.parse(raw) as InvestmentPlan[]
    return Array.isArray(plans) ? plans : []
  } catch {
    return []
  }
}

export function saveInvestmentPlans(plans: InvestmentPlan[]) {
  localStorage.setItem(INVESTMENT_PLANS_STORAGE_KEY, JSON.stringify(plans))
}

export function buildInvestmentPeriods(plan: InvestmentPlan): InvestmentPeriod[] {
  const start = parseInputDate(plan.startDate)
  const end = parseInputDate(plan.endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []

  const today = new Date()
  const periods: InvestmentPeriod[] = []
  let cursor = new Date(start)

  while (cursor <= end) {
    const nextStart = plan.frequency === 'weekly' ? addDays(cursor, 7) : addMonths(cursor, 1)
    const periodEnd = addDays(nextStart, -1) > end ? new Date(end) : addDays(nextStart, -1)
    const labels = periodLabel(cursor, plan.frequency)
    const id = `${plan.frequency}-${toInputDate(cursor)}`
    const entry = plan.entries[id]
    const plannedAmount = Math.max(Number(plan.contribution) || 0, 0)
    const savedAmount = entry?.saved ? Math.max(Number(entry.amount) || 0, 0) : 0

    periods.push({
      id,
      ...labels,
      startDate: new Date(cursor),
      endDate: periodEnd,
      month: monthKey(cursor),
      plannedAmount,
      savedAmount,
      saved: Boolean(entry?.saved),
      isPastOrCurrent: periodEnd <= today,
    })

    cursor = nextStart
  }

  return periods
}

export function calculateInvestmentProgress(plan: InvestmentPlan): InvestmentPlanProgress {
  const periods = buildInvestmentPeriods(plan)
  const savedRecurringTotal = periods.reduce((sum, period) => sum + period.savedAmount, 0)
  const savedTotal = Math.max(Number(plan.initialBalance) || 0, 0) + savedRecurringTotal
  const scheduledTotal = periods.reduce((sum, period) => sum + period.plannedAmount, 0)
  const futurePlannedTotal = periods
    .filter(period => !period.saved)
    .reduce((sum, period) => sum + period.plannedAmount, 0)
  const expectedByNow = Math.max(Number(plan.initialBalance) || 0, 0) + periods
    .filter(period => period.isPastOrCurrent)
    .reduce((sum, period) => sum + period.plannedAmount, 0)
  const projectedWithoutReturn = savedTotal + futurePlannedTotal
  const annualReturn = Math.max(Number(plan.annualReturnPct) || 0, 0) / 100
  const monthsRemaining = Math.max((parseInputDate(plan.endDate).getTime() - new Date().getTime()) / 2629800000, 0)
  const projectedFinal = projectedWithoutReturn * Math.pow(1 + annualReturn, monthsRemaining / 12)
  const targetAmount = Math.max(Number(plan.targetAmount) || 0, 0)
  const targetGap = Math.max(targetAmount - projectedFinal, 0)
  const targetProgress = targetAmount > 0 ? Math.min((savedTotal / targetAmount) * 100, 100) : 0
  const completedPeriods = periods.filter(period => period.saved).length
  const totalPeriods = periods.length

  let status: InvestmentPlanProgress['status'] = 'on_track'
  if (targetAmount > 0 && savedTotal >= targetAmount) status = 'complete'
  else if (targetGap > 0) status = 'risk'
  else if (savedTotal + 0.005 < expectedByNow) status = 'watch'

  return {
    periods,
    savedTotal,
    scheduledTotal,
    futurePlannedTotal,
    projectedFinal,
    expectedByNow,
    targetGap,
    targetProgress,
    completedPeriods,
    totalPeriods,
    status,
  }
}

export function investmentSummaryForMonth(month: string, currency: 'CAD' | 'USD' = 'CAD'): MonthlyInvestmentSummary {
  const plans = loadInvestmentPlans().filter(plan => plan.status === 'open' && plan.currency === currency)
  return plans.reduce<MonthlyInvestmentSummary>((summary, plan) => {
    const periods = buildInvestmentPeriods(plan).filter(period => period.month === month)
    const plannedDue = periods.reduce((sum, period) => sum + period.plannedAmount, 0)
    const savedActual = periods.reduce((sum, period) => sum + period.savedAmount, 0)
    return {
      plannedDue: summary.plannedDue + plannedDue,
      savedActual: summary.savedActual + savedActual,
      remainingDue: summary.remainingDue + Math.max(plannedDue - savedActual, 0),
      openPlans: summary.openPlans + 1,
    }
  }, { plannedDue: 0, savedActual: 0, remainingDue: 0, openPlans: 0 })
}

export function summarizeInvestmentPlans(plans: InvestmentPlan[], currency: 'CAD' | 'USD' = 'CAD') {
  const activePlans = plans.filter(plan => plan.status === 'open' && plan.currency === currency)
  return activePlans.reduce(
    (summary, plan) => {
      const progress = calculateInvestmentProgress(plan)
      return {
        openPlans: summary.openPlans + 1,
        savedTotal: summary.savedTotal + progress.savedTotal,
        projectedFinal: summary.projectedFinal + progress.projectedFinal,
        targetTotal: summary.targetTotal + Math.max(Number(plan.targetAmount) || 0, 0),
        riskPlans: summary.riskPlans + (progress.status === 'risk' ? 1 : 0),
      }
    },
    { openPlans: 0, savedTotal: 0, projectedFinal: 0, targetTotal: 0, riskPlans: 0 },
  )
}

export function investmentPortfolioSummary(currency: 'CAD' | 'USD' = 'CAD') {
  const plans = loadInvestmentPlans()
  return summarizeInvestmentPlans(plans, currency)
}
