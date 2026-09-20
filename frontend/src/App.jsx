import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api/client';
import SearchPanel from './components/SearchPanel.jsx';
import TrackedList from './components/TrackedList.jsx';
import ProductDetail from './components/ProductDetail.jsx';

export default function App() {
  const [trackedProducts, setTrackedProducts] = useState([]);
  const [loadingTracked, setLoadingTracked] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [banner, setBanner] = useState(null);

  const refreshTracked = useCallback(async () => {
    setLoadingTracked(true);
    try {
      const { results } = await api.listTrackedProducts();
      setTrackedProducts(results);
    } catch (err) {
      setBanner({ type: 'error', text: err.message });
    } finally {
      setLoadingTracked(false);
    }
  }, []);

  useEffect(() => {
    refreshTracked();
  }, [refreshTracked]);

  async function handleTrack(product) {
  try {
    await api.trackProduct({
      product_name: product.name,
      external_id: product.id,
    });

    setBanner({ type: 'success', text: `Now tracking "${product.name}"` });
    refreshTracked();
  } catch (err) {
    setBanner({ type: 'error', text: err.message });
  }
}


  if (selectedId) {
    return (
      <ProductDetail
        productId={selectedId}
        onBack={() => {
          setSelectedId(null);
          refreshTracked();
        }}
      />
    );
  }

  return (
    <div className="app">
      <h1>INE Price Tracker</h1>
      <p className="subtitle">
        Search the INE mock store, track products, and watch price &amp; stock history over time.
      </p>

      {banner && (
        <div className="card" style={{ color: banner.type === 'error' ? 'var(--danger)' : 'var(--success)' }}>
          {banner.text}
        </div>
      )}

      <SearchPanel onTrack={handleTrack} />

      <h2 style={{ fontSize: '1.1rem', marginTop: 28 }}>Tracked products</h2>
      <TrackedList
        products={trackedProducts}
        loading={loadingTracked}
        onSelect={setSelectedId}
        onRefresh={refreshTracked}
      />
    </div>
  );
}
