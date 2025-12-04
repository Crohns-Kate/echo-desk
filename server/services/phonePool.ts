/**
 * Phone Number Pool Service
 * Manages pre-provisioned Twilio numbers for instant tenant assignment
 */

import twilio from "twilio";
import { db } from "../db";
import { phoneNumberPool, tenants } from "../../shared/schema";
import { eq, and, isNull, sql, asc } from "drizzle-orm";
import type { PhoneNumberPoolEntry, Tenant } from "../../shared/schema";
import { env } from "../utils/env";

// Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Australia-specific configuration
const TWILIO_CONFIG = {
  country: "AU",
  numberTypes: ["local"] as const,
  areaCodes: ["02", "03", "07", "08"], // NSW, VIC, QLD, SA/WA
  defaultAreaCode: "02", // Sydney/NSW default
};

// Pool configuration
const POOL_CONFIG = {
  targetPoolSize: 20, // Maintain 20 available numbers
  quarantineDays: 30, // 30-day quarantine before reuse
  lowPoolThreshold: 5, // Warn when pool drops below this
};

export interface ProvisionResult {
  success: boolean;
  phoneNumber?: string;
  twilioPhoneSid?: string;
  error?: string;
}

export interface AssignResult {
  success: boolean;
  phoneNumber?: string;
  error?: string;
}

/**
 * Get pool statistics
 */
export async function getPoolStats(): Promise<{
  available: number;
  assigned: number;
  releasing: number;
  total: number;
  byAreaCode: Record<string, { available: number; assigned: number }>;
}> {
  const numbers = await db.select().from(phoneNumberPool);

  const stats = {
    available: 0,
    assigned: 0,
    releasing: 0,
    total: numbers.length,
    byAreaCode: {} as Record<string, { available: number; assigned: number }>,
  };

  for (const num of numbers) {
    if (num.status === "available") stats.available++;
    if (num.status === "assigned") stats.assigned++;
    if (num.status === "releasing") stats.releasing++;

    const areaCode = num.areaCode || "unknown";
    if (!stats.byAreaCode[areaCode]) {
      stats.byAreaCode[areaCode] = { available: 0, assigned: 0 };
    }
    if (num.status === "available") stats.byAreaCode[areaCode].available++;
    if (num.status === "assigned") stats.byAreaCode[areaCode].assigned++;
  }

  return stats;
}

/**
 * Provision a new number from Twilio and add to pool
 */
export async function provisionNewNumber(
  areaCode?: string,
  tenantId?: number
): Promise<ProvisionResult> {
  const targetAreaCode = areaCode || TWILIO_CONFIG.defaultAreaCode;

  try {
    // Search for available numbers in Australia
    const availableNumbers = await twilioClient
      .availablePhoneNumbers("AU")
      .local.list({
        areaCode: parseInt(targetAreaCode),
        limit: 5,
      });

    if (availableNumbers.length === 0) {
      // Try without area code filter
      const anyNumbers = await twilioClient
        .availablePhoneNumbers("AU")
        .local.list({ limit: 5 });

      if (anyNumbers.length === 0) {
        return {
          success: false,
          error: "No Australian phone numbers available from Twilio",
        };
      }

      // Use first available
      availableNumbers.push(...anyNumbers);
    }

    const selectedNumber = availableNumbers[0];

    // Purchase the number
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: selectedNumber.phoneNumber,
      friendlyName: tenantId
        ? `Echo Desk - Tenant ${tenantId}`
        : "Echo Desk - Pool",
      voiceUrl: `${env.PUBLIC_BASE_URL}/api/voice/incoming`,
      voiceMethod: "POST",
      smsUrl: `${env.PUBLIC_BASE_URL}/api/sms/incoming`,
      smsMethod: "POST",
      statusCallback: `${env.PUBLIC_BASE_URL}/api/voice/status`,
      statusCallbackMethod: "POST",
    });

    // Extract area code from phone number (Australian format: +61 X XXXX XXXX)
    const phoneAreaCode = extractAreaCode(purchasedNumber.phoneNumber);

    // Add to pool
    const [poolEntry] = await db
      .insert(phoneNumberPool)
      .values({
        phoneNumber: purchasedNumber.phoneNumber,
        twilioPhoneSid: purchasedNumber.sid,
        areaCode: phoneAreaCode,
        status: tenantId ? "assigned" : "available",
        tenantId: tenantId || null,
        assignedAt: tenantId ? new Date() : null,
      })
      .returning();

    console.log(
      `[PhonePool] Provisioned new number: ${purchasedNumber.phoneNumber} (${phoneAreaCode})`
    );

    return {
      success: true,
      phoneNumber: purchasedNumber.phoneNumber,
      twilioPhoneSid: purchasedNumber.sid,
    };
  } catch (error) {
    console.error("[PhonePool] Failed to provision number:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to provision number",
    };
  }
}

/**
 * Assign an available number from the pool to a tenant
 */
export async function assignNumberToTenant(
  tenantId: number,
  preferredAreaCode?: string
): Promise<AssignResult> {
  try {
    // First, try to find an available number with preferred area code
    let availableNumber: PhoneNumberPoolEntry | undefined;

    if (preferredAreaCode) {
      const [preferred] = await db
        .select()
        .from(phoneNumberPool)
        .where(
          and(
            eq(phoneNumberPool.status, "available"),
            eq(phoneNumberPool.areaCode, preferredAreaCode)
          )
        )
        .orderBy(asc(phoneNumberPool.createdAt))
        .limit(1);
      availableNumber = preferred;
    }

    // If no preferred area code match, get any available
    if (!availableNumber) {
      const [any] = await db
        .select()
        .from(phoneNumberPool)
        .where(eq(phoneNumberPool.status, "available"))
        .orderBy(asc(phoneNumberPool.createdAt))
        .limit(1);
      availableNumber = any;
    }

    // If pool is empty, provision a new number
    if (!availableNumber) {
      console.log("[PhonePool] Pool empty, provisioning new number...");
      const result = await provisionNewNumber(preferredAreaCode, tenantId);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, phoneNumber: result.phoneNumber };
    }

    // Assign the number to the tenant
    await db
      .update(phoneNumberPool)
      .set({
        status: "assigned",
        tenantId,
        assignedAt: new Date(),
      })
      .where(eq(phoneNumberPool.id, availableNumber.id));

    // Update the tenant's phone number
    await db
      .update(tenants)
      .set({
        phoneNumber: availableNumber.phoneNumber,
        twilioPhoneSid: availableNumber.twilioPhoneSid,
        phoneSetupType: "provisioned",
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    // Update Twilio webhook URLs for this tenant
    await updateTwilioWebhooks(availableNumber.twilioPhoneSid, tenantId);

    console.log(
      `[PhonePool] Assigned ${availableNumber.phoneNumber} to tenant ${tenantId}`
    );

    // Check pool level and warn if low
    const stats = await getPoolStats();
    if (stats.available < POOL_CONFIG.lowPoolThreshold) {
      console.warn(
        `[PhonePool] WARNING: Pool running low! Only ${stats.available} numbers available.`
      );
    }

    return { success: true, phoneNumber: availableNumber.phoneNumber };
  } catch (error) {
    console.error("[PhonePool] Failed to assign number:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to assign number",
    };
  }
}

/**
 * Release a number back to the pool (with quarantine)
 */
export async function releaseNumber(tenantId: number): Promise<{ success: boolean; error?: string }> {
  try {
    // Find the number assigned to this tenant
    const [assignedNumber] = await db
      .select()
      .from(phoneNumberPool)
      .where(
        and(
          eq(phoneNumberPool.tenantId, tenantId),
          eq(phoneNumberPool.status, "assigned")
        )
      )
      .limit(1);

    if (!assignedNumber) {
      return { success: true }; // No number to release
    }

    // Calculate quarantine end date
    const quarantineEndsAt = new Date();
    quarantineEndsAt.setDate(
      quarantineEndsAt.getDate() + POOL_CONFIG.quarantineDays
    );

    // Mark as releasing
    await db
      .update(phoneNumberPool)
      .set({
        status: "releasing",
        tenantId: null,
        releasedAt: new Date(),
        quarantineEndsAt,
      })
      .where(eq(phoneNumberPool.id, assignedNumber.id));

    // Clear tenant's phone number
    await db
      .update(tenants)
      .set({
        phoneNumber: null,
        twilioPhoneSid: null,
        phoneSetupType: "pending",
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    // Update Twilio to play "number not in service" message
    await updateTwilioWebhooksForQuarantine(assignedNumber.twilioPhoneSid);

    console.log(
      `[PhonePool] Released ${assignedNumber.phoneNumber} from tenant ${tenantId} (quarantine until ${quarantineEndsAt.toISOString()})`
    );

    return { success: true };
  } catch (error) {
    console.error("[PhonePool] Failed to release number:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to release number",
    };
  }
}

/**
 * Process quarantine - move numbers from releasing to available
 * Should be called by a cron job daily
 */
export async function processQuarantine(): Promise<number> {
  try {
    const now = new Date();

    // Find numbers whose quarantine has ended
    const result = await db
      .update(phoneNumberPool)
      .set({ status: "available" })
      .where(
        and(
          eq(phoneNumberPool.status, "releasing"),
          sql`${phoneNumberPool.quarantineEndsAt} <= ${now}`
        )
      )
      .returning();

    if (result.length > 0) {
      console.log(
        `[PhonePool] Released ${result.length} numbers from quarantine`
      );

      // Update Twilio webhooks for each to point to generic handler
      for (const num of result) {
        await updateTwilioWebhooksForPool(num.twilioPhoneSid);
      }
    }

    return result.length;
  } catch (error) {
    console.error("[PhonePool] Failed to process quarantine:", error);
    return 0;
  }
}

/**
 * Replenish the pool to target size
 */
export async function replenishPool(): Promise<{ added: number; errors: string[] }> {
  const stats = await getPoolStats();
  const needed = POOL_CONFIG.targetPoolSize - stats.available;

  if (needed <= 0) {
    return { added: 0, errors: [] };
  }

  console.log(`[PhonePool] Replenishing pool: need ${needed} numbers`);

  let added = 0;
  const errors: string[] = [];

  // Distribute across area codes
  const numbersPerAreaCode = Math.ceil(needed / TWILIO_CONFIG.areaCodes.length);

  for (const areaCode of TWILIO_CONFIG.areaCodes) {
    const areaStats = stats.byAreaCode[areaCode] || { available: 0 };
    const areaNeeded = Math.min(
      numbersPerAreaCode,
      Math.max(0, 5 - areaStats.available) // Aim for at least 5 per area code
    );

    for (let i = 0; i < areaNeeded && added < needed; i++) {
      const result = await provisionNewNumber(areaCode);
      if (result.success) {
        added++;
      } else {
        errors.push(`${areaCode}: ${result.error}`);
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`[PhonePool] Replenished: added ${added} numbers`);
  if (errors.length > 0) {
    console.warn(`[PhonePool] Replenish errors:`, errors);
  }

  return { added, errors };
}

/**
 * Update Twilio webhooks for a tenant's number
 */
async function updateTwilioWebhooks(
  twilioPhoneSid: string,
  tenantId: number
): Promise<void> {
  try {
    await twilioClient.incomingPhoneNumbers(twilioPhoneSid).update({
      friendlyName: `Echo Desk - Tenant ${tenantId}`,
      voiceUrl: `${env.PUBLIC_BASE_URL}/api/voice/incoming?tenantId=${tenantId}`,
      smsUrl: `${env.PUBLIC_BASE_URL}/api/sms/incoming?tenantId=${tenantId}`,
    });
  } catch (error) {
    console.error(
      `[PhonePool] Failed to update Twilio webhooks for ${twilioPhoneSid}:`,
      error
    );
  }
}

/**
 * Update Twilio webhooks for quarantine (plays "not in service" message)
 */
async function updateTwilioWebhooksForQuarantine(
  twilioPhoneSid: string
): Promise<void> {
  try {
    await twilioClient.incomingPhoneNumbers(twilioPhoneSid).update({
      friendlyName: "Echo Desk - Quarantine",
      voiceUrl: `${env.PUBLIC_BASE_URL}/api/voice/quarantine`,
      smsUrl: `${env.PUBLIC_BASE_URL}/api/sms/quarantine`,
    });
  } catch (error) {
    console.error(
      `[PhonePool] Failed to update Twilio webhooks for quarantine:`,
      error
    );
  }
}

/**
 * Update Twilio webhooks for pool (generic handler)
 */
async function updateTwilioWebhooksForPool(
  twilioPhoneSid: string
): Promise<void> {
  try {
    await twilioClient.incomingPhoneNumbers(twilioPhoneSid).update({
      friendlyName: "Echo Desk - Pool (Available)",
      voiceUrl: `${env.PUBLIC_BASE_URL}/api/voice/incoming`,
      smsUrl: `${env.PUBLIC_BASE_URL}/api/sms/incoming`,
    });
  } catch (error) {
    console.error(
      `[PhonePool] Failed to update Twilio webhooks for pool:`,
      error
    );
  }
}

/**
 * Extract area code from Australian phone number
 * Format: +61 X XXXX XXXX where X is the area code
 */
function extractAreaCode(phoneNumber: string): string {
  // Remove +61 prefix and get first digit
  const cleaned = phoneNumber.replace(/\+61\s*/, "");
  const areaCode = cleaned.charAt(0);

  // Australian area codes are 02, 03, 07, 08
  if (["2", "3", "7", "8"].includes(areaCode)) {
    return "0" + areaCode;
  }

  // Mobile numbers start with 4
  if (areaCode === "4") {
    return "04";
  }

  return "02"; // Default to Sydney
}

/**
 * Get all numbers in the pool (for admin)
 */
export async function getAllPoolNumbers(): Promise<PhoneNumberPoolEntry[]> {
  return db.select().from(phoneNumberPool).orderBy(asc(phoneNumberPool.createdAt));
}

/**
 * Delete a number from pool (also releases from Twilio)
 */
export async function deleteFromPool(
  poolId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const [number] = await db
      .select()
      .from(phoneNumberPool)
      .where(eq(phoneNumberPool.id, poolId))
      .limit(1);

    if (!number) {
      return { success: false, error: "Number not found in pool" };
    }

    if (number.status === "assigned") {
      return { success: false, error: "Cannot delete assigned number" };
    }

    // Release from Twilio
    await twilioClient.incomingPhoneNumbers(number.twilioPhoneSid).remove();

    // Remove from database
    await db.delete(phoneNumberPool).where(eq(phoneNumberPool.id, poolId));

    console.log(`[PhonePool] Deleted ${number.phoneNumber} from pool and Twilio`);

    return { success: true };
  } catch (error) {
    console.error("[PhonePool] Failed to delete number:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete number",
    };
  }
}
