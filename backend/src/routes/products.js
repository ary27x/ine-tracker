const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Load catalogue once when the server starts
const cataloguePath = path.join(
  __dirname,
  '..',
  'data',
  'all_catalogue.json'
);

const catalogue = JSON.parse(
  fs.readFileSync(cataloguePath, 'utf-8')
);

// GET /api/products/search?q=partial+name
router.get('/search', (req, res) => {
  const q = (req.query.q || '').toString().trim();

  if (!q) {
    return res.status(400).json({
      error: 'Query parameter "q" is required'
    });
  }

  const query = q.toLowerCase();

  const results = catalogue.filter((product) => {
    return product.name.toLowerCase().includes(query);
  });

  res.json({
    query: q,
    count: results.length,
    results
  });
});

module.exports = router;