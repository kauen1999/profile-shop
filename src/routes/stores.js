const express = require('express');
const { prisma } = require('../db');
const { asyncHandler } = require('../asyncHandler');
const { requireAuth } = require('../authMiddleware');
const { computeExtraMovesCap } = require('./storePokemonOptions');
const { resolveItemTemplate } = require('./storeItemOptions');

const VALID_GAME_WORLDS = ['BLUE', 'GREEN', 'RED', 'BLACK', 'PURPLE', 'SILVER', 'GOLD'];

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

// There's no DB unique constraint on whatsapp/discord/telegram (see
// prisma/schema.prisma's Store model) — this is an application-level
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
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });

    if (!store) {
      return res.status(404).json({ hasStore: false });
    }

    res.json(store);
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

    const { name, description, gameNickname, whatsapp, discord, telegram } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name é obrigatório.' });
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
    const conflictField = await findConflictingContactField({ whatsapp, discord, telegram });
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
        discord: (discord && String(discord).trim()) || null,
        telegram: (telegram && String(telegram).trim()) || null,
        updatedAt: new Date(),
      },
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

    const { name, slug, description, gameNickname, whatsapp, discord, telegram } = req.body || {};
    const data = { updatedAt: new Date() };

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
    const contactFields = { whatsapp, discord, telegram };
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

    const updated = await prisma.store.update({ where: { id: store.id }, data });

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
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });

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

    const requiredFields = { pokeballCatalogItemId, pokemonCatalogItemId, level, gender, nature };
    for (const [field, value] of Object.entries(requiredFields)) {
      if (value === undefined || value === null || value === '') {
        return res.status(400).json({ error: `${field} é obrigatório.` });
      }
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
    if (extraMoveCount !== undefined && extraMoveCount !== null) {
      const normalizedExtraMoveCount = Number(extraMoveCount);
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
    if (presetSlotCount !== undefined && presetSlotCount !== null) {
      const normalizedPresetSlotCount = Number(presetSlotCount);
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
      extraMovesText,
      presetSlotsText,
      // TODO: hardcoded placeholder — this form has no world/server
      // selection UI yet (deliberate, confirmed scope decision, see
      // CLAUDE.md's "Setup de loja pós-login e edição" / Pokémon-listing
      // section). NOT real data — do not build filtering/business logic
      // that assumes this reflects which world the Pokémon actually lives
      // in until a real UI field replaces it.
      world: 'BLUE',
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
    const store = await prisma.store.findUnique({ where: { userId: req.currentUser.id } });
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
    }

    // These are required-on-create fields (see POST /me/pokemon above) —
    // on PATCH they're optional (only validated if the key is present), but
    // if present, clearing one to blank is rejected the same way POST
    // rejects a missing value for them — unlike Items' genuinely-optional
    // fields, these have no meaningful "cleared" state.
    const requiredIfPresent = { pokeballCatalogItemId, pokemonCatalogItemId, level, gender, nature };
    for (const [field, value] of Object.entries(requiredIfPresent)) {
      if (value !== undefined && (value === null || value === '')) {
        return res.status(400).json({ error: `${field} não pode ser vazio.` });
      }
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

    if (extraMoveCount !== undefined) {
      if (extraMoveCount === null || extraMoveCount === '') {
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
        data.extraMovesText = normalizedExtraMoveCount > 0 ? `+${normalizedExtraMoveCount}` : null;
      }
    }

    if (presetSlotCount !== undefined) {
      if (presetSlotCount === null || presetSlotCount === '') {
        data.presetSlotsText = null;
      } else {
        const normalizedPresetSlotCount = Number(presetSlotCount);
        if (normalizedPresetSlotCount < 0 || normalizedPresetSlotCount > 3) {
          return res.status(400).json({ error: 'presetSlotCount precisa estar entre 0 e 3.' });
        }
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
