'use strict';
/* Runs on every myWestbourne page. It reads the page you're on, and every half
   hour also loads Due Work, the homepage and News in the background (using your
   logged-in session), then hands what it found to background.js. */
(() => {
  const CRAWL_EVERY = 30 * 60 * 1000;
  const send = (items, why) => items.length && chrome.runtime.sendMessage({ type: 'items', items, why }).catch(() => { });

  const scanHere = () => send(MWB.scan(document, location.pathname), 'page');

  async function load(path) {
    try {
      const r = await fetch(path, { credentials: 'include' });
      if (!r.ok || !r.url.startsWith(MWB.ORIGIN + '/') || /\/login|saml|oauth/i.test(r.url)) return null;
      return new DOMParser().parseFromString(await r.text(), 'text/html');
    } catch { return null; }
  }

  async function crawl() {
    const dueLink = document.querySelector('a[href*="/learning/due"]');
    const paths = [...new Set([dueLink ? new URL(dueLink.href).pathname : '/learning/due', '/', '/news'])];
    let items = [];
    for (const p of paths) {
      const doc = await load(p);
      if (doc) items = items.concat(MWB.scan(doc, p));
    }
    await chrome.storage.local.set({ lastCrawl: Date.now() });
    send(items, 'crawl');
    return items.length;
  }

  async function maybeCrawl() {
    const { lastCrawl = 0 } = await chrome.storage.local.get('lastCrawl');
    if (Date.now() - lastCrawl > CRAWL_EVERY) crawl();
  }

  // widgets on the homepage load after the page does, so look again when it changes
  let timer = null, rescans = 0;
  new MutationObserver(() => {
    if (rescans > 20) return;
    clearTimeout(timer);
    timer = setTimeout(() => { rescans++; scanHere(); }, 2000);
  }).observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'crawl') { scanHere(); crawl().then(n => reply({ ok: true, found: n })); return true; }
    if (msg.type === 'page') { reply({ ok: true, item: MWB.page(document, location.href) }); }
  });

  scanHere();
  maybeCrawl();
})();
