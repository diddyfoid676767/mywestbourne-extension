'use strict';
/* Strava, Garmin Connect and Teams. Activities go to the planner as workouts;
   Teams assignments go to Missed info next to myWestbourne's due work.
   Every half hour on Strava and Garmin it also asks the site for your latest
   activities itself, using your logged-in session. */
(() => {
  const host = location.hostname;
  const SITE = /strava\.com$/.test(host) ? 'strava' : /garmin\.com$/.test(host) ? 'garmin' : 'teams';
  const CHECK_EVERY = 30 * 60 * 1000;
  const pad = n => String(n).padStart(2, '0');
  const localStamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const num = v => typeof v === 'number' && isFinite(v) ? v : (parseFloat(v) || 0);

  // Strava's own activity list (strava.com/athlete/training)
  function stravaAct(m) {
    if (!m || m.id == null) return null;
    let start = '';
    const t = m.start_time && new Date(String(m.start_time).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    if (t && !isNaN(t)) start = localStamp(t);
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(m.start_date_local || '')) start = m.start_date_local.slice(0, 16);
    if (!start) return null;
    return {
      src: 'strava', id: String(m.id), name: m.name || '', type: m.sport_type || m.type || m.display_type || '', start_date_local: start,
      moving_time: num(m.moving_time_raw ?? m.moving_time), elapsed_time: num(m.elapsed_time_raw ?? m.elapsed_time),
      distance: num(m.distance_raw ?? (typeof m.distance === 'number' ? m.distance : 0)), average_heartrate: num(m.average_heartrate),
      suffer_score: num(m.suffer_score), total_elevation_gain: num(m.elevation_gain_raw ?? m.total_elevation_gain),
    };
  }
  // Garmin Connect's activity list (connect.garmin.com/modern/activities)
  function garminAct(a) {
    if (!a || a.activityId == null || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(a.startTimeLocal || '')) return null;
    return {
      src: 'garmin', id: String(a.activityId), name: a.activityName || '', type: (a.activityType && a.activityType.typeKey) || '',
      start_date_local: a.startTimeLocal.replace(' ', 'T').slice(0, 16), moving_time: num(a.movingDuration || a.duration),
      elapsed_time: num(a.elapsedDuration || a.duration), distance: num(a.distance), average_heartrate: num(a.averageHR),
      suffer_score: num(a.activityTrainingLoad), total_elevation_gain: num(a.elevationGain),
    };
  }
  function activities(data) {
    const list = Array.isArray(data) ? data : (data && (data.models || data.activityList || data.activities)) || [];
    return list.map(x => SITE === 'strava' ? stravaAct(x) : garminAct(x)).filter(Boolean);
  }

  // Teams assignments: any object with a name and a due date, wherever it sits
  const classes = {};
  function walk(o, f, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 8) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, f, depth + 1); return; }
    f(o);
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k], f, depth + 1);
  }
  const key = (o, re) => { for (const k in o) if (re.test(k) && o[k] != null && o[k] !== '') return o[k]; };
  function teamsItems(data) {
    const out = [], today = localStamp(new Date()).slice(0, 10);
    walk(data, o => {
      const name = key(o, /^(display_?name|title|name)$/i), due = key(o, /^due_?(date_?)?(time)?$/i);
      if (name && !due && o.id && (key(o, /class|code|term/i) || /class/i.test(JSON.stringify(Object.keys(o))))) classes[o.id] = name;
      if (!name || !due || typeof name !== 'string') return;
      const d = new Date(due); if (isNaN(d)) return;
      const status = String(key(o, /^status$/i) || '').toLowerCase();
      if (/submitted|returned|graded/.test(status)) return;
      const stamp = localStamp(d), date = stamp.slice(0, 10);
      if (date < today) return;
      const cls = classes[key(o, /^class_?id$/i)] || key(o, /^class_?name$/i) || '';
      const instr = key(o, /^instructions?$/i), text = String((instr && (instr.content || instr)) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const web = String(key(o, /^web_?url$/i) || '');
      let h = 0; for (const c of String(o.id || name + due)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      out.push({
        id: 'mwb-t' + h.toString(36), category: 'Deadline', subject: name.slice(0, 200), summary: [cls, text.slice(0, 300)].filter(Boolean).join('. '),
        from: String(cls), received: '', due: date, time: stamp.slice(11, 16) === '00:00' ? '' : stamp.slice(11, 16),
        link: /^https:\/\/(teams\.microsoft\.com|teams\.cloud\.microsoft|assignments\.onenote\.com)\//.test(web) ? web : '',
      });
    });
    return out;
  }

  // Garmin sleep and daily summary, keyed by the morning you woke up
  const hhmm = ms => typeof ms === 'number' ? new Date(ms).toISOString().slice(11, 16) : '';
  function healthFrom(url, data) {
    const days = {};
    const put = (d, v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(d || '')) days[d] = Object.assign(days[d] || {}, Object.fromEntries(Object.entries(v).filter(([, x]) => x))); };
    walk(data, o => {
      if (o.sleepTimeSeconds != null && o.calendarDate) {
        const sc = o.sleepScores && o.sleepScores.overall;
        put(o.calendarDate, { sleep: Math.round(num(o.sleepTimeSeconds) / 60), deep: Math.round(num(o.deepSleepSeconds) / 60), light: Math.round(num(o.lightSleepSeconds) / 60), rem: Math.round(num(o.remSleepSeconds) / 60), awake: Math.round(num(o.awakeSleepSeconds) / 60), score: sc ? num(sc.value) : 0, bed: hhmm(o.sleepStartTimestampLocal), wake: hhmm(o.sleepEndTimestampLocal) });
      }
      if (o.calendarDate && (o.totalSteps != null || o.restingHeartRate != null)) {
        put(o.calendarDate, { steps: num(o.totalSteps), rhr: num(o.restingHeartRate), bb: num(o.bodyBatteryMostRecentValue), stress: num(o.averageStressLevel) > 0 ? num(o.averageStressLevel) : 0 });
      }
    });
    return days;
  }

  function take(url, data) {
    if (SITE === 'garmin' && /wellness-service|usersummary-service/i.test(url)) {
      const days = healthFrom(url, data);
      if (Object.keys(days).length) chrome.runtime.sendMessage({ type: 'health', days }).catch(() => { });
      return Object.keys(days).length;
    }
    if (SITE === 'teams') { const items = teamsItems(data); if (items.length) chrome.runtime.sendMessage({ type: 'items', items }).catch(() => { }); return items.length; }
    const acts = activities(data);
    if (acts.length) chrome.runtime.sendMessage({ type: 'acts', acts }).catch(() => { });
    return acts.length;
  }
  window.addEventListener('message', e => {
    if (e.source === window && e.data && e.data.__lpc) take(e.data.url, e.data.data);
  });

  async function getJson(url, headers) {
    try {
      const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json, text/javascript', ...headers } });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }
  // Garmin's web app has moved its API around; use whichever way answers
  let garminWay = null;
  async function garmin(path, ok) {
    const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    const ways = [[`/gc-api/`, { 'connect-csrf-token': csrf }], ['/', { NK: 'NT', 'DI-Backend': 'connectapi.garmin.com' }], ['/proxy/', { NK: 'NT' }], ['/modern/proxy/', { NK: 'NT' }]];
    for (const [pre, h] of garminWay ? [garminWay] : ways) {
      const d = await getJson(pre + path, h);
      if (d && ok(d)) { garminWay = [pre, h]; return d; }
    }
    return null;
  }
  async function garminHealth() {
    const prof = await garmin('userprofile-service/socialProfile', d => d && d.displayName);
    if (!prof) return 0;
    const dn = encodeURIComponent(prof.displayName), { health = {} } = await chrome.storage.local.get('health');
    const back = Object.keys(health).length ? 3 : 14;
    let n = 0;
    for (let i = 0; i < back; i++) {
      const day = localStamp(new Date(Date.now() - i * 864e5)).slice(0, 10);
      const sleep = await garmin(`wellness-service/wellness/dailySleepData/${dn}?date=${day}&nonSleepBufferMinutes=60`, d => d && typeof d === 'object');
      const sum = await garmin(`usersummary-service/usersummary/daily/${dn}?calendarDate=${day}`, d => d && typeof d === 'object');
      if (sleep) n += take('wellness-service', sleep);
      if (sum) n += take('usersummary-service', sum);
    }
    return n;
  }

  async function check() {
    let n = 0;
    if (SITE === 'strava') {
      for (const p of [1, 2]) {
        const d = await getJson(`/athlete/training_activities?page=${p}&per_page=30`, { 'X-Requested-With': 'XMLHttpRequest' });
        if (d) n += take('', d);
      }
    } else if (SITE === 'garmin') {
      const d = await garmin('activitylist-service/activities/search/activities?limit=40&start=0', d => Array.isArray(d) || (d && d.activityList));
      if (d) n = take('activitylist-service', d);
      n += await garminHealth();
    }
    await chrome.storage.local.set({ ['lastCheck_' + SITE]: Date.now() });
    return n;
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'crawl' && window === window.top) { check().then(n => reply({ ok: true, found: n })); return true; }
  });
  if (SITE !== 'teams' && window === window.top) {
    chrome.storage.local.get('lastCheck_' + SITE).then(s => { if (Date.now() - (s['lastCheck_' + SITE] || 0) > CHECK_EVERY) check(); });
  }
})();
