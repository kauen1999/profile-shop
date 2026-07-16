import { GENDER_LABELS } from './buildPokemonLookText';
import { GAME_WORLD_LABELS } from './buildItemLookText';
import { formatCategoryLabel } from './formatCategoryLabel';

// Every field a shopper might reasonably search a listing by, for both
// listing kinds — matches the "search everything" ask (name, description,
// every other field on the ad), not just the display name. Plain lowercase
// substring match, same as the rest of this app's search UX (the backend's
// own search is a case-insensitive ILIKE, not accent-folded/fuzzy either) —
// deliberately not accent-insensitive here, kept consistent/simple.
export function buildListingSearchText(listing) {
  const { kind, name, raw } = listing;
  const parts = [name];

  if (kind === 'item') {
    parts.push(
      formatCategoryLabel(raw.CatalogItem?.category),
      raw.serialNumber,
      raw.acquiredAt,
      raw.originWorld ? GAME_WORLD_LABELS[raw.originWorld] : null,
      raw.notes
    );
  } else {
    parts.push(
      raw.nickname,
      raw.nature,
      raw.gender ? GENDER_LABELS[raw.gender] : null,
      raw.capturedAt,
      raw.CatalogItem_StorePokemon_heldItemCatalogItemIdToCatalogItem?.name,
      raw.CatalogItem_StorePokemon_megaStoneCatalogItemIdToCatalogItem?.name,
      raw.CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem?.name,
      ...(raw.StorePokemonSticker || []).map((s) => s.CatalogItem?.name),
      ...(raw.StorePokemonAddon || []).map((a) => a.CatalogItem?.name)
    );
  }

  return parts.filter(Boolean).join(' ').toLowerCase();
}
