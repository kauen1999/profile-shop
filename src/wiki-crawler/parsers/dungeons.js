const { resolveLink, parseSmallBoldDropsWithImages, loadWikitext } = require('./dailyBoss');
const { stripLeadingQuantity, isLikelyRewardItem } = require('./itemFilter');

const ROW_SPLIT = /\|-\s*style="background: linear-gradient\(90deg, #f8f9fa[^"]*"/;

function parseRewardProse(text) {
  const cleaned = text
    .replace(/\s*e\s+\d[\d.,]*k?\s*de\s+EXP\.?\s*$/i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\n/g, ', ')
    .replace(/\s+e\s+/g, ', ')
    .replace(/\s+ou\s+/g, ', ');
  return cleaned
    .split(',')
    .map((p) => resolveLink(p.trim()).replace(/^(um|uma|o|a)\s+/i, ''))
    .map((p) => stripLeadingQuantity(p.trim()))
    .filter(isLikelyRewardItem);
}

function parseDungeonsIndexRow(chunk) {
  const cells = chunk
    .split(/\n\|\s*style="[^"]*"\s*\|/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (cells.length < 4) return null;
  const name = resolveLink(cells[0]);
  if (/clique no nome/i.test(cells[3])) return { name, drops: [] };
  return { name, drops: parseRewardProse(cells[3]) };
}

function buildDungeonsIndexMap() {
  const wikitext = loadWikitext('Dungeons');
  const end = wikitext.indexOf('== Janela de Dungeons ==');
  const relevant = wikitext.slice(0, end === -1 ? wikitext.length : end);
  const chunks = relevant.split(ROW_SPLIT).slice(1);

  const map = new Map();
  for (const chunk of chunks) {
    const row = parseDungeonsIndexRow(chunk);
    if (row) map.set(row.name.toLowerCase(), row);
  }
  return map;
}

function extractDropsFromPage(title, heading) {
  const wikitext = loadWikitext(title);
  const start = wikitext.indexOf(heading);
  if (start === -1) throw new Error(`Cabeçalho "${heading}" não encontrado em "${title}".`);
  return parseSmallBoldDropsWithImages(wikitext.slice(start));
}

module.exports = { buildDungeonsIndexMap, extractDropsFromPage, parseRewardProse };
