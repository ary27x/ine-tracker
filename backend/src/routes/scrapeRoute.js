const express = require('express');
const { launchBrowser } = require('../scraper/browser');
const { runScrapeForAllActiveProducts } = require('../scraper/runScrape');

const router = express.Router();

function requireCronSecret(req, res, next) {
  const provided = req.get('x-cron-secret') || req.query.secret;
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET not configured on server' });
  }
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/scrape/run
// Called by cron-job.org every 2 hours. Auth via header: X-Cron-Secret: <CRON_SECRET>
router.post('/run', requireCronSecret, async (_req, res) => {
  let browser;
  try {
    browser = await launchBrowser();
    const summary = await runScrapeForAllActiveProducts(browser);
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

module.exports = router;
