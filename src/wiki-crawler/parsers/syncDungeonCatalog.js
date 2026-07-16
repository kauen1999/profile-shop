require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { buildDungeonsIndexMap, extractDropsFromPage } = require('./dungeons');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com';

function mwImageUrl(filename) {
  const normalized = filename.replace(/ /g, '_');
  const capitalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const hash = crypto.createHash('md5').update(capitalized).digest('hex');
  return `${BASE_URL}/images/${hash[0]}/${hash.slice(0, 2)}/${capitalized}`;
}

const DUNGEONS = [
  { name: 'Nightmare', title: 'Nightmare Dungeon', temporary: false, source: 'index' },
  { name: 'Magma', title: 'Magma Dungeon', temporary: false, source: 'index' },
  { name: 'Undersea Volcano', title: 'Undersea Volcano', temporary: false, source: 'index' },
  { name: 'Sacred Ruins', title: 'Sacred Ruins Dungeon', temporary: false, source: 'index' },
  {
    name: 'Porygon Toy',
    title: 'Porygon Toy',
    temporary: true,
    source: 'page',
    pages: [{ title: 'Porygon Toy', heading: '== Recompensas ==' }],
  },
  {
    name: 'Halloween',
    title: 'Halloween Dungeon',
    temporary: true,
    source: 'page',
    pages: [
      { title: 'Halloween Dungeon 2024', heading: '== Recompensas ==' },
      { title: 'Halloween Dungeon 2025', heading: '== Recompensas ==' },
    ],
  },
  { name: 'Easter', title: 'Easter Dungeon', temporary: true, source: 'index' },
  { name: 'Burning Prison', title: 'Burning Prison', temporary: true, source: 'index' },
  {
    name: 'PokeRift',
    title: 'PokeRift',
    temporary: true,
    source: 'page',
    pages: [{ title: 'PokeRift', heading: '== Dungeon Rewards ==' }],
  },
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
  const hash = crypto.createHash('md5').update(`dungeon-drop:${name.toLowerCase()}`).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  return 1300000000 + num;
}

function buildItemMap() {
  const indexMap = buildDungeonsIndexMap();
  const items = new Map();

  for (const dungeon of DUNGEONS) {
    let drops;
    if (dungeon.source === 'index') {
      const row = indexMap.get(dungeon.name.toLowerCase());
      drops = row ? row.drops.map((name) => ({ name, file: null })) : [];
    } else {
      const seen = new Set();
      drops = [];
      for (const page of dungeon.pages) {
        for (const drop of extractDropsFromPage(page.title, page.heading)) {
          if (seen.has(drop.name.toLowerCase())) continue;
          seen.add(drop.name.toLowerCase());
          drops.push(drop);
        }
      }
    }

    for (const drop of drops) {
      const key = drop.name.toLowerCase();
      if (!items.has(key)) items.set(key, { name: drop.name, file: drop.file, sources: [] });
      if (!items.get(key).file && drop.file) items.get(key).file = drop.file;
      items.get(key).sources.push({ dungeon: dungeon.name, temporary: dungeon.temporary });
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
        extractedFields: { ...(existing.extractedFields || {}), dungeonSources: sources },
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
    let slug = `dungeon-${slugify(name)}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `dungeon-${slugify(name)}-${suffix++}`;
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
        wikiUrl: `${BASE_URL}/${encodeURIComponent(sources[0].dungeon.replace(/ /g, '_'))}`,
        searchableText: `${name.toLowerCase()} dungeon`,
        extractedFields: {
          dungeonSources: sources,
          ...(classification.matchedRule ? {} : { classifierFallback: true }),
        },
        updatedAt: new Date(),
      },
    });
    created++;
  }

  console.log(`\nDungeons processadas: ${DUNGEONS.length}`);
  console.log(
    `Itens — únicos: ${items.size} · vinculados a itens existentes: ${linkedExisting} · criados em dungeon-drops: ${created} · imagens preenchidas: ${imagesBackfilled}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
