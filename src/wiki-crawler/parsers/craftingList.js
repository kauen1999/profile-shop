const { loadWikitext, parseDropsWithImages } = require('./dailyBoss');

const ROW_SPLIT = /\|-\s*style="background: linear-gradient\(90deg, #f8f9fa[^"]*"/;

function stripQuantity(text) {
  const match = text.match(/^(\d+)\s*x?\s*(.+)$/i);
  return match ? match[2].trim() : text.trim();
}

function parseCraftingSection(sectionText) {
  const chunks = sectionText.split(ROW_SPLIT).slice(1);
  const recipes = [];
  for (const chunk of chunks) {
    const bolds = parseDropsWithImages(chunk);
    if (bolds.length < 2) continue;
    const [recipe, ...rawIngredients] = bolds;
    recipes.push({
      name: recipe.name,
      file: recipe.file,
      ingredients: rawIngredients.map((i) => ({ name: stripQuantity(i.name), file: i.file })),
    });
  }
  return recipes;
}

function buildCraftingIndex() {
  const wikitext = loadWikitext('Craft System');
  const tmStart = wikitext.indexOf('== TM Crafting List ==');
  const heldStart = wikitext.indexOf('== Held Items Crafting List ==');
  const outrosStart = wikitext.indexOf('== Outros ==');

  const tmSection = wikitext.slice(tmStart, heldStart);
  const heldSection = wikitext.slice(heldStart, outrosStart === -1 ? undefined : outrosStart);

  return {
    tms: parseCraftingSection(tmSection),
    heldItems: parseCraftingSection(heldSection),
  };
}

module.exports = { buildCraftingIndex };
