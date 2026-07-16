// Display-only humanization of CatalogItem.category values — kebab-case
// internal identifiers (e.g. "sticker-balls", "decoracao") turned into a
// shopper-facing label. Shared by StoreListingCard.jsx (storefront card) and
// AddItemListing.jsx (the read-only "Categoria" field once an item is
// picked), so both places always show the exact same label for the same
// category.
//
// 2026-07-15: the "23 cosmetic categories -> one label" grouping requested
// earlier is now real catalog data (see CLAUDE.md's "Estado atual do
// catálogo" — carpets/misc/doll/figure/etc. were migrated to a single real
// `decoracao` category, 688 rows, with categoryClassifier.js updated so
// future syncs don't recreate the old fragmented categories). This function
// no longer needs to reconstruct that grouping itself — it only needs to
// spell `decoracao` with the accent a shopper expects, same as any other
// multi-word category gets Title-Cased.
const CATEGORY_LABEL_OVERRIDES = {
  decoracao: 'Decoração',
  // 2026-07-15, requested explicitly — shorter shopper-facing labels for
  // these two than the literal humanized category name would produce
  // ("Pokemon Shiny", "Cherish Ball Pokemon").
  'pokemon-shiny': 'Shiny',
  'cherish-ball-pokemon': 'Cherishball',
};

export function formatCategoryLabel(category) {
  if (!category) return null;
  if (CATEGORY_LABEL_OVERRIDES[category]) return CATEGORY_LABEL_OVERRIDES[category];

  return category
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
