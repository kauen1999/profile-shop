// Pure helper — builds a wa.me deep link from a store's raw `whatsapp`
// contact field (free-text, never validated/normalized at write time — see
// CLAUDE.md's "Setup de loja pós-login e edição" section) plus a listing
// name. Strips everything but digits (wa.me requires a bare international
// number with no punctuation) and assumes a Brazilian number (`55` country
// code prefix) since that's the only market this project targets today.
// Returns null when there's nothing usable to link to, so callers can decide
// not to render the button at all rather than link to a broken wa.me URL.
export function buildWhatsappLink(whatsapp, listingName) {
  if (!whatsapp) return null;

  const digits = String(whatsapp).replace(/\D/g, '');
  if (!digits) return null;

  const message = `Olá! Tenho interesse em: ${listingName || ''}`.trim();
  return `https://wa.me/55${digits}?text=${encodeURIComponent(message)}`;
}
