# Kian's Lake George 70.3 training dashboard

Personal fork of [Noah's original Lake George 70.3 dashboard](https://github.com/noahlazar31/lake-george-703-plan), targeting **June 13, 2027**.

This fork is **not yet deployed**. Changes are proposed on a development branch and require review/merge. Obtain Noah's permission before independently hosting his work; no explicit license was present in the original repository at the time of review.

## What is customized

- A **single-athlete, passcode-protected dashboard** rather than the original friend's invite flow.
- Initial **return-to-training block**, intentionally limited and symptom-led; no maximal FTP test, hard efforts, heavy lower-body lifting or squash on the initial recovery weeks.
- **December–January:** three strength sessions, three swims, Monday long Z2 bike, Friday structured bike, two runs, optional weekend easy bike, Wednesday squash.
- **February–March:** progressive bike development alongside swimming, two runs and three strength sessions.
- **April–May:** longer race-specific bikes, three swims, two maintenance lifts and structured running; weekend easy ride remains flexible.
- Final taper and race week.
- Explicit strength workouts using the athlete's preferred Tuesday Pull/Legs, Thursday Push/Legs and weekend Upper split.
- Real training targets remain adjustable via the secure setup; **300 W FTP is an untested estimate**. A proper test is deferred until fully recovered.
- The existing Garmin integration via **intervals.icu**, automated 20-minute refresh, workout diary, weather and optional AI coaching remain available.

The source code cannot determine clinical clearance for physical activity. The return-to-sport phase is **not a medical prescription** and should not progress when symptoms increase.

## Safe deployment to your own Cloudflare account

The fork previously contained **Noah's Cloudflare Worker name, KV namespace identifiers and automatic deployment settings**. Those have been removed from this development branch. Do **not** deploy using the original repository's KV namespaces or secrets.

1. Make sure your fork is authorized for independent hosting.
2. Merge the personalized changes after reviewing the pull request.
3. Create your own Cloudflare account and a **Workers KV namespace**. Copy its namespace ID into the sole `KV` binding in `wrangler.jsonc`. The placeholder intentionally prevents a successful deploy before your own storage is configured.
4. Add Worker secrets using the Cloudflare dashboard or Wrangler:
   - `PASSCODE`: a unique site passcode; never commit it.
   - `DATA_KEY`: base64 encoding of 32 random bytes (required for encrypted intervals.icu/AI keys).
5. Configure GitHub repository Actions secrets `CLOUDFLARE_API_TOKEN` (scoped to Workers/Workers KV deployment) and `CLOUDFLARE_ACCOUNT_ID`.
6. From GitHub Actions choose **Deploy Kian Training Site to Cloudflare** → **Run workflow**. The workflow is intentionally **manual-only** so the fork cannot accidentally deploy on a push.
7. The new Worker URL will be shown by Cloudflare. Sign in with the passcode.
8. On the site's secure Setup page, create/connect your intervals.icu account, grant Garmin access there, and enter the **intervals.icu** Athlete ID and API key **in the website's protected form**, not ChatGPT or GitHub.
9. Review the imported athlete metrics. Complete the race settings; entering a manually guessed value does not make it a tested FTP.
10. Verify Garmin data and workout logging work before relying on the dashboard.

### Privacy

- The GitHub fork is currently **public**. Never commit keys, Garmin exports, medical records or personal wellness histories.
- Garmin/intervals.icu credentials are encrypted using `DATA_KEY` and stored on **your** Cloudflare KV namespace.
- Protect your passcode and Cloudflare/GitHub credentials. Treat wellness and GPS tracks as sensitive.
- The original friends website stores your earlier activity/log data separately; this new dashboard **does not automatically migrate those original site logs**. Garmin history that is retrievable via intervals.icu can sync to the new instance.

### Testing

The main HTML client code and Worker were parsed for JavaScript syntax using the connected GitHub source after customization. The 30-week personalized schedule was generated and checked for phase counts and daily workout roles. **End-to-end deployment, Cloudflare secrets, Garmin authentication, login, and mobile-browser behavior are untested until a private Cloudflare environment is configured.**

## Development

```sh
./build.sh
npx wrangler deploy
```

This deploy command will fail until `wrangler.jsonc` has your KV namespace and the required secrets are configured. Use the manual GitHub Actions workflow to deploy once secrets are in place.

**Important:** the source remains upstream-derived and a change to upstream may require integration work. We have deliberately not changed the upstream repository or Noah's live deployment.
