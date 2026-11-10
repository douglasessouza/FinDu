import type { Account, RecurringExpense, Transaction } from '../services/api.ts'
import { hasExpectedIncomeDate } from './payPeriodSummary.ts'

export interface RecurringMatchCandidate {
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
  const [year, month, day] = dateValue.slice(0, 10).split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return 31
  const lastDayOfTransactionMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return Math.abs(date.getDate() - Math.min(dueDay, lastDayOfTransactionMonth))
}

export function isPayrollIncome(item: RecurringExpense): boolean {
  if (item.type !== 'INCOME') return false
  const text = `${item.name} ${item.category || ''}`.toLowerCase()
  return text.includes('payroll') || text.includes('salary')
}

export function hasExpectedRecurringDate(item: RecurringExpense, tx: Transaction, cashFlowMonth: string): boolean {
  if (item.type === 'INCOME') {
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

export function findRecurringMatches(
  items: RecurringExpense[],
  transactions: Transaction[],
  monthStr: string,
  accounts: Account[] = [],
  calendar = false,
): Record<number, RecurringMatchCandidate> {
  const matches: Record<number, RecurringMatchCandidate> = {}
  const usedTransactions = new Set<number>()
  const cardAccountIds = new Set(accounts.filter(account => account.account_type === 'CREDIT_CARD').map(account => account.id))
  const sortedItems = [...items].sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name))

  for (const item of sortedItems) {
    const candidates = transactions
      .filter(tx => calendar ? tx.date.slice(0, 7) === monthStr && dayDistance(tx.date, item.due_day) <= 7 : hasExpectedRecurringDate(item, tx, monthStr))
      .filter(tx => !item.payment_account_id || tx.account_id === item.payment_account_id)
      .filter(tx => item.type === 'INCOME' || (item.payment_method === 'CREDIT_CARD'
        ? cardAccountIds.has(tx.account_id) : !cardAccountIds.has(tx.account_id)))
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

