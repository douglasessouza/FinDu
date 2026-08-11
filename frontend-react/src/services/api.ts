import axios from 'axios'
import {
  cachedGet,
  clearCachedGets,
  invalidateReferenceData as invalidateReferenceDataCache,
  invalidateReferenceDataForMutation,
  REFERENCE_CACHE_KEYS,
} from './cache'

const AUTH_TOKEN_KEY = 'findu_auth_token'

const api = axios.create({
  baseURL: '/api',
})

api.interceptors.response.use(response => {
  invalidateReferenceDataForMutation(response.config.method, response.config.url)
  return response
})

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string) {
  clearCachedGets()
  localStorage.setItem(AUTH_TOKEN_KEY, token)
  api.defaults.headers.common.Authorization = `Bearer ${token}`
}

export function clearAuthToken() {
  clearCachedGets()
  localStorage.removeItem(AUTH_TOKEN_KEY)
  delete api.defaults.headers.common.Authorization
}

const existingToken = getAuthToken()
if (existingToken) {
  api.defaults.headers.common.Authorization = `Bearer ${existingToken}`
}

export default api

// ── Types ──────────────────────────────────────────────
export type CurrencyCode = 'BRL' | 'CAD' | 'USD' | 'EUR'

export interface Account {
  id: number
  name: string
  bank: string
  account_type: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD'
  currency: CurrencyCode
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
  currency: CurrencyCode
  date: string
  category?: string
  statement_month?: string
  payment_due_date?: string
}

export interface RecurringExpense {
  id: number
  name: string
  amount: number
  currency: CurrencyCode
  due_day: number
  type: 'INCOME' | 'EXPENSE'
  category?: string
  start_month?: string | null
  valid_until?: string
}

export interface RecurringMonthlyOverride {
  id: number
  recurring_id: number
  month: string
  amount: number
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
  currency: CurrencyCode
  start_month: string
  valid_until?: string | null
  is_active: boolean
  items?: CategoryBudgetItem[]
  created_at?: string | null
}

export interface CategoryBudgetItem {
  id?: number
  name: string
  amount: number
  created_at?: string | null
}

export interface MonthlyPayment {
  id: number
  month: string
  item_type: string
  item_id: number
  item_name: string
  paid_at: string
}

export interface CardStatementSummaryItem {
  account_id: number
  account_name: string
  currency: CurrencyCode
  charges: number
  credits: number
  payments: number
  amount_due: number
  count: number
  payment_due_date?: string | null
}

export interface CardStatementCurrencyTotals {
  charges: number
  credits: number
  payments: number
  amount_due: number
}

export interface CardStatementSummaryResponse {
  month: string
  cards: CardStatementSummaryItem[]
  total_charges: number | null
  total_credits: number | null
  total_payments: number | null
  total_amount_due: number | null
  currency: CurrencyCode | null
  totals_by_currency: Partial<Record<CurrencyCode, CardStatementCurrencyTotals>>
}

export interface MonthlyDashboardResponse {
  month: string
  accounts: Account[]
  recurring: RecurringExpense[]
  payments: MonthlyPayment[]
  matches: RecurringMatch[]
  overrides: RecurringMonthlyOverride[]
  checking_transactions: Transaction[]
  card_summaries: CardStatementSummaryResponse
  card_summaries_due: CardStatementSummaryResponse
}

export interface ImportStatementTransaction {
  description: string
  amount: number
  currency: CurrencyCode
  date: string
  category?: string
  import_fingerprint?: string
  import_occurrence?: number
  import_identity_token?: string
}

export interface ImportConfirmRequest {
  account_id: number
  idempotency_key: string
  transactions: ImportStatementTransaction[]
}

export interface ImportedTransaction extends Transaction {
  import_batch_id: string
  import_fingerprint?: string | null
  import_occurrence?: number | null
  import_idempotency_key?: string | null
  created_at?: string
}

export interface ImportConfirmResponse {
  import_batch_id: string
  inserted_count: number
  skipped_count: number
  transactions: ImportedTransaction[]
}

export interface TransactionPageParams {
  accountId?: number
  dateFrom?: string
  dateTo?: string
  month?: string
  category?: string
  limit?: number
  cursor?: string
}

export interface PaginatedTransactionsResponse {
  items: Transaction[]
  next_cursor: string | null
}

export interface SpendingCurrencyValues {
  cards: number
  debit: number
}

export interface SpendingCategorySummary {
  cards: number | null
  debit: number | null
  currency: CurrencyCode | null
  by_currency: Partial<Record<CurrencyCode, SpendingCurrencyValues>>
}

export type SpendingAnalysisResponse = Record<string, Record<string, SpendingCategorySummary>>

export type ExchangeCurrency = Extract<CurrencyCode, 'BRL' | 'CAD' | 'USD'>

export interface ExchangeRatesResponse {
  base: ExchangeCurrency
  rates: Record<ExchangeCurrency, number>
  rate_last_updated_at?: string | null
  rate_next_update_at?: string | null
  fetched_at: string
  source?: string
  update_frequency?: 'hourly' | 'daily'
  cache_status?: 'fresh' | 'cached' | 'stale'
  browser_cache_status?: 'fresh' | 'stale'
}

const REFERENCE_CACHE_TTL_MS = {
  accounts: 30_000,
  categories: 5 * 60_000,
  recurring: 30_000,
} as const

export async function getAccounts(): Promise<Account[]> {
  return cachedGet(
    REFERENCE_CACHE_KEYS.accounts,
    async () => (await api.get<Account[]>('/accounts')).data,
    REFERENCE_CACHE_TTL_MS.accounts,
  )
}

export async function getCategories(): Promise<Category[]> {
  return cachedGet(
    REFERENCE_CACHE_KEYS.categories,
    async () => (await api.get<Category[]>('/categories')).data,
    REFERENCE_CACHE_TTL_MS.categories,
  )
}

export async function getRecurringExpenses(): Promise<RecurringExpense[]> {
  return cachedGet(
    REFERENCE_CACHE_KEYS.recurring,
    async () => (await api.get<RecurringExpense[]>('/recurring-expenses')).data,
    REFERENCE_CACHE_TTL_MS.recurring,
  )
}

export function invalidateReferenceData(key: keyof typeof REFERENCE_CACHE_KEYS): void {
  invalidateReferenceDataCache(key)
}

export async function getMonthlyDashboard(month: string): Promise<MonthlyDashboardResponse> {
  return (await api.get<MonthlyDashboardResponse>('/dashboard/monthly', { params: { month } })).data
}

export async function getCardStatementSummary(month: string): Promise<CardStatementSummaryResponse> {
  return (await api.get<CardStatementSummaryResponse>('/card-statements/summary', { params: { month } })).data
}

export async function getTransactionsPage(
  params: TransactionPageParams,
): Promise<PaginatedTransactionsResponse> {
  return (await api.get<PaginatedTransactionsResponse>('/transactions', {
    params: {
      account_id: params.accountId,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      month: params.month,
      category: params.category,
      limit: params.limit,
      cursor: params.cursor,
    },
  })).data
}

export async function getTransactions(
  params: Omit<TransactionPageParams, 'cursor'>,
): Promise<Transaction[]> {
  const transactions: Transaction[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await getTransactionsPage({ ...params, limit: params.limit ?? 500, cursor })
    transactions.push(...page.items)
    if (!page.next_cursor) break
    if (seenCursors.has(page.next_cursor)) throw new Error('Repeated transaction cursor')
    seenCursors.add(page.next_cursor)
    cursor = page.next_cursor
  } while (cursor)
  return transactions
}

export async function getSpendingAnalysis(
  monthFrom: string,
  monthTo: string,
): Promise<SpendingAnalysisResponse> {
  return (await api.get<SpendingAnalysisResponse>('/spending-analysis', {
    params: { month_from: monthFrom, month_to: monthTo },
  })).data
}

export async function updateTransactionCategories(
  updates: { id: number; category: string }[],
): Promise<{ updated_count: number; transactions: { id: number; category: string }[] }> {
  return (await api.patch('/transactions/categories', { updates })).data
}

export async function confirmStatementImport(
  request: ImportConfirmRequest,
): Promise<ImportConfirmResponse> {
  return (await api.post<ImportConfirmResponse>('/imports/confirm', request)).data
}

interface StoredExchangeRates {
  response: ExchangeRatesResponse
  expiresAt: number
}

const EXCHANGE_CACHE_PREFIX = 'findu_exchange_rates_lkg:'

function exchangeStorageKey(base: ExchangeCurrency): string {
  return `${EXCHANGE_CACHE_PREFIX}${base}`
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function validExchangeResponse(value: unknown, base: ExchangeCurrency): value is ExchangeRatesResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ExchangeRatesResponse>
  if (candidate.base !== base || !candidate.rates || typeof candidate.rates !== 'object') return false
  if (!candidate.fetched_at || !Number.isFinite(Date.parse(candidate.fetched_at))) return false
  return (['CAD', 'USD', 'BRL'] as const).every(currency => positiveFinite(candidate.rates?.[currency]))
}

function exchangeExpiry(response: ExchangeRatesResponse): number {
  const fetchedAt = Date.parse(response.fetched_at)
  const nextUpdateAt = response.rate_next_update_at
    ? Date.parse(response.rate_next_update_at)
    : Number.NaN
  if (Number.isFinite(nextUpdateAt) && nextUpdateAt > fetchedAt) return nextUpdateAt
  const ttlMs = response.update_frequency === 'hourly' ? 60 * 60_000 : 24 * 60 * 60_000
  return fetchedAt + ttlMs
}

function readStoredExchangeRates(base: ExchangeCurrency): StoredExchangeRates | null {
  try {
    const raw = localStorage.getItem(exchangeStorageKey(base))
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<StoredExchangeRates>
    if (
      !validExchangeResponse(stored.response, base)
      || typeof stored.expiresAt !== 'number'
      || !Number.isFinite(stored.expiresAt)
    ) {
      localStorage.removeItem(exchangeStorageKey(base))
      return null
    }
    return { response: stored.response, expiresAt: stored.expiresAt }
  } catch {
    return null
  }
}

function writeStoredExchangeRates(response: ExchangeRatesResponse): StoredExchangeRates {
  const stored = { response, expiresAt: exchangeExpiry(response) }
  try {
    localStorage.setItem(exchangeStorageKey(response.base), JSON.stringify(stored))
  } catch {
    // Browser storage may be unavailable; the live response remains usable.
  }
  return stored
}

export async function getExchangeRates(
  base: ExchangeCurrency,
  options: { forceRefresh?: boolean } = {},
): Promise<ExchangeRatesResponse> {
  const stored = readStoredExchangeRates(base)
  if (!options.forceRefresh && stored && stored.expiresAt > Date.now()) {
    return { ...stored.response, browser_cache_status: 'fresh' }
  }

  try {
    const response = (await api.get<ExchangeRatesResponse>('/exchange-rates', { params: { base } })).data
    if (!validExchangeResponse(response, base)) throw new Error('Invalid exchange-rate response')
    writeStoredExchangeRates(response)
    return { ...response, browser_cache_status: 'fresh' }
  } catch (error) {
    if (stored) return { ...stored.response, browser_cache_status: 'stale' }
    throw error
  }
}
