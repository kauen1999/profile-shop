import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { API_URL, api, getMyStore, getStoreBySlug } from '../api';
import { useFetch } from '../hooks/useFetch';
import { FabSpeedDial } from '../components/FabSpeedDial';
import { StoreListingCard } from '../components/StoreListingCard';
import { WordmarkLink } from '../components/WordmarkLink';
import { AnalyticsTab } from '../components/AnalyticsTab';
import { buildStoreExportText } from '../domain/buildExportText';
import { buildStoreWhatsappAdText } from '../domain/buildWhatsappAdText';
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

// Generic "share" glyph (nodes-and-lines) — not a brand logo, the standard
// cross-platform symbol for sharing a link.
function ShareIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L7.04 9.81C6.5 9.31 5.79 9 5 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
    </svg>
  );
}

// Standard magnifying-glass glyph for the filter search bar (2026-07-16
// redesign) — same "generic UI symbol, not a brand mark" spirit as
// ShareIcon above.
function SearchIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// Fallback avatar content (store header, 2026-07-17 redesign) — used only
// when the owner has no Google photo (store.User?.image), so the avatar
// slot stays structurally present either way.
function getStoreInitial(name) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// Store header description cap (2026-07-17) — an unbounded description can
// grow the header's own layout height a lot (and, with an unbroken long
// string and no wrapping, even its width) — capped at a fixed character
// count so the header's proportions never depend on how much text an
// owner happened to write. Cuts at the last whole word within the limit
// (never mid-word) before appending the ellipsis.
const STORE_HEADER_DESCRIPTION_LIMIT = 220;

function truncateDescription(text, limit = STORE_HEADER_DESCRIPTION_LIMIT) {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// The 3 real CatalogItem categories a Pokémon listing's underlying item can
// have (see normalizeListings above and CLAUDE.md's "Correção do filtro de
// categoria" entry — Pokémon rows resolve a real `category` too, not just
// Item rows). Used to scope the category <select>'s options to whichever
// kind is selected in the Tipo filter (2026-07-18, explicit request).
const POKEMON_CATALOG_CATEGORIES = ['pokemon', 'pokemon-shiny', 'cherish-ball-pokemon'];

// "Ver mais" page sizes (2026-07-18, explicit request) — 5 per column when
// Tipo === 'all' (each column paginates on its own), 10 total (5+5, split
// the same way the columns already balance a single-kind result) when Tipo
// is narrowed to just Pokémon or just Item. See the pagination state/effect
// and the column-split logic inside the component below.
const ALL_TYPE_PAGE_SIZE = 5;
const SINGLE_TYPE_PAGE_SIZE = 10;

// Avatar+nick content, shared between the 2 layout variants below
// (.store-header-avatar-block-mobile / -desktop) — same markup rendered
// twice (CSS toggles which one is visible per breakpoint, see Landing.css),
// so this avoids literally duplicating the JSX at each call site.
function renderAvatarContent(store) {
  return (
    <>
      {store.User?.image ? (
        <img src={store.User.image} alt="" className="store-header-avatar" />
      ) : (
        <div className="store-header-avatar store-header-avatar-fallback" aria-hidden="true">
          {getStoreInitial(store.name)}
        </div>
      )}
      {store.gameNickname && <p className="store-header-nickname">{store.gameNickname}</p>}
    </>
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
  // Owner-only ID token (2026-07-21), captured by the same effect that
  // resolves isOwner below — needed by AnalyticsTab's authenticated
  // GET /stores/me/analytics call. Stays null for anonymous visitors.
  const [idToken, setIdToken] = useState(null);
  // Anúncios / Analytics tab switcher (2026-07-21) — only ever rendered/
  // reachable when isOwner, defaults to the existing listings view.
  const [activeTab, setActiveTab] = useState('anuncios'); // anuncios | analytics
  // Switching tabs re-renders a much shorter/taller content block below the
  // tab bar — without this, the browser clamps the current scroll offset
  // down to whatever fits the new (often shorter) content, which reads as
  // "jumping to the top of the page". Remembered per tab (not a single
  // shared value) so going Anúncios -> Analytics -> Anúncios restores the
  // original depth on Anúncios, rather than wherever Analytics happened to
  // leave it. Captured at click time and restored synchronously via
  // useLayoutEffect, right after the new tab's content is in the DOM but
  // before the browser paints — avoids a visible flash back down.
  const scrollPositionsRef = useRef({ anuncios: 0, analytics: 0 });
  function handleTabChange(tab) {
    scrollPositionsRef.current[activeTab] = window.scrollY;
    setActiveTab(tab);
  }
  useLayoutEffect(() => {
    window.scrollTo(0, scrollPositionsRef.current[activeTab]);
  }, [activeTab]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  // Transient feedback for a failed Ocultar/Mostrar/Marcar-vendido/Excluir
  // action — cleared automatically after a few seconds, never blocking.
  const [actionError, setActionError] = useState('');
  // Transient feedback for the "Compartilhar" button (share-sheet unavailable
  // → clipboard fallback) — same auto-clear-after-a-few-seconds pattern as
  // actionError above, own state since it's unrelated to listing actions.
  const [shareFeedback, setShareFeedback] = useState('');

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

  // "Ver mais" pagination (2026-07-18, explicit request) — purely a render
  // cap on data already fetched in one shot via GET /stores/:slug, not a
  // second network call. Two independent counters (Tipo === 'all', one
  // Pokémon column + one Item column, each growing on its own) vs. one
  // shared counter (Tipo narrowed to a single kind, still split into 2
  // balanced columns, but revealed together) — see the split logic below
  // for how each is actually used.
  const [visibleLeftCount, setVisibleLeftCount] = useState(ALL_TYPE_PAGE_SIZE);
  const [visibleRightCount, setVisibleRightCount] = useState(ALL_TYPE_PAGE_SIZE);
  const [visibleSingleCount, setVisibleSingleCount] = useState(SINGLE_TYPE_PAGE_SIZE);

  // Resets pagination back to the initial page size whenever any filter
  // changes — without this, switching filters after clicking "Ver mais" a
  // few times would leave the counters at a stale, confusing offset instead
  // of starting the new result set from the top.
  useEffect(() => {
    setVisibleLeftCount(ALL_TYPE_PAGE_SIZE);
    setVisibleRightCount(ALL_TYPE_PAGE_SIZE);
    setVisibleSingleCount(SINGLE_TYPE_PAGE_SIZE);
  }, [typeFilter, categoryFilter, searchQuery, priceMinReal, priceMaxReal, priceMinHd, priceMaxHd]);

  // Category options are scoped to the selected Tipo (2026-07-18, explicit
  // request) — a previously-selected category can become invalid for the
  // new Tipo (e.g. "Shiny" selected, then switching to "Itens"), which
  // would otherwise silently zero out every result (the filter still
  // compares listing.category against the stale value) without any visible
  // explanation. Resetting on every Tipo change is simpler and more
  // predictable than trying to detect exactly when the current value
  // becomes invalid.
  useEffect(() => {
    setCategoryFilter('');
  }, [typeFilter]);

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
    setIdToken(null);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) return;

      try {
        const freshIdToken = await firebaseUser.getIdToken();
        const { store: myStore } = await getMyStore(freshIdToken);
        if (myStore && myStore.slug === slug) {
          setIsOwner(true);
          setIdToken(freshIdToken);
        }
      } catch {
        // Falha na checagem de dono (token expirado, backend fora do ar) —
        // não afeta a visão pública, só não mostra os controles de dono.
      }
    });

    return unsubscribe;
  }, [slug]);

  // Analytics visit ping (2026-07-21) — fire-and-forget, never surfaced to
  // the visitor on failure. Known/accepted race: isOwner starts false and
  // only resolves after onAuthStateChanged fires, so an owner viewing their
  // own store can generate one stray visit before their own auth state
  // settles — accepted 1-row noise cost per the approved plan, no
  // debounce/delay added to "fix" it.
  useEffect(() => {
    if (!slug || isOwner) return;
    api.recordStoreVisit(slug).catch(() => {});
  }, [slug, isOwner]);

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

  useEffect(() => {
    if (!shareFeedback) return undefined;
    const timer = setTimeout(() => setShareFeedback(''), 4000);
    return () => clearTimeout(timer);
  }, [shareFeedback]);

  // "Compartilhar" — prefers the native share sheet (mobile browsers, most
  // desktop browsers too), which lets the visitor pick WhatsApp/Telegram/
  // etc. directly; falls back to copying the store's public URL to the
  // clipboard when the Web Share API isn't available. A user dismissing the
  // native share sheet rejects the promise with an AbortError — not a
  // failure to surface, so only the clipboard-fallback path reports
  // anything back via shareFeedback.
  async function handleShare() {
    const url = `${window.location.origin}/${slug}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: store.name, url });
      } catch {
        // Cancelled by the user, or share failed silently — nothing to show.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setShareFeedback('Link copiado!');
    } catch {
      setShareFeedback('Não foi possível copiar o link.');
    }
  }

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

  // "Exportar pra WhatsApp" (2026-07-21) — separate from "Exportar
  // Anúncios" above: this one is meant to be pasted straight into a sales
  // group, not re-imported, so it's clipboard-only (no .txt download — there's
  // nothing to keep/reimport from a WhatsApp-formatted post) and reuses the
  // same `shareFeedback` state/timer already used by handleShare for the
  // toast message. buildStoreWhatsappAdText returns '' when there's nothing
  // ACTIVE-with-a-price to show — that's reported instead of copying an
  // empty string.
  async function handleExportWhatsapp() {
    setMenuOpen(false);
    const text = buildStoreWhatsappAdText(store);

    if (!text) {
      setShareFeedback('Nenhum anúncio com preço pra exportar.');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setShareFeedback('Texto copiado!');
    } catch {
      setShareFeedback('Não foi possível copiar o texto.');
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

  // Keeps this page's own `store` state in sync when a listing's status
  // changes from OUTSIDE the Anúncios tab (2026-07-21 follow-up) — today
  // that's only the Analytics tab's "Reverter venda" action in the sales
  // log. AnalyticsTab already does its own PATCH + refetches its own
  // analytics payload (so its stat tiles/log stay correct); this is purely
  // "also update the Anúncios tab's cached copy of this row" so a reverted
  // sale reappears there without needing a full page reload — no network
  // call happens here, `replaceRawListing` already exists for exactly this
  // kind of local-state patch.
  function syncListingStatus(kind, id, status) {
    replaceRawListing(kind, id, (raw) => ({ ...raw, status, soldAt: status === 'SOLD' ? raw.soldAt : null }));
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
  // Sold listings leave the Anúncios tab entirely for the owner too
  // (2026-07-21 follow-up) — they're no longer "an ad you're managing",
  // they're a completed sale tracked in the Analytics dashboard's sales
  // log instead. Hidden listings are unaffected — still visible/dimmed to
  // the owner, since Hidden is a temporary self-toggle they manage here,
  // unlike Sold. A visitor's view is unchanged (ACTIVE only).
  const visibleListings = isOwner
    ? allListings.filter((listing) => listing.status !== 'SOLD')
    : allListings.filter((listing) => listing.status === 'ACTIVE');

  // Options list every real catalog category (requested explicitly — lets a
  // shopper browse toward a category this store doesn't happen to have
  // anything in yet), not just the ones currently present in
  // `visibleListings` — same `GET /catalog-items/filters` endpoint
  // Catalog.jsx already uses for its own category `<select>`. Sorted
  // alphabetically by display label (the API's own order is by
  // catalog-wide count, not useful for scanning a ~19-item dropdown by
  // name).
  //
  // Scoped to the selected Tipo (2026-07-18, explicit request): "Todos"
  // shows every category; "Pokémon" narrows to just the 3 Pokémon-shaped
  // categories (see POKEMON_CATALOG_CATEGORIES); "Itens" shows everything
  // except those 3 (every category is a real item type, since Pokémon rows
  // only ever resolve to those 3 specific values).
  const categoryOptions = (catalogFilters?.categories || [])
    .map((c) => c.value)
    .filter((value) => {
      if (typeFilter === 'pokemon') return POKEMON_CATALOG_CATEGORIES.includes(value);
      if (typeFilter === 'item') return !POKEMON_CATALOG_CATEGORIES.includes(value);
      return true;
    })
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

  // 2-column layout (2026-07-18, explicit request): with "Todos" selected,
  // the 2 columns are a natural kind split (Pokémon left, Items right).
  // With the type filter narrowed to just one kind, there's no second kind
  // left to give the right column, so instead the SAME kind's listings are
  // divided evenly across both columns (a balanced 2-column grid of one
  // kind, not "left column always Pokémon"). filteredListings is already
  // ordered (createdAt desc, from the backend) — slicing it in half
  // preserves that order within each column instead of re-sorting.
  //
  // "Ver mais" pagination (2026-07-18, follow-up): each branch additionally
  // caps what's actually rendered. Tipo === 'all' caps each kind's full
  // list independently (visibleLeftCount/visibleRightCount, one "Ver mais"
  // per column). A single kind caps the combined list first
  // (visibleSingleCount, one shared "Ver mais"), THEN splits — applying
  // Math.ceil(length/2) to the already-capped slice (not the full filtered
  // list) is what keeps "10 visible" landing on exactly 5+5, "20 visible"
  // on 10+10, etc., instead of a split point that drifts independently of
  // how much is actually shown.
  let leftColumnListings;
  let rightColumnListings;
  let showMoreLeft = false;
  let showMoreRight = false;
  let showMoreSingle = false;
  if (typeFilter === 'all') {
    const allLeft = filteredListings.filter((listing) => listing.kind === 'pokemon');
    const allRight = filteredListings.filter((listing) => listing.kind === 'item');
    leftColumnListings = allLeft.slice(0, visibleLeftCount);
    rightColumnListings = allRight.slice(0, visibleRightCount);
    showMoreLeft = allLeft.length > visibleLeftCount;
    showMoreRight = allRight.length > visibleRightCount;
  } else {
    const visibleSlice = filteredListings.slice(0, visibleSingleCount);
    const splitIndex = Math.ceil(visibleSlice.length / 2);
    leftColumnListings = visibleSlice.slice(0, splitIndex);
    rightColumnListings = visibleSlice.slice(splitIndex);
    showMoreSingle = filteredListings.length > visibleSingleCount;
  }

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
                  className="landing-store-menu-item"
                  onClick={handleExportWhatsapp}
                >
                  Exportar pra WhatsApp
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
          <div className="landing-auth-card store-header">
            {/* Store header — 2 layouts, one per breakpoint (per request),
                both rendered and toggled via display:none in Landing.css
                (@media min-width:860px), not conditional rendering — a DOM
                node can't move between 2 different parents based on a
                media query, so the avatar+nick content (renderAvatarContent)
                is rendered twice: once inside the banner, stacked above the
                name (narrow screens), once inside .store-header-info,
                overlapping the banner/info boundary the original way
                (negative margin, wide screens — the earlier "Warframe
                Market" design, restored here after having been replaced by
                the narrow-screen version for all widths).
                Description (2026-07-21): rendered as a direct sibling right
                after the avatar block inside .store-header-info (no more
                .store-header-details wrapper — it only ever held this one
                paragraph, removed as dead wrapper) — on desktop this section
                switches to flex-direction:column (see Landing.css), so the
                description now flows in its own full-width row below the
                avatar row, instead of sitting beside the avatar as a
                same-height column (the bug this fixes — see CLAUDE.md). On
                mobile nothing changes here (avatar-block-desktop is already
                display:none there, description was already the only visible
                content, already read as directly below the name). */}
            <div
              className="store-header-banner"
              style={{ '--banner-photo-url': `url(${API_URL}/images/store-card-banner.png)` }}
            >
              <div className="store-header-avatar-block store-header-avatar-block-mobile">
                {renderAvatarContent(store)}
              </div>

              <div className="store-header-name-box">
                <h1 className="store-header-name">{store.name}</h1>
              </div>
            </div>

            <div className="store-header-info">
              <div className="store-header-avatar-block store-header-avatar-block-desktop">
                {renderAvatarContent(store)}
              </div>

              {store.description && (
                <p className="store-header-description">{truncateDescription(store.description)}</p>
              )}
            </div>

            {/* Compartilhar — back to an icon-only button (per request),
                now floating in the card's bottom-right corner instead of
                sitting inline with the store info text. */}
            <button
              type="button"
              className="store-header-share-btn"
              onClick={handleShare}
              aria-label="Compartilhar loja"
              title="Compartilhar loja"
            >
              <ShareIcon />
            </button>
            {shareFeedback && <span className="store-header-share-feedback">{shareFeedback}</span>}
          </div>

          {/* Anúncios / Analytics tab bar (2026-07-21) — owner-only, same as
              every other owner control on this page. Visitors keep seeing
              the listings section directly, no tab bar at all. */}
          {isOwner && (
            <div className="store-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'anuncios'}
                className={`store-tab${activeTab === 'anuncios' ? ' store-tab-active' : ''}`}
                onClick={() => handleTabChange('anuncios')}
              >
                Anúncios
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'analytics'}
                className={`store-tab${activeTab === 'analytics' ? ' store-tab-active' : ''}`}
                onClick={() => handleTabChange('analytics')}
              >
                Analytics
              </button>
            </div>
          )}

          {activeTab === 'anuncios' && (
          <div className="landing-auth-card landing-store-listings">
            {actionError && <p className="landing-auth-error store-listing-action-error">{actionError}</p>}

            {visibleListings.length === 0 ? (
              <p className="landing-store-empty">Ainda sem anúncios à venda.</p>
            ) : (
              <>
                {/* A single flex-wrap row — search + every pill are direct
                    siblings here, wrapping onto as many lines as needed at
                    any width (no separate breakpoint-specific layout, see
                    Landing.css). Search is a constrained-width item now,
                    not full-width, so it sits inline with the rest instead
                    of forcing them onto their own line below it. */}
                {/* 2-column grid at the 375×667 minimum screen (2026-07-17
                    reorganization): search spans both columns on its own
                    row, then Tipo+R$ on one row and Categoria+HD on the
                    next — Categoria shares Tipo's column so they're always
                    the same width. Reverts to the single flex-wrap row for
                    min-width: 860px+ (see Landing.css) — the grid areas
                    below only apply while the container is actually a grid. */}
                <div className="store-listings-filters">
                  <div className="store-listings-search store-listings-filter-area-search">
                    <SearchIcon className="store-listings-search-icon" />
                    <input
                      type="text"
                      className="store-listings-search-input"
                      placeholder="Buscar..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label="Buscar anúncios"
                    />
                  </div>

                  <div
                    className="store-listings-segmented store-listings-filter-area-tipo"
                    role="group"
                    aria-label="Tipo de anúncio"
                  >
                    <button
                      type="button"
                      className={typeFilter === 'all' ? 'active' : ''}
                      onClick={() => setTypeFilter('all')}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      className={typeFilter === 'pokemon' ? 'active' : ''}
                      onClick={() => setTypeFilter('pokemon')}
                    >
                      Pokémon
                    </button>
                    <button
                      type="button"
                      className={typeFilter === 'item' ? 'active' : ''}
                      onClick={() => setTypeFilter('item')}
                    >
                      Itens
                    </button>
                  </div>

                  <select
                    className="store-listings-category-select store-listings-filter-area-categoria"
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                    aria-label="Categoria"
                  >
                    <option value="">Todas as categorias</option>
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {formatCategoryLabel(category)}
                      </option>
                    ))}
                  </select>

                  {/* Real and HD are independent currencies — each
                      collapses to one "mín – máx" pill instead of two
                      separate labeled fields. */}
                  <div className="store-listings-price-pill store-listings-filter-area-real">
                    <span className="store-listings-price-pill-label">R$</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="mín"
                      value={priceMinReal}
                      onChange={(event) => setPriceMinReal(event.target.value)}
                      aria-label="Preço mínimo em Real"
                    />
                    <span className="store-listings-price-pill-sep">–</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="máx"
                      value={priceMaxReal}
                      onChange={(event) => setPriceMaxReal(event.target.value)}
                      aria-label="Preço máximo em Real"
                    />
                  </div>

                  <div className="store-listings-price-pill store-listings-filter-area-hd">
                    <span className="store-listings-price-pill-label">HD</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="mín"
                      value={priceMinHd}
                      onChange={(event) => setPriceMinHd(event.target.value)}
                      aria-label="Quantidade mínima em HD"
                    />
                    <span className="store-listings-price-pill-sep">–</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="máx"
                      value={priceMaxHd}
                      onChange={(event) => setPriceMaxHd(event.target.value)}
                      aria-label="Quantidade máxima em HD"
                    />
                  </div>
                </div>

                {filteredListings.length === 0 ? (
                  <p className="landing-store-empty">Nenhum anúncio encontrado com esses filtros.</p>
                ) : (
                  <>
                    <div className="store-listings-columns">
                      {leftColumnListings.length > 0 && (
                        <div className="store-listings-list store-listings-column">
                          {leftColumnListings.map((listing) => (
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
                          {typeFilter === 'all' && showMoreLeft && (
                            <button
                              type="button"
                              className="landing-btn landing-btn-outline"
                              onClick={() => setVisibleLeftCount((count) => count + ALL_TYPE_PAGE_SIZE)}
                            >
                              Ver mais
                            </button>
                          )}
                        </div>
                      )}
                      {rightColumnListings.length > 0 && (
                        <div className="store-listings-list store-listings-column">
                          {rightColumnListings.map((listing) => (
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
                          {typeFilter === 'all' && showMoreRight && (
                            <button
                              type="button"
                              className="landing-btn landing-btn-outline"
                              onClick={() => setVisibleRightCount((count) => count + ALL_TYPE_PAGE_SIZE)}
                            >
                              Ver mais
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {typeFilter !== 'all' && showMoreSingle && (
                      <div className="store-listings-load-more-wrap">
                        <button
                          type="button"
                          className="landing-btn landing-btn-outline"
                          onClick={() => setVisibleSingleCount((count) => count + SINGLE_TYPE_PAGE_SIZE)}
                        >
                          Ver mais
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          )}

          {isOwner && activeTab === 'analytics' && (
            <AnalyticsTab slug={slug} idToken={idToken} onListingStatusSynced={syncListingStatus} />
          )}
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
