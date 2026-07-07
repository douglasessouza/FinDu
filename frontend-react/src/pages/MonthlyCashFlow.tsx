import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, CircleHelp, Sparkles } from 'lucide-react'
import api from '../services/api'
import CardCycleSummary from '../components/CardCycleSummary'
import { investmentPortfolioSummary, investmentSummaryForMonth } from '../utils/investmentPlans'
import type {
  Account,
  RecurringExpense,
  RecurringMatch as SavedRecurringMatch,
  Transaction,
} from '../services/api'

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

interface StatementSummaryItem {
  payment_due_date?: string | null
  charges?: number | null
  amount_due?: number | null
}

interface RecurringMatchCandidate {
  transaction: Transaction
  actualAmount: number
  variance: number
  confidence: 'High' | 'Medium'
  score: number
  savedId?: number
  source?: string
}

const STOP_WORDS = new Set([
  'the', 'and', 'of', 'to', 'from', 'payment', 'purchase', 'contactless', 'interac',
  'online', 'banking', 'deposit', 'preauthorized', 'preauth', 'pos', 'debit', 'credit',
  'card', 'visa', 'mastercard', 'american', 'express',
])

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
}

function textScore(name: string, description: string): number {
  const normalizedName = normalizeText(name)
  const normalizedDescription = normalizeText(description)
  if (!normalizedName || !normalizedDescription) return 0
  if (normalizedDescription.includes(normalizedName) || normalizedName.includes(normalizedDescription)) return 1

  const nameTokens = tokens(name)
  const descTokens = tokens(description)
  if (nameTokens.length === 0) return 0
  const hits = nameTokens.filter(token => descTokens.some(descToken => (
    descToken === token || descToken.startsWith(token) || token.startsWith(descToken)
  ))).length
  return hits / nameTokens.length
}

function dayDistance(dateValue: string, dueDay: number): number {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return 31
  return Math.abs(date.getDate() - Math.min(dueDay, 28))
}

function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function incomeTransactionMonth(item: RecurringExpense, cashFlowMonth: string): string {
  return item.due_day >= 28 ? addMonths(cashFlowMonth, -1) : cashFlowMonth
}

function amountMatches(planned: number, actual: number): boolean {
  const tolerance = Math.max(5, planned * 0.15)
  return Math.abs(planned - actual) <= tolerance
}

function findRecurringMatches(
  items: RecurringExpense[],
  transactions: Transaction[],
  monthStr: string,
): Record<number, RecurringMatchCandidate> {
  const matches: Record<number, RecurringMatchCandidate> = {}
  const usedTransactions = new Set<number>()
  const sortedItems = [...items].sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name))

  for (const item of sortedItems) {
    const transactionMonth = item.type === 'INCOME'
      ? incomeTransactionMonth(item, monthStr)
      : monthStr

    const candidates = transactions
      .filter(tx => tx.date.slice(0, 7) === transactionMonth)
      .filter(tx => !usedTransactions.has(tx.id))
      .filter(tx => item.type === 'INCOME' ? tx.amount > 0 : tx.amount < 0)
      .filter(tx => tx.currency === item.currency)
      .map(tx => {
        const actualAmount = Math.abs(tx.amount)
        const variance = actualAmount - item.amount
        const nameScore = textScore(item.name, tx.description)
        const categoryScore = item.category && tx.category === item.category ? 1 : 0
        const amountScore = amountMatches(item.amount, actualAmount)
          ? Math.max(0, 1 - (Math.abs(variance) / Math.max(5, item.amount * 0.15)))
          : 0
        const dateScore = Math.max(0, 1 - (dayDistance(tx.date, item.due_day) / 10))
        const score = (nameScore * 45) + (amountScore * 35) + (dateScore * 15) + (categoryScore * 5)
        return { tx, actualAmount, variance, score }
      })
      .filter(candidate => amountMatches(item.amount, candidate.actualAmount))
      .filter(candidate => candidate.score >= 48)
      .sort((a, b) => b.score - a.score)

    const best = candidates[0]
    if (best) {
      usedTransactions.add(best.tx.id)
      matches[item.id] = {
        transaction: best.tx,
        actualAmount: best.actualAmount,
        variance: best.variance,
        score: best.score,
        confidence: best.score >= 72 ? 'High' : 'Medium',
      }
    }
  }

  return matches
}

function formatDueDate(dateStr: string): string {
  if (!dateStr) return ''
  const [y, mo, dy] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, dy).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function isValidThisMonth(item: RecurringExpense, year: number, month: number): boolean {
  if (!item.valid_until) return true
  const end = new Date(item.valid_until)
  const startOfMonth = new Date(year, month - 1, 1)
  return Number.isNaN(end.getTime()) || end >= startOfMonth
}

export default function MonthlyCashFlow() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [statementTransactions, setStatementTransactions] = useState<Transaction[]>([])
  const [actualOtherIncomeTransactions, setActualOtherIncomeTransactions] = useState<Transaction[]>([])
  const [cardCharges, setCardCharges] = useState<Record<string, number>>({})
  const [cardDueDates, setCardDueDates] = useState<Record<string, string>>({})
  const [payments, setPayments] = useState<MonthlyPayment[]>([])
  const [savedMatches, setSavedMatches] = useState<SavedRecurringMatch[]>([])
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

  async function load() {
    setLoading(true)
    try {
      const [accRes, recRes, payRes, matchRes] = await Promise.all([
        api.get('/accounts'),
        api.get('/recurring-expenses'),
        api.get(`/monthly-payments?month=${monthStr}`),
        api.get(`/recurring-matches?month=${monthStr}`).catch(() => ({ data: [] })),
      ])

      const loadedAccounts = accRes.data as Account[]
      setAccounts(loadedAccounts)
      setRecurring(recRes.data as RecurringExpense[])
      setPayments(payRes.data as MonthlyPayment[])
      setSavedMatches(matchRes.data as SavedRecurringMatch[])

      const cards = loadedAccounts.filter(a => a.account_type === 'CREDIT_CARD')
      const checking = loadedAccounts.filter(a => a.account_type !== 'CREDIT_CARD')
      const charges: Record<string, number> = {}
      const dueDates: Record<string, string> = {}

      const txResults = await Promise.all(checking.map(async account => {
        try {
          const res = await api.get(`/accounts/${account.id}/transactions`)
          return res.data as Transaction[]
        } catch (error) {
          console.error(`Failed to load transactions for ${account.name}`, error)
          return []
        }
      }))

      await Promise.all(cards.map(async card => {
        try {
          const res = await api.get(`/accounts/${card.id}/statement-summary`)
          let total = 0
          for (const data of Object.values(res.data as Record<string, StatementSummaryItem>)) {
            const due = (data.payment_due_date || '').slice(0, 7)
            if (due === monthStr) {
              total += data.amount_due ?? data.charges ?? 0
              const dueDate = (data.payment_due_date || '').slice(0, 10)
              if (dueDate) dueDates[card.name] = dueDate
            }
          }
          if (total > 0) charges[card.name] = total
        } catch (error) {
          console.error(`Failed to load statement summary for ${card.name}`, error)
        }
      }))

      cards.forEach(card => {
        if (!dueDates[card.name] && card.due_day) {
          const nextDueMonth = month === 12 ? 1 : month + 1
          const nextDueYear = month === 12 ? year + 1 : year
          dueDates[card.name] = `${nextDueYear}-${String(nextDueMonth).padStart(2, '0')}-${String(card.due_day).padStart(2, '0')}`
        }
      })

      const loadedStatementTransactions = txResults.flat()
      setStatementTransactions(loadedStatementTransactions)
      setCardCharges(charges)
      setCardDueDates(dueDates)
    } finally {
      setLoading(false)
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    load()
  }, [monthStr, month, year])

  useEffect(() => {
    let cancelled = false

    async function loadActualOtherIncome() {
      try {
        const res = await api.get(`/other-income-transactions?month=${monthStr}`)
        if (!cancelled) setActualOtherIncomeTransactions(res.data as Transaction[])
      } catch (error) {
        console.error('Failed to load actual other income', error)
        if (!cancelled) setActualOtherIncomeTransactions([])
      }
    }

    loadActualOtherIncome()
    return () => { cancelled = true }
  }, [monthStr])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const autoRecurringMatches = useMemo(
    () => findRecurringMatches(recurring, statementTransactions, monthStr),
    [recurring, statementTransactions, monthStr],
  )

  const recurringMatches = useMemo(() => {
    const merged: Record<number, RecurringMatchCandidate> = { ...autoRecurringMatches }

    for (const saved of savedMatches) {
      if (!saved.transaction) continue
      const item = recurring.find(current => current.id === saved.recurring_id)
      if (!item) continue
      merged[saved.recurring_id] = {
        transaction: saved.transaction,
        actualAmount: saved.actual_amount,
        variance: saved.variance,
        confidence: saved.confidence,
        score: saved.score,
        savedId: saved.id,
        source: saved.source,
      }
    }

    return merged
  }, [autoRecurringMatches, recurring, savedMatches])

  useEffect(() => {
    if (loading) return

    const savedRecurringIds = new Set(savedMatches.map(match => match.recurring_id))
    const matchesToSave = Object.entries(autoRecurringMatches)
      .filter(([recurringId]) => !savedRecurringIds.has(Number(recurringId)))
      .map(([recurringId, match]) => {
        const item = recurring.find(current => current.id === Number(recurringId))
        if (!item) return null
        return {
          month: monthStr,
          recurring_id: item.id,
          transaction_id: match.transaction.id,
          planned_amount: item.amount,
          actual_amount: match.actualAmount,
          variance: match.variance,
          confidence: match.confidence,
          score: match.score,
          source: 'auto',
        }
      })
      .filter(Boolean)

    if (matchesToSave.length === 0) return

    let cancelled = false

    async function saveMatches() {
      try {
        const results = await Promise.all(matchesToSave.map(match => api.post('/recurring-matches', match)))
        if (!cancelled) {
          setSavedMatches(prev => {
            const existing = new Set(prev.map(match => match.recurring_id))
            const next = results.map(res => res.data as SavedRecurringMatch).filter(match => !existing.has(match.recurring_id))
            return [...prev, ...next]
          })
        }
      } catch (error) {
        console.error('Failed to persist recurring matches', error)
      }
    }

    saveMatches()
    return () => { cancelled = true }
  }, [autoRecurringMatches, loading, monthStr, recurring, savedMatches])

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
        month: monthStr,
        item_type: itemType,
        item_id: itemId,
        item_name: itemName,
      })
      setPayments(prev => [...prev, res.data])
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6">
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
          <div className="mb-6">
            <CardCycleSummary accounts={accounts} month={monthStr} />
          </div>

          {(['CAD', 'BRL'] as const).map(currency => {
            const symbol = currency === 'CAD' ? 'CAD$' : 'R$'
            const flag = currency === 'CAD' ? '🇨🇦' : '🇧🇷'
            const checking = accounts.filter(a => a.currency === currency && a.account_type !== 'CREDIT_CARD')
            const inBank = checking.reduce((s, a) => s + a.balance, 0)
            const monthRecurring = recurring.filter(r => r.currency === currency && isValidThisMonth(r, year, month))
            const incomeList = monthRecurring.filter(r => r.type === 'INCOME')
            const expenseList = monthRecurring.filter(r => r.type !== 'INCOME')
            const matchedIncomeActual = incomeList.reduce((s, r) => s + (recurringMatches[r.id]?.actualAmount || 0), 0)
            const remainingIncome = incomeList.reduce((s, r) => s + (recurringMatches[r.id] ? 0 : r.amount), 0)
            const totalRecurringExpensesPlanned = expenseList.reduce((s, r) => s + r.amount, 0)
            const matchedExpenseActual = expenseList.reduce((s, r) => s + (recurringMatches[r.id]?.actualAmount || 0), 0)
            const remainingRecurringExpenses = expenseList.reduce((s, r) => s + (recurringMatches[r.id] || isPaid('recurring', r.id) ? 0 : r.amount), 0)
            const currencyActualOtherIncome = actualOtherIncomeTransactions.filter(tx => tx.currency === currency)
            const actualOtherIncomeTotal = currencyActualOtherIncome.reduce((s, tx) => s + Number(tx.amount), 0)
            const cardEntries = Object.entries(cardCharges).filter(([name]) => {
              const card = accounts.find(a => a.name === name)
              return card?.currency === currency
            })
            const totalCardsPlanned = cardEntries.reduce((s, [, v]) => s + v, 0)
            const remainingCards = cardEntries.reduce((s, [name, v]) => {
              const card = accounts.find(a => a.name === name)
              return s + (card && isPaid('card', card.id) ? 0 : v)
            }, 0)
            const plannedFixedExpenses = totalRecurringExpensesPlanned + totalCardsPlanned
            const openFixedExpenses = remainingRecurringExpenses + remainingCards
            const investmentSavings = currency === 'CAD'
              ? investmentSummaryForMonth(monthStr, 'CAD')
              : { plannedDue: 0, savedActual: 0, remainingDue: 0, openPlans: 0 }
            const investmentPortfolio = currency === 'CAD'
              ? investmentPortfolioSummary('CAD')
              : { openPlans: 0, savedTotal: 0, projectedFinal: 0, targetTotal: 0, riskPlans: 0 }
            const payrollIncome = incomeList.filter(item => {
              const text = `${item.name} ${item.category || ''}`.toLowerCase()
              return text.includes('payroll') || text.includes('salary')
            })
            const otherIncome = incomeList.filter(item => !payrollIncome.some(payroll => payroll.id === item.id))
            const payrollIncomeTotal = payrollIncome.reduce((s, r) => s + r.amount, 0)
            const plannedOtherIncomeTotal = otherIncome.reduce((s, r) => s + r.amount, 0)
            const otherIncomeTotal = plannedOtherIncomeTotal + actualOtherIncomeTotal
            const projectedBalance = inBank + remainingIncome - openFixedExpenses - investmentSavings.remainingDue

            if (inBank === 0 && incomeList.length === 0 && plannedFixedExpenses === 0 && investmentSavings.plannedDue === 0) return null

            return (
              <div key={currency} className="mb-10">
                <h2 className="text-lg font-bold text-[#1B4D3E] mb-4">{flag} {currency}</h2>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
                  <div className="bg-white rounded-xl border border-[#D4E4D5] p-4">
                    <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest">Expected Income</p>
                    <p className="text-xl font-bold text-[#1B6B3A] mt-1">+ {symbol} {fmt(remainingIncome)}</p>
                    <p className="text-xs text-[#8BAE90] mt-1">Still to be received</p>
                  </div>
                  <div className="bg-white rounded-xl border border-[#D4E4D5] p-4">
                    <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest">Planned Expenses</p>
                    <p className="text-xl font-bold text-[#B85050] mt-1">- {symbol} {fmt(plannedFixedExpenses)}</p>
                    <p className="text-xs text-[#8BAE90] mt-1">Recurring bills + cards due</p>
                  </div>
                  <div className="bg-white rounded-xl border border-[#D4E4D5] p-4">
                    <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest">Planned Savings</p>
                    <p className="text-xl font-bold text-[#1B4D3E] mt-1">- {symbol} {fmt(investmentSavings.remainingDue)}</p>
                    <p className="text-xs text-[#8BAE90] mt-1">
                      {symbol} {fmt(investmentSavings.savedActual)} saved of {symbol} {fmt(investmentSavings.plannedDue)}
                    </p>
                  </div>
                  <div className="bg-[#2D6A4F] rounded-xl border border-[#2D6A4F] p-4">
                    <p className="text-[10px] font-semibold text-white uppercase tracking-widest">Projected End-of-Month</p>
                    <p className="text-xl font-bold text-[#E8C84A] mt-1">{symbol} {fmt(projectedBalance)}</p>
                    <p className="text-xs text-white/80 mt-1">After income, open payments, and planned savings</p>
                  </div>
                </div>

                <section className="mb-5 rounded-xl border-2 border-[#1B4D3E] bg-[#F7FBF8] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="section-title">Income</p>
                    <p className="text-xs text-[#8BAE90]">
                      Expected {symbol} {fmt(remainingIncome)} · received {symbol} {fmt(matchedIncomeActual)}
                    </p>
                  </div>
                  {incomeList.length === 0 && currencyActualOtherIncome.length === 0 ? (
                    <div className="bg-white rounded-lg border border-[#D4E4D5] px-4 py-3 text-sm text-[#8BAE90]">
                      No recurring income registered.
                    </div>
                  ) : (
                    <>
                      {payrollIncome.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          {payrollIncome.map(r => {
                            const match = recurringMatches[r.id]
                            const received = Boolean(match)
                            return (
                            <div key={r.id} className={`rounded-lg border border-[#D4E4D5] px-4 py-3 ${received ? 'bg-[#EDF4EE]' : 'bg-[#F4FAF5]'}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2 min-w-0">
                                  <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                    received ? 'bg-[#1B6B3A] border-[#1B6B3A] text-white' : 'border-[#D4E4D5]'
                                  }`}>
                                    {received && <Check size={13} />}
                                  </span>
                                  <div className="min-w-0">
                                  <p className={`font-bold truncate ${received ? 'text-[#8BAE90] line-through' : 'text-[#1B4D3E]'}`}>{r.name}</p>
                                  <p className="text-xs text-[#7BAE8A] mt-1">
                                    day {r.due_day}
                                    {r.valid_until && (
                                      <span className="text-amber-500 ml-2">
                                        until {new Date(r.valid_until).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                                      </span>
                                    )}
                                  </p>
                                  {match && (
                                    <p
                                      className="text-xs text-[#1B6B3A] mt-1 truncate"
                                      title={match.transaction.description}
                                    >
                                      Received {formatDueDate(match.transaction.date.slice(0, 10))}
                                    </p>
                                  )}
                                  </div>
                                </div>
                                <p className={`font-bold whitespace-nowrap ${received ? 'text-[#8BAE90] line-through' : 'text-[#1B6B3A]'}`}>
                                  + {symbol} {fmt(match?.actualAmount || r.amount)}
                                </p>
                              </div>
                            </div>
                          )})}
                        </div>
                      )}

                      {otherIncome.length > 0 && (
                        <div className="mt-3">
                          <p className="section-title mb-2">Planned Other Incomes</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {otherIncome.map(r => (
                              <div key={r.id} className="rounded-lg border border-[#CFE0F5] bg-[#F3F7FD] px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="font-bold text-[#1B4D3E] truncate">{r.name}</p>
                                    <p className="text-xs text-[#3F6EA8] mt-1">
                                      day {r.due_day} · {r.category || 'Other Income'}
                                      {r.valid_until && (
                                        <span className="text-amber-500 ml-2">
                                          until {new Date(r.valid_until).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                  <p className="text-[#1B6B3A] font-bold whitespace-nowrap">+ {symbol} {fmt(r.amount)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {currencyActualOtherIncome.length > 0 && (
                        <div className="mt-3">
                          <p className="section-title mb-2">Actual Other Incomes</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {currencyActualOtherIncome.map(tx => (
                              <div key={tx.id} className="rounded-lg border border-[#CFE0F5] bg-[#F3F7FD] px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="font-bold text-[#1B4D3E] truncate">{tx.description}</p>
                                    <p className="text-xs text-[#3F6EA8] mt-1">{formatDueDate(tx.date.slice(0, 10))} · Other Income</p>
                                  </div>
                                  <p className="text-[#1B6B3A] font-bold whitespace-nowrap">+ {symbol} {fmt(tx.amount)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 bg-white rounded-lg border border-[#D4E4D5] overflow-hidden">
                        <div className="flex justify-between items-center px-4 py-3 border-b border-[#EDF4EE]">
                          <span className="text-[#1B4D3E] font-bold">Payroll Income</span>
                          <span className="text-[#1B6B3A] font-bold">+ {symbol} {fmt(payrollIncomeTotal)}</span>
                        </div>
                        <div className="flex justify-between items-center px-4 py-3 border-b border-[#EDF4EE]">
                          <span className="text-[#1B4D3E] font-bold">Other Incomes</span>
                          <span className="text-[#1B6B3A] font-bold">+ {symbol} {fmt(otherIncomeTotal)}</span>
                        </div>
                        <div className="flex justify-between items-center px-4 py-3 bg-[#F4FAF5]">
                          <span className="text-[#1B4D3E] font-bold">Expected Income Remaining</span>
                          <span className="text-[#1B6B3A] font-bold">+ {symbol} {fmt(remainingIncome)}</span>
                        </div>
                      </div>
                    </>
                  )}
                </section>

                <section className="mb-5 rounded-xl border-2 border-[#1B4D3E] bg-[#FFF8F8] p-4">
                  <div className="flex items-center justify-between mb-4">
                    <p className="section-title">Expenses</p>
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#B85050]">Remaining to pay: {symbol} {fmt(openFixedExpenses)}</p>
                      <p className="text-xs text-[#8BAE90] flex items-center justify-end gap-1">
                        <CircleHelp size={12} />
                        Already included in the projected end-of-month balance.
                      </p>
                    </div>
                  </div>

                  <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="section-title">Credit Cards</p>
                    {cardEntries.length > 0 && (
                      <p className="text-xs text-[#8BAE90]">Planned due: {symbol} {fmt(totalCardsPlanned)}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {cardEntries.length === 0 ? (
                      <div className="rounded-lg border border-[#D4E4D5] bg-[#F4FAF5] px-4 py-3">
                        <p className="font-bold text-[#1B4D3E]">No cards due</p>
                        <p className="text-xs text-[#7BAE8A] mt-1">No credit card payments due this month.</p>
                        <p className="text-[#1B6B3A] font-bold mt-3">{symbol} {fmt(0)}</p>
                      </div>
                    ) : (
                      cardEntries.map(([name, amount]) => {
                        const card = accounts.find(a => a.name === name)
                        const paid = isPaid('card', card?.id ?? 0)
                        const dueDate = cardDueDates[name]

                        return (
                          <div key={name} className={`rounded-lg border px-4 py-3 transition ${
                            paid ? 'bg-[#F4FAF5] border-[#D4E4D5]' : 'bg-white border-[#D4E4D5]'
                          }`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 min-w-0">
                                <button
                                  onClick={() => card && togglePaid('card', card.id, name)}
                                  className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0 ${
                                    paid ? 'bg-[#1B6B3A] border-[#1B6B3A] text-white' : 'border-[#D4E4D5] hover:border-[#4E9A7A]'
                                  }`}
                                  title={paid ? 'Marked as paid' : 'Mark as paid'}
                                >
                                  {paid && <Check size={13} />}
                                </button>
                                <div className="min-w-0">
                                  <p className={`text-sm font-semibold transition truncate ${paid ? 'text-[#8BAE90] line-through' : 'text-[#2C3E2D]'}`}>{name}</p>
                                  {dueDate && <p className="text-xs text-[#8BAE90] mt-1">due {formatDueDate(dueDate)}</p>}
                                </div>
                              </div>
                              <span className={`font-bold text-sm transition whitespace-nowrap ${paid ? 'text-[#8BAE90] line-through' : 'text-[#B85050]'}`}>
                                - {symbol} {fmt(amount)}
                              </span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                  </div>

                <div className="mb-4">
                  <section className="max-w-4xl">
                    <div className="flex items-center justify-between mb-2">
                      <p className="section-title">Recurring Expenses</p>
                      <p className="text-xs text-[#8BAE90]">Open {symbol} {fmt(remainingRecurringExpenses)}</p>
                    </div>
                    <div className="bg-white rounded-lg border border-[#D4E4D5] overflow-hidden">
                        {expenseList.length === 0 ? (
                          <p className="px-4 py-4 text-sm text-[#8BAE90]">No recurring fixed expenses.</p>
                        ) : (
                          expenseList.map(r => {
                            const paid = isPaid('recurring', r.id)
                            const match = recurringMatches[r.id]
                            const done = Boolean(paid || match)
                            return (
                              <div key={r.id} className={`flex flex-col md:flex-row md:justify-between md:items-center gap-2 px-4 py-3 border-b border-[#EDF4EE] last:border-0 transition ${done ? 'bg-[#F4FAF5]' : ''}`}>
                                <div className="flex items-start gap-3 min-w-0">
                                  <button
                                    onClick={() => !match && togglePaid('recurring', r.id, r.name)}
                                    disabled={Boolean(match)}
                                    className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0 ${
                                      done ? 'bg-[#1B6B3A] border-[#1B6B3A] text-white' : 'border-[#D4E4D5] hover:border-[#4E9A7A]'
                                    }`}
                                    title={match ? 'Auto matched from statement' : paid ? 'Marked as paid' : 'Mark as paid'}
                                  >
                                    {done && <Check size={13} />}
                                  </button>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-sm transition ${done ? 'text-[#8BAE90] line-through' : 'text-[#2C3E2D]'}`}>{r.name}</span>
                                      <span className="text-[#8BAE90] text-xs">(day {r.due_day})</span>
                                      {r.valid_until && (
                                        <span className="text-amber-500 text-xs">
                                          until {new Date(r.valid_until).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </span>
                                      )}
                                    </div>
                                    {match && (
                                      <p className="text-xs text-[#1B6B3A] mt-1 flex items-center gap-1">
                                        <Sparkles size={12} />
                                        Matched: {match.transaction.description} · {formatDueDate(match.transaction.date.slice(0, 10))}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <span className={`font-semibold text-sm transition ${done ? 'text-[#8BAE90] line-through' : 'text-[#B85050]'}`}>
                                    - {symbol} {fmt(match?.actualAmount || r.amount)}
                                  </span>
                                  {match && Math.abs(match.variance) > 0.005 && (
                                    <p className="text-xs text-[#8BAE90]">planned {symbol} {fmt(r.amount)}</p>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                          <div className="px-4 py-3 bg-[#FDF5F5]">
                          <div className="flex justify-between items-center">
                            <span className="text-[#1B4D3E] font-bold text-sm">Planned Recurring</span>
                            <span className="text-[#B85050] font-bold text-sm">- {symbol} {fmt(totalRecurringExpensesPlanned)}</span>
                          </div>
                          <p className="text-xs text-[#8BAE90] mt-1">
                            Open {symbol} {fmt(remainingRecurringExpenses)} · matched {symbol} {fmt(matchedExpenseActual)}
                          </p>
                        </div>
                      </div>
                  </section>
                </div>
                </section>

                <div className="bg-white rounded-xl border border-[#D4E4D5] overflow-hidden">
                  <p className="section-title px-5 pt-4 mb-3">Balance</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#EDF4EE]">
                    <div className="px-5 pb-5">
                      <p className="text-xs text-[#8BAE90] mb-1">Current Bank Balance</p>
                      <p className="text-2xl font-bold text-[#1B4D3E]">{symbol} {fmt(inBank)}</p>
                      <p className="text-xs text-[#8BAE90] mt-1">Already includes received income and paid expenses.</p>
                    </div>
                    <div className="px-5 py-5 md:pt-0 bg-[#F8FBF8]">
                      <p className="text-xs text-[#8BAE90] mb-1">Total Savings</p>
                      <p className="text-2xl font-bold text-[#1B6B3A]">{symbol} {fmt(investmentPortfolio.savedTotal)}</p>
                      <p className="text-xs text-[#8BAE90] mt-1">
                        Updated from {investmentPortfolio.openPlans} open investment plan{investmentPortfolio.openPlans === 1 ? '' : 's'}.
                      </p>
                    </div>
                    <div className="px-5 py-5 md:pt-0 bg-[#2D6A4F] md:rounded-br-xl">
                      <p className="text-xs text-white mb-1">Projected End-of-Month Balance</p>
                      <p className="text-2xl font-bold text-[#E8C84A]">{symbol} {fmt(projectedBalance)}</p>
                      <p className="text-xs text-white/80 mt-1">After expected income, remaining payments, and planned savings.</p>
                    </div>
                  </div>
                  <p className="text-xs text-[#8BAE90] text-center py-2 border-t border-[#EDF4EE]">
                    {fmt(inBank)} + expected income {fmt(remainingIncome)} - remaining payments {fmt(openFixedExpenses)} - planned savings {fmt(investmentSavings.remainingDue)} = {symbol} {fmt(projectedBalance)}
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
