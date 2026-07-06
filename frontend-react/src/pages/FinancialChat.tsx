import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Send, Sparkles, User } from 'lucide-react'
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
        {message.content}
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
    <div className="max-w-6xl mx-auto">
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

      {alerts.length > 0 && (
        <div className="bg-white border border-[#D4E4D5] rounded-lg p-4 mb-5">
          <div className="flex items-center gap-2 text-[#B85050] font-bold text-sm mb-2">
            <AlertTriangle size={17} />
            Active alerts
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {alerts.map(alert => (
              <div key={alert} className="bg-[#FFF8E6] border border-[#F0D56A] rounded-lg px-3 py-2 text-sm text-[#5A4A1D]">
                {alert}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#F8FBF8] border border-[#D4E4D5] rounded-lg min-h-[560px] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
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
          <div className="flex flex-wrap gap-2 mb-3">
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
              className="flex-1 px-4 py-3 rounded-lg border border-[#D4E4D5] bg-white text-[#1B4D3E] text-sm font-semibold focus:outline-none focus:border-[#1B4D3E]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="w-12 h-12 rounded-lg bg-[#1B4D3E] text-white flex items-center justify-center hover:bg-[#2D6A4F] transition disabled:opacity-50"
              aria-label="Send message"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
