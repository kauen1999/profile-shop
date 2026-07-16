require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com/Craft_System';

const ITEMS = [
  { name: 'Shiny Heart Scale', source: "Bill's Grandfather" },
  { name: 'Migrating Big Nugget', source: "Bill's Grandfather" },
  { name: 'Horde Leader Big Pearl', source: "Bill's Grandfather" },
  { name: 'Boss Griseous Orb', source: "Bill's Grandfather" },
  { name: 'TM Data', source: "Bill's Grandfather" },
  { name: 'Prismatic Material', source: "Bill's Grandfather" },
  { name: 'Poke Radar', source: "Bill's Sister" },
];

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableWikiPageId(name) {
  const hash = crypto.createHash('md5').update(`craft-system:${name.toLowerCase()}`).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  return 1100000000 + num;
}

async function main() {
  let linkedExisting = 0;
  let created = 0;

  for (const { name, source } of ITEMS) {
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
          extractedFields: { ...(existing.extractedFields || {}), craftSystemSource: source },
          updatedAt: new Date(),
        },
      });
      linkedExisting++;
      continue;
    }

    const classification = classifyItemCategory(name);

    await prisma.catalogItem.create({
      data: {
        wikiPageId: stableWikiPageId(name),
        name,
        slug: `craft-${slugify(name)}`,
        category: classification.category,
        imageUrl: '',
        wikiTitle: name,
        wikiUrl: BASE_URL,
        searchableText: `${name.toLowerCase()} craft system`,
        extractedFields: {
          craftSystemSource: source,
          ...(classification.matchedRule ? {} : { classifierFallback: true }),
        },
        updatedAt: new Date(),
      },
    });
    created++;
  }

  console.log(`Itens — vinculados: ${linkedExisting} · criados em craft-system: ${created}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
