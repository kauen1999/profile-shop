require('dotenv').config();
const { prisma } = require('../../db');

// Maps an extractedFields key (how/where an item is obtained or used) to its
// subcategory label. Only cross-system "sourcing" keys go here — the
// classification-provenance fields from the legacy pipeline (sections,
// infoboxFields, addonEntityId, etc.) are not subcategories.
const SUBCATEGORY_KEYS = [
  'eventSources',
  'dailyBossSources',
  'dailyBossAccessSources',
  'dungeonSources',
  'questSources',
  'npcShopSources',
  'minigameSources',
  'craftSystemSource',
  'craftIngredient',
  'appearances', // battle pass reward appearances
];

const SUBCATEGORY_LABELS = {
  appearances: 'battlePassSources',
};

async function main() {
  const items = await prisma.catalogItem.findMany({
    where: { NOT: { extractedFields: { equals: null } } },
  });

  let updated = 0;
  let unchanged = 0;

  for (const item of items) {
    const fields = item.extractedFields || {};
    const subcategories = SUBCATEGORY_KEYS.filter((key) => {
      const value = fields[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }).map((key) => SUBCATEGORY_LABELS[key] || key);

    const existing = JSON.stringify(fields.subcategories || []);
    if (existing === JSON.stringify(subcategories)) {
      unchanged++;
      continue;
    }

    if (subcategories.length === 0) {
      unchanged++;
      continue;
    }

    await prisma.catalogItem.update({
      where: { wikiPageId: item.wikiPageId },
      data: {
        extractedFields: { ...fields, mainCategory: item.category, subcategories },
        updatedAt: new Date(),
      },
    });
    updated++;
  }

  console.log(`Itens verificados: ${items.length} · com subcategorias atualizadas: ${updated} · sem mudança: ${unchanged}`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { SUBCATEGORY_KEYS, SUBCATEGORY_LABELS };
