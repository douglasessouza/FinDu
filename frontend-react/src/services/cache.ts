interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const entries = new Map<string, CacheEntry<unknown>>()
const inFlight = new Map<string, Promise<unknown>>()
const keyGenerations = new Map<string, number>()
let cacheGeneration = 0

export const REFERENCE_CACHE_KEYS = {
  accounts: 'reference:accounts',
  categories: 'reference:categories',
  recurring: 'reference:recurring',
} as const

export type ReferenceDataKey = keyof typeof REFERENCE_CACHE_KEYS

const MUTATION_METHODS = new Set(['post', 'put', 'patch', 'delete'])

export async function cachedGet<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const cached = entries.get(key) as CacheEntry<T> | undefined
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const pending = inFlight.get(key) as Promise<T> | undefined
  if (pending) return pending

  const generation = cacheGeneration
  const keyGeneration = keyGenerations.get(key) || 0
  const request = loader()
    .then(value => {
      if (
        generation === cacheGeneration
        && keyGeneration === (keyGenerations.get(key) || 0)
      ) {
        entries.set(key, {
          value,
          expiresAt: Date.now() + Math.max(0, ttlMs),
        })
      }
      return value
    })
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key)
    })

  inFlight.set(key, request)
  return request
}

export function invalidateCachedGet(key: string): void {
  keyGenerations.set(key, (keyGenerations.get(key) || 0) + 1)
  entries.delete(key)
  inFlight.delete(key)
}

export function invalidateReferenceData(key: ReferenceDataKey): void {
  invalidateCachedGet(REFERENCE_CACHE_KEYS[key])
}

export function invalidateReferenceDataForMutation(method?: string, url?: string): void {
  if (!method || !url || !MUTATION_METHODS.has(method.toLowerCase())) return

  let path: string
  try {
    path = new URL(url, 'https://findu.local').pathname.replace(/^\/api(?=\/|$)/, '')
  } catch {
    return
  }

  if (/^\/accounts(?:\/|$)/.test(path)) invalidateReferenceData('accounts')
  if (/^\/categories(?:\/|$)/.test(path)) invalidateReferenceData('categories')
  if (/^\/recurring-expenses(?:\/|$)/.test(path)) invalidateReferenceData('recurring')
}

export function clearCachedGets(): void {
  cacheGeneration++
  entries.clear()
  inFlight.clear()
  keyGenerations.clear()
}
