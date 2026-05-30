import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export default api

// ── Types ──────────────────────────────────────────────
export interface Account {
  id: number
  name: string
  bank: string
  account_type: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD'
  currency: 'BRL' | 'CAD' | 'USD' | 'EUR'
  balance: number
  credit_limit?: number
  closing_day?: number
  due_day?: number
}

export interface Transaction {
  id: number
  account_id: number
  description: string
  amount: number
  currency: string
  date: string
  category?: string
  statement_month?: string
  payment_due_date?: string
}

export interface RecurringExpense {
  id: number
  name: string
  amount: number
  currency: string
  due_day: number
  type: 'INCOME' | 'EXPENSE'
  category?: string
  valid_until?: string
}

export interface Category {
  id: number
  name: string
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER'
  is_default: boolean
}

export interface RecurringMatch {
  id: number
  month: string
  recurring_id: number
  transaction_id: number
  planned_amount: number
  actual_amount: number
  variance: number
  confidence: 'High' | 'Medium'
  score: number
  source: string
  created_at?: string | null
  transaction: Transaction | null
}

export interface CategoryBudget {
  id: number
  category: string
  amount: number
  currency: 'BRL' | 'CAD' | 'USD' | 'EUR'
  start_month: string
  valid_until?: string | null
  is_active: boolean
  created_at?: string | null
}
