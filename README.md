# Lake George 70.3 training dashboard

Daily plan, check-in, logging and progress for IRONMAN 70.3 Lake George (June 13, 2027).

- `lake-george-70-3-plan.html` – the dashboard (plan data, UI, all logic)
- `src/index.js` – Cloudflare Worker: passcode gate, log storage (KV), intervals.icu sync for Garmin data, workout push, AI coach (`/api/coach`, Claude)
- `wrangler.jsonc` – Worker config (static assets, KV, 20-min sync cron)
- `deploy.sh` – builds `site/` (adds the history dashboard) and deploys

Secrets live in Cloudflare, never in this repo: `PASSCODE`, `INTERVALS_API_KEY`, `ANTHROPIC_API_KEY` (coach; `npx wrangler secret put ANTHROPIC_API_KEY`). Optional var `COACH_MODEL` overrides the default `claude-sonnet-5-5`.

- **Strength log:** all lifts use free weights (dumbbells, barbell, bodyweight; no cables or machines). Each superset exercise has a weight + reps field. The next target comes from the last log (3×8–12; all sets ≥12 → +5 lb, any set <8 → −5 lb; bodyweight moves add a rep). Moves that only gained “DB” in their name keep their earlier logs (`LIFT_WAS`). Replaced moves (cable row → DB row, and so on) start fresh, because the loads differ.
- **Weather:** `/api/weather` (Worker) fetches the National Weather Service hourly grid and active alerts for the dashboard's location (Middlebury by default; “Use my location” saves another one on this device). It caches them in KV for 20 minutes. US locations only; no key needed.
  - **Verdicts:** each bike or run session gets one for its own time window (slot time + duration): ride or run outside, outside with care, or indoors. Each comes with up to three reasons and what to wear. The rules are in `wxVerdict()`. They cover storms, ice, wind chill, cold rain, gusts, heat, darkness from computed sunrise/sunset, and NWS alerts.
  - **Where they show:** official alerts appear above the sessions. Week shows a badge on each upcoming outdoor session.
  - **Coach:** “Ask coach for an indoor version” fills the Doing-something-different box. The daily coach review also receives the verdicts.
- **Coached workout library (sessions from Nov 17, 2026):** `upgrade()` rebuilds each swim, bike, run and brick as an explicit structured workout (`s.build`).
  - **What stays the same:** the session's day, length and hard/easy role. Days before Nov 17, tests, open-water sessions, rehearsals, race week, Foundation run-walks and strength are left as written.
  - **Swim:** Swim Smooth's weekly three. Technique rotates its focus weekly (alignment, rotation and breathing, catch, timing), and each drill goes straight into freestyle. Endurance is “red mist” reps at CSS +5 s with short rests, plus a pull-and-paddles set breathing 3/5/7 in Build. CSS is 100s in Foundation, “Goldilocks” in Base, and 200s plus speed in Build. Race-pace sessions are 50 m surges settling into race pace with sighting. Sets are sized for 2:30/100 m CSS and filled with relaxed 100s.
  - **Bike:** quality sessions keep the plan's interval set but add spin-ups. In Base, alternate weeks do the same watts at low cadence (60–70 rpm). In Build, weeks 22 and 26 are 8×5 min at threshold. Easy rides get cadence and single-leg drills. Long rides add cadence blocks, Base long rides step up to race power at the end, and race-specific long rides alternate low-cadence and race-power blocks.
  - **Run:** easy runs open with 10 min slower than easy and end with strides, or hill sprints in odd Base weeks. Quality runs get drills and strides first; week 23 is tempo + hills. Brick runs start with 5 min of quick steps; goal-pace bricks are 1-mile repeats.
  - **Sources:** Swim Smooth (Paul Newsome); Triathlete (Alison Freeman, Andrew Sheaff, Lance Watson); TrainingPeaks (Matt Fitzgerald, 80/20); IRONMAN's 16-week 70.3 guide.
  - **Checked against the previous plan:** 0 past sessions changed, 0 hard/easy flips, 0 length changes. Bike/run planned load: median 1.00× the old session (range 0.88–1.16). Swims fill 90–104% of their slot.
- **Substitutions:** a ride on a run day (or run on a ride day) counts that session as done and adds to bike/run hours by what you actually did.
- **Coach:** on the first visit each day the page sends the last 7 days + next 4 days to `/api/coach`; Claude suggests changes, which only apply after you tap Accept (stored in `settings.ovr`, Undo restores the plan). Max 8 reviews a day.
- **Doing something different?** The box at the top of Today sends what you typed, plus the same context as the daily review, to `/api/coach` as `request: { text, date }` for the day on screen. Claude replans that day (and later days if the week needs it). Changes apply only after Accept. If one replaces an earlier accepted change, Undo goes back to that earlier change. Requests have their own cap (15 a day, `askCount`) and don't replace the stored daily review.
- **Structured workouts:** `structOf(session)` turns each session's plan text into steps (time or distance, intensity, target). The same model draws the profile on each card, fills the step table (watts from FTP, ≤144 bpm or goal pace for runs, pace per 100 m from CSS for swims), sets the planned load, and writes the intervals.icu workout text sent to the watch (`docOf`). If a swim or run set takes much longer than its slot at your current CSS or goal pace, the card says so.
- **Compliance:** each done or missed session gets a TrainingPeaks-style grade (`compliance`). Green: duration within 20% of plan. Yellow: 20–50% off, swapped, a load far from plan, or the wrong intensity. Red: more than 50% off, or missed. Today shows duration, load, power or heart rate, decoupling and time in HR zones. Week shows a grade on each session and a weekly tally. The Worker passes intervals.icu's `decoupling` and `icu_hr_zone_times` through for this.

## Design refinement loop

`dev/tools/refine.mjs` runs one round of the loop: screenshot every view, audit it, compare, fix, then run it again.

```sh
cd dev && node tools/server3.mjs ../lake-george-70-3-plan.html mockdata ../training-dashboard.html 8802 50 &   # mock Worker with test data
cd tools && node refine.mjs ../shots/refine/r5                                                             # one round
```

- **What it checks:** Today, a completed day, Week, Progress (all sections open) and Guide, each at 390 px and 1280 px, in light and dark mode. Per view: axe-core (WCAG 2.2 AA, including contrast), tap targets under 44 px, text under 12 px, clipped text, horizontal overflow, heading-level jumps, and console errors. For the whole round: how many font sizes, weights and text colors are in use.
- **Output:** full-page and first-screen screenshots, `scorecard.md`, and `scorecard.json`.
- **Each round:** read the scorecard and the screenshots, fix the highest-impact problems, then run the next round into a new folder so the rounds can be compared.
- **When to stop:** the scorecard reads `issues 0` and a visual review finds nothing high or medium.

## Motion

The motion follows two skills from the open skills ecosystem:
- **design-motion-principles** (kylezantos): Emil Kowalski's restraint first, Jakub Krehel's polish second.
- **fixing-motion-performance** (ibelick): what may animate, and how cheaply.

**Rules:**
- **What animates:** only changes of place. Tab, day and week changes, and accepting or undoing a coach change, run inside a view transition (`flow()`).
  - The view you leave fades out in 100 ms.
  - The new view arrives from the side you moved toward in 220 ms.
  - What persists doesn't flash: the tab underline and the selected-day pill glide, and the header and date row stay put.
- **New content:** a coach reply, a session's review after you tick Done, or a section you open by tapping fades up once (`reveal()`).
- **Progress:** one entrance moment. The 5:00 bars grow the first time you open the tab.
- **Never animated:** keyboard-driven changes, back/forward, typing, chart scrubbing, opening and closing sections (height), and anything when the device asks for reduced motion.
- **Never used:** loops, count-ups, or staggered lists.
- **What may move:** only transform and opacity; the small data bars are the exception. All easing uses the custom curves in `--ease-out` and `--ease-in`.

`dev/tools/motion-test.mjs` checks every navigation. For each one it lists the animations that actually ran, with their duration and the properties they change, and saves paused frames at 0, 40 and 75% of the motion. It also checks that reduced motion runs nothing and that no infinite animation exists.
