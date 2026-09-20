# INE Price Tracker

Tracks products from the [INE mock store](https://demo.inelabteamdev.com/): search, select products to
track, scrape price/stock every 2 hours, and view history + a per-product scrape log
(successful / retried / failed attempts).

## Overview

```
React (Vercel)  →  Express API (Render)  →  Supabase (Postgres)
                                ↑
                    cron-job.org (every 2h) → POST /api/scrape/run
                                ↓
                        Playwright → INE mock store
```

One reusable function, `scrapeProduct(page, product)`, is used for every tracked
product — there are no per-product scraper implementations. A retry/backoff
orchestrator (`runScrape.js`) wraps it, logs every attempt, and guarantees one
product's failure never blocks the others.

## Repo layout

```
backend/    Express API + Playwright scraper
frontend/   React + Vite dashboard
supabase/   schema.sql — run this first
```

## 1. Supabase setup

1. Create a project at supabase.com.
2. Open the SQL editor and run `supabase/schema.sql`. This creates
   `tracked_products`, `price_history`, `scrape_logs`.
3. Copy your **Project URL**, **anon key**, and **service_role key** from
   Project Settings → API. The backend uses the service role key only
   (never expose it to the frontend).

## 2. Backend — local setup

```bash
cd backend
cp .env.example .env      # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
npm install                # also runs `playwright install chromium` via postinstall
npm run dev                 # http://localhost:3001
```

If the Playwright browser download fails in a restricted network, run
`npx playwright install chromium` manually once network access is available.

### Environment variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Not used server-side today; documented for completeness / future auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access, bypasses RLS |
| `CRON_SECRET` | Shared secret cron-job.org sends as `X-Cron-Secret` header |
| `HEADLESS` | `true` in production, `false` for the headed demo |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins, or `*` |
| `PORT` | Express port (Render sets this automatically) |
| `STORE_BASE_URL` | Storefront base URL (default `https://demo.inelabteamdev.com`) |
| `MAX_SCRAPE_ATTEMPTS` | Retry ceiling per scrape (default 3) |
| `SCRAPE_BASE_DELAY_MS` | Base backoff delay in ms (default 1000, doubles each retry) |

## 3. Frontend — local setup

```bash
cd frontend
cp .env.example .env      # VITE_API_BASE_URL=http://localhost:3001
npm install
npm run dev                 # http://localhost:5173
```

## 4. Headed scraper demo

Runs the exact same `scrapeProduct()` + retry logic used in production, but
with a visible browser window:

```bash
cd backend
npm run scrape:headed                    # scrapes all active tracked products
# or, to watch a single product without touching the database:
HEADLESS=false node src/scripts/headed.js --url=https://demo.inelabteamdev.com/product/537
```

You'll see it navigate to the product, click "Reveal price," wait through the
loading state, extract the real price (skipping decoys), and read stock —
plus retries/backoff if a scrape fails.

## 5. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/api/products/search?q=` | Search the live INE catalog |
| GET | `/api/tracked-products` | List tracked products |
| POST | `/api/tracked-products` | Start tracking `{ product_name, product_url, external_id? }` |
| GET | `/api/tracked-products/:id` | One tracked product |
| GET | `/api/tracked-products/:id/history` | Price/stock history |
| GET | `/api/tracked-products/:id/logs` | Scrape attempt log |
| POST | `/api/scrape/run` | Runs the scraper over all active products. Requires header `X-Cron-Secret: <CRON_SECRET>` |

## 6. Deployment

**Backend → Render**
- New Web Service, root directory `backend`.
- Build command: `npm install` (this also installs the Chromium browser via
  the `postinstall` script). Start command: `npm start`.
- Set all env vars from `.env.example` in the Render dashboard.
- Render's free tier can sleep — this is exactly why scheduling uses an
  external cron hitting an HTTP endpoint instead of `setInterval()` inside
  the process (see design note below).

**Frontend → Vercel**
- Import the repo, root directory `frontend`, framework preset "Vite."
- Set `VITE_API_BASE_URL` to the deployed Render URL.

**Cron → cron-job.org**
- Create a job: `POST https://<your-render-app>.onrender.com/api/scrape/run`
- Every 2 hours.
- Add header `X-Cron-Secret: <same value as CRON_SECRET>`.

**CORS**
- Set `CORS_ORIGIN` on the backend to your Vercel URL (comma-separate if you
  keep a preview + production URL).

## Scraper reliability approach

The store is deliberately built to be hard to scrape naively, and the design
below responds directly to what live inspection turned up:

- **Price is hidden behind an interaction.** The detail page loads with the
  price area in an idle state ("Hover over the price area to load the
  current price") and a disabled "Reveal price" button that becomes
  clickable shortly after. The scraper waits for the button to be enabled,
  clicks it, then waits for the price block to leave its loading state
  rather than assuming a fixed delay.

- **Decoy prices in the DOM.** The rendered page contains up to four
  currency-looking values: two hidden (`display:none`/`aria-hidden`,
  including one with a `data-price="true"` attribute — a classic scraper
  honeypot), one visible-but-struck-through "original" price, and the real
  current price. The real price's text is also split across individual
  `<span>` characters interleaved with zero-width space characters, so a
  plain `textContent` grab still needs cleanup. `extractPrice()` filters by
  **computed style** (skips hidden/aria-hidden elements and anything with
  `text-decoration: line-through`) rather than by class name, because the
  class names on these elements (`pw-k2`, `vim8fup`, …) appear to be
  randomized/salted per page load and are not a stable contract.

- **Rate limiting is real.** Refreshing the page can return HTTP 429. The
  scraper checks the navigation response status explicitly and treats 429
  and 5xx as retryable errors with a longer backoff for 429 specifically.

- **Bounded retries with exponential backoff.** Each product gets up to
  `MAX_SCRAPE_ATTEMPTS` (default 3) attempts, with delays of ~1s, 2s, 4s
  (capped at 15s, plus jitter, doubled again after a 429). Every attempt is
  written to `scrape_logs` — success, retry, or terminal failure — with a
  structured `error_type` (`timeout`, `network`, `http_429`, `http_5xx`,
  `selector_missing`, `invalid_price`, `invalid_stock`, `playwright_error`).

- **Never store bad data.** `price_history` and `tracked_products` are only
  updated after a successful attempt whose price parses to a positive number
  and whose stock badge was found. If every attempt for a product fails, only
  `scrape_logs` is written — no price/stock fields are touched, so a gap in
  history is an honest signal that the scrape failed, not a fabricated value.

- **One product's failure never blocks another's.** Each product runs in its
  own `try/catch` and its own fresh Playwright browser context (shared
  browser instance, isolated cookies/state per product), inside a loop that
  always continues to the next product on error.

## Database design

Three tables, matching the assignment: `tracked_products` (one row per
tracked item, holding a denormalized "current" snapshot for fast dashboard
reads), `price_history` (append-only, one row per **successful** scrape),
and `scrape_logs` (append-only, one row per **attempt**, so a single scrape
of one product can appear multiple times under one `run_id` if it retried).
`run_id` groups every product scraped in one `/api/scrape/run` invocation,
which makes it possible to reconstruct "what happened in the 2pm run"
independent of per-product history.

## Scheduling choice

`setInterval()` was explicitly avoided because Render's free tier can spin
the service down when idle, silently killing any in-process timer. Instead,
an external scheduler (cron-job.org) makes an HTTP call to
`POST /api/scrape/run` every 2 hours; Render wakes the service to handle the
request. The endpoint is protected by a shared secret header rather than
being left open, since it triggers real work (browser launches, DB writes)
and unauthenticated triggering would be a cheap DoS vector.

## Trade-offs

- **Search is a two-phase catalog crawl, not a live search box.** Live
  inspection showed the catalog has 1,000 products across 50 pages (20/page,
  click-through Prev/Next pagination, no URL change per page), and each
  listing card's "View details" control is a `<button>`, not an `<a href>` —
  there is no link to scrape directly off the listing. So:
  1. **Metadata phase** (cheap): crawl all 50 pages once, reading only the
     visible name/brand/SKU/category off each tile — no clicking involved.
     Cached for 6 hours (catalog contents are assumed static in this demo;
     only price/stock change per product).
  2. **Resolve phase** (on demand): filter the cached metadata by substring
     match against the query, then — only for the (capped at 20) matches
     actually returned — navigate to that product's page and click its
     "View details" button to capture the real URL Playwright lands on. This
     is the only reliable way to get a product URL here, and it means search
     latency scales with the number of matches shown, not the catalog size.
  Resolved URLs are cached per SKU for the same 6-hour window, so repeat
  searches for the same product are instant. If a search matches more than
  20 products, only the first 20 are resolved and returned — documented, not
  silently dropped (`totalMatches` / `cappedTo` are included in the API
  response).
- **A fresh browser is launched per search request** rather than kept warm,
  favoring simplicity and Render's free-tier memory limits over search
  latency. A search that requires a cold metadata crawl (i.e., cache expired
  or server just started) can take significantly longer than a warm one,
  since it pages through the full catalog first.
- **Stock is normalized to a small vocabulary** (`in_stock` / `out_of_stock`
  / `low_stock` / `unknown`) derived from the badge's class and text, since
  only `out_of_stock` was directly observed during inspection — the other
  values are a best-effort mapping and may need adjustment once more states
  are seen in the headed run.
- **No auth**, per the assignment — the dashboard is a shared/global view.

## What AI-generated code initially got wrong, and how it was corrected

This project's selectors were **not** invented up front. The first attempt to
inspect the live site failed outright: this environment's outbound network
is restricted to a small allowlist (npm, PyPI, GitHub, etc.) that does not
include the store's domain, so a first pass at running Playwright directly
against `demo.inelabteamdev.com` from inside the sandbox returned a 403 at
the network proxy. A follow-up plain HTTP fetch of the homepage also came
back essentially empty (`<div id="root"></div>`) because the store is a
client-rendered SPA — fetching HTML without executing JavaScript shows
nothing useful. Rather than falling back to guessed Amazon/Shopify-style
selectors (`.price`, `.stock-status`, etc.), which the "do not invent
selectors" instruction rules out, development paused and the actual
rendered DOM (product detail page, then the revealed-price state) was
obtained directly from the person running this build, via their browser's
DevTools. That inspection is what surfaced the decoy-price and
randomized-class behavior described above — a first draft written against
plausible-looking-but-invented selectors would have silently scraped the
wrong number (one of the two hidden decoys) most of the time, which is a
far worse failure mode than an honestly-logged scrape failure.

The first version of the catalog/search code was also written before the
listing page's DOM had been inspected, as a stopgap: it assumed product
cards would contain a normal `<a href="/product/{id}">` link and scraped the
homepage for those anchors directly. Once the real listing HTML was shared,
that assumption turned out to be wrong on two counts — the catalog is
paginated (1,000 products, 50 pages, click-through Prev/Next, no URL change
per page) rather than a single scrollable list, and the "View details"
control on each card is a `<button>`, not an `<a>`, so there is no href to
read at all; navigation happens via client-side JS. `catalog.js` was
rewritten around that reality: a cheap metadata-only crawl of all 50 pages
(reading visible text, no clicks), followed by resolving a real URL — by
clicking through to the product and reading `page.url()` — only for the
handful of results an actual search returns. The takeaway generalizes
beyond this one bug: assuming a "View details" affordance is a normal link
is exactly the kind of plausible-but-unverified selector guess the
assignment warns against, and it would have shipped a search feature that
silently returned zero results against the real site.
