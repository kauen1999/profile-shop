// Filters applied to free-text reward prose (comma-separated lists in Portuguese)
// to drop entries that are placeholders, currency, or experience — not real
// catalog items — and to strip leading quantity numbers the wiki sometimes
// leaves attached to the item name (e.g. "1 Fire Stone", "100 Ultra Balls").

const PLACEHOLDER_NAMES = new Set(['?', 'desconhecido', 'unknown', '-']);

function stripLeadingQuantity(name) {
  return name.replace(/^\d+\s*x?\s+/i, '').trim();
}

function isLikelyRewardItem(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_NAMES.has(trimmed.toLowerCase())) return false;
  if (/^\d*\s*hds?$/i.test(trimmed)) return false;
  if (/^\d*\s*(experi[êe]ncia|experience|exp|xp)$/i.test(trimmed)) return false;
  return true;
}

module.exports = { stripLeadingQuantity, isLikelyRewardItem };
