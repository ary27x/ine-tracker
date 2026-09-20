const S = require('../config/selectors');

const STORE_BASE_URL = process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com';
const METADATA_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — catalog contents (names/SKUs) are
// assumed static in this demo; only price/stock change per product. Adjust
// down if that assumption turns out false.
const MAX_RESOLVE_PER_SEARCH = 20; // cap how many "View details" clicks one search triggers

let metadataCache = { items: null, fetchedAt: 0 };
let urlCache = new Map(); // sku -> resolved product_url, cleared whenever metadataCache refreshes

/**
 * Reads the "Page X of Y" status text and returns { current, total }.
 */
async function readPaginationStatus(page) {
  const text = (await page.locator(S.paginationStatus).textContent().catch(() => '')) || '';
  const match = text.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  return match ? { current: parseInt(match[1], 10), total: parseInt(match[2], 10) } : null;
}

async function readTilesOnCurrentPage(page) {
  return page.evaluate(
    ({ tileSel, nameSel, brandSel, skuSel, catSel }) => {
      return Array.from(document.querySelectorAll(tileSel)).map((tile) => ({
        name: (tile.querySelector(nameSel)?.textContent || '').trim(),
        brand: (tile.querySelector(brandSel)?.textContent || '').trim(),
        sku: (tile.querySelector(skuSel)?.textContent || '').replace(/^SKU\s+/i, '').trim(),
        category: (tile.querySelector(catSel)?.textContent || '').trim(),
      }));
    },
    { tileSel: S.tile, nameSel: S.tileName, brandSel: S.tileBrand, skuSel: S.tileSku, catSel: S.tileCategory }
  );
}

/**
 * Clicks "Next" and waits for the pagination status text to actually change,
 * rather than a fixed sleep — this is a client-rendered SPA with no URL
 * change on page turn, so waiting for navigation/URL won't work here.
 */
async function goToNextPage(page) {
  const before = (await page.locator(S.paginationStatus).textContent().catch(() => '')) || '';
  const nextButton = page.getByRole('button', { name: S.paginationNextButtonText, exact: false }).first();
  await nextButton.click();
  await page
    .waitForFunction(
      ({ sel, prev }) => {
        const el = document.querySelector(sel);
        return el && el.textContent.trim() !== prev;
      },
      { sel: S.paginationStatus, prev: before },
      { timeout: 8000 }
    )
    .catch(() => {
      /* if it times out we'll detect the stall via unchanged pagination status below */
    });
}

/**
 * Crawls every page of the catalog collecting only lightweight metadata
 * (name/brand/sku/category/page) — no clicking, so this is cheap even across
 * 50 pages. Product URLs are NOT collected here; they're resolved lazily,
 * only for products that actually match a search (see resolveProductUrl).
 */
async function crawlCatalogMetadata(page) {
  const response = await page.goto(STORE_BASE_URL, { waitUntil: 'domcontentloaded' });
  if (response && response.status() >= 400) {
    throw new Error(`Homepage returned HTTP ${response.status()}`);
  }
  await page.waitForSelector(S.tile, { timeout: 10000 });

  const items = [];
  let pageNum = 1;
  const seenPages = new Set();
  // Safety cap in case pagination status parsing fails — avoids an infinite loop.
  const HARD_PAGE_CAP = 200;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await readPaginationStatus(page);
    const currentPage = status ? status.current : pageNum;
    if (seenPages.has(currentPage)) break; // guards against a stuck Next button
    seenPages.add(currentPage);

    const tiles = await readTilesOnCurrentPage(page);
    for (const t of tiles) {
      if (t.name) items.push({ ...t, page: currentPage });
    }

    const totalPages = status ? status.total : currentPage;
    if (currentPage >= totalPages || currentPage >= HARD_PAGE_CAP) break;

    await goToNextPage(page);
    pageNum += 1;
  }

  return items;
}

async function getCatalogMetadata(page, { forceRefresh = false } = {}) {
  const isFresh = metadataCache.items && Date.now() - metadataCache.fetchedAt < METADATA_TTL_MS;
  if (isFresh && !forceRefresh) return metadataCache.items;

  const items = await crawlCatalogMetadata(page);
  metadataCache = { items, fetchedAt: Date.now() };
  urlCache = new Map(); // stale once the underlying metadata changes
  return items;
}

/**
 * Navigates to the given catalog page number, either by trying a direct
 * `?page=N` URL first (cheap, if the SPA supports it) or, if that doesn't
 * land on the right page, by clicking "Next" from page 1 the required number
 * of times (slower but always correct).
 */
async function navigateToPage(page, targetPage) {
  if (targetPage === 1) {
    await page.goto(STORE_BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(S.tile, { timeout: 10000 });
    return;
  }

  const direct = await page
    .goto(`${STORE_BASE_URL}/?page=${targetPage}`, { waitUntil: 'domcontentloaded' })
    .catch(() => null);
  if (direct) {
    await page.waitForSelector(S.tile, { timeout: 10000 }).catch(() => {});
    const status = await readPaginationStatus(page);
    if (status && status.current === targetPage) return; // direct navigation worked
  }

  // Fall back: start at page 1 and click Next repeatedly.
  await page.goto(STORE_BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(S.tile, { timeout: 10000 });
  let current = 1;
  while (current < targetPage) {
    await goToNextPage(page);
    current += 1;
  }
}

/**
 * Resolves ONE product's real URL by navigating to its known page and
 * clicking its "View details" button (there is no href to read directly).
 */
async function resolveProductUrl(page, tileMeta) {
  if (urlCache.has(tileMeta.sku)) return urlCache.get(tileMeta.sku);

  await navigateToPage(page, tileMeta.page);

  const tiles = page.locator(S.tile);
  const count = await tiles.count();
  for (let i = 0; i < count; i += 1) {
    const t = tiles.nth(i);
    const skuText = ((await t.locator(S.tileSku).textContent().catch(() => '')) || '')
      .replace(/^SKU\s+/i, '')
      .trim();
    if (skuText === tileMeta.sku) {
      await t.locator(S.tileCta).click();
      await page.waitForSelector('.detail-card', { timeout: 10000 });
      const url = page.url();
      urlCache.set(tileMeta.sku, url);
      return url;
    }
  }

  throw new Error(`Could not find tile with SKU "${tileMeta.sku}" on page ${tileMeta.page} to resolve its URL`);
}

/**
 * Public search entry point: filters cached metadata by substring match,
 * then resolves real product URLs only for the (capped) set of results
 * actually returned to the caller.
 */
async function searchCatalog(page, query) {
  const metadata = await getCatalogMetadata(page);
  const q = query.trim().toLowerCase();
  const matches = q ? metadata.filter((p) => p.name.toLowerCase().includes(q)) : metadata;
  const capped = matches.slice(0, MAX_RESOLVE_PER_SEARCH);

  const results = [];
  for (const m of capped) {
    try {
      const productUrl = await resolveProductUrl(page, m);
      results.push({
        name: m.name,
        brand: m.brand,
        sku: m.sku,
        category: m.category,
        productUrl,
        externalId: (productUrl.match(/\/product\/([^/?#]+)/) || [])[1] || null,
      });
    } catch (err) {
      // One product's failed resolution shouldn't break the rest of the results.
      // eslint-disable-next-line no-console
      console.error(`[catalog] Failed to resolve URL for SKU ${m.sku}:`, err.message);
    }
  }

  return { results, totalMatches: matches.length, cappedTo: capped.length };
}

module.exports = { getCatalogMetadata, searchCatalog, resolveProductUrl, STORE_BASE_URL };
