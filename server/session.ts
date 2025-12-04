/**
 * Session Configuration
 * Sets up express-session with PostgreSQL storage
 */

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";

// Create PostgreSQL connection pool for sessions
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Create connect-pg-simple store
const PgSession = connectPgSimple(session);

// Session configuration
export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "sessions",
    createTableIfMissing: false, // We create table via migration
  }),
  secret: process.env.SESSION_SECRET || "echo-desk-dev-secret-change-in-production",
  resave: false,
  saveUninitialized: false,
  name: "echodesk.sid",
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
});

// Warn if using default secret in production
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.warn("[Session] WARNING: Using default session secret in production! Set SESSION_SECRET environment variable.");
}
