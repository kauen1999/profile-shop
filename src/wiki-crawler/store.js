const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDirs() {
  fs.mkdirSync(config.pagesDir, { recursive: true });
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadIndex() {
  return loadJson(config.indexPath, { pages: {}, updatedAt: null });
}

function saveIndex(index) {
  index.updatedAt = new Date().toISOString();
  saveJson(config.indexPath, index);
}

function loadQueue() {
  return loadJson(config.queuePath, null);
}

function saveQueue(queue) {
  saveJson(config.queuePath, queue);
}

function sanitizeTitle(title) {
  return title.replace(/[^a-zA-Z0-9À-ÿ_-]+/g, '_').slice(0, 150);
}

function pageFilePath(pageid, title) {
  return path.join(config.pagesDir, `${pageid}__${sanitizeTitle(title)}.json`);
}

function savePageContent(pageid, title, content) {
  const filePath = pageFilePath(pageid, title);
  saveJson(filePath, content);
  return path.relative(config.dataDir, filePath);
}

module.exports = {
  ensureDirs,
  loadIndex,
  saveIndex,
  loadQueue,
  saveQueue,
  savePageContent,
};
