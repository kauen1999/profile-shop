const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const { prisma } = require('../src/db');

// Guards Architecture Rule 2 + the 2026-07-13 golden-rule fix: every sync
// script's duplicate check must match on wikiTitle OR name, case-insensitive
// — checking only one field is exactly what caused the historical
// duplicates documented in CLAUDE.md (mega-stones, Shiny Pokémon in
// dungeon-drops/quest-rewards, "X na Cherish Ball"). See
// CATALOG_PIPELINE.md section 1, step 2.
//
// This mirrors the exact `findFirst` shape used in the 9 sync scripts
// (e.g. syncQuestCatalog.js) rather than importing it, since those scripts
// don't export their per-item duplicate-check as a standalone function —
// if that query shape ever changes in the sync scripts, this test needs to
// be updated to match (documented limitation, not solved via refactor here).

const TEST_WIKI_PAGE_ID = 999_000_001;
const TEST_NAME = 'Zzz Test Dedup Fixture Item';

function findByGoldenRule(name) {
  return prisma.catalogItem.findFirst({
    where: {
      OR: [
        { wikiTitle: { equals: name, mode: 'insensitive' } },
        { name: { equals: name, mode: 'insensitive' } },
      ],
    },
  });
}

before(async () => {
  await prisma.catalogItem.deleteMany({ where: { wikiPageId: TEST_WIKI_PAGE_ID } });
  await prisma.catalogItem.create({
    data: {
      wikiPageId: TEST_WIKI_PAGE_ID,
      name: TEST_NAME,
      slug: `test-dedup-fixture-${TEST_WIKI_PAGE_ID}`,
      category: 'materials',
      imageUrl: '',
      wikiTitle: TEST_NAME,
      wikiUrl: 'https://wiki.otponline.com/Test',
      searchableText: TEST_NAME.toLowerCase(),
      extractedFields: {},
      updatedAt: new Date(),
    },
  });
});

after(async () => {
  await prisma.catalogItem.deleteMany({ where: { wikiPageId: TEST_WIKI_PAGE_ID } });
  await prisma.$disconnect();
});

test('same wikiTitle with different casing finds the existing row (no duplicate)', async () => {
  const found = await findByGoldenRule(TEST_NAME.toUpperCase());
  assert.ok(found, 'expected an existing row to be found by wikiTitle, case-insensitive');
  assert.equal(found.wikiPageId, TEST_WIKI_PAGE_ID);
});

test('same name with different casing finds the existing row (no duplicate)', async () => {
  // Simulate the mega-stones-class bug: wikiTitle diverges from name, but a
  // lookup by `name` should still find the row.
  await prisma.catalogItem.update({
    where: { wikiPageId: TEST_WIKI_PAGE_ID },
    data: { wikiTitle: 'Some Unrelated Page Title' },
  });

  const found = await findByGoldenRule(TEST_NAME.toLowerCase());
  assert.ok(found, 'expected the row to be found by name even though wikiTitle no longer matches');
  assert.equal(found.wikiPageId, TEST_WIKI_PAGE_ID);

  // restore for the after() cleanup / other tests
  await prisma.catalogItem.update({
    where: { wikiPageId: TEST_WIKI_PAGE_ID },
    data: { wikiTitle: TEST_NAME },
  });
});
