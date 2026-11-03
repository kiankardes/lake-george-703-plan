// Lake George 70.3 dashboard: passcode gate, log storage (KV), and intervals.icu bridge to Garmin.
// Secrets (set with `npx wrangler secret put NAME`): PASSCODE, INTERVALS_API_KEY.
const enc = new TextEncoder();
const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const html = (s, status = 200) => new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const getCookie = (req, name) => { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)")); return m ? m[1] : null; };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const LOGIN = err => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lake George 70.3 Plan</title><style>
:root{--bg:#f3f6f6;--card:#fff;--fg:#17211f;--muted:#5b6a67;--line:#d9e0df;--accent:#1d5f6e;--bad:#b3372b}
@media (prefers-color-scheme:dark){:root{--bg:#0f1615;--card:#172120;--fg:#e3ebe9;--muted:#93a4a0;--line:#2a3735;--accent:#6bb8c6;--bad:#ec7b6f;color-scheme:dark}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
form{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:24px;display:flex;flex-direction:column;gap:12px;width:100%;max-width:340px}
h1{margin:0;font-size:22px;text-transform:uppercase;letter-spacing:.02em}p{margin:0;color:var(--muted);font-size:13px}
input{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button{font:inherit;font-weight:600;padding:9px;border:0;border-radius:6px;background:var(--accent);color:var(--card);cursor:pointer}.err{color:var(--bad)}
</style></head><body><form method="post" action="/login"><h1>Lake George 70.3</h1><p>Enter your passcode to open the dashboard.</p>
<input type="password" name="pass" id="pass" autocomplete="current-password" required autofocus aria-label="Passcode">
${err ? `<p class="err">${err}</p>` : ""}<button type="submit">Open</button></form></body></html>`;


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
const A_FIELDS = ["id", "start_date_local", "type", "name", "source", "moving_time", "elapsed_time", "distance", "total_elevation_gain", "average_heartrate", "icu_average_watts", "icu_weighted_avg_watts", "icu_training_load", "icu_intensity", "trainer"];
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
Keep the plan's notation: {Z2} {TEMPO} {SS} {RP} {CSS} {GP} tokens are filled with the athlete's zones; easy runs are "≤144 bpm". Only change sessions on the upcoming dates given. Each change replaces that whole slot. Use sport "rest" to remove a session.
Always answer by calling the suggest tool exactly once (with an empty changes list when the plan should stand). Do not reply with plain text.`;

async function anthropic(env, model, body) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, ...body })
  });
}
async function coach(env, ctx) {
  const body = { max_tokens: 4000, system: COACH_SYSTEM, tools: [COACH_TOOL], tool_choice: { type: "auto" },
    messages: [{ role: "user", content: JSON.stringify(ctx) }] };
  let model = env.COACH_MODEL || "claude-sonnet-5-5", r = await anthropic(env, model, body);
  if (r.status === 404) { // model retired: fall back to the newest Sonnet the key can use
    const list = await (await fetch("https://api.anthropic.com/v1/models?limit=50", { headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } })).json();
    const alt = (list.data || []).find(m => /sonnet/.test(m.id));
    if (alt) { model = alt.id; r = await anthropic(env, model, body); }
  }
  const j = await r.json();
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(j.error && j.error.message) || ""}`.slice(0, 240));
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

export default {
  async scheduled(event, env, ctx) { if (env.INTERVALS_API_KEY) ctx.waitUntil(refresh(env)); },

  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    if (!env.PASSCODE) return html("<p>Set the PASSCODE secret first: <code>npx wrangler secret put PASSCODE</code></p>", 503);
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
      return h ? html(h) : html("<p style='font:15px sans-serif;padding:16px'>No history uploaded yet. Run deploy.sh on your Mac to upload it.</p>", 404);
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

      if (!env.INTERVALS_API_KEY) return json({ error: "no_key" }, 503);

      if (p === "/api/garmin" && req.method === "GET") {
        let g = await env.KV.get("garmin", "json");
        if (!g || url.searchParams.get("refresh") === "1" || Date.now() - (g.fetchedAt || 0) > 15 * 60e3) g = await refresh(env);
        return json(g);
      }

      if (p === "/api/coach" && req.method === "GET") return json((await env.KV.get("coach", "json")) || {});
      if (p === "/api/coach" && req.method === "POST") {
        if (!env.ANTHROPIC_API_KEY) return json({ error: "no_ai_key" }, 503);
        const raw = await req.text();
        if (raw.length > 80000) return json({ error: "bad_body" }, 400);
        const ctx = JSON.parse(raw);
        if (!ctx || !/^\d{4}-\d{2}-\d{2}$/.test(ctx.today) || !Array.isArray(ctx.next)) return json({ error: "bad_body" }, 400);
        const n = (await env.KV.get("coachCount", "json")) || {};
        const used = n.date === ctx.today ? n.count : 0;
        if (used >= 8) return json({ error: "daily_limit" }, 429);
        await env.KV.put("coachCount", JSON.stringify({ date: ctx.today, count: used + 1 }));
        const c = await coach(env, ctx);
        await env.KV.put("coach", JSON.stringify(c));
        return json(c);
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
