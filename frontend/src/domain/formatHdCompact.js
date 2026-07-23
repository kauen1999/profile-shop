// Shared HD-price abbreviation in thousands ("k") — 1000+ HD reads as a
// compact "k" figure instead of a long raw number, used anywhere HD is
// shown for a human to scan quickly (storefront card/modal, the Analytics
// dashboard, the WhatsApp sales-post export). Below 1000: unchanged, the
// same "<N> HD" shape used everywhere. At/above 1000: a remainder that's a
// clean multiple of 100 becomes one decimal place (1500 -> "1,5k"); a zero
// remainder drops the decimal (750000 -> "750k"); anything else splits into
// a thousands part plus the exact leftover so no precision is silently lost
// (1050 -> "1k 50hd", 1354 -> "1k 354hd").
//
// NEVER used anywhere the value needs to round-trip back through
// parseLookText.js — buildExportText.js's buildPriceLines (the "Exportar
// Anúncios" reimport format) and buildItemLookText.js/buildPokemonLookText.js
// must all stay a plain number, since the importer parses "<número> HD"
// literally; abbreviating there would break reimport.
export function formatHdCompact(priceHd, { remainderJoiner = ' ' } = {}) {
  if (priceHd == null) return null;
  if (priceHd < 1000) return `${priceHd} HD`;

  const thousands = Math.floor(priceHd / 1000);
  const remainder = priceHd - thousands * 1000;

  if (remainder === 0) return `${thousands}k`;
  if (remainder % 100 === 0) return `${thousands},${remainder / 100}k`;
  return `${thousands}k${remainderJoiner}${remainder}hd`;
}
