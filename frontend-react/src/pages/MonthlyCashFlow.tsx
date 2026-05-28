import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../services/api'
import type { Account, RecurringExpense } from '../services/api'

function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface MonthlyPayment {
  id: number
  month: string
  item_type: string
  item_id: number
  item_name: string
  paid_at: string
}

export default function MonthlyCashFlow() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [cardCharges, setCardCharges] = useState<Record<string, number>>({})
  const [cardDueDates, setCardDueDates] = useState<Record<string, string>>({})
  const [payments, setPayments] = useState<MonthlyPayment[]>([])
  const [loading, setLoading] = useState(true)

  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [accRes, recRes, payRes] = await Promise.all([
          api.get('/accounts'),
          api.get('/recurring-expenses'),
          api.get(`/monthly-payments?month=${monthStr}`),
        ])
        setAccounts(accRes.data)
        setRecurring(recRes.data)
        setPayments(payRes.data)

        // Card charges + due dates
        const cards = accRes.data.filter((a: Account) => a.account_type === 'CREDIT_CARD')
        const charges: Record<string, number> = {}
        const dueDates: Record<string, string> = {}

        await Promise.all(cards.map(async (card: Account) => {
          try {
            const res = await api.get(`/accounts/${card.id}/statement-summary`)
            let total = 0
            for (const data of Object.values(res.data) as any[]) {
              const due = (data.payment_due_date || '').slice(0, 7)
              if (due === monthStr) {
                total += data.charges || 0
                // Get actual due date
                const dueDate = (data.payment_due_date || '').slice(0, 10)
                if (dueDate) dueDates[card.name] = dueDate
              }
            }
            if (total > 0) charges[card.name] = total
          } catch {}
        }))

        // For cards without statement data, calculate due date from due_day
        cards.forEach((card: Account) => {
          if (!dueDates[card.name] && card.due_day) {
            const nextMonth = month === 12 ? 1 : month + 1
            const nextYear = month === 12 ? year + 1 : year
            const dueDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(card.due_day).padStart(2, '0')}`
            dueDates[card.name] = dueDate
          }
        })

        setCardCharges(charges)
        setCardDueDates(dueDates)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [monthStr])

  function isPaid(itemType: string, itemId: number): MonthlyPayment | undefined {
    return payments.find(p => p.item_type === itemType && p.item_id === itemId)
  }

  async function togglePaid(itemType: string, itemId: number, itemName: string) {
    const existing = isPaid(itemType, itemId)
    if (existing) {
      await api.delete(`/monthly-payments/${existing.id}`)
      setPayments(prev => prev.filter(p => p.id !== existing.id))
    } else {
      const res = await api.post('/monthly-payments', {
        month: monthStr, item_type: itemType, item_id: itemId, item_name: itemName
      })
      setPayments(prev => [...prev, res.data])
    }
  }

  function formatDueDate(dateStr: string): string {
    if (!dateStr) return ''
    const [y, mo, dy] = dateStr.split('-').map(Number)
    return new Date(y, mo - 1, dy).toLocaleDateString('en', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      {/* Month navigation */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-[#D4E4D5] transition text-[#1B4D3E]">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold flex-1 text-center text-[#1B4D3E]">{monthLabel}</h1>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-[#D4E4D5] transition text-[#1B4D3E]">
          <ChevronRight size={20} />
        </button>
      </div>

      {loading && <div className="text-center text-[#8BAE90] py-20">Loading...</div>}

      {!loading && (
        <div>
          {(['CAD', 'BRL'] as const).map(currency => {
            const symbol = currency === 'CAD' ? 'CAD$' : 'R$'
            const flag = currency === 'CAD' ? '🇨🇦' : '🇧🇷'
            const checking = accounts.filter(a => a.currency === currency && a.account_type !== 'CREDIT_CARD')
            const inBank = checking.reduce((s, a) => s + a.balance, 0)
            const incomeList = recurring.filter(r => r.currency === currency && r.type === 'INCOME')
            const expenseList = recurring.filter(r => r.currency === currency && r.type !== 'INCOME')
            const totalIncome = incomeList.reduce((s, r) => s + r.amount, 0)
            const totalRecExp = expenseList.reduce((s, r) => s + r.amount, 0)
            const cardEntries = Object.entries(cardCharges).filter(([name]) => {
              const card = accounts.find(a => a.name === name)
              return card?.currency === currency
            })
            const totalCards = cardEntries.reduce((s, [, v]) => s + v, 0)
            const totalExpenses = totalRecExp + totalCards
            const balance = inBank + totalIncome - totalExpenses

            if (inBank === 0 && totalIncome === 0 && totalExpenses === 0) return null

            return (
              <div key={currency} className="mb-10">
                <h2 className="text-lg font-bold text-[#1B4D3E] mb-4">{flag} {currency}</h2>

                {/* Income */}
                <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest mb-2">Income</p>
                <div className="bg-white rounded-xl border border-[#D4E4D5] overflow-hidden mb-4">
                  {incomeList.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-[#8BAE90]">No recurring income registered.</p>
                  ) : (
                    <>
                      {incomeList.map(r => (
                        <div key={r.id} className="flex justify-between items-center px-4 py-3 border-b border-[#EDF4EE]">
                          <span className="text-[#2C3E2D] text-base">
                            {r.name}
                            <span className="text-[#8BAE90] text-xs ml-2">(day {r.due_day})</span>
                            {r.valid_until && (
                              <span className="text-amber-500 text-xs ml-2">
                                until {new Date(r.valid_until).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                          </span>
                          <span className="text-[#1B6B3A] font-semibold text-base">+ {symbol} {fmt(r.amount)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center px-4 py-3 bg-[#F4FAF5]">
                        <span className="text-[#1B4D3E] font-bold">Total Income</span>
                        <span className="text-[#1B6B3A] font-bold">+ {symbol} {fmt(totalIncome)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Expenses */}
                <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest mb-2">Expenses</p>
                <div className="bg-white rounded-xl border border-[#D4E4D5] overflow-hidden mb-4">

                  {/* Card charges */}
                  {cardEntries.map(([name, amount]) => {
                    const card = accounts.find(a => a.name === name)
                    const paid = isPaid('card', card?.id ?? 0)
                    const dueDate = cardDueDates[name]

                    return (
                      <div key={name} className={`flex justify-between items-center px-4 py-3 border-b border-[#EDF4EE] transition ${paid ? 'bg-[#F4FAF5]' : ''}`}>
                        <div className="flex items-center gap-3">
                          {/* Checkbox */}
                          <button
                            onClick={() => card && togglePaid('card', card.id, name)}
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0 ${
                              paid
                                ? 'bg-[#1B6B3A] border-[#1B6B3A] text-white'
                                : 'border-[#D4E4D5] hover:border-[#4E9A7A]'
                            }`}
                          >
                            {paid && <span className="text-xs font-bold">✓</span>}
                          </button>
                          <span className={`text-base transition ${paid ? 'text-[#8BAE90] line-through' : 'text-[#2C3E2D]'}`}>
                            💳 {name}
                            {dueDate && (
                              <span className="text-[#8BAE90] text-xs ml-2">(due {formatDueDate(dueDate)})</span>
                            )}
                          </span>
                        </div>
                        <span className={`font-semibold text-base transition ${paid ? 'text-[#8BAE90] line-through' : 'text-[#B85050]'}`}>
                          - {symbol} {fmt(amount)}
                        </span>
                      </div>
                    )
                  })}

                  {/* Recurring expenses */}
                  {expenseList.map(r => {
                    const paid = isPaid('recurring', r.id)
                    return (
                      <div key={r.id} className={`flex justify-between items-center px-4 py-3 border-b border-[#EDF4EE] transition ${paid ? 'bg-[#F4FAF5]' : ''}`}>
                        <div className="flex items-center gap-3">
                          {/* Checkbox */}
                          <button
                            onClick={() => togglePaid('recurring', r.id, r.name)}
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0 ${
                              paid
                                ? 'bg-[#1B6B3A] border-[#1B6B3A] text-white'
                                : 'border-[#D4E4D5] hover:border-[#4E9A7A]'
                            }`}
                          >
                            {paid && <span className="text-xs font-bold">✓</span>}
                          </button>
                          <span className={`text-base transition ${paid ? 'text-[#8BAE90] line-through' : 'text-[#2C3E2D]'}`}>
                            🔄 {r.name}
                            <span className="text-[#8BAE90] text-xs ml-2">(day {r.due_day})</span>
                            {r.valid_until && (
                              <span className="text-amber-500 text-xs ml-2">
                                until {new Date(r.valid_until).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                          </span>
                        </div>
                        <span className={`font-semibold text-base transition ${paid ? 'text-[#8BAE90] line-through' : 'text-[#B85050]'}`}>
                          - {symbol} {fmt(r.amount)}
                        </span>
                      </div>
                    )
                  })}

                  <div className="flex justify-between items-center px-4 py-3 bg-[#FDF5F5]">
                    <span className="text-[#1B4D3E] font-bold">Total Expenses</span>
                    <span className="text-[#B85050] font-bold">- {symbol} {fmt(totalExpenses)}</span>
                  </div>
                </div>

                {/* Balance */}
                <div className="bg-white rounded-xl border border-[#D4E4D5] overflow-hidden">
                  <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest px-4 pt-3 mb-3">Balance</p>
                  <div className="grid grid-cols-3 divide-x divide-[#EDF4EE]">
                    <div className="text-center px-4 pb-4">
                      <p className="text-xs text-[#8BAE90] mb-1">🏦 In Bank</p>
                      <p className="text-xl font-bold text-[#1B4D3E]">{fmt(inBank)}</p>
                      <p className="text-xs text-[#8BAE90]">{symbol}</p>
                    </div>
                    <div className="text-center px-4 pb-4">
                      <p className="text-xs text-[#8BAE90] mb-1">💸 After Expenses</p>
                      <p className={`text-xl font-bold ${(inBank - totalExpenses) >= 0 ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>
                        {fmt(inBank - totalExpenses)}
                      </p>
                      <p className="text-xs text-[#8BAE90]">{symbol}</p>
                    </div>
                    <div className="text-center px-4 pb-4 bg-[#2D6A4F] rounded-br-xl">
                      <p className="text-xs text-white mb-1">🎯 Balance</p>
                      <p className="text-xl font-bold text-[#E8C84A]">{fmt(balance)}</p>
                      <p className="text-xs text-white">{symbol}</p>
                    </div>
                  </div>
                  <p className="text-xs text-[#8BAE90] text-center py-2 border-t border-[#EDF4EE]">
                    {fmt(inBank)} + {fmt(totalIncome)} − {fmt(totalExpenses)} = {symbol} {fmt(balance)}
                  </p>
                </div>

                <hr className="border-[#D4E4D5] my-8" />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}