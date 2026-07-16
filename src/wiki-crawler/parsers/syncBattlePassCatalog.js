require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { buildBattlePassIndex } = require('./battlePass');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com';
const BATTLE_PASS_WIKI_URL = `${BASE_URL}/Battle_Pass`;

function mwImageUrl(filename) {
  const normalized = filename.replace(/ /g, '_');
  const capitalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const hash = crypto.createHash('md5').update(capitalized).digest('hex');
  return `${BASE_URL}/images/${hash[0]}/${hash.slice(0, 2)}/${capitalized}`;
}

function stripQuantity(text) {
  if (!text || text === '-') return null;
  const match = text.match(/^(\d+)\s*x?\s*(.+)$/i);
  return match ? match[2].trim() : text.trim();
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
  const hash = crypto.createHash('md5').update(name.toLowerCase()).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  return 1900000000 + num;
}

function buildItemMap(seasons) {
  const items = new Map();

  for (const [seasonNum, rewards] of Object.entries(seasons)) {
    for (const reward of rewards) {
      for (const track of ['free', 'premium']) {
        const name = stripQuantity(reward[track]);
        if (!name) continue;
        const file = reward[`${track}File`];
        const key = name.toLowerCase();
        if (!items.has(key)) {
          items.set(key, { name, file, appearances: [] });
        }
        if (!items.get(key).file && file) items.get(key).file = file;
        items.get(key).appearances.push({
          season: Number(seasonNum),
          level: reward.level,
          track,
        });
      }
    }
  }

  return items;
}

async function main() {
  const seasons = buildBattlePassIndex();
  const items = buildItemMap(seasons);

  let created = 0;
  let updated = 0;
  let imagesBackfilled = 0;
  const usedSlugs = new Set();

  for (const { name, file, appearances } of items.values()) {
    const wikiPageId = stableWikiPageId(name);
    const existing = await prisma.catalogItem.findUnique({ where: { wikiPageId } });

    let slug = `battle-pass-${slugify(name)}`;
    if (existing) {
      slug = existing.slug;
    } else {
      let suffix = 2;
      while (usedSlugs.has(slug)) {
        slug = `battle-pass-${slugify(name)}-${suffix++}`;
      }
    }
    usedSlugs.add(slug);

    let imageUrl = existing?.imageUrl || '';
    if (!imageUrl && file) {
      imageUrl = mwImageUrl(file);
      imagesBackfilled++;
    }

    // `battle-pass` is a retired source-category name (Architecture Rule 1).
    // Genuinely-new items get classified into a real type category; an item
    // this script already created before (found by its own synthetic
    // wikiPageId, no cross-linking to other categories by design — see
    // CLAUDE.md) keeps its existing category untouched on update, same as
    // every other field here.
    const classification = existing ? null : classifyItemCategory(name);
    const data = {
      name,
      slug,
      category: existing ? existing.category : classification.category,
      imageUrl,
      wikiTitle: name,
      wikiUrl: BATTLE_PASS_WIKI_URL,
      searchableText: `${name.toLowerCase()} battle pass`,
      extractedFields: {
        appearances,
        ...(classification && !classification.matchedRule ? { classifierFallback: true } : {}),
      },
      updatedAt: new Date(),
    };

    if (existing) {
      await prisma.catalogItem.update({ where: { wikiPageId }, data });
      updated++;
    } else {
      await prisma.catalogItem.create({ data: { wikiPageId, ...data } });
      created++;
    }
  }

  console.log(
    `\nConcluído. Itens únicos: ${items.size} · Criados: ${created} · Atualizados: ${updated} · Imagens preenchidas: ${imagesBackfilled}`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
