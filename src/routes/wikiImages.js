const express = require('express');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../db');
const { asyncHandler } = require('../asyncHandler');

const router = express.Router();
const IMAGES_DIR = path.join(__dirname, '../../public/images');
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const REMOTE_PREFIX = 'https://wiki.otponline.com';

// Nested looktype URLs (extractedFields.addonCompatibilities[i].looktypeImageUrl
// / .looktypeShinyImageUrl on `addons`-category rows) are a second, separate
// source of pending work discovered later than the original top-level
// migration (see CLAUDE.md's "Wiki crawler" section). `exclude` tokens for
// these carry this prefix so /pending can tell them apart from a plain
// numeric wikiPageId (used for the original top-level exclude contract,
// unchanged) without breaking that existing contract.
const NESTED_EXCLUDE_PREFIX = 'nested:';
const NESTED_LOOKTYPE_FIELDS = ['looktypeImageUrl', 'looktypeShinyImageUrl'];

function nestedExcludeKey(wikiPageId, compatibilityIndex, field) {
  return `${NESTED_EXCLUDE_PREFIX}${wikiPageId}:${compatibilityIndex}:${field}`;
}

router.get(
  '/pending',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const excludeTokens = (req.query.exclude || '').split(',').filter(Boolean);

    // Original top-level exclude contract, unchanged: plain numeric
    // wikiPageId tokens filter the top-level-imageUrl query below.
    const excludeWikiPageIds = excludeTokens
      .filter((t) => !t.startsWith(NESTED_EXCLUDE_PREFIX))
      .map(Number)
      .filter((n) => !Number.isNaN(n));

    // Nested exclude tokens instead identify one specific
    // addonCompatibilities[i].<field> entry — a single addons row can have
    // several independently-pending nested URLs, so excluding by wikiPageId
    // alone (like the top-level case) would wrongly skip every other pending
    // entry on that same row too.
    const excludeNestedKeys = new Set(excludeTokens.filter((t) => t.startsWith(NESTED_EXCLUDE_PREFIX)));

    const topLevelWhere = {
      imageUrl: { startsWith: REMOTE_PREFIX },
      ...(excludeWikiPageIds.length ? { wikiPageId: { notIn: excludeWikiPageIds } } : {}),
    };

    const [topLevelItems, topLevelRemaining, addonRows] = await Promise.all([
      prisma.catalogItem.findMany({
        where: topLevelWhere,
        take: limit,
        select: { wikiPageId: true, imageUrl: true, name: true },
      }),
      prisma.catalogItem.count({ where: topLevelWhere }),
      // Only 739 `addons` rows total — fetch the whole category and filter
      // in JS, same "small category, filter in memory" pattern already used
      // in src/routes/storePokemonOptions.js's addon matching, rather than a
      // raw-SQL JSON-array query for this row count.
      prisma.catalogItem.findMany({
        where: { category: 'addons' },
        select: { wikiPageId: true, name: true, extractedFields: true },
      }),
    ]);

    const nestedPending = [];
    for (const row of addonRows) {
      const compatibilities = row.extractedFields?.addonCompatibilities;
      if (!Array.isArray(compatibilities)) continue;
      compatibilities.forEach((compatibility, compatibilityIndex) => {
        for (const field of NESTED_LOOKTYPE_FIELDS) {
          const url = compatibility?.[field];
          if (typeof url !== 'string' || !url.startsWith(REMOTE_PREFIX)) continue;
          if (excludeNestedKeys.has(nestedExcludeKey(row.wikiPageId, compatibilityIndex, field))) continue;
          nestedPending.push({
            wikiPageId: row.wikiPageId,
            imageUrl: url,
            name: row.name,
            nested: { compatibilityIndex, field },
          });
        }
      });
    }

    const remainingSlots = Math.max(limit - topLevelItems.length, 0);
    const items = [...topLevelItems, ...nestedPending.slice(0, remainingSlots)];
    const remaining = topLevelRemaining + nestedPending.length;

    res.json({ items, remaining });
  })
);

router.post(
  '/upload',
  asyncHandler(async (req, res) => {
    const { wikiPageId, filename, dataBase64, nested } = req.body;
    if (!wikiPageId || !dataBase64) {
      return res.status(400).json({ error: 'wikiPageId e dataBase64 são obrigatórios' });
    }

    const existing = await prisma.catalogItem.findUnique({ where: { wikiPageId: Number(wikiPageId) } });
    if (!existing) return res.status(404).json({ error: 'Item não encontrado' });

    const ext = path.extname(filename || '') || '.png';
    const buffer = Buffer.from(dataBase64, 'base64');

    if (nested && typeof nested === 'object') {
      const { compatibilityIndex, field } = nested;
      if (!Number.isInteger(compatibilityIndex) || !NESTED_LOOKTYPE_FIELDS.includes(field)) {
        return res.status(400).json({
          error: 'nested.compatibilityIndex (inteiro) e nested.field (looktypeImageUrl|looktypeShinyImageUrl) são obrigatórios.',
        });
      }

      const compatibilities = existing.extractedFields?.addonCompatibilities;
      if (!Array.isArray(compatibilities) || !compatibilities[compatibilityIndex]) {
        return res.status(404).json({ error: 'extractedFields.addonCompatibilities[compatibilityIndex] não encontrado.' });
      }

      // Distinct filename from the item's own top-level image (which lives
      // at `${wikiPageId}${ext}`) — one addons row can have several pending
      // nested URLs across compatibilities/fields, all needing their own
      // local file.
      const variantSuffix = field === 'looktypeShinyImageUrl' ? 'shiny' : 'normal';
      const localFilename = `${wikiPageId}-looktype-${compatibilityIndex}-${variantSuffix}${ext}`;
      fs.writeFileSync(path.join(IMAGES_DIR, localFilename), buffer);
      const localUrl = `${req.protocol}://${req.get('host')}/images/${localFilename}`;

      // Analogous to the top-level case's `extractedFields.wikiImageUrl`
      // stash below: preserve the original remote URL as a sibling key on
      // this same compatibility entry, so it isn't lost.
      const originalUrlField = field === 'looktypeShinyImageUrl' ? 'wikiLooktypeShinyImageUrl' : 'wikiLooktypeImageUrl';

      const updatedCompatibilities = compatibilities.map((compatibility, idx) => {
        if (idx !== compatibilityIndex) return compatibility;
        return {
          ...compatibility,
          [field]: localUrl,
          [originalUrlField]: compatibility[field],
        };
      });

      await prisma.catalogItem.update({
        where: { wikiPageId: Number(wikiPageId) },
        data: {
          extractedFields: { ...(existing.extractedFields || {}), addonCompatibilities: updatedCompatibilities },
          updatedAt: new Date(),
        },
      });

      return res.json({ ok: true, imageUrl: localUrl });
    }

    const localFilename = `${wikiPageId}${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, localFilename), buffer);

    const localUrl = `${req.protocol}://${req.get('host')}/images/${localFilename}`;

    await prisma.catalogItem.update({
      where: { wikiPageId: Number(wikiPageId) },
      data: {
        imageUrl: localUrl,
        extractedFields: { ...(existing.extractedFields || {}), wikiImageUrl: existing.imageUrl },
        updatedAt: new Date(),
      },
    });

    res.json({ ok: true, imageUrl: localUrl });
  })
);

module.exports = router;
