const crypto = require('crypto');
const { newPage } = require('./browser');
const { scrapeProduct, ScrapeError } = require('./scrapeProduct');
const { supabase } = require('../config/supabase');

const MAX_ATTEMPTS = parseInt(process.env.MAX_SCRAPE_ATTEMPTS || '3', 10);
const BASE_DELAY_MS = parseInt(process.env.SCRAPE_BASE_DELAY_MS || '1000', 10);

function backoffDelay(attempt, errorType) {
  // Exponential backoff with jitter: 1s, 2s, 4s, ... capped at 15s.
  const exp = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), 15000);
  const jitter = Math.random() * 300;
  // Be extra polite after a 429 — wait longer than a plain retry would.
  const rateLimitPenalty = errorType === 'http_429' ? exp : 0;
  return exp + jitter + rateLimitPenalty;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logAttempt({ productId, runId, attempt, status, errorType, message, durationMs }) {
  const { error } = await supabase.from('scrape_logs').insert({
    product_id: productId,
    run_id: runId,
    attempt,
    status,
    error_type: errorType || null,
    message: message || null,
    duration_ms: durationMs,
  });
  if (error) {
    // Logging failures should never crash the scrape run — just surface to stdout.
    // eslint-disable-next-line no-console
    console.error('[runScrape] Failed to write scrape_logs row:', error.message);
  }
}

/**
 * Scrapes ONE product with bounded retries + exponential backoff. Every
 * attempt (success, retry, or terminal failure) is logged. On success,
 * price_history is inserted and tracked_products is updated. On total
 * failure, ONLY scrape_logs is written — price_history and tracked_products
 * are left untouched (never store fake/null prices).
 */
async function scrapeProductWithRetries({ browser, product, runId }) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    let context;
    try {
      console.log(`[runScrape] attempt ${attempt} starting for product ${product.id}`);

      const created = await newPage(browser);
      context = created.context;
console.log('[runScrape] page created, calling scrapeProduct...');
      const result = await scrapeProduct(created.page, product);
      console.log('[runScrape] scrapeProduct returned:', result);
      const durationMs = Date.now() - startedAt;

      await logAttempt({
        productId: product.id,
        runId,
        attempt,
        status: 'success',
        durationMs,
      });

      const nowIso = new Date().toISOString();

      const { error: historyError } = await supabase.from('price_history').insert({
        product_id: product.id,
        price: result.price,
        stock: result.stock,
        stock_raw: result.stockRaw,
        scraped_at: nowIso,
      });
      if (historyError) throw new Error(`price_history insert failed: ${historyError.message}`);

      const { error: updateError } = await supabase
        .from('tracked_products')
        .update({
          current_price: result.price,
          current_stock: result.stock,
          current_stock_raw: result.stockRaw,
          last_scraped_at: nowIso,
          last_scrape_status: 'success',
        })
        .eq('id', product.id);
      if (updateError) throw new Error(`tracked_products update failed: ${updateError.message}`);

      return { success: true, attempts: attempt, result };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const isScrapeError = err instanceof ScrapeError;
      const errorType = isScrapeError ? err.type : 'playwright_error';
      const isLastAttempt = attempt === MAX_ATTEMPTS;

      await logAttempt({
        productId: product.id,
        runId,
        attempt,
        status: isLastAttempt ? 'failed' : 'retry',
        errorType,
        message: err.message,
        durationMs,
      });

      lastError = err;

      if (!isLastAttempt) {
        await sleep(backoffDelay(attempt, errorType));
      }
    } finally {
        console.log('[runScrape] closing context...');

      if (context) await context.close().catch(() => {});
        console.log('[runScrape] context closed');

    }
  }

  return { success: false, attempts: MAX_ATTEMPTS, error: lastError };
}

/**
 * Runs the scraper for every active tracked product. A failure on one
 * product never stops the others — each is fully isolated in its own
 * try/catch and its own browser context.
 */
async function runScrapeForAllActiveProducts(browser) {
  const runId = crypto.randomUUID();

  const { data: products, error } = await supabase
    .from('tracked_products')
    .select('id, product_name, product_url')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to load active tracked products: ${error.message}`);

  const summary = { runId, total: products.length, succeeded: 0, failed: 0, results: [] };

  for (const product of products) {
    try {
      const outcome = await scrapeProductWithRetries({ browser, product, runId });
      if (outcome.success) summary.succeeded += 1;
      else summary.failed += 1;
      summary.results.push({
        productId: product.id,
        productName: product.product_name,
        success: outcome.success,
        attempts: outcome.attempts,
        error: outcome.success ? null : outcome.error && outcome.error.message,
      });
    } catch (err) {
      // Should be unreachable (scrapeProductWithRetries catches internally),
      // but guarantees one product's unexpected crash never kills the run.
      summary.failed += 1;
      summary.results.push({
        productId: product.id,
        productName: product.product_name,
        success: false,
        attempts: 0,
        error: err.message,
      });
    }
  }

  return summary;
}

module.exports = { scrapeProductWithRetries, runScrapeForAllActiveProducts };
