import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { api, createStoreItem, getMyStore, getStoreBySlug, updateStoreItem } from '../api';
import { NewListingPageShell } from '../components/NewListingPageShell';
import { Autocomplete } from '../components/Autocomplete';
import { LookPreviewCard } from '../components/LookPreviewCard';
import { useFetch } from '../hooks/useFetch';
import { buildItemLookText, GAME_WORLD_LABELS } from '../domain/buildItemLookText';
import { formatCategoryLabel } from '../domain/formatCategoryLabel';
import { GAME_WORLDS, ITEM_PICKER_EXCLUDED_CATEGORIES } from '../domain/gameConstants';
import '../AddPokemonListing.css';

async function fetchCatalogItems(search) {
  const res = await api.getCatalogItems({
    search,
    pageSize: 30,
    excludeCategories: ITEM_PICKER_EXCLUDED_CATEGORIES.join(','),
  });
  return res.items;
}

export function AddItemListing() {
  const { slug, storeItemId } = useParams();
  const navigate = useNavigate();

  // Presence of :storeItemId (only matched by the .../editar route, see
  // App.jsx) is what signals edit mode — same component as creation, per
  // plan.
  const isEditMode = storeItemId !== undefined;
  const editId = isEditMode ? Number(storeItemId) : null;

  // loading | ready | redirecting | notfound — same pattern as
  // AddPokemonListing.jsx: re-verifies ownership via onAuthStateChanged ->
  // getMyStore -> compare slug, never trusts arriving via URL implies
  // ownership. In edit mode, also fetches the existing listing (via the
  // public GET /stores/:slug — same route StoreProfile.jsx already uses,
  // no dedicated edit-fetch endpoint) before flipping to 'ready'.
  const [pageStatus, setPageStatus] = useState('loading');

  const [item, setItem] = useState(null);

  // Guards the "changing the picked item clears every template-specific
  // field" effect below from wiping the values this same render just
  // pre-filled from the existing listing — see the effect itself for the
  // full explanation. Only relevant in edit mode; stays false (no-op guard)
  // for creation.
  const hydratingRef = useRef(isEditMode);

  // Template-specific fields — only the ones relevant to the resolved
  // template are ever sent on submit.
  const [serialNumber, setSerialNumber] = useState('');
  const [acquiredAt, setAcquiredAt] = useState('');
  const [originWorld, setOriginWorld] = useState('');
  const [quantity, setQuantity] = useState('1');
  // "Descrição" (2026-07-15) — some items really do have flavor text in-game
  // (e.g. "is a legendary reward that can be obtained at halloween events"),
  // but no catalog field captures it for any category (confirmed: only
  // mega-stones have an auto-generated description, nothing general-purpose
  // exists) — same "seller types what the catalog can't supply" reasoning
  // already used for Número de Série/Data/Mundo de Origem. Reuses the
  // `notes` column that already existed on StoreItem/already accepted by
  // POST|PATCH /stores/me/items and already rendered on the storefront card
  // — it just never had a form input until now.
  const [notes, setNotes] = useState('');

  const [priceReal, setPriceReal] = useState('');
  const [priceHd, setPriceHd] = useState('');

  const [submitStatus, setSubmitStatus] = useState('idle'); // idle | saving | error
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setPageStatus('redirecting');
        navigate(`/${slug}`, { replace: true });
        return;
      }

      try {
        const idToken = await firebaseUser.getIdToken();
        const { store } = await getMyStore(idToken);
        if (!store || store.slug !== slug) {
          setPageStatus('redirecting');
          navigate(`/${slug}`, { replace: true });
          return;
        }

        if (isEditMode) {
          const fullStore = await getStoreBySlug(slug);
          const existing = (fullStore.StoreItem || []).find((row) => row.id === editId);
          if (!existing) {
            setPageStatus('redirecting');
            navigate(`/${slug}`, { replace: true });
            return;
          }

          hydratingRef.current = true;
          setItem(existing.CatalogItem || null);
          setSerialNumber(existing.serialNumber || '');
          setAcquiredAt(existing.acquiredAt || '');
          setOriginWorld(existing.originWorld || '');
          setQuantity(existing.quantity != null ? String(existing.quantity) : '1');
          setNotes(existing.notes || '');
          setPriceReal(existing.priceReal != null ? String(existing.priceReal) : '');
          setPriceHd(existing.priceHd != null ? String(existing.priceHd) : '');
        }

        setPageStatus('ready');
      } catch {
        setPageStatus('redirecting');
        navigate(`/${slug}`, { replace: true });
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // GET /store-item-options/:wikiPageId/template — fetch triggered by the
  // picked item changing, same "dependent field" pattern already used for
  // Mega Stone/Extra Moves Cap in AddPokemonListing.jsx via useFetch. Never
  // inspect category/extractedFields ourselves — always defer to this
  // endpoint for which fields to render.
  const { data: templateData } = useFetch(
    () => (item ? api.getItemTemplate(item.wikiPageId) : Promise.resolve(null)),
    [item?.wikiPageId]
  );

  const template = templateData?.template || null;
  const slots = templateData?.slots ?? null;
  const compatiblePokemon = templateData?.compatiblePokemon || [];

  // Changing the picked item clears every template-specific field — a value
  // typed for a previous item's template shouldn't silently carry over.
  // Skipped once in edit mode: the item goes from unset -> the pre-filled
  // existing item in the very same state-update batch that also sets
  // serialNumber/acquiredAt/originWorld/quantity from the existing listing
  // (see the ownership-check effect above) — without this guard, this
  // effect would immediately wipe out that same pre-fill right after it's
  // applied, since it only keys off item.wikiPageId changing, not who
  // changed it or why.
  useEffect(() => {
    if (hydratingRef.current) return;
    setSerialNumber('');
    setAcquiredAt('');
    setOriginWorld('');
    setQuantity('1');
    setNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.wikiPageId]);

  // Always runs last (declared after every guarded effect above) — flips
  // the hydration guard off after the commit it needed to suppress has had
  // its one chance to run. Any later, genuinely user-driven item change
  // finds this already false and resets normally.
  useEffect(() => {
    hydratingRef.current = false;
  });

  async function handleSubmit(event) {
    event.preventDefault();

    if (!item) {
      setSubmitStatus('error');
      setSubmitError('Escolha um item.');
      return;
    }

    if (priceReal === '' && priceHd === '') {
      setSubmitStatus('error');
      setSubmitError('Informe ao menos um preço (Real ou HD).');
      return;
    }

    if (!auth.currentUser) {
      setSubmitStatus('error');
      setSubmitError('Sua sessão expirou. Volte e entre de novo.');
      return;
    }

    setSubmitStatus('saving');
    setSubmitError('');

    try {
      const idToken = await auth.currentUser.getIdToken();

      if (isEditMode) {
        // PATCH semantics: a field key present in the body is the one
        // being touched. Unlike creation (where an empty optional field
        // simply means "never set"), an edit that empties a field the
        // listing already had needs to explicitly clear it — sending
        // `null` here, not omitting the key, is what actually clears it
        // server-side (see src/routes/stores.js's PATCH /me/items/:id).
        // catalogItemId is deliberately never sent — immutable after
        // creation, per the backend contract.
        await updateStoreItem(idToken, editId, {
          serialNumber: serialNumber.trim() || null,
          acquiredAt: acquiredAt.trim() || null,
          originWorld: originWorld || null,
          quantity: template === 'stackable' ? (quantity !== '' ? Number(quantity) : null) : undefined,
          notes: notes.trim() || null,
          priceReal: priceReal !== '' ? Number(priceReal) : null,
          priceHd: priceHd !== '' ? Number(priceHd) : null,
        });
      } else {
        await createStoreItem(idToken, {
          catalogItemId: item.wikiPageId,
          serialNumber: serialNumber.trim() || undefined,
          acquiredAt: acquiredAt.trim() || undefined,
          originWorld: originWorld || undefined,
          quantity: template === 'stackable' && quantity !== '' ? Number(quantity) : undefined,
          notes: notes.trim() || undefined,
          priceReal: priceReal !== '' ? Number(priceReal) : undefined,
          priceHd: priceHd !== '' ? Number(priceHd) : undefined,
        });
      }
      navigate(`/${slug}`);
    } catch (err) {
      setSubmitStatus('error');
      if (err.status === 400) {
        setSubmitError(err.message || 'Confira os campos obrigatórios e tente de novo.');
      } else if (err.status === 401) {
        setSubmitError('Sua sessão expirou. Volte e entre de novo.');
      } else if (err.status === 404) {
        setSubmitError('Não encontramos sua loja. Configure uma antes de anunciar.');
      } else {
        setSubmitError('Não conseguimos falar com o servidor agora. Tente de novo.');
      }
    }
  }

  const previewText = buildItemLookText({
    template,
    itemName: item?.name,
    serialNumber,
    acquiredAt,
    originWorldLabel: GAME_WORLD_LABELS[originWorld],
    slots,
    compatiblePokemon,
    quantity,
    notes,
  });

  const pageTitle = isEditMode ? 'Editar Item' : 'Anunciar Item';

  if (pageStatus !== 'ready') {
    return (
      <NewListingPageShell title={pageTitle}>
        <p>Carregando...</p>
      </NewListingPageShell>
    );
  }

  return (
    <NewListingPageShell
      title={pageTitle}
      backTo={`/${slug}`}
      backLabel="Voltar para minha loja"
      previewSlot={<LookPreviewCard title="Prévia do anúncio" text={previewText} />}
    >
      <form className="new-listing-form" onSubmit={handleSubmit}>
        <label>
          Item *
          <Autocomplete
            fetchOptions={fetchCatalogItems}
            value={item}
            onChange={setItem}
            placeholder="Buscar item..."
          />
        </label>

        {item?.category && (
          <label>
            Categoria
            <span className="new-listing-display-value">{formatCategoryLabel(item.category)}</span>
          </label>
        )}

        {template === 'addon' && compatiblePokemon.length > 0 && (
          <label>
            Pode ser usado em
            <span className="new-listing-display-value">{compatiblePokemon.join(', ')}</span>
          </label>
        )}

        {/* 2026-07-14 revisão: Número de Série/Data/Mundo de Origem deixaram
            de depender do template "legendary" resolvido pelo catálogo —
            esse sinal (classificationReason) cobre só 13 linhas conhecidas,
            deixando de fora itens genuinamente legendary que não foram
            tagueados numa sync antiga (lacuna documentada no CLAUDE.md). Em
            vez de esconder o campo até o catálogo saber que é legendary,
            os 3 campos ficam sempre disponíveis e opcionais em qualquer
            item — o vendedor sabe pelo próprio jogo se o item que tem é
            legendary, mesmo quando o catálogo ainda não sabe. */}
        <label>
          Número de Série
          <input
            type="number"
            min="1"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            placeholder="Opcional"
          />
        </label>

        <label>
          Data
          <input
            type="text"
            value={acquiredAt}
            onChange={(e) => setAcquiredAt(e.target.value)}
            placeholder="Ex: 03/11/2024 06:18:09 (opcional)"
          />
        </label>

        <label>
          Mundo de Origem
          <select value={originWorld} onChange={(e) => setOriginWorld(e.target.value)}>
            <option value="">Selecione... (opcional)</option>
            {GAME_WORLDS.map((world) => (
              <option key={world} value={world}>
                {GAME_WORLD_LABELS[world]}
              </option>
            ))}
          </select>
        </label>

        {template === 'backpack' && slots !== null && (
          <label>
            Slots
            <span className="new-listing-display-value">{slots}</span>
          </label>
        )}

        {template === 'stackable' && (
          <label>
            Quantidade
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => {
                const val = e.target.value;
                if (val !== '' && Number(val) < 1) return;
                setQuantity(val);
              }}
            />
          </label>
        )}

        <label>
          Descrição
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional — conte um pouco sobre esse item"
            rows={3}
          />
        </label>

        <div className="new-listing-multiselect">
          <span className="new-listing-multiselect-label">Preço</span>
          <p className="new-listing-price-hint">Preencha ao menos um dos dois.</p>
          <label>
            Preço em Real
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={priceReal}
              onChange={(e) => {
                const val = e.target.value;
                if (val !== '' && Number(val) <= 0) return;
                setPriceReal(val);
              }}
              placeholder="Ao menos um dos dois"
            />
          </label>
          <label>
            Preço em HD
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={priceHd}
              onChange={(e) => {
                const val = e.target.value;
                if (val !== '' && Number(val) <= 0) return;
                setPriceHd(val);
              }}
              placeholder="Ao menos um dos dois"
            />
          </label>
        </div>

        {submitStatus === 'error' && submitError && <p className="landing-auth-error">{submitError}</p>}

        <button
          type="submit"
          className="landing-btn landing-btn-primary landing-btn-lg"
          disabled={submitStatus === 'saving'}
        >
          {submitStatus === 'saving' ? 'Salvando...' : isEditMode ? 'Salvar alterações' : 'Anunciar Item'}
        </button>
      </form>
    </NewListingPageShell>
  );
}
