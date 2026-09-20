-- INE Price Tracker — Supabase / PostgreSQL schema
-- Run this in the Supabase SQL editor (or via `psql`) before starting the backend.

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- tracked_products
-- One row per product the user chose to track from search results.
-- ---------------------------------------------------------------------------
create table if not exists tracked_products (
  id                uuid primary key default gen_random_uuid(),
  product_name      text not null,
  product_url       text not null unique,       -- e.g. https://demo.inelabteamdev.com/product/537
  external_id       text,                        -- the numeric/slug id from the URL, kept for convenience
  is_active         boolean not null default true,  -- false = paused, excluded from /api/scrape/run
  current_price     numeric(12, 2),              -- null until first successful scrape
  current_stock     text,                        -- normalized: 'in_stock' | 'out_of_stock' | 'low_stock' | 'unknown'
  current_stock_raw text,                        -- raw badge text as shown on the site, for display
  last_scraped_at   timestamptz,
  last_scrape_status text,                       -- 'success' | 'failed' — mirrors the most recent run outcome
  created_at        timestamptz not null default now()
);

create index if not exists idx_tracked_products_active on tracked_products (is_active);

-- ---------------------------------------------------------------------------
-- price_history
-- Only successful, validated scrapes are inserted here. Never write nulls or
-- placeholder values on failure — a gap in history IS the signal that a scrape failed.
-- ---------------------------------------------------------------------------
create table if not exists price_history (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references tracked_products (id) on delete cascade,
  price       numeric(12, 2) not null,
  stock       text not null,          -- normalized status, same vocabulary as current_stock
  stock_raw   text,                   -- raw badge text at time of scrape
  scraped_at  timestamptz not null default now()
);

create index if not exists idx_price_history_product_time
  on price_history (product_id, scraped_at desc);

-- ---------------------------------------------------------------------------
-- scrape_logs
-- One row per ATTEMPT (not per run) — a single scrape of one product can
-- produce several rows (attempt 1 failed, attempt 2 failed, attempt 3 succeeded).
-- ---------------------------------------------------------------------------
create table if not exists scrape_logs (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references tracked_products (id) on delete cascade,
  run_id       uuid not null,          -- shared by every product scraped in one /api/scrape/run invocation
  attempt      int not null,           -- 1, 2, 3 ...
  status       text not null,          -- 'success' | 'retry' | 'failed'
  error_type   text,                   -- 'timeout' | 'network' | 'http_429' | 'http_5xx' | 'selector_missing'
                                        -- | 'invalid_price' | 'invalid_stock' | 'playwright_error' | null
  message      text,                   -- human-readable detail, e.g. the caught error message
  duration_ms  int,                    -- how long this attempt took
  created_at   timestamptz not null default now()
);

create index if not exists idx_scrape_logs_product_time
  on scrape_logs (product_id, created_at desc);
create index if not exists idx_scrape_logs_run on scrape_logs (run_id);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- No RLS policies are defined here because the assignment has no auth and the
-- backend talks to Supabase using the SERVICE ROLE key from the server only
-- (never exposed to the browser). If you later add auth, enable RLS and add
-- policies before using the anon key from the frontend.
