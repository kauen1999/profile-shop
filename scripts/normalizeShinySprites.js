// Some shiny Pokémon sprites on the wiki have the artwork crammed into the
// bottom-right corner of an otherwise-empty canvas (e.g. a 21x17 drawing
// inside a 64x64 image). Fix: crop tightly to the opaque-pixel bounding box
// plus a small proportional padding. This is a pure crop (no resampling), so
// it never loses quality — the frontend's `object-fit: contain` then scales
// the now-tightly-framed art to fill the thumbnail box instead of scaling a
// mostly-empty canvas.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { prisma } = require('../src/db');

const IMAGES_DIR = path.join(__dirname, '../public/images');
const BACKUP_DIR = path.join(__dirname, '../public/images-backup-shiny-recenter');

const ASYMMETRY_THRESHOLD = 0.12; // fraction of width/height the content must be off-center by, on both axes

async function analyzeImage(filePath) {
  const image = sharp(filePath);
  const { width, height } = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;

  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = channels === 4 ? data[(y * width + x) * channels + 3] : 255;
      if (alpha > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right === -1) return null; // fully transparent image

  const ml = left;
  const mr = width - 1 - right;
  const mt = top;
  const mb = height - 1 - bottom;
  return { width, height, bbox: { left, top, right: right + 1, bottom: bottom + 1 }, ml, mr, mt, mb };
}

function isOffCenter({ width, height, ml, mr, mt, mb }) {
  const asymX = (ml - mr) / width;
  const asymY = (mt - mb) / height;
  return asymX > ASYMMETRY_THRESHOLD && asymY > ASYMMETRY_THRESHOLD;
}

async function main() {
  const items = await prisma.catalogItem.findMany({
    where: { category: 'pokemon-shiny' },
    select: { wikiPageId: true, name: true, imageUrl: true },
  });

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  let fixed = 0;
  let skippedNoFile = 0;
  let skippedAlreadyCentered = 0;

  for (const item of items) {
    const files = fs.readdirSync(IMAGES_DIR).filter((f) => f.startsWith(`${item.wikiPageId}.`));
    if (!files.length) {
      skippedNoFile++;
      continue;
    }
    const filename = files[0];
    const filePath = path.join(IMAGES_DIR, filename);

    const analysis = await analyzeImage(filePath);
    if (!analysis || !isOffCenter(analysis)) {
      skippedAlreadyCentered++;
      continue;
    }

    const { bbox } = analysis;
    const contentW = bbox.right - bbox.left;
    const contentH = bbox.bottom - bbox.top;
    // Crop tightly to the exact content bbox first (zero slack, so this can
    // never clip a foot/edge pixel), then add real transparent padding equally
    // on all 4 sides. Padding via `extend` (not by leaving crop slack) matters
    // because content that already touched the original canvas edge (e.g. feet
    // at y=63 of 64) has no spare transparent pixels on that side to crop
    // into — cropping with slack there just reproduces the flush-edge look.
    const pad = Math.max(4, Math.round(0.08 * Math.max(contentW, contentH)));

    fs.copyFileSync(filePath, path.join(BACKUP_DIR, filename));

    const buffer = await sharp(filePath)
      .extract({ left: bbox.left, top: bbox.top, width: contentW, height: contentH })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    fs.writeFileSync(filePath, buffer);

    fixed++;
    console.log(`fixed: ${item.wikiPageId} ${item.name} (${analysis.width}x${analysis.height} -> ${contentW + pad * 2}x${contentH + pad * 2})`);
  }

  console.log(`\nTotal: ${items.length} · corrigidos: ${fixed} · já centralizados: ${skippedAlreadyCentered} · sem arquivo local: ${skippedNoFile}`);
  console.log(`Backup dos originais em: ${BACKUP_DIR}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('FAILED:', err);
  await prisma.$disconnect();
  process.exit(1);
});
