import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, Save, Split, Target, Trash2, Wand2, X } from 'lucide-react'
import api, {
  getAccounts,
  getCategories,
  getRecurringExpenses,
  getSpendingAnalysis,
  getTransactions,
  updateTransactionCategories,
} from '../services/api'
import type { Account, CategoryBudget, RecurringExpense, SpendingAnalysisResponse, Transaction } from '../services/api'
import { loadRowsPreservingPrevious, replaceSelectedMonth } from '../services/reportingData'
import { investmentSummaryForMonth } from '../utils/investmentPlans'

interface Row {
  category: string
  planned: number
  real: number
  variance: number
}

type BudgetBucket = 'needs' | 'wants' | 'savings'
type BudgetMethodKey = '50-30-20' | '60-20-20' | '60-30-10' | 'custom'

interface BudgetMethod {
  label: string
  description: string
  buckets: Record<BudgetBucket, number>
}

interface BudgetMethodState {
  selectedMethod: BudgetMethodKey
  customBuckets: Record<BudgetBucket, number>
  categoryMap: Record<string, BudgetBucket>
}

interface SplitRow {
  description: string
  category: string
  amount: string
}

const BUDGET_BUCKETS: {
  key: BudgetBucket
  label: string
  description: string
  color: string
  accent: string
  card: string
  chip: string
  select: string
  ring: string
}[] = [
  {
    key: 'needs',
    label: 'Needs',
    description: 'Rent, groceries, insurance, phone, transport, and required bills.',
    color: 'bg-[#1F6F8B]',
    accent: 'bg-[#1F6F8B]',
    card: 'bg-[#F1F8FA] border-[#B7D8E2]',
    chip: 'bg-[#DCEFF4] text-[#14566D] border-[#B7D8E2]',
    select: 'bg-[#F1F8FA] text-[#14566D] border-[#B7D8E2]',
    ring: 'focus:border-[#1F6F8B]',
  },
  {
    key: 'wants',
    label: 'Wants',
    description: 'Coffee, restaurants, leisure, entertainment, travel, and flexible lifestyle.',
    color: 'bg-[#C9A84C]',
    accent: 'bg-[#C9A84C]',
    card: 'bg-[#FFF9E9] border-[#E8D28C]',
    chip: 'bg-[#FFF0B8] text-[#6F5608] border-[#E8D28C]',
    select: 'bg-[#FFF9E9] text-[#6F5608] border-[#E8D28C]',
    ring: 'focus:border-[#C9A84C]',
  },
  {
    key: 'savings',
    label: 'Savings / Investments',
    description: 'Savings, investments, debt acceleration, and future goals.',
    color: 'bg-[#2D6A4F]',
    accent: 'bg-[#2D6A4F]',
    card: 'bg-[#F1F8F4] border-[#B8D9C6]',
    chip: 'bg-[#DCF0E5] text-[#1F5A3D] border-[#B8D9C6]',
    select: 'bg-[#F1F8F4] text-[#1F5A3D] border-[#B8D9C6]',
    ring: 'focus:border-[#2D6A4F]',
  },
]

const BUDGET_METHODS: Record<BudgetMethodKey, BudgetMethod> = {
  '50-30-20': {
    label: '50/30/20',
    description: 'Classic split for needs, wants, and savings.',
    buckets: { needs: 50, wants: 30, savings: 20 },
  },
  '60-20-20': {
    label: '60/20/20',
    description: 'More room for essentials while preserving a strong savings target.',
    buckets: { needs: 60, wants: 20, savings: 20 },
  },
  '60-30-10': {
    label: '60/30/10',
    description: 'Useful when essentials are high and savings need a gradual ramp.',
    buckets: { needs: 60, wants: 30, savings: 10 },
  },
  custom: {
    label: 'Custom Douglas Plan',
    description: 'Your own allocation, editable as your priorities change.',
    buckets: { needs: 60, wants: 20, savings: 20 },
  },
}

const DEFAULT_METHOD_STATE: BudgetMethodState = {
  selectedMethod: '60-20-20',
  customBuckets: { needs: 60, wants: 20, savings: 20 },
  categoryMap: {},
}

const METHOD_STORAGE_KEY = 'findu_budget_methodology'
const EXCLUDED_METHOD_CATEGORIES = new Set(['Salary', 'Other Income', 'Transfer'])
const EARLIEST_REPORTING_MONTH = '1000-01'

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

function lastDayOfMonth(month: string): string {
  const [year, mo] = month.split('-').map(Number)
  const date = new Date(year, mo, 0)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function defaultBucketForCategory(category: string): BudgetBucket {
  const value = category.toLowerCase()
  if (/(investment|saving|emergency|debt|loan|tfsa|rrsp)/.test(value)) return 'savings'
  if (/(coffee|restaurant|leisure|entertainment|travel|clothing|subscription)/.test(value)) return 'wants'
  if (/(rent|housing|food|grocery|transport|gas|car|insurance|phone|health|wellness|education)/.test(value)) return 'needs'
  return 'wants'
}

function loadMethodState(): BudgetMethodState {
  try {
    const raw = localStorage.getItem(METHOD_STORAGE_KEY)
    if (!raw) return DEFAULT_METHOD_STATE
    const parsed = JSON.parse(raw) as Partial<BudgetMethodState>
    return {
      selectedMethod: parsed.selectedMethod && BUDGET_METHODS[parsed.selectedMethod] ? parsed.selectedMethod : DEFAULT_METHOD_STATE.selectedMethod,
      customBuckets: {
        ...DEFAULT_METHOD_STATE.customBuckets,
        ...(parsed.customBuckets || {}),
      },
      categoryMap: parsed.categoryMap || {},
    }
  } catch {
    return DEFAULT_METHOD_STATE
  }
}

function saveMethodState(state: BudgetMethodState) {
  localStorage.setItem(METHOD_STORAGE_KEY, JSON.stringify(state))
}

function bucketStatus(actual: number, target: number): { label: string; className: string } {
  if (target <= 0 && actual <= 0) return { label: 'No activity', className: 'text-[#8BAE90]' }
  if (target <= 0) return { label: 'Review', className: 'text-[#B85050]' }
  const ratio = actual / target
  if (ratio <= 0.9) return { label: 'On track', className: 'text-[#1B6B3A]' }
  if (ratio <= 1.05) return { label: 'Close', className: 'text-[#C9A84C]' }
  return { label: 'Over target', className: 'text-[#B85050]' }
}

function pct(value: number): string {
  return value.toLocaleString('en-CA', { maximumFractionDigits: 1 })
}

function recurringIsActiveForMonth(item: RecurringExpense, month: string): boolean {
  if (item.start_month && item.start_month > month) return false
  if (!item.valid_until) return true
  return new Date(item.valid_until) >= new Date(`${month}-01T00:00:00`)
}

export default function PlannedVsReal() {
  const [spending, setSpending] = useState<SpendingAnalysisResponse>({})
  const [budgets, setBudgets] = useState<CategoryBudget[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categoryTransactions, setCategoryTransactions] = useState<Transaction[]>([])
  const [categoryTransactionsLoading, setCategoryTransactionsLoading] = useState(false)
  const [categoryTransactionsError, setCategoryTransactionsError] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [editedCats, setEditedCats] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [methodState, setMethodState] = useState<BudgetMethodState>(() => loadMethodState())
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappingMessage, setMappingMessage] = useState('')
  const [splitTx, setSplitTx] = useState<Transaction | null>(null)
  const [splitRows, setSplitRows] = useState<SplitRow[]>([])
  const [splitError, setSplitError] = useState('')
  const [splitting, setSplitting] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const today = new Date()
        const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
        const [nextSpending, loadedAccounts, loadedCategories, loadedRecurring] = await Promise.all([
          getSpendingAnalysis(EARLIEST_REPORTING_MONTH, currentMonth),
          getAccounts(),
          getCategories(),
          getRecurringExpenses(),
        ])
        setSpending(nextSpending)
        setAccounts(loadedAccounts)
        setCategories(loadedCategories.map(category => category.name).sort())
        setRecurring(loadedRecurring)

        const months = Object.keys(nextSpending).sort()
        setSelectedMonth(months.includes(currentMonth) ? currentMonth : months[months.length - 1] || currentMonth)
      } catch {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedMonth) return

    async function loadMonthContext() {
      setLoading(true)
      try {
        const [budgetRes, monthlyTransactions] = await Promise.all([
          api.get('/category-budgets', { params: { month: selectedMonth } }),
          getTransactions({ month: selectedMonth }),
        ])
        setBudgets(budgetRes.data as CategoryBudget[])
        setTransactions(monthlyTransactions)
      } finally {
        setLoading(false)
      }
    }

    loadMonthContext()
  }, [selectedMonth])

  const accountById = useMemo(() => {
    return accounts.reduce<Record<number, Account>>((lookup, account) => {
      lookup[account.id] = account
      return lookup
    }, {})
  }, [accounts])

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

    const realByCategory: Record<string, number> = {}
    Object.entries(spending[selectedMonth] || {}).forEach(([category, value]) => {
      const cad = value.by_currency.CAD
      if (!cad) return
      realByCategory[category] = Math.round((cad.cards + cad.debit) * 100) / 100
    })

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
      .sort((a, b) => {
        const aHasPlan = a.planned > 0
        const bHasPlan = b.planned > 0
        if (aHasPlan !== bHasPlan) return aHasPlan ? -1 : 1

        if (!aHasPlan && !bHasPlan) return b.real - a.real

        const percentageDifference = (b.real / b.planned) - (a.real / a.planned)
        if (percentageDifference !== 0) return percentageDifference

        return b.variance - a.variance
      })
  }, [budgets, selectedMonth, spending])

  const totals = rows.reduce(
    (acc, row) => ({
      planned: acc.planned + row.planned,
      real: acc.real + row.real,
      variance: acc.variance + row.variance,
    }),
    { planned: 0, real: 0, variance: 0 },
  )
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
  const splitTotal = splitRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  const splitRemaining = splitTx ? Math.abs(splitTx.amount) - splitTotal : 0
  const methodCategories = useMemo(() => {
    return Array.from(new Set([
      ...categories,
      ...rows.map(row => row.category),
      ...budgets.map(budget => budget.category),
    ]))
      .filter(category => category && !EXCLUDED_METHOD_CATEGORIES.has(category))
      .sort()
  }, [budgets, categories, rows])
  const categoryMap = useMemo(() => {
    return methodCategories.reduce<Record<string, BudgetBucket>>((lookup, category) => {
      lookup[category] = methodState.categoryMap[category] || defaultBucketForCategory(category)
      return lookup
    }, {})
  }, [methodCategories, methodState.categoryMap])
  const selectedBuckets = methodState.selectedMethod === 'custom'
    ? methodState.customBuckets
    : BUDGET_METHODS[methodState.selectedMethod].buckets
  const actualIncomeCad = useMemo(() => {
    return transactions
      .filter(tx => tx.amount > 0)
      .filter(tx => tx.currency === 'CAD')
      .filter(tx => (tx.category || 'Other') !== 'Transfer')
      .filter(tx => tx.date?.slice(0, 7) === selectedMonth)
      .reduce((sum, tx) => sum + tx.amount, 0)
  }, [selectedMonth, transactions])
  const plannedIncomeCad = useMemo(() => {
    return recurring
      .filter(item => item.type === 'INCOME')
      .filter(item => item.currency === 'CAD')
      .filter(item => recurringIsActiveForMonth(item, selectedMonth))
      .reduce((sum, item) => sum + item.amount, 0)
  }, [recurring, selectedMonth])
  const monthlyIncomeCad = actualIncomeCad > 0 ? actualIncomeCad : plannedIncomeCad
  const monthlyIncomeSource = actualIncomeCad > 0 ? 'actual received income' : plannedIncomeCad > 0 ? 'planned recurring income' : 'missing income'
  const investmentMonthSummary = selectedMonth ? investmentSummaryForMonth(selectedMonth, 'CAD') : {
    plannedDue: 0,
    savedActual: 0,
    remainingDue: 0,
    openPlans: 0,
  }
  const bucketRows = BUDGET_BUCKETS.map(bucket => {
    const categoriesInBucket = methodCategories.filter(category => categoryMap[category] === bucket.key)
    const categoryActual = rows
      .filter(row => categoryMap[row.category] === bucket.key)
      .reduce((sum, row) => sum + row.real, 0)
    const actual = bucket.key === 'savings'
      ? categoryActual + investmentMonthSummary.savedActual
      : categoryActual
    const target = monthlyIncomeCad * (selectedBuckets[bucket.key] / 100)
    const actualPercent = monthlyIncomeCad > 0 ? (actual / monthlyIncomeCad) * 100 : 0
    const status = bucketStatus(actual, target)
    return {
      ...bucket,
      percent: selectedBuckets[bucket.key],
      actualPercent,
      target,
      actual,
      variance: target - actual,
      categories: categoriesInBucket,
      status,
    }
  })
  const percentTotal = Object.values(selectedBuckets).reduce((sum, value) => sum + Number(value || 0), 0)

  useEffect(() => {
    saveMethodState(methodState)
  }, [methodState])

  function prevMonth() {
    setSelectedMonth(month => addMonths(month, -1))
  }

  function nextMonth() {
    setSelectedMonth(month => addMonths(month, 1))
  }

  async function refreshSpendingAndTransactions() {
    if (!selectedMonth) return
    const [nextSpending, monthlyTransactions] = await Promise.all([
      getSpendingAnalysis(selectedMonth, selectedMonth),
      getTransactions({ month: selectedMonth }),
    ])
    setSpending(current => replaceSelectedMonth(current, selectedMonth, nextSpending))
    setTransactions(monthlyTransactions)
  }

  async function loadCategoryTransactions(category: string, previousRows = categoryTransactions) {
    if (!selectedMonth) return
    setCategoryTransactionsLoading(true)
    setCategoryTransactionsError(null)
    const result = await loadRowsPreservingPrevious(async () => {
      const categoryRows = await getTransactions({
        category,
        dateFrom: `${addMonths(selectedMonth, -1)}-01`,
        dateTo: lastDayOfMonth(selectedMonth),
      })
      const filtered = categoryRows
        .filter(transaction => transaction.amount < 0 && transaction.currency === 'CAD')
        .filter(transaction => {
          const account = accountById[transaction.account_id]
          const reportingMonth = account?.account_type === 'CREDIT_CARD'
            ? transaction.statement_month || transaction.date.slice(0, 7)
            : transaction.date.slice(0, 7)
          return reportingMonth === selectedMonth
        })
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      return filtered
    }, previousRows)
    setCategoryTransactions(result.rows)
    setCategoryTransactionsError(result.error)
    setCategoryTransactionsLoading(false)
  }

  function openCategoryDetails(category: string) {
    setSelectedCategory(category)
    setEditedCats({})
    setSaveMsg('')
    setCategoryTransactions([])
    setCategoryTransactionsError(null)
    loadCategoryTransactions(category, [])
  }

  function closeModal() {
    setSelectedCategory(null)
    setCategoryTransactions([])
    setCategoryTransactionsError(null)
    setEditedCats({})
    setSaveMsg('')
    cancelSplit()
  }

  async function saveCategoryChanges() {
    const changes = Object.entries(editedCats)
    if (changes.length === 0) return

    setSaving(true)
    try {
      const result = await updateTransactionCategories(
        changes.map(([id, category]) => ({ id: Number(id), category })),
      )
      await refreshSpendingAndTransactions()
      if (selectedCategory) await loadCategoryTransactions(selectedCategory, categoryTransactions)
      setEditedCats({})
      setSaveMsg(`${result.updated_count} transaction${result.updated_count !== 1 ? 's' : ''} updated.`)
      setTimeout(() => setSaveMsg(''), 3000)
    } finally {
      setSaving(false)
    }
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
      await refreshSpendingAndTransactions()
      if (selectedCategory) await loadCategoryTransactions(selectedCategory, categoryTransactions)
      setEditedCats(prev => {
        const next = { ...prev }
        delete next[splitTx.id]
        return next
      })
      setSaveMsg('Transaction split saved.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (error) {
      console.error(`Failed to split transaction ${splitTx.id}`, error)
      setSplitError('Could not save split.')
    } finally {
      setSplitting(false)
    }
  }

  function updateMethodState(updates: Partial<BudgetMethodState>) {
    setMappingMessage('')
    setMethodState(current => ({ ...current, ...updates }))
  }

  function updateCategoryBucket(category: string, bucket: BudgetBucket) {
    setMappingMessage('')
    setMethodState(current => ({
      ...current,
      categoryMap: {
        ...current.categoryMap,
        [category]: bucket,
      },
    }))
  }

  function updateCustomBucket(bucket: BudgetBucket, value: number) {
    setMethodState(current => ({
      ...current,
      selectedMethod: 'custom',
      customBuckets: {
        ...current.customBuckets,
        [bucket]: Number.isFinite(value) ? value : 0,
      },
    }))
  }

  async function autoMapCategories() {
    setMappingLoading(true)
    setMappingMessage('')
    try {
      const res = await api.post('/budget-methodology/suggest', {
        categories: methodCategories,
        model: methodState.selectedMethod,
      })
      const suggestions = (res.data?.mapping || {}) as Record<string, BudgetBucket>
      setMethodState(current => ({
        ...current,
        categoryMap: {
          ...current.categoryMap,
          ...suggestions,
        },
      }))
      setMappingMessage(res.data?.source === 'fallback'
        ? 'Mapped with FinDu rules. Review before relying on it.'
        : 'AI mapped your categories. Review and adjust if needed.')
    } catch {
      const fallback = methodCategories.reduce<Record<string, BudgetBucket>>((lookup, category) => {
        lookup[category] = defaultBucketForCategory(category)
        return lookup
      }, {})
      setMethodState(current => ({
        ...current,
        categoryMap: {
          ...current.categoryMap,
          ...fallback,
        },
      }))
      setMappingMessage('AI was unavailable, so FinDu used local rules. Review before relying on it.')
    } finally {
      setMappingLoading(false)
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
          <p className="text-sm text-[#7BAE8A] mt-1">Compare your real spending against budgets and a flexible money methodology.</p>
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
          <section className="bg-white border border-[#D4E4D5] rounded-xl p-5 mb-6">
            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5 mb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">Budget methodology</p>
                <h2 className="text-xl font-bold text-[#1B4D3E] mt-1">Recommended allocation</h2>
                <p className="text-sm text-[#7BAE8A] mt-1 max-w-3xl">
                  Pick a rule, map each FinDu category to a bucket, and compare your real spending against a target based on this month's CAD income.
                </p>
              </div>
              <button
                type="button"
                onClick={autoMapCategories}
                disabled={mappingLoading || methodCategories.length === 0}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1B4D3E] text-white text-sm font-bold hover:bg-[#2D6A4F] transition disabled:opacity-50"
              >
                <Wand2 size={16} />
                {mappingLoading ? 'Mapping...' : 'Auto-map with AI'}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-4 mb-5">
              {(Object.keys(BUDGET_METHODS) as BudgetMethodKey[]).map(methodKey => {
                const method = BUDGET_METHODS[methodKey]
                const active = methodState.selectedMethod === methodKey
                return (
                  <button
                    key={methodKey}
                    type="button"
                    onClick={() => updateMethodState({ selectedMethod: methodKey })}
                    className={`rounded-lg border px-4 py-3 text-left transition ${
                      active
                        ? 'border-[#1B4D3E] bg-[#EDF4EE]'
                        : 'border-[#D4E4D5] bg-[#F8FBF8] hover:border-[#9CC7A7]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-[#1B4D3E]">{method.label}</p>
                      {active && <CheckCircle2 size={16} className="text-[#1B6B3A]" />}
                    </div>
                    <p className="text-xs text-[#7BAE8A] mt-1">{method.description}</p>
                  </button>
                )
              })}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid gap-3 md:grid-cols-3">
                {bucketRows.map(bucket => {
                  const progress = bucket.percent > 0 ? Math.min((bucket.actualPercent / bucket.percent) * 100, 140) : 0
                  return (
                    <div key={bucket.key} className={`rounded-lg border p-4 overflow-hidden relative ${bucket.card}`}>
                      <div className={`absolute left-0 top-0 h-full w-1.5 ${bucket.accent}`} />
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`w-3 h-3 rounded-full ${bucket.accent}`} />
                            <p className="text-sm font-bold text-[#1B4D3E]">{bucket.label}</p>
                          </div>
                          <p className="text-xs text-[#7BAE8A] mt-1">{bucket.description}</p>
                        </div>
                        <div className="w-20 shrink-0">
                          <label className="sr-only">{bucket.label} target percent</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={bucket.percent}
                            onChange={event => updateCustomBucket(bucket.key, Number(event.target.value))}
                            className={`w-full rounded-lg border bg-white px-2 py-1.5 text-right text-sm font-bold focus:outline-none ${bucket.chip} ${bucket.ring}`}
                          />
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 mb-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-xs font-semibold text-[#8BAE90]">Actual share of income</p>
                            <p className={`text-xl font-bold ${bucket.status.className}`}>
                              {monthlyIncomeCad > 0 ? `${pct(bucket.actualPercent)}%` : '-'}
                            </p>
                          </div>
                          <p className="text-xs text-[#7BAE8A] mt-1">
                            Target share {pct(bucket.percent)}% - Actual CAD$ {fmt(bucket.actual)}
                          </p>
                        </div>
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="text-[#7BAE8A]">{monthlyIncomeCad > 0 ? `${pct(bucket.actualPercent)}% of salary` : 'Income missing'}</span>
                          <span className={bucket.status.className}>{bucket.status.label}</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-white border border-[#D4E4D5] overflow-hidden">
                          <div className={`${bucket.color} h-full rounded-full`} style={{ width: `${Math.min(progress, 100)}%` }} />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-[#8BAE90]">Target</p>
                            <p className="font-bold text-[#1B4D3E]">CAD$ {fmt(bucket.target)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[#8BAE90]">Difference</p>
                            <p className={`font-bold ${bucket.variance >= 0 ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>
                              {bucket.variance >= 0 ? 'Under' : 'Over'} CAD$ {fmt(Math.abs(bucket.variance))}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-bold text-[#1B4D3E]">Category mapping</p>
                    <p className="text-xs text-[#7BAE8A] mt-1">AI suggests buckets; you approve the final setup.</p>
                  </div>
                  <span className={`text-xs font-bold ${percentTotal === 100 ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>
                    {percentTotal}%
                  </span>
                </div>
                {mappingMessage && (
                  <div className="rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-xs font-semibold text-[#1B4D3E] mb-3">
                    {mappingMessage}
                  </div>
                )}
                <div className="max-h-64 overflow-auto space-y-2 pr-1">
                  {methodCategories.length === 0 ? (
                    <p className="text-sm text-[#8BAE90]">No expense categories found yet.</p>
                  ) : (
                    methodCategories.map(category => {
                      const mappedBucket = BUDGET_BUCKETS.find(bucket => bucket.key === categoryMap[category])
                      return (
                        <div key={category} className={`grid grid-cols-[minmax(0,1fr)_150px] gap-2 items-center rounded-lg border px-2 py-1.5 ${mappedBucket?.card || 'bg-white border-[#D4E4D5]'}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${mappedBucket?.accent || 'bg-[#8BAE90]'}`} />
                            <p className="truncate text-sm font-semibold text-[#1B4D3E]">{category}</p>
                          </div>
                          <select
                            value={categoryMap[category]}
                            onChange={event => updateCategoryBucket(category, event.target.value as BudgetBucket)}
                            className={`rounded-lg border px-2 py-1.5 text-xs font-semibold focus:outline-none ${mappedBucket?.select || 'bg-white text-[#1B4D3E] border-[#D4E4D5]'}`}
                          >
                            {BUDGET_BUCKETS.map(bucket => (
                              <option key={bucket.key} value={bucket.key}>{bucket.label}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })
                  )}
                </div>
                <div className="mt-3 rounded-lg bg-white border border-[#D4E4D5] px-3 py-2">
                  <p className="text-xs text-[#7BAE8A]">
                    Income base: <span className="font-bold text-[#1B4D3E]">CAD$ {fmt(monthlyIncomeCad)}</span> from {monthlyIncomeSource}. If this looks low, update recurring income or classify salary transactions for {monthLabel(selectedMonth)}.
                  </p>
                  {investmentMonthSummary.openPlans > 0 && (
                    <p className="text-xs text-[#7BAE8A] mt-2">
                      Investment plans: <span className="font-bold text-[#1B4D3E]">CAD$ {fmt(investmentMonthSummary.savedActual)}</span> saved of CAD$ {fmt(investmentMonthSummary.plannedDue)} planned this month.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

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
                    onClick={() => openCategoryDetails(row.category)}
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
              <div className="w-full max-w-6xl max-h-[88vh] overflow-hidden rounded-lg bg-white border border-[#D4E4D5] shadow-xl">
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
                  <div className="min-w-[1040px] grid grid-cols-[280px_1fr] gap-4 p-5">
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
                            <div className="mt-3 rounded-lg border border-[#EDF4EE] bg-white overflow-hidden">
                              {(budget.items && budget.items.length > 0 ? budget.items : [{ name: budget.category, amount: budget.amount }]).map((item, index) => (
                                <div key={`${budget.id}-${item.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#EDF4EE] last:border-0">
                                  <p className="text-xs font-semibold text-[#2C3E2D] truncate">{item.name}</p>
                                  <p className="text-xs font-bold tabular-nums text-[#1B4D3E]">CAD$ {fmt(item.amount)}</p>
                                </div>
                              ))}
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

                      {categoryTransactionsLoading ? (
                        <div className="px-5 py-12 text-center text-[#8BAE90]">
                          Loading transactions...
                        </div>
                      ) : (
                        <>
                          {categoryTransactionsError && (
                            <div role="alert" className="flex items-center justify-between gap-4 border-b border-[#F0D6D6] bg-[#FFF7F7] px-5 py-3 text-sm text-[#9A3F3F]">
                              <span>{categoryTransactionsError}</span>
                              <button
                                type="button"
                                onClick={() => loadCategoryTransactions(selectedCategory, categoryTransactions)}
                                className="shrink-0 rounded-lg border border-[#D9A8A8] px-3 py-1.5 text-xs font-semibold transition hover:bg-white"
                              >
                                Retry
                              </button>
                            </div>
                          )}
                          {!categoryTransactionsError && categoryTransactions.length === 0 && (
                            <div className="px-5 py-12 text-center text-[#8BAE90]">
                              No transactions found in this category for {monthLabel(selectedMonth)}.
                            </div>
                          )}
                          {categoryTransactions.length > 0 && <div>
                          <div className="grid grid-cols-[80px_150px_1fr_120px_180px_52px] gap-3 border-b border-[#D4E4D5] bg-[#F9FCF9] px-5 py-3 text-xs font-semibold uppercase tracking-widest text-[#8BAE90]">
                            <span>Date</span>
                            <span>Source</span>
                            <span>Description</span>
                            <span className="text-right">Amount</span>
                            <span>Move to</span>
                            <span className="text-right">Split</span>
                          </div>
                          {categoryTransactions.map((tx, index) => {
                            const [year, month, day] = tx.date.slice(0, 10).split('-').map(Number)
                            const dateStr = new Date(year, month - 1, day).toLocaleDateString('en', { month: 'short', day: 'numeric' })
                            const currentCat = editedCats[tx.id] ?? tx.category ?? 'Other'
                            const isEdited = editedCats[tx.id] !== undefined && editedCats[tx.id] !== tx.category
                            const account = accountById[tx.account_id]
                            const sourceLabel = account ? account.name : 'Unknown'
                            const sourceMeta = account?.account_type === 'CREDIT_CARD' ? 'Card' : 'Account'

                            return (
                              <div
                                key={tx.id}
                                className={`grid grid-cols-[80px_150px_1fr_120px_180px_52px] gap-3 items-center border-b border-[#EDF4EE] px-5 py-3 last:border-0 ${index % 2 === 0 ? 'bg-white' : 'bg-[#F9FCF9]'}`}
                              >
                                <span className="text-xs text-[#8BAE90]">{dateStr}</span>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold text-[#1B4D3E]">{sourceLabel}</p>
                                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#8BAE90]">{sourceMeta}</p>
                                </div>
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
                                        const next = { ...prev }
                                        delete next[tx.id]
                                        return next
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
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => startSplit(tx)}
                                    disabled={saving}
                                    className="rounded-lg border border-[#D4E4D5] p-2 text-[#1B4D3E] transition hover:bg-[#F4FAF5] disabled:opacity-50"
                                    title="Split transaction"
                                  >
                                    <Split size={14} />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                          </div>}
                        </>
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

                {splitTx && (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B1F18]/45 px-4">
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
                          className="rounded-lg p-2 text-[#8BAE90] transition hover:bg-[#F4FAF5] hover:text-[#1B4D3E]"
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
                                onChange={event => updateSplitRow(index, { description: event.target.value })}
                                className="w-full rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-sm font-semibold text-[#1B4D3E] focus:outline-none"
                              />
                              <select
                                value={row.category}
                                onChange={event => updateSplitRow(index, { category: event.target.value })}
                                className="w-full rounded-lg border border-[#D4E4D5] bg-white px-2 py-2 text-xs font-semibold text-[#1B4D3E] focus:outline-none"
                              >
                                {categories.map(category => (
                                  <option key={category} value={category}>{category}</option>
                                ))}
                              </select>
                              <input
                                type="number"
                                step="0.01"
                                min={0}
                                value={row.amount}
                                onChange={event => updateSplitRow(index, { amount: event.target.value })}
                                className="w-full rounded-lg border border-[#D4E4D5] bg-white px-3 py-2 text-right text-sm font-semibold tabular-nums text-[#1B4D3E] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => removeSplitRow(index)}
                                disabled={splitRows.length <= 2}
                                className="h-10 rounded-lg border border-[#F0CCCC] text-[#B85050] transition hover:bg-[#FDF5F5] disabled:opacity-40"
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
                          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#D4E4D5] py-2 text-sm font-semibold text-[#1B4D3E] transition hover:bg-[#F4FAF5]"
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
                            className="rounded-lg border border-[#D4E4D5] px-5 py-3 text-sm font-semibold text-[#8BAE90] transition hover:text-[#1B4D3E]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveSplit}
                            disabled={splitting}
                            className="rounded-lg bg-[#1B4D3E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2D6A4F] disabled:opacity-50"
                          >
                            {splitting ? 'Saving...' : 'Save Split'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
