import { parseLookText } from './src/domain/parseLookText.js';
import { resolveImportDraft } from './src/domain/resolveImportDraft.js';

const store = await fetch('http://localhost:3000/stores/teste').then(r => r.json());
const { buildStoreExportText } = await import('./src/domain/buildExportText.js');
const text = buildStoreExportText(store);

const parsed = parseLookText(text);
console.log('blocks:', parsed.length, parsed.map(p => p.kind));

const resolved = await Promise.all(parsed.map((p) => resolveImportDraft(p)));
resolved.forEach((d, i) => {
  if (d.kind === 'pokemon') {
    console.log(i, 'pokemon', {
      pokeball: d.pokeball.status, pokeballName: d.pokeball.item?.name,
      pokemon: d.pokemon.status, pokemonName: d.pokemon.item?.name,
      heldItem: d.heldItem.status, heldItemName: d.heldItem.item?.name,
      megaStone: d.megaStone.status, megaStoneName: d.megaStone.item?.name,
      equippedAddon: d.equippedAddon.status, equippedAddonName: d.equippedAddon.item?.name,
      stickers: d.stickers.map(s => [s.name, s.status, s.item?.name]),
    });
  } else if (d.kind === 'item') {
    console.log(i, 'item', { item: d.item.status, itemName: d.item.item?.name });
  } else {
    console.log(i, 'unparseable', d.rawText.slice(0,60));
  }
});
