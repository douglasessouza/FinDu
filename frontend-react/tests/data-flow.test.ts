import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cachedGet,
  clearCachedGets,
  invalidateReferenceDataForMutation,
  REFERENCE_CACHE_KEYS,
} from '../src/services/cache.ts'
import {
  createLatestRequestRunner,
  hasCurrentMonthlyData,
  loadRowsPreservingPrevious,
  replaceSelectedMonth,
} from '../src/services/reportingData.ts'
import { calculateProjectedBalance, calculateRemainingIncome } from '../src/utils/cashFlowProjection.ts'
import { buildPayPeriodSummary, resolveCardDueDay } from '../src/utils/payPeriodSummary.ts'

test('pay-period summary includes day 15 in the first period', () => {
  const summary = buildPayPeriodSummary({
    incomes: [
      { amount: 2060, dueDay: 15 },
      { amount: 3499.88, dueDay: 28 },
      { amount: 2060, dueDay: 30 },
    ],
    expenses: [
      { amount: 2617.02, dueDay: 5 },
      { amount: 326.72, dueDay: 16 },
      { amount: 2600, dueDay: 1 },
      { amount: 66.62, dueDay: 7 },
      { amount: 63.26, dueDay: 18 },
      { amount: 150, dueDay: 19 },
    ],
  })

  assert.deepEqual(summary, {
    throughDay15: { income: 2060, expenses: 5283.64, balance: -3223.64 },
    afterDay15: { income: 5559.88, expenses: 539.98, balance: 5019.9 },
  })
})

test('card due day prefers the statement date and falls back to the account setting', () => {
  assert.equal(resolveCardDueDay('2026-08-04', 18), 4)
  assert.equal(resolveCardDueDay(undefined, 18), 18)
  assert.equal(resolveCardDueDay(undefined, undefined), 31)
})

test('pay-period summary returns zero totals when the month has no planned items', () => {
  assert.deepEqual(buildPayPeriodSummary({ incomes: [], expenses: [] }), {
    throughDay15: { income: 0, expenses: 0, balance: 0 },
    afterDay15: { income: 0, expenses: 0, balance: 0 },
  })
})

test('received salary settles guaranteed income even when deposits do not match individual payroll dates', () => {
  assert.equal(calculateRemainingIncome(7619.88, 7624.38), 0)
  assert.equal(calculateRemainingIncome(7619.88, 2060), 5559.88)
})

test('cash projection does not count income already included in the current balance', () => {
  assert.equal(calculateProjectedBalance({
    currentBalance: 2515.67,
    remainingIncome: 0,
    remainingExpenses: 289.26,
    remainingSavings: 500,
  }), 1726.41)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('replaceSelectedMonth removes stale category data when the refreshed month is absent', () => {
  const current = {
    '2026-07': { Groceries: { amount: 20 } },
    '2026-08': { Dining: { amount: 45 } },
  }

  assert.deepEqual(replaceSelectedMonth(current, '2026-08', {}), {
    '2026-07': { Groceries: { amount: 20 } },
    '2026-08': {},
  })
})

test('loadRowsPreservingPrevious distinguishes an empty success from a failed request', async () => {
  const previous = [{ id: 7 }]
  const emptySuccess = await loadRowsPreservingPrevious(async () => [], previous)
  const failed = await loadRowsPreservingPrevious(
    async () => { throw new Error('offline') },
    previous,
  )

  assert.deepEqual(emptySuccess, { rows: [], error: null })
  assert.equal(failed.rows, previous)
  assert.equal(failed.error, 'Could not load transactions. Please try again.')
})

test('latest monthly request ignores an older response that resolves last', async () => {
  const runner = createLatestRequestRunner()
  const july = deferred<string>()
  const august = deferred<string>()
  const state: { data: string | null, error: string | null, loading: boolean } = {
    data: null,
    error: null,
    loading: false,
  }
  const handlers = {
    onStart: () => {
      state.loading = true
      state.error = null
    },
    onSuccess: (data: string) => { state.data = data },
    onError: (error: unknown) => {
      state.error = error instanceof Error ? error.message : 'unknown error'
    },
    onFinish: () => { state.loading = false },
  }

  const julyRun = runner.run(() => july.promise, handlers)
  const augustRun = runner.run(() => august.promise, handlers)

  august.resolve('2026-08 data')
  await augustRun
  assert.deepEqual(state, {
    data: '2026-08 data',
    error: null,
    loading: false,
  })

  july.resolve('2026-07 data')
  await julyRun
  assert.deepEqual(state, {
    data: '2026-08 data',
    error: null,
    loading: false,
  })
})

test('latest monthly request owns failure and stale finally cannot change its state', async () => {
  const runner = createLatestRequestRunner()
  const july = deferred<string>()
  const august = deferred<string>()
  const state: { data: string | null, error: string | null, loading: boolean } = {
    data: null,
    error: null,
    loading: false,
  }
  const handlers = {
    onStart: () => {
      state.loading = true
      state.error = null
    },
    onSuccess: (data: string) => { state.data = data },
    onError: (error: unknown) => {
      state.error = error instanceof Error ? error.message : 'unknown error'
    },
    onFinish: () => { state.loading = false },
  }

  const julyRun = runner.run(() => july.promise, handlers)
  const augustRun = runner.run(() => august.promise, handlers)

  august.reject(new Error('August failed'))
  await augustRun
  assert.deepEqual(state, {
    data: null,
    error: 'August failed',
    loading: false,
  })

  july.resolve('2026-07 data')
  await julyRun
  assert.deepEqual(state, {
    data: null,
    error: 'August failed',
    loading: false,
  })
})

test('monthly data cannot drive rendering or persistence under a different selected month', () => {
  assert.equal(hasCurrentMonthlyData('2026-08', '2026-07', false), false)
  assert.equal(hasCurrentMonthlyData('2026-08', '2026-08', true), false)
  assert.equal(hasCurrentMonthlyData('2026-08', '2026-08', false), true)
})

test('successful reference mutations invalidate the matching cached collection', async () => {
  clearCachedGets()
  let accountLoads = 0
  let categoryLoads = 0
  let recurringLoads = 0

  const loadAccounts = () => Promise.resolve(++accountLoads)
  const loadCategories = () => Promise.resolve(++categoryLoads)
  const loadRecurring = () => Promise.resolve(++recurringLoads)

  assert.equal(await cachedGet(REFERENCE_CACHE_KEYS.accounts, loadAccounts, 60_000), 1)
  assert.equal(await cachedGet(REFERENCE_CACHE_KEYS.categories, loadCategories, 60_000), 1)
  assert.equal(await cachedGet(REFERENCE_CACHE_KEYS.recurring, loadRecurring, 60_000), 1)

  invalidateReferenceDataForMutation('patch', '/accounts/42?include=balance')
  invalidateReferenceDataForMutation('DELETE', '/api/categories/7')
  invalidateReferenceDataForMutation('post', '/recurring-expenses/3/monthly-overrides')

  assert.equal(await cachedGet(REFERENCE_CACHE_KEYS.accounts, loadAccounts, 60_000), 2)
  assert.equal(await cachedGet(REFERENCE_CACHE_KEYS.categories, loadCategories, 60_000), 2)
  assert.equal(await cachedGet(REFERENCE_CACHE_KEYS.recurring, loadRecurring, 60_000), 2)
})

test('reads and unrelated mutations leave reference caches intact', async () => {
  clearCachedGets()
  let loads = 0
  const loader = () => Promise.resolve(++loads)

  assert.equal(await cachedGet(REFERENCE_CACHE_KEYS.accounts, loader, 60_000), 1)
  invalidateReferenceDataForMutation('get', '/accounts')
  invalidateReferenceDataForMutation('post', '/transactions')
  invalidateReferenceDataForMutation('post', '/category-budgets')

  assert.equal(await cachedGet(REFERENCE_CACHE_KEYS.accounts, loader, 60_000), 1)
})
