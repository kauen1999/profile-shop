const fs = require('fs');
const path = require('path');
const config = require('../config');

const ROW_SPLIT_REGEX = /\|-\s*style="background: linear-gradient\(90deg, #f8f9fa[^"]*"/;
const SECTION_SPLIT_REGEX = /={2,3}\s*([^=]+?)\s*={2,3}/g;

function loadWikitext(title) {
  const index = JSON.parse(fs.readFileSync(config.indexPath, 'utf-8'));
  const entry = index.pages[title];
  if (!entry || entry.missing || entry.failed || !entry.file) {
    throw new Error(`Página "${title}" não encontrada no índice do crawler.`);
  }
  const pagePath = path.join(config.dataDir, entry.file);
  return JSON.parse(fs.readFileSync(pagePath, 'utf-8')).wikitext;
}

function resolveLink(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (match) return (match[2] || match[1]).trim();
  // Wiki typo fallback: "Page|Display" without the [[ ]] wrapper.
  if (trimmed.includes('|') && !trimmed.includes('[')) {
    const parts = trimmed.split('|');
    return parts[parts.length - 1].trim();
  }
  // Free-form prose with embedded wiki markup: strip it down to readable text.
  if (/\[\[|'''/.test(trimmed)) {
    return trimmed
      .replace(/\[\[Arquivo:([^|\]]+)(?:\|[^\]]*)?\]\]/g, (_, file) => file.replace(/\.[a-z]+$/i, ''))
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/'''/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return trimmed;
}

// Image tag immediately followed by a bold span: [[Arquivo:File.png|...]] '''Name'''
function parseDropsWithImages(html) {
  const drops = [];
  const seen = new Set();
  const regex = /(?:\[\[Arquivo:([^|\]]+)(?:\|[^\]]*)?\]\]\s*)?'''(.+?)'''/gs;
  let match;
  while ((match = regex.exec(html))) {
    const name = resolveLink(match[2]);
    if (!name || name.length > 60 || name.endsWith('.') || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    drops.push({ name, file: match[1] ? match[1].trim() : null });
  }
  return drops;
}

function parseDrops(html) {
  return parseDropsWithImages(html).map((d) => d.name);
}

// Table layout where a header row of bold names is followed by a row of
// images in the same column order: <small>'''Name'''</small> ... [[Arquivo:File.png]]
function parseSmallBoldDropsWithImages(html) {
  const names = [];
  const seen = new Set();
  const nameRegex = /<small>\s*'''([^<]+?)'''?\s*<\/small>/g;
  let match;
  while ((match = nameRegex.exec(html))) {
    const name = resolveLink(match[1].trim());
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }

  const files = [...html.matchAll(/\[\[Arquivo:([^|\]]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());

  return names.map((name, i) => ({ name, file: files[i] || null }));
}

function parseSmallBoldDrops(html) {
  return parseSmallBoldDropsWithImages(html).map((d) => d.name);
}

function parseBossChunk(rawChunk, sectionName) {
  const cells = rawChunk.split('\n|');
  const startIdx = cells.findIndex((c) => /^\[\[Arquivo:/.test(c.trim()));
  if (startIdx === -1) return null;

  const [imageCell, nameCell, cooldownCell, accessCell, ...rest] = cells.slice(startIdx);
  const name = (nameCell || '').trim();
  if (!name) return null;

  const dropsHtml = rest.join('\n|');
  const imageMatch = imageCell.match(/Arquivo:([^|\]]+)/);

  return {
    section: sectionName,
    name,
    cooldown: (cooldownCell || '').trim(),
    access: accessCell ? resolveLink(accessCell) : null,
    bossImageFile: imageMatch ? imageMatch[1].trim() : null,
    drops: parseDrops(dropsHtml),
    dropsWithImages: parseDropsWithImages(dropsHtml),
  };
}

function splitIntoSections(wikitext) {
  const headers = [...wikitext.matchAll(SECTION_SPLIT_REGEX)];
  const sections = [];
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i][1].trim();
    const start = headers[i].index + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : wikitext.length;
    sections.push({ name, content: wikitext.slice(start, end) });
  }
  return sections;
}

function buildDailyBossIndex() {
  const wikitext = loadWikitext('Daily Boss');
  const sections = splitIntoSections(wikitext);

  const bosses = [];
  for (const section of sections) {
    if (section.name === 'Introdução' || section.name === 'Boss de Evento') continue;
    const chunks = section.content.split(ROW_SPLIT_REGEX).slice(1);
    for (const chunk of chunks) {
      const boss = parseBossChunk(chunk, section.name);
      if (boss) bosses.push(boss);
    }
  }
  return bosses;
}

module.exports = {
  buildDailyBossIndex,
  parseDrops,
  parseDropsWithImages,
  parseSmallBoldDrops,
  parseSmallBoldDropsWithImages,
  resolveLink,
  loadWikitext,
};
