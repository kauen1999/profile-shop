// Pure builder for a WhatsApp-ready sales post — a third sibling of
// buildExportText.js's buildStoreExportText, but built for pasting into a
// WhatsApp sales group instead of re-importing into the platform. Reads the
// exact same nested shape StoreProfile.jsx already gets from
// `GET /stores/:slug` (no fetch of its own).
//
// Deliberately does NOT reuse buildPokemonLookText.js/buildItemLookText.js
// (this is a denser, one-line/one-block-per-listing format, not the in-game
// "look" text those two must keep reproducing character for character) nor
// buildPriceLines (buildExportText.js) for the HD price — that one must
// stay a plain number, since parseLookText.js's parsePriceHdRaw parses that
// exact shape back in on reimport; abbreviating it there would break that
// round-trip. `formatHdCompact` (shared with StoreListingCard.jsx/
// AnalyticsTab.jsx, see formatHdCompact.js) is safe here and in those two
// because none of them feed the reimport parser.

import { GENDER_LABELS } from './buildPokemonLookText';
import { formatCategoryLabel } from './formatCategoryLabel';
import { formatHdCompact } from './formatHdCompact';

function buildPriceText(priceReal, priceHd) {
  const parts = [];
  if (priceReal != null) parts.push(`R$ ${priceReal}`);
  // " e " joiner here (vs. the plain space used elsewhere) — reads as a
  // sentence fragment in a WhatsApp chat message, unlike the terser card/
  // dashboard UI contexts.
  if (priceHd != null) parts.push(formatHdCompact(priceHd, { remainderJoiner: ' e ' }));
  return parts.join(' · ');
}

// One Pokémon's distinguishing fields, in the exact order requested — used
// both for a lone (ungrouped) species line and for each numbered entry
// inside a species group. Never includes the species name itself (callers
// add that separately, once, in the header/prefix) — every field omitted
// when absent, same principle as buildPokemonLookText.js/
// buildPokemonCompactSummary.
function buildPokemonFieldsText(raw, addonCount) {
  const parts = [];

  if (raw.level != null) parts.push(`lvl${raw.level}`);
  if (raw.nature) parts.push(raw.nature);
  if (raw.gender) parts.push(GENDER_LABELS[raw.gender] || raw.gender);
  if (raw.nickname) parts.push(`"${raw.nickname}"`);
  if (addonCount > 0) parts.push(`${addonCount} addons`);
  if (raw.boost > 0) parts.push(`Boost +${raw.boost}`);
  if (raw.extraMoveCount > 0) parts.push(`Extra Moves +${raw.extraMoveCount}`);
  if (raw.presetSlotCount > 0) parts.push(`Preset Slots ${raw.presetSlotCount}`);

  const pokeballName = raw.CatalogItem_StorePokemon_pokeballCatalogItemIdToCatalogItem?.name;
  if (pokeballName) parts.push(pokeballName);

  return parts.join(' · ');
}

// Naive pluralization (just appends "s") — Portuguese has no clean
// grammatical rule for pluralizing a foreign proper noun like a Pokémon
// species name, and guessing one would misfire far more often than it'd
// help on the mostly-English names this catalog uses.
function pluralizeSpeciesName(name) {
  return `${name}s`;
}

function buildPokemonEntrySuffix(raw, addonCount, priceText) {
  const fields = buildPokemonFieldsText(raw, addonCount);
  return [fields, priceText].filter(Boolean).join(' — ');
}

// `entries`: [{ raw, speciesName, addonCount, priceText }], all sharing one
// species name, already sorted createdAt desc. A lone entry keeps the
// original single-line shape (name inline); 2+ become a header + numbered
// list, the species name said once instead of repeated per line.
function buildPokemonBlock(entries) {
  const speciesName = entries[0].speciesName;

  if (entries.length === 1) {
    const { raw, addonCount, priceText } = entries[0];
    const suffix = buildPokemonEntrySuffix(raw, addonCount, priceText);
    return `🐾 *${speciesName}*${suffix ? ` — ${suffix}` : ''}`;
  }

  const lines = [`🐾 *${pluralizeSpeciesName(speciesName)}* (${entries.length})`];
  entries.forEach(({ raw, addonCount, priceText }, index) => {
    const suffix = buildPokemonEntrySuffix(raw, addonCount, priceText);
    lines.push(`${index + 1}. ${suffix}`);
  });
  return lines.join('\n');
}

// `entry`: { name, categoryLabel, quantity, priceText } — quantity is
// already the summed total for a group of 100%-identical rows (see
// itemGroupKey below), so this never needs to know whether it came from 1
// row or several.
function buildItemLine(entry) {
  const parts = [];
  if (entry.categoryLabel) parts.push(entry.categoryLabel);
  if (entry.quantity > 1) parts.push(`x${entry.quantity}`);
  const middle = parts.join(' · ');
  const suffix = [middle, entry.priceText].filter(Boolean).join(' — ');
  return `📦 *${entry.name}*${suffix ? ` — ${suffix}` : ''}`;
}

// Grouping key for "100% identical" items — every field that would need to
// match for two separate StoreItem rows to really be "the same listing,
// just created twice" instead of editing quantity on the existing one.
// `quantity`/`id`/`createdAt` are deliberately excluded — quantity is what
// gets summed across the group, id/createdAt never affect display.
function itemGroupKey(raw) {
  return [
    raw.catalogItemId,
    raw.priceReal ?? '',
    raw.priceHd ?? '',
    raw.serialNumber ?? '',
    raw.acquiredAt ?? '',
    raw.originWorld ?? '',
    raw.notes ?? '',
  ].join('|');
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.values()];
}

function mostRecentCreatedAt(rows) {
  return rows.reduce((latest, row) => (new Date(row.createdAt) > new Date(latest) ? row.createdAt : latest), rows[0].createdAt);
}

// `store` is the object returned by GET /stores/:slug (already loaded by
// StoreProfile.jsx — no network call happens here). Only `status: 'ACTIVE'`
// listings with at least one price set are included — an active listing
// with no price at all isn't worth advertising. Returns '' when nothing is
// eligible, so the caller can show a dedicated "nothing to export" message
// instead of copying an empty/header-only string.
export function buildStoreWhatsappAdText(store) {
  const eligibleItems = (store.StoreItem || []).filter(
    (raw) => raw.status === 'ACTIVE' && (raw.priceReal != null || raw.priceHd != null)
  );
  const eligiblePokemon = (store.StorePokemon || []).filter(
    (raw) => raw.status === 'ACTIVE' && (raw.priceReal != null || raw.priceHd != null)
  );

  if (eligibleItems.length === 0 && eligiblePokemon.length === 0) return '';

  const itemBlocks = groupBy(eligibleItems, itemGroupKey).map((rows) => {
    const first = rows[0];
    const quantity = rows.reduce((sum, row) => sum + (row.quantity || 1), 0);
    return {
      createdAt: mostRecentCreatedAt(rows),
      text: buildItemLine({
        name: first.CatalogItem?.name,
        categoryLabel: formatCategoryLabel(first.CatalogItem?.category),
        quantity,
        priceText: buildPriceText(first.priceReal, first.priceHd),
      }),
    };
  });

  const pokemonBlocks = groupBy(
    eligiblePokemon,
    (raw) => raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem?.name
  ).map((rows) => {
    const sorted = [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const entries = sorted.map((raw) => ({
      raw,
      speciesName: raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem?.name,
      addonCount: raw.StorePokemonAddon?.length || 0,
      priceText: buildPriceText(raw.priceReal, raw.priceHd),
    }));
    return { createdAt: sorted[0].createdAt, text: buildPokemonBlock(entries) };
  });

  const blocks = [...itemBlocks, ...pokemonBlocks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const header = `🛒 *Anúncios da ${store.name}!*`;
  // Store description (2026-07-21) — the full text, never truncated like the
  // header card's `truncateDescription` (that limit exists only to protect
  // the card's fixed layout on-screen; this is a plain text export with no
  // such constraint, and the whole bio is exactly what the seller wants in
  // the sales post). Omitted entirely when the store has none set.
  const descriptionBlock = store.description ? store.description : null;
  const footer = `👉 Loja completa com fotos: ${window.location.origin}/${store.slug}`;

  return [header, descriptionBlock, ...blocks.map((block) => block.text), footer].filter(Boolean).join('\n\n');
}
