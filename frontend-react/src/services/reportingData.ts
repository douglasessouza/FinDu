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
