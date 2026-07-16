require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../../db');
const config = require('../config');
const { buildPokemonIndex } = require('./pokemonIndex');

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

async function main() {
  const crawlIndex = JSON.parse(fs.readFileSync(config.indexPath, 'utf-8'));
  const parsed = buildPokemonIndex();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of parsed) {
    const pageEntry = crawlIndex.pages[entry.name];
    if (!pageEntry || !pageEntry.pageid) {
      console.warn(`Sem pageid no índice do crawler para "${entry.name}", pulando.`);
      skipped++;
      continue;
    }

    const wikiPageId = pageEntry.pageid;
    const imageUrl = entry.imageFile ? mwImageUrl(entry.imageFile) : null;
    const wikiUrl = `${BASE_URL}/${encodeURIComponent(entry.name.replace(/ /g, '_'))}`;
    const newFields = {
      generation: entry.generation,
      regionalForm: entry.regionalForm,
      types: entry.types,
      pokedexNumber: entry.pokedexNumber,
    };

    const existing = await prisma.catalogItem.findUnique({ where: { wikiPageId } });

    if (existing) {
      await prisma.catalogItem.update({
        where: { wikiPageId },
        data: {
          extractedFields: { ...(existing.extractedFields || {}), ...newFields },
          updatedAt: new Date(),
        },
      });
      updated++;
    } else {
      await prisma.catalogItem.create({
        data: {
          wikiPageId,
          name: entry.name,
          slug: slugify(entry.name),
          category: 'pokemon',
          imageUrl: imageUrl || '',
          wikiTitle: entry.name,
          wikiUrl,
          searchableText: `${entry.name.toLowerCase()} pokemon`,
          extractedFields: newFields,
          updatedAt: new Date(),
        },
      });
      created++;
    }
  }

  console.log(`\nConcluído. Criados: ${created} · Atualizados: ${updated} · Pulados: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
