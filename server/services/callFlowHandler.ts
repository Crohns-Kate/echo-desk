import twilio from 'twilio';
import { storage } from '../storage';
import { findPatientByPhoneRobust, createAppointmentForPatient, getAvailability } from './cliniko';
import { sendNewPatientForm } from './sms';
import { saySafe } from '../utils/voice-constants';
import { AUST_TZ } from '../time';
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
  [CallState.PATIENT_TYPE_DETECT]: [CallState.RETURNING_PATIENT_LOOKUP, CallState.NEW_PATIENT_PHONE_CONFIRM],
  [CallState.RETURNING_PATIENT_LOOKUP]: [CallState.CHIEF_COMPLAINT, CallState.NEW_PATIENT_PHONE_CONFIRM],
  [CallState.NEW_PATIENT_PHONE_CONFIRM]: [CallState.SEND_FORM_LINK],
  [CallState.SEND_FORM_LINK]: [CallState.WAITING_FOR_FORM],
  [CallState.WAITING_FOR_FORM]: [CallState.FORM_RECEIVED, CallState.ERROR_RECOVERY],
  [CallState.FORM_RECEIVED]: [CallState.CHIEF_COMPLAINT],
  [CallState.CHIEF_COMPLAINT]: [CallState.APPOINTMENT_SEARCH],
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

  constructor(callSid: string, callerPhone: string, vr: twilio.twiml.VoiceResponse) {
    this.vr = vr;
    this.ctx = {
      state: CallState.GREETING,
      callSid,
      callerPhone,
      retryCount: 0
    };
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
      // Unclear response - retry
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
          hints: 'yes, no, new, returning',
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=patient_type`,
          method: 'POST'
        });
        saySafe(g, "Sorry, I didn't catch that. Is this your first visit? Say yes for new patient, or no if you've been here before.");
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
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=chief_complaint`,
          method: 'POST'
        });
        g.pause({ length: 1 });

      } else if (patients.length > 1) {
        // Multiple patients - ask to disambiguate
        const names = patients.slice(0, 2).map(p => p.firstName).join(' or ');
        const g = this.vr.gather({
          input: ['speech', 'dtmf'],
          timeout: 5,
          speechTimeout: 'auto',
          hints: patients.map(p => p.firstName).join(', '),
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=disambiguate_patient`,
          method: 'POST'
        });
        saySafe(g, `I see a few accounts with this number. Are you ${names}? Or press 3 if neither.`);

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
   * Handle new patient phone confirmation
   */
  async handleNewPatientPhoneConfirm(): Promise<void> {
    const lastThree = this.ctx.callerPhone.slice(-3);

    const g = this.vr.gather({
      input: ['speech', 'dtmf'],
      timeout: 5,
      speechTimeout: 'auto',
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
        clinicName: 'Echo Desk Chiropractic'
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

    saySafe(this.vr, `Got it! Thanks ${this.ctx.formData.firstName}. What brings you in today?`);

    this.transitionTo(CallState.CHIEF_COMPLAINT);
    const g = this.vr.gather({
      input: ['speech'],
      timeout: 5,
      speechTimeout: 'auto',
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

    saySafe(this.vr, `Sorry to hear about your ${this.ctx.complaint}. Let me find the next available appointment.`);

    this.transitionTo(CallState.APPOINTMENT_SEARCH);
    await this.handleAppointmentSearch();
    await this.saveContext();
  }

  /**
   * Search for available appointments
   */
  async handleAppointmentSearch(): Promise<void> {
    try {
      const now = dayjs();
      const twoWeeksLater = now.add(14, 'days');

      const { slots } = await getAvailability({
        fromISO: now.toISOString(),
        toISO: twoWeeksLater.toISOString(),
        timezone: AUST_TZ
      });

      if (slots.length === 0) {
        this.transitionTo(CallState.ERROR_RECOVERY);
        saySafe(this.vr, "I don't have any openings in the next two weeks. Would you like me to add you to our waitlist? Let me transfer you to our reception.");
        this.vr.hangup();
        return;
      }

      // Take top 3 slots
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

    try {
      // Create patient in Cliniko if new
      let patientId = this.ctx.patientId;

      if (!patientId && this.ctx.formData) {
        // Create new patient (this should be done via Cliniko API)
        // For now, we'll just use the form data
        console.log('[handleConfirmBooking] Would create patient:', this.ctx.formData);
        // TODO: Actually create patient in Cliniko
        // const newPatient = await createPatient(this.ctx.formData);
        // patientId = newPatient.id;
      }

      // Create appointment
      // TODO: Actually create appointment in Cliniko
      // await createAppointmentForPatient({
      //   patientId: patientId!,
      //   startTime: slot.startISO,
      //   practitionerId: slot.practitionerId!,
      //   appointmentTypeId: slot.appointmentTypeId!
      // });

      saySafe(this.vr, `Perfect! You're all set for ${slot.speakable} with Dr. Michael. I'll text you a confirmation now.`);

      // Send SMS confirmation
      // TODO: Send actual confirmation SMS

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
   * Get TwiML response
   */
  getTwiML(): string {
    return this.vr.toString();
  }
}
