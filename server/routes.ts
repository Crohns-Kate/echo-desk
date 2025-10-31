import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerVoice } from "./routes/voice";
import { registerApp } from "./routes/app";
import { initializeWebSocket } from "./services/websocket";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database
  await storage.seed();

  // Health check endpoint for Cliniko configuration
  app.get('/__cliniko/health', (_req, res) => {
    res.json({
      region: process.env.CLINIKO_REGION,
      businessId: process.env.CLINIKO_BUSINESS_ID,
      practitionerId: process.env.CLINIKO_PRACTITIONER_ID,
      appointmentTypeId: process.env.CLINIKO_APPT_TYPE_ID,
      ok: true
    });
  });

  // Register Twilio voice webhook routes
  registerVoice(app);

  // Register dashboard API routes
  registerApp(app);

  const httpServer = createServer(app);
  
  // Initialize WebSocket server
  initializeWebSocket(httpServer);

  return httpServer;
}
