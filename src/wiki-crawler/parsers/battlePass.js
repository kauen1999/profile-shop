const fs = require('fs');
const path = require('path');
const config = require('../config');

const SEASON_PAGES = [
  'Battle Pass - Season 1',
  'Battle Pass - Season 2',
  'Battle Pass - Season 3',
  'Battle Pass - Season 4',
  'Battle Pass - Season 5',
  'Battle Pass - Season 6',
];

function loadWikitext(title) {
  const index = JSON.parse(fs.readFileSync(config.indexPath, 'utf-8'));
  const entry = index.pages[title];
  if (!entry || entry.missing || entry.failed || !entry.file) {
    throw new Error(`Página "${title}" não encontrada no índice do crawler.`);
  }
  const pagePath = path.join(config.dataDir, entry.file);
  return JSON.parse(fs.readFileSync(pagePath, 'utf-8')).wikitext;
}

function extractCellData(cell) {
  const fileMatch = cell.match(/\[\[Arquivo:([^|\]]+)(?:\|[^\]]*)?\]\]/);
  const text = cell
    .replace(/\[\[Arquivo:[^\]]*\]\]/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { text: text || null, file: fileMatch ? fileMatch[1].trim() : null };
}

function cleanCell(cell) {
  return extractCellData(cell).text;
}

function parseSeasonRewards(wikitext) {
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
  const rewards = [];
  let match;
  while ((match = rowRegex.exec(wikitext))) {
    const [, level, freeCell, premiumCell] = match;
    const free = extractCellData(freeCell);
    const premium = extractCellData(premiumCell);
    rewards.push({
      level: Number(level),
      free: free.text,
      freeFile: free.file,
      premium: premium.text,
      premiumFile: premium.file,
    });
  }
  return rewards;
}

function buildBattlePassIndex() {
  const seasons = {};
  for (const title of SEASON_PAGES) {
    const seasonNumber = Number(title.match(/Season (\d+)/)[1]);
    const wikitext = loadWikitext(title);
    seasons[seasonNumber] = parseSeasonRewards(wikitext);
  }
  return seasons;
}

module.exports = { buildBattlePassIndex, parseSeasonRewards, SEASON_PAGES };
