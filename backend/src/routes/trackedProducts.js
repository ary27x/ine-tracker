const express = require('express');
const { supabase } = require('../config/supabase');

const router = express.Router();

// GET /api/tracked-products
router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('tracked_products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ results: data });
});

// POST /api/tracked-products  { product_name, product_url, external_id? }

// POST /api/tracked-products  { product_name, product_url, external_id? }

router.post('/', async (req, res) => {
  console.log('TRACK REQUEST:', req.body);

  const { product_name, external_id } = req.body || {};

  if (!product_name || !external_id) {
    return res.status(400).json({
      error: 'product_name and external_id are required'
    });
  }

  const product_url = `/product/${external_id}`;

  const { data, error } = await supabase
    .from('tracked_products')
    .insert({
      product_name,
      product_url,
      external_id
    })
    .select()
    .single();

  if (error) {
    // Unique violation on product_url -> already tracked
    if (error.code === '23505') {
      const existing = await supabase
        .from('tracked_products')
        .select('*')
        .eq('product_url', product_url)
        .single();

      return res.status(200).json({
        result: existing.data,
        note: 'already tracked'
      });
    }

    return res.status(500).json({
      error: error.message
    });
  }

  res.status(201).json({
    result: data
  });
});

// GET /api/tracked-products/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('tracked_products')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Not found' });
  res.json({ result: data });
});

// GET /api/tracked-products/:id/history
router.get('/:id/history', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .eq('product_id', req.params.id)
    .order('scraped_at', { ascending: true })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ results: data });
});

// GET /api/tracked-products/:id/logs
router.get('/:id/logs', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const { data, error } = await supabase
    .from('scrape_logs')
    .select('*')
    .eq('product_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ results: data });
});

module.exports = router;
