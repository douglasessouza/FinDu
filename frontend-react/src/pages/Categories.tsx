import { useEffect, useMemo, useState } from 'react'
import { Lock, Plus, RefreshCw, Search, Tag, Trash2 } from 'lucide-react'
import api from '../services/api'
import type { Category } from '../services/api'

type CategoryType = 'EXPENSE' | 'INCOME' | 'TRANSFER'
type TypeFilter = CategoryType | 'ALL'

const CATEGORY_TYPES: CategoryType[] = ['EXPENSE', 'INCOME', 'TRANSFER']

const TYPE_LABELS: Record<CategoryType, string> = {
  EXPENSE: 'Expense',
  INCOME: 'Income',
  TRANSFER: 'Transfer',
}

const TYPE_DESCRIPTIONS: Record<CategoryType, string> = {
  EXPENSE: 'Spending buckets used in imports, transactions, and analysis.',
  INCOME: 'Money coming in, such as payroll or reimbursements.',
  TRANSFER: 'Movements between your own accounts.',
}

const EMPTY_FORM = {
  name: '',
  type: 'EXPENSE' as CategoryType,
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function typeClasses(type: CategoryType): string {
  if (type === 'INCOME') return 'bg-[#EDF7EF] text-[#1B6B3A] border-[#CFE6D4]'
  if (type === 'TRANSFER') return 'bg-[#F4F3FF] text-[#4F46A5] border-[#DDD9FF]'
  return 'bg-[#FDF5F5] text-[#B85050] border-[#F0CCCC]'
}

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [form, setForm] = useState(EMPTY_FORM)

  async function loadCategories() {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/categories')
      setCategories(res.data as Category[])
    } catch (e) {
      console.error('Failed to load categories', e)
      setError('Could not load categories.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    async function loadInitialCategories() {
      setError('')
      try {
        const res = await api.get('/categories')
        if (!active) return
        setCategories(res.data as Category[])
      } catch (e) {
        if (!active) return
        console.error('Failed to load categories', e)
        setError('Could not load categories.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadInitialCategories()
    return () => { active = false }
  }, [])

  const stats = useMemo(() => {
    return categories.reduce<Record<CategoryType | 'DEFAULT' | 'CUSTOM', number>>((totals, category) => {
      totals[category.type] += 1
      totals[category.is_default ? 'DEFAULT' : 'CUSTOM'] += 1
      return totals
    }, { EXPENSE: 0, INCOME: 0, TRANSFER: 0, DEFAULT: 0, CUSTOM: 0 })
  }, [categories])

  const filteredCategories = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return categories.filter(category => {
      const matchesType = typeFilter === 'ALL' || category.type === typeFilter
      const matchesQuery = !needle || category.name.toLowerCase().includes(needle)
      return matchesType && matchesQuery
    })
  }, [categories, query, typeFilter])

  const groupedCategories = useMemo(() => {
    return CATEGORY_TYPES.reduce<Record<CategoryType, Category[]>>((groups, type) => {
      groups[type] = filteredCategories
        .filter(category => category.type === type)
        .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name))
      return groups
    }, { EXPENSE: [], INCOME: [], TRANSFER: [] })
  }, [filteredCategories])

  async function createCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = normalizeName(form.name)

    if (!name) {
      setError('Category name is required.')
      return
    }

    const exists = categories.some(category => category.name.toLowerCase() === name.toLowerCase())
    if (exists) {
      setError('Category already exists.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.post('/categories', { name, type: form.type })
      setCategories(prev => [...prev, res.data as Category].sort((a, b) => a.name.localeCompare(b.name)))
      setForm(EMPTY_FORM)
      setTypeFilter(form.type)
      setQuery('')
      setMessage(`${name} added.`)
    } catch (e) {
      console.error('Failed to create category', e)
      setError('Could not create category. It may already exist.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCategory(category: Category) {
    if (category.is_default) return
    const confirmed = window.confirm(`Delete ${category.name}? Existing transactions will keep their current category text.`)
    if (!confirmed) return

    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api.delete(`/categories/${category.id}`)
      setCategories(prev => prev.filter(existing => existing.id !== category.id))
      setMessage(`${category.name} deleted.`)
    } catch (e) {
      console.error(`Failed to delete category ${category.id}`, e)
      setError('Could not delete category.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E] flex items-center gap-2">
            <Tag size={24} />
            Categories
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">Manage the labels used by imports, reports, recurring items, and transaction edits.</p>
        </div>
        <button
          onClick={loadCategories}
          disabled={loading || saving}
          className="self-start lg:self-auto px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold hover:bg-[#F4FAF5] transition disabled:opacity-50 flex items-center gap-2"
        >
          <RefreshCw size={15} />
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

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Total</p>
          <p className="text-2xl font-bold text-[#1B4D3E] mt-1">{categories.length}</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Default</p>
          <p className="text-2xl font-bold text-[#1B4D3E] mt-1">{stats.DEFAULT}</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Custom</p>
          <p className="text-2xl font-bold text-[#1B4D3E] mt-1">{stats.CUSTOM}</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Expense</p>
          <p className="text-2xl font-bold text-[#B85050] mt-1">{stats.EXPENSE}</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Income</p>
          <p className="text-2xl font-bold text-[#1B6B3A] mt-1">{stats.INCOME}</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Transfer</p>
          <p className="text-2xl font-bold text-[#4F46A5] mt-1">{stats.TRANSFER}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-4">
          <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-3 text-[#8BAE90]" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search categories"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-4 lg:flex gap-2">
                {(['ALL', ...CATEGORY_TYPES] as TypeFilter[]).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTypeFilter(type)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                      typeFilter === type
                        ? 'bg-[#1B4D3E] text-white'
                        : 'bg-[#F4FAF5] text-[#1B4D3E] hover:bg-[#EDF4EE]'
                    }`}
                  >
                    {type === 'ALL' ? 'All' : TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="bg-white border border-[#D4E4D5] rounded-xl px-5 py-12 text-center text-[#8BAE90]">
              Loading categories...
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="bg-white border border-[#D4E4D5] rounded-xl px-5 py-12 text-center text-[#8BAE90]">
              No categories match this filter.
            </div>
          ) : (
            CATEGORY_TYPES.map(type => {
              const sectionCategories = groupedCategories[type]
              if (sectionCategories.length === 0) return null

              return (
                <section key={type} className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#EDF4EE] flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="section-title">{TYPE_LABELS[type]}</p>
                      <p className="text-sm text-[#7BAE8A] mt-1">{TYPE_DESCRIPTIONS[type]}</p>
                    </div>
                    <span className={`self-start md:self-auto text-xs font-bold px-3 py-1 rounded-full border ${typeClasses(type)}`}>
                      {sectionCategories.length} item{sectionCategories.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="divide-y divide-[#EDF4EE]">
                    {sectionCategories.map(category => (
                      <div key={category.id} className="px-5 py-4 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-[#1B4D3E] truncate">{category.name}</p>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${typeClasses(category.type)}`}>
                              {TYPE_LABELS[category.type]}
                            </span>
                          </div>
                          <p className="text-sm text-[#7BAE8A] mt-1">
                            {category.is_default ? 'Default category protected from deletion.' : 'Custom category.'}
                          </p>
                        </div>
                        {category.is_default ? (
                          <span className="p-2 rounded-lg border border-[#D4E4D5] text-[#8BAE90]" title="Default category">
                            <Lock size={16} />
                          </span>
                        ) : (
                          <button
                            onClick={() => deleteCategory(category)}
                            disabled={saving}
                            className="p-2 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-50"
                            title="Delete category"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </div>

        <form onSubmit={createCategory} className="bg-white border border-[#D4E4D5] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <Plus size={18} className="text-[#1B4D3E]" />
            <p className="text-sm font-bold text-[#1B4D3E]">Add Category</p>
          </div>

          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Name</label>
          <input
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Rent, Groceries, Pet"
            className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
          />

          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Type</label>
          <div className="grid grid-cols-1 gap-2 mb-5">
            {CATEGORY_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setForm(prev => ({ ...prev, type }))}
                className={`px-4 py-3 rounded-lg border text-left transition ${
                  form.type === type
                    ? 'border-[#1B4D3E] bg-[#F4FAF5]'
                    : 'border-[#D4E4D5] bg-white hover:bg-[#F4FAF5]'
                }`}
              >
                <span className="block text-sm font-bold text-[#1B4D3E]">{TYPE_LABELS[type]}</span>
                <span className="block text-xs text-[#7BAE8A] mt-1">{TYPE_DESCRIPTIONS[type]}</span>
              </button>
            ))}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add Category
          </button>
        </form>
      </div>
    </div>
  )
}
