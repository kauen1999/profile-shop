// Shared classifier used by every sync*.js script's "create new item" branch.
//
// Context: 11 source/reward categories (`loot`, `daily-boss-drops`,
// `dungeon-drops`, `event-items`, `quest-rewards`, `battle-pass`,
// `npc-shop-items`, `minigame-items`, `craft-system`, `craft-ingredients`)
// were retired on 2026-07-13 because they violated Architecture Rule 1
// (`category` must answer "what is this", never "where did it come from").
// A one-time cleanup reassigned the 331 existing rows in those categories to
// a real type category (or the new catch-all `materials`). This module is
// the *ongoing* version of that same classification logic, applied to
// newly-discovered items in the sync scripts' "create" branch so the bug
// doesn't reintroduce those retired categories going forward.
//
// This only decides `CatalogItem.category` for the "no existing row found"
// path. It has no opinion on `extractedFields.subcategories`/source fields
// (e.g. `dailyBossSources`, `questSources`) — those keep recording the
// retired name as the *source*, which is correct and unrelated to this file.
//
// NOTE: pokeballs/held-items/evolution-items/mega-stones/pokemon have no
// reliable name pattern and are deliberately NOT covered here — a script
// that already creates those types keeps its own logic untouched.
//
// 2026-07-15 consolidation: 23 cosmetic/furniture-type categories (carpets,
// misc, doll, figure, outfits, collectibles, tapestries, plush, costumes,
// balloons, ornaments, birthday-cakes, chairs, chests, beds, tables, sofas,
// wallpapers, pillows, benches, fireworks, desks, wreaths) were folded into
// a single new category, `decoracao`, at the user's explicit request (real
// data migration on the 688 existing rows in those categories — see
// CLAUDE.md "Estado atual do catálogo"). The name-pattern matching logic
// below is unchanged; only the resolved category string for each of those
// rules was updated to `decoracao`, so a newly-discovered item that would
// have matched e.g. `carpets` or `collectibles` before now resolves
// straight to `decoracao` instead of silently reintroducing a retired
// fragmented category. `misc` had no rule of its own here (it was never
// produced by this classifier) — nothing to change for it. Categories NOT
// part of this fold (tickets, backpacks, boxes, addons, depots,
// sticker-balls, boss-keys) keep their own rule untouched.
//
// 2026-07-15 split (same day, follow-up request): `outfits`/`costumes` were
// pulled back OUT of `decoracao` into their own real category, `outfit`
// (singular, exact string requested by the user) — 79 existing rows (48
// outfits + 31 costumes) migrated back out of `decoracao` into `outfit`.
// See CLAUDE.md "Estado atual do catálogo" for the migration details. The
// `outfits?`/`costumes?` rules below now resolve to `outfit` instead of
// `decoracao` so a newly-discovered outfit/costume item doesn't get folded
// back into `decoracao` by mistake. Every other rule that resolved to
// `decoracao` in the consolidation above is untouched.

// Order matters only in the sense that every rule here maps to a distinct,
// non-overlapping keyword, except the deliberate `cake` fallback after
// `birthday cake` (kept as two entries for clarity, functionally redundant)
// and the multi-keyword `decoracao` catch-all at the end (formerly
// `collectibles`, folded in 2026-07-15).
const RULES = [
  [/\bcarpets?\b/i, 'decoracao'],
  [/\bdolls?\b/i, 'decoracao'],
  [/\bfigures?\b/i, 'decoracao'],
  [/\btapestr(?:y|ies)\b/i, 'decoracao'],
  [/\boutfits?\b/i, 'outfit'],
  [/\bwallpapers?\b/i, 'decoracao'],
  [/\bchairs?\b/i, 'decoracao'],
  [/\btickets?\b/i, 'tickets'],
  [/\bbackpacks?\b/i, 'backpacks'],
  [/\bbox(?:es)?\b/i, 'boxes'],
  [/\baddons?\b/i, 'addons'],
  [/\btables?\b/i, 'decoracao'],
  [/\bsofas?\b/i, 'decoracao'],
  [/\bornaments?\b/i, 'decoracao'],
  [/\bcostumes?\b/i, 'outfit'],
  [/\bplush(?:ie)?s?\b/i, 'decoracao'],
  [/\bchests?\b/i, 'decoracao'],
  [/\bbeds?\b/i, 'decoracao'],
  [/\bdesks?\b/i, 'decoracao'],
  [/\bbench(?:es)?\b/i, 'decoracao'],
  [/\bfireworks?\b/i, 'decoracao'],
  [/\bwreaths?\b/i, 'decoracao'],
  [/\bballoons?\b/i, 'decoracao'],
  [/\bbirthday cakes?\b/i, 'decoracao'],
  [/\bcakes?\b/i, 'decoracao'],
  [/\bcollectibles?\b/i, 'decoracao'],
  [/\bpillows?\b/i, 'decoracao'],
  [/\bdepots?\b/i, 'depots'],
  [/\bsticker balls?\b/i, 'sticker-balls'],
  [/\bcapsules?\b/i, 'sticker-balls'],
  [/\bboss keys?\b/i, 'boss-keys'],
  [/\blegendary\b/i, 'decoracao'],
  [/\bdecorations?\b/i, 'decoracao'],
  [/\bdecorative\b/i, 'decoracao'],
  [/\bstatues?\b/i, 'decoracao'],
  // 2026-07-15 materials audit: these generic decoration nouns kept turning
  // up miscategorized as `materials` (vase/bottle/lamp/painting/plush/medal
  // items parsed from prose reward lists, which never get run through this
  // classifier's category-vs-origin logic at all — only new items created by
  // the 8 `sync*.js` scripts that call `classifyItemCategory` go through
  // here). Added so a future new item with one of these words doesn't repeat
  // the same mistake, not because these specific items will be re-synced.
  [/\bvases?\b/i, 'decoracao'],
  [/\blamps?\b/i, 'decoracao'],
  [/\bpaintings?\b/i, 'decoracao'],
  [/\bstuffed\b/i, 'decoracao'],
  [/\bmedals?\b/i, 'decoracao'],
];

// TM prefix, e.g. "TM01 - Flamethrower" or "TM - Pollen Puff".
const TM_PREFIX = /^tm\s*(?:\d+|-)/i;

/**
 * Classifies a newly-discovered item name into a real "what is this" type
 * category, per the rules established during the 2026-07-13 retired-category
 * cleanup. Falls back to `materials` when nothing matches.
 *
 * Returns `matchedRule: false` whenever the result is the blind `materials`
 * fallback rather than an actual recognized pattern (TM prefix or one of
 * `RULES`), so callers can tag the created row (e.g.
 * `extractedFields.classifierFallback = true`) instead of that fallback being
 * indistinguishable from a genuinely-classified material. See CLAUDE.md,
 * "categoryClassifier fallback signal".
 *
 * @param {string} name
 * @returns {{ category: string, matchedRule: boolean }}
 */
function classifyItemCategory(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return { category: 'materials', matchedRule: false };

  if (TM_PREFIX.test(trimmed)) return { category: 'tms', matchedRule: true };

  for (const [pattern, category] of RULES) {
    if (pattern.test(trimmed)) return { category, matchedRule: true };
  }

  return { category: 'materials', matchedRule: false };
}

module.exports = { classifyItemCategory };
