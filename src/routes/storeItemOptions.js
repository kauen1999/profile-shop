const express = require('express');
const { prisma } = require('../db');
const { asyncHandler } = require('../asyncHandler');

const router = express.Router();

// Resolves the "look-field template" for a given CatalogItem, purely from
// its metadata (category / extractedFields) — NEVER from item name/
// appearance. Priority order confirmed against real DB data during planning
// (see CLAUDE.md's "Criação de anúncio de Item" section for the full
// rationale and known data gaps):
//
//   1. extractedFields.classificationReason === 'legendary_item_index_table'
//      -> 'legendary'. Only 13 real rows carry this flag today — a known,
//      documented data-completeness gap (some items literally named
//      "Legendary X" don't have it, e.g. "Legendary Grandfather Statue" has
//      classificationReason: 'collectible_coverage_gap_sync' instead). Do
//      NOT compensate with name matching — the flag is ground truth as-is.
//   2. category === 'backpacks' -> 'backpack'. extractedFields.
//      backpackSlotCapacity is present on 78/142 rows, absent on the rest —
//      return null when absent, never guess. No weight/"peso" field exists
//      anywhere for backpacks (confirmed) — never fabricate one.
//   3. category === 'addons' -> 'addon'. extractedFields.addonCompatibilities
//      is an array of { pokemonWikiTitle, ... } (already used by the
//      Pokémon-listing flow, see GET /store-pokemon-options/addons) — return
//      the list of pokemonWikiTitle strings.
//   4. category === 'materials' -> 'stackable'. A documented approximation —
//      there is no real "stackable" flag anywhere in the catalog;
//      category === 'materials' is just the best available real-data proxy.
//   5. else -> 'default' (no extra fields).
function resolveItemTemplate(item) {
  const extractedFields = item.extractedFields || {};

  if (extractedFields.classificationReason === 'legendary_item_index_table') {
    return { template: 'legendary', slots: null, compatiblePokemon: [] };
  }

  if (item.category === 'backpacks') {
    const slots =
      typeof extractedFields.backpackSlotCapacity === 'number'
        ? extractedFields.backpackSlotCapacity
        : null;
    return { template: 'backpack', slots, compatiblePokemon: [] };
  }

  if (item.category === 'addons') {
    const compatibilities = Array.isArray(extractedFields.addonCompatibilities)
      ? extractedFields.addonCompatibilities
      : [];
    const compatiblePokemon = compatibilities
      .map((c) => c?.pokemonWikiTitle)
      .filter((title) => typeof title === 'string' && title.trim());
    return { template: 'addon', slots: null, compatiblePokemon };
  }

  if (item.category === 'materials') {
    return { template: 'stackable', slots: null, compatiblePokemon: [] };
  }

  return { template: 'default', slots: null, compatiblePokemon: [] };
}

// GET /store-item-options/:wikiPageId/template — public, read-only catalog
// lookup feeding the "create Item listing" frontend form. No requireAuth
// needed (nothing mutates, nothing user-specific), same as
// storePokemonOptions.js. Wrapped in asyncHandler per this project's
// mandatory convention.
router.get(
  '/:wikiPageId/template',
  asyncHandler(async (req, res) => {
    const wikiPageId = Number(req.params.wikiPageId);
    if (!Number.isInteger(wikiPageId)) {
      return res.status(400).json({ error: 'wikiPageId inválido.' });
    }

    const item = await prisma.catalogItem.findUnique({ where: { wikiPageId } });
    if (!item) {
      return res.status(404).json({ error: 'CatalogItem não encontrado para este wikiPageId.' });
    }

    res.json(resolveItemTemplate(item));
  })
);

// resolveItemTemplate is re-exported so POST /stores/me/items
// (src/routes/stores.js) can recompute the same template server-side —
// never trust a client-supplied template string, same "never trust client,
// recompute" principle already used for the Pokémon form's
// extra-moves-cap validation (see storePokemonOptions.js).
module.exports = router;
module.exports.resolveItemTemplate = resolveItemTemplate;
