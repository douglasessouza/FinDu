import { useEffect, useMemo, useState } from 'react'
import { Check, CreditCard, Edit3, Plus, Trash2, X } from 'lucide-react'
import api from '../services/api'
import type { Account } from '../services/api'

type Currency = 'BRL' | 'CAD' | 'USD' | 'EUR'

const CURRENCIES: Currency[] = ['CAD', 'BRL', 'USD', 'EUR']

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

function monthLabel(date: Date): string {
  return date.toLocaleString('en', { month: 'short', year: 'numeric' })
}

function dateLabel(date: Date): string {
  return date.toLocaleString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortDateLabel(date: Date): string {
  return date.toLocaleString('en', { month: 'short', day: 'numeric' })
}

function safeDate(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  return new Date(year, monthIndex, Math.min(day, lastDay))
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

function getCurrentCycle(card: Account) {
  const closingDay = card.closing_day
  const dueDay = card.due_day
  if (!closingDay || !dueDay) return null

  const today = new Date()
  const cycleStartDay = closingDay < 28 ? closingDay + 1 : closingDay
  const previousMonth = addMonths(today, -1)
  const paymentMonth = addMonths(today, 1)
  const cycleStart = safeDate(previousMonth.getFullYear(), previousMonth.getMonth(), cycleStartDay)
  const cycleEnd = safeDate(today.getFullYear(), today.getMonth(), closingDay)
  const paymentDue = safeDate(paymentMonth.getFullYear(), paymentMonth.getMonth(), dueDay)
  const isClosed = today.getDate() >= closingDay

  return {
    cycle: `${shortDateLabel(cycleStart)} -> ${shortDateLabel(cycleEnd)}`,
    status: isClosed ? 'Closed' : 'Open',
    chargesIn: monthLabel(today),
    cashFlowIn: monthLabel(paymentDue),
    paymentDue: dateLabel(paymentDue),
  }
}

interface CardForm {
  name: string
  bank: string
  currency: Currency
  credit_limit: string
  balance: string
  closing_day: string
  due_day: string
}

interface EditDraft {
  credit_limit: string
  closing_day: string
  due_day: string
}

const EMPTY_FORM: CardForm = {
  name: '',
  bank: '',
  currency: 'CAD',
  credit_limit: '0',
  balance: '0',
  closing_day: '1',
  due_day: '10',
}

function validDay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31
}

export default function CreditCards() {
  const [cards, setCards] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<EditDraft>({ credit_limit: '0', closing_day: '1', due_day: '10' })
  const [form, setForm] = useState<CardForm>(EMPTY_FORM)

  async function loadCards() {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/accounts')
      setCards((res.data as Account[]).filter(a => a.account_type === 'CREDIT_CARD'))
    } catch (e) {
      console.error('Failed to load credit cards', e)
      setError('Could not load credit cards.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    async function loadInitialCards() {
      setError('')
      try {
        const res = await api.get('/accounts')
        if (!active) return
        setCards((res.data as Account[]).filter(a => a.account_type === 'CREDIT_CARD'))
      } catch (e) {
        if (!active) return
        console.error('Failed to load credit cards', e)
        setError('Could not load credit cards.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadInitialCards()
    return () => { active = false }
  }, [])

  const totals = useMemo(() => {
    return cards.reduce<Record<string, { limit: number; owed: number }>>((acc, card) => {
      const current = acc[card.currency] || { limit: 0, owed: 0 }
      current.limit += card.credit_limit || 0
      current.owed += Math.max(card.balance || 0, 0)
      acc[card.currency] = current
      return acc
    }, {})
  }, [cards])

  function startEdit(card: Account) {
    setEditingId(card.id)
    setDraft({
      credit_limit: String(card.credit_limit || 0),
      closing_day: String(card.closing_day || 1),
      due_day: String(card.due_day || 10),
    })
    setError('')
    setMessage('')
  }

  function cancelEdit() {
    setEditingId(null)
  }

  function validateCardNumbers(limit: number, closing: number, due: number): string | null {
    if (!Number.isFinite(limit) || limit < 0) return 'Credit limit must be zero or greater.'
    if (!validDay(closing)) return 'Closing day must be between 1 and 31.'
    if (!validDay(due)) return 'Due day must be between 1 and 31.'
    return null
  }

  async function saveCard(card: Account) {
    const creditLimit = Number(draft.credit_limit || 0)
    const closingDay = Number(draft.closing_day)
    const dueDay = Number(draft.due_day)
    const validation = validateCardNumbers(creditLimit, closingDay, dueDay)
    if (validation) {
      setError(validation)
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.patch(`/accounts/${card.id}`, {
        credit_limit: creditLimit,
        closing_day: closingDay,
        due_day: dueDay,
      })
      const updated = res.data as Account
      setCards(prev => prev.map(c => c.id === card.id ? updated : c))
      setEditingId(null)
      setMessage(`${card.name} updated.`)
    } catch (e) {
      console.error(`Failed to update card ${card.id}`, e)
      setError('Could not save credit card.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCard(card: Account) {
    const confirmed = window.confirm(`Delete ${card.name}? This cannot be undone.`)
    if (!confirmed) return

    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api.delete(`/accounts/${card.id}`)
      setCards(prev => prev.filter(c => c.id !== card.id))
      setMessage(`${card.name} deleted.`)
    } catch (e) {
      console.error(`Failed to delete card ${card.id}`, e)
      setError('Could not delete credit card. Check if it has linked transactions first.')
    } finally {
      setSaving(false)
    }
  }

  async function createCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const creditLimit = Number(form.credit_limit || 0)
    const balance = Number(form.balance || 0)
    const closingDay = Number(form.closing_day)
    const dueDay = Number(form.due_day)
    const validation = validateCardNumbers(creditLimit, closingDay, dueDay)

    if (!form.name.trim() || !form.bank.trim()) {
      setError('Card name and bank are required.')
      return
    }
    if (validation) {
      setError(validation)
      return
    }
    if (!Number.isFinite(balance) || balance < 0) {
      setError('Current balance must be zero or greater.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.post('/accounts', {
        name: form.name.trim(),
        bank: form.bank.trim(),
        account_type: 'CREDIT_CARD',
        currency: form.currency,
        balance,
        credit_limit: creditLimit,
        closing_day: closingDay,
        due_day: dueDay,
      })
      setCards(prev => [...prev, res.data as Account].sort((a, b) => a.name.localeCompare(b.name)))
      setForm(EMPTY_FORM)
      setMessage('Credit card created.')
    } catch (e) {
      console.error('Failed to create credit card', e)
      setError('Could not create credit card.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E] flex items-center gap-2">
            <CreditCard size={25} />
            Credit Cards
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">
            Based on today: {new Date().toLocaleString('en', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <button
          onClick={loadCards}
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
          const total = totals[currency] || { limit: 0, owed: 0 }
          const available = Math.max(total.limit - total.owed, 0)
          const utilization = total.limit > 0 ? Math.round((total.owed / total.limit) * 100) : 0

          return (
            <div key={currency} className="bg-white border border-[#D4E4D5] rounded-xl p-4">
              <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">{currency}</p>
              <p className="text-xl font-bold text-[#1B4D3E] mt-1">{symbol(currency)} {fmt(total.limit, currency)}</p>
              <div className="flex justify-between text-xs mt-2 text-[#7BAE8A]">
                <span>Owed {symbol(currency)} {fmt(total.owed, currency)}</span>
                <span>{utilization}% used</span>
              </div>
              <div className="h-1.5 bg-[#EDF4EE] rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-[#E8C84A]" style={{ width: `${Math.min(utilization, 100)}%` }} />
              </div>
              <p className="text-xs text-[#8BAE90] mt-2">Available {symbol(currency)} {fmt(available, currency)}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">
        <section className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#EDF4EE]">
            <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">Cards</p>
            <p className="text-sm text-[#7BAE8A] mt-1">{cards.length} active credit card{cards.length === 1 ? '' : 's'}</p>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-center text-[#8BAE90]">Loading credit cards...</div>
          ) : cards.length === 0 ? (
            <div className="px-5 py-10 text-center text-[#8BAE90]">No credit cards yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EDF4EE] bg-[#F9FCF9]">
                    <th className="text-left py-3 px-4 text-[#8BAE90] font-semibold uppercase tracking-widest text-xs">Card</th>
                    <th className="text-right py-3 px-4 text-[#8BAE90] font-semibold uppercase tracking-widest text-xs">Limit</th>
                    <th className="text-left py-3 px-4 text-[#8BAE90] font-semibold uppercase tracking-widest text-xs">Cycle</th>
                    <th className="text-left py-3 px-4 text-[#8BAE90] font-semibold uppercase tracking-widest text-xs">Status</th>
                    <th className="text-left py-3 px-4 text-[#8BAE90] font-semibold uppercase tracking-widest text-xs">Cash Flow In</th>
                    <th className="text-left py-3 px-4 text-[#8BAE90] font-semibold uppercase tracking-widest text-xs">Payment Due</th>
                    <th className="text-right py-3 px-4 text-[#8BAE90] font-semibold uppercase tracking-widest text-xs">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map(card => {
                    const cycle = getCurrentCycle(card)
                    const isEditing = editingId === card.id

                    return (
                      <tr key={card.id} className="border-b border-[#EDF4EE] last:border-0 align-top">
                        <td className="py-4 px-4 min-w-48">
                          <p className="font-bold text-[#1B4D3E]">{card.name}</p>
                          <p className="text-xs text-[#7BAE8A] mt-1">{card.bank} · {card.currency}</p>
                          <p className="text-xs text-[#8BAE90] mt-1">Closes day {card.closing_day || '-'} · Due day {card.due_day || '-'}</p>
                        </td>
                        <td className="py-4 px-4 text-right min-w-32">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.01"
                              value={draft.credit_limit}
                              onChange={e => setDraft(prev => ({ ...prev, credit_limit: e.target.value }))}
                              className="w-28 px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold text-right focus:outline-none"
                            />
                          ) : (
                            <>
                              <p className="font-bold text-[#1B4D3E] tabular-nums">{symbol(card.currency)} {fmt(card.credit_limit || 0, card.currency)}</p>
                              <p className="text-xs text-[#B85050] mt-1">Owed {symbol(card.currency)} {fmt(Math.max(card.balance || 0, 0), card.currency)}</p>
                            </>
                          )}
                        </td>
                        <td className="py-4 px-4 min-w-36">
                          {isEditing ? (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="number"
                                min={1}
                                max={31}
                                value={draft.closing_day}
                                onChange={e => setDraft(prev => ({ ...prev, closing_day: e.target.value }))}
                                className="w-20 px-2 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                                title="Closing day"
                              />
                              <input
                                type="number"
                                min={1}
                                max={31}
                                value={draft.due_day}
                                onChange={e => setDraft(prev => ({ ...prev, due_day: e.target.value }))}
                                className="w-20 px-2 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none"
                                title="Due day"
                              />
                            </div>
                          ) : (
                            <>
                              <p className="font-semibold text-[#1B4D3E]">{cycle?.cycle || '-'}</p>
                              <p className="text-xs text-[#8BAE90] mt-1">Charges in {cycle?.chargesIn || '-'}</p>
                            </>
                          )}
                        </td>
                        <td className="py-4 px-4 min-w-24">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${
                            cycle?.status === 'Open'
                              ? 'bg-[#EDF4EE] text-[#1B6B3A]'
                              : 'bg-[#F5EFE0] text-[#8A6D1D]'
                          }`}>
                            {cycle?.status || '-'}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-[#1B4D3E] font-semibold min-w-28">{cycle?.cashFlowIn || '-'}</td>
                        <td className="py-4 px-4 text-[#1B4D3E] font-semibold min-w-36">{cycle?.paymentDue || '-'}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center justify-end gap-2">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => saveCard(card)}
                                  disabled={saving}
                                  className="p-2 rounded-lg bg-[#1B4D3E] text-white hover:bg-[#2D6A4F] transition disabled:opacity-50"
                                  title="Save card"
                                >
                                  <Check size={16} />
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  disabled={saving}
                                  className="p-2 rounded-lg border border-[#D4E4D5] text-[#8BAE90] hover:bg-[#F4FAF5] transition disabled:opacity-50"
                                  title="Cancel"
                                >
                                  <X size={16} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(card)}
                                  disabled={saving}
                                  className="p-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] hover:bg-[#F4FAF5] transition disabled:opacity-50"
                                  title="Edit card"
                                >
                                  <Edit3 size={16} />
                                </button>
                                <button
                                  onClick={() => deleteCard(card)}
                                  disabled={saving}
                                  className="p-2 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-50"
                                  title="Delete card"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <form onSubmit={createCard} className="bg-white border border-[#D4E4D5] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <Plus size={18} className="text-[#1B4D3E]" />
            <p className="text-sm font-bold text-[#1B4D3E]">Add Credit Card</p>
          </div>

          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Card name</label>
          <input
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Amex Cobalt"
            className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
          />

          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Bank</label>
          <input
            value={form.bank}
            onChange={e => setForm(prev => ({ ...prev, bank: e.target.value }))}
            placeholder="Amex"
            className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
          />

          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Currency</label>
          <select
            value={form.currency}
            onChange={e => setForm(prev => ({ ...prev, currency: e.target.value as Currency }))}
            className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
          >
            {CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Credit limit</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={form.credit_limit}
                onChange={e => setForm(prev => ({ ...prev, credit_limit: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Current balance</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={form.balance}
                onChange={e => setForm(prev => ({ ...prev, balance: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Closing day</label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.closing_day}
                onChange={e => setForm(prev => ({ ...prev, closing_day: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-5"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Due day</label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.due_day}
                onChange={e => setForm(prev => ({ ...prev, due_day: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-5"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add Credit Card
          </button>
        </form>
      </div>
    </div>
  )
}
