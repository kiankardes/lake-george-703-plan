# Lake George 70.3 training dashboard

Daily plan, check-in, logging and progress for IRONMAN 70.3 Lake George (June 13, 2027).

- `lake-george-70-3-plan.html` – the dashboard (plan data, UI, all logic)
- `src/index.js` – Cloudflare Worker: passcode gate, log storage (KV), intervals.icu sync for Garmin data, workout push, AI coach (`/api/coach`, Claude)
- `wrangler.jsonc` – Worker config (static assets, KV, 20-min sync cron)
- `deploy.sh` – builds `site/` (adds the history dashboard) and deploys

Secrets live in Cloudflare, never in this repo: `PASSCODE`, `INTERVALS_API_KEY`, `ANTHROPIC_API_KEY` (coach; `npx wrangler secret put ANTHROPIC_API_KEY`). Optional var `COACH_MODEL` overrides the default `claude-sonnet-5-5`.

- **Strength log:** lift sessions show each superset exercise with a weight + reps field. The next target comes from the last log (3×8–12; all sets ≥12 → +5 lb, any set <8 → −5 lb; bodyweight moves add a rep).
- **Substitutions:** a ride on a run day (or run on a ride day) counts that session as done and adds to bike/run hours by what you actually did.
- **Coach:** on the first visit each day the page sends the last 7 days + next 4 days to `/api/coach`; Claude suggests changes, which only apply after you tap Accept (stored in `settings.ovr`, Undo restores the plan). Max 8 reviews a day.
