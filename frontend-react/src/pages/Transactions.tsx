import { useState, useEffect } from 'react'
import { Save } from 'lucide-react'
import api from '../services/api'
import type { Account, Category } from '../services/api'

function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function monthLabel(m: string): string {
  const [year, month] = m.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

interface Transaction {
  id: number
  date: string
  description: string
  amount: number
  currency: string
  category: string
  statement_month?: string
  account_id: number
}

export default function Transactions() {
  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedAccId, setSelectedAccId] = useState<number | null>(null)
  const [monthFilter, setMonthFilter] = useState(currentMonth)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [editedCats, setEditedCats] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    async function load() {
      const [accRes, catRes] = await Promise.all([
        api.get('/accounts'),
        api.get('/categories'),
      ])
      setAccounts(accRes.data)
      setCategories((catRes.data as Category[]).map(c => c.name).sort())
      if (accRes.data.length > 0) setSelectedAccId(accRes.data[0].id)
    }
    load()
  }, [])

  const selectedAcc = accounts.find(a => a.id === selectedAccId)
  const isCard = selectedAcc?.account_type === 'CREDIT_CARD'

  // Grouped accounts for the selector
  const debitAccounts = accounts.filter(a => a.account_type !== 'CREDIT_CARD')
  const cardAccounts = accounts.filter(a => a.account_type === 'CREDIT_CARD')

  useEffect(() => {
    if (!selectedAccId) return
    async function loadTxs() {
      setLoading(true)
      setEditedCats({})
      try {
        const res = await api.get(`/accounts/${selectedAccId}/transactions`)
        let data: Transaction[] = res.data

        if (isCard && monthFilter) {
          data = data.filter(t => t.statement_month === monthFilter)
          // For cards: only show charges (negative), hide payments
          data = data.filter(t => t.amount < 0)
        } else if (!isCard && monthFilter) {
          data = data.filter(t => t.date?.slice(0, 7) === monthFilter)
        }

        data.sort((a, b) => b.date.localeCompare(a.date))
        setTxs(data)
      } finally {
        setLoading(false)
      }
    }
    loadTxs()
  }, [selectedAccId, monthFilter, isCard])

  async function saveChanges() {
    const toUpdate = Object.entries(editedCats)
    if (toUpdate.length === 0) return
    setSaving(true)
    let updated = 0
    for (const [id, category] of toUpdate) {
      try {
        await api.patch(`/transactions/${id}`, { category })
        updated++
      } catch (error) {
        console.error(`Failed to update transaction ${id}`, error)
      }
    }
    setSaving(false)
    setEditedCats({})
    setSaveMsg(`✅ ${updated} transaction${updated !== 1 ? 's' : ''} updated!`)
    setTimeout(() => setSaveMsg(''), 3000)
    // Refresh
    const res = await api.get(`/accounts/${selectedAccId}/transactions`)
    let data: Transaction[] = res.data
    if (isCard && monthFilter) {
      data = data.filter(t => t.statement_month === monthFilter && t.amount < 0)
    } else if (!isCard && monthFilter) {
      data = data.filter(t => t.date?.slice(0, 7) === monthFilter)
    }
    data.sort((a, b) => b.date.localeCompare(a.date))
    setTxs(data)
  }

  const totalExpenses = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const totalIncome = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const pendingChanges = Object.keys(editedCats).length

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <h1 className="text-2xl font-bold text-[#1B4D3E] mb-6">💸 Transactions</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Account</label>
          <select
            value={selectedAccId ?? ''}
            onChange={e => setSelectedAccId(Number(e.target.value))}
            className="px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none min-w-[240px]"
          >
            {debitAccounts.length > 0 && (
              <optgroup label="🏦 Bank Accounts">
                {debitAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.bank})</option>
                ))}
              </optgroup>
            )}
            {cardAccounts.length > 0 && (
              <optgroup label="💳 Credit Cards">
                {cardAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.bank})</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">
            {isCard ? 'Statement Month' : 'Month'}
          </label>
          <input
            type="month"
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            className="px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
          />
        </div>
      </div>

      {/* Summary cards */}
      {txs.length > 0 && (
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="bg-white rounded-xl border border-[#D4E4D5] px-5 py-3 min-w-[120px]">
            <p className="text-xs text-[#8BAE90] mb-1">Transactions</p>
            <p className="text-2xl font-bold text-[#1B4D3E]">{txs.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#D4E4D5] px-5 py-3 min-w-[180px]">
            <p className="text-xs text-[#8BAE90] mb-1">{isCard ? 'Total Charges' : 'Total Spent'}</p>
            <p className="text-2xl font-bold text-[#B85050]">CAD$ {fmt(totalExpenses)}</p>
          </div>
          {!isCard && totalIncome > 0 && (
            <div className="bg-white rounded-xl border border-[#D4E4D5] px-5 py-3 min-w-[180px]">
              <p className="text-xs text-[#8BAE90] mb-1">Total Received</p>
              <p className="text-2xl font-bold text-[#1B6B3A]">CAD$ {fmt(totalIncome)}</p>
            </div>
          )}
          {pendingChanges > 0 && (
            <div className="bg-[#FDF6E3] rounded-xl border border-[#C9A84C] px-5 py-3 flex items-center gap-4">
              <div>
                <p className="text-xs text-[#8B6914] mb-1">Unsaved changes</p>
                <p className="text-2xl font-bold text-[#7A5C0A]">{pendingChanges}</p>
              </div>
              <button
                onClick={saveChanges}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#1B4D3E] text-white text-sm font-semibold rounded-lg hover:bg-[#2D6A4F] transition disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save All'}
              </button>
            </div>
          )}
        </div>
      )}

      {saveMsg && (
        <div className="mb-4 px-4 py-2 bg-[#F4FAF5] border border-[#D4E4D5] rounded-lg text-sm text-[#1B6B3A] font-semibold">
          {saveMsg}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center text-[#8BAE90] py-20">Loading...</div>
      ) : txs.length === 0 ? (
        <div className="text-center text-[#8BAE90] py-20">
          No transactions found for {monthLabel(monthFilter)}.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#D4E4D5] overflow-hidden">
          {/* Header */}
          <div className="grid text-xs font-semibold text-[#8BAE90] uppercase tracking-widest px-4 py-3 border-b-2 border-[#D4E4D5] bg-[#F9FCF9]"
            style={{ gridTemplateColumns: isCard ? '90px 1fr 130px 160px 100px' : '90px 1fr 130px 160px' }}
          >
            <span>Date</span>
            <span>Description</span>
            <span className="text-right">Amount</span>
            <span className="pl-2">Category</span>
            {isCard && <span className="pl-2">Statement</span>}
          </div>

          {/* Rows */}
          {txs.map((t, idx) => {
            const [y, mo, dy] = t.date.slice(0, 10).split('-').map(Number)
            const dateStr = new Date(y, mo - 1, dy).toLocaleDateString('en', { month: 'short', day: 'numeric' })
            const currentCat = editedCats[t.id] ?? t.category ?? 'Other'
            const isEdited = editedCats[t.id] !== undefined && editedCats[t.id] !== t.category

            return (
              <div
                key={t.id}
                className={`grid px-4 py-2.5 border-b border-[#EDF4EE] last:border-0 items-center ${idx % 2 === 0 ? 'bg-white' : 'bg-[#F9FCF9]'}`}
                style={{ gridTemplateColumns: isCard ? '90px 1fr 130px 160px 100px' : '90px 1fr 130px 160px' }}
              >
                <span className="text-[#8BAE90] text-xs">{dateStr}</span>

                <span className="text-[#2C3E2D] text-sm truncate pr-4">{t.description}</span>

                <span className={`text-right text-sm font-semibold tabular-nums ${t.amount < 0 ? 'text-[#B85050]' : 'text-[#1B6B3A]'}`}>
                  {t.amount < 0 ? '-' : '+'} $ {fmt(Math.abs(t.amount))}
                </span>

                <div className="pl-2">
                  <select
                    value={currentCat}
                    onChange={e => setEditedCats(prev => ({ ...prev, [t.id]: e.target.value }))}
                    className={`text-xs px-2 py-1.5 rounded-lg border focus:outline-none w-full ${
                      isEdited
                        ? 'border-[#C9A84C] bg-[#FDF6E3] text-[#7A5C0A] font-semibold'
                        : 'border-[#D4E4D5] bg-transparent text-[#2C3E2D]'
                    }`}
                  >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {isCard && (
                  <span className="pl-2 text-xs text-[#8BAE90]">{t.statement_month || '—'}</span>
                )}
              </div>
            )
          })}

          {/* Footer */}
          <div className="px-4 py-3 bg-[#F4FAF5] flex items-center justify-between border-t-2 border-[#D4E4D5]">
            <span className="text-sm text-[#8BAE90]">{txs.length} transactions</span>
            {pendingChanges > 0 ? (
              <button
                onClick={saveChanges}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#1B4D3E] text-white text-sm font-semibold rounded-lg hover:bg-[#2D6A4F] transition disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? 'Saving...' : `Save ${pendingChanges} change${pendingChanges !== 1 ? 's' : ''}`}
              </button>
            ) : (
              <span className="text-sm font-semibold text-[#1B4D3E]">
                {isCard ? `Charges: CAD$ ${fmt(totalExpenses)}` : `Spent: CAD$ ${fmt(totalExpenses)}`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
