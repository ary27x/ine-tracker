const S = require('../config/selectors');

/**
 * Typed error so the retry orchestrator (runScrape.js) can log a meaningful
 * error_type without string-matching messages.
 */
class ScrapeError extends Error {
  constructor(type, message) {
    super(message);
    this.name = 'ScrapeError';
    this.type = type; // 'timeout' | 'network' | 'http_429' | 'http_5xx' | 'selector_missing'
    // | 'invalid_price' | 'invalid_stock' | 'playwright_error'
  }
}

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const CURRENCY_RE = /[₹$€£]\s?[\d][\d,.\s]*\d|\b\d[\d,]*\.\d{2}\b/; // loose "looks like a price" check

/**
 * The detail page renders several currency-looking strings:
 *  - a hidden (display:none / aria-hidden) decoy at .price-main > .price-value
 *  - a hidden decoy with [data-price="true"] (classic scraper honeypot)
 *  - the "was" price, visible but struck through (text-decoration: line-through)
 *  - the REAL current price, visible, no strikethrough — but its text is split
 *    across individual <span> characters interleaved with zero-width spaces,
 *    to defeat naive innerText scraping.
 *
 * We identify the real price structurally (visible + not struck-through +
 * matches a currency pattern once zero-width characters are stripped),
 * rather than by class name, because the classes on these elements look
 * randomized per page load (e.g. "pw-k2", "vim8fup").
 */
async function extractPrice(page) {
  return page.evaluate(
    ({ priceMainSel, zwRe }) => {
      const main = document.querySelector(priceMainSel);
      if (!main) return { error: 'no_price_main' };

      const stripZeroWidth = (s) => s.replace(new RegExp(zwRe, 'gu'), '');

      const candidates = Array.from(main.children);
      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (el.getAttribute('aria-hidden') === 'true') continue;
        if (el.hasAttribute('data-price')) continue; // known honeypot pattern
        if (
          style.textDecorationLine &&
          style.textDecorationLine.includes('line-through')
        ) {
          continue; // this is the "was" / original price, not current
        }
        const text = stripZeroWidth(el.textContent || '').trim();
        if (!text) continue;
        // must contain at least one digit to be a real candidate
        if (!/\d/.test(text)) continue;
        return { text };
      }
      return { error: 'not_found' };
    },
    { priceMainSel: S.priceMain, zwRe: ZERO_WIDTH_RE.source }
  );
}

function parsePriceText(text) {
  if (!text) return null;
  const cleaned = text.replace(ZERO_WIDTH_RE, '').replace(/[^\d.,]/g, '');
  // Handle "10,297.50" style — strip thousands separators, keep last dot as decimal
  const normalized = cleaned.replace(/,/g, '');
  const value = parseFloat(normalized);
  if (Number.isNaN(value) || value <= 0) return null;
  return value;
}

function normalizeStock(rawText, classList) {
  const cls = (classList || []).join(' ').toLowerCase();
  const text = (rawText || '').toLowerCase();
  if (cls.includes('out-stock') || text.includes('out of stock')) return 'out_of_stock';
  if (cls.includes('low-stock') || text.includes('low stock') || text.includes('only'))
    return 'low_stock';
  if (cls.includes('in-stock') || text.includes('in stock') || text.includes('available'))
    return 'in_stock';
  return 'unknown';
}

/**
 * A cookie-consent overlay (`.cookie-overlay > .cookie-banner`, a real
 * role="dialog"/aria-modal="true" modal) renders a couple seconds after the
 * detail page loads and locks body scroll. It sits on top of the reveal-price
 * button and intercepts clicks on it, which is what was causing
 * `button.click()` to time out and every attempt to fail identically across
 * all 3 retries.
 *
 * Unlike the price block, this part of the markup does NOT use randomized
 * classnames — `.cookie-overlay`, `.cookie-banner`, and the accept button's
 * `aria-label="Accept cookies"` are stable, so we can select it directly
 * instead of scanning structurally. If selectors.js defines S.cookieAccept,
 * that takes precedence (in case the markup differs across environments).
 *
 * Returns true if the banner was found and dismissed, false otherwise (not
 * an error — some loads may not show it, or it may already be dismissed).
 */
async function dismissCookieBanner(page, { timeout = 4000 } = {}) {
  const acceptSel = S.cookieAccept || 'button[aria-label="Accept cookies"]';

  const button = page.locator(acceptSel).first();
  const appeared = await button
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;

  try {
    await button.click({ timeout: 3000 });
    // Give the overlay a moment to actually unmount before we act on
    // whatever's underneath it.
    await page.locator(S.cookieOverlay || '.cookie-overlay').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Injected via page.addInitScript() so it runs before the page's own scripts
 * on every navigation. Watches the DOM and clicks the cookie-accept button
 * the instant it appears, whenever that happens to be — this replaces
 * relying on a fixed polling window (which was missing the banner on
 * attempts where it rendered later than expected).
 */
const COOKIE_AUTO_DISMISS_SCRIPT = `
  (function () {
    var ACCEPT_SEL = 'button[aria-label="Accept cookies"]';
    var tryDismiss = function () {
      var btn = document.querySelector(ACCEPT_SEL);
      if (btn && !btn.disabled) btn.click();
    };
    tryDismiss(); // in case it's already there by the time this runs
    var observer = new MutationObserver(tryDismiss);
    var attach = function () {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });
  })();
`;

/**
 * scrapeProduct — ONE attempt at scraping ONE product. Throws ScrapeError on
 * any failure. The caller (runScrape.js) is responsible for retries, backoff,
 * and logging each attempt.
 *
 * @param {import('playwright').Page} page
 * @param {{ product_url: string }} product
 * @returns {Promise<{ price: number, stock: string, stockRaw: string }>}
 */


async function scrapeProduct(page, product) {
  // Install once per page instance — addInitScript re-runs the script on
  // every subsequent navigation of this page, so it doesn't need to be
  // re-added per product/attempt if the same page is reused across the run.
  if (!page.__cookieAutoDismissInstalled) {
    await page.addInitScript(COOKIE_AUTO_DISMISS_SCRIPT);
    page.__cookieAutoDismissInstalled = true;
  }

  const productUrl = new URL(
  product.product_url,
  'https://demo.inelabteamdev.com'
).toString();
  let response;
  try {
    response = await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    if (/timeout/i.test(err.message)) {
      throw new ScrapeError('timeout', `Navigation timeout: ${err.message}`);
    }
    throw new ScrapeError('network', `Navigation failed: ${err.message}`);
  }

  if (response) {
    const status = response.status();
    if (status === 429) {
      throw new ScrapeError('http_429', `Rate limited (429) loading ${product.product_url}`);
    }
    if (status >= 500 && status < 600) {
      throw new ScrapeError('http_5xx', `Server error (${status}) loading ${product.product_url}`);
    }
    if (status === 404) {
      throw new ScrapeError('selector_missing', `Product not found (404): ${product.product_url}`);
    }
  }

  // Confirm the SPA actually rendered the product (not a blank/error shell)
  try {
    await page.waitForSelector(S.detailCard, { timeout: 10000 });
  } catch {
    throw new ScrapeError(
      'selector_missing',
      `Detail card (${S.detailCard}) did not appear — page structure may have changed or product missing`
    );
  }

  // Clear the cookie-consent overlay now, before it has a chance to sit on
  // top of the reveal-price button and intercept the click below.
  await dismissCookieBanner(page, { timeout: 4000 });

  // Price is hidden behind a "Reveal price" interaction. If the price block
  // is already in a success/error state (e.g. cached), skip the click.
  const initialState = await page
    .locator(S.priceBlock)
    .first()
    .getAttribute('class')
    .catch(() => '');

  if (initialState && initialState.includes(S.priceBlockIdleClass))
  {
        const button = page.locator(S.revealButton).first();
    const priceBlock = page.locator(S.priceBlock).first();

    try {
      console.log('[scrapeProduct] waiting for button visible...');
      await button.waitFor({ state: 'visible', timeout: 8000 });
      console.log('[scrapeProduct] button visible');

      const box = await priceBlock.boundingBox();
      console.log('[scrapeProduct] box:', box);
      if (!box) {
        throw new Error('Could not get bounding box for price block');
      }

      console.log('[scrapeProduct] starting jitter loop...');
      const jitterStart = Date.now();
      const jitterTimeout = 6000;
      let enabled = false;
      let i = 0;

      while (Date.now() - jitterStart < jitterTimeout) {
        const x = box.x + 10 + (i % 20);
        const y = box.y + 10 + ((i * 3) % Math.min(15, box.height - 10));
        await page.mouse.move(x, y, { steps: 3 });
        await page.waitForTimeout(100);
        i++;

        const disabledAttr = await button.getAttribute('disabled').catch(() => 'unknown');
        if (disabledAttr === null) {
          enabled = true;
          break;
        }
      }
      console.log('[scrapeProduct] jitter loop done, enabled:', enabled);

      if (!enabled) {
        throw new Error('Reveal-price button never became enabled after simulated hover');
      }

      try {
        console.log('[scrapeProduct] clicking button...');
        await button.click({ timeout: 5000 });
        console.log('[scrapeProduct] click succeeded');
      } catch (clickErr) {
        console.log('[scrapeProduct] click failed, trying cookie dismiss + retry:', clickErr.message);
        const dismissed = await dismissCookieBanner(page, { timeout: 2000 });
        if (!dismissed) throw clickErr;
        await button.click({ timeout: 5000 });
        console.log('[scrapeProduct] click succeeded on retry');
      }
    } catch (err) {
      console.log('[scrapeProduct] reveal-button block failed:', err.message);
      throw new ScrapeError(
        'selector_missing',
        `Could not click reveal-price button: ${err.message}`
      );
    }
  }
  // Wait for the price block to reach a TERMINAL state (success or error) —
  // not just "left idle", since the site shows an intermediate loading
  // interstitial after reveal (confirmed: "Loaded in N attempts" in the
  // markup) before price-main actually populates. Treating "not idle" as
  // done was racing us into reading the DOM mid-loading, which is why
  // extractPrice kept failing with no_price_main.
  try {
    await page.waitForFunction(
      ({ sel, successClass, errorClass }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        return el.className.includes(successClass) || el.className.includes(errorClass);
      },
      { sel: S.priceBlock, successClass: S.priceBlockSuccessClass, errorClass: S.priceBlockErrorClass },
      { timeout: 20000 } // bumped from 15s — site can do multiple internal load attempts
    );
  } catch {
    throw new ScrapeError('timeout', 'Price never reached a success/error state within 20s');
  }

  const finalClass = await page
    .locator(S.priceBlock)
    .first()
    .getAttribute('class')
    .catch(() => '');

  if (finalClass && finalClass.includes(S.priceBlockErrorClass)) {
    throw new ScrapeError('invalid_price', 'Site reported a price-load error');
  }

  const priceResult = await extractPrice(page);
  if (priceResult.error) {
    throw new ScrapeError(
      'invalid_price',
      `Could not locate a valid, non-decoy price on the page (${priceResult.error})`
    );
  }

  const price = parsePriceText(priceResult.text);
  if (price === null) {
    throw new ScrapeError('invalid_price', `Extracted text did not parse as a valid price: "${priceResult.text}"`);
  }

  // Stock badge
  const stockHandle = page.locator(S.stockBadge).first();
  const stockExists = await stockHandle.count().then((c) => c > 0).catch(() => false);
  if (!stockExists) {
    throw new ScrapeError('invalid_stock', `Stock badge (${S.stockBadge}) not found`);
  }
  const stockRaw = (await stockHandle.textContent().catch(() => '')) || '';
  const stockClassAttr = (await stockHandle.getAttribute('class').catch(() => '')) || '';
  const stock = normalizeStock(stockRaw, stockClassAttr.split(/\s+/));

  return { price, stock, stockRaw: stockRaw.trim() };
}

module.exports = { scrapeProduct, ScrapeError, parsePriceText, normalizeStock };