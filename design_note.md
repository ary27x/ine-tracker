# Design Note: Scraper Reliability

## The core challenge

The mock store (demo.inelabteamdev.com) is deliberately built to defeat naive scraping: a cookie-consent overlay that intercepts clicks, a price hidden behind a "Reveal price" button that only enables under a specific real-mouse interaction, randomized per-load class names, and multiple decoy price elements (hidden, struck-through, honeypot `data-price` attributes) sitting alongside the one real price. Reliability here meant handling both *transient* failures (network blips, rate limits, slow loads) and *adversarial* ones (the site actively trying to distinguish bots from humans).

## How reliability was built in

**Typed errors, not string matching.** `ScrapeError` carries a `type` (`timeout`, `network`, `http_429`, `selector_missing`, `invalid_price`, etc.) so the retry orchestrator can log a meaningful `error_type` per attempt without parsing error messages — this makes failure patterns queryable in `scrape_logs` rather than just readable in server logs.

**Bounded retries with exponential backoff + jitter.** Each product gets up to 3 attempts, with delay increasing exponentially (capped at 15s) and extra jitter to avoid synchronized retry storms. A 429 specifically gets an additional penalty delay, since hammering a rate-limited endpoint faster only makes it worse.

**Structural price detection, not class-name matching.** Since the site randomizes classnames per load, the real price is identified by *behavior*: visible (not `display:none`/`aria-hidden`), not struck-through, not a `data-price` honeypot, and containing digits after stripping zero-width characters used to defeat naive `innerText` reads.

**One attempt = one clean function.** `scrapeProduct()` does exactly one attempt and throws on any failure; all retry/backoff/logging logic lives in the orchestrator (`runScrapeProductWithRetries`). This separation made it much easier to isolate and fix the reveal-button bug in isolation without touching retry logic.

**Every attempt is logged, success or failure**, before any price/stock data is written — `price_history` and `tracked_products` are only ever updated on a genuine success, so a bad run never silently overwrites good data with nulls or stale values.

**Fire-and-forget scrape trigger.** The `/api/scrape/run` endpoint responds immediately and runs the actual scrape in the background, since a full run can exceed typical HTTP proxy/load-balancer timeouts (relevant both for manual testing and for the external cron service).

## Trade-offs

- **Fixed jitter timeout margins** (e.g. waiting up to 6-20s for various state transitions) rather than something adaptive — simpler and predictable, but means a genuinely broken page takes the full timeout to fail rather than failing fast.
- **Free-tier hosting constraints accepted as-is** — Render's free tier cold-starts after ~15 minutes idle and has limited RAM; acceptable for a demo/assignment, but would need a paid tier or a keep-alive ping for anything with real uptime requirements.
- **Client-provided IDs trusted for the reveal-button jitter simulation** — the mouse-jitter interaction was reverse-engineered by observation (see below) rather than reading the site's actual JS, since inspecting minified bundle internals wasn't necessary once black-box testing gave a clear, reproducible signal.

## What the AI got wrong on the first attempt, and how it was corrected

**1. Assumed a simple `hover()` would be enough to enable the reveal button.** It wasn't. The button only enables after the mouse moves *continuously* inside the price block for roughly 1.5 seconds — a single stationary hover event never triggers it. This was only found by building an isolated repro script that compared a manual mouse-move loop against a plain `hover()` call side-by-side and watching which one actually flipped the `disabled` attribute.

**2. Wrote a `waitForFunction` that polled for a state change nothing was driving.** The original code polled `!button.disabled` for up to 8 seconds but never dispatched any event that could cause that state to change — so it always timed out, and the failure was silently swallowed by a `.catch(() => {})`, masking the real problem as a generic click timeout instead of a clear "button never enabled" error.

**3. Treated "left the idle CSS class" as "price has loaded."** The site has an intermediate loading interstitial after the reveal click (visible in the DOM as `<span>Loaded in N attempts</span>`) before the real terminal state (`price-success` / `price-error`) is reached. Waiting for "not idle" raced ahead into this loading state and tried to read `.price-main` before it was populated, causing `no_price_main` errors on roughly two-thirds of products. Fixed by waiting explicitly for the terminal success/error class instead.

**4. Missed the Render build-vs-runtime filesystem split for Playwright.** Chromium downloaded successfully during the build step but wasn't present when the server tried to launch it at runtime, since Render's default cache directory doesn't carry over. Fixed with `PLAYWRIGHT_BROWSERS_PATH=0`, which installs the browser into `node_modules` (part of the deployed build output) instead of the OS-level cache.

**5. Left a stale `HEADLESS=false` value assumption unresolved**, causing Chromium to attempt a headed launch on a server with no display — fixed by explicitly confirming and setting `HEADLESS=true` in the deployed environment.

**6. Initially made `/api/scrape/run` synchronous**, blocking the HTTP response until every product finished scraping — fine locally, but risky in production where proxy timeouts and the external cron service both impose their own limits. Fixed by responding immediately and running the scrape in the background.

Each of these was found the same way: build a small, isolated repro outside the main codebase, add explicit logging/observation at each step, and compare expected vs. actual state rather than guessing at a fix and re-running the whole pipeline blind.
