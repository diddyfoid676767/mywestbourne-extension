const { JSDOM } = require('jsdom');
const MWB = require('../parse.js');
const now = new Date(2026, 9, 23, 14, 0);
const doc = h => new JSDOM(h).window.document;
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)); process.exitCode = 1; } else console.log('ok', m); };
eq(MWB.findDate('Due: Monday, 26 October 2026 11:59 PM', now), { date: '2026-10-26', time: '23:59' }, 'long date');
eq(MWB.findDate('Due Mon 26 Oct', now), { date: '2026-10-26', time: '' }, 'no year');
eq(MWB.findDate('due 15 Jan', now), { date: '2027-01-15', time: '' }, 'next year');
eq(MWB.findDate('October 30, 2026 at 3:30pm', now), { date: '2026-10-30', time: '15:30' }, 'US order');
eq(MWB.findDate('3/11/2026 9:00', now), { date: '2026-11-03', time: '09:00' }, 'dd/mm');
eq(MWB.findDate('Due tomorrow', now), { date: '2026-10-24', time: '' }, 'tomorrow');
eq(MWB.findDate('nothing here', now), null, 'none');
const d = doc(`<div id="content"><ul>
 <li class="card"><h3><a href="/learning/assessments/4411">Ecosystems SAC</a></h3><a href="/homepage/123">12BIO1A - Biology 3&amp;4</a><time datetime="2026-10-26T09:10:00+11:00">Mon 26 Oct</time></li>
 <li class="card"><h3><a href="/learning/assessments/4412">Unit 4 Outcome 2 essay</a></h3><span>11ENG2B - English 3&amp;4</span> <span>Due: 30/10/2026 11:59pm</span> <a href="/learning/assessments/4412">View</a></li>
</ul>
<div><a href="/news/990">Everest expedition: key dates</a><p>Posted 22 Oct 2026 by Nikki Little</p></div></div>`);
const a = MWB.assessments(d, now);
eq(a.map(x => [x.id, x.subject, x.due, x.time, x.from]), [['mwb-a4411', 'Ecosystems SAC', '2026-10-26', '09:10', '12BIO1A - Biology 3&4'], ['mwb-a4412', 'Unit 4 Outcome 2 essay', '2026-10-30', '23:59', '11ENG2B - English 3&4']], 'assessments');
const n = MWB.news(d, now);
eq(n.map(x => [x.id, x.subject, x.received.slice(0, 10)]), [['mwb-n990', 'Everest expedition: key dates', '2026-10-21']], 'news');
const det = MWB.detail(doc(`<div id="content"><h1>Ecosystems SAC</h1><p>12BIO1A - Biology 3&amp;4</p><dl><dt>Due</dt><dd>Monday 26 October 2026, 9:10am</dd></dl><p>Bring a calculator.</p></div>`), '/learning/assessments/4411', now);
eq([det[0].due, det[0].time, det[0].from], ['2026-10-26', '09:10', '12BIO1A - Biology 3&4'], 'detail');
