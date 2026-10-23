'use strict';
/* Reads myWestbourne (Schoolbox) pages into planner items. Every function takes
   a Document, so it works on the page you're looking at and on pages fetched in
   the background. Schoolbox layouts change, so this goes by links and dates
   rather than exact page structure:
     /learning/assessments/<id>  a piece of due work or an assessment
     /news/<id>                  a news post or notice */
var MWB = (() => {
  const ORIGIN = 'https://my.westbourne.vic.edu.au';
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const GENERIC = /^(view|open|submit|more|read more|details|go|here|click here|\d+)$/i;

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  // text with a space between elements, so "Due</dt><dd>Mon" reads "Due Mon"
  // (innerText would do this, but not on pages fetched in the background)
  function text(el) {
    if (!el) return '';
    const parts = [], w = (el.ownerDocument || el).createTreeWalker(el, 4);
    for (let n; (n = w.nextNode());) if (!n.parentElement || !/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.parentElement.tagName)) parts.push(n.nodeValue);
    return clean(parts.join(' '));
  }
  const abs = href => { try { return new URL(href, ORIGIN).href; } catch { return ''; } };

  // a year-less date means the nearest one: this year, or next year if that's
  // more than two months ago (e.g. "15 Jan" seen in November)
  function guessYear(m, d, now) {
    let y = now.getFullYear();
    if (new Date(y, m, d) < new Date(now.getFullYear(), now.getMonth() - 2, now.getDate())) y++;
    return y;
  }
  function mkDate(y, m, d) {
    const x = new Date(y, m, d);
    return x.getMonth() === m && x.getDate() === d ? ymd(x) : '';
  }

  // first date in a piece of text, as YYYY-MM-DD, plus a time if one follows
  function findDate(s, now = new Date()) {
    s = clean(s);
    let m, date = '', at = -1;
    const tries = [
      [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MON}\\.?,?(?:\\s+(\\d{4}))?`, 'i'), m => mkDate(m[3] ? +m[3] : guessYear(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1], now), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1])],
      [new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?`, 'i'), m => mkDate(m[3] ? +m[3] : guessYear(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2], now), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2])],
      [/\b(\d{4})-(\d{2})-(\d{2})\b/, m => mkDate(+m[1], +m[2] - 1, +m[3])],
      // Australian order: day/month/year
      [/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/, m => mkDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1])],
      [/\btoday\b/i, () => ymd(now)],
      [/\btomorrow\b/i, () => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))],
    ];
    for (const [re, f] of tries) {
      if ((m = re.exec(s)) && (at < 0 || m.index < at)) { const d = f(m); if (d) { date = d; at = m.index; } }
    }
    if (!date) return null;
    const rest = s.slice(at, at + 60);
    const t = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i.exec(rest) || /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*\/)/.exec(rest);
    let time = '';
    if (t) {
      let h = +t[1];
      if (t[3]) { h = h % 12 + (t[3].toLowerCase() === 'p' ? 12 : 0); }
      time = `${pad(h)}:${t[2] || '00'}`;
    }
    return { date, time };
  }

  // the due date of a piece of work: a <time datetime> if the page has one,
  // otherwise a date written after "due", otherwise the first date in it
  function dueOf(el, now) {
    const tm = el.querySelector && el.querySelector('time[datetime]');
    if (tm) {
      const v = tm.getAttribute('datetime');
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v, time: '' };
      const d = new Date(v);
      if (!isNaN(d)) return { date: ymd(d), time: /T\d/.test(v) && !/T00:00(:00)?/.test(v) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '' };
    }
    const s = text(el), i = s.search(/\bdue\b/i);
    return (i >= 0 && findDate(s.slice(i), now)) || findDate(s, now);
  }

  // the block a link sits in: the biggest ancestor that is still only about
  // this one assessment or post (so a date from the next row isn't picked up)
  function boxOf(a, re) {
    const ids = el => new Set([...el.querySelectorAll('a[href]')].map(l => (re.exec(l.getAttribute('href')) || [])[1]).filter(Boolean)).size;
    let b = a;
    while (b.parentElement && !/^(BODY|HTML|MAIN)$/.test(b.parentElement.tagName) && b.parentElement.id !== 'content' && ids(b.parentElement) <= 1 && text(b.parentElement).length < 1500) b = b.parentElement;
    return b;
  }

  // the class a piece of work belongs to, e.g. "12BIO1A - Biology 3&4"
  function classOf(box, a) {
    for (const l of box.querySelectorAll('a[href*="/homepage/"], a[href*="/learning/classes/"], a[href*="/home/page/"]')) {
      if (l !== a && text(l)) return text(l);
    }
    const m = /\b\d{1,2}[A-Z]{2,5}\d?[A-Z]?\s*-\s*[A-Za-z][A-Za-z']*(?:\s+(?!due\b)[A-Za-z][A-Za-z']*)*(?:\s*(?:\d\s*&\s*\d|\d\/\d|units?\s*\d(?:\s*(?:&|and)\s*\d)?))?/i.exec(text(box));
    return m ? clean(m[0]) : '';
  }

  function assessments(doc, now = new Date()) {
    const out = new Map();
    for (const a of doc.querySelectorAll('a[href*="/learning/assessments/"]')) {
      const m = /\/learning\/assessments\/(\d+)/.exec(a.getAttribute('href') || '');
      if (!m) continue;
      const box = boxOf(a, /\/learning\/assessments\/(\d+)/);
      let title = text(a);
      if (!title || GENERIC.test(title)) {
        const h = box.querySelector('h1, h2, h3, h4, h5, strong, b');
        title = h ? text(h) : '';
      }
      if (!title || GENERIC.test(title)) continue;
      const due = dueOf(box, now), cls = classOf(box, a);
      const item = {
        id: 'mwb-a' + m[1], category: 'Deadline', subject: title.slice(0, 200),
        summary: cls,
        from: cls, received: '', due: due ? due.date : '', time: due ? due.time : '', link: ORIGIN + '/learning/assessments/' + m[1],
      };
      const old = out.get(item.id);
      if (!old || (!old.due && item.due) || (old.due === item.due && item.summary.length > old.summary.length)) out.set(item.id, item);
    }
    return [...out.values()];
  }

  function news(doc, now = new Date()) {
    const out = new Map();
    for (const a of doc.querySelectorAll('a[href*="/news/"]')) {
      const m = /\/news\/(\d+)/.exec(a.getAttribute('href') || '');
      if (!m) continue;
      const title = text(a);
      if (!title || GENERIC.test(title) || out.has('mwb-n' + m[1])) continue;
      const box = boxOf(a, /\/news\/(\d+)/), d = dueOf(box, now);
      let summary = text(box).replace(title, '').trim();
      out.set('mwb-n' + m[1], {
        id: 'mwb-n' + m[1], category: 'FYI', subject: title.slice(0, 200), summary: summary.slice(0, 300),
        from: '', received: d ? new Date(d.date + 'T09:00:00').toISOString() : '', due: '', link: ORIGIN + '/news/' + m[1],
      });
    }
    return [...out.values()];
  }

  // what the page you're on is about, when it's a single assessment or post
  function detail(doc, path, now = new Date()) {
    const main = doc.querySelector('#content, main, [role="main"]') || doc.body;
    const h1 = doc.querySelector('#content h1, main h1, h1');
    const title = text(h1) || clean(doc.title);
    let m;
    if ((m = /^\/learning\/assessments\/(\d+)/.exec(path))) {
      const body = text(main);
      const i = body.search(/\bdue\b/i);
      const due = (i >= 0 && findDate(body.slice(i), now)) || dueOf(main, now);
      const cls = classOf(main, null);
      const desc = body.replace(title, '').trim().slice(0, 400);
      return [{
        id: 'mwb-a' + m[1], category: 'Deadline', subject: title.slice(0, 200),
        summary: [cls, desc].filter(Boolean).join('. ').slice(0, 600),
        from: cls, received: '', due: due ? due.date : '', time: due ? due.time : '', link: ORIGIN + '/learning/assessments/' + m[1],
      }];
    }
    if ((m = /^\/news\/(\d+)/.exec(path))) {
      const body = text(main).replace(title, '').trim();
      const d = findDate(body.slice(0, 300), now);
      const author = doc.querySelector('[class*="author"], .byline, a[href*="/search/user/"]');
      return [{
        id: 'mwb-n' + m[1], category: 'FYI', subject: title.slice(0, 200), summary: body.slice(0, 600),
        from: text(author).slice(0, 100), received: d ? new Date(d.date + 'T09:00:00').toISOString() : '', due: '', link: ORIGIN + '/news/' + m[1],
      }];
    }
    return [];
  }

  // anything else, when you press "Add this page" in the popup
  function page(doc, url, now = new Date()) {
    const main = doc.querySelector('#content, main, [role="main"]') || doc.body;
    const title = text(doc.querySelector('#content h1, main h1, h1')) || clean(doc.title) || 'myWestbourne page';
    const body = text(main).replace(title, '').trim();
    const i = body.search(/\bdue\b/i), due = i >= 0 ? findDate(body.slice(i), now) : null;
    let h = 0; for (const c of url) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return {
      id: 'mwb-p' + h.toString(36), category: due ? 'Deadline' : 'FYI', subject: title.slice(0, 200), summary: body.slice(0, 600),
      from: '', received: now.toISOString(), due: due ? due.date : '', time: due ? due.time : '', link: url.startsWith(ORIGIN + '/') ? url : '',
    };
  }

  // everything the page shows; the detail view wins over list entries
  function scan(doc, path, now = new Date()) {
    const byId = new Map();
    for (const x of [...assessments(doc, now), ...news(doc, now), ...detail(doc, path, now)]) {
      const old = byId.get(x.id);
      byId.set(x.id, old && !x.due && old.due ? { ...x, due: old.due, time: old.time } : x);
    }
    return [...byId.values()];
  }

  return { ORIGIN, findDate, assessments, news, detail, page, scan, abs, ymd };
})();
if (typeof module !== 'undefined') module.exports = MWB;
