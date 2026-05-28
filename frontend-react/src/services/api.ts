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