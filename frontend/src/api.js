export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function request(path) {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Erro ${res.status} ao buscar ${path}`);
  }
  return res.json();
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, value);
  });
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export async function loginWithGoogle(idToken) {
  const res = await fetch(`${API_URL}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON (ex: erro de infraestrutura) — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao autenticar.`);
    error.status = res.status;
    throw error;
  }

  return body;
}

export async function getMyStore(idToken) {
  const res = await fetch(`${API_URL}/stores/me`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  // 404 here means "usuário ainda não configurou a loja" — um estado válido,
  // não um erro. Só lança pra qualquer outra falha (401, 500, etc).
  if (res.status === 404) {
    return { store: null };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON (ex: erro de infraestrutura) — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao buscar loja.`);
    error.status = res.status;
    throw error;
  }

  return { store: body };
}

export async function createStore(idToken, data) {
  const res = await fetch(`${API_URL}/stores`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON (ex: erro de infraestrutura) — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao criar loja.`);
    error.status = res.status;
    throw error;
  }

  return body;
}

export async function updateStore(idToken, data) {
  const res = await fetch(`${API_URL}/stores/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON (ex: erro de infraestrutura) — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao atualizar loja.`);
    error.status = res.status;
    // Presente só no 409 de conflito de contato (whatsapp/discord/telegram) —
    // diz qual campo específico colidiu, pra quem chamou destacar o input
    // certo em vez de um erro genérico. Ausente no 409 de slug já em uso.
    if (body?.field) error.field = body.field;
    throw error;
  }

  return body;
}

export async function getStoreBySlug(slug) {
  const res = await fetch(`${API_URL}/stores/${encodeURIComponent(slug)}`);

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao buscar loja.`);
    error.status = res.status;
    throw error;
  }

  return body;
}

// GET /store-pokemon-options/pokemon/:wikiPageId/extra-moves-cap — used to
// drive the Extra Moves numeric input's max, recomputed per species as soon
// as a Pokémon is picked (see AddPokemonListing.jsx).
export async function getExtraMovesCap(wikiPageId) {
  return request(`/store-pokemon-options/pokemon/${wikiPageId}/extra-moves-cap`);
}

export async function createStorePokemon(idToken, data) {
  const res = await fetch(`${API_URL}/stores/me/pokemon`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao anunciar Pokémon.`);
    error.status = res.status;
    throw error;
  }

  return body;
}

// GET /store-item-options/:wikiPageId/template — resolves which form fields
// to render for a picked item (never derived client-side from
// category/extractedFields, see AddItemListing.jsx).
export async function getItemTemplate(wikiPageId) {
  return request(`/store-item-options/${wikiPageId}/template`);
}

export async function createStoreItem(idToken, data) {
  const res = await fetch(`${API_URL}/stores/me/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao anunciar item.`);
    error.status = res.status;
    throw error;
  }

  return body;
}

export async function updateStorePokemon(idToken, id, data) {
  const res = await fetch(`${API_URL}/stores/me/pokemon/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao atualizar Pokémon.`);
    error.status = res.status;
    throw error;
  }

  return body;
}

export async function deleteStorePokemon(idToken, id) {
  const res = await fetch(`${API_URL}/stores/me/pokemon/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // resposta sem corpo JSON — segue sem body
    }
    const error = new Error(body?.error || `Erro ${res.status} ao excluir Pokémon.`);
    error.status = res.status;
    throw error;
  }
}

export async function updateStoreItem(idToken, id, data) {
  const res = await fetch(`${API_URL}/stores/me/items/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem corpo JSON — segue sem body
  }

  if (!res.ok) {
    const error = new Error(body?.error || `Erro ${res.status} ao atualizar item.`);
    error.status = res.status;
    throw error;
  }

  return body;
}

export async function deleteStoreItem(idToken, id) {
  const res = await fetch(`${API_URL}/stores/me/items/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // resposta sem corpo JSON — segue sem body
    }
    const error = new Error(body?.error || `Erro ${res.status} ao excluir item.`);
    error.status = res.status;
    throw error;
  }
}

// Store Analytics (2026-07-21) — 2 public fire-and-forget tracking pings +
// 1 owner-only aggregate read. `recordStoreVisit`/`recordListingView` never
// throw for the caller to worry about beyond a plain rejected promise —
// callers always attach `.catch(() => {})`, a failed ping (network hiccup,
// backend asleep) should never surface to a visitor.
export async function recordStoreVisit(slug) {
  await fetch(`${API_URL}/stores/${encodeURIComponent(slug)}/visit`, { method: 'POST' });
}

export async function recordListingView(slug, { kind, listingId }) {
  await fetch(`${API_URL}/stores/${encodeURIComponent(slug)}/listing-view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, listingId }),
  });
}

export async function getStoreAnalytics(idToken) {
  const res = await fetch(`${API_URL}/stores/me/analytics`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error(`Erro ${res.status} ao buscar analytics.`);
  return res.json();
}

export const api = {
  getCatalogItems: (params) => request(`/catalog-items${buildQuery(params)}`),
  getCatalogFilters: () => request('/catalog-items/filters'),
  getPokemonOptions: (params) => request(`/store-pokemon-options/pokemon${buildQuery(params)}`),
  getMegaStonesFor: (pokemonWikiTitle) =>
    request(`/store-pokemon-options/mega-stones${buildQuery({ pokemonWikiTitle })}`),
  getAddonsFor: (pokemonWikiTitle, search) =>
    request(`/store-pokemon-options/addons${buildQuery({ pokemonWikiTitle, search })}`),
  getExtraMovesCap,
  createStorePokemon,
  updateStorePokemon,
  deleteStorePokemon,
  getItemTemplate,
  createStoreItem,
  updateStoreItem,
  deleteStoreItem,
  loginWithGoogle,
  getMyStore,
  createStore,
  updateStore,
  getStoreBySlug,
  recordStoreVisit,
  recordListingView,
  getStoreAnalytics,
};
