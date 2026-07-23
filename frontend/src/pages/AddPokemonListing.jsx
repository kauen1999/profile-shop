import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { api, createStorePokemon, getMyStore, getStoreBySlug, updateStorePokemon } from '../api';
import { NewListingPageShell } from '../components/NewListingPageShell';
import { Autocomplete } from '../components/Autocomplete';
import { MultiSelectPicker } from '../components/MultiSelectPicker';
import { LookPreviewCard } from '../components/LookPreviewCard';
import { PokemonSpritePreview } from '../components/PokemonSpritePreview';
import { makeAddonOptionRenderer } from '../components/renderAddonOption';
import { useFetch } from '../hooks/useFetch';
import { buildPokemonLookText, GENDER_LABELS, toSealName } from '../domain/buildPokemonLookText';
import { GAME_WORLD_LABELS } from '../domain/buildItemLookText';
import { NATURES } from '../domain/gameConstants';
import { findAddonLooktypeUrl, isMigratedImageUrl, isShinyPokemonName } from '../domain/resolveAddonSprite';
import '../AddPokemonListing.css';

async function fetchPokeballs(search) {
  const res = await api.getCatalogItems({ category: 'pokeballs', search, nameOnly: true, pageSize: 30 });
  return res.items;
}

async function fetchHeldItems(search) {
  const res = await api.getCatalogItems({ category: 'held-items', search, nameOnly: true, pageSize: 30 });
  return res.items;
}

async function fetchStickerBalls(search) {
  const res = await api.getCatalogItems({ category: 'sticker-balls', search, nameOnly: true, pageSize: 30 });
  return res.items;
}

// Pure derivation (no state, no effect) of which sprite URL the visual
// preview should show — recomputed every render straight from current
// Pokémon/addon selection, per plan.
function resolveSpritePreviewUrl(pokemonItem, equippedAddonItem) {
  if (!pokemonItem) return null;
  if (!equippedAddonItem) return pokemonItem.imageUrl || null;

  const isShiny = isShinyPokemonName(pokemonItem.name);

  // `equippedAddonItem` comes in one of two shapes depending on how it got
  // set: the flattened one GET /store-pokemon-options/addons returns (right
  // after a fresh Autocomplete pick, already resolved for the current
  // species) has looktypeImageUrl/looktypeShinyImageUrl directly on it; the
  // raw CatalogItem row used to pre-fill an existing listing for edit (see
  // the ownership-check effect above — same gap already documented for
  // genderOptions just below) only carries
  // extractedFields.addonCompatibilities. Try the flat fields first, fall
  // back to resolving from the raw shape so both paths show the same
  // looktype sprite instead of silently falling back to the base sprite in
  // edit mode.
  const flatPreferred = isShiny ? equippedAddonItem.looktypeShinyImageUrl : equippedAddonItem.looktypeImageUrl;
  const preferred = isMigratedImageUrl(flatPreferred)
    ? flatPreferred
    : findAddonLooktypeUrl(equippedAddonItem, pokemonItem.wikiTitle, isShiny);

  // Falls back to the plain Pokémon sprite whenever the addon has no
  // looktype data for this species (regex-fallback addons) or the looktype
  // image hasn't been migrated off the wiki yet — never requests a URL
  // known to be unusable in the real app.
  return isMigratedImageUrl(preferred) ? preferred : pokemonItem.imageUrl || null;
}

export function AddPokemonListing() {
  const { slug, storePokemonId } = useParams();
  const navigate = useNavigate();

  // Presence of :storePokemonId (only matched by the .../editar route, see
  // App.jsx) is what signals edit mode — same component as creation.
  const isEditMode = storePokemonId !== undefined;
  const editId = isEditMode ? Number(storePokemonId) : null;

  // loading | ready | redirecting — mirrors StoreSettings.jsx's pageStatus
  // pattern: doesn't trust arriving via URL implies ownership, re-verifies
  // via the same onAuthStateChanged → getMyStore → compare slug technique
  // already used in StoreProfile.jsx. In edit mode, also fetches the
  // existing listing (public GET /stores/:slug, same route StoreProfile.jsx
  // already uses — no dedicated edit-fetch endpoint) before flipping to
  // 'ready'.
  const [pageStatus, setPageStatus] = useState('loading');

  // Guards the "changing Pokébola/Pokémon clears dependent fields" effects
  // below from wiping out the values this same render just pre-filled from
  // the existing listing — see those effects for the full explanation. Only
  // relevant in edit mode; stays false (no-op guard) for creation.
  const hydratingRef = useRef(isEditMode);

  // ---- form state, in the exact fill order from the plan ----
  const [pokeball, setPokeball] = useState(null);
  const [pokemon, setPokemon] = useState(null);
  const [level, setLevel] = useState('');
  const [gender, setGender] = useState('');
  const [nature, setNature] = useState('');
  const [nickname, setNickname] = useState('');
  const [selectedAddons, setSelectedAddons] = useState([]); // full addon objects (name/imageUrl/looktype*)
  const [equippedAddon, setEquippedAddon] = useState(null); // must always be one of selectedAddons
  const [boost, setBoost] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [heldItem, setHeldItem] = useState(null);
  const [megaStone, setMegaStone] = useState(null);
  const [stickers, setStickers] = useState([]); // array of catalog items
  const [extraMoveCount, setExtraMoveCount] = useState('');
  const [presetSlotCount, setPresetSlotCount] = useState('');

  // Mundo — options come from the store's own registered worlds
  // (Store.StoreWorld, set in Configurações da loja), never a hardcoded
  // list of all 7. Auto-filled below when the store only has one.
  const [world, setWorld] = useState('');
  const [worldOptions, setWorldOptions] = useState([]);

  // Commercial/listing data, not part of the in-game "look" — same reasoning
  // that already keeps World out of this form. Both optional/independent,
  // never referenced by the textual or visual look preview.
  const [priceReal, setPriceReal] = useState('');
  const [priceHd, setPriceHd] = useState('');

  // Compatibility list driving whether "Mega Stone" renders at all — never a
  // hardcoded per-species condition, always whatever the backend returns for
  // the current species. (Addons compatibility is now fetched directly by
  // the multi-select's own Autocomplete search, no separate list needed —
  // see MultiSelectPicker/AddonPicker below.)
  const [megaStoneCompat, setMegaStoneCompat] = useState([]);

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

        const storeWorldOptions = (store.StoreWorld || []).map((w) => w.world);
        setWorldOptions(storeWorldOptions);

        if (isEditMode) {
          const fullStore = await getStoreBySlug(slug);
          const existing = (fullStore.StorePokemon || []).find((row) => row.id === editId);
          if (!existing) {
            setPageStatus('redirecting');
            navigate(`/${slug}`, { replace: true });
            return;
          }

          hydratingRef.current = true;
          setPokeball(existing.CatalogItem_StorePokemon_pokeballCatalogItemIdToCatalogItem || null);
          setPokemon(existing.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem || null);
          setLevel(existing.level != null ? String(existing.level) : '');
          setGender(existing.gender || '');
          setNature(existing.nature || '');
          setWorld(existing.world || '');
          setNickname(existing.nickname || '');
          setSelectedAddons((existing.StorePokemonAddon || []).map((row) => row.CatalogItem).filter(Boolean));
          setEquippedAddon(existing.CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem || null);
          setBoost(existing.boost != null ? String(existing.boost) : '');
          setCapturedAt(existing.capturedAt || '');
          setHeldItem(existing.CatalogItem_StorePokemon_heldItemCatalogItemIdToCatalogItem || null);
          setMegaStone(existing.CatalogItem_StorePokemon_megaStoneCatalogItemIdToCatalogItem || null);
          setStickers((existing.StorePokemonSticker || []).map((row) => row.CatalogItem).filter(Boolean));
          setExtraMoveCount(existing.extraMoveCount != null ? String(existing.extraMoveCount) : '');
          setPresetSlotCount(existing.presetSlotCount != null ? String(existing.presetSlotCount) : '');
          setPriceReal(existing.priceReal != null ? String(existing.priceReal) : '');
          setPriceHd(existing.priceHd != null ? String(existing.priceHd) : '');
        } else if (storeWorldOptions.length === 1) {
          // Only one world registered for this store — no reason to make
          // the owner pick it explicitly every time.
          setWorld(storeWorldOptions[0]);
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

  // Changing Pokébola clears: Pokémon, Usando, Mega Stone. Skipped once in
  // edit mode — pokeball goes from unset -> the pre-filled existing ball in
  // the very same state-update batch that also pre-fills pokemon/
  // equippedAddon/megaStone (see the ownership-check effect above); without
  // this guard, this effect would immediately wipe that same pre-fill right
  // back out, since it only keys off pokeball.wikiPageId changing, not who
  // changed it or why.
  useEffect(() => {
    if (hydratingRef.current) return;
    setPokemon(null);
    setEquippedAddon(null);
    setMegaStone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokeball?.wikiPageId]);

  // Changing Pokémon clears: Gênero, Addons (species-specific, fetched by
  // wikiTitle), Usando, Mega Stone, Extra Moves (the per-species cap changes,
  // a previously-typed value could now exceed the new max) — and
  // re-triggers the mega-stone compatibility fetch for the new species (or
  // clears it out when there is no species selected). The clearing part is
  // skipped once in edit mode (same reasoning as the pokeball effect above),
  // but the mega-stone compatibility fetch itself always still runs even
  // while hydrating — it's what makes the "Mega Stone" field render at all,
  // and the pre-filled `megaStone` value needs that field to exist to be
  // visible.
  useEffect(() => {
    if (!hydratingRef.current) {
      setGender('');
      setSelectedAddons([]);
      setEquippedAddon(null);
      setMegaStone(null);
      setExtraMoveCount('');
    }

    if (!pokemon) {
      setMegaStoneCompat([]);
      return undefined;
    }

    let cancelled = false;
    api.getMegaStonesFor(pokemon.wikiTitle).then((list) => {
      if (!cancelled) setMegaStoneCompat(list || []);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokemon?.wikiPageId]);

  // Reactive rule (step 8, per plan): if the currently-chosen "Usando" addon
  // gets deselected from the Addons multi-select, clear "Usando"
  // automatically — in addition to the pokemon-change clear above. Not
  // guarded by hydratingRef: during edit-mode pre-fill, equippedAddon is
  // always a member of the pre-filled selectedAddons set by construction
  // (the backend enforces that invariant on write — see
  // src/routes/stores.js), so this never fires spuriously during hydration;
  // if it ever finds a genuine mismatch (e.g. corrupted data), clearing is
  // the correct, safe behavior anyway.
  useEffect(() => {
    if (equippedAddon && !selectedAddons.some((a) => a.wikiPageId === equippedAddon.wikiPageId)) {
      setEquippedAddon(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddons]);

  // Always runs last (declared after every guarded effect above) — flips
  // the hydration guard off after the commit it needed to suppress has had
  // its one chance to run. Any later, genuinely user-driven pokéball/Pokémon
  // change finds this already false and resets normally.
  useEffect(() => {
    hydratingRef.current = false;
  });

  // GET /store-pokemon-options/pokemon/:wikiPageId/extra-moves-cap — same
  // "fetch triggered by a dependent-field change" pattern already used for
  // Mega Stone/Addons above, via the shared useFetch hook.
  const { data: extraMovesCap } = useFetch(
    () => (pokemon ? api.getExtraMovesCap(pokemon.wikiPageId) : Promise.resolve(null)),
    [pokemon?.wikiPageId]
  );
  const maxExtraMoves = extraMovesCap?.maxExtraMoves ?? 0;

  function toggleAddon(item) {
    setSelectedAddons((current) => {
      const exists = current.some((a) => a.wikiPageId === item.wikiPageId);
      if (exists) return current.filter((a) => a.wikiPageId !== item.wikiPageId);
      return [...current, item];
    });
  }

  // Custom thumb for the Addons picker's dropdown rows — shows the current
  // Pokémon actually wearing each addon (same composite the sprite preview
  // and the storefront modal use), not the addon's own generic icon, so the
  // user can tell them apart before picking one. Shared with
  // ImportListings.jsx's "Usando" picker — see renderAddonOption.jsx.
  const renderAddonOption = makeAddonOptionRenderer(pokemon?.name);

  function toggleSticker(item) {
    setStickers((current) => {
      const exists = current.some((s) => s.wikiPageId === item.wikiPageId);
      if (exists) return current.filter((s) => s.wikiPageId !== item.wikiPageId);
      return [...current, item];
    });
  }

  const restrictToCherishBall = pokeball?.name === 'Cherish Ball';

  // `genderOptions` only exists on rows returned by
  // GET /store-pokemon-options/pokemon (computed there, never stored on
  // CatalogItem itself — see storePokemonOptions.js). In edit mode, the
  // pre-filled `pokemon` is a raw CatalogItem from GET /stores/:slug and
  // won't have it. Falling back to "just the already-picked gender" keeps
  // the <select> showing the real current value instead of rendering
  // empty/mismatched — the fuller option set reappears once the user
  // re-picks a species through the Autocomplete (which does hit the
  // dedicated endpoint).
  const genderOptions = pokemon?.genderOptions || (gender ? [gender] : []);

  // Same "fall back to just the already-picked value" reasoning as
  // genderOptions above — if this listing's current world was removed from
  // the store's registered worlds since it was created (edit mode), the
  // <select> still shows the real current value instead of silently
  // resetting to nothing.
  const effectiveWorldOptions =
    world && !worldOptions.includes(world) ? [...worldOptions, world] : worldOptions;

  const spritePreviewUrl = resolveSpritePreviewUrl(pokemon, equippedAddon);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!pokeball || !pokemon || !level || !gender || !nature || !world) {
      setSubmitStatus('error');
      setSubmitError('Preencha os campos obrigatórios: Pokébola, Pokémon, Nível, Gênero, Nature e Mundo.');
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
        // being touched, and `null` (not omission) is what clears it — see
        // src/routes/stores.js's PATCH /me/pokemon/:id. Unlike creation,
        // this form now has a fully accurate pre-fill (including
        // addons/stickers/equipped-addon, resolved straight from the
        // extended GET /stores/:slug payload), so it's safe and correct to
        // always send the full addon/sticker sets here — including
        // deliberately empty arrays, which is exactly how the user clears
        // them via the pickers.
        await updateStorePokemon(idToken, editId, {
          pokeballCatalogItemId: pokeball.wikiPageId,
          pokemonCatalogItemId: pokemon.wikiPageId,
          level: Number(level),
          gender,
          nature,
          world,
          nickname: nickname.trim() || null,
          addonCatalogItemIds: selectedAddons.map((a) => a.wikiPageId),
          equippedAddonCatalogItemId: equippedAddon?.wikiPageId ?? null,
          boost: boost !== '' ? Number(boost) : null,
          capturedAt: capturedAt.trim() || null,
          heldItemCatalogItemId: heldItem?.wikiPageId ?? null,
          megaStoneCatalogItemId: megaStone?.wikiPageId ?? null,
          stickerCatalogItemIds: stickers.map((s) => s.wikiPageId),
          extraMoveCount: extraMoveCount !== '' ? Number(extraMoveCount) : null,
          presetSlotCount: presetSlotCount !== '' ? Number(presetSlotCount) : null,
          priceReal: priceReal !== '' ? Number(priceReal) : null,
          priceHd: priceHd !== '' ? Number(priceHd) : null,
        });
      } else {
        await createStorePokemon(idToken, {
          pokeballCatalogItemId: pokeball.wikiPageId,
          pokemonCatalogItemId: pokemon.wikiPageId,
          level: Number(level),
          gender,
          nature,
          world,
          nickname: nickname.trim() || undefined,
          addonCatalogItemIds: selectedAddons.length ? selectedAddons.map((a) => a.wikiPageId) : undefined,
          equippedAddonCatalogItemId: equippedAddon?.wikiPageId,
          boost: boost !== '' ? Number(boost) : undefined,
          capturedAt: capturedAt.trim() || undefined,
          heldItemCatalogItemId: heldItem?.wikiPageId,
          megaStoneCatalogItemId: megaStone?.wikiPageId,
          stickerCatalogItemIds: stickers.length ? stickers.map((s) => s.wikiPageId) : undefined,
          extraMoveCount: extraMoveCount !== '' ? Number(extraMoveCount) : undefined,
          presetSlotCount: presetSlotCount !== '' ? Number(presetSlotCount) : undefined,
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

  const previewText = buildPokemonLookText({
    pokeballName: pokeball?.name,
    pokemonName: pokemon?.name,
    level,
    genderLabel: GENDER_LABELS[gender],
    nature,
    nickname,
    addonCount: selectedAddons.length || undefined,
    equippedAddonName: equippedAddon?.name,
    boost,
    capturedAt,
    heldItemName: heldItem?.name,
    megaStoneName: megaStone?.name,
    stickerNames: stickers.map((s) => toSealName(s.name)),
    extraMoveCount,
    presetSlotCount,
  });

  const pageTitle = isEditMode ? 'Editar Pokémon' : 'Anunciar Pokémon';

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
      previewSlot={
        <>
          <PokemonSpritePreview key={spritePreviewUrl} imageUrl={spritePreviewUrl} alt={pokemon?.name} boost={boost} />
          <LookPreviewCard title="Prévia do anúncio" text={previewText} />
        </>
      }
    >
      <form className="new-listing-form" onSubmit={handleSubmit}>
        <label>
          Pokébola *
          <Autocomplete
            fetchOptions={fetchPokeballs}
            value={pokeball}
            onChange={setPokeball}
            placeholder="Buscar pokébola..."
          />
        </label>

        <label>
          Pokémon *
          <Autocomplete
            fetchOptions={(search) => api.getPokemonOptions({ search, restrictToCherishBall }).then((r) => r.items)}
            value={pokemon}
            onChange={setPokemon}
            placeholder="Buscar Pokémon..."
            disabled={!pokeball}
            resetKey={pokeball?.wikiPageId}
          />
        </label>

        <label>
          Nível *
          <input
            type="number"
            min="1"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            required
          />
        </label>

        <label>
          Gênero *
          <select value={gender} onChange={(e) => setGender(e.target.value)} disabled={!pokemon} required>
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
          <select value={nature} onChange={(e) => setNature(e.target.value)} required>
            <option value="">Selecione...</option>
            {NATURES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label>
          Mundo *
          <select
            value={world}
            onChange={(e) => setWorld(e.target.value)}
            disabled={worldOptions.length === 0}
            required
          >
            <option value="">Selecione...</option>
            {effectiveWorldOptions.map((w) => (
              <option key={w} value={w}>
                {GAME_WORLD_LABELS[w] || w}
              </option>
            ))}
          </select>
        </label>
        {worldOptions.length === 0 && (
          <p className="new-listing-field-hint">
            Sua loja ainda não tem nenhum mundo cadastrado — adicione um em Configurações antes de
            anunciar um Pokémon.
          </p>
        )}

        <label>
          Nickname
          <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Opcional" />
        </label>

        <div className="new-listing-multiselect">
          <span className="new-listing-multiselect-label">Addons</span>
          <MultiSelectPicker
            fetchOptions={(search) =>
              pokemon ? api.getAddonsFor(pokemon.wikiTitle, search) : Promise.resolve([])
            }
            selected={selectedAddons}
            onToggle={toggleAddon}
            placeholder="Buscar addon..."
            disabled={!pokemon}
            resetKey={pokemon?.wikiPageId}
            renderOption={renderAddonOption}
          />
        </div>

        {selectedAddons.length > 0 && (
          <label>
            Usando (addon equipado)
            <select
              value={equippedAddon?.wikiPageId ?? ''}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setEquippedAddon(id ? selectedAddons.find((a) => a.wikiPageId === id) || null : null);
              }}
            >
              <option value="">Nenhum</option>
              {selectedAddons.map((addon) => (
                <option key={addon.wikiPageId} value={addon.wikiPageId}>
                  {addon.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Boost
          <input
            type="number"
            min="0"
            value={boost}
            onChange={(e) => {
              const val = e.target.value;
              // Reject negative client-side too (backend rejects it either
              // way, but this avoids a round trip for an obviously-invalid
              // value) — min 0, no max, per 2026-07-14 revision.
              if (val !== '' && Number(val) < 0) return;
              setBoost(val);
            }}
            placeholder="Opcional"
          />
        </label>

        <label>
          Data de captura
          <input
            type="text"
            value={capturedAt}
            onChange={(e) => setCapturedAt(e.target.value)}
            placeholder="Ex: 12/12/2024"
          />
        </label>

        <label>
          Held Item
          <Autocomplete
            fetchOptions={fetchHeldItems}
            value={heldItem}
            onChange={setHeldItem}
            placeholder="Buscar held item..."
          />
        </label>

        {megaStoneCompat.length > 0 && (
          <label>
            Mega Stone
            <Autocomplete
              fetchOptions={() => api.getMegaStonesFor(pokemon.wikiTitle)}
              value={megaStone}
              onChange={setMegaStone}
              placeholder="Buscar mega stone..."
              resetKey={pokemon?.wikiPageId}
            />
          </label>
        )}

        <div className="new-listing-multiselect">
          <span className="new-listing-multiselect-label">Stickers</span>
          <MultiSelectPicker
            fetchOptions={fetchStickerBalls}
            selected={stickers}
            onToggle={toggleSticker}
            placeholder="Buscar sticker..."
            getLabel={(item) => toSealName(item.name)}
            renderOption={(item, meta) => (
              <>
                {meta && typeof meta.selected === 'boolean' && (
                  <input
                    type="checkbox"
                    checked={meta.selected}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                    className="autocomplete-option-checkbox"
                  />
                )}
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="autocomplete-option-thumb"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                )}
                <span>{toSealName(item.name)}</span>
              </>
            )}
          />
        </div>

        <label>
          Extra Moves
          <input
            type="number"
            min="0"
            max={maxExtraMoves}
            value={extraMoveCount}
            disabled={!pokemon}
            onChange={(e) => {
              const val = e.target.value;
              if (val !== '' && (Number(val) < 0 || Number(val) > maxExtraMoves)) return;
              setExtraMoveCount(val);
            }}
            placeholder="Opcional"
          />
        </label>

        <label>
          Preset Slots
          <input
            type="number"
            min="0"
            max="3"
            value={presetSlotCount}
            onChange={(e) => {
              const val = e.target.value;
              if (val !== '' && (Number(val) < 0 || Number(val) > 3)) return;
              setPresetSlotCount(val);
            }}
            placeholder="Opcional"
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
          {submitStatus === 'saving' ? 'Salvando...' : isEditMode ? 'Salvar alterações' : 'Anunciar Pokémon'}
        </button>
      </form>
    </NewListingPageShell>
  );
}
