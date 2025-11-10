# 🧪 Webhook Testing Guide

## ✅ Routes Added

Your EchoDesk webhook now has three testable endpoints:

1. **GET /health** - Simple health check (no Twilio required)
2. **POST /api/voice/test** - Test TwiML response (no signature validation)
3. **POST /api/voice/incoming** - Real Twilio webhook entry point (with signature validation in production)

---

## 🔧 Local Testing (Development Mode)

### 1. Health Check

```bash
curl http://localhost:5000/health
```

**Expected response:**
```json
{"ok":true,"env":"development"}
```

---

### 2. Test Route (No Twilio Signature Required)

```bash
curl -X POST http://localhost:5000/api/voice/test
```

**Expected response:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Olivia-Neural">This is a test Twi M L response. The voice system is working.</Say>
  <Redirect method="POST">/api/voice/handle?route=start</Redirect>
</Response>
```

---

### 3. Incoming Call Simulation

```bash
curl -X POST http://localhost:5000/api/voice/incoming \
  -d "CallSid=TEST123456" \
  -d "From=%2B61412345678" \
  -H "Content-Type: application/x-www-form-urlencoded"
```

**Expected response:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Olivia-Neural">Hello and welcome to your clinic. How can I help you today?</Say>
  <Pause length="1"/>
  <Redirect method="POST">/api/voice/handle?route=start&amp;callSid=TEST123456</Redirect>
</Response>
```

---

### 4. Test the Full Booking Flow

Simulate the "start" route to test intent detection:

```bash
curl -X POST "http://localhost:5000/api/voice/handle?route=start&callSid=TEST001" \
  -d "SpeechResult=I want to book an appointment" \
  -d "From=%2B61412345678" \
  -H "Content-Type: application/x-www-form-urlencoded"
```

**Expected:** TwiML with `<Gather>` asking about day preference

---

### 5. Test Reschedule Flow

```bash
curl -X POST "http://localhost:5000/api/voice/handle?route=start&callSid=TEST002" \
  -d "SpeechResult=I need to reschedule my appointment" \
  -d "From=%2B61412345678" \
  -H "Content-Type: application/x-www-form-urlencoded"
```

**Expected:** Redirect to reschedule-lookup route

---

## 🌐 Public Testing (via Replit URL)

Your public URL is: `https://workspace.mbjltd70.repl.co`

### 1. Test Health Endpoint

```bash
curl https://workspace.mbjltd70.repl.co/health
```

### 2. Test Voice Webhook

```bash
curl -X POST https://workspace.mbjltd70.repl.co/api/voice/test
```

### 3. Test Incoming Webhook

```bash
curl -X POST https://workspace.mbjltd70.repl.co/api/voice/incoming \
  -d "CallSid=TEST999" \
  -d "From=%2B61412345678" \
  -H "Content-Type: application/x-www-form-urlencoded"
```

---

## 🎯 Twilio Configuration

When you're ready to connect real Twilio calls:

1. Go to [Twilio Console](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Select your phone number
3. Under **"A call comes in"**:
   - **Method:** POST
   - **URL:** `https://workspace.mbjltd70.repl.co/api/voice/incoming`
4. Click **Save**

---

## 🔍 Debugging Tips

### Check Server Logs

Watch the console output when testing:

```bash
# In dev mode, logs appear automatically
# Look for:
[VOICE][INCOMING] { callSid: 'TEST123', from: '+61412345678' }
[VOICE][HANDLE IN] { route: 'start', callSid: 'TEST123', speechRaw: '...', digits: '', from: '+61412345678' }
```

### Test Different Intents

**Book appointment:**
```bash
curl -X POST "http://localhost:5000/api/voice/handle?route=start&callSid=TEST" \
  -d "SpeechResult=book" \
  -d "From=%2B61400000000"
```

**Reschedule:**
```bash
curl -X POST "http://localhost:5000/api/voice/handle?route=start&callSid=TEST" \
  -d "SpeechResult=reschedule" \
  -d "From=%2B61400000000"
```

**Cancel:**
```bash
curl -X POST "http://localhost:5000/api/voice/handle?route=start&callSid=TEST" \
  -d "SpeechResult=cancel" \
  -d "From=%2B61400000000"
```

---

## 📊 What Each Endpoint Does

| Endpoint | Signature Check | Purpose |
|----------|----------------|---------|
| `/health` | ❌ No | Quick server status check |
| `/api/voice/test` | ❌ No | Test TwiML without Twilio |
| `/api/voice/incoming` | ⚠️ Dev only | Entry point for Twilio calls |
| `/api/voice/handle` | ⚠️ Dev only | Handles conversation flow |

**Note:** In production (when `NODE_ENV=production`), signature validation is enabled automatically to secure your webhook.

---

## 🚨 Common Issues

### Issue: "No signature header error"

**Cause:** You're hitting a route with signature validation in dev mode  
**Solution:** Use `/api/voice/test` instead, or the validation is disabled in dev mode anyway (warning only)

### Issue: TwiML looks garbled

**Cause:** URL encoding in the response  
**Solution:** This is normal! Twilio decodes it automatically. The `abs()` function base64-encodes paths for security.

### Issue: No response from server

**Cause:** Server not running  
**Solution:** Check `npm run dev` is active in the console

---

## ✅ Success Checklist

- [ ] Health endpoint returns `{"ok":true}`
- [ ] Test route returns valid TwiML
- [ ] Incoming route returns greeting TwiML
- [ ] Handle route processes SpeechResult correctly
- [ ] Server logs show route processing
- [ ] Public URL works (for Twilio configuration)

---

**Your webhook is ready for testing! 🎉**

Use these commands to verify everything works before connecting Twilio.
