// Lake George 70.3 dashboard: passcode gate, log storage (KV), and intervals.icu bridge to Garmin.
// Secrets (set with `npx wrangler secret put NAME`): PASSCODE, INTERVALS_API_KEY.
const enc = new TextEncoder();
const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const html = (s, status = 200) => new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const getCookie = (req, name) => { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)")); return m ? m[1] : null; };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- pages served by the Worker (login, setup and error pages, and the theme injected into History) ----------
// Same design tokens as the dashboard's :root block in lake-george-70-3-plan.html. Keep the two in step.
const THEME = `:root{--bg:#eef0f2;--card:#fff;--soft:#f6f7f8;--fg:#15191d;--muted:#4b545c;--faint:#5f6870;--line:#dde0e3;--line-strong:#b9bfc4;--accent:#1c5bb8;--accent-ink:#fff;
--swim:#0b737c;--bike:#ad460b;--run:#377020;--lift:#8a6510;--good:#1e7b4f;--warn:#8f5a00;--warn-soft:#fbf0dc;--bad:#b42318;--body:"Barlow",system-ui,sans-serif;--display:"Barlow Semi Condensed","Barlow",system-ui,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#111416;--soft:#1a1e21;--fg:#f2f4f5;--muted:#a9b2b9;--faint:#87919a;--line:#262b2f;--line-strong:#3b4248;--accent:#79aeff;--accent-ink:#00152f;
--swim:#45c3cd;--bike:#ff8c4f;--run:#8fcd62;--lift:#e3ba52;--good:#5fd394;--warn:#f2b54d;--warn-soft:#2a1e08;--bad:#ff7b6c;color-scheme:dark}}`;
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap">`;
const ICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%2315191d'/%3E%3Crect x='7' y='8' width='18' height='4' rx='2' fill='%23fff'/%3E%3Crect x='7' y='14' width='13' height='4' rx='2' fill='%23fff'/%3E%3Crect x='7' y='20' width='8' height='4' rx='2' fill='%23fff'/%3E%3C/svg%3E">`;
// One shell for every page the Worker writes itself.
const PAGE = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#eef0f2" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<title>${title}</title>${ICON}${FONTS}<style>${THEME}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:400 15px/1.5 var(--body);padding:16px}
.box{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--fg);border-radius:8px;padding:24px;display:flex;flex-direction:column;gap:12px;width:100%;max-width:360px}
.box.warn{border-left-color:var(--warn)}h1{margin:0;font:600 24px/1.1 var(--display)}p{margin:0;color:var(--muted)}
label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted)}
input{font:inherit;min-height:44px;padding:0 12px;border:1px solid var(--line-strong);border-radius:6px;background:var(--soft);color:var(--fg)}
button{font:inherit;font-weight:600;min-height:44px;border:1px solid var(--accent);border-radius:6px;background:var(--accent);color:var(--accent-ink);cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.err{color:var(--bad);font-weight:600}
details{font-size:13px}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--accent);font-weight:500}code{overflow-wrap:anywhere}
</style></head><body>${body}</body></html>`;
const LOGIN = err => PAGE("Lake George 70.3 Plan", `<form class="box" method="post" action="/login"><h1>Lake George 70.3</h1><p>Enter your passcode to open the training plan.</p>
<label>Passcode<input type="password" name="pass" id="pass" autocomplete="current-password" required autofocus></label>
${err ? `<p class="err" role="alert">${err} Check it and try again.</p>` : ""}<button type="submit">Open training plan</button></form>`);
const NOTICE = (title, text, fix) => PAGE(title, `<div class="box warn"><h1>${title}</h1><p>${text}</p>${fix ? `<details><summary>How to fix</summary><p>${fix}</p></details>` : ""}</div>`);
// History is built separately (build_dashboard.py) with its own palette. This is added to it so it shares the dashboard's colors, type and theme.
const HISTORY_THEME = `${FONTS}<style>${THEME}
:root{--border:var(--line);--hover:var(--soft);--strength:var(--lift);--squash:var(--muted);--racket:var(--bad);--other:var(--line-strong);--z1:var(--line-strong);--z2:var(--swim);--z3:var(--run);--z4:var(--warn);--z5:var(--bad)}
body{font-family:var(--body)}h1,h2,h3{font-family:var(--display);font-weight:600}button{min-height:44px}</style>`;


// Garmin + Strava both feed intervals.icu: keep the Garmin copy, drop a Strava duplicate of the same day and sport.
const kind = t => /swim/i.test(t) ? "swim" : /ride|cycl/i.test(t) ? "bike" : /run/i.test(t) ? "run" : String(t || "").toLowerCase();
function dedupe(acts) {
  // Strava-sourced rows arrive as stubs (Strava's API terms hide their details): skip them, Garmin supplies the real data.
  const list = acts.filter(a => a.start_date_local && a.type);
  const isStrava = a => String(a.source || "").toUpperCase() === "STRAVA";
  const have = new Set(list.filter(a => !isStrava(a)).map(a => a.start_date_local.slice(0, 10) + kind(a.type)));
  return list.filter(a => !isStrava(a) || !have.has(a.start_date_local.slice(0, 10) + kind(a.type)));
}

async function intervals(env, path, init = {}) {
  const r = await fetch(`https://intervals.icu/api/v1/athlete/${env.ATHLETE_ID}${path}`, {
    ...init, headers: { authorization: "Basic " + btoa("API_KEY:" + env.INTERVALS_API_KEY), "content-type": "application/json", ...(init.headers || {}) }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`intervals.icu ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const W_FIELDS = ["id", "sleepSecs", "sleepScore", "sleepQuality", "avgSleepingHR", "hrv", "hrvSDNN", "restingHR", "readiness", "ctl", "atl", "rampRate", "weight", "steps", "soreness", "fatigue", "stress"];
const A_FIELDS = ["id", "start_date_local", "type", "name", "source", "moving_time", "elapsed_time", "distance", "total_elevation_gain", "average_heartrate", "icu_average_watts", "icu_weighted_avg_watts", "icu_training_load", "icu_intensity", "trainer", "decoupling", "icu_hr_zone_times"];
const pick = (o, f) => Object.fromEntries(f.filter(k => o[k] != null).map(k => [k, o[k]]));
const ymd = d => d.toISOString().slice(0, 10);
async function refresh(env) {
  const prev = (await env.KV.get("garmin", "json")) || {};
  const now = new Date(), oldest = "2026-10-12", newest = ymd(new Date(now.getTime() + 864e5));
  try {
    const [well, acts, lib] = await Promise.all([
      intervals(env, `/wellness?oldest=2026-07-01&newest=${newest}`),
      intervals(env, `/activities?oldest=${oldest}&newest=${newest}T23:59:59`),
      prev.libAt && now - prev.libAt < 7 * 864e5 ? Promise.resolve(null) : intervals(env, `/activities?oldest=${ymd(new Date(now - 400 * 864e5))}&newest=${newest}T23:59:59`)
    ]);
    const g = {
      fetchedAt: Date.now(), error: null,
      keys: { wellness: Object.keys((well || []).find(w => w.sleepSecs || w.hrv) || (well || [])[0] || {}), activity: Object.keys((acts || [])[0] || {}) },
      stravaHidden: (acts || []).filter(a => !a.type && String(a.source || "").toUpperCase() === "STRAVA").length,
      wellness: (well || []).map(w => pick(w, W_FIELDS)),
      activities: dedupe(acts || []).sort((a, b) => a.start_date_local.localeCompare(b.start_date_local)).map(a => pick(a, A_FIELDS)),
      library: lib ? dedupe(lib).filter(a => /ride/i.test(a.type) && (a.moving_time || 0) >= 2400).map(a => pick(a, ["id", "start_date_local", "type", "name", "moving_time", "distance", "total_elevation_gain", "icu_weighted_avg_watts"])) : prev.library || [],
      libAt: lib ? Date.now() : prev.libAt
    };
    await env.KV.put("garmin", JSON.stringify(g));
    return g;
  } catch (e) {
    const g = Object.assign(prev, { error: String(e.message || e).slice(0, 300), errorAt: Date.now() });
    await env.KV.put("garmin", JSON.stringify(g));
    return g;
  }
}

// ---------- AI coach (Claude) ----------
const SPORTS = ["swim", "bike", "run", "lift", "rest"];
const COACH_TOOL = {
  name: "suggest",
  description: "Return the coaching review and any changes to the next 3 days of the plan.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "2-4 sentences: how the last days went and what matters next. Plain, direct." },
      lifts: { type: "string", description: "One or two sentences on strength progress from the lift logs, or empty." },
      changes: {
        type: "array", maxItems: 6,
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD, one of the upcoming days given" },
            slot: { type: "string", enum: ["am", "pm"] },
            sport: { type: "string", enum: SPORTS },
            minutes: { type: "integer", minimum: 0, maximum: 400 },
            details: { type: "string", description: "The new session, written like the plan: e.g. '45 min easy ≤144 bpm' or '60 min Z2 {Z2}'. Use · between parts. For lifts, list exercises separated by ·" },
            reason: { type: "string", description: "One sentence: why this change, citing the data." }
          },
          required: ["date", "slot", "sport", "minutes", "details", "reason"]
        }
      }
    },
    required: ["summary", "changes"]
  }
};
const COACH_SYSTEM = `You are the endurance coach behind a 34-week IRONMAN 70.3 Lake George plan (race June 13, 2027). The athlete is a busy student.
Each day you get: athlete settings, the last 7 days (planned sessions, what was actually done from Garmin, RPE, check-ins, wellness, lift logs, notes), and the next 3 days as planned.
Decide whether the next 3 days should change. Default to NO changes: only adjust when the data clearly calls for it (missed or swapped key sessions, poor sleep/HRV/readiness, high fatigue or extra load, soreness, lifts stalling or jumping, illness noted).
Rules: one hard session per day at most; never put a leg-heavy lift the day before the long ride; keep the long ride and long run unless fatigue is severe; keep weekly hours within about 15% of plan; a ride done instead of a run counts as aerobic work, so don't make the athlete repeat it.
This athlete's known pattern (Oct 2026 data): skips swims, rides easy days at tempo, runs easy runs at 150-170 bpm, and builds fitness too fast. The context's "habits" object scores this. Apply these rules:
- Swim is the biggest limiter. Never remove a swim to fix fatigue; cut bike or run instead. If daysSinceSwim is 4 or more, make sure one of the next 3 days has a swim (a 30 min easy technique swim is enough).
- An easy session done hard (bike normalized power above 80% of FTP, run average HR above 150, or squash) counts as a hard day. Follow it with an easy day.
- If easyShareThisWeek.pct is under 75, do not add intensity; make the next easy sessions explicitly capped (bike "stay under {Z2} ceiling", run "run-walk 4:1, walk when HR passes 144").
- If ctlRamp7d is above 5, hold or trim volume for the next 3 days; above 7, replace the next hard session with easy aerobic work.
- In Foundation (weeks 1-8) easy runs are run-walk 4 min run / 1 min walk until easy runs hold ≤144 bpm.
Mention the most important habit gap in the summary, with its number.
Weather: next[].weather gives an outdoor verdict per bike/run session from the National Weather Service forecast ("go", "caution", "indoor") with reasons. For "indoor", keep the session's purpose but move it to the trainer or treadmill (shorten a long outdoor ride to a trainer-length version, e.g. 75-90 min at the same intent) or swap it with an indoor-friendly day; never schedule an outdoor-only session (long ride, brick) into an indoor verdict. "caution" needs no change unless the session is hard and the reason is wind, rain or ice.
Keep the plan's notation: {Z2} {TEMPO} {SS} {RP} {CSS} {GP} tokens are filled with the athlete's zones; easy runs are "≤144 bpm". Only change sessions on the upcoming dates given. Each change replaces that whole slot. Use sport "rest" to remove a session.
Always answer by calling the suggest tool exactly once (with an empty changes list when the plan should stand). Do not reply with plain text.`;
// Added to the system prompt when the athlete types what they're doing instead ("Doing something different?" on Today).
const ASK_RULES = `

This time the athlete sent a request in "request": { text, date }. In their own words they say what they are doing instead or what changed (time, place, equipment, friends, weather, how they feel). The request overrides "default to no changes":
- Change the session(s) on request.date so the day fits what they described. If they said exactly what they'll do, write that as the session with targets (zones, HR caps, duration) that keep it useful for the race. If they only gave a constraint ("only 30 min", "no pool"), pick the best workout that fits it.
- Then change later days only if the week needs it: a hard effort today makes tomorrow's hard session easy; a dropped swim comes back later in the week.
- All rules above still apply. If what they describe is unsafe (pain, illness, a second hard day in a row), say so in summary and suggest the safer version instead.
- summary: answer the athlete directly about their request in 1-3 sentences. lifts: empty.`;

async function anthropic(env, model, body) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, ...body })
  });
}
async function coach(env, ctx) {
  const body = { max_tokens: 4000, system: COACH_SYSTEM + (ctx.request ? ASK_RULES : ""), tools: [COACH_TOOL], tool_choice: { type: "auto" },
    messages: [{ role: "user", content: JSON.stringify(ctx) }] };
  // A failure of the Claude request itself (network error or a non-2xx answer) is marked refundable: it gives the daily count back.
  // Anything that goes wrong after a successful Claude response still counts.
  const refundable = msg => Object.assign(new Error(String(msg).slice(0, 240)), { refund: true });
  let model = env.COACH_MODEL || "claude-sonnet-5-5", r;
  try {
    r = await anthropic(env, model, body);
    if (r.status === 404) { // model retired: fall back to the newest Sonnet the key can use
      const list = await (await fetch("https://api.anthropic.com/v1/models?limit=50", { headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } })).json();
      const alt = (list.data || []).find(m => /sonnet/.test(m.id));
      if (alt) { model = alt.id; r = await anthropic(env, model, body); }
    }
  } catch (e) { throw refundable("Claude request failed: " + (e.message || e)); }
  if (!r.ok) { let msg = ""; try { msg = ((await r.json()).error || {}).message || ""; } catch (e) {} throw refundable(`Claude ${r.status}: ${msg}`); }
  const j = await r.json();
  const tool = (j.content || []).find(c => c.type === "tool_use");
  let out = tool ? tool.input : null;
  if (!out) { // model answered in text: take the JSON object from it
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n"), m = text.match(/\{[\s\S]*\}/);
    try { out = m ? JSON.parse(m[0]) : null; } catch (e) { out = null; }
    if (!out) throw new Error("Claude didn't return a review. Try again.");
  }
  const dates = new Set((ctx.next || []).map(d => d.date));
  const changes = (Array.isArray(out.changes) ? out.changes : []).filter(c => c && dates.has(c.date) && ["am", "pm"].includes(c.slot) && SPORTS.includes(c.sport))
    .slice(0, 6).map(c => ({ date: c.date, slot: c.slot, sport: c.sport, minutes: Math.max(0, Math.min(400, Math.round(+c.minutes || 0))),
      details: String(c.details || "").slice(0, 400), reason: String(c.reason || "").slice(0, 300) }));
  return { forDate: ctx.today, createdAt: Date.now(), model, summary: String(out.summary || "").slice(0, 1200), lifts: String(out.lifts || "").slice(0, 600), changes };
}

// ---------- weather (National Weather Service: US only, no key) ----------
// /api/weather?lat=&lon= returns hourly conditions for the next ~7 days plus active NWS alerts for that point,
// in the units the dashboard shows (°F, mph, inches). Cached in KV for 20 minutes per location (2 decimals ≈ 1 km).
const NWS = "https://api.weather.gov", NWS_UA = { "user-agent": "lake-george-703-plan (personal training dashboard)", accept: "application/geo+json" };
const isoDur = d => { const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d) || []; return ((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600e3 + (+m[3] || 0) * 60e3; };
// NWS grid values cover intervals ("2026-11-16T07:00:00+00:00/PT2H"); spread each over its hours.
// Amounts (precipitation, ice, snow) are split evenly across the hours; levels (temperature, wind) repeat.
function hourly(prop, start, n, conv, amount) {
  const out = new Array(n).fill(null);
  for (const v of (prop && prop.values) || []) {
    const [t, d] = v.validTime.split("/"), t0 = Date.parse(t), hrs = Math.max(1, Math.round(isoDur(d) / 3600e3));
    for (let h = 0; h < hrs; h++) { const i = Math.round((t0 - start) / 3600e3) + h; if (i >= 0 && i < n && v.value != null) out[i] = conv(amount ? v.value / hrs : v.value); }
  }
  return out;
}
async function nws(path) {
  const r = await fetch(path.startsWith("http") ? path : NWS + path, { headers: NWS_UA });
  if (!r.ok) throw Object.assign(new Error(`NWS ${r.status}`), { status: r.status });
  return r.json();
}
async function weather(env, lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`, cached = await env.KV.get("wx:" + key, "json");
  if (cached && Date.now() - cached.fetchedAt < 20 * 60e3) return cached;
  let pt = await env.KV.get("wxpt:" + key, "json"); // the forecast grid for a point never changes; look it up once
  if (!pt) {
    let p;
    try { p = (await nws(`/points/${key}`)).properties; }
    catch (e) { if (e.status === 404 || e.status === 400) return { error: "outside_us", fetchedAt: Date.now() }; throw e; }
    pt = { grid: p.forecastGridData, name: p.relativeLocation ? `${p.relativeLocation.properties.city}, ${p.relativeLocation.properties.state}` : key };
    await env.KV.put("wxpt:" + key, JSON.stringify(pt));
  }
  const [grid, al] = await Promise.all([nws(pt.grid), nws(`/alerts/active?point=${key}`).catch(() => ({ features: [] }))]);
  const g = grid.properties, start = Math.ceil(Date.parse(g.validTimes.split("/")[0]) / 3600e3) * 3600e3, n = 24 * 8;
  const F = c => Math.round(c * 9 / 5 + 32), MPH = k => Math.round(k / 1.609344), IN = mm => Math.round(mm / 25.4 * 1000) / 1000;
  const wx = new Array(n).fill(null).map(() => []);
  for (const v of (g.weather && g.weather.values) || []) {
    const [t, d] = v.validTime.split("/"), i0 = Math.round((Date.parse(t) - start) / 3600e3), hrs = Math.max(1, Math.round(isoDur(d) / 3600e3));
    const kinds = (v.value || []).filter(w => w && w.weather).map(w => (w.intensity && w.intensity !== "none" ? w.intensity + " " : "") + w.weather);
    for (let h = 0; h < hrs; h++) if (i0 + h >= 0 && i0 + h < n) wx[i0 + h].push(...kinds);
  }
  const out = {
    fetchedAt: Date.now(), updated: g.updateTime, place: { lat, lon, name: pt.name }, start,
    temp: hourly(g.temperature, start, n, F), feels: hourly(g.apparentTemperature, start, n, F),
    wind: hourly(g.windSpeed, start, n, MPH), gust: hourly(g.windGust, start, n, MPH), pop: hourly(g.probabilityOfPrecipitation, start, n, Math.round),
    rain: hourly(g.quantitativePrecipitation, start, n, IN, true), ice: hourly(g.iceAccumulation, start, n, IN, true), snow: hourly(g.snowfallAmount, start, n, IN, true), wx,
    alerts: (al.features || []).map(f => f.properties).filter(Boolean).map(a => ({ event: a.event, severity: a.severity, headline: a.headline, onset: a.onset || a.effective, ends: a.ends || a.expires }))
  };
  await env.KV.put("wx:" + key, JSON.stringify(out), { expirationTtl: 3600 });
  return out;
}

export default {
  async scheduled(event, env, ctx) { if (env.INTERVALS_API_KEY) ctx.waitUntil(refresh(env)); },

  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    if (!env.PASSCODE) return html(NOTICE("The site isn't set up yet", "It has no passcode, so it can't open.", "In <code>~/Desktop/Training</code> run <code>npx wrangler secret put PASSCODE</code>, choose a passcode, then reload."), 503);
    const token = await sha("lg703:" + env.PASSCODE);

    if (p === "/login" && req.method === "POST") {
      const f = await req.formData();
      if (f.get("pass") === env.PASSCODE)
        return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `lg703=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` } });
      await new Promise(r => setTimeout(r, 800));
      return html(LOGIN("Wrong passcode."), 401);
    }
    if (p === "/logout") return new Response(null, { status: 303, headers: { location: "/", "set-cookie": "lg703=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
    if (getCookie(req, "lg703") !== token) return p.startsWith("/api/") ? json({ error: "locked" }, 401) : html(LOGIN(""), 401);
    if (p === "/history.html") {
      const h = await env.KV.get("history");
      return h ? html(h.replace("</head>", HISTORY_THEME + "</head>")) : html(NOTICE("No history uploaded yet", "Your Garmin history page hasn't been sent to the site.", "On your Mac, run <code>./deploy.sh</code> in <code>~/Desktop/Training</code>. It uploads <code>training-dashboard.html</code> along with the site."), 404);
    }
    if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);

    try {
      if (p === "/api/state" && req.method === "GET")
        return json({ logs: (await env.KV.get("logs", "json")) || {}, settings: await env.KV.get("settings", "json") });

      const day = p.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})$/);
      if (day && req.method === "PUT") {
        const body = await req.json();
        if (typeof body !== "object" || Array.isArray(body) || JSON.stringify(body).length > 20000) return json({ error: "bad_body" }, 400);
        const logs = (await env.KV.get("logs", "json")) || {};
        logs[day[1]] = body;
        await env.KV.put("logs", JSON.stringify(logs));
        return json({ ok: true });
      }
      if (p === "/api/settings" && req.method === "PUT") {
        const body = await req.json();
        if (typeof body !== "object" || JSON.stringify(body).length > 20000) return json({ error: "bad_body" }, 400);
        await env.KV.put("settings", JSON.stringify(body));
        return json({ ok: true });
      }

      // Coach and weather routes come before the Garmin key check: they need the Claude key or nothing, not the intervals.icu one.
      if (p === "/api/weather" && req.method === "GET") {
        const lat = +url.searchParams.get("lat"), lon = +url.searchParams.get("lon");
        if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || !url.searchParams.get("lat") || !url.searchParams.get("lon")) return json({ error: "bad_location" }, 400);
        return json(await weather(env, Math.round(lat * 100) / 100, Math.round(lon * 100) / 100));
      }
      if (p === "/api/coach" && req.method === "GET") return json((await env.KV.get("coach", "json")) || {});
      if (p === "/api/coach" && req.method === "POST") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "no_ai_key" }, 503);
        const raw = await req.text();
        if (raw.length > 80000) return json({ error: "bad_body" }, 400);
        const ctx = JSON.parse(raw);
        if (!ctx || !/^\d{4}-\d{2}-\d{2}$/.test(ctx.today) || !Array.isArray(ctx.next)) return json({ error: "bad_body" }, 400);
        // A typed request ("Doing something different?") has its own daily cap and doesn't replace the stored daily review.
        const rq = ctx.request;
        if (rq != null && (typeof rq.text !== "string" || !rq.text.trim() || rq.text.length > 500 || !ctx.next.some(d => d && d.date === rq.date))) return json({ error: "bad_body" }, 400);
        const countKey = rq ? "askCount" : "coachCount", cap = rq ? 15 : 8;
        const n = (await env.KV.get(countKey, "json")) || {};
        const used = n.date === ctx.today ? n.count : 0;
        if (used >= cap) return json({ error: "daily_limit" }, 429);
        await env.KV.put(countKey, JSON.stringify({ date: ctx.today, count: used + 1 }));
        let c;
        try { c = await coach(env, ctx); }
        catch (e) { // the cap stays put; only a failed Claude request gives its count back
          if (e && e.refund) await env.KV.put(countKey, JSON.stringify({ date: ctx.today, count: used }));
          throw e;
        }
        if (!rq) await env.KV.put("coach", JSON.stringify(c));
        return json(c);
      }

      if (!env.INTERVALS_API_KEY) return json({ error: "no_key" }, 503);

      if (p === "/api/garmin" && req.method === "GET") {
        let g = await env.KV.get("garmin", "json");
        if (!g || url.searchParams.get("refresh") === "1" || Date.now() - (g.fetchedAt || 0) > 15 * 60e3) g = await refresh(env);
        return json(g);
      }

      if (p === "/api/push" && req.method === "POST") {
        const { events } = await req.json();
        if (!Array.isArray(events) || !events.length || events.length > 100) return json({ error: "bad_events" }, 400);
        const clean = events.filter(e => typeof e.external_id === "string" && e.external_id.startsWith("lg703-") && e.category === "WORKOUT")
          .map(e => ({ category: "WORKOUT", start_date_local: String(e.start_date_local), type: String(e.type), name: String(e.name).slice(0, 120),
            description: String(e.description).slice(0, 4000), moving_time: +e.moving_time || 0, external_id: e.external_id }));
        const res = await intervals(env, "/events/bulk?upsert=true", { method: "POST", body: JSON.stringify(clean) });
        return json({ ok: true, count: Array.isArray(res) ? res.length : clean.length });
      }
      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: "upstream", detail: String(e.message || e).slice(0, 240) }, 502);
    }
  }
};
