/**
 * Debug endpoints for testing OpenAI receptionist brain
 * Use these to manually test conversation logic before Twilio integration
 */

import { Express, Request, Response } from "express";
import {
  callReceptionistBrain,
  initializeConversation,
  addTurnToHistory,
  updateConversationState,
  type CompactCallState,
  type ConversationContext
} from "../ai/receptionistBrain";

export function setupDebugRoutes(app: Express) {
  /**
   * Test endpoint for OpenAI receptionist brain
   *
   * Usage with curl:
   *
   * curl -X POST http://localhost:8080/api/debug/receptionist \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "message": "I'd like to come in this afternoon for my lower back",
   *     "state": {}
   *   }'
   *
   * Or test a follow-up message:
   *
   * curl -X POST http://localhost:8080/api/debug/receptionist \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "message": "John Smith",
   *     "state": {"im": "book", "tp": "this afternoon", "sym": "lower back pain", "np": true},
   *     "history": [
   *       {"role": "user", "content": "I'd like to come in this afternoon for my lower back"},
   *       {"role": "assistant", "content": "Sure, I can help with that..."}
   *     ]
   *   }'
   */
  app.post("/api/debug/receptionist", async (req: Request, res: Response) => {
    try {
      const { message, state, history, clinicName, knownPatient, availableSlots, firstTurn } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({
          error: "Missing or invalid 'message' field (must be a string)"
        });
      }

      console.log("\n[DEBUG][RECEPTIONIST] ════════════════════════════════════════");
      console.log("[DEBUG][RECEPTIONIST] Testing OpenAI receptionist brain");
      console.log("[DEBUG][RECEPTIONIST] Message:", message);
      console.log("[DEBUG][RECEPTIONIST] Current state:", JSON.stringify(state || {}, null, 2));
      console.log("[DEBUG][RECEPTIONIST] ════════════════════════════════════════\n");

      // Create conversation context
      let context: ConversationContext = {
        callSid: 'DEBUG-TEST',
        callerPhone: '+61400000000',
        history: [],
        currentState: state || {},
        clinicName: clinicName || 'Spinalogic',
        knownPatient: knownPatient || undefined,
        availableSlots: availableSlots || undefined,
        firstTurn: firstTurn !== undefined ? firstTurn : !history || history.length === 0
      };

      // Add history if provided
      if (history && Array.isArray(history)) {
        for (const turn of history) {
          if (turn.role && turn.content) {
            context = addTurnToHistory(context, turn.role, turn.content);
          }
        }
      }

      // Call OpenAI receptionist brain
      const result = await callReceptionistBrain(context, message);

      console.log("\n[DEBUG][RECEPTIONIST] ────────────────────────────────────────");
      console.log("[DEBUG][RECEPTIONIST] OpenAI Response:");
      console.log("[DEBUG][RECEPTIONIST] Reply:", result.reply);
      console.log("[DEBUG][RECEPTIONIST] State:", JSON.stringify(result.state, null, 2));
      console.log("[DEBUG][RECEPTIONIST] ────────────────────────────────────────\n");

      // Return result
      return res.json({
        success: true,
        reply: result.reply,
        state: result.state,
        context: {
          message: "This is what the receptionist would say to the caller",
          stateExplanation: {
            im: "Intent: " + (result.state.im || "unknown"),
            np: "Is new patient: " + (result.state.np === null ? "unknown" : result.state.np),
            nm: "Name: " + (result.state.nm || "not provided"),
            tp: "Time preference: " + (result.state.tp || "not provided"),
            sym: "Symptom: " + (result.state.sym || "not mentioned"),
            faq: "FAQ questions: " + (result.state.faq.length > 0 ? result.state.faq.join(", ") : "none"),
            rs: "Ready to offer slots: " + (result.state.rs ? "YES - backend should fetch times" : "NO - need more info")
          }
        }
      });

    } catch (error: any) {
      console.error("[DEBUG][RECEPTIONIST] ERROR:", error);
      return res.status(500).json({
        error: "Internal server error",
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  /**
   * Test multi-turn conversation
   *
   * Usage:
   *
   * curl -X POST http://localhost:8080/api/debug/receptionist-conversation \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "messages": [
   *       "I'd like to come in this afternoon for my lower back",
   *       "John Smith",
   *       "This is my first visit"
   *     ]
   *   }'
   */
  app.post("/api/debug/receptionist-conversation", async (req: Request, res: Response) => {
    try {
      const { messages, clinicName, knownPatient } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: "Missing or invalid 'messages' field (must be array of strings)"
        });
      }

      console.log("\n[DEBUG][CONVERSATION] ════════════════════════════════════════");
      console.log("[DEBUG][CONVERSATION] Testing multi-turn conversation");
      console.log("[DEBUG][CONVERSATION] Messages:", messages);
      console.log("[DEBUG][CONVERSATION] ════════════════════════════════════════\n");

      // Initialize conversation
      let context = initializeConversation(
        'DEBUG-CONVERSATION',
        '+61400000000',
        clinicName || 'Spinalogic',
        knownPatient
      );

      const turns: Array<{ user: string; assistant: string; state: CompactCallState }> = [];

      // Process each message
      for (const message of messages) {
        console.log("\n[DEBUG][CONVERSATION] ──────────────────────────────────────");
        console.log("[DEBUG][CONVERSATION] User:", message);

        const result = await callReceptionistBrain(context, message);

        console.log("[DEBUG][CONVERSATION] Assistant:", result.reply);
        console.log("[DEBUG][CONVERSATION] State:", JSON.stringify(result.state, null, 2));

        turns.push({
          user: message,
          assistant: result.reply,
          state: result.state
        });

        // Update context for next turn
        context = addTurnToHistory(context, 'user', message);
        context = addTurnToHistory(context, 'assistant', result.reply);
        context = updateConversationState(context, result.state);
      }

      console.log("\n[DEBUG][CONVERSATION] ════════════════════════════════════════");
      console.log("[DEBUG][CONVERSATION] Conversation complete");
      console.log("[DEBUG][CONVERSATION] Total turns:", turns.length);
      console.log("[DEBUG][CONVERSATION] Final state:", JSON.stringify(context.currentState, null, 2));
      console.log("[DEBUG][CONVERSATION] ════════════════════════════════════════\n");

      return res.json({
        success: true,
        turns,
        finalState: context.currentState,
        conversationHistory: context.history
      });

    } catch (error: any) {
      console.error("[DEBUG][CONVERSATION] ERROR:", error);
      return res.status(500).json({
        error: "Internal server error",
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  console.log("[DEBUG] Debug routes registered:");
  console.log("[DEBUG]   POST /api/debug/receptionist - Test single message");
  console.log("[DEBUG]   POST /api/debug/receptionist-conversation - Test multi-turn conversation");
}
