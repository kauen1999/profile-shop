const express = require('express');
const { prisma } = require('../db');
const { asyncHandler } = require('../asyncHandler');
const { requireAuth } = require('../authMiddleware');
const { computeExtraMovesCap } = require('./storePokemonOptions');
const { resolveItemTemplate } = require('./storeItemOptions');

const VALID_GAME_WORLDS = ['BLUE', 'GREEN', 'RED', 'BLACK', 'PURPLE', 'SILVER', 'GOLD'];

// Shared by POST / and PATCH /me — normalizes+validates the `worlds` array a
// store registers itself under (StoreWorld, `@@unique([storeId, world])`).
// Returns `{ worlds }` (deduped, only when the input differs) on success, or
// `{ error }` on the first invalid value found. `undefined`/absent input is
// treated as "no change" (returns `{ worlds: undefined }`), matching the
// same "only touch what's present" convention as every other optional field
// on these two routes — registering a world is optional, per the request
// this was built from ("adicione... a opção de colocar o mundo").
function normalizeWorlds(worlds) {
  if (worlds === undefined) return { worlds: undefined };
  if (!Array.isArray(worlds)) return { error: 'worlds precisa ser uma lista de mundos.' };

  const deduped = [...new Set(worlds.map((w) => String(w).toUpperCase()))];
  const invalid = deduped.find((w) => !VALID_GAME_WORLDS.includes(w));
  if (invalid) {
    return {
      error: `"${invalid}" não é um mundo válido — precisa ser um dos valores: ${VALID_GAME_WORLDS.join(', ')}.`,
    };
  }

  return { worlds: deduped };
}

// Mirrors prisma/schema.prisma's StoreListingStatus enum (added 2026-07-14
// alongside the PATCH/DELETE routes below).
const VALID_LISTING_STATUSES = ['ACTIVE', 'HIDDEN', 'SOLD'];

const router = express.Router();

// Reserved slugs — names that would collide with existing frontend routes
// (see frontend/src/... router). Checked case-insensitively before ever
// hitting the DB uniqueness check, so a store never gets created at a URL
// the SPA router would intercept as one of its own pages.
const RESERVED_SLUGS = new Set([
  'login',
  'catalog',
  'mapa-de-dados',
  'cadastro',
  'stores',
  'auth',
  'api',
  // Not in the original task list, but a real technical conflict found
  // while wiring this up: GET /stores/me is mounted at the same path as
  // the public GET /stores/:slug lookup, and Express matches route
  // registration order — a store with slug "me" would be permanently
  // shadowed by the /me route and never reachable publicly.
  'me',
  // Added when the Setup Shop frontend flow was built (2026-07-14): the SPA
  // route `/configurar-loja` (frontend/src/App.jsx, SetupShop.jsx) didn't
  // exist yet when this list was first written. A store named "Configurar
  // Loja" would slugify to this and permanently shadow that route the same
  // way "me" would have — added proactively, not found via a bug report.
  'configurar-loja',
  // Added alongside PATCH /stores/me (2026-07-14): a frontend settings page
  // is about to be built at `/configuracoes` to consume this route. Added
  // proactively, same reasoning as 'configurar-loja' above.
  'configuracoes',
]);

// Same normalization pattern used across the wiki-crawler sync scripts
// (e.g. src/wiki-crawler/parsers/syncDailyBossCatalog.js's slugify) —
// lowercase, strip accents, non-alphanumeric runs collapse to a single
// hyphen, trim leading/trailing hyphens. Kept identical on purpose so slug
// shape is consistent across the whole system, not a second dialect.
function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// There's no DB unique constraint on whatsapp (see prisma/schema.prisma's
// Store model) — this is an application-level
// invariant, checked here instead. Prevents two stores from listing the
// identical contact channel. `contacts` is a { fieldName: rawValue } map of
// only the fields actually being set/changed; `excludeStoreId` omits the
// caller's own store from the collision check (falsy/undefined for the
// creation path, where there's no store yet to exclude). Comparison is
// case-insensitive and trimmed. Returns the first conflicting field name, or
// null if none conflict. Shared by POST / (create) and PATCH /me (update) so
// the same invariant holds wherever contact data enters the system.
async function findConflictingContactField(contacts, excludeStoreId) {
  for (const [field, rawValue] of Object.entries(contacts)) {
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue).trim();
    if (!value) continue;

    const where = { [field]: { equals: value, mode: 'insensitive' } };
    if (excludeStoreId) {
      where.id = { not: excludeStoreId };
    }

    const conflict = await prisma.store.findFirst({ where });
    if (conflict) return field;
  }

  return null;
}

// GET /stores and GET /stores/:slug (public, read-only) stay inline in
// src/index.js — unchanged, not moved here, per task instructions.

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({
      where: { userId: req.currentUser.id },
      include: { StoreWorld: true },
    });

    if (!store) {
      return res.status(404).json({ hasStore: false });
    }

    res.json(store);
  })
);

// GET /stores/me/analytics (2026-07-21) — owner-only, aggregates the
// StoreVisit/StoreListingView event logs plus StoreItem/StorePokemon into the
// dashboard shape the frontend Analytics tab consumes. See CLAUDE.md's
// "Analytics da loja" entry for the full data model.
router.get(
  '/me/analytics',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });

    if (!store) {
      return res.status(404).json({ error: 'Este usuário ainda não possui uma loja.' });
    }

    const storeId = store.id;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Performance (2026-07-22, reported slow/timing out) — this handler
    // originally ran ~10 DB round-trips in sequence, several of them hitting
    // the exact same "SOLD" rows 3 times over (once via `aggregate` for
    // count+sum, once via `findMany` for the species/category breakdown,
    // once more via `findMany` for the sales log). Against this project's
    // Neon connection (documented elsewhere in CLAUDE.md as prone to
    // cold-start latency), that many serial round-trips is exactly what
    // shows up as "demora muito"/eventual fetch failure on the frontend.
    // Fixed two ways: (1) every query below that doesn't depend on another
    // query's result now fires in one `Promise.all` wave instead of
    // sequentially; (2) the SOLD rows are fetched ONCE per table (no `take`
    // limit, so counts/sums/breakdowns still reflect the true lifetime
    // total) and count/sum/bySpecies/byCategory/salesLog are all derived
    // from that same in-memory array — no repeat trips for the same rows.
    // Only `viewedItems`/`viewedPokemon` genuinely depend on `topViewGroups`
    // (need its ids first) and stay a second wave.
    const [visitsRow, rawVisitsPerDay, activeItemsAgg, activePokemonAgg, soldItemsAll, soldPokemonAll, topViewGroups] =
      await Promise.all([
        // Calendar-boundary visit counts (today/week/month) + the rolling
        // last-7-days count used only for the HOT ratio below, all in one
        // query — date_trunc('week', ...) is ISO-week (starts Monday), NOT
        // a rolling window, which is why `last7d` is computed separately
        // from `week` in the same SELECT rather than reused: they answer
        // different questions (calendar week-to-date vs. a fixed rolling
        // window) even though both read the same table.
        prisma.$queryRaw`
          SELECT
            COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('day', NOW()))::int AS today,
            COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('week', NOW()))::int AS week,
            COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW()))::int AS month,
            COUNT(*) FILTER (WHERE "createdAt" >= ${sevenDaysAgo})::int AS last7d
          FROM "StoreVisit" WHERE "storeId" = ${storeId}
        `,
        // Visits per day, last 30 calendar days — groupBy can't bucket by a
        // truncated date, so this uses the same $queryRaw escape hatch
        // already used elsewhere in this project (e.g.
        // src/routes/storePokemonOptions.js's Cherish Ball union query).
        // Zero-filled below, after this wave resolves.
        prisma.$queryRaw`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
          FROM "StoreVisit"
          WHERE "storeId" = ${storeId} AND "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY day
        `,
        // totalAdvertised scopes to ACTIVE listings only, paired with an
        // estimated-revenue figure — only needs count+sum, so `aggregate`
        // (not a row fetch) is the right call here, unlike the SOLD case
        // below which also needs per-row breakdown data.
        prisma.storeItem.aggregate({
          where: { storeId, status: 'ACTIVE' },
          _sum: { priceReal: true, priceHd: true },
          _count: true,
        }),
        prisma.storePokemon.aggregate({
          where: { storeId, status: 'ACTIVE' },
          _sum: { priceReal: true, priceHd: true },
          _count: true,
        }),
        // SOLD rows, fetched once (no `take`) — feeds sold.item/pokemon
        // counts, revenue sums, bySpecies/byCategory, AND salesLog, all
        // derived below without any further query against these rows.
        prisma.storeItem.findMany({
          where: { storeId, status: 'SOLD' },
          include: { CatalogItem: { select: { name: true, category: true } } },
        }),
        prisma.storePokemon.findMany({
          where: { storeId, status: 'SOLD' },
          include: {
            CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem: { select: { name: true } },
          },
        }),
        // Top 10 most-viewed listings, scoped to a rolling last-7-days
        // window (kept consistent with the HOT badge, computed over the
        // same window). Over-fetches 20 groups since some may be orphaned
        // (the referenced StoreItem/StorePokemon was later deleted — no
        // FK/cascade at the listing level for StoreListingView, only at the
        // Store level, see prisma/schema.prisma's comment on the model).
        prisma.storeListingView.groupBy({
          by: ['kind', 'listingId'],
          where: { storeId, createdAt: { gte: sevenDaysAgo } },
          _count: { listingId: true },
          orderBy: { _count: { listingId: 'desc' } },
          take: 20,
        }),
      ]);

    const visits = { today: visitsRow[0].today, week: visitsRow[0].week, month: visitsRow[0].month };
    const visitsLast7Days = visitsRow[0].last7d;

    const countByDay = new Map(
      rawVisitsPerDay.map((row) => [row.day.toISOString().slice(0, 10), row.count])
    );
    const visitsPerDay = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      visitsPerDay.push({ date: key, count: countByDay.get(key) || 0 });
    }

    const bySpeciesMap = new Map();
    for (const row of soldPokemonAll) {
      const name = row.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem?.name;
      if (!name) continue;
      bySpeciesMap.set(name, (bySpeciesMap.get(name) || 0) + 1);
    }
    const bySpecies = [...bySpeciesMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const byCategoryMap = new Map();
    for (const row of soldItemsAll) {
      const category = row.CatalogItem?.category;
      if (!category) continue;
      byCategoryMap.set(category, (byCategoryMap.get(category) || 0) + 1);
    }
    const byCategory = [...byCategoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const itemIds = topViewGroups.filter((g) => g.kind === 'ITEM').map((g) => g.listingId);
    const pokemonIds = topViewGroups.filter((g) => g.kind === 'POKEMON').map((g) => g.listingId);

    const [viewedItems, viewedPokemon] = await Promise.all([
      itemIds.length
        ? prisma.storeItem.findMany({
            where: { id: { in: itemIds }, storeId },
            include: { CatalogItem: true },
          })
        : [],
      pokemonIds.length
        ? prisma.storePokemon.findMany({
            where: { id: { in: pokemonIds }, storeId },
            include: {
              CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem: true,
            },
          })
        : [],
    ]);

    const itemsById = new Map(viewedItems.map((row) => [row.id, row]));
    const pokemonById = new Map(viewedPokemon.map((row) => [row.id, row]));

    const topListings = topViewGroups
      .map((group) => {
        const row =
          group.kind === 'ITEM' ? itemsById.get(group.listingId) : pokemonById.get(group.listingId);
        if (!row) return null; // orphaned view — listing no longer exists, silently dropped

        const catalogItem =
          group.kind === 'ITEM'
            ? row.CatalogItem
            : row.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem;

        const viewCount = group._count.listingId;
        // Guard against divide-by-zero explicitly — a store with 0 visits in
        // the last 7 days must never mark anything HOT (never NaN/Infinity).
        const hotRatio = visitsLast7Days > 0 ? viewCount / visitsLast7Days : 0;

        return {
          kind: group.kind,
          id: group.listingId,
          name: catalogItem?.name || null,
          imageUrl: catalogItem?.imageUrl || null,
          viewCount,
          isHot: hotRatio >= 0.25,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 10);

    // Sales log — same soldItemsAll/soldPokemonAll rows already fetched
    // above (no separate query), capped at 50 total (a defensive cap, not a
    // hard product requirement) after sorting by soldAt desc. soldAt can be
    // null for a row that was somehow marked SOLD before this field existed
    // (pre-existing data from before this refinement) — those sort last,
    // never crash the sort.
    const salesLog = [
      ...soldItemsAll.map((row) => ({
        kind: 'ITEM',
        id: row.id,
        name: row.CatalogItem?.name || null,
        priceReal: row.priceReal,
        priceHd: row.priceHd,
        soldAt: row.soldAt,
      })),
      ...soldPokemonAll.map((row) => ({
        kind: 'POKEMON',
        id: row.id,
        name: row.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem?.name || null,
        priceReal: row.priceReal,
        priceHd: row.priceHd,
        soldAt: row.soldAt,
      })),
    ]
      .sort((a, b) => {
        if (!a.soldAt && !b.soldAt) return 0;
        if (!a.soldAt) return 1; // nulls last
        if (!b.soldAt) return -1;
        return new Date(b.soldAt) - new Date(a.soldAt);
      })
      .slice(0, 50);

    const soldRevenueReal = soldItemsAll.reduce((sum, row) => sum + (row.priceReal || 0), 0) +
      soldPokemonAll.reduce((sum, row) => sum + (row.priceReal || 0), 0);
    const soldRevenueHd = soldItemsAll.reduce((sum, row) => sum + (row.priceHd || 0), 0) +
      soldPokemonAll.reduce((sum, row) => sum + (row.priceHd || 0), 0);

    res.json({
      visits,
      visitsPerDay,
      totalAdvertised: {
        item: activeItemsAgg._count,
        pokemon: activePokemonAgg._count,
        combined: activeItemsAgg._count + activePokemonAgg._count,
        estimatedRevenue: {
          real: (activeItemsAgg._sum.priceReal || 0) + (activePokemonAgg._sum.priceReal || 0),
          hd: (activeItemsAgg._sum.priceHd || 0) + (activePokemonAgg._sum.priceHd || 0),
        },
      },
      sold: {
        item: soldItemsAll.length,
        pokemon: soldPokemonAll.length,
        combined: soldItemsAll.length + soldPokemonAll.length,
        revenue: { real: soldRevenueReal, hd: soldRevenueHd },
        bySpecies,
        byCategory,
      },
      topListings,
      salesLog,
    });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existingStore = await prisma.store.findUnique({
      where: { userId: req.currentUser.id },
    });

    if (existingStore) {
      return res.status(409).json({ error: 'Este usuário já possui uma loja.' });
    }

    const { name, description, gameNickname, whatsapp, worlds } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name é obrigatório.' });
    }

    const { worlds: normalizedWorlds, error: worldsError } = normalizeWorlds(worlds);
    if (worldsError) {
      return res.status(400).json({ error: worldsError });
    }

    const baseSlug = slugify(name);

    if (!baseSlug) {
      return res
        .status(400)
        .json({ error: 'name inválido — não gera um slug utilizável (só caracteres especiais?).' });
    }

    if (RESERVED_SLUGS.has(baseSlug)) {
      return res.status(400).json({
        error: `"${baseSlug}" é uma rota reservada do sistema e não pode ser usado como nome da loja.`,
      });
    }

    // Collision-avoidance against the real Store.slug unique constraint —
    // same spirit as the in-memory `usedSlugs` sets in the catalog sync
    // scripts, but this runs once per request (not a batch loop), so we
    // check the DB directly instead of keeping an in-memory set.
    let slug = baseSlug;
    let suffix = 2;
    while (await prisma.store.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    // Contact-uniqueness invariant (added 2026-07-14 alongside PATCH
    // /stores/me, applied here retroactively for consistency — see
    // findConflictingContactField above). No existing store to exclude yet,
    // hence no excludeStoreId argument.
    const conflictField = await findConflictingContactField({ whatsapp });
    if (conflictField) {
      return res
        .status(409)
        .json({ error: 'Este contato já está em uso por outra loja.', field: conflictField });
    }

    const store = await prisma.store.create({
      data: {
        userId: req.currentUser.id,
        name: name.trim(),
        slug,
        description: (description && String(description).trim()) || null,
        gameNickname: (gameNickname && String(gameNickname).trim()) || null,
        whatsapp: (whatsapp && String(whatsapp).trim()) || null,
        updatedAt: new Date(),
        ...(normalizedWorlds?.length && {
          StoreWorld: { create: normalizedWorlds.map((world) => ({ world })) },
        }),
      },
      include: { StoreWorld: true },
    });

    res.status(201).json(store);
  })
);

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });

    if (!store) {
      return res
        .status(404)
        .json({ error: 'Este usuário ainda não possui uma loja — nada para editar.' });
    }

    const { name, slug, description, gameNickname, whatsapp, worlds } = req.body || {};
    const data = { updatedAt: new Date() };

    const { worlds: normalizedWorlds, error: worldsError } = normalizeWorlds(worlds);
    if (worldsError) {
      return res.status(400).json({ error: worldsError });
    }
    if (normalizedWorlds !== undefined) {
      // Full-set replace, not diff/merge — same pattern already used for
      // StorePokemonAddon/StorePokemonSticker on PATCH /me/pokemon/:id below.
      data.StoreWorld = { deleteMany: {}, create: normalizedWorlds.map((world) => ({ world })) };
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name não pode ser vazio.' });
      }
      data.name = name.trim();
    }

    if (description !== undefined) {
      data.description = (description && String(description).trim()) || null;
    }

    if (slug !== undefined) {
      const candidateSlug = slugify(String(slug));

      if (!candidateSlug) {
        return res
          .status(400)
          .json({ error: 'slug inválido — não gera um valor utilizável (só caracteres especiais?).' });
      }

      // Only validate/collide-check if it actually changed — resubmitting
      // the store's own current slug unchanged is a no-op, not an edit.
      if (candidateSlug !== store.slug) {
        if (RESERVED_SLUGS.has(candidateSlug)) {
          return res.status(400).json({
            error: `"${candidateSlug}" é uma rota reservada do sistema e não pode ser usado como slug da loja.`,
          });
        }

        // Deliberately different from POST /'s creation-time behavior (no
        // auto-suffixing to "-2", "-3", ...): here the user is explicitly
        // typing a slug into a settings field, so a silent substitution
        // would be surprising — a clear 409 they can react to is the right
        // UX for an edit form, not a fallback value they didn't ask for.
        const collision = await prisma.store.findUnique({ where: { slug: candidateSlug } });
        if (collision) {
          return res
            .status(409)
            .json({ error: `O slug "${candidateSlug}" já está em uso por outra loja.` });
        }

        data.slug = candidateSlug;
      }
    }

    if (gameNickname !== undefined) {
      data.gameNickname = (gameNickname && String(gameNickname).trim()) || null;
    }

    // Contact fields: only check uniqueness for values that are actually
    // changing (re-submitting the store's own current value is a no-op, and
    // would otherwise be excluded by excludeStoreId anyway — the "differs"
    // guard just avoids a redundant query per unchanged field).
    const contactFields = { whatsapp };
    const changedContacts = {};

    for (const [field, rawValue] of Object.entries(contactFields)) {
      if (rawValue === undefined) continue;

      const normalized = (rawValue && String(rawValue).trim()) || null;
      const current = (store[field] || '').trim().toLowerCase();

      if (normalized && normalized.toLowerCase() !== current) {
        changedContacts[field] = normalized;
      }

      data[field] = normalized;
    }

    if (Object.keys(changedContacts).length > 0) {
      const conflictField = await findConflictingContactField(changedContacts, store.id);
      if (conflictField) {
        return res.status(409).json({
          error: 'Este contato já está em uso por outra loja.',
          field: conflictField,
        });
      }
    }

    const updated = await prisma.store.update({
      where: { id: store.id },
      data,
      include: { StoreWorld: true },
    });

    res.json(updated);
  })
);

// POST /stores/me/pokemon — creates a StorePokemon listing owned by the
// caller's own Store. Follows the exact requireAuth + asyncHandler +
// "404 if no Store yet" pattern already established by POST / and PATCH /me
// above.
router.post(
  '/me/pokemon',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({
      where: { userId: req.currentUser.id },
      include: { StoreWorld: true },
    });

    if (!store) {
      return res
        .status(404)
        .json({ error: 'Este usuário ainda não possui uma loja — configure uma loja antes de anunciar um Pokémon.' });
    }

    const {
      pokeballCatalogItemId,
      pokemonCatalogItemId,
      level,
      gender,
      nature,
      world,
      nickname,
      addonCatalogItemIds,
      equippedAddonCatalogItemId,
      boost,
      capturedAt,
      heldItemCatalogItemId,
      megaStoneCatalogItemId,
      stickerCatalogItemIds,
      extraMoveCount,
      presetSlotCount,
      priceReal,
      priceHd,
    } = req.body || {};

    const requiredFields = { pokeballCatalogItemId, pokemonCatalogItemId, level, gender, nature, world };
    for (const [field, value] of Object.entries(requiredFields)) {
      if (value === undefined || value === null || value === '') {
        return res.status(400).json({ error: `${field} é obrigatório.` });
      }
    }

    // world is validated against the STORE's own registered worlds
    // (StoreWorld), not just the bare GameWorld enum — a listing can't claim
    // a world its own store never registered under "Mundo" in settings.
    const storeWorlds = store.StoreWorld.map((w) => w.world);
    if (storeWorlds.length === 0) {
      return res.status(400).json({
        error: 'Cadastre ao menos um mundo nas configurações da loja antes de anunciar um Pokémon.',
      });
    }
    if (!storeWorlds.includes(world)) {
      return res.status(400).json({
        error: `world inválido — precisa ser um dos mundos cadastrados pela loja: ${storeWorlds.join(', ')}.`,
      });
    }

    // Shiny toggle removed (2026-07-14) — addonCount replaced by
    // addonCatalogItemIds (an array of CatalogItem.wikiPageIds), following
    // the same nested-create pattern already established below for
    // stickerCatalogItemIds/StorePokemonSticker.
    const normalizedAddonIds = Array.isArray(addonCatalogItemIds)
      ? addonCatalogItemIds.map((id) => Number(id))
      : [];

    if (
      equippedAddonCatalogItemId !== undefined &&
      equippedAddonCatalogItemId !== null &&
      !normalizedAddonIds.includes(Number(equippedAddonCatalogItemId))
    ) {
      return res
        .status(400)
        .json({ error: 'O addon equipado precisa estar entre os addons selecionados.' });
    }

    if (boost !== undefined && boost !== null && Number(boost) < 0) {
      return res.status(400).json({ error: 'boost não pode ser negativo.' });
    }

    let extraMovesText = null;
    let normalizedExtraMoveCount = null;
    if (extraMoveCount !== undefined && extraMoveCount !== null) {
      normalizedExtraMoveCount = Number(extraMoveCount);
      if (normalizedExtraMoveCount < 0) {
        return res.status(400).json({ error: 'extraMoveCount não pode ser negativo.' });
      }
      // Never trust a client-supplied cap — recompute server-side from the
      // same wiki-crawl-backed source GET
      // /store-pokemon-options/pokemon/:wikiPageId/extra-moves-cap uses (see
      // CLAUDE.md's documented data limitation on this computation).
      const { maxExtraMoves } = computeExtraMovesCap(Number(pokemonCatalogItemId));
      if (normalizedExtraMoveCount > maxExtraMoves) {
        return res.status(400).json({
          error: `extraMoveCount excede o máximo permitido para este Pokémon (${maxExtraMoves}).`,
        });
      }
      extraMovesText = normalizedExtraMoveCount > 0 ? `+${normalizedExtraMoveCount}` : null;
    }

    let presetSlotsText = null;
    let normalizedPresetSlotCount = null;
    if (presetSlotCount !== undefined && presetSlotCount !== null) {
      normalizedPresetSlotCount = Number(presetSlotCount);
      if (normalizedPresetSlotCount < 0 || normalizedPresetSlotCount > 3) {
        return res.status(400).json({ error: 'presetSlotCount precisa estar entre 0 e 3.' });
      }
      presetSlotsText = normalizedPresetSlotCount > 0 ? String(normalizedPresetSlotCount) : null;
    }

    // Preço (2026-07-14, revisado): pelo menos um dos dois é obrigatório —
    // um anúncio sem nenhum preço não faz sentido. Nenhum dos dois é
    // individualmente obrigatório (pode ser só Real, só HD, ou os dois),
    // só não pode ficar os dois vazios ao mesmo tempo. "Positivo" (não
    // "não-negativo") por instrução explícita, então 0 também é rejeitado.
    const hasPriceReal = priceReal !== undefined && priceReal !== null && priceReal !== '';
    const hasPriceHd = priceHd !== undefined && priceHd !== null && priceHd !== '';

    if (!hasPriceReal && !hasPriceHd) {
      return res
        .status(400)
        .json({ error: 'Informe ao menos um preço (Real ou HD).' });
    }

    if (hasPriceReal && Number(priceReal) <= 0) {
      return res.status(400).json({ error: 'priceReal precisa ser um valor positivo.' });
    }

    if (hasPriceHd && Number(priceHd) <= 0) {
      return res.status(400).json({ error: 'priceHd precisa ser um valor positivo.' });
    }

    const data = {
      storeId: store.id,
      pokeballCatalogItemId: Number(pokeballCatalogItemId),
      pokemonCatalogItemId: Number(pokemonCatalogItemId),
      level: Number(level),
      gender,
      nature,
      nickname: (nickname && String(nickname).trim()) || null,
      addonCount: normalizedAddonIds.length || null,
      equippedAddonCatalogItemId:
        equippedAddonCatalogItemId !== undefined && equippedAddonCatalogItemId !== null
          ? Number(equippedAddonCatalogItemId)
          : null,
      boost: boost !== undefined && boost !== null ? Number(boost) : null,
      capturedAt: (capturedAt && String(capturedAt).trim()) || null,
      heldItemCatalogItemId:
        heldItemCatalogItemId !== undefined && heldItemCatalogItemId !== null
          ? Number(heldItemCatalogItemId)
          : null,
      megaStoneCatalogItemId:
        megaStoneCatalogItemId !== undefined && megaStoneCatalogItemId !== null
          ? Number(megaStoneCatalogItemId)
          : null,
      // Bug fix (2026-07-18): this create only ever wrote the *derived*
      // display strings (extraMovesText/presetSlotsText) — the actual
      // numeric extraMoveCount/presetSlotCount columns, which is what the
      // edit-form prefill and the storefront card/modal both read, were
      // never assigned here and stayed permanently null regardless of what
      // the form submitted.
      extraMoveCount: normalizedExtraMoveCount > 0 ? normalizedExtraMoveCount : null,
      extraMovesText,
      presetSlotCount: normalizedPresetSlotCount > 0 ? normalizedPresetSlotCount : null,
      presetSlotsText,
      world,
      priceReal: hasPriceReal ? Number(priceReal) : null,
      priceHd: hasPriceHd ? Number(priceHd) : null,
      updatedAt: new Date(),
    };

    if (normalizedAddonIds.length) {
      data.StorePokemonAddon = {
        create: normalizedAddonIds.map((id) => ({ addonCatalogItemId: id })),
      };
    }

    if (Array.isArray(stickerCatalogItemIds) && stickerCatalogItemIds.length) {
      data.StorePokemonSticker = {
        create: stickerCatalogItemIds.map((id) => ({ stickerCatalogItemId: Number(id) })),
      };
    }

    const storePokemon = await prisma.storePokemon.create({
      data,
      include: { StorePokemonSticker: true, StorePokemonAddon: true },
    });

    res.status(201).json(storePokemon);
  })
);

// POST /stores/me/items — creates a StoreItem listing owned by the caller's
// own Store. Follows the exact requireAuth + asyncHandler + "404 if no Store
// yet" pattern already established by POST /me/pokemon above.
router.post(
  '/me/items',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });

    if (!store) {
      return res
        .status(404)
        .json({ error: 'Este usuário ainda não possui uma loja — configure uma loja antes de anunciar um item.' });
    }

    const {
      catalogItemId,
      serialNumber,
      acquiredAt,
      originWorld,
      quantity,
      notes,
      priceReal,
      priceHd,
    } = req.body || {};

    if (catalogItemId === undefined || catalogItemId === null || catalogItemId === '') {
      return res.status(400).json({ error: 'catalogItemId é obrigatório.' });
    }

    const catalogItem = await prisma.catalogItem.findUnique({
      where: { wikiPageId: Number(catalogItemId) },
    });

    if (!catalogItem) {
      return res.status(400).json({ error: 'catalogItemId não corresponde a nenhum item do catálogo.' });
    }

    // Never trust a client-supplied template — always re-resolve it
    // server-side from the CatalogItem's own metadata, same "never trust
    // client, recompute" principle already used for the Pokémon form's
    // extra-moves-cap validation above. The resolved template isn't used to
    // reject fields outside its scope (see "don't over-validate" note
    // below) — it exists purely so a future stricter validation pass has
    // something authoritative to check against, computed here rather than
    // duplicated.
    resolveItemTemplate(catalogItem);

    if (originWorld !== undefined && originWorld !== null && originWorld !== '') {
      if (!VALID_GAME_WORLDS.includes(originWorld)) {
        return res.status(400).json({
          error: `originWorld inválido — precisa ser um dos valores: ${VALID_GAME_WORLDS.join(', ')}.`,
        });
      }
    }

    let normalizedQuantity = 1;
    if (quantity !== undefined && quantity !== null && quantity !== '') {
      normalizedQuantity = Number(quantity);
      if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
        return res.status(400).json({ error: 'quantity precisa ser um número inteiro positivo.' });
      }
    }

    // Preço: mesma regra já estabelecida em POST /me/pokemon — pelo menos um
    // dos dois é obrigatório, cada um precisa ser positivo (não apenas
    // não-negativo) se informado.
    const hasPriceReal = priceReal !== undefined && priceReal !== null && priceReal !== '';
    const hasPriceHd = priceHd !== undefined && priceHd !== null && priceHd !== '';

    if (!hasPriceReal && !hasPriceHd) {
      return res
        .status(400)
        .json({ error: 'Informe ao menos um preço (Real ou HD).' });
    }

    if (hasPriceReal && Number(priceReal) <= 0) {
      return res.status(400).json({ error: 'priceReal precisa ser um valor positivo.' });
    }

    if (hasPriceHd && Number(priceHd) <= 0) {
      return res.status(400).json({ error: 'priceHd precisa ser um valor positivo.' });
    }

    // Don't over-validate: serialNumber/acquiredAt/originWorld being present
    // on a non-legendary item (or quantity on a non-stackable one) is not
    // rejected — these fields simply aren't required outside their
    // associated template, per plan.
    const storeItem = await prisma.storeItem.create({
      data: {
        storeId: store.id,
        catalogItemId: catalogItem.wikiPageId,
        serialNumber: (serialNumber && String(serialNumber).trim()) || null,
        acquiredAt: (acquiredAt && String(acquiredAt).trim()) || null,
        originWorld: originWorld || null,
        quantity: normalizedQuantity,
        notes: (notes && String(notes).trim()) || null,
        priceReal: hasPriceReal ? Number(priceReal) : null,
        priceHd: hasPriceHd ? Number(priceHd) : null,
        updatedAt: new Date(),
      },
    });

    res.status(201).json(storeItem);
  })
);

// PATCH /stores/me/items/:id — edits a StoreItem the caller owns.
// catalogItemId is NOT accepted here (immutable after creation — read from
// the existing row, never from the request body). Ownership check: the row
// must exist AND belong to the caller's own Store, otherwise a uniform 404
// (never reveals whether the id exists under a different store).
router.patch(
  '/me/items/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });
    const id = Number(req.params.id);

    const existing = Number.isInteger(id)
      ? await prisma.storeItem.findUnique({ where: { id } })
      : null;

    if (!store || !existing || existing.storeId !== store.id) {
      return res.status(404).json({ error: 'Item não encontrado.' });
    }

    const { serialNumber, acquiredAt, originWorld, quantity, notes, priceReal, priceHd, status } =
      req.body || {};

    const data = { updatedAt: new Date() };

    if (status !== undefined) {
      if (!VALID_LISTING_STATUSES.includes(status)) {
        return res.status(400).json({
          error: `status inválido — precisa ser um dos valores: ${VALID_LISTING_STATUSES.join(', ')}.`,
        });
      }
      data.status = status;
      // soldAt stamps the exact moment a listing transitions to SOLD (used by
      // the Analytics dashboard's sales log) — cleared if the status is moved
      // back away from SOLD (e.g. "Reverter venda"). Only touched when
      // `status` is present in the request body at all.
      data.soldAt = status === 'SOLD' ? new Date() : null;
    }

    if (serialNumber !== undefined) {
      data.serialNumber = (serialNumber && String(serialNumber).trim()) || null;
    }

    if (acquiredAt !== undefined) {
      data.acquiredAt = (acquiredAt && String(acquiredAt).trim()) || null;
    }

    if (originWorld !== undefined) {
      if (originWorld === null || originWorld === '') {
        data.originWorld = null;
      } else if (!VALID_GAME_WORLDS.includes(originWorld)) {
        return res.status(400).json({
          error: `originWorld inválido — precisa ser um dos valores: ${VALID_GAME_WORLDS.join(', ')}.`,
        });
      } else {
        data.originWorld = originWorld;
      }
    }

    if (quantity !== undefined) {
      // Mirrors POST /me/items: a falsy value (null/'') resets to the
      // schema default (1) rather than being treated as "leave unchanged" —
      // the field key being present at all means the caller is touching it.
      let normalizedQuantity = 1;
      if (quantity !== null && quantity !== '') {
        normalizedQuantity = Number(quantity);
      }
      if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
        return res.status(400).json({ error: 'quantity precisa ser um número inteiro positivo.' });
      }
      data.quantity = normalizedQuantity;
    }

    if (notes !== undefined) {
      data.notes = (notes && String(notes).trim()) || null;
    }

    // Preço (2026-07-14, PATCH): diferente de POST, aqui NÃO se exige "pelo
    // menos um preço" no geral — só se valida presença-e-positividade de
    // qual campo de preço estiver de fato no corpo desta requisição. Uma
    // requisição que só manda { status: 'HIDDEN' } não pode ser rejeitada
    // por falta de preço, já que a linha já tem preço válido desde a
    // criação. Um valor vazio/nulo explícito limpa o preço daquele campo.
    if (priceReal !== undefined) {
      if (priceReal === null || priceReal === '') {
        data.priceReal = null;
      } else if (Number(priceReal) <= 0) {
        return res.status(400).json({ error: 'priceReal precisa ser um valor positivo.' });
      } else {
        data.priceReal = Number(priceReal);
      }
    }

    if (priceHd !== undefined) {
      if (priceHd === null || priceHd === '') {
        data.priceHd = null;
      } else if (Number(priceHd) <= 0) {
        return res.status(400).json({ error: 'priceHd precisa ser um valor positivo.' });
      } else {
        data.priceHd = Number(priceHd);
      }
    }

    const updated = await prisma.storeItem.update({ where: { id }, data });

    res.json(updated);
  })
);

// DELETE /stores/me/items/:id — same ownership check as PATCH above, real
// delete (no soft-delete concept here — that's what status: HIDDEN is for).
router.delete(
  '/me/items/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });
    const id = Number(req.params.id);

    const existing = Number.isInteger(id)
      ? await prisma.storeItem.findUnique({ where: { id } })
      : null;

    if (!store || !existing || existing.storeId !== store.id) {
      return res.status(404).json({ error: 'Item não encontrado.' });
    }

    await prisma.storeItem.delete({ where: { id } });

    res.status(204).send();
  })
);

// PATCH /stores/me/pokemon/:id — edits a StorePokemon the caller owns.
// Unlike Items, the full field set (including species/pokéball) is
// editable here, per the approved plan. Re-runs the same validations
// POST /me/pokemon does, but only for whichever fields are actually present
// in the body — mirrors the "only touch what's included" principle used by
// PATCH /me/items/:id above. addonCatalogItemIds/stickerCatalogItemIds, when
// present, replace the full nested set (delete + recreate) rather than
// diffing — simplest correct behavior for a full-form edit.
router.patch(
  '/me/pokemon/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({
      where: { userId: req.currentUser.id },
      include: { StoreWorld: true },
    });
    const id = Number(req.params.id);

    const existing = Number.isInteger(id)
      ? await prisma.storePokemon.findUnique({
          where: { id },
          include: { StorePokemonAddon: true },
        })
      : null;

    if (!store || !existing || existing.storeId !== store.id) {
      return res.status(404).json({ error: 'Pokémon não encontrado.' });
    }

    const {
      pokeballCatalogItemId,
      pokemonCatalogItemId,
      level,
      gender,
      nature,
      world,
      nickname,
      addonCatalogItemIds,
      equippedAddonCatalogItemId,
      boost,
      capturedAt,
      heldItemCatalogItemId,
      megaStoneCatalogItemId,
      stickerCatalogItemIds,
      extraMoveCount,
      presetSlotCount,
      priceReal,
      priceHd,
      status,
    } = req.body || {};

    const data = { updatedAt: new Date() };

    if (status !== undefined) {
      if (!VALID_LISTING_STATUSES.includes(status)) {
        return res.status(400).json({
          error: `status inválido — precisa ser um dos valores: ${VALID_LISTING_STATUSES.join(', ')}.`,
        });
      }
      data.status = status;
      // soldAt stamps the exact moment a listing transitions to SOLD (used by
      // the Analytics dashboard's sales log) — cleared if the status is moved
      // back away from SOLD (e.g. "Reverter venda"). Only touched when
      // `status` is present in the request body at all.
      data.soldAt = status === 'SOLD' ? new Date() : null;
    }

    // These are required-on-create fields (see POST /me/pokemon above) —
    // on PATCH they're optional (only validated if the key is present), but
    // if present, clearing one to blank is rejected the same way POST
    // rejects a missing value for them — unlike Items' genuinely-optional
    // fields, these have no meaningful "cleared" state.
    const requiredIfPresent = { pokeballCatalogItemId, pokemonCatalogItemId, level, gender, nature, world };
    for (const [field, value] of Object.entries(requiredIfPresent)) {
      if (value !== undefined && (value === null || value === '')) {
        return res.status(400).json({ error: `${field} não pode ser vazio.` });
      }
    }

    if (world !== undefined) {
      // Same store-registered-worlds check as POST /me/pokemon above.
      const storeWorlds = store.StoreWorld.map((w) => w.world);
      if (!storeWorlds.includes(world)) {
        return res.status(400).json({
          error: `world inválido — precisa ser um dos mundos cadastrados pela loja: ${storeWorlds.join(', ')}.`,
        });
      }
      data.world = world;
    }

    if (pokeballCatalogItemId !== undefined) data.pokeballCatalogItemId = Number(pokeballCatalogItemId);
    if (pokemonCatalogItemId !== undefined) data.pokemonCatalogItemId = Number(pokemonCatalogItemId);
    if (level !== undefined) data.level = Number(level);
    if (gender !== undefined) data.gender = gender;
    if (nature !== undefined) data.nature = nature;
    if (nickname !== undefined) data.nickname = (nickname && String(nickname).trim()) || null;

    // Effective addon set used for the equipped-addon-membership check
    // below: the newly-provided set if addonCatalogItemIds is in the body,
    // otherwise whatever addons this StorePokemon already has.
    let effectiveAddonIds = existing.StorePokemonAddon.map((a) => a.addonCatalogItemId);
    const addonsProvided = addonCatalogItemIds !== undefined;
    if (addonsProvided) {
      effectiveAddonIds = Array.isArray(addonCatalogItemIds)
        ? addonCatalogItemIds.map((n) => Number(n))
        : [];
    }

    if (
      equippedAddonCatalogItemId !== undefined &&
      equippedAddonCatalogItemId !== null &&
      !effectiveAddonIds.includes(Number(equippedAddonCatalogItemId))
    ) {
      return res
        .status(400)
        .json({ error: 'O addon equipado precisa estar entre os addons selecionados.' });
    }

    if (equippedAddonCatalogItemId !== undefined) {
      data.equippedAddonCatalogItemId =
        equippedAddonCatalogItemId !== null ? Number(equippedAddonCatalogItemId) : null;
    }

    if (boost !== undefined) {
      if (boost !== null && Number(boost) < 0) {
        return res.status(400).json({ error: 'boost não pode ser negativo.' });
      }
      data.boost = boost !== null ? Number(boost) : null;
    }

    if (capturedAt !== undefined) {
      data.capturedAt = (capturedAt && String(capturedAt).trim()) || null;
    }

    if (heldItemCatalogItemId !== undefined) {
      data.heldItemCatalogItemId =
        heldItemCatalogItemId !== null ? Number(heldItemCatalogItemId) : null;
    }

    if (megaStoneCatalogItemId !== undefined) {
      data.megaStoneCatalogItemId =
        megaStoneCatalogItemId !== null ? Number(megaStoneCatalogItemId) : null;
    }

    // Bug fix (2026-07-18): same gap as POST /me/pokemon above — this block
    // only ever wrote the derived extraMovesText, never the numeric
    // extraMoveCount column the edit-form prefill and the storefront
    // card/modal actually read, so editing a listing to add/change extra
    // moves silently had no visible effect and the field always came back
    // empty when reopening the form.
    if (extraMoveCount !== undefined) {
      if (extraMoveCount === null || extraMoveCount === '') {
        data.extraMoveCount = null;
        data.extraMovesText = null;
      } else {
        const normalizedExtraMoveCount = Number(extraMoveCount);
        if (normalizedExtraMoveCount < 0) {
          return res.status(400).json({ error: 'extraMoveCount não pode ser negativo.' });
        }
        // Same "never trust client, recompute" principle as POST
        // /me/pokemon — cap is derived from whichever pokemonCatalogItemId
        // is effective for this update (the newly-provided one if present,
        // otherwise the row's existing species).
        const effectivePokemonId =
          pokemonCatalogItemId !== undefined ? Number(pokemonCatalogItemId) : existing.pokemonCatalogItemId;
        const { maxExtraMoves } = computeExtraMovesCap(effectivePokemonId);
        if (normalizedExtraMoveCount > maxExtraMoves) {
          return res.status(400).json({
            error: `extraMoveCount excede o máximo permitido para este Pokémon (${maxExtraMoves}).`,
          });
        }
        data.extraMoveCount = normalizedExtraMoveCount > 0 ? normalizedExtraMoveCount : null;
        data.extraMovesText = normalizedExtraMoveCount > 0 ? `+${normalizedExtraMoveCount}` : null;
      }
    }

    if (presetSlotCount !== undefined) {
      if (presetSlotCount === null || presetSlotCount === '') {
        data.presetSlotCount = null;
        data.presetSlotsText = null;
      } else {
        const normalizedPresetSlotCount = Number(presetSlotCount);
        if (normalizedPresetSlotCount < 0 || normalizedPresetSlotCount > 3) {
          return res.status(400).json({ error: 'presetSlotCount precisa estar entre 0 e 3.' });
        }
        data.presetSlotCount = normalizedPresetSlotCount > 0 ? normalizedPresetSlotCount : null;
        data.presetSlotsText = normalizedPresetSlotCount > 0 ? String(normalizedPresetSlotCount) : null;
      }
    }

    // Preço: mesma regra de PATCH /me/items/:id acima.
    if (priceReal !== undefined) {
      if (priceReal === null || priceReal === '') {
        data.priceReal = null;
      } else if (Number(priceReal) <= 0) {
        return res.status(400).json({ error: 'priceReal precisa ser um valor positivo.' });
      } else {
        data.priceReal = Number(priceReal);
      }
    }

    if (priceHd !== undefined) {
      if (priceHd === null || priceHd === '') {
        data.priceHd = null;
      } else if (Number(priceHd) <= 0) {
        return res.status(400).json({ error: 'priceHd precisa ser um valor positivo.' });
      } else {
        data.priceHd = Number(priceHd);
      }
    }

    if (addonsProvided) {
      data.addonCount = effectiveAddonIds.length || null;
      // Full-set replace, not diff/merge (per plan) — delete this
      // StorePokemon's existing addon rows and recreate from the provided
      // array, all within the same nested update.
      data.StorePokemonAddon = {
        deleteMany: {},
        create: effectiveAddonIds.map((addonCatalogItemId) => ({ addonCatalogItemId })),
      };
    }

    if (stickerCatalogItemIds !== undefined) {
      const normalizedStickerIds = Array.isArray(stickerCatalogItemIds)
        ? stickerCatalogItemIds.map((n) => Number(n))
        : [];
      data.StorePokemonSticker = {
        deleteMany: {},
        create: normalizedStickerIds.map((stickerCatalogItemId) => ({ stickerCatalogItemId })),
      };
    }

    const updated = await prisma.storePokemon.update({
      where: { id },
      data,
      include: { StorePokemonSticker: true, StorePokemonAddon: true },
    });

    res.json(updated);
  })
);

// DELETE /stores/me/pokemon/:id — same ownership check as above. Real
// delete; StorePokemonAddon/StorePokemonSticker rows cascade automatically
// per their onDelete: Cascade in prisma/schema.prisma.
router.delete(
  '/me/pokemon/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });
    const id = Number(req.params.id);

    const existing = Number.isInteger(id)
      ? await prisma.storePokemon.findUnique({ where: { id } })
      : null;

    if (!store || !existing || existing.storeId !== store.id) {
      return res.status(404).json({ error: 'Pokémon não encontrado.' });
    }

    await prisma.storePokemon.delete({ where: { id } });

    res.status(204).send();
  })
);

module.exports = router;
