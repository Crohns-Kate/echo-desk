/**
 * AI Module - Conversational AI Layer for Echo Desk
 *
 * This module provides LLM-driven conversation capabilities:
 * - Intent classification with expanded taxonomy
 * - Knowledge base responses
 * - Conversation memory management
 * - Safety guardrails
 * - Dialogue orchestration
 *
 * Usage:
 *   import { processUtterance, classifyIntent, isLLMAvailable } from './ai';
 */

// LLM Provider
export {
  complete,
  quickComplete,
  isLLMAvailable,
  getCurrentProvider,
  type LLMMessage,
  type LLMOptions,
  type LLMResponse
} from './llmProvider';

// Intent Router
export {
  classifyIntent,
  describeIntent,
  type IntentType,
  type IntentDetails,
  type IntentResult
} from './intentRouter';

// Knowledge Responder
export {
  respondToQuery,
  getQuickResponse,
  clearKnowledgeCache,
  type KnowledgeCategory
} from './knowledgeResponder';

// State Memory
export {
  initializeMemory,
  getMemory,
  recordIntent,
  recordSystemResponse,
  updateCollectedInfo,
  setAwaitingResponse,
  getNextMissingInfo,
  markConfirmed,
  recordError,
  getConversationSummary,
  getFullTranscript,
  clearMemory,
  getMemoryStats,
  type ConversationMemory,
  type CollectedInfo,
  type MissingInfo
} from './stateMemory';

// Safety Guardrails
export {
  checkSafetyGuardrails,
  validateResponse,
  getSafeFallback,
  checkResponseLength,
  type SafetyCheckResult
} from './safetyGuardrails';

// Dialogue Manager
export {
  processUtterance,
  getDialogueState,
  type DialogueContext,
  type DialogueResponse,
  type DialogueAction
} from './dialogueManager';
