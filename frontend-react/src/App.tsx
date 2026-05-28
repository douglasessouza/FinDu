import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { LayoutDashboard, TrendingUp, Receipt, Upload, Building2, CreditCard, RefreshCw, Tag } from 'lucide-react'
import MonthlyCashFlow from './pages/MonthlyCashFlow'
import SpendingAnalysis from './pages/SpendingAnalysis'
import Transactions from './pages/Transactions'
import ImportStatement from './pages/ImportStatement'
import Accounts from './pages/Accounts'
import CreditCards from './pages/CreditCards'
import RecurringExpenses from './pages/RecurringExpenses'
import Categories from './pages/Categories'

const navReports = [
  { to: '/', icon: LayoutDashboard, label: 'Monthly Cash Flow' },
  { to: '/spending', icon: TrendingUp, label: 'Spending Analysis' },
  { to: '/transactions', icon: Receipt, label: 'Transactions' },
]

const navManage = [
  { to: '/import', icon: Upload, label: 'Import Statement' },
  { to: '/accounts', icon: Building2, label: 'Accounts' },
  { to: '/cards', icon: CreditCard, label: 'Credit Cards' },
  { to: '/recurring', icon: RefreshCw, label: 'Recurring Expenses & Income' },
  { to: '/categories', icon: Tag, label: 'Categories' },
]

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-50 text-gray-900">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col py-6 px-4 gap-1 shrink-0">
          <div className="mb-6 px-2">
            <h1 className="text-xl font-bold">💰 FinDu</h1>
            <p className="text-xs text-gray-400">Personal finance control</p>
          </div>

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-1">Reports</p>
          {navReports.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-600 font-semibold'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mt-4 mb-1">Manage</p>
          {navManage.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-600 font-semibold'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8">
          <Routes>
            <Route path="/" element={<MonthlyCashFlow />} />
            <Route path="/spending" element={<SpendingAnalysis />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/import" element={<ImportStatement />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/cards" element={<CreditCards />} />
            <Route path="/recurring" element={<RecurringExpenses />} />
            <Route path="/categories" element={<Categories />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}