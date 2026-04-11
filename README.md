# FinDu — Multi-Currency Personal Finance

> Take control of your money, wherever it lives.

---

## The Problem

Most people live in one country, earn in one currency, and spend in one place. Personal finance apps were built for them.

But life is more complex than that.

Some of us earn a salary in Brazil and another in Canada. We have a business in one country and investments in another. We hold stocks in USD, pay rent in CAD, and still have financial obligations in BRL. Every month, we're mentally converting, estimating, and guessing whether we're actually doing okay — because no single tool shows the full picture.

FinDu was built to solve exactly that.

---

## What is FinDu?

FinDu is a personal, open-source financial control app designed for people whose financial life spans multiple countries and currencies.

It consolidates all your accounts — bank accounts, credit cards, investment portfolios, business revenue — into a single dashboard, converting everything in real time to whichever currency you want to see.

No more spreadsheets. No more mental math. No more blind spots.

---

## Who is it for?

FinDu is for anyone whose money doesn't live in just one place:

- Expats and immigrants managing finances in two countries
- Professionals with salaries in multiple currencies
- Business owners with revenue in one country and expenses in another
- Investors holding assets in USD, BRL, CAD, EUR, or any combination
- Digital nomads who move between countries and currencies

---

## Core Features

**Multi-currency by design** — Configure whichever currencies make sense for your life. BRL, CAD, USD, EUR, GBP, and more. FinDu converts everything in real time and lets you see your total net worth in any currency.

**All your accounts in one place** — Bank accounts, credit cards, investment accounts, business accounts. Brazil, Canada, or anywhere else.

**AI-powered** — Powered by Claude (Anthropic), FinDu automatically categorizes your transactions, detects anomalies, and lets you ask questions in plain language: *"How much did I spend on restaurants last month?"* or *"What's my savings rate in CAD this year?"*

**Smart statement import** — Upload PDFs, CSVs, OFX files, or even photos of paper statements. FinDu reads and extracts the data automatically.

**Open Finance integration** — Automatic sync with Brazilian banks via Pluggy. Canadian Open Banking support planned for 2026.

**Clean dashboard** — See your total financial position at a glance. Filter by country, currency, account, or category.

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

The API will be running at `http://localhost:8000`

API documentation (auto-generated): `http://localhost:8000/docs`

---

## Project Status

- [x] Phase 0 — Planning & Documentation
- [x] Phase 1 — Foundation & Infrastructure (in progress)
- [ ] Phase 2 — Core Features (accounts, transactions, dashboard)
- [ ] Phase 3 — AI & Statement Import
- [ ] Phase 4 — Open Finance Brazil (Pluggy)
- [ ] Phase 5 — Reports & Final Dashboard

---

## Why not just use [Lunch Money / YNAB / PocketSmith]?

We tried. None of them handle the multi-country, multi-currency, multi-entity reality well. They're built for one person, one country, one currency. FinDu is built for the rest of us.

---

## License

MIT — free to use, fork, and adapt.

---

*Built with Python, FastAPI, and Claude AI.*