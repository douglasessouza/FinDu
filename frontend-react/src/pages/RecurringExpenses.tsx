import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Plus, RefreshCw, Trash2 } from 'lucide-react'
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

function itemVerb(type: RecurringType): string {
  return type === 'INCOME' ? 'Receive' : 'Due'
}

interface RecurringForm {
  name: string
  amount: string
  currency: Currency
  due_day: string
  category: string
  valid_until: string
}

interface BudgetForm {
  category: string
  amount: string
  currency: Currency
  start_month: string
  valid_until: string
}

const EXPENSE_FORM: RecurringForm = {
  name: '',
  amount: '0',
  currency: 'CAD',
  due_day: '1',
  category: '',
  valid_until: '',
}

const INCOME_FORM: RecurringForm = {
  name: '',
  amount: '0',
  currency: 'CAD',
  due_day: '1',
  category: 'Salary',
  valid_until: '',
}

const EMPTY_BUDGET_FORM: BudgetForm = {
  category: '',
  amount: '0',
  currency: 'CAD',
  start_month: new Date().toISOString().slice(0, 7),
  valid_until: '',
}

function validDay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31
}

export default function RecurringExpenses() {
  const [items, setItems] = useState<RecurringExpense[]>([])
  const [budgets, setBudgets] = useState<CategoryBudget[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [expenseOnlyCategories, setExpenseOnlyCategories] = useState<string[]>([])
  const [activeForm, setActiveForm] = useState<RecurringType>('EXPENSE')
  const [expenseForm, setExpenseForm] = useState<RecurringForm>(EXPENSE_FORM)
  const [incomeForm, setIncomeForm] = useState<RecurringForm>(INCOME_FORM)
  const [budgetForm, setBudgetForm] = useState<BudgetForm>(EMPTY_BUDGET_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const incomeItems = items.filter(item => item.type === 'INCOME')
  const expenseItems = items.filter(item => item.type !== 'INCOME')
  const expenseCategories = categories.length > 0 ? categories : ['Housing', 'Food', 'Transport', 'Other']

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

  const totalsByCurrency = useMemo(() => {
    return items.reduce<Record<string, { income: number; expenses: number }>>((totals, item) => {
      const current = totals[item.currency] || { income: 0, expenses: 0 }
      if (item.type === 'INCOME') current.income += item.amount
      else current.expenses += item.amount
      totals[item.currency] = current
      return totals
    }, {})
  }, [items])

  const budgetTotalsByCurrency = useMemo(() => {
    return budgets.reduce<Record<string, number>>((totals, budget) => {
      totals[budget.currency] = (totals[budget.currency] || 0) + budget.amount
      return totals
    }, {})
  }, [budgets])

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
    const amount = Number(budgetForm.amount)

    if (!budgetForm.category) {
      setError('Budget category is required.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Budget amount must be greater than zero.')
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
        amount,
        currency: budgetForm.currency,
        start_month: budgetForm.start_month,
        valid_until: budgetForm.valid_until ? `${budgetForm.valid_until}T00:00:00` : null,
      })
      setBudgets(prev => [...prev, res.data as CategoryBudget].sort((a, b) => a.category.localeCompare(b.category)))
      setBudgetForm(prev => ({ ...prev, amount: '0', valid_until: '' }))
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

  function renderBudget(budget: CategoryBudget) {
    return (
      <div key={budget.id} className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3 border-b border-[#EDF4EE] last:border-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-[#1B4D3E] truncate">{budget.category}</h3>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FDF5F5] text-[#B85050]">
              Budget
            </span>
          </div>
          <p className="text-sm text-[#7BAE8A] mt-1">
            Starts {budget.start_month} · {validUntilLabel(budget.valid_until || undefined)}
          </p>
        </div>
        <div className="flex items-center justify-between md:justify-end gap-4">
          <p className="text-lg font-bold tabular-nums text-[#B85050]">
            - {symbol(budget.currency)} {fmt(budget.amount, budget.currency)}
          </p>
          <button
            onClick={() => deleteBudget(budget)}
            disabled={saving}
            className="p-2 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-50"
            title="Delete category budget"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    )
  }

  function renderItem(item: RecurringExpense) {
    const isIncome = item.type === 'INCOME'

    return (
      <div key={item.id} className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3 border-b border-[#EDF4EE] last:border-0">
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
            {itemVerb(item.type)} day {item.due_day} · {item.category || 'No category'} · {validUntilLabel(item.valid_until)}
          </p>
        </div>
        <div className="flex items-center justify-between md:justify-end gap-4">
          <p className={`text-lg font-bold tabular-nums ${isIncome ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>
            {isIncome ? '+' : '-'} {symbol(item.currency)} {fmt(item.amount, item.currency)}
          </p>
          <button
            onClick={() => deleteItem(item)}
            disabled={saving}
            className="p-2 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-50"
            title="Delete recurring item"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    )
  }

  const form = activeForm === 'INCOME' ? incomeForm : expenseForm
  const formCategories = activeForm === 'INCOME' ? INCOME_CATEGORIES : expenseCategories

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E] flex items-center gap-2">
            <RefreshCw size={24} />
            Recurring Expenses & Income
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">Track fixed monthly bills, payroll, and temporary recurring items.</p>
        </div>
        <button
          onClick={loadRecurring}
          disabled={loading || saving}
          className="px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold hover:bg-[#F4FAF5] transition disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-[#FDF5F5] border border-[#B85050] rounded-lg text-sm text-[#B85050]">
          {error}
        </div>
      )}

      {message && (
        <div className="mb-4 px-4 py-3 bg-[#F4FAF5] border border-[#D4E4D5] rounded-lg text-sm text-[#1B4D3E]">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {CURRENCIES.map(currency => {
          const total = totalsByCurrency[currency] || { income: 0, expenses: 0 }
          const budgetTotal = budgetTotalsByCurrency[currency] || 0
          const net = total.income - total.expenses - budgetTotal

          return (
            <div key={currency} className="bg-white border border-[#D4E4D5] rounded-xl p-4">
              <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">{currency}</p>
              <p className={`text-xl font-bold mt-1 ${net >= 0 ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>
                {symbol(currency)} {fmt(net, currency)}
              </p>
              <div className="flex justify-between text-xs text-[#7BAE8A] mt-2">
                <span>Income {symbol(currency)} {fmt(total.income, currency)}</span>
                <span>Outflow {symbol(currency)} {fmt(total.expenses + budgetTotal, currency)}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6">
          <section className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EDF4EE]">
              <p className="section-title">Income</p>
              <p className="text-sm text-[#7BAE8A] mt-1">{incomeItems.length} active recurring income item{incomeItems.length === 1 ? '' : 's'}</p>
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">Loading income...</div>
            ) : incomeItems.length === 0 ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">No recurring income yet.</div>
            ) : (
              <div>{incomeItems.map(renderItem)}</div>
            )}
          </section>

          <section className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EDF4EE]">
              <p className="section-title">Expenses</p>
              <p className="text-sm text-[#7BAE8A] mt-1">{expenseItems.length} active recurring expense{expenseItems.length === 1 ? '' : 's'}</p>
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">Loading expenses...</div>
            ) : expenseItems.length === 0 ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">No recurring expenses yet.</div>
            ) : (
              <div>{expenseItems.map(renderItem)}</div>
            )}
          </section>

          <section className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EDF4EE]">
              <p className="section-title">Monthly Category Budgets</p>
              <p className="text-sm text-[#7BAE8A] mt-1">{budgets.length} active category budget{budgets.length === 1 ? '' : 's'}</p>
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">Loading budgets...</div>
            ) : budgets.length === 0 ? (
              <div className="px-5 py-10 text-center text-[#8BAE90]">No monthly category budgets yet.</div>
            ) : (
              <div>{budgets.map(renderBudget)}</div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <form onSubmit={createItem} className="bg-white border border-[#D4E4D5] rounded-xl p-5">
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

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              Add {activeForm === 'INCOME' ? 'Income' : 'Expense'}
            </button>
          </form>

          <form onSubmit={createBudget} className="bg-white border border-[#D4E4D5] rounded-xl p-5">
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={budgetForm.amount}
                  onChange={e => setBudgetForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
                />
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
