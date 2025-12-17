# OpenAI Conversation Mode

## Overview

Echo Desk now supports an **OpenAI-powered conversational AI mode** that provides a more natural, human-like interaction compared to the traditional FSM (Finite State Machine) approach.

### Key Features

- **Goal-First Understanding**: Extracts ALL information from the first utterance (intent, time preference, symptoms, FAQs)
- **Multi-Intent Awareness**: Handles when callers ask multiple questions in one sentence
- **Natural Responses**: OpenAI generates human-like, contextual responses (not hardcoded)
- **Structured State Tracking**: Maintains conversation context with JSON state extraction
- **FAQ Knowledge**: Built-in answers for common chiropractic questions
- **No Redundancy**: Never asks the same question twice if information is already known

### Architecture

```
Twilio Call → OpenAI Receptionist Brain → TwiML Response
     ↓              ↓                           ↓
  Speech      Extract State                 Polly TTS
  Input       + Generate Reply              + Gather
```

**Key Components:**

1. **`server/ai/receptionistBrain.ts`**: OpenAI wrapper with comprehensive system prompt
2. **`server/services/openai-call-handler.ts`**: Conversation flow management and Cliniko integration
3. **`server/routes/voice.ts`**: New webhook endpoints (`/api/voice/openai-incoming`, `/api/voice/openai-continue`)

## How to Enable

### Step 1: Set Environment Variable

Add to your `.env` file:

```bash
OPENAI_CONVERSATION_MODE=true
OPENAI_API_KEY=sk-...your-key...
```

**Note**: If `OPENAI_CONVERSATION_MODE` is `false` or not set, the system will use the traditional FSM approach.

### Step 2: Configure Twilio Webhook

In your Twilio phone number settings, update the **Voice Configuration**:

**When a call comes in:**
- Set webhook URL to: `https://your-domain.com/api/voice/openai-incoming`
- Method: `POST`

Example:
```
https://echo-desk-production-xxxx.up.railway.app/api/voice/openai-incoming
```

### Step 3: Deploy and Test

Deploy your changes to Railway (or your hosting platform), then test by calling your Twilio number.

## Conversation Flow

### 1. Greeting

The system greets the caller and listens for their full request:

```
Assistant: "Hi, thanks for calling Spinalogic, this is Sarah. How can I help you today?"

Caller: "Hi, I'd like to come in this afternoon if you've got anything,
         my lower back's killing me, I've never been there before,
         and I was wondering how much it costs."
```

### 2. Goal Extraction

OpenAI extracts structured state from the utterance:

```json
{
  "intent_main": "book_appointment",
  "sub_intents": ["faq_pricing"],
  "is_new_patient": true,
  "time_preference_raw": "this afternoon",
  "symptom_description": "lower back pain",
  "wants_today": true,
  "faq_questions": ["how much does it cost"],
  "ready_to_offer_slots": false
}
```

### 3. Natural Response

OpenAI generates a response that:
- Acknowledges their situation
- Answers the FAQ
- Moves toward booking

```
Assistant: "Sure, I can help you with an appointment this afternoon.
           I'm sorry your lower back is giving you trouble.
           For a first visit, it's usually around $80, and we'll do a full assessment.
           What's your full name so I can put you into the system?"
```

### 4. Slot Offering

Once the system has enough information (name, new/existing, time preference), it fetches available slots from Cliniko:

```
Assistant: "For this afternoon I have three times that could work:
           2:15, 3:00, or 4:30. Which suits you best?"
```

### 5. Booking Confirmation

After the caller chooses a time, the system confirms and (for new patients) offers to send an SMS form:

```
Assistant: "Great, I'll book that in for 3:00.
           I can also text you a quick form to fill in your details
           so everything goes straight into our system.
           Shall I send that to this number?"
```

## FAQ Handling

The system has built-in knowledge for common questions:

| Question Type | Example | Built-in Answer |
|--------------|---------|-----------------|
| **Techniques** | "What techniques do you use?" | "We use a range of gentle chiropractic techniques tailored to your comfort..." |
| **Treat Kids** | "Do you treat children?" | "Yes, absolutely — we treat kids, teens, adults, and older patients..." |
| **Duration** | "How long is the appointment?" | "First visits are about 45 minutes because there's an assessment. Follow-ups are around 15 minutes." |
| **Pain/Comfort** | "Does it hurt?" | "Most people find treatment comfortable, and some even find it relaxing..." |
| **Pricing** | "How much does it cost?" | "First visits are usually around $80, follow-ups about $50..." |
| **Location** | "Where are you located?" | "We're at 123 Main Street, right near the post office..." |
| **Hours** | "When are you open?" | "We're open Monday to Friday, 8am to 6pm, and Saturday mornings 8 to 12..." |

### Fallback Rules

The system will **only** fallback to "I can't answer that" for:
- Medical diagnosis or prognosis
- Medication advice
- Highly technical biomedical questions
- Legal or liability questions
- Completely off-topic subjects

## Comparison: FSM vs OpenAI Mode

| Feature | FSM (Traditional) | OpenAI Mode |
|---------|------------------|-------------|
| **Response Type** | Hardcoded | Dynamic (generated by OpenAI) |
| **Intent Extraction** | Single intent per turn | Multi-intent from first utterance |
| **Conversation Flow** | Rigid state machine | Flexible, goal-oriented |
| **FAQ Handling** | Database lookup + hardcoded answers | Built-in knowledge in system prompt |
| **Redundancy** | May ask same question multiple times | Never asks twice if already known |
| **Natural Language** | Script-like | Human-like |
| **Time Preference** | Requires specific prompts | Understands "this afternoon", "tomorrow morning", etc. |
| **Multi-turn Context** | Limited (only current state) | Full conversation history |

## Customization

### Updating FAQ Answers

Edit the system prompt in `server/ai/receptionistBrain.ts`:

```typescript
const RECEPTIONIST_SYSTEM_PROMPT = `
...

### Pricing
"First visits are usually around $80, follow-ups about $50. I can give you more detail if you like, or send you our pricing sheet."

...
`;
```

### Adjusting Tone

Modify the "IDENTITY AND TONE" section:

```typescript
Your name is Sarah. You are warm, calm, professional, and human.
- Use short, natural spoken-language sentences (this is TTS)
- Never sound robotic or formal
- Show empathy for symptoms and concerns
- Be efficient but not rushed
```

### Changing Clinic Details

The system automatically uses your tenant configuration:
- Clinic name from tenant database
- Timezone from tenant settings
- Known patient info from Cliniko

## Troubleshooting

### "I'm having trouble with my system"

This error means OpenAI failed to respond. Check:
1. `OPENAI_API_KEY` is set and valid
2. OpenAI API is not experiencing downtime
3. Check server logs for detailed error messages

### Responses seem generic

OpenAI may need more context. Ensure:
1. Conversation history is being saved correctly
2. Known patient info is being passed to context
3. Available slots are being fetched and added to context

### System asks redundant questions

Check that:
1. `currentState` is being updated with new parsed state
2. System prompt includes "NO REDUNDANCY" rules
3. Conversation context is being loaded from database

### JSON parse errors

OpenAI occasionally returns malformed JSON. The system has fallback handling, but if it happens frequently:
1. Increase `temperature` to reduce creativity (currently 0.7)
2. Add more examples to system prompt
3. Consider using JSON mode (OpenAI API feature)

## Testing Examples

Test these scenarios to verify the system works:

### Scenario 1: Multi-Intent Booking

**Caller**: "Hi, I'd like to book today at 4pm, my neck hurts, do you treat kids? My daughter needs to come too."

**Expected**:
- Extracts: booking intent, today, 4pm, neck pain, FAQ about kids
- Responds: Acknowledges booking + symptoms, answers kid question, continues with booking

### Scenario 2: Assertive Caller

**Caller**: "I need an appointment this afternoon for my back."

**Expected**:
- Extracts: booking intent, this afternoon, back pain
- Does NOT ask "What brings you in?" (already knows)
- Moves directly to asking if new/existing patient

### Scenario 3: FAQ Only

**Caller**: "How much does a first visit cost?"

**Expected**:
- Recognizes FAQ intent
- Provides pricing information
- Asks if they'd like to book an appointment

### Scenario 4: Change Appointment

**Caller**: "I need to change my appointment from Thursday to Friday."

**Expected**:
- Recognizes change_appointment intent
- Looks up existing appointment
- Offers available slots for Friday

## Performance Considerations

- **Latency**: OpenAI API adds ~1-2 seconds per turn
- **Cost**: Approximately $0.01-0.02 per call (using gpt-4o-mini)
- **Token Usage**: ~500-1000 tokens per turn (including history)

**Cost Optimization Tips**:
1. Use `gpt-4o-mini` (default) instead of `gpt-4o`
2. Limit conversation history to last 10 turns
3. Truncate long symptom descriptions in state

## Migration Guide

### From FSM to OpenAI Mode

1. **Test in parallel**: Keep FSM running on one number, OpenAI on another
2. **Monitor logs**: Watch for errors and edge cases
3. **Compare transcripts**: Check if OpenAI responses are appropriate
4. **Adjust prompts**: Refine system prompt based on real calls
5. **Full cutover**: Once confident, update all Twilio numbers

### Rollback Plan

If you need to revert to FSM mode:

1. Set `OPENAI_CONVERSATION_MODE=false` in `.env`
2. Update Twilio webhook to `/api/voice/incoming`
3. Deploy changes

**Note**: Both systems can coexist. You can even use different modes for different tenant phone numbers.

## Future Enhancements

Potential improvements to the OpenAI conversation system:

- [ ] Streaming responses for lower latency
- [ ] Voice cloning for more personalized TTS
- [ ] Multi-language support
- [ ] Emotion detection and empathetic responses
- [ ] Integration with calendar for smarter scheduling
- [ ] Learning from user corrections
- [ ] A/B testing different system prompts

## Support

For issues or questions:
1. Check server logs: `docker logs echo-desk` or Railway logs
2. Review call transcripts in admin dashboard
3. Test with verbose logging: `LOG_LEVEL=debug`
4. Open an issue in the GitHub repository
