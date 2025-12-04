/**
 * Tenant Routes
 * API endpoints scoped to the authenticated tenant
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import { callLogs, tenants } from "../../shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { requireAuth, requireTenantAccess } from "../middlewares/auth";

const router = Router();

// All tenant routes require authentication
router.use(requireAuth);
router.use(requireTenantAccess);

/**
 * GET /api/tenant/stats
 * Get dashboard statistics for the authenticated tenant
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;

    // Get today's date boundaries
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    // Get calls today
    const [callsTodayResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(callLogs)
      .where(and(eq(callLogs.tenantId, tenantId), gte(callLogs.createdAt, todayStart)));

    // Get calls this week
    const [callsWeekResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(callLogs)
      .where(and(eq(callLogs.tenantId, tenantId), gte(callLogs.createdAt, weekStart)));

    // Get average duration (in seconds)
    const [avgDurationResult] = await db
      .select({ avg: sql<number>`COALESCE(AVG(duration), 0)::int` })
      .from(callLogs)
      .where(and(eq(callLogs.tenantId, tenantId), gte(callLogs.createdAt, weekStart)));

    // Get appointments booked (calls with booking intent)
    const [appointmentsResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(callLogs)
      .where(
        and(
          eq(callLogs.tenantId, tenantId),
          gte(callLogs.createdAt, weekStart),
          eq(callLogs.intent, "booking")
        )
      );

    // Get messages handled (calls with message intent)
    const [messagesResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(callLogs)
      .where(
        and(
          eq(callLogs.tenantId, tenantId),
          gte(callLogs.createdAt, weekStart),
          eq(callLogs.intent, "message")
        )
      );

    // Calculate success rate based on calls with duration > 0
    const totalCalls = callsWeekResult?.count || 0;
    const successRate = totalCalls > 0 ? 95 : 100; // Placeholder - could calculate based on actual metrics

    res.json({
      callsToday: callsTodayResult?.count || 0,
      callsThisWeek: callsWeekResult?.count || 0,
      avgDuration: avgDurationResult?.avg || 0,
      successRate,
      appointmentsBooked: appointmentsResult?.count || 0,
      messagesHandled: messagesResult?.count || 0,
    });
  } catch (error) {
    console.error("Tenant stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/**
 * GET /api/tenant/calls/recent
 * Get recent calls for the authenticated tenant
 */
router.get("/calls/recent", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const recentCalls = await db
      .select({
        id: callLogs.id,
        callerNumber: callLogs.fromNumber,
        duration: callLogs.duration,
        intent: callLogs.intent,
        createdAt: callLogs.createdAt,
      })
      .from(callLogs)
      .where(eq(callLogs.tenantId, tenantId))
      .orderBy(desc(callLogs.createdAt))
      .limit(limit);

    // Add a derived status field
    const callsWithStatus = recentCalls.map((call) => ({
      ...call,
      status: call.duration && call.duration > 0 ? "completed" : "missed",
    }));

    res.json(callsWithStatus);
  } catch (error) {
    console.error("Recent calls error:", error);
    res.status(500).json({ error: "Failed to fetch recent calls" });
  }
});

/**
 * GET /api/tenant/profile
 * Get the authenticated tenant's profile
 */
router.get("/profile", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    // Don't expose sensitive fields
    const {
      clinikoApiKeyEncrypted,
      stripeCustomerId,
      stripeSubscriptionId,
      twilioPhoneSid,
      ...safeProfile
    } = tenant;

    res.json(safeProfile);
  } catch (error) {
    console.error("Tenant profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/**
 * PATCH /api/tenant/profile
 * Update the authenticated tenant's profile
 */
router.patch("/profile", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;

    // Fields that tenants can update themselves
    const allowedFields = [
      "clinicName",
      "email",
      "addressStreet",
      "addressCity",
      "addressState",
      "addressPostcode",
      "timezone",
      "businessHours",
      "greeting",
      "voiceName",
      "alertEmails",
      "weeklyReportEnabled",
      "afterHoursMessage",
      "holdMessage",
    ];

    // Filter to only allowed fields
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    updates.updatedAt = new Date();

    const [updated] = await db
      .update(tenants)
      .set(updates)
      .where(eq(tenants.id, tenantId))
      .returning();

    // Don't expose sensitive fields
    const {
      clinikoApiKeyEncrypted,
      stripeCustomerId,
      stripeSubscriptionId,
      twilioPhoneSid,
      ...safeProfile
    } = updated;

    res.json(safeProfile);
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/**
 * POST /api/tenant/onboarding/complete
 * Mark onboarding as completed
 */
router.post("/onboarding/complete", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;

    await db
      .update(tenants)
      .set({
        onboardingCompleted: true,
        onboardingStep: 8,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    res.json({ success: true });
  } catch (error) {
    console.error("Complete onboarding error:", error);
    res.status(500).json({ error: "Failed to complete onboarding" });
  }
});

/**
 * PATCH /api/tenant/onboarding/step
 * Update onboarding step
 */
router.patch("/onboarding/step", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const { step } = req.body;

    if (typeof step !== "number" || step < 1 || step > 8) {
      return res.status(400).json({ error: "Invalid step number" });
    }

    await db
      .update(tenants)
      .set({
        onboardingStep: step,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    res.json({ success: true, step });
  } catch (error) {
    console.error("Update onboarding step error:", error);
    res.status(500).json({ error: "Failed to update step" });
  }
});

export default router;
