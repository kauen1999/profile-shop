import { useState } from 'react';
import { getBoostGlowColor } from '../domain/getBoostGlowColor';

// Pure, presentational visual preview for the "create Pokémon listing" flow
// (2026-07-14 addition). Receives an already-resolved image URL — no
// fetching, no domain logic, no knowledge of Pokémon/addons/looktypes; the
// caller (AddPokemonListing.jsx) computes which URL to show and is expected
// to pass a `key` that changes whenever the resolved URL changes, so this
// component remounts (fresh `failed` state, fresh <img>) instead of reusing
// the same DOM node across a failing-image → valid-image transition.
//
// Broken image hides itself via the project's standard onError pattern
// (never a broken-image icon) — done through React state, not imperative
// DOM mutation, so a later successful load of a different URL is never
// blocked by a `style.display` a previous failed load left behind on a
// reused <img> node.
//
// `boost` (2026-07-15 addition) drives the same Boost System aura glow as
// StoreListingCard.jsx's storefront photo — see getBoostGlowColor.js for
// the color table. Optional; omitted entirely (no glow) when not passed or
// when the current boost value is below the tier-8 threshold.
export function PokemonSpritePreview({ imageUrl, alt, boost }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) return null;

  const boostGlowColor = getBoostGlowColor(boost);

  return (
    <div className="pokemon-sprite-preview">
      <img
        src={imageUrl}
        alt={alt || ''}
        className={`pokemon-sprite-preview-img${boostGlowColor ? ' pokemon-sprite-preview-glow' : ''}`}
        style={boostGlowColor ? { '--boost-glow-color': boostGlowColor } : undefined}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
