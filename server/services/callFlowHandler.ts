import twilio from 'twilio';
import { storage } from '../storage';
import { findPatientByPhoneRobust, createAppointmentForPatient, getAvailability } from './cliniko';
import { sendNewPatientForm } from './sms';
import { saySafe } from '../utils/voice-constants';
import { AUST_TZ, labelForSpeech } from '../time';
import { parseNaturalDate, formatDateRange, extractTimePreference } from '../utils/date-parser';
import { classifyIntent } from './intent';
import type { TenantContext } from './tenantResolver';
import { CallState } from '../types/call-state';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// ═══════════════════════════════════════════════
// FSM (Finite State Machine) Types
// ═══════════════════════════════════════════════

export { CallState };

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
  patientPhone?: string;
  formToken?: string;
  formWaitCount?: number;
  formData?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  complaint?: string;
  preferredDay?: string; // Natural language day extracted from complaint (e.g., "saturday", "today")
  preferredTime?: { hour: number; minute: number }; // Specific time preference (e.g., {hour: 14, minute: 0} for 2pm)
  appointmentSlots?: Array<{
    startISO: string;
    speakable: string;
    practitionerId?: string;
    appointmentTypeId?: string;
  }>;
  selectedSlotIndex?: number;
  retryCount: number;
  slotSelectionRetries?: number; // Separate retry counter for slot selection step
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
  [CallState.WAITING_FOR_FORM]: [CallState.FORM_RECEIVED, CallState.VERBAL_COLLECTION, CallState.ERROR_RECOVERY],
  [CallState.VERBAL_COLLECTION]: [CallState.FORM_RECEIVED, CallState.ERROR_RECOVERY],
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
   * Get voice name for TTS
   */
  getVoice(): string {
    return this.tenantCtx?.voiceName || 'Polly.Olivia-Neural';
  }

  /**
   * Get caller phone from context
   */
  getCallerPhone(): string {
    return this.ctx.callerPhone;
  }

  /**
   * Set patient name
   */
  setPatientName(name: string): void {
    this.ctx.patientName = name;
    // Also extract first name
    const parts = name.trim().split(/\s+/);
    if (parts.length > 0) {
      this.ctx.patientFirstName = parts[0];
    }
  }

  /**
   * Get patient name
   */
  getPatientName(): string | undefined {
    return this.ctx.patientName;
  }

  /**
   * Set patient phone
   */
  setPatientPhone(phone: string): void {
    this.ctx.patientPhone = phone;
  }

  /**
   * Get patient phone (or fall back to caller phone)
   */
  getPatientPhone(): string {
    return this.ctx.patientPhone || this.ctx.callerPhone;
  }

  /**
   * Set patient email
   */
  setPatientEmail(email: string): void {
    this.ctx.patientEmail = email;
  }

  /**
   * Set form data from verbal collection
   */
  setFormData(data: { firstName: string; lastName: string; phone: string; email: string }): void {
    this.ctx.formData = data;
  }

  /**
   * Load existing context from storage
   */
  async loadContext(): Promise<void> {
    try {
      const call = await storage.getCallByCallSid(this.ctx.callSid);
      if (call?.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        if (conversation?.context) {
          // Restore state from storage
          const stored = conversation.context as Partial<CallContext>;
          console.log('[CallFlowHandler] Loading context from DB:');
          console.log('[CallFlowHandler]   - state:', stored.state);
          console.log('[CallFlowHandler]   - formData present:', !!stored.formData);
          console.log('[CallFlowHandler]   - selectedSlotIndex:', stored.selectedSlotIndex);
          console.log('[CallFlowHandler]   - appointmentSlots count:', stored.appointmentSlots?.length || 0);
          this.ctx = {
            ...this.ctx,
            ...stored,
            // Always keep current callSid and phone
            callSid: this.ctx.callSid,
            callerPhone: this.ctx.callerPhone
          };
          console.log('[CallFlowHandler] After merge - formData:', this.ctx.formData);
          console.log('[CallFlowHandler] After merge - selectedSlotIndex:', this.ctx.selectedSlotIndex);
        }
        this.ctx.conversationId = String(call.conversationId);
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
        console.log('[CallFlowHandler] Saving context to DB:');
        console.log('[CallFlowHandler]   - state:', this.ctx.state);
        console.log('[CallFlowHandler]   - formData present:', !!this.ctx.formData);
        console.log('[CallFlowHandler]   - selectedSlotIndex:', this.ctx.selectedSlotIndex);
        console.log('[CallFlowHandler]   - appointmentSlots count:', this.ctx.appointmentSlots?.length || 0);
        await storage.updateConversation(Number(this.ctx.conversationId), {
          context: this.ctx
        });
        console.log('[CallFlowHandler] ✅ Context saved successfully');
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
   * Handle greeting (for unknown callers)
   */
  async handleGreeting(): Promise<void> {
    this.transitionTo(CallState.PATIENT_TYPE_DETECT);

    const g = this.vr.gather({
      input: ['speech', 'dtmf'],
      timeout: 5,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      hints: 'book, appointment, new patient, patient visit, book me in, make an appointment, need an appointment, schedule, change, reschedule, cancel, question, ask, hours, location',
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=patient_type`,
      method: 'POST'
    });

    // Build a warm, natural greeting with SSML pacing
    const clinicName = this.getClinicName();
    let greetingMessage: string;

    if (this.tenantCtx?.greeting && this.tenantCtx.greeting !== "Thanks for calling") {
      // Use tenant's custom greeting with natural pacing
      greetingMessage = `<speak>${this.tenantCtx.greeting} <break time="300ms"/> How can I help you today?</speak>`;
    } else {
      // Default greeting - warm, friendly, with natural pauses
      greetingMessage = `<speak>Thanks for calling ${clinicName}! <break time="200ms"/> How can I help you today?</speak>`;
    }

    saySafe(g, greetingMessage);
    await this.saveContext();
  }

  /**
   * Handle patient type/intent detection
   */
  async handlePatientTypeDetect(speechRaw: string, digits: string): Promise<void> {
    const speech = speechRaw.toLowerCase().trim();

    // Very forgiving booking intent detection
    // Treat any combination of booking-related words as booking intent
    const hasBookWord = speech.includes('book');
    const hasPatientWord = speech.includes('patient');
    const hasAppointmentWord = speech.includes('appointment');
    const hasVisitWord = speech.includes('visit');

    // Primary booking patterns - very forgiving
    const wantsToBook =
      // "book" + "patient" anywhere (e.g., "I want to book a new patient appointment")
      (hasBookWord && hasPatientWord) ||
      // "new patient" anywhere
      speech.includes('new patient') ||
      // "patient visit" anywhere
      (hasPatientWord && hasVisitWord) ||
      // "book a visit" or "book visit"
      (hasBookWord && hasVisitWord) ||
      // "book me in"
      speech.includes('book me in') ||
      speech.includes('book me') ||
      // Standard booking phrases
      hasBookWord ||
      hasAppointmentWord ||
      speech.includes('first') ||
      speech.includes('make an') ||
      speech.includes('need an') ||
      speech.includes('want an') ||
      speech.includes('like to') ||
      speech.includes('see someone') ||
      speech.includes('see the doctor') ||
      speech.includes('see dr') ||
      speech.includes('come in') ||
      speech.includes('get in') ||
      hasVisitWord ||
      speech.includes('available') ||
      speech.includes('opening') ||
      speech.includes('slot') ||
      (speech.includes('schedule') && !speech.includes('reschedule'));

    const wantsToChange = speech.includes('reschedule') || speech.includes('change') ||
                          speech.includes('move') || speech.includes('cancel') ||
                          speech.includes('different time') || speech.includes('existing');

    const hasQuestion = speech.includes('question') || speech.includes('ask') ||
                       speech.includes('hours') || speech.includes('location') ||
                       speech.includes('parking') || speech.includes('price') ||
                       speech.includes('cost') || speech.includes('where') ||
                       speech.includes('what') || speech.includes('how much');

    console.log('[handlePatientTypeDetect] Speech:', speechRaw);
    console.log('[handlePatientTypeDetect] wantsToBook:', wantsToBook, 'wantsToChange:', wantsToChange, 'hasQuestion:', hasQuestion);

    if (wantsToBook) {
      // Route to new patient booking flow
      console.log('[handlePatientTypeDetect] Routing to new patient booking');
      this.transitionTo(CallState.NEW_PATIENT_PHONE_CONFIRM);
      await this.handleNewPatientPhoneConfirm();
    } else if (wantsToChange) {
      // Transfer to reception for appointment changes
      console.log('[handlePatientTypeDetect] Transferring for appointment change');
      saySafe(this.vr, "Let me transfer you to our reception team who can help with that.");
      this.vr.hangup();
    } else if (hasQuestion) {
      // Route to FAQ flow
      console.log('[handlePatientTypeDetect] Routing to FAQ flow');
      this.transitionTo(CallState.FAQ_ANSWERING);
      await this.handleFAQ(speechRaw);
    } else {
      // Unclear response - max 2 retries then assume booking (friendly fallback)
      this.ctx.retryCount++;
      if (this.ctx.retryCount >= 2) {
        // After 2 unclear attempts, default to booking flow
        this.transitionTo(CallState.NEW_PATIENT_PHONE_CONFIRM);
        saySafe(this.vr, "<speak>No worries, <break time='150ms'/> I'll help you book an appointment.</speak>");
        await this.handleNewPatientPhoneConfirm();
      } else {
        const g = this.vr.gather({
          input: ['speech', 'dtmf'],
          timeout: 5,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          hints: 'book, appointment, new patient, patient visit, book me in, make an appointment, schedule, change, reschedule, question, ask',
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=patient_type`,
          method: 'POST'
        });

        // Single clear retry prompt with SSML
        saySafe(g, "<speak>I didn't quite catch that. <break time='200ms'/> Would you like to book an appointment, change an existing one, or ask a question?</speak>");
      }
    }

    await this.saveContext();
  }

  /**
   * Handle returning patient lookup
   */
  async handleReturningPatientLookup(): Promise<void> {
    try {
      const patient = await findPatientByPhoneRobust(this.ctx.callerPhone, this.tenantCtx);

      if (patient) {
        // Found exactly one patient
        this.ctx.patientId = patient.id;
        this.ctx.patientName = `${patient.first_name} ${patient.last_name}`;
        this.ctx.patientFirstName = patient.first_name;

        saySafe(this.vr, `Hi ${patient.first_name}! What brings you in today?`);

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

      } else {
        // No patient found - treat as new
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
      this.ctx.formWaitCount = 0; // Track how many times we've checked

      // Store token in storage for later retrieval
      if (this.ctx.conversationId) {
        await storage.updateConversation(Number(this.ctx.conversationId), {
          context: { ...this.ctx, formToken: token, formWaitCount: 0 }
        });
      }

      // Send SMS with form link
      await sendNewPatientForm({
        to: this.ctx.callerPhone,
        token: token,
        clinicName: this.getClinicName()
      });

      saySafe(this.vr, "Perfect! I've sent you a text with a link. I'll wait right here while you fill it out. Takes about 30 seconds.");

      this.transitionTo(CallState.WAITING_FOR_FORM);

      // Use Gather to allow keypress while waiting
      const gather = this.vr.gather({
        input: ['dtmf'],
        numDigits: 1,
        timeout: 10,
        action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=form_keypress`,
        method: 'POST'
      });
      saySafe(gather, "Press 1 when you've completed the form. Or press 2 if you can't receive texts and I'll collect your details over the phone.");
      gather.pause({ length: 8 });

      // If gather times out without input, redirect to check form status
      this.vr.redirect({ method: 'POST' }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=check_form_status`);

    } catch (err) {
      console.error('[handleSendFormLink] Error:', err);
      this.transitionTo(CallState.ERROR_RECOVERY);
      saySafe(this.vr, "I'm sorry, I'm having trouble sending the text message. Let me transfer you to our reception.");
      this.vr.hangup();
    }

    await this.saveContext();
  }

  /**
   * Handle keypress during form wait
   */
  async handleFormKeypress(digits: string): Promise<void> {
    console.log('[handleFormKeypress] Digit pressed:', digits);

    if (digits === '1') {
      // User says they're done - check if form actually completed
      const call = await storage.getCallByCallSid(this.ctx.callSid);
      if (call?.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        const context = conversation?.context as Partial<CallContext>;

        if (context?.formData) {
          // Form completed!
          await this.loadContext();
          this.transitionTo(CallState.FORM_RECEIVED);
          await this.handleFormReceived();
          return;
        }
      }

      // Form not actually completed yet
      saySafe(this.vr, "I don't see the form yet. Take your time - press 1 again when you're done.");
      this.vr.redirect({
        method: 'POST'
      }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=check_form_status`);

    } else if (digits === '2') {
      // User can't receive texts - collect verbally
      saySafe(this.vr, "No problem! I'll collect your details over the phone instead.");
      this.transitionTo(CallState.VERBAL_COLLECTION);
      this.vr.redirect({
        method: 'POST'
      }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=collect_verbal_details`);

    } else {
      // Invalid digit
      saySafe(this.vr, "Press 1 when you've completed the form, or press 2 to give details over the phone.");
      this.vr.redirect({
        method: 'POST'
      }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=check_form_status`);
    }

    await this.saveContext();
  }

  /**
   * Check if form has been completed
   */
  async handleCheckFormStatus(speechRaw?: string, digits?: string): Promise<void> {
    try {
      // Check storage for form completion
      const call = await storage.getCallByCallSid(this.ctx.callSid);
      if (call?.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        const context = conversation?.context as Partial<CallContext>;

        console.log('[handleCheckFormStatus] Checking for form data in context');
        console.log('[handleCheckFormStatus] formData present:', !!context?.formData);
        if (context?.formData) {
          console.log('[handleCheckFormStatus] formData:', context.formData);
        }

        if (context?.formData) {
          // Form completed! Reload entire context to ensure we have everything
          console.log('[handleCheckFormStatus] Form completed! Reloading full context');
          await this.loadContext();  // Reload entire context from DB
          console.log('[handleCheckFormStatus] After reload - formData:', this.ctx.formData);
          console.log('[handleCheckFormStatus] After reload - selectedSlotIndex:', this.ctx.selectedSlotIndex);
          console.log('[handleCheckFormStatus] After reload - appointmentSlots count:', this.ctx.appointmentSlots?.length || 0);
          this.transitionTo(CallState.FORM_RECEIVED);
          await this.handleFormReceived();
          return;
        }
      }

      // Check how long we've been waiting
      const waitingTime = Date.now() - parseInt(this.ctx.formToken?.split('_')[2] || '0');
      this.ctx.formWaitCount = (this.ctx.formWaitCount || 0) + 1;

      if (waitingTime > 90000) {
        // 90 seconds timeout - offer alternatives
        this.transitionTo(CallState.ERROR_RECOVERY);
        saySafe(this.vr, "I haven't received the form yet. No worries - would you like to give me your details over the phone instead? Press 1 for yes, or press 2 to hang up and try again later.");

        const gather = this.vr.gather({
          input: ['dtmf'],
          numDigits: 1,
          timeout: 10,
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=timeout_choice`,
          method: 'POST'
        });
        gather.pause({ length: 8 });

        // Default to verbal if no response
        this.vr.redirect({
          method: 'POST'
        }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=collect_verbal_details`);
        return;
      }

      // Every 3rd check (about 30 seconds), remind them of options
      if (this.ctx.formWaitCount % 3 === 0) {
        const gather = this.vr.gather({
          input: ['dtmf'],
          numDigits: 1,
          timeout: 8,
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=form_keypress`,
          method: 'POST'
        });
        saySafe(gather, "Still waiting for the form. Press 1 when done, or press 2 to give details over the phone.");
        gather.pause({ length: 6 });
      } else {
        // Brief pause between checks
        this.vr.pause({ length: 8 });
      }

      // Continue checking
      this.vr.redirect({ method: 'POST' }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=check_form_status`);

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
      if (intent.preferredTime) {
        // Parse the time string into hour/minute object
        const parsedTime = extractTimePreference(intent.preferredTime);
        if (parsedTime) {
          this.ctx.preferredTime = parsedTime;
          console.log('[handleChiefComplaint] Extracted preferred time from intent:', `${parsedTime.hour}:${String(parsedTime.minute).padStart(2, '0')}`);
        }
      }
    } catch (err) {
      console.warn('[handleChiefComplaint] Failed to classify intent:', err);
      // Continue without preferred day/time
    }

    // Extract specific time preference (e.g., "2pm", "2:00pm") from raw speech if not already set
    if (!this.ctx.preferredTime) {
      const timePreference = extractTimePreference(speechRaw);
      if (timePreference) {
        this.ctx.preferredTime = timePreference;
        console.log('[handleChiefComplaint] Extracted preferred time from speech:', `${timePreference.hour}:${String(timePreference.minute).padStart(2, '0')}`);
      }
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
      console.log('[handleAppointmentSearch]   - Preferred time:', this.ctx.preferredTime ? `${this.ctx.preferredTime.hour}:${String(this.ctx.preferredTime.minute).padStart(2, '0')}` : 'none specified');
      console.log('[handleAppointmentSearch]   - Date range:', formatDateRange(dateRange));

      const { slots } = await getAvailability({
        fromISO: dateRange.from.toISOString(),
        toISO: dateRange.to.toISOString(),
        timezone: this.getTimezone(),
        tenantCtx: this.tenantCtx,
        preferredTime: this.ctx.preferredTime
      });

      if (slots.length === 0) {
        // No slots found for the requested day - try to find alternatives
        if (this.ctx.preferredDay) {
          // They requested a specific day but we have no slots
          const fallbackRange = parseNaturalDate(undefined, this.getTimezone()); // Get next 2 weeks
          const { slots: fallbackSlots } = await getAvailability({
            fromISO: fallbackRange.from.toISOString(),
            toISO: fallbackRange.to.toISOString(),
            timezone: this.getTimezone(),
            tenantCtx: this.tenantCtx
          });

          if (fallbackSlots.length > 0) {
            // Offer alternatives
            // Rank by preferred time if specified
            let rankedFallbackSlots = fallbackSlots;
            if (this.ctx.preferredTime) {
              rankedFallbackSlots = this.rankSlotsByTime(fallbackSlots, this.ctx.preferredTime);
            }

            this.ctx.appointmentSlots = rankedFallbackSlots.slice(0, 3).map(slot => ({
              startISO: slot.startISO,
              speakable: this.formatSpeakableTime(slot.startISO),
              practitionerId: this.tenantCtx?.cliniko?.practitionerId || process.env.CLINIKO_PRACTITIONER_ID,
              appointmentTypeId: this.tenantCtx?.cliniko?.standardApptTypeId || process.env.CLINIKO_APPT_TYPE_ID
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
      // If they specified a preferred time, rank slots by proximity to that time
      let rankedSlots = slots;
      if (this.ctx.preferredTime) {
        console.log('[handleAppointmentSearch]   - Preferred time:', this.ctx.preferredTime);
        rankedSlots = this.rankSlotsByTime(slots, this.ctx.preferredTime);
      }

      this.ctx.appointmentSlots = rankedSlots.slice(0, 3).map(slot => ({
        startISO: slot.startISO,
        speakable: this.formatSpeakableTime(slot.startISO),
        practitionerId: this.tenantCtx?.cliniko?.practitionerId || process.env.CLINIKO_PRACTITIONER_ID,
        appointmentTypeId: this.tenantCtx?.cliniko?.standardApptTypeId || process.env.CLINIKO_APPT_TYPE_ID
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
   * Parse time string to hour (24-hour format)
   * Examples: "2pm" -> 14, "2:30pm" -> 14.5, "14:00" -> 14
   */
  private parseTimeToHours(timeStr: string): number {
    const lowerTime = timeStr.toLowerCase().trim();

    // Match patterns like "2pm", "2:30pm", "14:00"
    const ampmMatch = lowerTime.match(/(\d{1,2}):?(\d{2})?\s*([ap]\.?m\.?)/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
      const isPM = ampmMatch[3].toLowerCase().startsWith('p');

      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;

      return hours + (minutes / 60);
    }

    // Match 24-hour format like "14:00"
    const militaryMatch = lowerTime.match(/(\d{1,2}):(\d{2})/);
    if (militaryMatch) {
      const hours = parseInt(militaryMatch[1], 10);
      const minutes = parseInt(militaryMatch[2], 10);
      return hours + (minutes / 60);
    }

    return -1; // Could not parse
  }

  /**
   * Rank slots by proximity to preferred time
   * Returns slots sorted with closest time first
   */
  private rankSlotsByTime(slots: Array<{ startISO: string }>, preferredTime: { hour: number; minute: number }): Array<{ startISO: string }> {
    const preferredHours = preferredTime.hour + (preferredTime.minute / 60);

    // Calculate time difference for each slot and sort
    const rankedSlots = slots.map(slot => {
      const slotDate = dayjs(slot.startISO).tz(this.getTimezone());
      const slotHours = slotDate.hour() + (slotDate.minute() / 60);
      const timeDiff = Math.abs(slotHours - preferredHours);

      return { slot, timeDiff };
    });

    // Sort by time difference (closest first)
    rankedSlots.sort((a, b) => a.timeDiff - b.timeDiff);

    const preferredTimeStr = `${preferredTime.hour}:${String(preferredTime.minute).padStart(2, '0')}`;
    console.log(`[rankSlotsByTime] Preferred time: ${preferredTimeStr} (${preferredHours.toFixed(1)}h)`);
    rankedSlots.slice(0, 3).forEach(({ slot, timeDiff }) => {
      const slotDate = dayjs(slot.startISO).tz(this.getTimezone());
      console.log(`  - ${slotDate.format('h:mma ddd MMM D')} (${timeDiff.toFixed(1)}h difference)`);
    });

    return rankedSlots.map(r => r.slot);
  }

  /**
   * Format time for speech - uses proper TTS-friendly format
   * Example: "3:45 pm today" or "9 am Friday 13th December"
   */
  private formatSpeakableTime(isoString: string): string {
    try {
      const tz = this.getTimezone();
      const date = dayjs(isoString).tz(tz);
      const today = dayjs().tz(tz).startOf('day');
      const tomorrow = today.add(1, 'day');

      // Format time part - "3:45 pm" or "9 am" (no minutes if on the hour)
      const hour = date.hour();
      const minute = date.minute();
      const h12 = hour % 12 || 12;
      const ampm = hour < 12 ? 'a m' : 'p m';
      const timePart = minute === 0
        ? `${h12} ${ampm}`
        : `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;

      // Format day part - "today", "tomorrow", or "Friday 13th December"
      let dayPart: string;
      if (date.isSame(today, 'day')) {
        dayPart = 'today';
      } else if (date.isSame(tomorrow, 'day')) {
        dayPart = 'tomorrow';
      } else {
        // Use ordinal suffix: 1st, 2nd, 3rd, etc.
        const dayNum = date.date();
        const ordinal = this.getOrdinalSuffix(dayNum);
        dayPart = `${date.format('dddd')} ${dayNum}${ordinal} ${date.format('MMMM')}`;
      }

      return `${timePart} ${dayPart}`;
    } catch (err) {
      console.error('[formatSpeakableTime] Error:', err);
      // Fallback to labelForSpeech from time.ts
      return labelForSpeech(isoString, this.getTimezone());
    }
  }

  /**
   * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.)
   */
  private getOrdinalSuffix(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  /**
   * Present appointment options
   */
  async handlePresentOptions(): Promise<void> {
    if (!this.ctx.appointmentSlots || this.ctx.appointmentSlots.length === 0) {
      console.error('[handlePresentOptions] No appointment slots available');
      // No slots - redirect to error recovery
      saySafe(this.vr, "<speak>I'm sorry, I couldn't find any available appointments. Let me transfer you to reception.</speak>");
      this.vr.hangup();
      return;
    }

    // Reset retry count for this step
    this.ctx.slotSelectionRetries = (this.ctx.slotSelectionRetries || 0);

    // Build SSML with natural pacing between options
    const optionsSSML = this.ctx.appointmentSlots
      .map((slot, idx) => `Option ${idx + 1}: ${slot.speakable}`)
      .join(' <break time="400ms"/> ');

    const g = this.vr.gather({
      input: ['speech', 'dtmf'],
      timeout: 10,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      numDigits: 1,
      hints: 'one, two, three, first, second, third, option one, option two, option three, the first, the second, the third, number one, number two, number three',
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=choose_slot`,
      method: 'POST'
    });

    // Natural pacing with SSML breaks
    const numOptions = this.ctx.appointmentSlots.length;
    const digitPrompt = numOptions === 1 ? 'press 1' : `press ${this.ctx.appointmentSlots.map((_, i) => i + 1).join(' or ')}`;

    saySafe(g, `<speak>I have ${numOptions} ${numOptions === 1 ? 'opening' : 'openings'} available. <break time="300ms"/> ${optionsSSML}. <break time="400ms"/> Which works best for you? You can say the number, or ${digitPrompt}.</speak>`);

    // Fallback redirect if gather fails completely
    this.vr.redirect({ method: 'POST' }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=choose_slot`);

    await this.saveContext();
  }

  /**
   * Parse option choice from speech or digits
   * Returns 0-based index or -1 if not understood
   */
  private parseOptionChoice(speech: string, digits: string): number {
    // DTMF digits take priority
    if (digits === '1') return 0;
    if (digits === '2') return 1;
    if (digits === '3') return 2;

    const s = speech.toLowerCase().trim();

    // Option 1 patterns
    const isOption1 =
      s.includes('option 1') ||
      s.includes('option one') ||
      s.includes('the first') ||
      s.includes('first one') ||
      s.includes('first option') ||
      s.includes('number 1') ||
      s.includes('number one') ||
      s === 'one' ||
      s === '1' ||
      s === 'first' ||
      s.startsWith('one ') ||
      s.endsWith(' one') ||
      // Check for "one" as a standalone word
      /\bone\b/.test(s);

    // Option 2 patterns
    const isOption2 =
      s.includes('option 2') ||
      s.includes('option two') ||
      s.includes('the second') ||
      s.includes('second one') ||
      s.includes('second option') ||
      s.includes('number 2') ||
      s.includes('number two') ||
      s === 'two' ||
      s === '2' ||
      s === 'second' ||
      s.startsWith('two ') ||
      s.endsWith(' two') ||
      /\btwo\b/.test(s);

    // Option 3 patterns
    const isOption3 =
      s.includes('option 3') ||
      s.includes('option three') ||
      s.includes('the third') ||
      s.includes('third one') ||
      s.includes('third option') ||
      s.includes('number 3') ||
      s.includes('number three') ||
      s === 'three' ||
      s === '3' ||
      s === 'third' ||
      s.startsWith('three ') ||
      s.endsWith(' three') ||
      /\bthree\b/.test(s);

    if (isOption1) return 0;
    if (isOption2) return 1;
    if (isOption3) return 2;

    return -1;
  }

  /**
   * Handle slot choice
   */
  async handleChooseSlot(speechRaw: string, digits: string): Promise<void> {
    console.log('[handleChooseSlot] Speech:', speechRaw, 'Digits:', digits);
    console.log('[handleChooseSlot] Available slots:', this.ctx.appointmentSlots?.length || 0);
    console.log('[handleChooseSlot] Slot selection retries:', this.ctx.slotSelectionRetries || 0);

    // Parse choice using flexible option detection
    const choiceIndex = this.parseOptionChoice(speechRaw, digits);
    console.log('[handleChooseSlot] Parsed choice index:', choiceIndex);

    if (choiceIndex >= 0 && this.ctx.appointmentSlots && choiceIndex < this.ctx.appointmentSlots.length) {
      // Valid choice - reset retries and proceed
      this.ctx.slotSelectionRetries = 0;
      this.ctx.selectedSlotIndex = choiceIndex;
      // Ask for confirmation before booking
      await this.askBookingConfirmation();
    } else {
      // Invalid choice - use separate retry counter for this step
      this.ctx.slotSelectionRetries = (this.ctx.slotSelectionRetries || 0) + 1;
      console.log('[handleChooseSlot] Slot selection retry #', this.ctx.slotSelectionRetries);

      if (this.ctx.slotSelectionRetries >= 3) {
        // After 3 tries at slot selection, transfer to reception
        this.transitionTo(CallState.ERROR_RECOVERY);
        saySafe(this.vr, "<speak>No worries, <break time='200ms'/> let me transfer you to our reception team who can help.</speak>");
        this.vr.hangup();
      } else {
        // Give clearer guidance and re-present options
        saySafe(this.vr, "<speak>I didn't quite catch that. <break time='200ms'/> Just say the number, like one, two, or three. Or press the number on your keypad.</speak>");
        await this.handlePresentOptions();
      }
    }

    await this.saveContext();
  }

  /**
   * Ask for booking confirmation before creating appointment
   */
  async askBookingConfirmation(): Promise<void> {
    if (this.ctx.selectedSlotIndex === undefined || !this.ctx.appointmentSlots) {
      console.error('[askBookingConfirmation] No slot selected');
      return;
    }

    const slot = this.ctx.appointmentSlots[this.ctx.selectedSlotIndex];
    const patientName = this.ctx.formData?.firstName || this.ctx.patientFirstName || '';

    const g = this.vr.gather({
      input: ['speech', 'dtmf'],
      timeout: 8,
      speechTimeout: 'auto',
      actionOnEmptyResult: true,
      numDigits: 1,
      hints: 'yes, no, correct, that is correct, yep, yeah, sure, nope, not right, wrong',
      action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=booking_confirmation`,
      method: 'POST'
    });

    // Confirm the booking details with SSML pacing
    const confirmMessage = patientName
      ? `<speak>Perfect ${patientName}! <break time="200ms"/> Just to confirm, <break time="150ms"/> I'm booking you for ${slot.speakable}. <break time="300ms"/> Is that correct? Press 1 for yes, or 2 to pick a different time.</speak>`
      : `<speak>Just to confirm, <break time="150ms"/> I'm booking you for ${slot.speakable}. <break time="300ms"/> Is that correct? Press 1 for yes, or 2 to pick a different time.</speak>`;

    saySafe(g, confirmMessage);
    await this.saveContext();
  }

  /**
   * Handle booking confirmation response
   */
  async handleBookingConfirmationResponse(speechRaw: string, digits: string): Promise<void> {
    const speech = speechRaw.toLowerCase().trim();

    // Check for affirmative response
    const isYes =
      digits === '1' ||
      speech.includes('yes') ||
      speech.includes('yeah') ||
      speech.includes('yep') ||
      speech.includes('correct') ||
      speech.includes('sure') ||
      speech.includes('ok') ||
      speech.includes('okay') ||
      speech.includes('that\'s right') ||
      speech.includes('thats right') ||
      speech.includes('sounds good') ||
      speech.includes('perfect') ||
      speech.includes('great');

    // Check for negative response
    const isNo =
      digits === '2' ||
      speech.includes('no') ||
      speech.includes('nope') ||
      speech.includes('wrong') ||
      speech.includes('different') ||
      speech.includes('change') ||
      speech.includes('not right') ||
      speech.includes('another');

    console.log('[handleBookingConfirmationResponse] Speech:', speechRaw, 'Digits:', digits);
    console.log('[handleBookingConfirmationResponse] isYes:', isYes, 'isNo:', isNo);

    if (isYes) {
      // Proceed with booking
      this.transitionTo(CallState.CONFIRM_BOOKING);
      await this.handleConfirmBooking();
    } else if (isNo) {
      // Go back to present options
      saySafe(this.vr, "<speak>No problem! <break time='200ms'/> Let me read those options again.</speak>");
      this.ctx.selectedSlotIndex = undefined;
      await this.handlePresentOptions();
    } else {
      // Unclear - ask again
      this.ctx.retryCount++;
      if (this.ctx.retryCount >= 2) {
        // Assume yes after 2 unclear attempts
        saySafe(this.vr, "<speak>I'll go ahead and book that for you.</speak>");
        this.transitionTo(CallState.CONFIRM_BOOKING);
        await this.handleConfirmBooking();
      } else {
        await this.askBookingConfirmation();
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

      const emailToUse = this.ctx.formData?.email || this.ctx.patientEmail || undefined;

      console.log('[handleConfirmBooking] Passing to createAppointmentForPatient:');
      console.log('[handleConfirmBooking]   - phone:', phoneToUse);
      console.log('[handleConfirmBooking]   - fullName:', fullName);
      console.log('[handleConfirmBooking]   - email:', emailToUse);
      console.log('[handleConfirmBooking]   - formData present:', !!this.ctx.formData);
      if (this.ctx.formData) {
        console.log('[handleConfirmBooking]   - formData.email:', this.ctx.formData.email);
      }

      // Create appointment (this also creates patient if needed)
      const practitionerId = this.tenantCtx?.cliniko?.practitionerId || env.CLINIKO_PRACTITIONER_ID;
      const appointment = await createAppointmentForPatient(phoneToUse, {
        startsAt: slot.startISO,
        practitionerId: practitionerId,
        appointmentTypeId: appointmentTypeId,
        notes: isNewPatient
          ? `New patient appointment booked via voice call at ${new Date().toISOString()}`
          : `Follow-up appointment booked via voice call at ${new Date().toISOString()}`,
        fullName: fullName || undefined,
        email: emailToUse,
        tenantCtx: this.tenantCtx
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

      // Check if caller is declaring intent to ask (not actually asking a question)
      const speech = speechRaw.toLowerCase().trim();
      const isJustDeclaringIntent =
        speech === 'ask' ||
        speech === 'ask a' ||
        speech === 'question' ||
        speech === 'ask a question' ||
        speech === 'i have a question' ||
        speech === 'question please' ||
        speech === 'yes' ||
        speech.length < 5; // Too short to be a real question

      if (isJustDeclaringIntent) {
        // They want to ask a question but haven't said it yet - prompt them
        console.log('[handleFAQ] Caller declared intent to ask, prompting for actual question');
        const g = this.vr.gather({
          input: ['speech'],
          timeout: 8,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          hints: 'hours, location, parking, cost, price, how long, what time, when',
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=faq`,
          method: 'POST'
        });
        saySafe(g, "Of course! What would you like to know?");
        g.pause({ length: 2 });

        // If no response, ask again
        saySafe(this.vr, "Go ahead, I'm listening.");
        this.vr.redirect({
          method: 'POST'
        }, `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=faq`);
        return;
      }

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
        // No FAQ found - ask if they'd like to rephrase or book instead
        console.log('[handleFAQ] No FAQ match found for:', speechRaw);
        const g = this.vr.gather({
          input: ['speech'],
          timeout: 5,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          hints: 'book, appointment, different question, repeat',
          action: `/api/voice/handle-flow?callSid=${this.ctx.callSid}&step=faq_followup`,
          method: 'POST'
        });
        saySafe(g, "I'm not sure about that one. Would you like to ask something else, or shall I help you book an appointment?");
        g.pause({ length: 1 });

        // Default to booking if no response
        saySafe(this.vr, "No worries. Let me help you book an appointment instead.");
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

    // Check if they want to book - use more specific patterns to avoid false positives
    // "book an appointment" vs "how long is the appointment?"
    const bookingPhrases = [
      'book', 'schedule', 'make an appointment',
      'want an appointment', 'need an appointment',
      'get an appointment', 'yes please', 'yes i would'
    ];
    const wantsToBook = bookingPhrases.some(phrase => speech.includes(phrase)) ||
                        (speech === 'yes' || speech === 'sure' || speech === 'okay');

    // Check if this is a question (likely another FAQ)
    const isQuestion = speech.includes('how') || speech.includes('what') ||
                      speech.includes('when') || speech.includes('where') ||
                      speech.includes('why') || speech.includes('who') ||
                      speech.includes('?') || speech.includes('cost') ||
                      speech.includes('price') || speech.includes('long') ||
                      speech.includes('much') || speech.includes('location') ||
                      speech.includes('hours') || speech.includes('parking');

    // Check if they're done
    const isDone = speech.includes('no') || speech.includes('nothing') ||
                   speech.includes("that's all") || speech.includes("that's it") ||
                   speech.includes('no thanks') || speech.includes("i'm good");

    if (isDone) {
      // They're done
      this.transitionTo(CallState.CLOSING);
      saySafe(this.vr, "Perfect! Have a great day. Bye!");
      this.vr.hangup();
    } else if (isQuestion) {
      // They have another question - stay in FAQ mode
      console.log('[handleFAQFollowup] Detected another question, staying in FAQ mode');
      this.transitionTo(CallState.FAQ_ANSWERING);
      await this.handleFAQ(speechRaw);
    } else if (wantsToBook) {
      // Continue to booking flow
      console.log('[handleFAQFollowup] Detected booking intent, transitioning to booking flow');
      this.transitionTo(CallState.PATIENT_TYPE_DETECT);
      saySafe(this.vr, "Great! Let's get you booked in.");
      await this.handlePatientTypeDetect('', '');
    } else {
      // Unclear - try to answer as FAQ first
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
