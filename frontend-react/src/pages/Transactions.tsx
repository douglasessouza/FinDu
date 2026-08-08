import { useState, useEffect, useMemo, useCallback } from 'react'
import { ArrowDownUp, Plus, Save, Split, Trash2, X } from 'lucide-react'
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
  payment_due_date?: string
  account_id: number
}

type SortKey = 'date' | 'description' | 'amount' | 'category' | 'statement'
type SortDirection = 'asc' | 'desc'

interface SplitRow {
  description: string
  category: string
  amount: string
}

interface NewTransactionDraft {
  date: string
  description: string
  amount: string
  category: string
  statement: string
}

export default function Transactions() {
  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const todayStr = today.toISOString().slice(0, 10)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedAccId, setSelectedAccId] = useState<number | null>(null)
  const [monthFilter, setMonthFilter] = useState(currentMonth)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [editedDates, setEditedDates] = useState<Record<number, string>>({})
  const [editedCats, setEditedCats] = useState<Record<number, string>>({})
  const [editedStatements, setEditedStatements] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [splitTx, setSplitTx] = useState<Transaction | null>(null)
  const [splitRows, setSplitRows] = useState<SplitRow[]>([])
  const [splitError, setSplitError] = useState('')
  const [splitting, setSplitting] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [newTx, setNewTx] = useState<NewTransactionDraft>({
    date: todayStr,
    description: '',
    amount: '',
    category: 'Other',
    statement: currentMonth,
  })

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

  const loadTxs = useCallback(async () => {
    if (!selectedAccId) return
    setLoading(true)
    setEditedDates({})
    setEditedCats({})
    setEditedStatements({})
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

      setTxs(data)
    } finally {
      setLoading(false)
    }
  }, [isCard, monthFilter, selectedAccId])

  useEffect(() => {
    if (!selectedAccId) return
    queueMicrotask(() => {
      setNewTx(prev => ({
        ...prev,
        category: categories.includes(prev.category) ? prev.category : categories[0] || 'Other',
        statement: monthFilter || prev.statement,
      }))
      void loadTxs()
    })
  }, [categories, loadTxs, monthFilter, selectedAccId])

  function dueDateForStatement(statementMonth: string): string | null {
    if (!selectedAcc?.due_day || !statementMonth) return null
    const [year, month] = statementMonth.split('-').map(Number)
    const dueDate = new Date(year, month, selectedAcc.due_day)
    return [
      dueDate.getFullYear(),
      String(dueDate.getMonth() + 1).padStart(2, '0'),
      String(dueDate.getDate()).padStart(2, '0'),
    ].join('-')
  }

  async function addTransaction() {
    if (!selectedAccId || !selectedAcc) return

    const amount = Number(newTx.amount)
    if (!newTx.date || !newTx.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setAddError('Fill date, description, and a positive amount.')
      return
    }

    setAdding(true)
    setAddError('')
    setSaveMsg('')
    try {
      const res = await api.post('/transactions', {
        account_id: selectedAccId,
        description: newTx.description.trim(),
        amount: isCard ? -Math.round(amount * 100) / 100 : Math.round(amount * 100) / 100,
        currency: selectedAcc.currency || 'CAD',
        date: `${newTx.date}T12:00:00`,
        category: newTx.category || 'Other',
      })

      if (isCard && newTx.statement) {
        const dueDate = dueDateForStatement(newTx.statement)
        await api.patch(`/transactions/${res.data.id}`, {
          statement_month: newTx.statement,
          ...(dueDate ? { payment_due_date: dueDate } : {}),
        })
      }

      setNewTx({
        date: todayStr,
        description: '',
        amount: '',
        category: categories[0] || 'Other',
        statement: monthFilter || currentMonth,
      })
      setShowAddForm(false)
      setSaveMsg('✅ Transaction added.')
      setTimeout(() => setSaveMsg(''), 3000)
      await loadTxs()
    } catch (error) {
      console.error('Failed to add transaction', error)
      setAddError('Could not add transaction.')
    } finally {
      setAdding(false)
    }
  }

  async function saveChanges() {
    const ids = new Set([
      ...Object.keys(editedDates),
      ...Object.keys(editedCats),
      ...Object.keys(editedStatements),
    ])
    if (ids.size === 0) return
    setSaving(true)
    let updated = 0
    for (const id of ids) {
      try {
        const changes: Record<string, string> = {}
        if (editedDates[Number(id)] !== undefined) {
          changes.date = `${editedDates[Number(id)]}T12:00:00`
        }
        if (editedCats[Number(id)] !== undefined) {
          changes.category = editedCats[Number(id)]
        }
        if (editedStatements[Number(id)] !== undefined) {
          const statementMonth = editedStatements[Number(id)]
          changes.statement_month = statementMonth
          const dueDate = dueDateForStatement(statementMonth)
          if (dueDate) changes.payment_due_date = dueDate
        }
        await api.patch(`/transactions/${id}`, changes)
        updated++
      } catch (error) {
        console.error(`Failed to update transaction ${id}`, error)
      }
    }
    setSaving(false)
    setEditedDates({})
    setEditedCats({})
    setEditedStatements({})
    setSaveMsg(`✅ ${updated} transaction${updated !== 1 ? 's' : ''} updated!`)
    setTimeout(() => setSaveMsg(''), 3000)
    await loadTxs()
  }

  async function deleteTransaction(tx: Transaction) {
    const confirmed = window.confirm(`Delete this transaction?\n\n${tx.description}\n$ ${fmt(Math.abs(tx.amount))}`)
    if (!confirmed) return

    setDeletingId(tx.id)
    setSaveMsg('')
    try {
      await api.delete(`/transactions/${tx.id}`)
      setTxs(prev => prev.filter(existing => existing.id !== tx.id))
      setEditedDates(prev => {
        const next = { ...prev }
        delete next[tx.id]
        return next
      })
      setEditedCats(prev => {
        const next = { ...prev }
        delete next[tx.id]
        return next
      })
      setEditedStatements(prev => {
        const next = { ...prev }
        delete next[tx.id]
        return next
      })
      setSaveMsg('✅ Transaction deleted.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (error) {
      console.error(`Failed to delete transaction ${tx.id}`, error)
      setSaveMsg('Could not delete transaction.')
    } finally {
      setDeletingId(null)
    }
  }

  function changeSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(key)
    setSortDirection(key === 'date' ? 'desc' : 'asc')
  }

  function startSplit(tx: Transaction) {
    setSplitTx(tx)
    setSplitError('')
    setSplitRows([
      {
        description: tx.description,
        category: editedCats[tx.id] ?? tx.category ?? 'Other',
        amount: fmt(Math.abs(tx.amount)).replace(/,/g, ''),
      },
      {
        description: tx.description,
        category: editedCats[tx.id] ?? tx.category ?? 'Other',
        amount: '0.00',
      },
    ])
  }

  function updateSplitRow(index: number, update: Partial<SplitRow>) {
    setSplitRows(prev => prev.map((row, currentIndex) => currentIndex === index ? { ...row, ...update } : row))
  }

  function addSplitRow() {
    setSplitRows(prev => [
      ...prev,
      {
        description: splitTx?.description || '',
        category: splitTx?.category || 'Other',
        amount: '0.00',
      },
    ])
  }

  function removeSplitRow(index: number) {
    setSplitRows(prev => prev.length <= 2 ? prev : prev.filter((_, currentIndex) => currentIndex !== index))
  }

  function cancelSplit() {
    setSplitTx(null)
    setSplitRows([])
    setSplitError('')
  }

  async function saveSplit() {
    if (!splitTx) return

    const originalCents = Math.round(Math.abs(splitTx.amount) * 100)
    const rows = splitRows
      .map(row => ({
        description: row.description.trim(),
        category: row.category || 'Other',
        amountCents: Math.round(Number(row.amount || 0) * 100),
      }))
      .filter(row => row.description && row.amountCents > 0)

    if (rows.length < 2) {
      setSplitError('Add at least two split rows with descriptions and amounts.')
      return
    }

    const splitCents = rows.reduce((sum, row) => sum + row.amountCents, 0)
    if (splitCents !== originalCents) {
      setSplitError(`Split total must equal $ ${fmt(Math.abs(splitTx.amount))}. Remaining: $ ${fmt(Math.abs(originalCents - splitCents) / 100)}.`)
      return
    }

    setSplitting(true)
    try {
      await api.post(`/transactions/${splitTx.id}/split`, {
        lines: rows.map(row => ({
          description: row.description,
          category: row.category,
          amount: row.amountCents / 100,
        })),
      })
      cancelSplit()
      await loadTxs()
      setSaveMsg('✅ Transaction split saved.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (error) {
      console.error(`Failed to split transaction ${splitTx.id}`, error)
      setSplitError('Could not save split.')
    } finally {
      setSplitting(false)
    }
  }

  const sortedTxs = useMemo(() => {
    function sortValue(tx: Transaction, key: SortKey): string | number {
      if (key === 'date') return editedDates[tx.id] ?? (tx.date || '')
      if (key === 'description') return tx.description || ''
      if (key === 'amount') return tx.amount
      if (key === 'category') return editedCats[tx.id] ?? tx.category ?? 'Other'
      return tx.statement_month || ''
    }

    return [...txs].sort((a, b) => {
      const aValue = sortValue(a, sortKey)
      const bValue = sortValue(b, sortKey)
      const direction = sortDirection === 'asc' ? 1 : -1

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * direction
      }

      return String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' }) * direction
    })
  }, [editedCats, editedDates, sortDirection, sortKey, txs])

  const totalExpenses = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const totalIncome = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const pendingChanges = new Set([
    ...Object.keys(editedDates),
    ...Object.keys(editedCats),
    ...Object.keys(editedStatements),
  ]).size
  const sortLabel = {
    date: 'Date',
    description: 'Description',
    amount: 'Amount',
    category: 'Category',
    statement: 'Statement',
  }[sortKey]
  const splitTotal = splitRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  const splitRemaining = splitTx ? Math.abs(splitTx.amount) - splitTotal : 0

  function renderSortButton(label: string, value: SortKey, align: 'left' | 'right' = 'left') {
    const active = sortKey === value
    return (
      <button
        type="button"
        onClick={() => changeSort(value)}
        className={`flex items-center gap-1 ${align === 'right' ? 'justify-end text-right' : ''} ${active ? 'text-[#1B4D3E]' : 'text-[#8BAE90]'}`}
      >
        <span>{label}</span>
        <ArrowDownUp size={12} className={active ? 'opacity-100' : 'opacity-45'} />
      </button>
    )
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-[#1B4D3E]">💸 Transactions</h1>
        <button
          type="button"
          onClick={() => setShowAddForm(show => !show)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B4D3E] text-white text-sm font-semibold hover:bg-[#2D6A4F] transition"
        >
          {showAddForm ? <X size={16} /> : <Plus size={16} />}
          {showAddForm ? 'Cancel' : 'Add transaction'}
        </button>
      </div>

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

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Sort</label>
          <div className="flex gap-2">
            <select
              value={sortKey}
              onChange={e => {
                const nextKey = e.target.value as SortKey
                setSortKey(nextKey)
                setSortDirection(nextKey === 'date' ? 'desc' : 'asc')
              }}
              className="px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
            >
              <option value="date">Date</option>
              <option value="description">Description</option>
              <option value="amount">Amount</option>
              <option value="category">Category</option>
              {isCard && <option value="statement">Statement</option>}
            </select>
            <button
              type="button"
              onClick={() => setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc')}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold hover:bg-[#F4FAF5] transition"
              title="Toggle sort direction"
            >
              <ArrowDownUp size={14} />
              {sortDirection === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className="mb-6 bg-white rounded-xl border border-[#D4E4D5] p-4">
          <div className="grid gap-3 items-end" style={{ gridTemplateColumns: isCard ? '150px 1fr 120px 160px 130px auto' : '150px 1fr 120px 160px auto' }}>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Date</label>
              <input
                type="date"
                value={newTx.date}
                onChange={e => setNewTx(prev => ({ ...prev, date: e.target.value }))}
                className="px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Description</label>
              <input
                type="text"
                value={newTx.description}
                onChange={e => setNewTx(prev => ({ ...prev, description: e.target.value }))}
                className="px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm focus:outline-none"
                placeholder="Merchant or note"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newTx.amount}
                onChange={e => setNewTx(prev => ({ ...prev, amount: e.target.value }))}
                className="px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm focus:outline-none"
                placeholder="0.00"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Category</label>
              <select
                value={newTx.category}
                onChange={e => setNewTx(prev => ({ ...prev, category: e.target.value }))}
                className="px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm focus:outline-none"
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {isCard && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Statement</label>
                <input
                  type="month"
                  value={newTx.statement}
                  onChange={e => setNewTx(prev => ({ ...prev, statement: e.target.value }))}
                  className="px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm focus:outline-none"
                />
              </div>
            )}
            <button
              type="button"
              onClick={addTransaction}
              disabled={adding}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#1B4D3E] text-white text-sm font-semibold hover:bg-[#2D6A4F] transition disabled:opacity-50"
            >
              <Plus size={14} />
              {adding ? 'Adding...' : 'Add'}
            </button>
          </div>
          {addError && <p className="mt-3 text-sm font-semibold text-[#B85050]">{addError}</p>}
        </div>
      )}

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
          <div className="grid text-xs font-semibold uppercase tracking-widest px-4 py-3 border-b-2 border-[#D4E4D5] bg-[#F9FCF9]"
            style={{ gridTemplateColumns: isCard ? '130px 1fr 130px 160px 100px 92px' : '130px 1fr 130px 160px 92px' }}
          >
            {renderSortButton('Date', 'date')}
            {renderSortButton('Description', 'description')}
            {renderSortButton('Amount', 'amount', 'right')}
            <span className="pl-2">{renderSortButton('Category', 'category')}</span>
            {isCard && <span className="pl-2">{renderSortButton('Statement', 'statement')}</span>}
            <span className="text-right">Actions</span>
          </div>

          {/* Rows */}
          {sortedTxs.map((t, idx) => {
            const currentDate = editedDates[t.id] ?? t.date.slice(0, 10)
            const isDateEdited = editedDates[t.id] !== undefined && editedDates[t.id] !== t.date.slice(0, 10)
            const currentCat = editedCats[t.id] ?? t.category ?? 'Other'
            const isEdited = editedCats[t.id] !== undefined && editedCats[t.id] !== t.category
            const currentStatement = editedStatements[t.id] ?? t.statement_month ?? ''
            const isStatementEdited = editedStatements[t.id] !== undefined && editedStatements[t.id] !== t.statement_month

            return (
              <div
                key={t.id}
                className={`grid px-4 py-2.5 border-b border-[#EDF4EE] last:border-0 items-center ${idx % 2 === 0 ? 'bg-white' : 'bg-[#F9FCF9]'}`}
                style={{ gridTemplateColumns: isCard ? '130px 1fr 130px 160px 100px 92px' : '130px 1fr 130px 160px 92px' }}
              >
                <input
                  type="date"
                  value={currentDate}
                  onChange={e => setEditedDates(prev => ({ ...prev, [t.id]: e.target.value }))}
                  className={`w-full text-xs px-2 py-1.5 rounded-lg border focus:outline-none ${
                    isDateEdited
                      ? 'border-[#C9A84C] bg-[#FDF6E3] text-[#7A5C0A] font-semibold'
                      : 'border-[#D4E4D5] bg-transparent text-[#2C3E2D]'
                  }`}
                />

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
                  <div className="pl-2">
                    <input
                      type="month"
                      value={currentStatement}
                      onChange={e => setEditedStatements(prev => ({ ...prev, [t.id]: e.target.value }))}
                      className={`w-full text-xs px-2 py-1.5 rounded-lg border focus:outline-none ${
                        isStatementEdited
                          ? 'border-[#C9A84C] bg-[#FDF6E3] text-[#7A5C0A] font-semibold'
                          : 'border-[#D4E4D5] bg-transparent text-[#2C3E2D]'
                      }`}
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => startSplit(t)}
                    disabled={deletingId === t.id || saving}
                    className="p-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] hover:bg-[#F4FAF5] transition disabled:opacity-50"
                    title="Split transaction"
                  >
                    <Split size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTransaction(t)}
                    disabled={deletingId === t.id || saving}
                    className="p-2 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-50"
                    title="Delete transaction"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}

          {/* Footer */}
          <div className="px-4 py-3 bg-[#F4FAF5] flex items-center justify-between border-t-2 border-[#D4E4D5]">
            <span className="text-sm text-[#8BAE90]">
              {txs.length} transactions · sorted by {sortLabel} {sortDirection === 'asc' ? 'ascending' : 'descending'}
            </span>
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

      {splitTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F18]/45 px-4">
          <div className="w-full max-w-2xl rounded-lg border border-[#D4E4D5] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#EDF4EE] px-5 py-4">
              <div>
                <p className="text-lg font-bold text-[#1B4D3E]">Split Transaction</p>
                <p className="mt-1 text-sm text-[#7BAE8A]">
                  {splitTx.description} · $ {fmt(Math.abs(splitTx.amount))}
                </p>
              </div>
              <button
                type="button"
                onClick={cancelSplit}
                className="rounded-lg p-2 text-[#8BAE90] hover:bg-[#F4FAF5] hover:text-[#1B4D3E] transition"
                title="Close split dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              <div className="mb-3 grid grid-cols-[1fr_150px_110px_34px] gap-2 text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">
                <span>Description</span>
                <span>Category</span>
                <span className="text-right">Amount</span>
                <span />
              </div>

              <div className="space-y-2">
                {splitRows.map((row, index) => (
                  <div key={index} className="grid grid-cols-[1fr_150px_110px_34px] gap-2">
                    <input
                      type="text"
                      value={row.description}
                      onChange={e => updateSplitRow(index, { description: e.target.value })}
                      className="w-full rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-sm font-semibold text-[#1B4D3E] focus:outline-none"
                    />
                    <select
                      value={row.category}
                      onChange={e => updateSplitRow(index, { category: e.target.value })}
                      className="w-full rounded-lg border border-[#D4E4D5] bg-white px-2 py-2 text-xs font-semibold text-[#1B4D3E] focus:outline-none"
                    >
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={row.amount}
                      onChange={e => updateSplitRow(index, { amount: e.target.value })}
                      className="w-full rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-right text-sm font-semibold tabular-nums text-[#1B4D3E] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeSplitRow(index)}
                      disabled={splitRows.length <= 2}
                      className="h-10 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-40"
                      title="Remove split row"
                    >
                      <Trash2 size={14} className="mx-auto" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addSplitRow}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#D4E4D5] py-2 text-sm font-semibold text-[#1B4D3E] hover:bg-[#F4FAF5] transition"
              >
                <Plus size={14} />
                Add Split Row
              </button>

              <div className="mt-4 rounded-lg border border-[#D4E4D5] bg-[#F9FCF9] px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-[#7BAE8A]">Split total</span>
                  <span className="font-bold tabular-nums text-[#1B4D3E]">$ {fmt(splitTotal)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-[#7BAE8A]">Remaining</span>
                  <span className={`font-bold tabular-nums ${Math.round(splitRemaining * 100) === 0 ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>
                    $ {fmt(Math.abs(splitRemaining))}
                  </span>
                </div>
              </div>

              {splitError && (
                <div className="mt-3 rounded-lg border border-[#B85050] bg-[#FDF5F5] px-4 py-2 text-sm text-[#B85050]">
                  {splitError}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelSplit}
                  className="rounded-lg border border-[#D4E4D5] px-5 py-3 text-sm font-semibold text-[#8BAE90] hover:text-[#1B4D3E] transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveSplit}
                  disabled={splitting}
                  className="rounded-lg bg-[#1B4D3E] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2D6A4F] transition disabled:opacity-50"
                >
                  {splitting ? 'Saving...' : 'Save Split'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
