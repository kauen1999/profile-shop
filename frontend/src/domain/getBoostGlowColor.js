// Boost System aura colors — from the "Sistema de Auras" table on the wiki's
// Boost System page (data/wiki-crawl/pages/4624__Boost_System.json,
// confirmed verbatim this session): a Pokémon's Boost Stone count grants a
// colored aura starting at 8, escalating by tier, with no aura at all below
// that. Real documented in-game mechanic, not a cosmetic choice — the exact
// thresholds/colors come straight from that table:
//   1–7  -> no aura
//   8    -> Amarela (yellow)
//   9    -> Laranja (orange)
//   10   -> Vermelha (red)
//   11   -> Azul (blue)
//   12+  -> Roxa (purple) — "12 ou mais" in the source table
//
// Returns a CSS color string, or null when there's no aura (boost missing,
// non-numeric, or below the tier-8 threshold) — callers use `null` to decide
// whether to render any glow at all.
const BOOST_GLOW_COLORS = {
  8: '#ffd400',
  9: '#ff8c00',
  10: '#ff3b3b',
  11: '#3b82f6',
};
const PURPLE_AURA = '#a855f7';

export function getBoostGlowColor(boost) {
  const value = Number(boost);
  if (!Number.isFinite(value) || value < 8) return null;
  if (value >= 12) return PURPLE_AURA;
  return BOOST_GLOW_COLORS[value] ?? null;
}
