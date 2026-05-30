import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Target } from 'lucide-react'
import api from '../services/api'
import type { RecurringExpense } from '../services/api'

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

function isValidThisMonth(item: RecurringExpense, month: string): boolean {
  if (!item.valid_until) return true
  const [year, mo] = month.split('-').map(Number)
  const monthStart = new Date(year, mo - 1, 1)
  const validUntil = new Date(item.valid_until)
  return Number.isNaN(validUntil.getTime()) || validUntil >= monthStart
}

export default function PlannedVsReal() {
  const [spending, setSpending] = useState<SpendingData>({})
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [spendingRes, recurringRes] = await Promise.all([
          api.get('/spending-analysis'),
          api.get('/recurring-expenses'),
        ])
        const nextSpending = spendingRes.data as SpendingData
        setSpending(nextSpending)
        setRecurring(recurringRes.data as RecurringExpense[])

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

    const plannedByCategory = recurring
      .filter(item => item.type !== 'INCOME')
      .filter(item => item.currency === 'CAD')
      .filter(item => isValidThisMonth(item, selectedMonth))
      .reduce<Record<string, number>>((totals, item) => {
        const category = item.category || 'Other'
        totals[category] = (totals[category] || 0) + item.amount
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
  }, [recurring, selectedMonth, spending])

  const totals = rows.reduce(
    (acc, row) => ({
      planned: acc.planned + row.planned,
      real: acc.real + row.real,
      variance: acc.variance + row.variance,
    }),
    { planned: 0, real: 0, variance: 0 },
  )

  const maxAmount = Math.max(1, ...rows.map(row => Math.max(row.planned, row.real)))

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
          <p className="text-sm text-[#7BAE8A] mt-1">Compare planned recurring expenses against imported real spending by category.</p>
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

          <div className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b border-[#EDF4EE] text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">
              <span>Category</span>
              <span className="text-right">Planned</span>
              <span className="text-right">Real</span>
              <span className="text-right">Variance</span>
            </div>

            {rows.length === 0 ? (
              <div className="px-5 py-12 text-center text-[#8BAE90]">No planned or real spending for this month.</div>
            ) : (
              rows.map(row => {
                const plannedWidth = `${Math.max(3, (row.planned / maxAmount) * 100)}%`
                const realWidth = `${Math.max(3, (row.real / maxAmount) * 100)}%`
                const over = row.variance > 0

                return (
                  <div key={row.category} className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 px-5 py-4 border-b border-[#EDF4EE] last:border-0">
                    <div>
                      <p className="font-bold text-[#1B4D3E]">{row.category}</p>
                      <div className="mt-2 space-y-1">
                        <div className="h-2 bg-[#EDF4EE] rounded-full overflow-hidden">
                          <div className="h-full bg-[#7BAE8A]" style={{ width: plannedWidth }} />
                        </div>
                        <div className="h-2 bg-[#EDF4EE] rounded-full overflow-hidden">
                          <div className={`h-full ${over ? 'bg-[#B85050]' : 'bg-[#1B6B3A]'}`} style={{ width: realWidth }} />
                        </div>
                      </div>
                    </div>
                    <p className="lg:text-right font-semibold text-[#1B4D3E]">CAD$ {fmt(row.planned)}</p>
                    <p className="lg:text-right font-semibold text-[#B85050]">CAD$ {fmt(row.real)}</p>
                    <p className={`lg:text-right font-bold ${over ? 'text-[#B85050]' : 'text-[#1B6B3A]'}`}>
                      {row.variance >= 0 ? '+' : '-'} CAD$ {fmt(Math.abs(row.variance))}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
