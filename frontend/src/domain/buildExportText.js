// Pure export builder — the reverse direction of the import feature. Reads
// the exact same nested shape StoreProfile.jsx already gets from
// `getStoreBySlug` (no fetch of its own) and feeds
// buildPokemonLookText.js/buildItemLookText.js, the same builders the
// creation forms already use for their live preview. Sibling to
// StoreListingCard.jsx's buildPokemonCardDetails/buildItemCardDetails (same
// source rows, same relation names) but producing full "look" text instead
// of short display pills.

import { buildPokemonLookText, GENDER_LABELS, toSealName } from './buildPokemonLookText';
import { buildItemLookText, GAME_WORLD_LABELS } from './buildItemLookText';

// Price is NOT part of the real in-game look text (buildPokemonLookText.js/
// buildItemLookText.js stay pure — they're also used for the creation
// forms' live preview, which must keep matching exactly what the game
// itself generates). These two lines are an export-only addition, appended
// after the real look text, so a store's listings can round-trip through
// Import without the owner having to retype every price by hand.
// parseLookText.js reads these back with the exact inverse of this format.
function buildPriceLines(priceReal, priceHd) {
  const lines = [];
  if (priceReal != null) lines.push(`Preço Real: R$ ${priceReal}`);
  if (priceHd != null) lines.push(`Preço HD: ${priceHd} HD`);
  return lines;
}

// Same "export-only, not real in-game text" reasoning as buildPriceLines
// above — `world` is a required field on every Pokémon listing (see
// POST /stores/me/pokemon), but it's app-internal (which of the store's own
// registered worlds this listing is under, added 2026-07-17), never part of
// buildPokemonLookText.js's pure preview text and never shown by the real
// game's own look command. Without this line, an exported Pokémon could
// never round-trip back through Import — the field is mandatory but the
// text carrying it never mentioned it, so re-importing always failed
// validation server-side with "world é obrigatório" (bug found and fixed
// 2026-07-18, this same entry — see CLAUDE.md).
function buildWorldLine(world) {
  return world ? [`Mundo: ${GAME_WORLD_LABELS[world] || world}`] : [];
}

function buildPokemonExportText(raw) {
  const pokeballName = raw.CatalogItem_StorePokemon_pokeballCatalogItemIdToCatalogItem?.name;
  const pokemonName = raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem?.name;
  const heldItemName = raw.CatalogItem_StorePokemon_heldItemCatalogItemIdToCatalogItem?.name;
  const megaStoneName = raw.CatalogItem_StorePokemon_megaStoneCatalogItemIdToCatalogItem?.name;
  const equippedAddonName = raw.CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem?.name;
  const addonCount = raw.StorePokemonAddon?.length || undefined;
  const stickerNames = (raw.StorePokemonSticker || [])
    .map((row) => row.CatalogItem?.name)
    .filter(Boolean)
    .map(toSealName);

  const lookText = buildPokemonLookText({
    pokeballName,
    pokemonName,
    level: raw.level ?? undefined,
    genderLabel: raw.gender ? GENDER_LABELS[raw.gender] : undefined,
    nature: raw.nature ?? undefined,
    nickname: raw.nickname ?? undefined,
    addonCount,
    equippedAddonName,
    boost: raw.boost ?? undefined,
    capturedAt: raw.capturedAt ?? undefined,
    heldItemName,
    megaStoneName,
    stickerNames: stickerNames.length > 0 ? stickerNames : undefined,
    extraMoveCount: raw.extraMoveCount ?? undefined,
    presetSlotCount: raw.presetSlotCount ?? undefined,
  });

  const worldLine = buildWorldLine(raw.world);
  const priceLines = buildPriceLines(raw.priceReal, raw.priceHd);
  return [lookText, ...worldLine, ...priceLines].join('\n');
}

// Simplification deliberately mirrored from the plan: doesn't call
// GET /store-item-options/:id/template per item (would be N synchronous
// network round-trips just to export). "Slots"/"Pode ser usado em" are
// purely informational and the importer already ignores them on the way
// back in (see parseLookText.js) — omitting them here loses nothing needed
// to reimport. `template` here is a synthetic value only used to decide
// whether buildItemLookText renders the "Quantidade" line — it does NOT
// imply the item's real template was checked.
function buildItemExportText(raw) {
  const quantity = raw.quantity;

  const lookText = buildItemLookText({
    template: quantity > 1 ? 'stackable' : 'default',
    itemName: raw.CatalogItem?.name,
    serialNumber: raw.serialNumber ?? undefined,
    acquiredAt: raw.acquiredAt ?? undefined,
    originWorldLabel: raw.originWorld ? GAME_WORLD_LABELS[raw.originWorld] : undefined,
    slots: null,
    compatiblePokemon: [],
    quantity,
    notes: raw.notes ?? undefined,
  });

  const priceLines = buildPriceLines(raw.priceReal, raw.priceHd);
  return [lookText, ...priceLines].join('\n');
}

// `store` is the object returned by GET /stores/:slug (already loaded by
// StoreProfile.jsx — no network call happens here). Only `status: 'ACTIVE'`
// listings are exported (confirmed decision — reimporting shouldn't recreate
// hidden/sold "ghosts"). Blocks are joined in the same createdAt-desc order
// StoreProfile.jsx already displays them in, separated by a double blank
// line.
export function buildStoreExportText(store) {
  const itemBlocks = (store.StoreItem || [])
    .filter((raw) => raw.status === 'ACTIVE')
    .map((raw) => ({ createdAt: raw.createdAt, text: buildItemExportText(raw) }));

  const pokemonBlocks = (store.StorePokemon || [])
    .filter((raw) => raw.status === 'ACTIVE')
    .map((raw) => ({ createdAt: raw.createdAt, text: buildPokemonExportText(raw) }));

  const blocks = [...itemBlocks, ...pokemonBlocks].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  return blocks.map((block) => block.text).join('\n\n\n');
}
