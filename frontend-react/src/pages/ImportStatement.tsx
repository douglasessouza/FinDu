import { useState, useEffect } from 'react'
import { Upload, Trash2, Bot, CheckCircle, RefreshCw, Split, Plus, X } from 'lucide-react'
import api from '../services/api'
import type { Account, Category } from '../services/api'

function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface ImportBatch {
  import_batch_id: string
  account_id: number
  account_name: string
  transaction_count: number
  first_date: string
  last_date: string
  imported_at: string
}

interface ParsedTransaction {
  date: string
  description: string
  amount: number
  category?: string
  is_recurring?: boolean
  recurring_match?: string | null
}

interface SplitRow {
  description: string
  category: string
  amount: string
}

type Step = 'upload' | 'preview' | 'review' | 'balance' | 'done'

function errorDetail(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: string } } }).response
    return response?.data?.detail || fallback
  }
  return fallback
}

export default function ImportStatement() {
  const today = new Date()
  const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [imports, setImports] = useState<ImportBatch[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const [selectedAccId, setSelectedAccId] = useState<number | null>(null)
  const [fromDate, setFromDate] = useState(firstOfMonth)
  const [file, setFile] = useState<File | null>(null)

  const [step, setStep] = useState<Step>('upload')
  const [bank, setBank] = useState('')
  const [lastDate, setLastDate] = useState<string | null>(null)
  const [parsedTxs, setParsedTxs] = useState<ParsedTransaction[]>([])
  const [reviewedTxs, setReviewedTxs] = useState<ParsedTransaction[]>([])
  const [splitIndex, setSplitIndex] = useState<number | null>(null)
  const [splitRows, setSplitRows] = useState<SplitRow[]>([])
  const [splitError, setSplitError] = useState('')

  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  // Balance confirmation
  const [calculatedBalance, setCalculatedBalance] = useState<number | null>(null)
  const [confirmedBalance, setConfirmedBalance] = useState<number | null>(null)

  const selectedAcc = accounts.find(a => a.id === selectedAccId)
  const isCard = selectedAcc?.account_type === 'CREDIT_CARD'
  const debitAccounts = accounts.filter(a => a.account_type !== 'CREDIT_CARD')
  const cardAccounts = accounts.filter(a => a.account_type === 'CREDIT_CARD')

  useEffect(() => {
    async function load() {
      const [accRes, catRes, impRes] = await Promise.all([
        api.get('/accounts'),
        api.get('/categories'),
        api.get('/imports'),
      ])
      setAccounts(accRes.data)
      setCategories((catRes.data as Category[]).map(c => c.name).sort())
      setImports(impRes.data)
      if (accRes.data.length > 0) setSelectedAccId(accRes.data[0].id)
    }
    load()
  }, [])

  async function handleParse() {
    if (!file || !selectedAccId) return
    setError('')
    setLoading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('account_id', String(selectedAccId))
      form.append('from_date', fromDate)
      const res = await api.post('/parse-statement', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const { transactions, bank: detectedBank, last_date, account_id: matchedAccountId } = res.data
      if (matchedAccountId && matchedAccountId !== selectedAccId) {
        setSelectedAccId(matchedAccountId)
      }
      setBank(detectedBank)
      setLastDate(last_date)
      setParsedTxs(transactions)
      setStep('preview')
    } catch (e: unknown) {
      setError(errorDetail(e, 'Error parsing file.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleAnalyze() {
    if (!parsedTxs.length || !selectedAccId) return
    setAnalyzing(true)
    setError('')
    try {
      const form = new FormData()
      form.append('account_id', String(selectedAccId))
      form.append('transactions_json', JSON.stringify(parsedTxs))
      const res = await api.post('/analyze-statement', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setReviewedTxs(res.data.transactions)
      setStep('review')
    } catch (e: unknown) {
      setError(errorDetail(e, 'AI analysis failed.'))
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleImport() {
    if (!reviewedTxs.length || !selectedAccId) return
    setImporting(true)
    setError('')
    const batchId = crypto.randomUUID()
    for (const t of reviewedTxs) {
      try {
        await api.post('/transactions', {
          account_id: selectedAccId,
          description: t.description,
          amount: t.amount,
          currency: selectedAcc?.currency || 'CAD',
          date: `${t.date}T12:00:00`,
          category: t.category || 'Other',
          import_batch_id: batchId,
        })
      } catch (e) {
        console.error('Failed to import transaction', e)
      }
    }

    // For debit accounts: calculate new balance
    if (!isCard && selectedAcc) {
      const net = reviewedTxs.reduce((s, t) => s + t.amount, 0)
      const newBal = Math.round((selectedAcc.balance + net) * 100) / 100
      setCalculatedBalance(newBal)
      setConfirmedBalance(newBal)
      setStep('balance')
    } else {
      setStep('done')
    }

    // Refresh imports list
    const impRes = await api.get('/imports')
    setImports(impRes.data)
    setImporting(false)
  }

  function startSplit(index: number) {
    const tx = reviewedTxs[index]
    setSplitIndex(index)
    setSplitError('')
    setSplitRows([
      {
        description: tx.description,
        category: tx.category || 'Other',
        amount: fmt(Math.abs(tx.amount)).replace(/,/g, ''),
      },
      {
        description: tx.description,
        category: tx.category || 'Other',
        amount: '0.00',
      },
    ])
  }

  function updateSplitRow(index: number, update: Partial<SplitRow>) {
    setSplitRows(prev => prev.map((row, currentIndex) => currentIndex === index ? { ...row, ...update } : row))
  }

  function addSplitRow() {
    const source = splitIndex !== null ? reviewedTxs[splitIndex] : null
    setSplitRows(prev => [
      ...prev,
      {
        description: source?.description || '',
        category: source?.category || 'Other',
        amount: '0.00',
      },
    ])
  }

  function removeSplitRow(index: number) {
    setSplitRows(prev => prev.length <= 2 ? prev : prev.filter((_, currentIndex) => currentIndex !== index))
  }

  function cancelSplit() {
    setSplitIndex(null)
    setSplitRows([])
    setSplitError('')
  }

  function saveSplit() {
    if (splitIndex === null) return

    const original = reviewedTxs[splitIndex]
    const sign = original.amount < 0 ? -1 : 1
    const originalCents = Math.round(Math.abs(original.amount) * 100)
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
      setSplitError(`Split total must equal $ ${fmt(Math.abs(original.amount))}. Remaining: $ ${fmt(Math.abs(originalCents - splitCents) / 100)}.`)
      return
    }

    const splitTransactions: ParsedTransaction[] = rows.map(row => ({
      ...original,
      description: row.description,
      category: row.category,
      amount: sign * (row.amountCents / 100),
      is_recurring: false,
      recurring_match: null,
    }))

    setReviewedTxs(prev => [
      ...prev.slice(0, splitIndex),
      ...splitTransactions,
      ...prev.slice(splitIndex + 1),
    ])
    cancelSplit()
  }

  async function handleConfirmBalance() {
    if (confirmedBalance === null || !selectedAccId) return
    await api.patch(`/accounts/${selectedAccId}`, { balance: confirmedBalance })
    setStep('done')
  }

  function reset() {
    setStep('upload')
    setFile(null)
    setBank('')
    setLastDate(null)
    setParsedTxs([])
    setReviewedTxs([])
    setError('')
    setCalculatedBalance(null)
    setConfirmedBalance(null)
  }

  async function deleteImport(batchId: string) {
    const confirmed = window.confirm('Delete this import batch and all of its transactions? This cannot be undone.')
    if (!confirmed) return
    await api.delete(`/imports/${batchId}`)
    setImports(prev => prev.filter(i => i.import_batch_id !== batchId))
  }

  const totalExpenses = reviewedTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const totalIncome = reviewedTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const splitSource = splitIndex !== null ? reviewedTxs[splitIndex] : null
  const splitTotal = splitRows.reduce((sum, row) => {
    const amount = Number(row.amount || 0)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)
  const splitRemaining = splitSource ? Math.abs(splitSource.amount) - splitTotal : 0

  return (
    <div className="w-full max-w-4xl mx-auto px-6">
      <h1 className="text-2xl font-bold text-[#1B4D3E] mb-2">📂 Import Statement</h1>
      <p className="text-sm text-[#8BAE90] mb-6">Supports RBC (Chequing & Credit), Amex (CSV and XLS/XLSX), and BMO CSV.</p>

      {/* Import History */}
      <div className="mb-6">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm text-[#8BAE90] hover:text-[#1B4D3E] transition"
        >
          🗂️ Import History {showHistory ? '▲' : '▼'}
        </button>
        {showHistory && (
          <div className="mt-3 bg-white rounded-xl border border-[#D4E4D5] overflow-hidden">
            {imports.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[#8BAE90]">No imports yet.</p>
            ) : (
              imports.map(imp => (
                <div key={imp.import_batch_id} className="flex items-center justify-between px-4 py-3 border-b border-[#EDF4EE] last:border-0">
                  <div>
                    <p className="text-sm font-semibold text-[#1B4D3E]">{imp.account_name}</p>
                    <p className="text-xs text-[#8BAE90]">
                      {imp.transaction_count} transactions · {imp.first_date} → {imp.last_date} · imported {imp.imported_at}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteImport(imp.import_batch_id)}
                    className="p-2 text-[#B85050] hover:bg-[#FDF5F5] rounded-lg transition"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-[#FDF5F5] border border-[#B85050] rounded-lg text-sm text-[#B85050]">
          {error}
        </div>
      )}

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div className="bg-white rounded-xl border border-[#D4E4D5] p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Account</label>
              <select
                value={selectedAccId ?? ''}
                onChange={e => setSelectedAccId(Number(e.target.value))}
                className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
              >
                {debitAccounts.length > 0 && (
                  <optgroup label="🏦 Bank Accounts">
                    {debitAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.bank})</option>)}
                  </optgroup>
                )}
                {cardAccounts.length > 0 && (
                  <optgroup label="💳 Credit Cards">
                    {cardAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.bank})</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Import from date</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Statement file (CSV, XLS, XLSX)</label>
            <div
              className="border-2 border-dashed border-[#D4E4D5] rounded-xl p-8 text-center hover:border-[#4E9A7A] transition cursor-pointer"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <Upload size={28} className="mx-auto text-[#8BAE90] mb-2" />
              {file ? (
                <p className="text-sm font-semibold text-[#1B4D3E]">{file.name}</p>
              ) : (
                <p className="text-sm text-[#8BAE90]">Drop file here or click to browse</p>
              )}
              <input id="file-input" type="file" accept=".csv,.xls,.xlsx" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f) }} />
            </div>
          </div>

          <button
            onClick={handleParse}
            disabled={!file || !selectedAccId || loading}
            className="mt-4 w-full py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <><RefreshCw size={16} className="animate-spin" /> Parsing...</> : <><Upload size={16} /> Parse Statement</>}
          </button>
        </div>
      )}

      {/* ── Step 2: Preview ── */}
      {step === 'preview' && (
        <div>
          <div className="bg-white rounded-xl border border-[#D4E4D5] p-4 mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-[#1B4D3E]">✅ {bank} — {parsedTxs.length} new transactions found</p>
              {lastDate && (
                <p className="text-xs text-[#8BAE90] mt-0.5">Last imported: {lastDate} (older transactions filtered out)</p>
              )}
            </div>
            <button onClick={reset} className="text-xs text-[#8BAE90] hover:text-[#B85050]">Start over</button>
          </div>

          {/* Preview table */}
          <div className="bg-white rounded-xl border border-[#D4E4D5] overflow-x-auto mb-4">
            <div className="min-w-[760px]">
            <div className="grid text-xs font-semibold text-[#8BAE90] uppercase tracking-widest px-4 py-2 border-b border-[#D4E4D5] bg-[#F9FCF9]"
              style={{ gridTemplateColumns: '100px 1fr 120px' }}>
              <span>Date</span>
              <span>Description</span>
              <span className="text-right">Amount</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {parsedTxs.map((t, i) => (
                <div key={i} className={`grid px-4 py-2 border-b border-[#EDF4EE] last:border-0 text-sm items-center ${i % 2 === 0 ? 'bg-white' : 'bg-[#F9FCF9]'}`}
                  style={{ gridTemplateColumns: '100px 1fr 120px' }}>
                  <span className="text-[#8BAE90] text-xs">{t.date}</span>
                  <span className="text-[#2C3E2D] truncate pr-2">{t.description}</span>
                  <span className={`text-right font-semibold tabular-nums ${t.amount < 0 ? 'text-[#B85050]' : 'text-[#1B6B3A]'}`}>
                    {t.amount < 0 ? '-' : '+'}$ {fmt(Math.abs(t.amount))}
                  </span>
                </div>
              ))}
            </div>
            </div>
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing || parsedTxs.length === 0}
            className="w-full py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {analyzing
              ? <><RefreshCw size={16} className="animate-spin" /> AI is categorizing... (15-30s)</>
              : <><Bot size={16} /> Analyze with AI</>}
          </button>
        </div>
      )}

      {/* ── Step 3: Review ── */}
      {step === 'review' && (
        <div>
          <div className="bg-white rounded-xl border border-[#D4E4D5] p-4 mb-4 flex flex-wrap gap-4 items-center justify-between">
            <div>
              <p className="text-sm font-bold text-[#1B4D3E]">📋 Review & confirm {reviewedTxs.length} transactions</p>
              <p className="text-xs text-[#8BAE90]">Edit categories or split mixed purchases and income before importing.</p>
            </div>
            <div className="flex gap-4">
              {isCard ? (
                <span className="text-sm font-semibold text-[#B85050]">Total charges: CAD$ {fmt(totalExpenses)}</span>
              ) : (
                <>
                  <span className="text-sm font-semibold text-[#B85050]">Spent: CAD$ {fmt(totalExpenses)}</span>
                  {totalIncome > 0 && <span className="text-sm font-semibold text-[#1B6B3A]">Received: CAD$ {fmt(totalIncome)}</span>}
                </>
              )}
            </div>
          </div>

          {isCard && (
            <div className="mb-4 px-4 py-2 bg-[#EDF4EE] border border-[#D4E4D5] rounded-lg text-xs text-[#1B4D3E]">
              💳 Credit card import — payments are categorized as Transfer and excluded from spending analysis.
            </div>
          )}

          {/* Review table */}
          <div className="bg-white rounded-xl border border-[#D4E4D5] overflow-x-auto mb-4">
            <div className="min-w-[760px]">
            <div className="grid text-xs font-semibold text-[#8BAE90] uppercase tracking-widest px-4 py-2 border-b border-[#D4E4D5] bg-[#F9FCF9]"
              style={{ gridTemplateColumns: '90px 1fr 110px 150px 90px 72px' }}>
              <span>Date</span>
              <span>Description</span>
              <span className="text-right">Amount</span>
              <span className="pl-2">Category</span>
              <span className="pl-2">Recurring</span>
              <span className="text-right">Split</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {reviewedTxs.map((t, i) => (
                <div key={i}
                  className={`grid px-4 py-2 border-b border-[#EDF4EE] last:border-0 items-center ${i % 2 === 0 ? 'bg-white' : 'bg-[#F9FCF9]'}`}
                  style={{ gridTemplateColumns: '90px 1fr 110px 150px 90px 72px' }}>
                  <span className="text-[#8BAE90] text-xs">{t.date}</span>
                  <input
                    aria-label={`Description for transaction on ${t.date}`}
                    name={`transaction-description-${i}`}
                    autoComplete="off"
                    value={t.description}
                    onChange={e => setReviewedTxs(prev => prev.map((tx, j) => j === i ? { ...tx, description: e.target.value } : tx))}
                    className="text-sm text-[#2C3E2D] bg-transparent border-0 focus:outline-none pr-2 truncate"
                  />
                  <span className={`text-right text-sm font-semibold tabular-nums ${t.amount < 0 ? 'text-[#B85050]' : 'text-[#1B6B3A]'}`}>
                    {t.amount < 0 ? '-' : '+'}$ {fmt(Math.abs(t.amount))}
                  </span>
                  <div className="pl-2">
                    <select
                      aria-label={`Category for ${t.description}`}
                      name={`transaction-category-${i}`}
                      value={t.category || 'Other'}
                      onChange={e => setReviewedTxs(prev => prev.map((tx, j) => j === i ? { ...tx, category: e.target.value } : tx))}
                      className="text-xs px-2 py-1 border border-[#D4E4D5] rounded-lg focus:outline-none w-full bg-white"
                    >
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="pl-2">
                    {t.is_recurring && (
                      <span className="text-xs text-[#4E9A7A] font-semibold">✓ {t.recurring_match || 'Yes'}</span>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => startSplit(i)}
                      className="p-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] hover:bg-[#F4FAF5] transition"
                      title={t.amount > 0 ? 'Split income into salary and extra income' : 'Split transaction'}
                      aria-label={t.amount > 0 ? `Split ${t.description} into salary and extra income` : `Split ${t.description}`}
                    >
                      <Split size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex-1 py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {importing
                ? <><RefreshCw size={16} className="animate-spin" /> Importing...</>
                : <><CheckCircle size={16} /> Import All Transactions</>}
            </button>
            <button onClick={reset} className="px-6 py-3 border border-[#D4E4D5] text-[#8BAE90] rounded-xl hover:text-[#B85050] hover:border-[#B85050] transition text-sm">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Balance confirmation (debit only) ── */}
      {step === 'balance' && (
        <div className="bg-white rounded-xl border border-[#D4E4D5] p-6">
          <p className="text-lg font-bold text-[#1B4D3E] mb-2">💰 Confirm Account Balance</p>
          <p className="text-sm text-[#8BAE90] mb-4">
            We calculated the new balance based on imported transactions. Please confirm or correct it.
          </p>
          <p className="text-sm text-[#2C3E2D] mb-4">Account: <strong>{selectedAcc?.name}</strong></p>
          <div className="bg-[#EDF4EE] rounded-lg px-4 py-3 mb-4">
            <p className="text-xs text-[#8BAE90] mb-1">Calculated new balance</p>
            <p className="text-2xl font-bold text-[#1B4D3E]">CAD$ {fmt(calculatedBalance ?? 0)}</p>
          </div>
          <div className="mb-4">
            <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Confirm or correct balance</label>
            <input
              type="number"
              step="0.01"
              value={confirmedBalance ?? ''}
              onChange={e => setConfirmedBalance(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-lg font-bold focus:outline-none focus:border-[#4E9A7A]"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleConfirmBalance}
              className="flex-1 py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition flex items-center justify-center gap-2"
            >
              <CheckCircle size={16} /> Update Balance
            </button>
            <button onClick={() => setStep('done')} className="px-6 py-3 border border-[#D4E4D5] text-[#8BAE90] rounded-xl hover:text-[#1B4D3E] transition text-sm">
              Skip
            </button>
          </div>
        </div>
      )}

      {/* ── Step 5: Done ── */}
      {step === 'done' && (
        <div className="bg-white rounded-xl border border-[#D4E4D5] p-8 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <p className="text-xl font-bold text-[#1B4D3E] mb-2">Import complete!</p>
          <p className="text-sm text-[#8BAE90] mb-6">Transactions have been imported and categorized.</p>
          <button
            onClick={reset}
            className="px-8 py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition"
          >
            Import Another Statement
          </button>
        </div>
      )}

      {splitSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-[#0B1F18]/45 px-4 py-6">
          <div role="dialog" aria-modal="true" aria-labelledby="split-income-title" className="w-full max-w-2xl rounded-xl border border-[#D4E4D5] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#EDF4EE] px-5 py-4">
              <div>
                <h2 id="split-income-title" className="text-lg font-bold text-[#1B4D3E]">
                  {splitSource.amount > 0 ? 'Split Income' : 'Split Transaction'}
                </h2>
                <p className="mt-1 text-sm text-[#7BAE8A]">
                  {splitSource.description} · $ {fmt(Math.abs(splitSource.amount))}
                </p>
                {splitSource.amount > 0 && (
                  <p className="mt-1 text-xs font-semibold text-[#3F6EA8]">
                    Use Salary for the payroll portion and Other Income for the extra portion.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={cancelSplit}
                className="rounded-lg p-2 text-[#8BAE90] hover:bg-[#F4FAF5] hover:text-[#1B4D3E] transition"
                title="Close split dialog"
                aria-label="Close split dialog"
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
                      aria-label={`Split description ${index + 1}`}
                      name={`split-description-${index}`}
                      autoComplete="off"
                      type="text"
                      value={row.description}
                      onChange={e => updateSplitRow(index, { description: e.target.value })}
                      className="w-full rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-sm font-semibold text-[#1B4D3E] focus:outline-none"
                    />
                    <select
                      aria-label={`Split category ${index + 1}`}
                      name={`split-category-${index}`}
                      value={row.category}
                      onChange={e => updateSplitRow(index, { category: e.target.value })}
                      className="w-full rounded-lg border border-[#D4E4D5] bg-white px-2 py-2 text-xs font-semibold text-[#1B4D3E] focus:outline-none"
                    >
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                      aria-label={`Split amount ${index + 1}`}
                      name={`split-amount-${index}`}
                      inputMode="decimal"
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
                      aria-label={`Remove split row ${index + 1}`}
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
                  className="rounded-xl border border-[#D4E4D5] px-5 py-3 text-sm font-semibold text-[#8BAE90] hover:text-[#1B4D3E] transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveSplit}
                  className="rounded-xl bg-[#1B4D3E] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2D6A4F] transition"
                >
                  Save Split
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
