// Pure, item-specific preview-text builder — mirrors buildPokemonLookText.js's
// shape/spirit: takes already-resolved display values (never raw
// template-fetch objects, never ids) and returns the exact "look" text a
// player would type in-game to describe this item listing.
//
// Line sets per template were confirmed explicitly with the user from real
// in-game examples this session (see AddItemListing.jsx's task notes) — only
// the fields that map onto our 5-template model (legendary/backpack/addon/
// stackable/default) are implemented; "Peso" was confirmed absent from the
// catalog entirely and is deliberately not reproduced. Every optional line is
// fully omitted (no blank "Label: ") when empty, same principle as
// buildPokemonLookText.js.

// Display label per GameWorld enum value — no existing pattern for this
// elsewhere in the frontend (the Pokémon form deliberately still uses a
// hardcoded placeholder and doesn't have a real World selector), so this is
// just the raw enum value capitalized.
export const GAME_WORLD_LABELS = {
  BLUE: 'Blue',
  GREEN: 'Green',
  RED: 'Red',
  BLACK: 'Black',
  PURPLE: 'Purple',
  SILVER: 'Silver',
  GOLD: 'Gold',
};

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

export function buildItemLookText({
  template,
  itemName,
  serialNumber,
  acquiredAt,
  originWorldLabel,
  slots,
  compatiblePokemon,
  quantity,
  notes,
}) {
  const nameText = itemName || '';
  const lines = [`Você vê um ${nameText}.`];

  // 2026-07-14 revisão: Número de Série/Data/Mundo de Origem não dependem
  // mais do template "legendary" resolvido pelo catálogo (esse sinal cobre
  // só uma fração conhecida dos itens realmente legendary — ver CLAUDE.md)
  // — aparecem sempre que preenchidos, em qualquer item.
  if (!isBlank(serialNumber)) lines.push(`Número de Série: ${serialNumber}`);
  if (!isBlank(acquiredAt)) lines.push(`Data: ${acquiredAt}`);
  if (!isBlank(originWorldLabel)) lines.push(`Mundo de Origem: ${originWorldLabel}`);

  if (template === 'backpack') {
    if (slots !== null && slots !== undefined) lines.push(`Slots: ${slots}`);
  } else if (template === 'addon') {
    if (Array.isArray(compatiblePokemon) && compatiblePokemon.length > 0) {
      lines.push(`Pode ser usado em: ${compatiblePokemon.join(', ')}`);
    }
  } else if (template === 'stackable') {
    const numericQuantity = Number(quantity);
    if (Number.isFinite(numericQuantity) && numericQuantity > 1) {
      lines.push(`Quantidade: ${numericQuantity}`);
    }
  }
  // 'default' (and any unrecognized template): no extra template-specific lines.

  // "Descrição" (2026-07-15) — a real in-game item can have a flavor-text
  // sentence (confirmed by the two literal examples this feature's domain
  // was originally scoped from: "...is a legendary reward that can be
  // obtained at halloween events.", "A decorative figure obtained from 2023
  // Children's Day Event."), always as the LAST line, never as a labeled
  // "Descrição: ..." — reproduces the game's own convention verbatim rather
  // than inventing a label the game doesn't use.
  if (!isBlank(notes)) lines.push(notes);

  return lines.join('\n');
}
