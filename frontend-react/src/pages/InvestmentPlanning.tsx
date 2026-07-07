import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, PiggyBank, RotateCcw, TrendingUp } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type Frequency = 'weekly' | 'monthly'

interface InvestmentPlan {
  initialBalance: number
  contribution: number
  frequency: Frequency
  annualReturnPct: number
  targetAmount: number
  startDate: string
  endDate: string
}

interface ProjectionPoint {
  label: string
  date: Date
  balance: number
  contributed: number
  growth: number
}

const STORAGE_KEY = 'findu_investment_plan'

function todayInput(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function yearEndInput(): string {
  const today = new Date()
  return `${today.getFullYear()}-12-31`
}

function defaultPlan(): InvestmentPlan {
  return {
    initialBalance: 0,
    contribution: 100,
    frequency: 'weekly',
    annualReturnPct: 0,
    targetAmount: 5000,
    startDate: todayInput(),
    endDate: yearEndInput(),
  }
}

function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function shortMoney(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value))
}

function parseInputDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function monthLabel(date: Date): string {
  return date.toLocaleString('en', { month: 'short' })
}

function loadPlan(): InvestmentPlan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPlan()
    return { ...defaultPlan(), ...JSON.parse(raw) }
  } catch {
    return defaultPlan()
  }
}

function projectPlan(plan: InvestmentPlan): ProjectionPoint[] {
  const start = parseInputDate(plan.startDate)
  const end = parseInputDate(plan.endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []

  const points: ProjectionPoint[] = []
  let balance = Number(plan.initialBalance) || 0
  let contributed = balance
  let contributionDate = new Date(start)
  let checkpoint = new Date(start.getFullYear(), start.getMonth(), 1)
  const monthlyRate = Math.pow(1 + Math.max(plan.annualReturnPct, 0) / 100, 1 / 12) - 1

  while (checkpoint <= end) {
    const nextCheckpoint = new Date(checkpoint.getFullYear(), checkpoint.getMonth() + 1, 1)

    while (contributionDate < nextCheckpoint && contributionDate <= end) {
      const amount = Math.max(Number(plan.contribution) || 0, 0)
      balance += amount
      contributed += amount
      contributionDate = plan.frequency === 'weekly'
        ? addDays(contributionDate, 7)
        : addMonths(contributionDate, 1)
    }

    if (checkpoint >= start || checkpoint.getMonth() === start.getMonth()) {
      balance *= (1 + monthlyRate)
      const growth = balance - contributed
      points.push({
        label: monthLabel(checkpoint),
        date: new Date(checkpoint),
        balance: Math.round(balance * 100) / 100,
        contributed: Math.round(contributed * 100) / 100,
        growth: Math.round(Math.max(growth, 0) * 100) / 100,
      })
    }

    checkpoint = nextCheckpoint
  }

  return points
}

export default function InvestmentPlanning() {
  const [plan, setPlan] = useState<InvestmentPlan>(() => loadPlan())
  const projection = useMemo(() => projectPlan(plan), [plan])
  const finalPoint = projection[projection.length - 1]
  const finalBalance = finalPoint?.balance || 0
  const totalContributed = finalPoint?.contributed || 0
  const totalGrowth = Math.max(finalBalance - totalContributed, 0)
  const targetGap = Math.max(plan.targetAmount - finalBalance, 0)
  const targetProgress = plan.targetAmount > 0 ? Math.min((finalBalance / plan.targetAmount) * 100, 100) : 0
  const contributionCount = plan.contribution > 0
    ? Math.max(Math.round((totalContributed - plan.initialBalance) / plan.contribution), 0)
    : 0

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
  }, [plan])

  function updatePlan<K extends keyof InvestmentPlan>(key: K, value: InvestmentPlan[K]) {
    setPlan(current => ({ ...current, [key]: value }))
  }

  function resetPlan() {
    setPlan(defaultPlan())
  }

  const inputClass = 'w-full rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-sm font-semibold text-[#1B4D3E] focus:outline-none focus:border-[#1B4D3E]'

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E] flex items-center gap-2">
            <PiggyBank size={24} />
            Investment Planning
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">
            Plan weekly or monthly contributions and see the projected balance by your target date.
          </p>
        </div>
        <button
          type="button"
          onClick={resetPlan}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-bold hover:bg-[#F4FAF5] transition"
        >
          <RotateCcw size={16} />
          Reset
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <section className="bg-white border border-[#D4E4D5] rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Plan inputs</p>
          <h2 className="text-xl font-bold text-[#1B4D3E] mt-1">Contribution plan</h2>

          <div className="grid gap-4 mt-5">
            <label>
              <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Initial balance</span>
              <input
                type="number"
                min="0"
                value={plan.initialBalance}
                onChange={event => updatePlan('initialBalance', Number(event.target.value))}
                className={`${inputClass} mt-1`}
              />
            </label>

            <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3">
              <label>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Contribution</span>
                <input
                  type="number"
                  min="0"
                  value={plan.contribution}
                  onChange={event => updatePlan('contribution', Number(event.target.value))}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Frequency</span>
                <select
                  value={plan.frequency}
                  onChange={event => updatePlan('frequency', event.target.value as Frequency)}
                  className={`${inputClass} mt-1`}
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Start</span>
                <input
                  type="date"
                  value={plan.startDate}
                  onChange={event => updatePlan('startDate', event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">End</span>
                <input
                  type="date"
                  value={plan.endDate}
                  onChange={event => updatePlan('endDate', event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Annual return</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={plan.annualReturnPct}
                  onChange={event => updatePlan('annualReturnPct', Number(event.target.value))}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Target</span>
                <input
                  type="number"
                  min="0"
                  value={plan.targetAmount}
                  onChange={event => updatePlan('targetAmount', Number(event.target.value))}
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] px-4 py-3">
            <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Assumption</p>
            <p className="text-sm text-[#1B4D3E] mt-1">
              Return is optional and defaults to 0%. This is a planning calculator, not investment advice.
            </p>
          </div>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="bg-[#1B4D3E] border border-[#1B4D3E] rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/75">Projected balance</p>
              <p className="text-2xl font-bold text-[#E8C84A] mt-2">CAD$ {fmt(finalBalance)}</p>
            </div>
            <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Contributed</p>
              <p className="text-2xl font-bold text-[#1B4D3E] mt-2">CAD$ {fmt(totalContributed)}</p>
            </div>
            <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Projected growth</p>
              <p className="text-2xl font-bold text-[#1B6B3A] mt-2">CAD$ {fmt(totalGrowth)}</p>
            </div>
            <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Contributions</p>
              <p className="text-2xl font-bold text-[#1B4D3E] mt-2">{contributionCount}</p>
            </div>
          </div>

          <div className="bg-white border border-[#D4E4D5] rounded-xl p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Goal progress</p>
                <h2 className="text-xl font-bold text-[#1B4D3E] mt-1">Target CAD$ {fmt(plan.targetAmount)}</h2>
              </div>
              <div className="text-left md:text-right">
                <p className="text-sm font-bold text-[#1B4D3E]">{Math.round(targetProgress)}% complete</p>
                <p className="text-xs text-[#7BAE8A]">Gap CAD$ {fmt(targetGap)}</p>
              </div>
            </div>
            <div className="h-3 rounded-full bg-[#EDF4EE] border border-[#D4E4D5] overflow-hidden">
              <div className="h-full rounded-full bg-[#E8C84A]" style={{ width: `${targetProgress}%` }} />
            </div>
          </div>

          <div className="bg-white border border-[#D4E4D5] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-[#1B4D3E]" />
              <p className="section-title">Projection</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={projection}>
                  <CartesianGrid stroke="#D4E4D5" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#7BAE8A" tickLine={false} axisLine={false} />
                  <YAxis stroke="#7BAE8A" tickFormatter={shortMoney} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    formatter={(value, name) => [
                      `CAD$ ${fmt(Number(value || 0))}`,
                      name === 'contributed' ? 'Contributed' : 'Balance',
                    ]}
                    contentStyle={{ borderColor: '#D4E4D5', borderRadius: 8 }}
                  />
                  <Line type="monotone" dataKey="balance" stroke="#1B4D3E" strokeWidth={3} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="contributed" stroke="#C9A84C" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#D4E4D5] flex items-center gap-2">
              <CalendarDays size={18} className="text-[#1B4D3E]" />
              <p className="section-title">Monthly checkpoints</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-[#F8FBF8] text-[#8BAE90] uppercase text-xs tracking-widest">
                  <tr>
                    <th className="text-left px-5 py-3">Month</th>
                    <th className="text-right px-5 py-3">Contributed</th>
                    <th className="text-right px-5 py-3">Growth</th>
                    <th className="text-right px-5 py-3">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.map(point => (
                    <tr key={`${point.label}-${point.date.toISOString()}`} className="border-t border-[#EDF4EE]">
                      <td className="px-5 py-3 font-bold text-[#1B4D3E]">{point.label}</td>
                      <td className="px-5 py-3 text-right text-[#2C3E2D]">CAD$ {fmt(point.contributed)}</td>
                      <td className="px-5 py-3 text-right text-[#1B6B3A]">CAD$ {fmt(point.growth)}</td>
                      <td className="px-5 py-3 text-right font-bold text-[#1B4D3E]">CAD$ {fmt(point.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
