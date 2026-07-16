// Migração pontual: copia todo public/images/ (arquivos já baixados via o
// bookmarklet de download, ver CLAUDE.md "Wiki crawler") pra tabela
// CatalogImage no Neon, pra servir /images/:filename funcionar em hosts sem
// disco gravável persistente (ex: Vercel). Idempotente — upsert por filename,
// pode rodar de novo com segurança (ex: depois de mais rodadas do bookmarklet).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { prisma } = require('../src/db');

const IMAGES_DIR = path.join(__dirname, '../public/images');

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

async function main() {
  const files = fs.readdirSync(IMAGES_DIR).filter((f) => fs.statSync(path.join(IMAGES_DIR, f)).isFile());
  console.log(`${files.length} arquivos em ${IMAGES_DIR}`);

  let done = 0;
  for (const filename of files) {
    const buffer = fs.readFileSync(path.join(IMAGES_DIR, filename));
    const ext = path.extname(filename).toLowerCase();
    await prisma.catalogImage.upsert({
      where: { filename },
      create: { filename, contentType: CONTENT_TYPES[ext] || 'application/octet-stream', data: buffer },
      update: { contentType: CONTENT_TYPES[ext] || 'application/octet-stream', data: buffer },
    });
    done++;
    if (done % 200 === 0) console.log(`${done}/${files.length}`);
  }

  console.log(`Concluído: ${done}/${files.length}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
