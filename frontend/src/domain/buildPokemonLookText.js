// Pure, Pokémon-specific preview-text builder. NOT a component — takes
// already-resolved display values (names, not ids) and returns the exact
// "look" text a player would type in-game to describe this listing.
//
// Deliberately NOT derived from the form's field-fill order (see
// AddPokemonListing.jsx) — this line order was confirmed explicitly with
// the user from two literal real-game examples and must be reproduced
// character for character. Every optional field is fully omitted (no blank
// line, no "Label: " with nothing after it) when empty.

// Fixed label mapping for the gender values returned by
// GET /store-pokemon-options/pokemon's `genderOptions` — not catalog data,
// just a display label for a small fixed enum.
export const GENDER_LABELS = {
  macho: 'Macho',
  femea: 'Fêmea',
  sem_genero: 'Sem gênero',
};

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

// Colocated here per plan (could equally live in the sticker picker) — must
// never be applied to the shared GET /catalog-items path, which keeps
// showing real "Capsule" names on the general Catalog.jsx browse page.
export function toSealName(name) {
  return name.replace(/Capsule/gi, 'Seal');
}

// NOTE (2026-07-14 revision): `shiny`/`extraMovesText`/`presetSlotsText`
// params are gone — the Shiny toggle was removed (shininess now lives on
// which Pokémon row was picked, reflected directly in `pokemonName`), and
// Extra Moves/Preset Slots are now numeric (`extraMoveCount`/
// `presetSlotCount`), each only rendered when `> 0` per the new backend
// contract (0 means "not set", never rendered as `+0`/`0`).
export function buildPokemonLookText({
  pokeballName,
  pokemonName,
  level,
  genderLabel,
  nature,
  nickname,
  addonCount,
  equippedAddonName,
  boost,
  capturedAt,
  heldItemName,
  megaStoneName,
  stickerNames,
  extraMoveCount,
  presetSlotCount,
}) {
  const pokeballText = pokeballName || '';
  const pokemonText = pokemonName || '';

  const lines = [`Você vê uma ${pokeballText} com um ${pokemonText}.`, ''];

  if (!isBlank(level)) lines.push(`Nível: ${level}`);
  if (!isBlank(genderLabel)) lines.push(`Gênero: ${genderLabel}`);
  if (!isBlank(nickname)) lines.push(`Nickname: ${nickname}`);
  if (!isBlank(addonCount)) lines.push(`Addons: ${addonCount}`);
  if (!isBlank(equippedAddonName)) lines.push(`Usando: ${equippedAddonName}`);
  // BOOST must never render as `+0` — only shown once the value is
  // genuinely positive (per 2026-07-14 revision: min is 0, no max).
  const numericBoost = Number(boost);
  if (!isBlank(boost) && Number.isFinite(numericBoost) && numericBoost > 0) {
    lines.push(`BOOST: +${numericBoost}`);
  }
  if (!isBlank(nature)) lines.push(`Nature: ${nature}`);
  if (!isBlank(capturedAt)) lines.push(`Capturado em: ${capturedAt}`);
  if (!isBlank(heldItemName)) lines.push(`Held item: ${heldItemName}`);
  if (!isBlank(megaStoneName)) lines.push(`Mega Stone: ${megaStoneName}`);
  if (Array.isArray(stickerNames) && stickerNames.length > 0) {
    lines.push(`Stickers: ${stickerNames.join(', ')}`);
  }
  const numericExtraMoveCount = Number(extraMoveCount);
  if (Number.isFinite(numericExtraMoveCount) && numericExtraMoveCount > 0) {
    lines.push(`Extra Moves: +${numericExtraMoveCount}`);
  }
  const numericPresetSlotCount = Number(presetSlotCount);
  if (Number.isFinite(numericPresetSlotCount) && numericPresetSlotCount > 0) {
    lines.push(`Preset Slots: ${numericPresetSlotCount}`);
  }

  return lines.join('\n');
}
