import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Target } from 'lucide-react'
import api from '../services/api'
import type { CategoryBudget } from '../services/api'

interface SpendingData {
  [month: string]: { [category: string]: { cards: number; debit: number } }
}

interface Row {
  category: string
  planned: number
  real: number
  variance: number
}

function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function monthLabel(month: string): string {
  const [year, mo] = month.split('-').map(Number)
  return new Date(year, mo - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

function addMonths(month: string, delta: number): string {
  const [year, mo] = month.split('-').map(Number)
  const date = new Date(year, mo - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export default function PlannedVsReal() {
  const [spending, setSpending] = useState<SpendingData>({})
  const [budgets, setBudgets] = useState<CategoryBudget[]>([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [spendingRes, budgetRes] = await Promise.all([
          api.get('/spending-analysis'),
          api.get('/category-budgets'),
        ])
        const nextSpending = spendingRes.data as SpendingData
        setSpending(nextSpending)
        setBudgets(budgetRes.data as CategoryBudget[])

        const months = Object.keys(nextSpending).sort()
        const today = new Date()
        const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
        setSelectedMonth(months.includes(currentMonth) ? currentMonth : months[months.length - 1] || currentMonth)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const rows = useMemo<Row[]>(() => {
    if (!selectedMonth) return []

    const plannedByCategory = budgets
      .filter(budget => budget.currency === 'CAD')
      .filter(budget => budget.is_active)
      .filter(budget => budget.start_month <= selectedMonth)
      .filter(budget => !budget.valid_until || new Date(budget.valid_until) >= new Date(`${selectedMonth}-01T00:00:00`))
      .reduce<Record<string, number>>((totals, budget) => {
        totals[budget.category] = (totals[budget.category] || 0) + budget.amount
        return totals
      }, {})

    const realByCategory = Object.entries(spending[selectedMonth] || {}).reduce<Record<string, number>>((totals, [category, value]) => {
      totals[category] = Math.round(((value.cards || 0) + (value.debit || 0)) * 100) / 100
      return totals
    }, {})

    return Array.from(new Set([...Object.keys(plannedByCategory), ...Object.keys(realByCategory)]))
      .map(category => {
        const planned = plannedByCategory[category] || 0
        const real = realByCategory[category] || 0
        return {
          category,
          planned,
          real,
          variance: real - planned,
        }
      })
      .filter(row => row.planned > 0 || row.real > 0)
      .sort((a, b) => Math.max(b.real, b.planned) - Math.max(a.real, a.planned))
  }, [budgets, selectedMonth, spending])

  const totals = rows.reduce(
    (acc, row) => ({
      planned: acc.planned + row.planned,
      real: acc.real + row.real,
      variance: acc.variance + row.variance,
    }),
    { planned: 0, real: 0, variance: 0 },
  )

  function prevMonth() {
    setSelectedMonth(month => addMonths(month, -1))
  }

  function nextMonth() {
    setSelectedMonth(month => addMonths(month, 1))
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E] flex items-center gap-2">
            <Target size={24} />
            Planned vs Real
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">Compare monthly category budgets against imported real spending by category.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-[#D4E4D5] transition text-[#1B4D3E]">
            <ChevronLeft size={20} />
          </button>
          <p className="min-w-40 text-center font-bold text-[#1B4D3E]">{selectedMonth ? monthLabel(selectedMonth) : 'Loading'}</p>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-[#D4E4D5] transition text-[#1B4D3E]">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-[#8BAE90] py-20">Loading planned vs real...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
              <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Planned</p>
              <p className="text-2xl font-bold text-[#1B4D3E] mt-1">CAD$ {fmt(totals.planned)}</p>
            </div>
            <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
              <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Real</p>
              <p className="text-2xl font-bold text-[#B85050] mt-1">CAD$ {fmt(totals.real)}</p>
            </div>
            <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
              <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Variance</p>
              <p className={`text-2xl font-bold mt-1 ${totals.variance <= 0 ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>
                {totals.variance >= 0 ? '+' : '-'} CAD$ {fmt(Math.abs(totals.variance))}
              </p>
            </div>
          </div>

          <div className="bg-white border border-[#D4E4D5] rounded-lg px-4 py-3 mb-4">
            <p className="section-title mb-3">Color Legend</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 text-sm">
              <div className="flex items-center gap-2 text-[#1B4D3E]">
                <span className="w-4 h-4 rounded border border-[#D4E4D5] bg-[#F4FAF5]" />
                <span>On track</span>
              </div>
              <div className="flex items-center gap-2 text-[#1B4D3E]">
                <span className="w-4 h-4 rounded border border-[#CFE0F5] bg-[#F3F7FD]" />
                <span>Close to budget</span>
              </div>
              <div className="flex items-center gap-2 text-[#1B4D3E]">
                <span className="w-4 h-4 rounded border border-[#F0CCCC] bg-[#FDF5F5]" />
                <span>Over budget</span>
              </div>
              <div className="flex items-center gap-2 text-[#1B4D3E]">
                <span className="w-4 h-4 rounded border border-[#B8C0BA] bg-[#E3E7E4]" />
                <span>Not planned yet</span>
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="bg-white border border-[#D4E4D5] rounded-lg px-5 py-12 text-center text-[#8BAE90]">
              No planned or real spending for this month.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {rows.map(row => {
                const isUnplanned = row.planned <= 0
                const over = !isUnplanned && row.variance > 0
                const ratio = row.planned > 0 ? row.real / row.planned : 0
                const cardClass = isUnplanned
                  ? 'bg-[#E3E7E4] border-[#B8C0BA]'
                  : over
                    ? 'bg-[#FDF5F5] border-[#F0CCCC]'
                    : ratio >= 0.75
                      ? 'bg-[#F3F7FD] border-[#CFE0F5]'
                      : 'bg-[#F4FAF5] border-[#D4E4D5]'
                const statusClass = isUnplanned ? 'text-[#6F7D73]' : over ? 'text-[#B85050]' : ratio >= 0.75 ? 'text-[#3F6EA8]' : 'text-[#1B6B3A]'
                const statusLabel = isUnplanned
                  ? `Not planned yet · real CAD$ ${fmt(row.real)}`
                  : over
                    ? `Over by CAD$ ${fmt(Math.abs(row.variance))}`
                    : `Remaining CAD$ ${fmt(Math.abs(row.variance))}`
                const percentLabel = isUnplanned ? 'No plan' : `${Math.round(ratio * 100)}%`

                return (
                  <div key={row.category} className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-[#1B4D3E] truncate">{row.category}</p>
                        <p className={`text-xs font-semibold mt-1 ${statusClass}`}>{statusLabel}</p>
                      </div>
                      <p className={`text-xs font-bold ${statusClass}`}>{percentLabel}</p>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-[#7BAE8A]">Planned</p>
                        <p className="font-bold text-[#1B4D3E]">CAD$ {fmt(row.planned)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[#7BAE8A]">Real</p>
                        <p className={`font-bold ${isUnplanned ? 'text-[#6F7D73]' : over ? 'text-[#B85050]' : 'text-[#1B6B3A]'}`}>CAD$ {fmt(row.real)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
