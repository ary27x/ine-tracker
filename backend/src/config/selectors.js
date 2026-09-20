/**
 * Centralized selectors for demo.inelabteamdev.com.
 *
 * Based on live DOM inspection of a product page (/product/537), NOT guessed.
 * See README "Scraper reliability approach" for the full writeup.
 *
 * Key finding: the site deliberately obfuscates the price. Several elements
 * on the page contain currency-looking text, but only ONE is the real,
 * currently-displayed price — the rest are decoys/honeypots or the
 * strikethrough "original" price. See extractPrice() in scrapeProduct.js for
 * how we pick the right one (by computed style, not by class name, since the
 * class names appear to be randomized/salted per page load, e.g. "pw-k2",
 * "vim8fup").
 */
module.exports = {
  // Product detail page
  detailCard: '.detail-card',
  productTitle: '.detail-info h1',

  priceBlock: '.price-block',
  priceBlockIdleClass: 'price-idle', // shown before the user reveals the price
  priceBlockSuccessClass: 'price-success',
  priceBlockErrorClass: 'price-error', // best-effort guess at the failure-state class name;
  // extractPrice() does not depend on this being exactly right — it also treats
  // "no valid, non-decoy price found after the reveal settles" as an error.

  revealButton: '.price-block button', // "Reveal price" — only one button exists before reveal
  priceMain: '.price-main', // container we scan for the real price among decoys
  stockBadge: '.stock-badge', // e.g. <span class="stock-badge out-stock">Out of stock</span>

  // Homepage / catalog — confirmed from live DOM (1000 products, 20/page,
  // Page 1 of 50, Prev/Next pagination). Listing cards are <article class="tile">
  // with NO href on them or their "View details" control — it's a <button>,
  // not an <a>. So there is no href to scrape structurally here; the only way
  // to get a product's real URL is to click its "View details" button and
  // read the resulting page URL (see catalog.js resolveProductUrl()).
  tile: 'article.tile',
  tileName: '.tile-name',
  tileBrand: '.tile-brand',
  tileSku: '.tile-sku',
  tileCategory: '.tile-category',
  tileCta: '.tile-cta', // "View details →" button, not a link

  paginationStatus: '.pagination-status', // e.g. "Page 1 of 50"
  // Prev/Next are both `class="btn btn-ghost"` with no distinguishing class —
  // identified by their text content instead.
  paginationNextButtonText: 'Next',
};
