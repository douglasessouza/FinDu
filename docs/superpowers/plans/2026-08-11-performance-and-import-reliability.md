# FinDu Performance and Import Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FinDu faster in production and make statement imports atomically idempotent without changing existing financial behavior.

**Architecture:** Introduce focused backend service modules behind backward-compatible FastAPI routes, migrate schema and seed work to Alembic, and replace frontend N+1 calls with bounded consolidated requests. Persist import fingerprints plus occurrence ordinals so deduplication is account-scoped and multiset-aware.

**Tech Stack:** Python 3.14, FastAPI 0.135, SQLAlchemy 2.0, Alembic 1.18, PostgreSQL/Supabase, pytest, React 19, TypeScript 6, Vite 8, Nginx, Google Cloud Run.

## Global Constraints

- Preserve statement parsing, AI categorization, splitting, balance confirmation, import history, batch deletion, account matching, and all existing financial calculations.
- Keep legacy API response shapes when new optional query parameters are absent.
- Use one minimum Cloud Run API instance and startup CPU boost.
- Do not push unless backend tests, frontend lint/build, migration checks, and local smoke tests pass.
- Keep monetary fingerprint inputs in signed integer minor units; do not fingerprint binary floats.
- Never expose credentials or mutate production financial data during smoke tests.

---

## File Structure

- `app/imports.py`: pure normalization, fingerprint, multiset comparison, and batch-import service functions.
- `app/reporting.py`: bounded transaction filters and SQL-backed dashboard/card/spending aggregation helpers.
- `app/exchange_rates.py`: process-local last-known-good exchange-rate cache.
- `app/main.py`: request/response models and thin FastAPI route adapters.
- `app/models.py`: persisted import metadata and query-aligned indexes.
- `tests/`: isolated backend behavior and API regression tests using SQLite fixtures where SQL is portable.
- `alembic/versions/*_optimize_performance_and_imports.py`: schema, indexes, backfill, seed, and budget-item migration.
- `frontend-react/src/services/api.ts`: shared request types and small reference-data cache.
- Relevant React pages: migrate data loading to consolidated/bounded/batch endpoints.
- `nginx.conf`, `.github/workflows/deploy.yml`: cache and Cloud Run configuration.

### Task 1: Backend test foundation and import fingerprint rules

**Files:**
- Modify: `requirements.txt`
- Create: `tests/conftest.py`
- Create: `tests/test_import_deduplication.py`
- Create: `app/imports.py`

**Interfaces:**
- Produces: `normalize_description(value: str) -> str`
- Produces: `transaction_fingerprint(account_id: int, date_value: date | datetime | str, description: str, amount: Decimal | float | str) -> str`
- Produces: `filter_unseen_occurrences(parsed: list[dict], existing_counts: Mapping[str, int], account_id: int) -> list[dict]`

- [ ] **Step 1: Add pytest and create isolated database fixtures**

Add `pytest==8.4.2` to `requirements.txt`. In `tests/conftest.py`, set a temporary SQLite `DATABASE_URL` before importing app modules, create an in-memory engine with `StaticPool`, create all metadata, and override `get_db` for `TestClient`.

- [ ] **Step 2: Write failing pure-function tests**

Cover whitespace/case normalization, cents-based amounts, account isolation, repeat import returning none, two identical statement rows surviving when existing count is zero, and only one surplus row surviving when existing count is one.

```python
def test_multiset_deduplication_preserves_surplus_occurrence():
    rows = [ROW.copy(), ROW.copy()]
    fingerprint = transaction_fingerprint(7, ROW["date"], ROW["description"], ROW["amount"])
    assert filter_unseen_occurrences(rows, {fingerprint: 1}, 7) == [ROW]
```

- [ ] **Step 3: Run the tests and confirm RED**

Run: `.venv/bin/pytest tests/test_import_deduplication.py -q`
Expected: collection fails because `app.imports` does not exist.

- [ ] **Step 4: Implement the minimal pure functions**

Use Unicode normalization, collapsed whitespace, casefolding, `Decimal(str(amount)).quantize(Decimal("0.01"))`, canonical ISO calendar date, SHA-256, and a consumed-count dictionary that walks source rows in order.

- [ ] **Step 5: Run tests and commit GREEN**

Run: `.venv/bin/pytest tests/test_import_deduplication.py -q`
Expected: all tests pass.

Commit: `test: establish import deduplication rules`

### Task 2: Persist import identity and move startup work to Alembic

**Files:**
- Modify: `app/models.py`
- Modify: `app/main.py:247-278`
- Create: `alembic/versions/<revision>_optimize_performance_and_imports.py`
- Create: `tests/test_migration_contract.py`

**Interfaces:**
- Produces transaction fields: `import_fingerprint: str | None`, `import_occurrence: int | None`, `import_idempotency_key: str | None`
- Produces unique constraint: `(account_id, import_fingerprint, import_occurrence)` for non-null imported identities.

- [ ] **Step 1: Write failing model and startup-contract tests**

Assert the new model columns/indexes exist and that importing/starting the FastAPI app no longer calls `Base.metadata.create_all`, `inspect`, `ALTER TABLE`, or per-category seed queries.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `.venv/bin/pytest tests/test_migration_contract.py -q`
Expected: missing columns/indexes and startup hook still present.

- [ ] **Step 3: Add model metadata and one Alembic migration**

The migration must add import columns, backfill only rows with `import_batch_id`, assign occurrence numbers per `(account_id, fingerprint)` in deterministic `date,id` order, create query indexes from the design, seed missing default categories with conflict-safe SQL, and backfill missing general budget items.

- [ ] **Step 4: Remove runtime DDL and seed mutation**

Delete `initialize_reference_data`; retain no schema mutation in application startup.

- [ ] **Step 5: Verify migration SQL and tests**

Run: `DATABASE_URL=sqlite:////tmp/findu-plan-migration.db .venv/bin/alembic upgrade head`
Run: `.venv/bin/pytest tests/test_migration_contract.py -q`
Expected: migration and tests pass.

Commit: `perf: move schema setup and indexes to alembic`

### Task 3: Atomic and idempotent statement import

**Files:**
- Modify: `app/imports.py`
- Modify: `app/main.py:1437-1476`
- Modify: `app/main.py:600-710`
- Create: `tests/test_statement_import_api.py`

**Interfaces:**
- Produces: `POST /imports/confirm`
- Consumes JSON: `{account_id, idempotency_key, transactions[]}`
- Returns: `{import_batch_id, inserted_count, skipped_count, transactions}`
- Extends `POST /parse-statement` response with additive fingerprint occurrence metadata.

- [ ] **Step 1: Write failing API tests**

Test same-day unseen rows, account isolation, identical-occurrence preservation, repeated idempotency key, repeated statement with a new key, invalid account rollback, and a forced mid-batch failure leaving zero rows.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `.venv/bin/pytest tests/test_statement_import_api.py -q`
Expected: `/imports/confirm` returns 404.

- [ ] **Step 3: Replace last-date filtering with multiset filtering**

Query existing fingerprint counts for the matched account, include fallback fingerprints for legacy untagged rows during transition, and preserve `last_date` only as display metadata.

- [ ] **Step 4: Implement atomic confirmation**

Use one SQLAlchemy transaction, recompute server-side identities, allocate occurrence ordinals after existing counts, insert all rows, and return a prior batch result when the idempotency key already exists.

- [ ] **Step 5: Run import regression suite and commit**

Run: `.venv/bin/pytest tests/test_import_deduplication.py tests/test_statement_import_api.py -q`
Expected: all tests pass.

Commit: `feat: make statement imports atomic and idempotent`

### Task 4: Bounded reporting and consolidated dashboard API

**Files:**
- Create: `app/reporting.py`
- Modify: `app/main.py:706-815`
- Modify: `app/main.py:1031-1083`
- Create: `tests/test_reporting_api.py`

**Interfaces:**
- Produces: `GET /dashboard/monthly?month=YYYY-MM`
- Produces: `GET /card-statements/summary?month=YYYY-MM`
- Extends: `GET /transactions` with `date_from`, `date_to`, `month`, `category`, `limit`, `cursor`
- Extends: `GET /spending-analysis` with `month_from`, `month_to`

- [ ] **Step 1: Write failing compatibility and aggregate tests**

Seed checking/card transactions across several months. Assert legacy unfiltered shapes, stable cursor ordering `(date DESC, id DESC)`, bounded results, card-cycle totals, excluded categories, and consolidated dashboard equality with legacy calculations.

- [ ] **Step 2: Run tests and confirm RED**

Run: `.venv/bin/pytest tests/test_reporting_api.py -q`
Expected: new endpoint 404 or missing query behavior.

- [ ] **Step 3: Implement SQL-backed helpers and thin routes**

Use SQL `SUM`, conditional aggregation, bounded date predicates, and deterministic cursor encoding. Fetch dashboard collections in a bounded number of queries independent of account count.

- [ ] **Step 4: Run reporting tests and inspect query count**

Run: `.venv/bin/pytest tests/test_reporting_api.py -q`
Expected: all tests pass and dashboard query-count assertion stays constant as accounts are added.

Commit: `perf: add bounded financial reporting endpoints`

### Task 5: Batch edits and exchange-rate caching

**Files:**
- Create: `app/exchange_rates.py`
- Modify: `app/main.py:168-227`
- Modify: `app/main.py:818-838`
- Create: `tests/test_batch_updates_and_rates.py`

**Interfaces:**
- Produces: `PATCH /transactions/categories` with `{updates: [{id, category}]}`
- Produces: cached exchange response with `cache_status` and existing rate fields.

- [ ] **Step 1: Write failing tests**

Assert category updates commit atomically, invalid IDs roll back, cached exchange requests make one upstream call inside TTL, and upstream failure serves last-known-good data.

- [ ] **Step 2: Run tests and confirm RED**

Run: `.venv/bin/pytest tests/test_batch_updates_and_rates.py -q`
Expected: batch route missing and upstream called repeatedly.

- [ ] **Step 3: Implement minimal services and routes**

Use a lock-protected process cache with timestamp/expiry and preserve the existing response fields. Apply transaction category updates in one database transaction.

- [ ] **Step 4: Verify and commit**

Run: `.venv/bin/pytest tests/test_batch_updates_and_rates.py -q`
Expected: all tests pass.

Commit: `perf: batch category edits and cache exchange rates`

### Task 6: Migrate frontend data loading and import confirmation

**Files:**
- Modify: `frontend-react/src/services/api.ts`
- Modify: `frontend-react/src/pages/ImportStatement.tsx`
- Modify: `frontend-react/src/pages/MonthlyCashFlow.tsx`
- Modify: `frontend-react/src/pages/PlannedVsReal.tsx`
- Modify: `frontend-react/src/pages/SpendingAnalysis.tsx`
- Create: `frontend-react/src/services/cache.ts`

**Interfaces:**
- Consumes all Task 3–5 endpoints.
- Produces a TTL cache helper: `cachedGet<T>(key: string, loader: () => Promise<T>, ttlMs: number): Promise<T>`.

- [ ] **Step 1: Add frontend type contracts and failing compile references**

Define `MonthlyDashboardResponse`, `ImportConfirmRequest/Response`, paginated transaction types, and cached exchange metadata. Change call sites to the new typed functions before implementations so `npm run build` fails on missing helpers.

- [ ] **Step 2: Confirm RED**

Run: `cd frontend-react && npm run build`
Expected: TypeScript errors for missing service helpers.

- [ ] **Step 3: Implement data-flow migration**

Use one monthly dashboard request, one card summary request, bounded category transaction requests, one batch category update, and one atomic import confirmation. Preserve review state and reuse the same idempotency key after retryable failure.

- [ ] **Step 4: Add last-known-good browser exchange cache**

Cache only validated finite positive rates with their fetched timestamp; expire normal reads according to server metadata but retain stale values for fallback display.

- [ ] **Step 5: Verify frontend and commit**

Run: `cd frontend-react && npm run lint && npm run build`
Expected: both exit 0.

Commit: `perf: consolidate frontend data loading`

### Task 7: Static caching and Cloud Run deployment configuration

**Files:**
- Modify: `nginx.conf`
- Modify: `.github/workflows/deploy.yml`
- Create: `tests/test_deployment_config.py`

**Interfaces:**
- Produces immutable `/assets/` cache, revalidating SPA HTML, gzip, Alembic deploy step, `--min-instances=1`, and `--cpu-boost`.

- [ ] **Step 1: Write failing config tests**

Parse text/YAML and assert the required cache directives, migration step ordering before API deploy, minimum instances, CPU boost, and absence of secrets printed by commands.

- [ ] **Step 2: Run and confirm RED**

Run: `.venv/bin/pytest tests/test_deployment_config.py -q`
Expected: required directives/options are absent.

- [ ] **Step 3: Implement deployment and Nginx changes**

Add exact-match handling for `/index.html`, immutable cache for hashed assets, gzip MIME types, an Alembic execution mechanism using the built API image, and Cloud Run instance settings.

- [ ] **Step 4: Verify and commit**

Run: `.venv/bin/pytest tests/test_deployment_config.py -q`
Expected: all tests pass.

Commit: `perf: tune Cloud Run and static asset delivery`

### Task 8: Complete verification, push, and read-only production smoke test

**Files:**
- Modify only if a verification failure reveals a root cause covered by this spec.

**Interfaces:**
- Consumes the complete application and deploy workflow.
- Produces a verified main-branch deployment.

- [ ] **Step 1: Run complete backend and migration suite**

Run: `.venv/bin/pytest -q`
Run: `DATABASE_URL=sqlite:////tmp/findu-final-migration.db .venv/bin/alembic upgrade head`
Expected: zero failures and successful upgrade.

- [ ] **Step 2: Run complete frontend gate**

Run: `cd frontend-react && npm run lint && npm run build`
Expected: both exit 0 with recorded bundle sizes.

- [ ] **Step 3: Run local smoke tests**

Start API and Vite with the webapp-testing server helper; verify authentication status, initial route rendering, monthly dashboard request, navigation, and import preview using temporary non-production fixtures.

- [ ] **Step 4: Audit repository state**

Run: `git diff --check`, `git status --short`, secret-pattern scan limited to changed files, and `git log --oneline -12`.
Expected: no whitespace errors, unrelated files, generated artifacts, or credentials.

- [ ] **Step 5: Push only after all gates pass**

Run: `git push origin main`
Expected: push accepted and GitHub Actions workflow starts.

- [ ] **Step 6: Monitor deployment and smoke test production read-only**

Wait for GitHub Actions completion. Then call `/health`, `/auth/status`, and other authentication-safe read-only endpoints, recording status and latency. Do not submit imports, category edits, deletions, or financial mutations.

- [ ] **Step 7: Report measured outcome**

Compare new warm latency, request count per key screen, bundle sizes, and cold-start configuration with the baseline: first health request 10.15 seconds, warm health request 0.14 second, initial shared JS 95.75 KB gzip, chart chunk 98.18 KB gzip.
