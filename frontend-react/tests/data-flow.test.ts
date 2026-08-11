import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cachedGet,
  clearCachedGets,
  invalidateReferenceDataForMutation,
  REFERENCE_CACHE_KEYS,
} from '../src/services/cache.ts'
import {
  loadRowsPreservingPrevious,
  replaceSelectedMonth,
} from '../src/services/reportingData.ts'

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
