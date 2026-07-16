require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { loadWikitext, parseSmallBoldDropsWithImages } = require('./dailyBoss');
const { parseShopTable } = require('./shopTable');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com';

function mwImageUrl(filename) {
  const normalized = filename.replace(/ /g, '_');
  const capitalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const hash = crypto.createHash('md5').update(capitalized).digest('hex');
  return `${BASE_URL}/images/${hash[0]}/${hash.slice(0, 2)}/${capitalized}`;
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableWikiPageId(name) {
  const hash = crypto.createHash('md5').update(`minigame:${name.toLowerCase()}`).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  return 1700000000 + num;
}

function buildItemMap() {
  const items = new Map();

  const cassinoWikitext = loadWikitext('Cassino otPokémon');
  for (const item of parseShopTable(cassinoWikitext)) {
    const key = item.name.toLowerCase();
    if (!items.has(key)) items.set(key, { name: item.name, file: item.file, sources: [] });
    items.get(key).sources.push({
      minigame: 'Cassino otPokémon',
      obtainMethod: 'shop',
      price: item.price,
      currency: item.currency,
    });
  }

  const bombermonWikitext = loadWikitext('Bombermon');
  const rankStart = bombermonWikitext.indexOf('== Rank Semanal ==');
  for (const drop of parseSmallBoldDropsWithImages(bombermonWikitext.slice(rankStart))) {
    const key = drop.name.toLowerCase();
    if (!items.has(key)) items.set(key, { name: drop.name, file: drop.file, sources: [] });
    if (!items.get(key).file && drop.file) items.get(key).file = drop.file;
    items.get(key).sources.push({ minigame: 'Bombermon', obtainMethod: 'reward', tier: 'rank_semanal_1' });
  }

  return items;
}

async function main() {
  const items = buildItemMap();

  let linkedExisting = 0;
  let created = 0;
  let imagesBackfilled = 0;
  const usedSlugs = new Set();

  for (const { name, file, sources } of items.values()) {
    const existing = await prisma.catalogItem.findFirst({
      where: {
        OR: [
          { wikiTitle: { equals: name, mode: 'insensitive' } },
          { name: { equals: name, mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      const data = {
        extractedFields: { ...(existing.extractedFields || {}), minigameSources: sources },
        updatedAt: new Date(),
      };
      if (!existing.imageUrl && file) {
        data.imageUrl = mwImageUrl(file);
        imagesBackfilled++;
      }
      await prisma.catalogItem.update({ where: { wikiPageId: existing.wikiPageId }, data });
      linkedExisting++;
      continue;
    }

    const wikiPageId = stableWikiPageId(name);
    let slug = `minigame-${slugify(name)}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `minigame-${slugify(name)}-${suffix++}`;
    }
    usedSlugs.add(slug);

    const classification = classifyItemCategory(name);

    await prisma.catalogItem.create({
      data: {
        wikiPageId,
        name,
        slug,
        category: classification.category,
        imageUrl: file ? mwImageUrl(file) : '',
        wikiTitle: name,
        wikiUrl: `${BASE_URL}/${encodeURIComponent(sources[0].minigame.replace(/ /g, '_'))}`,
        searchableText: `${name.toLowerCase()} minigame`,
        extractedFields: {
          minigameSources: sources,
          ...(classification.matchedRule ? {} : { classifierFallback: true }),
        },
        updatedAt: new Date(),
      },
    });
    created++;
  }

  console.log(
    `Itens — únicos: ${items.size} · vinculados: ${linkedExisting} · criados em minigame-items: ${created} · imagens preenchidas: ${imagesBackfilled}`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
