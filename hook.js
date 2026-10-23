'use strict';
/* Runs inside Strava, Garmin Connect and Teams pages (the page's own world) and
   passes a copy of the activity and assignment lists those sites load for
   themselves to sites.js. That way it works however the site logs you in.
   Nothing is changed or sent anywhere else. */
(() => {
  const WANT = /activitylist-service|training_activities|assignments|\/edu\/|wellness-service|usersummary-service/i;
  const pass = (url, data) => { try { window.postMessage({ __lpc: 1, url: String(url), data }, location.origin); } catch { } };
  const of = fetch;
  window.fetch = async function (input, init) {
    const res = await of.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (WANT.test(url || '') && /json|javascript/i.test(res.headers.get('content-type') || '')) res.clone().json().then(d => pass(url, d), () => { });
    } catch { }
    return res;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (WANT.test(String(url))) this.addEventListener('load', () => {
      try { pass(url, this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch { }
    });
    return open.apply(this, arguments);
  };
})();
