require('dotenv').config();
const { prisma } = require('../../db');
const { buildPokemonIndex } = require('./pokemonIndex');

async function main() {
  const parsed = buildPokemonIndex();
  const byTitle = new Map(parsed.map((entry) => [entry.name.toLowerCase(), entry]));

  const shinyItems = await prisma.catalogItem.findMany({ where: { category: 'pokemon-shiny' } });

  let updated = 0;
  let unmatched = 0;

  for (const item of shinyItems) {
    const entry = byTitle.get(item.wikiTitle.toLowerCase());
    if (!entry) {
      console.warn(`Sem correspondência na lista de gerações para "${item.wikiTitle}" (shiny).`);
      unmatched++;
      continue;
    }

    await prisma.catalogItem.update({
      where: { wikiPageId: item.wikiPageId },
      data: {
        extractedFields: {
          ...(item.extractedFields || {}),
          generation: entry.generation,
          regionalForm: entry.regionalForm,
          types: entry.types,
          pokedexNumber: entry.pokedexNumber,
        },
        updatedAt: new Date(),
      },
    });
    updated++;
  }

  console.log(`\nConcluído. Atualizados: ${updated} · Sem correspondência: ${unmatched}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
