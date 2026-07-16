// Runs `fn` over `items` with at most `concurrency` in flight at once.
// ImportListings.jsx uses this for the "Analisar" step — resolving each
// pasted look block hits several network endpoints per block
// (pokeball/pokemon/mega-stone/addon/held-item/stickers), and firing all of
// them via a single Promise.all across every block (the previous behavior)
// meant pasting a few hundred looks opened a few thousand simultaneous
// requests at once: the browser's per-host connection limit queues most of
// them, the tab appears frozen, and the backend/Neon connection pool gets
// hammered all at once. A bounded pool keeps only `concurrency` blocks
// resolving at any given time — same total work, but the browser and
// backend see a steady trickle instead of a burst.
export async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await fn(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
