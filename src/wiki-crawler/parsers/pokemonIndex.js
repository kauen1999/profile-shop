const fs = require('fs');
const path = require('path');
const config = require('../config');

const GENERATION_PAGES = {
  1: 'Primeira Geração',
  2: 'Segunda Geração',
  3: 'Terceira Geração',
  4: 'Quarta Geração',
  5: 'Quinta Geração',
  6: 'Sexta Geração',
  7: 'Setima Geração',
};

const REGIONAL_FORMS_PAGE = 'Regional Forms';

function loadWikitext(title) {
  const index = JSON.parse(fs.readFileSync(config.indexPath, 'utf-8'));
  const entry = index.pages[title];
  if (!entry || entry.missing || entry.failed || !entry.file) {
    throw new Error(`Página "${title}" não encontrada no índice do crawler.`);
  }
  const pagePath = path.join(config.dataDir, entry.file);
  const page = JSON.parse(fs.readFileSync(pagePath, 'utf-8'));
  return page.wikitext;
}

function parsePokedexPage(wikitext) {
  const blocks = wikitext.split('<div class="square-box-pokedex">').slice(1);
  return blocks
    .map((block) => {
      const nameMatch = block.match(/<p class="square-name-pokedex">\[\[([^\]|]+)\]\]<\/p>/);
      const numberMatch = block.match(/#(\d+)/);
      const imageMatch = block.match(/Arquivo:([^|]+)\|link=/);
      const typeMatches = [...block.matchAll(/Arquivo:[^|]+-tipo\.png\|([A-Za-zÀ-ÿ]+)\]\]/g)];
      return {
        name: nameMatch ? nameMatch[1].trim() : null,
        pokedexNumber: numberMatch ? parseInt(numberMatch[1], 10) : null,
        imageFile: imageMatch ? imageMatch[1].trim() : null,
        types: typeMatches.map((m) => m[1]),
      };
    })
    .filter((entry) => entry.name);
}

function buildPokemonIndex() {
  const pokemon = [];

  for (const [generation, title] of Object.entries(GENERATION_PAGES)) {
    const wikitext = loadWikitext(title);
    const entries = parsePokedexPage(wikitext);
    for (const entry of entries) {
      pokemon.push({ ...entry, generation: Number(generation), regionalForm: false });
    }
  }

  const regionalWikitext = loadWikitext(REGIONAL_FORMS_PAGE);
  const regionalEntries = parsePokedexPage(regionalWikitext);
  for (const entry of regionalEntries) {
    pokemon.push({ ...entry, generation: null, regionalForm: true });
  }

  return pokemon;
}

module.exports = { buildPokemonIndex, parsePokedexPage, GENERATION_PAGES, REGIONAL_FORMS_PAGE };
