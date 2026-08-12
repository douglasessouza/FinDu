export function replaceSelectedMonth<T>(
  current: Record<string, Record<string, T>>,
  selectedMonth: string,
  next: Record<string, Record<string, T>>,
): Record<string, Record<string, T>> {
  return {
    ...current,
    [selectedMonth]: next[selectedMonth] ?? {},
  }
}

export interface RowsLoadResult<T> {
  rows: T[]
  error: string | null
}

export interface LatestRequestHandlers<T> {
  onStart?: () => void
  onSuccess: (value: T) => void
  onError?: (error: unknown) => void
  onFinish?: () => void
}

export interface LatestRequestRunner {
  run<T>(
    loader: () => Promise<T>,
    handlers: LatestRequestHandlers<T>,
  ): Promise<void>
  invalidate(): void
}

export function createLatestRequestRunner(): LatestRequestRunner {
  let generation = 0

  return {
    async run<T>(
      loader: () => Promise<T>,
      handlers: LatestRequestHandlers<T>,
    ): Promise<void> {
      const requestGeneration = ++generation
      handlers.onStart?.()

      try {
        const value = await loader()
        if (requestGeneration === generation) handlers.onSuccess(value)
      } catch (error) {
        if (requestGeneration === generation) handlers.onError?.(error)
      } finally {
        if (requestGeneration === generation) handlers.onFinish?.()
      }
    },
    invalidate(): void {
      generation += 1
    },
  }
}

export function hasCurrentMonthlyData(
  selectedMonth: string,
  loadedMonth: string | null,
  loading: boolean,
): boolean {
  return !loading && loadedMonth === selectedMonth
}

export async function loadRowsPreservingPrevious<T>(
  loader: () => Promise<T[]>,
  previousRows: T[],
): Promise<RowsLoadResult<T>> {
  try {
    return { rows: await loader(), error: null }
  } catch {
    return {
      rows: previousRows,
      error: 'Could not load transactions. Please try again.',
    }
  }
}
