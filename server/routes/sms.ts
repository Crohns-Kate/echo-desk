import { Express, Request, Response } from "express";
import { storage } from "../storage";
import { sendEmailUpdateConfirmation, sendEmailUpdateError } from "../services/sms";

/**
 * SMS webhook routes
 * Handles inbound SMS messages from patients
 */
export function registerSMS(app: Express) {

  /**
   * POST /api/sms/inbound
   * Twilio webhook for incoming SMS messages
   * Handles email collection via SMS replies
   */
  app.post("/api/sms/inbound", async (req: Request, res: Response) => {
    try {
      const from = req.body.From as string; // Patient's phone number
      const body = (req.body.Body as string || '').trim();
      const messageSid = req.body.MessageSid as string;

      console.log('[SMS_INBOUND] 📥 Received SMS');
      console.log('[SMS_INBOUND]   From:', from);
      console.log('[SMS_INBOUND]   Body:', body);
      console.log('[SMS_INBOUND]   MessageSid:', messageSid);

      if (!from || !body) {
        console.warn('[SMS_INBOUND] Missing from or body');
        return res.sendStatus(204);
      }

      // Check if the message looks like an email address
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const possibleEmail = body.toLowerCase().trim();

      if (emailRegex.test(possibleEmail)) {
        console.log('[SMS_INBOUND] 📧 Detected email format:', possibleEmail);

        // Find the most recent call from this number
        const calls = await storage.listCalls(undefined, 50);
        const recentCall = calls.find(call => call.fromNumber === from);

        if (!recentCall) {
          console.log('[SMS_INBOUND] ⚠️  No recent call found for phone:', from);
          await sendEmailUpdateError({
            to: from,
            clinicName: 'Echo Desk',
            reason: 'We couldn\'t find your recent call. Please call us again.'
          });
          return res.sendStatus(204);
        }

        console.log('[SMS_INBOUND] 📞 Found recent call:', recentCall.callSid);

        // Update conversation context with email
        if (recentCall.conversationId) {
          const conversation = await storage.getConversation(recentCall.conversationId);
          const existingContext = (conversation?.context as any) || {};

          await storage.updateConversation(recentCall.conversationId, {
            context: {
              ...existingContext,
              email: possibleEmail,
              emailCollectedViaSMS: true,
              emailCollectedViaInboundSMS: true,
              emailCollectedAt: new Date().toISOString()
            }
          });

          console.log('[SMS_INBOUND] ✅ Updated conversation context with email');

          // Try to update Cliniko patient record
          try {
            const { updateClinikoPatientEmail } = await import('../integrations/cliniko');
            const { findPatientByPhoneRobust } = await import('../services/cliniko');
            const { getTenantContext } = await import('../services/tenantResolver');

            // Get tenant context from the call
            let tenantCtx: ReturnType<typeof getTenantContext> | undefined;
            if (recentCall.tenantId) {
              const tenant = await storage.getTenantById(recentCall.tenantId);
              if (tenant) {
                tenantCtx = getTenantContext(tenant);
              }
            }

            const patient = await findPatientByPhoneRobust(from, tenantCtx);

            if (patient && patient.id) {
              console.log('[SMS_INBOUND] 🔍 Found patient in Cliniko:', patient.id);

              // Only update if this is a returning patient, not a new patient
              // Check if patientMode is 'existing' to avoid overwriting wrong records
              const patientMode = existingContext.patientMode;

              if (patientMode === 'new') {
                console.log('[SMS_INBOUND] ⚠️  Patient is NEW - skipping Cliniko update to prevent data corruption');
                console.log('[SMS_INBOUND]   Email will be set when patient record is created during booking');
              } else {
                await updateClinikoPatientEmail(patient.id, possibleEmail);
                console.log('[SMS_INBOUND] ✅ Updated Cliniko patient email successfully');

                await sendEmailUpdateConfirmation({
                  to: from,
                  email: possibleEmail,
                  clinicName: 'Echo Desk'
                });

                console.log('[SMS_INBOUND] ✅ Sent confirmation SMS');
              }
            } else {
              console.log('[SMS_INBOUND] ⚠️  Patient not found in Cliniko');
              console.log('[SMS_INBOUND]   Email saved to context - will be used during appointment booking');

              await sendEmailUpdateConfirmation({
                to: from,
                email: possibleEmail,
                clinicName: 'Echo Desk'
              });
            }
          } catch (clinikoError: any) {
            console.error('[SMS_INBOUND] ❌ Failed to update Cliniko:', clinikoError.message);
            console.error('[SMS_INBOUND]   Error details:', clinikoError);

            // Still confirm to user that we received it
            await sendEmailUpdateConfirmation({
              to: from,
              email: possibleEmail,
              clinicName: 'Echo Desk'
            });

            console.log('[SMS_INBOUND] ℹ️  Email saved locally - will sync to Cliniko during booking');
          }
        } else {
          console.warn('[SMS_INBOUND] ⚠️  Call has no conversation ID');
          await sendEmailUpdateError({
            to: from,
            clinicName: 'Echo Desk',
            reason: 'We couldn\'t associate your email with your call. Please try the link we sent you.'
          });
        }
      } else {
        console.log('[SMS_INBOUND] ℹ️  Message doesn\'t look like an email, ignoring:', body);
        // Could add other handlers here for different types of SMS replies
        // For now, we just ignore non-email messages
      }

      return res.sendStatus(204);

    } catch (error: any) {
      console.error('[SMS_INBOUND] ❌ Error processing inbound SMS:', error);
      console.error('[SMS_INBOUND]   Stack:', error.stack);
      return res.sendStatus(500);
    }
  });
}
