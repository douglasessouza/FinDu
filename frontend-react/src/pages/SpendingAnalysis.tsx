import { useState, useEffect } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import api from '../services/api'
import type { Account, Category } from '../services/api'

// ── Helpers ─────────────────────────────────────────────────────
function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatChartValue(value: unknown): string {
  const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
  return `CAD$ ${fmt(Number.isFinite(numericValue) ? numericValue : 0)}`
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

const COLORS = [
  '#4E9A7A', '#E8B84B', '#6B8CBA', '#D4756B', '#7B9E6B',
  '#C17BB8', '#5BA8C4', '#D4964A', '#8B7BB8', '#6BB89E',
  '#C4A84B', '#7B8EC4', '#C47B8B', '#4B9E9E', '#B87B4B',
  '#9E6B4B', '#6B9E9E', '#9E4B6B',
]

const BAR_COLORS = ['#4E9A7A', '#E8B84B', '#6B8CBA', '#D4756B', '#7B9E6B', '#C17BB8']

interface SpendingData {
  [month: string]: { [category: string]: { cards: number; debit: number } }
}

interface Transaction {
  id: number
  date: string
  description: string
  amount: number
  category: string
  account_id: number
  statement_month?: string
  _account_name?: string
  _is_card?: boolean
}

interface StatementSummaryItem {
  payment_due_date?: string | null
  charges?: number | null
}

type ChartRow = { category: string } & Record<string, string | number | null>

function chartNumber(value: string | number | null | undefined): number {
  return typeof value === 'number' ? value : Number(value || 0)
}

// ── Card Summary ─────────────────────────────────────────────────
function CardSummary({ accounts, selectedMonth }: { accounts: Account[]; selectedMonth: string }) {
  const [rows, setRows] = useState<{ name: string; amount: number }[]>([])

  useEffect(() => {
    if (!accounts.length || !selectedMonth) return
    async function load() {
      const cards = accounts.filter(a => a.account_type === 'CREDIT_CARD')
      const result: { name: string; amount: number }[] = []
      await Promise.all(cards.map(async card => {
        try {
          const res = await api.get(`/accounts/${card.id}/statement-summary`)
          let total = 0
          for (const d of Object.values(res.data as Record<string, StatementSummaryItem>)) {
            const due = (d.payment_due_date || '').slice(0, 7)
            if (due) {
              const [y, mo] = due.split('-').map(Number)
              const bm = new Date(y, mo - 2, 1)
              const bmStr = `${bm.getFullYear()}-${String(bm.getMonth() + 1).padStart(2, '0')}`
              if (bmStr === selectedMonth) total += d.charges || 0
            }
          }
          if (total > 0) result.push({ name: card.name, amount: Math.round(total * 100) / 100 })
        } catch (error) {
          console.error(`Failed to load statement summary for ${card.name}`, error)
        }
      }))
      setRows(result)
    }
    load()
  }, [accounts, selectedMonth])

  if (!rows.length) return null
  const total = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="border-t border-[#EDF4EE] pt-3 mt-4">
      <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest mb-2">💳 Card charges this month</p>
      {rows.map(r => (
        <div key={r.name} className="flex justify-between text-sm py-1">
          <span className="text-[#8BAE90]">↳ {r.name}</span>
          <span className="text-[#B85050] font-semibold">CAD$ {fmt(r.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between text-sm font-bold pt-2 border-t border-[#EDF4EE] mt-1">
        <span className="text-[#1B4D3E]">Total cards</span>
        <span className="text-[#B85050]">CAD$ {fmt(total)}</span>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────
export default function SpendingAnalysis() {
  const [data, setData] = useState<SpendingData>({})
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [nMonths, setNMonths] = useState(2)
  const [txCache, setTxCache] = useState<Record<number, Transaction[]>>({})
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [categoryTxs, setCategoryTxs] = useState<Transaction[]>([])
  const [loadingTxs, setLoadingTxs] = useState(false)
  const [editingTx, setEditingTx] = useState<number | null>(null)
  const [editCat, setEditCat] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [dataRes, accRes, catRes] = await Promise.all([
          api.get('/spending-analysis'),
          api.get('/accounts'),
          api.get('/categories'),
        ])
        setData(dataRes.data)
        setAccounts(accRes.data)
        setCategories((catRes.data as Category[]).map(c => c.name).sort())
        const months = Object.keys(dataRes.data).sort().reverse()
        if (months.length > 0) setSelectedMonth(months[0])
        setNMonths(Math.min(2, months.length))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const allMonths = Object.keys(data).sort()
  const months = [...allMonths].reverse()
  const monthData = data[selectedMonth] || {}

  const pieData = Object.entries(monthData)
    .map(([cat, vals]) => ({ name: cat, value: Math.round((vals.cards + vals.debit) * 100) / 100 }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const grandTotal = pieData.reduce((s, d) => s + d.value, 0)

  // Bar chart
  const monthsToShow = allMonths.slice(-nMonths)
  const allCatsBar = Array.from(new Set(monthsToShow.flatMap(m => Object.keys(data[m] || {})))).sort()
  const barData = allCatsBar.map(cat => {
    const row: ChartRow = { category: cat }
    for (const m of monthsToShow) {
      const vals = data[m]?.[cat]
      const total = vals ? Math.round((vals.cards + vals.debit) * 100) / 100 : 0
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

  // Breakdown table
  const allCatsTable = Array.from(new Set(allMonths.flatMap(m => Object.keys(data[m] || {})))).sort()
  const tableRows = allCatsTable.map(cat => {
    const row: ChartRow = { category: cat }
    let catTotal = 0
    for (const m of allMonths) {
      const vals = data[m]?.[cat]
      const total = vals ? Math.round((vals.cards + vals.debit) * 100) / 100 : 0
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
      return s + (vals ? vals.cards + vals.debit : 0)
    }, 0)
    tableTotals[m] = Math.round(mTotal * 100) / 100
    tableTotals.total = Number(tableTotals.total || 0) + mTotal
  }
  tableTotals.total = Math.round(chartNumber(tableTotals.total) * 100) / 100

  // Transactions
  async function loadTxsForCategory(category: string) {
    const EXCLUDED = ['Salary', 'Other Income', 'Transfer']
    if (EXCLUDED.includes(category)) { setCategoryTxs([]); return }
    setLoadingTxs(true)
    const cache = { ...txCache }
    await Promise.all(accounts.map(async acc => {
      if (cache[acc.id]) return
      try {
        const res = await api.get(`/accounts/${acc.id}/transactions`)
        cache[acc.id] = res.data
      } catch (error) {
        console.error(`Failed to load transactions for ${acc.name}`, error)
        cache[acc.id] = []
      }
    }))
    setTxCache(cache)
    const results: Transaction[] = []
    for (const acc of accounts) {
      const txs = cache[acc.id] || []
      const isCard = acc.account_type === 'CREDIT_CARD'
      for (const t of txs) {
        if (t.amount >= 0) continue
        if ((t.category || 'Other') !== category) continue
        if (isCard && t.statement_month === selectedMonth)
          results.push({ ...t, _account_name: acc.name, _is_card: true })
        else if (!isCard && t.date?.slice(0, 7) === selectedMonth)
          results.push({ ...t, _account_name: acc.name, _is_card: false })
      }
    }
    results.sort((a, b) => b.date.localeCompare(a.date))
    setCategoryTxs(results)
    setLoadingTxs(false)
  }

  function toggleCategory(cat: string) {
    if (openCategory === cat) { setOpenCategory(null); setCategoryTxs([]) }
    else { setOpenCategory(cat); setEditingTx(null); loadTxsForCategory(cat) }
  }

  async function saveCategory(txId: number, newCat: string) {
    try {
      await api.patch(`/transactions/${txId}`, { category: newCat })
      const tx = categoryTxs.find(t => t.id === txId)
      if (tx) setTxCache(prev => { const n = { ...prev }; delete n[tx.account_id]; return n })
      setEditingTx(null)
      if (openCategory) loadTxsForCategory(openCategory)
    } catch (error) {
      console.error(`Failed to update transaction ${txId}`, error)
    }
  }

  function refresh() { setTxCache({}); setCategoryTxs([]); setOpenCategory(null) }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="w-full max-w-7xl mx-auto px-6">

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1B4D3E]">📈 Spending Analysis</h1>
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
          <select
            value={selectedMonth}
            onChange={e => { setSelectedMonth(e.target.value); setOpenCategory(null) }}
            className="mb-6 px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
          >
            {months.map(m => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>

          {pieData.length === 0 ? (
            <div className="text-center text-[#8BAE90] py-10">No expenses for this month.</div>
          ) : (
            <>
              {/* ── Donut + Categories ── */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-10">

                {/* Left: donut */}
                <div className="bg-white rounded-xl border border-[#D4E4D5] p-6">
                  <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest mb-2">
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
                        formatter={(value, name) => [formatChartValue(value), String(name)]}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #D4E4D5', fontSize: '13px', backgroundColor: 'white' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <p className="text-center text-sm text-[#8BAE90] mt-1">
                    Total: <span className="font-bold text-[#1B4D3E]">CAD$ {fmt(grandTotal)}</span>
                  </p>
                  <CardSummary accounts={accounts} selectedMonth={selectedMonth} />
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
                            <span className="text-xs font-bold text-[#B85050]">$ {fmt(d.value)}</span>
                            {isOpen ? <ChevronUp size={12} className="text-[#8BAE90]" /> : <ChevronDown size={12} className="text-[#8BAE90]" />}
                          </div>
                        </button>

                        {/* Transactions — only shown when open */}
                        {isOpen && (
                          <div className="border-t border-[#EDF4EE] col-span-full">
                            {loadingTxs ? (
                              <p className="px-4 py-3 text-sm text-[#8BAE90]">Loading...</p>
                            ) : categoryTxs.length === 0 ? (
                              <p className="px-4 py-3 text-sm text-[#8BAE90]">No transactions found.</p>
                            ) : (
                              <>
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
                                          <span className="text-xs text-[#8BAE90] shrink-0">{t._is_card ? '💳' : '🏦'}</span>
                                        </div>
                                        <span className="text-sm font-semibold text-[#B85050] shrink-0">$ {fmt(amt)}</span>
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
                                <div className="px-4 py-2 bg-[#F4FAF5] flex justify-between text-xs font-semibold">
                                  <span className="text-[#1B4D3E]">{categoryTxs.length} transactions</span>
                                  <span className="text-[#B85050]">CAD$ {fmt(categoryTxs.reduce((s, t) => s + Math.abs(t.amount), 0))}</span>
                                </div>
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
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">📊 Category Trends</p>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[#8BAE90]">Months:</span>
                    <input
                      type="range" min={1} max={allMonths.length} value={nMonths}
                      onChange={e => setNMonths(Number(e.target.value))}
                      className="w-28 accent-[#1B4D3E]"
                    />
                    <span className="text-xs font-bold text-[#1B4D3E] w-4">{nMonths}</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={barData} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EDF4EE" />
                    <XAxis dataKey="category" angle={-35} textAnchor="end" tick={{ fontSize: 11, fill: '#8BAE90' }} interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: '#8BAE90' }} tickFormatter={v => `$${v}`} />
                    <Tooltip
                      formatter={(value, name) => [formatChartValue(value), String(name)]}
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
                <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest mb-4">📋 Category Breakdown by Month</p>
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
                              {chartNumber(row[m]) ? `$ ${fmt(chartNumber(row[m]))}` : '—'}
                            </td>
                          ))}
                          <td className="text-right py-2 px-3 font-semibold text-[#1B4D3E]">$ {fmt(chartNumber(row.total))}</td>
                        </tr>
                      ))}
                      <tr className="bg-[#1B4D3E] text-white font-bold">
                        <td className="py-3 px-3 rounded-bl-lg">💰 TOTAL</td>
                        {allMonths.map(m => (
                          <td key={m} className="text-right py-3 px-3">$ {fmt(chartNumber(tableTotals[m]))}</td>
                        ))}
                        <td className="text-right py-3 px-3 text-[#E8C84A] rounded-br-lg">$ {fmt(chartNumber(tableTotals.total))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-[#8BAE90] mt-3">Grand total: CAD$ {fmt(tableTotals.total)}</p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
