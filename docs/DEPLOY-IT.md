# Swipr + Quality (SQL Server edition) - deployment guide for IT

One Node.js process serves the Swipr website, the Quality website (`/qa/`), the API (`/api`, Quality under `/api/qa`) and the
live call signalling (WebSocket). Everything is stored in ONE SQL Server database.

| | |
|---|---|
| SQL Server | 2016 or newer (tested on SQL Server 2025) |
| Node.js | 20 or newer, with npm |
| Default port | 8080 (`PORT` in `.env`) |

---

## 1. One SQL Server login (DBA, 1 minute)

Run in SSMS as sysadmin (change the name and password):

```sql
CREATE LOGIN [swipr_app] WITH PASSWORD = N'<STRONG-PASSWORD>', CHECK_POLICY = ON;
ALTER SERVER ROLE dbcreator ADD MEMBER [swipr_app];   -- lets the app create the database itself
```

* With `dbcreator` and `AUTO_INIT_DB=true` the app creates the database named in `DATABASE_URL` (e.g. `Swish_Swipr`),
  owns it, and creates every table and view.
* Prefer to do it yourself? `CREATE DATABASE [Swish_Swipr]`, add the login as a user with `db_owner`, then run
  `sql/schema.sql` (it is idempotent; the batch separator is a line that only contains `GO`).
  Strict mode: `AUTO_INIT_DB` unset, the login may be limited to `db_datareader` + `db_datawriter` plus EXECUTE on `dbo.fn_digits`;
  the app only checks that everything exists and refuses to start otherwise.
* Server/database collation does not matter: every text column carries its own binary collation (case-sensitive, like
  PostgreSQL), so nothing depends on the server default.

## 2. Install

```bash
git clone <repository-url> swipr-sql
cd swipr-sql
npm ci
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`: `DATABASE_URL` (or the `MSSQL_*` lines), `PORT`, and **`JWT_SECRET`** (32+ random characters, for example
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`; use the OLD system's value so nobody has to sign in
again). Optional integrations (XonTel, push, Cloudinary, TURN, fingerprint bridge) are listed in `.env.example`; copy the values
from the old system's environment.

## 3. Copy the existing data from the old system (once)

The old data is in a PostgreSQL database on Railway (Swipr and the Quality tables, which are `qa_*` tables in the same
database). You need a **read only** connection string from the person who owns the Railway project (Postgres service ->
Connect -> Public/TCP URL). Put it in `.env`:

```
PG_SOURCE_URL=postgresql://user:password@host:port/database
```

Then, **before the first `npm start`**:

```bash
npm run migrate:from-postgres
```

It creates the database and tables if they do not exist, reads the old database in ONE read-only snapshot (the source is
never written to), copies every table with its original ids, then reads everything back from SQL Server and compares
**every cell**. It must end with a line like:

```
OK: 196920 rows, 1796968 cells verified identical.
```

Anything else is an error that names the table and column. Afterwards remove `PG_SOURCE_URL` from `.env`.

> Started the app already and it wrote some rows? Run `npm run migrate:from-postgres -- --replace` to wipe the tables first.
>
> **Order matters.** The Quality system used to be a separate application with its own database. Its data reaches this
> database only after it has been imported into the PostgreSQL Swipr database (the Quality tables `qa_*` are then part of the
> data this command copies). Migrate when that import is done; re-run with `--replace` at the final cut-over so the last
> changes are included.

## 4. Build and start

```bash
npm run build      # builds Swipr (dist/), the Quality server module (qa-dist/) and the Quality website (qa-ui-dist/)
npm start
```

A good start ends with:

```
[qa] Quality module mounted at /api/qa
[db] schema ready
[server] listening on :8080
```

Run it as a service with your usual tool (NSSM / pm2 / Windows Service / systemd) using `npm start` in the project folder.
**Reverse proxy / HTTPS:** forward the public name to the port and let WebSocket upgrades through (`Upgrade` / `Connection`
headers): in-app calls need them. Send `X-Forwarded-*` headers as usual.

## 5. After the first start

* `GET /api/health` returns `{"ok":true}`. Sign in as an existing admin, open **Quality** from the switcher at the top of the
  menu (people with a Quality role only), and check the dashboards show the old data.
* People with Quality access are managed in Quality -> **Quality Access** (supervisors only).
* The database is the only state the app has (recordings and photos live in it too): back it up with your normal SQL Server backups.

## 6. Updating later

```bash
git pull
npm ci
npm run build
# restart the service
```

`sql/schema.sql` is idempotent; with `AUTO_INIT_DB=true` the app re-applies it at start, otherwise run it again.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `The database is missing: ...` at start | `AUTO_INIT_DB` is off and `sql/schema.sql` was not run (or an old copy was): run it, or set `AUTO_INIT_DB=true` with a `dbcreator`/`db_owner` login. |
| `Login failed for user` | wrong password, or the login has no user in an existing database. |
| `self signed certificate` / TLS error | `MSSQL_TRUST_CERT=true` (default) and `MSSQL_ENCRYPT` matching the server (or `?encrypt=..` on the URL). |
| `Cannot resolve the collation conflict` | a table was created by hand with another collation: use `sql/schema.sql` as is. |
| Quality shows "No Quality access" | the person has no Quality role yet: Quality -> Quality Access. |
| Everybody must sign in again after the move | `JWT_SECRET` differs from the old system's. |

## What was verified

* Swipr core: every GET route for all 8 roles (288 responses) identical to the PostgreSQL edition; a write scenario (users,
  schedules, swaps, leaves, holidays, templates, evaluations, breaks, XonTel mapping, notifications, push, attendance, lateness
  recomputation) with identical responses and identical changes in all 19 tables.
* Quality module: 499 read requests across 7 roles identical (differences only in the order of ties the original query leaves
  unspecified); a 62-request write scenario with identical responses and identical changes in all 17 Quality tables.
* The batch upserts fed by XonTel and the fingerprint terminal return and store the same rows on both databases.
* Data migration of a copy of the production database (50 tables, 196,920 rows, ~1.8 million cells) compared cell by cell.
