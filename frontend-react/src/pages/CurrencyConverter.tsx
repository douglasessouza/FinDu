import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, RefreshCw } from 'lucide-react'
import { getExchangeRates } from '../services/api'
import type { ExchangeCurrency as Currency, ExchangeRatesResponse } from '../services/api'


const CURRENCIES: {
  code: Currency
  label: string
  symbol: string
  helper: string
}[] = [
  { code: 'CAD', label: 'Canadian Dollar', symbol: 'CAD$', helper: 'Dólar canadense' },
  { code: 'USD', label: 'US Dollar', symbol: 'US$', helper: 'Dólar americano' },
  { code: 'BRL', label: 'Brazilian Real', symbol: 'R$', helper: 'Real brasileiro' },
]

function fmt(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseAmount(value: string): number {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatUpdatedAt(timestamp?: string | null): string {
  if (!timestamp) return 'Not available yet'
  return new Date(timestamp).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function CurrencyConverter() {
  const [rates, setRates] = useState<Record<Currency, number> | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [nextUpdateAt, setNextUpdateAt] = useState<string | null>(null)
  const [frequency, setFrequency] = useState<'hourly' | 'daily'>('daily')
  const [usingStaleRates, setUsingStaleRates] = useState(false)
  const [baseCurrency, setBaseCurrency] = useState<Currency>('CAD')
  const [amountText, setAmountText] = useState('1')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadRates(forceRefresh = false) {
    setLoading(true)
    setError('')
    try {
      const response: ExchangeRatesResponse = await getExchangeRates('CAD', { forceRefresh })
      const usdRate = Number(response.rates.USD)
      const brlRate = Number(response.rates.BRL)
      if (!Number.isFinite(usdRate) || !Number.isFinite(brlRate) || usdRate <= 0 || brlRate <= 0) {
        throw new Error('Missing exchange rates')
      }
      setRates({
        CAD: Number(response.rates.CAD || 1),
        USD: usdRate,
        BRL: brlRate,
      })
      setUpdatedAt(response.rate_last_updated_at || null)
      setFetchedAt(response.fetched_at || null)
      setNextUpdateAt(response.rate_next_update_at || null)
      setFrequency(response.update_frequency || 'daily')
      setUsingStaleRates(response.browser_cache_status === 'stale' || response.cache_status === 'stale')
    } catch {
      setError('Could not load live exchange rates.')
    } finally {
      setLoading(false)
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadRates()
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const converted = useMemo(() => {
    if (!rates) return null
    const amount = parseAmount(amountText)
    const amountInCad = amount / rates[baseCurrency]
    return CURRENCIES.reduce<Record<Currency, number>>((lookup, currency) => {
      lookup[currency.code] = amountInCad * rates[currency.code]
      return lookup
    }, { CAD: 0, USD: 0, BRL: 0 })
  }, [amountText, baseCurrency, rates])

  function updateCurrencyInput(currency: Currency, value: string) {
    setBaseCurrency(currency)
    setAmountText(value)
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B4D3E] flex items-center gap-2">
            <ArrowLeftRight size={24} />
            Currency Converter
          </h1>
          <p className="text-sm text-[#7BAE8A] mt-1">
            Convert between CAD, USD, and BRL using the freshest available exchange rate.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadRates(true)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#D4E4D5] bg-white px-4 py-2.5 text-sm font-bold text-[#1B4D3E] transition hover:bg-[#F4FAF5] disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Updating...' : 'Update now'}
        </button>
      </div>

      <section className="rounded-xl border border-[#D4E4D5] bg-white p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Live conversion</p>
            <h2 className="mt-1 text-xl font-bold text-[#1B4D3E]">Type in any currency</h2>
          </div>
          <div className="grid gap-2 text-right">
            <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#8BAE90]">Last rate update</p>
              <p className="text-xs font-semibold text-[#1B4D3E]">
                {loading ? 'Loading latest rates...' : formatUpdatedAt(updatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 text-[11px] font-bold">
              <span
                className={`rounded-full border px-2.5 py-1 ${
                  frequency === 'hourly'
                    ? 'border-[#8DBE9B] bg-[#EDF8F0] text-[#1B6B3A]'
                    : 'border-[#E8C84A] bg-[#FFF9D8] text-[#8A6D00]'
                }`}
              >
                {frequency === 'hourly' ? 'Hourly provider' : 'Daily fallback'}
              </span>
              {fetchedAt && (
                <span className="rounded-full border border-[#D4E4D5] bg-white px-2.5 py-1 text-[#1B4D3E]">
                  Fetched {formatUpdatedAt(fetchedAt)}
                </span>
              )}
            </div>
          </div>
        </div>

        {frequency === 'daily' && !loading && (
          <div className="mb-4 rounded-lg border border-[#E8C84A] bg-[#FFF9D8] px-4 py-3 text-sm font-semibold text-[#7A6200]">
            Hourly refresh is ready in the app. Add the EXCHANGE_RATE_API_KEY secret to switch from daily fallback to hourly rates.
          </div>
        )}

        {usingStaleRates && !loading && (
          <div className="mb-4 rounded-lg border border-[#E8C84A] bg-[#FFF9D8] px-4 py-3 text-sm font-semibold text-[#7A6200]">
            Live refresh is unavailable. Showing the last validated exchange rates saved in this browser.
          </div>
        )}

        {frequency === 'hourly' && nextUpdateAt && (
          <div className="mb-4 rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] px-4 py-3 text-sm font-semibold text-[#1B4D3E]">
            Next provider refresh: {formatUpdatedAt(nextUpdateAt)}.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-[#E8A09A] bg-[#FFF1F0] px-4 py-3 text-sm font-semibold text-[#B85050]">
            {error}
          </div>
        )}

        <div className="grid gap-3">
          {CURRENCIES.map(currency => {
            const value = currency.code === baseCurrency
              ? amountText
              : converted
                ? fmt(converted[currency.code])
                : ''

            return (
              <label
                key={currency.code}
                className={`grid gap-3 rounded-lg border px-4 py-4 md:grid-cols-[minmax(0,1fr)_180px] md:items-center ${
                  currency.code === baseCurrency
                    ? 'border-[#1B4D3E] bg-[#EDF4EE]'
                    : 'border-[#D4E4D5] bg-[#F8FBF8]'
                }`}
              >
                <div>
                  <p className="text-lg font-bold text-[#1B4D3E]">{currency.label}</p>
                  <p className="text-xs font-semibold text-[#7BAE8A]">{currency.helper}</p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-[#D4E4D5] bg-white px-3 py-2">
                  <span className="w-12 text-xs font-bold text-[#8BAE90]">{currency.symbol}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={event => updateCurrencyInput(currency.code, event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-right text-lg font-bold text-[#1B4D3E] outline-none"
                  />
                </div>
              </label>
            )
          })}
        </div>

        {rates && (
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">1 CAD</p>
              <p className="mt-1 text-lg font-bold text-[#1B4D3E]">US$ {fmt(rates.USD)}</p>
              <p className="text-sm font-semibold text-[#1B6B3A]">R$ {fmt(rates.BRL)}</p>
            </div>
            <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">1 USD</p>
              <p className="mt-1 text-lg font-bold text-[#1B4D3E]">CAD$ {fmt(1 / rates.USD)}</p>
              <p className="text-sm font-semibold text-[#1B6B3A]">R$ {fmt(rates.BRL / rates.USD)}</p>
            </div>
            <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">1 BRL</p>
              <p className="mt-1 text-lg font-bold text-[#1B4D3E]">CAD$ {fmt(1 / rates.BRL)}</p>
              <p className="text-sm font-semibold text-[#1B6B3A]">US$ {fmt(rates.USD / rates.BRL)}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
