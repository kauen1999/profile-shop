// A looktype URL is only safe to use once it's been migrated off the wiki
// (see CLAUDE.md's "Migração de imagem"/wiki-image-downloader pipeline) —
// the wiki blocks direct hotlinking for every visitor, not just our own
// tooling, so an un-migrated `https://wiki.otponline.com/...` URL would
// always 404/403 as a plain <img> in the real app.
export function isMigratedImageUrl(url) {
  return !!url && !url.startsWith('https://wiki.otponline.com');
}

// GET /store-pokemon-options/pokemon (and the raw CatalogItem row alike)
// never expose a "is this shiny" flag directly — shininess is only
// observable via the naming convention the backend itself documents: a
// shiny row's `name` always reads "Shiny X".
export function isShinyPokemonName(name) {
  return !!name?.startsWith('Shiny ');
}

// Finds the addonCompatibilities entry (raw CatalogItem.extractedFields
// shape) matching a given species — same case-insensitive/trimmed match
// GET /store-pokemon-options/addons uses server-side
// (src/routes/storePokemonOptions.js), replicated client-side here because
// the raw CatalogItem row (already loaded via GET /stores/:slug, no fetch
// needed) carries the full addonCompatibilities array, not the single
// flattened entry that endpoint returns for one species at a time.
function findAddonCompatibility(addonCatalogItem, pokemonWikiTitle) {
  const compatibilities = addonCatalogItem?.extractedFields?.addonCompatibilities;
  if (!Array.isArray(compatibilities) || !pokemonWikiTitle) return null;
  const target = String(pokemonWikiTitle).trim().toLowerCase();
  return (
    compatibilities.find((c) => String(c?.pokemonWikiTitle || '').trim().toLowerCase() === target) || null
  );
}

// Shared 2-tier preference: the exact shininess variant, else the *other*
// color of the same composite. The exact variant is a real, permanent gap
// for some combinations — not every addon had both colors captured from
// the wiki (confirmed, e.g., "Christmas Helper Addon" never got a shiny
// Gardevoir composite). The Pokémon wearing the addon in the wrong color is
// still far more useful than a completely generic addon icon, so try that
// before giving up. Returns null if neither is usable.
function pickWithShininessFallback(normalUrl, shinyUrl, isShiny) {
  const preferred = isShiny ? shinyUrl : normalUrl;
  if (isMigratedImageUrl(preferred)) return preferred;
  const other = isShiny ? normalUrl : shinyUrl;
  return isMigratedImageUrl(other) ? other : null;
}

// Raw lookup — the looktype URL for this species/shininess straight from
// the raw CatalogItem's extractedFields.addonCompatibilities, or null if
// there's no match / no compatibility data at all. Exported separately
// from resolveAddonLooktypeUrl below because the two call sites need
// different fallbacks when this comes back empty (the addon's own icon in
// the storefront modal, the base Pokémon sprite in the listing form's
// preview).
export function findAddonLooktypeUrl(addonCatalogItem, pokemonWikiTitle, isShiny) {
  const compatibility = findAddonCompatibility(addonCatalogItem, pokemonWikiTitle);
  if (!compatibility) return null;
  return pickWithShininessFallback(compatibility.looktypeImageUrl, compatibility.looktypeShinyImageUrl, isShiny);
}

// Resolves the sprite that shows the Pokémon actually wearing this addon
// (the "looktype" composite) for the given species/shininess, falling back
// to the addon's own catalog image when there's no species-specific
// looktype data (regex-fallback addons, ~173 of 739) or the looktype image
// hasn't been migrated off the wiki yet — never returns a URL known to be
// unusable in the real app.
export function resolveAddonLooktypeUrl(addonCatalogItem, pokemonWikiTitle, isShiny) {
  return findAddonLooktypeUrl(addonCatalogItem, pokemonWikiTitle, isShiny) || addonCatalogItem?.imageUrl || null;
}

// Same resolution, but for the *flattened* shape GET /store-pokemon-options/
// addons already returns (`{ wikiPageId, name, imageUrl, looktypeImageUrl,
// looktypeShinyImageUrl }`) — already resolved server-side for one specific
// species, so no extractedFields/compatibility lookup needed here, just the
// same shininess-fallback-then-icon preference.
export function resolveFlatAddonSpriteUrl(addonOption, isShiny) {
  const preferred = pickWithShininessFallback(
    addonOption?.looktypeImageUrl,
    addonOption?.looktypeShinyImageUrl,
    isShiny
  );
  return preferred || addonOption?.imageUrl || null;
}
