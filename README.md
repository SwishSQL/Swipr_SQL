# Swipr + Quality — SQL Server edition

Swish's staff scheduling system (Swipr) together with the Quality (QA) system, as one application on **Microsoft SQL Server**.
Functionally identical to the PostgreSQL edition (`swish-schedule-main`, branch `qa-merge`): same website, same API, same
screens. Only the data layer changed. **To install it, read [docs/DEPLOY-IT.md](docs/DEPLOY-IT.md).**

## What is in here

| | |
|---|---|
| `server.js` | Express server: Swipr API (`/api`), the Swipr website (`dist/`), the Quality website (`qa-ui-dist/` at `/qa/`), call signalling |
| `qa/` | Quality module (API under `/api/qa`): `qa-module.ts` (routes), `index.ts` (identity, role guards, Quality Access), `db.ts` + `qa-sql.js` (SQL adapter) |
| `qa-ui/` | Quality website (its own small Vite app with its own design) |
| `db.js` | **Data layer**: a `pg`-shaped pool on top of the `mssql` driver (transactions, JSON columns, large IN lists) |
| `db-translate.js` | PostgreSQL -> T-SQL translation of the SQL the application sends (one rule per construct, documented in the file) |
| `sql/schema.sql` | Every table, index, view and function (idempotent T-SQL) |
| `scripts/migrate-from-postgres.mjs` | One-off copy of the live PostgreSQL database, verified cell by cell |
| `tools/` | `db-init.mjs`, `sweep.mjs` (compiles every SQL statement of the app on a real SQL Server), schema generator and local-test helpers |

## How the database layer works

The application was written for PostgreSQL. Rather than hand-rewrite ~430 statements, `db-translate.js` translates, at run time,
the constructs it uses: `$n` placeholders, `->>` JSON access, `= ANY($n)`, `UNNEST(...)` batches, `ON CONFLICT` upserts
(`MERGE`), `RETURNING` (`OUTPUT`), `LIMIT/OFFSET`, `FOR UPDATE`, `::` casts, intervals, `ILIKE`, and a few more. Statements
that have no safe mechanical translation were rewritten by hand in the source.

* JSON documents (users, schedules, requests ...) are `NVARCHAR(MAX)` with an `ISJSON` check; columns that hold documents are
  parsed on read. `users.username` is a computed, uniquely indexed column.
* **Every text column has the same binary collation**, which reproduces PostgreSQL's case-sensitive comparisons and avoids
  SQL Server's "collation conflict" errors between columns.
* BIGINT is a string and INT a number, as with `pg`. The Quality module asks for BIGINT as numbers.
* SQL Server allows 2100 parameters per statement: long `IN (...)` lists are sent as one JSON array.
* The application issues no DDL while running. `AUTO_INIT_DB=true` lets it run `sql/schema.sql` at start.

## Tests that were run (see docs/DEPLOY-IT.md, "What was verified")

The PostgreSQL edition and this edition were run side by side on the same data (a copy of production) and compared:
every read route for every role, large write scenarios (responses and the resulting change in every table), the batch
upserts, binary uploads, and a cell-by-cell comparison of the migrated data.
`npm run sweep` compiles every SQL statement of the code against a real SQL Server (needs a reachable database).

## Development

```bash
npm ci
cp .env.example .env     # DATABASE_URL, JWT_SECRET
npm run db:init          # or AUTO_INIT_DB=true
npm run build
npm start
```

Notes for changing the code: use PostgreSQL-style SQL with `$1` placeholders through `pool.query` (it is translated), keep
boolean columns out of bare conditions (`WHERE flag = 1`), and run `npm run sweep` after touching SQL.
`tools/gen-mssql-schema.cjs` regenerates `sql/schema.sql` from a PostgreSQL catalog dump; the Quality routes
(`qa/qa-module.ts`) are edited directly and are no longer generated.
