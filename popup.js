'use strict';
const $ = id => document.getElementById(id);
const ask = msg => chrome.runtime.sendMessage(msg);
const ORIGIN = 'https://my.westbourne.vic.edu.au';
const SITES = /^https:\/\/(my\.westbourne\.vic\.edu\.au|www\.strava\.com|connect\.garmin\.com|teams\.microsoft\.com|teams\.cloud\.microsoft)\//;
const ymd = d => new Date(d - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
function when(d) {
  const n = Math.round((new Date(d + 'T00:00') - new Date(ymd(Date.now()) + 'T00:00')) / 86400000);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : n < 7 ? new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' }) : new Date(d + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.url && SITES.test(tab.url) ? tab : null;
}
async function activeTab() {
  const tab = await currentTab();
  return tab && tab.url.startsWith(ORIGIN + '/') ? tab : null;
}

async function refresh() {
  const s = await ask({ type: 'status' });
  const items = Object.values(s.items || {});
  const p = $('planner');
  if (s.planner) {
    p.className = 'status ok';
    p.textContent = `✓ Connected to Life Planner ${s.planner.version || ''}` + (s.lastSent ? ` · sent ${ago(s.lastSent)}` : '');
  } else {
    p.className = 'status warn';
    p.textContent = items.length ? 'Life Planner isn’t open. Everything will go across when you open it.' : 'Life Planner isn’t open right now.';
  }
  const due = items.filter(x => x.due), newsN = items.length - due.length;
  $('counts').textContent = items.length ? `${due.length} due work · ${newsN} news and notices` + (s.lastCrawl ? ` · myWestbourne checked ${ago(s.lastCrawl)}` : '') : '';
  if (s.lastError && s.planner) p.textContent += ` · ${s.lastError}`;
  const acts = Object.values(s.acts || {}), by = src => acts.filter(a => a.src === src).length;
  const nights = Object.values(s.health || {}).filter(h => h.sleep).length;
  if (acts.length || nights) $('acts').textContent = (nights ? `${nights} nights of sleep from Garmin · ` : '') + `${by('strava')} from Strava · ${by('garmin')} from Garmin (last 120 days)` + (s.lastCheck_strava ? ` · Strava checked ${ago(s.lastCheck_strava)}` : '') + (s.lastCheck_garmin ? ` · Garmin checked ${ago(s.lastCheck_garmin)}` : '');
  const t = ymd(Date.now());
  const up = due.filter(x => x.due >= t).sort((a, b) => (a.due + (a.time || '')).localeCompare(b.due + (b.time || ''))).slice(0, 15);
  if (up.length) $('list').innerHTML = up.map(x => `<li><span class="when">${esc(when(x.due))}${x.time ? ' ' + esc(x.time) : ''}</span><a href="${esc(x.link)}" target="_blank">${esc(x.subject)}</a>${x.from ? `<span class="cls">${esc(x.from)}</span>` : ''}</li>`).join('');
  $('page').disabled = !(await activeTab());
}

$('check').onclick = async () => {
  const tab = await currentTab();
  if (!tab) { chrome.tabs.create({ url: ORIGIN + '/' }); window.close(); return; }
  if (/teams\./.test(tab.url)) { $('msg').textContent = 'Open Assignments in Teams and they come across by themselves.'; return; }
  $('msg').textContent = 'Checking…';
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'crawl' }, { frameId: 0 });
    $('msg').textContent = r.found ? `Found ${r.found}.` : 'Found nothing new to read here. Try the activities or due work page.';
  } catch { $('msg').textContent = 'Reload the myWestbourne tab and try again.'; }
  setTimeout(refresh, 800);
};
$('page').onclick = async () => {
  const tab = await activeTab(); if (!tab) return;
  try {
    const { item } = await chrome.tabs.sendMessage(tab.id, { type: 'page' });
    const r = await ask({ type: 'add', item });
    $('msg').textContent = r.ok ? `Added “${item.subject}” to Missed info.` : 'Saved. It will go across when the planner is open.';
  } catch { $('msg').textContent = 'Reload the myWestbourne tab and try again.'; }
  refresh();
};
$('send').onclick = async () => {
  const r = await ask({ type: 'send' });
  $('msg').textContent = r.ok ? `Sent ${r.count} items to the planner.` : 'Couldn’t reach the planner. Is it open?';
  refresh();
};
refresh();
