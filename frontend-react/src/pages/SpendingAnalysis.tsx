import { useState, useEffect } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import {
  getAccounts,
  getCardStatementSummary,
  getCategories,
  getSpendingAnalysis,
  getTransactions,
  updateTransactionCategories,
} from '../services/api'
import type {
  Account,
  CardStatementSummaryItem,
  CurrencyCode,
  SpendingAnalysisResponse,
  SpendingCategorySummary,
  Transaction,
} from '../services/api'
import { loadRowsPreservingPrevious, replaceSelectedMonth } from '../services/reportingData'

// ── Helpers ─────────────────────────────────────────────────────
function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function currencySymbol(currency: CurrencyCode): string {
  if (currency === 'BRL') return 'R$'
  if (currency === 'USD') return 'US$'
  if (currency === 'EUR') return '€'
  return 'CAD$'
}

function formatChartValue(value: unknown, currency: CurrencyCode): string {
  const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
  return `${currencySymbol(currency)} ${fmt(Number.isFinite(numericValue) ? numericValue : 0)}`
}

// Parse "YYYY-MM" safely without timezone issues
function monthLabel(m: string): string {
  const [year, month] = m.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

function monthShort(m: string): string {
  const [year, month] = m.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' })
}

function addMonths(month: string, delta: number): string {
  const [year, mo] = month.split('-').map(Number)
  const date = new Date(year, mo - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function lastDayOfMonth(month: string): string {
  const [year, mo] = month.split('-').map(Number)
  const date = new Date(year, mo, 0)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const COLORS = [
  '#4E9A7A', '#E8B84B', '#6B8CBA', '#D4756B', '#7B9E6B',
  '#C17BB8', '#5BA8C4', '#D4964A', '#8B7BB8', '#6BB89E',
  '#C4A84B', '#7B8EC4', '#C47B8B', '#4B9E9E', '#B87B4B',
  '#9E6B4B', '#6B9E9E', '#9E4B6B',
]

const BAR_COLORS = ['#4E9A7A', '#E8B84B', '#6B8CBA', '#D4756B', '#7B9E6B', '#C17BB8']
const EARLIEST_REPORTING_MONTH = '1000-01'
const CURRENCY_ORDER: CurrencyCode[] = ['CAD', 'BRL', 'USD', 'EUR']

type DisplayTransaction = Transaction & {
  _account_name?: string
  _is_card?: boolean
}

type ChartRow = { category: string } & Record<string, string | number | null>

function chartNumber(value: string | number | null | undefined): number {
  return typeof value === 'number' ? value : Number(value || 0)
}

function spendingValues(summary: SpendingCategorySummary | undefined, currency: CurrencyCode) {
  return summary?.by_currency[currency] || { cards: 0, debit: 0 }
}

// ── Card Summary ─────────────────────────────────────────────────
function CardSummary({ selectedMonth }: { selectedMonth: string }) {
  const [rows, setRows] = useState<CardStatementSummaryItem[]>([])

  useEffect(() => {
    if (!selectedMonth) return
    async function load() {
      try {
        const summary = await getCardStatementSummary(selectedMonth)
        setRows(summary.cards.filter(card => card.amount_due > 0))
      } catch {
        setRows([])
      }
    }
    load()
  }, [selectedMonth])

  if (!rows.length) return null
  const totals = rows.reduce<Partial<Record<CurrencyCode, number>>>((result, row) => {
    result[row.currency] = (result[row.currency] || 0) + row.amount_due
    return result
  }, {})

  return (
    <div className="border-t border-[#EDF4EE] pt-3 mt-4">
      <p className="section-title mb-2">💳 Card spending in this cycle</p>
      {rows.map(r => (
        <div key={`${r.account_id}-${r.currency}`} className="flex justify-between text-sm py-1">
          <span className="text-[#8BAE90]">↳ {r.account_name}</span>
          <span className="text-[#B85050] font-semibold">{currencySymbol(r.currency)} {fmt(r.amount_due)}</span>
        </div>
      ))}
      {CURRENCY_ORDER.filter(currency => totals[currency] !== undefined).map(currency => (
        <div key={currency} className="flex justify-between text-sm font-bold pt-2 border-t border-[#EDF4EE] mt-1">
          <span className="text-[#1B4D3E]">Total cards ({currency})</span>
          <span className="text-[#B85050]">{currencySymbol(currency)} {fmt(totals[currency] || 0)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────
export default function SpendingAnalysis() {
  const [data, setData] = useState<SpendingAnalysisResponse>({})
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('CAD')
  const [trendMonths, setTrendMonths] = useState<string[]>([])
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [categoryTxs, setCategoryTxs] = useState<DisplayTransaction[]>([])
  const [loadingTxs, setLoadingTxs] = useState(false)
  const [categoryTxError, setCategoryTxError] = useState<string | null>(null)
  const [editingTx, setEditingTx] = useState<number | null>(null)
  const [editCat, setEditCat] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const today = new Date()
        const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
        const [nextData, loadedAccounts, loadedCategories] = await Promise.all([
          getSpendingAnalysis(EARLIEST_REPORTING_MONTH, currentMonth),
          getAccounts(),
          getCategories(),
        ])
        setData(nextData)
        setAccounts(loadedAccounts)
        setCategories(loadedCategories.map(c => c.name).sort())
        const months = Object.keys(nextData).sort().reverse()
        if (months.length > 0) setSelectedMonth(months[0])
        setTrendMonths(months.slice(0, 2))
        const available = new Set<CurrencyCode>()
        Object.values(nextData).forEach(month => {
          Object.values(month).forEach(summary => {
            Object.keys(summary.by_currency).forEach(currency => available.add(currency as CurrencyCode))
          })
        })
        setSelectedCurrency(available.has('CAD') ? 'CAD' : CURRENCY_ORDER.find(currency => available.has(currency)) || 'CAD')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const allMonths = Object.keys(data).sort()
  const months = [...allMonths].reverse()
  const monthData = data[selectedMonth] || {}
  const availableCurrencies = CURRENCY_ORDER.filter(currency => (
    Object.values(data).some(month => Object.values(month).some(summary => summary.by_currency[currency]))
  ))
  const symbol = currencySymbol(selectedCurrency)

  const pieData = Object.entries(monthData)
    .map(([cat, vals]) => {
      const currencyValues = spendingValues(vals, selectedCurrency)
      return { name: cat, value: Math.round((currencyValues.cards + currencyValues.debit) * 100) / 100 }
    })
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const grandTotal = pieData.reduce((s, d) => s + d.value, 0)

  // Bar chart
  const monthsToShow = allMonths.filter(month => trendMonths.includes(month))
  const allCatsBar = Array.from(new Set(monthsToShow.flatMap(m => Object.keys(data[m] || {})))).sort()
  const barData = allCatsBar.map(cat => {
    const row: ChartRow = { category: cat }
    for (const m of monthsToShow) {
      const vals = data[m]?.[cat]
      const currencyValues = spendingValues(vals, selectedCurrency)
      const total = Math.round((currencyValues.cards + currencyValues.debit) * 100) / 100
      if (total > 0) row[monthShort(m)] = total
    }
    return row
  }).filter(row => Object.keys(row).length > 1)

  barData.sort((a, b) => {
    const aT = monthsToShow.reduce((s, m) => s + Number(a[monthShort(m)] || 0), 0)
    const bT = monthsToShow.reduce((s, m) => s + Number(b[monthShort(m)] || 0), 0)
    return bT - aT
  })

  const monthBarKeys = monthsToShow.map(m => monthShort(m))

  function toggleTrendMonth(month: string) {
    setTrendMonths(current => {
      if (current.includes(month)) {
        if (current.length === 1) return current
        return current.filter(value => value !== month)
      }
      return [...current, month]
    })
  }

  // Breakdown table
  const allCatsTable = Array.from(new Set(allMonths.flatMap(m => Object.keys(data[m] || {})))).sort()
  const tableRows = allCatsTable.map(cat => {
    const row: ChartRow = { category: cat }
    let catTotal = 0
    for (const m of allMonths) {
      const vals = data[m]?.[cat]
      const currencyValues = spendingValues(vals, selectedCurrency)
      const total = Math.round((currencyValues.cards + currencyValues.debit) * 100) / 100
      row[m] = total > 0 ? total : null
      catTotal += total
    }
    row.total = Math.round(catTotal * 100) / 100
    return row
  })

  const tableTotals: ChartRow = { category: '💰 TOTAL', total: 0 }
  for (const m of allMonths) {
    const mTotal = allCatsTable.reduce((s, cat) => {
      const vals = data[m]?.[cat]
      const currencyValues = spendingValues(vals, selectedCurrency)
      return s + currencyValues.cards + currencyValues.debit
    }, 0)
    tableTotals[m] = Math.round(mTotal * 100) / 100
    tableTotals.total = Number(tableTotals.total || 0) + mTotal
  }
  tableTotals.total = Math.round(chartNumber(tableTotals.total) * 100) / 100

  // Transactions
  async function loadTxsForCategory(category: string, previousRows = categoryTxs) {
    const EXCLUDED = ['Salary', 'Other Income', 'Transfer']
    setLoadingTxs(true)
    setCategoryTxError(null)
    const result = await loadRowsPreservingPrevious(async () => {
      if (EXCLUDED.includes(category)) return []

      const categoryRows = await getTransactions({
        category,
        dateFrom: `${addMonths(selectedMonth, -1)}-01`,
        dateTo: lastDayOfMonth(selectedMonth),
      })
      const accountById = new Map(accounts.map(account => [account.id, account]))
      const rows: DisplayTransaction[] = categoryRows
        .filter(transaction => transaction.amount < 0 && transaction.currency === selectedCurrency)
        .filter(transaction => {
          const account = accountById.get(transaction.account_id)
          const reportingMonth = account?.account_type === 'CREDIT_CARD'
            ? transaction.statement_month || transaction.date.slice(0, 7)
            : transaction.date.slice(0, 7)
          return reportingMonth === selectedMonth
        })
        .map(transaction => {
          const account = accountById.get(transaction.account_id)
          return {
            ...transaction,
            _account_name: account?.name,
            _is_card: account?.account_type === 'CREDIT_CARD',
          }
        })
      rows.sort((a, b) => b.date.localeCompare(a.date))
      return rows
    }, previousRows)
    setCategoryTxs(result.rows)
    setCategoryTxError(result.error)
    setLoadingTxs(false)
  }

  function toggleCategory(cat: string) {
    if (openCategory === cat) {
      setOpenCategory(null)
      setCategoryTxs([])
      setCategoryTxError(null)
    } else {
      setOpenCategory(cat)
      setEditingTx(null)
      setCategoryTxs([])
      setCategoryTxError(null)
      loadTxsForCategory(cat, [])
    }
  }

  async function saveCategory(txId: number, newCat: string) {
    try {
      await updateTransactionCategories([{ id: txId, category: newCat }])
      const updatedSpending = await getSpendingAnalysis(selectedMonth, selectedMonth)
      setData(current => replaceSelectedMonth(current, selectedMonth, updatedSpending))
      setEditingTx(null)
      if (openCategory) loadTxsForCategory(openCategory, categoryTxs)
    } catch (error) {
      console.error(`Failed to update transaction ${txId}`, error)
    }
  }

  async function refresh() {
    setCategoryTxs([])
    setCategoryTxError(null)
    setOpenCategory(null)
    if (!selectedMonth) return
    const today = new Date()
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const updatedSpending = await getSpendingAnalysis(EARLIEST_REPORTING_MONTH, currentMonth)
    setData(updatedSpending)
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="w-full max-w-7xl mx-auto px-6">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E]">📈 Spending Analysis</h1>
          <p className="text-sm text-[#7BAE8A] mt-1">Card purchases follow each statement cycle; bank spending follows the transaction month.</p>
        </div>
        <button onClick={refresh} className="flex items-center gap-2 text-sm text-[#8BAE90] hover:text-[#1B4D3E] transition">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center text-[#8BAE90] py-20">Loading...</div>
      ) : months.length === 0 ? (
        <div className="text-center text-[#8BAE90] py-20">No spending data yet. Import some transactions first!</div>
      ) : (
        <>
          {/* Month selector */}
          <div className="mb-6 flex flex-wrap gap-3">
            <select
              value={selectedMonth}
              onChange={e => { setSelectedMonth(e.target.value); setOpenCategory(null) }}
              className="px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
            >
              {months.map(m => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
            {availableCurrencies.length > 1 && (
              <select
                aria-label="Reporting currency"
                value={selectedCurrency}
                onChange={e => { setSelectedCurrency(e.target.value as CurrencyCode); setOpenCategory(null) }}
                className="px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
              >
                {availableCurrencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            )}
          </div>

          {pieData.length === 0 ? (
            <div className="text-center text-[#8BAE90] py-10">No expenses for this month.</div>
          ) : (
            <>
              {/* ── Donut + Categories ── */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-10">

                {/* Left: donut */}
                <div className="bg-white rounded-xl border border-[#D4E4D5] p-6">
                  <p className="section-title mb-2">
                    Spending by Category — {monthLabel(selectedMonth)}
                  </p>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius="55%"
                        outerRadius="80%"
                        dataKey="value"
                        paddingAngle={2}
                        label={({ percent = 0 }) => percent > 0.04 ? `${(percent * 100).toFixed(1)}%` : ''}
                        labelLine={false}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [formatChartValue(value, selectedCurrency), String(name)]}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #D4E4D5', fontSize: '13px', backgroundColor: 'white' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <p className="text-center text-sm text-[#8BAE90] mt-1">
                    Total: <span className="font-bold text-[#1B4D3E]">{symbol} {fmt(grandTotal)}</span>
                  </p>
                  <CardSummary selectedMonth={selectedMonth} />
                </div>

                {/* Right: category list — 2 columns when many */}
                <div className={`grid gap-2 content-start ${pieData.length > 8 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {pieData.map((d, i) => {
                    const pct = grandTotal > 0 ? ((d.value / grandTotal) * 100).toFixed(1) : '0'
                    const color = COLORS[i % COLORS.length]
                    const isOpen = openCategory === d.name

                    return (
                      <div key={d.name} className="bg-white rounded-xl border border-[#D4E4D5] overflow-hidden">
                        {/* Header */}
                        <button
                          onClick={() => toggleCategory(d.name)}
                          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#F4FAF5] transition"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <span className="text-sm font-semibold text-[#1B4D3E] truncate">{d.name}</span>
                            <span className="text-xs text-[#8BAE90] shrink-0">{pct}%</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-1">
                            <span className="text-xs font-bold text-[#B85050]">{symbol} {fmt(d.value)}</span>
                            {isOpen ? <ChevronUp size={12} className="text-[#8BAE90]" /> : <ChevronDown size={12} className="text-[#8BAE90]" />}
                          </div>
                        </button>

                        {/* Transactions — only shown when open */}
                        {isOpen && (
                          <div className="border-t border-[#EDF4EE] col-span-full">
                            {loadingTxs ? (
                              <p className="px-4 py-3 text-sm text-[#8BAE90]">Loading...</p>
                            ) : (
                              <>
                                {categoryTxError && (
                                  <div role="alert" className="flex items-center justify-between gap-3 border-b border-[#F0D6D6] bg-[#FFF7F7] px-4 py-3 text-sm text-[#9A3F3F]">
                                    <span>{categoryTxError}</span>
                                    <button
                                      type="button"
                                      onClick={() => loadTxsForCategory(d.name, categoryTxs)}
                                      className="shrink-0 rounded-lg border border-[#D9A8A8] px-3 py-1 text-xs font-semibold hover:bg-white"
                                    >
                                      Retry
                                    </button>
                                  </div>
                                )}
                                {!categoryTxError && categoryTxs.length === 0 && (
                                  <p className="px-4 py-3 text-sm text-[#8BAE90]">No transactions found.</p>
                                )}
                                {categoryTxs.map(t => {
                                  const amt = Math.abs(t.amount)
                                  const [y, mo, dy] = t.date.slice(0, 10).split('-').map(Number)
                                  const dateStr = new Date(y, mo - 1, dy).toLocaleDateString('en', { month: 'short', day: 'numeric' })
                                  const isEditing = editingTx === t.id

                                  return (
                                    <div key={t.id} className="px-4 py-2 border-b border-[#EDF4EE] last:border-0">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                          <span className="text-xs text-[#8BAE90] shrink-0">{dateStr}</span>
                                          <span className="text-sm text-[#2C3E2D] truncate">{t.description}</span>
                                          <span className="text-xs text-[#8BAE90] shrink-0">
                                            {t._is_card ? '💳' : '🏦'} {t._account_name}
                                          </span>
                                        </div>
                                        <span className="text-sm font-semibold text-[#B85050] shrink-0">{symbol} {fmt(amt)}</span>
                                      </div>

                                      {isEditing ? (
                                        <div className="flex items-center gap-2 mt-1.5">
                                          <select
                                            value={editCat}
                                            onChange={e => setEditCat(e.target.value)}
                                            className="flex-1 text-xs px-2 py-1 border border-[#D4E4D5] rounded-lg focus:outline-none bg-white"
                                          >
                                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                          </select>
                                          <button
                                            onClick={() => saveCategory(t.id, editCat)}
                                            className="text-xs px-3 py-1 bg-[#1B4D3E] text-white rounded-lg hover:bg-[#2D6A4F] transition"
                                          >Save</button>
                                          <button
                                            onClick={() => setEditingTx(null)}
                                            className="text-xs px-2 py-1 text-[#8BAE90] hover:text-[#1B4D3E]"
                                          >✕</button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => { setEditingTx(t.id); setEditCat(t.category || 'Other') }}
                                          className="text-xs text-[#8BAE90] hover:text-[#1B4D3E] transition mt-0.5"
                                        >✏️ Edit category</button>
                                      )}
                                    </div>
                                  )
                                })}
                                {categoryTxs.length > 0 && (
                                  <div className="px-4 py-2 bg-[#F4FAF5] flex justify-between text-xs font-semibold">
                                    <span className="text-[#1B4D3E]">{categoryTxs.length} transactions</span>
                                    <span className="text-[#B85050]">{symbol} {fmt(categoryTxs.reduce((s, t) => s + Math.abs(t.amount), 0))}</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── Category Trends ── */}
              <div className="bg-white rounded-xl border border-[#D4E4D5] p-6 mb-10">
                <div className="flex flex-col gap-3 mb-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="section-title">📊 Category Trends</p>
                    <p className="text-xs text-[#8BAE90]">
                      Comparing {monthsToShow.length} month{monthsToShow.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2" aria-label="Months to compare">
                    {[...allMonths].reverse().map(month => {
                      const selected = trendMonths.includes(month)
                      const isOnlySelection = selected && trendMonths.length === 1
                      return (
                        <button
                          key={month}
                          type="button"
                          onClick={() => toggleTrendMonth(month)}
                          aria-pressed={selected}
                          title={isOnlySelection ? 'At least one month must remain selected' : `${selected ? 'Remove' : 'Add'} ${monthLabel(month)}`}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            selected
                              ? 'border-[#1B4D3E] bg-[#1B4D3E] text-white'
                              : 'border-[#D4E4D5] bg-white text-[#7BAE8A] hover:border-[#4E9A7A] hover:text-[#1B4D3E]'
                          } ${isOnlySelection ? 'cursor-not-allowed' : ''}`}
                        >
                          {monthShort(month)}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={barData} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EDF4EE" />
                    <XAxis dataKey="category" angle={-35} textAnchor="end" tick={{ fontSize: 11, fill: '#8BAE90' }} interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: '#8BAE90' }} tickFormatter={v => `${symbol}${v}`} />
                    <Tooltip
                      formatter={(value, name) => [formatChartValue(value, selectedCurrency), String(name)]}
                      contentStyle={{ borderRadius: '8px', border: '1px solid #D4E4D5', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                    {monthBarKeys.map((key, i) => (
                      <Bar key={key} dataKey={key} fill={BAR_COLORS[i % BAR_COLORS.length]} radius={[3, 3, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* ── Category Breakdown table ── */}
              <div className="bg-white rounded-xl border border-[#D4E4D5] p-6 mb-10">
                <p className="section-title mb-4">📋 Category Breakdown by Month</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-[#D4E4D5]">
                        <th className="text-left py-2 px-3 text-[#1B4D3E] font-bold">Category</th>
                        {allMonths.map(m => (
                          <th key={m} className="text-right py-2 px-3 text-[#1B4D3E] font-bold">{monthShort(m)}</th>
                        ))}
                        <th className="text-right py-2 px-3 text-[#1B4D3E] font-bold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((row, idx) => (
                        <tr key={row.category} className={`border-b border-[#EDF4EE] ${idx % 2 === 0 ? '' : 'bg-[#F9FCF9]'}`}>
                          <td className="py-2 px-3 text-[#2C3E2D] font-medium">{row.category}</td>
                          {allMonths.map(m => (
                            <td key={m} className="text-right py-2 px-3 text-[#8BAE90]">
                              {chartNumber(row[m]) ? `${symbol} ${fmt(chartNumber(row[m]))}` : '—'}
                            </td>
                          ))}
                          <td className="text-right py-2 px-3 font-semibold text-[#1B4D3E]">{symbol} {fmt(chartNumber(row.total))}</td>
                        </tr>
                      ))}
                      <tr className="bg-[#1B4D3E] text-white font-bold">
                        <td className="py-3 px-3 rounded-bl-lg">💰 TOTAL</td>
                        {allMonths.map(m => (
                          <td key={m} className="text-right py-3 px-3">{symbol} {fmt(chartNumber(tableTotals[m]))}</td>
                        ))}
                        <td className="text-right py-3 px-3 text-[#E8C84A] rounded-br-lg">{symbol} {fmt(chartNumber(tableTotals.total))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-[#8BAE90] mt-3">Grand total: {symbol} {fmt(tableTotals.total)}</p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
