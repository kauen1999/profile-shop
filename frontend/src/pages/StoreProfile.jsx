import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { api, getMyStore, getStoreBySlug } from '../api';
import { useFetch } from '../hooks/useFetch';
import { FabSpeedDial } from '../components/FabSpeedDial';
import { StoreListingCard } from '../components/StoreListingCard';
import { WordmarkLink } from '../components/WordmarkLink';
import { buildStoreExportText } from '../domain/buildExportText';
import { buildListingSearchText } from '../domain/buildListingSearchText';
import { formatCategoryLabel } from '../domain/formatCategoryLabel';
import '../Landing.css';
import '../AddPokemonListing.css';

// Normalizes the two listing shapes (StoreItem/StorePokemon, each with their
// own nested CatalogItem relation name) into one common card-friendly shape.
// `raw` keeps the original row around for the handful of type-specific
// display fields StoreListingCard.jsx reads directly (nickname/level/boost
// vs. quantity/notes) — never re-derived a second time elsewhere.
function normalizeListings(store) {
  const items = (store.StoreItem || []).map((raw) => ({
    kind: 'item',
    id: raw.id,
    name: raw.CatalogItem?.name || '',
    imageUrl: raw.CatalogItem?.imageUrl || null,
    // Real catalog category of the underlying CatalogItem — normalized here
    // the same way name/imageUrl already are, so the category filter (see
    // below) never needs to know which kind-specific relation to read.
    category: raw.CatalogItem?.category || null,
    priceReal: raw.priceReal,
    priceHd: raw.priceHd,
    status: raw.status,
    createdAt: raw.createdAt,
    raw,
  }));

  const pokemon = (store.StorePokemon || []).map((raw) => ({
    kind: 'pokemon',
    id: raw.id,
    name: raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem?.name || '',
    imageUrl: raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem?.imageUrl || null,
    // A Pokémon listing's underlying CatalogItem has a real category too
    // (pokemon/pokemon-shiny/cherish-ball-pokemon) — same field, same
    // source pattern as the item branch above.
    category: raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem?.category || null,
    priceReal: raw.priceReal,
    priceHd: raw.priceHd,
    status: raw.status,
    createdAt: raw.createdAt,
    raw,
  }));

  // The backend already returns both StoreItem/StorePokemon ordered by
  // createdAt desc, but re-sorting the merged list here is what actually
  // guarantees a correct interleaved order between the two kinds — cheap and
  // never wrong even if that backend ordering guarantee ever changes.
  return [...items, ...pokemon].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Hand-drawn simplified brand glyphs (single <path>, colored via `fill`) —
// same self-contained spirit as the CSS-only .landing-pokeball icon, no
// icon-library dependency added for three icons.
function WhatsAppIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.42-1.42a9.87 9.87 0 0 0 4.62 1.18h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.64-1.03-5.13-2.9-6.99A9.82 9.82 0 0 0 12.04 2zm0 1.67c2.19 0 4.25.85 5.79 2.4a8.18 8.18 0 0 1 2.41 5.83c0 4.55-3.7 8.24-8.25 8.24a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.22.84.86-3.13-.2-.32a8.15 8.15 0 0 1-1.26-4.35c0-4.55 3.71-8.18 8.36-8.18zm-4.42 4.6c-.16 0-.42.06-.64.31-.22.25-.85.83-.85 2.02s.87 2.34 1 2.5c.12.16 1.7 2.7 4.19 3.68 2.06.82 2.48.66 2.93.62.45-.04 1.44-.59 1.65-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.34-.76-1.83-.2-.48-.4-.42-.55-.42h-.47z" />
    </svg>
  );
}

function DiscordIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.32 5.37a17.9 17.9 0 0 0-4.4-1.36c-.19.34-.4.79-.55 1.15a16.6 16.6 0 0 0-4.94 0c-.15-.36-.37-.81-.56-1.15-1.51.26-2.98.71-4.4 1.36C2.6 9.24 1.86 13 2.22 16.72a18 18 0 0 0 5.5 2.79c.44-.6.84-1.24 1.18-1.92-.65-.24-1.27-.54-1.86-.89.16-.11.31-.23.46-.35a12.9 12.9 0 0 0 10.98 0c.15.13.3.24.46.35-.59.35-1.21.65-1.86.89.34.68.74 1.32 1.18 1.92a18 18 0 0 0 5.5-2.79c.43-4.3-.7-8.02-2.94-11.35zM9.68 14.45c-.98 0-1.78-.9-1.78-2s.78-2 1.78-2 1.8.9 1.78 2c0 1.1-.79 2-1.78 2zm5.65 0c-.98 0-1.78-.9-1.78-2s.78-2 1.78-2 1.8.9 1.78 2c0 1.1-.78 2-1.78 2z" />
    </svg>
  );
}

function TelegramIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M21.05 3.35 2.7 10.53c-1.24.5-1.23 1.2-.23 1.5l4.7 1.47 1.8 5.62c.22.6.37.84.77.84.32 0 .47-.15.65-.32l1.86-1.8 4.66 3.45c.86.48 1.47.23 1.69-.8l3.06-14.4c.32-1.27-.48-1.83-1.61-1.34zM8.5 13.86 17.94 8c.44-.27.85-.12.51.18l-7.63 6.9-.3 3.24z" />
    </svg>
  );
}

export function StoreProfile() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [store, setStore] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | notfound | error
  // Owner controls (Configurações/Desconectar) are an additional, non-blocking
  // check layered on top of the public fetch above — never a prerequisite for
  // rendering the page. Stays false for anonymous visitors and for anyone
  // viewing a store that isn't their own.
  const [isOwner, setIsOwner] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  // Transient feedback for a failed Ocultar/Mostrar/Marcar-vendido/Excluir
  // action — cleared automatically after a few seconds, never blocking.
  const [actionError, setActionError] = useState('');

  // Storefront filter bar (2026-07-15) — entirely client-side, no new network
  // calls: every field these filters read against is already present in
  // `store` from the initial GET /stores/:slug fetch. Small enough lists
  // (per-store listing counts, not catalog-scale) that recomputing on every
  // render is fine, no useMemo needed.
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all | item | pokemon
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priceMinReal, setPriceMinReal] = useState('');
  const [priceMaxReal, setPriceMaxReal] = useState('');
  const [priceMinHd, setPriceMinHd] = useState('');
  const [priceMaxHd, setPriceMaxHd] = useState('');

  // Every real catalog category (not just the ones this store happens to
  // have listed right now) — requested explicitly, so the filter can be
  // used to browse toward a category the store doesn't have anything in
  // yet too. `GET /catalog-items/filters` is the same endpoint Catalog.jsx
  // already uses to populate its own category `<select>`.
  const { data: catalogFilters } = useFetch(() => api.getCatalogFilters(), []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setStore(null);

    getStoreBySlug(slug)
      .then((data) => {
        if (cancelled) return;
        setStore(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err.status === 404 ? 'notfound' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    setIsOwner(false);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) return;

      try {
        const idToken = await firebaseUser.getIdToken();
        const { store: myStore } = await getMyStore(idToken);
        if (myStore && myStore.slug === slug) {
          setIsOwner(true);
        }
      } catch {
        // Falha na checagem de dono (token expirado, backend fora do ar) —
        // não afeta a visão pública, só não mostra os controles de dono.
      }
    });

    return unsubscribe;
  }, [slug]);

  // Closes the hamburger dropdown on any click outside of it — standard
  // ref + document mousedown listener pattern, only attached while the menu
  // is actually open.
  useEffect(() => {
    if (!menuOpen) return undefined;

    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Transient action-error message auto-clears — never a blocking banner.
  useEffect(() => {
    if (!actionError) return undefined;
    const timer = setTimeout(() => setActionError(''), 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  async function handleLogout() {
    await signOut(auth);
    navigate('/login');
  }

  // "Exportar Anúncios" — pure client-side action, no navigation, no
  // network call of its own (buildStoreExportText only reads `store`, which
  // this page already loaded). Downloads a .txt file and also copies to the
  // clipboard as a convenience — same "look" text format the importer
  // (ImportListings.jsx) understands, so re-pasting this file back in
  // round-trips.
  async function handleExport() {
    setMenuOpen(false);
    const text = buildStoreExportText(store);

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}-anuncios.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard permission denied/unavailable — the download above already
      // succeeded, so this is just a missed convenience, not a failure.
    }
  }

  // Replaces the raw StoreItem/StorePokemon row (by kind+id) inside `store`
  // state with whatever `updater` returns — shared by the optimistic status
  // update and its revert-on-failure below.
  function replaceRawListing(kind, id, updater) {
    const key = kind === 'item' ? 'StoreItem' : 'StorePokemon';
    setStore((prev) => ({
      ...prev,
      [key]: prev[key].map((raw) => (raw.id === id ? updater(raw) : raw)),
    }));
  }

  // Ocultar/Mostrar and Marcar como vendido/Reverter venda both funnel
  // through here — only `newStatus` differs. Optimistic: flips local state
  // immediately, reverts it if the PATCH fails.
  async function handleStatusChange(listing, newStatus) {
    const previousStatus = listing.status;
    replaceRawListing(listing.kind, listing.id, (raw) => ({ ...raw, status: newStatus }));

    try {
      const idToken = await auth.currentUser.getIdToken();
      if (listing.kind === 'item') {
        await api.updateStoreItem(idToken, listing.id, { status: newStatus });
      } else {
        await api.updateStorePokemon(idToken, listing.id, { status: newStatus });
      }
    } catch {
      replaceRawListing(listing.kind, listing.id, (raw) => ({ ...raw, status: previousStatus }));
      setActionError('Não foi possível atualizar o anúncio agora. Tente de novo.');
    }
  }

  async function handleDelete(listing) {
    if (!window.confirm('Tem certeza que deseja excluir este anúncio?')) return;

    const key = listing.kind === 'item' ? 'StoreItem' : 'StorePokemon';
    const previousList = store[key];
    setStore((prev) => ({ ...prev, [key]: prev[key].filter((raw) => raw.id !== listing.id) }));

    try {
      const idToken = await auth.currentUser.getIdToken();
      if (listing.kind === 'item') {
        await api.deleteStoreItem(idToken, listing.id);
      } else {
        await api.deleteStorePokemon(idToken, listing.id);
      }
    } catch {
      setStore((prev) => ({ ...prev, [key]: previousList }));
      setActionError('Não foi possível excluir o anúncio agora. Tente de novo.');
    }
  }

  if (status === 'loading') {
    return (
      <div className="landing landing-auth">
        <header className="landing-header">
          <WordmarkLink />
        </header>
        <div className="landing-auth-wrap">
          <div className="landing-auth-card">
            <p>Carregando loja...</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'notfound') {
    return (
      <div className="landing landing-auth">
        <header className="landing-header">
          <WordmarkLink />
        </header>
        <div className="landing-auth-wrap">
          <div className="landing-auth-card">
            <h1>Loja não encontrada</h1>
            <p className="landing-auth-notice">
              Não existe nenhuma loja com esse endereço. Confira o link ou volte para a página inicial.
            </p>
            <Link to="/" className="landing-auth-back">
              ← Voltar para a página inicial
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="landing landing-auth">
        <header className="landing-header">
          <WordmarkLink />
        </header>
        <div className="landing-auth-wrap">
          <div className="landing-auth-card">
            <h1>Não foi possível carregar</h1>
            <p className="landing-auth-notice">
              Não conseguimos falar com o servidor agora. Tente de novo em instantes.
            </p>
            <Link to="/" className="landing-auth-back">
              ← Voltar para a página inicial
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Non-owners only ever see ACTIVE listings — GET /stores/:slug is fully
  // public and returns every status regardless of who's asking (see
  // CLAUDE.md's "Listagens da loja" section), so this filter is the only
  // thing standing between a HIDDEN/SOLD listing and a visitor's screen.
  const allListings = normalizeListings(store);
  const visibleListings = isOwner ? allListings : allListings.filter((listing) => listing.status === 'ACTIVE');

  // Category filter is only meaningful for Item listings — Pokémon listings
  // have no comparable "category" concept exposed to shoppers, so picking a
  // real category naturally excludes them (no `CatalogItem.category` to
  // match), which is intended, not a bug to work around. Options list every
  // real catalog category (requested explicitly — lets a shopper browse
  // toward a category this store doesn't happen to have anything in yet),
  // not just the ones currently present in `visibleListings` — same
  // `GET /catalog-items/filters` endpoint Catalog.jsx already uses for its
  // own category `<select>`. Sorted alphabetically by display label (the
  // API's own order is by catalog-wide count, not useful for scanning a
  // ~19-item dropdown by name).
  const categoryOptions = (catalogFilters?.categories || [])
    .map((c) => c.value)
    .sort((a, b) => formatCategoryLabel(a).localeCompare(formatCategoryLabel(b)));

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const minPriceReal = priceMinReal === '' ? null : Number(priceMinReal);
  const maxPriceReal = priceMaxReal === '' ? null : Number(priceMaxReal);
  const minPriceHd = priceMinHd === '' ? null : Number(priceMinHd);
  const maxPriceHd = priceMaxHd === '' ? null : Number(priceMaxHd);
  const hasRealBound = minPriceReal !== null || maxPriceReal !== null;
  const hasHdBound = minPriceHd !== null || maxPriceHd !== null;

  const filteredListings = visibleListings.filter((listing) => {
    if (typeFilter !== 'all' && listing.kind !== typeFilter) return false;

    // Every listing (item or Pokémon) now carries its real catalog
    // category via the normalized `category` field above — no kind-specific
    // exception needed, both filter identically.
    if (categoryFilter && listing.category !== categoryFilter) return false;

    // Real and HD are independent currencies (never summed/compared to each
    // other) — each has its own min/max bound, checked against its own
    // price field only.
    if (hasRealBound) {
      if (listing.priceReal == null) return false;
      if (minPriceReal !== null && listing.priceReal < minPriceReal) return false;
      if (maxPriceReal !== null && listing.priceReal > maxPriceReal) return false;
    }

    if (hasHdBound) {
      if (listing.priceHd == null) return false;
      if (minPriceHd !== null && listing.priceHd < minPriceHd) return false;
      if (maxPriceHd !== null && listing.priceHd > maxPriceHd) return false;
    }

    if (normalizedSearch && !buildListingSearchText(listing).includes(normalizedSearch)) return false;

    return true;
  });

  return (
    <div className="landing landing-auth">
      <header className="landing-header">
        <WordmarkLink />
        {isOwner && (
          <div className="landing-store-menu" ref={menuRef}>
            <button
              type="button"
              className="landing-hamburger"
              aria-label="Menu da loja"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="landing-hamburger-bar" />
              <span className="landing-hamburger-bar" />
              <span className="landing-hamburger-bar" />
            </button>
            {menuOpen && (
              <div className="landing-store-menu-dropdown" role="menu">
                <Link
                  to="/configuracoes"
                  className="landing-store-menu-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Configurações
                </Link>
                <Link
                  to={`/${slug}/anuncios/importar`}
                  className="landing-store-menu-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Importar Anúncios
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  className="landing-store-menu-item"
                  onClick={handleExport}
                >
                  Exportar Anúncios
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="landing-store-menu-item landing-store-menu-item-danger"
                  onClick={handleLogout}
                >
                  Desconectar
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="landing-auth-wrap">
        <div className="landing-store-blocks">
          <div className="landing-auth-card landing-store-card">
            <h1>{store.name}</h1>
            {store.gameNickname && (
              <p className="landing-store-nickname">Dono: {store.gameNickname}</p>
            )}
            {store.description && <p className="landing-store-description">{store.description}</p>}

            {(store.whatsapp || store.discord || store.telegram) && (
              <div className="landing-store-contacts">
                {store.whatsapp && (
                  <span
                    className="landing-store-contact-icon landing-store-contact-whatsapp"
                    title={`WhatsApp: ${store.whatsapp}`}
                    aria-label={`WhatsApp: ${store.whatsapp}`}
                  >
                    <WhatsAppIcon />
                  </span>
                )}
                {store.discord && (
                  <span
                    className="landing-store-contact-icon landing-store-contact-discord"
                    title={`Discord: ${store.discord}`}
                    aria-label={`Discord: ${store.discord}`}
                  >
                    <DiscordIcon />
                  </span>
                )}
                {store.telegram && (
                  <span
                    className="landing-store-contact-icon landing-store-contact-telegram"
                    title={`Telegram: ${store.telegram}`}
                    aria-label={`Telegram: ${store.telegram}`}
                  >
                    <TelegramIcon />
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="landing-auth-card landing-store-listings">
            {actionError && <p className="landing-auth-error store-listing-action-error">{actionError}</p>}

            {visibleListings.length === 0 ? (
              <p className="landing-store-empty">Ainda sem anúncios à venda.</p>
            ) : (
              <>
                <div className="store-listings-filters">
                  <input
                    type="text"
                    className="store-listings-filter-search"
                    placeholder="Buscar por nome, descrição, item equipado..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    aria-label="Buscar anúncios"
                  />

                  {/* Mobile/tablet (below 860px): plain flex-wrap, unchanged
                      from before — .store-listings-filter-row wraps Tipo,
                      Categoria and the price wrapper as 3 items; within the
                      price wrapper, Real/HD sit side by side, each with
                      Mín/Máx stacked. Desktop (860px+, Landing.css):
                      .store-listings-filters itself becomes a
                      `grid-template-areas` 2×3 grid ("search search real" /
                      "tipo cat hd") — `.store-listings-filter-row` and
                      `.store-listings-filter-price-group` switch to
                      `display: contents` there, dissolving as boxes so their
                      children (search/Tipo/Categoria/Real/HD) become direct
                      grid items placed by the `store-listings-filter-area-*`
                      classes below, with no duplicated markup between the
                      two breakpoints. */}
                  <div className="store-listings-filter-row">
                    <label className="store-listings-filter-field store-listings-filter-area-tipo">
                      <span>Tipo</span>
                      <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                        <option value="all">Todos</option>
                        <option value="pokemon">Pokémon</option>
                        <option value="item">Itens</option>
                      </select>
                    </label>

                    <label className="store-listings-filter-field store-listings-filter-area-categoria">
                      <span>Categoria</span>
                      <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                        <option value="">Todas as categorias</option>
                        {categoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {formatCategoryLabel(category)}
                          </option>
                        ))}
                      </select>
                    </label>

                    {/* Real and HD are independent currencies — each gets its
                        own compact min/max pair (stacked on mobile, side by
                        side on desktop — see Landing.css), the two currencies
                        sitting side by side on mobile, stacked into separate
                        grid rows on desktop. */}
                    <div className="store-listings-filter-price-group">
                      <div className="store-listings-filter-price-col store-listings-filter-area-real">
                        <label className="store-listings-filter-field store-listings-filter-field-sm">
                          <span>Mín.</span>
                          <input
                            type="number"
                            min="0"
                            placeholder="R$"
                            value={priceMinReal}
                            onChange={(event) => setPriceMinReal(event.target.value)}
                          />
                        </label>
                        <label className="store-listings-filter-field store-listings-filter-field-sm">
                          <span>Máx.</span>
                          <input
                            type="number"
                            min="0"
                            placeholder="R$"
                            value={priceMaxReal}
                            onChange={(event) => setPriceMaxReal(event.target.value)}
                          />
                        </label>
                      </div>

                      <div className="store-listings-filter-price-col store-listings-filter-area-hd">
                        <label className="store-listings-filter-field store-listings-filter-field-sm">
                          <span>Mín.</span>
                          <input
                            type="number"
                            min="0"
                            placeholder="HD"
                            value={priceMinHd}
                            onChange={(event) => setPriceMinHd(event.target.value)}
                          />
                        </label>
                        <label className="store-listings-filter-field store-listings-filter-field-sm">
                          <span>Máx.</span>
                          <input
                            type="number"
                            min="0"
                            placeholder="HD"
                            value={priceMaxHd}
                            onChange={(event) => setPriceMaxHd(event.target.value)}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {filteredListings.length === 0 ? (
                  <p className="landing-store-empty">Nenhum anúncio encontrado com esses filtros.</p>
                ) : (
                  <div className="store-listings-list">
                    {filteredListings.map((listing) => (
                      <StoreListingCard
                        key={`${listing.kind}-${listing.id}`}
                        listing={listing}
                        isOwner={isOwner}
                        slug={slug}
                        storeWhatsapp={store.whatsapp}
                        onStatusChange={handleStatusChange}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <Link to="/" className="landing-auth-back">
            ← Voltar para a página inicial
          </Link>
        </div>
      </div>

      {isOwner && (
        <FabSpeedDial
          actions={[
            {
              key: 'pokemon',
              label: 'Adicionar Pokémon',
              enabled: true,
              onClick: () => navigate(`/${slug}/anuncios/pokemon/novo`),
            },
            {
              key: 'item',
              label: 'Adicionar Item',
              enabled: true,
              onClick: () => navigate(`/${slug}/anuncios/item/novo`),
            },
          ]}
        />
      )}
    </div>
  );
}
