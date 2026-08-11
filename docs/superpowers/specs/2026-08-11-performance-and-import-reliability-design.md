# FinDu Performance and Import Reliability Design

## Objective

Make FinDu materially faster in production without removing or changing existing financial functionality. Strengthen statement import deduplication so repeated imports show only unseen transactions while preserving legitimate identical transactions.

## Success Criteria

- Cloud Run keeps one API instance warm and enables startup CPU boost.
- Database schema changes and reference-data seeding run through Alembic, not API startup.
- Monthly dashboard data is available through one consolidated endpoint.
- Transaction endpoints support bounded date filters and optional pagination without breaking existing callers.
- Spending and card summaries are aggregated in PostgreSQL and can be requested for a specific month.
- Statement preview returns only unseen transaction occurrences for the matched account.
- Repeating the same import creates no duplicates.
- Multiple legitimate identical transactions in the same statement remain importable.
- Import confirmation is atomic and idempotent.
- Existing statement parsing, AI categorization, splitting, balance confirmation, import history, batch deletion, account matching, and financial calculations remain available.
- Production assets receive appropriate immutable caching while `index.html` remains revalidatable.
- The repository is pushed only if automated tests, lint, build, migration checks, and smoke tests pass.

## Chosen Approach

Use an incremental, backward-compatible optimization. Existing API routes remain available while new consolidated and batch endpoints become the primary frontend path. This limits regression risk and allows each optimization to be tested independently.

## Architecture

### Runtime and Deployment

- Configure the API Cloud Run service with one minimum instance and startup CPU boost.
- Run Alembic before deploying the new API revision.
- Remove runtime DDL, schema inspection, data backfill, and per-category seed queries from FastAPI startup.
- Keep API health checks independent of external services and database migrations.

### Database

Add indexes aligned with current query patterns:

- `transactions(account_id, date)`
- `transactions(account_id, statement_month)`
- `transactions(date)`
- `transactions(statement_month)`
- `transactions(import_batch_id)`
- `transactions(category, date)`
- `monthly_payments(month)`
- `recurring_matches(month)`
- `recurring_monthly_overrides(month)`
- `category_budget_items(budget_id)`

Alembic will also:

- Seed missing default categories idempotently.
- Backfill missing category-budget items.
- Add persisted import fingerprint and occurrence metadata needed for idempotency.
- Backfill existing imported transactions without changing monetary values, categories, dates, or batch membership.

### API Boundaries

Add focused API services and endpoints rather than expanding the current monolithic handlers:

- Monthly dashboard endpoint returning accounts, recurring items, payments, matches, overrides, relevant checking transactions, and card summaries for one month.
- Transaction queries accepting `date_from`, `date_to`, `month`, `category`, `limit`, and cursor parameters.
- Card-summary endpoint aggregating all cards for a requested month.
- Spending-analysis endpoint accepting a bounded month range and performing aggregation in PostgreSQL.
- Batch transaction-category update endpoint.
- Atomic statement-import confirmation endpoint.

Existing routes retain their current response shapes when new query parameters are absent.

### Frontend Data Flow

- Monthly Cash Flow uses the consolidated monthly endpoint instead of per-account and per-card requests.
- Planned vs Real reuses shared account, category, recurring, and transaction data rather than loading duplicates.
- Spending Analysis requests bounded summaries and fetches filtered category transactions on demand.
- Batch category edits use one API request and update local state after success.
- Stable reference data uses a small client cache with explicit stale times.
- Exchange rates use a backend time-based cache and a browser last-known-good cache.

### Static Delivery

- Hashed assets under `/assets/` receive a one-year immutable cache policy.
- `index.html` remains revalidatable so deployments are discovered promptly.
- Enable gzip compression in Nginx. Use Brotli only if the selected image supports it without increasing operational complexity.

## Statement Import Deduplication

### Normalization

For every parsed transaction, derive a stable base fingerprint from:

- Matched account identifier
- Calendar transaction date
- Normalized description
- Signed amount converted to integer minor units

Description normalization trims whitespace, collapses repeated whitespace, and applies stable case normalization. It does not discard merchant-identifying text.

### Occurrence Semantics

A base fingerprint may legitimately occur multiple times. Deduplication therefore uses multiset comparison:

- Count existing imported occurrences per fingerprint for the matched account.
- Walk the parsed statement in source order.
- Consume one existing occurrence for each matching parsed occurrence.
- Return only surplus occurrences as new.

This means a repeated statement produces zero new rows, while a statement containing two identical purchases preserves both when fewer than two already exist.

### Atomic Confirmation

The frontend submits reviewed transactions to a batch endpoint with a client-generated idempotency key. The backend:

1. Revalidates the account and payload.
2. Recomputes fingerprints and occurrence ordinals.
3. Rechecks existing occurrences inside the database transaction.
4. Inserts only still-new occurrences.
5. Assigns one import batch identifier.
6. Commits all rows together.

On any error, the transaction rolls back. Repeating a successful request with the same idempotency key returns the prior result.

### Compatibility

- Statement parsing and AI categorization retain their current payload shapes, with additive metadata only.
- Split rows receive independent occurrence handling while preserving their reviewed amounts and categories.
- Import history continues grouping by `import_batch_id`.
- Deleting a batch removes its transactions and releases their fingerprints for a future import.
- Account balance confirmation remains a separate explicit user action after successful debit-account import.

## Error Handling

- Consolidated endpoints fail as one response and never return internally inconsistent partial financial data.
- Import confirmation is all-or-nothing.
- The frontend retains review state when an import fails and allows retry with the same idempotency key.
- Exchange-rate failures return the last valid cached value with freshness metadata when available.
- Legacy endpoints remain usable during migration and rollback.

## Verification Strategy

### Import Regression Tests

- Reimporting the same statement returns zero new transactions.
- Two identical legitimate transactions in one statement are both preserved.
- A later statement with one additional identical occurrence returns only the additional occurrence.
- Different transactions on the latest imported date remain visible.
- Fingerprints are isolated by account.
- Amex and BMO statement detection continues matching the correct credit-card account.
- Split transactions, history listing, batch deletion, and balance confirmation retain existing behavior.
- A batch failure creates no partial transactions.
- Retrying an idempotency key does not duplicate rows.

### Performance and Data Tests

- Consolidated dashboard totals equal totals produced by the current rules.
- Spending and card aggregation match representative legacy results.
- Transaction filters and cursor pagination do not omit or repeat rows.
- Migration upgrade succeeds on an existing-style database and on an empty database.
- Relevant PostgreSQL queries are checked with `EXPLAIN` or equivalent plan assertions where practical.

### Release Gate

Before push:

- Backend automated tests pass.
- Frontend lint passes.
- TypeScript and Vite production build pass.
- Alembic upgrade check passes.
- Local API and frontend smoke tests pass.
- Git diff contains no unrelated changes or secrets.

After push:

- GitHub Actions deployment completes successfully.
- Production health endpoint responds successfully.
- A warm request and a cold-start-aware observation are recorded.
- Authentication and statement-import preview receive a production smoke check that does not mutate user financial data.

## Rollout Order

1. Add regression-test foundation and deduplication helpers.
2. Add database migration, indexes, seed/backfill behavior, and import metadata.
3. Add atomic statement import and compatibility tests.
4. Add bounded aggregate and consolidated dashboard endpoints.
5. Migrate frontend pages to the new endpoints and cache behavior.
6. Configure Nginx caching and Cloud Run deployment settings.
7. Run the complete release gate, commit, push, monitor deployment, and perform read-only production smoke checks.

## Non-Goals

- Redesigning the user interface.
- Changing financial calculation rules or currency semantics.
- Replacing PostgreSQL, FastAPI, React, Vite, or Cloud Run.
- Introducing a distributed cache before measured traffic requires one.
- Removing legacy endpoints in this change.
