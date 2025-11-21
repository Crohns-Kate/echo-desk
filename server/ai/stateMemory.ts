/**
 * State Memory - Conversation memory management per callSid
 * Tracks conversation context, collected information, and dialogue state
 */

import type { IntentType, IntentDetails } from './intentRouter';

// What information we need to collect for a booking
export interface CollectedInfo {
  callerName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  patientId?: string;           // Cliniko patient ID if matched
  isNewPatient?: boolean;
  appointmentType?: string;
  preferredDay?: string;
  preferredTime?: string;
  preferredDateRange?: {
    from: string;              // ISO date
    to: string;                // ISO date
  };
  complaint?: string;          // Chief complaint / reason for visit
  selectedSlotIndex?: number;
  selectedSlot?: {
    startISO: string;
    speakable: string;
    practitionerId?: string;
    appointmentTypeId?: string;
  };
}

// What information is still missing
export interface MissingInfo {
  needsName: boolean;
  needsEmail: boolean;
  needsPhone: boolean;
  needsPatientType: boolean;   // New vs returning
  needsAppointmentType: boolean;
  needsDateTime: boolean;
  needsSlotSelection: boolean;
  needsConfirmation: boolean;
}

// Conversation memory state
export interface ConversationMemory {
  callSid: string;
  tenantId?: number;
  startedAt: string;           // ISO timestamp
  lastActivityAt: string;      // ISO timestamp

  // Current dialogue state
  currentIntent: IntentType;
  intentHistory: Array<{
    intent: IntentType;
    timestamp: string;
    utterance: string;
  }>;

  // Collected information
  collected: CollectedInfo;
  missing: MissingInfo;

  // Dialogue tracking
  turnCount: number;
  lastQuestion?: string;       // Last question we asked
  awaitingResponseType?: 'yes_no' | 'name' | 'email' | 'phone' | 'date' | 'time' | 'slot' | 'confirmation' | 'open';

  // Error tracking
  errorCount: number;
  lastError?: string;

  // Raw transcript
  transcript: Array<{
    role: 'caller' | 'system';
    content: string;
    timestamp: string;
  }>;
}

// In-memory storage (per process - in production use Redis)
const memoryStore = new Map<string, ConversationMemory>();

/**
 * Initialize new conversation memory
 */
export function initializeMemory(callSid: string, tenantId?: number): ConversationMemory {
  const now = new Date().toISOString();

  const memory: ConversationMemory = {
    callSid,
    tenantId,
    startedAt: now,
    lastActivityAt: now,
    currentIntent: 'unknown',
    intentHistory: [],
    collected: {},
    missing: {
      needsName: true,
      needsEmail: true,
      needsPhone: false,  // We usually have caller's phone from Twilio
      needsPatientType: true,
      needsAppointmentType: false,  // Can default
      needsDateTime: true,
      needsSlotSelection: true,
      needsConfirmation: true
    },
    turnCount: 0,
    errorCount: 0,
    transcript: []
  };

  memoryStore.set(callSid, memory);
  console.log(`[StateMemory] Initialized memory for ${callSid}`);

  return memory;
}

/**
 * Get existing memory or initialize new
 */
export function getMemory(callSid: string, tenantId?: number): ConversationMemory {
  const existing = memoryStore.get(callSid);
  if (existing) {
    return existing;
  }
  return initializeMemory(callSid, tenantId);
}

/**
 * Update memory with new intent
 */
export function recordIntent(
  callSid: string,
  intent: IntentType,
  utterance: string,
  details?: IntentDetails
): ConversationMemory {
  const memory = getMemory(callSid);
  const now = new Date().toISOString();

  // Update current intent
  memory.currentIntent = intent;
  memory.lastActivityAt = now;
  memory.turnCount++;

  // Add to history
  memory.intentHistory.push({
    intent,
    timestamp: now,
    utterance
  });

  // Add to transcript
  memory.transcript.push({
    role: 'caller',
    content: utterance,
    timestamp: now
  });

  // Update collected info from details
  if (details) {
    if (details.name) {
      memory.collected.callerName = details.name;
      memory.collected.firstName = details.name.split(' ')[0];
      memory.missing.needsName = false;
    }
    if (details.email) {
      memory.collected.email = details.email;
      memory.missing.needsEmail = false;
    }
    if (details.phone) {
      memory.collected.phone = details.phone;
      memory.missing.needsPhone = false;
    }
    if (details.preferredDay) {
      memory.collected.preferredDay = details.preferredDay;
      memory.missing.needsDateTime = false;
    }
    if (details.preferredTime) {
      memory.collected.preferredTime = details.preferredTime;
    }
    if (details.existingPatient !== undefined) {
      memory.collected.isNewPatient = !details.existingPatient;
      memory.missing.needsPatientType = false;
    }
    if (details.appointmentType) {
      memory.collected.appointmentType = details.appointmentType;
      memory.missing.needsAppointmentType = false;
    }
  }

  memoryStore.set(callSid, memory);
  return memory;
}

/**
 * Record system response in transcript
 */
export function recordSystemResponse(callSid: string, response: string): void {
  const memory = getMemory(callSid);
  memory.transcript.push({
    role: 'system',
    content: response,
    timestamp: new Date().toISOString()
  });
  memory.lastQuestion = response;
  memoryStore.set(callSid, memory);
}

/**
 * Update collected information
 */
export function updateCollectedInfo(
  callSid: string,
  updates: Partial<CollectedInfo>
): ConversationMemory {
  const memory = getMemory(callSid);

  Object.assign(memory.collected, updates);

  // Update missing flags based on what was collected
  if (updates.callerName || updates.firstName) {
    memory.missing.needsName = false;
  }
  if (updates.email) {
    memory.missing.needsEmail = false;
  }
  if (updates.phone) {
    memory.missing.needsPhone = false;
  }
  if (updates.isNewPatient !== undefined) {
    memory.missing.needsPatientType = false;
  }
  if (updates.preferredDay || updates.preferredDateRange) {
    memory.missing.needsDateTime = false;
  }
  if (updates.selectedSlot || updates.selectedSlotIndex !== undefined) {
    memory.missing.needsSlotSelection = false;
  }

  memory.lastActivityAt = new Date().toISOString();
  memoryStore.set(callSid, memory);
  return memory;
}

/**
 * Set what type of response we're waiting for
 */
export function setAwaitingResponse(
  callSid: string,
  type: ConversationMemory['awaitingResponseType']
): void {
  const memory = getMemory(callSid);
  memory.awaitingResponseType = type;
  memoryStore.set(callSid, memory);
}

/**
 * Get the next piece of missing information to collect
 */
export function getNextMissingInfo(callSid: string): keyof MissingInfo | null {
  const memory = getMemory(callSid);
  const { missing } = memory;

  // Priority order for collection
  const priorities: (keyof MissingInfo)[] = [
    'needsPatientType',    // First: new or returning?
    'needsName',           // Then: who are you?
    'needsDateTime',       // Then: when do you want to come?
    'needsSlotSelection',  // Then: which slot?
    'needsConfirmation',   // Finally: confirm booking
    'needsEmail',          // Optional: email for confirmation
    'needsPhone',          // Optional: usually have it
    'needsAppointmentType' // Optional: can default
  ];

  for (const key of priorities) {
    if (missing[key]) {
      return key;
    }
  }

  return null;
}

/**
 * Mark confirmation as received
 */
export function markConfirmed(callSid: string): void {
  const memory = getMemory(callSid);
  memory.missing.needsConfirmation = false;
  memoryStore.set(callSid, memory);
}

/**
 * Record an error
 */
export function recordError(callSid: string, error: string): number {
  const memory = getMemory(callSid);
  memory.errorCount++;
  memory.lastError = error;
  memoryStore.set(callSid, memory);
  return memory.errorCount;
}

/**
 * Get conversation summary for handoff
 */
export function getConversationSummary(callSid: string): string {
  const memory = memoryStore.get(callSid);
  if (!memory) return 'No conversation history';

  const parts: string[] = [];

  if (memory.collected.callerName) {
    parts.push(`Caller: ${memory.collected.callerName}`);
  }
  if (memory.collected.isNewPatient !== undefined) {
    parts.push(`Patient type: ${memory.collected.isNewPatient ? 'New' : 'Returning'}`);
  }
  if (memory.currentIntent !== 'unknown') {
    parts.push(`Intent: ${memory.currentIntent}`);
  }
  if (memory.collected.preferredDay) {
    parts.push(`Preferred: ${memory.collected.preferredDay}${memory.collected.preferredTime ? ' ' + memory.collected.preferredTime : ''}`);
  }

  parts.push(`Turns: ${memory.turnCount}`);

  return parts.join(' | ');
}

/**
 * Export full transcript
 */
export function getFullTranscript(callSid: string): string {
  const memory = memoryStore.get(callSid);
  if (!memory) return '';

  return memory.transcript
    .map(t => `[${t.role.toUpperCase()}] ${t.content}`)
    .join('\n');
}

/**
 * Clear memory for a call (on call end)
 */
export function clearMemory(callSid: string): void {
  memoryStore.delete(callSid);
  console.log(`[StateMemory] Cleared memory for ${callSid}`);
}

/**
 * Get memory stats (for debugging)
 */
export function getMemoryStats(): { activeConversations: number; callSids: string[] } {
  return {
    activeConversations: memoryStore.size,
    callSids: Array.from(memoryStore.keys())
  };
}
