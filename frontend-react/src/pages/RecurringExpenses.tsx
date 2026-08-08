import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Edit3, GitBranch, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import api from '../services/api'
import type { Category, CategoryBudget, RecurringExpense } from '../services/api'

type Currency = 'BRL' | 'CAD' | 'USD' | 'EUR'
type RecurringType = 'EXPENSE' | 'INCOME'

const CURRENCIES: Currency[] = ['CAD', 'BRL', 'USD', 'EUR']
const INCOME_CATEGORIES = ['Salary', 'Other Income', 'Transfer', 'Other']

function fmt(value: number, currency: string): string {
  return value.toLocaleString(currency === 'BRL' || currency === 'EUR' ? 'pt-BR' : 'en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function symbol(currency: string): string {
  if (currency === 'BRL') return 'R$'
  if (currency === 'USD') return 'US$'
  if (currency === 'EUR') return '€'
  return 'CAD$'
}

function validUntilLabel(value?: string): string {
  if (!value) return 'Ongoing'
  const date = value.slice(0, 10)
  const [year, month, day] = date.split('-').map(Number)
  return `Until ${new Date(year, month - 1, day).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`
}

function startMonthLabel(value?: string | null): string {
  if (!value) return 'Started before tracking'
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  return `From ${new Date(year, month - 1, 1).toLocaleDateString('en', {
    month: 'short',
    year: 'numeric',
  })}`
}

function itemVerb(type: RecurringType): string {
  return type === 'INCOME' ? 'Receive' : 'Due'
}

function activeInMonth(startMonth: string | null | undefined, validUntil: string | null | undefined, month: string): boolean {
  if (startMonth && startMonth.slice(0, 7) > month) return false
  if (validUntil && validUntil.slice(0, 7) < month) return false
  return true
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthName(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1))
}

interface RecurringForm {
  name: string
  amount: string
  currency: Currency
  due_day: string
  category: string
  start_month: string
  valid_until: string
}

interface RecurringDateForm {
  start_month: string
  valid_until: string
}

interface BudgetForm {
  category: string
  currency: Currency
  start_month: string
  valid_until: string
  items: { name: string; amount: string }[]
}

const EXPENSE_FORM: RecurringForm = {
  name: '',
  amount: '0',
  currency: 'CAD',
  due_day: '1',
  category: '',
  start_month: new Date().toISOString().slice(0, 7),
  valid_until: '',
}

const INCOME_FORM: RecurringForm = {
  name: '',
  amount: '0',
  currency: 'CAD',
  due_day: '1',
  category: 'Salary',
  start_month: new Date().toISOString().slice(0, 7),
  valid_until: '',
}

const EMPTY_BUDGET_FORM: BudgetForm = {
  category: '',
  currency: 'CAD',
  start_month: new Date().toISOString().slice(0, 7),
  valid_until: '',
  items: [{ name: '', amount: '0' }],
}

function validDay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31
}

export default function RecurringExpenses() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMonth = /^\d{4}-\d{2}$/.test(searchParams.get('month') || '')
    ? searchParams.get('month')!
    : new Date().toISOString().slice(0, 7)
  const requestedCurrency = searchParams.get('currency') as Currency | null
  const initialCurrency = requestedCurrency && CURRENCIES.includes(requestedCurrency) ? requestedCurrency : 'CAD'
  const [items, setItems] = useState<RecurringExpense[]>([])
  const [budgets, setBudgets] = useState<CategoryBudget[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [expenseOnlyCategories, setExpenseOnlyCategories] = useState<string[]>([])
  const [activeForm, setActiveForm] = useState<RecurringType>('EXPENSE')
  const [expenseForm, setExpenseForm] = useState<RecurringForm>(EXPENSE_FORM)
  const [incomeForm, setIncomeForm] = useState<RecurringForm>(INCOME_FORM)
  const [budgetForm, setBudgetForm] = useState<BudgetForm>(EMPTY_BUDGET_FORM)
  const [expandedBudgetId, setExpandedBudgetId] = useState<number | null>(null)
  const [editingBudgetId, setEditingBudgetId] = useState<number | null>(null)
  const [editingBudgetItems, setEditingBudgetItems] = useState<{ name: string; amount: string }[]>([])
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [editingItemDates, setEditingItemDates] = useState<RecurringDateForm>({ start_month: '', valid_until: '' })
  const [adjustingBudgetId, setAdjustingBudgetId] = useState<number | null>(null)
  const [adjustmentStartMonth, setAdjustmentStartMonth] = useState(new Date().toISOString().slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(initialMonth)
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(initialCurrency)
  const [showPastSchedules, setShowPastSchedules] = useState(false)

  const monthItems = useMemo(
    () => items.filter(item => item.currency === selectedCurrency && activeInMonth(item.start_month, item.valid_until, selectedMonth)),
    [items, selectedCurrency, selectedMonth],
  )
  const incomeItems = monthItems.filter(item => item.type === 'INCOME')
  const expenseItems = monthItems.filter(item => item.type !== 'INCOME')
  const monthBudgets = useMemo(
    () => budgets.filter(budget => budget.currency === selectedCurrency && activeInMonth(budget.start_month, budget.valid_until, selectedMonth)),
    [budgets, selectedCurrency, selectedMonth],
  )
  const pastItems = items.filter(item => item.currency === selectedCurrency && item.valid_until && item.valid_until.slice(0, 7) < selectedMonth)
  const pastBudgets = budgets.filter(budget => budget.currency === selectedCurrency && budget.valid_until && budget.valid_until.slice(0, 7) < selectedMonth)
  const fixedIncomeTotal = incomeItems.reduce((sum, item) => sum + item.amount, 0)
  const fixedExpenseTotal = expenseItems.reduce((sum, item) => sum + item.amount, 0)
  const categoryBudgetTotal = monthBudgets.reduce((sum, budget) => sum + budget.amount, 0)
  const totalMonthlyPlan = fixedExpenseTotal + categoryBudgetTotal

  useEffect(() => {
    setSearchParams({ month: selectedMonth, currency: selectedCurrency }, { replace: true })
  }, [selectedCurrency, selectedMonth, setSearchParams])
  const expenseCategories = categories.length > 0 ? categories : ['Housing', 'Food', 'Transport', 'Other']
  const budgetFormTotal = budgetForm.items.reduce((sum, item) => {
    const amount = Number(item.amount || 0)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)

  async function loadRecurring() {
    setLoading(true)
    setError('')
    try {
      const [recRes, catRes] = await Promise.all([
        api.get('/recurring-expenses'),
        api.get('/categories'),
      ])
      const nextCategories = (catRes.data as Category[])
        .filter(category => category.type === 'EXPENSE' || category.type === 'TRANSFER')
        .map(category => category.name)
        .sort()
      const nextExpenseOnlyCategories = (catRes.data as Category[])
        .filter(category => category.type === 'EXPENSE')
        .map(category => category.name)
        .sort()
      const budgetRes = await api.get('/category-budgets').catch(() => ({ data: [] }))
      setItems(recRes.data as RecurringExpense[])
      setBudgets(budgetRes.data as CategoryBudget[])
      setCategories(nextCategories)
      setExpenseOnlyCategories(nextExpenseOnlyCategories)
      if (!expenseForm.category && nextCategories.length > 0) {
        setExpenseForm(prev => ({ ...prev, category: nextCategories[0] }))
      }
      if (!budgetForm.category && nextExpenseOnlyCategories.length > 0) {
        setBudgetForm(prev => ({ ...prev, category: nextExpenseOnlyCategories[0] }))
      }
    } catch (e) {
      console.error('Failed to load recurring items', e)
      setError('Could not load recurring expenses and income.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    async function loadInitialRecurring() {
      setError('')
      try {
        const [recRes, catRes, budgetRes] = await Promise.all([
          api.get('/recurring-expenses'),
          api.get('/categories'),
          api.get('/category-budgets').catch(() => ({ data: [] })),
        ])
        if (!active) return
        const nextCategories = (catRes.data as Category[])
          .filter(category => category.type === 'EXPENSE' || category.type === 'TRANSFER')
          .map(category => category.name)
          .sort()
        const nextExpenseOnlyCategories = (catRes.data as Category[])
          .filter(category => category.type === 'EXPENSE')
          .map(category => category.name)
          .sort()
        setItems(recRes.data as RecurringExpense[])
        setBudgets(budgetRes.data as CategoryBudget[])
        setCategories(nextCategories)
        setExpenseOnlyCategories(nextExpenseOnlyCategories)
        if (nextCategories.length > 0) {
          setExpenseForm(prev => prev.category ? prev : { ...prev, category: nextCategories[0] })
        }
        if (nextExpenseOnlyCategories.length > 0) {
          setBudgetForm(prev => prev.category ? prev : { ...prev, category: nextExpenseOnlyCategories[0] })
        }
      } catch (e) {
        if (!active) return
        console.error('Failed to load recurring items', e)
        setError('Could not load recurring expenses and income.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadInitialRecurring()
    return () => { active = false }
  }, [])

  async function deleteItem(item: RecurringExpense) {
    const confirmed = window.confirm(`Delete ${item.name}? This cannot be undone.`)
    if (!confirmed) return

    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api.delete(`/recurring-expenses/${item.id}`)
      setItems(prev => prev.filter(existing => existing.id !== item.id))
      setMessage(`${item.name} deleted.`)
    } catch (e) {
      console.error(`Failed to delete recurring item ${item.id}`, e)
      setError('Could not delete recurring item.')
    } finally {
      setSaving(false)
    }
  }

  function validateForm(form: RecurringForm): string | null {
    const amount = Number(form.amount || 0)
    const dueDay = Number(form.due_day)
    if (!form.name.trim()) return 'Name is required.'
    if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than zero.'
    if (!validDay(dueDay)) return 'Day must be between 1 and 31.'
    if (!form.category) return 'Category is required.'
    if (!form.start_month) return 'Start month is required.'
    if (form.valid_until && form.valid_until.slice(0, 7) < form.start_month) return 'Valid until must be on or after the start month.'
    return null
  }

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = activeForm === 'INCOME' ? incomeForm : expenseForm
    const validation = validateForm(form)
    if (validation) {
      setError(validation)
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.post('/recurring-expenses', {
        name: form.name.trim(),
        amount: Number(form.amount),
        currency: form.currency,
        due_day: Number(form.due_day),
        category: form.category,
        type: activeForm,
        start_month: form.start_month,
        valid_until: form.valid_until ? `${form.valid_until}T00:00:00` : null,
      })
      setItems(prev => [...prev, res.data as RecurringExpense].sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name)))
      if (activeForm === 'INCOME') setIncomeForm(INCOME_FORM)
      else setExpenseForm({ ...EXPENSE_FORM, category: expenseCategories[0] || '' })
      setMessage(`${activeForm === 'INCOME' ? 'Income' : 'Expense'} added.`)
    } catch (e) {
      console.error('Failed to create recurring item', e)
      setError(`Could not create ${activeForm === 'INCOME' ? 'income' : 'expense'}.`)
    } finally {
      setSaving(false)
    }
  }

  async function createBudget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const budgetItems = budgetForm.items
      .map(item => ({ name: item.name.trim(), amount: Number(item.amount || 0) }))
      .filter(item => item.name && Number.isFinite(item.amount) && item.amount > 0)

    if (!budgetForm.category) {
      setError('Budget category is required.')
      return
    }
    if (budgetItems.length === 0) {
      setError('Add at least one budget item with a name and amount greater than zero.')
      return
    }
    if (!budgetForm.start_month) {
      setError('Budget start month is required.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.post('/category-budgets', {
        category: budgetForm.category,
        amount: budgetItems.reduce((sum, item) => sum + item.amount, 0),
        items: budgetItems,
        currency: budgetForm.currency,
        start_month: budgetForm.start_month,
        valid_until: budgetForm.valid_until ? `${budgetForm.valid_until}T00:00:00` : null,
      })
      setBudgets(prev => [...prev, res.data as CategoryBudget].sort((a, b) => a.category.localeCompare(b.category)))
      setBudgetForm(prev => ({ ...prev, valid_until: '', items: [{ name: '', amount: '0' }] }))
      setMessage(`${budgetForm.category} budget added.`)
    } catch (e) {
      console.error('Failed to create category budget', e)
      setError('Could not create category budget.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteBudget(budget: CategoryBudget) {
    const confirmed = window.confirm(`Delete ${budget.category} budget?`)
    if (!confirmed) return

    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api.delete(`/category-budgets/${budget.id}`)
      setBudgets(prev => prev.filter(existing => existing.id !== budget.id))
      setMessage(`${budget.category} budget deleted.`)
    } catch (e) {
      console.error(`Failed to delete category budget ${budget.id}`, e)
      setError('Could not delete category budget.')
    } finally {
      setSaving(false)
    }
  }

  function updateCurrentForm(update: Partial<RecurringForm>) {
    if (activeForm === 'INCOME') setIncomeForm(prev => ({ ...prev, ...update }))
    else setExpenseForm(prev => ({ ...prev, ...update }))
  }

  function startEditingItemDates(item: RecurringExpense) {
    setEditingItemId(item.id)
    setEditingItemDates({
      start_month: item.start_month || '',
      valid_until: item.valid_until ? item.valid_until.slice(0, 10) : '',
    })
    setError('')
    setMessage('')
  }

  function cancelEditingItemDates() {
    setEditingItemId(null)
    setEditingItemDates({ start_month: '', valid_until: '' })
  }

  async function saveItemDates(item: RecurringExpense) {
    if (!editingItemDates.start_month) {
      setError('Start month is required.')
      return
    }
    if (editingItemDates.valid_until && editingItemDates.valid_until.slice(0, 7) < editingItemDates.start_month) {
      setError('Valid until must be on or after the start month.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.patch(`/recurring-expenses/${item.id}`, {
        start_month: editingItemDates.start_month,
        valid_until: editingItemDates.valid_until ? `${editingItemDates.valid_until}T00:00:00` : null,
      })
      setItems(prev => prev.map(existing => existing.id === item.id ? res.data as RecurringExpense : existing))
      cancelEditingItemDates()
      setMessage(`${item.name} dates updated.`)
    } catch (e) {
      console.error(`Failed to update recurring item ${item.id}`, e)
      setError('Could not update recurring item dates.')
    } finally {
      setSaving(false)
    }
  }

  function updateBudgetItem(index: number, update: Partial<{ name: string; amount: string }>) {
    setBudgetForm(prev => ({
      ...prev,
      items: prev.items.map((item, currentIndex) => currentIndex === index ? { ...item, ...update } : item),
    }))
  }

  function addBudgetItem() {
    setBudgetForm(prev => ({
      ...prev,
      items: [...prev.items, { name: '', amount: '0' }],
    }))
  }

  function removeBudgetItem(index: number) {
    setBudgetForm(prev => ({
      ...prev,
      items: prev.items.length === 1
        ? [{ name: '', amount: '0' }]
        : prev.items.filter((_, currentIndex) => currentIndex !== index),
    }))
  }

  function startEditingBudget(budget: CategoryBudget) {
    const items = budget.items && budget.items.length > 0 ? budget.items : [{ name: budget.category, amount: budget.amount }]
    setEditingBudgetId(budget.id)
    setEditingBudgetItems(items.map(item => ({ name: item.name, amount: String(item.amount) })))
    setAdjustingBudgetId(null)
  }

  function startAdjustingBudget(budget: CategoryBudget) {
    const items = budget.items && budget.items.length > 0 ? budget.items : [{ name: budget.category, amount: budget.amount }]
    setAdjustingBudgetId(budget.id)
    setEditingBudgetId(budget.id)
    setEditingBudgetItems(items.map(item => ({ name: item.name, amount: String(item.amount) })))
    setAdjustmentStartMonth(new Date().toISOString().slice(0, 7))
  }

  function updateEditingBudgetItem(index: number, update: Partial<{ name: string; amount: string }>) {
    setEditingBudgetItems(prev => prev.map((item, currentIndex) => currentIndex === index ? { ...item, ...update } : item))
  }

  function addEditingBudgetItem() {
    setEditingBudgetItems(prev => [...prev, { name: '', amount: '0' }])
  }

  function removeEditingBudgetItem(index: number) {
    setEditingBudgetItems(prev => prev.length === 1 ? [{ name: '', amount: '0' }] : prev.filter((_, currentIndex) => currentIndex !== index))
  }

  async function saveBudgetItems(budget: CategoryBudget) {
    const items = editingBudgetItems
      .map(item => ({ name: item.name.trim(), amount: Number(item.amount || 0) }))
      .filter(item => item.name && Number.isFinite(item.amount) && item.amount > 0)

    if (items.length === 0) {
      setError('Add at least one budget item with a name and amount greater than zero.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.patch(`/category-budgets/${budget.id}`, { items })
      setBudgets(prev => prev.map(existing => existing.id === budget.id ? res.data as CategoryBudget : existing))
      setEditingBudgetId(null)
      setEditingBudgetItems([])
      setMessage(`${budget.category} budget items updated.`)
    } catch (e) {
      console.error(`Failed to update category budget ${budget.id}`, e)
      setError('Could not update category budget items.')
    } finally {
      setSaving(false)
    }
  }

  async function saveBudgetAdjustment(budget: CategoryBudget) {
    const items = editingBudgetItems
      .map(item => ({ name: item.name.trim(), amount: Number(item.amount || 0) }))
      .filter(item => item.name && Number.isFinite(item.amount) && item.amount > 0)

    if (!adjustmentStartMonth) {
      setError('New start month is required.')
      return
    }
    if (adjustmentStartMonth <= budget.start_month) {
      setError('New start month must be after the current budget start month.')
      return
    }
    if (items.length === 0) {
      setError('Add at least one budget item with a name and amount greater than zero.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.post(`/category-budgets/${budget.id}/adjust`, {
        start_month: adjustmentStartMonth,
        items,
      })
      const previous = res.data.previous as CategoryBudget
      const current = res.data.current as CategoryBudget
      setBudgets(prev => [...prev.filter(existing => existing.id !== budget.id), previous, current].sort((a, b) => a.category.localeCompare(b.category) || a.start_month.localeCompare(b.start_month)))
      setEditingBudgetId(null)
      setAdjustingBudgetId(null)
      setEditingBudgetItems([])
      setMessage(`${budget.category} budget adjusted from ${adjustmentStartMonth}. Previous months were preserved.`)
    } catch (e) {
      console.error(`Failed to adjust category budget ${budget.id}`, e)
      setError('Could not adjust category budget.')
    } finally {
      setSaving(false)
    }
  }

  function renderBudget(budget: CategoryBudget) {
    const items = budget.items && budget.items.length > 0 ? budget.items : [{ name: budget.category, amount: budget.amount }]
    const expanded = expandedBudgetId === budget.id
    const editing = editingBudgetId === budget.id
    const adjusting = adjustingBudgetId === budget.id

    return (
      <div key={budget.id} className="border-b border-[#EDF4EE] last:border-0">
        <div className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3">
          <button
            type="button"
            onClick={() => setExpandedBudgetId(current => current === budget.id ? null : budget.id)}
            className="flex-1 min-w-0 text-left"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-[#1B4D3E] truncate">{budget.category}</h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FDF5F5] text-[#B85050]">
                Budget
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#EDF4EE] text-[#1B4D3E]">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>
              {expanded ? <ChevronUp size={15} className="text-[#8BAE90]" /> : <ChevronDown size={15} className="text-[#8BAE90]" />}
            </div>
            <p className="text-sm text-[#7BAE8A] mt-1">
              Starts {budget.start_month} · {validUntilLabel(budget.valid_until || undefined)}
            </p>
          </button>
          <div className="flex items-center justify-between md:justify-end gap-4">
            <p className="text-lg font-bold tabular-nums text-[#B85050]">
              - {symbol(budget.currency)} {fmt(budget.amount, budget.currency)}
            </p>
            <button
              onClick={() => deleteBudget(budget)}
              disabled={saving}
              className="p-2 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-50"
              title="Delete category budget"
              aria-label={`Delete ${budget.category} budget`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mx-5 mb-4 rounded-lg border border-[#D4E4D5] bg-[#F9FCF9] overflow-hidden">
            {editing ? (
              <div className="p-3">
                {adjusting && (
                  <div className="mb-3 rounded-lg border border-[#D4E4D5] bg-white p-3">
                    <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">New value starts in</label>
                    <input
                      type="month"
                      value={adjustmentStartMonth}
                      onChange={e => setAdjustmentStartMonth(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                    />
                    <p className="mt-2 text-xs text-[#7BAE8A]">
                      FinDu will end the current budget the month before this date and create a new version.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  {editingBudgetItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-[1fr_120px_34px] gap-2">
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => updateEditingBudgetItem(index, { name: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={item.amount}
                        onChange={e => updateEditingBudgetItem(index, { amount: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeEditingBudgetItem(index)}
                        className="h-10 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition"
                        title="Remove budget item"
                        aria-label={`Remove ${item.name || `budget item ${index + 1}`}`}
                      >
                        <Trash2 size={14} className="mx-auto" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                  <button
                    type="button"
                    onClick={addEditingBudgetItem}
                    className="px-3 py-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] text-sm font-semibold hover:bg-[#F4FAF5] transition flex items-center gap-2"
                  >
                    <Plus size={14} />
                    Add Item
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBudgetId(null)
                        setAdjustingBudgetId(null)
                        setEditingBudgetItems([])
                      }}
                      className="px-3 py-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] text-sm font-semibold hover:bg-white transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => adjusting ? saveBudgetAdjustment(budget) : saveBudgetItems(budget)}
                      disabled={saving}
                      className="px-3 py-2 rounded-lg bg-[#1B4D3E] text-white text-sm font-semibold hover:bg-[#2D6A4F] transition disabled:opacity-50"
                    >
                      {adjusting ? 'Save New Version' : 'Save Items'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {items.map((item, index) => (
                  <div key={`${budget.id}-${item.name}-${index}`} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#EDF4EE] last:border-0">
                    <p className="text-sm font-semibold text-[#1B4D3E] truncate">{item.name}</p>
                    <p className="text-sm font-bold tabular-nums text-[#B85050]">
                      - {symbol(budget.currency)} {fmt(item.amount, budget.currency)}
                    </p>
                  </div>
                ))}
                <div className="px-4 py-3 bg-white">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => startEditingBudget(budget)}
                      className="py-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] text-sm font-semibold hover:bg-[#F4FAF5] transition"
                    >
                      Edit Current Version
                    </button>
                    <button
                      type="button"
                      onClick={() => startAdjustingBudget(budget)}
                      className="py-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] text-sm font-semibold hover:bg-[#F4FAF5] transition flex items-center justify-center gap-2"
                    >
                      <GitBranch size={14} />
                      Adjust From Month
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  function renderItem(item: RecurringExpense) {
    const isIncome = item.type === 'INCOME'
    const editingDates = editingItemId === item.id

    return (
      <div key={item.id} className="border-b border-[#EDF4EE] last:border-0">
        <div className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-[#1B4D3E] truncate">{item.name}</h3>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                isIncome ? 'bg-[#EDF4EE] text-[#1B6B3A]' : 'bg-[#FDF5F5] text-[#B85050]'
              }`}>
                {isIncome ? 'Income' : 'Expense'}
              </span>
            </div>
            <p className="text-sm text-[#7BAE8A] mt-1">
              {itemVerb(item.type)} day {item.due_day} · {item.category || 'No category'} · {startMonthLabel(item.start_month)} · {validUntilLabel(item.valid_until)}
            </p>
          </div>
          <div className="flex items-center justify-between md:justify-end gap-3">
            <p className={`text-lg font-bold tabular-nums ${isIncome ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>
              {isIncome ? '+' : '-'} {symbol(item.currency)} {fmt(item.amount, item.currency)}
            </p>
            <button
              type="button"
              onClick={() => editingDates ? cancelEditingItemDates() : startEditingItemDates(item)}
              disabled={saving}
              className="p-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] hover:bg-[#F4FAF5] transition disabled:opacity-50"
              title={editingDates ? 'Cancel date edit' : 'Edit start and end dates'}
              aria-label={editingDates ? `Cancel editing ${item.name}` : `Edit dates for ${item.name}`}
            >
              {editingDates ? <X size={16} /> : <Edit3 size={16} />}
            </button>
            <button
              onClick={() => deleteItem(item)}
              disabled={saving}
              className="p-2 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-50"
              title="Delete recurring item"
              aria-label={`Delete ${item.name}`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {editingDates && (
          <div className="mx-5 mb-4 rounded-lg border border-[#D4E4D5] bg-[#F9FCF9] p-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 sm:items-end">
              <div>
                <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Start month</label>
                <input
                  type="month"
                  value={editingItemDates.start_month}
                  onChange={e => setEditingItemDates(prev => ({ ...prev, start_month: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Valid until</label>
                <input
                  type="date"
                  value={editingItemDates.valid_until}
                  onChange={e => setEditingItemDates(prev => ({ ...prev, valid_until: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => saveItemDates(item)}
                disabled={saving}
                className="h-10 px-4 rounded-lg bg-[#1B4D3E] text-white text-sm font-semibold hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Save size={14} />
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const form = activeForm === 'INCOME' ? incomeForm : expenseForm
  const formCategories = activeForm === 'INCOME' ? INCOME_CATEGORIES : expenseCategories

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <p className="eyebrow mb-2">Monthly planning</p>
          <h1 className="text-3xl font-bold text-[#123D32]">Income, Fixed Costs & Budgets</h1>
          <p className="text-sm text-[#55705E] mt-1">See only what applies to the selected month. Past schedules stay in history.</p>
        </div>
        <button
          onClick={loadRecurring}
          disabled={loading || saving}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#123D32] text-sm font-semibold hover:bg-[#F4FAF5] disabled:opacity-50"
        >
          <RefreshCw size={15} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" aria-live="polite" className="mb-4 px-4 py-3 bg-[#FDF5F5] border border-[#B85050] rounded-lg text-sm text-[#B85050]">
          {error}
        </div>
      )}

      {message && (
        <div role="status" aria-live="polite" className="mb-4 px-4 py-3 bg-[#F4FAF5] border border-[#D4E4D5] rounded-lg text-sm text-[#1B4D3E]">
          {message}
        </div>
      )}

      <section aria-label="Plan filters" className="surface-card mb-5 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-2 sm:justify-start">
            <button type="button" onClick={() => setSelectedMonth(month => shiftMonth(month, -1))} aria-label="Previous month" className="grid size-10 place-items-center rounded-lg border border-[#D4E4D5] text-[#123D32] hover:bg-[#EDF4EE]"><ChevronLeft size={18} /></button>
            <div className="min-w-44 text-center">
              <p className="eyebrow">Plan for</p>
              <h2 className="text-xl font-bold text-[#123D32]">{monthName(selectedMonth)}</h2>
            </div>
            <button type="button" onClick={() => setSelectedMonth(month => shiftMonth(month, 1))} aria-label="Next month" className="grid size-10 place-items-center rounded-lg border border-[#D4E4D5] text-[#123D32] hover:bg-[#EDF4EE]"><ChevronRight size={18} /></button>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl bg-[#EDF4EE] p-1" aria-label="Currency">
            {CURRENCIES.map(currency => (
              <button key={currency} type="button" onClick={() => setSelectedCurrency(currency)} aria-pressed={selectedCurrency === currency} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${selectedCurrency === currency ? 'bg-white text-[#123D32] shadow-sm' : 'text-[#55705E] hover:text-[#123D32]'}`}>{currency}</button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="surface-card p-4"><p className="eyebrow">Fixed income</p><p className="money mt-2 text-xl font-bold text-[#236B4B]">+ {symbol(selectedCurrency)} {fmt(fixedIncomeTotal, selectedCurrency)}</p><p className="mt-1 text-xs text-[#55705E]">{incomeItems.length} guaranteed source{incomeItems.length === 1 ? '' : 's'}</p></div>
        <div className="surface-card p-4"><p className="eyebrow">Fixed expenses</p><p className="money mt-2 text-xl font-bold text-[#B54B4B]">- {symbol(selectedCurrency)} {fmt(fixedExpenseTotal, selectedCurrency)}</p><p className="mt-1 text-xs text-[#55705E]">{expenseItems.length} recurring bill{expenseItems.length === 1 ? '' : 's'}</p></div>
        <div className="surface-card p-4"><p className="eyebrow">Category budgets</p><p className="money mt-2 text-xl font-bold text-[#B54B4B]">- {symbol(selectedCurrency)} {fmt(categoryBudgetTotal, selectedCurrency)}</p><p className="mt-1 text-xs text-[#55705E]">{monthBudgets.length} spending area{monthBudgets.length === 1 ? '' : 's'}</p></div>
        <div className="rounded-2xl border border-[#123D32] bg-[#123D32] p-4 text-white"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">Total planned outflow</p><p className="money mt-2 text-xl font-bold text-[#D8B541]">- {symbol(selectedCurrency)} {fmt(totalMonthlyPlan, selectedCurrency)}</p><p className="mt-1 text-xs text-white/70">Fixed costs + flexible budgets</p></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6">
          <section className="surface-card overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EDF4EE]">
              <h2 className="section-title">Guaranteed Income</h2>
              <p className="text-sm text-[#55705E] mt-1">Expected every month during this schedule.</p>
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">Loading income...</div>
            ) : incomeItems.length === 0 ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">No recurring income yet.</div>
            ) : (
              <div>{incomeItems.map(renderItem)}</div>
            )}
          </section>

          <section className="surface-card overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EDF4EE]">
              <h2 className="section-title">Fixed Monthly Expenses</h2>
              <p className="text-sm text-[#55705E] mt-1">Bills with a predictable amount and due date.</p>
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">Loading expenses...</div>
            ) : expenseItems.length === 0 ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">No recurring expenses yet.</div>
            ) : (
              <div>{expenseItems.map(renderItem)}</div>
            )}
          </section>

          <section className="surface-card overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EDF4EE]">
              <h2 className="section-title">Flexible Spending Budgets</h2>
              <p className="text-sm text-[#55705E] mt-1">Monthly limits for spending areas such as food, coffee, and education.</p>
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">Loading budgets...</div>
            ) : monthBudgets.length === 0 ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">No monthly category budgets yet.</div>
            ) : (
              <div>{monthBudgets.map(renderBudget)}</div>
            )}
          </section>

          {(pastItems.length > 0 || pastBudgets.length > 0) && (
            <section className="surface-card overflow-hidden">
              <button type="button" onClick={() => setShowPastSchedules(value => !value)} aria-expanded={showPastSchedules} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F4FAF5]">
                <div className="flex items-center gap-3"><Archive size={18} className="text-[#55705E]" /><div><h2 className="section-title">Past Schedules</h2><p className="text-sm text-[#55705E]">{pastItems.length + pastBudgets.length} ended before {monthName(selectedMonth)}</p></div></div>
                {showPastSchedules ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {showPastSchedules && <div className="border-t border-[#EDF4EE]">{pastItems.map(renderItem)}{pastBudgets.map(renderBudget)}</div>}
            </section>
          )}
        </div>

        <div className="space-y-6">
          <form onSubmit={createItem} className="surface-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <Plus size={18} className="text-[#1B4D3E]" />
              <p className="text-sm font-bold text-[#1B4D3E]">Add Recurring Item</p>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-5">
            {(['EXPENSE', 'INCOME'] as RecurringType[]).map(type => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setActiveForm(type)
                  setError('')
                  setMessage('')
                }}
                className={`py-2 rounded-lg text-sm font-semibold transition ${
                  activeForm === type
                    ? 'bg-[#1B4D3E] text-white'
                    : 'bg-[#F4FAF5] text-[#1B4D3E] hover:bg-[#EDF4EE]'
                }`}
              >
                {type === 'EXPENSE' ? 'Expense' : 'Income'}
              </button>
            ))}
            </div>

            <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Name</label>
          <input
            value={form.name}
            onChange={e => updateCurrentForm({ name: e.target.value })}
            placeholder={activeForm === 'INCOME' ? 'Doug Salary' : 'Rent, Netflix'}
            className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Amount</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={form.amount}
                onChange={e => updateCurrentForm({ amount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Currency</label>
              <select
                value={form.currency}
                onChange={e => updateCurrentForm({ currency: e.target.value as Currency })}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              >
                {CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">
                {activeForm === 'INCOME' ? 'Receive day' : 'Due day'}
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.due_day}
                onChange={e => updateCurrentForm({ due_day: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Category</label>
              <select
                value={form.category}
                onChange={e => updateCurrentForm({ category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              >
                {formCategories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Start month</label>
              <div className="relative mb-5">
                <CalendarDays size={15} className="absolute left-3 top-2.5 text-[#8BAE90]" />
                <input
                  type="month"
                  value={form.start_month}
                  onChange={e => updateCurrentForm({ start_month: e.target.value })}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Valid until</label>
              <div className="relative mb-5">
                <CalendarDays size={15} className="absolute left-3 top-2.5 text-[#8BAE90]" />
                <input
                  type="date"
                  value={form.valid_until}
                  onChange={e => updateCurrentForm({ valid_until: e.target.value })}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                />
              </div>
            </div>
          </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              Add {activeForm === 'INCOME' ? 'Income' : 'Expense'}
            </button>
          </form>

          <form onSubmit={createBudget} className="surface-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <Plus size={18} className="text-[#1B4D3E]" />
              <p className="text-sm font-bold text-[#1B4D3E]">Add Category Budget</p>
            </div>

            <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Category</label>
            <select
              value={budgetForm.category}
              onChange={e => setBudgetForm(prev => ({ ...prev, category: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
            >
              {expenseOnlyCategories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>

            <div className="mb-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Budget items</label>
                <p className="text-sm font-bold text-[#1B4D3E]">
                  Total {symbol(budgetForm.currency)} {fmt(budgetFormTotal, budgetForm.currency)}
                </p>
              </div>

              <div className="space-y-2">
                {budgetForm.items.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_110px_34px] gap-2">
                    <input
                      type="text"
                      value={item.name}
                      onChange={e => updateBudgetItem(index, { name: e.target.value })}
                      placeholder={index === 0 ? 'Academia' : 'Item name'}
                      className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={item.amount}
                      onChange={e => updateBudgetItem(index, { amount: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeBudgetItem(index)}
                      className="h-10 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition"
                      title="Remove budget item"
                      aria-label={`Remove budget item ${index + 1}`}
                    >
                      <Trash2 size={14} className="mx-auto" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addBudgetItem}
                className="mt-2 w-full py-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] text-sm font-semibold hover:bg-[#F4FAF5] transition flex items-center justify-center gap-2"
              >
                <Plus size={14} />
                Add Item
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Currency</label>
              <select
                value={budgetForm.currency}
                onChange={e => setBudgetForm(prev => ({ ...prev, currency: e.target.value as Currency }))}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              >
                {CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </div>

            <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Start month</label>
            <input
              type="month"
              value={budgetForm.start_month}
              onChange={e => setBudgetForm(prev => ({ ...prev, start_month: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
            />

            <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Valid until</label>
            <div className="relative mb-5">
              <CalendarDays size={15} className="absolute left-3 top-2.5 text-[#8BAE90]" />
              <input
                type="date"
                value={budgetForm.valid_until}
                onChange={e => setBudgetForm(prev => ({ ...prev, valid_until: e.target.value }))}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              Add Budget
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
