# Life Planner Connector

A Chrome extension that reads your school work and training from the sites you
already use, while you're logged in, and sends it into your Life Planner:

| Site | What comes across | Where it lands in the planner |
| --- | --- | --- |
| myWestbourne (my.westbourne.vic.edu.au) | Due work, assessments, news posts | **Missed info**; dated SACs and work are added as assessments or tasks |
| Microsoft Teams | Assignments that aren't handed in yet | **Missed info**; added as assessments or tasks |
| Strava (strava.com) | Your recent activities | Workouts in your training plan |
| Garmin Connect (connect.garmin.com) | Your recent activities | Workouts in your training plan |
| Garmin Connect (connect.garmin.com) | Sleep, steps, resting heart rate, body battery | The **Health & sleep** tab |

It never sees your passwords and only ever sends to the planner on your own
computer (`http://127.0.0.1:47823`). If the planner isn't open, it keeps
everything and sends it the next time the planner is running (it tries every
5 minutes).

You need **Life Planner 2.10** for myWestbourne, and the version after 2.10 for
Teams, Strava, Garmin and Health & sleep.

## How each site works

- **myWestbourne**: every page you open is read for assessments and news, and
  every 30 minutes it also loads Due Work, the homepage and News by itself.
- **Strava and Garmin**: open strava.com or connect.garmin.com (any page) and it
  asks for your latest activities by itself, at most every 30 minutes. On
  Garmin it also reads the last few days of sleep and daily summaries. Opening
  your activity list on either site also works.
- **Teams**: open the **Assignments** tab in Teams on the web
  (teams.microsoft.com) and the list it shows comes across. The Teams desktop
  app can't run Chrome extensions, so use Teams in Chrome.
- **No doubles**: an activity that's on both Strava and Garmin (or also comes in
  through intervals.icu) only becomes one workout: anything starting within 10
  minutes of one already in your plan is skipped. A SAC that's in both your
  email and myWestbourne or Teams is only added once too.

The popup (click the extension's icon) shows whether the planner is connected,
what's coming up, and how many activities it has. Its buttons:

- **Check this site now**: re-reads the site you're on straight away.
- **Add this page**: sends the myWestbourne page you're looking at, for
  anything the extension doesn't pick up by itself.
- **Send to planner**: sends everything again.

## Install it in Chrome

1. Put this folder somewhere it can stay, for example
   `Documents\LifePlanner\life-planner-connector`. Chrome loads it from there
   every time, so don't delete or move it.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose this folder (the one with
   `manifest.json` in it).
5. Click the puzzle-piece icon in Chrome's toolbar and pin
   "Life Planner Connector".
6. Open Life Planner, then open myWestbourne, Strava, Garmin Connect or Teams
   and log in. Click the extension's icon: it should say "Connected to Life
   Planner".

To update it after the files change: replace the files in the folder, go to
`chrome://extensions` and click the circular reload arrow on the extension's
card.

## Files

| File | What it is |
| --- | --- |
| `manifest.json` | Tells Chrome what the extension is and which sites it may use |
| `parse.js`, `content.js` | Read myWestbourne pages into due work and news |
| `hook.js` | Inside Strava, Garmin and Teams pages, passes on a copy of the activity and assignment lists those sites load |
| `sites.js` | Turns those lists into activities and assignments, and asks Strava and Garmin for new ones |
| `background.js` | Keeps everything and sends it to the planner |
| `popup.html`, `popup.js`, `popup.css` | The little window you see when you click the icon |
