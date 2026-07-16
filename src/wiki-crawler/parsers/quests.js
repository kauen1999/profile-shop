const { resolveLink, loadWikitext } = require('./dailyBoss');
const { parseRewardProse } = require('./dungeons');

const ROW_SPLIT = /\|-\s*style="background: linear-gradient\(90deg, #f8f9fa[^"]*"/;

// Real wiki text, but too vague/generic to be a concrete catalog item (an
// ability unlock, an unspecified "two addons", a random-category reward, or
// an unnamed Pokémon) — not a parser bug, just not something to catalog.
const EXCLUDED_REWARDS = new Set([
  'habilidade de mega evoluir o pokémon',
  'dois addons para a outfit trainer',
  'mega stone aleatória',
  'pokémon na cherish ball',
]);

function parseQuestRow(chunk) {
  const cells = chunk
    .split(/\n\s*\|\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!cells.length || !/^\[\[/.test(cells[0])) return null;

  const name = resolveLink(cells[0]);

  // Row shape is always [name, level, premium-icon, reward, video, ...junk].
  // "level" can be a number OR free text ("Desconhecido"), so anchor on the
  // premium-icon cell (always an Arquivo image) instead of guessing which
  // cell "looks like" a reward.
  const imageIdx = cells.findIndex((c) => /^\[\[Arquivo:/.test(c));
  const rewardCell = imageIdx !== -1 ? cells[imageIdx + 1] : null;

  const drops = rewardCell
    ? parseRewardProse(rewardCell)
        .filter((d) => !/^acesso\b|^libera acesso\b/i.test(d))
        .filter((d) => !EXCLUDED_REWARDS.has(d.toLowerCase()))
    : [];

  return { name, drops };
}

function buildQuestsIndex() {
  const wikitext = loadWikitext('Quests');
  const chunks = wikitext.split(ROW_SPLIT).slice(1);
  return chunks.map(parseQuestRow).filter(Boolean);
}

module.exports = { buildQuestsIndex };
