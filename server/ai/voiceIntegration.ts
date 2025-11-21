/**
 * Voice Integration - Bridge between AI layer and Twilio voice routes
 * Provides hybrid FSM + AI conversation handling
 */

import twilio from 'twilio';
import {
  processUtterance,
  getDialogueState,
  type DialogueContext,
  type DialogueResponse
} from './dialogueManager';
import {
  initializeMemory,
  getMemory,
  clearMemory,
  updateCollectedInfo
} from './stateMemory';
import { classifyIntent } from './intentRouter';
import { isLLMAvailable } from './llmProvider';
import { saySafe } from '../utils/voice-constants';
import type { TenantContext } from '../services/tenantResolver';

export interface AIVoiceConfig {
  enableAI: boolean;           // Master switch for AI features
  aiConfidenceThreshold: number; // Minimum confidence to use AI response (0-1)
  maxAITurns: number;          // Max consecutive AI turns before FSM fallback
  enableBargeIn: boolean;      // Allow caller to interrupt AI responses
}

const DEFAULT_CONFIG: AIVoiceConfig = {
  enableAI: true,
  aiConfidenceThreshold: 0.6,
  maxAITurns: 10,
  enableBargeIn: true
};

/**
 * Initialize AI for a new call
 */
export function initializeAICall(
  callSid: string,
  callerPhone: string,
  tenantCtx?: TenantContext
): void {
  initializeMemory(callSid, tenantCtx?.id);

  // Store caller phone in memory
  updateCollectedInfo(callSid, { phone: callerPhone });

  console.log(`[AIVoice] Initialized AI for call ${callSid}`);
}

/**
 * Process caller speech with AI and generate TwiML response
 */
export async function processWithAI(
  speechResult: string,
  callSid: string,
  vr: twilio.twiml.VoiceResponse,
  tenantCtx?: TenantContext,
  config: Partial<AIVoiceConfig> = {}
): Promise<{ usedAI: boolean; response: DialogueResponse | null }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Check if AI is available and enabled
  if (!cfg.enableAI || !isLLMAvailable()) {
    console.log('[AIVoice] AI disabled or unavailable, using FSM');
    return { usedAI: false, response: null };
  }

  try {
    // Build dialogue context
    const context: DialogueContext = {
      callSid,
      tenantId: tenantCtx?.id,
      clinicName: tenantCtx?.clinicName || 'the clinic',
      timezone: tenantCtx?.timezone,
      callerPhone: getMemory(callSid).collected.phone
    };

    // Process with AI dialogue manager
    const response = await processUtterance(speechResult, context);

    // Check confidence threshold
    if (response.confidence < cfg.aiConfidenceThreshold) {
      console.log(`[AIVoice] Confidence ${response.confidence} below threshold ${cfg.aiConfidenceThreshold}`);
      return { usedAI: false, response };
    }

    // Generate TwiML response
    generateTwiML(vr, response, callSid, cfg);

    return { usedAI: true, response };
  } catch (error) {
    console.error('[AIVoice] AI processing failed:', error);
    return { usedAI: false, response: null };
  }
}

/**
 * Generate TwiML from AI response
 */
function generateTwiML(
  vr: twilio.twiml.VoiceResponse,
  response: DialogueResponse,
  callSid: string,
  config: AIVoiceConfig
): void {
  // Handle special cases
  if (response.shouldTransfer) {
    saySafe(vr, response.speech);
    // Add transfer logic here if needed
    vr.hangup();
    return;
  }

  if (response.shouldHangup) {
    saySafe(vr, response.speech);
    vr.hangup();
    return;
  }

  // Normal response with gather
  const gather = vr.gather({
    input: response.collectDigits ? ['speech', 'dtmf'] : ['speech'],
    timeout: 5,
    speechTimeout: 'auto',
    actionOnEmptyResult: true,
    hints: response.gatherHints,
    action: `/api/voice/ai-continue?callSid=${callSid}${response.nextStep ? `&step=${response.nextStep}` : ''}`,
    method: 'POST',
    bargeIn: config.enableBargeIn
  });

  saySafe(gather, response.speech);

  // Fallback if no response
  saySafe(vr, "I didn't catch that. Let me transfer you to our reception.");
  vr.redirect({
    method: 'POST'
  }, `/api/voice/handle-flow?callSid=${callSid}&step=error_recovery`);
}

/**
 * Get suggested next FSM step from AI response
 */
export function getNextFSMStep(aiResponse: DialogueResponse | null): string | null {
  if (!aiResponse) return null;

  // Map AI intents/actions to FSM steps
  const intentToStep: Record<string, string> = {
    'booking_new_patient': 'new_patient_phone_confirm',
    'booking_standard': 'returning_patient_lookup',
    'change_appointment': 'transfer',
    'cancel_appointment': 'transfer',
    'ask_human': 'transfer',
    'emergency': 'emergency',
    'confirmation': 'confirm_booking',
    'negation': 'appointment_search'
  };

  if (aiResponse.nextStep) {
    return aiResponse.nextStep;
  }

  return intentToStep[aiResponse.intent] || null;
}

/**
 * Quick intent classification without full dialogue processing
 * Useful for simple routing decisions in FSM
 */
export async function quickClassify(
  speech: string
): Promise<{ intent: string; confidence: number; day?: string; time?: string }> {
  try {
    const result = await classifyIntent(speech);
    return {
      intent: result.intent,
      confidence: result.confidence,
      day: result.details.preferredDay,
      time: result.details.preferredTime
    };
  } catch (error) {
    console.error('[AIVoice] Quick classify failed:', error);
    return { intent: 'unknown', confidence: 0 };
  }
}

/**
 * Clean up AI resources when call ends
 */
export function cleanupAICall(callSid: string): void {
  clearMemory(callSid);
  console.log(`[AIVoice] Cleaned up AI for call ${callSid}`);
}

/**
 * Check if we should use AI for this call/step
 */
export function shouldUseAI(
  callSid: string,
  currentFSMState: string,
  config: Partial<AIVoiceConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enableAI || !isLLMAvailable()) {
    return false;
  }

  // Get conversation state
  const state = getDialogueState(callSid);

  // Check turn limit
  if (state.memory.turnCount >= cfg.maxAITurns) {
    console.log(`[AIVoice] Turn limit reached (${state.memory.turnCount}/${cfg.maxAITurns})`);
    return false;
  }

  // Check error count
  if (!state.canContinue) {
    console.log('[AIVoice] Too many errors, falling back to FSM');
    return false;
  }

  // Some FSM states should always use FSM logic
  const fsmOnlyStates = [
    'WAITING_FOR_FORM',
    'CHECK_FORM_STATUS',
    'ERROR_RECOVERY'
  ];

  if (fsmOnlyStates.includes(currentFSMState)) {
    return false;
  }

  return true;
}

/**
 * Merge AI-collected info into FSM context
 */
export function mergeAIContext(
  callSid: string,
  fsmContext: any
): any {
  const memory = getMemory(callSid);
  const collected = memory.collected;

  return {
    ...fsmContext,
    // Merge AI collected info
    patientName: collected.callerName || fsmContext.patientName,
    patientFirstName: collected.firstName || fsmContext.patientFirstName,
    patientEmail: collected.email || fsmContext.patientEmail,
    preferredDay: collected.preferredDay || fsmContext.preferredDay,
    // AI specific
    aiTurnCount: memory.turnCount,
    aiIntent: memory.currentIntent,
    aiCollected: collected
  };
}
