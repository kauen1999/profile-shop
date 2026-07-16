javascript:(async function () {
  const BACKEND = 'http://localhost:3000/wiki-crawl';
  const API_URL = 'https://wiki.otponline.com/api.php';
  const DELAY_MS = 300;

  function extractWikitext(revision) {
    if (!revision) return '';
    const slot = revision.slots && revision.slots.main;
    if (!slot) return revision['*'] || '';
    return slot['*'] || slot.content || '';
  }

  async function callApi(params) {
    const url = new URL(API_URL);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const res = await fetch(url.toString(), { credentials: 'include' });
    if (!res.ok) throw new Error('API ' + res.status);
    return res.json();
  }

  async function fetchWikiPage(title) {
    let links = [];
    let plcontinue = null;
    let pageInfo = null;
    let content = null;
    let firstCall = true;

    do {
      const params = {
        action: 'query',
        format: 'json',
        redirects: '1',
        titles: title,
        prop: firstCall ? 'revisions|links|info' : 'links',
        pllimit: 'max',
      };
      if (firstCall) {
        params.rvslots = 'main';
        params.rvprop = 'content|ids|timestamp';
      }
      if (plcontinue) params.plcontinue = plcontinue;

      const data = await callApi(params);
      const pages = (data.query && data.query.pages) || {};
      const pageData = Object.values(pages)[0];
      if (!pageData) break;

      if (firstCall) {
        pageInfo = {
          pageid: pageData.pageid,
          ns: pageData.ns,
          title: pageData.title,
          missing: pageData.missing !== undefined,
        };
        const revision = pageData.revisions && pageData.revisions[0];
        if (revision) {
          content = {
            revid: revision.revid,
            timestamp: revision.timestamp,
            wikitext: extractWikitext(revision),
          };
        }
      }

      if (Array.isArray(pageData.links)) links.push(...pageData.links);
      plcontinue = (data.continue && data.continue.plcontinue) || null;
      firstCall = false;
    } while (plcontinue);

    return { pageInfo, content, links };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function renderStatus(text) {
    let box = document.getElementById('ps-crawler-status');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ps-crawler-status';
      box.style.cssText =
        'position:fixed;bottom:10px;right:10px;background:#111;color:#0f0;font:12px monospace;' +
        'padding:8px 12px;border-radius:6px;z-index:999999;max-width:320px;white-space:pre-wrap;';
      document.body.appendChild(box);
    }
    box.textContent = text;
  }

  async function backendGet(path) {
    const res = await fetch(BACKEND + path);
    if (!res.ok) throw new Error('Backend ' + res.status);
    return res.json();
  }

  async function backendPost(path, body) {
    const res = await fetch(BACKEND + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Backend ' + res.status);
    return res.json();
  }

  renderStatus('profile-shop crawler: iniciando...');
  let processed = 0;

  while (true) {
    let next;
    try {
      next = await backendGet('/next');
    } catch (err) {
      renderStatus('Erro ao falar com o backend: ' + err.message + '\nO backend está rodando em localhost:3000?');
      return;
    }

    if (next.done) {
      renderStatus('Concluído! ' + processed + ' páginas processadas nesta sessão.');
      return;
    }

    const title = next.title;
    renderStatus('Processadas: ' + processed + '\nAtual: ' + title);

    try {
      const result = await fetchWikiPage(title);
      await backendPost('/result', Object.assign({ title }, result));
    } catch (err) {
      await backendPost('/result', { title, error: err.message });
    }

    processed++;
    await sleep(DELAY_MS);
  }
})();
