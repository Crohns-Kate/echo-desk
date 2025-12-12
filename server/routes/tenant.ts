/**
 * Tenant Routes
 * API endpoints scoped to the authenticated tenant
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import { callLogs, tenants, practitioners } from "../../shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { requireAuth, requireTenantAccess } from "../middlewares/auth";
import { storage } from "../storage";
import { getPractitioners } from "../services/cliniko";
import { getTenantContext } from "../services/tenantResolver";

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
      "address",
      "addressStreet",
      "addressCity",
      "addressState",
      "addressPostcode",
      "googleMapsUrl",
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

// =====================================================
// Practitioner Management Routes
// =====================================================

/**
 * GET /api/tenant/practitioners
 * List all practitioners for the authenticated tenant
 */
router.get("/practitioners", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const practitionerList = await storage.listPractitioners(tenantId);
    res.json(practitionerList);
  } catch (error) {
    console.error("List practitioners error:", error);
    res.status(500).json({ error: "Failed to fetch practitioners" });
  }
});

/**
 * POST /api/tenant/practitioners
 * Create a new practitioner for the authenticated tenant
 */
router.post("/practitioners", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const { name, clinikoPractitionerId, isDefault } = req.body;

    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }

    const practitioner = await storage.createPractitioner(tenantId, {
      name: name.trim(),
      clinikoPractitionerId: clinikoPractitionerId?.trim() || undefined,
      isDefault: Boolean(isDefault),
    });

    res.status(201).json(practitioner);
  } catch (error) {
    console.error("Create practitioner error:", error);
    res.status(500).json({ error: "Failed to create practitioner" });
  }
});

/**
 * PATCH /api/tenant/practitioners/:id
 * Update a practitioner
 */
router.patch("/practitioners/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const practitionerId = parseInt(req.params.id);

    // Verify practitioner belongs to this tenant
    const existing = await storage.getPractitionerById(practitionerId);
    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "Practitioner not found" });
    }

    const { name, clinikoPractitionerId, isActive, isDefault, schedule } = req.body;
    const updates: Record<string, any> = {};

    if (name !== undefined) updates.name = name.trim();
    if (clinikoPractitionerId !== undefined) updates.clinikoPractitionerId = clinikoPractitionerId?.trim() || null;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (isDefault !== undefined) updates.isDefault = Boolean(isDefault);
    if (schedule !== undefined) updates.schedule = schedule;

    const practitioner = await storage.updatePractitioner(practitionerId, updates);
    res.json(practitioner);
  } catch (error) {
    console.error("Update practitioner error:", error);
    res.status(500).json({ error: "Failed to update practitioner" });
  }
});

/**
 * DELETE /api/tenant/practitioners/:id
 * Delete a practitioner
 */
router.delete("/practitioners/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const practitionerId = parseInt(req.params.id);

    // Verify practitioner belongs to this tenant
    const existing = await storage.getPractitionerById(practitionerId);
    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "Practitioner not found" });
    }

    const deleted = await storage.deletePractitioner(practitionerId);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: "Failed to delete practitioner" });
    }
  } catch (error) {
    console.error("Delete practitioner error:", error);
    res.status(500).json({ error: "Failed to delete practitioner" });
  }
});

/**
 * POST /api/tenant/cliniko/sync-practitioners
 * Sync practitioners from Cliniko into the local database
 * Upserts by clinikoPractitionerId, preserves custom display names
 */
router.post("/cliniko/sync-practitioners", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const tenant = await storage.getTenantById(tenantId);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    // Get tenant context for Cliniko API
    const tenantCtx = getTenantContext(tenant);

    if (!tenantCtx.cliniko?.apiKey) {
      return res.status(400).json({ error: "Cliniko API key not configured for this tenant" });
    }

    console.log(`[TENANT][SYNC] Syncing practitioners for tenant ${tenant.slug}`);

    // Fetch practitioners from Cliniko
    const clinikoPractitioners = await getPractitioners(tenantCtx);

    console.log(`[TENANT][SYNC] Found ${clinikoPractitioners.length} practitioners in Cliniko`);

    // Get existing practitioners from DB
    const existingPractitioners = await storage.listPractitioners(tenantId);
    const existingByClinikoId = new Map(
      existingPractitioners
        .filter(p => p.clinikoPractitionerId)
        .map(p => [p.clinikoPractitionerId, p])
    );

    const results = {
      created: 0,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      practitioners: [] as Array<{ name: string; clinikoPractitionerId: string; action: string }>
    };

    // Upsert each Cliniko practitioner
    const syncedClinikoIds = new Set<string>();
    for (const cp of clinikoPractitioners) {
      syncedClinikoIds.add(cp.id);

      const displayName = `${cp.first_name} ${cp.last_name}`.trim();
      const existing = existingByClinikoId.get(cp.id);

      if (existing) {
        // Update if inactive (reactivate)
        if (!existing.isActive) {
          await storage.updatePractitioner(existing.id, { isActive: true });
          results.updated++;
          results.practitioners.push({ name: displayName, clinikoPractitionerId: cp.id, action: 'reactivated' });
        } else {
          results.unchanged++;
          results.practitioners.push({ name: displayName, clinikoPractitionerId: cp.id, action: 'unchanged' });
        }
        // Note: We preserve existing display name - don't overwrite customized names
      } else {
        // Create new practitioner
        await storage.createPractitioner(tenantId, {
          name: displayName,
          clinikoPractitionerId: cp.id,
          isDefault: clinikoPractitioners.length === 1 // Default if only one
        });
        results.created++;
        results.practitioners.push({ name: displayName, clinikoPractitionerId: cp.id, action: 'created' });
      }
    }

    // Optionally deactivate practitioners not in Cliniko (query param: ?deactivateMissing=true)
    if (req.query.deactivateMissing === 'true') {
      for (const existing of existingPractitioners) {
        if (existing.clinikoPractitionerId && !syncedClinikoIds.has(existing.clinikoPractitionerId) && existing.isActive) {
          await storage.updatePractitioner(existing.id, { isActive: false });
          results.deactivated++;
          results.practitioners.push({
            name: existing.name,
            clinikoPractitionerId: existing.clinikoPractitionerId,
            action: 'deactivated'
          });
        }
      }
    }

    console.log(`[TENANT][SYNC] Sync complete:`, results);

    res.json({
      success: true,
      message: `Synced ${clinikoPractitioners.length} practitioners from Cliniko`,
      results
    });
  } catch (error: any) {
    console.error("Cliniko sync error:", error);
    res.status(500).json({
      error: "Failed to sync practitioners from Cliniko",
      details: error.message
    });
  }
});

export default router;
