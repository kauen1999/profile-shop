const fs = require('fs');
const path = require('path');
const express = require('express');
const { prisma } = require('../db');
const { asyncHandler } = require('../asyncHandler');

const router = express.Router();

const WIKI_CRAWL_DIR = path.resolve(__dirname, '..', '..', 'data', 'wiki-crawl');
const WIKI_CRAWL_INDEX_PATH = path.join(WIKI_CRAWL_DIR, 'index.json');

// Lazily-built, module-level (process-lifetime) reverse index: pageid -> file
// path, built once from data/wiki-crawl/index.json's `pages` map (keyed by
// title, not by id). Static local data that never changes at runtime — no
// invalidation needed, per plan.
let wikiPageIdToFile = null;

function getWikiPageIdToFileMap() {
  if (wikiPageIdToFile) return wikiPageIdToFile;

  wikiPageIdToFile = new Map();
  try {
    const raw = fs.readFileSync(WIKI_CRAWL_INDEX_PATH, 'utf8');
    const index = JSON.parse(raw);
    for (const info of Object.values(index?.pages || {})) {
      // A handful of index entries lack a `file` (confirmed during
      // verification) — skip those rather than throw.
      if (info && typeof info.pageid === 'number' && info.file) {
        wikiPageIdToFile.set(info.pageid, info.file);
      }
    }
  } catch (err) {
    console.error('Falha ao carregar data/wiki-crawl/index.json:', err.message);
  }

  return wikiPageIdToFile;
}

// Cache of computed { naturalMoveCount, maxExtraMoves } by wikiPageId — the
// underlying wikitext files are static, never change at runtime.
const extraMovesCapCache = new Map();

const MOVESET_SECTION_RE = /==\s*Moveset Padrão\s*==([\s\S]*?)\n==/i;

// Shared by GET /pokemon/:wikiPageId/extra-moves-cap and the server-side
// recomputation inside POST /stores/me/pokemon (never trust a client-supplied
// cap for validation — see CLAUDE.md's "Setup de loja..." section for the
// documented limitation of this data source: the wikitext table is a fixed
// 8-slot template, so this is a conservative floor, not necessarily the true
// movepool size, for the ~48% of species with all 8 slots filled).
function computeExtraMovesCap(wikiPageId) {
  if (extraMovesCapCache.has(wikiPageId)) {
    return extraMovesCapCache.get(wikiPageId);
  }

  const fallback = { naturalMoveCount: null, maxExtraMoves: 10 };

  const file = getWikiPageIdToFileMap().get(wikiPageId);
  if (!file) {
    extraMovesCapCache.set(wikiPageId, fallback);
    return fallback;
  }

  let result = fallback;
  try {
    const raw = fs.readFileSync(path.join(WIKI_CRAWL_DIR, file), 'utf8');
    const page = JSON.parse(raw);
    const wikitext = page?.wikitext;
    const match = typeof wikitext === 'string' ? wikitext.match(MOVESET_SECTION_RE) : null;

    if (match) {
      const section = match[1];
      const naturalMoveCount = (section.match(/-move-otp\.png/g) || []).length;
      result = {
        naturalMoveCount,
        maxExtraMoves: Math.max(0, 10 - Math.min(naturalMoveCount, 8)),
      };
    }
  } catch (err) {
    console.error(`Falha ao calcular extra-moves-cap para wikiPageId=${wikiPageId}:`, err.message);
    result = fallback;
  }

  extraMovesCapCache.set(wikiPageId, result);
  return result;
}

// All routes here are public, read-only catalog lookups feeding the
// "create Pokémon listing" frontend form — no requireAuth needed (nothing
// mutates, nothing user-specific). Every handler still goes through
// asyncHandler per this project's mandatory convention (Neon hibernates;
// see CLAUDE.md's "Rodando localmente" section).

// Derives the gender options a species can be listed with, from the raw
// wikitext infobox fields captured at sync time (extractedFields.infoboxFields
// — see CatalogItem's `pokemon`/`pokemon-shiny` rows).
// The wiki renders gender icons as `[[Arquivo:Male-otp.png ...]]` /
// `[[Arquivo:Female-otp.png ...]]` / `[[Arquivo:Undefined.png ...]]` inside
// one of the infobox cell values — there's no clean structured field for
// this, so we scan every cell's raw text for those filename substrings.
//
// Critical bug to avoid (flagged during planning and worth re-stating here):
// must check the substring 'Male-otp.png', never bare 'Male' —
// "Female-otp.png".includes("Male") evaluates to `true` (the bare word "Male"
// is a substring of "Female"), which would wrongly mark female-only species
// as male-available too.
function genderOptionsFromInfobox(infoboxFields) {
  const values = Object.values(infoboxFields || {}).map(String);
  if (!values.length) return null;
  if (values.some((v) => v.includes('Undefined.png'))) return ['sem_genero'];
  const options = [];
  if (values.some((v) => v.includes('Male-otp.png'))) options.push('macho');
  if (values.some((v) => v.includes('Female-otp.png'))) options.push('femea');
  return options.length ? options : null;
}

// Some pokemon-shiny rows (sourced via the Cherish-Ball merge, per earlier
// session investigation) have no infoboxFields at all. Falls back to the
// linked base `pokemon` row's infoboxFields (via extractedFields.
// sourceWikiPageId) when the row's own data is unusable, and finally to a
// permissive default rather than blocking the form on missing source data.
async function derivePokemonGenderOptions(extractedFields) {
  const ownOptions = genderOptionsFromInfobox(extractedFields?.infoboxFields);
  if (ownOptions) return ownOptions;

  const sourceWikiPageId = extractedFields?.sourceWikiPageId;
  if (sourceWikiPageId !== undefined && sourceWikiPageId !== null) {
    const base = await prisma.catalogItem.findUnique({
      where: { wikiPageId: Number(sourceWikiPageId) },
    });
    const baseOptions = genderOptionsFromInfobox(base?.extractedFields?.infoboxFields);
    if (baseOptions) return baseOptions;
  }

  return ['macho', 'femea'];
}

async function toOptionShape(item) {
  return {
    wikiPageId: item.wikiPageId,
    name: item.name,
    wikiTitle: item.wikiTitle,
    imageUrl: item.imageUrl,
    genderOptions: await derivePokemonGenderOptions(item.extractedFields),
  };
}

// GET /store-pokemon-options/pokemon?search=&restrictToCherishBall=&page=&pageSize=
router.get(
  '/pokemon',
  asyncHandler(async (req, res) => {
    const { search, restrictToCherishBall, page = '1', pageSize = '60' } = req.query;
    const take = Math.min(Number(pageSize) || 60, 200);
    const currentPage = Math.max(Number(page) || 1, 1);
    const skip = (currentPage - 1) * take;

    let allMatching;

    if (restrictToCherishBall === 'true') {
      // Prisma's structured JSON `equals` filter does not reliably match
      // these rows (confirmed during planning) — raw SQL is required here,
      // same pattern GET /catalog-items already uses for its
      // subcategories/generation JSON filtering (src/routes/catalogItems.js).
      //
      // Union of two independent signals, restored 2026-07-18 after a
      // same-day correction — see CLAUDE.md's "Estado atual do catálogo"
      // 2026-07-18 entries for the full story. A same-day fix earlier had
      // collapsed the dedicated `category = 'cherish-ball-pokemon'` bucket
      // (118 rows) into `category: 'pokemon'`/`'pokemon-shiny'`, on the
      // mistaken assumption that the `cherishBallPokemon` flag was already
      // the single source of truth for this. That was wrong per explicit
      // user correction: a Cherish Ball Pokémon is a distinct catalog item
      // from the plain species (the ball is exclusive and comes bundled
      // with the Pokémon) — the two need to coexist as separate rows, not
      // be merged into one. The 118 rows were restored to their own
      // `category: 'cherish-ball-pokemon'`, and 118 new, separate
      // `category: 'pokemon'` rows were backfilled (one per missing
      // species, e.g. Gengar/Togekiss/Raichu) so those species also show up
      // in the unrestricted list below. Both signals matter here again:
      // - `category = 'cherish-ball-pokemon'`: species/forms whose ONLY
      //   obtainment path is the Cherish Ball (these 118 rows).
      // - `extractedFields.cherishBallPokemon = 'true'` on `pokemon`/
      //   `pokemon-shiny` rows: species obtainable BOTH normally AND via
      //   Cherish Ball (their shiny variant carries the flag; ~89 rows).
      const rows = await prisma.$queryRaw`
        SELECT * FROM "CatalogItem"
        WHERE (category IN ('pokemon', 'pokemon-shiny') AND "extractedFields"->>'cherishBallPokemon' = 'true')
           OR category = 'cherish-ball-pokemon'
      `;
      // Small result set (~207 rows) — filtering by search in JS here rather
      // than pushing it into the raw query, per plan.
      allMatching = search
        ? rows.filter((r) => r.name.toLowerCase().includes(String(search).toLowerCase()))
        : rows;
      allMatching.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Shiny toggle removed (2026-07-14) — the catalog already carries
      // independent `pokemon-shiny` rows, so the unrestricted list now
      // surfaces both categories directly; the frontend picks whichever row
      // (base or shiny) it wants, no separate shiny-resolution step needed.
      // `category = 'cherish-ball-pokemon'` is deliberately NOT included
      // here — those 118 rows only represent the exclusive Cherish Ball
      // variant of a species (see the `restrictToCherishBall` branch
      // above); a plain `category IN ('pokemon', 'pokemon-shiny')` filter
      // naturally excludes them while still including every species' own
      // base `pokemon`/`pokemon-shiny` row (backfilled 2026-07-18 for the
      // 118 species that previously had none) and the ~89
      // `cherishBallPokemon`-flagged rows (correctly still shown here too,
      // since those species ARE obtainable outside the Cherish Ball).
      const where = { category: { in: ['pokemon', 'pokemon-shiny'] } };
      if (search) where.name = { contains: search, mode: 'insensitive' };
      allMatching = await prisma.catalogItem.findMany({ where, orderBy: { name: 'asc' } });
    }

    const total = allMatching.length;
    const paged = allMatching.slice(skip, skip + take);
    const items = await Promise.all(paged.map((item) => toOptionShape(item)));

    res.json({
      items,
      total,
      page: currentPage,
      pageSize: take,
      totalPages: Math.max(Math.ceil(total / take), 1),
    });
  })
);

// GET /store-pokemon-options/mega-stones?pokemonWikiTitle=
router.get(
  '/mega-stones',
  asyncHandler(async (req, res) => {
    const { pokemonWikiTitle } = req.query;
    if (!pokemonWikiTitle) {
      return res.json([]);
    }

    // Only 19 rows total ever — fetch all, filter in JS, no DB-level filter.
    const stones = await prisma.catalogItem.findMany({ where: { category: 'mega-stones' } });
    const target = String(pokemonWikiTitle).trim().toLowerCase();

    // Irregular name → species exceptions where the generic "strip trailing
    // ite" suffix rule below doesn't produce the real species name. Found
    // during verification: "Blastoisinite".replace(/ite$/i, '') yields
    // "Blastoisin", not "Blastoise" (the wiki spells the stone with an
    // extra "in" the species name doesn't have) — the suffix rule alone
    // silently hid this stone from Blastoise's mega-stone list.
    const IRREGULAR_MEGA_STONE_NAMES = {
      blastoisinite: 'blastoise',
    };

    const matches = stones.filter((stone) => {
      const structured = stone.extractedFields?.megaStonePokemonWikiTitle;
      if (structured) {
        return String(structured).trim().toLowerCase() === target;
      }
      // Fallback for the rows without the structured field (confirmed
      // during planning: "Kangaskhanite", "Blastoisinite") — strip a
      // trailing "ite" from the stone's own name and compare, checking the
      // irregular-name table first.
      const stoneNameLower = stone.name.trim().toLowerCase();
      if (IRREGULAR_MEGA_STONE_NAMES[stoneNameLower]) {
        return IRREGULAR_MEGA_STONE_NAMES[stoneNameLower] === target;
      }
      const derived = stone.name.replace(/ite$/i, '');
      return derived.trim().toLowerCase() === target;
    });

    res.json(matches);
  })
);

// GET /store-pokemon-options/addons?pokemonWikiTitle=&search=
router.get(
  '/addons',
  asyncHandler(async (req, res) => {
    const { pokemonWikiTitle, search } = req.query;
    if (!pokemonWikiTitle) {
      return res.json([]);
    }

    // 739 rows total — fetch all, filter in JS (per plan; small enough not
    // to warrant a DB-level filter, and the compatibility data lives inside
    // a JSON array so a DB-level filter would need its own raw-SQL anyway).
    const addons = await prisma.catalogItem.findMany({ where: { category: 'addons' } });
    const target = String(pokemonWikiTitle).trim();
    const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const nameDashAddonRe = new RegExp(`^${escapedTarget}\\s*-\\s*.*Addon$`, 'i');
    const addonParaRe = new RegExp(`addon para\\s+${escapedTarget}$`, 'i');

    // Attach the matched addonCompatibilities entry (if any) alongside each
    // addon, so the looktype image URLs can be pulled straight from it below
    // — computed once here rather than re-searching the array a second time.
    let matches = [];
    for (const addon of addons) {
      const compatibilities = addon.extractedFields?.addonCompatibilities;
      if (Array.isArray(compatibilities) && compatibilities.length) {
        const matchedCompatibility = compatibilities.find(
          (c) => String(c?.pokemonWikiTitle || '').trim().toLowerCase() === target.toLowerCase()
        );
        if (matchedCompatibility) {
          matches.push({ addon, matchedCompatibility });
        }
        continue;
      }
      // Regex fallback, only for the ~173 rows lacking addonCompatibilities.
      // Rows matching neither pattern (generic names, no species signal)
      // simply never appear for any species — expected, not a bug. No
      // structured compatibility data exists for these, so no looktype
      // images either (see fields below).
      if (nameDashAddonRe.test(addon.name) || addonParaRe.test(addon.name)) {
        matches.push({ addon, matchedCompatibility: null });
      }
    }

    if (search) {
      const searchLower = String(search).toLowerCase();
      matches = matches.filter(({ addon }) => addon.name.toLowerCase().includes(searchLower));
    }

    res.json(
      matches.map(({ addon, matchedCompatibility }) => ({
        wikiPageId: addon.wikiPageId,
        name: addon.name,
        imageUrl: addon.imageUrl,
        looktypeImageUrl: matchedCompatibility?.looktypeImageUrl ?? null,
        looktypeShinyImageUrl: matchedCompatibility?.looktypeShinyImageUrl ?? null,
      }))
    );
  })
);

// GET /store-pokemon-options/pokemon/:wikiPageId/extra-moves-cap
router.get(
  '/pokemon/:wikiPageId/extra-moves-cap',
  asyncHandler(async (req, res) => {
    const wikiPageId = Number(req.params.wikiPageId);
    if (!Number.isInteger(wikiPageId)) {
      return res.status(400).json({ error: 'wikiPageId inválido.' });
    }

    res.json(computeExtraMovesCap(wikiPageId));
  })
);

// computeExtraMovesCap is re-exported (alongside the router as the default
// shape Express expects) so POST /stores/me/pokemon (src/routes/stores.js)
// can recompute the same cap server-side for validation, instead of trusting
// a client-supplied value or duplicating this parsing logic.
module.exports = router;
module.exports.computeExtraMovesCap = computeExtraMovesCap;
