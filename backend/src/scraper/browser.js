const { chromium } = require('playwright');

/**
 * Launches a single Chromium instance. Reused across all products in one
 * scrape run (much cheaper than a fresh browser per product), with a fresh
 * browser context per product so cookies/localStorage/session state never
 * leak between products.
 */
async function launchBrowser() {
  const headless = process.env.HEADLESS !== 'false'; // default true (production)
  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 150, // slow down visibly in headed demo mode
  });
  return browser;
}

async function newPage(browser) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 INE-Tracker-Bot/1.0',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  // Reasonable default timeouts; individual calls can override.
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  return { context, page };
}

module.exports = { launchBrowser, newPage };
