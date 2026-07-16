require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { buildQuestsIndex } = require('./quests');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com';

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableWikiPageId(name) {
  const hash = crypto.createHash('md5').update(`quest-reward:${name.toLowerCase()}`).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  return 1200000000 + num;
}

function buildItemMap(quests) {
  const items = new Map();
  for (const quest of quests) {
    for (const dropName of quest.drops) {
      const key = dropName.toLowerCase();
      if (!items.has(key)) items.set(key, { name: dropName, sources: [] });
      items.get(key).sources.push({ quest: quest.name });
    }
  }
  return items;
}

async function main() {
  const quests = buildQuestsIndex();
  const items = buildItemMap(quests);

  let linkedExisting = 0;
  let created = 0;
  const usedSlugs = new Set();

  for (const { name, sources } of items.values()) {
    const existing = await prisma.catalogItem.findFirst({
      where: {
        OR: [
          { wikiTitle: { equals: name, mode: 'insensitive' } },
          { name: { equals: name, mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      await prisma.catalogItem.update({
        where: { wikiPageId: existing.wikiPageId },
        data: {
          extractedFields: { ...(existing.extractedFields || {}), questSources: sources },
          updatedAt: new Date(),
        },
      });
      linkedExisting++;
      continue;
    }

    const wikiPageId = stableWikiPageId(name);
    let slug = `quest-${slugify(name)}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `quest-${slugify(name)}-${suffix++}`;
    }
    usedSlugs.add(slug);

    const classification = classifyItemCategory(name);

    await prisma.catalogItem.create({
      data: {
        wikiPageId,
        name,
        slug,
        category: classification.category,
        imageUrl: '',
        wikiTitle: name,
        wikiUrl: `${BASE_URL}/Quests`,
        searchableText: `${name.toLowerCase()} quest`,
        extractedFields: {
          questSources: sources,
          ...(classification.matchedRule ? {} : { classifierFallback: true }),
        },
        updatedAt: new Date(),
      },
    });
    created++;
  }

  console.log(`\nQuests processadas: ${quests.length}`);
  console.log(
    `Itens — únicos: ${items.size} · vinculados a itens existentes: ${linkedExisting} · criados em quest-rewards: ${created}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
