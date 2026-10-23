'use strict';
/* Keeps everything found on myWestbourne and Teams (items) and Strava and
   Garmin (acts) in chrome.storage and sends it to the Life Planner at
   http://127.0.0.1:47823. The planner only runs while it's open, so when it
   isn't, everything waits here and goes across on the next try (every 5
   minutes, or "Send to planner" in the popup). */
const PLANNER = 'http://127.0.0.1:47823/api/portal';
const PLANNER_OLD = 'http://127.0.0.1:47823/api/westbourne'; // Life Planner 2.10
const ACTS = 'http://127.0.0.1:47823/api/browser/activities';
const HEALTH = 'http://127.0.0.1:47823/api/browser/health';
const DAY = 86400000;

let chain = Promise.resolve();
const serial = f => (chain = chain.then(f, f));

const ymd = d => new Date(d - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function prune(items) {
  const now = Date.now(), old = ymd(now - 14 * DAY);
  const keep = Object.values(items).filter(x => x.due ? x.due >= old : now - x.lastSeen < 45 * DAY);
  keep.sort((a, b) => b.lastSeen - a.lastSeen);
  return Object.fromEntries(keep.slice(0, 300).map(x => [x.id, x]));
}

function merge(found) {
  return serial(async () => {
    const { items = {} } = await chrome.storage.local.get('items');
    const now = Date.now();
    let changed = false;
    for (const x of found) {
      if (!x || !x.id || !x.subject) continue;
      const old = items[x.id];
      const next = { ...old, ...x, firstSeen: old ? old.firstSeen : now, lastSeen: now };
      // a list entry without a date never wipes a date we already know
      if (old && !x.due && old.due) { next.due = old.due; next.time = old.time; }
      if (old && !x.from && old.from) next.from = old.from;
      if (old && x.summary.length < (old.summary || '').length && x.due === old.due) next.summary = old.summary;
      next.received = x.received || (old && old.received) || new Date(next.firstSeen).toISOString();
      const same = old && ['subject', 'summary', 'due', 'time', 'from', 'category', 'link', 'received'].every(k => (old[k] || '') === (next[k] || ''));
      if (!same) changed = true;
      items[x.id] = next;
    }
    await chrome.storage.local.set({ items: prune(items), ...(changed ? { dirty: true } : {}) });
    return changed;
  });
}

// activities: keyed src:id, last 120 days
function mergeActs(found) {
  return serial(async () => {
    const { acts = {} } = await chrome.storage.local.get('acts');
    const old = new Date(Date.now() - 120 * DAY).toISOString().slice(0, 10);
    let changed = false;
    for (const a of found) {
      if (!a || !a.id || !a.src || !a.start_date_local) continue;
      const k = a.src + ':' + a.id;
      if (JSON.stringify(acts[k]) !== JSON.stringify(a)) { acts[k] = a; changed = true; }
    }
    for (const k in acts) if (acts[k].start_date_local < old) delete acts[k];
    await chrome.storage.local.set({ acts, ...(changed ? { actsDirty: true } : {}) });
    return changed;
  });
}

// health: one entry per day, last 60 days
function mergeHealth(found) {
  return serial(async () => {
    const { health = {} } = await chrome.storage.local.get('health');
    const old = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
    let changed = false;
    for (const [d, v] of Object.entries(found || {})) {
      const next = { ...health[d], ...v };
      if (JSON.stringify(next) !== JSON.stringify(health[d])) { health[d] = next; changed = true; }
    }
    for (const d in health) if (d < old) delete health[d];
    await chrome.storage.local.set({ health, ...(changed ? { actsDirty: true } : {}) });
    return changed;
  });
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

function send() {
  return serial(async () => {
    const { items = {}, acts = {}, health = {} } = await chrome.storage.local.get(['items', 'acts', 'health']);
    const list = Object.values(items).map(({ firstSeen, lastSeen, ...x }) => x);
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      let r = await post(PLANNER, { items: list });
      if (r.status === 404 || r.status === 403) r = await post(PLANNER_OLD, { items: list });
      if (!r.ok) throw new Error(`planner said ${r.status}`);
      const r2 = await post(ACTS, { items: Object.values(acts) });
      if (!r2.ok) throw new Error(r2.status === 404 || r2.status === 403 ? 'Update Life Planner to get Strava and Garmin' : `planner said ${r2.status}`);
      if (Object.keys(health).length) {
        const r3 = await post(HEALTH, { days: health });
        if (!r3.ok) throw new Error(r3.status === 404 || r3.status === 403 ? 'Update Life Planner to get sleep and steps' : `planner said ${r3.status}`);
      }
      await chrome.storage.local.set({ dirty: false, actsDirty: false, lastSent: Date.now(), lastError: '' });
      badge('');
      return { ok: true, count: list.length };
    } catch (e) {
      const msg = String(e.message || e);
      await chrome.storage.local.set({ lastError: /fetch/i.test(msg) ? 'Life Planner isn’t open' : msg });
      badge('•', '#f59f00');
      return { ok: false, error: msg };
    }
  });
}

async function plannerUp() {
  try {
    let r = await fetch(PLANNER, { cache: 'no-store' });
    if (r.status === 404) r = await fetch(PLANNER_OLD, { cache: 'no-store' });
    const j = await r.json();
    return j.app === 'life-planner' ? j : null;
  } catch { return null; }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'items') {
      if (await merge(msg.items)) await send();
      reply({ ok: true });
    } else if (msg.type === 'acts') {
      if (await mergeActs(msg.acts)) await send();
      reply({ ok: true });
    } else if (msg.type === 'health') {
      if (await mergeHealth(msg.days)) await send();
      reply({ ok: true });
    } else if (msg.type === 'add') {
      await merge([msg.item]);
      reply(await send());
    } else if (msg.type === 'send') {
      reply(await send());
    } else if (msg.type === 'status') {
      const s = await chrome.storage.local.get(['items', 'acts', 'lastSent', 'lastError', 'dirty', 'lastCrawl', 'lastCheck_strava', 'lastCheck_garmin', 'health']);
      reply({ ...s, planner: await plannerUp() });
    } else if (msg.type === 'clear') {
      await chrome.storage.local.set({ items: {}, dirty: true, lastCrawl: 0 });
      reply(await send());
    }
  })();
  return true;
});

const setup = () => chrome.alarms.create('retry', { periodInMinutes: 5 });
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'retry') return;
  const { dirty, actsDirty } = await chrome.storage.local.get(['dirty', 'actsDirty']);
  if (dirty || actsDirty) send();
});
