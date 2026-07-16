require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { loadWikitext } = require('./dailyBoss');
const { parseShopTable } = require('./shopTable');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com';
const NPC_PAGES = ['Assistant Rich', 'Collector Thomson'];

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
  const hash = crypto.createHash('md5').update(`npc-shop:${name.toLowerCase()}`).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  return 1000000000 + num;
}

function buildItemMap() {
  const items = new Map();

  for (const npc of NPC_PAGES) {
    const wikitext = loadWikitext(npc);
    for (const item of parseShopTable(wikitext)) {
      const key = item.name.toLowerCase();
      if (!items.has(key)) items.set(key, { name: item.name, file: item.file, sources: [] });
      items.get(key).sources.push({
        npc,
        obtainMethod: 'shop',
        price: item.price,
        currency: item.currency || null,
      });
    }
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
        extractedFields: { ...(existing.extractedFields || {}), npcShopSources: sources },
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
    let slug = `npc-shop-${slugify(name)}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `npc-shop-${slugify(name)}-${suffix++}`;
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
        wikiUrl: `${BASE_URL}/${encodeURIComponent(sources[0].npc.replace(/ /g, '_'))}`,
        searchableText: `${name.toLowerCase()} npc shop`,
        extractedFields: {
          npcShopSources: sources,
          ...(classification.matchedRule ? {} : { classifierFallback: true }),
        },
        updatedAt: new Date(),
      },
    });
    created++;
  }

  console.log(
    `Itens — únicos: ${items.size} · vinculados: ${linkedExisting} · criados em npc-shop-items: ${created} · imagens preenchidas: ${imagesBackfilled}`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
