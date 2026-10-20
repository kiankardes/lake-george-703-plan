# Lake George 70.3 training dashboard

Daily plan, check-in, logging and progress for IRONMAN 70.3 Lake George (June 13, 2027).

- `lake-george-70-3-plan.html` – the dashboard (plan data, UI, all logic)
- `src/index.js` – Cloudflare Worker: passcode gate, log storage (KV), intervals.icu sync for Garmin data, workout push
- `wrangler.jsonc` – Worker config (static assets, KV, 20-min sync cron)
- `deploy.sh` – builds `site/` (adds the history dashboard) and deploys

Secrets live in Cloudflare, never in this repo: `PASSCODE`, `INTERVALS_API_KEY`.
