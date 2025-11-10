// server/index.ts
// Only load dotenv in development - Replit Deployments inject env vars automatically
if (process.env.NODE_ENV !== "production") {
  await import("dotenv/config");
}
import express from "express";
import cors from "cors";

// Your local modules
import { registerVoice } from "./routes/voice";
// DEV MODE: Comment out storage import to run minimal server without DB
// import { storage } from "./storage";

// --- App setup ---
const app = express();

// Use Express’ built-in parsers (avoids body-parser CJS dynamic require issues)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// CORS (adjust origin as needed)
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

// Register routes (Twilio voice etc.)
registerVoice(app);

// --- Robust startup, no top-level await ---
(async () => {
  try {
    // DEV MODE: Skip storage initialization in minimal mode
    // if (typeof (storage as any)?.init === "function") {
    //   await (storage as any).init();
    // }

    const port = Number(process.env.PORT) || 5000;
    app.listen(port, () => {
      console.log(`[express] serving on port ${port}`);
    });
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
})();

// Helpful safety logs
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

export default app;
