// server/index.ts
// NOTE: On Replit Deployments, env vars are injected; no dotenv needed.
import express from "express";
import cors from "cors";
import { registerVoice } from "./routes/voice";

const app = express();

// ----------------------------------------------------------------------------
// 🔐 Twilio webhooks MUST be mounted BEFORE any body parsers.
//   (Twilio's middleware needs access to the raw request body for HMAC.)
// ----------------------------------------------------------------------------
registerVoice(app);

// ----------------------------------------------------------------------------
// The rest of your app middleware/parsers
// ----------------------------------------------------------------------------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// Simple health check
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, env: process.env.NODE_ENV || "development" });
});

// Optional root
app.get("/", (_req, res) => {
  res.type("text/plain").send("OK");
});

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
(async () => {
  try {
    const port = Number(process.env.PORT) || 5000;
    app.listen(port, () => {
      const isDev = process.env.NODE_ENV !== "production";
      const skipValidation =
        isDev || process.env.DISABLE_TWILIO_VALIDATION === "true";

      console.log(`[express] serving on port ${port}`);
      console.log(
        `[twilio] NODE_ENV=${process.env.NODE_ENV || "development"} | DISABLE_TWILIO_VALIDATION=${process.env.DISABLE_TWILIO_VALIDATION || "false"} | validate=${!skipValidation}`
      );
      console.log(`[twilio] Incoming webhook path: POST /api/voice/incoming`);
      console.log(`[twilio] Test handler path:     POST /api/voice/test`);
    });
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
})();

// Safety logs
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

export default app;