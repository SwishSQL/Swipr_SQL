# Swish Schedule

Role-based employee shift-scheduling system (Manager / Supervisor / Employee) with
shift swaps, leave requests, bulk Excel upload/export, and live operational dashboards.

**Stack:** React 19 + Vite + TypeScript (frontend) · Express + PostgreSQL (backend).

---

## Architecture

- **Frontend** — Vite SPA built into `dist/`. Talks to the backend over a REST API at `/api`.
- **Backend** — `server.js`: an Express server that serves the built SPA and exposes the
  API. Data is stored in **PostgreSQL** (tables auto-created on first boot).
- Passwords are hashed with **bcrypt** and never returned to the client.

## Run locally

**Prerequisites:** Node.js 18+ and a PostgreSQL database.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your PostgreSQL connection string.
3. Start the backend (terminal 1):
   ```bash
   npm run dev:server
   ```
4. Start the frontend dev server (terminal 2):
   ```bash
   npm run dev
   ```
   Vite runs on `http://localhost:3000` and proxies `/api` to the backend on `:8080`.

To test the production build locally:
```bash
npm run build
npm start          # serves dist/ + API on http://localhost:8080
```

## Deploy to Railway

1. Create a new Railway project and add a **PostgreSQL** plugin.
2. Deploy this repository as a service (Railway auto-detects `railway.json`).
3. In the service **Variables**, add:
   - `DATABASE_URL = ${{ Postgres.DATABASE_URL }}`
   - (`PORT` is provided automatically by Railway — do not hard-code it.)
4. Railway runs `npm install && npm run build`, then `npm start`.
   The Express server binds to the injected `PORT` and serves both the SPA and the API.

> **Note:** Make sure the public networking **target port** matches the port the app
> logs at startup (the server reads `process.env.PORT`).

## First login

On first run the database is empty. Open the app and use the **"Create Initial
Supervisor"** button on the login screen, then sign in with:

- Username: `supervisor`
- Password: `super123`

Change this password immediately from **User Management**.
