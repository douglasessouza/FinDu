import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Pencil, RotateCcw, Save, Sparkles, X } from 'lucide-react'
import api, { getMonthlyDashboard } from '../services/api'
import { createLatestRequestRunner, hasCurrentMonthlyData } from '../services/reportingData'
import CardCycleSummary from '../components/CardCycleSummary'
import { investmentPortfolioSummary, investmentSummaryForMonth } from '../utils/investmentPlans'
import { calculateProjectedBalance, calculateRemainingIncome } from '../utils/cashFlowProjection'
import { buildPayPeriodSummary, hasExpectedIncomeDate, resolveCardDueDay } from '../utils/payPeriodSummary'
import type {
  Account,
  CurrencyCode,
  MonthlyPayment,
  RecurringExpense,
  RecurringMonthlyOverride,
  RecurringMatch as SavedRecurringMatch,
  Transaction,
} from '../services/api'

function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface CardChargeEntry {
  accountId: number
  name: string
  currency: CurrencyCode
  amount: number
  dueDate?: string
  dueDay: number
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
  const lastDayOfTransactionMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return Math.abs(date.getDate() - Math.min(dueDay, lastDayOfTransactionMonth))
}

function isPayrollIncome(item: RecurringExpense): boolean {
  if (item.type !== 'INCOME') return false
  const text = `${item.name} ${item.category || ''}`.toLowerCase()
  return text.includes('payroll') || text.includes('salary')
}

function hasExpectedRecurringDate(item: RecurringExpense, tx: Transaction, cashFlowMonth: string): boolean {
  if (isPayrollIncome(item)) {
    return hasExpectedIncomeDate({
      transactionDate: tx.date,
      dueDay: item.due_day,
      cashFlowMonth,
    })
  }
  const txMonth = tx.date.slice(0, 7)
  if (txMonth !== cashFlowMonth) return false
  return dayDistance(tx.date, item.due_day) <= 7
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
    const candidates = transactions
      .filter(tx => hasExpectedRecurringDate(item, tx, monthStr))
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

function currencySymbol(currency: CurrencyCode): string {
  if (currency === 'BRL') return 'R$'
  if (currency === 'USD') return 'US$'
  if (currency === 'EUR') return '€'
  return 'CAD$'
}

function currencyFlag(currency: CurrencyCode): string {
  if (currency === 'BRL') return '🇧🇷'
  if (currency === 'USD') return '🇺🇸'
  if (currency === 'EUR') return '🇪🇺'
  return '🇨🇦'
}

function isValidThisMonth(item: RecurringExpense, year: number, month: number): boolean {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const startOfMonth = new Date(year, month - 1, 1)
  if (item.start_month && item.start_month > monthKey) return false
  if (!item.valid_until) return true
  const end = new Date(item.valid_until)
  return Number.isNaN(end.getTime()) || end >= startOfMonth
}

export default function MonthlyCashFlow() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [monthlyOverrides, setMonthlyOverrides] = useState<Record<number, RecurringMonthlyOverride>>({})
  const [previousMonthlyOverrides, setPreviousMonthlyOverrides] = useState<Record<number, RecurringMonthlyOverride>>({})
  const [editingRecurringId, setEditingRecurringId] = useState<number | null>(null)
  const [editingAmount, setEditingAmount] = useState('')
  const [savingOverride, setSavingOverride] = useState(false)
  const [overrideError, setOverrideError] = useState('')
  const [statementTransactions, setStatementTransactions] = useState<Transaction[]>([])
  const [cardCharges, setCardCharges] = useState<CardChargeEntry[]>([])
  const [payments, setPayments] = useState<MonthlyPayment[]>([])
  const [savedMatches, setSavedMatches] = useState<SavedRecurringMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<{ month: string, message: string } | null>(null)
  const monthlyRequestRef = useRef(createLatestRequestRunner())
  const monthlyOverrideRequestRef = useRef(createLatestRequestRunner())

  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
  const currentLoadError = loadError?.month === monthStr ? loadError.message : null
  const currentMonthData = hasCurrentMonthlyData(monthStr, loadedMonth, loading)
  const monthIsPending = !currentMonthData && !currentLoadError
  const visibleCurrencies = useMemo(() => {
    const available = new Set<CurrencyCode>()
    accounts.forEach(account => available.add(account.currency))
    recurring.forEach(item => available.add(item.currency))
    statementTransactions.forEach(transaction => available.add(transaction.currency))
    cardCharges.forEach(card => available.add(card.currency))
    const order: CurrencyCode[] = ['CAD', 'BRL', 'USD', 'EUR']
    return order.filter(currency => available.has(currency))
  }, [accounts, cardCharges, recurring, statementTransactions])

  function prepareMonthNavigation() {
    monthlyOverrideRequestRef.current.invalidate()
    setEditingRecurringId(null)
    setSavingOverride(false)
    setOverrideError('')
  }

  function prevMonth() {
    prepareMonthNavigation()
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    prepareMonthNavigation()
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  async function load(requestedMonth: string) {
    await monthlyRequestRef.current.run(
      () => getMonthlyDashboard(requestedMonth),
      {
        onStart: () => {
          setLoading(true)
          setLoadedMonth(null)
          setLoadError(null)
        },
        onSuccess: dashboard => {
          setAccounts(dashboard.accounts)
          setRecurring(dashboard.recurring)
          setPayments(dashboard.payments)
          setSavedMatches(dashboard.matches)
          setMonthlyOverrides(
            dashboard.overrides.reduce<Record<number, RecurringMonthlyOverride>>(
              (result, override) => ({ ...result, [override.recurring_id]: override }),
              {},
            ),
          )
          setPreviousMonthlyOverrides(
            dashboard.previous_month_overrides.reduce<Record<number, RecurringMonthlyOverride>>(
              (result, override) => ({ ...result, [override.recurring_id]: override }),
              {},
            ),
          )
          setEditingRecurringId(null)
          setOverrideError('')
          setStatementTransactions(dashboard.checking_transactions)
          setCardCharges(
            dashboard.card_summaries_due.cards
              .filter(card => card.amount_due > 0)
              .map(card => ({
                accountId: card.account_id,
                name: card.account_name,
                currency: card.currency,
                amount: card.amount_due,
                dueDate: card.payment_due_date?.slice(0, 10),
                dueDay: resolveCardDueDay(
                  card.payment_due_date,
                  dashboard.accounts.find(account => account.id === card.account_id)?.due_day,
                ),
              })),
          )
          setLoadedMonth(requestedMonth)
        },
        onError: () => {
          setLoadError({
            month: requestedMonth,
            message: 'Could not load this month. Please try again.',
          })
        },
        onFinish: () => { setLoading(false) },
      },
    )
  }

  useEffect(() => {
    const requestRunner = monthlyRequestRef.current
    const overrideRequestRunner = monthlyOverrideRequestRef.current
    void load(monthStr)
    return () => {
      requestRunner.invalidate()
      overrideRequestRunner.invalidate()
    }
  }, [monthStr])

  const effectiveRecurring = useMemo(
    () => recurring.map(item => ({
      ...item,
      amount: monthlyOverrides[item.id]?.amount ?? item.amount,
    })),
    [monthlyOverrides, recurring],
  )

  const autoRecurringMatches = useMemo(
    () => loadedMonth === monthStr
      ? findRecurringMatches(
          effectiveRecurring.filter(item => isValidThisMonth(item, year, month)),
          statementTransactions,
          monthStr,
        )
      : {},
    [effectiveRecurring, loadedMonth, month, statementTransactions, monthStr, year],
  )

  const recurringMatches = useMemo(() => {
    const merged: Record<number, RecurringMatchCandidate> = { ...autoRecurringMatches }

    for (const saved of savedMatches) {
      if (saved.source === 'ignored') {
        delete merged[saved.recurring_id]
        continue
      }
      if (!saved.transaction) continue
      const item = effectiveRecurring.find(current => current.id === saved.recurring_id)
      if (!item) continue
      if (!hasExpectedRecurringDate(item, saved.transaction, monthStr)) continue
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
  }, [autoRecurringMatches, effectiveRecurring, monthStr, savedMatches])

  useEffect(() => {
    if (!currentMonthData) return

    const savedRecurringIds = new Set(savedMatches.map(match => match.recurring_id))
    const matchesToSave = Object.entries(autoRecurringMatches)
      .filter(([recurringId]) => !savedRecurringIds.has(Number(recurringId)))
      .map(([recurringId, match]) => {
        const item = effectiveRecurring.find(current => current.id === Number(recurringId))
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
  }, [autoRecurringMatches, currentMonthData, effectiveRecurring, monthStr, savedMatches])

  function startEditingRecurring(item: RecurringExpense) {
    setEditingRecurringId(item.id)
    setEditingAmount(String(item.amount))
    setOverrideError('')
  }

  async function saveMonthlyOverride(item: RecurringExpense) {
    const amount = Number(editingAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setOverrideError('Enter an amount greater than zero.')
      return
    }
    await monthlyOverrideRequestRef.current.run(
      () => api.put(`/recurring-expenses/${item.id}/monthly-overrides/${monthStr}`, { amount }),
      {
        onStart: () => {
          setSavingOverride(true)
          setOverrideError('')
        },
        onSuccess: res => {
          const saved = res.data as RecurringMonthlyOverride
          setMonthlyOverrides(prev => ({ ...prev, [item.id]: saved }))
          setEditingRecurringId(null)
        },
        onError: error => {
          console.error('Failed to save monthly recurring amount', error)
          setOverrideError('Could not save this monthly amount.')
        },
        onFinish: () => setSavingOverride(false),
      },
    )
  }

  async function resetMonthlyOverride(item: RecurringExpense) {
    await monthlyOverrideRequestRef.current.run(
      () => api.delete(`/recurring-expenses/${item.id}/monthly-overrides/${monthStr}`),
      {
        onStart: () => {
          setSavingOverride(true)
          setOverrideError('')
        },
        onSuccess: () => {
          setMonthlyOverrides(prev => {
            const next = { ...prev }
            delete next[item.id]
            return next
          })
          setEditingRecurringId(null)
        },
        onError: error => {
          console.error('Failed to reset monthly recurring amount', error)
          setOverrideError('Could not restore the default amount.')
        },
        onFinish: () => setSavingOverride(false),
      },
    )
  }

  function isPaid(itemType: string, itemId: number): MonthlyPayment | undefined {
    return payments.find(p => p.item_type === itemType && p.item_id === itemId)
  }

  async function ignoreRecurringMatch(item: RecurringExpense, match: RecurringMatchCandidate) {
    const ignoredPayload = {
      month: monthStr,
      recurring_id: item.id,
      transaction_id: match.transaction.id,
      planned_amount: item.amount,
      actual_amount: match.actualAmount,
      variance: match.variance,
      confidence: match.confidence,
      score: match.score,
      source: 'ignored',
    }

    const res = match.savedId
      ? await api.post(`/recurring-matches/${match.savedId}/ignore`)
      : await api.post('/recurring-matches', ignoredPayload)

    const ignoredMatch = res.data as SavedRecurringMatch
    setSavedMatches(prev => {
      const withoutCurrent = prev.filter(current => current.recurring_id !== ignoredMatch.recurring_id)
      return [...withoutCurrent, ignoredMatch]
    })
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

      {(loading || monthIsPending) && <div className="text-center text-[#8BAE90] py-20">Loading...</div>}

      {!loading && currentLoadError && (
        <div className="text-center text-red-600 py-20">{currentLoadError}</div>
      )}

      {currentMonthData && (
        <div>
          <div className="mb-6">
            <CardCycleSummary accounts={accounts} month={monthStr} />
          </div>

          {visibleCurrencies.map(currency => {
            const symbol = currencySymbol(currency)
            const flag = currencyFlag(currency)
            const checking = accounts.filter(a => a.currency === currency && a.account_type !== 'CREDIT_CARD')
            const inBank = checking.reduce((s, a) => s + a.balance, 0)
            const monthRecurring = effectiveRecurring.filter(r => r.currency === currency && isValidThisMonth(r, year, month))
            const previousMonthDate = new Date(year, month - 2, 1)
            const previousMonthYear = previousMonthDate.getFullYear()
            const previousMonthNumber = previousMonthDate.getMonth() + 1
            const incomeList = monthRecurring.filter(r => r.type === 'INCOME')
            const expenseList = monthRecurring.filter(r => r.type !== 'INCOME')
            const totalRecurringExpensesPlanned = expenseList.reduce((s, r) => s + r.amount, 0)
            const matchedExpenseActual = expenseList.reduce((s, r) => s + (recurringMatches[r.id]?.actualAmount || 0), 0)
            const remainingRecurringExpenses = expenseList.reduce((s, r) => s + (recurringMatches[r.id] || isPaid('recurring', r.id) ? 0 : r.amount), 0)
            const currencyIncomeTransactions = statementTransactions.filter(tx => (
              tx.currency === currency && tx.amount > 0 && tx.date.slice(0, 7) === monthStr
            ))
            const currencyActualSalaryIncome = currencyIncomeTransactions.filter(
              tx => (tx.category || '').trim().toLowerCase() === 'salary',
            )
            const currencyActualOtherIncome = currencyIncomeTransactions.filter(
              tx => (tx.category || '').trim().toLowerCase() === 'other income',
            )
            const actualSalaryIncomeTotal = currencyActualSalaryIncome.reduce((s, tx) => s + Number(tx.amount), 0)
            const actualOtherIncomeTotal = currencyActualOtherIncome.reduce((s, tx) => s + Number(tx.amount), 0)
            const cardEntries = cardCharges.filter(card => card.currency === currency)
            const totalCardsPlanned = cardEntries.reduce((sum, card) => sum + card.amount, 0)
            const remainingCards = cardEntries.reduce((sum, card) => {
              return sum + (isPaid('card', card.accountId) ? 0 : card.amount)
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
            const plannedIncomeTotal = incomeList.reduce((s, r) => s + r.amount, 0)
            const projectedIncomeTotal = plannedIncomeTotal + actualOtherIncomeTotal
            const receivedIncomeTotal = actualSalaryIncomeTotal + actualOtherIncomeTotal
            // The bank balance already includes every received deposit. Use the
            // aggregate salary received this month to avoid counting income again
            // when one deposit covers multiple payroll entries or arrives off-date.
            const remainingIncomeTotal = calculateRemainingIncome(
              plannedIncomeTotal,
              actualSalaryIncomeTotal,
            )
            const projectedBalance = calculateProjectedBalance({
              currentBalance: inBank,
              remainingIncome: remainingIncomeTotal,
              remainingExpenses: openFixedExpenses,
              remainingSavings: investmentSavings.remainingDue,
            })
            const previousMonthIncomeList = recurring.filter(item => (
              item.currency === currency
              && item.type === 'INCOME'
              && item.due_day >= 28
              && isValidThisMonth(item, previousMonthYear, previousMonthNumber)
            ))
            const payPeriodIncomes = [
              ...previousMonthIncomeList.map(item => {
                const match = recurringMatches[item.id]
                return {
                  id: `income-previous-${item.id}`,
                  name: item.name,
                  dueLabel: match
                    ? `Received ${formatDueDate(match.transaction.date)}`
                    : `Expected ${new Date(previousMonthYear, previousMonthNumber - 1, item.due_day).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`,
                  amount: previousMonthlyOverrides[item.id]?.amount ?? item.amount,
                  actualAmount: match?.actualAmount,
                  period: 'first' as const,
                }
              }),
              ...incomeList.filter(item => item.due_day <= 27).map(item => {
                const match = recurringMatches[item.id]
                return {
                  id: `income-current-${item.id}`,
                  name: item.name,
                  dueLabel: match
                    ? `Received ${formatDueDate(match.transaction.date)}`
                    : `Expected ${new Date(year, month - 1, item.due_day).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`,
                  amount: item.amount,
                  actualAmount: match?.actualAmount,
                  period: item.due_day <= 14 ? 'first' as const : 'second' as const,
                }
              }),
            ]
            const payPeriodSummary = buildPayPeriodSummary({
              incomes: payPeriodIncomes,
              expenses: [
                ...expenseList.map(item => ({
                  id: `recurring-${item.id}`,
                  name: item.name,
                  kind: 'Recurring' as const,
                  dueLabel: `day ${item.due_day}`,
                  amount: item.amount,
                  dueDay: item.due_day,
                  status: isPaid('recurring', item.id)
                    ? 'Paid' as const
                    : recurringMatches[item.id]
                      ? 'Matched' as const
                      : undefined,
                })),
                ...cardEntries.map(card => ({
                  id: `card-${card.accountId}`,
                  name: card.name,
                  kind: 'Credit card' as const,
                  dueLabel: card.dueDate ? formatDueDate(card.dueDate) : `day ${card.dueDay}`,
                  amount: card.amount,
                  dueDay: card.dueDay,
                  status: isPaid('card', card.accountId) ? 'Paid' as const : undefined,
                })),
              ],
            })

            if (inBank === 0 && incomeList.length === 0 && plannedFixedExpenses === 0 && investmentSavings.plannedDue === 0) return null

            return (
              <div key={currency} className="mb-10">
                <h2 className="text-xl font-bold text-[#123D32] mb-4">{flag} {currency}</h2>

                <section aria-label={`${currency} month story`} className="mb-5 overflow-hidden rounded-2xl border border-[#123D32] bg-white shadow-[0_18px_50px_rgba(18,61,50,0.06)]">
                  <div className="flex flex-col gap-1 bg-[#123D32] px-5 py-4 text-white sm:flex-row sm:items-end sm:justify-between">
                    <div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/65">Month story</p><h3 className="mt-1 text-xl font-bold">Where this month is expected to land</h3></div>
                    <p className="money text-2xl font-bold text-[#D8B541]">{symbol} {fmt(projectedBalance)}</p>
                  </div>
                  <div className="grid grid-cols-1 divide-y divide-[#E6EEE7] sm:grid-cols-5 sm:divide-x sm:divide-y-0">
                    {[
                      { label: 'Current balance', value: inBank, sign: '', tone: 'text-[#123D32]' },
                      { label: 'Still to receive', value: remainingIncomeTotal, sign: '+', tone: 'text-[#236B4B]' },
                      { label: 'Still to pay', value: openFixedExpenses, sign: '−', tone: 'text-[#B54B4B]' },
                      { label: 'Still to save', value: investmentSavings.remainingDue, sign: '−', tone: 'text-[#123D32]' },
                      { label: 'End of month', value: projectedBalance, sign: '=', tone: 'text-[#B28E18]' },
                    ].map((step, index) => (
                      <div key={step.label} className="relative px-4 py-4">
                        <div className="mb-3 flex items-center gap-2"><span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${index === 4 ? 'bg-[#D8B541] text-[#123D32]' : 'bg-[#EDF4EE] text-[#55705E]'}`}>{index + 1}</span><p className="text-xs font-semibold text-[#55705E]">{step.label}</p></div>
                        <p className={`money text-base font-bold ${step.tone}`}>{step.sign} {symbol} {fmt(step.value)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-2 border-t border-[#E6EEE7] bg-[#F8FBF8] px-5 py-3 text-xs text-[#55705E] sm:grid-cols-3">
                    <span>Received income {symbol} {fmt(receivedIncomeTotal)}</span><span>Still to receive {symbol} {fmt(remainingIncomeTotal)}</span><span>Still to pay {symbol} {fmt(openFixedExpenses)}</span>
                  </div>
                </section>

                <section aria-labelledby={`${currency}-pay-period-title`} className="mb-5 overflow-hidden rounded-xl border-2 border-[#1B4D3E] bg-[#FCFEFC]">
                  <div className="border-b border-[#D4E4D5] px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-6">
                    <div>
                      <p id={`${currency}-pay-period-title`} className="section-title">Plan by pay period</p>
                      <p className="mt-1 text-xs text-[#55705E]">A quick check of what is available and what is due on each side of the month.</p>
                    </div>
                    <p className="mt-2 max-w-xl text-xs text-[#7BAE8A] sm:mt-0 sm:text-right">
                      Income and bills grouped around each pay cycle.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 divide-y divide-[#D4E4D5] md:grid-cols-2 md:divide-x md:divide-y-0">
                    {[
                      { label: 'First pay cycle', incomeRange: 'Income 28→14', billRange: 'Bills 01→14', totals: payPeriodSummary.firstPeriod },
                      { label: 'Second pay cycle', incomeRange: 'Income 15→27', billRange: `Bills 15→${new Date(year, month, 0).getDate()}`, totals: payPeriodSummary.secondPeriod },
                    ].map(period => {
                      const positive = period.totals.balance >= 0
                      return (
                        <div key={period.label} className="px-4 py-4 sm:px-5">
                          <div className="mb-4 flex items-center justify-between gap-4">
                            <h3 className="font-bold text-[#1B4D3E]">{period.label}</h3>
                            <span className="flex flex-wrap justify-end gap-1">
                              <span className="rounded-full bg-[#E8F3EA] px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide text-[#236B4B]">{period.incomeRange}</span>
                              <span className="rounded-full bg-[#F3E8E8] px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide text-[#B85050]">{period.billRange}</span>
                            </span>
                          </div>
                          <div className="space-y-2 text-sm">
                            <details className="group rounded-lg border border-[#E1EAE2] bg-white/70 open:bg-white">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2D6A4F]">
                                <span className="flex items-center gap-2 text-[#55705E]">
                                  <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden="true" />
                                  Income
                                  <span className="rounded-full bg-[#E8F3EA] px-2 py-0.5 text-[10px] font-bold text-[#236B4B]">{period.totals.incomes.length}</span>
                                </span>
                                <span className="money whitespace-nowrap font-semibold text-[#1B6B3A]">+ {symbol} {fmt(period.totals.income)}</span>
                              </summary>
                              <div className="border-t border-[#EDF2ED] px-3 py-1">
                                {period.totals.incomes.length === 0 ? (
                                  <p className="py-2 text-xs text-[#7BAE8A]">No planned income in this period.</p>
                                ) : period.totals.incomes.map(income => (
                                  <div key={income.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-[#EDF2ED] py-2.5 last:border-b-0">
                                    <div className="min-w-0">
                                      <p className="truncate font-semibold text-[#1B4D3E]">{income.name}</p>
                                      <p className="mt-0.5 text-[11px] text-[#7BAE8A]">{income.dueLabel}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="money whitespace-nowrap font-semibold text-[#1B6B3A]">+ {symbol} {fmt(income.amount)}</p>
                                      <p className={`mt-0.5 text-[10px] font-bold uppercase tracking-wide ${income.status === 'Received' ? 'text-[#236B4B]' : 'text-[#B28E18]'}`}>{income.status}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                            <details className="group rounded-lg border border-[#E1EAE2] bg-white/70 open:bg-white">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2D6A4F]">
                                <span className="flex items-center gap-2 text-[#55705E]">
                                  <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden="true" />
                                  Bills due
                                  <span className="rounded-full bg-[#F3E8E8] px-2 py-0.5 text-[10px] font-bold text-[#B85050]">{period.totals.bills.length}</span>
                                </span>
                                <span className="money font-semibold text-[#B85050]">− {symbol} {fmt(period.totals.expenses)}</span>
                              </summary>
                              <div className="border-t border-[#EDF2ED] px-3 py-1">
                                {period.totals.bills.length === 0 ? (
                                  <p className="py-2 text-xs text-[#7BAE8A]">No planned bills in this period.</p>
                                ) : period.totals.bills.map(bill => (
                                  <div key={bill.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-[#EDF2ED] py-2.5 last:border-b-0">
                                    <div className="min-w-0">
                                      <p className="truncate font-semibold text-[#1B4D3E]">{bill.name}</p>
                                      <p className="mt-0.5 text-[11px] text-[#7BAE8A]">{bill.kind} · {bill.dueLabel}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="money whitespace-nowrap font-semibold text-[#B85050]">− {symbol} {fmt(bill.amount)}</p>
                                      {bill.status && <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7BAE8A]">{bill.status} · included</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                            <div className="mt-3 flex items-center justify-between gap-4 border-t border-[#D4E4D5] pt-3"><span className="font-bold text-[#1B4D3E]">Period balance</span><span className={`money text-base font-bold ${positive ? 'text-[#1B6B3A]' : 'text-[#B85050]'}`}>{positive ? '+' : '−'} {symbol} {fmt(Math.abs(period.totals.balance))}</span></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="mb-5 rounded-xl border-2 border-[#1B4D3E] bg-[#F7FBF8] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="section-title">Income</p>
                    <p className="text-xs text-[#8BAE90]">
                      Guaranteed {symbol} {fmt(plannedIncomeTotal)} · received {symbol} {fmt(receivedIncomeTotal)}
                    </p>
                  </div>
                  {incomeList.length === 0 && currencyIncomeTransactions.length === 0 ? (
                    <div className="bg-white rounded-lg border border-[#D4E4D5] px-4 py-3 text-sm text-[#8BAE90]">
                      No recurring income registered.
                    </div>
                  ) : (
                    <>
                      {payrollIncome.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          {payrollIncome.map(r => (
                            <div key={r.id} className="rounded-lg border border-[#D4E4D5] bg-[#F4FAF5] px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-bold truncate text-[#1B4D3E]">{r.name}</p>
                                  <p className="text-xs text-[#7BAE8A] mt-1">
                                    day {r.due_day}
                                    {r.valid_until && (
                                      <span className="text-amber-500 ml-2">
                                        until {new Date(r.valid_until).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <div className="text-right">
                                  {editingRecurringId === r.id ? (
                                    <div className="flex flex-col items-end gap-1">
                                      <div className="flex items-center gap-1">
                                        <span className="text-xs text-[#8BAE90]">{symbol}</span>
                                        <input
                                          type="number"
                                          min="0.01"
                                          step="0.01"
                                          value={editingAmount}
                                          onChange={event => setEditingAmount(event.target.value)}
                                          onKeyDown={event => {
                                            if (event.key === 'Enter') saveMonthlyOverride(r)
                                            if (event.key === 'Escape') setEditingRecurringId(null)
                                          }}
                                          autoFocus
                                          className="w-28 rounded-md border border-[#B9D1BD] bg-white px-2 py-1 text-right text-sm text-[#1B4D3E] outline-none focus:border-[#2D6A4F] focus:ring-2 focus:ring-[#D4E4D5]"
                                          aria-label={`Amount for ${r.name} in ${monthLabel}`}
                                        />
                                        <button onClick={() => saveMonthlyOverride(r)} disabled={savingOverride} className="rounded-md p-1.5 text-[#1B6B3A] hover:bg-[#E8F3EA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D6A4F] disabled:opacity-50" title={`Save amount only for ${monthLabel}`}><Save size={15} /></button>
                                        <button onClick={() => setEditingRecurringId(null)} disabled={savingOverride} className="rounded-md p-1.5 text-[#8BAE90] hover:bg-[#EDF4EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D6A4F]" title="Cancel"><X size={15} /></button>
                                      </div>
                                      {monthlyOverrides[r.id] && (
                                        <button onClick={() => resetMonthlyOverride(r)} disabled={savingOverride} className="flex items-center gap-1 text-[11px] text-[#7BAE8A] hover:text-[#1B4D3E] disabled:opacity-50" title="Use the regular recurring amount again"><RotateCcw size={11} />Restore default {symbol} {fmt(recurring.find(item => item.id === r.id)?.amount ?? r.amount)}</button>
                                      )}
                                      {overrideError && <p className="text-xs font-semibold text-[#B85050]">{overrideError}</p>}
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex items-center justify-end gap-1">
                                        <p className="font-bold whitespace-nowrap text-[#1B6B3A]">+ {symbol} {fmt(r.amount)}</p>
                                        <button onClick={() => startEditingRecurring(r)} className="rounded-md p-1 text-[#7BAE8A] hover:bg-[#E8F3EA] hover:text-[#1B4D3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D6A4F]" title={`Edit amount only for ${monthLabel}`}><Pencil size={13} /></button>
                                      </div>
                                      {monthlyOverrides[r.id] && <p className="text-[11px] font-semibold text-amber-600">custom for {monthLabel}</p>}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
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
                                  <div className="text-right">
                                    {editingRecurringId === r.id ? (
                                      <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-[#8BAE90]">{symbol}</span>
                                          <input
                                            type="number"
                                            min="0.01"
                                            step="0.01"
                                            value={editingAmount}
                                            onChange={event => setEditingAmount(event.target.value)}
                                            onKeyDown={event => {
                                              if (event.key === 'Enter') saveMonthlyOverride(r)
                                              if (event.key === 'Escape') setEditingRecurringId(null)
                                            }}
                                            autoFocus
                                            className="w-28 rounded-md border border-[#B9D1BD] bg-white px-2 py-1 text-right text-sm text-[#1B4D3E] outline-none focus:border-[#2D6A4F] focus:ring-2 focus:ring-[#D4E4D5]"
                                            aria-label={`Amount for ${r.name} in ${monthLabel}`}
                                          />
                                          <button onClick={() => saveMonthlyOverride(r)} disabled={savingOverride} className="rounded-md p-1.5 text-[#1B6B3A] hover:bg-[#E8F3EA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D6A4F] disabled:opacity-50" title={`Save amount only for ${monthLabel}`}><Save size={15} /></button>
                                          <button onClick={() => setEditingRecurringId(null)} disabled={savingOverride} className="rounded-md p-1.5 text-[#8BAE90] hover:bg-[#EDF4EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D6A4F]" title="Cancel"><X size={15} /></button>
                                        </div>
                                        {monthlyOverrides[r.id] && (
                                          <button onClick={() => resetMonthlyOverride(r)} disabled={savingOverride} className="flex items-center gap-1 text-[11px] text-[#7BAE8A] hover:text-[#1B4D3E] disabled:opacity-50" title="Use the regular recurring amount again"><RotateCcw size={11} />Restore default {symbol} {fmt(recurring.find(item => item.id === r.id)?.amount ?? r.amount)}</button>
                                        )}
                                        {overrideError && <p className="text-xs font-semibold text-[#B85050]">{overrideError}</p>}
                                      </div>
                                    ) : (
                                      <>
                                        <div className="flex items-center justify-end gap-1">
                                          <p className="text-[#1B6B3A] font-bold whitespace-nowrap">+ {symbol} {fmt(r.amount)}</p>
                                          <button onClick={() => startEditingRecurring(r)} className="rounded-md p-1 text-[#3F6EA8] hover:bg-[#E7EFFA] hover:text-[#1B4D3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F6EA8]" title={`Edit amount only for ${monthLabel}`}><Pencil size={13} /></button>
                                        </div>
                                        {monthlyOverrides[r.id] && <p className="text-[11px] font-semibold text-amber-600">custom for {monthLabel}</p>}
                                      </>
                                    )}
                                  </div>
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
                          <span className="text-[#1B4D3E] font-bold">Guaranteed Payroll</span>
                          <span className="text-[#1B6B3A] font-bold">+ {symbol} {fmt(payrollIncomeTotal)}</span>
                        </div>
                        <div className="flex justify-between items-center px-4 py-3 border-b border-[#EDF4EE]">
                          <span className="text-[#1B4D3E] font-bold">Extra Income Received</span>
                          <span className="text-[#1B6B3A] font-bold">+ {symbol} {fmt(actualOtherIncomeTotal)}</span>
                        </div>
                        <div className="flex justify-between items-center px-4 py-3 bg-[#F4FAF5]">
                          <span className="text-[#1B4D3E] font-bold">Total Projected Income</span>
                          <span className="text-[#1B6B3A] font-bold">+ {symbol} {fmt(projectedIncomeTotal)}</span>
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
                      cardEntries.map(cardCharge => {
                        const card = accounts.find(account => account.id === cardCharge.accountId)
                        const paid = isPaid('card', cardCharge.accountId)

                        return (
                          <div key={`${cardCharge.accountId}-${cardCharge.currency}`} className={`rounded-lg border px-4 py-3 transition ${
                            paid ? 'bg-[#F4FAF5] border-[#D4E4D5]' : 'bg-white border-[#D4E4D5]'
                          }`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 min-w-0">
                                <button
                                  onClick={() => card && togglePaid('card', card.id, cardCharge.name)}
                                  className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0 ${
                                    paid ? 'bg-[#1B6B3A] border-[#1B6B3A] text-white' : 'border-[#D4E4D5] hover:border-[#4E9A7A]'
                                  }`}
                                  title={paid ? 'Marked as paid' : 'Mark as paid'}
                                >
                                  {paid && <Check size={13} />}
                                </button>
                                <div className="min-w-0">
                                  <p className={`text-sm font-semibold transition truncate ${paid ? 'text-[#8BAE90] line-through' : 'text-[#2C3E2D]'}`}>{cardCharge.name}</p>
                                  {cardCharge.dueDate && <p className="text-xs text-[#8BAE90] mt-1">due {formatDueDate(cardCharge.dueDate)}</p>}
                                </div>
                              </div>
                              <span className={`font-bold text-sm transition whitespace-nowrap ${paid ? 'text-[#8BAE90] line-through' : 'text-[#B85050]'}`}>
                                - {symbol} {fmt(cardCharge.amount)}
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
                                    onClick={() => match ? ignoreRecurringMatch(r, match) : togglePaid('recurring', r.id, r.name)}
                                    className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0 ${
                                      done ? 'bg-[#1B6B3A] border-[#1B6B3A] text-white hover:bg-[#B85050] hover:border-[#B85050]' : 'border-[#D4E4D5] hover:border-[#4E9A7A]'
                                    }`}
                                    title={match ? 'Unmark matched transaction for this month' : paid ? 'Marked as paid' : 'Mark as paid'}
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
                                  {editingRecurringId === r.id ? (
                                    <div className="flex flex-col items-end gap-1">
                                      <div className="flex items-center gap-1">
                                        <span className="text-xs text-[#8BAE90]">{symbol}</span>
                                        <input
                                          type="number"
                                          min="0.01"
                                          step="0.01"
                                          value={editingAmount}
                                          onChange={event => setEditingAmount(event.target.value)}
                                          onKeyDown={event => {
                                            if (event.key === 'Enter') saveMonthlyOverride(r)
                                            if (event.key === 'Escape') setEditingRecurringId(null)
                                          }}
                                          autoFocus
                                          className="w-28 rounded-md border border-[#B9D1BD] px-2 py-1 text-right text-sm text-[#1B4D3E] outline-none focus:border-[#2D6A4F]"
                                          aria-label={`Amount for ${r.name} in ${monthLabel}`}
                                        />
                                        <button
                                          onClick={() => saveMonthlyOverride(r)}
                                          disabled={savingOverride}
                                          className="rounded-md p-1.5 text-[#1B6B3A] hover:bg-[#E8F3EA] disabled:opacity-50"
                                          title={`Save amount only for ${monthLabel}`}
                                        >
                                          <Save size={15} />
                                        </button>
                                        <button
                                          onClick={() => setEditingRecurringId(null)}
                                          disabled={savingOverride}
                                          className="rounded-md p-1.5 text-[#8BAE90] hover:bg-[#EDF4EE]"
                                          title="Cancel"
                                        >
                                          <X size={15} />
                                        </button>
                                      </div>
                                      {monthlyOverrides[r.id] && (
                                        <button
                                          onClick={() => resetMonthlyOverride(r)}
                                          disabled={savingOverride}
                                          className="flex items-center gap-1 text-[11px] text-[#7BAE8A] hover:text-[#1B4D3E] disabled:opacity-50"
                                          title="Use the regular recurring amount again"
                                        >
                                          <RotateCcw size={11} />
                                          Restore default {symbol} {fmt(recurring.find(item => item.id === r.id)?.amount ?? r.amount)}
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex items-center justify-end gap-1">
                                        <span className={`font-semibold text-sm transition ${done ? 'text-[#8BAE90] line-through' : 'text-[#B85050]'}`}>
                                          - {symbol} {fmt(match?.actualAmount || r.amount)}
                                        </span>
                                        <button
                                          onClick={() => startEditingRecurring(r)}
                                          className="rounded-md p-1 text-[#7BAE8A] hover:bg-[#EDF4EE] hover:text-[#1B4D3E]"
                                          title={`Edit amount only for ${monthLabel}`}
                                        >
                                          <Pencil size={13} />
                                        </button>
                                      </div>
                                      {monthlyOverrides[r.id] && (
                                        <p className="text-[11px] font-semibold text-amber-600">custom for {monthLabel}</p>
                                      )}
                                      {match && Math.abs(match.variance) > 0.005 && (
                                        <p className="text-xs text-[#8BAE90]">planned {symbol} {fmt(r.amount)}</p>
                                      )}
                                    </>
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
                          {overrideError && (
                            <p className="text-xs font-semibold text-[#B85050] mt-1">{overrideError}</p>
                          )}
                        </div>
                      </div>
                  </section>
                </div>
                </section>

                <details className="surface-card overflow-hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-bold text-[#123D32] hover:bg-[#F4FAF5]">
                    <span>How FinDu calculated this projection</span>
                    <span className="money text-[#55705E]">Total savings {symbol} {fmt(investmentPortfolio.savedTotal)}</span>
                  </summary>
                  <div className="border-t border-[#EDF4EE] bg-[#F8FBF8] px-5 py-4">
                    <p className="money text-sm text-[#55705E]">
                      {symbol} {fmt(inBank)} + {fmt(remainingIncomeTotal)} still to receive − {fmt(openFixedExpenses)} still to pay − {fmt(investmentSavings.remainingDue)} still to save = <strong className="text-[#123D32]">{symbol} {fmt(projectedBalance)}</strong>
                    </p>
                    <p className="mt-2 text-xs text-[#55705E]">Savings total comes from {investmentPortfolio.openPlans} open investment plan{investmentPortfolio.openPlans === 1 ? '' : 's'}.</p>
                  </div>
                </details>

                <hr className="border-[#D4E4D5] my-8" />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
