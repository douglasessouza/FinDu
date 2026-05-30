import { useEffect, useMemo, useState } from 'react'
import { Building2, Check, Edit3, Plus, Trash2, X } from 'lucide-react'
import api from '../services/api'
import type { Account } from '../services/api'

type AccountType = 'CHECKING' | 'SAVINGS'
type Currency = 'BRL' | 'CAD' | 'USD' | 'EUR'

const CURRENCIES: Currency[] = ['CAD', 'BRL', 'USD', 'EUR']
const ACCOUNT_TYPES: AccountType[] = ['CHECKING', 'SAVINGS']

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

function accountTypeLabel(type: string): string {
  return type === 'SAVINGS' ? 'Savings' : 'Checking'
}

interface AccountForm {
  name: string
  bank: string
  account_type: AccountType
  currency: Currency
  balance: string
}

const EMPTY_FORM: AccountForm = {
  name: '',
  bank: '',
  account_type: 'CHECKING',
  currency: 'CAD',
  balance: '0',
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [balanceDraft, setBalanceDraft] = useState('')
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM)

  async function loadAccounts() {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/accounts')
      setAccounts((res.data as Account[]).filter(a => a.account_type !== 'CREDIT_CARD'))
    } catch (e) {
      console.error('Failed to load accounts', e)
      setError('Could not load accounts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    async function loadInitialAccounts() {
      setError('')
      try {
        const res = await api.get('/accounts')
        if (!active) return
        setAccounts((res.data as Account[]).filter(a => a.account_type !== 'CREDIT_CARD'))
      } catch (e) {
        if (!active) return
        console.error('Failed to load accounts', e)
        setError('Could not load accounts.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadInitialAccounts()
    return () => { active = false }
  }, [])

  const totalsByCurrency = useMemo(() => {
    return accounts.reduce<Record<string, number>>((totals, account) => {
      totals[account.currency] = (totals[account.currency] || 0) + account.balance
      return totals
    }, {})
  }, [accounts])

  function startEdit(account: Account) {
    setEditingId(account.id)
    setBalanceDraft(String(account.balance))
    setError('')
    setMessage('')
  }

  function cancelEdit() {
    setEditingId(null)
    setBalanceDraft('')
  }

  async function saveBalance(account: Account) {
    const nextBalance = Number(balanceDraft)
    if (!Number.isFinite(nextBalance)) {
      setError('Balance must be a valid number.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.patch(`/accounts/${account.id}`, { balance: nextBalance })
      const updated = res.data as Account
      setAccounts(prev => prev.map(a => a.id === account.id ? updated : a))
      setEditingId(null)
      setBalanceDraft('')
      setMessage(`${account.name} balance updated.`)
    } catch (e) {
      console.error(`Failed to update account ${account.id}`, e)
      setError('Could not update account balance.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAccount(account: Account) {
    const confirmed = window.confirm(`Delete ${account.name}? This cannot be undone.`)
    if (!confirmed) return

    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api.delete(`/accounts/${account.id}`)
      setAccounts(prev => prev.filter(a => a.id !== account.id))
      setMessage(`${account.name} deleted.`)
    } catch (e) {
      console.error(`Failed to delete account ${account.id}`, e)
      setError('Could not delete account. Check if it has linked transactions first.')
    } finally {
      setSaving(false)
    }
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const balance = Number(form.balance || 0)

    if (!form.name.trim() || !form.bank.trim()) {
      setError('Account name and bank are required.')
      return
    }
    if (!Number.isFinite(balance)) {
      setError('Initial balance must be a valid number.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.post('/accounts', {
        name: form.name.trim(),
        bank: form.bank.trim(),
        account_type: form.account_type,
        currency: form.currency,
        balance,
        credit_limit: null,
        closing_day: null,
        due_day: null,
      })
      setAccounts(prev => [...prev, res.data as Account].sort((a, b) => a.name.localeCompare(b.name)))
      setForm(EMPTY_FORM)
      setMessage('Account created.')
    } catch (e) {
      console.error('Failed to create account', e)
      setError('Could not create account.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E] flex items-center gap-2">
            <Building2 size={25} />
            Bank Accounts
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">Manage checking and savings balances by currency.</p>
        </div>
        <button
          onClick={loadAccounts}
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
        {CURRENCIES.map(currency => (
          <div key={currency} className="bg-white border border-[#D4E4D5] rounded-xl p-4">
            <p className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest">{currency}</p>
            <p className="text-xl font-bold text-[#1B4D3E] mt-1">
              {symbol(currency)} {fmt(totalsByCurrency[currency] || 0, currency)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
        <section className="bg-white border border-[#D4E4D5] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#EDF4EE] flex items-center justify-between">
            <div>
              <p className="section-title">Accounts</p>
              <p className="text-sm text-[#7BAE8A] mt-1">{accounts.length} active bank account{accounts.length === 1 ? '' : 's'}</p>
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-center text-[#8BAE90]">Loading accounts...</div>
          ) : accounts.length === 0 ? (
            <div className="px-5 py-10 text-center text-[#8BAE90]">No bank accounts yet.</div>
          ) : (
            <div className="divide-y divide-[#EDF4EE]">
              {accounts.map(account => {
                const isEditing = editingId === account.id

                return (
                  <div key={account.id} className="px-5 py-4">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="font-bold text-[#1B4D3E] truncate">{account.name}</h2>
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#EDF4EE] text-[#4E9A7A]">
                            {accountTypeLabel(account.account_type)}
                          </span>
                        </div>
                        <p className="text-sm text-[#7BAE8A] mt-1">{account.bank} · {account.currency}</p>
                      </div>

                      <div className="lg:w-56">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={balanceDraft}
                            onChange={e => setBalanceDraft(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold text-right focus:outline-none"
                            autoFocus
                          />
                        ) : (
                          <p className="text-xl font-bold text-[#1B4D3E] lg:text-right tabular-nums">
                            {symbol(account.currency)} {fmt(account.balance, account.currency)}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 lg:w-28 lg:justify-end">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => saveBalance(account)}
                              disabled={saving}
                              className="p-2 rounded-lg bg-[#1B4D3E] text-white hover:bg-[#2D6A4F] transition disabled:opacity-50"
                              title="Save balance"
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
                              onClick={() => startEdit(account)}
                              disabled={saving}
                              className="p-2 rounded-lg border border-[#D4E4D5] text-[#1B4D3E] hover:bg-[#F4FAF5] transition disabled:opacity-50"
                              title="Edit balance"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              onClick={() => deleteAccount(account)}
                              disabled={saving}
                              className="p-2 rounded-lg border border-[#F0CCCC] text-[#B85050] hover:bg-[#FDF5F5] transition disabled:opacity-50"
                              title="Delete account"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <form onSubmit={createAccount} className="bg-white border border-[#D4E4D5] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <Plus size={18} className="text-[#1B4D3E]" />
            <p className="text-sm font-bold text-[#1B4D3E]">Add Account</p>
          </div>

          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Account name</label>
          <input
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="RBC Chequing"
            className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
          />

          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Bank</label>
          <input
            value={form.bank}
            onChange={e => setForm(prev => ({ ...prev, bank: e.target.value }))}
            placeholder="RBC"
            className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Type</label>
              <select
                value={form.account_type}
                onChange={e => setForm(prev => ({ ...prev, account_type: e.target.value as AccountType }))}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              >
                {ACCOUNT_TYPES.map(type => <option key={type} value={type}>{accountTypeLabel(type)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Currency</label>
              <select
                value={form.currency}
                onChange={e => setForm(prev => ({ ...prev, currency: e.target.value as Currency }))}
                className="w-full px-3 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-4"
              >
                {CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </div>
          </div>

          <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">Initial balance</label>
          <input
            type="number"
            step="0.01"
            value={form.balance}
            onChange={e => setForm(prev => ({ ...prev, balance: e.target.value }))}
            className="w-full px-4 py-2 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none mb-5"
          />

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-[#1B4D3E] text-white font-semibold rounded-xl hover:bg-[#2D6A4F] transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add Account
          </button>
        </form>
      </div>
    </div>
  )
}
