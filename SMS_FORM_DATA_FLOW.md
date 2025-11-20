# SMS Form Data Flow - Where Information Goes

## Overview

When a patient fills out the SMS verification form, the data flows through multiple systems and gets stored in two places:

1. **Conversation Context** (your local database)
2. **Cliniko** (immediately, if patient exists)

---

## Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Patient receives SMS with link                               │
│    Example: /verify-details?callSid=CAxxxx                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Patient clicks link → Beautiful mobile form loads            │
│    Form displays: First Name, Last Name, Email fields           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Patient fills out and submits form                           │
│    JavaScript sends data to TWO API endpoints:                  │
│    - POST /api/name-verify (firstName, lastName, callSid)       │
│    - POST /api/email-collect (email, callSid)                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Server receives data (server/routes/app.ts)                  │
│                                                                  │
│    A. /api/name-verify endpoint (lines 406-469)                 │
│    B. /api/email-collect endpoint (lines 352-403)               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Data gets stored in TWO places IMMEDIATELY:                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ A. CONVERSATION CONTEXT (Local Database)                │   │
│  │    Location: storage.updateConversation()               │   │
│  │                                                          │   │
│  │    Stored fields:                                       │   │
│  │    - fullName: "Chris Jackson"                          │   │
│  │    - firstName: "Chris"                                 │   │
│  │    - email: "chris@example.com"                         │   │
│  │    - nameVerifiedViaSMS: true                           │   │
│  │    - emailCollectedViaSMS: true                         │   │
│  │                                                          │   │
│  │    Purpose: Used for ongoing conversation context       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ B. CLINIKO PATIENT RECORD (Immediate Update)            │   │
│  │    Function: updateClinikoPatient()                     │   │
│  │    API: PATCH /patients/{id}                            │   │
│  │                                                          │   │
│  │    Updated fields in Cliniko:                           │   │
│  │    - first_name: "Chris"                                │   │
│  │    - last_name: "Jackson"                               │   │
│  │    - email: "chris@example.com"                         │   │
│  │                                                          │   │
│  │    How it finds patient:                                │   │
│  │    1. Uses call.fromNumber (phone from call)            │   │
│  │    2. Calls findPatientByPhone()                        │   │
│  │    3. Updates that patient record immediately           │   │
│  │                                                          │   │
│  │    Purpose: Real-time sync with practice management     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Success message shown to patient                             │
│    "✓ Thanks! Your details have been saved."                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detailed Code Flow

### Step 1: Form Submission (Client-Side)

**File**: `server/routes/forms.ts` (lines 857-868)

```javascript
// When patient clicks "Submit"
await fetch('/api/name-verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ callSid, firstName, lastName })
});

await fetch('/api/email-collect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ callSid, email })
});
```

---

### Step 2: Name Storage (Server-Side)

**File**: `server/routes/app.ts` (lines 406-469)

```typescript
// POST /api/name-verify endpoint
app.post('/api/name-verify', async (req: Request, res: Response) => {
  const { callSid, firstName, lastName } = req.body;

  // 1. Find the call record
  const call = await storage.getCallByCallSid(callSid);

  // 2. Update conversation context in LOCAL DATABASE
  if (call.conversationId) {
    const conversation = await storage.getConversation(call.conversationId);
    const existingContext = (conversation?.context as any) || {};

    await storage.updateConversation(call.conversationId, {
      context: {
        ...existingContext,
        fullName: `${firstName} ${lastName}`,
        firstName: firstName.trim(),
        nameVerifiedViaSMS: true
      }
    });
  }

  // 3. Update CLINIKO IMMEDIATELY (if patient exists)
  if (call.fromNumber) {
    const patient = await findPatientByPhone(call.fromNumber);
    if (patient && patient.id) {
      await updateClinikoPatient(patient.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim()
      });
      console.log('[NAME-VERIFY] ✅ Cliniko patient updated');
    }
  }
});
```

---

### Step 3: Email Storage (Server-Side)

**File**: `server/routes/app.ts` (lines 352-403)

```typescript
// POST /api/email-collect endpoint
app.post('/api/email-collect', async (req: Request, res: Response) => {
  const { callSid, email } = req.body;

  // 1. Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // 2. Update conversation context in LOCAL DATABASE
  if (call.conversationId) {
    await storage.updateConversation(call.conversationId, {
      context: {
        ...existingContext,
        email: email.toLowerCase(),
        emailCollectedViaSMS: true
      }
    });
  }

  // 3. Update CLINIKO IMMEDIATELY (if patient exists and email is empty)
  if (call.fromNumber) {
    const patient = await findPatientByPhone(call.fromNumber);
    if (patient && patient.id && (!patient.email || patient.email === '')) {
      await updateClinikoPatient(patient.id, {
        email: email.toLowerCase()
      });
      console.log('[EMAIL-COLLECT] ✅ Cliniko patient updated with email');
    }
  }
});
```

---

## Where Data is Stored

### 1. Conversation Context (Your Database)

**Location**: SQLite database (or your configured storage)
**Table**: `conversations`
**Field**: `context` (JSON column)

**Example stored data**:
```json
{
  "fullName": "Chris Jackson",
  "firstName": "Chris",
  "email": "chris@example.com",
  "nameVerifiedViaSMS": true,
  "emailCollectedViaSMS": true,
  "phone": "+61401687714",
  "appointmentBooked": true,
  "clinikoPatientId": "12345",
  "appointmentDetails": {
    "date": "2025-11-25",
    "time": "10:00 AM"
  }
}
```

**Purpose**:
- Powers ongoing conversation flow
- Tracks what data has been collected
- Prevents asking for same info twice
- Used by AI assistant to personalize responses

**Access**: Can be queried via:
```typescript
const conversation = await storage.getConversation(conversationId);
const email = conversation.context.email;
const name = conversation.context.fullName;
```

---

### 2. Cliniko Patient Record

**Location**: Cliniko cloud system (external API)
**Endpoint**: `https://api.au4.cliniko.com/v1/patients/{id}`
**Updated via**: `PATCH` request

**Example Cliniko record after update**:
```json
{
  "id": "12345",
  "first_name": "Chris",
  "last_name": "Jackson",
  "email": "chris@example.com",
  "phone_numbers": [
    {
      "number": "+61401687714",
      "phone_type": "Mobile"
    }
  ],
  "created_at": "2025-11-20T00:42:00Z",
  "updated_at": "2025-11-20T00:45:30Z"
}
```

**Purpose**:
- Official patient management system
- Used for appointment scheduling
- Accessible by clinic staff
- Permanent patient record

**When it updates**:
1. **Immediately** when form is submitted (if patient exists)
2. **During booking** if patient doesn't exist yet (creates new patient)

---

## Verification Flags

The system tracks HOW data was collected:

```typescript
{
  "nameVerifiedViaSMS": true,      // Name came from SMS form (typed)
  "emailCollectedViaSMS": true,    // Email came from SMS form (typed)
  "nameFromVoice": false,          // vs. voice transcription
  "emailFromVoice": false          // vs. voice transcription
}
```

**Why this matters**:
- SMS form data is MORE accurate (typed vs. spoken/transcribed)
- System knows which data is verified
- Prevents re-asking for already verified info

---

## Example: Chris Jackson's Full Journey

### 1. Initial Call
```
Phone: +61401687714
Voice: "This is Chris Jackson calling"
→ Stored in conversation context: { fullName: "Chris Jackson" }
```

### 2. During Call
```
System creates/finds patient in Cliniko
→ Patient ID: 12345 (new patient created)
→ Name might be wrong due to voice transcription: "Chris Jakson" 😕
```

### 3. SMS Sent After Call
```
SMS: "Click here to verify your details: https://example.com/verify-details?callSid=CA123"
```

### 4. Patient Fills Form
```
First Name: Chris
Last Name: Jackson
Email: chris@example.com
→ Submits form
```

### 5. Data Storage (Happens Simultaneously)

**A. Conversation Context Updated:**
```json
{
  "fullName": "Chris Jackson",
  "firstName": "Chris",
  "email": "chris@example.com",
  "nameVerifiedViaSMS": true,
  "emailCollectedViaSMS": true,
  "phone": "+61401687714",
  "clinikoPatientId": "12345"
}
```

**B. Cliniko Patient Updated:**
```
PATCH https://api.au4.cliniko.com/v1/patients/12345
{
  "first_name": "Chris",
  "last_name": "Jackson",
  "email": "chris@example.com"
}
```

### 6. Result
- ✅ Conversation context has accurate data
- ✅ Cliniko has accurate data
- ✅ Future calls will use correct info
- ✅ Clinic staff see correct patient record

---

## What Happens on Next Call

When Chris calls again from +61401687714:

```typescript
// 1. System looks up patient by phone
const patient = await findPatientByPhone('+61401687714');

// 2. Finds Chris Jackson (updated with correct info)
// Result:
{
  id: "12345",
  first_name: "Chris",
  last_name: "Jackson",
  email: "chris@example.com"
}

// 3. Checks conversation context
{
  fullName: "Chris Jackson",
  email: "chris@example.com",
  nameVerifiedViaSMS: true,
  emailCollectedViaSMS: true
}

// 4. System says:
"Hi Chris! Welcome back. I have your details on file."
// (Doesn't ask for name/email again because it's verified)
```

---

## Database Structure

### Conversations Table
```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER,
  context TEXT,  -- ← JSON string with all collected data
  created_at DATETIME,
  updated_at DATETIME
);
```

**Sample record**:
```sql
id: 42
tenant_id: 1
context: '{"fullName":"Chris Jackson","email":"chris@example.com",...}'
created_at: '2025-11-20 00:42:00'
updated_at: '2025-11-20 00:45:30'
```

### Calls Table
```sql
CREATE TABLE calls (
  id INTEGER PRIMARY KEY,
  call_sid TEXT,           -- Twilio call ID
  conversation_id INTEGER, -- Links to conversations table
  from_number TEXT,        -- +61401687714
  status TEXT,
  recording_url TEXT,
  transcript TEXT
);
```

**Relationship**:
```
calls.conversation_id → conversations.id
```

---

## Key Functions

### Storage Functions
- `storage.getCallByCallSid(callSid)` - Find call record
- `storage.getConversation(conversationId)` - Get conversation data
- `storage.updateConversation(id, { context })` - Save to database

### Cliniko Functions
- `findPatientByPhone(phone)` - Search Cliniko by phone number
- `updateClinikoPatient(patientId, data)` - Update patient record
- `getOrCreatePatient(...)` - Find or create patient

---

## Error Handling

### If Cliniko Update Fails
```typescript
try {
  await updateClinikoPatient(patient.id, { email });
  console.log('✅ Cliniko updated');
} catch (clinikoErr) {
  // Data still saved to conversation context!
  console.warn('Could not update Cliniko immediately (will sync on booking)');
  // System will try again during next appointment booking
}
```

**Result**:
- ✅ Data is NEVER lost (always saved to conversation context)
- ⚠️ Cliniko update is "best effort" (retried on next booking if it fails)

---

## Summary

### Question: "Where does the information go?"

**Answer**:

1. **Local Database** (conversations.context):
   - Stores: fullName, firstName, email, verification flags
   - Immediate: ✅ Always succeeds
   - Used for: Ongoing conversations, AI context
   - Access: Your server has full control

2. **Cliniko** (patient record):
   - Updates: first_name, last_name, email
   - Immediate: ✅ Attempts immediately, retries on booking if fails
   - Used for: Official patient records, staff access, appointments
   - Access: Via Cliniko API

### Data Flow Timeline

```
0s  - Patient submits form
1s  - Form POSTs to /api/name-verify
2s  - Server updates conversation context ✅
3s  - Server finds patient in Cliniko by phone
4s  - Server updates Cliniko patient record ✅
5s  - Success message shown to patient
```

**Both systems are updated within seconds of form submission.**

---

## Verification

You can verify the data was stored by:

### 1. Check Logs
```bash
# In your server logs:
[NAME-VERIFY] Stored name from web form: Chris Jackson for call: CA123
[NAME-VERIFY] ✅ Cliniko patient updated with name
[EMAIL-COLLECT] Stored email from web form: chris@example.com for call: CA123
[EMAIL-COLLECT] ✅ Cliniko patient updated with email
```

### 2. Check Database
```sql
SELECT context FROM conversations WHERE id = 42;
-- Result: {"fullName":"Chris Jackson","email":"chris@example.com",...}
```

### 3. Check Cliniko Dashboard
```
Log into Cliniko → Patients → Search "Chris Jackson"
→ Should show: first_name: Chris, last_name: Jackson, email: chris@example.com
```

---

**Last Updated**: 2025-11-20
**Status**: ✅ Fully operational and tested
