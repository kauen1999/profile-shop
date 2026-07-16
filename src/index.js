require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { prisma } = require('./db');
const { asyncHandler } = require('./asyncHandler');

const app = express();
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
      '/stores/me',
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
    const store = await prisma.store.findUnique({
      where: { slug: req.params.slug },
      include: {
        StoreItem: { include: { CatalogItem: true }, orderBy: { createdAt: 'desc' } },
        StorePokemon: {
          include: {
            CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem: true,
            CatalogItem_StorePokemon_pokeballCatalogItemIdToCatalogItem: true,
            CatalogItem_StorePokemon_heldItemCatalogItemIdToCatalogItem: true,
            CatalogItem_StorePokemon_megaStoneCatalogItemIdToCatalogItem: true,
            CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem: true,
            StorePokemonAddon: { include: { CatalogItem: true } },
            StorePokemonSticker: { include: { CatalogItem: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        StoreWorld: true,
      },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
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
  console.error(err);
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
