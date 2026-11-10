# Cumulative Cash Flow Implementation Plan

**Goal:** Implement the approved inline preview: carry projected balances forward, distinguish monthly cash flow and collapse Income/Expenses.
**Architecture:** Calendar-month projection from today's bank balance through the selected future month using monthly dashboards and existing payment, receipt, match, override and savings data. Preserve the 28–27 salary planning cycle.
**Tech Stack:** React/TypeScript, existing API and node:test. No new dependencies or schema changes.
**Spec:** User-approved inline preview in this chat and UX/design assessment.

- [x] Add calendar projection regression tests (month-end income counted once, year rollover, multiple months/currencies, overrides, cancellations, paid/matched items, savings).
- [x] Extract reusable matching; implement projection utility and request loading with stale-response protection. Recompute selected-month changes. Past months show monthly result, without inventing historic bank balances.
- [x] Apply compact summary, distinct calendar/cycle labels, native collapsed Income/Expenses with existing actions and accessible focus; keep errors visible.
- [x] Run suite/build/lint and responsive UI verification, one focused review, commit and push. No deployment monitoring.

Execution: inline in the existing clean checkout, as authorized by user's implementation-and-push request. Baseline: 23 frontend tests pass.

Validation: 48 frontend tests pass; TypeScript app/node checks, production Vite build and ESLint pass. Build used temporary TypeScript cache paths and Vite runner because shared node_modules cache is outside the sandbox. Focused review identified prior-month receipt changes not propagating; fixed with applyProjectionPayments and cancellation/restore regression test. Browser verification could not complete: in-app localhost connection timeout and Chrome automation timeout. No production data or backend changes.

Remote integration: rebased onto current origin/main, preserving routed bank/card expense handling and forecast card charges. Added regression covering card-paid bills only affecting the bank in their due month and replacing estimates with posted charges without duplication.
