require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { buildDailyBossIndex } = require('./dailyBoss');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com';
const DAILY_BOSS_URL = `${BASE_URL}/Daily_Boss`;

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

function stableWikiPageId(namespace, name) {
  const hash = crypto.createHash('md5').update(`${namespace}:${name.toLowerCase()}`).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  const bases = { drop: 1500000000, access: 1400000000 };
  return bases[namespace] + num;
}

function buildMaps(bosses) {
  const drops = new Map();
  const access = new Map();

  for (const boss of bosses) {
    for (const drop of boss.dropsWithImages) {
      const key = drop.name.toLowerCase();
      if (!drops.has(key)) drops.set(key, { name: drop.name, file: drop.file, sources: [] });
      if (!drops.get(key).file && drop.file) drops.get(key).file = drop.file;
      drops.get(key).sources.push({ boss: boss.name, section: boss.section, cooldown: boss.cooldown });
    }

    if (boss.access && boss.access.toLowerCase() !== boss.name.toLowerCase()) {
      const key = boss.access.toLowerCase();
      if (!access.has(key)) access.set(key, { name: boss.access, bosses: [] });
      access.get(key).bosses.push({ boss: boss.name, section: boss.section });
    }
  }

  return { drops, access };
}

async function syncCategory(map, namespace, category, sourceField) {
  let linkedExisting = 0;
  let created = 0;
  let imagesBackfilled = 0;
  const usedSlugs = new Set();

  for (const { name, file, ...meta } of map.values()) {
    const sources = meta.sources || meta.bosses;
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
        extractedFields: { ...(existing.extractedFields || {}), [sourceField]: sources },
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

    const wikiPageId = stableWikiPageId(namespace, name);
    let slug = `${category}-${slugify(name)}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${category}-${slugify(name)}-${suffix++}`;
    }
    usedSlugs.add(slug);

    // `daily-boss-access` records seasonal access windows, not physical items —
    // left untouched (open question, see CLAUDE.md). `daily-boss-drops` is a
    // retired source-category name; newly-created drop items get classified
    // into a real type category instead (Architecture Rule 1).
    const classification = namespace === 'access' ? null : classifyItemCategory(name);
    const assignedCategory = namespace === 'access' ? category : classification.category;

    await prisma.catalogItem.create({
      data: {
        wikiPageId,
        name,
        slug,
        category: assignedCategory,
        imageUrl: file ? mwImageUrl(file) : '',
        wikiTitle: name,
        wikiUrl: DAILY_BOSS_URL,
        searchableText: `${name.toLowerCase()} ${category}`,
        extractedFields: {
          [sourceField]: sources,
          ...(classification && !classification.matchedRule ? { classifierFallback: true } : {}),
        },
        updatedAt: new Date(),
      },
    });
    created++;
  }

  return { linkedExisting, created, imagesBackfilled, total: map.size };
}

async function main() {
  const bosses = buildDailyBossIndex();
  const { drops, access } = buildMaps(bosses);

  // Dedupe case-insensitive casing variants, keeping first-seen name.
  const dedupe = (map) => {
    const out = new Map();
    for (const [key, value] of map) {
      if (!out.has(key)) {
        out.set(key, value);
        continue;
      }
      const existing = out.get(key);
      if (!existing.file && value.file) existing.file = value.file;
      if (existing.sources) existing.sources.push(...value.sources);
      else existing.bosses.push(...value.bosses);
    }
    return out;
  };

  const dropsResult = await syncCategory(dedupe(drops), 'drop', 'daily-boss-drops', 'dailyBossSources');
  const accessResult = await syncCategory(dedupe(access), 'access', 'daily-boss-access', 'dailyBossAccessSources');

  console.log(`\nBosses processados: ${bosses.length}`);
  console.log(
    `Drops — únicos: ${dropsResult.total} · vinculados: ${dropsResult.linkedExisting} · criados: ${dropsResult.created} · imagens preenchidas: ${dropsResult.imagesBackfilled}`
  );
  console.log(
    `Acesso — únicos: ${accessResult.total} · vinculados: ${accessResult.linkedExisting} · criados: ${accessResult.created}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
