const { test, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const { prisma } = require('../src/db');

// Documents and guards the CURRENT behavior of `daily-boss-access`, without
// changing the model — see CATALOG_PIPELINE.md section 3 ("Por que
// daily-boss-access não é um CatalogItem, conceitualmente") and section 5
// ("Não alterar sem revisão arquitetural": daily-boss-access migration is
// deferred, not decided).
//
// If this test starts failing, it means the underlying data/behavior
// changed — that's exactly the trigger to revisit the deferred modeling
// decision in CATALOG_PIPELINE.md, not to just update this test.

after(async () => {
  await prisma.$disconnect();
});

test('daily-boss-access items never have an image (they are access windows, not tradeable objects)', async () => {
  const items = await prisma.catalogItem.findMany({ where: { category: 'daily-boss-access' } });
  assert.ok(items.length > 0, 'expected daily-boss-access to still exist as a category');
  for (const item of items) {
    assert.equal(item.imageUrl, '', `expected empty imageUrl for "${item.name}" (wikiPageId ${item.wikiPageId})`);
  }
});

test('daily-boss-access items are never referenced by Listing or StoreItem (never traded)', async () => {
  const ids = (await prisma.catalogItem.findMany({
    where: { category: 'daily-boss-access' },
    select: { wikiPageId: true },
  })).map((i) => i.wikiPageId);

  const [listingCount, storeItemCount] = await Promise.all([
    prisma.listing.count({ where: { catalogItemId: { in: ids } } }),
    prisma.storeItem.count({ where: { catalogItemId: { in: ids } } }),
  ]);

  assert.equal(listingCount, 0);
  assert.equal(storeItemCount, 0);
});

test('daily-boss-access slugs follow the auto-generated event-window pattern', async () => {
  const items = await prisma.catalogItem.findMany({ where: { category: 'daily-boss-access' } });
  for (const item of items) {
    assert.match(item.slug, /^daily-boss-access-/, `expected auto-generated slug prefix for "${item.name}"`);
  }
});
