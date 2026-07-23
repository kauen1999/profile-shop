require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { prisma } = require('./db');
const { asyncHandler } = require('./asyncHandler');

const app = express();

// Trust the first hop's X-Forwarded-For (Vercel, and any single reverse
// proxy in front of this process, sets that header) — required for
// express-rate-limit below: with Express's default `trust proxy: false`,
// the library throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR as soon as it sees
// an X-Forwarded-For header, since it can't tell whether `req.ip` reflects
// the real client or an untrusted client-supplied value. `1` (not `true`)
// deliberately trusts only one hop — trusting all hops would let a client
// spoof its own IP via a crafted header and bypass the rate limit entirely.
app.set('trust proxy', 1);

// Structured access log (2026-07-22) — one JSON line per completed request,
// logged via res.on('finish', ...) so it always reflects the real final
// status code (including ones set later by asyncHandler/error middleware).
// Deliberately never logs body/headers/query — may contain sensitive data
// (passwords aren't a thing here, but tokens/contact info could pass through
// query strings or bodies). No logging library (pino/winston) — traffic
// volume doesn't justify the dependency yet; console.log(JSON.stringify(...))
// is a deliberate, documented choice (see CLAUDE.md).
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      })
    );
  });
  next();
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/images', express.static(path.join(__dirname, '../public/images')));
// Fallback pro Neon (tabela CatalogImage) quando o arquivo não está no disco
// local — necessário em hosts sem disco gravável persistente (ex: Vercel) ou
// quando a imagem só foi migrada via backfill, nunca escrita nesse disco.
app.get(
  '/images/:filename',
  asyncHandler(async (req, res) => {
    const image = await prisma.catalogImage.findUnique({ where: { filename: req.params.filename } });
    if (!image) return res.status(404).json({ error: 'Imagem não encontrada.' });
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(image.data));
  })
);
app.use('/wiki-crawl', require('./wiki-crawler/routes'));
app.use('/wiki-images', require('./routes/wikiImages'));
app.use('/catalog-items', require('./routes/catalogItems'));
app.use('/auth', require('./routes/auth'));
app.use('/stores', require('./routes/stores'));
app.use('/store-pokemon-options', require('./routes/storePokemonOptions'));
app.use('/store-item-options', require('./routes/storeItemOptions'));

app.get('/', (req, res) => {
  res.json({
    name: 'profile-shop API',
    frontend: 'http://localhost:5173',
    endpoints: [
      '/health',
      '/stores',
      '/stores/:slug',
      '/stores/:slug/visit',
      '/stores/:slug/listing-view',
      '/stores/me',
      '/stores/me/analytics',
      '/catalog-items?search=&category=&subcategory=&generation=&regionalForm=&hasImage=&page=&pageSize=',
      '/catalog-items/filters',
      '/listings',
      '/wiki-crawl/next',
      '/wiki-crawl/result',
      '/wiki-crawl/status',
      '/wiki-images/pending',
      '/wiki-images/upload',
      '/images/:filename',
      '/auth/google',
      '/store-pokemon-options/pokemon?search=&restrictToCherishBall=&page=&pageSize=',
      '/store-pokemon-options/pokemon/:wikiPageId/shiny',
      '/store-pokemon-options/mega-stones?pokemonWikiTitle=',
      '/store-pokemon-options/addons?pokemonWikiTitle=&search=',
      '/store-item-options/:wikiPageId/template',
    ],
  });
});

app.get(
  '/health',
  asyncHandler(async (req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  })
);

app.get(
  '/stores',
  asyncHandler(async (req, res) => {
    const stores = await prisma.store.findMany({
      include: { User: { select: { id: true, name: true, email: true } } },
    });
    res.json(stores);
  })
);

app.get(
  '/stores/:slug',
  asyncHandler(async (req, res) => {
    // Fixed 2026-07-14 — this route used to omit the nested CatalogItem
    // relation entirely, so the frontend could never render a real
    // item/Pokémon name or photo, only the raw catalogItemId/
    // pokemonCatalogItemId (documented gap in CLAUDE.md right after the
    // Pokémon-listing feature shipped). Only the main Pokémon relation is
    // included on the StorePokemon side (not pokéball/held item/mega
    // stone/addons/stickers) — this route feeds a storefront card that only
    // needs a name+photo; the rest of a listed Pokémon's display data
    // (nature/level/nickname/etc.) is already present as plain scalar
    // fields on StorePokemon, no extra include required.
    //
    // Deliberately no status filtering here (ACTIVE/HIDDEN/SOLD all
    // returned) — this route stays fully public/unauthenticated and has no
    // concept of "who's asking" to decide what a visitor vs. the owner
    // should see. The frontend is responsible for deciding what to display;
    // a hidden/sold listing's data is technically still fetchable by
    // inspecting the network response, just suppressed in the UI. See
    // CLAUDE.md's "Listagens da loja: status (ACTIVE/HIDDEN/SOLD) e edição"
    // section for the full reasoning.
    // 2026-07-15: this payload is meant to be a COMPLETE representation of
    // every listing — not just enough to render a storefront card. It's
    // also what the "Editar" flow pre-fills its form from directly (no
    // second/dedicated edit-fetch endpoint), so every relation the create
    // forms can set must be resolvable from here: Pokébola, Pokémon, Held
    // Item, Mega Stone, Addon equipado, the full Addons/Stickers sets, plus
    // the plain scalar fields already present on the row itself.
    //
    // 2026-07-22 (perf pass): every nested CatalogItem-shaped relation below
    // used to be `include: true` (every column, including `extractedFields`
    // — measured at 114KB of a 202KB payload against a real store, 56%).
    // Audited every frontend consumer of this route (storefront cards +
    // "ver anúncio completo" modal, the Editar form's prefill for both
    // Pokémon and Item, the two exports/WhatsApp text builders, the search/
    // category filter on the storefront) before narrowing anything — see
    // CLAUDE.md's "Estado atual do catálogo"/this same section for the full
    // per-relation citation trail. Two relations genuinely need
    // `extractedFields` (addon composite-sprite resolution reads
    // `extractedFields.addonCompatibilities` — see
    // resolveAddonSprite.js:findAddonLooktypeUrl) and keep `include: true`;
    // every other relation only ever has `wikiPageId`/`name`/`imageUrl`/
    // `wikiTitle`/`category` read off it anywhere in the frontend, so those
    // get a `select` naming exactly those fields, nothing more.
    const store = await prisma.store.findUnique({
      where: { slug: req.params.slug },
      include: {
        StoreItem: {
          include: {
            // .name/.imageUrl (card+modal photo/name), .category
            // (formatCategoryLabel in the card/modal/compact-summary/search
            // text), .wikiPageId (Editar prefill + template fetch/submit
            // payload). No extractedFields consumer found anywhere.
            CatalogItem: { select: { wikiPageId: true, name: true, imageUrl: true, category: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        StorePokemon: {
          include: {
            // Base species — .wikiTitle unlocks mega-stone/addon-compat
            // fetches and addon-sprite shininess lookup, .category feeds the
            // storefront's category filter (normalizeListings), .name/
            // .imageUrl for display. No extractedFields consumer.
            CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem: {
              select: { wikiPageId: true, name: true, imageUrl: true, wikiTitle: true, category: true },
            },
            CatalogItem_StorePokemon_pokeballCatalogItemIdToCatalogItem: {
              select: { wikiPageId: true, name: true, imageUrl: true },
            },
            CatalogItem_StorePokemon_heldItemCatalogItemIdToCatalogItem: {
              select: { wikiPageId: true, name: true, imageUrl: true },
            },
            CatalogItem_StorePokemon_megaStoneCatalogItemIdToCatalogItem: {
              select: { wikiPageId: true, name: true, imageUrl: true },
            },
            // Equipped addon: DOES need extractedFields.addonCompatibilities
            // (StoreListingCard.jsx's modal, AddPokemonListing.jsx's edit-mode
            // sprite preview via findAddonLooktypeUrl) — kept as full include.
            CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem: true,
            // Same reasoning as the equipped addon above — each selected
            // addon's composite sprite in the "ver anúncio completo" modal
            // (resolveAddonLooktypeUrl) reads extractedFields too.
            StorePokemonAddon: { include: { CatalogItem: true } },
            // Stickers only ever render .name (toSealName) + .imageUrl — no
            // extractedFields consumer anywhere.
            StorePokemonSticker: {
              include: { CatalogItem: { select: { wikiPageId: true, name: true, imageUrl: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        StoreWorld: true,
        // 2026-07-17: exposes the owner's Google profile photo for the
        // storefront header (only Google-login users have `image` set —
        // see POST /auth/google — so the frontend must handle it being
        // null). Only `image` is selected — the rest of `User` (email,
        // firebaseUid) has no reason to be public on an unauthenticated
        // route.
        User: { select: { image: true } },
      },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
  })
);

// Analytics feature (2026-07-21) — see CLAUDE.md's "Analytics da loja" entry
// for the full data model/reasoning. Public, unauthenticated event-recording
// endpoints — a regular storefront visitor isn't logged in, so these can't
// require auth. Both fire-and-forget from the frontend's perspective.
const VALID_LISTING_KINDS = ['ITEM', 'POKEMON'];

// Rate limiting (2026-07-22) — applied ONLY to these 2 public write
// endpoints (no auth required to hit them, so they're the only ones
// trivially abusable by a script hammering the same IP). Not applied to
// GET /stores/:slug or any other read-only route, and not to POST
// /auth/google (already gated by requiring a real Firebase ID token).
// In-memory store (express-rate-limit's default) is fine — this runs as a
// single Node process, no Redis/shared-state need. 30 req/min/IP/route —
// each route gets its OWN limiter instance (own in-memory counter store),
// never a single shared instance across both, so hitting one route's limit
// never eats into the other route's budget. On exceeding, respond with this
// project's usual { error } JSON shape instead of the library's default
// plain-text/HTML body.
function createAnalyticsRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
    },
  });
}

app.post(
  '/stores/:slug/visit',
  createAnalyticsRateLimiter(),
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { slug: req.params.slug } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    await prisma.storeVisit.create({ data: { storeId: store.id } });
    res.status(201).json({ ok: true });
  })
);

app.post(
  '/stores/:slug/listing-view',
  createAnalyticsRateLimiter(),
  asyncHandler(async (req, res) => {
    const { kind, listingId } = req.body || {};

    if (!VALID_LISTING_KINDS.includes(kind)) {
      return res.status(400).json({
        error: `kind inválido — precisa ser um dos valores: ${VALID_LISTING_KINDS.join(', ')}.`,
      });
    }

    const normalizedListingId = Number(listingId);
    if (!Number.isInteger(normalizedListingId) || normalizedListingId <= 0) {
      return res.status(400).json({ error: 'listingId precisa ser um número inteiro positivo.' });
    }

    const store = await prisma.store.findUnique({ where: { slug: req.params.slug } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    // Existence check, not an ownership check (this is a public route) —
    // confirms the id actually resolves to a listing that belongs to THIS
    // store, so a bogus/foreign id never gets logged as a view.
    const existing =
      kind === 'ITEM'
        ? await prisma.storeItem.findUnique({ where: { id: normalizedListingId } })
        : await prisma.storePokemon.findUnique({ where: { id: normalizedListingId } });

    if (!existing || existing.storeId !== store.id) {
      return res.status(404).json({ error: 'Anúncio não encontrado.' });
    }

    await prisma.storeListingView.create({
      data: { storeId: store.id, kind, listingId: normalizedListingId },
    });
    res.status(201).json({ ok: true });
  })
);

app.get(
  '/listings',
  asyncHandler(async (req, res) => {
    const listings = await prisma.listing.findMany({
      where: { status: 'ACTIVE' },
      include: { CatalogItem: true, User: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(listings);
  })
);

// Keeps the process alive on transient failures (e.g. Neon waking from
// idle) instead of crashing the whole server on one bad request.
app.use((err, req, res, next) => {
  // Structured error log (2026-07-22) — same JSON-line discipline as the
  // access log above: never includes request body/headers/query (may
  // contain sensitive data). errorStack/errorMessage are internal-only,
  // never sent to the client (the response below stays the same generic
  // 503 it always was).
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode: 503,
      errorMessage: err.message,
      errorStack: err.stack,
    })
  );
  if (res.headersSent) return next(err);
  res.status(503).json({ error: 'Serviço temporariamente indisponível. Tente novamente.' });
});

process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`profile-shop API rodando em http://localhost:${port}`);
});
