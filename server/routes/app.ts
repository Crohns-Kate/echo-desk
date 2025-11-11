// server/routes/app.ts
import { Request, Response, Express } from "express";
import { storage } from "../storage";
import { BUILD } from "../utils/version";

// Optional lazy loaders so diagnostics don't crash if helpers aren't present
async function lazyTime() {
  try {
    return await import("../time");
  } catch {
    return {} as any;
  }
}
async function lazyTZ() {
  try {
    return await import("../utils/tz");
  } catch {
    return {} as any;
  }
}
async function lazyCliniko() {
  return await import("../services/cliniko");
}

export function registerApp(app: Express) {
  // ─────────────────────────────────────────────────────────────
  // Health + version
  // ─────────────────────────────────────────────────────────────
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/version", (_req: Request, res: Response) => {
    res.json(BUILD);
  });

  // ─────────────────────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────────────────────
  app.get("/api/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await (storage as any).getStats?.();
      res.json(stats ?? { calls: 0, patients: 0 });
    } catch (error) {
      console.error("[/api/stats] error:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Calls (best-effort)
  // ─────────────────────────────────────────────────────────────
  app.get("/api/calls", async (_req: Request, res: Response) => {
    try {
      const calls =
        (await (storage as any).getCalls?.()) ??
        (await (storage as any).listCalls?.()) ??
        [];
      res.json(calls);
    } catch (error) {
      console.error("[/api/calls] error:", error);
      res.status(500).json({ error: "Failed to fetch calls" });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Cliniko config/health echo (no network call)
  // ─────────────────────────────────────────────────────────────
  app.get("/__cliniko/health", async (_req: Request, res: Response) => {
    const region = process.env.CLINIKO_REGION || "au4";
    const apiKey = !!process.env.CLINIKO_API_KEY;
    const businessId = process.env.CLINIKO_BUSINESS_ID || "";
    const practitionerId = process.env.CLINIKO_PRACTITIONER_ID || "";
    const apptTypeId = process.env.CLINIKO_APPT_TYPE_ID || "";

    res.json({
      ok: Boolean(apiKey && businessId && practitionerId && apptTypeId),
      region,
      businessId,
      practitionerId,
      apptTypeId,
      timestamp: new Date().toISOString(),
    });
  });

  // ─────────────────────────────────────────────────────────────
  // TZ diagnostics
  // ─────────────────────────────────────────────────────────────
  app.get("/__tz/now", async (_req: Request, res: Response) => {
    const { AUST_TZ } = (await lazyTime()) as any;
    const tz = AUST_TZ || "Australia/Brisbane";
    const now = new Date();

    res.json({
      serverTime: now.toISOString(),
      clinicTime: now.toLocaleString("en-AU", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "long",
      }),
      timezone: tz,
      serverOffset: -now.getTimezoneOffset() / 60,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Availability probe (choose day & optional part=morning|afternoon)
  // ─────────────────────────────────────────────────────────────
  app.get("/__cliniko/avail", async (req: Request, res: Response) => {
    try {
      const { localDayWindow, speakableTime, AUST_TZ } = (await lazyTime()) as any;
      const { getAvailability } = await lazyCliniko();

      const day = (req.query.day as string) || "tomorrow";
      const part = (req.query.part as string) as "morning" | "afternoon" | undefined;

      const tz = AUST_TZ || "Australia/Brisbane";
      const window =
        typeof localDayWindow === "function"
          ? localDayWindow(day, tz)
          : (() => {
              const base = new Date();
              if (day.toLowerCase() === "tomorrow") base.setDate(base.getDate() + 1);
              const fromDate = new Date(base);
              fromDate.setHours(0, 0, 0, 0);
              const toDate = new Date(base);
              toDate.setHours(23, 59, 59, 999);
              return { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() };
            })();

      const { fromDate, toDate } = window;

      const slots = await getAvailability({
        fromIso: fromDate,
        toIso: toDate,
        part: part ?? "any",
      });

      const option1 = slots[0];
      const option2 = slots[1];

      const speak = (iso: string) =>
        typeof speakableTime === "function" ? speakableTime(iso, tz) : iso;

      res.json({
        ok: true,
        day,
        part: part || "any",
        fromDate,
        toDate,
        totalSlots: slots.length,
        options: [
          option1 && { iso: option1.startIso, speakable: speak(option1.startIso) },
          option2 && { iso: option2.startIso, speakable: speak(option2.startIso) },
        ].filter(Boolean),
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        reason: err.message || String(err),
        stack: err.stack,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Mini TTS phrasing demo
  // ─────────────────────────────────────────────────────────────
  app.get("/__tts/demo", async (req: Request, res: Response) => {
    try {
      const { speakableTime, AUST_TZ } = (await lazyTime()) as any;
      const tz = AUST_TZ || "Australia/Brisbane";
      const iso = (req.query.iso as string) || new Date().toISOString();
      const speak =
        typeof speakableTime === "function" ? speakableTime(iso, tz) : iso;
      res.json({ iso, speak, timezone: tz });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Self-test: availability → create → reschedule → cancel (no Twilio)
  // ─────────────────────────────────────────────────────────────
  app.get("/__cliniko/selftest", async (_req: Request, res: Response) => {
    const phone = process.env.TEST_PHONE || "+61400000000";
    const results: Record<string, any> = { timestamp: new Date().toISOString() };

    try {
      const {
        getAvailability,
        getPatientAppointments,
        createAppointmentForPatient,
        rescheduleAppointment,
        cancelAppointment,
      } = await lazyCliniko();

      const nowIso = new Date().toISOString();
      const plus1d = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const avail = await getAvailability({ fromIso: nowIso, toIso: plus1d, part: "any" });
      results.availability = avail.slice(0, 3);

      const appts = await getPatientAppointments(phone);
      results.appointments = appts;

      if (avail.length) {
        const testSlot = avail[0].startIso;
        const created = await createAppointmentForPatient(phone, {
          practitionerId: process.env.CLINIKO_PRACTITIONER_ID || "",
          appointmentTypeId: process.env.CLINIKO_APPT_TYPE_ID || "",
          businessId: process.env.CLINIKO_BUSINESS_ID || "",
          startsAt: testSlot,
        });
        results.created = { id: created.id, starts_at: created.starts_at };

        const newTime = new Date(new Date(testSlot).getTime() + 30 * 60 * 1000).toISOString();
        await rescheduleAppointment(created.id, newTime);
        results.rescheduled = newTime;

        await cancelAppointment(created.id);
        results.cancelled = true;
      }

      results.ok = true;
      res.json(results);
    } catch (err: any) {
      console.error("[SELFTEST][ERROR]", err);
      res.status(500).json({ ok: false, error: err.message || String(err), stack: err.stack });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Recording proxy (stream & download) using Twilio credentials
  // ─────────────────────────────────────────────────────────────
  app.get("/api/recordings/:sid/stream", async (req: Request, res: Response) => {
    try {
      const fetch = (await import("node-fetch")).default as any;
      const { Readable } = await import("stream");
      const sid = req.params.sid;

      const acc = process.env.TWILIO_ACCOUNT_SID;
      const tok = process.env.TWILIO_AUTH_TOKEN;
      if (!acc || !tok) {
        return res.status(500).json({ error: "Twilio credentials not configured" });
      }
      const url = `https://api.twilio.com/2010-04-01/Accounts/${acc}/Recordings/${sid}.mp3`;
      const auth = Buffer.from(`${acc}:${tok}`).toString("base64");

      const tw = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!tw.ok) {
        return res.status(tw.status).json({ error: `Twilio error ${tw.status}` });
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Accept-Ranges", "bytes");
      // @ts-ignore - Node18 Readable.fromWeb is available
      Readable.fromWeb(tw.body as any).pipe(res);
    } catch (err: any) {
      console.error("[RECORDING STREAM ERROR]", err);
      if (!res.headersSent) res.status(500).json({ error: err.message || "Stream failed" });
    }
  });

  app.get("/api/recordings/:sid/download", async (req: Request, res: Response) => {
    try {
      const fetch = (await import("node-fetch")).default as any;
      const { Readable } = await import("stream");
      const sid = req.params.sid;

      const acc = process.env.TWILIO_ACCOUNT_SID;
      const tok = process.env.TWILIO_AUTH_TOKEN;
      if (!acc || !tok) {
        return res.status(500).json({ error: "Twilio credentials not configured" });
      }
      const url = `https://api.twilio.com/2010-04-01/Accounts/${acc}/Recordings/${sid}.mp3`;
      const auth = Buffer.from(`${acc}:${tok}`).toString("base64");

      const tw = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!tw.ok) {
        return res.status(tw.status).json({ error: `Twilio error ${tw.status}` });
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${sid}.mp3"`);
      // @ts-ignore
      Readable.fromWeb(tw.body as any).pipe(res);
    } catch (err: any) {
      console.error("[RECORDING DOWNLOAD ERROR]", err);
      if (!res.headersSent) res.status(500).json({ error: err.message || "Download failed" });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Simple HTML Dashboard (no frontend build required)
  // ─────────────────────────────────────────────────────────────
  app.get("/__cliniko/dashboard", (_req: Request, res: Response) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cliniko IVR Dashboard</title>
<style>
  :root{--bg:#0b1020;--card:#121935;--ink:#e9eefc;--muted:#a9b2d6;--ok:#40d486;--bad:#ff6b6b;--acc:#7aa2ff}
  html,body{background:var(--bg);color:var(--ink);font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:0}
  .wrap{max-width:980px;margin:32px auto;padding:0 16px}
  h1{font-weight:700;letter-spacing:.2px}
  .grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
  .card{background:var(--card);border-radius:16px;padding:16px;box-shadow:0 6px 18px rgba(0,0,0,.25)}
  .k{font-size:12px;color:var(--muted)}
  .v{font-weight:600}
  button{background:var(--acc);color:#08112a;border:0;border-radius:12px;padding:10px 14px;font-weight:700;cursor:pointer}
  button:disabled{opacity:.5;cursor:not-allowed}
  code,pre{background:#0d1328;color:#d8e1ff;border-radius:8px;padding:6px 8px;display:block;white-space:pre-wrap}
  .ok{color:var(--ok)} .bad{color:var(--bad)}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .mono{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}
</style>
</head>
<body>
<div class="wrap">
  <h1>Cliniko IVR Dashboard</h1>

  <div class="grid">
    <div class="card">
      <h3>Environment</h3>
      <div id="env" class="mono k">Loading…</div>
      <div class="row" style="margin-top:8px">
        <button onclick="loadEnv()">Refresh</button>
      </div>
    </div>

    <div class="card">
      <h3>Timezone</h3>
      <div id="tz" class="mono k">Loading…</div>
      <div class="row" style="margin-top:8px">
        <button onclick="loadTZ()">Refresh</button>
      </div>
    </div>

    <div class="card">
      <h3>Availability Probe</h3>
      <div class="row">
        <select id="day">
          <option value="today">today</option>
          <option value="tomorrow" selected>tomorrow</option>
        </select>
        <select id="part">
          <option value="">any</option>
          <option value="morning">morning</option>
          <option value="afternoon">afternoon</option>
        </select>
        <button onclick="probeAvail()">Check</button>
      </div>
      <pre id="avail" class="mono k" style="margin-top:8px">Loading…</pre>
    </div>

    <div class="card">
      <h3>Self Test</h3>
      <div class="row">
        <button onclick="runSelftest()">Run end-to-end</button>
      </div>
      <pre id="selftest" class="mono k" style="margin-top:8px">Ready.</pre>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <h3>Raw Endpoints</h3>
    <ul class="k">
      <li><a href="/__cliniko/health" target="_blank">/__cliniko/health</a></li>
      <li><a href="/__tz/now" target="_blank">/__tz/now</a></li>
      <li><a href="/__cliniko/avail" target="_blank">/__cliniko/avail</a></li>
      <li><a href="/__cliniko/selftest" target="_blank">/__cliniko/selftest</a></li>
    </ul>
  </div>
</div>
<script>
async function loadEnv(){
  const r=await fetch('/__cliniko/health'); const j=await r.json();
  const ok = j.ok ? '<span class="ok">OK</span>' : '<span class="bad">MISSING</span>';
  document.getElementById('env').innerHTML =
    'status: '+ ok + '\\n' +
    'region: ' + j.region + '\\n' +
    'businessId: ' + (j.businessId||'(none)') + '\\n' +
    'practitionerId: ' + (j.practitionerId||'(none)') + '\\n' +
    'apptTypeId: ' + (j.apptTypeId||'(none)') + '\\n' +
    'time: ' + j.timestamp;
}
async function loadTZ(){
  const r=await fetch('/__tz/now'); const j=await r.json();
  document.getElementById('tz').textContent = JSON.stringify(j,null,2);
}
async function probeAvail(){
  const day=document.getElementById('day').value;
  const part=document.getElementById('part').value;
  const q = new URLSearchParams({ day, ...(part?{part}:{}) });
  const r=await fetch('/__cliniko/avail?'+q.toString()); const j=await r.json();
  document.getElementById('avail').textContent = JSON.stringify(j,null,2);
}
async function runSelftest(){
  document.getElementById('selftest').textContent='Running…';
  const r=await fetch('/__cliniko/selftest'); const j=await r.json();
  document.getElementById('selftest').textContent = JSON.stringify(j,null,2);
}
loadEnv(); loadTZ(); probeAvail();
</script>
</body>
</html>`);
  });
}