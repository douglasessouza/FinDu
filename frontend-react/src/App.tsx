import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { TrendingUp, Receipt, Upload, Building2, CreditCard, RefreshCw, Tag, Banknote, Target, CircleHelp, MessageCircle, PiggyBank, ArrowLeftRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import MonthlyCashFlow from './pages/MonthlyCashFlow'
import PlannedVsReal from './pages/PlannedVsReal'
import SpendingAnalysis from './pages/SpendingAnalysis'
import Transactions from './pages/Transactions'
import ImportStatement from './pages/ImportStatement'
import Accounts from './pages/Accounts'
import CreditCards from './pages/CreditCards'
import RecurringExpenses from './pages/RecurringExpenses'
import Categories from './pages/Categories'
import HowItWorks from './pages/HowItWorks'
import FinancialChat from './pages/FinancialChat'
import InvestmentPlanning from './pages/InvestmentPlanning'
import CurrencyConverter from './pages/CurrencyConverter'
import api, { clearAuthToken, getAuthToken, setAuthToken } from './services/api'
import axios from 'axios'

type AuthStatus = {
  requires_auth: boolean
  providers?: {
    password?: boolean
    google?: boolean
  }
  google_client_id?: string | null
}

type GoogleCredentialResponse = {
  credential?: string
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string
            callback: (response: GoogleCredentialResponse) => void
          }) => void
          renderButton: (
            element: HTMLElement,
            options: {
              theme: string
              size: string
              width: number
              text: string
            },
          ) => void
        }
      }
    }
  }
}

const navReports = [
  { to: '/', icon: Banknote, label: 'Monthly Cash Flow' },
  { to: '/planned-vs-real', icon: Target, label: 'Budget & Card Cycles' },
  { to: '/investments', icon: PiggyBank, label: 'Investments' },
  { to: '/spending', icon: TrendingUp, label: 'Spending Analysis' },
  { to: '/transactions', icon: Receipt, label: 'Transactions' },
]

const navManage = [
  { to: '/import', icon: Upload, label: 'Import Statement' },
  { to: '/recurring', icon: RefreshCw, label: 'Recurring Expenses & Income' },
  { to: '/cards', icon: CreditCard, label: 'Credit Cards' },
  { to: '/accounts', icon: Building2, label: 'Accounts' },
  { to: '/categories', icon: Tag, label: 'Categories' },
]

function Sidebar() {
  const [fx, setFx] = useState<{ usd_cad: number; cad_brl: number } | null>(null)

  useEffect(() => {
    async function loadFx() {
      try {
        const [r1, r2] = await Promise.all([
          axios.get('https://api.exchangerate-api.com/v4/latest/USD'),
          axios.get('https://api.exchangerate-api.com/v4/latest/CAD'),
        ])
        setFx({
          usd_cad: r1.data.rates.CAD,
          cad_brl: r2.data.rates.BRL,
        })
      } catch {
        setFx(null)
      }
    }
    loadFx()
  }, [])

  return (
    <aside className="w-60 bg-white border-r border-[#D4E4D5] flex flex-col py-5 px-3 shrink-0">
      {/* Logo */}
      <div className="bg-[#1B4D3E] rounded-xl px-4 py-3 mb-3">
        <p className="text-[#E8C84A] font-bold text-base">💰 FinDu</p>
        <p className="text-[#7BAE8A] text-xs mt-0.5">Personal finance control</p>
      </div>

      {/* FX pill */}
      {fx && (
        <div className="border border-[#C9A84C] rounded-full px-3 py-1.5 mb-4 text-center">
          <p className="text-[#1B4D3E] text-xs font-semibold leading-tight">
            1 USD = CAD$ {fx.usd_cad.toFixed(4)}
          </p>
          <p className="text-[#1B4D3E] text-xs font-semibold leading-tight">
            1 CAD = R$ {fx.cad_brl.toFixed(4)}
          </p>
        </div>
      )}

      {/* Reports */}
      <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest px-2 mb-1">Reports</p>
      {navReports.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
              isActive
                ? 'bg-[#EDF4EE] text-[#1B4D3E] font-semibold border-l-[3px] border-[#E8C84A]'
                : 'text-[#8BAE90] hover:bg-[#F4FAF5] hover:text-[#1B4D3E]'
            }`
          }
        >
          <Icon size={15} />
          {label}
        </NavLink>
      ))}

      {/* Manage */}
      <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest px-2 mt-4 mb-1">Manage</p>
      {navManage.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
              isActive
                ? 'bg-[#EDF4EE] text-[#1B4D3E] font-semibold border-l-[3px] border-[#E8C84A]'
                : 'text-[#8BAE90] hover:bg-[#F4FAF5] hover:text-[#1B4D3E]'
            }`
          }
        >
          <Icon size={15} />
          {label}
        </NavLink>
      ))}

      <p className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest px-2 mt-4 mb-1">Help</p>
      <NavLink
        to="/chat"
        className={({ isActive }) =>
          `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
            isActive
              ? 'bg-[#EDF4EE] text-[#1B4D3E] font-semibold border-l-[3px] border-[#E8C84A]'
              : 'text-[#8BAE90] hover:bg-[#F4FAF5] hover:text-[#1B4D3E]'
          }`
        }
      >
        <MessageCircle size={15} />
        Financial Chat
      </NavLink>
      <NavLink
        to="/currency-converter"
        className={({ isActive }) =>
          `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
            isActive
              ? 'bg-[#EDF4EE] text-[#1B4D3E] font-semibold border-l-[3px] border-[#E8C84A]'
              : 'text-[#8BAE90] hover:bg-[#F4FAF5] hover:text-[#1B4D3E]'
          }`
        }
      >
        <ArrowLeftRight size={15} />
        Currency Converter
      </NavLink>
      <NavLink
        to="/how-it-works"
        className={({ isActive }) =>
          `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
            isActive
              ? 'bg-[#EDF4EE] text-[#1B4D3E] font-semibold border-l-[3px] border-[#E8C84A]'
              : 'text-[#8BAE90] hover:bg-[#F4FAF5] hover:text-[#1B4D3E]'
          }`
        }
      >
        <CircleHelp size={15} />
        How FinDu Works
      </NavLink>
    </aside>
  )
}

function LoginScreen({ authStatus, onAuthenticated }: { authStatus: AuthStatus | null; onAuthenticated: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)

  const passwordEnabled = Boolean(authStatus?.providers?.password)
  const googleClientId = authStatus?.providers?.google && authStatus.google_client_id ? authStatus.google_client_id : null

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return

    let cancelled = false
    const clientId = googleClientId

    async function signInWithGoogle(response: GoogleCredentialResponse) {
      if (!response.credential) {
        setError('Google sign-in failed.')
        return
      }
      setError('')
      setLoading(true)
      try {
        const res = await api.post('/auth/google', { credential: response.credential })
        setAuthToken(res.data.token)
        onAuthenticated()
      } catch {
        clearAuthToken()
        setError('This Google account is not allowed.')
      } finally {
        setLoading(false)
      }
    }

    function renderGoogleButton() {
      if (cancelled || !window.google || !googleButtonRef.current) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: signInWithGoogle,
      })
      googleButtonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 304,
        text: 'signin_with',
      })
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    if (existingScript) {
      if (window.google) renderGoogleButton()
      else existingScript.addEventListener('load', renderGoogleButton, { once: true })
    } else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = renderGoogleButton
      document.head.appendChild(script)
    }

    return () => {
      cancelled = true
    }
  }, [googleClientId, onAuthenticated])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/auth/login', { password })
      setAuthToken(res.data.token)
      onAuthenticated()
    } catch {
      clearAuthToken()
      setError('Invalid password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#EDF4EE] flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-white border border-[#D4E4D5] rounded-xl p-6 shadow-sm">
        <div className="bg-[#1B4D3E] rounded-xl px-4 py-3 mb-5">
          <p className="text-[#E8C84A] font-bold text-lg">FinDu</p>
          <p className="text-[#7BAE8A] text-xs mt-0.5">Personal finance control</p>
        </div>

        {googleClientId && (
          <div className="mb-4">
            <div ref={googleButtonRef} className="min-h-10 flex justify-center" />
          </div>
        )}

        {googleClientId && passwordEnabled && (
          <div className="flex items-center gap-3 my-4">
            <div className="h-px bg-[#D4E4D5] flex-1" />
            <span className="text-[10px] font-semibold text-[#8BAE90] uppercase tracking-widest">or</span>
            <div className="h-px bg-[#D4E4D5] flex-1" />
          </div>
        )}

        {passwordEnabled && (
          <form onSubmit={submit}>
            <label className="text-xs font-semibold text-[#8BAE90] uppercase tracking-widest block mb-2">
              Password
            </label>
            <input
              autoFocus={!googleClientId}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none focus:border-[#1B4D3E]"
            />
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full mt-5 px-4 py-2.5 bg-[#1B4D3E] text-white text-sm font-semibold rounded-lg hover:bg-[#2D6A4F] transition disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}

        {!googleClientId && !passwordEnabled && (
          <p className="text-sm text-[#B85050]">Authentication is not configured.</p>
        )}

        {error && <p className="text-sm text-[#B85050] mt-3">{error}</p>}
      </div>
    </div>
  )
}

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)

  useEffect(() => {
    async function checkAuth() {
      try {
        const status = await api.get<AuthStatus>('/auth/status')
        setAuthStatus(status.data)
        if (!status.data.requires_auth) {
          setAuthenticated(true)
          return
        }

        const token = getAuthToken()
        if (!token) {
          setAuthenticated(false)
          return
        }

        setAuthToken(token)
        await api.get('/auth/me')
        setAuthenticated(true)
      } catch {
        clearAuthToken()
        setAuthenticated(false)
      } finally {
        setAuthReady(true)
      }
    }
    checkAuth()
  }, [])

  if (!authReady) {
    return <div className="min-h-screen bg-[#EDF4EE]" />
  }

  if (!authenticated) {
    return <LoginScreen authStatus={authStatus} onAuthenticated={() => setAuthenticated(true)} />
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen bg-[#EDF4EE] text-[#2C3E2D]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <Routes>
            <Route path="/" element={<MonthlyCashFlow />} />
            <Route path="/planned-vs-real" element={<PlannedVsReal />} />
            <Route path="/investments" element={<InvestmentPlanning />} />
            <Route path="/spending" element={<SpendingAnalysis />} />
            <Route path="/chat" element={<FinancialChat />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/import" element={<ImportStatement />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/cards" element={<CreditCards />} />
            <Route path="/recurring" element={<RecurringExpenses />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/currency-converter" element={<CurrencyConverter />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
