/**
 * Visible (headed) scraper demonstration.
 *
 * Usage:
 *   HEADLESS=false npm run scrape:headed            # scrape all active tracked products
 *   HEADLESS=false npm run scrape:headed -- --url=https://demo.inelabteamdev.com/product/537
 *
 * This intentionally reuses the exact same scrapeProduct() + retry logic
 * used in production (runScrape.js) — nothing is faked for the demo.
 */
require('dotenv').config();
const { launchBrowser } = require('../scraper/browser');
const { scrapeProductWithRetries, runScrapeForAllActiveProducts } = require('../scraper/runScrape');
const { supabase } = require('../config/supabase');

async function main() {
  process.env.HEADLESS = process.env.HEADLESS || 'false';

  const urlArg = process.argv.find((a) => a.startsWith('--url='));
  const browser = await launchBrowser();

  try {
    if (urlArg) {
      const url = urlArg.split('=')[1];
      console.log(`\n[headed] Scraping single URL: ${url}\n`);
      const fakeProduct = { id: '00000000-0000-0000-0000-000000000000', product_name: 'ad-hoc', product_url: url };
      // Skip DB writes for an ad-hoc URL that may not be a tracked_products row.
      const { scrapeProduct } = require('../scraper/scrapeProduct');
      const { newPage } = require('../scraper/browser');
      const { page, context } = await newPage(browser);
      try {
        const result = await scrapeProduct(page, fakeProduct);
        console.log('[headed] Result:', result);
      } catch (err) {
        console.error('[headed] Failed:', err.type || 'error', '-', err.message);
      } finally {
        await context.close();
        await new Promise((r) => setTimeout(r, 1500)); // pause so you can see the final state
      }
      return;
    }

    console.log('\n[headed] Scraping all active tracked products from Supabase...\n');
    const summary = await runScrapeForAllActiveProducts(browser);
    console.log('\n[headed] Run summary:', JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[headed] Fatal error:', err);
    process.exit(1);
  });
