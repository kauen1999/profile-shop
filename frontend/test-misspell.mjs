import { parseLookText } from './src/domain/parseLookText.js';
import { resolveImportDraft } from './src/domain/resolveImportDraft.js';

const text = `Você vê uma Great Ball com um Pinsir.

Nível: 80
Gênero: Fêmea
Nickname: Big Claw
Addons: 1
Usando: Hollow Addon
BOOST: +3
Nature: Jolly
Capturado em: 12/12/2024
Held item: Air Baloon
Mega Stone: Pinsirite
Stickers: Acid Seal
Extra Moves: +2
Preset Slots: 1`;

const parsed = parseLookText(text);
const [draft] = await Promise.all(parsed.map((p) => resolveImportDraft(p)));
console.log(JSON.stringify({
  pokeball: draft.pokeball.status,
  pokemon: draft.pokemon.status,
  heldItem: draft.heldItem.status,
  heldItemCandidates: draft.heldItem.candidates.map(c => c.name),
  megaStone: draft.megaStone.status,
  equippedAddon: draft.equippedAddon.status,
}, null, 2));
