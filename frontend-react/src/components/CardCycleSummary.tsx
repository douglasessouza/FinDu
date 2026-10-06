import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, CreditCard } from 'lucide-react'
import type { Account } from '../services/api'

function addMonths(month: string, delta: number): string {
  const [year, mo] = month.split('-').map(Number)
  const date = new Date(year, mo - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function cycleDate(month: string, day: number): Date {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1, Math.min(day, new Date(year, monthNumber, 0).getDate()))
}

function monthLabel(month: string): string {
  const [year, mo] = month.split('-').map(Number)
  return new Date(year, mo - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export default function CardCycleSummary({ accounts, month }: { accounts: Account[]; month: string }) {
  const [showAllCycles, setShowAllCycles] = useState(false)

  const cards = useMemo(() => {
    return accounts
      .filter(account => account.account_type === 'CREDIT_CARD' && account.closing_day && account.due_day)
      .sort((a, b) => (a.closing_day || 0) - (b.closing_day || 0))
  }, [accounts])

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const cycleStatus = month < currentMonth
    ? 'Closed'
    : month > currentMonth
      ? 'Upcoming'
      : cards.some(card => cycleDate(month, card.closing_day || 1) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        ? 'Open'
        : 'Closed'
  const nextClosing = month === currentMonth
    ? cards
      .map(card => ({ card, date: cycleDate(month, card.closing_day || 1) }))
      .filter(item => item.date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0]
    : undefined

  if (!month || cards.length === 0) return null

  return (
    <div className="bg-[#1B4D3E] text-white rounded-xl p-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
            <CreditCard size={18} />
          </span>
          <div>
            <p className="text-sm font-bold">{monthLabel(month)} spending cycle - {cycleStatus}</p>
            <p className="text-xs text-white/75 mt-1">
              {nextClosing
                ? `Next closing: ${nextClosing.card.name}, ${shortDate(nextClosing.date)} - paid ${shortDate(cycleDate(addMonths(month, 1), nextClosing.card.due_day || 1))}`
                : 'Closing dates define the spending cycle. Due dates define when the bill enters Monthly Cash Flow.'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAllCycles(value => !value)}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold transition"
        >
          {showAllCycles ? 'Hide card cycles' : 'View all card cycles'}
          {showAllCycles ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {showAllCycles && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 mt-4 pt-4 border-t border-white/15">
          {cards.map(card => {
            const closing = cycleDate(month, card.closing_day || 1)
            const payment = cycleDate(addMonths(month, 1), card.due_day || 1)
            return (
              <div key={card.id} className="rounded-lg bg-white/10 px-3 py-2">
                <p className="text-sm font-bold truncate">{card.name}</p>
                <p className="text-xs text-white/75 mt-1">Closes {shortDate(closing)}</p>
                <p className="text-xs text-[#E8C84A]">Paid {shortDate(payment)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
