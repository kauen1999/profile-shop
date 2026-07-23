const { test, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const { prisma } = require('../src/db');

// This used to guard the CURRENT behavior of `daily-boss-access` while its
// migration was deferred (see CATALOG_PIPELINE.md section 3). The deferred
// decision was later revisited and resolved: the 24 rows were deleted from
// the catalog on 2026-07-15 (CLAUDE.md, "Deleção de dado real 2026-07-15").
//
// This test is now the opposite canary — it guards against the category
// silently reappearing. `npm run dailyboss:sync`'s creation branch still
// writes `category: 'daily-boss-access'` for its 'access' namespace (that
// code path was deliberately left in place, see CLAUDE.md) — if that script
// runs again before the deferred modeling decision is revisited, this test
// starts failing again, which is the correct signal to go back to
// CATALOG_PIPELINE.md, not to just update this assertion.

after(async () => {
  await prisma.$disconnect();
});

test('daily-boss-access no longer exists as a category (deleted 2026-07-15, watch for silent recreation)', async () => {
  const count = await prisma.catalogItem.count({ where: { category: 'daily-boss-access' } });
  assert.equal(
    count,
    0,
    'daily-boss-access reappeared — likely dailyboss:sync ran again; revisit the deferred modeling decision in CATALOG_PIPELINE.md before deciding what to do with these rows'
  );
});
