const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const { prisma } = require('../src/db');
const storesRouter = require('../src/routes/stores');

// Integration tests for the business logic inside src/routes/stores.js —
// ownership isolation, the SOLD/soldAt lifecycle, price validation, world
// validation, and the extraMoveCount/presetSlotCount persistence bug fixed
// on 2026-07-18 (reported by a user, only ever verified manually before
// this file existed). See CLAUDE.md's "Setup de loja..."/"Criação de
// anúncio de Pokémon..." sections for the behavior being guarded here.
//
// Runs against whatever DATABASE_URL points to — an ephemeral Postgres
// container in CI (see .github/workflows/ci.yml's `test-db` job,
// `prisma db push` creates the schema fresh each run), or any disposable
// Postgres locally. Every fixture this file creates is self-contained
// (own User/Store/CatalogItem rows, namespaced IDs below) and cleaned up
// in each test's own `finally` block — never depends on, and never
// leaves behind, real accumulated data. Safe to run against a real dev
// DB too, though that's not its purpose.
//
// Auth is bypassed by design: these routes are protected by
// requireAuth (real Firebase ID token verification), which can't be
// forged in this environment (documented repeatedly in CLAUDE.md). Since
// the goal here is the business logic *behind* requireAuth, not
// requireAuth itself, each route's handler is invoked directly — the
// same technique already proven and documented in CLAUDE.md ("Nota de
// implementação da técnica de monkey-patch" / "Verificado com um token
// Firebase real"): find the final handler in the router's own stack
// (skipping requireAuth), and invoke it with a fake req/res/next. Note
// that asyncHandler ((req,res,next) => { Promise.resolve(fn(...)).catch(next) })
// does NOT return/await its inner promise — invoking the handler must
// supply a real `next` and let res.json()/next(err) drive an outer Promise.

function findRouteHandler(method, routePath) {
  const layer = storesRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
  const handlers = layer.route.stack.map((s) => s.handle);
  return handlers[handlers.length - 1]; // last handler = the asyncHandler-wrapped real logic, past requireAuth
}

function invoke(method, routePath, req) {
  const handler = findRouteHandler(method, routePath);
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
      send(body) {
        resolve({ status: this.statusCode, body: body ?? null });
      },
    };
    handler({ params: {}, body: {}, ...req }, res, reject);
  });
}

// Namespaced ID generator — far outside every synthetic-id range already
// documented in CLAUDE.md ("IDs sintéticos" table tops out at ~2.147bi) and
// distinct from deduplication.test.js's single fixed id (999_000_001), so
// this file can never collide with real catalog data or another test file
// even when run against a shared/real database.
let counter = 0;
function nextId() {
  counter += 1;
  return 999_600_000 + counter;
}

async function makeUser() {
  return prisma.user.create({
    data: {
      email: `storeroutes-test-${nextId()}@example.com`,
      updatedAt: new Date(),
    },
  });
}

async function makeStore(user, { worlds = ['BLUE'] } = {}) {
  return prisma.store.create({
    data: {
      userId: user.id,
      name: 'Store Routes Test',
      slug: `test-store-routes-${nextId()}`,
      updatedAt: new Date(),
      ...(worlds.length && { StoreWorld: { create: worlds.map((world) => ({ world })) } }),
    },
    include: { StoreWorld: true },
  });
}

async function makeCatalogItem(category = 'materials') {
  const wikiPageId = nextId();
  return prisma.catalogItem.create({
    data: {
      wikiPageId,
      name: `Test Fixture ${wikiPageId}`,
      slug: `test-fixture-${wikiPageId}`,
      category,
      imageUrl: '',
      wikiTitle: `Test Fixture ${wikiPageId}`,
      wikiUrl: 'https://wiki.otponline.com/Test',
      searchableText: `test fixture ${wikiPageId}`,
      extractedFields: {},
      updatedAt: new Date(),
    },
  });
}

async function cleanup({ userIds = [], catalogItemIds = [] }) {
  // Deleting the User cascades to Store -> StoreItem/StorePokemon/StoreWorld
  // (and StorePokemonAddon/StorePokemonSticker via StorePokemon), per
  // prisma/schema.prisma's onDelete: Cascade chain.
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (catalogItemIds.length) {
    await prisma.catalogItem.deleteMany({ where: { wikiPageId: { in: catalogItemIds } } });
  }
}

test('ownership: PATCH/DELETE on another store\'s item and pokemon return a uniform 404', async () => {
  const ownerUser = await makeUser();
  const attackerUser = await makeUser();
  const ownerStore = await makeStore(ownerUser);
  await makeStore(attackerUser); // exists so the attacker has a Store row too, otherwise the 404 would be ambiguous (no store vs. wrong store)
  const catalogItem = await makeCatalogItem();
  const pokeball = await makeCatalogItem('pokeballs');
  const pokemon = await makeCatalogItem('pokemon');

  try {
    const item = await prisma.storeItem.create({
      data: { storeId: ownerStore.id, catalogItemId: catalogItem.wikiPageId, priceReal: 100, updatedAt: new Date() },
    });
    const storePokemon = await prisma.storePokemon.create({
      data: {
        storeId: ownerStore.id,
        pokeballCatalogItemId: pokeball.wikiPageId,
        pokemonCatalogItemId: pokemon.wikiPageId,
        level: 50,
        world: 'BLUE',
        priceReal: 100,
        updatedAt: new Date(),
      },
    });

    const itemPatch = await invoke('patch', '/me/items/:id', {
      currentUser: attackerUser,
      params: { id: String(item.id) },
      body: { status: 'HIDDEN' },
    });
    assert.equal(itemPatch.status, 404);

    const itemDelete = await invoke('delete', '/me/items/:id', {
      currentUser: attackerUser,
      params: { id: String(item.id) },
    });
    assert.equal(itemDelete.status, 404);

    const pokemonPatch = await invoke('patch', '/me/pokemon/:id', {
      currentUser: attackerUser,
      params: { id: String(storePokemon.id) },
      body: { nickname: 'stolen' },
    });
    assert.equal(pokemonPatch.status, 404);

    const pokemonDelete = await invoke('delete', '/me/pokemon/:id', {
      currentUser: attackerUser,
      params: { id: String(storePokemon.id) },
    });
    assert.equal(pokemonDelete.status, 404);

    // The attacker's 404s must never have actually mutated/deleted the owner's rows.
    const itemStillThere = await prisma.storeItem.findUnique({ where: { id: item.id } });
    assert.ok(itemStillThere, 'item must survive an ownership-rejected PATCH/DELETE');
    assert.equal(itemStillThere.status, 'ACTIVE');

    const pokemonStillThere = await prisma.storePokemon.findUnique({ where: { id: storePokemon.id } });
    assert.ok(pokemonStillThere, 'pokemon must survive an ownership-rejected PATCH/DELETE');
    assert.equal(pokemonStillThere.nickname, null);
  } finally {
    await cleanup({
      userIds: [ownerUser.id, attackerUser.id],
      catalogItemIds: [catalogItem.wikiPageId, pokeball.wikiPageId, pokemon.wikiPageId],
    });
  }
});

test('soldAt: marking SOLD stamps it, reverting to ACTIVE clears it (item and pokemon)', async () => {
  const user = await makeUser();
  const store = await makeStore(user);
  const catalogItem = await makeCatalogItem();
  const pokeball = await makeCatalogItem('pokeballs');
  const pokemon = await makeCatalogItem('pokemon');

  try {
    const item = await prisma.storeItem.create({
      data: { storeId: store.id, catalogItemId: catalogItem.wikiPageId, priceReal: 100, updatedAt: new Date() },
    });
    const storePokemon = await prisma.storePokemon.create({
      data: {
        storeId: store.id,
        pokeballCatalogItemId: pokeball.wikiPageId,
        pokemonCatalogItemId: pokemon.wikiPageId,
        level: 50,
        world: 'BLUE',
        priceReal: 100,
        updatedAt: new Date(),
      },
    });

    const itemSold = await invoke('patch', '/me/items/:id', {
      currentUser: user,
      params: { id: String(item.id) },
      body: { status: 'SOLD' },
    });
    assert.equal(itemSold.status, 200);
    assert.ok(itemSold.body.soldAt, 'item soldAt must be set after marking SOLD');

    const itemReverted = await invoke('patch', '/me/items/:id', {
      currentUser: user,
      params: { id: String(item.id) },
      body: { status: 'ACTIVE' },
    });
    assert.equal(itemReverted.status, 200);
    assert.equal(itemReverted.body.soldAt, null, 'item soldAt must be cleared after reverting to ACTIVE');

    const pokemonSold = await invoke('patch', '/me/pokemon/:id', {
      currentUser: user,
      params: { id: String(storePokemon.id) },
      body: { status: 'SOLD' },
    });
    assert.equal(pokemonSold.status, 200);
    assert.ok(pokemonSold.body.soldAt, 'pokemon soldAt must be set after marking SOLD');

    const pokemonReverted = await invoke('patch', '/me/pokemon/:id', {
      currentUser: user,
      params: { id: String(storePokemon.id) },
      body: { status: 'ACTIVE' },
    });
    assert.equal(pokemonReverted.status, 200);
    assert.equal(pokemonReverted.body.soldAt, null, 'pokemon soldAt must be cleared after reverting to ACTIVE');
  } finally {
    await cleanup({
      userIds: [user.id],
      catalogItemIds: [catalogItem.wikiPageId, pokeball.wikiPageId, pokemon.wikiPageId],
    });
  }
});

test('price validation: POST /me/items rejects missing/zero/negative price, accepts a positive one', async () => {
  const user = await makeUser();
  await makeStore(user);
  const catalogItem = await makeCatalogItem();
  const createdItemIds = [];

  try {
    const noPrice = await invoke('post', '/me/items', {
      currentUser: user,
      body: { catalogItemId: catalogItem.wikiPageId },
    });
    assert.equal(noPrice.status, 400);

    const zeroPrice = await invoke('post', '/me/items', {
      currentUser: user,
      body: { catalogItemId: catalogItem.wikiPageId, priceReal: 0 },
    });
    assert.equal(zeroPrice.status, 400);

    const negativePrice = await invoke('post', '/me/items', {
      currentUser: user,
      body: { catalogItemId: catalogItem.wikiPageId, priceReal: -5 },
    });
    assert.equal(negativePrice.status, 400);

    const valid = await invoke('post', '/me/items', {
      currentUser: user,
      body: { catalogItemId: catalogItem.wikiPageId, priceReal: 100 },
    });
    assert.equal(valid.status, 201);
    createdItemIds.push(valid.body.id);
  } finally {
    if (createdItemIds.length) {
      await prisma.storeItem.deleteMany({ where: { id: { in: createdItemIds } } });
    }
    await cleanup({ userIds: [user.id], catalogItemIds: [catalogItem.wikiPageId] });
  }
});

test('world validation: POST /me/pokemon requires a world the store itself registered', async () => {
  const user = await makeUser();
  const store = await makeStore(user, { worlds: ['BLUE'] });
  const noWorldUser = await makeUser();
  await makeStore(noWorldUser, { worlds: [] });
  const pokeball = await makeCatalogItem('pokeballs');
  const pokemon = await makeCatalogItem('pokemon');
  const createdPokemonIds = [];

  const basePayload = {
    pokeballCatalogItemId: pokeball.wikiPageId,
    pokemonCatalogItemId: pokemon.wikiPageId,
    level: 50,
    gender: 'macho',
    nature: 'Bashful',
    priceReal: 100,
  };

  try {
    const unregisteredWorld = await invoke('post', '/me/pokemon', {
      currentUser: user,
      body: { ...basePayload, world: 'GOLD' },
    });
    assert.equal(unregisteredWorld.status, 400);

    const registeredWorld = await invoke('post', '/me/pokemon', {
      currentUser: user,
      body: { ...basePayload, world: 'BLUE' },
    });
    assert.equal(registeredWorld.status, 201);
    assert.equal(registeredWorld.body.world, 'BLUE');
    createdPokemonIds.push(registeredWorld.body.id);

    const storeWithNoWorlds = await invoke('post', '/me/pokemon', {
      currentUser: noWorldUser,
      body: { ...basePayload, world: 'BLUE' },
    });
    assert.equal(storeWithNoWorlds.status, 400);
  } finally {
    if (createdPokemonIds.length) {
      await prisma.storePokemon.deleteMany({ where: { id: { in: createdPokemonIds } } });
    }
    await cleanup({
      userIds: [user.id, noWorldUser.id],
      catalogItemIds: [pokeball.wikiPageId, pokemon.wikiPageId],
    });
  }
});

test('extraMoveCount/presetSlotCount are persisted as numbers (2026-07-18 regression) and the cap is enforced', async () => {
  const user = await makeUser();
  await makeStore(user, { worlds: ['BLUE'] });
  const pokeball = await makeCatalogItem('pokeballs');
  const pokemon = await makeCatalogItem('pokemon');
  const createdPokemonIds = [];

  // pokemon.wikiPageId is a synthetic id (999_600_000+) that never matches a
  // real entry in data/wiki-crawl/index.json, so computeExtraMovesCap always
  // falls back to maxExtraMoves: 10 — deterministic in any environment,
  // including CI's ephemeral DB where data/wiki-crawl/ doesn't exist at all.
  const basePayload = {
    pokeballCatalogItemId: pokeball.wikiPageId,
    pokemonCatalogItemId: pokemon.wikiPageId,
    level: 50,
    gender: 'macho',
    nature: 'Bashful',
    world: 'BLUE',
    priceReal: 100,
  };

  try {
    const created = await invoke('post', '/me/pokemon', {
      currentUser: user,
      body: { ...basePayload, extraMoveCount: 3, presetSlotCount: 2 },
    });
    assert.equal(created.status, 201);
    createdPokemonIds.push(created.body.id);
    // This is the exact bug fixed on 2026-07-18: only the derived *Text
    // fields were ever written, the numeric columns stayed null regardless
    // of what was submitted.
    assert.equal(created.body.extraMoveCount, 3, 'extraMoveCount must be persisted as a number');
    assert.equal(created.body.extraMovesText, '+3');
    assert.equal(created.body.presetSlotCount, 2, 'presetSlotCount must be persisted as a number');
    assert.equal(created.body.presetSlotsText, '2');

    const overCap = await invoke('post', '/me/pokemon', {
      currentUser: user,
      body: { ...basePayload, extraMoveCount: 11 },
    });
    assert.equal(overCap.status, 400);

    const edited = await invoke('patch', '/me/pokemon/:id', {
      currentUser: user,
      params: { id: String(created.body.id) },
      body: { extraMoveCount: 5, presetSlotCount: 1 },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.extraMoveCount, 5);
    assert.equal(edited.body.extraMovesText, '+5');
    assert.equal(edited.body.presetSlotCount, 1);
    assert.equal(edited.body.presetSlotsText, '1');

    const overCapEdit = await invoke('patch', '/me/pokemon/:id', {
      currentUser: user,
      params: { id: String(created.body.id) },
      body: { extraMoveCount: 11 },
    });
    assert.equal(overCapEdit.status, 400);
  } finally {
    if (createdPokemonIds.length) {
      await prisma.storePokemon.deleteMany({ where: { id: { in: createdPokemonIds } } });
    }
    await cleanup({ userIds: [user.id], catalogItemIds: [pokeball.wikiPageId, pokemon.wikiPageId] });
  }
});
