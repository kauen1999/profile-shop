const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SUBCATEGORY_KEYS } = require('../src/wiki-crawler/parsers/syncSubcategories');

// Guards against `classifierFallback` (the categoryClassifier.js signal for
// "no rule matched") ever being read as a subcategory/source by
// syncSubcategories.js — it is a data-quality flag, not an
// extractedFields.subcategories source key. See CATALOG_PIPELINE.md section 1
// and CLAUDE.md's classifierFallback entry.

test('classifierFallback is never treated as a subcategory source key', () => {
  assert.ok(!SUBCATEGORY_KEYS.includes('classifierFallback'));
});

test('SUBCATEGORY_KEYS only contains the documented source keys', () => {
  const documented = [
    'eventSources',
    'dailyBossSources',
    'dailyBossAccessSources',
    'dungeonSources',
    'questSources',
    'npcShopSources',
    'minigameSources',
    'craftSystemSource',
    'craftIngredient',
    'appearances',
  ];
  assert.deepEqual([...SUBCATEGORY_KEYS].sort(), [...documented].sort());
});
