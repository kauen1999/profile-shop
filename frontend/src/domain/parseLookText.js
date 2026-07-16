// Pure text parsing for the "import listings from look text" feature — the
// exact reverse of buildPokemonLookText.js/buildItemLookText.js. No network,
// no catalog knowledge (name→CatalogItem resolution lives in
// resolveImportDraft.js) — this module only turns raw pasted text into plain
// JS field values.

import { GENDER_LABELS } from './buildPokemonLookText';
import { GAME_WORLD_LABELS } from './buildItemLookText';

// The one line the game itself always generates at the start of a look text
// (see buildPokemonLookText.js/buildItemLookText.js's first line) — the only
// reliable, always-present marker of "a new block starts here". Neither a
// free-form item description nor any recognized label line ever begins with
// this exact phrase.
const BLOCK_START_PREFIX = 'Você vê ';

// A real look copied straight out of the game's chat log is prefixed with a
// timestamp on its first line (e.g. "18:45 Você vê uma Dive Ball..."), which
// buildPokemonLookText.js/buildItemLookText.js never generate themselves (our
// own export format has no timestamp either) — strip it before matching
// BLOCK_START_PREFIX/the first-line regexes below, on every line
// defensively (harmless on a line that never had one).
const TIMESTAMP_PREFIX_RE = /^\d{1,2}:\d{2}(?::\d{2})?\s+/;

function stripTimestampPrefix(line) {
  return line.replace(TIMESTAMP_PREFIX_RE, '');
}

// More specific pattern tried first — has " com " between the two nouns,
// which the item pattern below never has.
const POKEMON_FIRST_LINE_RE = /^Você vê (?:um|uma) (.+?) com (?:um|uma) (.+?)\.$/i;
const ITEM_FIRST_LINE_RE = /^Você vê (?:um|uma) (.+?)\.$/i;

// Builds { LABEL_TEXT: enumValue } -> { enumValue: LABEL_TEXT } in reverse,
// so the same fixed label tables the builders already export
// (GENDER_LABELS/GAME_WORLD_LABELS) are the single source of truth for both
// directions — never a second, hand-duplicated table.
function invertLabelMap(labelMap) {
  const inverted = {};
  Object.entries(labelMap).forEach(([value, label]) => {
    inverted[label.toLowerCase()] = value;
  });
  return inverted;
}

const GENDER_VALUE_BY_LABEL = invertLabelMap(GENDER_LABELS);
const GAME_WORLD_VALUE_BY_LABEL = invertLabelMap(GAME_WORLD_LABELS);

// Reverse of toSealName (buildPokemonLookText.js) — a sticker is stored in
// the catalog as "X Capsule" but displayed/exported as "X Seal"; going back
// from pasted text to a catalog-searchable name means undoing that
// substitution.
export function fromSealName(name) {
  return name.replace(/Seal/gi, 'Capsule');
}

const POKEMON_LABEL_FIELDS = {
  nível: 'levelRaw',
  gênero: 'genderLabelRaw',
  nickname: 'nickname',
  addons: 'addonCountRaw',
  usando: 'equippedAddonName',
  boost: 'boostRaw',
  nature: 'nature',
  'capturado em': 'capturedAt',
  'held item': 'heldItemName',
  'mega stone': 'megaStoneName',
  stickers: 'stickerNamesRaw',
  'extra moves': 'extraMoveCountRaw',
  'preset slots': 'presetSlotCountRaw',
  'preço real': 'priceRealRaw',
  'preço hd': 'priceHdRaw',
};

// Value formats are fixed by buildExportText.js (the only writer of these
// two lines — they're not part of the real in-game look text, only our own
// export format): "R$ 12.5" and "5 HD". Stripping the fixed prefix/suffix
// back off is enough — no locale/thousands-separator parsing needed since
// buildExportText.js never adds one.
function parsePriceRealRaw(raw) {
  return raw.replace(/^R\$\s*/i, '').trim();
}

function parsePriceHdRaw(raw) {
  return raw.replace(/\s*HD$/i, '').trim();
}

// "Slots"/"Pode ser usado em" are informative/derived-from-catalog lines
// that buildItemLookText.js renders but the creation payload never accepts
// (see CLAUDE.md's "Criação de anúncio de Item") — recognized here just so
// they're deliberately dropped instead of accidentally falling into `notes`.
const ITEM_IGNORED_LABELS = new Set(['slots', 'pode ser usado em']);

const ITEM_LABEL_FIELDS = {
  'número de série': 'serialNumber',
  data: 'acquiredAt',
  'mundo de origem': 'originWorldLabelRaw',
  quantidade: 'quantityRaw',
  'preço real': 'priceRealRaw',
  'preço hd': 'priceHdRaw',
};

// Splits a block of pasted text (possibly several look texts concatenated,
// with or without blank lines between them) into one raw string per look
// text. Anything before the first marker line is discarded (never a
// legitimate look text on its own).
export function splitLookBlocks(rawText) {
  if (!rawText) return [];

  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let current = null;

  for (const rawLine of lines) {
    const line = stripTimestampPrefix(rawLine.trim());
    if (line.startsWith(BLOCK_START_PREFIX)) {
      if (current) blocks.push(current.join('\n').trim());
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current.join('\n').trim());

  return blocks.filter((block) => block.length > 0);
}

// Splits a "Label: valor" line on the first ": " only (values may
// themselves legitimately contain a colon, e.g. a date/time).
function splitLabelLine(line) {
  const index = line.indexOf(': ');
  if (index === -1) return null;
  return { label: line.slice(0, index).trim(), value: line.slice(index + 2).trim() };
}

function parsePokemonBlock(block, match, restLines) {
  const fields = {
    pokeballName: match[1].trim(),
    pokemonName: match[2].trim(),
    levelRaw: '',
    genderLabelRaw: '',
    nickname: '',
    addonCountRaw: '',
    equippedAddonName: '',
    boostRaw: '',
    nature: '',
    capturedAt: '',
    heldItemName: '',
    megaStoneName: '',
    stickerNamesRaw: '',
    extraMoveCountRaw: '',
    presetSlotCountRaw: '',
    priceRealRaw: '',
    priceHdRaw: '',
  };
  const unrecognizedLines = [];

  restLines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return; // the blank separator line, or any extra blank line — never meaningful

    const split = splitLabelLine(line);
    if (!split) {
      unrecognizedLines.push(line);
      return;
    }

    const fieldKey = POKEMON_LABEL_FIELDS[split.label.toLowerCase()];
    if (!fieldKey) {
      unrecognizedLines.push(line);
      return;
    }

    fields[fieldKey] = split.value;
  });

  const level = fields.levelRaw !== '' ? fields.levelRaw : '';
  const gender = GENDER_VALUE_BY_LABEL[fields.genderLabelRaw.toLowerCase()] || '';
  const addonCount = fields.addonCountRaw !== '' ? Number(fields.addonCountRaw) : null;
  // BOOST/Extra Moves are always rendered as "+N" by the builders — strip
  // the leading "+" back off so the value is a plain editable number again.
  const boost = fields.boostRaw.replace(/^\+/, '');
  const extraMoveCount = fields.extraMoveCountRaw.replace(/^\+/, '');
  const presetSlotCount = fields.presetSlotCountRaw;
  const stickerNames = fields.stickerNamesRaw
    ? fields.stickerNamesRaw
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .map(fromSealName)
    : [];
  const priceReal = fields.priceRealRaw ? parsePriceRealRaw(fields.priceRealRaw) : '';
  const priceHd = fields.priceHdRaw ? parsePriceHdRaw(fields.priceHdRaw) : '';

  return {
    kind: 'pokemon',
    rawText: block,
    fields: {
      pokeballName: fields.pokeballName,
      pokemonName: fields.pokemonName,
      level,
      gender,
      nickname: fields.nickname,
      addonCount,
      equippedAddonName: fields.equippedAddonName,
      boost,
      nature: fields.nature,
      capturedAt: fields.capturedAt,
      heldItemName: fields.heldItemName,
      megaStoneName: fields.megaStoneName,
      stickerNames,
      extraMoveCount,
      presetSlotCount,
      priceReal,
      priceHd,
    },
    unrecognizedLines,
  };
}

function parseItemBlock(block, match, restLines) {
  const fields = {
    serialNumber: '',
    acquiredAt: '',
    originWorldLabelRaw: '',
    quantityRaw: '',
    priceRealRaw: '',
    priceHdRaw: '',
  };
  // Every line that isn't a recognized label (including the free-form,
  // unlabeled flavor-text line the game puts last — see buildItemLookText.js's
  // `notes` param) is preserved verbatim as part of the item's description —
  // never silently dropped.
  const notesLines = [];

  restLines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const split = splitLabelLine(line);
    if (!split) {
      notesLines.push(line);
      return;
    }

    const normalizedLabel = split.label.toLowerCase();
    if (ITEM_IGNORED_LABELS.has(normalizedLabel)) return;

    const fieldKey = ITEM_LABEL_FIELDS[normalizedLabel];
    if (!fieldKey) {
      notesLines.push(line);
      return;
    }

    fields[fieldKey] = split.value;
  });

  const originWorld = GAME_WORLD_VALUE_BY_LABEL[fields.originWorldLabelRaw.toLowerCase()] || '';
  const priceReal = fields.priceRealRaw ? parsePriceRealRaw(fields.priceRealRaw) : '';
  const priceHd = fields.priceHdRaw ? parsePriceHdRaw(fields.priceHdRaw) : '';

  return {
    kind: 'item',
    rawText: block,
    fields: {
      itemName: match[1].trim(),
      serialNumber: fields.serialNumber,
      acquiredAt: fields.acquiredAt,
      originWorld,
      quantity: fields.quantityRaw,
      notes: notesLines.join('\n'),
      priceReal,
      priceHd,
    },
  };
}

// Parses a single already-split block. Tries the more specific Pokémon
// pattern (has " com ") first, then the Item pattern; a block matching
// neither is `unparseable` and shown as-is in the review screen, never
// guessed at.
export function parseLookBlock(block) {
  const firstLine = block.split('\n')[0].trim();
  const restLines = block.split('\n').slice(1);

  const pokemonMatch = firstLine.match(POKEMON_FIRST_LINE_RE);
  if (pokemonMatch) return parsePokemonBlock(block, pokemonMatch, restLines);

  const itemMatch = firstLine.match(ITEM_FIRST_LINE_RE);
  if (itemMatch) return parseItemBlock(block, itemMatch, restLines);

  return { kind: 'unparseable', rawText: block };
}

// Convenience wrapper combining both steps — what ImportListings.jsx calls
// directly on "Analisar".
export function parseLookText(rawText) {
  return splitLookBlocks(rawText).map(parseLookBlock);
}
