export interface RecurrenceSchedule {
  id: number
  frequency?: string
  anchor_date?: string | null
  start_month?: string | null
  valid_until?: string | null
  recurring_source_id?: number
  occurrence_date?: string
}
const DAY = 86_400_000

export function recurrenceDates(item: RecurrenceSchedule, month: string): string[] {
  if (item.frequency !== 'BIWEEKLY' || !item.anchor_date) return []
  const anchor = Date.parse(`${item.anchor_date.slice(0, 10)}T00:00:00Z`)
  const start = Date.parse(`${month}-01T00:00:00Z`)
  if (!Number.isFinite(anchor) || !Number.isFinite(start)) return []
  const [year, number] = month.split('-').map(Number)
  const end = Date.UTC(year, number, 1)
  const first = Math.max(start, item.start_month ? Date.parse(`${item.start_month}-01T00:00:00Z`) : start, anchor)
  const last = item.valid_until ? Math.min(end - DAY, Date.parse(`${item.valid_until.slice(0, 10)}T00:00:00Z`)) : end - DAY
  const dates: string[] = []
  for (let date = anchor + Math.max(0, Math.ceil((first - anchor) / (14 * DAY))) * 14 * DAY; date <= last; date += 14 * DAY) {
    dates.push(new Date(date).toISOString().slice(0, 10))
  }
  return dates
}

/** Negative identities are local dated occurrences. MonthlyPayment's month +
 * item_id key keeps each installment independent; edits use the real source ID.
 * Never persist these identities into recurring_matches (a recurrence FK). */
export function expandRecurringForMonth<T extends RecurrenceSchedule>(items: T[], month: string): T[] {
  return items.flatMap(item => {
    if (item.frequency !== 'BIWEEKLY' || item.occurrence_date) return [item]
    return recurrenceDates(item, month).map(date => ({ ...item,
      id: -(item.id * 100 + Number(date.slice(8, 10))),
      recurring_source_id: item.id, occurrence_date: date, due_day: Number(date.slice(8, 10)),
    }))
  })
}
export const recurringSourceId = (item: RecurrenceSchedule) => item.recurring_source_id ?? item.id

/** Carry an existing saved match forward when a monthly row becomes a schedule. */
export function recurringMatchItem<T extends RecurrenceSchedule>(items: T[], sourceId: number, transactionDate: string): T | undefined {
  const direct = items.find(item => item.id === sourceId)
  if (direct) return direct
  const timestamp = Date.parse(`${transactionDate.slice(0, 10)}T00:00:00Z`)
  return items.filter(item => item.recurring_source_id === sourceId && item.occurrence_date
    && item.occurrence_date.slice(0, 7) === transactionDate.slice(0, 7))
    .map(item => ({ item, distance: Math.abs(Date.parse(`${item.occurrence_date}T00:00:00Z`) - timestamp) }))
    .filter(candidate => candidate.distance <= 7 * DAY)
    .sort((a, b) => a.distance - b.distance)[0]?.item
}
