// Builds an Outlook-importable .ics of every planned session from the dashboard's own plan logic.
// Usage: node calendar/build-ics.mjs <settings.json> <fromDate YYYY-MM-DD> <out.ics>
import fs from "node:fs";
const [, , settingsPath, FROM, OUT] = process.argv;
const html = fs.readFileSync(new URL("../lake-george-70-3-plan.html", import.meta.url), "utf8");
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
const A = cut("const START", "// ---------- state ----------");
const T = cut("// ---------- token expansion", "// ---------- storage");
const F = cut("function fromCoach(c) {", "\n}\n", ) ;
const src = `${A}\nlet settings = Object.assign(structuredClone(DEF), SET);\n${T}\nconst fc = (()=>{ ${html.slice(html.indexOf("function fromCoach(c) {"), html.indexOf("\n}\n", html.indexOf("function fromCoach(c) {")) + 3)}; return fromCoach; })();\nreturn { DAYS, X, slotTime, fc, settings };`;
const SET = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const { DAYS, X, slotTime, fc, settings } = new Function("SET", src)(SET);
const ovr = settings.ovr || {};
const esc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = l => { const out = []; let b = Buffer.from(l); while (b.length > 74) { let n = 74; while ((b[n] & 0xc0) === 0x80) n--; out.push(b.subarray(0, n).toString()); b = Buffer.concat([Buffer.from(" "), b.subarray(n)]); } out.push(b.toString()); return out.join("\r\n"); };
const LBL = { swim: "Swim", bike: "Bike", run: "Run", lift: "", brick: "Brick", key: "Key" };
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const ev = [];
for (const d of DAYS) {
  if (d.key < FROM) continue;
  for (const slot of ["am", "pm"]) {
    const o = ovr[d.key + "|" + slot];
    const s = o ? fc(o) : d[slot];
    if (!s || s.s === "rest") continue;
    const t = X(s.t), [h, m] = slotTime(d, slot).split(":").map(Number);
    const st = new Date(d.date); st.setHours(h, m); const en = new Date(st.getTime() + Math.max(s.m || 30, 20) * 6e4);
    const f = x => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}T${String(x.getHours()).padStart(2, "0")}${String(x.getMinutes()).padStart(2, "0")}00`;
    const title = s.s === "lift" ? t : `${LBL[s.s]}: ${t}`;
    const desc = [t, ...(s.items || []), `Week ${d.wk} · ${d.ph}`].join("\n");
    ev.push(["BEGIN:VEVENT", `UID:lg703-${d.key}-${slot}@noahlazar`, `DTSTAMP:${stamp}`, `DTSTART;TZID=America/New_York:${f(st)}`, `DTEND;TZID=America/New_York:${f(en)}`,
      `SUMMARY:${esc(title.length > 70 ? title.slice(0, 69) + "…" : title)}`, `DESCRIPTION:${esc(desc)}`, "TRANSP:OPAQUE", "CATEGORIES:Training", "END:VEVENT"].map(fold).join("\r\n"));
  }
}
const tz = ["BEGIN:VTIMEZONE", "TZID:America/New_York", "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD", "END:VTIMEZONE"];
fs.writeFileSync(OUT, ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Noah//Lake George 70.3//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Lake George 70.3", "X-WR-TIMEZONE:America/New_York", ...tz, ...ev, "END:VCALENDAR", ""].join("\r\n"));
console.log(`${ev.length} events → ${OUT}`);
