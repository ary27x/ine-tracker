const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return body;
}

export const api = {
  searchProducts: (q) => request(`/api/products/search?q=${encodeURIComponent(q)}`),
  listTrackedProducts: () => request('/api/tracked-products'),
  trackProduct: (product) =>
    request('/api/tracked-products', {
      method: 'POST',
      body: JSON.stringify(product),
    }),
  getTrackedProduct: (id) => request(`/api/tracked-products/${id}`),
  getHistory: (id) => request(`/api/tracked-products/${id}/history`),
  getLogs: (id) => request(`/api/tracked-products/${id}/logs`),
};
