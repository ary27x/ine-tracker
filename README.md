# INE Price Tracker

A price/stock tracker for the mock e-commerce site [demo.inelabteamdev.com](https://demo.inelabteamdev.com). Users search a catalog, track products, and the backend scrapes each tracked product's current price and stock on a schedule, storing history in Supabase.

**Live site:** https://ine-tracker-nine.vercel.app
**Backend API:** https://ine-tracker.onrender.com

## Stack

- **Frontend:** React + Vite, hosted on Vercel
- **Backend:** Node.js + Express + Playwright, hosted on Render
- **Database:** Supabase (PostgreSQL)
- **Scheduling:** cron-job.org triggers the scrape endpoint on a timer

## Project structure

```
backend/    Express API + Playwright scraper
frontend/   React (Vite) UI
supabase/   Database schema (schema.sql)
```

## Setup instructions

### 1. Database

Run `supabase/schema.sql` against a Supabase project (SQL Editor → paste → run). This creates `tracked_products`, `price_history`, and `scrape_logs`.

### 2. Backend

```bash
cd backend
npm install
npx playwright install chromium
cp .env.example .env   # fill in real values, see table below
npm run dev             # local dev server on :3001
```

To run one scrape manually against your local backend:

```bash
curl -X POST http://localhost:3001/api/scrape/run -H "x-cron-secret: <your CRON_SECRET>"
```

To watch the scraper run in a visible browser window (useful for debugging or demoing):

```bash
npm run scrape:headed
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # set VITE_API_BASE_URL to your backend URL
npm run dev
```

### 4. Deployment

- **Backend (Render):** Root directory `backend`, build command `npm install`, start command `node src/server.js`. Set `PLAYWRIGHT_BROWSERS_PATH=0` so Playwright's Chromium binary is installed into `node_modules` (survives Render's build→runtime handoff) instead of the OS cache directory (which does not).
- **Frontend (Vercel):** Root directory `frontend`, framework preset Vite (auto-detected).
- **Scheduling (cron-job.org):** POST request to `<backend-url>/api/scrape/run` with header `x-cron-secret: <CRON_SECRET>`, every 2 hours.

## Environment variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only — bypasses RLS, never expose to frontend) |
| `CRON_SECRET` | Shared secret required in the `x-cron-secret` header to trigger `/api/scrape/run` |
| `CORS_ORIGIN` | Comma-separated list of allowed frontend origins (e.g. the Vercel URL) |
| `HEADLESS` | `true` in production; `false` only for local visible-browser debugging |
| `PORT` | Port the Express server listens on |
| `MAX_SCRAPE_ATTEMPTS` | Retry attempts per product before giving up (default 3) |
| `SCRAPE_BASE_DELAY_MS` | Base delay for exponential backoff between retries (default 1000ms) |
| `PLAYWRIGHT_BROWSERS_PATH` | Set to `0` on Render so Chromium installs into `node_modules` rather than a build-only cache directory |

### Frontend (`frontend/.env`)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Base URL of the backend API (e.g. `https://ine-tracker.onrender.com`) |

## Scraping schedule

The scraper runs automatically every **2 hours**, triggered by an external cron service (cron-job.org) sending `POST /api/scrape/run` with the `x-cron-secret` header. The endpoint responds immediately (`{"ok":true,"message":"Scrape run started"}`) and runs the actual scrape in the background, since a full run (9 products × up to 3 retries each) can take longer than typical HTTP proxy timeouts.

Each attempt — success, retry, or terminal failure — is logged to the `scrape_logs` table with an `error_type` for anything that failed, so failure patterns are queryable rather than just visible in server logs.

## Further reading

See `DESIGN_NOTE.md` for the reliability approach, trade-offs, and what went wrong (and was fixed) along the way.
