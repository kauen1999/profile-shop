// Async name→CatalogItem resolution for the "import listings from look text"
// feature. Reuses exactly the endpoints the manual creation forms
// (AddPokemonListing.jsx/AddItemListing.jsx) already call through `api.js` —
// no new backend endpoint, no new api.js function. Never fuzzy-matches in
// the sense of "similar enough" — a name either matches exactly one
// candidate (after the fixed, deterministic normalization below) or the
// field is flagged `needs-review` for the user to pick by hand in
// ImportListings.jsx. A wrong automatic guess is worse than asking, but two
// real cases reported by a user surfaced that "exact" was too strict:
// pasted "Pokéhouse" (with an accent) never matched the catalog's
// "PokeHouse" (without one), and "Masterball" (no space) never matched
// "Master Ball" — the backend's search is a plain case-insensitive `ILIKE`,
// it doesn't fold accents or ignore whitespace, so neither variant even
// came back as a candidate to compare against. Fixed at the matching layer,
// not the backend, and still strictly a normalized-EQUALITY check, never a
// similarity score — the risk is bounded the same way it always was: if
// normalization makes two genuinely different catalog names collide, the
// result is `needs-review` (ambiguous), never a wrong silent pick.

import { api } from '../api';
import { ITEM_PICKER_EXCLUDED_CATEGORIES } from './gameConstants';

// How much of a name still counts as "distinctive enough to search with"
// when the exact/accent-stripped variants come back empty — see
// buildSearchVariants below. A heuristic, not a rule: long enough that most
// item names are still unambiguous by their first few characters, short
// enough to survive one missing space (e.g. "Masterball" → "Master").
const PREFIX_FALLBACK_LENGTH = 6;

function normalizeForMatch(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics (é → e, ã → a, ...)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // drop spaces/punctuation — "Master Ball" and "Masterball" become the same key
}

function stripDiacritics(name) {
  return (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Query strings to try against the backend's `search` param, in order,
// stopping as soon as one yields exactly one normalized match. The backend
// does a literal case-insensitive `ILIKE` (see src/routes/catalogItems.js) —
// it can't find "PokeHouse" from a query still carrying an accent, or
// "Master Ball" from a query with no space, because the substring simply
// isn't there. So the retries change what we SEND, not just what we compare
// against: 1) the raw pasted name (works whenever spacing/accents already
// match), 2) the same name with diacritics stripped (fixes the accent
// case), 3) a short alphanumeric-only prefix of that (fixes the
// missing-space case, since the real name's first word is still a literal
// substring of it).
function buildSearchVariants(name) {
  const variants = [name];

  const stripped = stripDiacritics(name);
  if (stripped !== name) variants.push(stripped);

  const alnumOnly = stripped.replace(/[^a-zA-Z0-9]/g, '');
  if (alnumOnly.length > PREFIX_FALLBACK_LENGTH) {
    variants.push(alnumOnly.slice(0, PREFIX_FALLBACK_LENGTH));
  }

  return variants;
}

// A resolved field always has this shape: { status, item, candidates }.
// - status: 'empty' (no name to resolve — field wasn't in the pasted text),
//   'resolved' (exactly one normalized-name match), or 'needs-review' (0 or
//   2+ matches — candidates pre-populates the Autocomplete shown in review).
// - item: the matched CatalogItem, or null.
// - candidates: every distinct row seen across all search variants tried
//   (used to pre-populate the Autocomplete dropdown when the user has to
//   pick manually — the more variants tried, the better that fallback list
//   tends to be too).
async function resolveExactName(name, fetchCandidates) {
  if (!name) return { status: 'empty', item: null, candidates: [] };

  const target = normalizeForMatch(name);
  const seenIds = new Set();
  const allCandidates = [];

  for (const variant of buildSearchVariants(name)) {
    // eslint-disable-next-line no-await-in-loop
    const found = (await fetchCandidates(variant)) || [];
    for (const candidate of found) {
      if (!seenIds.has(candidate.wikiPageId)) {
        seenIds.add(candidate.wikiPageId);
        allCandidates.push(candidate);
      }
    }

    const matches = found.filter((candidate) => normalizeForMatch(candidate.name) === target);
    if (matches.length === 1) {
      return { status: 'resolved', item: matches[0], candidates: allCandidates };
    }
    if (matches.length > 1) {
      // Ambiguous already within this variant's own results — trying a
      // looser variant next could only add more candidates, never resolve
      // the ambiguity, so stop here instead of drowning the review picker
      // in duplicates.
      return { status: 'needs-review', item: null, candidates: allCandidates };
    }
  }

  return { status: 'needs-review', item: null, candidates: allCandidates };
}

async function fetchPokeballCandidates(search) {
  const res = await api.getCatalogItems({ category: 'pokeballs', search, nameOnly: true, pageSize: 30 });
  return res.items;
}

async function fetchHeldItemCandidates(search) {
  const res = await api.getCatalogItems({ category: 'held-items', search, nameOnly: true, pageSize: 30 });
  return res.items;
}

async function fetchStickerCandidates(search) {
  const res = await api.getCatalogItems({ category: 'sticker-balls', search, nameOnly: true, pageSize: 30 });
  return res.items;
}

async function fetchItemCandidates(search) {
  const res = await api.getCatalogItems({
    search,
    nameOnly: true,
    pageSize: 30,
    excludeCategories: ITEM_PICKER_EXCLUDED_CATEGORIES.join(','),
  });
  return res.items;
}

// Resolves one parsed Pokémon block (see parseLookText.js) into a draft
// ready for ImportListings.jsx to render/edit/submit. Steps run in the same
// dependency order the manual form's reactive effects already establish:
// pokéball first (decides the Cherish Ball restriction), then Pokémon (whose
// wikiTitle unlocks the mega-stone/addon compatibility lookups), then
// everything else.
export async function resolvePokemonDraft(parsed) {
  const f = parsed.fields;

  const pokeball = await resolveExactName(f.pokeballName, fetchPokeballCandidates);

  const restrictToCherishBall = pokeball.item?.name === 'Cherish Ball';
  const pokemon = await resolveExactName(f.pokemonName, (search) =>
    api.getPokemonOptions({ search, restrictToCherishBall }).then((r) => r.items)
  );

  let megaStoneCompat = [];
  if (pokemon.item) {
    megaStoneCompat = await api.getMegaStonesFor(pokemon.item.wikiTitle);
  }

  const equippedAddon = pokemon.item
    ? await resolveExactName(f.equippedAddonName, (search) => api.getAddonsFor(pokemon.item.wikiTitle, search))
    : { status: f.equippedAddonName ? 'needs-review' : 'empty', item: null, candidates: [] };

  const megaStone = pokemon.item
    ? await resolveExactName(f.megaStoneName, () => Promise.resolve(megaStoneCompat))
    : { status: f.megaStoneName ? 'needs-review' : 'empty', item: null, candidates: [] };

  const heldItem = await resolveExactName(f.heldItemName, fetchHeldItemCandidates);

  const stickers = await Promise.all(
    f.stickerNames.map(async (name) => ({
      name,
      ...(await resolveExactName(name, fetchStickerCandidates)),
    }))
  );

  return {
    kind: 'pokemon',
    rawText: parsed.rawText,
    unrecognizedLines: parsed.unrecognizedLines,
    fields: {
      // Names captured verbatim from the pasted text — kept alongside the
      // resolved-field objects below (never overwritten once a match is
      // found) purely so ImportListings.jsx can show "texto colado: X" hints
      // and pre-fill the Autocomplete placeholder when a field needs review.
      pokeballName: f.pokeballName,
      pokemonName: f.pokemonName,
      heldItemName: f.heldItemName,
      megaStoneName: f.megaStoneName,
      equippedAddonName: f.equippedAddonName,
      level: f.level,
      gender: f.gender,
      nickname: f.nickname,
      addonCount: f.addonCount,
      boost: f.boost,
      nature: f.nature,
      capturedAt: f.capturedAt,
      // Already a plain GameWorld enum value (or '') — parseLookText.js's
      // GAME_WORLD_VALUE_BY_LABEL already did the label→enum inversion, same
      // as `gender` above; no async catalog resolution needed, same as
      // resolveItemDraft's `originWorld` below.
      world: f.world,
      extraMoveCount: f.extraMoveCount,
      presetSlotCount: f.presetSlotCount,
      priceReal: f.priceReal,
      priceHd: f.priceHd,
    },
    pokeball,
    pokemon,
    megaStoneCompat,
    equippedAddon,
    // The full addon set (2026-07-18, bug fix) — the pasted text only ever
    // carries a count ("Addons: N") and the identity of the one equipped
    // addon, never the other N-1 (documented, permanent limitation of the
    // look-text format — see CLAUDE.md). Pre-filled with just the equipped
    // one when resolved (never inventing the rest), same starting point
    // AddPokemonListing.jsx's own `selectedAddons` would have for a single
    // known addon — the user adds the rest manually via the same
    // MultiSelectPicker the manual form uses, in ImportListings.jsx.
    selectedAddons: equippedAddon.item ? [equippedAddon.item] : [],
    megaStone,
    heldItem,
    stickers,
  };
}

// Resolves one parsed Item block. A single lookup — items don't have the
// Pokémon flow's dependency chain.
export async function resolveItemDraft(parsed) {
  const f = parsed.fields;
  const item = await resolveExactName(f.itemName, fetchItemCandidates);

  return {
    kind: 'item',
    rawText: parsed.rawText,
    fields: {
      // Kept alongside `item` (the resolved field) for the same hint/
      // placeholder reason as the Pokémon fields above.
      itemName: f.itemName,
      serialNumber: f.serialNumber,
      acquiredAt: f.acquiredAt,
      originWorld: f.originWorld,
      quantity: f.quantity,
      notes: f.notes,
      priceReal: f.priceReal,
      priceHd: f.priceHd,
    },
    item,
  };
}

// Dispatches a single parsed block (from parseLookText.js) to the right
// resolver by kind. `unparseable` blocks pass straight through — there's
// nothing to resolve, ImportListings.jsx shows them as a raw-text error.
export async function resolveImportDraft(parsed) {
  if (parsed.kind === 'pokemon') return resolvePokemonDraft(parsed);
  if (parsed.kind === 'item') return resolveItemDraft(parsed);
  return { kind: 'unparseable', rawText: parsed.rawText };
}
