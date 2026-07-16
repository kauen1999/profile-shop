// Small fixed game-mechanics/domain constants — not catalog data (nothing to
// do with the CatalogItem model), so hardcoding here is fine (same reasoning
// each constant already had inline before being centralized on 2026-07-15).
// Centralized in their own file (rather than left exported from
// AddPokemonListing.jsx/AddItemListing.jsx) for two reasons: it avoids
// oxlint's `react(only-export-components)` fast-refresh warning that comes
// from exporting non-component values out of a page component file, and it
// gives ImportListings.jsx/resolveImportDraft.js (2026-07-15) a shared
// source instead of duplicating any of these three lists a second time.

// Standard 25 Pokémon natures.
export const NATURES = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty',
  'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
  'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive',
  'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
  'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky',
];

// Fixed 7-value GameWorld enum (prisma/schema.prisma).
export const GAME_WORLDS = ['BLUE', 'GREEN', 'RED', 'BLACK', 'PURPLE', 'SILVER', 'GOLD'];

// Pokémon (pokemon/pokemon-shiny/cherish-ball-pokemon) are never items — they
// have their own dedicated "Adicionar Pokémon" flow. daily-boss-access rows
// aren't physical items either (they're boss-access-window records with
// sentence-like names — see CLAUDE.md's documented open decision on that
// category). Used with GET /catalog-items?excludeCategories=.
export const ITEM_PICKER_EXCLUDED_CATEGORIES = [
  'pokemon',
  'pokemon-shiny',
  'cherish-ball-pokemon',
  'daily-boss-access',
];
