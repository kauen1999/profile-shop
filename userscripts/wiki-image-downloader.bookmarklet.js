javascript:(async function () {
  const BACKEND = 'http://localhost:3000/wiki-images';
  const failed = new Set();

  function renderStatus(text) {
    let box = document.getElementById('ps-image-status');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ps-image-status';
      box.style.cssText =
        'position:fixed;bottom:10px;right:10px;background:#111;color:#0f0;font:12px monospace;' +
        'padding:8px 12px;border-radius:6px;z-index:999999;max-width:320px;white-space:pre-wrap;';
      document.body.appendChild(box);
    }
    box.textContent = text;
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  // First fallback attempt (confirmed 2026-07-14 NOT sufficient on its own —
  // kept as a fast/cheap first try since it's harmless, but real fix is
  // loadImageViaIframe below). Draws a plain <img> into a <canvas>.
  function loadImageViaCanvas(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          resolve(dataUrl.split(',')[1]);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('img element failed to load'));
      img.src = url;
    });
  }

  // Real fallback (confirmed 2026-07-14): the addon looktype images carry a
  // Cross-Origin-Resource-Policy header that blocks ANY embedded sub-resource
  // load — fetch(), XHR, AND plain <img> alike (this was the mistaken
  // assumption in the first fallback above: CORP is not fetch-specific, it
  // blocks image embeds too). The browser's own network-layer log line
  // (`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`) fires identically
  // regardless of which JS API triggered the blocked request, which is why
  // switching to loadImageViaCanvas alone didn't change anything — same
  // error, confirmed by the user testing again.
  //
  // What IS exempt from CORP: genuine navigation loads (the browser address
  // bar, or a frame navigating to a URL as its own top-level document —
  // that's why pasting the URL directly into the address bar worked fine).
  // This loads the URL as an <iframe>'s own document (a "navigate" fetch,
  // not a "no-cors" embed) and reaches into the resulting framed document —
  // when a browser frames a bare image resource this way, it auto-generates
  // a minimal HTML document with a single <img>. That <img> is read from
  // *within* the iframe's own same-origin realm (own contentWindow/document),
  // so the canvas draw there is never cross-origin-tainted.
  function loadImageViaIframe(url) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';

      function cleanup() {
        iframe.remove();
      }

      iframe.onload = () => {
        try {
          const framedDoc = iframe.contentDocument;
          const framedImg = framedDoc && framedDoc.querySelector('img');
          if (!framedImg) throw new Error('framed document has no <img> (blocked or not an image?)');

          function extract() {
            try {
              const framedWindow = iframe.contentWindow;
              const canvas = framedWindow.document.createElement('canvas');
              canvas.width = framedImg.naturalWidth;
              canvas.height = framedImg.naturalHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(framedImg, 0, 0);
              const dataUrl = canvas.toDataURL('image/png');
              cleanup();
              resolve(dataUrl.split(',')[1]);
            } catch (err) {
              cleanup();
              reject(err);
            }
          }

          if (framedImg.complete && framedImg.naturalWidth > 0) {
            extract();
          } else {
            framedImg.onload = extract;
            framedImg.onerror = () => {
              cleanup();
              reject(new Error('framed <img> failed to load'));
            };
          }
        } catch (err) {
          cleanup();
          reject(err);
        }
      };
      iframe.onerror = () => {
        cleanup();
        reject(new Error('iframe failed to load'));
      };

      document.body.appendChild(iframe);
      iframe.src = url;
    });
  }

  // Some pending items are nested addon looktype images
  // (extractedFields.addonCompatibilities[i].looktypeImageUrl/
  // looktypeShinyImageUrl on `addons`-category rows, not the row's own
  // top-level imageUrl) — a single addons row can carry several
  // independently-pending nested URLs, so a plain wikiPageId isn't a unique
  // key for the `failed`/`exclude` bookkeeping below. Mirrors the backend's
  // nestedExcludeKey() in src/routes/wikiImages.js — keep both in sync.
  function itemKey(item) {
    return item.nested
      ? `nested:${item.wikiPageId}:${item.nested.compatibilityIndex}:${item.nested.field}`
      : String(item.wikiPageId);
  }

  renderStatus('Baixando imagens: iniciando...');
  let processed = 0;
  let emptyRoundsInARow = 0;
  const MAX_EMPTY_ROUNDS = 5;

  while (true) {
    const exclude = [...failed].join(',');
    const res = await fetch(`${BACKEND}/pending?limit=30&exclude=${exclude}`);
    const batch = await res.json();

    if (!batch.items.length) {
      renderStatus(`Concluído! ${processed} imagens baixadas. ${failed.size} falharam (sem imagem disponível).`);
      return;
    }

    let successesThisRound = 0;
    for (const item of batch.items) {
      renderStatus(`Baixadas: ${processed} · Faltam: ${batch.remaining}\nAtual: ${item.name}`);
      try {
        let dataBase64;
        let filename = item.imageUrl.split('/').pop();

        try {
          const imgRes = await fetch(item.imageUrl);
          if (!imgRes.ok) throw new Error(`download: status ${imgRes.status}`);
          const buffer = await imgRes.arrayBuffer();
          dataBase64 = arrayBufferToBase64(buffer);
        } catch (fetchErr) {
          try {
            dataBase64 = await loadImageViaCanvas(item.imageUrl);
          } catch (canvasErr) {
            // Confirmed 2026-07-14: CORP blocks the plain <img>+canvas
            // fallback too (same underlying restriction as fetch) — the
            // iframe-navigation approach is the one that actually escapes it.
            dataBase64 = await loadImageViaIframe(item.imageUrl);
          }
          filename = filename.replace(/\.[a-z0-9]+$/i, '') + '.png';
        }

        const body = { wikiPageId: item.wikiPageId, filename, dataBase64 };
        if (item.nested) body.nested = item.nested;

        const uploadRes = await fetch(`${BACKEND}/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        // Bug found 2026-07-14: this call was never checked for a non-2xx
        // status — a server-side upload failure (e.g. validation error) was
        // silently counted as a success (processed++), which could make the
        // whole run look like it's progressing while nothing was actually
        // persisted for the failing class of items. Always check .ok.
        if (!uploadRes.ok) {
          const errText = await uploadRes.text().catch(() => '');
          throw new Error(`upload: status ${uploadRes.status} ${errText}`);
        }
        processed++;
        successesThisRound++;
      } catch (err) {
        failed.add(itemKey(item));
        // Log the real reason instead of swallowing it silently — needed to
        // diagnose why a whole class of items (e.g. nested addon looktype
        // images) might be failing systematically instead of guessing blind.
        console.error(`[wiki-image-downloader] falhou: ${item.name} (${item.imageUrl})`, err);
      }
      // Slowed down 2026-07-14 (was 120ms): this migration is ~1500+ images
      // in one go, much larger volume than the original per-category
      // migrations this pacing was tuned for. Confirmed via real console
      // logs that a fast run triggers a hard Cloudflare 403 block on
      // *every* subsequent request (not the earlier CORP-style block —
      // this is real rate-limiting), not just an occasional hiccup.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    if (successesThisRound === 0) {
      emptyRoundsInARow++;
      if (emptyRoundsInARow >= MAX_EMPTY_ROUNDS) {
        renderStatus(`Parando: ${MAX_EMPTY_ROUNDS} lotes seguidos falharam. ${processed} baixadas, ${failed.size} falharam.`);
        return;
      }
      // Wait bumped 5s -> 15s (same reasoning as above) — gives a Cloudflare
      // rate-limit window more realistic time to lift before giving up.
      renderStatus(`Lote sem sucesso (${emptyRoundsInARow}/${MAX_EMPTY_ROUNDS}), tentando de novo em 15s...`);
      await new Promise((resolve) => setTimeout(resolve, 15000));
    } else {
      emptyRoundsInARow = 0;
    }
  }
})();
