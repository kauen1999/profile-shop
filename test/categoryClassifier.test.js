const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyItemCategory } = require('../src/wiki-crawler/parsers/categoryClassifier');

// Guards Architecture Rule 1 (category = type, never origin) as implemented
// by categoryClassifier.js's "create new item" fallback path — see
// CATALOG_PIPELINE.md section 1.

test('classifyItemCategory always returns { category, matchedRule }', () => {
  const result = classifyItemCategory('Pink heart carpet');
  assert.equal(typeof result.category, 'string');
  assert.equal(typeof result.matchedRule, 'boolean');
});

test('a name matching a known rule sets matchedRule: true and the expected category', () => {
  // 'carpets' and 'collectibles' (via the 'statues' rule) were folded into
  // the single 'decoracao' category by the 2026-07-15 consolidation
  // (CLAUDE.md, "Migração de dado real 2026-07-15") — categoryClassifier.js
  // was updated to match at the time, this test wasn't.
  assert.deepEqual(classifyItemCategory('Pink heart carpet'), { category: 'decoracao', matchedRule: true });
  assert.deepEqual(classifyItemCategory('TM01 - Fly'), { category: 'tms', matchedRule: true });
  assert.deepEqual(classifyItemCategory('Legendary Blastoise Cursed Statue'), { category: 'decoracao', matchedRule: true });
});

test('a name matching no rule falls back to materials with matchedRule: false', () => {
  assert.deepEqual(classifyItemCategory('Some Never Before Seen Widget'), { category: 'materials', matchedRule: false });
});

test('empty/blank name also falls back with matchedRule: false (never throws)', () => {
  assert.deepEqual(classifyItemCategory(''), { category: 'materials', matchedRule: false });
  assert.deepEqual(classifyItemCategory('   '), { category: 'materials', matchedRule: false });
  assert.deepEqual(classifyItemCategory(undefined), { category: 'materials', matchedRule: false });
});
