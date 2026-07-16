// ==UserScript==
// @name         profile-shop Wiki Crawler
// @namespace    profile-shop
// @version      1.0
// @description  Percorre wiki.otponline.com via API do MediaWiki e envia os dados para o backend local do profile-shop
// @match        https://wiki.otponline.com/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function () {
  'use strict';

  const BACKEND = 'http://localhost:3000/wiki-crawl';
  const API_URL = 'https://wiki.otponline.com/api.php';
  const DELAY_MS = 300;

  function gmRequest(method, url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : undefined,
        onload: (res) => {
          try {
            resolve(JSON.parse(res.responseText));
          } catch (err) {
            reject(err);
          }
        },
        onerror: () => reject(new Error('Falha na requisição ao backend')),
      });
    });
  }

  function extractWikitext(revision) {
    if (!revision) return '';
    const slot = revision.slots?.main;
    if (!slot) return revision['*'] ?? '';
    return slot['*'] ?? slot.content ?? '';
  }

  async function callApi(params) {
    const url = new URL(API_URL);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const res = await fetch(url.toString(), { credentials: 'include' });
    if (!res.ok) throw new Error(`API do MediaWiki retornou ${res.status}`);
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
      const pages = data?.query?.pages || {};
      const pageData = Object.values(pages)[0];
      if (!pageData) break;

      if (firstCall) {
        pageInfo = {
          pageid: pageData.pageid,
          ns: pageData.ns,
          title: pageData.title,
          missing: pageData.missing !== undefined,
        };
        const revision = pageData.revisions?.[0];
        if (revision) {
          content = {
            revid: revision.revid,
            timestamp: revision.timestamp,
            wikitext: extractWikitext(revision),
          };
        }
      }

      if (Array.isArray(pageData.links)) links.push(...pageData.links);
      plcontinue = data.continue?.plcontinue || null;
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

  async function loop() {
    renderStatus('profile-shop crawler: iniciando...');
    let processed = 0;

    while (true) {
      let next;
      try {
        next = await gmRequest('GET', `${BACKEND}/next`);
      } catch (err) {
        renderStatus(`Erro ao falar com o backend: ${err.message}\nO backend está rodando em localhost:3000?`);
        return;
      }

      if (next.done) {
        renderStatus(`Concluído! ${processed} páginas processadas nesta sessão.`);
        return;
      }

      const { title } = next;
      renderStatus(`Processadas nesta sessão: ${processed}\nAtual: ${title}`);

      try {
        const result = await fetchWikiPage(title);
        await gmRequest('POST', `${BACKEND}/result`, { title, ...result });
      } catch (err) {
        await gmRequest('POST', `${BACKEND}/result`, { title, error: err.message });
      }

      processed++;
      await sleep(DELAY_MS);
    }
  }

  const startBtn = document.createElement('button');
  startBtn.textContent = 'Iniciar crawler profile-shop';
  startBtn.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;padding:8px 12px;';
  startBtn.onclick = () => {
    startBtn.remove();
    loop();
  };
  document.body.appendChild(startBtn);
})();
