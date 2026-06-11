import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CreditCard, Target } from 'lucide-react'
import api from '../services/api'
import type { Account, CategoryBudget } from '../services/api'

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

function cycleDate(month: string, day: number): Date {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1, Math.min(day, new Date(year, monthNumber, 0).getDate()))
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export default function PlannedVsReal() {
  const [spending, setSpending] = useState<SpendingData>({})
  const [budgets, setBudgets] = useState<CategoryBudget[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [showAllCycles, setShowAllCycles] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [spendingRes, budgetRes, accountRes] = await Promise.all([
          api.get('/spending-analysis'),
          api.get('/category-budgets'),
          api.get('/accounts'),
        ])
        const nextSpending = spendingRes.data as SpendingData
        setSpending(nextSpending)
        setBudgets(budgetRes.data as CategoryBudget[])
        setAccounts(accountRes.data as Account[])

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
  const cards = accounts
    .filter(account => account.account_type === 'CREDIT_CARD' && account.closing_day && account.due_day)
    .sort((a, b) => (a.closing_day || 0) - (b.closing_day || 0))
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const cycleStatus = selectedMonth < currentMonth
    ? 'Closed'
    : selectedMonth > currentMonth
      ? 'Upcoming'
      : cards.some(card => cycleDate(selectedMonth, card.closing_day || 1) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        ? 'Open'
        : 'Closed'
  const nextClosing = selectedMonth === currentMonth
    ? cards
      .map(card => ({ card, date: cycleDate(selectedMonth, card.closing_day || 1) }))
      .filter(item => item.date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0]
    : undefined

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
            Budget & Card Cycles
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">See how much of each category budget remains in the selected card cycle.</p>
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
          <div className="bg-[#1B4D3E] text-white rounded-xl p-4 mb-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                  <CreditCard size={18} />
                </span>
                <div>
                  <p className="text-sm font-bold">{monthLabel(selectedMonth)} spending cycle · {cycleStatus}</p>
                  <p className="text-xs text-white/75 mt-1">
                    {nextClosing
                      ? `Next closing: ${nextClosing.card.name}, ${shortDate(nextClosing.date)} · paid ${shortDate(cycleDate(addMonths(selectedMonth, 1), nextClosing.card.due_day || 1))}`
                      : 'Closing dates define the spending cycle. Due dates define when the bill enters Monthly Cash Flow.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAllCycles(value => !value)}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold transition"
              >
                {showAllCycles ? 'Hide card cycles' : 'View all card cycles'}
                {showAllCycles ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            {showAllCycles && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 mt-4 pt-4 border-t border-white/15">
                {cards.map(card => {
                  const closing = cycleDate(selectedMonth, card.closing_day || 1)
                  const payment = cycleDate(addMonths(selectedMonth, 1), card.due_day || 1)
                  return (
                    <div key={card.id} className="rounded-lg bg-white/10 px-3 py-2">
                      <p className="text-sm font-bold truncate">{card.name}</p>
                      <p className="text-xs text-white/75 mt-1">Closes {shortDate(closing)}</p>
                      <p className="text-xs text-[#E8C84A]">Paid {shortDate(payment)}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

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
