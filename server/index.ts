// server/index.ts
// NOTE: No dotenv needed on Replit Deployments (envs injected).
import express from "express";
import cors from "cors";
import { registerVoice } from "./routes/voice";

const app = express();

/**
 * 🛑 IMPORTANT: Mount Twilio routes BEFORE any body parsers.
 * Twilio’s HMAC validation requires the raw request body.
 */
registerVoice(app);

// Parsers and other middleware for the rest of your app
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, env: process.env.NODE_ENV || "development" });
});

(async () => {
  try {
    const port = Number(process.env.PORT) || 5000;
    app.listen(port, () => {
      console.log(`[express] serving on port ${port}`);
    });
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
})();

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

export default app;