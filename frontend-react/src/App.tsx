import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { TrendingUp, Receipt, Upload, Building2, CreditCard, RefreshCw, Tag, Banknote, Target, CircleHelp } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import axios from 'axios'

const navReports = [
  { to: '/', icon: Banknote, label: 'Monthly Cash Flow' },
  { to: '/planned-vs-real', icon: Target, label: 'Budget & Card Cycles' },
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

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-[#EDF4EE] text-[#2C3E2D]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <Routes>
            <Route path="/" element={<MonthlyCashFlow />} />
            <Route path="/planned-vs-real" element={<PlannedVsReal />} />
            <Route path="/spending" element={<SpendingAnalysis />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/import" element={<ImportStatement />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/cards" element={<CreditCards />} />
            <Route path="/recurring" element={<RecurringExpenses />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
