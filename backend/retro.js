// retro.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const page = await browser.newPage();

  page.on('console', msg => console.log('[browser]', msg.text()));

  await page.goto('https://demo.inelabteamdev.com/product/537', { waitUntil: 'domcontentloaded' });

  const accept = page.locator('button[aria-label="Accept cookies"]').first();
  if (await accept.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) {
    await accept.click();
    console.log('--- cookie banner dismissed ---');
  }

  const priceBlock = page.locator('.price-block').first();
  const button = priceBlock.locator('button').first();
  await priceBlock.waitFor({ state: 'visible' });

  const box = await priceBlock.boundingBox();
  console.log('box:', box);

  console.log('--- jittering mouse inside price-block for 6s ---');
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < 6000) {
    const x = box.x + 10 + (i % 20);       // small back-and-forth motion
    const y = box.y + 10 + ((i * 3) % 15);
    await page.mouse.move(x, y, { steps: 3 });
    await page.waitForTimeout(100);
    i++;

    const disabledAttr = await button.getAttribute('disabled').catch(() => 'ERR');
    if (disabledAttr === null) {
      console.log(`--- ENABLED after ${Date.now() - start}ms ---`);
      break;
    }
  }

  const finalDisabled = await button.getAttribute('disabled');
  console.log('final disabled attr:', JSON.stringify(finalDisabled));

  try {
    await button.click({ timeout: 5000 });
    console.log('--- click succeeded ---');
    await page.waitForTimeout(2000);
    console.log('price-block innerText:', await priceBlock.evaluate(el => el.innerText));
  } catch (err) {
    console.log('--- click FAILED:', err.message);
  }

  await page.waitForTimeout(10000);
  await browser.close();
})();