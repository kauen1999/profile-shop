require('dotenv').config();
const crypto = require('crypto');
const { prisma } = require('../../db');
const { buildCraftingIndex } = require('./craftingList');
const { classifyItemCategory } = require('./categoryClassifier');

const BASE_URL = 'https://wiki.otponline.com/Craft_System';

function mwImageUrl(filename) {
  const normalized = filename.replace(/ /g, '_');
  const capitalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const hash = crypto.createHash('md5').update(capitalized).digest('hex');
  return `${BASE_URL.split('/Craft_System')[0]}/images/${hash[0]}/${hash.slice(0, 2)}/${capitalized}`;
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
  const hash = crypto.createHash('md5').update(`craft-ingredient:${name.toLowerCase()}`).digest();
  const num = hash.readUInt32BE(0) % 90000000;
  return 1400000000 + num;
}

function buildIngredientMap(craftingIndex) {
  const items = new Map();

  const recipes = [
    ...craftingIndex.tms.map((r) => ({ ...r, recipeType: 'tm' })),
    ...craftingIndex.heldItems.map((r) => ({ ...r, recipeType: 'held-item' })),
  ];

  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const key = ingredient.name.toLowerCase();
      if (!items.has(key)) items.set(key, { name: ingredient.name, file: ingredient.file, usedFor: [] });
      if (!items.get(key).file && ingredient.file) items.get(key).file = ingredient.file;
      items.get(key).usedFor.push({ recipe: recipe.name, recipeType: recipe.recipeType });
    }
  }

  return { items, recipes };
}

async function main() {
  const craftingIndex = buildCraftingIndex();
  const { items, recipes } = buildIngredientMap(craftingIndex);

  let linkedExisting = 0;
  let created = 0;
  let imagesBackfilled = 0;
  const usedSlugs = new Set();

  for (const { name, file, usedFor } of items.values()) {
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
        extractedFields: { ...(existing.extractedFields || {}), craftIngredient: usedFor },
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
    let slug = `craft-ingredient-${slugify(name)}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `craft-ingredient-${slugify(name)}-${suffix++}`;
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
        wikiUrl: BASE_URL,
        searchableText: `${name.toLowerCase()} craft ingredient`,
        extractedFields: {
          craftIngredient: usedFor,
          ...(classification.matchedRule ? {} : { classifierFallback: true }),
        },
        updatedAt: new Date(),
      },
    });
    created++;
  }

  // Also tag the crafted TMs/Held Items themselves with their recipe (what it costs to craft them).
  let recipesLinked = 0;
  for (const recipe of recipes) {
    const existing = await prisma.catalogItem.findFirst({
      where: {
        OR: [
          { wikiTitle: { equals: recipe.name, mode: 'insensitive' } },
          { name: { equals: recipe.name, mode: 'insensitive' } },
        ],
      },
    });
    if (!existing) continue;

    const data = {
      extractedFields: {
        ...(existing.extractedFields || {}),
        craftingRecipe: { type: recipe.recipeType, ingredients: recipe.ingredients.map((i) => i.name) },
      },
      updatedAt: new Date(),
    };
    if (!existing.imageUrl && recipe.file) {
      data.imageUrl = mwImageUrl(recipe.file);
      imagesBackfilled++;
    }
    await prisma.catalogItem.update({ where: { wikiPageId: existing.wikiPageId }, data });
    recipesLinked++;
  }

  console.log(`Receitas: ${recipes.length} (${craftingIndex.tms.length} TMs + ${craftingIndex.heldItems.length} Held Items)`);
  console.log(
    `Ingredientes — únicos: ${items.size} · vinculados: ${linkedExisting} · criados em craft-ingredients: ${created}`
  );
  console.log(`Itens crafteáveis marcados com craftingRecipe: ${recipesLinked}`);
  console.log(`Imagens preenchidas (que estavam vazias): ${imagesBackfilled}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
