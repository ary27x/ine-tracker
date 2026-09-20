import React from 'react';

function formatPrice(p) {
  if (p === null || p === undefined) return '—';
  return `₹${Number(p).toLocaleString('en-IN')}`;
}

function formatTime(t) {
  if (!t) return 'never';
  return new Date(t).toLocaleString();
}

export default function TrackedList({ products, loading, onSelect, onRefresh }) {
  if (loading) return <p className="empty">Loading…</p>;
  if (!products.length) {
    return <p className="empty">No products tracked yet — search above and hit Track.</p>;
  }

  return (
    <div className="list">
      {products.map((p) => (
        <div className="row" key={p.id}>
          <div className="row-main">
            <span className="row-name">{p.product_name}</span>
            <span className="row-meta">
              {formatPrice(p.current_price)} · {p.current_stock_raw || 'stock unknown'} · last scraped{' '}
              {formatTime(p.last_scraped_at)}
              {p.last_scrape_status === 'failed' && (
                <span className="badge failed" style={{ marginLeft: 8 }}>
                  last run failed
                </span>
              )}
            </span>
          </div>
          <button className="secondary" onClick={() => onSelect(p.id)}>
            View Details
          </button>
        </div>
      ))}
    </div>
  );
}
