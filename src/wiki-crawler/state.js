const store = require('./store');
const config = require('./config');

const MAX_RETRIES = 3;

let index = null;
let queue = null;
let visited = null;
let retryCounts = null;

function init() {
  if (index) return;
  store.ensureDirs();
  index = store.loadIndex();
  visited = new Set(Object.keys(index.pages));
  queue = store.loadQueue();
  if (!queue || queue.length === 0) {
    queue = visited.size === 0 ? [config.mainPageTitle] : [];
  }
  retryCounts = new Map();
}

function persist() {
  store.saveIndex(index);
  store.saveQueue(queue);
}

function getNext() {
  init();
  while (queue.length > 0) {
    const title = queue.shift();
    if (!visited.has(title)) return title;
  }
  return null;
}

function recordResult({ title, pageInfo, content, links, error }) {
  init();

  if (error) {
    const attempts = (retryCounts.get(title) || 0) + 1;
    retryCounts.set(title, attempts);

    if (attempts < MAX_RETRIES) {
      queue.push(title);
    } else {
      index.pages[title] = { failed: true, error, attempts, fetchedAt: new Date().toISOString() };
      visited.add(title);
    }
    persist();
    return;
  }

  if (!pageInfo || pageInfo.missing) {
    index.pages[title] = { missing: true, fetchedAt: new Date().toISOString() };
    visited.add(title);
    persist();
    return;
  }

  let file = null;
  if (content) {
    file = store.savePageContent(pageInfo.pageid, pageInfo.title, {
      title: pageInfo.title,
      pageid: pageInfo.pageid,
      ns: pageInfo.ns,
      revid: content.revid,
      timestamp: content.timestamp,
      wikitext: content.wikitext,
    });
  }

  const linkedTitles = (links || []).filter((link) => link.ns === 0).map((link) => link.title);

  index.pages[pageInfo.title] = {
    pageid: pageInfo.pageid,
    ns: pageInfo.ns,
    revid: content?.revid ?? null,
    file,
    links: linkedTitles,
    fetchedAt: new Date().toISOString(),
  };

  visited.add(pageInfo.title);
  visited.add(title);

  for (const linkedTitle of linkedTitles) {
    if (!visited.has(linkedTitle) && !queue.includes(linkedTitle)) {
      queue.push(linkedTitle);
    }
  }

  persist();
}

function getStatus() {
  init();
  return {
    indexed: Object.keys(index.pages).length,
    queued: queue.length,
  };
}

module.exports = { getNext, recordResult, getStatus };
