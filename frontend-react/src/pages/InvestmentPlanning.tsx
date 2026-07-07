import { useEffect, useState } from 'react'
import {
  Archive,
  CalendarDays,
  Check,
  CircleAlert,
  CirclePlus,
  PiggyBank,
  RotateCcw,
  TrendingUp,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  calculateInvestmentProgress,
  createDefaultInvestmentPlan,
  loadInvestmentPlans,
  saveInvestmentPlans,
  summarizeInvestmentPlans,
  type InvestmentFrequency,
  type InvestmentPlan,
} from '../utils/investmentPlans'

interface ChartPoint {
  label: string
  saved: number
  projected: number
  target: number
}

function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function shortMoney(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value))
}

function statusCopy(status: ReturnType<typeof calculateInvestmentProgress>['status']): {
  label: string
  tone: string
  bg: string
} {
  if (status === 'complete') return { label: 'Goal reached', tone: 'text-[#1B6B3A]', bg: 'bg-[#EDF4EE] border-[#9CC7A7]' }
  if (status === 'risk') return { label: 'At risk', tone: 'text-[#B85050]', bg: 'bg-[#FFF1F0] border-[#E8A09A]' }
  if (status === 'watch') return { label: 'Behind pace', tone: 'text-[#C9A84C]', bg: 'bg-[#FFF8E6] border-[#E8C84A]' }
  return { label: 'On track', tone: 'text-[#1B6B3A]', bg: 'bg-[#F4FAF5] border-[#9CC7A7]' }
}

function dateRangeLabel(start: Date, end: Date): string {
  const startLabel = start.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  return `${startLabel} - ${endLabel}`
}

function projectionData(plan: InvestmentPlan): ChartPoint[] {
  const progress = calculateInvestmentProgress(plan)
  let projected = Math.max(Number(plan.initialBalance) || 0, 0)
  return progress.periods.map(period => {
    if (period.saved) projected += period.savedAmount
    else projected += period.plannedAmount
    return {
      label: period.shortLabel,
      saved: period.saved ? projected : progress.savedTotal,
      projected,
      target: plan.targetAmount,
    }
  })
}

export default function InvestmentPlanning() {
  const [plans, setPlans] = useState<InvestmentPlan[]>(() => {
    const loaded = loadInvestmentPlans()
    return loaded.length > 0 ? loaded : [createDefaultInvestmentPlan()]
  })
  const [activePlanId, setActivePlanId] = useState(() => plans[0]?.id || '')
  const activePlan = plans.find(plan => plan.id === activePlanId) || plans[0]
  const activeProgress = activePlan ? calculateInvestmentProgress(activePlan) : null
  const portfolio = summarizeInvestmentPlans(plans, 'CAD')
  const chartData = activePlan ? projectionData(activePlan) : []

  useEffect(() => {
    saveInvestmentPlans(plans)
  }, [plans])

  function updatePlan(updates: Partial<InvestmentPlan>) {
    if (!activePlan) return
    setPlans(current => current.map(plan => (
      plan.id === activePlan.id ? { ...plan, ...updates } : plan
    )))
  }

  function createPlan() {
    const next = createDefaultInvestmentPlan()
    next.name = `Savings goal ${plans.length + 1}`
    setPlans(current => [...current, next])
    setActivePlanId(next.id)
  }

  function archivePlan() {
    if (!activePlan) return
    setPlans(current => current.map(plan => (
      plan.id === activePlan.id ? { ...plan, status: plan.status === 'open' ? 'archived' : 'open' } : plan
    )))
  }

  function resetActivePlan() {
    if (!activePlan) return
    const reset = { ...createDefaultInvestmentPlan(), id: activePlan.id, createdAt: activePlan.createdAt }
    setPlans(current => current.map(plan => plan.id === activePlan.id ? reset : plan))
  }

  function togglePeriod(periodId: string, amount: number) {
    if (!activePlan) return
    const currentEntry = activePlan.entries[periodId]
    const nextSaved = !currentEntry?.saved
    updatePlan({
      entries: {
        ...activePlan.entries,
        [periodId]: {
          periodId,
          amount: currentEntry?.amount ?? amount,
          saved: nextSaved,
        },
      },
    })
  }

  function updatePeriodAmount(periodId: string, amount: number) {
    if (!activePlan) return
    const currentEntry = activePlan.entries[periodId]
    updatePlan({
      entries: {
        ...activePlan.entries,
        [periodId]: {
          periodId,
          amount,
          saved: currentEntry?.saved ?? false,
        },
      },
    })
  }

  const inputClass = 'w-full rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-sm font-semibold text-[#1B4D3E] focus:outline-none focus:border-[#1B4D3E]'

  if (!activePlan || !activeProgress) {
    return (
      <div className="w-full max-w-7xl mx-auto px-6">
        <button
          type="button"
          onClick={createPlan}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1B4D3E] px-4 py-2.5 text-sm font-bold text-white"
        >
          <CirclePlus size={16} />
          Create investment plan
        </button>
      </div>
    )
  }

  const status = statusCopy(activeProgress.status)
  const remainingNeeded = Math.max(activePlan.targetAmount - activeProgress.savedTotal, 0)
  const projectionGap = Math.max(activePlan.targetAmount - activeProgress.projectedFinal, 0)

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E] flex items-center gap-2">
            <PiggyBank size={24} />
            Investment Planning
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">
            Manage savings goals, mark each period as saved, and keep the year-end target visible.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={createPlan}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1B4D3E] text-white text-sm font-bold hover:bg-[#2D6A4F] transition"
          >
            <CirclePlus size={16} />
            New plan
          </button>
          <button
            type="button"
            onClick={resetActivePlan}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-bold hover:bg-[#F4FAF5] transition"
          >
            <RotateCcw size={16} />
            Reset plan
          </button>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4 mb-5">
        <div className="bg-[#1B4D3E] border border-[#1B4D3E] rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/75">Open plan targets</p>
          <p className="text-2xl font-bold text-[#E8C84A] mt-2">CAD$ {fmt(portfolio.targetTotal)}</p>
          <p className="text-xs text-white/75 mt-1">{portfolio.openPlans} active plan{portfolio.openPlans !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Already saved</p>
          <p className="text-2xl font-bold text-[#1B4D3E] mt-2">CAD$ {fmt(portfolio.savedTotal)}</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Projected final</p>
          <p className="text-2xl font-bold text-[#1B6B3A] mt-2">CAD$ {fmt(portfolio.projectedFinal)}</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Plans at risk</p>
          <p className={`text-2xl font-bold mt-2 ${portfolio.riskPlans > 0 ? 'text-[#B85050]' : 'text-[#1B6B3A]'}`}>{portfolio.riskPlans}</p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="bg-white border border-[#D4E4D5] rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90] mb-3">Plans</p>
            <div className="space-y-2">
              {plans.map(plan => {
                const progress = calculateInvestmentProgress(plan)
                const planStatus = statusCopy(progress.status)
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setActivePlanId(plan.id)}
                    className={`w-full text-left rounded-lg border px-3 py-3 transition ${
                      activePlan.id === plan.id ? 'border-[#1B4D3E] bg-[#EDF4EE]' : 'border-[#D4E4D5] bg-[#F8FBF8] hover:border-[#9CC7A7]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-bold text-[#1B4D3E] truncate">{plan.name}</p>
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${planStatus.tone}`}>{planStatus.label}</span>
                    </div>
                    <p className="text-xs text-[#7BAE8A] mt-1">
                      CAD$ {fmt(progress.savedTotal)} saved of CAD$ {fmt(plan.targetAmount)}
                    </p>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="bg-white border border-[#D4E4D5] rounded-xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Plan setup</p>
                <h2 className="text-xl font-bold text-[#1B4D3E] mt-1">Approved plan</h2>
              </div>
              <button
                type="button"
                onClick={archivePlan}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-xs font-bold text-[#1B4D3E] hover:bg-[#F4FAF5]"
              >
                <Archive size={14} />
                {activePlan.status === 'open' ? 'Archive' : 'Reopen'}
              </button>
            </div>

            <div className="grid gap-4 mt-5">
              <label>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Plan name</span>
                <input
                  value={activePlan.name}
                  onChange={event => updatePlan({ name: event.target.value })}
                  className={`${inputClass} mt-1`}
                />
              </label>

              <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                <label>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Contribution</span>
                  <input
                    type="number"
                    min="0"
                    value={activePlan.contribution}
                    onChange={event => updatePlan({ contribution: Number(event.target.value) })}
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Every</span>
                  <select
                    value={activePlan.frequency}
                    onChange={event => updatePlan({ frequency: event.target.value as InvestmentFrequency, entries: {} })}
                    className={`${inputClass} mt-1`}
                  >
                    <option value="weekly">Week</option>
                    <option value="monthly">Month</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Initial saved</span>
                  <input
                    type="number"
                    min="0"
                    value={activePlan.initialBalance}
                    onChange={event => updatePlan({ initialBalance: Number(event.target.value) })}
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Target</span>
                  <input
                    type="number"
                    min="0"
                    value={activePlan.targetAmount}
                    onChange={event => updatePlan({ targetAmount: Number(event.target.value) })}
                    className={`${inputClass} mt-1`}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Start</span>
                  <input
                    type="date"
                    value={activePlan.startDate}
                    onChange={event => updatePlan({ startDate: event.target.value, entries: {} })}
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">End</span>
                  <input
                    type="date"
                    value={activePlan.endDate}
                    onChange={event => updatePlan({ endDate: event.target.value, entries: {} })}
                    className={`${inputClass} mt-1`}
                  />
                </label>
              </div>

              <label>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Annual return</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={activePlan.annualReturnPct}
                  onChange={event => updatePlan({ annualReturnPct: Number(event.target.value) })}
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
          </section>
        </aside>

        <main className="space-y-5">
          <section className={`rounded-xl border p-5 ${status.bg}`}>
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Current status</p>
                <h2 className={`text-2xl font-bold mt-1 ${status.tone}`}>{status.label}</h2>
                <p className="text-sm text-[#1B4D3E] mt-2">
                  If you keep saving CAD$ {fmt(activePlan.contribution)} per {activePlan.frequency === 'weekly' ? 'week' : 'month'},
                  this plan projects CAD$ {fmt(activeProgress.projectedFinal)} by the target date.
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-0 lg:min-w-[520px]">
                <div className="rounded-lg bg-white border border-[#D4E4D5] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#8BAE90] font-bold">Saved</p>
                  <p className="text-lg font-bold text-[#1B4D3E]">CAD$ {fmt(activeProgress.savedTotal)}</p>
                </div>
                <div className="rounded-lg bg-white border border-[#D4E4D5] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#8BAE90] font-bold">Need left</p>
                  <p className="text-lg font-bold text-[#1B4D3E]">CAD$ {fmt(remainingNeeded)}</p>
                </div>
                <div className="rounded-lg bg-white border border-[#D4E4D5] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#8BAE90] font-bold">Projection gap</p>
                  <p className={`text-lg font-bold ${projectionGap > 0 ? 'text-[#B85050]' : 'text-[#1B6B3A]'}`}>
                    CAD$ {fmt(projectionGap)}
                  </p>
                </div>
                <div className="rounded-lg bg-white border border-[#D4E4D5] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#8BAE90] font-bold">Periods</p>
                  <p className="text-lg font-bold text-[#1B4D3E]">{activeProgress.completedPeriods}/{activeProgress.totalPeriods}</p>
                </div>
              </div>
            </div>
            <div className="mt-5 h-3 rounded-full bg-white border border-[#D4E4D5] overflow-hidden">
              <div className="h-full rounded-full bg-[#E8C84A]" style={{ width: `${activeProgress.targetProgress}%` }} />
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="bg-white border border-[#D4E4D5] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={18} className="text-[#1B4D3E]" />
                <p className="section-title">Plan projection</p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="#D4E4D5" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#7BAE8A" tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis stroke="#7BAE8A" tickFormatter={shortMoney} tickLine={false} axisLine={false} width={44} />
                    <Tooltip
                      formatter={(value, name) => [
                        `CAD$ ${fmt(Number(value || 0))}`,
                        name === 'projected' ? 'Projected' : name === 'target' ? 'Target' : 'Saved',
                      ]}
                      contentStyle={{ borderColor: '#D4E4D5', borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="projected" stroke="#1B4D3E" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="saved" stroke="#C9A84C" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="target" stroke="#B85050" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-[#D4E4D5] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <CircleAlert size={18} className={status.tone} />
                <p className="section-title">Pace check</p>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-3 border-b border-[#EDF4EE] pb-3">
                  <span className="text-[#7BAE8A]">Expected by today</span>
                  <span className="font-bold text-[#1B4D3E]">CAD$ {fmt(activeProgress.expectedByNow)}</span>
                </div>
                <div className="flex justify-between gap-3 border-b border-[#EDF4EE] pb-3">
                  <span className="text-[#7BAE8A]">Saved now</span>
                  <span className="font-bold text-[#1B4D3E]">CAD$ {fmt(activeProgress.savedTotal)}</span>
                </div>
                <div className="flex justify-between gap-3 border-b border-[#EDF4EE] pb-3">
                  <span className="text-[#7BAE8A]">Future scheduled</span>
                  <span className="font-bold text-[#1B4D3E]">CAD$ {fmt(activeProgress.futurePlannedTotal)}</span>
                </div>
                <div className="rounded-lg bg-[#F8FBF8] border border-[#D4E4D5] px-3 py-3">
                  <p className="font-bold text-[#1B4D3E]">
                    {activeProgress.status === 'risk'
                      ? `You need CAD$ ${fmt(activeProgress.targetGap)} more than the current plan projects.`
                      : 'The current pace can reach the goal.'}
                  </p>
                  <p className="text-xs text-[#7BAE8A] mt-1">
                    Mark each period when the money is actually moved to savings or investment.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#D4E4D5] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays size={18} className="text-[#1B4D3E]" />
                <p className="section-title">{activePlan.frequency === 'weekly' ? 'Weekly savings tracker' : 'Monthly savings tracker'}</p>
              </div>
              <p className="text-xs font-bold text-[#8BAE90]">
                Saved CAD$ {fmt(activeProgress.savedTotal)} / Target CAD$ {fmt(activePlan.targetAmount)}
              </p>
            </div>
            <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
              {activeProgress.periods.map(period => {
                const entryAmount = activePlan.entries[period.id]?.amount ?? period.plannedAmount
                return (
                  <div
                    key={period.id}
                    className={`rounded-lg border px-3 py-3 transition ${
                      period.saved ? 'bg-[#EDF4EE] border-[#9CC7A7]' : period.isPastOrCurrent ? 'bg-[#FFF8E6] border-[#E8C84A]' : 'bg-[#F8FBF8] border-[#D4E4D5]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => togglePeriod(period.id, period.plannedAmount)}
                        className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          period.saved ? 'bg-[#1B6B3A] border-[#1B6B3A] text-white' : 'border-[#D4E4D5] bg-white hover:border-[#4E9A7A]'
                        }`}
                        title={period.saved ? 'Saved' : 'Mark as saved'}
                      >
                        {period.saved && <Check size={14} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`font-bold ${period.saved ? 'text-[#1B6B3A]' : 'text-[#1B4D3E]'}`}>{period.label}</p>
                          <input
                            type="number"
                            min="0"
                            value={entryAmount}
                            onChange={event => updatePeriodAmount(period.id, Number(event.target.value))}
                            className="w-24 rounded-lg border border-[#D4E4D5] bg-white px-2 py-1 text-right text-xs font-bold text-[#1B4D3E] focus:outline-none focus:border-[#1B4D3E]"
                          />
                        </div>
                        <p className="text-xs text-[#7BAE8A] mt-1">{dateRangeLabel(period.startDate, period.endDate)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
