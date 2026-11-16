// Lake George 70.3 dashboard: passcode gate, log storage (KV), and intervals.icu bridge to Garmin.
// Secrets (set with `npx wrangler secret put NAME`): PASSCODE, INTERVALS_API_KEY.
// Profile mode (var PROFILE_MODE = "1", e.g. a friend's site): a setup page takes the athlete's intervals.icu key
// (and optional Anthropic key), stores them encrypted with the DATA_KEY secret, reads their numbers, and saves a
// profile the dashboard builds its plan from. Without PROFILE_MODE nothing below changes.
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
const LOGIN = (err, title = "Lake George 70.3") => PAGE(title + " Plan", `<form class="box" method="post" action="/login"><h1>${title}</h1><p>Enter your passcode to open the training plan.</p>
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

// ---------- profile mode: encrypted keys, profile, setup page ----------
const b64 = u8 => btoa(String.fromCharCode(...u8)), unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
const dataKey = env => { if (!env.DATA_KEY) throw new Error("This site has no DATA_KEY secret."); return crypto.subtle.importKey("raw", unb64(env.DATA_KEY), "AES-GCM", false, ["encrypt", "decrypt"]); };
async function seal(env, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); return JSON.stringify({ iv: b64(iv), ct: b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await dataKey(env), enc.encode(JSON.stringify(obj))))) }); }
async function unseal(env, t) { const { iv, ct } = JSON.parse(t); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await dataKey(env), unb64(ct)))); }
// The request's env, with the site's stored keys filled in (env vars win, so Noah's site is untouched).
async function withKeys(env) {
  if (env.PROFILE_MODE !== "1") return env;
  const [sealed, profile] = await Promise.all([env.KV.get("keys"), env.KV.get("profile", "json")]);
  const k = sealed ? await unseal(env, sealed) : {};
  return Object.assign({}, env, { INTERVALS_API_KEY: env.INTERVALS_API_KEY || k.icu, ATHLETE_ID: env.ATHLETE_ID || k.athlete, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || k.ai, PROFILE: profile });
}
const icuGet = async (athlete, key, path) => {
  const r = await fetch(`https://intervals.icu/api/v1/athlete/${athlete}${path}`, { headers: { authorization: "Basic " + btoa("API_KEY:" + key) } });
  if (!r.ok) throw Object.assign(new Error(`intervals.icu ${r.status}`), { status: r.status });
  return r.json();
};
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
// Reads what intervals.icu knows (sport settings, recent training) into setup suggestions.
async function readAthlete(athlete, key) {
  const a = await icuGet(athlete, key, "");
  const ss = a.sportSettings || [], of = t => ss.find(x => (x.types || []).includes(t)) || {};
  const ride = of("Ride"), run = of("Run"), swim = of("Swim"), now = new Date(), d = n => new Date(now - n * 864e5).toISOString().slice(0, 10);
  const [acts, well] = await Promise.all([icuGet(athlete, key, `/activities?oldest=${d(42)}&newest=${d(-1)}`).catch(() => []), icuGet(athlete, key, `/wellness?oldest=${d(10)}&newest=${d(-1)}`).catch(() => [])]);
  const hrs = { swim: 0, bike: 0, run: 0, other: 0 };
  for (const x of acts || []) hrs[{ swim: "swim", bike: "bike", run: "run" }[kind(x.type || "")] || "other"] += (x.moving_time || 0) / 3600 / 6;
  const lthr = run.lthr || (ride.lthr ? ride.lthr + 5 : null), ctl = (well || []).filter(w => w.ctl != null).slice(-1)[0];
  return {
    name: a.firstname || a.name || "", city: a.city || "", weight: a.icu_weight || a.weight || null, rhr: a.icu_resting_hr || null,
    ftp: ride.ftp || null, lthr, maxhr: run.max_hr || ride.max_hr || null,
    css: swim.threshold_pace ? Math.round(100 / swim.threshold_pace) : null,             // m/s → s per 100 m
    gp: run.threshold_pace ? Math.round(1609.344 / (run.threshold_pace * .89)) : null,   // 70.3 run ≈ 89% of threshold speed, s per mile
    recent: { hours: +(hrs.swim + hrs.bike + hrs.run).toFixed(1), swim: +hrs.swim.toFixed(1), bike: +hrs.bike.toFixed(1), run: +hrs.run.toFixed(1) }, ctl: ctl ? Math.round(ctl.ctl) : null
  };
}
// Setup: 1 connect Garmin (via intervals.icu) → 2 race and week → 3 numbers (pre-filled; folded when complete).
// Non-secret answers are kept in this browser (localStorage) so leaving to create the intervals.icu account loses nothing.
const SETUP = (configured) => PAGE("Set up your plan", `<style>
[hidden]{display:none!important}body{display:block;padding:16px 16px 96px}.box{max-width:560px;margin:0 auto;border-left-width:1px}
.steps{display:flex;gap:4px;list-style:none;margin:0;padding:0;font-size:12px;color:var(--muted)}.steps li{flex:1;border-top:3px solid var(--line);padding-top:6px}
.steps li[aria-current]{border-top-color:var(--accent);color:var(--fg);font-weight:600}.steps li.done{border-top-color:var(--good);color:var(--good)}
h2{margin:8px 0 0;font:600 20px/1.2 var(--display)}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.help{font-size:12px;color:var(--faint)}
ol.how{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;color:var(--fg)}ol.how li::marker{font-weight:600}
select,input[type=date]{font:inherit;min-height:44px;padding:0 12px;border:1px solid var(--line-strong);border-radius:6px;background:var(--soft);color:var(--fg)}
.chk{flex-direction:row;align-items:center;gap:8px;min-height:44px;color:var(--fg)}.chk input{min-height:auto;width:20px;height:20px}
.done-card{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-left:4px solid var(--good);background:var(--soft);border-radius:6px}
.done-card b{color:var(--good)}.btn2{background:var(--card);color:var(--fg);border-color:var(--line-strong);padding:0 14px}
details.nums{border:1px solid var(--line);border-radius:6px;padding:0 12px}details.nums[open]{padding-bottom:12px}details.nums>summary{font-weight:600;color:var(--fg)}
.foot{position:fixed;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));background:var(--card);border-top:1px solid var(--line)}.foot>div{max-width:560px;margin:0 auto;display:flex;gap:12px;align-items:center}
.foot button{flex:1}.top{display:flex;justify-content:space-between;align-items:center;max-width:560px;margin:0 auto 12px;font-size:13px}a{color:var(--accent)}
@media(max-width:480px){.row{grid-template-columns:1fr}}</style>
<nav class="top" aria-label="Account">${configured ? '<a href="/">← Back to my plan</a>' : "<span></span>"}<a href="/logout">Sign out</a></nav>
<div class="box"><h1>${configured ? "Plan settings" : "Set up your plan"}</h1>
<ol class="steps" aria-label="Setup progress"><li id="s1" aria-current="step">1 · Connect Garmin</li><li id="s2">2 · Race and week</li><li id="s3">3 · Your numbers</li></ol>

<form id="connect" novalidate><h2>Connect your Garmin</h2>
<p>Your plan reads your training from Garmin and sends workouts to your watch through <b>intervals.icu</b>, a free site that links to Garmin. One-time setup, about 5 minutes:</p>
<ol class="how"><li><a href="https://intervals.icu/signup" target="_blank" rel="noopener">Create a free intervals.icu account</a> (opens a new tab; this page keeps your place).</li>
<li>In intervals.icu, open <b>Settings → Connections</b>, connect <b>Garmin</b>, and switch on <b>Upload planned workouts</b>.</li>
<li>Still in Settings, scroll to <b>Developer Settings</b>. Copy your <b>Athlete ID</b> (starts with “i”), then click <b>Generate</b> next to API key and copy it.</li></ol>
<label>Athlete ID<input name="athlete" required pattern="i?[0-9]+" autocomplete="off" spellcheck="false" inputmode="text" placeholder="e.g. i123456…"></label>
<label>API key<input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the key you generated…"></label>
<details><summary>Optional: turn on the AI coach</summary><label>Anthropic API key<input name="ai" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…"></label>
<p class="help">The coach reviews your week and rewrites a day when plans change. It needs your own key from console.anthropic.com (billed to you, roughly 10 short requests a day). Everything else works without it.</p></details>
<p class="err" id="cErr" role="alert" hidden></p><button id="cGo">Check my connection</button></form>

<div class="done-card" id="connected" hidden><div><b>✓ Garmin connected</b><div class="help" id="who"></div></div><button type="button" class="btn2" id="reconnect">Change</button></div>

<form id="plan" hidden novalidate>
<h2 id="h2race">Your race and week</h2>
<label>Race name<input name="race" required maxlength="80" value="IRONMAN 70.3" autocomplete="off"></label>
<div class="row"><label>Race date<input name="date" type="date" required></label><label>Goal time (optional)<input name="goal" pattern="[0-9]{1,2}:[0-5][0-9]" placeholder="h:mm, e.g. 5:30…" autocomplete="off" inputmode="numeric"><span class="help">Leave blank to aim for your projected time.</span></label></div>
<label>Hours a week at your busiest<input name="hours" type="number" min="4" max="18" step="0.5" required inputmode="decimal"><span class="help" id="hoursHelp">Most 70.3 plans peak at 7–11 hours. The plan starts near what you do now and builds up gradually.</span></label>
<div class="row"><label>Rest day<select name="restDay"><option value="mon">Monday</option><option value="fri">Friday</option></select></label><label>Long ride day<select name="longDay"><option value="sat">Saturday</option><option value="sun">Sunday</option></select></label></div>
<div class="row"><label>Weakest sport<select name="limiter"><option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option></select><span class="help">It gets protected first when a week gets busy.</span></label>
<label class="chk"><input type="checkbox" name="lift" checked> Weekly strength session (free weights)</label></div>

<h2 id="h2nums">Your numbers</h2>
<details class="nums" id="nums"><summary id="numsSum">Training numbers</summary>
<p class="help">These set every target in your plan. Best guesses are fine: week 4 has a swim test and a bike test, and every target updates from them.</p>
<div class="row"><label>Bike threshold power (FTP), watts<input name="ftp" type="number" min="80" max="500" required inputmode="numeric"><span class="help">Power you could hold for about an hour.</span></label>
<label>Swim threshold pace (CSS), per 100 m<input name="css" required pattern="[0-9]:[0-5][0-9]" placeholder="m:ss, e.g. 2:05…" inputmode="numeric"><span class="help">Steady-hard pace you could hold for 1,500 m.</span></label></div>
<div class="row"><label>Race run pace, per mile<input name="gp" required pattern="[0-9]{1,2}:[0-5][0-9]" placeholder="m:ss, e.g. 8:45…" inputmode="numeric"><span class="help">The pace you hope to hold for the half marathon.</span></label>
<label>Run threshold heart rate<input name="lthr" type="number" min="120" max="215" required inputmode="numeric"><span class="help">Average of a hard 30-min run. Easy runs stay under 80% of it.</span></label></div>
<div class="row"><label>Resting heart rate<input name="rhr" type="number" min="30" max="100" required inputmode="numeric"></label><label>Weight, kg (optional)<input name="weight" type="number" min="35" max="160" step="0.1" inputmode="decimal"></label></div>
</details>
<h2>Weather (optional)</h2>
<p class="help" id="locTxt">Share your location to get a ride-or-run-outside call for each session (US only). Weather stays off until you do.</p>
<button type="button" class="btn2" id="loc">Use my current location</button>
<p class="err" id="pErr" role="alert" hidden></p></form></div>
<div class="foot" id="foot" hidden><div><button form="plan" id="pGo">${configured ? "Save and update my plan" : "Create my plan"}</button></div></div>
<script>
const $ = s => document.querySelector(s), mmss = s => s ? Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0") : "", secs = t => { const [m, s] = t.split(":").map(Number); return m * 60 + s; };
const NUM = ["ftp", "css", "gp", "lthr", "rhr"], LBL = { ftp: "FTP", css: "swim pace", gp: "run pace", lthr: "threshold HR", rhr: "resting HR", weight: "weight" };
let place = null; const fail = (el, m) => { el.textContent = m; el.hidden = false; el.focus && el.focus(); };
const draft = () => { try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem("setup-draft")) || {}).filter(([, v]) => v !== "" && v != null)); } catch (e) { return {}; } }; // only answers actually given
const keep = () => { const f = $("#plan"), d = { athlete: $("#connect").athlete.value };
  for (const el of f.elements) if (el.name) d[el.name] = el.type === "checkbox" ? el.checked : el.value; try { localStorage.setItem("setup-draft", JSON.stringify(d)); } catch (e) {} };
function step(n) { for (const i of [1, 2, 3]) { const li = $("#s" + i); li.toggleAttribute("aria-current", i === n); li.classList.toggle("done", i < n); } }
function showConnected(j) {
  $("#connect").hidden = true; $("#connected").hidden = false; $("#plan").hidden = false; $("#foot").hidden = false; step(2);
  $("#who").textContent = (j.name ? j.name + " · " : "") + (j.recent ? "recent training " + j.recent.hours + " h a week" : "") + (j.ai ? " · AI coach on" : "");
  if (j.recent && j.recent.hours) $("#hoursHelp").textContent = "You've averaged " + j.recent.hours + " h a week lately. Most 70.3 plans peak at 7–11 h; yours starts near your current volume and builds up gradually.";
}
function fill(p, imported) {
  const f = $("#plan");
  for (const k of ["ftp", "lthr", "rhr", "weight", "hours"]) if (p[k] != null && p[k] !== "") f[k].value = p[k];
  for (const k of ["css", "gp"]) if (p[k]) f[k].value = typeof p[k] === "number" ? mmss(p[k]) : p[k];
  if (p.race) { if (typeof p.race === "string") f.race.value = p.race; else { f.race.value = p.race.name; f.date.value = p.race.date; } }
  if (p.date) f.date.value = p.date; if (p.goal) f.goal.value = typeof p.goal === "number" ? Math.floor(p.goal / 3600) + ":" + String(Math.round(p.goal % 3600 / 60)).padStart(2, "0") : p.goal;
  for (const k of ["limiter", "restDay", "longDay"]) if (p[k]) f[k].value = p[k]; if (p.lift != null) f.lift.checked = !!p.lift;
  if (p.place) { place = p.place; $("#locTxt").textContent = "Weather on for your saved location."; }
  numsSummary(imported);
}
// Numbers fold into one line when complete; the section opens on its own when something is missing.
function numsSummary(imported) {
  const f = $("#plan"), missing = NUM.filter(k => !f[k].value);
  const parts = [f.ftp.value && "FTP " + f.ftp.value + " W", f.css.value && "swim " + f.css.value + "/100 m", f.gp.value && "run " + f.gp.value + "/mi", f.lthr.value && "threshold HR " + f.lthr.value];
  $("#numsSum").textContent = missing.length ? "Add " + missing.length + " number" + (missing.length > 1 ? "s" : "") + ": " + missing.map(k => LBL[k]).join(", ") : (imported ? "From Garmin: " : "") + parts.filter(Boolean).join(" · ") + " — review";
  $("#nums").open = missing.length > 0;
}
fetch("/api/setup").then(r => r.json()).then(j => {
  const d = draft(); if (d.athlete) $("#connect").athlete.value = d.athlete; if (j.athlete) $("#connect").athlete.value = j.athlete;
  if (j.hasKey) { showConnected(Object.assign({ ai: j.hasAi }, j.connect || {})); fill(Object.assign({}, j.connect || {}, d, j.profile || {}), !j.profile && !!j.connect); if (j.profile) step(3); }
});
$("#plan").addEventListener("input", () => { keep(); numsSummary(false); });
$("#reconnect").addEventListener("click", () => { $("#connect").hidden = false; $("#connected").hidden = true; step(1); $("#connect").athlete.focus(); });
$("#connect").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, b = $("#cGo"); $("#cErr").hidden = true;
  if (!/^i?[0-9]+$/.test(f.athlete.value.trim())) return fail($("#cErr"), "Enter your Athlete ID from intervals.icu Settings → Developer Settings (it looks like i123456).");
  b.disabled = true; b.textContent = "Checking…"; keep();
  try {
    const r = await fetch("/api/setup/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ athlete: f.athlete.value.trim(), key: f.key.value.trim(), ai: f.ai.value.trim() }) }), j = await r.json();
    if (!r.ok) return fail($("#cErr"), { bad_key: "intervals.icu didn't accept that Athlete ID and API key. Copy both again from Settings → Developer Settings.", bad_ai_key: "Anthropic didn't accept that key. Check it at console.anthropic.com, or leave it blank.", no_key: "Paste the API key you generated in intervals.icu." }[j.error] || "Couldn't connect: " + (j.detail || j.error));
    f.key.value = ""; f.ai.value = "";
    showConnected(j);
    const got = Object.fromEntries(Object.entries(j).filter(([k, v]) => v != null && NUM.concat("weight").includes(k)));
    fill(Object.assign({ hours: Math.min(18, Math.max(6, Math.round(j.recent.hours * 1.6 * 2) / 2)) }, got, draft()), true);
    $("#h2race").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); $("#plan").race.focus({ preventScroll: true });
  } catch (x) { fail($("#cErr"), "No connection. Check your internet and try again."); } finally { b.disabled = false; b.textContent = "Check my connection"; }
});
$("#loc").addEventListener("click", () => { if (!navigator.geolocation) return $("#locTxt").textContent = "This browser can't share a location.";
  navigator.geolocation.getCurrentPosition(p => { place = { lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2), name: "Home" }; $("#locTxt").textContent = "Weather on for your current location."; },
    () => $("#locTxt").textContent = "Location not shared. Weather stays off; you can turn it on later in Plan settings."); });
$("#plan").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, b = $("#pGo"); $("#pErr").hidden = true;
  const bad = [...f.elements].find(el => el.willValidate && !el.checkValidity());
  if (bad) { if (bad.closest("#nums")) $("#nums").open = true; bad.focus(); return fail($("#pErr"), (bad.labels[0] ? bad.labels[0].firstChild.textContent.trim() : "A field") + ": " + (bad.validity.valueMissing ? "fill this in." : "check the format (" + (bad.placeholder || "see the hint") + ").")); }
  b.disabled = true; b.textContent = "Building your plan…";
  const t = new Date(), today = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  const goal = f.goal.value ? (([h, m]) => h * 3600 + m * 60)(f.goal.value.split(":").map(Number)) : null;
  const body = { today, race: { name: f.race.value.trim(), date: f.date.value }, goal, hours: +f.hours.value, limiter: f.limiter.value, restDay: f.restDay.value, longDay: f.longDay.value, lift: f.lift.checked,
    ftp: +f.ftp.value, css: secs(f.css.value), gp: secs(f.gp.value), lthr: +f.lthr.value, rhr: +f.rhr.value, weight: f.weight.value ? +f.weight.value : null, place };
  try { const r = await fetch("/api/setup/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), j = await r.json();
    if (!r.ok) return fail($("#pErr"), j.detail || "Couldn't save: " + j.error); try { localStorage.removeItem("setup-draft"); } catch (x) {} location.href = "/";
  } catch (x) { fail($("#pErr"), "No connection. Check your internet and try again."); } finally { b.disabled = false; b.textContent = ${JSON.stringify(configured ? "Save and update my plan" : "Create my plan")}; }
});
</script>`);

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
  const now = new Date(), P = env.PROFILE, back = n => ymd(new Date(new Date((P ? P.start : "2026-10-12") + "T12:00:00Z").getTime() - n * 864e5));
  const oldest = P ? back(42) : "2026-10-12", wOldest = P ? back(120) : "2026-07-01", newest = ymd(new Date(now.getTime() + 864e5));
  try {
    const [well, acts, lib] = await Promise.all([
      intervals(env, `/wellness?oldest=${wOldest}&newest=${newest}`),
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

// A profile's coach: same rules and notation, their race and easy cap, none of Noah's personal history.
const coachSystem = P => !P ? COACH_SYSTEM : COACH_SYSTEM
  .replace(/^You are the endurance coach behind[^\n]*\n/, `You are the endurance coach behind a structured plan for ${P.race.name} (race ${P.race.date}). The athlete is ${P.name || "an age-group triathlete"}.\n`)
  .replace(/This athlete's known pattern[\s\S]*?Mention the most important habit gap in the summary, with its number\.\n/,
    `Apply these rules (the context's "habits" object scores them):\n- Never remove a swim to fix fatigue; cut bike or run instead.\n- An easy session done hard (bike normalized power above 80% of FTP, run average HR above ${P.ez + 6}) counts as a hard day. Follow it with an easy day.\n- If easyShareThisWeek.pct is under 75, do not add intensity.\n- If ctlRamp7d is above 7, hold or trim volume for the next 3 days.\nThe athlete's weakest sport is the ${P.limiter || "swim"}: protect those sessions first.\n`)
  .replace(/easy runs are "≤144 bpm"/, `easy runs are "≤${P.ez} bpm"`);
async function anthropic(env, model, body) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, ...body })
  });
}
async function coach(env, ctx) {
  const body = { max_tokens: 4000, system: coachSystem(env.PROFILE) + (ctx.request ? ASK_RULES : ""), tools: [COACH_TOOL], tool_choice: { type: "auto" },
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

// Setup API (profile mode). Keys are never returned to the browser.
async function setupApi(req, env, p) {
  if (p === "/api/setup" && req.method === "GET") {
    const k = env.INTERVALS_API_KEY ? { athlete: env.ATHLETE_ID } : {};
    return json({ profile: env.PROFILE || null, athlete: k.athlete || null, hasKey: !!env.INTERVALS_API_KEY, hasAi: !!env.ANTHROPIC_API_KEY, connect: await env.KV.get("connect", "json") });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || JSON.stringify(body).length > 4000) return json({ error: "bad_body" }, 400);
  if (p === "/api/setup/connect" && req.method === "POST") {
    const athlete = String(body.athlete || "").trim(), key = String(body.key || "").trim() || (athlete === env.ATHLETE_ID ? env.INTERVALS_API_KEY : ""), ai = String(body.ai || "").trim() || env.ANTHROPIC_API_KEY || "";
    if (!/^i?\d{1,10}$/.test(athlete)) return json({ error: "bad_key" }, 400);
    if (!key) return json({ error: "no_key" }, 400);
    let info;
    try { info = await readAthlete(athlete, key); } catch (e) { return json({ error: e.status === 401 || e.status === 403 || e.status === 404 ? "bad_key" : "upstream", detail: String(e.message || e).slice(0, 200) }, e.status && e.status < 500 ? 400 : 502); }
    if (ai && ai !== env.ANTHROPIC_API_KEY) { // checked with the free models list; costs nothing
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": ai, "anthropic-version": "2023-06-01" } });
      if (r.status === 401 || r.status === 403) return json({ error: "bad_ai_key" }, 400);
    }
    await Promise.all([env.KV.put("keys", await seal(env, { icu: key, athlete, ai: ai || undefined })), env.KV.put("connect", JSON.stringify(info))]);
    return json(Object.assign(info, { ai: !!ai }));
  }
  if (p === "/api/setup/profile" && req.method === "POST") {
    if (!env.INTERVALS_API_KEY) return json({ error: "no_key", detail: "Connect intervals.icu first." }, 400);
    const b = body, n = (v, lo, hi) => typeof v === "number" && v >= lo && v <= hi, D = /^\d{4}-\d{2}-\d{2}$/;
    const bad = !b.race || typeof b.race.name !== "string" || !b.race.name.trim() || b.race.name.length > 80 ? "Give the race a name." : !D.test(b.race.date || "") || !D.test(b.today || "") ? "Pick a race date."
      : !n(b.hours, 4, 18) ? "Hours per week: 4 to 18." : !n(b.ftp, 80, 500) ? "FTP: 80 to 500 W." : !n(b.css, 60, 240) ? "CSS: 1:00 to 4:00 per 100 m." : !n(b.gp, 300, 900) ? "Run pace: 5:00 to 15:00 per mile."
      : !n(b.lthr, 120, 215) ? "Threshold HR: 120 to 215." : !n(b.rhr, 30, 100) ? "Resting HR: 30 to 100." : b.goal != null && !n(b.goal, 3 * 3600, 9 * 3600) ? "Goal time: 3:00 to 9:00." : null;
    if (bad) return json({ error: "bad_body", detail: bad }, 400);
    // the plan starts on the coming Monday (today, if it is one); it needs 8–40 weeks to race day
    const t = new Date(b.today + "T12:00:00Z"), dow = (t.getUTCDay() + 6) % 7, start = ymd(new Date(t.getTime() + (dow ? 7 - dow : 0) * 864e5));
    const keepStart = env.PROFILE && env.PROFILE.start <= b.today ? env.PROFILE.start : start; // an edit keeps the original start, so logged days stay put
    const weeks = (Date.parse(b.race.date) - Date.parse(keepStart)) / 864e5 / 7;
    if (weeks < 7 || weeks > 40) return json({ error: "bad_body", detail: `Race date must be 8 to 40 weeks after ${keepStart}.` }, 400);
    const place = b.place && n(b.place.lat, -90, 90) && n(b.place.lon, -180, 180) ? { lat: b.place.lat, lon: b.place.lon, name: String(b.place.name || "Home").slice(0, 40) } : null;
    const info = (env.PROFILE && env.PROFILE.recent) ? { name: env.PROFILE.name, recent: env.PROFILE.recent } : await readAthlete(env.ATHLETE_ID, env.INTERVALS_API_KEY).catch(() => ({ name: "", recent: null }));
    const profile = { name: info.name || "", start: keepStart, race: { name: b.race.name.trim(), date: b.race.date }, goal: b.goal || null, hours: b.hours, recent: info.recent, limiter: ["swim", "bike", "run"].includes(b.limiter) ? b.limiter : "swim",
      restDay: b.restDay === "fri" ? "fri" : "mon", longDay: b.longDay === "sun" ? "sun" : "sat", lift: !!b.lift, ftp: Math.round(b.ftp), css: Math.round(b.css), gp: Math.round(b.gp),
      lthr: Math.round(b.lthr), ez: Math.round(b.lthr * .8), rhr: Math.round(b.rhr), weight: b.weight && n(b.weight, 35, 160) ? b.weight : null, place };
    const settings = (await env.KV.get("settings", "json")) || { tests: [] };
    Object.assign(settings, { ftp: profile.ftp, css: profile.css, gp: profile.gp, rhr: profile.rhr }); // tests, milestones and coach changes are kept
    await Promise.all([env.KV.put("profile", JSON.stringify(profile)), env.KV.put("settings", JSON.stringify(settings))]);
    return json({ ok: true, start: profile.start });
  }
  return json({ error: "not_found" }, 404);
}

// ---------- friends site: one site, a private account per friend ----------
// Noah invites a friend from his dashboard (inviteApi on his site writes to this site's KV through the FRIENDS_KV
// binding). The friend opens the one-time link, picks a passcode, and gets their own storage: every KV key is
// prefixed "u:<id>:" (logs, settings, profile, encrypted keys, Garmin cache, coach), so friends never see each other.
// KV layout: users = { id: { name, login, created, disabled } } · login:<name> = id · invite:<code> = { name, created } (14-day TTL).
const scopedKV = (kv, pre) => ({ get: (k, t) => kv.get(pre + k, t), put: (k, v, o) => kv.put(pre + k, v, o), delete: k => kv.delete(pre + k) });
const userEnv = (env, id) => Object.assign({}, env, { KV: scopedKV(env.KV, `u:${id}:`), USER_ID: id });
const loginOf = name => String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 24);
const rand = n => b64(crypto.getRandomValues(new Uint8Array(n))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function passHash(pass, salt) { // PBKDF2-SHA256, 100k rounds (the Workers maximum)
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: 100000 }, key, 256)));
}
async function sessionSig(env, id, hash) { const k = await crypto.subtle.importKey("raw", unb64(env.DATA_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(id + ":" + hash)))).replace(/[+/=]/g, c => ({ "+": "-", "/": "_", "=": "" }[c])); }
const COOKIE = v => `fs=${v}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
const FRIEND_LOGIN = (err, name = "") => PAGE("Training plan", `<form class="box" method="post" action="/login"><h1>Training plan</h1><p>Sign in with the name from your invite and the passcode you chose.</p>
<label>Name<input name="name" autocomplete="username" required value="${String(name).replace(/[<>"&]/g, "")}" autocapitalize="none" spellcheck="false"></label>
<label>Passcode<input type="password" name="pass" autocomplete="current-password" required></label>
${err ? `<p class="err" role="alert">${err}</p>` : ""}<button type="submit">Sign in</button><p style="font-size:13px">New here? Open the invite link you were sent. Forgot your passcode? Ask the person who invited you for a reset link; your plan and log stay as they are.</p></form>`);
const JOIN = (code, name, err, login = loginOf(name)) => PAGE("Join", `<form class="box" method="post" action="/join"><h1>Hi ${String(name).replace(/[<>"&]/g, "")}</h1>
<p>You've been invited to a personal triathlon training plan. It builds a structured plan from your Garmin data and sends workouts to your watch. Your data is private to you.</p>
<input type="hidden" name="code" value="${code}"><label>Your sign-in name (you'll use it with your passcode)<input value="${login}" readonly autocomplete="username"></label>
<label>Choose a passcode (8+ characters)<input type="password" name="pass" minlength="8" autocomplete="new-password" required></label>
<label>Type it again<input type="password" name="pass2" minlength="8" autocomplete="new-password" required></label>
${err ? `<p class="err" role="alert">${err}</p>` : ""}<button type="submit">Create my account</button></form>`);
async function friendsFetch(req, env, url, p) {
  if (!env.DATA_KEY) return html(NOTICE("The site isn't set up yet", "It has no DATA_KEY secret.", "Run <code>openssl rand -base64 32 | npx wrangler secret put DATA_KEY --env friends</code>."), 503);
  if (p === "/join") {
    const code = req.method === "POST" ? null : url.searchParams.get("code") || "", f = req.method === "POST" ? await req.formData() : null, c = f ? String(f.get("code") || "") : code;
    const inv = /^[\w-]{16,64}$/.test(c) ? await env.KV.get("invite:" + c, "json") : null;
    if (!inv) return html(NOTICE("This invite link has expired", "Invite links work once and expire after 14 days. Ask for a new one."), 410);
    const login = inv.login || loginOf(inv.name) || "friend"; // reserved when the invite was made, so the invite message is right
    if (!f) return html(JOIN(c, inv.name, "", login));
    const pass = String(f.get("pass") || "");
    if (pass.length < 8) return html(JOIN(c, inv.name, "Use at least 8 characters.", login), 400);
    if (pass !== f.get("pass2")) return html(JOIN(c, inv.name, "The two passcodes don't match.", login), 400);
    if (await env.KV.get("login:" + login)) return html(NOTICE("This invite needs replacing", `The sign-in name “${login}” was just taken. Ask for a new invite.`), 409);
    const users = (await env.KV.get("users", "json")) || {};
    const id = rand(12), salt = rand(16), hash = await passHash(pass, salt.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - salt.length % 4) % 4));
    users[id] = { name: inv.name, login, created: Date.now() };
    await Promise.all([env.KV.put("users", JSON.stringify(users)), env.KV.put("login:" + login, id), env.KV.put(`u:${id}:auth`, JSON.stringify({ salt, hash })), env.KV.delete("invite:" + c)]);
    return new Response(null, { status: 303, headers: { location: "/setup", "set-cookie": COOKIE(`${id}.${await sessionSig(env, id, hash)}`) } });
  }
  if (p === "/reset") { // one-time passcode reset made by the owner; the account, plan and log are unchanged
    const f = req.method === "POST" ? await req.formData() : null, c = String(f ? f.get("code") || "" : url.searchParams.get("code") || "");
    const rs = /^[\w-]{16,64}$/.test(c) ? await env.KV.get("reset:" + c, "json") : null, users = (await env.KV.get("users", "json")) || {}, u = rs && users[rs.id];
    if (!u) return html(NOTICE("This reset link has expired", "Reset links work once and expire after 3 days. Ask for a new one."), 410);
    const page = err => PAGE("New passcode", `<form class="box" method="post" action="/reset"><h1>New passcode</h1><p>Choose a new passcode for <b>${u.login}</b>. Your plan and log stay as they are.</p>
<input type="hidden" name="code" value="${c}"><input type="hidden" autocomplete="username" value="${u.login}"><label>New passcode (8+ characters)<input type="password" name="pass" minlength="8" autocomplete="new-password" required></label>
<label>Type it again<input type="password" name="pass2" minlength="8" autocomplete="new-password" required></label>${err ? `<p class="err" role="alert">${err}</p>` : ""}<button type="submit">Save and sign in</button></form>`);
    if (!f) return html(page());
    const pass = String(f.get("pass") || "");
    if (pass.length < 8) return html(page("Use at least 8 characters."), 400);
    if (pass !== f.get("pass2")) return html(page("The two passcodes don't match."), 400);
    const salt = rand(16), b64std = t => t.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - t.length % 4) % 4), hash = await passHash(pass, b64std(salt));
    await Promise.all([env.KV.put(`u:${rs.id}:auth`, JSON.stringify({ salt, hash })), env.KV.delete("reset:" + c)]); // a new hash also ends every old sign-in
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": COOKIE(`${rs.id}.${await sessionSig(env, rs.id, hash)}`) } });
  }
  if (p === "/login" && req.method === "POST") {
    const f = await req.formData(), login = loginOf(f.get("name")), id = login && await env.KV.get("login:" + login), users = (await env.KV.get("users", "json")) || {};
    const auth = id && !(users[id] || {}).disabled ? await env.KV.get(`u:${id}:auth`, "json") : null;
    const b64std = t => t.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - t.length % 4) % 4);
    if (auth && await passHash(String(f.get("pass") || ""), b64std(auth.salt)) === auth.hash)
      return new Response(null, { status: 303, headers: { location: "/", "set-cookie": COOKIE(`${id}.${await sessionSig(env, id, auth.hash)}`) } });
    await new Promise(r => setTimeout(r, 800));
    return html(FRIEND_LOGIN("That name and passcode don't match. Check both and try again.", f.get("name") || ""), 401);
  }
  if (p === "/logout") return new Response(null, { status: 303, headers: { location: "/", "set-cookie": "fs=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
  // session: "<id>.<HMAC(id:passcode hash)>"; a removed friend or a changed passcode ends it
  const [id, sig] = String(getCookie(req, "fs") || "").split("."), users = id ? (await env.KV.get("users", "json")) || {} : {};
  const auth = id && users[id] && !users[id].disabled ? await env.KV.get(`u:${id}:auth`, "json") : null;
  if (!auth || sig !== await sessionSig(env, id, auth.hash)) return p.startsWith("/api/") ? json({ error: "locked" }, 401) : html(FRIEND_LOGIN(""), 401);
  return app(req, await withKeys(userEnv(env, id)), url, p, true);
}
// Noah's site: create, list and cancel invites; remove a friend's access (their data is kept).
async function inviteApi(req, env, p) {
  const F = env.FRIENDS_KV, base = (env.FRIENDS_URL || "").replace(/\/$/, "");
  if (p === "/api/invites" && req.method === "GET") {
    const users = (await F.get("users", "json")) || {}, list = await F.list({ prefix: "invite:" }), invites = [];
    for (const k of list.keys) { const v = await F.get(k.name, "json"); if (v) invites.push({ code: k.name.slice(7), name: v.name, login: v.login || loginOf(v.name), created: v.created, link: `${base}/join?code=${k.name.slice(7)}` }); }
    const friends = await Promise.all(Object.entries(users).map(async ([id, u]) => ({ id, name: u.name, login: u.login, created: u.created, disabled: !!u.disabled, ready: !!(await F.get(`u:${id}:profile`)) })));
    return json({ base, invites: invites.sort((a, b) => b.created - a.created), friends: friends.sort((a, b) => b.created - a.created) });
  }
  if (p === "/api/invites" && req.method === "POST") {
    const b = await req.json().catch(() => ({})), name = String(b.name || "").trim().replace(/\s+/g, " ");
    if (!/^[\p{L}][\p{L} '.-]{0,29}$/u.test(name)) return json({ error: "bad_name", detail: "Use their first name (letters only, up to 30)." }, 400);
    // reserve a sign-in name no one else has or has been promised (kian, kian2, …), so the message is exactly right
    const taken = new Set(), pend = await F.list({ prefix: "invite:" });
    for (const k of pend.keys) { const v = await F.get(k.name, "json"); if (v) taken.add(v.login || loginOf(v.name)); }
    const root = loginOf(name) || "friend"; let login = root, i = 2;
    while (taken.has(login) || await F.get("login:" + login)) login = root + i++;
    const code = rand(18), created = Date.now();
    await F.put("invite:" + code, JSON.stringify({ name, login, created }), { expirationTtl: 14 * 864e2 });
    return json({ kind: "invite", code, name, login, link: `${base}/join?code=${code}`, base });
  }
  const inv = p.match(/^\/api\/invites\/([\w-]{16,64})$/), fr = p.match(/^\/api\/friends\/([\w-]{8,32})$/), rst = p.match(/^\/api\/friends\/([\w-]{8,32})\/reset$/);
  if (rst && req.method === "POST") {
    const u = ((await F.get("users", "json")) || {})[rst[1]]; if (!u) return json({ error: "not_found" }, 404);
    const code = rand(18); await F.put("reset:" + code, JSON.stringify({ id: rst[1], created: Date.now() }), { expirationTtl: 3 * 864e2 });
    return json({ kind: "reset", name: u.name, login: u.login, link: `${base}/reset?code=${code}`, base });
  }
  if (inv && req.method === "DELETE") { await F.delete("invite:" + inv[1]); return json({ ok: true }); }
  if (fr && (req.method === "DELETE" || req.method === "POST")) {
    const users = (await F.get("users", "json")) || {}; if (!users[fr[1]]) return json({ error: "not_found" }, 404);
    users[fr[1]].disabled = req.method === "DELETE"; await F.put("users", JSON.stringify(users)); return json({ ok: true });
  }
  return json({ error: "not_found" }, 404);
}

// Everything after sign-in, shared by Noah's site and the friends site (PM = profile mode, env.KV already scoped to the user).
async function app(req, env, url, p, PM) {
  if (PM && p === "/setup") return html(SETUP(!!env.PROFILE));
  if (PM && (p === "/" || p === "/index.html") && req.method === "GET") {
    if (!env.PROFILE) return new Response(null, { status: 302, headers: { location: "/setup" } });
    const page = await (await env.ASSETS.fetch(req)).text(); // the dashboard builds its plan from this profile
    return html(page.replace("<body>", `<body>\n<script>window.LG_PROFILE = ${JSON.stringify(Object.assign({}, env.PROFILE, { ai: !!env.ANTHROPIC_API_KEY })).replace(/</g, "\\u003c")};</script>`));
  }
  if (p === "/history.html" && !PM) {
    const h = await env.KV.get("history");
    return h ? html(h.replace("</head>", HISTORY_THEME + "</head>")) : html(NOTICE("No history uploaded yet", "Your Garmin history page hasn't been sent to the site.", "On your Mac, run <code>./deploy.sh</code> in <code>~/Desktop/Training</code>. It uploads <code>training-dashboard.html</code> along with the site."), 404);
  }
  if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);

  try {
    if (PM && p.startsWith("/api/setup")) return await setupApi(req, env, p);
    if (!PM && /^\/api\/(invites|friends)/.test(p)) return env.FRIENDS_KV ? await inviteApi(req, env, p) : json({ enabled: false }); // no friends site bound: sharing is off
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

export default {
  async scheduled(event, env, ctx) {
    if (env.PROFILE_MODE !== "1") { ctx.waitUntil(env.INTERVALS_API_KEY ? refresh(env) : Promise.resolve()); return; }
    // friends site: every active friend's Garmin data refreshes on the same 20-minute cycle
    ctx.waitUntil((async () => { const users = (await env.KV.get("users", "json")) || {};
      for (const [id, u] of Object.entries(users)) if (!u.disabled) { const e = await withKeys(userEnv(env, id)); if (e.INTERVALS_API_KEY) await refresh(e).catch(() => null); } })());
  },

  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    if (env.PROFILE_MODE === "1") return friendsFetch(req, env, url, p);
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
    return app(req, env, url, p, false);
  }
};
