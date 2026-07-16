require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com';

const ELEMENTAL_TYPES = [
  'Bug', 'Dark', 'Dragon', 'Fairy', 'Figthing', 'Fire', 'Flying', 'Ghost',
  'Grass', 'Ground', 'Ice', 'Metal', 'Normal', 'Poison', 'Psychic', 'Rock',
  'Thunder', 'Water',
];

const EVENTS = [
  {
    title: 'Capture o Pokémon',
    url: `${BASE_URL}/Capture_o_Pok%C3%A9mon`,
    shop: false,
    items: [
      'Boost Stone', 'Heart Stone', 'Rock Stone', 'Dragon Stone', 'Ice Stone',
      'Sun Stone', 'Dusk Stone', 'Insect Stone', 'Thunder Stone', 'Earth Stone',
      'Leaf Stone', 'Water Stone', 'Fairy Stone', 'Poison Stone', 'Winner Stone',
      'Fire Stone', 'Psychic Stone', 'Ursaring backpack',
    ].map((name) => ({ name, tier: 'reward_pool' })),
  },
  {
    title: 'Bug Catcher',
    url: `${BASE_URL}/Bug_Catcher`,
    shop: false,
    items: [
      { name: 'Butterfree Plush', tier: '1st_place_pool', file: 'Pelucia Butterfree.png' },
      { name: 'Shiny Butterfree Plush', tier: '1st_place_pool', file: 'Pelucia Shiny Butterfree.png' },
      { name: 'Kriketot Plush', tier: '1st_place_pool', file: 'Pelucia Kriketot.png' },
      { name: 'Shiny Kriketot Plush', tier: '1st_place_pool', file: 'Pelucia Shiny Kriketot.png' },
      { name: 'Sun Stone', tier: '1st_place_fixed' },
      { name: 'Sitrus Berry', tier: '2nd_3rd_place' },
    ],
  },
  {
    title: 'Capture a Bandeira',
    url: `${BASE_URL}/Capture_a_Bandeira`,
    shop: false,
    items: [
      { name: 'Great Ball', tier: 'winning_team' },
      { name: 'Premier Ball', tier: 'winning_team' },
    ],
  },
  {
    title: 'Mewtwo Castle',
    url: `${BASE_URL}/Mewtwo_Castle`,
    shop: true,
    items: [
      { name: 'Mewtwo Statue', price: 100000000, file: 'Mewtwo Statue.png' },
      { name: "Mewtwo'S Statue", price: 200000000, file: 'Mewtwo statue.png' },
      { name: 'Mewtwo Tapestry', price: 1000000, file: 'Mewtwo Tapestry.png' },
      { name: 'Folded Mewtwo Carpet', price: 1000000, file: 'Folded Mewtwo Carpet.png' },
      { name: 'Mewtwo backpack', price: 20000000, file: 'Mewtwo backpack.png' },
      { name: 'Classic Mewtwo backpack', price: 40000000, file: 'Classic Mewtwo backpack.png' },
      { name: 'Black Mewtwo backpack', price: 60000000, file: 'Black Mewtwo backpack.png' },
    ].map((item) => ({ ...item, currency: 'gold' })),
  },
  {
    title: 'Tower Challenge',
    url: `${BASE_URL}/Tower_Challenge`,
    shop: true,
    items: [
      ...ELEMENTAL_TYPES.map((type) => ({
        name: `${type} backpack`,
        file: `${type} backpack.png`,
      })),
      ...ELEMENTAL_TYPES.map((type) => ({
        name: `${type} carpet`,
        file: `${type} carpet.png`,
      })),
      { name: 'Sealed Outfit Box', file: 'Sealed Outfit Box.png' },
    ],
  },
];

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
  const hash = crypto.createHash('md5').update(`event:${name.toLowerCase()}`).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  return 1600000000 + num;
}

function buildItemMap() {
  const items = new Map();

  for (const event of EVENTS) {
    for (const item of event.items) {
      const key = item.name.toLowerCase();
      if (!items.has(key)) {
        items.set(key, { name: item.name, file: item.file, sources: [] });
      }
      const entry = items.get(key);
      if (!entry.file && item.file) entry.file = item.file;
      entry.sources.push({
        event: event.title,
        url: event.url,
        obtainMethod: event.shop ? 'shop' : 'reward',
        tier: item.tier,
        price: item.price,
        currency: item.currency,
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
        extractedFields: { ...(existing.extractedFields || {}), eventSources: sources },
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
    let slug = `event-${slugify(name)}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `event-${slugify(name)}-${suffix++}`;
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
        wikiUrl: sources[0].url,
        searchableText: `${name.toLowerCase()} event`,
        extractedFields: {
          eventSources: sources,
          classificationReason: sources.some((s) => s.obtainMethod === 'shop')
            ? 'event_shop_table'
            : 'event_reward_table',
          ...(classification.matchedRule ? {} : { classifierFallback: true }),
        },
        updatedAt: new Date(),
      },
    });
    created++;
  }

  console.log(
    `\nConcluído. Itens únicos: ${items.size} · Vinculados a itens existentes: ${linkedExisting} · Criados em event-items: ${created} · Imagens preenchidas: ${imagesBackfilled}`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
