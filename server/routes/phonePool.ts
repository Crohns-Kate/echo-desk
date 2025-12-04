/**
 * Phone Pool Admin Routes
 * Manage pre-provisioned Twilio numbers
 */

import { Router, Request, Response } from "express";
import {
  getPoolStats,
  getAllPoolNumbers,
  provisionNewNumber,
  assignNumberToTenant,
  releaseNumber,
  processQuarantine,
  replenishPool,
  deleteFromPool,
} from "../services/phonePool";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";
import { logAuditEvent } from "../services/auth";

const router = Router();

// All phone pool routes require super admin access
router.use(requireAuth);
router.use(requireSuperAdmin);

/**
 * GET /api/admin/phone-pool/stats
 * Get pool statistics
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const stats = await getPoolStats();
    res.json(stats);
  } catch (error) {
    console.error("Failed to get pool stats:", error);
    res.status(500).json({ error: "Failed to get pool statistics" });
  }
});

/**
 * GET /api/admin/phone-pool
 * List all numbers in the pool
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const numbers = await getAllPoolNumbers();
    res.json(numbers);
  } catch (error) {
    console.error("Failed to get pool numbers:", error);
    res.status(500).json({ error: "Failed to get pool numbers" });
  }
});

/**
 * POST /api/admin/phone-pool/provision
 * Provision a new number and add to pool
 */
router.post("/provision", async (req: Request, res: Response) => {
  try {
    const { areaCode } = req.body;

    const result = await provisionNewNumber(areaCode);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log audit event
    await logAuditEvent(
      "phone_pool_provision",
      req.user!.id,
      undefined,
      "phone_number_pool",
      undefined,
      undefined,
      { phoneNumber: result.phoneNumber, areaCode },
      req.ip,
      req.headers["user-agent"]
    );

    res.json({
      success: true,
      phoneNumber: result.phoneNumber,
      twilioPhoneSid: result.twilioPhoneSid,
    });
  } catch (error) {
    console.error("Failed to provision number:", error);
    res.status(500).json({ error: "Failed to provision number" });
  }
});

/**
 * POST /api/admin/phone-pool/assign
 * Assign a number to a tenant
 */
router.post("/assign", async (req: Request, res: Response) => {
  try {
    const { tenantId, preferredAreaCode } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    const result = await assignNumberToTenant(tenantId, preferredAreaCode);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log audit event
    await logAuditEvent(
      "phone_pool_assign",
      req.user!.id,
      tenantId,
      "phone_number_pool",
      undefined,
      undefined,
      { phoneNumber: result.phoneNumber, tenantId },
      req.ip,
      req.headers["user-agent"]
    );

    res.json({ success: true, phoneNumber: result.phoneNumber });
  } catch (error) {
    console.error("Failed to assign number:", error);
    res.status(500).json({ error: "Failed to assign number" });
  }
});

/**
 * POST /api/admin/phone-pool/release
 * Release a number from a tenant back to pool
 */
router.post("/release", async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    const result = await releaseNumber(tenantId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log audit event
    await logAuditEvent(
      "phone_pool_release",
      req.user!.id,
      tenantId,
      "phone_number_pool",
      undefined,
      undefined,
      { tenantId },
      req.ip,
      req.headers["user-agent"]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to release number:", error);
    res.status(500).json({ error: "Failed to release number" });
  }
});

/**
 * POST /api/admin/phone-pool/process-quarantine
 * Process quarantined numbers (move to available)
 */
router.post("/process-quarantine", async (req: Request, res: Response) => {
  try {
    const count = await processQuarantine();

    // Log audit event
    await logAuditEvent(
      "phone_pool_process_quarantine",
      req.user!.id,
      undefined,
      "phone_number_pool",
      undefined,
      undefined,
      { releasedCount: count },
      req.ip,
      req.headers["user-agent"]
    );

    res.json({ success: true, releasedCount: count });
  } catch (error) {
    console.error("Failed to process quarantine:", error);
    res.status(500).json({ error: "Failed to process quarantine" });
  }
});

/**
 * POST /api/admin/phone-pool/replenish
 * Replenish pool to target size
 */
router.post("/replenish", async (req: Request, res: Response) => {
  try {
    const result = await replenishPool();

    // Log audit event
    await logAuditEvent(
      "phone_pool_replenish",
      req.user!.id,
      undefined,
      "phone_number_pool",
      undefined,
      undefined,
      { added: result.added, errors: result.errors },
      req.ip,
      req.headers["user-agent"]
    );

    res.json(result);
  } catch (error) {
    console.error("Failed to replenish pool:", error);
    res.status(500).json({ error: "Failed to replenish pool" });
  }
});

/**
 * DELETE /api/admin/phone-pool/:id
 * Delete a number from pool (also releases from Twilio)
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const poolId = parseInt(req.params.id);

    if (isNaN(poolId)) {
      return res.status(400).json({ error: "Invalid pool ID" });
    }

    const result = await deleteFromPool(poolId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log audit event
    await logAuditEvent(
      "phone_pool_delete",
      req.user!.id,
      undefined,
      "phone_number_pool",
      poolId,
      undefined,
      undefined,
      req.ip,
      req.headers["user-agent"]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete number:", error);
    res.status(500).json({ error: "Failed to delete number" });
  }
});

export default router;
