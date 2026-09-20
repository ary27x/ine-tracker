import React, { useState } from 'react';
import { api } from '../api/client';

export default function SearchPanel({ onTrack }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { results } = await api.searchProducts(query);
      setResults(results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <form className="search-row" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search products…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {results && results.length === 0 && <p className="empty">No products matched "{query}".</p>}

      {results && results.length > 0 && (
        <div className="list">
          {results.map((p) => (
            <div className="row" key={p.productUrl}>
              <div className="row-main">
                <span className="row-name">{p.name}</span>
                <span className="row-meta">
                  {[p.brand, p.category].filter(Boolean).join(' · ')}
                  {p.brand || p.category ? ' — ' : ''}
                  {p.productUrl}
                </span>
              </div>
              <button onClick={() => onTrack(p)}>Track</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
