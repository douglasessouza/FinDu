import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CreditCard, Save, Target, X } from 'lucide-react'
import api from '../services/api'
import type { Account, Category, CategoryBudget, Transaction } from '../services/api'

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
  const [categories, setCategories] = useState<string[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [showAllCycles, setShowAllCycles] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [editedCats, setEditedCats] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

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

  useEffect(() => {
    async function loadTransactionContext() {
      const [accountRes, categoryRes, transactionRes] = await Promise.all([
        api.get('/accounts'),
        api.get('/categories'),
        api.get('/transactions'),
      ])
      setAccounts(accountRes.data as Account[])
      setCategories((categoryRes.data as Category[]).map(category => category.name).sort())
      setTransactions(transactionRes.data as Transaction[])
    }
    loadTransactionContext()
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

  const accountById = useMemo(() => {
    return accounts.reduce<Record<number, Account>>((lookup, account) => {
      lookup[account.id] = account
      return lookup
    }, {})
  }, [accounts])

  const categoryTransactions = useMemo(() => {
    if (!selectedCategory || !selectedMonth) return []

    return transactions
      .filter(tx => tx.amount < 0)
      .filter(tx => (tx.category || 'Other') === selectedCategory)
      .filter(tx => {
        const account = accountById[tx.account_id]
        if (account?.account_type === 'CREDIT_CARD') {
          return (tx.payment_due_date || tx.date)?.slice(0, 7) === selectedMonth
        }
        return tx.date?.slice(0, 7) === selectedMonth
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }, [accountById, selectedCategory, selectedMonth, transactions])

  const selectedRow = rows.find(row => row.category === selectedCategory)
  const plannedBudgetItems = useMemo(() => {
    if (!selectedCategory || !selectedMonth) return []

    return budgets
      .filter(budget => budget.currency === 'CAD')
      .filter(budget => budget.is_active)
      .filter(budget => budget.category === selectedCategory)
      .filter(budget => budget.start_month <= selectedMonth)
      .filter(budget => !budget.valid_until || new Date(budget.valid_until) >= new Date(`${selectedMonth}-01T00:00:00`))
      .sort((a, b) => a.start_month.localeCompare(b.start_month))
  }, [budgets, selectedCategory, selectedMonth])
  const plannedTotal = plannedBudgetItems.reduce((sum, budget) => sum + budget.amount, 0)
  const modalTotal = categoryTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  const pendingChanges = Object.keys(editedCats).length

  function prevMonth() {
    setSelectedMonth(month => addMonths(month, -1))
  }

  function nextMonth() {
    setSelectedMonth(month => addMonths(month, 1))
  }

  async function refreshSpendingAndTransactions() {
    const [spendingRes, transactionRes] = await Promise.all([
      api.get('/spending-analysis'),
      api.get('/transactions'),
    ])
    setSpending(spendingRes.data as SpendingData)
    setTransactions(transactionRes.data as Transaction[])
  }

  function closeModal() {
    setSelectedCategory(null)
    setEditedCats({})
    setSaveMsg('')
  }

  async function saveCategoryChanges() {
    const changes = Object.entries(editedCats)
    if (changes.length === 0) return

    setSaving(true)
    let updated = 0
    try {
      for (const [id, category] of changes) {
        await api.patch(`/transactions/${id}`, { category })
        updated++
      }
      await refreshSpendingAndTransactions()
      setEditedCats({})
      setSaveMsg(`${updated} transaction${updated !== 1 ? 's' : ''} updated.`)
      setTimeout(() => setSaveMsg(''), 3000)
    } finally {
      setSaving(false)
    }
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
                  <button
                    key={row.category}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(row.category)
                      setEditedCats({})
                      setSaveMsg('')
                    }}
                    className={`rounded-lg border px-4 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]/30 ${cardClass}`}
                  >
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
                  </button>
                )
              })}
            </div>
          )}

          {selectedCategory && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F241C]/45 px-4 py-6">
              <div className="w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-lg bg-white border border-[#D4E4D5] shadow-xl">
                <div className="flex items-start justify-between gap-4 border-b border-[#D4E4D5] px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Category details</p>
                    <h2 className="text-xl font-bold text-[#1B4D3E] mt-1">{selectedCategory}</h2>
                    <p className="text-sm text-[#6F7D73] mt-1">
                      {monthLabel(selectedMonth)} · planned CAD$ {fmt(plannedTotal)} · real CAD$ {fmt(modalTotal)}
                      {selectedRow && ` · variance CAD$ ${fmt(Math.abs(selectedRow.variance))}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="p-2 rounded-lg text-[#1B4D3E] hover:bg-[#F4FAF5] transition"
                    title="Close"
                  >
                    <X size={20} />
                  </button>
                </div>

                {saveMsg && (
                  <div className="mx-5 mt-4 rounded-lg border border-[#D4E4D5] bg-[#F4FAF5] px-4 py-2 text-sm font-semibold text-[#1B6B3A]">
                    {saveMsg}
                  </div>
                )}

                <div className="max-h-[58vh] overflow-auto">
                  <div className="min-w-[860px] grid grid-cols-[280px_1fr] gap-4 p-5">
                    <div className="rounded-lg border border-[#D4E4D5] bg-[#F9FCF9] overflow-hidden">
                      <div className="border-b border-[#D4E4D5] px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Planned list</p>
                        <p className="mt-1 text-lg font-bold text-[#1B4D3E]">CAD$ {fmt(plannedTotal)}</p>
                      </div>

                      {plannedBudgetItems.length === 0 ? (
                        <div className="px-4 py-8 text-sm text-[#8BAE90]">
                          No planned budget for this category in {monthLabel(selectedMonth)}.
                        </div>
                      ) : (
                        plannedBudgetItems.map(budget => (
                          <div key={budget.id} className="border-b border-[#EDF4EE] px-4 py-3 last:border-0">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-[#1B4D3E]">{budget.category}</p>
                                <p className="mt-1 text-xs text-[#6F7D73]">
                                  From {monthLabel(budget.start_month)}
                                  {budget.valid_until ? ` to ${monthLabel(budget.valid_until)}` : ' onward'}
                                </p>
                              </div>
                              <p className="text-right text-sm font-bold tabular-nums text-[#1B4D3E]">
                                CAD$ {fmt(budget.amount)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="rounded-lg border border-[#D4E4D5] bg-white overflow-hidden">
                      <div className="flex items-center justify-between gap-3 border-b border-[#D4E4D5] bg-[#F9FCF9] px-5 py-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Real transactions</p>
                          <p className="mt-1 text-sm font-semibold text-[#1B4D3E]">{categoryTransactions.length} transactions</p>
                        </div>
                        <p className="text-right text-lg font-bold text-[#B85050]">CAD$ {fmt(modalTotal)}</p>
                      </div>

                      {categoryTransactions.length === 0 ? (
                        <div className="px-5 py-12 text-center text-[#8BAE90]">
                          No transactions found in this category for {monthLabel(selectedMonth)}.
                        </div>
                      ) : (
                        <div>
                          <div className="grid grid-cols-[90px_1fr_120px_180px] gap-3 border-b border-[#D4E4D5] bg-[#F9FCF9] px-5 py-3 text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">
                            <span>Date</span>
                            <span>Description</span>
                            <span className="text-right">Amount</span>
                            <span>Move to</span>
                          </div>
                          {categoryTransactions.map((tx, index) => {
                            const [year, month, day] = tx.date.slice(0, 10).split('-').map(Number)
                            const dateStr = new Date(year, month - 1, day).toLocaleDateString('en', { month: 'short', day: 'numeric' })
                            const currentCat = editedCats[tx.id] ?? tx.category ?? 'Other'
                            const isEdited = editedCats[tx.id] !== undefined && editedCats[tx.id] !== tx.category

                            return (
                              <div
                                key={tx.id}
                                className={`grid grid-cols-[90px_1fr_120px_180px] gap-3 items-center border-b border-[#EDF4EE] px-5 py-3 last:border-0 ${index % 2 === 0 ? 'bg-white' : 'bg-[#F9FCF9]'}`}
                              >
                                <span className="text-xs text-[#8BAE90]">{dateStr}</span>
                                <span className="min-w-0 truncate text-sm text-[#2C3E2D]">{tx.description}</span>
                                <span className="text-right text-sm font-semibold tabular-nums text-[#B85050]">
                                  CAD$ {fmt(Math.abs(tx.amount))}
                                </span>
                                <select
                                  value={currentCat}
                                  onChange={event => {
                                    const nextCategory = event.target.value
                                    setEditedCats(prev => {
                                      if (nextCategory === tx.category) {
                                        const { [tx.id]: _removed, ...rest } = prev
                                        return rest
                                      }
                                      return { ...prev, [tx.id]: nextCategory }
                                    })
                                  }}
                                  className={`w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none ${
                                    isEdited
                                      ? 'border-[#C9A84C] bg-[#FDF6E3] font-semibold text-[#7A5C0A]'
                                      : 'border-[#D4E4D5] bg-white text-[#2C3E2D]'
                                  }`}
                                >
                                  {categories.map(category => (
                                    <option key={category} value={category}>{category}</option>
                                  ))}
                                </select>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-[#D4E4D5] bg-[#F4FAF5] px-5 py-4">
                  <span className="text-sm font-semibold text-[#1B4D3E]">
                    {pendingChanges > 0 ? `${pendingChanges} unsaved change${pendingChanges !== 1 ? 's' : ''}` : 'No unsaved changes'}
                  </span>
                  <button
                    type="button"
                    onClick={saveCategoryChanges}
                    disabled={pendingChanges === 0 || saving}
                    className="flex items-center gap-2 rounded-lg bg-[#1B4D3E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2D6A4F] disabled:opacity-50"
                  >
                    <Save size={14} />
                    {saving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
