# FinDu — Personal Finance, Powered by AI

> Your money. Every account. Every currency. Every insight.

---

## The Problem

Managing personal finances is harder than it should be.

You have a bank account, a credit card, maybe some investments, a car loan, and a dozen recurring expenses. Every month you try to figure out where the money went — and every month the picture is blurry. Most apps give you charts. But charts don't tell you why you spent more in March, or whether you can actually afford that trip in July, or whether your spending habits are quietly working against your goals.

And if your financial life spans more than one country or currency? Forget it. No tool handles that well.

FinDu was built to change that.

---

## What is FinDu?

FinDu is a personal finance app that gives you a complete, intelligent view of your financial life — regardless of how many accounts, countries, or currencies are involved.

It connects your bank accounts, credit cards, and investments, automatically categorizes your transactions, and uses AI to help you understand your money: your habits, your patterns, your risks, and your opportunities.

Whether you live in one country or five, earn in one currency or three, FinDu adapts to your reality.

---

## Who is it for?

**Anyone who wants to actually understand their finances** — not just track them.

- People who want to stop guessing and start knowing
- Anyone juggling multiple accounts, cards, or currencies
- Expats and immigrants managing finances across countries
- Professionals with income in multiple currencies (BRL, CAD, USD, EUR...)
- Investors tracking portfolios alongside day-to-day spending
- Business owners who need to separate personal and company finances
- Anyone tired of spreadsheets and apps that only show half the picture

---

## Core Features

### 💰 Complete Financial Overview
All your accounts in one place — bank accounts, credit cards, investments, business accounts. See your real net worth in any currency, updated in real time.

### 🌍 True Multi-Currency Support
Configure whichever currencies make sense for your life. BRL, CAD, USD, EUR, GBP — set your base currency and see everything converted automatically with real-time exchange rates.

### 🤖 AI-Powered Intelligence
Powered by Claude (Anthropic), FinDu goes beyond categorization:
- **Automatic transaction categorization** — groceries, travel, kids, car, subscriptions
- **Spending behavior analysis** — understand your patterns and lifestyle habits
- **Monthly and annual forecasting** — AI predicts your future spending based on past behavior
- **Personalized tips** — actionable advice to improve your financial health
- **Natural language chat** — ask anything: *"How much did I spend on restaurants in Q1?"* or *"Can I afford a $3,000 vacation in August?"*
- **Anomaly alerts** — get notified when something looks off

### 📊 Smart Reporting
- Monthly and annual summaries
- Spending breakdown by category (food, travel, kids, car, health, etc.)
- Income vs. expenses trends
- Savings rate tracking
- Investment performance overview
- Exportable reports (PDF and Excel)

### 💳 Credit Card Management
Full visibility into your credit cards — spending by card, by category, upcoming bills, and how credit card spending fits into your overall monthly budget.

### 📈 Investment Tracking
Track your investment portfolio alongside your day-to-day finances. Stocks, funds, and assets in any currency — see the full picture.

### 📥 Smart Statement Import
Upload PDFs, CSVs, OFX files, or even photos of paper statements. FinDu reads and extracts the data automatically using AI.

### 🏦 Open Finance Integration
- Automatic sync with Brazilian banks via Pluggy (Open Finance BR)
- Canadian Open Banking support planned for 2026

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Python 3.14+ |
| Backend | FastAPI |
| Database | PostgreSQL (Supabase) |
| ORM | SQLAlchemy + Alembic |
| Frontend (v1) | Streamlit |
| Frontend (v2) | React + TypeScript + Tailwind CSS |
| Container | Docker |
| Cloud | Google Cloud Run |
| CI/CD | GitHub Actions |
| AI | Claude API (Anthropic) |
| Open Finance BR | Pluggy |
| Open Finance CA | Plaid (future) |

---

## Running Locally

**Prerequisites:** Docker, Git

```bash
# Clone the repository
git clone https://github.com/douglasessouza/FinDu.git
cd FinDu

# Copy environment variables
cp .env.example .env
# Fill in your credentials in .env

# Start the application
docker compose up --build
```

API running at: `http://localhost:8000`
Auto-generated API docs: `http://localhost:8000/docs`

---

## Project Status

- [x] Phase 0 — Planning & Documentation
- [x] Phase 1 — Foundation & Infrastructure (in progress)
- [ ] Phase 2 — Core Features (accounts, transactions, dashboard)
- [ ] Phase 3 — AI & Statement Import
- [ ] Phase 4 — Open Finance Brazil (Pluggy)
- [ ] Phase 5 — Reports & Final Dashboard

---

## Why not just use [YNAB / Lunch Money / PocketSmith / Mint]?

They're good apps — for a simple financial life. But they weren't built for people with multiple currencies, multiple countries, or the need for real AI-driven insight (not just charts). FinDu is.

---

## License

MIT — free to use, fork, and adapt.

---

*Built with Python, FastAPI, and Claude AI.*