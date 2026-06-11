import {
  ArrowRight,
  Banknote,
  CalendarCheck,
  Check,
  CreditCard,
  HelpCircle,
  ReceiptText,
  Target,
  WalletCards,
} from 'lucide-react'

const steps = [
  {
    number: '01',
    icon: Banknote,
    title: 'Money arrives',
    text: 'Income received at the end of one month can fund the next monthly cash flow.',
    example: "Vida's CAD$ 2,060 payroll arrives May 30 and funds June.",
    tone: 'bg-[#F4FAF5] border-[#D4E4D5]',
  },
  {
    number: '02',
    icon: Check,
    title: 'FinDu recognizes it',
    text: 'When a bank statement is imported, FinDu matches deposits with recurring payroll.',
    example: 'The payroll is marked Received and is not added to the bank balance again.',
    tone: 'bg-[#EDF4EE] border-[#BFD6C2]',
  },
  {
    number: '03',
    icon: CreditCard,
    title: 'You make a card purchase',
    text: 'The card closing date decides which spending cycle receives the purchase.',
    example: 'Amex closes Jun 18: a Jun 10 purchase belongs to June; a Jun 20 purchase belongs to July.',
    tone: 'bg-[#F3F7FD] border-[#CFE0F5]',
  },
  {
    number: '04',
    icon: CalendarCheck,
    title: 'The statement closes',
    text: 'Planned vs Real and Spending Analysis use the statement cycle for card purchases.',
    example: 'Food bought on Jun 10 uses the June Food budget, even though the bill is paid later.',
    tone: 'bg-[#FFF9E8] border-[#EADCA7]',
  },
  {
    number: '05',
    icon: ReceiptText,
    title: 'The bill enters Cash Flow',
    text: 'The payment due date decides when money will leave the bank account.',
    example: 'The Amex June statement is due Jul 5, so it appears in July Monthly Cash Flow.',
    tone: 'bg-[#FDF5F5] border-[#F0CCCC]',
  },
  {
    number: '06',
    icon: WalletCards,
    title: 'FinDu projects what remains',
    text: 'Only future movements are applied to the current bank balance.',
    example: 'Current balance + expected income - remaining payments = projected end-of-month balance.',
    tone: 'bg-[#1B4D3E] border-[#1B4D3E] text-white',
  },
]

const rules = [
  'Budget is a spending limit, never an extra expense.',
  'Card closing date defines the spending cycle.',
  'Card due date defines the Monthly Cash Flow month.',
  'Received income is already included in the current bank balance.',
  'Paid expenses are already deducted from the current bank balance.',
  'Every amount affects the projection only once.',
]

export default function HowItWorks() {
  return (
    <div className="w-full max-w-7xl mx-auto px-6">
      <div className="rounded-2xl bg-[#1B4D3E] text-white px-6 py-7 mb-6 overflow-hidden relative">
        <div className="absolute w-48 h-48 rounded-full bg-[#E8C84A]/10 -right-12 -top-20" />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2 text-[#E8C84A] text-xs font-bold uppercase tracking-widest mb-3">
            <HelpCircle size={16} />
            How FinDu Works
          </div>
          <h1 className="text-3xl font-bold">One purchase, two timelines.</h1>
          <p className="text-white/75 mt-2 leading-relaxed">
            FinDu separates when you spend from when money leaves your bank account.
            This guide shows how income, card cycles, budgets, and cash flow fit together.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-7">
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-bold text-[#8BAE90] uppercase tracking-widest">Monthly Cash Flow</p>
          <p className="font-bold text-[#1B4D3E] mt-2">When will money move?</p>
          <p className="text-xs text-[#7BAE8A] mt-1">Uses income status and payment due dates.</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-bold text-[#8BAE90] uppercase tracking-widest">Budget & Cycles</p>
          <p className="font-bold text-[#1B4D3E] mt-2">How much can I still spend?</p>
          <p className="text-xs text-[#7BAE8A] mt-1">Uses card closing cycles and category limits.</p>
        </div>
        <div className="bg-white border border-[#D4E4D5] rounded-xl p-4">
          <p className="text-xs font-bold text-[#8BAE90] uppercase tracking-widest">Spending Analysis</p>
          <p className="font-bold text-[#1B4D3E] mt-2">Where did the money go?</p>
          <p className="text-xs text-[#7BAE8A] mt-1">Explains categories and historical trends.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <ArrowRight size={18} className="text-[#C9A84C]" />
        <h2 className="text-xl font-bold text-[#1B4D3E]">Follow the story</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {steps.map(({ number, icon: Icon, title, text, example, tone }) => (
          <section key={number} className={`rounded-xl border p-5 ${tone}`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                number === '06' ? 'bg-white/10 text-[#E8C84A]' : 'bg-white text-[#1B4D3E]'
              }`}>
                <Icon size={19} />
              </div>
              <div>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${
                  number === '06' ? 'text-white/60' : 'text-[#8BAE90]'
                }`}>Step {number}</p>
                <h3 className={`font-bold mt-1 ${number === '06' ? 'text-white' : 'text-[#1B4D3E]'}`}>{title}</h3>
                <p className={`text-sm mt-2 leading-relaxed ${number === '06' ? 'text-white/75' : 'text-[#55705E]'}`}>{text}</p>
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                  number === '06' ? 'bg-white/10 text-white' : 'bg-white/70 text-[#1B4D3E]'
                }`}>
                  <span className="font-bold">Example: </span>{example}
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className="bg-white border border-[#D4E4D5] rounded-xl p-5 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Target size={18} className="text-[#1B4D3E]" />
          <h2 className="font-bold text-[#1B4D3E]">Quick rules</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rules.map(rule => (
            <div key={rule} className="flex items-start gap-2 rounded-lg bg-[#F7FBF8] px-3 py-2.5">
              <span className="w-5 h-5 rounded-full bg-[#1B6B3A] text-white flex items-center justify-center shrink-0 mt-0.5">
                <Check size={12} />
              </span>
              <p className="text-sm text-[#2C3E2D]">{rule}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#CFE0F5] bg-[#F3F7FD] p-5">
        <p className="text-xs font-bold text-[#3F6EA8] uppercase tracking-widest">Amex example</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-center mt-3">
          <div>
            <p className="font-bold text-[#1B4D3E]">Purchase Jun 10</p>
            <p className="text-xs text-[#55705E] mt-1">Food spending</p>
          </div>
          <ArrowRight className="text-[#8BAE90] hidden md:block" size={18} />
          <div>
            <p className="font-bold text-[#1B4D3E]">June cycle</p>
            <p className="text-xs text-[#55705E] mt-1">Closes Jun 18</p>
          </div>
          <ArrowRight className="text-[#8BAE90] hidden md:block" size={18} />
          <div>
            <p className="font-bold text-[#1B4D3E]">July Cash Flow</p>
            <p className="text-xs text-[#55705E] mt-1">Paid Jul 5</p>
          </div>
        </div>
      </section>
    </div>
  )
}
