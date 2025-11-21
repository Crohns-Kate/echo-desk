import twilio from 'twilio';
import { storage } from '../storage';
import { findPatientByPhoneRobust, createAppointmentForPatient, getAvailability } from './cliniko';
import { sendNewPatientForm } from './sms';
import { saySafe } from '../utils/voice-constants';
import { AUST_TZ } from '../time';
import { parseNaturalDate, formatDateRange } from '../utils/date-parser';
import { classifyIntent } from './intent';
import type { TenantContext } from './tenantResolver';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// ═══════════════════════════════════════════════
// FSM (Finite State Machine) Types
// ═══════════════════════════════════════════════

export enum CallState {
  GREETING = 'GREETING',
  PATIENT_TYPE_DETECT = 'PATIENT_TYPE_DETECT',
  FAQ_ANSWERING = 'FAQ_ANSWERING',
  RETURNING_PATIENT_LOOKUP = 'RETURNING_PATIENT_LOOKUP',
  NEW_PATIENT_PHONE_CONFIRM = 'NEW_PATIENT_PHONE_CONFIRM',
  SEND_FORM_LINK = 'SEND_FORM_LINK',
  WAITING_FOR_FORM = 'WAITING_FOR_FORM',
  FORM_RECEIVED = 'FORM_RECEIVED',
  CHIEF_COMPLAINT = 'CHIEF_COMPLAINT',
  APPOINTMENT_SEARCH = 'APPOINTMENT_SEARCH',
  PRESENT_OPTIONS = 'PRESENT_OPTIONS',
  CONFIRM_BOOKING = 'CONFIRM_BOOKING',
  CLOSING = 'CLOSING',
  ERROR_RECOVERY = 'ERROR_RECOVERY'
}

export interface CallContext {
  state: CallState;
  callSid: string;
  callerPhone: string;
  tenantId?: number;
  clinicName?: string;
  timezone?: string;
  patientId?: string;
  patientName?: string;
  patientFirstName?: string;
  patientEmail?: string;
  formToken?: string;
  formData?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  complaint?: string;
  preferredDay?: string; // Natural language day extracted from complaint (e.g., "saturday", "today")
  appointmentSlots?: Array<{
    startISO: string;
    speakable: string;
    practitionerId?: string;
    appointmentTypeId?: string;
  }>;
  selectedSlotIndex?: number;
  retryCount: number;
  conversationId?: string;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  [CallState.GREETING]: [CallState.PATIENT_TYPE_DETECT],
  [CallState.PATIENT_TYPE_DETECT]: [CallState.RETURNING_PATIENT_LOOKUP, CallState.NEW_PATIENT_PHONE_CONFIRM, CallState.FAQ_ANSWERING],
  [CallState.FAQ_ANSWERING]: [CallState.PATIENT_TYPE_DETECT, CallState.CHIEF_COMPLAINT, CallState.CLOSING],
  [CallState.RETURNING_PATIENT_LOOKUP]: [CallState.CHIEF_COMPLAINT, CallState.NEW_PATIENT_PHONE_CONFIRM],
  [CallState.NEW_PATIENT_PHONE_CONFIRM]: [CallState.SEND_FORM_LINK],
  [CallState.SEND_FORM_LINK]: [CallState.WAITING_FOR_FORM],
  [CallState.WAITING_FOR_FORM]: [CallState.FORM_RECEIVED, CallState.ERROR_RECOVERY],
  [CallState.FORM_RECEIVED]: [CallState.CHIEF_COMPLAINT],
  [CallState.CHIEF_COMPLAINT]: [CallState.APPOINTMENT_SEARCH, CallState.FAQ_ANSWERING],
  [CallState.APPOINTMENT_SEARCH]: [CallState.PRESENT_OPTIONS, CallState.ERROR_RECOVERY],
  [CallState.PRESENT_OPTIONS]: [CallState.CONFIRM_BOOKING, CallState.APPOINTMENT_SEARCH],
  [CallState.CONFIRM_BOOKING]: [CallState.CLOSING],
  [CallState.CLOSING]: [],
  [CallState.ERROR_RECOVERY]: [CallState.GREETING, CallState.CLOSING]
};

// ═══════════════════════════════════════════════
// Call Flow Handler Class
// ═══════════════════════════════════════════════

export class CallFlowHandler {
  private ctx: CallContext;
  private vr: twilio.twiml.VoiceResponse;
  private tenantCtx?: TenantContext;

  constructor(callSid: string, callerPhone: string, vr: twilio.twiml.VoiceResponse, tenantCtx?: TenantContext) {
    this.vr = vr;
    this.tenantCtx = tenantCtx;
    this.ctx = {
      state: CallState.GREETING,
      callSid,
      callerPhone,
      tenantId: tenantCtx?.id,
      clinicName: tenantCtx?.clinicName || 'Echo Desk Chiropractic',
      timezone: tenantCtx?.timezone || AUST_TZ,
      retryCount: 0
    };
  }

  /**
   * Get clinic name from context
   */
  getClinicName(): string {
    return this.ctx.clinicName || this.tenantCtx?.clinicName || 'Echo Desk Chiropractic';
  }

  /**
   * Get timezone from context
   */
  getTimezone(): string {
    return this.ctx.timezone || this.tenantCtx?.timezone || AUST_TZ;
  }

  /**
   * Load existing context from storage
   */
  async loadContext(): Promise<void> {
    try {
      const call = await storage.getCallByCallSid(this.ctx.callSid);
      if (call?.conversationId) {
        const conversation = await storage.getConversationById(call.conversationId);
        if (conversation?.context) {
          // Restore state from storage
          const stored = conversation.context as Partial<CallContext>;
          this.ctx = {
            ...this.ctx,
            ...stored,
            // Always keep current callSid and phone
            callSid: this.ctx.callSid,
            callerPhone: this.ctx.callerPhone
          };
          console.log('[CallFlowHandler] Restored context:', this.ctx.state);
        }
        this.ctx.conversationId = call.conversationId;
      }
    } catch (err) {
      console.error('[CallFlowHandler] Failed to load context:', err);
    }
  }

  /**
   * Save context to storage
   */
  async saveContext(): Promise<void> {
    try {
      if (this.ctx.conversationId) {
        await storage.updateConversation(this.ctx.conversationId, {
          context: this.ctx
        });
        console.log('[CallFlowHandler] Saved context:', this.ctx.state);
      }
    } catch (err) {
      console.error('[CallFlowHandler] Failed to save context:', err);
    }
  }

  /**
   * Validate and transition to new state
   */
  private transitionTo(newState: CallState): void {
    const validTransitions = VALID_TRANSITIONS[this.ctx.state];
    if (!validTransitions.includes(newState)) {
      console.warn(`[CallFlowHandler] Invalid transition from ${this.ctx.state} to ${newState}`);
      // Allow transition anyway but log it
    }
    console.log(`[CallFlowHandler] State transition: ${this.ctx.state} → ${newState}`);
    this.ctx.state = newState;
  }

  /**
   * Handle greeting
   */
  async handleGreeting(): Promise<void> {
    this.transitionTo(CallState.PATIENT_TYPE_DETECT);

    const g = this.vr.gather({
      input: ['speech', 'dtmf'],
      timeout: 5,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      hints: 'yes, no, new, returning, first visit',
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=patient_type`,
      method: 'POST'
    });

    saySafe(g, "Thanks for calling. Is this your first visit with us?");
    await this.saveContext();
  }

  /**
   * Handle patient type detection
   */
  async handlePatientTypeDetect(speechRaw: string, digits: string): Promise<void> {
    const speech = speechRaw.toLowerCase().trim();

    // Check for FAQ intent first (if they're asking a question instead of answering)
    const { detectFaqIntent } = await import('./faq');
    const faqCategory = detectFaqIntent(speechRaw);

    if (faqCategory && speechRaw.length > 10) {
      // They're asking a question, not answering our question
      console.log('[handlePatientTypeDetect] Detected FAQ intent:', faqCategory);
      this.transitionTo(CallState.FAQ_ANSWERING);
      await this.handleFAQ(speechRaw);
      return;
    }

    // Check if they said new/first/yes
    const isNew = speech.includes('new') || speech.includes('first') ||
                  speech.includes('yes') || digits === '1';

    // Check if they said returning/no
    const isReturning = speech.includes('returning') || speech.includes('no') ||
                        speech.includes('been before') || digits === '2';

    if (isNew) {
      // New patient flow
      this.transitionTo(CallState.NEW_PATIENT_PHONE_CONFIRM);
      await this.handleNewPatientPhoneConfirm();
    } else if (isReturning) {
      // Check Cliniko for existing patient
      this.transitionTo(CallState.RETURNING_PATIENT_LOOKUP);
      await this.handleReturningPatientLookup();
    } else {
      // Unclear response - retry with more helpful prompt
      this.ctx.retryCount++;
      if (this.ctx.retryCount >= 2) {
        // Assume new patient after 2 failed attempts
        this.transitionTo(CallState.NEW_PATIENT_PHONE_CONFIRM);
        saySafe(this.vr, "No worries, I'll treat this as a new patient visit.");
        await this.handleNewPatientPhoneConfirm();
      } else {
        const g = this.vr.gather({
          input: ['speech', 'dtmf'],
          timeout: 5,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          hints: 'yes, no, new, returning, first visit, been before',
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=patient_type`,
          method: 'POST'
        });

        // More conversational and helpful retry prompt
        const retryPrompts = [
          "Sorry, I didn't catch that. Have you been here before? Say yes if you're a returning patient, or no if this is your first visit.",
          "I didn't quite get that. Are you a new patient with us, or have you visited us before?",
          "Apologies, could you clarify? Is this your first appointment, or are you an existing patient?"
        ];
        const randomPrompt = retryPrompts[Math.floor(Math.random() * retryPrompts.length)];
        saySafe(g, randomPrompt);
      }
    }

    await this.saveContext();
  }

  /**
   * Handle returning patient lookup
   */
  async handleReturningPatientLookup(): Promise<void> {
    try {
      const patients = await findPatientByPhoneRobust(this.ctx.callerPhone);

      if (patients.length === 1) {
        // Found exactly one patient
        const patient = patients[0];
        this.ctx.patientId = patient.id;
        this.ctx.patientName = `${patient.firstName} ${patient.lastName}`;
        this.ctx.patientFirstName = patient.firstName;
        this.ctx.patientEmail = patient.email;

        saySafe(this.vr, `Hi ${patient.firstName}! What brings you in today?`);

        this.transitionTo(CallState.CHIEF_COMPLAINT);
        const g = this.vr.gather({
          input: ['speech'],
          timeout: 5,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=chief_complaint`,
          method: 'POST'
        });
        g.pause({ length: 1 });

      } else if (patients.length > 1) {
        // Multiple patients - store options and ask to disambiguate
        // Store patient options in context for disambiguation step
        (this.ctx as any).disambiguationPatients = patients.slice(0, 3).map(p => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email
        }));

        const names = patients.slice(0, 2).map((p, idx) => `${p.firstName}${idx === 0 ? '' : ''}`).join(' or ');
        const optionsText = patients.slice(0, 2).map((p, idx) => `Press ${idx + 1} for ${p.firstName}`).join('. ');

        const g = this.vr.gather({
          input: ['speech', 'dtmf'],
          timeout: 8,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          numDigits: 1,
          hints: patients.map(p => p.firstName).join(', ') + ', someone new, new patient, different person',
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=disambiguate_patient`,
          method: 'POST'
        });

        saySafe(g, `I see a few accounts with this number. Is this ${names}, or someone new? ${optionsText}. Or press 3 if you're someone new.`);

        await this.saveContext();

      } else {
        // No patients found - treat as new
        saySafe(this.vr, "I don't see an account with this number. Let's get you set up as a new patient.");
        this.transitionTo(CallState.NEW_PATIENT_PHONE_CONFIRM);
        await this.handleNewPatientPhoneConfirm();
      }
    } catch (err) {
      console.error('[handleReturningPatientLookup] Error:', err);
      this.transitionTo(CallState.ERROR_RECOVERY);
      saySafe(this.vr, "I'm having trouble looking up your account. Let me transfer you to our reception.");
      this.vr.hangup();
    }

    await this.saveContext();
  }

  /**
   * Handle multi-patient disambiguation
   * Called when multiple patients share the same phone number
   */
  async handleDisambiguatePatient(speechRaw: string, digits: string): Promise<void> {
    const speech = speechRaw.toLowerCase().trim();
    const patients = (this.ctx as any).disambiguationPatients || [];

    console.log('[handleDisambiguatePatient] Speech:', speechRaw, 'Digits:', digits);
    console.log('[handleDisambiguatePatient] Available patients:', patients.map((p: any) => p.firstName));

    // Check for "someone new" / "new patient" / press 3
    const isSomeoneNew = digits === '3' ||
                         speech.includes('new') ||
                         speech.includes('different') ||
                         speech.includes('someone else') ||
                         speech.includes('not me');

    if (isSomeoneNew) {
      // Booking for a NEW person - go to new patient flow
      console.log('[handleDisambiguatePatient] Selected: Someone new');
      saySafe(this.vr, "No problem! Let's set up a new account.");
      this.transitionTo(CallState.NEW_PATIENT_PHONE_CONFIRM);
      await this.handleNewPatientPhoneConfirm();
      return;
    }

    // Check for selection by digit (1 or 2)
    if (digits === '1' && patients[0]) {
      const patient = patients[0];
      this.ctx.patientId = patient.id;
      this.ctx.patientName = `${patient.firstName} ${patient.lastName}`;
      this.ctx.patientFirstName = patient.firstName;
      this.ctx.patientEmail = patient.email;
      console.log('[handleDisambiguatePatient] Selected patient 1:', patient.firstName);

      saySafe(this.vr, `Great, ${patient.firstName}! What brings you in today?`);
      this.transitionTo(CallState.CHIEF_COMPLAINT);
      await this.promptForChiefComplaint();
      return;
    }

    if (digits === '2' && patients[1]) {
      const patient = patients[1];
      this.ctx.patientId = patient.id;
      this.ctx.patientName = `${patient.firstName} ${patient.lastName}`;
      this.ctx.patientFirstName = patient.firstName;
      this.ctx.patientEmail = patient.email;
      console.log('[handleDisambiguatePatient] Selected patient 2:', patient.firstName);

      saySafe(this.vr, `Great, ${patient.firstName}! What brings you in today?`);
      this.transitionTo(CallState.CHIEF_COMPLAINT);
      await this.promptForChiefComplaint();
      return;
    }

    // Check for name match in speech
    for (let i = 0; i < patients.length; i++) {
      const patient = patients[i];
      if (speech.includes(patient.firstName.toLowerCase())) {
        this.ctx.patientId = patient.id;
        this.ctx.patientName = `${patient.firstName} ${patient.lastName}`;
        this.ctx.patientFirstName = patient.firstName;
        this.ctx.patientEmail = patient.email;
        console.log('[handleDisambiguatePatient] Selected by name:', patient.firstName);

        saySafe(this.vr, `Perfect, ${patient.firstName}! What brings you in today?`);
        this.transitionTo(CallState.CHIEF_COMPLAINT);
        await this.promptForChiefComplaint();
        return;
      }
    }

    // Unclear response - ask again
    this.ctx.retryCount++;
    if (this.ctx.retryCount >= 2) {
      // Too many retries - treat as new patient
      console.log('[handleDisambiguatePatient] Max retries, treating as new patient');
      saySafe(this.vr, "No worries, let's set you up fresh.");
      this.transitionTo(CallState.NEW_PATIENT_PHONE_CONFIRM);
      await this.handleNewPatientPhoneConfirm();
    } else {
      const names = patients.slice(0, 2).map((p: any) => p.firstName).join(' or ');
      const g = this.vr.gather({
        input: ['speech', 'dtmf'],
        timeout: 8,
        speechTimeout: 'auto',
        actionOnEmptyResult: true,
        numDigits: 1,
        hints: patients.map((p: any) => p.firstName).join(', ') + ', new',
        action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=disambiguate_patient`,
        method: 'POST'
      });
      saySafe(g, `Sorry, I didn't catch that. Are you ${names}? Or press 3 if you're someone new.`);
    }

    await this.saveContext();
  }

  /**
   * Prompt for chief complaint (helper)
   */
  private async promptForChiefComplaint(): Promise<void> {
    const g = this.vr.gather({
      input: ['speech'],
      timeout: 5,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=chief_complaint`,
      method: 'POST'
    });
    g.pause({ length: 1 });
    await this.saveContext();
  }

  /**
   * Handle new patient phone confirmation
   */
  async handleNewPatientPhoneConfirm(): Promise<void> {
    const lastThree = this.ctx.callerPhone.slice(-3);

    const g = this.vr.gather({
      input: ['speech', 'dtmf'],
      timeout: 5,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      hints: 'yes, no',
      numDigits: 1,
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=phone_confirm`,
      method: 'POST'
    });

    saySafe(g, `Is the number ending in ${lastThree} the best one to text you at? Press 1 for yes, 2 for no.`);
    await this.saveContext();
  }

  /**
   * Handle phone confirmation response
   */
  async handlePhoneConfirm(speechRaw: string, digits: string): Promise<void> {
    const speech = speechRaw.toLowerCase().trim();
    const confirmed = digits === '1' || speech.includes('yes');

    if (confirmed) {
      this.transitionTo(CallState.SEND_FORM_LINK);
      await this.handleSendFormLink();
    } else {
      // Ask for alternate phone number
      const g = this.vr.gather({
        input: ['dtmf'],
        timeout: 10,
        actionOnEmptyResult: true,
        numDigits: 10,
        action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=alternate_phone`,
        method: 'POST'
      });
      saySafe(g, "Please enter the 10-digit mobile number we should text, followed by pound.");
    }

    await this.saveContext();
  }

  /**
   * Send form link to patient
   */
  async handleSendFormLink(): Promise<void> {
    try {
      // Generate unique token
      const token = `form_${this.ctx.callSid}_${Date.now()}`;
      this.ctx.formToken = token;

      // Store token in storage for later retrieval
      if (this.ctx.conversationId) {
        await storage.updateConversation(this.ctx.conversationId, {
          context: { ...this.ctx, formToken: token }
        });
      }

      // Send SMS with form link
      await sendNewPatientForm({
        to: this.ctx.callerPhone,
        token: token,
        clinicName: this.getClinicName()
      });

      saySafe(this.vr, "Perfect! I've sent you a text with a link. I'll wait right here while you fill it out - takes about 30 seconds.");

      this.transitionTo(CallState.WAITING_FOR_FORM);

      // Start polling for form completion
      this.vr.play('http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3');
      this.vr.redirect({
        method: 'POST'
      }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=check_form_status`);

    } catch (err) {
      console.error('[handleSendFormLink] Error:', err);
      this.transitionTo(CallState.ERROR_RECOVERY);
      saySafe(this.vr, "I'm sorry, I'm having trouble sending the text message. Let me transfer you to our reception.");
      this.vr.hangup();
    }

    await this.saveContext();
  }

  /**
   * Check if form has been completed
   */
  async handleCheckFormStatus(): Promise<void> {
    try {
      // Check storage for form completion
      const call = await storage.getCallByCallSid(this.ctx.callSid);
      if (call?.conversationId) {
        const conversation = await storage.getConversationById(call.conversationId);
        const context = conversation?.context as Partial<CallContext>;

        if (context?.formData) {
          // Form completed!
          this.ctx.formData = context.formData;
          this.transitionTo(CallState.FORM_RECEIVED);
          await this.handleFormReceived();
          return;
        }
      }

      // Check how long we've been waiting
      const waitingTime = Date.now() - parseInt(this.ctx.formToken?.split('_')[2] || '0');

      if (waitingTime > 120000) {
        // 2 minutes timeout
        this.transitionTo(CallState.ERROR_RECOVERY);
        saySafe(this.vr, "I haven't received the form yet. No worries - I'll call you back in 5 minutes when you're ready, or you can call us anytime.");
        this.vr.hangup();
        return;
      }

      // Continue waiting - check again in 3 seconds
      this.vr.pause({ length: 3 });
      this.vr.redirect({
        method: 'POST'
      }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=check_form_status`);

    } catch (err) {
      console.error('[handleCheckFormStatus] Error:', err);
      this.transitionTo(CallState.ERROR_RECOVERY);
      saySafe(this.vr, "I'm having trouble checking the form status. Let me transfer you to our reception.");
      this.vr.hangup();
    }

    await this.saveContext();
  }

  /**
   * Handle form received
   */
  async handleFormReceived(): Promise<void> {
    if (!this.ctx.formData) {
      console.error('[handleFormReceived] No form data available');
      return;
    }

    saySafe(this.vr, `Got it! Thanks. What brings you in today?`);

    this.transitionTo(CallState.CHIEF_COMPLAINT);
    const g = this.vr.gather({
      input: ['speech'],
      timeout: 5,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=chief_complaint`,
      method: 'POST'
    });
    g.pause({ length: 1 });

    await this.saveContext();
  }

  /**
   * Handle chief complaint
   */
  async handleChiefComplaint(speechRaw: string): Promise<void> {
    this.ctx.complaint = speechRaw.toLowerCase().trim();

    // Extract preferred day/time from the complaint using intent classification
    try {
      const intent = await classifyIntent(this.ctx.complaint);
      if (intent.day) {
        this.ctx.preferredDay = intent.day;
        console.log('[handleChiefComplaint] Extracted preferred day:', intent.day);
      }
    } catch (err) {
      console.warn('[handleChiefComplaint] Failed to classify intent:', err);
      // Continue without preferred day
    }

    saySafe(this.vr, `Let me find the next available appointment.`);

    this.transitionTo(CallState.APPOINTMENT_SEARCH);
    await this.handleAppointmentSearch();
    await this.saveContext();
  }

  /**
   * Search for available appointments
   */
  async handleAppointmentSearch(): Promise<void> {
    try {
      // Parse the preferred day into a date range
      const dateRange = parseNaturalDate(this.ctx.preferredDay, AUST_TZ);

      console.log('[handleAppointmentSearch] Searching for appointments:');
      console.log('[handleAppointmentSearch]   - Preferred day:', this.ctx.preferredDay || 'none specified');
      console.log('[handleAppointmentSearch]   - Date range:', formatDateRange(dateRange));

      const { slots } = await getAvailability({
        fromISO: dateRange.from.toISOString(),
        toISO: dateRange.to.toISOString(),
        timezone: AUST_TZ
      });

      if (slots.length === 0) {
        // No slots found for the requested day - try to find alternatives
        if (this.ctx.preferredDay) {
          // They requested a specific day but we have no slots
          const fallbackRange = parseNaturalDate(undefined, AUST_TZ); // Get next 2 weeks
          const { slots: fallbackSlots } = await getAvailability({
            fromISO: fallbackRange.from.toISOString(),
            toISO: fallbackRange.to.toISOString(),
            timezone: AUST_TZ
          });

          if (fallbackSlots.length > 0) {
            // Offer alternatives
            this.ctx.appointmentSlots = fallbackSlots.slice(0, 3).map(slot => ({
              startISO: slot.startISO,
              speakable: this.formatSpeakableTime(slot.startISO),
              practitionerId: process.env.CLINIKO_PRACTITIONER_ID,
              appointmentTypeId: process.env.CLINIKO_APPT_TYPE_ID
            }));

            saySafe(this.vr, `I don't have any openings on ${this.ctx.preferredDay}, but here are the nearest available times.`);

            this.transitionTo(CallState.PRESENT_OPTIONS);
            await this.handlePresentOptions();
            await this.saveContext();
            return;
          }
        }

        // No slots at all
        this.transitionTo(CallState.ERROR_RECOVERY);
        saySafe(this.vr, "I don't have any openings in the next two weeks. Would you like me to add you to our waitlist? Let me transfer you to our reception.");
        this.vr.hangup();
        await this.saveContext();
        return;
      }

      // Found slots for the requested day
      this.ctx.appointmentSlots = slots.slice(0, 3).map(slot => ({
        startISO: slot.startISO,
        speakable: this.formatSpeakableTime(slot.startISO),
        practitionerId: process.env.CLINIKO_PRACTITIONER_ID,
        appointmentTypeId: process.env.CLINIKO_APPT_TYPE_ID
      }));

      this.transitionTo(CallState.PRESENT_OPTIONS);
      await this.handlePresentOptions();

    } catch (err) {
      console.error('[handleAppointmentSearch] Error:', err);
      this.transitionTo(CallState.ERROR_RECOVERY);
      saySafe(this.vr, "I'm having trouble finding available times. Let me transfer you to our reception.");
      this.vr.hangup();
    }

    await this.saveContext();
  }

  /**
   * Format time for speech
   */
  private formatSpeakableTime(isoString: string): string {
    try {
      const date = dayjs(isoString).tz(AUST_TZ);
      const today = dayjs().tz(AUST_TZ).startOf('day');
      const tomorrow = today.add(1, 'day');

      let dayPart: string;
      if (date.isSame(today, 'day')) {
        dayPart = 'today';
      } else if (date.isSame(tomorrow, 'day')) {
        dayPart = 'tomorrow';
      } else {
        dayPart = date.format('dddd, MMMM Do');
      }

      const timePart = date.format('h:mma');

      return `${timePart} ${dayPart}`;
    } catch (err) {
      console.error('[formatSpeakableTime] Error:', err);
      return isoString;
    }
  }

  /**
   * Present appointment options
   */
  async handlePresentOptions(): Promise<void> {
    if (!this.ctx.appointmentSlots || this.ctx.appointmentSlots.length === 0) {
      console.error('[handlePresentOptions] No appointment slots available');
      return;
    }

    const optionsText = this.ctx.appointmentSlots
      .map((slot, idx) => `Option ${idx + 1}: ${slot.speakable}`)
      .join('. ');

    const g = this.vr.gather({
      input: ['speech', 'dtmf'],
      timeout: 10,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      numDigits: 1,
      hints: 'one, two, three, option one, option two, option three',
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=choose_slot`,
      method: 'POST'
    });

    saySafe(g, `I have ${this.ctx.appointmentSlots.length} options available. ${optionsText}. Which works best? Press ${this.ctx.appointmentSlots.map((_, i) => i + 1).join(', ')}.`);

    await this.saveContext();
  }

  /**
   * Handle slot choice
   */
  async handleChooseSlot(speechRaw: string, digits: string): Promise<void> {
    const speech = speechRaw.toLowerCase().trim();

    // Parse choice
    let choiceIndex = -1;
    if (digits === '1' || speech.includes('one') || speech.includes('first')) {
      choiceIndex = 0;
    } else if (digits === '2' || speech.includes('two') || speech.includes('second')) {
      choiceIndex = 1;
    } else if (digits === '3' || speech.includes('three') || speech.includes('third')) {
      choiceIndex = 2;
    }

    if (choiceIndex >= 0 && this.ctx.appointmentSlots && choiceIndex < this.ctx.appointmentSlots.length) {
      this.ctx.selectedSlotIndex = choiceIndex;
      this.transitionTo(CallState.CONFIRM_BOOKING);
      await this.handleConfirmBooking();
    } else {
      // Invalid choice - retry
      this.ctx.retryCount++;
      if (this.ctx.retryCount >= 2) {
        this.transitionTo(CallState.ERROR_RECOVERY);
        saySafe(this.vr, "I'm having trouble understanding your choice. Let me transfer you to our reception.");
        this.vr.hangup();
      } else {
        saySafe(this.vr, "Sorry, I didn't catch that. ");
        await this.handlePresentOptions();
      }
    }

    await this.saveContext();
  }

  /**
   * Confirm and create booking
   */
  async handleConfirmBooking(): Promise<void> {
    if (this.ctx.selectedSlotIndex === undefined || !this.ctx.appointmentSlots) {
      console.error('[handleConfirmBooking] No slot selected');
      return;
    }

    const slot = this.ctx.appointmentSlots[this.ctx.selectedSlotIndex];
    const { env } = await import('../utils/env');

    try {
      // Determine if this is a new patient
      const isNewPatient = !this.ctx.patientId && this.ctx.formData;

      // Use NEW_PATIENT appointment type for new patients
      const appointmentTypeId = isNewPatient
        ? env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID
        : env.CLINIKO_APPT_TYPE_ID;

      // For new patients with form data, use the patient's phone from the form
      // For returning patients, use the caller's phone
      const phoneToUse = isNewPatient && this.ctx.formData?.phone
        ? this.ctx.formData.phone
        : this.ctx.callerPhone;

      console.log('[handleConfirmBooking] Creating appointment:');
      console.log('[handleConfirmBooking]   - Is new patient:', isNewPatient);
      console.log('[handleConfirmBooking]   - Appointment type ID:', appointmentTypeId);
      console.log('[handleConfirmBooking]   - Caller phone:', this.ctx.callerPhone);
      console.log('[handleConfirmBooking]   - Patient phone (for Cliniko):', phoneToUse);
      console.log('[handleConfirmBooking]   - Name:', this.ctx.formData?.firstName, this.ctx.formData?.lastName);

      // Prepare full name for Cliniko
      let fullName = '';
      if (this.ctx.formData) {
        fullName = `${this.ctx.formData.firstName} ${this.ctx.formData.lastName}`.trim();
      } else if (this.ctx.patientName) {
        fullName = this.ctx.patientName;
      }

      // Create appointment (this also creates patient if needed)
      const appointment = await createAppointmentForPatient(phoneToUse, {
        startsAt: slot.startISO,
        practitionerId: env.CLINIKO_PRACTITIONER_ID,
        appointmentTypeId: appointmentTypeId,
        notes: isNewPatient
          ? `New patient appointment booked via voice call at ${new Date().toISOString()}`
          : `Follow-up appointment booked via voice call at ${new Date().toISOString()}`,
        fullName: fullName || undefined,
        email: this.ctx.formData?.email || this.ctx.patientEmail || undefined
      });

      console.log('[handleConfirmBooking] ✅ Appointment created successfully:');
      console.log('[handleConfirmBooking]   - Appointment ID:', appointment?.id);
      console.log('[handleConfirmBooking]   - Patient ID:', appointment?.patient_id);

      // Store patient ID for future use
      if (appointment?.patient_id) {
        this.ctx.patientId = appointment.patient_id;
        await this.saveContext();
      }

      const firstName = this.ctx.formData?.firstName || this.ctx.patientFirstName || '';
      const confirmationText = firstName
        ? `${firstName}, perfect! You're all set for ${slot.speakable} with Dr. Michael. I'll text you a confirmation now.`
        : `Perfect! You're all set for ${slot.speakable} with Dr. Michael. I'll text you a confirmation now.`;

      saySafe(this.vr, confirmationText);

      // Send SMS confirmation
      try {
        const { sendAppointmentConfirmation } = await import('../services/sms');
        const { storage } = await import('../storage');
        await sendAppointmentConfirmation({
          to: this.ctx.callerPhone,
          appointmentDate: slot.speakable,
          clinicName: this.getClinicName()
        });
      } catch (smsErr) {
        console.error('[handleConfirmBooking] Failed to send SMS:', smsErr);
      }

      this.transitionTo(CallState.CLOSING);
      await this.handleClosing();

    } catch (err) {
      console.error('[handleConfirmBooking] Error:', err);
      this.transitionTo(CallState.ERROR_RECOVERY);
      saySafe(this.vr, "I'm having trouble creating the appointment. Let me transfer you to our reception.");
      this.vr.hangup();
    }

    await this.saveContext();
  }

  /**
   * Handle closing
   */
  async handleClosing(): Promise<void> {
    const g = this.vr.gather({
      input: ['speech'],
      timeout: 3,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      hints: 'no, nothing, that\'s all',
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=final_check`,
      method: 'POST'
    });

    saySafe(g, "Anything else I can help with?");
    g.pause({ length: 1 });

    // Default to goodbye if no response
    saySafe(this.vr, "Perfect! See you soon. Bye!");
    this.vr.hangup();

    await this.saveContext();
  }

  /**
   * Handle FAQ answering
   */
  async handleFAQ(speechRaw: string): Promise<void> {
    try {
      const { searchFaqByQuery, formatFaqAnswerForSpeech } = await import('./faq');

      console.log('[handleFAQ] Searching for FAQ answer:', speechRaw);

      // Search for matching FAQ
      const faq = await searchFaqByQuery(speechRaw);

      if (faq) {
        // Found an answer
        const formattedAnswer = formatFaqAnswerForSpeech(faq.answer);
        console.log('[handleFAQ] Found FAQ answer:', faq.question);

        // Answer the question and ask what else they need
        const g = this.vr.gather({
          input: ['speech'],
          timeout: 5,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          hints: 'appointment, booking, book, new patient, returning',
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=faq_followup`,
          method: 'POST'
        });

        saySafe(g, formattedAnswer);
        g.pause({ length: 1 });
        saySafe(g, "Is there anything else I can help you with? I can book an appointment if you need one.");

        // Fallback if no response
        saySafe(this.vr, "Feel free to call back anytime. Bye!");
        this.vr.hangup();
      } else {
        // No FAQ found - continue to booking flow
        console.log('[handleFAQ] No FAQ match found, continuing to patient type detection');
        saySafe(this.vr, "I can help you book an appointment. Let me get some details.");
        this.transitionTo(CallState.PATIENT_TYPE_DETECT);
        await this.handlePatientTypeDetect('', '');
      }

      await this.saveContext();
    } catch (err) {
      console.error('[handleFAQ] Error:', err);
      this.transitionTo(CallState.PATIENT_TYPE_DETECT);
      saySafe(this.vr, "Let me help you book an appointment instead.");
      await this.handlePatientTypeDetect('', '');
    }
  }

  /**
   * Handle FAQ followup (after answering a question)
   */
  async handleFAQFollowup(speechRaw: string): Promise<void> {
    const speech = speechRaw.toLowerCase().trim();

    // Check if they want to book
    const wantsToBook = speech.includes('book') || speech.includes('appointment') ||
                        speech.includes('yes') || speech.includes('schedule');

    // Check if they're done
    const isDone = speech.includes('no') || speech.includes('nothing') ||
                   speech.includes("that's all") || speech.includes("that's it");

    if (wantsToBook) {
      // Continue to booking flow
      this.transitionTo(CallState.PATIENT_TYPE_DETECT);
      saySafe(this.vr, "Great! Let's get you booked in.");
      await this.handlePatientTypeDetect('', '');
    } else if (isDone) {
      // They're done
      this.transitionTo(CallState.CLOSING);
      saySafe(this.vr, "Perfect! Have a great day. Bye!");
      this.vr.hangup();
    } else {
      // Try to answer another FAQ
      this.transitionTo(CallState.FAQ_ANSWERING);
      await this.handleFAQ(speechRaw);
    }

    await this.saveContext();
  }

  /**
   * Get TwiML response
   */
  getTwiML(): string {
    return this.vr.toString();
  }
}
