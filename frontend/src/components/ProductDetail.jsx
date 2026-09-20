import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api/client';

function formatPrice(p) {
  if (p === null || p === undefined) return '—';
  return `₹${Number(p).toLocaleString('en-IN')}`;
}

function statusBadgeClass(status) {
  if (status === 'success') return 'badge success';
  if (status === 'retry') return 'badge retry';
  if (status === 'failed') return 'badge failed';
  return 'badge unknown';
}

export default function ProductDetail({ productId, onBack }) {
  const [product, setProduct] = useState(null);
  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState('history');
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [p, h, l] = await Promise.all([
          api.getTrackedProduct(productId),
          api.getHistory(productId),
          api.getLogs(productId),
        ]);
        if (cancelled) return;
        setProduct(p.result);
        setHistory(h.results);
        setLogs(l.results);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const chartData = history.map((h) => ({
    time: new Date(h.scraped_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    price: Number(h.price),
  }));

  return (
    <div className="app">
      <a className="back-link" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
        ‹ Back to dashboard
      </a>

      {error && <p className="error-text">{error}</p>}

      {product && (
        <>
          <h1 style={{ marginTop: 12 }}>{product.product_name}</h1>
          <p className="subtitle">
            <a href={product.product_url} target="_blank" rel="noreferrer">
              {product.product_url}
            </a>
          </p>

          <div className="card" style={{ display: 'flex', gap: 32 }}>
            <div>
              <div className="row-meta">Current price</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{formatPrice(product.current_price)}</div>
            </div>
            <div>
              <div className="row-meta">Stock</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{product.current_stock_raw || '—'}</div>
            </div>
            <div>
              <div className="row-meta">Last scraped</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                {product.last_scraped_at ? new Date(product.last_scraped_at).toLocaleString() : 'never'}
              </div>
            </div>
          </div>

          <div className="tabs">
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
              Price / Stock History
            </button>
            <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
              Scrape Log
            </button>
          </div>

          {tab === 'history' && (
            <div className="card">
              {chartData.length === 0 ? (
                <p className="empty">No successful scrapes yet — check back after the next run.</p>
              ) : (
                <>
                  <div style={{ width: '100%', height: 260, marginBottom: 16 }}>
                    <ResponsiveContainer>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                        <Tooltip />
                        <Line type="monotone" dataKey="price" stroke="#2563eb" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Scraped at</th>
                        <th>Price</th>
                        <th>Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map((h) => (
                        <tr key={h.id}>
                          <td>{new Date(h.scraped_at).toLocaleString()}</td>
                          <td>{formatPrice(h.price)}</td>
                          <td>{h.stock_raw || h.stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {tab === 'logs' && (
            <div className="card">
              {logs.length === 0 ? (
                <p className="empty">No scrape attempts logged yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Attempt</th>
                      <th>Status</th>
                      <th>Error type</th>
                      <th>Message</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td>{new Date(l.created_at).toLocaleString()}</td>
                        <td>{l.attempt}</td>
                        <td>
                          <span className={statusBadgeClass(l.status)}>{l.status}</span>
                        </td>
                        <td>{l.error_type || '—'}</td>
                        <td style={{ maxWidth: 320 }}>{l.message || '—'}</td>
                        <td>{l.duration_ms ? `${l.duration_ms}ms` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
