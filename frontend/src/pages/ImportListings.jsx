import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { api, getMyStore } from '../api';
import { NewListingPageShell } from '../components/NewListingPageShell';
import { Autocomplete } from '../components/Autocomplete';
import { LookPreviewCard } from '../components/LookPreviewCard';
import { parseLookText } from '../domain/parseLookText';
import { resolveImportDraft } from '../domain/resolveImportDraft';
import { mapWithConcurrency } from '../domain/asyncPool';
import { buildPokemonLookText, GENDER_LABELS, toSealName } from '../domain/buildPokemonLookText';
import { buildItemLookText, GAME_WORLD_LABELS } from '../domain/buildItemLookText';
import { GAME_WORLDS, ITEM_PICKER_EXCLUDED_CATEGORIES, NATURES } from '../domain/gameConstants';
import '../AddPokemonListing.css';

// How many blocks get resolved against the backend at once during
// "Analisar" — see asyncPool.js for why this is bounded instead of firing
// every block's requests in one big Promise.all. 1 = fully sequential, one
// block resolved at a time (requested explicitly — the gentlest possible
// load on the backend/Neon, at the cost of total analyze time scaling
// linearly with the number of pasted looks).
const ANALYZE_CONCURRENCY = 1;

async function fetchPokeballs(search) {
  const res = await api.getCatalogItems({ category: 'pokeballs', search, pageSize: 30 });
  return res.items;
}

async function fetchHeldItems(search) {
  const res = await api.getCatalogItems({ category: 'held-items', search, pageSize: 30 });
  return res.items;
}

async function fetchStickerBalls(search) {
  const res = await api.getCatalogItems({ category: 'sticker-balls', search, pageSize: 30 });
  return res.items;
}

async function fetchItems(search) {
  const res = await api.getCatalogItems({
    search,
    pageSize: 30,
    excludeCategories: ITEM_PICKER_EXCLUDED_CATEGORIES.join(','),
  });
  return res.items;
}

// Turns a resolved-field object ({ status, item, candidates }) plus the name
// captured from the pasted text into what the review screen needs to render
// — a resolved field shows read-only text with a "trocar" link, anything
// else (empty/needs-review, or a resolved field the user asked to override)
// shows the Autocomplete instead. Candidates from the original search are
// offered as one-click suggestion chips — this is how a `needs-review` field
// gets "pre-populated" per the plan, without needing to modify Autocomplete
// itself (which has no prop for a pre-filled search string).
function ResolvedFieldPicker({ label, name, resolved, fetchOptions, onChange, overriding, onToggleOverride, disabled, resetKey }) {
  const showPicker = resolved.status !== 'resolved' || overriding;

  return (
    <label>
      {label}
      {showPicker ? (
        <>
          <Autocomplete
            fetchOptions={fetchOptions}
            value={resolved.item}
            onChange={onChange}
            placeholder={name ? `Buscar (texto colado: "${name}")...` : 'Buscar...'}
            disabled={disabled}
            resetKey={resetKey}
          />
          {resolved.status === 'needs-review' && resolved.candidates.length > 0 && (
            <div className="import-listing-suggestions">
              {resolved.candidates.slice(0, 5).map((candidate) => (
                <button
                  type="button"
                  key={candidate.wikiPageId}
                  className="import-listing-suggestion-chip"
                  onClick={() => onChange(candidate)}
                >
                  {candidate.name}
                </button>
              ))}
            </div>
          )}
          {resolved.status === 'needs-review' && name && (
            <p className="import-listing-review-hint">
              Não encontramos exatamente &quot;{name}&quot; no catálogo — escolha manualmente.
            </p>
          )}
        </>
      ) : (
        <div className="import-listing-resolved-value">
          <span>{resolved.item?.name}</span>
          <button type="button" className="import-listing-swap-link" onClick={onToggleOverride}>
            trocar
          </button>
        </div>
      )}
    </label>
  );
}

function buildPokemonPreviewText(draft) {
  return buildPokemonLookText({
    pokeballName: draft.pokeball.item?.name,
    pokemonName: draft.pokemon.item?.name,
    level: draft.fields.level,
    genderLabel: GENDER_LABELS[draft.fields.gender],
    nature: draft.fields.nature,
    nickname: draft.fields.nickname,
    addonCount: draft.equippedAddon.item ? 1 : undefined,
    equippedAddonName: draft.equippedAddon.item?.name,
    boost: draft.fields.boost,
    capturedAt: draft.fields.capturedAt,
    heldItemName: draft.heldItem.item?.name,
    megaStoneName: draft.megaStone.item?.name,
    stickerNames: draft.stickers.filter((s) => s.item).map((s) => toSealName(s.item.name)),
    extraMoveCount: draft.fields.extraMoveCount,
    presetSlotCount: draft.fields.presetSlotCount,
  });
}

// Synthetic `template` only decides whether the "Quantidade" line renders —
// same simplification already used by buildExportText.js, for the same
// reason (avoids one GET /store-item-options/:id/template call per draft
// just for a live preview; doesn't imply the item's real template was
// checked).
function buildItemPreviewText(draft) {
  const numericQuantity = Number(draft.fields.quantity);
  return buildItemLookText({
    template: Number.isFinite(numericQuantity) && numericQuantity > 1 ? 'stackable' : 'default',
    itemName: draft.item.item?.name,
    serialNumber: draft.fields.serialNumber,
    acquiredAt: draft.fields.acquiredAt,
    originWorldLabel: GAME_WORLD_LABELS[draft.fields.originWorld],
    slots: null,
    compatiblePokemon: [],
    quantity: draft.fields.quantity,
    notes: draft.fields.notes,
  });
}

// Drives the tab bar's status badge — whether ANY field on the draft still
// needs a manual pick, so the user can spot which "window" needs attention
// without having to open every one of them.
function draftNeedsReview(draft) {
  if (draft.kind === 'pokemon') {
    const simpleFields = [draft.pokeball, draft.pokemon, draft.heldItem, draft.megaStone, draft.equippedAddon];
    return simpleFields.some((f) => f.status === 'needs-review') || draft.stickers.some((s) => s.status === 'needs-review');
  }
  if (draft.kind === 'item') return draft.item.status === 'needs-review';
  return false;
}

function draftTabLabel(draft, index) {
  const n = index + 1;
  if (draft.kind === 'unparseable') return `Não reconhecido ${n}`;
  return draft.kind === 'pokemon' ? `Pokémon ${n}` : `Item ${n}`;
}

function draftTabStatus(draft) {
  if (draft.kind === 'unparseable') return 'error';
  if (draft.submitStatus === 'done') return 'done';
  if (draft.submitStatus === 'error') return 'error';
  if (draftNeedsReview(draft)) return 'review';
  return 'ready';
}

function validatePokemonDraft(draft) {
  if (!draft.pokeball.item) return 'Resolva a Pokébola antes de confirmar.';
  if (!draft.pokemon.item) return 'Resolva o Pokémon antes de confirmar.';
  if (!draft.fields.level) return 'Informe o Nível.';
  if (!draft.fields.gender) return 'Informe o Gênero.';
  if (!draft.fields.nature) return 'Informe a Nature.';
  if (draft.priceReal === '' && draft.priceHd === '') return 'Informe ao menos um preço (Real ou HD).';
  return null;
}

function validateItemDraft(draft) {
  if (!draft.item.item) return 'Resolva o Item antes de confirmar.';
  if (draft.priceReal === '' && draft.priceHd === '') return 'Informe ao menos um preço (Real ou HD).';
  return null;
}

function buildPokemonPayload(draft) {
  return {
    pokeballCatalogItemId: draft.pokeball.item?.wikiPageId,
    pokemonCatalogItemId: draft.pokemon.item?.wikiPageId,
    level: draft.fields.level !== '' ? Number(draft.fields.level) : undefined,
    gender: draft.fields.gender || undefined,
    nature: draft.fields.nature || undefined,
    nickname: draft.fields.nickname?.trim() || undefined,
    addonCatalogItemIds: draft.equippedAddon.item ? [draft.equippedAddon.item.wikiPageId] : undefined,
    equippedAddonCatalogItemId: draft.equippedAddon.item?.wikiPageId,
    boost: draft.fields.boost !== '' ? Number(draft.fields.boost) : undefined,
    capturedAt: draft.fields.capturedAt?.trim() || undefined,
    heldItemCatalogItemId: draft.heldItem.item?.wikiPageId,
    megaStoneCatalogItemId: draft.megaStone.item?.wikiPageId,
    stickerCatalogItemIds: draft.stickers.some((s) => s.item)
      ? draft.stickers.filter((s) => s.item).map((s) => s.item.wikiPageId)
      : undefined,
    extraMoveCount: draft.fields.extraMoveCount !== '' ? Number(draft.fields.extraMoveCount) : undefined,
    presetSlotCount: draft.fields.presetSlotCount !== '' ? Number(draft.fields.presetSlotCount) : undefined,
    priceReal: draft.priceReal !== '' ? Number(draft.priceReal) : undefined,
    priceHd: draft.priceHd !== '' ? Number(draft.priceHd) : undefined,
  };
}

function buildItemPayload(draft) {
  const numericQuantity = Number(draft.fields.quantity);
  return {
    catalogItemId: draft.item.item?.wikiPageId,
    serialNumber: draft.fields.serialNumber?.trim() || undefined,
    acquiredAt: draft.fields.acquiredAt?.trim() || undefined,
    originWorld: draft.fields.originWorld || undefined,
    quantity: Number.isFinite(numericQuantity) && numericQuantity >= 1 ? numericQuantity : undefined,
    notes: draft.fields.notes?.trim() || undefined,
    priceReal: draft.priceReal !== '' ? Number(draft.priceReal) : undefined,
    priceHd: draft.priceHd !== '' ? Number(draft.priceHd) : undefined,
  };
}

// Page for the "paste look text(s) → review → create" bulk-import flow —
// see CLAUDE.md's dated section for the full feature writeup. Same
// full-page-via-navigate() convention as every other multi-field screen in
// this project (AddPokemonListing.jsx/AddItemListing.jsx/StoreSettings.jsx),
// re-verifies store ownership on mount the same way (never trusts arriving
// via URL implies ownership).
export function ImportListings() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [pageStatus, setPageStatus] = useState('loading'); // loading | ready | redirecting
  const [rawText, setRawText] = useState('');
  const [analyzeStatus, setAnalyzeStatus] = useState('idle'); // idle | analyzing
  // { done, total } while analyzing — see asyncPool.js/handleAnalyze: each
  // block is now resolved AND has its tab appended to `drafts` as one
  // atomic step, so this counter only ever moves forward, never plateaus.
  const [analyzeProgress, setAnalyzeProgress] = useState(null);
  // `null` until the first "Analisar". Once analysis starts this is
  // pre-sized to the parsed block count and filled in place as each block
  // finishes (see handleAnalyze) — a `null` slot means that block is still
  // being resolved in the background. Requested explicitly: don't wait for
  // the whole paste to finish before showing anything — a draft's tab
  // appears the moment IT is ready, so the user can already start
  // reviewing/editing it while the rest keep loading behind it.
  const [drafts, setDrafts] = useState(null);
  // Which draft's "window" is currently shown — several drafts never stack
  // one form below another, only one is visible at a time, switched via the
  // tab bar (or the ‹ › buttons) rendered below.
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);

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
        setPageStatus('ready');
      } catch {
        setPageStatus('redirecting');
        navigate(`/${slug}`, { replace: true });
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  function updateDraft(index, updater) {
    setDrafts((current) => current.map((draft, i) => (i === index ? updater(draft) : draft)));
  }

  async function handleAnalyze() {
    setAnalyzeStatus('analyzing');

    const parsedBlocks = parseLookText(rawText);
    setAnalyzeProgress({ done: 0, total: parsedBlocks.length });
    // Pre-sized with `null` placeholders — a slot fills in (and its tab
    // appears) the moment that one block finishes, not when the whole
    // batch does. See asyncPool.js for why ANALYZE_CONCURRENCY bounds how
    // many of these run at once.
    setDrafts(new Array(parsedBlocks.length).fill(null));
    setActiveDraftIndex(0);

    let doneCount = 0;
    await mapWithConcurrency(parsedBlocks, ANALYZE_CONCURRENCY, async (parsed, index) => {
      const resolved = await resolveImportDraft(parsed);

      // Extra Moves cap is per-species (see GET
      // /store-pokemon-options/pokemon/:wikiPageId/extra-moves-cap, same
      // endpoint AddPokemonListing.jsx's form uses) — resolved as part of
      // this same block's step, not a separate pass over every block
      // afterwards, so a block's tab only ever appears once it's fully
      // ready to edit.
      let maxExtraMoves = 0;
      if (resolved.kind === 'pokemon' && resolved.pokemon.item) {
        const cap = await api.getExtraMovesCap(resolved.pokemon.item.wikiPageId);
        maxExtraMoves = cap?.maxExtraMoves ?? 0;
      }

      const finalDraft = {
        ...resolved,
        maxExtraMoves,
        // Pre-filled when the pasted text already carried a "Preço Real"/
        // "Preço HD" line (see parseLookText.js/buildExportText.js) — this
        // is our own export addition, not part of the real in-game look
        // text, so plain manually-copied game text won't have it and these
        // fall back to blank exactly as before.
        priceReal: resolved.fields?.priceReal || '',
        priceHd: resolved.fields?.priceHd || '',
        submitStatus: 'idle',
        submitError: '',
        overriding: {},
      };

      setDrafts((current) => {
        const next = [...current];
        next[index] = finalDraft;
        return next;
      });
      doneCount += 1;
      setAnalyzeProgress({ done: doneCount, total: parsedBlocks.length });
    });

    setAnalyzeProgress(null);
    setAnalyzeStatus('idle');
  }

  function toggleOverride(index, fieldKey) {
    updateDraft(index, (draft) => ({
      ...draft,
      overriding: { ...draft.overriding, [fieldKey]: !draft.overriding[fieldKey] },
    }));
  }

  function handlePokeballChange(index, newPokeball) {
    updateDraft(index, (draft) => ({
      ...draft,
      pokeball: { status: newPokeball ? 'resolved' : 'needs-review', item: newPokeball, candidates: draft.pokeball.candidates },
      pokemon: { status: 'needs-review', item: null, candidates: [] },
      megaStoneCompat: [],
      addonCompatAll: [],
      megaStone: { status: 'empty', item: null, candidates: [] },
      equippedAddon: { status: 'empty', item: null, candidates: [] },
      maxExtraMoves: 0,
      overriding: { ...draft.overriding, pokeball: false },
    }));
  }

  async function handlePokemonChange(index, newPokemon) {
    updateDraft(index, (draft) => ({
      ...draft,
      pokemon: { status: newPokemon ? 'resolved' : 'needs-review', item: newPokemon, candidates: draft.pokemon.candidates },
      megaStone: { status: 'empty', item: null, candidates: [] },
      equippedAddon: { status: 'empty', item: null, candidates: [] },
      megaStoneCompat: [],
      addonCompatAll: [],
      maxExtraMoves: 0,
      overriding: { ...draft.overriding, pokemon: false },
    }));

    if (!newPokemon) return;

    const [megaStoneCompat, addonCompatAll, cap] = await Promise.all([
      api.getMegaStonesFor(newPokemon.wikiTitle),
      api.getAddonsFor(newPokemon.wikiTitle),
      api.getExtraMovesCap(newPokemon.wikiPageId),
    ]);

    updateDraft(index, (draft) => ({
      ...draft,
      megaStoneCompat: megaStoneCompat || [],
      addonCompatAll: addonCompatAll || [],
      maxExtraMoves: cap?.maxExtraMoves ?? 0,
    }));
  }

  function handleSimpleFieldChange(index, fieldKey, newItem) {
    updateDraft(index, (draft) => ({
      ...draft,
      [fieldKey]: { status: newItem ? 'resolved' : 'empty', item: newItem, candidates: draft[fieldKey].candidates },
      overriding: { ...draft.overriding, [fieldKey]: false },
    }));
  }

  function handleStickerChange(index, stickerIndex, newItem) {
    updateDraft(index, (draft) => ({
      ...draft,
      stickers: draft.stickers.map((sticker, i) =>
        i === stickerIndex ? { ...sticker, status: newItem ? 'resolved' : 'needs-review', item: newItem } : sticker
      ),
      overriding: { ...draft.overriding, [`sticker-${stickerIndex}`]: false },
    }));
  }

  function handleItemChange(index, newItem) {
    updateDraft(index, (draft) => ({
      ...draft,
      item: { status: newItem ? 'resolved' : 'needs-review', item: newItem, candidates: draft.item.candidates },
      overriding: { ...draft.overriding, item: false },
    }));
  }

  function setDraftField(index, path, value) {
    updateDraft(index, (draft) => ({ ...draft, fields: { ...draft.fields, [path]: value } }));
  }

  async function confirmDraftAt(index) {
    const draft = drafts[index];
    if (!draft || draft.kind === 'unparseable' || draft.submitStatus === 'done') return;

    const validationError = draft.kind === 'pokemon' ? validatePokemonDraft(draft) : validateItemDraft(draft);
    if (validationError) {
      updateDraft(index, (d) => ({ ...d, submitStatus: 'error', submitError: validationError }));
      return;
    }

    if (!auth.currentUser) {
      updateDraft(index, (d) => ({ ...d, submitStatus: 'error', submitError: 'Sua sessão expirou. Volte e entre de novo.' }));
      return;
    }

    updateDraft(index, (d) => ({ ...d, submitStatus: 'saving', submitError: '' }));

    try {
      const idToken = await auth.currentUser.getIdToken();
      if (draft.kind === 'pokemon') {
        await api.createStorePokemon(idToken, buildPokemonPayload(draft));
      } else {
        await api.createStoreItem(idToken, buildItemPayload(draft));
      }
      updateDraft(index, (d) => ({ ...d, submitStatus: 'done', submitError: '' }));
    } catch (err) {
      updateDraft(index, (d) => ({
        ...d,
        submitStatus: 'error',
        submitError: err.message || 'Não foi possível criar este anúncio agora.',
      }));
    }
  }

  async function confirmAllReady() {
    if (!drafts) return;
    for (let i = 0; i < drafts.length; i += 1) {
      // `null` = that block is still being resolved in the background (see
      // handleAnalyze) — nothing to confirm yet, skip it rather than crash.
      if (!drafts[i] || drafts[i].kind === 'unparseable' || drafts[i].submitStatus === 'done') continue;
      // eslint-disable-next-line no-await-in-loop
      await confirmDraftAt(i);
    }
  }

  if (pageStatus !== 'ready') {
    return (
      <NewListingPageShell title="Importar Anúncios">
        <p>Carregando...</p>
      </NewListingPageShell>
    );
  }

  return (
    <NewListingPageShell title="Importar Anúncios" backTo={`/${slug}`} backLabel="Voltar para minha loja">
      <div className="new-listing-form">
        <p className="import-listing-intro">
          Cole abaixo um ou vários textos de &quot;look&quot; (inspecionar) copiados do jogo — Pokémon e Itens
          podem ser colados juntos, um após o outro. Cada um vira um rascunho que você revisa antes de criar
          de verdade.
        </p>
        <label>
          Textos de look
          <textarea
            rows={10}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Cole aqui um ou mais textos de look..."
          />
        </label>
        <button
          type="button"
          className="landing-btn landing-btn-primary"
          onClick={handleAnalyze}
          disabled={analyzeStatus === 'analyzing' || !rawText.trim()}
        >
          {analyzeStatus === 'analyzing'
            ? `Analisando... (${analyzeProgress?.done ?? 0}/${analyzeProgress?.total ?? 0})`
            : 'Analisar'}
        </button>
      </div>

      {drafts && drafts.length === 0 && (
        <p className="import-listing-warning">Nenhum texto de look reconhecido no que foi colado.</p>
      )}

      {drafts && drafts.length > 0 && (
        <>
          <div className="import-listing-batch-actions">
            <button type="button" className="landing-btn landing-btn-outline" onClick={confirmAllReady}>
              Confirmar todos os prontos
            </button>
          </div>

          {/* Windows you switch between — never several forms stacked one
              below the other. Each tab shows a status badge (✅ criado,
              ⚠️ erro/não reconhecido, ● precisa de revisão) so it's clear
              which ones still need attention without opening every one. */}
          <div className="import-listing-tabbar" role="tablist" aria-label="Rascunhos importados">
            <button
              type="button"
              className="import-listing-tab-nav"
              onClick={() => setActiveDraftIndex((i) => Math.max(0, i - 1))}
              disabled={activeDraftIndex === 0}
              aria-label="Rascunho anterior"
            >
              ‹
            </button>
            <div className="import-listing-tabs">
              {drafts.map((draft, index) => {
                // Still being resolved in the background (see
                // handleAnalyze) — shown disabled so it's visible that more
                // are on the way, but there's nothing to switch to yet.
                if (!draft) {
                  return (
                    <button key={index} type="button" role="tab" className="import-listing-tab import-listing-tab-loading" disabled>
                      Rascunho {index + 1} ⏳
                    </button>
                  );
                }
                const status = draftTabStatus(draft);
                const isActive = index === activeDraftIndex;
                return (
                  <button
                    key={index}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`import-listing-tab import-listing-tab-${status}${isActive ? ' import-listing-tab-active' : ''}`}
                    onClick={() => setActiveDraftIndex(index)}
                  >
                    {draftTabLabel(draft, index)}
                    {status === 'done' && <span aria-hidden="true"> ✅</span>}
                    {status === 'error' && <span aria-hidden="true"> ⚠️</span>}
                    {status === 'review' && <span aria-hidden="true"> ●</span>}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="import-listing-tab-nav"
              onClick={() => setActiveDraftIndex((i) => Math.min(drafts.length - 1, i + 1))}
              disabled={activeDraftIndex === drafts.length - 1}
              aria-label="Próximo rascunho"
            >
              ›
            </button>
          </div>

          <div className="import-listing-drafts">
            {(() => {
              const draft = drafts[activeDraftIndex];
              if (!draft) {
                return (
                  <div className="new-listing-form import-listing-draft-card">
                    <p>Ainda analisando este rascunho...</p>
                  </div>
                );
              }
              if (draft.kind === 'unparseable') {
                return (
                  <div className="new-listing-form import-listing-draft-card">
                    <p className="import-listing-warning">Não conseguimos reconhecer este texto como Pokémon ou Item:</p>
                    <pre className="import-listing-raw-block">{draft.rawText}</pre>
                  </div>
                );
              }
              if (draft.kind === 'pokemon') {
                return (
                  <PokemonDraftCard
                    draft={draft}
                    index={activeDraftIndex}
                    onFieldChange={setDraftField}
                    onPokeballChange={handlePokeballChange}
                    onPokemonChange={handlePokemonChange}
                    onSimpleFieldChange={handleSimpleFieldChange}
                    onStickerChange={handleStickerChange}
                    onToggleOverride={toggleOverride}
                    onSetPrice={(field, value) => updateDraft(activeDraftIndex, (d) => ({ ...d, [field]: value }))}
                    onConfirm={() => confirmDraftAt(activeDraftIndex)}
                  />
                );
              }
              return (
                <ItemDraftCard
                  draft={draft}
                  index={activeDraftIndex}
                  onFieldChange={setDraftField}
                  onItemChange={handleItemChange}
                  onToggleOverride={toggleOverride}
                  onSetPrice={(field, value) => updateDraft(activeDraftIndex, (d) => ({ ...d, [field]: value }))}
                  onConfirm={() => confirmDraftAt(activeDraftIndex)}
                />
              );
            })()}
          </div>
        </>
      )}
    </NewListingPageShell>
  );
}

function PokemonDraftCard({
  draft,
  index,
  onFieldChange,
  onPokeballChange,
  onPokemonChange,
  onSimpleFieldChange,
  onStickerChange,
  onToggleOverride,
  onSetPrice,
  onConfirm,
}) {
  const restrictToCherishBall = draft.pokeball.item?.name === 'Cherish Ball';
  const genderOptions = draft.pokemon.item?.genderOptions || (draft.fields.gender ? [draft.fields.gender] : []);
  const previewText = buildPokemonPreviewText(draft);

  return (
    <div className="new-listing-form import-listing-draft-card">
      <h3 className="import-listing-draft-title">Pokémon — rascunho {index + 1}</h3>

      {draft.unrecognizedLines?.length > 0 && (
        <p className="import-listing-warning">
          Linhas não reconhecidas (ignoradas): {draft.unrecognizedLines.join(' | ')}
        </p>
      )}
      {draft.fields.addonCount > 1 && (
        <p className="import-listing-warning">
          O texto colado diz {draft.fields.addonCount} addons, mas só conseguimos identificar{' '}
          {draft.equippedAddon.item ? 1 : 0} pelo nome — adicione os outros manualmente se quiser.
        </p>
      )}

      <ResolvedFieldPicker
        label="Pokébola *"
        name={draft.fields.pokeballName || undefined}
        resolved={draft.pokeball}
        fetchOptions={fetchPokeballs}
        onChange={(item) => onPokeballChange(index, item)}
        overriding={draft.overriding.pokeball}
        onToggleOverride={() => onToggleOverride(index, 'pokeball')}
      />

      <ResolvedFieldPicker
        label="Pokémon *"
        name={draft.fields.pokemonName || undefined}
        resolved={draft.pokemon}
        fetchOptions={(search) => api.getPokemonOptions({ search, restrictToCherishBall }).then((r) => r.items)}
        onChange={(item) => onPokemonChange(index, item)}
        overriding={draft.overriding.pokemon}
        onToggleOverride={() => onToggleOverride(index, 'pokemon')}
        disabled={!draft.pokeball.item}
        resetKey={draft.pokeball.item?.wikiPageId}
      />

      <label>
        Nível *
        <input
          type="number"
          min="1"
          value={draft.fields.level}
          onChange={(e) => onFieldChange(index, 'level', e.target.value)}
        />
      </label>

      <label>
        Gênero *
        <select value={draft.fields.gender} onChange={(e) => onFieldChange(index, 'gender', e.target.value)}>
          <option value="">Selecione...</option>
          {genderOptions.map((option) => (
            <option key={option} value={option}>
              {GENDER_LABELS[option] || option}
            </option>
          ))}
        </select>
      </label>

      <label>
        Nature *
        <select value={draft.fields.nature} onChange={(e) => onFieldChange(index, 'nature', e.target.value)}>
          <option value="">Selecione...</option>
          {NATURES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label>
        Nickname
        <input type="text" value={draft.fields.nickname} onChange={(e) => onFieldChange(index, 'nickname', e.target.value)} />
      </label>

      {draft.addonCompatAll.length > 0 && (
        <ResolvedFieldPicker
          label="Usando (addon equipado)"
          name={draft.fields.equippedAddonName || undefined}
          resolved={draft.equippedAddon}
          fetchOptions={(search) => api.getAddonsFor(draft.pokemon.item.wikiTitle, search)}
          onChange={(item) => onSimpleFieldChange(index, 'equippedAddon', item)}
          overriding={draft.overriding.equippedAddon}
          onToggleOverride={() => onToggleOverride(index, 'equippedAddon')}
          resetKey={draft.pokemon.item?.wikiPageId}
        />
      )}

      <label>
        Boost
        <input type="number" min="0" value={draft.fields.boost} onChange={(e) => onFieldChange(index, 'boost', e.target.value)} />
      </label>

      <label>
        Data de captura
        <input type="text" value={draft.fields.capturedAt} onChange={(e) => onFieldChange(index, 'capturedAt', e.target.value)} />
      </label>

      <ResolvedFieldPicker
        label="Held Item"
        name={draft.fields.heldItemName || undefined}
        resolved={draft.heldItem}
        fetchOptions={fetchHeldItems}
        onChange={(item) => onSimpleFieldChange(index, 'heldItem', item)}
        overriding={draft.overriding.heldItem}
        onToggleOverride={() => onToggleOverride(index, 'heldItem')}
      />

      {draft.megaStoneCompat.length > 0 && (
        <ResolvedFieldPicker
          label="Mega Stone"
          name={draft.fields.megaStoneName || undefined}
          resolved={draft.megaStone}
          fetchOptions={() => Promise.resolve(draft.megaStoneCompat)}
          onChange={(item) => onSimpleFieldChange(index, 'megaStone', item)}
          overriding={draft.overriding.megaStone}
          onToggleOverride={() => onToggleOverride(index, 'megaStone')}
          resetKey={draft.pokemon.item?.wikiPageId}
        />
      )}

      {draft.stickers.length > 0 && (
        <div className="new-listing-multiselect">
          <span className="new-listing-multiselect-label">Stickers</span>
          {draft.stickers.map((sticker, stickerIndex) => (
            <ResolvedFieldPicker
              key={stickerIndex}
              label={`Sticker: ${sticker.name}`}
              name={sticker.name}
              resolved={sticker}
              fetchOptions={fetchStickerBalls}
              onChange={(item) => onStickerChange(index, stickerIndex, item)}
              overriding={draft.overriding[`sticker-${stickerIndex}`]}
              onToggleOverride={() => onToggleOverride(index, `sticker-${stickerIndex}`)}
            />
          ))}
        </div>
      )}

      <label>
        Extra Moves
        <input
          type="number"
          min="0"
          max={draft.maxExtraMoves}
          value={draft.fields.extraMoveCount}
          onChange={(e) => onFieldChange(index, 'extraMoveCount', e.target.value)}
        />
      </label>

      <label>
        Preset Slots
        <input
          type="number"
          min="0"
          max="3"
          value={draft.fields.presetSlotCount}
          onChange={(e) => onFieldChange(index, 'presetSlotCount', e.target.value)}
        />
      </label>

      <div className="new-listing-multiselect">
        <span className="new-listing-multiselect-label">Preço</span>
        <p className="new-listing-price-hint">Preencha ao menos um dos dois — pré-preenchido quando o texto colado já trazia "Preço Real"/"Preço HD" (nosso formato de export), em branco quando é um look colado direto do jogo.</p>
        <label>
          Preço em Real
          <input type="number" min="0.01" step="0.01" value={draft.priceReal} onChange={(e) => onSetPrice('priceReal', e.target.value)} />
        </label>
        <label>
          Preço em HD
          <input type="number" min="0.01" step="0.01" value={draft.priceHd} onChange={(e) => onSetPrice('priceHd', e.target.value)} />
        </label>
      </div>

      <LookPreviewCard title="Prévia" text={previewText} />

      {draft.submitStatus === 'error' && draft.submitError && <p className="landing-auth-error">{draft.submitError}</p>}
      {draft.submitStatus === 'done' ? (
        <p className="import-listing-done">Criado ✅</p>
      ) : (
        <button type="button" className="landing-btn landing-btn-primary" onClick={onConfirm} disabled={draft.submitStatus === 'saving'}>
          {draft.submitStatus === 'saving' ? 'Salvando...' : 'Confirmar e Criar'}
        </button>
      )}
    </div>
  );
}

function ItemDraftCard({ draft, index, onFieldChange, onItemChange, onToggleOverride, onSetPrice, onConfirm }) {
  const previewText = buildItemPreviewText(draft);

  return (
    <div className="new-listing-form import-listing-draft-card">
      <h3 className="import-listing-draft-title">Item — rascunho {index + 1}</h3>

      <ResolvedFieldPicker
        label="Item *"
        name={draft.fields.itemName || undefined}
        resolved={draft.item}
        fetchOptions={fetchItems}
        onChange={(item) => onItemChange(index, item)}
        overriding={draft.overriding.item}
        onToggleOverride={() => onToggleOverride(index, 'item')}
      />

      <label>
        Número de Série
        <input type="text" value={draft.fields.serialNumber} onChange={(e) => onFieldChange(index, 'serialNumber', e.target.value)} />
      </label>

      <label>
        Data
        <input type="text" value={draft.fields.acquiredAt} onChange={(e) => onFieldChange(index, 'acquiredAt', e.target.value)} />
      </label>

      <label>
        Mundo de Origem
        <select value={draft.fields.originWorld} onChange={(e) => onFieldChange(index, 'originWorld', e.target.value)}>
          <option value="">Selecione... (opcional)</option>
          {GAME_WORLDS.map((world) => (
            <option key={world} value={world}>
              {GAME_WORLD_LABELS[world]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Quantidade
        <input type="number" min="1" value={draft.fields.quantity} onChange={(e) => onFieldChange(index, 'quantity', e.target.value)} />
      </label>

      <label>
        Descrição
        <textarea rows={3} value={draft.fields.notes} onChange={(e) => onFieldChange(index, 'notes', e.target.value)} />
      </label>

      <div className="new-listing-multiselect">
        <span className="new-listing-multiselect-label">Preço</span>
        <p className="new-listing-price-hint">Preencha ao menos um dos dois — pré-preenchido quando o texto colado já trazia "Preço Real"/"Preço HD" (nosso formato de export), em branco quando é um look colado direto do jogo.</p>
        <label>
          Preço em Real
          <input type="number" min="0.01" step="0.01" value={draft.priceReal} onChange={(e) => onSetPrice('priceReal', e.target.value)} />
        </label>
        <label>
          Preço em HD
          <input type="number" min="0.01" step="0.01" value={draft.priceHd} onChange={(e) => onSetPrice('priceHd', e.target.value)} />
        </label>
      </div>

      <LookPreviewCard title="Prévia" text={previewText} />

      {draft.submitStatus === 'error' && draft.submitError && <p className="landing-auth-error">{draft.submitError}</p>}
      {draft.submitStatus === 'done' ? (
        <p className="import-listing-done">Criado ✅</p>
      ) : (
        <button type="button" className="landing-btn landing-btn-primary" onClick={onConfirm} disabled={draft.submitStatus === 'saving'}>
          {draft.submitStatus === 'saving' ? 'Salvando...' : 'Confirmar e Criar'}
        </button>
      )}
    </div>
  );
}
