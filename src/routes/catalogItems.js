const express = require('express');
const { prisma } = require('../db');
const { asyncHandler } = require('../asyncHandler');

const router = express.Router();

router.get(
  '/filters',
  asyncHandler(async (req, res) => {
  const categories = await prisma.catalogItem.groupBy({
    by: ['category'],
    _count: true,
    orderBy: { _count: { category: 'desc' } },
  });

  const categoriesWithImageCounts = await prisma.catalogItem.groupBy({
    by: ['category'],
    _count: true,
    where: { NOT: { imageUrl: '' } },
  });
  const withImageCountByCategory = new Map(
    categoriesWithImageCounts.map((c) => [c.category, c._count])
  );

  const subcategoryRows = await prisma.$queryRaw`
    SELECT sub AS subcategory, COUNT(*)::int AS count
    FROM "CatalogItem", jsonb_array_elements_text("extractedFields"->'subcategories') AS sub
    GROUP BY sub
    ORDER BY count DESC
  `;

  const generationRows = await prisma.$queryRaw`
    SELECT ("extractedFields"->>'generation')::int AS generation, COUNT(*)::int AS count
    FROM "CatalogItem"
    WHERE "extractedFields"->>'generation' IS NOT NULL
    GROUP BY generation
    ORDER BY generation ASC
  `;

  const withImageCount = await prisma.catalogItem.count({ where: { NOT: { imageUrl: '' } } });

  res.json({
    categories: categories.map((c) => ({
      value: c.category,
      count: c._count,
      withImageCount: withImageCountByCategory.get(c.category) || 0,
    })),
    subcategories: subcategoryRows.map((r) => ({ value: r.subcategory, count: Number(r.count) })),
    generations: generationRows.map((r) => ({ value: r.generation, count: Number(r.count) })),
    withImageCount,
  });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
  const {
    search,
    nameOnly,
    category,
    excludeCategories,
    subcategory,
    generation,
    regionalForm,
    hasImage,
    page = '1',
    pageSize = '60',
  } = req.query;

  const where = {};
  if (category) {
    where.category = category;
  } else if (excludeCategories) {
    // Comma-separated list of categories to exclude from results — used by
    // the "Adicionar Item" listing form (frontend/src/pages/AddItemListing.jsx)
    // to keep Pokémon (pokemon/pokemon-shiny/cherish-ball-pokemon) and
    // daily-boss-access (access-window records, not physical items — see
    // CLAUDE.md's documented open decision on that category) out of the
    // item picker's results. Kept as a generic param on this shared route
    // rather than a one-off endpoint, since "which categories aren't real
    // sellable items" is catalog knowledge, not something the frontend
    // should hardcode a second time. Mutually exclusive with `category`
    // (include-one vs exclude-many don't need to combine for any caller
    // today).
    const excluded = excludeCategories
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (excluded.length) where.category = { notIn: excluded };
  }
  if (hasImage === 'true') where.NOT = { imageUrl: '' };
  if (search) {
    if (nameOnly === 'true') {
      // Used by the listing-creation pickers (Pokébola/Held Item/Sticker/Item
      // in AddPokemonListing.jsx/AddItemListing.jsx/ImportListings.jsx) —
      // there the user is searching for one specific catalog item by the name
      // they'd recognize, and a category/subcategory/description match would
      // surface unrelated items under an unrelated name (e.g. searching
      // "pokebola" matching every item tagged with that category). Deliberately
      // different from Catalog.jsx's own browse search (no `nameOnly`, still
      // matches broadly below) and from the storefront's own client-side
      // filter (buildListingSearchText.js, searches every field on purpose)
      // — neither of those is a "find the exact item to attach" picker.
      where.name = { contains: search, mode: 'insensitive' };
    } else {
      // `searchableText` is a snapshot taken at sync time and goes stale once
      // subcategories are added later (e.g. subcategories:sync never touches it),
      // so subcategory matches are computed live here instead of relying on it.
      const subcategoryMatches = await prisma.$queryRaw`
        SELECT DISTINCT "wikiPageId"
        FROM "CatalogItem", jsonb_array_elements_text("extractedFields"->'subcategories') AS sub
        WHERE sub ILIKE ${`%${search}%`}
      `;
      const subcategoryMatchIds = subcategoryMatches.map((r) => r.wikiPageId);

      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { searchableText: { contains: search.toLowerCase(), mode: 'insensitive' } },
        ...(subcategoryMatchIds.length ? [{ wikiPageId: { in: subcategoryMatchIds } }] : []),
      ];
    }
  }

  const jsonFilters = [];
  if (subcategory) {
    jsonFilters.push({ extractedFields: { path: ['subcategories'], array_contains: subcategory } });
  }
  if (generation) {
    jsonFilters.push({ extractedFields: { path: ['generation'], equals: Number(generation) } });
  }
  if (regionalForm) {
    jsonFilters.push({ extractedFields: { path: ['regionalForm'], equals: regionalForm === 'true' } });
  }
  if (jsonFilters.length) where.AND = jsonFilters;

  const take = Math.min(Number(pageSize) || 60, 200);
  const currentPage = Math.max(Number(page) || 1, 1);
  const skip = (currentPage - 1) * take;

  const [items, total] = await Promise.all([
    prisma.catalogItem.findMany({
      where,
      take,
      skip,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { Listing: { where: { status: 'ACTIVE' } } },
        },
      },
    }),
    prisma.catalogItem.count({ where }),
  ]);

  const itemsWithListingCount = items.map(({ _count, ...item }) => ({
    ...item,
    activeListingsCount: _count.Listing,
  }));

  res.json({
    items: itemsWithListingCount,
    total,
    page: currentPage,
    pageSize: take,
    totalPages: Math.max(Math.ceil(total / take), 1),
  });
  })
);

module.exports = router;
