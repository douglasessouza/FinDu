import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  ListChecks,
  MessageCircle,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  User,
  WalletCards,
} from 'lucide-react'
import api from '../services/api'

type ChatRole = 'user' | 'assistant'

type ChatMessage = {
  role: ChatRole
  content: string
}

type ChatResponse = {
  answer: string
  alerts: string[]
  snapshot_month: string
}

const quickPrompts = [
  'What are my biggest financial risks right now?',
  'Where can I reduce spending this month?',
  'How is my cash flow looking?',
  'Are there any unusual transactions or patterns?',
]

function monthLabel(month: string): string {
  if (!month) return ''
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

function cleanInsightText(text: string): string {
  return text
    .replace(/^#+\s*/, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/[_`]/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSections(text: string) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const sections: { title: string; items: string[] }[] = []
  let current: { title: string; items: string[] } | null = null

  lines.forEach(line => {
    const isHeading = line.startsWith('#') || /^[-*]*\s*\*\*[^*]+:\*\*/.test(line)
    if (isHeading) {
      const title = cleanInsightText(line).replace(/:$/, '')
      if (title) {
        current = { title, items: [] }
        sections.push(current)
      }
      return
    }

    const cleaned = cleanInsightText(line)
    if (!cleaned) return
    if (!current) {
      current = { title: 'Financial readout', items: [] }
      sections.push(current)
    }
    current.items.push(cleaned)
  })

  return sections
}

function parseAlertPercent(alert: string): number | null {
  const match = alert.match(/(\d+(?:\.\d+)?)%/)
  return match ? Number(match[1]) : null
}

function AlertCard({ alert }: { alert: string }) {
  const percent = parseAlertPercent(alert)
  const severity = percent === null ? 'watch' : percent >= 150 ? 'critical' : percent >= 100 ? 'over' : 'near'
  const barWidth = percent === null ? 42 : Math.min(percent, 180) / 1.8
  const styles = {
    critical: {
      label: 'Critical',
      bg: 'bg-[#FFF1F0]',
      border: 'border-[#E8A09A]',
      text: 'text-[#8C2F2A]',
      bar: 'bg-[#B85050]',
    },
    over: {
      label: 'Over budget',
      bg: 'bg-[#FFF8E6]',
      border: 'border-[#E8C84A]',
      text: 'text-[#6B4E00]',
      bar: 'bg-[#D9A700]',
    },
    near: {
      label: 'Near limit',
      bg: 'bg-[#F7FAEF]',
      border: 'border-[#C8D88A]',
      text: 'text-[#52601E]',
      bar: 'bg-[#9BA83F]',
    },
    watch: {
      label: 'Watch',
      bg: 'bg-[#EDF4EE]',
      border: 'border-[#BFD6C3]',
      text: 'text-[#1B4D3E]',
      bar: 'bg-[#7BAE8A]',
    },
  }[severity]

  return (
    <div className={`${styles.bg} ${styles.border} border rounded-lg p-3`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-sm font-semibold ${styles.text}`}>{alert}</p>
        <span className={`text-[10px] uppercase tracking-widest font-bold ${styles.text} shrink-0`}>{styles.label}</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-white/80 overflow-hidden border border-white">
        <div className={`${styles.bar} h-full rounded-full`} style={{ width: `${barWidth}%` }} />
      </div>
    </div>
  )
}

function InsightBoard({
  report,
  alerts,
  loading,
  snapshotMonth,
  onGenerate,
  onAsk,
}: {
  report: string
  alerts: string[]
  loading: boolean
  snapshotMonth: string
  onGenerate: () => void
  onAsk: (prompt: string) => void
}) {
  const [reviewed, setReviewed] = useState<string[]>([])
  const sections = parseSections(report)
  const actionSection = sections.find(section => /action|recommend|next/i.test(section.title))
  const riskSection = sections.find(section => /risk|alert|watch|attention/i.test(section.title))
  const goodSection = sections.find(section => /fine|good|healthy|looking/i.test(section.title))
  const actions = actionSection?.items.slice(0, 4) || sections.flatMap(section => section.items).slice(0, 3)
  const supportingSections = sections.filter(section => section !== actionSection && section.items.length > 0)

  function toggleReviewed(item: string) {
    setReviewed(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item])
  }

  if (!report && loading) {
    return (
      <div className="bg-white border border-[#D4E4D5] rounded-lg p-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-[#1B4D3E] text-[#E8C84A] flex items-center justify-center">
            <Sparkles size={19} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1B4D3E]">Building your insight board</h2>
            <p className="text-sm text-[#7BAE8A]">Scanning budgets, cards, cash flow, recurring bills, and recent transactions.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[1, 2, 3].map(item => (
            <div key={item} className="h-28 rounded-lg bg-[#EDF4EE] border border-[#D4E4D5] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="bg-white border border-[#D4E4D5] rounded-lg p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[#1B4D3E] text-[#E8C84A] flex items-center justify-center">
            <Sparkles size={19} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1B4D3E]">Insights and alerts</h2>
            <p className="text-sm text-[#7BAE8A]">
              Generate a visual readout with risks, next actions, and questions you can ask right away.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3 mb-4">
          <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] p-4">
            <ShieldAlert className="text-[#B85050] mb-3" size={20} />
            <p className="text-sm font-bold text-[#1B4D3E]">Budget pressure</p>
            <p className="text-xs text-[#7BAE8A] mt-1">Find categories close to or above the limit.</p>
          </div>
          <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] p-4">
            <Target className="text-[#C9A84C] mb-3" size={20} />
            <p className="text-sm font-bold text-[#1B4D3E]">Next actions</p>
            <p className="text-xs text-[#7BAE8A] mt-1">Turn the analysis into small things to do.</p>
          </div>
          <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] p-4">
            <WalletCards className="text-[#2D6A4F] mb-3" size={20} />
            <p className="text-sm font-bold text-[#1B4D3E]">Cash position</p>
            <p className="text-xs text-[#7BAE8A] mt-1">Check cards, account buffer, and recurring bills.</p>
          </div>
        </div>
        <button
          onClick={onGenerate}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#E8C84A] text-[#1B4D3E] text-sm font-bold rounded-lg hover:bg-[#F0D56A] transition disabled:opacity-50"
        >
          <Sparkles size={16} />
          Generate insights
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#D4E4D5] rounded-lg p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Insight board</p>
            <h2 className="text-xl font-bold text-[#1B4D3E] mt-1">Your financial pulse</h2>
            <p className="text-sm text-[#7BAE8A] mt-1">
              {snapshotMonth ? monthLabel(snapshotMonth) : 'Latest available snapshot'} - {alerts.length} active alerts - {actions.length} recommended actions
            </p>
          </div>
          <button
            onClick={onGenerate}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#E8C84A] text-[#1B4D3E] text-sm font-bold rounded-lg hover:bg-[#F0D56A] transition disabled:opacity-50"
          >
            <Sparkles size={16} />
            Refresh scan
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3 mt-5">
          <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] p-4">
            <ShieldAlert className={alerts.length ? 'text-[#B85050]' : 'text-[#7BAE8A]'} size={20} />
            <p className="text-2xl font-bold text-[#1B4D3E] mt-3">{alerts.length}</p>
            <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90] mt-1">Alerts</p>
          </div>
          <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] p-4">
            <ListChecks className="text-[#C9A84C]" size={20} />
            <p className="text-2xl font-bold text-[#1B4D3E] mt-3">{reviewed.length}/{actions.length}</p>
            <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90] mt-1">Reviewed actions</p>
          </div>
          <div className="rounded-lg border border-[#D4E4D5] bg-[#F8FBF8] p-4">
            <CheckCircle2 className="text-[#2D6A4F]" size={20} />
            <p className="text-2xl font-bold text-[#1B4D3E] mt-3">{goodSection?.items.length || 0}</p>
            <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90] mt-1">Healthy signals</p>
          </div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="bg-white border border-[#D4E4D5] rounded-lg p-5">
          <div className="flex items-center gap-2 text-[#B85050] font-bold text-sm mb-3">
            <AlertTriangle size={17} />
            Active alerts
          </div>
          <div className="grid gap-3">
            {alerts.map(alert => (
              <AlertCard key={alert} alert={alert} />
            ))}
          </div>
        </div>
      )}

      {actions.length > 0 && (
        <div className="bg-white border border-[#D4E4D5] rounded-lg p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Target className="text-[#C9A84C]" size={18} />
              <h3 className="text-base font-bold text-[#1B4D3E]">Recommended next actions</h3>
            </div>
            <span className="text-xs font-bold text-[#8BAE90]">{reviewed.length} reviewed</span>
          </div>
          <div className="grid gap-3">
            {actions.map((action, index) => {
              const isReviewed = reviewed.includes(action)
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => toggleReviewed(action)}
                  className={`text-left rounded-lg border p-4 transition ${
                    isReviewed
                      ? 'bg-[#EDF4EE] border-[#9CC7A7]'
                      : 'bg-[#F8FBF8] border-[#D4E4D5] hover:border-[#9CC7A7]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isReviewed ? 'bg-[#1B4D3E] text-white' : 'bg-white text-[#8BAE90] border border-[#D4E4D5]'
                    }`}>
                      {isReviewed ? <CheckCircle2 size={16} /> : <Circle size={14} />}
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90]">Action {index + 1}</p>
                      <p className="text-sm font-semibold text-[#1B4D3E] mt-1">{action}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {supportingSections.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {supportingSections.slice(0, 4).map(section => (
            <div key={section.title} className="bg-white border border-[#D4E4D5] rounded-lg p-5">
              <h3 className="text-base font-bold text-[#1B4D3E]">{section.title}</h3>
              <div className="mt-3 space-y-2">
                {section.items.slice(0, 4).map(item => (
                  <div key={item} className="flex gap-2 text-sm text-[#2C3E2D] leading-relaxed">
                    <ChevronRight size={15} className="text-[#8BAE90] mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onAsk(`Tell me more about: ${section.title}`)}
                className="mt-4 text-xs font-bold text-[#1B4D3E] hover:text-[#2D6A4F]"
              >
                Ask about this
              </button>
            </div>
          ))}
        </div>
      )}

      {riskSection && (
        <div className="bg-[#F8FBF8] border border-[#D4E4D5] rounded-lg p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90] mb-2">Focus area</p>
          <p className="text-sm text-[#2C3E2D] leading-relaxed">{riskSection.items[0]}</p>
        </div>
      )}
    </div>
  )
}

function FormattedAssistantText({ text }: { text: string }) {
  const sections = parseSections(text)
  if (sections.length === 0) return <span>{text}</span>

  return (
    <div className="space-y-3">
      {sections.map(section => (
        <div key={`${section.title}-${section.items[0] || ''}`}>
          <p className="font-bold text-[#1B4D3E]">{section.title}</p>
          {section.items.length > 0 && (
            <ul className="mt-1 space-y-1">
              {section.items.map(item => (
                <li key={item} className="flex gap-2">
                  <ChevronRight size={14} className="text-[#8BAE90] mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const Icon = isUser ? User : Bot
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-9 h-9 rounded-lg bg-[#1B4D3E] text-[#E8C84A] flex items-center justify-center shrink-0">
          <Icon size={18} />
        </div>
      )}
      <div
        className={`max-w-[78%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap border ${
          isUser
            ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]'
            : 'bg-white text-[#2C3E2D] border-[#D4E4D5]'
        }`}
      >
        {isUser ? message.content : <FormattedAssistantText text={message.content} />}
      </div>
      {isUser && (
        <div className="w-9 h-9 rounded-lg bg-white border border-[#D4E4D5] text-[#1B4D3E] flex items-center justify-center shrink-0">
          <Icon size={18} />
        </div>
      )}
    </div>
  )
}

export default function FinancialChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Ask me about spending, cash flow, budgets, credit cards, recurring bills, or alerts. I will use your FinDu data only.',
    },
  ])
  const [input, setInput] = useState('')
  const [alerts, setAlerts] = useState<string[]>([])
  const [snapshotMonth, setSnapshotMonth] = useState('')
  const [insightReport, setInsightReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function ask(prompt: string, mode = 'chat') {
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt || loading) return

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: cleanPrompt }]
    setMessages(nextMessages)
    setInput('')
    setError('')
    setLoading(true)

    try {
      const res = await api.post<ChatResponse>('/financial-chat', {
        message: cleanPrompt,
        mode,
        history: messages.filter(message => message.content).slice(-8),
      })
      setMessages([...nextMessages, { role: 'assistant', content: res.data.answer }])
      setAlerts(res.data.alerts || [])
      setSnapshotMonth(res.data.snapshot_month || '')
      if (mode === 'insights') {
        setInsightReport(res.data.answer)
      }
    } catch {
      setError('Could not generate financial insights right now.')
      setMessages(nextMessages)
    } finally {
      setLoading(false)
    }
  }

  async function generateInsights() {
    await ask('Generate the most important financial insights and alerts for me right now.', 'insights')
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#1B4D3E]">Financial Chat</h1>
          <p className="text-sm text-[#7BAE8A] mt-1">
            {snapshotMonth ? `Snapshot: ${monthLabel(snapshotMonth)}` : 'Ask questions or generate alerts from your current data.'}
          </p>
        </div>
        <button
          onClick={generateInsights}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#E8C84A] text-[#1B4D3E] text-sm font-bold rounded-lg hover:bg-[#F0D56A] transition disabled:opacity-50"
        >
          <Sparkles size={16} />
          Generate insights
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px] items-start">
        <section className="space-y-5">
          <InsightBoard
            report={insightReport}
            alerts={alerts}
            loading={loading}
            snapshotMonth={snapshotMonth}
            onGenerate={generateInsights}
            onAsk={ask}
          />

          <div className="bg-white border border-[#D4E4D5] rounded-lg p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-[#8BAE90] mb-3">Quick questions</p>
            <div className="flex flex-wrap gap-2">
              {quickPrompts.map(prompt => (
                <button
                  key={prompt}
                  onClick={() => ask(prompt)}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg border border-[#D4E4D5] text-xs font-semibold text-[#1B4D3E] hover:bg-[#EDF4EE] transition disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="bg-[#F8FBF8] border border-[#D4E4D5] rounded-lg h-[calc(100vh-156px)] min-h-[560px] max-h-[760px] flex flex-col overflow-hidden lg:sticky lg:top-6">
          <div className="border-b border-[#D4E4D5] bg-white px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1B4D3E] text-[#E8C84A] flex items-center justify-center">
              <MessageCircle size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1B4D3E]">Ask FinDu</h2>
              <p className="text-xs text-[#7BAE8A]">Your financial assistant</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message, index) => (
              <MessageBubble key={`${message.role}-${index}`} message={message} />
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#1B4D3E] text-[#E8C84A] flex items-center justify-center shrink-0">
                  <Bot size={18} />
                </div>
                <div className="bg-white border border-[#D4E4D5] rounded-lg px-4 py-3 text-sm text-[#7BAE8A]">
                  Reading your numbers...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-[#D4E4D5] bg-white p-4">
            {error && <p className="text-sm text-[#B85050] mb-2">{error}</p>}
            <form
              onSubmit={e => {
                e.preventDefault()
                ask(input)
              }}
              className="flex gap-3"
            >
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about your finances..."
                className="min-w-0 flex-1 px-4 py-3 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none focus:border-[#1B4D3E]"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="w-12 h-12 rounded-lg bg-[#1B4D3E] text-white flex items-center justify-center hover:bg-[#2D6A4F] transition disabled:opacity-50 shrink-0"
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  )
}
