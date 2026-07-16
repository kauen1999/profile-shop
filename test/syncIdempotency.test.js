const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
require('dotenv').config();
const { prisma } = require('../src/db');

// Guards the idempotency property the whole sync pipeline depends on (see
// CATALOG_PIPELINE.md section 1, step 5): running the same sync twice must
// never change the total CatalogItem count. This runs the real
// syncCraftSystemCatalog.js script (unmodified) as a subprocess against the
// real dev database — it's the smallest sync (2 items today), chosen to
// keep this fast and low-footprint. This is an integration test: it needs
// DATABASE_URL and the wiki-crawl data already collected in
// data/wiki-crawl/ (both already required for local dev, see README.md).

const SCRIPT = path.join(__dirname, '../src/wiki-crawler/parsers/syncCraftSystemCatalog.js');

after(async () => {
  await prisma.$disconnect();
});

test('running a sync script twice does not change the total CatalogItem count', async () => {
  execFileSync('node', [SCRIPT], { stdio: 'ignore' });
  const countAfterFirstRun = await prisma.catalogItem.count();

  execFileSync('node', [SCRIPT], { stdio: 'ignore' });
  const countAfterSecondRun = await prisma.catalogItem.count();

  assert.equal(
    countAfterSecondRun,
    countAfterFirstRun,
    'a second run of the same sync created or removed CatalogItem rows — idempotency broken'
  );
});
